import { RannError } from "@rann/shared";

export interface SseEvent {
  event?: string;
  data: string;
}

export async function* readSse(body: ReadableStream<Uint8Array> | null): AsyncGenerator<SseEvent, void, unknown> {
  if (!body) throw new RannError("E_PROVIDER_UNAVAILABLE", "Respons provider tanpa body");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let eventName: string | undefined;
  let dataLines: string[] = [];

  const flush = (): SseEvent | undefined => {
    if (dataLines.length === 0) {
      eventName = undefined;
      return undefined;
    }
    const event = { ...(eventName ? { event: eventName } : {}), data: dataLines.join("\n") };
    eventName = undefined;
    dataLines = [];
    return event;
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index = buffer.indexOf("\n");
    while (index >= 0) {
      const line = buffer.slice(0, index).replace(/\r$/, "");
      buffer = buffer.slice(index + 1);
      if (line === "") {
        const event = flush();
        if (event) yield event;
      } else if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice(5).trimStart());
      }
      index = buffer.indexOf("\n");
    }
  }
  if (buffer.length > 0 && buffer.startsWith("data:")) dataLines.push(buffer.slice(5).trimStart());
  const tail = flush();
  if (tail) yield tail;
}

export function providerError(name: string, status: number, detail: string, retryAfter?: string | null): RannError {
  const code =
    status === 401 || status === 403
      ? "E_PROVIDER_AUTH"
      : status === 429
        ? "E_PROVIDER_RATE_LIMIT"
        : "E_PROVIDER_UNAVAILABLE";
  const seconds = retryAfter ? Number(retryAfter) : NaN;
  return new RannError(code, `Provider ${name} membalas ${status}: ${detail.slice(0, 500)}`, {
    data: {
      status,
      ...(Number.isFinite(seconds) && seconds >= 0 ? { retryAfterMs: seconds * 1000 } : {})
    }
  });
}

export function safeArgs(raw: string): unknown {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { __raw: raw };
  }
}
