import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PluginManager } from "./plugins.js";

function temp(): string {
  return mkdtempSync(join(tmpdir(), "rann-plugin-gate-"));
}

function makePlugin(
  root: string,
  name: string,
  options: { permissions?: string[]; dependencies?: string[]; version?: string; changelog?: string } = {}
): string {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({
      name,
      version: options.version ?? "1.0.0",
      apiVersion: "^1.0.0",
      entry: "index.js",
      permissions: options.permissions ?? ["tool:register", "hook:register", "command:register"],
      ...(options.dependencies ? { dependencies: options.dependencies } : {}),
      ...(options.changelog ? { changelog: options.changelog } : {}),
      hooks: { PostToolUse: "after" },
      tools: [{ name: `${name}_tool`, description: "contoh" }],
      commands: [{ name: `${name}_cmd` }]
    })
  );
  writeFileSync(
    join(dir, "index.js"),
    'process.stdin.on("data", (chunk) => { const req = JSON.parse(String(chunk)); process.stdout.write(JSON.stringify({ result: req.method }) + "\\n"); });'
  );
  return dir;
}

function manager(): PluginManager {
  return new PluginManager(temp(), temp());
}

describe("urutan dan registrasi plugin", () => {
  it("memuat plugin sesuai dependensi, bukan urutan instalasi", () => {
    const m = manager();
    const source = temp();
    m.installFolder(makePlugin(source, "c", { dependencies: ["b"] }), { scope: "project" });
    m.installFolder(makePlugin(source, "b", { dependencies: ["a"] }), { scope: "project" });
    m.installFolder(makePlugin(source, "a"), { scope: "project" });
    for (const name of ["a", "b", "c"]) m.enable(name);
    expect(m.enabledInOrder()).toEqual(["a", "b", "c"]);
  });

  it("menolak siklus dependensi saat plugin diaktifkan", () => {
    const m = manager();
    const source = temp();
    m.installFolder(makePlugin(source, "x", { dependencies: ["y"] }), { scope: "project" });
    m.installFolder(makePlugin(source, "y", { dependencies: ["x"] }), { scope: "project" });
    m.enable("x");
    m.enable("y");
    expect(() => m.enabledInOrder()).toThrow(/Siklus dependensi/);
  });

  it("mendaftarkan tool, command, dan hook dari plugin aktif", () => {
    const m = manager();
    const source = temp();
    m.installFolder(makePlugin(source, "reg"), { scope: "project" });
    expect(m.registrations()).toEqual({ tools: [], commands: [], hooks: [], providers: [] });
    m.enable("reg");
    const reg = m.registrations();
    expect(reg.tools.map((entry) => entry.name)).toEqual(["reg_tool"]);
    expect(reg.commands.map((entry) => entry.name)).toEqual(["reg_cmd"]);
    expect(reg.hooks[0]).toMatchObject({ event: "PostToolUse", method: "after" });
  });
});

describe("izin dan update plugin", () => {
  it("menolak method yang izinnya tidak dideklarasikan", async () => {
    const m = manager();
    const source = temp();
    m.installFolder(makePlugin(source, "aman", { permissions: ["tool:register"] }), { scope: "project" });
    m.enable("aman");
    const blocked = await m.invoke("aman", "fs.write", { path: "a" });
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toContain("izin fs:write");
    const allowed = await m.invoke("aman", "ping", {});
    expect(allowed.ok).toBe(true);
  });

  it("meminta konfirmasi saat update menambah izin dan menampilkan changelog", () => {
    const m = manager();
    const source = temp();
    m.installFolder(makePlugin(source, "up", { permissions: ["tool:register"] }), { scope: "project" });
    const next = makePlugin(temp(), "up", {
      permissions: ["tool:register", "net:fetch"],
      version: "1.1.0",
      changelog: "Menambah akses jaringan untuk sinkronisasi."
    });
    const preview = m.previewUpdate("up", next);
    expect(preview.requiresConfirmation).toBe(true);
    expect(preview.addedPermissions).toEqual(["net:fetch"]);
    expect(preview.changelog).toContain("sinkronisasi");
    expect(() => m.update("up", next)).toThrow(/menambah izin/);
    const updated = m.update("up", next, { approve: true });
    expect(updated.version).toBe("1.1.0");
    expect(updated.permissions).toContain("net:fetch");
  });
});
