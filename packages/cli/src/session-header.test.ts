import { describe, expect, it } from "vitest";
import { ctrlDAction, headerLines } from "./session-header.js";

describe("header sesi", () => {
  it("tampil di bawah satu detik dan memuat konteks", () => {
    const started = performance.now();
    const lines = headerLines({
      cwd: "/proyek",
      branch: "main",
      session: "ses_1",
      model: "mock-1",
      permission: "trusted",
      profile: "default"
    });
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(lines.join("\n")).toContain("/proyek");
    expect(lines.join("\n")).toContain("ses_1");
    expect(lines).toHaveLength(3);
  });
});

describe("Ctrl+D saat turn berjalan", () => {
  it("langsung keluar saat tidak sibuk", async () => {
    expect(await ctrlDAction(false, async () => "wait")).toBe("exit");
  });

  it("menawarkan background saat turn berjalan", async () => {
    const seen: string[] = [];
    const action = await ctrlDAction(true, async (_title, options) => {
      seen.push(...options.map((option) => option.key));
      return "background";
    });
    expect(action).toBe("background");
    expect(seen).toContain("background");
  });
});
