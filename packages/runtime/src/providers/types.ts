export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ToolCallPart {
  id: string;
  name: string;
  args: unknown;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  toolCallId?: string;
  toolName?: string;
  toolCalls?: ToolCallPart[];
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  maxTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export type ProviderChunk =
  | { type: "text"; text: string }
  | { type: "tool_call"; id: string; name: string; args: unknown }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | { type: "done"; finishReason: string };

export interface Provider {
  readonly name: string;
  readonly kind: string;
  chat(request: ChatRequest): AsyncGenerator<ProviderChunk, void, unknown>;
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
