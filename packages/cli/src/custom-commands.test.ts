import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { expandCustomCommand, loadCustomCommands, parseCustomCommand } from "./custom-commands.js";

const dirs: string[] = [];
function temp(): string {
  const dir = mkdtempSync(join(tmpdir(), "rann-command-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const sample = `---
name: deploy-staging
description: Deploy build terakhir ke staging
aliases: [ds]
permission: exec
args:
  - name: version
    required: false
    description: Tag yang akan dideploy
model: auto
---
Jalankan deploy versi {{version}} dengan argumen $ARGUMENTS.
`;

describe("command kustom", () => {
  it("membaca frontmatter dan isi", () => {
    const command = parseCustomCommand(sample, "/tmp/deploy.md", "project");
    expect(command.name).toBe("deploy-staging");
    expect(command.aliases).toEqual(["ds"]);
    expect(command.permission).toBe("exec");
    expect(command.args[0]?.name).toBe("version");
  });

  it("menaikkan permission saat command meminta shell", () => {
    const body = `${sample.replace("permission: exec", "permission: read")}\n\`\`\`sh\nrm -rf build\n\`\`\`\n`;
    const command = parseCustomCommand(body, "/tmp/a.md", "global");
    expect(command.permission).toBe("exec");
  });

  it("menolak frontmatter rusak", () => {
    expect(() => parseCustomCommand("tanpa frontmatter", "/tmp/a.md", "global")).toThrow(/frontmatter/);
    expect(() => parseCustomCommand("---\nname: A\n---\nisi", "/tmp/a.md", "global")).toThrow(/nama/);
  });

  it("mengganti placeholder argumen", () => {
    const command = parseCustomCommand(sample, "/tmp/deploy.md", "project");
    expect(expandCustomCommand(command, "--version v1")).toContain("versi v1");
    expect(expandCustomCommand(command, "v2")).toContain("dengan argumen v2");
  });

  it("memuat global dan project dengan prioritas project", () => {
    const root = temp();
    const home = join(root, "home");
    const project = join(root, "project");
    mkdirSync(home, { recursive: true });
    mkdirSync(project, { recursive: true });
    writeFileSync(join(home, "sama.md"), sample.replaceAll("deploy-staging", "sama"));
    writeFileSync(join(project, "sama.md"), sample.replaceAll("deploy-staging", "sama").replace("global", "project"));
    writeFileSync(join(project, "lain.md"), sample.replaceAll("deploy-staging", "lain"));
    const result = loadCustomCommands({ homeDir: home, projectDir: project, coreNames: ["help"] });
    expect(result.commands.map((command) => command.name)).toEqual(["lain", "sama"]);
    expect(result.commands.find((command) => command.name === "sama")?.source).toBe("project");
    expect(result.errors.some((error) => error.includes("ditimpa"))).toBe(true);
  });

  it("menolak nama yang bentrok dengan command inti", () => {
    const root = temp();
    writeFileSync(join(root, "help.md"), sample.replace("deploy-staging", "help"));
    const result = loadCustomCommands({ homeDir: root, projectDir: join(root, "kosong") , coreNames: ["help"] });
    expect(result.commands).toHaveLength(0);
    expect(result.errors[0]).toContain("bentrok");
  });
});
