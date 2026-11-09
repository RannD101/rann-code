import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSession, createTurn, listSubagents } from "@rann/storage";
import { RpcServer } from "./rpc.js";
import { ensureLayout, resolveLayout } from "./paths.js";
import { loadConfig } from "@rann/shared";

const servers: RpcServer[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
});

function run(server: RpcServer, input: { sessionId: string; turnId: string; project: string; goal: string }) {
  const parent = server.database.prepare("SELECT * FROM sessions WHERE id = ?").get(input.sessionId);
  return (server as unknown as { runSubagent: (options: unknown) => Promise<Record<string, unknown>> }).runSubagent({
    parent,
    parentTurnId: input.turnId,
    projectPath: input.project,
    model: "mock-1",
    input: { goal: input.goal, label: "paralel" },
    signal: new AbortController().signal
  });
}

describe("acceptance paralel", () => {
  it("AC-055 delapan agen paralel selesai di bawah 60 persen waktu serial", async () => {
    const root = mkdtempSync(join(tmpdir(), "rann-par-"));
    const home = join(root, "home");
    const project = join(root, "project");
    mkdirSync(join(home, "config"), { recursive: true });
    mkdirSync(project, { recursive: true });
    writeFileSync(join(home, "config", "config.toml"), "[subagents]\nmax_per_turn = 8\nmax_concurrent = 8\nmax_concurrent_per_session = 8\nmax_children = 8\n");
    const layout = resolveLayout(home);
    ensureLayout(layout);
    const loaded = loadConfig({ home, projectPath: project });
    const server = new RpcServer({ layout, config: loaded, version: "test", shutdown: () => undefined });
    servers.push(server);
    const session = createSession(server.database, { title: "induk", model: "mock-1", permissionMode: "read-only", projectPath: project });
    const turn = createTurn(server.database, { sessionId: session.id });
    const previous = process.env.RANN_MOCK_SCENARIO;
    process.env.RANN_MOCK_SCENARIO = "slow";
    try {
      const started = Date.now();
      const results = await Promise.all(Array.from({ length: 8 }, (_, index) => run(server, { sessionId: session.id, turnId: turn.id, project, goal: `tugas ${index}` })));
      const elapsed = Date.now() - started;
      expect(results).toHaveLength(8);
      expect(listSubagents(server.database, turn.id)).toHaveLength(8);
      expect(elapsed).toBeLessThan(8 * 5_000 * 0.6);
    } finally {
      if (previous === undefined) delete process.env.RANN_MOCK_SCENARIO;
      else process.env.RANN_MOCK_SCENARIO = previous;
    }
  }, 60_000);
});
