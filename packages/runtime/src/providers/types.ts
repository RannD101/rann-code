export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ToolCallPart {
  id: string;
  name: string;
  args: unknown;
}

export interface ChatAttachment {
  name: string;
  mime: string;
  dataBase64: string;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  toolCallId?: string;
  toolName?: string;
  toolCalls?: ToolCallPart[];
  attachments?: ChatAttachment[];
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  permission?: "read" | "write" | "exec";
  timeoutMs?: number;
  outputSchema?: Record<string, unknown>;
}

export interface ResponseFormat {
  /** `json_object` hanya meminta JSON valid, `json_schema` meminta bentuk tertentu. */
  type: "json_object" | "json_schema";
  name?: string;
  schema?: Record<string, unknown>;
  strict?: boolean;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  maxTokens?: number;
  temperature?: number;
  responseFormat?: ResponseFormat;
  signal?: AbortSignal;
}

export type ProviderChunk =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | { type: "tool_call"; id: string; name: string; args: unknown }
  /** Dikirim begitu provider memberi id request, sebelum teks pertama. */
  | { type: "request_id"; id: string }
  | {
      type: "usage";
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens?: number;
      cacheWriteTokens?: number;
      providerRequestId?: string;
    }
  | { type: "done"; finishReason: string };

export interface EmbedRequest {
  model: string;
  input: string[];
  signal?: AbortSignal;
}

export interface EmbedResult {
  model: string;
  vectors: number[][];
  inputTokens?: number;
}

export interface ProviderModelInfo {
  id: string;
  displayName?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  capabilities?: Record<string, boolean>;
}

export interface ProviderHealthProbe {
  ok: boolean;
  latencyMs: number;
  status: "healthy" | "degraded" | "down";
  error?: string;
}

/** Method opsional yang boleh tidak dimiliki sebuah adapter. */
export interface AdapterSupport {
  embed: boolean;
  listModels: boolean;
  health: boolean;
  countTokens: boolean;
}

export interface Provider {
  readonly name: string;
  readonly kind: string;
  readonly support: AdapterSupport;
  chat(request: ChatRequest): AsyncGenerator<ProviderChunk, void, unknown>;
  /** Alias eksplisit untuk jalur streaming; adapter tanpa mode non-stream mengembalikan `chat`. */
  stream(request: ChatRequest): AsyncGenerator<ProviderChunk, void, unknown>;
  embed?(request: EmbedRequest): Promise<EmbedResult>;
  listModels?(): Promise<ProviderModelInfo[]>;
  health?(): Promise<ProviderHealthProbe>;
  countTokens?(request: ChatRequest): number | Promise<number>;
}

export const NO_ADAPTER_SUPPORT: AdapterSupport = {
  embed: false,
  listModels: false,
  health: false,
  countTokens: false
};

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
