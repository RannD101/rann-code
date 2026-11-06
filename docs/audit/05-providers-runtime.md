# Audit Kesiapan Implementasi: Provider, Runtime, Background

- Repo: `/root/rann-code`
- Commit: `82270f1` (docs: mulai audit implementasi terhadap PRD V1)
- Cakupan: RC-FR-101 sampai RC-FR-114 (provider, model registry, streaming, usage, router, context) dan RC-FR-121 sampai RC-FR-126 (background task, scheduler)
- Sumber kebenaran: `docs/prd/01-requirements.md` 8.8 dan 8.9, `docs/prd/05-models-and-routing.md` 23 sampai 26, `docs/prd/06-runtime-and-services.md` 29 dan 30, `docs/prd/ARCHITECTURE.md` 9.3, 11.1, 13.3, `docs/prd/IMPLEMENTATION-ROADMAP.md` M2, M11, M12, `docs/prd/ACCEPTANCE-CRITERIA.md` 8 dan 9.
- Metode: baca kode `packages/runtime/src`, `packages/shared/src`, `packages/storage/src`, `packages/cli/src`; grep simbol dan error code; jalankan suite tes nyata.
- Kode tidak diubah. Dokumen ini satu-satunya berkas yang ditulis.

## Ringkasan

| Status | Jumlah | FR |
|---|---|---|
| done | 0 | tidak ada |
| partial | 7 | 101, 102, 103, 106, 107, 109, 112 |
| missing | 13 | 104, 105, 108, 110, 111, 113, 114, 121, 122, 123, 124, 125, 126 |

Dari 20 FR yang diaudit, tidak ada satu pun yang memenuhi seluruh requirement. Yang berjalan hari ini adalah satu jalur tipis: satu adapter `openai-compatible`, satu `mock`, streaming teks plus tool call, pencatatan usage input/output, dan compaction berbasis pemotongan pesan. Seluruh lapisan yang membuat sistem "sadar kemampuan model" (capability registry, model registry, router, health, retry/fallback) belum ada, dan subsistem background serta scheduler belum ada sama sekali, termasuk skema database-nya.

Bukti tes: 52 tes lulus di 11 berkas (`packages/*/src/**/*.test.ts`) saat dijalankan dengan Node 22.23.3. Dengan Node 26.7.0 (default di mesin ini) seluruh tes yang menyentuh `better-sqlite3` gagal karena ABI `NODE_MODULE_VERSION 127` lawan `147`, jadi gate CI harus mematok versi Node.

## 8.8 Provider, router, dan context

### RC-FR-101. Arsitektur adapter provider

- Status: partial
- Ringkasan: Ada satu interface `Provider` dengan generator `chat()`, ditambah registry `createProvider()` berbasis `kind`.
- Bukti: `packages/runtime/src/providers/types.ts:38-42` mendefinisikan `Provider { name, kind, chat() }`; `packages/runtime/src/providers/index.ts:10-44` adalah registry; `packages/runtime/src/providers/openai.ts:48-52` memetakan status HTTP ke `E_PROVIDER_AUTH`, `E_PROVIDER_RATE_LIMIT`, `E_PROVIDER_UNAVAILABLE`.
- Kekurangan:
  - Interface hanya punya `chat`. `stream`, `embed`, `listModels`, `health`, dan `countTokens` tidak ada, sehingga requirement 1 tidak terpenuhi. Streaming hari ini implisit karena `chat` mengembalikan generator.
  - Menambah adapter tidak cukup "folder plus entri registry": `providerConfigSchema.kind` hanya menerima `openai-compatible | anthropic | mock` (`packages/shared/src/config.ts:8`), jadi setiap adapter baru memaksa perubahan `packages/shared`.
  - Error mapping hanya di adapter OpenAI. Tidak ada tabel pemetaan bersama, sehingga adapter berikutnya akan menduplikasi logika.
  - `ProviderChunk` tidak punya varian `start`, `reasoning`, `tool_call_end`, dan `error` seperti spesifikasi `ChatEvent` di 05-models-and-routing 23.2. Error selalu dilempar sebagai exception, bukan event.
- Tes belum ada: tes kontrak adapter (satu suite yang dijalankan untuk semua adapter), tes bahwa menambah adapter tidak mengubah `agent.ts`/CLI.

### RC-FR-102. Dukungan provider

- Status: partial
- Ringkasan: Hanya `mock` dan `openai-compatible` yang berfungsi. Adapter Anthropic ada di registry sebagai cabang yang langsung melempar error.
- Bukti: `packages/runtime/src/providers/index.ts:11-15` (`mock`, lalu `anthropic` melempar `E_UNSUPPORTED`); `packages/runtime/src/providers/openai.ts:54-213`; `packages/runtime/src/providers/mock.ts:9-46`.
- Kekurangan:
  - Adapter wajib yang belum ada: Anthropic, OpenAI Responses, Gemini. OpenRouter hanya bisa dipakai sebagai `openai-compatible` dengan base URL manual, tanpa preset, tanpa header khusus, dan tanpa dokumentasi contoh.
  - Requirement 2 terpenuhi secara teknis (`base_url` kustom bisa dipakai untuk Ollama, LM Studio, vLLM), tetapi tidak ada jalur `no-auth` resmi: `createProvider` melempar `E_PROVIDER_AUTH` kalau tidak ada key (`providers/index.ts:30-34`), sehingga server lokal tanpa key tidak bisa dipakai tanpa mengisi env dummy.
  - Requirement 3 (tes kontrak per adapter plus contoh konfigurasi) hanya terpenuhi untuk OpenAI: `packages/runtime/src/providers/openai.test.ts` berisi 3 tes. Tidak ada berkas contoh konfigurasi per provider di repo.
  - Requirement 4 tidak mungkin dipenuhi karena capability registry tidak ada.
- Tes belum ada: kontrak Anthropic, Responses, Gemini, OpenRouter; tes server lokal tanpa auth; tes `listModels` per provider.

### RC-FR-103. Manajemen kredensial

- Status: partial
- Ringkasan: Key dibaca dari env atau berkas, tidak pernah ditulis ke database, dan ada `rann provider add` serta `rann provider test`.
- Bukti: `packages/runtime/src/providers/index.ts:21-34` (env lalu `api_key_file`); `packages/cli/src/main.ts:709-745` (`provider test`, `provider add` menulis `api_key_env` ke TOML, bukan key); `packages/cli/src/main.ts:747-756` (daemon di-restart setelah config berubah); `packages/storage/src/db.ts` tidak punya kolom key di tabel mana pun.
- Kekurangan:
  - Requirement 1 gagal: tidak ada secret store terenkripsi maupun keychain. Key hidup di env atau berkas plaintext; yang diamankan hanya permission TOML `0600` (`packages/cli/src/config-store.ts:67`).
  - Requirement 2 setengah: key dari env dipakai langsung, tidak pernah dipindahkan ke store.
  - Requirement 3 sebagian: `provider add` dan `provider test` ada sebagai subcommand CLI, tetapi `/provider login` dan `/provider remove` tidak ada, baik sebagai slash command maupun RPC (`packages/shared/src/rpc.ts:145-171`).
  - Requirement 4 gagal: tidak ada masking 4 karakter terakhir. `provider.list` hanya mengembalikan `has_key: boolean` (`packages/runtime/src/rpc.ts:579-582`).
  - Requirement 5 tidak relevan karena key dibaca ulang setiap turn dari env, tetapi ini juga berarti rotasi bergantung pada restart proses, bukan pada store.
  - Bonus risiko: pesan error `E_PROVIDER_AUTH` menyebut nama env, bukan nilainya, jadi tidak bocor. Namun `provider add` menulis nilai flag apa adanya ke TOML, sehingga salah pakai (`--key-env` diisi key) akan menyimpan key plaintext di config.
- Tes belum ada: tes bahwa key tidak muncul di log, event, database, dan pesan error; tes rotasi key saat turn berjalan; tes masking.

### RC-FR-104. Discovery dan registrasi model

- Status: missing
- Ringkasan: Tidak ada model registry. `model.list` hanya menggemakan daftar string dari config provider aktif.
- Bukti: `packages/runtime/src/rpc.ts:558-569` (`modelList` menyusun `Set` dari `provider.models` plus default model); `packages/shared/src/config.ts:13` (`models: z.array(z.string())`, tanpa context window, harga, atau capability); `packages/storage/src/db.ts:27-219` tidak punya tabel `models` maupun `providers`.
- Kekurangan: tidak ada `listModels` ke provider, tidak ada cache, tidak ada registrasi manual dengan metadata, tidak ada penandaan `unavailable`, `/models` tidak menampilkan provider, context, harga, dan capability (`packages/cli/src/main.ts:605-617` hanya mencetak id model), alias tidak ada di skema config.
- Tes belum ada: discovery dan cache, registrasi manual, penandaan `unavailable`, output `/models` lengkap.

### RC-FR-105. Capability registry

- Status: missing
- Ringkasan: Tidak ada konsep capability sama sekali. Kode hanya membedakan provider, bukan kemampuan model.
- Bukti: grep `capabilit` pada `packages/**/*.ts` hanya menemukan `E_PROVIDER_CAPABILITY` di `packages/shared/src/errors.ts:15`, dan kode itu tidak pernah dilempar. `packages/runtime/src/agent.ts:308-314` memfilter tool berdasarkan ada tidaknya service (`memory`, `skill`, `task`), bukan berdasarkan capability model.
- Kekurangan: 10 capability minimum tidak dimodelkan, tidak ada sumber (provider/dokumentasi/override), tidak ada asumsi aman untuk capability tak diketahui, tidak ada pencatatan sumber perubahan. Akibat langsung: agen tetap mengirim `tools` ke model yang tidak mendukung tool calling, dan `E_PROVIDER_CAPABILITY` menjadi kode mati.
- Tes belum ada: seluruhnya. Minimal satu tes yang memastikan model tanpa `tool_calling` ditolak atau dijalankan tanpa tool (RC-AC-105).

### RC-FR-106. Context window dan tokenizer

- Status: partial
- Ringkasan: Ada budget konteks global dan compaction berbasis pemotongan pesan lama menjadi digest.
- Bukti: `packages/runtime/src/agent.ts:186-225` (`buildChatContext`), `packages/runtime/src/agent.ts:164-184` (`digestRows`, potong 180 karakter untuk tool dan 320 untuk pesan lain), `packages/shared/src/config.ts:65-71` (`context.max_tokens`, `keep_recent`, `summary_chars`), `packages/runtime/src/agent.ts:319-332` (event `context.compacted`).
- Kekurangan:
  - Requirement 1 gagal: context window tidak per model, hanya satu angka global. Tidak ada pemisahan budget input, output, dan reserve.
  - Requirement 2 gagal: estimator hanya `char/4` (`packages/runtime/src/providers/types.ts:44-46`). Tidak ada tokenizer per model dan tidak ada kalibrasi, jadi klaim error di bawah 15 persen tidak terbukti. `estimateRequestTokens` di `providers/openai.ts:224-226` tidak dipakai di mana pun.
  - Requirement 3 gagal: hanya satu ambang (`fullTokens <= maxTokens`). Tidak ada zona 75 persen dan 90 persen, dan tidak ada pembatasan operasi esensial.
  - Requirement 4 tidak dijamin: digest mempertahankan teks acak dari pesan lama, bukan goal, keputusan, error, path, dan hasil verifikasi secara terstruktur. Pesan yang dipotong bisa saja berisi path penting dan hilang tanpa jejak.
  - Requirement 5 sebagian: retrieval file tidak ada sama sekali; memory dibatasi `prompt_chars` (`packages/runtime/src/memory.ts`), tetapi overflow recovery bertahap tidak ada. Jika compaction masih melebihi budget, `buildChatContext` tetap mengirim konteks penuh (`agent.ts:204-211`), sehingga overflow diteruskan ke provider dan berakhir sebagai error provider, bukan `E_CONTEXT_OVERFLOW`.
  - Requirement 6 gagal: prompt caching tidak ada.
  - Requirement 7 gagal: `/context` tidak ada, baik slash command (`packages/cli/src/main.ts:515-582`) maupun RPC.
- Tes belum ada: akurasi estimator terhadap usage aktual, compaction yang mempertahankan goal/path/error, overflow recovery, `/context`.

### RC-FR-107. Streaming dan tool calling

- Status: partial
- Ringkasan: Streaming teks, akumulasi delta tool call per index, usage akhir, dan eksekusi tool setelah stream selesai sudah bekerja.
- Bukti: `packages/runtime/src/providers/openai.ts:152-207` (parse SSE, `pending` Map per index, tool call di-emit setelah loop); `packages/runtime/src/agent.ts:339-362` (konsumsi chunk, kumpulkan `calls`), `packages/runtime/src/agent.ts:390-470` (eksekusi tool setelah stream); tes `packages/runtime/src/providers/openai.test.ts:38-65` membuktikan args parsial dirangkai menjadi `{ path: "a.txt" }`.
- Kekurangan:
  - Requirement 1 sebagian: delta teks, tool call parsial, dan usage ada. Delta reasoning tidak ada karena `ProviderChunk` tidak punya variannya dan `delta.reasoning_content` diabaikan.
  - Requirement 2 terpenuhi secara struktural: eksekusi hanya terjadi setelah stream selesai. Tetapi validasi args tidak dilakukan sebelum eksekusi; `safeJson` mengembalikan `{ __raw: "..." }` untuk JSON rusak (`openai.ts:215-222`), lalu objek itu dikirim ke tool dan baru gagal di broker.
  - Requirement 3 gagal: capability tidak dicek, dan meskipun model mengembalikan beberapa tool call, `agent.ts:390` mengeksekusinya berurutan. Tidak ada eksekusi paralel.
  - Requirement 4 gagal: tidak ada resume stream dan tidak ada penanda sambung. Jika provider memutus koneksi di tengah, exception keluar dari loop dan `text` yang sudah terkumpul di variabel lokal dibuang sebelum `addMessage` (`agent.ts:364-373` baru menulis setelah loop selesai), sehingga teks parsial hilang. Ini melanggar 23.6 "teks yang sudah diterima dipertahankan" dan RC-AC-007.
  - Requirement 5 gagal: `E_STREAM_TRUNCATED` dideklarasikan (`packages/shared/src/errors.ts:17`) tetapi tidak pernah dilempar. Stream yang berakhir tanpa `done` dianggap selesai normal dengan `finishReason` terakhir.
  - Catatan performa: setiap delta menulis satu baris `events` (`agent.ts:347` memanggil `publish`, dan `publish` melakukan `appendEvent`). Satu jawaban 2.000 token berarti 2.000 insert.
- Tes belum ada: stream terputus di tengah, stream tanpa `done`, tool call dengan JSON invalid, dua tool call paralel, delta reasoning, backpressure.

### RC-FR-108. Structured output dan multimodal

- Status: missing
- Ringkasan: Tidak ada. `ChatMessage.content` bertipe `string` (`packages/runtime/src/providers/types.ts:9-15`), sehingga tidak ada tempat untuk parts gambar, PDF, atau audio.
- Bukti: `packages/runtime/src/providers/openai.ts:28-46` (`mapMessages` selalu mengirim `content` string); `packages/shared/src/rpc.ts:59-65` (`session.send` tidak punya field `attachments`).
- Kekurangan: tidak ada `responseFormat`/JSON schema, tidak ada validator lokal, tidak ada repair sekali, tidak ada multimodal, tidak ada validasi ukuran dan format, tidak ada penolakan dengan saran untuk model non-multimodal.
- Tes belum ada: seluruhnya.

### RC-FR-109. Usage dan biaya

- Status: partial
- Ringkasan: Input dan output token dicatat per turn dan bisa diringkas; budget harian dan per turn menegakkan `E_BUDGET_EXHAUSTED`.
- Bukti: `packages/storage/src/repos.ts:288-302` (`recordUsage`), `packages/storage/src/repos.ts:314-331` (`summarizeUsage`, `sumTokensSince`), `packages/runtime/src/agent.ts:265-273` (budget harian), `packages/runtime/src/agent.ts:350-358` (budget per turn), `packages/runtime/src/agent.ts:377-384` (pencatatan), `packages/shared/src/config.ts:72-77` (`budget`), `packages/cli/src/main.ts:532-537` dan `667-687` (`/usage` dan `rann usage`).
- Kekurangan:
  - Requirement 1 sebagian: hanya `input_tokens`, `output_tokens`, dan `cost_usd`. Cache read, cache write, dan provider request id tidak ada, baik di `ProviderChunk` maupun di tabel `usage_events` (`packages/storage/src/db.ts:130-140`).
  - Requirement 2 gagal: `costUsd` tidak pernah dihitung. Pemanggil tidak mengirimnya, sehingga `recordUsage` menyimpan `0` (`repos.ts:299`), bukan `null` yang ditandai. Tidak ada tabel harga dan tidak ada registry harga. RC-AC-109 dan RC-AC-010 (`$?` untuk model tanpa harga) tidak mungkin lulus.
  - Requirement 3 gagal: `/cost` dan `/budget` tidak ada.
  - Requirement 4 sebagian: budget per turn dan per hari ada, budget per task tidak ada. Budget per turn hanya dievaluasi saat chunk usage diterima; jika provider tidak mengirim usage (misalnya stream terputus, `openai.ts:204-206` mengirim 0), batas tidak pernah tercapai.
  - Requirement 5 terpenuhi: agent tidak punya jalur untuk mengubah `usage_events`.
- Tes belum ada: akurasi biaya dari harga registry, penanda `null`, agregasi 10 request, budget per task, budget saat usage tidak tersedia.

### RC-FR-110. Kesehatan provider dan rate limit

- Status: missing
- Ringkasan: Tidak ada health check, tidak ada status per provider, tidak ada pembacaan header rate limit, tidak ada circuit breaker.
- Bukti: `packages/runtime/src/rpc.ts:311-324` (`health` hanya status daemon, database, dan daftar turn aktif); `packages/runtime/src/rpc.ts:586-614` (`providerTest` mengukur latensi sekali, tidak menyimpan hasil); `packages/runtime/src/providers/openai.ts:116-128` membaca status dan body error tetapi tidak menyimpan `Retry-After`.
- Kekurangan: keenam status (`healthy`, `degraded`, `rate_limited`, `auth_error`, `down`, `unknown`) tidak dimodelkan, `Retry-After` diabaikan, tidak ada circuit breaker 5 kegagalan/30 detik, tidak ada tampilan status di `/providers` (kolom yang dicetak hanya nama, tipe, base URL, key, model; `packages/cli/src/main.ts:698-705`).
- Tes belum ada: pemetaan 429 ke `rate_limited`, penghormatan `Retry-After`, pembukaan dan penutupan circuit.

### RC-FR-111. Retry dan fallback

- Status: missing
- Ringkasan: Tidak ada retry dan tidak ada fallback. `model.fallback` di config diurai tetapi tidak pernah dibaca.
- Bukti: `packages/shared/src/config.ts:28-33` mendeklarasikan `model.fallback`; grep `fallback` di `packages/**/*.ts` tidak menemukan pemakaian selain nama variabel di `skills.ts` dan `ui.ts`. `packages/runtime/src/agent.ts:339` memanggil provider sekali; error langsung naik ke `catch` di `agent.ts:477-486`.
- Kekurangan: matriks retry 13.3 tidak diterapkan (provider chat 3 percobaan, stream 2, backoff 1s/2s/4s), tidak ada syarat `allowFallback`, tidak ada pemilihan model pengganti dengan capability setara, tidak ada pencatatan alasan fallback dan biayanya, tidak ada rantai percobaan di error akhir.
- Tes belum ada: seluruhnya.

### RC-FR-112. Alias dan pemilihan model

- Status: partial
- Ringkasan: `/model <nama>` mengganti model untuk permintaan berikutnya di sesi CLI, dan `/model` tanpa argumen menampilkan daftar model provider aktif.
- Bukti: `packages/cli/src/main.ts:550-561`; `packages/runtime/src/rpc.ts:355-359` (model per request menimpa `session.model` untuk turn itu); `packages/runtime/src/providers/index.ts:46-52` (`resolveModel`, di mana `auto` berarti default provider).
- Kekurangan:
  - Requirement 1 gagal: alias tidak ada di skema config.
  - Requirement 2 sebagian: `/model` menampilkan daftar, tetapi tidak menampilkan sumber pemilihan (default, flag, sesi, router).
  - Requirement 3 gagal: `--pin` tidak ada dan tidak ada konsep model dipatok.
  - Requirement 4 gagal: tidak ada aturan yang mengizinkan penggantian, karena router dan fallback juga belum ada.
  - Requirement 5 gagal: model yang dipakai tidak dicatat di `turns` (`packages/storage/src/db.ts:68-80` tidak punya kolom model), sehingga perubahan model tidak bisa diaudit per turn. `session.model` juga tidak diperbarui saat `/model` dipakai, karena nilainya hanya hidup di variabel CLI.
- Tes belum ada: alias, `--pin`, pencatatan model per turn, sumber pemilihan.

### RC-FR-113. Smart router

- Status: missing
- Ringkasan: Tidak ada router. "auto" hanya berarti `default_model` atau model pertama di config.
- Bukti: `packages/runtime/src/providers/index.ts:46-52`; tidak ada folder router, tidak ada tabel `routing_logs` di `packages/storage/src/db.ts`.
- Kekurangan: tidak ada penilaian kompleksitas, reasoning, konteks, tool, multimodal, kecepatan, biaya, dan kesehatan; tidak ada skor kandidat; `/route why` tidak ada; tidak ada error penjelasan saat tidak ada model cocok; tidak ada pembelajaran dari hasil task.
- Tes belum ada: seluruhnya.

### RC-FR-114. Kebijakan routing dan override

- Status: missing
- Ringkasan: Tidak ada kebijakan routing. Satu-satunya override adalah parameter `model` pada `session.send` dan `session.create`.
- Bukti: `packages/shared/src/rpc.ts:44-65`; `packages/runtime/src/rpc.ts:348-380`; skema config tidak punya bagian `routing` (`packages/shared/src/config.ts:26-116`).
- Kekurangan: enam kebijakan (`auto`, `manual`, `cost-first`, `quality-first`, `latency-first`, `custom`) tidak ada, aturan custom per task class/proyek/agen/biaya maksimum tidak ada, override per task dan per agen tidak ada, routing log tidak ada, aturan `allowFallback` untuk model dipatok tidak ada.
- Tes belum ada: seluruhnya.

## 8.9 Background dan scheduler

### RC-FR-121. Eksekusi dan antrean background

- Status: missing
- Ringkasan: Tidak ada job queue. Tidak ada paket `@rann/jobs`, tidak ada tabel `jobs`, tidak ada worker.
- Bukti: `find packages -name '*.ts'` hanya menghasilkan `cli`, `runtime`, `shared`, `storage`; grep `background|scheduler|cron|jobs|lease|heartbeat` pada `packages/**/*.ts` tidak menemukan satu pun hasil. Migrasi database (`packages/storage/src/db.ts:27-219`) tidak punya tabel `jobs`. RPC (`packages/shared/src/rpc.ts:145-171`) tidak punya method `background.*` maupun `queue.*`.
- Kekurangan: antrean persisten, prioritas, klaim transaksional `BEGIN IMMEDIATE`, lease, heartbeat, idempotency key, concurrency worker yang bisa dikonfigurasi, `/background` dan `/queue`, semuanya tidak ada. `createTurn` punya `idempotencyKey` (`repos.ts:162-168`), tetapi itu untuk turn interaktif, bukan job.
- Tes belum ada: seluruhnya.

### RC-FR-122. Persistensi dan pemulihan background

- Status: missing
- Ringkasan: Tidak ada state job, sehingga tidak ada yang bisa dipulihkan.
- Bukti: sama dengan RC-FR-121. Satu-satunya pemulihan yang ada adalah `stopDaemon` mengirim SIGTERM dan menunggu proses mati (`packages/runtime/src/daemon.ts:81-96`), bukan pemulihan job.
- Kekurangan: job `running` dengan heartbeat hilang tidak dikembalikan ke `queued` dan tidak ditandai `failed`, job selesai tidak dijamin tidak diulang, job `queued` tidak bertahan karena tabelnya tidak ada, pemulihan tidak dicatat di log dan audit.
- Tes belum ada: seluruhnya, termasuk skenario kill -9 (RC-AC-122).

### RC-FR-123. Monitoring, cancel, retry, dan notifikasi

- Status: missing
- Ringkasan: Tidak ada.
- Bukti: tidak ada event job di `packages/shared/src/events.ts:1-14`; tidak ada kanal notifikasi di kode; `session.cancel` hanya membatalkan turn interaktif lewat `AbortController` (`packages/runtime/src/rpc.ts:180-186`).
- Kekurangan: `/background status|cancel|retry` tidak ada, log job tidak bisa dilihat atau diekspor, notifikasi selesai/gagal/butuh approval tidak ada, retry idempoten tidak ada, dead letter tidak ada.
- Tes belum ada: seluruhnya.

### RC-FR-124. Jenis jadwal

- Status: missing
- Ringkasan: Tidak ada scheduler.
- Bukti: tidak ada paket `@rann/scheduler`, tidak ada tabel `scheduler_jobs`, tidak ada method `scheduler.*` di `packages/shared/src/rpc.ts`. `ARCHITECTURE.md:789-790` mendefinisikan `scheduler.list` dan `scheduler.run`, keduanya belum ada di kode.
- Kekurangan: one-time, interval, dan cron tidak ada; timezone dan `next_run_at` tidak ada; enable/disable/remove tidak ada; `/scheduler add|list|run|remove` tidak ada; kebijakan overlap `skip|queue|replace` tidak ada. Config juga tidak punya bagian `scheduler` (`packages/shared/src/config.ts:26-116`).
- Tes belum ada: seluruhnya, termasuk RC-AC-124.

### RC-FR-125. Trigger, timezone, dan DST

- Status: missing
- Ringkasan: Tidak ada.
- Bukti: tidak ada dependensi timezone di seluruh `package.json` workspace (runtime hanya `zod`, storage `better-sqlite3`, shared `smol-toml` dan `zod`), dan tidak ada kode yang menyentuh `Intl.DateTimeFormat` atau zona IANA.
- Kekurangan: validasi timezone, konversi lokal ke UTC, penanganan DST maju dan mundur, trigger kondisional dan event, kebijakan `catchUp` saat daemon mati, semuanya tidak ada.
- Tes belum ada: seluruhnya, termasuk RC-AC-125.

### RC-FR-126. Persistensi, riwayat, dan retry jadwal

- Status: missing
- Ringkasan: Tidak ada.
- Bukti: tabel `job_runs` yang didefinisikan di `ARCHITECTURE.md:608` tidak ada di migrasi; tidak ada audit untuk perubahan jadwal.
- Kekurangan: riwayat eksekusi, retry policy per job (maks percobaan, backoff, timeout), filter dan ekspor riwayat, penonaktifan otomatis job yang gagal berulang plus notifikasi, audit perubahan jadwal, semuanya tidak ada.
- Tes belum ada: seluruhnya.

## Temuan lintas-FR

1. Lapisan yang hilang saling mengunci. Tanpa capability registry (105), tool filtering, fallback, dan router tidak bisa dibangun benar. Tanpa model registry (104), harga dan context window tidak ada, sehingga usage (109) dan context (106) juga tidak bisa akurat. Urutan pembangunan harus 104 dan 105 lebih dulu, bukan adapter baru.
2. Kode error sudah disiapkan tetapi tidak dipakai. `E_STREAM_TRUNCATED`, `E_CONTEXT_OVERFLOW`, dan `E_PROVIDER_CAPABILITY` hanya muncul di `packages/shared/src/errors.ts`. Ini membuat kontrak error terlihat lengkap padahal perilakunya belum ada, dan berisiko membuat tes negatif lolos secara palsu.
3. Tidak ada jejak keputusan model. Tabel `turns` tidak menyimpan model, dan `routing_logs` tidak ada, sehingga RC-AC-114 (semua keputusan tercatat) tidak mungkin diverifikasi.
4. Persistensi event per delta. `publish("message.delta")` menulis satu baris `events` per chunk teks (`packages/runtime/src/agent.ts:347`). Untuk jawaban panjang ini membengkakkan database dan memperlambat streaming; spesifikasi 23.6 hanya meminta delta dikirim ke klien, bukan dipersistensi satu per satu.
5. Skema database tertinggal jauh dari ARCHITECTURE 9.3. Tabel yang belum ada: `providers`, `models`, `model_capabilities`, `routing_logs`, `jobs`, `scheduler_jobs`, `job_runs`, `path_leases`, `checkpoints`, `artifacts`. `countRows` di `repos.ts:588-601` juga masih memakai allowlist lama.
6. Gate versi Node. Suite tes hanya lulus di Node 22.23.3. Di Node 26.7.0, 15 tes gagal karena `better-sqlite3` dikompilasi untuk ABI 127. Ini perlu dipatok di `package.json` (`engines`) dan CI, atau `better-sqlite3` perlu di-rebuild.

## Prioritas

### P0 (menahan M2 dan M11, harus selesai sebelum fitur lain di atasnya)

1. Model registry dan capability registry: tabel `providers`, `models`, `model_capabilities`; tipe `ModelDescriptor`; `listModels` opsional di interface; penolakan model tanpa `tool_calling` untuk mode agentic (FR-104, FR-105, RC-AC-105).
2. Adapter Anthropic, OpenAI Responses, dan Gemini plus harness tes kontrak tunggal yang dijalankan untuk semua adapter; dukungan `no-auth` untuk server lokal (FR-102, FR-101).
3. Health, rate limit, retry, dan fallback: pembacaan `Retry-After`, circuit breaker 5/30 detik, matriks retry 13.3, rantai percobaan di error akhir, larangan fallback untuk model dipatok (FR-110, FR-111).
4. Secret store terenkripsi plus `provider login/remove` dan masking 4 karakter (FR-103, RC-AC-103).
5. Job queue persisten, worker pool, klaim transaksional, lease, heartbeat, dan recovery saat start (FR-121, FR-122, RC-AC-121, RC-AC-122).

### P1 (melengkapi kontrak yang sudah setengah jadi)

6. Context: context window per model, tokenizer atau estimator terkalibrasi, zona 75 dan 90 persen, overflow recovery, `/context` (FR-106, RC-AC-106).
7. Usage: tabel harga, biaya `null` bertanda, cache read/write, provider request id, `/cost` dan `/budget`, budget per task (FR-109, RC-AC-109, RC-AC-010).
8. Streaming: event `error`, `E_STREAM_TRUNCATED`, pertahankan teks parsial, resume atau ulangi dengan penanda, eksekusi tool paralel bila capability mengizinkan (FR-107, RC-AC-007).
9. Router dan kebijakan routing: skor kandidat, `routing_logs`, `/route why`, enam kebijakan, override per sesi/task/agen (FR-113, FR-114, FR-112).
10. Scheduler: one-time, interval, cron, timezone IANA, DST, overlap policy, `job_runs`, retry dan dead letter (FR-124, FR-125, FR-126).
11. Monitoring background: `/background status|cancel|retry`, log yang bisa diekspor, notifikasi (FR-123).
12. Structured output dan multimodal: `responseFormat`, validator lokal, `content` berbentuk parts, validasi ukuran dan format (FR-108).

### P2 (perbaikan dan kebersihan)

13. Alias model, `--pin`, pencatatan model per turn, `model.select` RPC (FR-112).
14. Hapus atau pakai `estimateRequestTokens`; hentikan penulisan event per delta atau gabungkan per 100 ms (temuan 4).
15. Samakan daftar tabel di `countRows` dan tambahkan tabel baru ke migrasi berikutnya (temuan 5).
16. Patok versi Node di `engines` dan CI, atau rebuild `better-sqlite3` (temuan 6).

## Berkas yang perlu disentuh

Registry dan skema:
- `packages/storage/src/db.ts` (migrasi 3: `providers`, `models`, `model_capabilities`, `routing_logs`; migrasi 4: `jobs`, `scheduler_jobs`, `job_runs`)
- `packages/storage/src/repos.ts` (`recordUsage` dengan cache dan harga, repositori model, repositori job, `countRows`)
- `packages/shared/src/config.ts` (bagian `routing`, `scheduler`, `jobs`, `pricing`, alias model, `kind` adapter baru, `no-auth`)
- `packages/shared/src/rpc.ts` (method `model.select`, `provider.add|login|remove`, `cost.summary`, `budget.*`, `route.why`, `background.*`, `scheduler.*`)
- `packages/shared/src/events.ts` (event job dan routing)
- `packages/shared/src/errors.ts` (pakai `E_STREAM_TRUNCATED`, `E_CONTEXT_OVERFLOW`, `E_PROVIDER_CAPABILITY`; tambah kode job dan scheduler bila perlu)

Provider:
- `packages/runtime/src/providers/types.ts` (interface `chat`, `stream`, `embed`, `listModels`, `health`, `countTokens`; varian chunk `start`, `reasoning`, `tool_call_end`, `error`)
- `packages/runtime/src/providers/index.ts` (registry berbasis map, bukan cabang `if`)
- `packages/runtime/src/providers/openai.ts` (health, `Retry-After`, `responseFormat`, multimodal, `E_STREAM_TRUNCATED`)
- berkas baru: `providers/anthropic.ts`, `providers/openai-responses.ts`, `providers/gemini.ts`, `providers/health.ts`, `providers/retry.ts`, `providers/pricing.ts`

Agent dan runtime:
- `packages/runtime/src/agent.ts` (capability filtering, zona konteks, pencatatan model dan biaya per turn, teks parsial saat error, eksekusi tool paralel)
- `packages/runtime/src/rpc.ts` (method baru, `providerList` dengan masking, `health` per provider, worker background saat start)
- `packages/runtime/src/daemon.ts` (mulai worker dan scheduler, recovery saat start)
- berkas baru: `packages/runtime/src/router.ts`, `packages/runtime/src/context.ts`, `packages/runtime/src/jobs/`, `packages/runtime/src/scheduler/`

CLI:
- `packages/cli/src/main.ts` (`/context`, `/cost`, `/budget`, `/route why`, `/background`, `/queue`, `/scheduler`, `/provider login|remove`, `/model --pin`)
- `packages/cli/src/config-store.ts` (tulis config untuk routing, scheduler, jobs)

Tes yang harus ditambahkan:
- `packages/runtime/src/providers/contract.test.ts` (satu suite untuk semua adapter: streaming, tool call, error map, usage, timeout, 429, 500, tool args invalid)
- `packages/runtime/src/router.test.ts`
- `packages/runtime/src/context.test.ts`
- `packages/runtime/src/jobs.test.ts` (prioritas, idempotency, lease, recovery, dead letter)
- `packages/runtime/src/scheduler.test.ts` (cron, interval, one-time, DST, overlap)
- `packages/runtime/src/usage.test.ts` (biaya dan penanda `null`)
