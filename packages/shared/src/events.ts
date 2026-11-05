export type EventType =
  | "session.created"
  | "turn.started"
  | "message.delta"
  | "message.completed"
  | "tool.started"
  | "tool.finished"
  | "approval.requested"
  | "turn.completed"
  | "turn.failed"
  | "log";

export interface EventEnvelope<T extends EventType = EventType> {
  seq: number;
  type: T;
  sessionId: string;
  turnId?: string;
  at: number;
  data: Record<string, unknown>;
}

export interface AgentEventInput<T extends EventType = EventType> {
  type: T;
  data: Record<string, unknown>;
}
