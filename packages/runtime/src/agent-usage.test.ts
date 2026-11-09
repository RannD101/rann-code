import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSession, createTurn, openDatabase, type Db } from "@rann/storage";
import { RannError } from "@rann/shared";
import { runTurn, type AgentConfig } from "./agent.js";
import type { ChatRequest, Provider, ProviderChunk } from "./providers/types.js";

const config: AgentConfig = {
  permissionMode: "trusted",
  workspaceOnly: true,
  allow: [],
  deny: [],
  maxSteps: 2,
  systemExtra: ""
};

class IdProvider implements Provider {
  readonly name = "id";
  readonly kind = "mock";
  readonly support = { embed: false, listModels: false, health: false, countTokens: true };

  stream(request: ChatRequest): AsyncGenerator<ProviderChunk, void, unknown> {
    return this.chat(request);
  }

  async *chat(_request: ChatRequest): AsyncGenerator<ProviderChunk, void, unknown> {
    yield { type: "request_id", id: "req_123" };
    yield { type: "text", text: "beres" };
    yield { type: "usage", inputTokens: 7, outputTokens: 3 };
    yield { type: "done", finishReason: "stop" };
  }
}

class DownProvider implements Provider {
  readonly name: string;
  readonly kind = "mock";
  readonly support = { embed: false, listModels: false, health: false, countTokens: true };
  calls = 0;

  constructor(name = "down") {
    this.name = name;
  }

  stream(request: ChatRequest): AsyncGenerator<ProviderChunk, void, unknown> {
    return this.chat(request);
  }

  async *chat(_request: ChatRequest): AsyncGenerator<ProviderChunk, void, unknown> {
    this.calls += 1;
    throw new RannError("E_PROVIDER_UNAVAILABLE", `provider ${this.name} mati`);
    yield { type: "done", finishReason: "stop" };
  }
}

function setup(): { db: Db; close: () => void; project: string } {
  const root = mkdtempSync(join(tmpdir(), "rann-usage-"));
  const project = join(root, "proyek");
  const { db } = openDatabase({ path: join(root, "rann.db") });
  return { db, close: () => db.close(), project };
}

function usageRows(db: Db): Array<{ provider: string; model: string; provider_request_id: string | null }> {
  return db
    .prepare("SELECT provider, model, provider_request_id FROM usage_events ORDER BY created_at")
    .all() as Array<{ provider: string; model: string; provider_request_id: string | null }>;
}

describe("pencatatan usage dan fallback", () => {
  it("menyimpan provider request id ke usage_events", async () => {
    const { db, close, project } = setup();
    try {
      const session = createSession(db, { projectPath: project, model: "id", permissionMode: "trusted" });
      const turn = createTurn(db, { sessionId: session.id });
      const result = await runTurn({
        db,
        session,
        turnId: turn.id,
        userText: "halo",
        provider: new IdProvider(),
        model: "id-1",
        workspaceRoot: project,
        config
      });
      expect(result.text).toBe("beres");
      const row = usageRows(db)[0];
      expect(row?.provider_request_id).toBe("req_123");
      expect(row?.model).toBe("id-1");
    } finally {
      close();
    }
  });

  it("berpindah ke fallback dan mencatat model yang benar-benar dipakai", async () => {
    const { db, close, project } = setup();
    try {
      const session = createSession(db, { projectPath: project, model: "down", permissionMode: "trusted" });
      const turn = createTurn(db, { sessionId: session.id });
      const primary = new DownProvider("down");
      const logs: Array<Record<string, unknown>> = [];
      const result = await runTurn({
        db,
        session,
        turnId: turn.id,
        userText: "halo",
        provider: primary,
        model: "down-1",
        workspaceRoot: project,
        config,
        fallbacks: [{ provider: new IdProvider(), model: "id-1", contextWindow: 8_000, maxOutputTokens: 1_000 }],
        emit: (event) => {
          if (event.type === "log") logs.push(event.data as Record<string, unknown>);
        }
      });
      expect(result.text).toBe("beres");
      expect(primary.calls).toBe(2);
      const row = usageRows(db)[0];
      expect(row?.provider).toBe("id");
      expect(row?.model).toBe("id-1");
      const switched = logs.find((entry) => entry.event === "provider.switch");
      expect(switched?.to).toBe("id");
      expect(switched?.fallback).toBe(true);
    } finally {
      close();
    }
  });

  it("menyusun rantai percobaan saat semua provider gagal", async () => {
    const { db, close, project } = setup();
    try {
      const session = createSession(db, { projectPath: project, model: "down", permissionMode: "trusted" });
      const turn = createTurn(db, { sessionId: session.id });
      const error = await runTurn({
        db,
        session,
        turnId: turn.id,
        userText: "halo",
        provider: new DownProvider("satu"),
        model: "satu-1",
        workspaceRoot: project,
        config,
        fallbacks: [{ provider: new DownProvider("dua"), model: "dua-1", contextWindow: 8_000, maxOutputTokens: 1_000 }]
      }).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(RannError);
      const rann = error as RannError;
      expect(rann.code).toBe("E_PROVIDER_UNAVAILABLE");
      expect(rann.message).toContain("rantai");
      const attempts =
        (rann.data as { attempts?: Array<{ provider: string; code: string; attempts: number }> }).attempts ?? [];
      expect(attempts.map((entry) => entry.provider)).toEqual(["satu", "dua"]);
      expect(attempts.map((entry) => entry.attempts)).toEqual([2, 1]);
      expect(attempts.every((entry) => entry.code === "E_PROVIDER_UNAVAILABLE")).toBe(true);
      const events = db.prepare("SELECT COUNT(*) AS total FROM events WHERE session_id = ?").get(session.id) as { total: number };
      expect(events.total).toBeGreaterThan(0);
      expect(usageRows(db)).toHaveLength(0);
    } finally {
      close();
    }
  });
});
