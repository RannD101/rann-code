import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUILTIN_COMMANDS, findReplCommand, registerCommands } from "./repl-commands.js";
import { loadProjectCommands, registerProjectCommands } from "./project-commands.js";

describe("command proyek", () => {
  it("memuat frontmatter dan isi command", () => {
    const root = mkdtempSync(join(tmpdir(), "rann-cmd-"));
    mkdirSync(join(root, ".rann", "commands"), { recursive: true });
    writeFileSync(
      join(root, ".rann", "commands", "rilis.md"),
      "---\nname: rilis\ndescription: Jalankan rilis\n---\nPeriksa changelog lalu jalankan tes.\n"
    );
    const commands = loadProjectCommands(root);
    expect(commands).toHaveLength(1);
    expect(commands[0]).toMatchObject({ name: "rilis", source: "project" });
    expect(commands[0]?.handler).toContain("changelog");
  });

  it("menimpa command bawaan dengan nama yang sama", () => {
    const root = mkdtempSync(join(tmpdir(), "rann-cmd-"));
    mkdirSync(join(root, ".rann", "commands"), { recursive: true });
    writeFileSync(join(root, ".rann", "commands", "status.md"), "---\nname: status\ndescription: Status versi proyek\n---\nTampilkan status proyek.\n");
    expect(BUILTIN_COMMANDS.some((command) => command.name === "status")).toBe(true);
    registerProjectCommands(root);
    expect(findReplCommand("status")?.source).toBe("project");
    expect(findReplCommand("status")?.handler).toContain("status proyek");
    registerCommands(BUILTIN_COMMANDS.filter((command) => command.name === "status"));
  });
});
