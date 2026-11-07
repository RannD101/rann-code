export type EventType =
  | "session.updated"
  | "turn.start"
  | "message.start"
  | "message.delta"
  | "message.end"
  | "reasoning.delta"
  | "tool.start"
  | "tool.end"
  | "plan.update"
  | "task.update"
  | "agent.update"
  | "approval.request"
  | "approval.resolved"
  | "usage.update"
  | "error"
  | "turn.end"
  | "heartbeat"
  // Nama lama tetap diterima agar klien versi 0.1.x tidak langsung rusak.
  // Runtime hanya menerbitkan nama kanonis di atas.
  | "session.created"
  | "turn.started"
  | "message.completed"
  | "tool.started"
  | "tool.finished"
  | "approval.requested"
  | "context.compacted"
  | "subagent.started"
  | "subagent.finished"
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
