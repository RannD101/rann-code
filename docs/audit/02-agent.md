# Audit 02. Agent Core, Planning, Task Graph, Checkpoint, Recovery, Subagents

- Lingkup: RC-FR-021 sampai RC-FR-039 dan RC-FR-053 sampai RC-FR-062 (29 FR)
- Basis PRD: `docs/prd/01-requirements.md` 8.2 dan 8.4, `docs/prd/03-agent-core.md` 12 sampai 15, `docs/prd/ARCHITECTURE.md` 12, 13.3, 14.3, 14.4, 16 (tabel storage), `docs/prd/IMPLEMENTATION-ROADMAP.md` M4 dan M10, `docs/prd/ACCEPTANCE-CRITERIA.md`
- Kode yang diperiksa: `packages/runtime/src/{agent,rpc,daemon,policy,paths}.ts`, `packages/runtime/src/tools/index.ts`, `packages/storage/src/{db,repos}.ts`, `packages/shared/src/{events,config,errors,rpc}.ts`, `packages/cli/src/{main,args}.ts`

## 1. Ringkasan

| Status | Jumlah | FR |
|---|---|---|
| done | 0 | tidak ada |
| partial | 8 | 021, 028, 031, 032, 053, 056, 058, 062 |
| missing | 21 | 022, 023, 024, 025, 026, 027, 029, 030, 033, 034, 035, 036, 037, 038, 039, 054, 055, 057, 059, 060, 061 |

Tidak ada satu pun FR di lingkup ini yang memenuhi seluruh requirement. Yang ada adalah lapisan eksekusi turn yang bekerja (loop provider, tool call, izin tool, event) dan spawn subagent minimal. Lapisan perencanaan, task graph, checkpoint, verifikasi, dan orkestrasi multi-agent belum ada, baik di storage, runtime, RPC, maupun CLI.

Dari 29 FR, 19 berprioritas P0 di PRD. Seluruh 19 P0 tersebut berstatus missing atau partial, sehingga M4 dan M10 belum bisa dinyatakan selesai dan acceptance criteria RC-AC-021 sampai RC-AC-039 dan RC-AC-053 sampai RC-AC-062 belum ada yang terpenuhi.

### 1.1 Metode dan kondisi tes

- `grep` kata kunci penentu: `plan`, `replan`, `checkpoint`, `subagent`, `dag`, `topolog`, `lease`, `heartbeat`, `stalled`, `orphaned`, `maxRuntime`, `priority`, `E_NO_PROGRESS` di `packages/*/src` (tanpa `*.test.ts`). Hasil: `lease`, `heartbeat`, `stalled`, `orphaned`, `maxRuntime`, `priority`, `E_NO_PROGRESS` = 0 kemunculan. `checkpoint` hanya 3 kemunculan, semuanya di `packages/runtime/src/paths.ts` (definisi direktori, tidak dipakai).
- Tabel storage aktual: `profiles`, `projects`, `sessions`, `turns`, `messages`, `tool_calls`, `usage_events`, `audit_log`, `events`, `config_kv` (migrasi 1) dan `memories` (migrasi 2). Tabel yang diminta arsitektur tetapi tidak ada: `tasks`, `plans`, `checkpoints`, `path_leases`, `agent_messages`, `file_changes`. Lihat `packages/storage/src/db.ts:27-219` dan `docs/prd/ARCHITECTURE.md:587-615`.
- Metode RPC aktual ada 23 (`packages/shared/src/rpc.ts:148-170`). Tidak ada `task.*`, `plan.*`, `approval.list`, `agent.*`, `checkpoint.*` yang diminta `docs/prd/ARCHITECTURE.md:768-775`.
- Baseline tes: 52 tes di 11 berkas, semuanya lulus dengan Node 22.23.3. Dengan Node 26.7.0 (default PATH di mesin ini) 15 tes gagal seluruhnya karena `better-sqlite3` melaporkan `Module did not self-register` (ABI native), bukan kegagalan logika. Tidak ada satu pun dari 52 tes yang menyentuh plan, task graph, checkpoint, verifier, atau lifecycle agen. Rincian: `daemon.test.ts` 8 tes (termasuk satu tes subagent), `tools.test.ts` 8, `policy.test.ts` 8, `db.test.ts` 4, `memory-skills.test.ts` 5, sisanya provider, MCP, config, error, id.

## 2. Agent dan planning (RC-FR-021 sampai RC-FR-039)

### RC-FR-021. Agent reasoning loop

- Ringkasan: loop agent berfase understand, plan, act, observe, evaluate, verify, report; berhenti hanya jika kriteria selesai terpenuhi, dibatalkan, budget habis, atau gagal permanen.
- Status: **partial**
- Bukti: `packages/runtime/src/agent.ts:233-487` (`runTurn`), loop di `agent.ts:317`, publish event di `agent.ts:252-255`, finalisasi di `agent.ts:244-250`, batas langkah di `agent.ts:473-476`. Ada juga `maxSteps` dan budget token per turn dan per hari (`agent.ts:265-273`, `353-358`).
- Kekurangan:
  - Tidak ada fase. Loop hanya "panggil model, jalankan tool, ulang". Tidak ada state `understand`, `plan`, `observe`, `evaluate`, `verify`, `report`, dan tidak ada state machine yang diminta `03-agent-core.md` 12.4 dan 12.12.
  - `agent.ts:375-388` menutup turn sebagai `done` begitu model berhenti tanpa tool call, tanpa memeriksa kriteria selesai. Ini melanggar requirement 2 dan 5 secara langsung dan menjadi akar masalah FR-039.
  - Event per fase tidak ada. `EventType` (`packages/shared/src/events.ts:1-14`) hanya punya `turn.started`, `message.delta`, `message.completed`, `tool.started`, `tool.finished`, `approval.requested`, `context.compacted`, `subagent.started`, `subagent.finished`, `turn.completed`, `turn.failed`, `log`.
  - Larangan mengubah goal dan menaikkan permission tidak ditegakkan di runtime karena goal sendiri tidak ada sebagai objek (lihat FR-036). Permission hanya dibaca dari config per sesi (`rpc.ts:371-380`), tidak ada jalur yang bisa menaikkannya, jadi larangan ini terpenuhi secara kebetulan, bukan oleh penegakan eksplisit.
  - Audit trail tidak ditulis sama sekali: `appendAudit` dan `verifyAuditChain` ada di `packages/storage/src/repos.ts:546-586` tetapi tidak dipanggil dari mana pun (`grep appendAudit` hanya menemukan definisinya).
- Tes yang belum ada: turn dengan model yang berhenti tanpa tool call tetapi kriteria belum terpenuhi harus memicu `premature_finish` lalu verifikasi; urutan event fase; `done` tidak boleh terjadi tanpa jejak verifikasi; turn yang dibatalkan di tengah fase.

### RC-FR-022. Perencanaan otomatis

- Ringkasan: planner dipanggil untuk goal kompleks, menghasilkan plan berisi goal, task, dependensi, agen, file, risiko, estimasi, kriteria selesai, divalidasi dan disimpan sebelum eksekusi.
- Status: **missing**
- Bukti: tidak ada modul planner (`packages/runtime/src/planner.ts` tidak ada; `grep -i planner` di `packages/*/src` nol hasil). `agent.ts:88-119` (`systemPrompt`) tidak memuat instruksi planning atau skema plan. Tidak ada tipe `Plan` atau `PlanTask` di `packages/shared/src`.
- Kekurangan: tidak ada klasifikasi tugas (`answer`, `inspect`, `modify`, `operate`, `research`, `incident`) seperti `03-agent-core.md` 12.5; tidak ada pemicu "≥ 3 langkah, ≥ 3 file, dependensi eksternal"; tidak ada validasi skema; tidak ada cek siklik; tidak ada penyimpanan plan sebelum langkah pertama; tidak ada pencatatan keputusan "planner dilewati".
- Tes yang belum ada: goal 3 langkah menghasilkan ≥ 3 task; goal sepele melewati planner dan keputusannya tercatat; plan invalid (task tanpa acceptance) ditolak; plan dengan siklus ditolak dengan daftar edge.

### RC-FR-023. Mode plan eksplisit

- Ringkasan: `/plan` atau mode `plan` hanya menghasilkan rencana, tanpa tool tulis atau shell; pengguna bisa menyetujui, menolak, mengedit; `--plan-only` mengeluarkan JSON; perpindahan ke eksekusi butuh aksi eksplisit.
- Status: **missing**
- Bukti: REPL hanya mengenal `/new`, `/status`, `/model`, `/permission`, `/tools`, `/usage`, `/sessions`, `/exit` (`packages/cli/src/main.ts:510-560`). `packages/cli/src/args.ts` tidak punya flag `plan` atau `plan-only`; `flagBool`/`flagString` generik saja. Tidak ada method RPC `plan.*`.
- Kekurangan: tidak ada mode plan, tidak ada pemblokiran tool tulis khusus plan, tidak ada output JSON plan, tidak ada `/execute`. Mode `read-only` di `policy.ts:57` memang memblokir tulis dan exec, tetapi itu mode izin umum, bukan mode plan, dan tidak menghasilkan rencana apa pun.
- Tes yang belum ada: `/plan` tidak mengeksekusi `fs_write` maupun `shell_run`; `--plan-only` mengeluarkan JSON yang lolos skema; `/execute` menolak plan yang belum disetujui.

### RC-FR-024. Dekomposisi tugas dan DAG

- Ringkasan: setiap task punya id, judul, tujuan, agen, dependensi, file, risiko, kriteria selesai; dependensi membentuk DAG; siklus ditolak; task tanpa kriteria tidak valid; task paralel dijadwalkan bersamaan; perubahan DAG menaikkan versi plan.
- Status: **missing**
- Bukti: tidak ada tabel `tasks` atau `plan_tasks` (`db.ts:27-219`), tidak ada fungsi repo task (`repos.ts` hanya sesi, turn, pesan, tool call, usage, memori, event, audit). Unit kerja satu-satunya adalah `turn`.
- Kekurangan: seluruh requirement 1 sampai 5 tidak terpenuhi. Tidak ada penanda task paralel, tidak ada kriteria selesai, tidak ada versi plan.
- Tes yang belum ada: validasi DAG dengan 6 task; penolakan siklus A→B→C→A beserta edge yang salah; penolakan task tanpa acceptance; kenaikan versi setelah DAG berubah.

### RC-FR-025. Deteksi dependensi dan urutan eksekusi

- Ringkasan: dependensi eksplisit dan implisit dideteksi; topological sort deterministik; task dengan dependensi gagal menjadi `blocked`; task non-kritis berjalan lebih dulu; dependensi divalidasi ulang saat replanning.
- Status: **missing**
- Bukti: tidak ada topological sort, tidak ada status `blocked` (status turn hanya `queued`, `running`, `done`, `failed`, `cancelled`, lihat `db.ts:71`), eksekusi sepenuhnya sekuensial di dalam satu loop model (`agent.ts:317-470`).
- Kekurangan: seluruh requirement tidak terpenuhi. Tidak ada analisis dependensi implisit dari file atau modul.
- Tes yang belum ada: urutan A→B→C dihormati; sort deterministik untuk input sama; dependensi gagal menghasilkan `blocked` bukan `failed`.

### RC-FR-026. Penilaian risiko

- Ringkasan: risiko task dinilai dari kategori (skema data, migrasi, hapus file, Git destruktif, auth, dependency baru, deploy) dengan level low/medium/high dan alasan; task high selalu butuh approval termasuk mode trusted; ringkasan risiko tampil di plan dan approval.
- Status: **missing**
- Bukti: satu-satunya penilaian yang ada adalah risiko per tool: `ToolRisk = "read" | "write" | "exec"` (`policy.ts:4`) dan daftar pola shell berbahaya `DANGEROUS_SHELL` (`policy.ts:7-21`), dipakai di `decide()` (`policy.ts:49-63`).
- Kekurangan: tidak ada level task, tidak ada kategori risiko, tidak ada alasan tertulis. `policy.ts:59` membuat mode `trusted` mengizinkan semua yang bukan deny, sehingga "high selalu butuh approval" tidak mungkin dipenuhi sekarang. Tidak ada ringkasan risiko di mana pun.
- Tes yang belum ada: task yang menyentuh migrasi database dinilai high dan memaksa approval walau mode `trusted`; penilaian tidak turun karena model menyatakan yakin.

### RC-FR-027. Estimasi eksekusi

- Ringkasan: estimasi rentang menit dan biaya, berlabel `historical` atau `heuristic`, diperbarui setelah plan berubah, `tidak tersedia` jika data kurang, dan selisih aktual dicatat.
- Status: **missing**
- Bukti: tidak ada estimator. Data mentah tersedia di `usage_events` (`repos.ts:288-324`, `summarizeUsage`, `sumTokensSince`) tetapi tidak dipakai untuk estimasi.
- Kekurangan: seluruh requirement tidak terpenuhi, termasuk penyimpanan selisih aktual vs estimasi.
- Tes yang belum ada: plan 5 task menghasilkan rentang, bukan angka tunggal; tanpa histori menghasilkan label `heuristic` atau `tidak tersedia`; estimasi berubah setelah replan.

### RC-FR-028. Persetujuan rencana

- Ringkasan: approval menampilkan goal, task, risiko, file, estimasi; pengguna bisa setuju semua, setuju sebagian, tolak, atau minta revisi; task yang tidak disetujui tetap pending; approval kedaluwarsa; keputusan dicatat dengan aktor, waktu, alasan.
- Status: **partial**
- Bukti: mekanisme approval ada, tetapi untuk tool, bukan untuk plan. `agent.ts:447-459` melempar `E_APPROVAL_REQUIRED` lalu meminta keputusan; `rpc.ts:267-302` membuat `requestId`, menulis event `approval.requested`, memasang timeout 10 menit, dan mendengarkan abort; `rpc.ts:304-309` (`respondPermission`); ingatan "selalu" per sesi di `rpc.ts:50` dan `rpc.ts:363`. Sisi CLI: `makeApprovalHandler` di `packages/cli/src/main.ts:420-446`.
- Kekurangan: tidak ada approval plan (goal, task, risiko, file, estimasi); tidak ada persetujuan sebagian per task; tidak ada konsep plan kedaluwarsa, hanya timeout satu request; keputusan tidak mencatat aktor dan alasan (payload event hanya `request_id`, `tool`, `args` di `rpc.ts:275-280`); tidak ada `approval.list` sehingga approval yang menunggu tidak bisa dilihat setelah reconnect; tidak ada mekanisme revisi dengan catatan.
- Tes yang belum ada: setujui sebagian task lalu hanya task itu berjalan; approval kedaluwarsa memaksa plan disetujui ulang; keputusan tercatat dengan aktor dan alasan; tool tulis tetap terblokir selama plan menunggu approval.

### RC-FR-029. Persistensi dan versi rencana

- Ringkasan: plan disimpan di tabel `plans` dengan versi dan status; versi lama menjadi `superseded`; `/plan show` menampilkan versi aktif dan riwayat; plan bisa diekspor dan diimpor JSON; plan terhubung ke task dan sesi.
- Status: **missing**
- Bukti: tidak ada tabel `plans` (`db.ts`), tidak ada fungsi repo plan (`repos.ts`), tidak ada perintah `/plan` (`main.ts:510-560`).
- Kekurangan: seluruh requirement tidak terpenuhi, termasuk keterkaitan plan ke sesi asal.
- Tes yang belum ada: plan bertahan setelah daemon restart; revisi menandai versi lama `superseded`; ekspor lalu impor menghasilkan plan identik; `/plan show` menampilkan riwayat.

### RC-FR-030. Replanning dinamis

- Ringkasan: replan dipicu kegagalan permanen, dependensi berubah, file target hilang, atau goal berubah; versi +1 dengan alasan; perubahan besar butuh approval ulang; perubahan kecil otomatis tetapi dicatat; task selesai tidak diulang.
- Status: **missing**
- Bukti: tidak ada trigger replan. Satu-satunya reaksi terhadap kegagalan tool adalah mengembalikan error ke model dan lanjut iterasi (`agent.ts:461-469`), tanpa perubahan plan karena plan tidak ada.
- Kekurangan: seluruh requirement tidak terpenuhi. Tidak ada pencatatan alasan replan.
- Tes yang belum ada: asumsi plan terbukti salah memicu versi +1 dengan alasan; penambahan task high memicu approval ulang; task yang sudah `done` tidak dijalankan lagi.

### RC-FR-031. Eksekusi multi-langkah dan pemilihan tool

- Ringkasan: tool dipilih berdasarkan capability, izin, biaya, konteks; tool tidak diizinkan tidak pernah dikirim ke model; setiap tool call punya id, args tervalidasi, timeout, audit; tool paralel diizinkan bila independen; kegagalan menghasilkan error terstruktur.
- Status: **partial**
- Bukti: multi-langkah berjalan (`agent.ts:317-470`); setiap call dicatat `addToolCall` (`repos.ts:254-261`) dan diselesaikan `completeToolCall` (`repos.ts:263-276`); validasi argumen zod di `packages/runtime/src/tools/index.ts:53-117`; timeout shell di `tools/index.ts:278` dan `318-321`; error terstruktur dikembalikan ke model di `agent.ts:418-428`.
- Kekurangan:
  - Requirement 2 dilanggar. Filter kandidat di `agent.ts:308-314` hanya menyembunyikan `memory`, `skill`, dan `task` bila service tidak tersedia. Tidak ada filter berdasarkan `permissionMode`, `allow`, dan `deny`, sehingga `shell_run` dan `fs_write` tetap dikirim ke model di mode `read-only`. Penolakan baru terjadi saat eksekusi (`tools/index.ts:212`, `268`), padahal PRD melarang tool tersebut muncul sebagai kandidat.
  - Requirement 4 tidak terpenuhi: `for (const call of calls)` di `agent.ts:390` menjalankan tool satu per satu, tidak paralel, dan tidak ada batas concurrency.
  - Requirement 3 separuh: `call.id` dari provider disimpan di pesan, tetapi `tool_calls` memakai id internal (`toolRow.id`), tidak ada idempotency key, dan `audit_log` tidak pernah ditulis.
  - Batas 32 tool dan tool search dua tahap (`03-agent-core.md` 12.6) tidak ada.
- Tes yang belum ada: mode `read-only` tidak pernah mengirim `fs_write`/`shell_run` ke provider (periksa argumen `provider.chat`); dua tool independen dieksekusi paralel; tool gagal mengembalikan error terstruktur yang memuat code dan retryable; audit tercatat untuk setiap tool call.

### RC-FR-032. Observasi dan evaluasi

- Ringkasan: hasil tool dinormalisasi menjadi observation (status, ringkasan, data, artefak); agent mengevaluasi terhadap kriteria langkah; hasil kosong, error, atau terpotong tidak dianggap sukses; evaluasi dicatat di trace dengan alasan; ketidaktahuan dinyatakan eksplisit.
- Status: **partial**
- Bukti: `ToolResult { ok, output, exitCode, durationMs }` (`tools/index.ts:29-34`); normalisasi ke pesan dan event di `agent.ts:395-416`; output dipotong 20.000 karakter (`agent.ts:402`); penanda `truncated` di `tools/index.ts:292-297` dan `332`.
- Kekurangan: tidak ada tipe `Observation` dengan `status`, `summary` 400 karakter, `artifactRef`, `provenance`, `metrics` (`03-agent-core.md` 12.7). Tidak ada langkah evaluasi terhadap kriteria langkah, jadi tidak ada `success`, `partial`, `failure_retryable`, `failure_terminal`, `unexpected`. Output yang terpotong tetap `ok: true` (`tools/index.ts:329-335`), melanggar requirement 3. Tidak ada alasan evaluasi di trace.
- Tes yang belum ada: output kosong ditandai bukan sukses; output terpotong tidak dihitung sukses; evaluasi menulis alasan ke event; kegagalan evaluasi menghasilkan pernyataan tidak tahu, bukan klaim.

### RC-FR-033. Self-correction dan strategi retry

- Ringkasan: retry mengikuti matriks 13.3; setelah dua kegagalan identik, percobaan ketiga wajib mengubah strategi; jika tidak ada alternatif, berhenti dengan `E_NO_PROGRESS`; perubahan strategi dicatat; tool tidak idempoten tidak diulang otomatis.
- Status: **missing**
- Bukti: `grep E_NO_PROGRESS` nol hasil, dan kode error itu tidak ada di `ERROR_CODES` (`packages/shared/src/errors.ts:1-31`). Tidak ada pelacakan kegagalan identik; satu-satunya batas adalah `maxSteps` (`agent.ts:317`, `473-476`). `RETRYABLE` di `errors.ts:69-79` hanya metadata dan tidak dipakai untuk retry.
- Kekurangan: seluruh requirement tidak terpenuhi. Agent saat ini bisa memanggil tool yang sama dengan argumen sama sampai `maxSteps` habis, lalu gagal dengan `E_BUDGET_EXHAUSTED` yang menyesatkan.
- Tes yang belum ada: kegagalan identik ketiga menghasilkan `E_NO_PROGRESS`; percobaan ketiga yang mengubah parameter diizinkan; tool tidak idempoten tidak diulang otomatis.

### RC-FR-034. Pemulihan error

- Ringkasan: error diklasifikasikan transient, permanent, conflict, budget, policy; transient diretry, permanent dihentikan dengan saran, conflict memicu replan, budget menghentikan task dengan laporan; state dan lease disimpan atau dilepas sebelum retry; checkpoint tersedia untuk rollback; pengguna bisa memilih retry, skip, replan, abort.
- Status: **missing**
- Bukti: hanya kerangka klasifikasi yang ada, `RETRYABLE` dan exit code per kode error di `packages/shared/src/errors.ts:69-135`. Tidak ada backoff, tidak ada pemilihan aksi pengguna, tidak ada rollback.
- Kekurangan: seluruh perilaku tidak ada. `agent.ts:461-469` hanya mencatat kegagalan tool dan melanjutkan loop; `agent.ts:477-486` memfinalisasi turn `failed` tanpa saran. Tidak ada lease untuk dilepas, tidak ada checkpoint untuk rollback, dan tidak ada jalur `retry`, `skip`, `replan`, `abort` seperti pada approval.
- Tes yang belum ada: error transient diretry dengan backoff lalu sukses; error policy langsung berhenti tanpa retry; pengguna memilih skip lalu turn lanjut; state konsisten setelah error di tengah tool tulis.

### RC-FR-035. Prioritas task

- Ringkasan: prioritas integer, makin tinggi makin dulu; task berjalan tidak dibatalkan saat prioritas berubah; task high bisa memakai antrean terpisah; task yang menunggu approval tidak menghalangi task lain; perubahan prioritas dicatat.
- Status: **missing**
- Bukti: tidak ada kolom `priority` di skema mana pun (`db.ts`), tidak ada antrean. Satu sesi hanya boleh punya satu turn aktif (`rpc.ts:353`), sehingga tidak ada kumpulan task untuk diprioritaskan.
- Kekurangan: seluruh requirement tidak terpenuhi.
- Tes yang belum ada: lima task antre dengan prioritas berbeda dijalankan berurutan sesuai prioritas; menaikkan prioritas tidak membatalkan task yang sedang berjalan; task menunggu approval tidak memblokir task lain.

### RC-FR-036. Goal tracking dan state

- Ringkasan: goal, kriteria selesai, dan asumsi disimpan di state task; state diperbarui setiap langkah dan bertahan setelah restart; goal tidak bisa diubah agent; kriteria terpenuhi ditandai bukti; `/status` menampilkan goal, progres, kriteria yang belum terpenuhi.
- Status: **missing**
- Bukti: tidak ada objek `Goal` atau `Criterion` (`03-agent-core.md` 12.10). `sessions.metadata_json` ada tetapi selalu ditulis `'{}'` (`repos.ts:105`). `/status` hanya mencetak sesi, model, izin, folder, dan status sesi (`packages/cli/src/main.ts:519-527`).
- Kekurangan: goal hanya tersimpan implisit sebagai pesan user pertama; tidak ada kriteria, asumsi, progres, atau bukti. `/status` tidak menampilkan goal dan kriteria.
- Tes yang belum ada: goal dan 3 kriteria bertahan setelah restart; satu kriteria gagal membuat status bukan `done`; `/status` menampilkan kriteria yang belum terpenuhi.

### RC-FR-037. Dukungan task panjang

- Ringkasan: heartbeat ≤ 10 detik; task tanpa heartbeat > 60 detik menjadi `stalled` dan bisa dipulihkan; checkpoint berkala dan budget terkonfigurasi; progres dan log tersedia dari CLI, dashboard, messaging; `maxRuntime` wajib.
- Status: **missing**
- Bukti: `grep heartbeat`, `stalled`, `maxRuntime` nol hasil. Config agent hanya `max_steps` dan `system_extra` (`packages/shared/src/config.ts:36-41`). Tabel `turns` tidak punya kolom heartbeat (`db.ts:68-82`).
- Kekurangan: seluruh requirement tidak terpenuhi. Tidak ada batas waktu berjalan, hanya batas jumlah langkah; satu turn dengan tool lambat bisa berjalan tanpa batas.
- Tes yang belum ada: heartbeat tertulis ≤ 10 detik selama turn berjalan; turn tanpa heartbeat 60 detik ditandai `stalled`; turn melewati `maxRuntime` berhenti dengan laporan.

### RC-FR-038. Checkpoint dan kelanjutan task

- Ringkasan: checkpoint dibuat sebelum tool tulis, setelah test lulus, dan setiap N langkah; menyimpan state task, file berubah, hash, Git ref; setelah crash task dipulihkan dari checkpoint terakhir tanpa mengulang langkah sukses; restore mengembalikan file dan state dengan konfirmasi; `/checkpoint` untuk melihat dan menghapus.
- Status: **missing**
- Bukti: `packages/runtime/src/paths.ts:15` dan `47` mendefinisikan `checkpointsDir`, dan `paths.ts:60` membuat direktorinya, tetapi tidak ada kode yang menulis atau membacanya. Tidak ada tabel `checkpoints` (`db.ts`), tidak ada modul checkpoint, tidak ada perintah `/checkpoint` (`main.ts:510-560`).
- Kekurangan: seluruh requirement tidak terpenuhi. Ini juga memblokir FR-034 requirement 4 dan RC-AC-038 (kill -9 lalu pulih ≤ 5 detik), yang saat ini mustahil karena turn yang berjalan hanya hidup di memori proses dan `turns.status` akan tertinggal `running` setelah crash.
- Tes yang belum ada: checkpoint dibuat sebelum `fs_write`; setelah `kill -9` dan restart, task pulih dari checkpoint terakhir; langkah sukses tidak diulang; restore menolak menimpa perubahan pengguna tanpa konfirmasi; `/checkpoint` menampilkan daftar.

### RC-FR-039. Analisis kegagalan dan verifikasi

- Ringkasan: sebelum `done`, verifier menjalankan kriteria (tes, build, runtime, diff, file existence); klaim tanpa bukti ditolak dan status menjadi `verifying` atau `failed`; laporan gagal memuat langkah, error asli, hipotesis, saran; laporan sukses memuat file berubah, perintah verifikasi, hasil; verifikasi yang tidak bisa dijalankan ditandai `unverified`.
- Status: **missing**
- Bukti: tidak ada modul verifier dan tidak ada status `verifying` (status turn hanya `queued`, `running`, `done`, `failed`, `cancelled`, `db.ts:71`). `agent.ts:375-388` menutup turn sebagai `done` dan mengirim `turn.completed` hanya berisi `steps`, `usage`, `text`.
- Kekurangan: seluruh requirement tidak terpenuhi. Klaim sukses model langsung dipercaya. Tidak ada laporan terstruktur untuk sukses maupun gagal, dan tidak ada penanda `unverified`.
- Tes yang belum ada: klaim selesai tanpa menjalankan tes ditolak dan turn tidak berstatus `done`; kriteria `file` yang tidak terpenuhi menghasilkan `failed`; verifikasi yang tidak bisa dijalankan menghasilkan `unverified`; laporan sukses memuat perintah dan hasil verifikasi.

## 3. Subagents dan agent teams (RC-FR-053 sampai RC-FR-062)

### RC-FR-053. Spawn subagent dan profil

- Ringkasan: subagent dibuat dengan profil (model, system prompt, tool allowlist, permission mode, budget); profil dari bawaan, `~/.rann/agents/`, `.rann/agents/`; spawn mencatat parent, goal, konteks, batas kedalaman; izin anak adalah irisan profil dan kebijakan sesi; hasil terstruktur, bukan transkrip.
- Status: **partial**
- Bukti: tool `task` (`packages/runtime/src/tools/index.ts:431-453`) memanggil `delegate`; `rpc.ts:392-411` membatasi `max_per_turn` dan menjalankan `runSubagent`; `rpc.ts:446-540` membuat sesi anak dengan `parentId` (`repos.ts:98-108`), memakai `config.subagents.model` dan `config.subagents.permission_mode` (`rpc.ts:462-463`), menyusun prompt anak eksplisit (`rpc.ts:490-497`), dan mengembalikan `{ session_id, turn_id, text, steps, usage, compacted }` (`rpc.ts:528-535`). Config `subagents` di `packages/shared/src/config.ts:56-64`.
- Kekurangan: tidak ada profil sama sekali, sehingga model, prompt, tool allowlist, permission, dan budget tidak bisa ditentukan per profil; tidak ada batas kedalaman yang divalidasi atau dicatat; izin anak diambil dari config global (`config.subagents.permission_mode`), bukan irisan profil dengan kebijakan sesi, sehingga anak bisa lebih longgar atau lebih ketat tanpa aturan; hasil tidak memuat bukti, file berubah, atau biaya terstruktur (`usage` hanya token, tanpa biaya); alasan spawn tidak dicatat, hanya `label` pada event (`agent.ts:280-296`).
- Tes yang belum ada: profil `reviewer` menghasilkan model, allowlist, dan budget sesuai profil; hasil anak memuat status, bukti, file berubah, biaya; spawn melebihi `max_per_turn` ditolak.

### RC-FR-054. Specialisasi agent

- Ringkasan: profil bawaan minimal architect, research, coding, frontend, backend, testing, security, reviewer, documentation; tiap profil punya deskripsi, trigger, allowlist, output yang diharapkan; profil bisa diperluas tanpa mengubah kode inti; agent utama memilih profil berdasarkan task; profil tidak cocok ditolak dengan alasan.
- Status: **missing**
- Bukti: tidak ada direktori atau loader profil; `packages/runtime/src/skills.ts` adalah mekanisme skill, bukan profil agen. Tidak ada tipe `AgentProfile` di `packages/shared/src`.
- Kekurangan: seluruh requirement tidak terpenuhi. Prompt anak adalah template tetap di `rpc.ts:490-497` tanpa spesialisasi.
- Tes yang belum ada: sembilan profil bawaan termuat; profil dari `.rann/agents/*.md` menimpa bawaan; profil yang tidak cocok ditolak dengan alasan; pemilihan profil tidak bergantung pada nama yang disebut pengguna.

### RC-FR-055. Eksekusi paralel

- Ringkasan: concurrency dibatasi per provider, per model, per sesi; task paralel hanya jika tanpa dependensi dan tanpa konflik lease; budget total parent mencakup anak; kegagalan satu anak tidak membatalkan yang lain kecuali `failFast`; hasil digabung dengan status dan bukti.
- Status: **missing**
- Bukti: subagent dijalankan sekuensial. `tools/index.ts:450` menunggu `ctx.delegate(...)`, dan `rpc.ts:503` menunggu `runTurn` anak sampai selesai. Tidak ada pool, antrean, atau penghitung concurrency; yang ada hanya `max_per_turn` (`rpc.ts:395-400`).
- Kekurangan: seluruh requirement tidak terpenuhi. Tidak ada `failFast`, tidak ada penggabungan hasil paralel, tidak ada pembagian budget eksplisit antara parent dan anak (anak memakai batas per turn dan per hari yang sama, `rpc.ts:517-520`).
- Tes yang belum ada: delapan tugas independen berjalan paralel dengan waktu < 60 persen serial; batas concurrency per provider dihormati; satu anak gagal tanpa membatalkan yang lain; total biaya anak tidak melebihi budget parent.

### RC-FR-056. Delegasi dan agregasi hasil

- Ringkasan: delegasi menyertakan goal, kriteria selesai, konteks, file, batas waktu; anak mengembalikan status, ringkasan, bukti, file berubah, biaya; klaim tanpa bukti ditandai `unverified`; konflik antar hasil dilaporkan; agregasi disimpan di task parent.
- Status: **partial**
- Bukti: `DelegateInput { goal, context?, label? }` (`agent.ts:43-47`); hasil ringkas dari anak (`rpc.ts:528-535`); event `subagent.started` dan `subagent.finished` di `agent.ts:280-296`.
- Kekurangan: delegasi tidak membawa kriteria selesai, daftar file, atau batas waktu; hasil tidak memuat bukti, file berubah, biaya, atau penanda `unverified`; tidak ada deteksi konflik; tidak ada agregasi tersimpan karena task parent tidak ada sebagai entitas. Hasil anak masuk ke percakapan sebagai teks tool, sehingga bisa hilang saat compaction.
- Tes yang belum ada: tiga subagent selesai menghasilkan agregasi berisi status, bukti, biaya, konflik; klaim tanpa bukti ditandai `unverified`; konflik dua hasil dilaporkan, bukan dipilih diam-diam.

### RC-FR-057. Komunikasi antar agen

- Ringkasan: pesan terstruktur (tipe, subjek, isi, referensi, prioritas); dicatat di `agent_messages` dan bisa diaudit; hanya ke parent, anak, atau peer satu tim; pesan tidak bisa mengubah goal atau izin; eskalasi ke pengguna setelah 3 pertukaran.
- Status: **missing**
- Bukti: tidak ada tabel `agent_messages` (`db.ts`), tidak ada tipe `AgentMessage` (`03-agent-core.md` 15.5), tidak ada tool atau RPC untuk mengirim pesan. Satu-satunya komunikasi adalah nilai balik `delegate`.
- Kekurangan: seluruh requirement tidak terpenuhi, termasuk aturan tujuan pesan dan eskalasi.
- Tes yang belum ada: pesan tercatat dan bisa dibaca lewat RPC; agen tidak bisa mengirim ke agen di luar tim; pesan tidak mengubah goal penerima; konflik tiga pertukaran memicu eskalasi.

### RC-FR-058. Konteks bersama dan terisolasi

- Ringkasan: mode `shared` membagikan goal, keputusan, artefak, ringkasan; mode `isolated` hanya goal dan konteks eksplisit; transkrip penuh parent tidak pernah diberikan ke anak; anak bisa meminta konteks tambahan dengan persetujuan parent; kebocoran memory atau secret antar agen ditolak.
- Status: **partial**
- Bukti: anak menerima goal sebagai pesan user (`rpc.ts:507`) dan konteks eksplisit di `systemExtra` (`rpc.ts:490-497`); riwayat pesan anak terpisah karena memakai sesi sendiri (`listMessages` per sesi, `repos.ts:235`). Requirement 2 dan 3 terpenuhi.
- Kekurangan: mode `shared` tidak ada; keputusan, artefak, lease, dan hasil verifikasi tidak dibagikan; tidak ada permintaan konteks tambahan dengan persetujuan parent; tidak ada kontrol kebocoran. Catatan penting: anak memakai `MemoryService` pada database yang sama (`rpc.ts:474-480`), sehingga seluruh memori global terbaca anak tanpa filter, dan `memories` tidak punya kepemilikan agen (`db.ts:186-196`).
- Tes yang belum ada: mode `shared` membagikan ringkasan dan keputusan tetapi bukan transkrip; mode `isolated` hanya memberi goal dan konteks eksplisit; memori agen lain tidak terbaca; permintaan konteks tambahan ditolak tanpa persetujuan parent.

### RC-FR-059. Hierarki agen

- Ringkasan: kedalaman maksimal tiga tingkat termasuk root; jumlah anak per agen dibatasi konfigurasi default 8; setiap agen punya id, parent, dan path hierarki; agen tidak bisa menjadi parent dirinya sendiri; siklus parent-child ditolak saat spawn.
- Status: **missing**
- Bukti: `sessions.parent_id` ada (`db.ts:55`) dan diisi saat spawn (`rpc.ts:460`), tetapi tidak pernah dibaca untuk validasi. Kode error `E_AGENT_DEPTH` tidak ada di `ERROR_CODES` (`errors.ts:1-31`). Kedalaman efektif sekarang 2 karena `runSubagent` tidak meneruskan `delegate` ke `runTurn` anak (`rpc.ts:503-526`), jadi anak tidak bisa spawn, tetapi ini konsekuensi tidak adanya fitur, bukan penegakan aturan.
- Kekurangan: tidak ada perhitungan kedalaman dari rantai `parent_id`, tidak ada batas 8 anak per agen, tidak ada `path` hierarki, tidak ada penolakan self-parent atau siklus, tidak ada pesan error yang sesuai.
- Tes yang belum ada: spawn tingkat keempat ditolak dengan `E_AGENT_DEPTH`; anak ke-9 ditolak; spawn dengan parent dirinya sendiri ditolak; siklus parent-child ditolak.

### RC-FR-060. Pencegahan konflik file

- Ringkasan: lease per path dengan TTL dan heartbeat sebelum menulis; lease kedua ditolak sampai lepas atau kedaluwarsa; hash file diperiksa setelah menulis dan tulis dibatalkan bila berubah di luar agen; perubahan bentrok masuk merge queue dan diselesaikan dengan diff; lease yatim dilepas otomatis.
- Status: **missing**
- Bukti: tidak ada tabel `path_leases` (`db.ts`), tidak ada fungsi lease (`repos.ts`), `grep lease` nol hasil di `packages/*/src`. `fs_edit` (`tools/index.ts:235-249`) membaca file, menghitung kemunculan, menulis langsung, tanpa `expectedHash` dan tanpa baca ulang setelah tulis. `fs_write` (`tools/index.ts:210-217`) menimpa tanpa pemeriksaan apa pun.
- Kekurangan: seluruh requirement tidak terpenuhi. Dua agen yang menulis file yang sama akan saling menimpa tanpa error, dan ini adalah skenario RC-AC-060 yang saat ini pasti gagal. Karena subagent berbagi workspace dan DB yang sama, risikonya nyata meski eksekusi masih sekuensial.
- Tes yang belum ada: lease kedua pada path sama ditolak dengan `E_LEASE_CONFLICT`; lease kedaluwarsa bisa diambil alih; tulis dibatalkan bila hash berubah di luar agen; antrean merge menghasilkan diff, bukan timpa.

### RC-FR-061. Lifecycle dan monitoring agen

- Ringkasan: status agen `starting`, `running`, `waiting`, `done`, `failed`, `cancelled`; `/agents` menampilkan pohon, status, langkah, biaya, heartbeat; heartbeat ≤ 10 detik dan agen tanpa heartbeat 60 detik menjadi `orphaned`; agen selesai menyimpan hasil dan transcript ringkas; dashboard menampilkan data yang sama.
- Status: **missing**
- Bukti: sesi hanya punya status `active`, `closed`, `error` (`db.ts:57`). Tidak ada perintah `/agents` (`main.ts:510-560`). `health()` hanya mengembalikan `active_turns` berisi id sesi (`rpc.ts:311-324`). Tidak ada heartbeat atau biaya per agen; `usage_events` mencatat per sesi tetapi tidak diagregasi per pohon agen.
- Kekurangan: seluruh requirement tidak terpenuhi. Pemantauan hanya mungkin lewat `session.list` dan `session.get`, tanpa pohon, langkah, biaya, atau heartbeat.
- Tes yang belum ada: `/agents` menampilkan pohon dan status lima agen; agen tanpa heartbeat 60 detik menjadi `orphaned`; biaya per agen terhitung; transcript ringkas tersimpan setelah agen selesai.

### RC-FR-062. Pembatalan dan pemulihan agen

- Ringkasan: cancel satu agen menghentikan model call dan tool, melepas lease, menyimpan state; cancel parent membatalkan semua anak ≤ 3 detik; agen yang dibatalkan berstatus `cancelled`, bukan gagal; agen orphan dipulihkan atau dibatalkan saat start dengan keputusan tercatat; tidak ada proses anak tertinggal.
- Status: **partial**
- Bukti: `session.cancel` memanggil `controller.abort()` (`rpc.ts:180-186`); signal parent diteruskan ke subagent (`rpc.ts:408` dan `524`), dicek di loop (`agent.ts:318`, `391`), dan dipakai untuk mematikan proses shell beserta grupnya (`tools/index.ts:309-326`); status turn menjadi `cancelled` (`agent.ts:479-482`).
- Kekurangan: cancel satu agen anak tidak mungkin karena `activeTurns` hanya menyimpan id sesi parent (`rpc.ts:48`, `362`); `session.cancel` dengan id anak mengembalikan `{ cancelled: false }` tanpa efek. Tidak ada pelepasan lease (lease belum ada), tidak ada penyimpanan state sebelum berhenti, tidak ada jaminan ≤ 3 detik karena penghentian bergantung pada provider yang menghormati abort, tidak ada pemulihan agen orphan saat daemon start (`daemon.ts:40-79` hanya start server), dan tidak ada pelacakan proses anak selain shell.
- Tes yang belum ada: cancel parent menghentikan anak dan menutup semua proses shell; cancel anak tunggal menghentikan hanya anak itu; agen orphan saat start dipulihkan atau dibatalkan dengan keputusan tercatat; status akhir `cancelled` bukan `failed`.

## 4. Prioritas perbaikan

### P0, blokir M4 dan M10 serta acceptance criteria

1. **Skema storage untuk plan, task, checkpoint, lease, dan pesan agen.** Tambah migrasi v3 berisi `tasks`, `plans`, `plan_tasks`, `checkpoints`, `path_leases`, `agent_runs`, `agent_messages`, `file_changes`, plus kolom `turns.heartbeat_at`, `turns.step_count`, `sessions.depth`, `sessions.path`. Tambah repo CRUD dengan compare-and-swap versi. Berkas: `packages/storage/src/db.ts`, `packages/storage/src/repos.ts`.
2. **Planner dan validator DAG.** Modul baru dengan skema Zod plan, klasifikasi tugas, validasi acceptance dan siklus (Kahn dengan urutan deterministik), anotasi risiko berbasis path dan perintah, estimasi rentang, persistensi versi, dan replan. Berkas: `packages/runtime/src/planner.ts` (baru), `packages/shared/src/plan.ts` (baru, skema dan tipe), `packages/runtime/src/agent.ts`, `packages/runtime/src/rpc.ts`.
3. **Verifier dan observation.** Tipe `Observation` dan `Criterion`, eksekusi kriteria `test`, `build`, `runtime`, `file`, `diff`, `manual`, status `verifying`/`unverified`, laporan sukses dan gagal terstruktur. Sekaligus menutup `agent.ts:375-388` agar turn tanpa tool call tidak langsung `done`. Berkas: `packages/runtime/src/verify.ts` (baru), `packages/runtime/src/observation.ts` (baru), `packages/runtime/src/agent.ts`, `packages/shared/src/events.ts`.
4. **Checkpoint dan recovery.** Checkpoint sebelum tool tulis dan setiap N langkah, isi state task, daftar file, hash, Git ref; restore dengan konfirmasi; pemulihan saat daemon start untuk turn `running` dan agen `orphaned`. Berkas: `packages/runtime/src/checkpoint.ts` (baru), `packages/runtime/src/daemon.ts`, `packages/runtime/src/paths.ts`, `packages/storage/src/repos.ts`.
5. **Tool broker yang sadar izin dan paralel.** Filter kandidat tool berdasarkan `permissionMode`, `allow`, `deny`, dan kapabilitas sebelum dikirim ke provider; eksekusi paralel untuk call independen dengan batas concurrency; retry matrix dari `docs/prd/ARCHITECTURE.md` 13.3 dengan deteksi kegagalan identik dan `E_NO_PROGRESS`; tulis `audit_log` untuk setiap tool call dan keputusan. Berkas: `packages/runtime/src/tools/index.ts`, `packages/runtime/src/policy.ts`, `packages/runtime/src/agent.ts`, `packages/shared/src/errors.ts`.
6. **Subagent: profil, batas hierarki, hasil terstruktur, cancel per agen.** Loader profil dari `~/.rann/agents/*.md` dan `.rann/agents/*.md` dengan sembilan profil bawaan, validasi kedalaman dan jumlah anak, `AgentResult` berisi status, bukti, file, biaya, `unverified`, pendaftaran setiap agen di `activeTurns`, pembatalan berantai dengan tenggat. Berkas: `packages/runtime/src/agents/profile.ts` (baru), `packages/runtime/src/agents/registry.ts` (baru), `packages/runtime/src/rpc.ts`, `packages/runtime/src/agent.ts`, `packages/shared/src/config.ts`.
7. **Permukaan RPC dan CLI.** Method `plan.get`, `plan.approve`, `plan.reject`, `task.list`, `task.get`, `task.cancel`, `task.retry`, `approval.list`, `agent.list`, `agent.cancel`, `checkpoint.list`, `checkpoint.restore`; perintah `/plan`, `/execute`, `/tasks`, `/agents`, `/checkpoint`, dan flag `--plan`, `--plan-only`. Berkas: `packages/shared/src/rpc.ts`, `packages/runtime/src/rpc.ts`, `packages/cli/src/main.ts`, `packages/cli/src/args.ts`.

### P1, penting tetapi tidak memblokir M4

1. Goal tracking dan `/status` yang menampilkan goal, progres, kriteria, asumsi; penyimpanan goal di `tasks.goal_json` dan `sessions.metadata_json`. Berkas: `packages/runtime/src/agent.ts`, `packages/cli/src/main.ts`.
2. Heartbeat, `maxRuntime`, status `stalled`, dan event progres untuk CLI dan dashboard. Berkas: `packages/runtime/src/agent.ts`, `packages/shared/src/config.ts`, `packages/storage/src/db.ts`.
3. Prioritas task dan antrean terpisah, termasuk aturan task menunggu approval tidak memblokir task lain. Berkas: `packages/runtime/src/planner.ts`, `packages/runtime/src/rpc.ts`.
4. Estimasi historis dari `usage_events` dengan label `historical`/`heuristic` dan pencatatan selisih aktual. Berkas: `packages/runtime/src/planner.ts`, `packages/storage/src/repos.ts`.
5. Komunikasi antar agen lewat `agent_messages`, termasuk eskalasi setelah tiga pertukaran. Berkas: `packages/runtime/src/agents/message.ts` (baru), `packages/runtime/src/rpc.ts`.
6. Mode konteks `shared` dengan pembagian keputusan, artefak, dan lease, serta kontrol kebocoran memori antar agen. Berkas: `packages/runtime/src/agents/context.ts` (baru), `packages/runtime/src/memory.ts`.

### P2, penyempurnaan

1. Ekspor dan impor plan JSON, plus `/plan show` dengan riwayat versi dan deteksi deviasi (`03-agent-core.md` 13.5).
2. Transcript ringkas per agen dan agregasi biaya per pohon agen.
3. Paritas dashboard untuk data `/agents` dan `/tasks`.
4. Audit `appendAudit` disambungkan ke seluruh jalur keputusan, bukan hanya tool call.

## 5. Berkas yang perlu disentuh

Baru:
- `packages/runtime/src/planner.ts`
- `packages/runtime/src/verify.ts`
- `packages/runtime/src/observation.ts`
- `packages/runtime/src/checkpoint.ts`
- `packages/runtime/src/agents/profile.ts`
- `packages/runtime/src/agents/registry.ts`
- `packages/runtime/src/agents/message.ts`
- `packages/runtime/src/agents/context.ts`
- `packages/shared/src/plan.ts`

Diubah:
- `packages/storage/src/db.ts` (migrasi v3)
- `packages/storage/src/repos.ts` (repo plan, task, checkpoint, lease, agen, file_changes)
- `packages/runtime/src/agent.ts` (state machine berfase, verifikasi, retry, audit)
- `packages/runtime/src/rpc.ts` (method plan, task, agent, checkpoint; registrasi agen aktif)
- `packages/runtime/src/daemon.ts` (recovery saat start)
- `packages/runtime/src/policy.ts` (filter kandidat tool, risiko task)
- `packages/runtime/src/tools/index.ts` (lease, expectedHash, eksekusi paralel)
- `packages/shared/src/rpc.ts` (skema method baru)
- `packages/shared/src/events.ts` (event fase, plan, task, checkpoint, agen)
- `packages/shared/src/errors.ts` (`E_NO_PROGRESS`, `E_AGENT_DEPTH`, `E_LEASE_CONFLICT`, `E_VERIFY_FAILED`)
- `packages/shared/src/config.ts` (`agent.max_runtime_ms`, `agent.checkpoint_every`, `subagents.max_depth`, `subagents.max_children`, `subagents.max_concurrent`)
- `packages/cli/src/main.ts` dan `packages/cli/src/args.ts` (perintah dan flag baru)

Tes yang perlu ditambah:
- `packages/runtime/src/planner.test.ts`: pemicu planner, validasi DAG, penolakan siklus, risiko high, estimasi rentang.
- `packages/runtime/src/agent-loop.test.ts`: fase dan event, `premature_finish`, penolakan `done` tanpa bukti, `E_NO_PROGRESS`.
- `packages/runtime/src/checkpoint.test.ts`: checkpoint sebelum tulis, restore, penolakan menimpa perubahan pengguna.
- `packages/runtime/src/subagent.test.ts`: profil, kedalaman, batas anak, hasil terstruktur, cancel per agen, lease conflict.
- `packages/storage/src/plan-repos.test.ts`: versi plan, `superseded`, lease unik, checkpoint hash.
- `packages/runtime/src/recovery.test.ts`: `kill -9` saat turn berjalan lalu daemon start memulihkan ≤ 5 detik.
