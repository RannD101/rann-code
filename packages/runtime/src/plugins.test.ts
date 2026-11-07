import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PluginManager, PLUGIN_API_VERSION, satisfiesApiRange, validateManifest } from "./plugins.js";

function temp(): string {
  return mkdtempSync(join(tmpdir(), "rann-plugin-"));
}

function makePlugin(root: string, name = "contoh", options: { apiVersion?: string; dependencies?: string[]; version?: string } = {}): string {
  const dir = join(root, "src", name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify({
      name,
      version: options.version ?? "1.0.0",
      apiVersion: options.apiVersion ?? "^1.0.0",
      entry: "index.js",
      permissions: ["tool:register"],
      ...(options.dependencies ? { dependencies: options.dependencies } : {}),
      hooks: { PostToolUse: "hook" },
      tools: [{ name: "contoh_tool", description: "contoh" }]
    })
  );
  writeFileSync(join(dir, "index.js"), `process.stdin.on("data", () => {});`);
  return dir;
}

describe("satisfiesApiRange", () => {
  it("mendukung caret, tilde, perbandingan, dan OR", () => {
    expect(satisfiesApiRange("^1.0.0")).toBe(true);
    expect(satisfiesApiRange("~1.0.0")).toBe(true);
    expect(satisfiesApiRange(">=1.0.0 <2.0.0")).toBe(true);
    expect(satisfiesApiRange("^2.0.0")).toBe(false);
    expect(satisfiesApiRange("^2.0.0 || ^1.0.0")).toBe(true);
    expect(satisfiesApiRange("*")).toBe(true);
    expect(PLUGIN_API_VERSION).toBe("1.0.0");
  });
});

describe("validateManifest", () => {
  it("menolak nama dan entry berbahaya", () => {
    expect(() => validateManifest({ name: "Nama Besar", version: "1.0.0", apiVersion: "^1.0.0", entry: "index.js", permissions: [] })).toThrow();
    expect(() => validateManifest({ name: "aman", version: "1.0.0", apiVersion: "^1.0.0", entry: "../evil.js", permissions: [] })).toThrow();
    expect(() => validateManifest({ name: "aman", version: "1.0.0", apiVersion: "^2.0.0", entry: "index.js", permissions: [] })).toThrow(/API/);
  });
});

describe("PluginManager", () => {
  it("memasang plugin nonaktif lalu bisa diaktifkan", () => {
    const home = temp();
    const project = temp();
    const source = makePlugin(temp());
    const manager = new PluginManager(home, project);
    const installed = manager.installFolder(source, { scope: "project" });
    expect(installed.status).toBe("installed");
    expect(installed.permissions).toEqual(["tool:register"]);
    const enabled = manager.enable("contoh");
    expect(enabled.status).toBe("enabled");
    const disabled = manager.disable("contoh");
    expect(disabled.status).toBe("disabled");
  });

  it("menolak nama bentrok dan dependensi hilang", () => {
    const home = temp();
    const project = temp();
    const source = makePlugin(temp());
    const manager = new PluginManager(home, project);
    manager.installFolder(source, { scope: "project" });
    expect(() => manager.installFolder(source, { scope: "project" })).toThrow(/sudah terdaftar/);
    const dependent = makePlugin(temp(), "butuh", { dependencies: ["hilang"] });
    manager.installFolder(dependent, { scope: "project" });
    expect(() => manager.enable("butuh")).toThrow(/Dependensi plugin hilang/);
  });

  it("menandai plugin rusak sebagai error tanpa menjatuhkan manager", () => {
    const home = temp();
    const project = temp();
    const source = makePlugin(temp());
    const manager = new PluginManager(home, project);
    manager.installFolder(source, { scope: "project" });
    manager.markError("contoh", "crash saat aktivasi");
    const plugin = manager.get("contoh");
    expect(plugin?.status).toBe("error");
    expect(plugin?.last_error).toContain("crash");
    manager.enable("contoh");
    expect(manager.get("contoh")?.status).toBe("enabled");
  });

  it("rollback memulihkan versi sebelumnya", () => {
    const home = temp();
    const project = temp();
    const manager = new PluginManager(home, project);
    const v1 = makePlugin(temp(), "roll", { version: "1.0.0" });
    manager.installFolder(v1, { scope: "project" });
    manager.update("roll");
    const v2 = makePlugin(temp(), "roll", { version: "2.0.0" });
    manager.installFolder(v2, { scope: "project", overwrite: true });
    expect(manager.get("roll")?.version).toBe("2.0.0");
    const restored = manager.rollback("roll");
    expect(restored.version).toBe("1.0.0");
  });

  it("remove menghapus folder dan state", () => {
    const home = temp();
    const project = temp();
    const source = makePlugin(temp());
    const manager = new PluginManager(home, project);
    const installed = manager.installFolder(source, { scope: "project" });
    expect(existsSync(installed.path)).toBe(true);
    expect(manager.remove("contoh").removed).toBe(true);
    expect(manager.get("contoh")).toBeUndefined();
    expect(existsSync(installed.path)).toBe(false);
  });
});
