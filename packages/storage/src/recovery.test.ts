import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createCheckpoint, createSession, createTurn, listMessages, openDatabase, recoverInterruptedTurns } from "./index.js";

describe("pemulihan turn terputus", () => {
  it("menyertakan checkpoint terakhir dan menandai bisa dilanjutkan", () => {
    const dir = mkdtempSync(join(tmpdir(), "rann-recovery-"));
    const { db } = openDatabase({ path: join(dir, "rann.db") });
    const session = createSession(db, { projectPath: dir, model: "mock-1", permissionMode: "trusted" });
    const turn = createTurn(db, { sessionId: session.id });
    createCheckpoint(db, { sessionId: session.id, turnId: turn.id, label: "sebelum edit", state: { step: 3 } });
    const recovered = recoverInterruptedTurns(db);
    expect(recovered.map((item) => item.id)).toContain(turn.id);
    const message = listMessages(db, session.id, 10).find((item) => item.turn_id === turn.id && item.role === "assistant");
    expect(message?.content).toContain("Checkpoint terakhir");
    expect(message?.content).toContain("/resume");
    expect((JSON.parse(message?.content_json ?? "{}") as { resume?: boolean }).resume).toBe(true);
  });

  it("memberi petunjuk berbeda saat belum ada checkpoint", () => {
    const dir = mkdtempSync(join(tmpdir(), "rann-recovery-"));
    const { db } = openDatabase({ path: join(dir, "rann.db") });
    const session = createSession(db, { projectPath: dir, model: "mock-1", permissionMode: "trusted" });
    const turn = createTurn(db, { sessionId: session.id });
    recoverInterruptedTurns(db);
    const message = listMessages(db, session.id, 10).find((item) => item.turn_id === turn.id && item.role === "assistant");
    expect(message?.content).toContain("Belum ada checkpoint");
  });

  it("AC-038 turn running pulih dari checkpoint dalam <= 5 detik", () => {
    const dir = mkdtempSync(join(tmpdir(), "rann-recovery-fast-"));
    const { db } = openDatabase({ path: join(dir, "rann.db") });
    const session = createSession(db, { projectPath: dir, model: "mock-1", permissionMode: "trusted" });
    const turn = createTurn(db, { sessionId: session.id });
    db.prepare("UPDATE turns SET status = 'running' WHERE id = ?").run(turn.id);
    const checkpoint = createCheckpoint(db, { sessionId: session.id, turnId: turn.id, label: "sebelum crash", state: { step: 4 } });
    const started = Date.now();
    const recovered = recoverInterruptedTurns(db);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(recovered.map((item) => item.id)).toContain(turn.id);
    const message = listMessages(db, session.id, 10).find((item) => item.turn_id === turn.id && item.role === "assistant");
    expect(message?.content).toContain(checkpoint.id);
  });
});
