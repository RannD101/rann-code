import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { addMemory, createSession, createTurn, listMessages, openDatabase, recordUsage, type Db } from "@rann/storage";
import { RannError } from "@rann/shared";
import { runTurn, type AgentConfig } from "./agent.js";
import { MemoryService } from "./memory.js";
import { SkillStore } from "./skills.js";
import type { ChatRequest, Provider, ProviderChunk } from "./providers/types.js";
import { listFileCheckpoints, restoreFileCheckpoint } from "./checkpoint-files.js";

class CaptureProvider implements Provider {
  readonly name = "capture";
  readonly kind = "mock";
  readonly requests: ChatRequest[] = [];

  async *chat(request: ChatRequest): AsyncGenerator<ProviderChunk, void, unknown> {
    this.requests.push(request);
    yield { type: "text", text: "selesai" };
    yield { type: "usage", inputTokens: 5, outputTokens: 2 };
    yield { type: "done", finishReason: "stop" };
  }
}

class PartialProvider implements Provider {
  readonly name = "partial";
  readonly kind = "mock";

  async *chat(_request: ChatRequest): AsyncGenerator<ProviderChunk, void, unknown> {
    yield { type: "text", text: "jawaban sebagian" };
    throw new RannError("E_STREAM_TRUNCATED", "stream terputus");
  }
}

class WritingProvider implements Provider {
  readonly name = "writer";
  readonly kind = "mock";
  private calls = 0;

  async *chat(_request: ChatRequest): AsyncGenerator<ProviderChunk, void, unknown> {
    this.calls += 1;
    if (this.calls === 1) {
      yield { type: "tool_call", id: "call_1", name: "fs_write", args: { path: "hasil.txt", content: "dibuat agent" } };
      yield { type: "usage", inputTokens: 5, outputTokens: 2 };
      yield { type: "done", finishReason: "tool_calls" };
      return;
    }
    yield { type: "text", text: "beres" };
    yield { type: "usage", inputTokens: 5, outputTokens: 2 };
    yield { type: "done", finishReason: "stop" };
  }
}

function setup(): { db: Db; close: () => void; project: string; profile: string } {
  const root = mkdtempSync(join(tmpdir(), "rann-agent-"));
  const project = join(root, "proyek");
  const profile = join(root, "profil");
  const { db } = openDatabase({ path: join(root, "rann.db") });
  return { db, close: () => db.close(), project, profile };
}

const config: AgentConfig = {
  permissionMode: "trusted",
  workspaceOnly: true,
  allow: [],
  deny: [],
  maxSteps: 4,
  systemExtra: ""
};

describe("runTurn dengan memori dan skill lokal", () => {
  it("menyisipkan memori relevan dan katalog skill ke system prompt", async () => {
    const { db, close, project, profile } = setup();
    try {
      addMemory(db, { text: "User memakai bahasa Indonesia", scope: "global", kind: "preference" });
      addMemory(db, { text: "Proyek ini memakai pnpm", projectPath: project, kind: "convention" });
      const skills = new SkillStore(profile, project);
      skills.create({
        name: "uji-agent",
        description: "Gunakan saat menguji agent dengan memori lokal",
        body: "1. Baca memori.\n2. Baca katalog skill.\n3. Jalankan tes.",
        scope: "project"
      });

      const session = createSession(db, { projectPath: project, model: "capture", permissionMode: "trusted" });
      const turn = createTurn(db, { sessionId: session.id });
      const provider = new CaptureProvider();
      const result = await runTurn({
        db,
        session,
        turnId: turn.id,
        userText: "tolong pakai pnpm",
        provider,
        model: "capture",
        workspaceRoot: project,
        config,
        memory: new MemoryService(db, project, { enabled: true, promptChars: 6_000, retrieve: 8 }),
        skills
      });

      expect(result.text).toBe("selesai");
      const system = provider.requests[0]?.messages[0]?.content ?? "";
      expect(system).toContain("MEMORI LOKAL");
      expect(system).toContain("User memakai bahasa Indonesia");
      expect(system).toContain("Proyek ini memakai pnpm");
      expect(system).toContain("SKILL LOKAL");
      expect(system).toContain("uji-agent");
      expect(system).toContain("debug-sistematis");
      const toolNames = provider.requests[0]?.tools?.map((tool) => tool.name) ?? [];
      expect(toolNames).toContain("memory");
      expect(toolNames).toContain("skill");
      expect(toolNames).not.toContain("task");
    } finally {
      close();
    }
  });

  it("menolak turn sebelum memanggil provider saat budget harian habis", async () => {
    const { db, close, project } = setup();
    try {
      const session = createSession(db, { projectPath: project, model: "capture", permissionMode: "trusted" });
      const turn = createTurn(db, { sessionId: session.id });
      recordUsage(db, {
        provider: "capture",
        model: "capture",
        sessionId: session.id,
        turnId: turn.id,
        inputTokens: 100,
        outputTokens: 0
      });
      const provider = new CaptureProvider();
      await expect(
        runTurn({
          db,
          session,
          turnId: turn.id,
          userText: "halo",
          provider,
          model: "capture",
          workspaceRoot: project,
          config,
          budget: { maxTokensPerTurn: 0, maxTokensPerDay: 1 }
        })
      ).rejects.toMatchObject({ code: "E_BUDGET_EXHAUSTED" });
      expect(provider.requests).toHaveLength(0);
    } finally {
      close();
    }
  });

  it("menyimpan teks parsial saat stream terputus", async () => {
    const { db, close, project } = setup();
    try {
      const session = createSession(db, { projectPath: project, model: "partial", permissionMode: "trusted" });
      const turn = createTurn(db, { sessionId: session.id });
      await expect(
        runTurn({
          db,
          session,
          turnId: turn.id,
          userText: "halo",
          provider: new PartialProvider(),
          model: "partial",
          workspaceRoot: project,
          config
        })
      ).rejects.toMatchObject({ code: "E_STREAM_TRUNCATED" });
      const messages = listMessages(db, session.id, 10);
      expect(messages.at(-1)).toMatchObject({ role: "assistant", content: "jawaban sebagian" });
    } finally {
      close();
    }
  });

  it("membuat checkpoint berkas otomatis sebelum tool mengubah workspace", async () => {
    const { db, close, project, profile } = setup();
    try {
      mkdirSync(project, { recursive: true });
      const checkpointsDir = join(profile, "checkpoints");
      mkdirSync(checkpointsDir, { recursive: true });
      writeFileSync(join(project, "awal.txt"), "isi awal", "utf8");

      const session = createSession(db, { projectPath: project, model: "writer", permissionMode: "trusted" });
      const turn = createTurn(db, { sessionId: session.id });
      const result = await runTurn({
        db,
        session,
        turnId: turn.id,
        userText: "halo",
        provider: new WritingProvider(),
        model: "writer",
        workspaceRoot: project,
        checkpointsDir,
        config
      });

      expect(result.text).toBe("beres");
      expect(readFileSync(join(project, "hasil.txt"), "utf8")).toBe("dibuat agent");
      const snapshots = listFileCheckpoints(checkpointsDir, 10, project);
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0]?.label).toBe("sebelum fs_write");

      writeFileSync(join(project, "awal.txt"), "diubah setelah snapshot", "utf8");
      restoreFileCheckpoint(project, checkpointsDir, snapshots[0]!.id, { force: true });
      expect(readFileSync(join(project, "awal.txt"), "utf8")).toBe("isi awal");
    } finally {
      close();
    }
  });
});
