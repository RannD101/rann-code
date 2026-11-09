import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openDatabase } from "@rann/storage";
import { MemoryService, chunkKnowledge } from "./memory.js";
import { executeTool } from "./tools/index.js";

function setup(): { service: MemoryService; root: string } {
  const root = mkdtempSync(join(tmpdir(), "rann-ac-memory-"));
  const { db } = openDatabase({ path: join(root, "rann.db") });
  return { service: new MemoryService(db, root, { enabled: true, promptChars: 4_000, retrieve: 10 }), root };
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
});
