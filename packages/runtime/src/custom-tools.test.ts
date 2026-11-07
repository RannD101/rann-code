import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadCustomTools, runCustomTool } from "./custom-tools.js";

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "rann-tools-"));
}

describe("tool kustom", () => {
  it("memuat manifest perintah CLI dan menjalankannya dengan JSON", async () => {
    const root = workspace();
    mkdirSync(join(root, ".rann", "tools"), { recursive: true });
    writeFileSync(join(root, ".rann", "tools", "echo.json"), JSON.stringify({
      name: "echo_json",
      description: "Mengembalikan input",
      command: process.execPath,
      args: ["-e", "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>console.log(JSON.stringify({got:JSON.parse(d)})))"],
      permission: "read",
      timeout_ms: 5_000,
      schema: { type: "object", properties: { text: { type: "string" } }, additionalProperties: false }
    }));
    const loaded = await loadCustomTools(root);
    expect(loaded.errors).toEqual([]);
    expect(loaded.tools[0]?.name).toBe("echo_json");
    const result = await runCustomTool(loaded.tools[0]!, { text: "halo" }, { workspaceRoot: root });
    expect(result).toMatchObject({ ok: true, output: { got: { text: "halo" } } });
  });

  it("memuat modul TypeScript dan menolak skema tidak valid", async () => {
    const root = workspace();
    const dir = join(root, ".rann", "tools");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "tambah.ts"), [
      "export const meta = { name: 'tambah_dua', description: 'Menambah dua angka', permission: 'read' as const, timeout_ms: 2000 };",
      "export const schema = { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } }, required: ['a', 'b'] };",
      "export default async function (input: { a: number; b: number }) { return { hasil: input.a + input.b }; }"
    ].join("\n"));
    writeFileSync(join(dir, "rusak.json"), JSON.stringify({ name: "rusak", description: "x", command: "echo", schema: { type: "string" } }));
    const loaded = await loadCustomTools(root);
    expect(loaded.tools.map((tool) => tool.name)).toContain("tambah_dua");
    expect(loaded.errors).toHaveLength(1);
    const result = await runCustomTool(loaded.tools.find((tool) => tool.name === "tambah_dua")!, { a: 2, b: 3 }, { workspaceRoot: root });
    expect(result.output).toEqual({ hasil: 5 });
  });

  it("menandai timeout dan output bukan JSON", async () => {
    const root = workspace();
    const dir = join(root, ".rann", "tools");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "lambat.json"), JSON.stringify({ name: "lambat_tool", description: "Tidur", command: process.execPath, args: ["-e", "setTimeout(()=>{},5000)"], permission: "read", timeout_ms: 1000, schema: { type: "object", properties: {} } }));
    writeFileSync(join(dir, "bukan.json"), JSON.stringify({ name: "bukan_json_tool", description: "Bukan JSON", command: process.execPath, args: ["-e", "console.log('halo')"], permission: "read", timeout_ms: 2000, schema: { type: "object", properties: {} } }));
    const loaded = await loadCustomTools(root);
    const slow = await runCustomTool(loaded.tools.find((tool) => tool.name === "lambat_tool")!, {}, { workspaceRoot: root });
    expect(slow.code).toBe("E_TOOL_TIMEOUT");
    const bad = await runCustomTool(loaded.tools.find((tool) => tool.name === "bukan_json_tool")!, {}, { workspaceRoot: root });
    expect(bad.code).toBe("E_TOOL_FAILED");
  });
});
