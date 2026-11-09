import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { addMemory, createSession, openDatabase, recordProcedureResult, upsertProcedure } from "@rann/storage";
import { MemoryService, chunkKnowledge } from "./memory.js";
import { executeTool } from "./tools/index.js";

function setup(): { service: MemoryService; root: string; db: ReturnType<typeof openDatabase>["db"] } {
  const root = mkdtempSync(join(tmpdir(), "rann-ac-memory-"));
  const { db } = openDatabase({ path: join(root, "rann.db") });
  return { service: new MemoryService(db, root, { enabled: true, promptChars: 4_000, retrieve: 10 }), root, db };
}

describe("acceptance memori dan tool", () => {
  it("AC-064 keputusan arsitektur ditemukan lagi untuk sesi baru", () => {
    const { service } = setup();
    service.add({ text: "Keputusan: produksi memakai Postgres, bukan SQLite", kind: "decision", scope: "project" });
    const prompt = service.prompt("database produksi apa?");
    expect(prompt.text).toContain("Postgres");
  });

  it("AC-067 knowledge chunk membawa path dan nomor baris", () => {
    const chunks = chunkKnowledge("# Pajak\nHitung pajak dari harga.\n\n# Diskon\nDiskon maksimal 10 persen.", "docs/pajak.md");
    expect(chunks[0]).toMatchObject({ path: "docs/pajak.md", heading: "Pajak", startLine: 1 });
    expect(chunks[0]?.text).toContain("Hitung pajak");
  });

  it("AC-088 argumen salah tipe ditolak dan menyebut field path", async () => {
    const error = await executeTool("fs_read", { path: 123 }, {
      workspaceRoot: "/tmp",
      workspaceOnly: true,
      permissionMode: "trusted",
      approved: false
    }).catch((caught: unknown) => caught);
    expect((error as { code?: string }).code).toBe("E_TOOL_INVALID_ARGS");
    expect((error as Error).message).toContain("path");
  });

  it("AC-089 tool lambat melewati timeout dan proses dibunuh", async () => {
    const started = Date.now();
    const result = await executeTool(
      "shell_run",
      { command: 'node -e "setTimeout(()=>{}, 5000)"' },
      { workspaceRoot: "/tmp", workspaceOnly: true, permissionMode: "trusted", approved: true, shellTimeoutMs: 200 }
    );
    expect(result.ok).toBe(false);
    expect(result.code).toBe("E_TOOL_TIMEOUT");
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  it("AC-065 ringkasan sesi disimpan, transkrip mentah tidak", () => {
    const { service, root, db } = setup();
    const session = createSession(db, { projectPath: root, model: "mock-1", permissionMode: "trusted" });
    const messages = Array.from({ length: 12 }, (_, index) => ({ role: index % 2 === 0 ? "user" : "assistant", content: `pesan ${index} isi panjang` }));
    const entry = service.summarizeSession(session.id, messages);
    expect(entry?.kind).toBe("session_summary");
    expect(entry?.text).toContain(session.id);
    expect(entry?.text).not.toContain("pesan 11 isi panjang");
    expect(root.length).toBeGreaterThan(0);
  });

  it("AC-068 prosedur aktif setelah tiga keberhasilan", () => {
    const { root } = setup();
    const { db } = openDatabase({ path: join(root, "proc.db") });
    const procedure = upsertProcedure(db, {
      projectPath: root,
      name: "rilis",
      trigger: "saat rilis",
      prerequisites: ["tes hijau"],
      steps: "1. jalankan tes\n2. build",
      verification: "exit 0"
    });
    expect(procedure.status).toBe("candidate");
    for (let index = 0; index < 3; index += 1) recordProcedureResult(db, procedure.id, true);
    const active = db.prepare("SELECT status FROM procedures WHERE id = ?").get(procedure.id) as { status: string };
    expect(active.status).toBe("active");
  });

  it("AC-074 koreksi memory dicatat dengan aktor", () => {
    const { service } = setup();
    const entry = service.add({ text: "Pakai npm untuk proyek ini", kind: "preference", scope: "project" });
    service.update(entry.id, { text: "Pakai pnpm untuk proyek ini" });
    const rows = service["db"].prepare("SELECT action, actor FROM memory_events WHERE memory_id = ?").all(entry.id) as Array<{ action: string; actor: string }>;
    expect(rows.some((row) => row.action === "updated" && row.actor === "agent")).toBe(true);
  });

  it("AC-094 tool MCP tetap meminta izin saat permission write", async () => {
    const error = await executeTool("mcp__srv__tulis", {}, {
      workspaceRoot: "/tmp",
      workspaceOnly: true,
      permissionMode: "trusted",
      approved: false,
      mcp: {
        listTools: async () => [],
        callTool: async () => ({ ok: true }),
        permissionFor: () => "write",
        untrusted: true
      }
    } as never).catch((caught: unknown) => caught);
    expect((error as { code?: string }).code).toBe("E_APPROVAL_REQUIRED");
  });

  it("AC-070 pencarian 10.000 memory tetap di bawah 80 ms p95", () => {
    const root = mkdtempSync(join(tmpdir(), "rann-ac-perf-"));
    const { db } = openDatabase({ path: join(root, "rann.db") });
    const insert = db.transaction(() => {
      for (let index = 0; index < 10_000; index += 1) {
        addMemory(db, { text: `catatan ${index} tentang topik ${index % 100}`, scope: "project", kind: "note", projectPath: root });
      }
    });
    insert();
    const service = new MemoryService(db, root, { enabled: true, promptChars: 4_000, retrieve: 10 });
    const durations: number[] = [];
    for (let index = 0; index < 20; index += 1) {
      const started = performance.now();
      service.search(`topik ${index % 100}`);
      durations.push(performance.now() - started);
    }
    durations.sort((a, b) => a - b);
    const p95 = durations[Math.floor(durations.length * 0.95) - 1] ?? durations.at(-1) ?? 0;
    expect(p95).toBeLessThan(80);
  }, 60_000);

  it("AC-142 memori sesi tidak bocor ke sesi lain", () => {
    const root = mkdtempSync(join(tmpdir(), "rann-ac-session-mem-"));
    const { db } = openDatabase({ path: join(root, "rann.db") });
    const a = createSession(db, { projectPath: root, model: "mock-1", permissionMode: "trusted" });
    const b = createSession(db, { projectPath: root, model: "mock-1", permissionMode: "trusted" });
    const owner = new MemoryService(db, root, { enabled: true, promptChars: 2_000, retrieve: 10, sessionId: a.id });
    const other = new MemoryService(db, root, { enabled: true, promptChars: 2_000, retrieve: 10, sessionId: b.id });
    owner.add({ text: "rahasia sesi A tentang proyek", scope: "session", kind: "note", sessionId: a.id });
    expect(owner.prompt("rahasia sesi").text).toContain("rahasia sesi A");
    expect(other.prompt("rahasia sesi").text).toBe("");
  });


  it("AC-075 impor melaporkan konflik duplikat", () => {
    const { service } = setup();
    service.add({ text: "Selalu pakai pnpm untuk proyek ini", kind: "preference", scope: "project" });
    const payload = service.exportAll();
    const result = service.importAll(payload, { strategy: "skip" });
    expect(result.conflicts.length).toBeGreaterThan(0);
    expect(result.imported).toBe(0);
  });

  it("AC-072 memory duplikat digabung dengan versi baru", () => {
    const { service, db } = setup();
    const first = service.add({ text: "Selalu pakai pnpm di proyek ini", kind: "preference", scope: "project", tags: ["a"] });
    const second = service.add({ text: "Selalu pakai pnpm di proyek ini", kind: "preference", scope: "project", tags: ["b"] });
    expect(second.id).toBe(first.id);
    expect(second.version).toBe(2);
    expect(second.tags).toContain("b");
    const merged = db.prepare("SELECT COUNT(*) AS n FROM memory_events WHERE memory_id = ? AND action = 'merged'").get(first.id) as { n: number };
    expect(merged.n).toBe(1);
  });

  it("AC-073 memory kedaluwarsa berstatus stale dan tidak muncul", () => {
    const { service, db } = setup();
    const entry = service.add({ text: "catatan sementara yang sudah lewat", kind: "note", scope: "project", expiresAt: Date.now() - 1_000 });
    expect(service.search("catatan sementara")).toHaveLength(0);
    const row = db.prepare("SELECT status FROM memory_entries WHERE id = ?").get(entry.id) as { status: string };
    expect(row.status).toBe("stale");
  });
});
