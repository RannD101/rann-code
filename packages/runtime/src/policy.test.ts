import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertAllowed, decide, isDangerousShell, resolveInsideWorkspace } from "./policy.js";
import { RannError } from "@rann/shared";

describe("policy", () => {
  it("read-only hanya mengizinkan baca", () => {
    expect(decide({ mode: "read-only", tool: "fs_read", risk: "read" })).toBe("allow");
    expect(decide({ mode: "read-only", tool: "fs_write", risk: "write" })).toBe("deny");
    expect(decide({ mode: "read-only", tool: "shell_run", risk: "exec" })).toBe("deny");
  });

  it("ask menunggu persetujuan untuk tulis dan eksekusi", () => {
    expect(decide({ mode: "ask", tool: "fs_write", risk: "write" })).toBe("ask");
    expect(decide({ mode: "ask", tool: "fs_write", risk: "write", approved: true })).toBe("allow");
    expect(decide({ mode: "ask", tool: "fs_read", risk: "read" })).toBe("allow");
  });

  it("accept-edits mengizinkan tulis tetapi tetap bertanya untuk shell", () => {
    expect(decide({ mode: "accept-edits", tool: "fs_write", risk: "write" })).toBe("allow");
    expect(decide({ mode: "accept-edits", tool: "shell_run", risk: "exec" })).toBe("ask");
  });

  it("trusted mengizinkan semua kecuali yang diblokir", () => {
    expect(decide({ mode: "trusted", tool: "shell_run", risk: "exec", command: "git status" })).toBe("allow");
    expect(decide({ mode: "trusted", tool: "shell_run", risk: "exec", command: "rm -rf /" })).toBe("deny");
  });

  it("aturan deny menang atas allow dan mode", () => {
    expect(
      decide({
        mode: "trusted",
        tool: "shell_run",
        risk: "exec",
        command: "git push origin main",
        deny: ["shell_run:git push*"]
      })
    ).toBe("deny");
    expect(
      decide({
        mode: "read-only",
        tool: "fs_write",
        risk: "write",
        allow: ["fs_write:*"]
      })
    ).toBe("allow");
  });

  it("mengenali perintah shell berbahaya", () => {
    for (const command of ["rm -rf /", "mkfs.ext4 /dev/sda1", "dd if=x of=/dev/sda", "shutdown -h now", "git push origin main"]) {
      expect(isDangerousShell(command)).toBe(true);
    }
    expect(isDangerousShell("git status")).toBe(false);
    expect(isDangerousShell("rm -rf ./dist")).toBe(false);
  });

  it("assertAllowed melempar kode yang tepat", () => {
    try {
      assertAllowed({ mode: "ask", tool: "fs_write", risk: "write" });
      throw new Error("seharusnya gagal");
    } catch (error) {
      expect((error as RannError).code).toBe("E_APPROVAL_REQUIRED");
    }
    try {
      assertAllowed({ mode: "read-only", tool: "fs_write", risk: "write" });
      throw new Error("seharusnya gagal");
    } catch (error) {
      expect((error as RannError).code).toBe("E_PERMISSION");
    }
  });

  it("menjaga path tetap di dalam workspace", () => {
    const root = mkdtempSync(join(tmpdir(), "rann-policy-"));
    expect(resolveInsideWorkspace("src/a.ts", { workspaceRoot: root, workspaceOnly: true })).toBe(join(root, "src/a.ts"));
    expect(() => resolveInsideWorkspace("../luar.txt", { workspaceRoot: root, workspaceOnly: true })).toThrowError(RannError);
    expect(resolveInsideWorkspace("../luar.txt", { workspaceRoot: root, workspaceOnly: false })).toBe(join(root, "..", "luar.txt"));
  });
});
