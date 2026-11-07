import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUILTIN_PROFILES, loadProfiles, pickProfile } from "./subagent-profiles.js";
import { toolSpecs } from "./tools/index.js";

describe("subagent profiles", () => {
  it("hanya memakai tool yang benar-benar terdaftar", () => {
    const tools = new Set(toolSpecs().map((spec) => spec.name));
    for (const profile of BUILTIN_PROFILES) {
      if (profile.tools === "*") continue;
      for (const tool of profile.tools) expect(tools.has(tool), `${profile.name}: ${tool}`).toBe(true);
    }
  });

  it("memuat profil project dan menimpa profil bawaan dengan nama sama", () => {
    const dir = mkdtempSync(join(tmpdir(), "rann-profiles-"));
    const project = join(dir, "project");
    mkdirSync(join(project, ".rann", "agents"), { recursive: true });
    writeFileSync(
      join(project, ".rann", "agents", "coder.md"),
      "---\nname: coder\ndescription: versi project\ntools: fs_read, shell_run\npermission: read-only\nmax_steps: 4\n---\nKerjakan hanya perubahan kecil."
    );
    const profiles = loadProfiles(join(dir, "home"), project);
    const coder = profiles.find((item) => item.name === "coder")!;
    expect(coder.source).toBe("project");
    expect(coder.description).toBe("versi project");
    expect(coder.tools).toEqual(["fs_read", "shell_run"]);
    expect(coder.maxSteps).toBe(4);
  });

  it("memilih profil eksplisit dan menolak nama asing", () => {
    const profiles = loadProfiles("/tmp/tidak-ada-home");
    expect(pickProfile(profiles, "tester", "apa saja").name).toBe("tester");
    expect(pickProfile(profiles, undefined, "tolong perbaiki bug ini").name).toBe("debugger");
    expect(() => pickProfile(profiles, "tidak-ada", "apa saja")).toThrow(/tidak dikenal/);
  });
});
