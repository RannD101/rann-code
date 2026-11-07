import { describe, expect, it } from "vitest";
import { RannError } from "@rann/shared";
import { HealthRegistry, isRetryable, retryDelayMs, retryStream } from "./retry.js";

describe("retry dan health", () => {
  it("mengulang stream yang gagal sebelum chunk pertama", async () => {
    let calls = 0;
    const factory = async function* (): AsyncGenerator<string> {
      calls += 1;
      if (calls < 3) throw new RannError("E_PROVIDER_UNAVAILABLE", "sementara");
      yield "ok";
    };
    const chunks: string[] = [];
    for await (const chunk of retryStream(factory, { attempts: 3 })) chunks.push(chunk);
    expect(chunks).toEqual(["ok"]);
    expect(calls).toBe(3);
  });

  it("tidak mengulang setelah teks terkirim", async () => {
    let calls = 0;
    const factory = async function* (): AsyncGenerator<string> {
      calls += 1;
      yield "sebagian";
      throw new RannError("E_PROVIDER_UNAVAILABLE", "putus");
    };
    const chunks: string[] = [];
    await expect(async () => {
      for await (const chunk of retryStream(factory, { attempts: 3 })) chunks.push(chunk);
    }).rejects.toMatchObject({ code: "E_PROVIDER_UNAVAILABLE" });
    expect(chunks).toEqual(["sebagian"]);
    expect(calls).toBe(1);
  });

  it("membedakan error yang layak diulang", () => {
    expect(isRetryable(new RannError("E_PROVIDER_RATE_LIMIT", "429"))).toBe(true);
    expect(isRetryable(new RannError("E_PROVIDER_AUTH", "401"))).toBe(false);
    expect(retryDelayMs(1)).toBeGreaterThanOrEqual(1_000);
    expect(retryDelayMs(1)).toBeLessThanOrEqual(1_250);
    expect(retryDelayMs(2)).toBeGreaterThanOrEqual(2_000);
    expect(retryDelayMs(1, 12_000)).toBe(12_000);
  });

  it("membuka circuit setelah lima kegagalan", () => {
    const registry = new HealthRegistry();
    for (let index = 0; index < 5; index += 1) {
      registry.recordFailure("p", new RannError("E_PROVIDER_UNAVAILABLE", "gagal"));
    }
    expect(registry.isOpen("p")).toBe(true);
    expect(registry.get("p").status).toBe("down");
    registry.recordSuccess("p");
    expect(registry.isOpen("p")).toBe(false);
    expect(registry.get("p").status).toBe("healthy");
  });
});
