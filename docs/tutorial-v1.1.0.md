# Tutorial v1.1.0: dua jalur CLI

Rilis 1.1.0 punya dua panduan terpisah karena kedua CLI punya cara pasang, autentikasi, dan perintah yang berbeda.

- [Rann Code CLI](tutorial-rann-code.md): agen coding lokal dengan daemon, sesi SQLite, memori, skill, subagent, MCP, dan provider model yang kamu pasang sendiri.
- [Claude Code CLI](tutorial-claude-code.md): CLI agent dari Anthropic yang memakai akun Claude atau API key Anthropic.

Kalau kamu pengguna Rann Code, mulai dari panduan pertama. Panduan kedua disediakan untuk membandingkan atau memakai Claude Code di mesin yang sama.

## Ringkasan perbedaan

- Rann Code menyimpan sesi, memori, dan konfigurasi di `RANN_HOME` milikmu, default `~/.rann`. Claude Code menyimpan konfigurasi di folder miliknya sendiri dan memakai akun Anthropic.
- Rann Code bisa berjalan penuh dengan provider `mock` tanpa jaringan. Claude Code memerlukan autentikasi Anthropic untuk menjalankan model.
- Rann Code memakai perintah `rann`. Claude Code memakai perintah `claude`.
- Keduanya bisa dipasang berdampingan karena nama perintahnya berbeda.

## Versi

- Rann Code: `1.1.0`
- Claude Code: ikuti versi terbaru dari installer resmi Anthropic.
