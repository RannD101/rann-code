import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setConfigValue, unsetConfigValue } from "./config-store.js";

describe("config-store", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "rann-config-"));
    mkdirSync(join(home, "config"), { recursive: true });
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it("menulis nilai ke section yang benar dan tidak menduplikasi kunci", () => {
    setConfigValue(home, "providers.rann.base_url", "https://satu");
    setConfigValue(home, "providers.rann.base_url", "https://dua");
    const text = readFileSync(join(home, "config", "config.toml"), "utf8");
    expect(text).toContain("[providers.rann]");
    expect(text.match(/base_url =/g)).toHaveLength(1);
    expect(text).toContain('base_url = "https://dua"');
  });

  it("menghapus satu kunci tanpa menyentuh kunci lain", () => {
    writeFileSync(
      join(home, "config", "config.toml"),
      ['[providers.rann]', 'base_url = "https://satu"', 'api_key_ref = "rann.api_key"', "", "[agent]", "max_steps = 5", ""].join("\n"),
      "utf8"
    );
    expect(unsetConfigValue(home, "providers.rann.api_key_ref")).toBe(true);
    const text = readFileSync(join(home, "config", "config.toml"), "utf8");
    expect(text).not.toContain("api_key_ref");
    expect(text).toContain('base_url = "https://satu"');
    expect(text).toContain("max_steps = 5");
    expect(unsetConfigValue(home, "providers.rann.api_key_ref")).toBe(false);
  });
});
