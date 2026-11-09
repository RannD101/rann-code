import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSession, createTurn, openDatabase } from "@rann/storage";
import { runTurn, type AgentConfig } from "./agent.js";
import { prepareAttachments } from "./attachments.js";
import type { ChatRequest, Provider, ProviderChunk } from "./providers/types.js";

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

class Capture implements Provider {
  readonly name = "capture";
  readonly kind = "mock";
  readonly support = { embed: false, listModels: false, health: false, countTokens: true };
  requests: ChatRequest[] = [];
  stream(request: ChatRequest): AsyncGenerator<ProviderChunk, void, unknown> {
    return this.chat(request);
  }
  async *chat(request: ChatRequest): AsyncGenerator<ProviderChunk, void, unknown> {
    this.requests.push(request);
    yield { type: "text", text: "ok" };
    yield { type: "usage", inputTokens: 2, outputTokens: 1 };
    yield { type: "done", finishReason: "stop" };
  }
}

const config: AgentConfig = {
  permissionMode: "trusted",
  workspaceOnly: true,
  allow: [],
  deny: [],
  maxSteps: 2,
  systemExtra: ""
};

function setup(bytes: Buffer): { root: string; db: ReturnType<typeof openDatabase>["db"]; session: ReturnType<typeof createSession>; turn: ReturnType<typeof createTurn>; attachment: ReturnType<typeof prepareAttachments>[number] } {
  const root = mkdtempSync(join(tmpdir(), "rann-ac-multi-"));
  writeFileSync(join(root, "gambar.png"), bytes);
  const { db } = openDatabase({ path: join(root, "rann.db") });
  const session = createSession(db, { projectPath: root, model: "capture", permissionMode: "trusted" });
  const turn = createTurn(db, { sessionId: session.id });
  const [attachment] = prepareAttachments([{ path: "gambar.png" }], root, join(root, "artifacts"));
  return { root, db, session, turn, attachment: attachment! };
}

describe("acceptance multimodal", () => {
  it("AC-019 gambar 2 MB dikirim sebagai lampiran, bukan base64 di teks", async () => {
    const bytes = Buffer.concat([Buffer.from(PNG, "base64"), Buffer.alloc(2 * 1024 * 1024)]);
    const { root, db, session, turn, attachment } = setup(bytes);
    const provider = new Capture();
    await runTurn({
      db,
      session,
      turnId: turn.id,
      userText: "jelaskan gambar",
      provider,
      model: "capture-1",
      workspaceRoot: root,
      attachments: [attachment],
      modelCapabilities: { streaming: true, toolCalling: true, parallelToolCalls: true, structuredOutput: true, strictSchema: true, reasoning: false, vision: true, audio: false, pdf: false, promptCaching: false, embeddings: false },
      config
    });
    const user = provider.requests[0]?.messages.find((message) => message.role === "user");
    expect(user?.attachments?.length).toBe(1);
    expect(user?.content).not.toContain("base64");
  });

  it("AC-108 model tanpa vision menolak gambar dengan pesan jelas", async () => {
    const bytes = Buffer.from(PNG, "base64");
    const { root, db, session, turn, attachment } = setup(bytes);
    const provider = new Capture();
    await runTurn({
      db,
      session,
      turnId: turn.id,
      userText: "jelaskan gambar",
      provider,
      model: "capture-1",
      workspaceRoot: root,
      attachments: [attachment],
      modelCapabilities: { streaming: true, toolCalling: true, parallelToolCalls: true, structuredOutput: true, strictSchema: true, reasoning: false, vision: false, audio: false, pdf: false, promptCaching: false, embeddings: false },
      config
    });
    const user = provider.requests[0]?.messages.find((message) => message.role === "user");
    expect(user?.content).toContain("tanpa capability vision");
    expect(user?.attachments).toBeUndefined();
  });
});
