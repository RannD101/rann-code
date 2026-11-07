import { describe, expect, it } from "vitest";
import { REPL_COMMANDS, commandName, completeReplLine, findReplCommand, matchReplCommands } from "./repl-commands.js";

describe("registry perintah REPL", () => {
  it("mengenali nama dan alias", () => {
    expect(findReplCommand("undo")?.usage).toContain("/undo");
    expect(findReplCommand("q")?.name).toBe("exit");
    expect(findReplCommand("tidak-ada")).toBeUndefined();
  });

  it("mengambil nama perintah dari baris", () => {
    expect(commandName("/plan buat fitur")).toBe("plan");
    expect(commandName("  /MEMORY  ")).toBe("memory");
    expect(commandName("halo")).toBe("");
  });

  it("mencari perintah dengan typo dan sinonim", () => {
    expect(matchReplCommands("chekpoint")[0]?.name).toBe("checkpoints");
    expect(matchReplCommands("biaya").map((item) => item.name)).toContain("usage");
    expect(matchReplCommands("zzzzz")).toHaveLength(0);
  });

  it("melengkapi nama perintah untuk readline", () => {
    const [hits, line] = completeReplLine("/mod");
    expect(line).toBe("/mod");
    expect(hits).toContain("/model");
    expect(hits).toContain("/models");
    expect(completeReplLine("/plan ide")[0]).toHaveLength(0);
  });

  it("semua perintah punya deskripsi dan penggunaan", () => {
    for (const command of REPL_COMMANDS) {
      expect(command.description.length).toBeGreaterThan(3);
      expect(command.usage.startsWith("/")).toBe(true);
    }
  });
});
