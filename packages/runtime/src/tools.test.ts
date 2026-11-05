import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { executeTool, toolSpecs, type ToolContext } from "./tools/index.js";

function workspace(): string {
  return mkdtempSync(join(tmpdir(), "rann-tools-"));
}

function context(root: string, patch: Partial<ToolContext> = {}): ToolContext {
  return {
    workspaceRoot: root,
    workspaceOnly: true,
    permissionMode: "trusted",
    approved: false,
    shellTimeoutMs: 20_000,
    ...patch
  };
}

describe("tools", () => {
  it("menulis, membaca, mengedit, dan mendaftar berkas", async () => {
    const root = workspace();
    const write = await executeTool("fs_write", { path: "src/halo.txt", content: "baris satu\nbaris dua\n" }, context(root));
    expect(write.ok).toBe(true);
    expect(readFileSync(join(root, "src/halo.txt"), "utf8")).toBe("baris satu\nbaris dua\n");

    const read = await executeTool("fs_read", { path: "src/halo.txt", offset: 2, limit: 1 }, context(root));
    expect(read.ok).toBe(true);
    const readOutput = read.output as { content: string; total_lines: number };
    expect(readOutput.content).toBe("baris dua");
    expect(readOutput.total_lines).toBe(3);

    const edit = await executeTool("fs_edit", { path: "src/halo.txt", old: "satu", new: "1" }, context(root));
    expect(edit.ok).toBe(true);
    expect(readFileSync(join(root, "src/halo.txt"), "utf8")).toContain("baris 1");

    const list = await executeTool("fs_list", { path: ".", depth: 2 }, context(root));
    const listed = (list.output as { entries: Array<{ path: string; type: string }> }).entries;
    expect(listed.some((entry) => entry.path === "src/halo.txt" && entry.type === "file")).toBe(true);
  });

  it("menolak path keluar workspace", async () => {
    const root = workspace();
    await expect(executeTool("fs_write", { path: "../luar.txt", content: "x" }, context(root))).rejects.toMatchObject({
      code: "E_PERMISSION"
    });
  });

  it("read-only menolak tulisan", async () => {
    const root = workspace();
    await expect(
      executeTool("fs_write", { path: "a.txt", content: "x" }, context(root, { permissionMode: "read-only" }))
    ).rejects.toMatchObject({ code: "E_PERMISSION" });
  });

  it("mode ask butuh approved", async () => {
    const root = workspace();
    await expect(executeTool("fs_write", { path: "a.txt", content: "x" }, context(root, { permissionMode: "ask" }))).rejects.toMatchObject({
      code: "E_APPROVAL_REQUIRED"
    });
    const allowed = await executeTool(
      "fs_write",
      { path: "a.txt", content: "x" },
      context(root, { permissionMode: "ask", approved: true })
    );
    expect(allowed.ok).toBe(true);
  });

  it("menjalankan shell dan menangkap keluaran", async () => {
    const root = workspace();
    const result = await executeTool("shell_run", { command: "printf 'halo-shell'" }, context(root));
    expect(result.ok).toBe(true);
    expect((result.output as { stdout: string }).stdout).toBe("halo-shell");
    expect(result.exitCode).toBe(0);
  });

  it("menolak perintah shell berbahaya dan melaporkan exit code", async () => {
    const root = workspace();
    await expect(executeTool("shell_run", { command: "rm -rf /" }, context(root))).rejects.toMatchObject({ code: "E_PERMISSION" });
    const failed = await executeTool("shell_run", { command: "exit 3" }, context(root));
    expect(failed.ok).toBe(false);
    expect(failed.exitCode).toBe(3);
  });

  it("memvalidasi argumen dan tool tak dikenal", async () => {
    const root = workspace();
    await expect(executeTool("fs_read", {}, context(root))).rejects.toMatchObject({ code: "E_TOOL_INVALID_ARGS" });
    await expect(executeTool("tidak_ada", {}, context(root))).rejects.toMatchObject({ code: "E_TOOL_NOT_FOUND" });
  });

  it("mengekspos spesifikasi tool untuk provider", () => {
    const names = toolSpecs().map((spec) => spec.name);
    expect(names).toEqual(["fs_read", "fs_list", "fs_write", "fs_edit", "shell_run", "memory", "skill", "task"]);
  });
});
