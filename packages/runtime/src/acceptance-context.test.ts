import { describe, expect, it } from "vitest";
import { buildChatContext } from "./agent.js";
import { estimateTokens } from "./providers/types.js";
import type { MessageRow } from "@rann/storage";

const key = process.env.RANN_LIVE_API_KEY;

function row(index: number, role: "user" | "assistant" | "system", content: string): MessageRow {
  return {
    id: `m${index}`,
    session_id: "ses",
    turn_id: "turn",
    role,
    content,
    content_json: null,
    token_count: null,
    created_at: index
  };
}

describe("acceptance context", () => {
  it("AC-106 compaction berjalan dan goal, keputusan, error tetap ada", () => {
    const rows = [
      row(0, "system", "GOAL: selesaikan rate limit"),
      row(1, "assistant", "KEPUTUSAN: pakai Redis untuk counter"),
      ...Array.from({ length: 30 }, (_, index) => row(index + 2, index % 2 === 0 ? "user" : "assistant", "riwayat panjang ".repeat(200))),
      row(40, "system", "ERROR: koneksi Redis gagal sekali"),
      row(41, "user", "lanjutkan")
    ];
    const built = buildChatContext(rows, "GOAL: selesaikan rate limit", { maxTokens: 2_000, keepRecent: 4, summaryChars: 4_000 });
    expect(built.compacted).toBe(true);
    const all = built.messages.map((message) => message.content).join("\n");
    expect(all).toContain("GOAL: selesaikan rate limit");
    expect(all).toContain("KEPUTUSAN: pakai Redis");
    expect(all).toContain("ERROR: koneksi Redis gagal");
  });

  it.skipIf(!key)("AC-106 estimator token dalam 15 persen dari usage provider nyata", async () => {
    const text = "Rann Code adalah agen coding otonom yang berjalan di terminal. ".repeat(40);
    const response = await fetch("https://api.rannd.web.id/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model: "river/GLM-5.3", messages: [{ role: "user", content: text }], max_tokens: 1 })
    });
    const data = (await response.json()) as { usage?: { prompt_tokens?: number } };
    const actual = data.usage?.prompt_tokens ?? 0;
    const estimated = estimateTokens(text);
    expect(actual).toBeGreaterThan(0);
    expect(Math.abs(estimated - actual) / actual).toBeLessThanOrEqual(0.15);
  }, 120_000);
});
