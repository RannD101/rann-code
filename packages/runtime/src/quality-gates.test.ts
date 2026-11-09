import { existsSync, linkSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createSession, createSubagent, createTurn, markOrphanedSubagents, openDatabase } from "@rann/storage";
import { validateJsonSchema } from "./json-schema.js";
import { executeTool, withToolTimeout, type ToolContext } from "./tools/index.js";
import { runTurn, type AgentConfig } from "./agent.js";
import type { ChatRequest, Provider, ProviderChunk } from "./providers/types.js";

const config: AgentConfig = {
  permissionMode: "trusted",
  workspaceOnly: true,
  allow: [],
  deny: [],
  maxSteps: 3,
  systemExtra: ""
};

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "rann-quality-"));
}

function context(root: string, patch: Partial<ToolContext> = {}): ToolContext {
  return { workspaceRoot: root, workspaceOnly: true, permissionMode: "trusted", approved: false, ...patch };
}

class TextProvider implements Provider {
  readonly name = "teks";
  readonly kind = "mock";
  readonly support = { embed: false, listModels: false, health: false, countTokens: true };
  stream(request: ChatRequest): AsyncGenerator<ProviderChunk, void, unknown> {
    return this.chat(request);
  }
  async *chat(_request: ChatRequest): AsyncGenerator<ProviderChunk, void, unknown> {
    yield { type: "text", text: "ini bukan json" };
    yield { type: "usage", inputTokens: 3, outputTokens: 2 };
    yield { type: "done", finishReason: "stop" };
  }
}

describe("validator JSON Schema", () => {
  it("menerima objek valid dan melaporkan field wajib yang hilang", () => {
    const schema = {
      type: "object",
      required: ["status", "items"],
      properties: { status: { type: "number" }, items: { type: "array", items: { type: "string" } } }
    };
    expect(validateJsonSchema({ status: 200, items: ["a"] }, schema)).toEqual([]);
    expect(validateJsonSchema({ items: ["a", 2] }, schema).join(" ")).toContain("status wajib ada");
    expect(validateJsonSchema({ status: 200, items: ["a", 2] }, schema).join(" ")).toContain("items[1] harus string");
  });

  it("menolak tipe dan properti tambahan yang tidak diizinkan", () => {
    expect(validateJsonSchema("x", { type: "object" })).toEqual(["$ harus object"]);
    expect(validateJsonSchema({ a: 1 }, { type: "object", properties: {}, additionalProperties: false })).toEqual([
      "$.a tidak diizinkan"
    ]);
  });
});

describe("penjagaan eksekusi tool", () => {
  it("menegakkan timeout per tool", async () => {
    await expect(
      withToolTimeout("lambat", 20, context(workspace()), async () => new Promise((resolve) => setTimeout(resolve, 500)))
    ).rejects.toMatchObject({ code: "E_TOOL_TIMEOUT" });
  });

  it("menolak hardlink yang bisa menunjuk ke luar workspace", async () => {
    const root = workspace();
    const outside = join(mkdtempSync(join(tmpdir(), "rann-outside-")), "rahasia.txt");
    writeFileSync(outside, "isi luar");
    linkSync(outside, join(root, "tertaut.txt"));
    await expect(
      executeTool("fs_write", { path: "tertaut.txt", content: "diubah" }, context(root))
    ).rejects.toMatchObject({ code: "E_PERMISSION" });
  });

  it("memaksa persetujuan untuk aksi tulis setelah konten web", async () => {
    await expect(
      executeTool("fs_write", { path: "catatan.txt", content: "x" }, context(workspace(), { untrusted: true }))
    ).rejects.toMatchObject({ code: "E_APPROVAL_REQUIRED", data: { provenance: "untrusted_content" } });
  });

  it("mencatat alasan pemilihan browser", async () => {
    const decisions: Array<{ tool: string; reason: string }> = [];
    await expect(
      executeTool(
        "browser",
        { action: "navigate", url: "https://example.com" },
        context(workspace(), { recordDecision: (input) => decisions.push(input) })
      )
    ).rejects.toMatchObject({ code: "E_TOOL_FAILED" });
    expect(decisions[0]?.tool).toBe("browser");
    expect(decisions[0]?.reason).toContain("JavaScript");
  });
});

describe("structured output", () => {
  it("menandai balasan yang tidak memenuhi schema setelah satu percobaan ulang", async () => {
    const root = workspace();
    const { db } = openDatabase({ path: join(root, "rann.db") });
    const session = createSession(db, { projectPath: root, model: "teks", permissionMode: "trusted" });
    const turn = createTurn(db, { sessionId: session.id });
    const result = await runTurn({
      db,
      session,
      turnId: turn.id,
      userText: "balas json",
      provider: new TextProvider(),
      model: "teks-1",
      workspaceRoot: root,
      config,
      responseSchema: { type: "object", required: ["ok"] }
    });
    expect(result.text).toContain("[skema tidak terpenuhi");
    expect(result.steps).toBeGreaterThanOrEqual(2);
    const errorEvents = db
      .prepare("SELECT payload_json FROM events WHERE type = 'error' AND payload_json LIKE '%E_OUTPUT_INVALID%'")
      .all();
    expect(errorEvents.length).toBe(2);
  });
});

describe("generasi kerangka tes", () => {
  it("mendeteksi vitest dan membuat berkas tes tanpa menimpa", async () => {
    const root = workspace();
    writeFileSync(join(root, "package.json"), JSON.stringify({ devDependencies: { vitest: "^2.0.0" } }));
    writeFileSync(join(root, "hitung.ts"), "export const satu = 1;\n");
    const result = await executeTool("test_generate", { path: "hitung.ts" }, context(root));
    const output = result.output as { path: string; framework: string };
    expect(output.framework).toBe("vitest");
    expect(output.path).toBe("hitung.test.ts");
    expect(readFileSync(join(root, "hitung.test.ts"), "utf8")).toContain('from "vitest"');
    await expect(executeTool("test_generate", { path: "hitung.ts" }, context(root))).rejects.toMatchObject({
      code: "E_CONFLICT"
    });
  });

  it("membuat kerangka pytest saat proyek Python", async () => {
    const root = workspace();
    writeFileSync(join(root, "pyproject.toml"), "[tool.pytest.ini_options]\n");
    writeFileSync(join(root, "kalkulator.py"), "def tambah(a, b):\n    return a + b\n");
    const result = await executeTool("test_generate", { path: "kalkulator.py" }, context(root));
    const output = result.output as { path: string; framework: string };
    expect(output.framework).toBe("pytest");
    expect(existsSync(join(root, output.path))).toBe(true);
    expect(readFileSync(join(root, output.path), "utf8")).toContain("pytest.skip");
  });
});

describe("status subagent", () => {
  it("memakai starting lalu orphaned, bukan failed", () => {
    const root = workspace();
    const { db } = openDatabase({ path: join(root, "rann.db") });
    const session = createSession(db, { projectPath: root, model: "x", permissionMode: "trusted" });
    const agent = createSubagent(db, { sessionId: session.id, profile: "coder", goal: "uji", depth: 1, path: "0" });
    expect(agent.status).toBe("starting");
    const ids = markOrphanedSubagents(db, -1);
    expect(ids).toContain(agent.id);
    const row = db.prepare("SELECT status FROM agents WHERE id = ?").get(agent.id) as { status: string };
    expect(row.status).toBe("orphaned");
  });
});

