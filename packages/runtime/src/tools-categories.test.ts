import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { executeTool, type ToolContext } from "./tools/index.js";

const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function root(): string {
  return mkdtempSync(join(tmpdir(), "rann-kategori-"));
}

function ctx(path: string, patch: Partial<ToolContext> = {}): ToolContext {
  return { workspaceRoot: path, workspaceOnly: true, permissionMode: "trusted", approved: false, ...patch };
}

describe("kategori tool image", () => {
  it("membaca metadata PNG tanpa OCR", async () => {
    const dir = root();
    writeFileSync(join(dir, "titik.png"), Buffer.from(PNG_1X1, "base64"));
    const result = await executeTool("image_info", { path: "titik.png" }, ctx(dir));
    const output = result.output as { width?: number; height?: number; format?: string };
    expect(output.format).toBe("png");
    expect(output.width).toBe(1);
    expect(output.height).toBe(1);
  });
});

describe("kategori tool package", () => {
  it("menolak flag registry yang bisa mengalihkan sumber paket", async () => {
    const dir = root();
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "uji", version: "1.0.0" }));
    await expect(
      executeTool("package_run", { manager: "npm", args: ["install", "--registry=http://jahat.test"] }, ctx(dir))
    ).rejects.toMatchObject({ code: "E_PERMISSION" });
  });
});

describe("kategori tool scheduling", () => {
  it("meneruskan prompt ke antrean dengan prioritas", async () => {
    const dir = root();
    const calls: unknown[] = [];
    const result = await executeTool(
      "schedule_task",
      { text: "ringkas laporan", priority: 40, delay_seconds: 5 },
      ctx(dir, { scheduleTask: async (input) => (calls.push(input), { id: "job_1" }) })
    );
    expect(calls).toHaveLength(1);
    expect((result.output as { id: string }).id).toBe("job_1");
  });
});
