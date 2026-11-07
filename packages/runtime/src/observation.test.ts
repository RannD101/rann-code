import { describe, expect, it } from "vitest";
import { evaluateObservation, normalizeObservation } from "./agent.js";

describe("observasi tool", () => {
  it("menandai hasil normal sebagai ok dan mengambil artefak", () => {
    const observation = normalizeObservation("fs_read", { ok: true, output: { path: "src/a.ts", content: "x" } });
    expect(observation.status).toBe("ok");
    expect(observation.artifacts).toEqual(["src/a.ts"]);
    expect(evaluateObservation("fs_read", observation).ok).toBe(true);
  });

  it("hasil kosong tidak dianggap sukses", () => {
    const observation = normalizeObservation("fs_read", { ok: true, output: "" });
    expect(observation.status).toBe("empty");
    expect(evaluateObservation("fs_read", observation)).toMatchObject({ ok: false });
  });

  it("output terpotong ditandai", () => {
    const observation = normalizeObservation("git_read", { ok: true, output: `awal\n[output dipotong]` });
    expect(observation.status).toBe("truncated");
    expect(evaluateObservation("git_read", observation).ok).toBe(false);
  });

  it("error membawa kode dan alasan evaluasi", () => {
    const observation = normalizeObservation("shell_run", { ok: false, output: "gagal", code: "E_TOOL_FAILED" });
    expect(observation.status).toBe("error");
    expect(evaluateObservation("shell_run", observation).reason).toContain("shell_run gagal");
  });
});
