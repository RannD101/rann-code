import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSession, createTurn, listSubagents, getSubagent } from "@rann/storage";
import { RpcServer } from "./rpc.js";
import { ensureLayout, resolveLayout } from "./paths.js";
import { ensureDefaultConfig } from "./daemon.js";
import { loadConfig } from "@rann/shared";

const servers: RpcServer[] = [];

async function setup(): Promise<{ server: RpcServer; project: string; sessionId: string; turnId: string }> {
  const root = mkdtempSync(join(tmpdir(), "rann-subrun-"));
  const home = join(root, "home");
  const project = join(root, "project");
  mkdirSync(project, { recursive: true });
  writeFileSync(join(project, "catatan.txt"), "isi");
  const layout = resolveLayout(home);
  ensureLayout(layout);
  ensureDefaultConfig(layout);
  const loaded = loadConfig({ home, projectPath: project });
  const server = new RpcServer({ layout, config: loaded, version: "test", shutdown: () => undefined });
  servers.push(server);
  const session = createSession(server.database, { title: "induk", model: "mock-1", permissionMode: "read-only", projectPath: project });
  const turn = createTurn(server.database, { sessionId: session.id });
  return { server, project, sessionId: session.id, turnId: turn.id };
}

function run(server: RpcServer, input: { sessionId: string; turnId: string; project: string; goal: string }) {
  const parent = server.database.prepare("SELECT * FROM sessions WHERE id = ?").get(input.sessionId);
  return (server as unknown as {
    runSubagent: (options: unknown) => Promise<Record<string, unknown>>;
  }).runSubagent({
    parent,
    parentTurnId: input.turnId,
    projectPath: input.project,
    model: "mock-1",
    input: { goal: input.goal, label: "uji" },
    signal: new AbortController().signal
  });
}

afterEach(async () => {
  for (const server of servers.splice(0)) await server.close();
});

describe("runSubagent", () => {
  it("menjalankan subagent nyata dengan mock provider dan menyimpan hasil", async () => {
    const { server, project, sessionId, turnId } = await setup();
    const result = await run(server, { sessionId, turnId, project, goal: "tool:fs_list {}" });

    expect(result.status).toBe("done");
    expect(result.profile).toBe("explore");
    expect(Number(result.steps)).toBeGreaterThanOrEqual(2);
    expect(result.session_id).toBeTypeOf("string");
    const rows = listSubagents(server.database);
    expect(rows).toHaveLength(1);
    expect(getSubagent(server.database, String(result.agent_id))?.status).toBe("done");
    expect(getSubagent(server.database, String(result.agent_id))?.parent_turn_id).toBe(turnId);
  });

  it("menolak subagent melebihi max_per_turn", async () => {
    const { server, project, sessionId, turnId } = await setup();
    (server as unknown as { options: { config: { config: { subagents: { max_per_turn: number } } } } }).options.config.config.subagents.max_per_turn = 1;
    await run(server, { sessionId, turnId, project, goal: "tool:fs_list {}" });
    await expect(run(server, { sessionId, turnId, project, goal: "tool:fs_list {}" })).rejects.toMatchObject({
      code: "E_BUDGET_EXHAUSTED"
    });
  });
});
