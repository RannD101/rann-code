import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { explainKey, loadConfig, providerFor, RannError } from "./index.js";

function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe("config", () => {
  it("menggabungkan default, global, project, dan env", () => {
    const home = tempDir("rann-cfg-home-");
    const project = tempDir("rann-cfg-proj-");
    mkdirSync(join(home, "config"), { recursive: true });
    writeFileSync(
      join(home, "config", "config.toml"),
      ['provider = "mock"', "[model]", 'default = "mock-1"', "[permissions]", 'mode = "trusted"'].join("\n")
    );
    mkdirSync(join(project, ".rann"), { recursive: true });
    writeFileSync(join(project, ".rann", "config.toml"), ["[agent]", "max_steps = 5"].join("\n"));

    const loaded = loadConfig({ home, projectPath: project, env: {} });
    expect(loaded.config.provider).toBe("mock");
    expect(loaded.config.permissions.mode).toBe("trusted");
    expect(loaded.config.agent.max_steps).toBe(5);
    expect(loaded.sources["permissions.mode"]).toBe("global");
    expect(loaded.sources["agent.max_steps"]).toBe("project");
    expect(loaded.files).toHaveLength(2);
  });

  it("profil menimpa global dan project menimpa profil", () => {
    const home = tempDir("rann-cfg-profile-");
    const project = tempDir("rann-cfg-profile-proj-");
    mkdirSync(join(home, "config"), { recursive: true });
    mkdirSync(join(home, "profiles", "kerja"), { recursive: true });
    mkdirSync(join(project, ".rann"), { recursive: true });
    writeFileSync(join(home, "config", "config.toml"), ['[permissions]', 'mode = "ask"'].join("\n"));
    writeFileSync(join(home, "profiles", "kerja", "config.toml"), ['[permissions]', 'mode = "trusted"', "[agent]", "max_steps = 7"].join("\n"));
    writeFileSync(join(project, ".rann", "config.toml"), ["[agent]", "max_steps = 4"].join("\n"));
    const loaded = loadConfig({ home, projectPath: project, env: { RANN_PROFILE: "kerja" } });
    expect(loaded.config.profile).toBe("kerja");
    expect(loaded.config.permissions.mode).toBe("trusted");
    expect(loaded.config.agent.max_steps).toBe(4);
    expect(loaded.sources["permissions.mode"]).toBe("profile");
    expect(loaded.sources["agent.max_steps"]).toBe("project");
    expect(loaded.files).toHaveLength(3);
  });

  it("env menimpa berkas config", () => {
    const home = tempDir("rann-cfg-env-");
    mkdirSync(join(home, "config"), { recursive: true });
    mkdirSync(join(home, "project"), { recursive: true });
    writeFileSync(join(home, "config", "config.toml"), ['[permissions]', 'mode = "ask"'].join("\n"));
    const loaded = loadConfig({
      home,
      projectPath: join(home, "project"),
      env: { RANN_PERMISSION_MODE: "read-only", RANN_NO_COLOR: "1" }
    });
    expect(loaded.config.permissions.mode).toBe("read-only");
    expect(loaded.config.ui.color).toBe(false);
    expect(loaded.sources["permissions.mode"]).toBe("env");
  });

  it("menolak mode izin di luar daftar PRD", () => {
    const home = tempDir("rann-cfg-bad-");
    mkdirSync(join(home, "config"), { recursive: true });
    writeFileSync(join(home, "config", "config.toml"), ['[permissions]', 'mode = "auto"'].join("\n"));
    try {
      loadConfig({ home, projectPath: home, env: {} });
      throw new Error("seharusnya gagal");
    } catch (error) {
      expect(error).toBeInstanceOf(RannError);
      expect((error as RannError).code).toBe("E_CONFIG_INVALID");
    }
  });

  it("melaporkan sumber nilai lewat explainKey", () => {
    const home = tempDir("rann-cfg-explain-");
    mkdirSync(join(home, "config"), { recursive: true });
    writeFileSync(join(home, "config", "config.toml"), ['[model]', 'default = "mock-1"'].join("\n"));
    const loaded = loadConfig({ home, projectPath: home, env: {} });
    const explained = explainKey(loaded, "model.default");
    expect(explained.value).toBe("mock-1");
    expect(explained.source).toBe("global");
  });

  it("memberi provider mock bawaan", () => {
    const home = tempDir("rann-cfg-mock-");
    mkdirSync(join(home, "config"), { recursive: true });
    const loaded = loadConfig({ home, projectPath: home, env: {} });
    const provider = providerFor(loaded.config);
    expect(provider.kind).toBe("mock");
    expect(provider.default_model).toBe("mock-1");
  });
});
