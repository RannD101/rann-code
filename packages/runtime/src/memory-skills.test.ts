import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { addMemory, openDatabase, type Db, type MessageRow } from "@rann/storage";
import { buildChatContext } from "./agent.js";
import { MemoryService } from "./memory.js";
import { SkillStore } from "./skills.js";

function database(): { db: Db; close: () => void } {
  const dir = mkdtempSync(join(tmpdir(), "rann-runtime-"));
  const { db } = openDatabase({ path: join(dir, "rann.db") });
  return { db, close: () => db.close() };
}

function row(index: number, role: MessageRow["role"], content: string): MessageRow {
  return {
    id: `msg_${index}`,
    session_id: "ses_test",
    turn_id: "turn_test",
    role,
    content,
    content_json: null,
    token_count: null,
    created_at: Date.now() + index
  };
}

describe("MemoryService", () => {
  it("mengambil memori global dan proyek yang relevan lalu membatasi ukuran prompt", () => {
    const { db, close } = database();
    const projectA = mkdtempSync(join(tmpdir(), "rann-mem-a-"));
    const projectB = mkdtempSync(join(tmpdir(), "rann-mem-b-"));
    try {
      addMemory(db, { text: "User selalu memakai bahasa Indonesia", scope: "global", kind: "preference" });
      addMemory(db, { text: "Proyek A memakai pnpm", projectPath: projectA });
      addMemory(db, { text: "Proyek B memakai npm", projectPath: projectB });

      const service = new MemoryService(db, projectA, { enabled: true, promptChars: 2_000, retrieve: 10 });
      const prompt = service.prompt("pnpm");
      expect(prompt.count).toBe(2);
      expect(prompt.text).toContain("bahasa Indonesia");
      expect(prompt.text).toContain("Proyek A memakai pnpm");
      expect(prompt.text).not.toContain("Proyek B memakai npm");
      expect(prompt.ids).toHaveLength(2);

      const tiny = new MemoryService(db, projectA, { enabled: true, promptChars: 30, retrieve: 10 });
      expect(tiny.prompt("pnpm").text.length).toBeLessThan(200);
      expect(new MemoryService(db, projectA, { enabled: false, promptChars: 2_000, retrieve: 10 }).prompt("pnpm").text).toBe("");
    } finally {
      close();
    }
  });

  it("mengekstrak preferensi eksplisit, melewati duplikat, dan menandai konflik", () => {
    const { db, close } = database();
    const project = mkdtempSync(join(tmpdir(), "rann-mem-extract-"));
    try {
      const service = new MemoryService(db, project, { enabled: true, promptChars: 2_000, retrieve: 10 });
      const first = service.rememberFromTurn("Aku suka jawaban singkat. Jangan pakai emoji di output.");
      expect(first.added.length).toBeGreaterThanOrEqual(2);
      expect(first.added.some((entry) => entry.kind === "preference")).toBe(true);
      const second = service.rememberFromTurn("Aku suka jawaban singkat.");
      expect(second.duplicates).toBeGreaterThanOrEqual(1);
      const conflict = service.rememberFromTurn("Aku tidak suka jawaban singkat.");
      expect(conflict.conflicts.length).toBeGreaterThanOrEqual(1);
    } finally {
      close();
    }
  });
});

describe("SkillStore", () => {
  it("membaca skill bawaan lalu menyimpan dan menghapus skill proyek", () => {
    const profile = mkdtempSync(join(tmpdir(), "rann-skill-profile-"));
    const project = mkdtempSync(join(tmpdir(), "rann-skill-project-"));
    const store = new SkillStore(profile, project);

    expect(store.list().some((skill) => skill.name === "debug-sistematis" && skill.scope === "builtin")).toBe(true);
    expect(store.catalog()).toContain("debug-sistematis");

    const created = store.create({
      name: "deploy-lokal",
      description: "Gunakan saat menyiapkan deploy lokal untuk proyek ini",
      body: "1. Jalankan build.\n2. Jalankan tes.\n3. Simpan artefak di dist.",
      scope: "project"
    });
    expect(created.name).toBe("deploy-lokal");
    expect(created.scope).toBe("project");
    expect(store.list().some((skill) => skill.name === "deploy-lokal")).toBe(true);
    expect(store.view("deploy-lokal")?.body).toContain("Jalankan build");

    const file = join(project, ".rann", "skills", "deploy-lokal", "SKILL.md");
    expect(readFileSync(file, "utf8")).toContain("name: deploy-lokal");

    expect(() =>
      store.create({
        name: "deploy-lokal",
        description: "Deskripsi lain yang cukup panjang",
        body: "Isi lain yang cukup panjang untuk lolos validasi.",
        scope: "project"
      })
    ).toThrow(/sudah ada/);

    expect(store.remove("deploy-lokal", "project")).toBe(true);
    expect(store.view("deploy-lokal")).toBeUndefined();
  });

  it("menolak nama skill tidak valid dan skill bawaan", () => {
    const profile = mkdtempSync(join(tmpdir(), "rann-skill-profile2-"));
    const project = mkdtempSync(join(tmpdir(), "rann-skill-project2-"));
    const store = new SkillStore(profile, project);
    expect(() => store.create({ name: "A", description: "deskripsi panjang sekali", body: "isi panjang sekali" })).toThrow();
    expect(() => store.create({ name: "debug-sistematis", description: "deskripsi panjang sekali", body: "isi panjang sekali" })).toThrow(/bawaan/);
    expect(() => store.remove("debug-sistematis")).toThrow(/bawaan/);
  });
});

describe("buildChatContext", () => {
  it("meringkas pesan lama tanpa memotong pesan terbaru", () => {
    const rows: MessageRow[] = [];
    for (let index = 0; index < 40; index += 1) {
      rows.push(row(index, index % 2 === 0 ? "user" : "assistant", `pesan ${index} ${"x".repeat(120)}`));
    }
    const built = buildChatContext(rows, "system", { maxTokens: 300, keepRecent: 8, summaryChars: 400 });
    expect(built.compacted).toBe(true);
    expect(built.dropped).toBeGreaterThan(0);
    expect(built.messages[0]?.role).toBe("system");
    expect(built.messages[1]?.content).toContain("RINGKASAN KONTEKS LOKAL");
    expect(built.messages.at(-1)?.content).toContain("pesan 39");
    expect(built.messages.length).toBeLessThan(rows.length + 2);
  });

  it("tidak berubah saat konteks masih kecil", () => {
    const rows = [row(0, "user", "halo"), row(1, "assistant", "hai")];
    const built = buildChatContext(rows, "system", { maxTokens: 10_000, keepRecent: 8, summaryChars: 400 });
    expect(built.compacted).toBe(false);
    expect(built.dropped).toBe(0);
    expect(built.messages.map((message) => message.content)).toEqual(["system", "halo", "hai"]);
  });
});

describe("skrip skill", () => {
  it("menjalankan skrip dari folder skill dengan env terbatas", async () => {
    const project = mkdtempSync(join(tmpdir(), "rann-skill-run-"));
    const store = new SkillStore(join(project, "profile"), project);
    store.create({ name: "skrip-uji", description: "Skill untuk menguji eksekusi skrip", body: "Jalankan skrip halo.", triggers: ["skrip"], scope: "project" });
    const file = join(project, ".rann", "skills", "skrip-uji", "scripts", "halo.sh");
    mkdirSync(join(project, ".rann", "skills", "skrip-uji", "scripts"), { recursive: true });
    writeFileSync(file, "#!/bin/sh\nprintf 'halo %s' \"$RANN_SKILL\"\n", { mode: 0o755 });
    const result = await store.runScript("skrip-uji", "halo.sh");
    expect(result.ok).toBe(true);
    expect(result.stdout).toBe("halo skrip-uji");
  });

  it("menolak path skrip di luar folder scripts dan skrip yang timeout", async () => {
    const project = mkdtempSync(join(tmpdir(), "rann-skill-run-"));
    const store = new SkillStore(join(project, "profile"), project);
    store.create({ name: "skrip-uji", description: "Skill untuk menguji eksekusi skrip", body: "Jalankan skrip halo.", scope: "project" });
    await expect(store.runScript("skrip-uji", "../rahasia.sh")).rejects.toThrow(/nama skrip/);
    mkdirSync(join(project, ".rann", "skills", "skrip-uji", "scripts"), { recursive: true });
    const file = join(project, ".rann", "skills", "skrip-uji", "scripts", "lambat.sh");
    writeFileSync(file, "#!/bin/sh\nsleep 5\n", { mode: 0o755 });
    const result = await store.runScript("skrip-uji", "lambat.sh", [], { timeoutMs: 1_000 });
    expect(result).toMatchObject({ ok: false, exitCode: 124 });
  });
});

describe("review kandidat memori", () => {
  it("menyimpan kandidat berkonfidensi rendah sebagai pending, menyaring rahasia, lalu bisa disetujui", () => {
    const { db, close } = database();
    try {
      const service = new MemoryService(db, "/proyek", { enabled: true, promptChars: 2_000, retrieve: 10 });
      const result = service.rememberFromTurn("Aku pilih pakai pnpm untuk proyek ini. Token api key rahasia jangan disimpan.");
      expect(result.added).toHaveLength(1);
      const [candidate] = service.pending();
      expect(candidate?.text).toContain("pnpm");
      expect(service.approve(candidate!.id)).toMatchObject({ status: "active" });
      expect(service.pending()).toHaveLength(0);
    } finally {
      close();
    }
  });
});

describe("memory per agen", () => {
  it("menyembunyikan memori agen lain, mengizinkan lewat grant, dan mencatat pemakaian", () => {
    const { db, close } = database();
    try {
      const reviewer = new MemoryService(db, "/proyek", { enabled: true, promptChars: 2_000, retrieve: 10, agentProfile: "reviewer" });
      const coder = new MemoryService(db, "/proyek", { enabled: true, promptChars: 2_000, retrieve: 10, agentProfile: "coder" });
      const entry = reviewer.add({ text: "pola bug null check di handler", kind: "insight", scope: "project" });
      expect(reviewer.search("pola bug")).toHaveLength(1);
      expect(coder.search("pola bug")).toHaveLength(0);
      reviewer.allowAgent(entry.id, "coder");
      expect(coder.search("pola bug")).toHaveLength(1);
      const events = db.prepare("SELECT COUNT(*) AS n FROM memory_events WHERE memory_id = ? AND action = 'retrieved'").get(entry.id) as { n: number };
      expect(events.n).toBe(2);
    } finally {
      close();
    }
  });
});
