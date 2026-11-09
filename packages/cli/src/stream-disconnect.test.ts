import { describe, expect, it } from "vitest";
import { runStreaming } from "./stream.js";
import type { RpcClient } from "@rann/runtime";
import type { EventEnvelope } from "@rann/shared";

describe("stream terputus", () => {
  it("AC-007 menampilkan marker, mempertahankan teks parsial, dan gagal dengan E_STREAM_TRUNCATED", async () => {
    let handler: ((event: EventEnvelope) => void) | undefined;
    let closeHandler: (() => void) | undefined;
    const client = {
      request: async () => ({ turnId: "turn-1" }),
      onEvent: (listener: (event: EventEnvelope) => void) => {
        handler = listener;
        return () => undefined;
      },
      onClose: (listener: () => void) => {
        closeHandler = listener;
        return () => undefined;
      },
      reconnect: async () => {
        throw new Error("mati");
      },
      close: () => undefined
    } as unknown as RpcClient;
    const errors: string[] = [];
    const original = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      errors.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      const pending = runStreaming(client, "ses-1", "halo");
      await new Promise((resolve) => setTimeout(resolve, 20));
      handler?.({ type: "message.delta", sessionId: "ses-1", turnId: "turn-1", data: { text: "sebagian" } } as unknown as EventEnvelope);
      closeHandler?.();
      const result = await pending;
      expect(result.text).toBe("sebagian");
      expect(result.ok).toBe(false);
      expect(result.error?.code).toBe("E_STREAM_TRUNCATED");
      expect(errors.join("")).toContain("[stream terputus]");
    } finally {
      process.stderr.write = original;
    }
  });
});
