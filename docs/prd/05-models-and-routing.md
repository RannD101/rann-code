# 05. Provider, Model Registry, Smart Router, dan Context Intelligence

- Dokumen induk: MASTER.md
- Versi: 1.0
- Requirement: RC-FR-101 sampai RC-FR-114
- Acceptance criteria: RC-AC-101 sampai RC-AC-114

## 23. Provider architecture

### 23.1 Prinsip

Rann Code tidak boleh bergantung pada satu vendor. Namun "mendukung banyak provider" bukan berarti semua model dianggap sama. Perbedaan yang nyata:

- Nama dan arti parameter reasoning berbeda.
- Dukungan tool calling, parallel tool call, dan strict schema berbeda.
- Format multimodal berbeda.
- Tokenizer dan cara menghitung token berbeda.
- Prompt caching berbeda, bahkan ada yang tidak punya.
- Batas context dan output berbeda.
- Cara streaming error dan usage berbeda.

Karena itu ada dua lapisan: adapter wire protocol dan capability registry. Adapter menerjemahkan bentuk request dan response. Capability registry menyatakan apa yang benar-benar bisa dilakukan model. Router dan agent hanya memakai capability, bukan asumsi.

### 23.2 Interface adapter

```ts
interface ProviderAdapter {
  id: string;
  kind: "anthropic" | "openai-responses" | "openai-chat" | "gemini" | "mock";
  listModels?(): Promise<ModelDescriptor[]>;
  chat(req: ChatRequest, signal: AbortSignal): AsyncIterable<ChatEvent>;
  embed?(req: EmbedRequest): Promise<EmbedResult>;
  countTokens?(req: CountRequest): Promise<number>;
  health(): Promise<HealthStatus>;
}

type ChatEvent =
  | { type: "start"; model: string; requestId?: string }
  | { type: "text"; delta: string }
  | { type: "reasoning"; delta: string }
  | { type: "tool_call"; id: string; name: string; argsDelta: string }
  | { type: "tool_call_end"; id: string; args: unknown }
  | { type: "usage"; input: number; output: number; cacheRead?: number; cacheWrite?: number }
  | { type: "error"; code: string; message: string; retryable: boolean; status?: number }
  | { type: "done"; stopReason: "end" | "tool_use" | "max_tokens" | "refusal" | "error" };
```

Aturan:

- Adapter tidak boleh melakukan retry. Retry adalah tanggung jawab lapisan atas agar kebijakan konsisten.
- Adapter tidak boleh menulis ke database. Ia hanya mengembalikan event.
- Adapter wajib memetakan error provider ke kode internal.
- Adapter wajib mengirim `done` tepat sekali, termasuk saat error.
- Adapter tidak boleh menelan tool call yang tidak dikenal; ia mengembalikan `error` dengan nama tool.

### 23.3 Adapter yang wajib ada

| Adapter | Wire protocol | Fitur yang dipetakan |
|---|---|---|
| `anthropic` | Messages API | system prompt terpisah, tool use, prompt caching, thinking block bila tersedia, streaming event |
| `openai-responses` | Responses API | instructions, tools, structured output, reasoning effort bila tersedia, streaming event |
| `openai-chat` | Chat Completions | messages, tools, JSON mode, streaming delta |
| `gemini` | generateContent dan Interactions API bila tersedia | contents, function calling, multimodal inline/file, streaming |
| `openai-compatible` | Chat Completions atau Responses | base URL, header kustom, path kustom, no-auth |
| `mock` | Internal | Untuk tes deterministik, tidak untuk produksi |

OpenRouter memakai `openai-compatible` dengan base URL `https://openrouter.ai/api/v1` dan header tambahan. Ollama, LM Studio, dan vLLM memakai adapter yang sama dengan `no-auth` atau API key lokal.

### 23.4 Normalisasi request

```ts
interface ChatRequest {
  model: string;
  system: string[];
  messages: Message[];
  tools?: ToolSchema[];
  toolChoice?: "auto" | "none" | "required" | { name: string };
  temperature?: number;
  maxOutputTokens?: number;
  stop?: string[];
  responseFormat?: { type: "text" } | { type: "json_schema"; schema: unknown; strict?: boolean };
  reasoning?: { effort: "low" | "medium" | "high"; budgetTokens?: number };
  metadata?: { sessionId: string; taskId: string; turnId: string };
}
```

Normalisasi:

- System prompt selalu dipisah dari messages. Untuk provider yang tidak mendukung, digabung di message pertama dengan penanda.
- Tool schema memakai JSON Schema subset yang didukung semua provider: `type`, `properties`, `required`, `enum`, `description`, `additionalProperties`. Fitur yang tidak didukung (`oneOf`, `$ref`) di-expand sebelum dikirim.
- Gambar dinormalisasi ke format yang didukung provider. Jika tidak didukung, request gagal dengan error capability, bukan mengirim bytes mentah.
- `maxOutputTokens` dipetakan ke nama parameter provider.
- `reasoning` hanya dikirim jika capability `reasoning` aktif.
- `responseFormat` json_schema hanya dikirim jika capability `structured_output` aktif. Jika tidak, sistem memakai prompt + validator lokal.

### 23.5 Normalisasi response

Perbedaan yang harus dijembatani:

| Hal | Variasi | Penanganan |
|---|---|---|
| Tool call | Sebagian provider mengirim args sebagai string JSON bertahap | Buffer sampai `tool_call_end`, parse, validasi |
| Reasoning | Sebagian provider memisahkan konten reasoning | Simpan terpisah, jangan tampilkan sebagai jawaban |
| Usage | Nama field berbeda, cache read/write terpisah | Petakan ke `input`, `output`, `cacheRead`, `cacheWrite` |
| Stop reason | `stop`, `end_turn`, `tool_use`, `length` | Petakan ke enum internal |
| Refusal | Sebagian provider punya field refusal | Petakan ke `refusal`, jangan dianggap jawaban sukses |
| Error | JSON berbeda, kadang HTML dari proxy | Parse JSON jika bisa, fallback status code |

Jika provider mengirim tool call dengan argumen invalid, adapter tetap mengembalikan `tool_call_end` dengan `args` mentah. Validasi dilakukan broker, sehingga error bisa dikembalikan ke model dengan konteks.

### 23.6 Streaming

- Semua adapter mengirim event yang sama.
- Delta teks tidak boleh di-buffer lebih dari 50 ms agar latensi tetap rendah.
- Tool call delta diakumulasi per id.
- Jika stream berakhir tanpa `done`, adapter mengirim `error` dengan `E_STREAM_TRUNCATED`.
- Jika koneksi putus setelah sebagian teks, teks yang sudah diterima dipertahankan.
- Backpressure: jika renderer lambat, buffer maksimal 1 MB lalu blokir pembacaan.

### 23.7 Structured output

Dua jalur:

1. **Native**: provider mendukung JSON Schema. Schema dikirim, response divalidasi ulang di lokal.
2. **Emulated**: provider hanya mendukung JSON mode atau tidak sama sekali. Sistem mengirim instruksi format, lalu memvalidasi dan memperbaiki satu kali jika invalid.

Validasi selalu dilakukan di lokal, termasuk untuk native. Tidak ada kepercayaan penuh pada klaim provider.

### 23.8 Multimodal

- Gambar: PNG, JPEG, WebP. Ukuran maksimal 20 MB per gambar, total 50 MB per request. Gambar besar di-resize ke batas provider.
- PDF: diekstrak menjadi teks dan gambar halaman jika provider mendukung. Jika tidak, hanya teks.
- Audio: hanya jika provider mendukung transkripsi atau input audio. Jika tidak, file ditranskripsi lewat tool terpisah.
- Video: tidak dikirim langsung. Diekstrak frame dan audio, lalu diringkas.

Capability registry menyatakan modality yang didukung per model. UI memberi tahu jika model aktif tidak bisa membaca gambar yang dilampirkan.

### 23.9 Embedding

```ts
interface EmbedRequest {
  model: string;
  input: string[];
  dimensions?: number;
  taskType?: "query" | "document";
}
```

- Batch maksimal 128 input atau 100.000 token per request.
- Embedding disimpan dengan nama model dan dimensi.
- Jika provider tidak mendukung dimensi kustom, dimensi asli dipakai.
- Error rate limit di-retry dengan backoff.
- Embedding tidak memakai model chat yang mahal kecuali dikonfigurasi.

### 23.10 Health, rate limit, dan fallback

Health status: `healthy`, `degraded`, `rate_limited`, `auth_error`, `down`, `unknown`.

- Health check ringan setiap 60 detik untuk provider yang dipakai.
- Rate limit dibaca dari header (`retry-after`, `x-ratelimit-remaining`, dan varian provider).
- Circuit breaker: 5 kegagalan berturut-turut dalam 60 detik membuka circuit selama 30 detik.
- Fallback chain didefinisikan per tugas atau per model.
- Fallback tidak boleh mengganti model yang di-pin pengguna tanpa izin. Jika model pinned gagal, sistem menawarkan fallback, bukan diam-diam pindah.

### 23.11 Keamanan provider

- API key tidak pernah ditulis ke log, trace, atau pesan error.
- Key disimpan di secret store dan dirujuk dengan id.
- Base URL kustom divalidasi: HTTPS wajib kecuali localhost.
- Redirect HTTP tidak diikuti untuk request yang membawa key.
- Header yang mengandung secret disensor di log.
- Provider proxy yang mengubah response tidak dipercaya untuk usage; sistem mencatat usage dari response dan menandai `unverified` jika bentuknya tidak standar.

## 24. Model registry

### 24.1 Skema model

```ts
interface ModelDescriptor {
  id: string;                    // "provider/model"
  provider: string;
  model: string;                 // nama di provider
  displayName: string;
  aliases: string[];
  contextWindow: number;
  maxOutputTokens: number;
  capabilities: {
    streaming: boolean;
    toolCalling: boolean;
    parallelToolCalls: boolean;
    structuredOutput: boolean;
    reasoning: boolean;
    vision: boolean;
    audio: boolean;
    embeddings: boolean;
    promptCaching: boolean;
  };
  pricing?: {
    inputPerMTok: number;
    outputPerMTok: number;
    cacheReadPerMTok?: number;
    cacheWritePerMTok?: number;
    currency: "USD";
    source: string;
    updatedAt: string;
  };
  tokenizer?: { type: "provider" | "tiktoken" | "heuristic"; name?: string };
  quality?: {
    coding: number;              // 0..1
    reasoning: number;           // 0..1
    writing: number;             // 0..1
  };
  latencyClass?: "fast" | "standard" | "slow";
  deprecated?: boolean;
}
```

Aturan:

- `contextWindow` dan `maxOutputTokens` wajib. Jika tidak diketahui, model tidak boleh dipakai untuk tugas yang membutuhkan konteks besar sampai pengguna mengisi.
- `pricing` opsional. Jika tidak ada, biaya ditampilkan `$?`, bukan nol.
- `quality` adalah perkiraan yang bisa diubah pengguna. Bukan klaim resmi provider.
- `capabilities` diverifikasi lewat tes provider, bukan hanya dari dokumentasi.

### 24.2 Sumber data

1. Built-in catalog yang diperbarui bersama rilis Rann Code.
2. Discovery dari provider (`/models`) jika tersedia.
3. Registrasi manual lewat `/model add` atau config.
4. Override pengguna untuk context, harga, dan capability.

Katalog bawaan tidak boleh mengklaim model yang belum ada. Model yang tidak dikenal bisa didaftarkan manual dan ditandai `unverified`.

### 24.3 Alias

Alias memudahkan perpindahan:

```json
{
  "aliases": {
    "fast": "openai/gpt-5-mini",
    "smart": "anthropic/claude-sonnet-4-5",
    "reasoning": "openai/gpt-5",
    "local": "ollama/qwen3-coder"
  }
}
```

Alias bisa diubah pengguna. Alias yang menunjuk model tidak tersedia menghasilkan error saat dipakai, bukan fallback diam-diam.

### 24.4 Registrasi manual

```
/model add custom/my-model --provider local --context 128000 --max-output 8192 --cap tool,stream
/model add custom/my-model --pricing-input 0 --pricing-output 0
```

Model manual disimpan di `~/.rann/models.json` dan digabung dengan katalog. Bentrok id diselesaikan dengan preferensi pengguna, tetapi ditandai `override`.

## 25. Smart router

### 25.1 Tujuan

Router memilih model yang cukup mampu untuk tugas, bukan selalu yang termahal. Ia juga tidak boleh mengorbankan kualitas secara diam-diam. Karena itu setiap keputusan punya alasan yang bisa dibaca.

### 25.2 Kelas tugas

| Kelas | Contoh | Kebutuhan utama |
|---|---|---|
| `answer` | Pertanyaan singkat, penjelasan | Latensi, biaya |
| `extraction` | Ambil memory, klasifikasi | Biaya, structured output |
| `inspect` | Baca repo, cari | Context, tool calling |
| `coding` | Edit, refactor, tes | Coding, tool calling, context |
| `reasoning` | Arsitektur, debugging sulit | Reasoning, context |
| `review` | Audit keamanan, review | Reasoning, coding |
| `writing` | Dokumentasi, laporan | Writing, context |
| `vision` | Baca screenshot, diagram | Vision |
| `embedding` | Indeks | Model embedding |

Kelas ditentukan dari sinyal tugas, bukan hanya prompt. Contoh: tugas yang menyebut path file dan kata kerja "ubah" masuk `coding`.

### 25.3 Skor kandidat

```
score = w_quality * q + w_task * taskFit + w_context * contextFit
      + w_tool * toolFit + w_cost * costScore + w_latency * latencyScore
      + w_health * healthScore
```

Bobot default per kelas:

| Kelas | quality | taskFit | context | tool | cost | latency | health |
|---|---|---|---|---|---|---|---|
| answer | 0,20 | 0,10 | 0,05 | 0,05 | 0,35 | 0,20 | 0,05 |
| extraction | 0,15 | 0,10 | 0,05 | 0,10 | 0,45 | 0,10 | 0,05 |
| inspect | 0,20 | 0,15 | 0,20 | 0,20 | 0,15 | 0,05 | 0,05 |
| coding | 0,30 | 0,20 | 0,15 | 0,20 | 0,08 | 0,02 | 0,05 |
| reasoning | 0,45 | 0,20 | 0,20 | 0,05 | 0,05 | 0,00 | 0,05 |
| review | 0,40 | 0,25 | 0,15 | 0,10 | 0,05 | 0,00 | 0,05 |
| writing | 0,35 | 0,25 | 0,20 | 0,00 | 0,10 | 0,05 | 0,05 |

`taskFit` dihitung dari kualitas coding, reasoning, atau writing sesuai kelas. `contextFit` adalah 1 jika context window cukup untuk perkiraan token, 0 jika tidak. `toolFit` adalah 1 jika semua tool yang dibutuhkan didukung. `costScore` dinormalisasi terbalik terhadap harga. `latencyScore` dari kelas latensi. `healthScore` dari status provider.

Kandidat yang tidak memenuhi syarat keras langsung dibuang:

- Tidak mendukung tool yang wajib.
- Context window kurang dari perkiraan.
- Tidak mendukung modality yang dilampirkan.
- Provider `down` atau `auth_error`.
- Model `deprecated`.

### 25.4 Kebijakan routing

```json
{
  "routing": {
    "mode": "auto",
    "defaultPolicy": "balanced",
    "policies": {
      "coding": {"prefer": ["smart", "reasoning"], "maxCostPerTask": 1.50},
      "extraction": {"prefer": ["fast"], "maxCostPerTask": 0.05},
      "review": {"prefer": ["reasoning"], "minQuality": 0.8}
    },
    "pinned": {
      "session": null,
      "project": "anthropic/claude-sonnet-4-5"
    },
    "fallback": [
      "openai/gpt-5",
      "openrouter/anthropic/claude-sonnet-4.5",
      "local/qwen3-coder"
    ]
  }
}
```

Aturan:

- `pinned` di level sesi menang atas project dan auto.
- `--model` di CLI menang atas config, kecuali `--model auto`.
- `prefer` adalah daftar alias yang diprioritaskan, bukan paksaan.
- `minQuality` membuang kandidat di bawah ambang.
- `maxCostPerTask` adalah batas keras. Jika semua kandidat melebihi, router memilih yang termurah dan memberi peringatan, atau berhenti jika `strictBudget`.
- Fallback hanya dipakai jika model utama gagal karena alasan yang bisa dipulihkan.

### 25.5 Transparansi

Setiap keputusan router menghasilkan:

```json
{
  "taskClass": "coding",
  "chosen": "anthropic/claude-sonnet-4-5",
  "score": 0.84,
  "candidates": [
    {"model": "anthropic/claude-sonnet-4-5", "score": 0.84, "reason": "coding 0.9, context cukup, harga menengah"},
    {"model": "openai/gpt-5-mini", "score": 0.71, "reason": "lebih murah, coding 0.7"},
    {"model": "local/qwen3-coder", "score": 0.52, "reason": "gratis, context kurang"}
  ],
  "policy": "balanced",
  "pinned": false
}
```

`/route explain "<prompt>"` menampilkan ini tanpa mengirim request. `/trace` menyimpan keputusan untuk setiap giliran. Jika pengguna bertanya "kenapa model ini", jawabannya ada, bukan tebakan.

### 25.6 Model switching

- Switch otomatis hanya terjadi saat fallback, dan dicatat.
- Switch karena compaction atau context penuh memerlukan model dengan context lebih besar; sistem memberi tahu.
- Switch di tengah tool call tidak dilakukan. Tunggu tool selesai atau batalkan dengan aman.
- Jika model baru tidak mendukung tool call, agentic mode berhenti dan meminta konfirmasi.

### 25.7 Evaluasi kualitas

Router memakai data historis:

- Tingkat keberhasilan task per model per kelas.
- Jumlah koreksi pengguna.
- Jumlah retry tool.
- Biaya per task sukses.

Data ini disimpan di `routing_stats` dan dipakai sebagai penyesuaian kecil, bukan pengganti kualitas dasar. Jika data kurang dari 20 sampel, bobotnya nol.

### 25.8 Biaya

Biaya dihitung dari usage dan harga registry:

```
cost = input/1e6 * inputPrice + output/1e6 * outputPrice
     + cacheRead/1e6 * cacheReadPrice + cacheWrite/1e6 * cacheWritePrice
```

Aturan:

- Harga dalam USD.
- Pembulatan ke 6 desimal.
- Jika harga tidak diketahui, `cost = null` dan ditampilkan `$?`.
- Budget dihitung dari `cost` yang diketahui; jika ada `null`, budget memberi peringatan.
- Usage provider yang tidak melaporkan token dihitung dengan estimator dan ditandai `estimated`.

## 26. Context intelligence

### 26.1 Tujuan

Context management memastikan model melihat informasi yang relevan, tidak kehilangan keputusan penting, dan tidak membayar token untuk hal yang tidak dipakai. Ini bukan sekadar "potong kalau penuh".

### 26.2 Estimasi token

Urutan metode:

1. Tokenizer provider jika adapter menyediakan.
2. Tokenizer lokal yang cocok (tiktoken untuk model OpenAI-compatible, SentencePiece jika tersedia).
3. Heuristik: 1 token ≈ 4 karakter untuk teks Latin, 1 token ≈ 1,5 karakter untuk CJK, 1 token ≈ 3 karakter untuk kode.

Setiap estimasi menyimpan `method` dan `confidence`. Jika error estimasi lebih dari 15 persen dibanding usage aktual, faktor koreksi diperbarui per model.

### 26.3 Anggaran konteks

| Zona | Porsi default | Isi |
|---|---|---|
| System | 8% | Identitas, aturan, format output |
| Tools | 12% | Skema tool yang relevan |
| Memory | 10% | Memory terseleksi |
| Files | 25% | File dan potongan kode |
| Conversation | 35% | Pesan dan hasil tool |
| Reserved | 10% | Ruang output dan verifikasi |

Porsi bisa diubah per model dan per tugas. Model dengan context 32k memakai porsi yang sama, tetapi totalnya lebih kecil; sistem memprioritaskan system, tool, dan goal.

### 26.4 Urutan penyusunan prompt

1. System prompt internal.
2. Instruksi global dan project yang relevan.
3. Goal dan kriteria selesai.
4. Rencana aktif dan status task.
5. Memory terseleksi.
6. Ringkasan percakapan sebelumnya.
7. File dan potongan kode yang relevan.
8. Pesan terbaru pengguna.
9. Skema tool.
10. Instruksi format output.

Urutan ini penting: jika budget habis, yang dipotong lebih dulu adalah file yang kurang relevan dan potongan percakapan lama, bukan goal atau instruksi keamanan.

### 26.5 Retrieval file dinamis

Sinyal yang dipakai:

- Path yang disebut pengguna.
- Simbol yang disebut atau yang error.
- File yang berubah di git.
- File yang diimpor oleh file yang sedang dibuka.
- Hasil pencarian teks dan semantik.
- Tes yang gagal.

File dipilih dengan skor, lalu dipotong per fungsi atau per rentang baris. Agen diberi peta file, bukan seluruh isi. Jika agen butuh bagian lain, ia memanggil `read_file` dengan rentang.

### 26.6 Memory injection

- Maksimal 12 entri atau 2.500 token.
- Setiap entri diberi label `[memory:scope]` dan sumber.
- Entri yang bertentangan tidak dimasukkan bersamaan; sistem memilih yang paling relevan dan menandai konflik.
- Memory tidak boleh mengubah instruksi keamanan.
- Jika tidak ada memory relevan, tidak ada bagian memory di prompt.

### 26.7 Compaction

Compaction dipicu saat pemakaian context melewati 75 persen, atau manual `/compact`.

Algoritma:

1. Hitung token per zona.
2. Bekukan goal, kriteria, keputusan, error terbuka, path penting, dan hasil verifikasi.
3. Ringkas percakapan lama per segmen (maksimal 8 segmen).
4. Pertahankan pesan terbaru yang relevan (default 6 pesan atau 4.000 token).
5. Tandai ringkasan dengan `[compacted: asal N pesan, waktu]`.
6. Tulis ringkasan ke `session_summaries` dengan referensi ke pesan asli.
7. Verifikasi bahwa total token turun di bawah 65 persen.
8. Jika masih di atas, potong file dan hasil tool lebih agresif.

Yang tidak boleh hilang:

- Tujuan asli.
- Kriteria selesai yang belum terpenuhi.
- Keputusan arsitektur.
- Error yang belum selesai.
- Path file yang diubah.
- Perintah verifikasi yang sudah dijalankan dan hasilnya.
- Preferensi pengguna yang relevan.

### 26.8 Overflow recovery

Jika provider menolak karena context terlalu besar:

1. Baca error dan batas yang dilaporkan.
2. Estimasi ulang dengan metode yang lebih konservatif.
3. Jalankan compaction paksa.
4. Kurangi tool schema ke tool yang benar-benar dipakai.
5. Kurangi file ke file yang berubah dan yang error.
6. Jika masih gagal, pindah ke model dengan context lebih besar jika diizinkan, atau minta pengguna memilih.
7. Catat kejadian di trace dan tampilkan satu pesan yang menjelaskan apa yang dipotong.

Tidak ada retry buta dengan prompt yang sama.

### 26.9 Prompt caching

- Untuk provider yang mendukung, system prompt dan instruksi stabil diberi penanda cache.
- Bagian yang berubah (pesan terbaru, file yang berubah) tidak di-cache.
- Cache key mencakup model, system prompt, dan tool schema.
- Jika cache tidak tersedia, tidak ada error; hanya usage tanpa cache.
- Penghematan cache ditampilkan di `/usage`.

### 26.10 Context inspector

`/context show` menampilkan:

- Total token dan persentase per zona.
- Daftar instruksi yang dimuat dan sumbernya.
- Daftar memory yang disuntikkan dan skornya.
- Daftar file dan rentang baris.
- Jumlah pesan yang diringkas.
- Tool schema yang dikirim.
- Estimasi biaya input untuk request berikutnya.

`/context explain <path>` menjelaskan mengapa file tertentu masuk atau tidak masuk.

### 26.11 Batas dan pengukuran

- Overhead context manager ≤ 20 ms per giliran untuk 100.000 token.
- Retrieval file ≤ 250 ms untuk repo 100.000 file.
- Compaction ≤ 3 detik untuk 100.000 token, di luar waktu model.
- Setelah compaction, tidak boleh ada penurunan akurasi pada tes regresi context (lihat ACCEPTANCE-CRITERIA).
