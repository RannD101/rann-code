import { describe, expect, it } from "vitest";
import { chooseTurnFailureAction } from "./turn-failure.js";

describe("pilihan setelah turn gagal", () => {
  it("memetakan jawaban ke tindakan", async () => {
    expect(await chooseTurnFailureAction("E_STREAM_TRUNCATED", async () => "r")).toBe("retry");
    expect(await chooseTurnFailureAction("E_STREAM_TRUNCATED", async () => "")).toBe("retry");
    expect(await chooseTurnFailureAction("E_TOOL_FAILED", async () => "a")).toBe("alternative");
    expect(await chooseTurnFailureAction("E_TOOL_FAILED", async () => "p")).toBe("replan");
    expect(await chooseTurnFailureAction("E_TOOL_FAILED", async () => "l")).toBe("continue");
  });

  it("tidak bertanya saat turn dibatalkan", async () => {
    let asked = false;
    expect(
      await chooseTurnFailureAction("E_CANCELLED", async () => {
        asked = true;
        return "p";
      })
    ).toBe("continue");
    expect(asked).toBe(false);
  });
});
