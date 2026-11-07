import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

  it("membuat, mendaftar, dan memulihkan checkpoint berkas", async () => {
    const root = workspace();
    const cpDir = join(mkdtempSync(join(tmpdir(), "rann-cpdir-")), "checkpoints");
    mkdirSync(cpDir, { recursive: true });
    writeFileSync(join(root, "catatan.txt"), "versi awal", "utf8");
    const created = await executeTool("checkpoint_create", { label: "tes" }, context(root, { checkpointsDir: cpDir }));
    const id = (created.output as { id: string }).id;
    writeFileSync(join(root, "catatan.txt"), "versi rusak", "utf8");

    const list = await executeTool("checkpoint_list", {}, context(root, { checkpointsDir: cpDir }));
    expect((list.output as { checkpoints: Array<{ id: string }> }).checkpoints[0]?.id).toBe(id);

    const restored = await executeTool("checkpoint_restore", { id, force: true }, context(root, { checkpointsDir: cpDir }));
    expect(restored.ok).toBe(true);
    expect(readFileSync(join(root, "catatan.txt"), "utf8")).toBe("versi awal");
  });

  it("mengekspos spesifikasi tool untuk provider", () => {
    const names = toolSpecs().map((spec) => spec.name);
    expect(names).toEqual([
      "fs_read",
      "fs_list",
      "fs_write",
      "fs_edit",
      "fs_stat",
      "fs_glob",
      "fs_delete",
      "git_read",
      "git_write",
      "checkpoint_create",
      "checkpoint_list",
      "checkpoint_restore",
      "shell_run",
      "memory",
      "skill",
      "task"
    ]);
  });

  it("menolak menulis bila hash berkas berubah", async () => {
    const root = workspace();
    writeFileSync(join(root, "a.txt"), "awal", "utf8");
    const first = await executeTool("fs_read", { path: "a.txt" }, context(root));
    const hash = (first.output as { sha256: string }).sha256;
    writeFileSync(join(root, "a.txt"), "diubah user", "utf8");
    await expect(
      executeTool("fs_write", { path: "a.txt", content: "baru", expected_sha256: hash }, context(root))
    ).rejects.toMatchObject({ code: "E_FILE_CHANGED" });
    expect(readFileSync(join(root, "a.txt"), "utf8")).toBe("diubah user");
  });

  it("memindahkan berkas ke trash dan menemukan berkas lewat glob", async () => {
    const root = workspace();
    await executeTool("fs_write", { path: "src/a.ts", content: "export {};" }, context(root));
    await executeTool("fs_write", { path: "dist/b.ts", content: "x" }, context(root));
    const glob = await executeTool("fs_glob", { pattern: "**/*.ts" }, context(root));
    expect((glob.output as { paths: string[] }).paths).toEqual(["src/a.ts"]);

    const removed = await executeTool("fs_delete", { path: "src/a.ts" }, context(root));
    const trash = (removed.output as { trash_path: string }).trash_path;
    expect(trash.startsWith(".rann/trash/")).toBe(true);
    expect(readFileSync(join(root, trash), "utf8")).toBe("export {};");
  });

  it("menolak berkas biner", async () => {
    const root = workspace();
    writeFileSync(join(root, "gambar.bin"), Buffer.from([0, 1, 2, 3]));
    await expect(executeTool("fs_read", { path: "gambar.bin" }, context(root))).rejects.toMatchObject({ code: "E_TOOL_FAILED" });
  });

  it("membaca status git dan commit dengan trailer sesi", async () => {
    const root = workspace();
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["config", "user.email", "uji@example.com"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Uji"], { cwd: root });
    writeFileSync(join(root, "a.txt"), "awal", "utf8");
    const status = await executeTool("git_read", { action: "status" }, context(root));
    expect((status.output as { stdout: string }).stdout).toContain("a.txt");

    const staged = await executeTool("git_write", { action: "stage", paths: ["a.txt"] }, context(root, { sessionId: "ses_uji" }));
    expect(staged.ok).toBe(true);
    const committed = await executeTool(
      "git_write",
      { action: "commit", message: "tambah a" },
      context(root, { sessionId: "ses_uji" })
    );
    expect(committed.ok).toBe(true);
    const log = await executeTool("git_read", { action: "log", limit: 1 }, context(root));
    expect((log.output as { stdout: string }).stdout).toContain("tambah a");

    const body = execFileSync("git", ["log", "-1", "--pretty=%B"], { cwd: root, encoding: "utf8" });
    expect(body).toContain("Rann-Code-Session: ses_uji");
  });

  it("menolak commit saat masih ada konflik", async () => {
    const root = workspace();
    execFileSync("git", ["init", "-q"], { cwd: root });
    execFileSync("git", ["config", "user.email", "uji@example.com"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Uji"], { cwd: root });
    writeFileSync(join(root, "a.txt"), "awal", "utf8");
    execFileSync("git", ["add", "-A"], { cwd: root });
    execFileSync("git", ["commit", "-qm", "awal"], { cwd: root });
    execFileSync("git", ["checkout", "-qb", "lain"], { cwd: root });
    writeFileSync(join(root, "a.txt"), "versi lain", "utf8");
    execFileSync("git", ["commit", "-qam", "lain"], { cwd: root });
    execFileSync("git", ["checkout", "-q", "-"], { cwd: root });
    writeFileSync(join(root, "a.txt"), "versi utama", "utf8");
    execFileSync("git", ["commit", "-qam", "utama"], { cwd: root });
    try {
      execFileSync("git", ["merge", "lain"], { cwd: root, stdio: "ignore" });
    } catch {
      // merge sengaja gagal dan meninggalkan konflik
    }
    await expect(
      executeTool("git_write", { action: "commit", message: "gabung" }, context(root, { sessionId: "ses_uji" }))
    ).rejects.toMatchObject({ code: "E_TOOL_FAILED" });
  });

  it("tidak mewariskan env sensitif ke shell", async () => {
    const root = workspace();
    process.env.RANN_TEST_SECRET = "jangan-bocor";
    try {
      const result = await executeTool("shell_run", { command: "printf '%s' \"${RANN_TEST_SECRET:-kosong}\"" }, context(root));
      expect((result.output as { stdout: string }).stdout).toBe("kosong");
    } finally {
      delete process.env.RANN_TEST_SECRET;
    }
  });
});
