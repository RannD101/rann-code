import { describe, expect, it } from "vitest";
import { sessionSendParams } from "./rpc.js";

describe("sessionSendParams", () => {
  it("mempertahankan flag planOnly dan forcePlan", () => {
    const parsed = sessionSendParams.parse({ sessionId: "ses_1", text: "kerja", planOnly: true, forcePlan: true });
    expect(parsed.planOnly).toBe(true);
    expect(parsed.forcePlan).toBe(true);
  });

  it("menolak teks kosong", () => {
    expect(() => sessionSendParams.parse({ sessionId: "ses_1", text: "" })).toThrow();
  });
});
