import { describe, expect, it } from "vitest";
import { renderTaskProgress } from "./stream.js";

describe("indikator task", () => {
  it("AC-009 menampilkan 2/5, langkah aktif, waktu, dan selesai", () => {
    expect(renderTaskProgress({ done: 1, total: 5, status: "running", title: "Bangun", elapsedMs: 1500 })).toBe(
      "[task] 2/5 running Bangun 1.5s"
    );
    expect(renderTaskProgress({ done: 5, total: 5, status: "done", title: "Selesai" })).toContain("5/5");
  });
});
