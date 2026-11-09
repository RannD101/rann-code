import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSession, createTurn, openDatabase } from "@rann/storage";
import { runTurn, type AgentConfig } from "./agent.js";
import { MockProvider } from "./providers/mock.js";
import type { ProviderChunk } from "./providers/types.js";

const config: AgentConfig = { permissionMode: "trusted", workspaceOnly: true, allow: [], deny: [], maxSteps: 8, systemExtra: "" };

const source = `export function hitung(a, op, b) {
  let hasil;
  if (op === "tambah") {
    hasil = a + b;
  } else if (op === "kurang") {
    hasil = a - b;
  } else if (op === "kali") {
    hasil = a * b;
  } else if (op === "bagi") {
    if (b === 0) {
      throw new Error("pembagi nol");
    }
    hasil = a / b;
  } else {
    throw new Error("operasi tidak dikenal");
  }
  return hasil;
}
`;
const refactored = `export function hitung(a, op, b) {
  const operasi = {
    tambah: () => a + b,
    kurang: () => a - b,
    kali: () => a * b,
    bagi: () => {
      if (b === 0) throw new Error("pembagi nol");
      return a / b;
    }
  };
  const jalankan = operasi[op];
  if (!jalankan) throw new Error("operasi tidak dikenal");
  return jalankan();
}
`;
const testFile = `import test from "node:test";
import assert from "node:assert/strict";
import { hitung } from "./kalkulator.mjs";
test("operasi", () => {
  assert.equal(hitung(2, "tambah", 3), 5);
  assert.equal(hitung(7, "kurang", 4), 3);
  assert.equal(hitung(6, "kali", 5), 30);
  assert.equal(hitung(8, "bagi", 2), 4);
  assert.throws(() => hitung(1, "bagi", 0));
  assert.throws(() => hitung(1, "pangkat", 2));
});
`;

class RefactorProvider extends MockProvider {
  private step = 0;
  async *chat(): AsyncGenerator<ProviderChunk, void, unknown> {
    if (this.step === 0) {
      this.step += 1;
      yield { type: "tool_call", id: "refactor-1", name: "fs_write", args: { path: "kalkulator.mjs", content: refactored } };
      yield { type: "usage", inputTokens: 10, outputTokens: 20 };
      yield { type: "done", finishReason: "tool_calls" };
      return;
    }
    if (this.step === 1) {
      this.step += 1;
      yield { type: "tool_call", id: "refactor-2", name: "shell_run", args: { command: "node --test kalkulator.test.mjs" } };
      yield { type: "usage", inputTokens: 10, outputTokens: 8 };
      yield { type: "done", finishReason: "tool_calls" };
      return;
    }
    this.step += 1;
    yield { type: "text", text: "Fungsi dirapikan, tes lulus, ekspor hitung tetap." };
    yield { type: "usage", inputTokens: 10, outputTokens: 8 };
    yield { type: "done", finishReason: "stop" };
  }
}

describe("acceptance refactor", () => {
  it("AC-045 refactor menjaga perilaku tes dan simbol publik", async () => {
    const dir = mkdtempSync(join(tmpdir(), "rann-refactor-"));
    writeFileSync(join(dir, "kalkulator.mjs"), source);
    writeFileSync(join(dir, "kalkulator.test.mjs"), testFile);
    const before = spawnSync("node", ["--test", "kalkulator.test.mjs"], { cwd: dir, encoding: "utf8" });
    expect(before.status).toBe(0);
    const exportsBefore = [...source.matchAll(/export function (\w+)/g)].map((match) => match[1]);
    const { db } = openDatabase({ path: join(dir, "rann.db") });
    const session = createSession(db, { projectPath: dir, model: "mock-1", permissionMode: "trusted" });
    const turn = createTurn(db, { sessionId: session.id });
    await runTurn({
      db, session, turnId: turn.id, provider: new RefactorProvider(), model: "mock-1", workspaceRoot: dir, config,
      taskClass: "answer",
      userText: "Rapikan kalkulator.mjs agar lebih ringkas tanpa mengubah perilaku dan tanpa mengubah nama ekspor hitung. Jalankan node --test kalkulator.test.mjs."
    });
    const after = spawnSync("node", ["--test", "kalkulator.test.mjs"], { cwd: dir, encoding: "utf8" });
    expect(after.status).toBe(0);
    const hasil = readFileSync(join(dir, "kalkulator.mjs"), "utf8");
    const exportsAfter = [...hasil.matchAll(/export function (\w+)/g)].map((match) => match[1]);
    expect(exportsAfter).toEqual(exportsBefore);
    expect(hasil.length).toBeLessThan(source.length);
  }, 40_000);
});
