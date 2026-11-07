import { describe, expect, it } from "vitest";
import { REPL_COMMANDS, commandName, completeReplLine, findReplCommand, isAvailable, matchReplCommands } from "./repl-commands.js";

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
    expect(matchReplCommands("chekpoint").map((item) => item.name)).toContain("checkpoint");
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

  it("setiap perintah punya kategori dan izin yang dikenal", () => {
    const categories = new Set(["umum", "sesi", "model", "agen", "memori", "skill", "tool", "proyek", "konfigurasi", "infra"]);
    const permissions = new Set(["read", "write", "exec", "net", "admin", "secret"]);
    for (const command of REPL_COMMANDS) {
      expect(categories.has(command.category)).toBe(true);
      expect(permissions.has(command.permission ?? "read")).toBe(true);
      expect(command.usage.startsWith("/")).toBe(true);
    }
  });

  it("perintah yang belum tersedia punya alasan", () => {
    for (const command of REPL_COMMANDS.filter((item) => item.available === false)) {
      expect((command.unavailableReason ?? "").length).toBeGreaterThan(3);
    }
  });

  it("membedakan perintah tersedia dan belum tersedia", () => {
    expect(isAvailable(findReplCommand("help")!)).toBe(true);
    expect(matchReplCommands("mcp")).toHaveLength(0);
    expect(matchReplCommands("mcp", { includeUnavailable: true }).map((item) => item.name)).toContain("mcp");
  });
});
