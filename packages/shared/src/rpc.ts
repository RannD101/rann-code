import { z } from "zod";

export const PROTOCOL_VERSION = 1;

export const requestIdSchema = z.union([z.string().min(1), z.number().int()]);
export type RequestId = z.infer<typeof requestIdSchema>;

export const rpcRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: requestIdSchema,
  method: z.string().min(1),
  params: z.record(z.unknown()).default({})
});
export type RpcRequest = z.infer<typeof rpcRequestSchema>;

export const rpcErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string(),
  data: z.record(z.unknown()).optional(),
  hint: z.string().optional()
});

export const rpcResponseSchema = z.union([
  z.object({ jsonrpc: z.literal("2.0"), id: requestIdSchema, result: z.unknown() }),
  z.object({ jsonrpc: z.literal("2.0"), id: requestIdSchema, error: rpcErrorSchema })
]);
export type RpcResponse = z.infer<typeof rpcResponseSchema>;

export const rpcNotificationSchema = z.object({
  jsonrpc: z.literal("2.0"),
  method: z.literal("event"),
  params: z.object({
    seq: z.number().int().nonnegative(),
    type: z.string(),
    sessionId: z.string(),
    turnId: z.string().optional(),
    at: z.number().int(),
    data: z.record(z.unknown())
  })
});
export type RpcNotification = z.infer<typeof rpcNotificationSchema>;

const empty = z.object({}).default({});

export const sessionCreateParams = z.object({
  projectPath: z.string().min(1).optional(),
  title: z.string().min(1).max(200).optional(),
  model: z.string().min(1).optional(),
  permissionMode: z.enum(["read-only", "ask", "accept-edits", "trusted", "custom"]).optional()
});

export const sessionListParams = z.object({
  status: z.enum(["active", "closed", "error"]).optional(),
  projectPath: z.string().min(1).optional(),
  limit: z.number().int().positive().max(200).default(20)
});

export const sessionGetParams = z.object({ sessionId: z.string().min(1) });

export const sessionRenameParams = z.object({ sessionId: z.string().min(1), title: z.string().min(1).max(200) });

export const sessionForkParams = z.object({
  sessionId: z.string().min(1),
  title: z.string().min(1).max(200).optional(),
  uptoMessageId: z.string().min(1).optional()
});

export const sessionSendParams = z.object({
  sessionId: z.string().min(1),
  text: z.string().min(1).max(200_000),
  model: z.string().min(1).optional(),
  permissionMode: z.enum(["read-only", "ask", "accept-edits", "trusted", "custom"]).optional(),
  idempotencyKey: z.string().min(8).max(200).optional(),
  planOnly: z.boolean().optional(),
  forcePlan: z.boolean().optional(),
  attachments: z.array(z.object({
    path: z.string().min(1).max(4096),
    name: z.string().min(1).max(255).optional()
  })).max(20).optional()
});

export const sessionCancelParams = z.object({
  sessionId: z.string().min(1),
  turnId: z.string().min(1).optional()
});

export const turnGetParams = z.object({ turnId: z.string().min(1) });
export const turnEventsParams = z.object({
  turnId: z.string().min(1),
  afterSeq: z.number().int().nonnegative().default(0)
});

export const shutdownParams = z.object({ graceful: z.boolean().default(true) });
export const configExplainParams = z.object({ key: z.string().min(1) });
export const permissionRespondParams = z.object({
  requestId: z.string().min(1),
  approved: z.boolean(),
  remember: z.boolean().default(false)
});
export const providerTestParams = z.object({
  name: z.string().min(1).optional(),
  model: z.string().min(1).optional()
});
export const usageSummaryParams = z.object({
  sessionId: z.string().min(1).optional()
});

const localPath = z.string().min(1).optional();

export const memoryListParams = z.object({
  projectPath: localPath,
  scope: z.enum(["global", "project", "all"]).default("all"),
  limit: z.number().int().positive().max(100).default(30)
});
export const memorySearchParams = z.object({
  projectPath: localPath,
  query: z.string().min(1).max(500),
  limit: z.number().int().positive().max(100).default(10)
});
export const memoryAddParams = z.object({
  projectPath: localPath,
  text: z.string().min(1).max(4_000),
  scope: z.enum(["global", "project"]).default("project"),
  kind: z.string().min(1).max(40).default("fact"),
  tags: z.array(z.string().min(1).max(40)).max(12).default([])
});
export const memoryUpdateParams = z.object({
  projectPath: localPath,
  id: z.string().min(1),
  text: z.string().min(1).max(4_000).optional(),
  kind: z.string().min(1).max(40).optional(),
  tags: z.array(z.string().min(1).max(40)).max(12).optional()
});
export const memoryPendingParams = z.object({
  projectPath: z.string().max(4_096).optional(),
  limit: z.number().int().min(1).max(100).optional()
});

export const memoryReviewParams = z.object({
  projectPath: z.string().max(4_096).optional(),
  id: z.string().min(1),
  text: z.string().min(3).max(4_000).optional(),
  tags: z.array(z.string().max(64)).max(12).optional(),
  kind: z.string().max(40).optional()
});

export const memoryPruneParams = z.object({
  projectPath: z.string().max(4_096).optional(),
  days: z.number().int().min(1).max(3_650).optional()
});

export const memoryRejectParams = z.object({
  projectPath: z.string().max(4_096).optional(),
  id: z.string().min(1)
});

export const memoryRemoveParams = z.object({
  projectPath: localPath,
  id: z.string().min(1)
});
export const skillListParams = z.object({
  projectPath: localPath,
  limit: z.number().int().positive().max(200).default(40)
});
export const skillViewParams = z.object({
  projectPath: localPath,
  name: z.string().min(1).max(64)
});
export const skillCreateParams = z.object({
  projectPath: localPath,
  name: z.string().min(1).max(64),
  description: z.string().min(12).max(500),
  body: z.string().min(1).max(60_000),
  scope: z.enum(["global", "project"]).default("project"),
  overwrite: z.boolean().default(false)
});
export const skillRemoveParams = z.object({
  projectPath: localPath,
  name: z.string().min(1).max(64),
  scope: z.enum(["global", "project"]).default("project")
});

export const secretSetParams = z.object({
  name: z.string().min(1).max(128),
  value: z.string().min(1).max(20_000),
  provider: z.string().min(1).max(64).optional()
});
export const secretRemoveParams = z.object({ name: z.string().min(1).max(128) });
export const secretExportParams = z.object({ path: z.string().min(1).max(4096) });

export const routeExplainParams = z.object({
  prompt: z.string().min(1).max(200_000),
  policy: z.string().min(1).max(64).optional()
});

export const checkpointListParams = z.object({
  limit: z.number().int().min(1).max(100).optional()
});

export const checkpointRestoreParams = z.object({
  id: z.string().min(1).max(120),
  force: z.boolean().optional()
});

export const planShowParams = z.object({ planId: z.string().min(1) });

export const toolTestParams = z.object({ name: z.string().min(1), args: z.unknown().optional() });

export const planExportParams = z.object({ planId: z.string().min(1) });

export const planImportParams = z.object({
  sessionId: z.string().min(1),
  text: z.string().max(200_000).optional(),
  draft: z.object({
    goal: z.string().min(1),
    assumptions: z.array(z.string()).default([]),
    criteria: z.array(z.object({ id: z.string(), text: z.string(), done: z.boolean().default(false) })).default([]),
    tasks: z.array(z.object({
      id: z.string().min(1),
      title: z.string().min(1),
      description: z.string().optional(),
      agent: z.string().min(1),
      files: z.array(z.string()).default([]),
      risk: z.enum(["low", "medium", "high"]).default("low"),
      acceptance: z.string().min(1),
      dependsOn: z.array(z.string()).default([])
    })).min(1).max(100),
    estimate: z.object({ minutes: z.number().int().positive(), source: z.enum(["heuristic", "historical"]).default("heuristic") }),
    risks: z.array(z.object({ taskId: z.string(), level: z.enum(["low", "medium", "high"]), reason: z.string() })).default([])
  })
});

export const planListParams = z.object({
  sessionId: z.string().min(1),
  limit: z.number().int().positive().max(100).default(20)
});

export const taskListParams = z.object({ sessionId: z.string().min(1) });

export const taskPriorityParams = z.object({ taskId: z.string().min(1), priority: z.number().int().min(-1000).max(1000) });

const goalCriterion = z.union([
  z.string().min(1).max(2_000),
  z.object({ id: z.string().min(1).max(40).optional(), text: z.string().min(1).max(2_000) })
]);

export const goalGetParams = z.object({ sessionId: z.string().min(1) });

export const goalListParams = z.object({
  sessionId: z.string().min(1),
  limit: z.number().int().min(1).max(100).default(20)
});

export const goalSetParams = z.object({
  sessionId: z.string().min(1),
  goal: z.string().min(1).max(20_000),
  criteria: z.array(goalCriterion).max(50).optional(),
  assumptions: z.array(z.string().min(1).max(2_000)).max(50).optional(),
  createdBy: z.enum(["user", "replan"]).default("user")
});

export const goalUpdateParams = z.object({
  sessionId: z.string().min(1),
  action: z.string().max(2_000).optional(),
  tool: z.string().max(200).optional(),
  note: z.string().max(4_000).optional(),
  complete: z
    .array(z.object({ id: z.string().min(1).max(40), evidence: z.string().min(1).max(4_000) }))
    .max(50)
    .optional()
});

export const goalFinishParams = z.object({
  sessionId: z.string().min(1),
  status: z.enum(["done", "failed", "cancelled"]),
  note: z.string().max(4_000).optional()
});

export const backgroundEnqueueParams = z.object({
  kind: z.enum(["prompt", "shell"]).default("prompt"),
  text: z.string().min(1).max(200_000),
  sessionId: z.string().min(1).optional(),
  queue: z.string().min(1).max(64).default("default"),
  priority: z.number().int().min(0).max(1_000).default(100),
  maxAttempts: z.number().int().min(1).max(10).default(3),
  idempotencyKey: z.string().min(8).max(200).optional(),
  nextRunAt: z.number().int().nonnegative().optional()
});
export const backgroundListParams = z.object({
  status: z.enum(["queued", "running", "done", "failed", "cancelled", "dead"]).optional(),
  queue: z.string().min(1).max(64).optional(),
  limit: z.number().int().positive().max(200).default(50)
});
export const backgroundIdParams = z.object({ id: z.string().min(1) });
export const backgroundLogsParams = z.object({
  id: z.string().min(1),
  limit: z.number().int().positive().max(500).default(100)
});

export const schedulerAddParams = z.object({
  name: z.string().min(1).max(120),
  schedule: z.string().min(1).max(200),
  command: z.string().min(1).max(8_000),
  timezone: z.string().min(1).max(80).optional(),
  payload: z.record(z.unknown()).optional(),
  overlapPolicy: z.enum(["skip", "queue", "replace"]).default("skip"),
  catchUp: z.boolean().default(true),
  maxAttempts: z.number().int().min(1).max(10).default(3)
});
export const schedulerListParams = empty;
export const schedulerIdParams = z.object({ id: z.string().min(1) });
export const schedulerUpdateParams = z.object({
  id: z.string().min(1),
  enabled: z.boolean().optional(),
  schedule: z.string().min(1).max(200).optional(),
  command: z.string().min(1).max(8_000).optional(),
  timezone: z.string().min(1).max(80).optional(),
  overlapPolicy: z.enum(["skip", "queue", "replace"]).optional(),
  catchUp: z.boolean().optional(),
  maxAttempts: z.number().int().min(1).max(10).optional()
});
export const schedulerHistoryParams = z.object({
  id: z.string().min(1),
  limit: z.number().int().positive().max(200).default(30)
});

export const dashboardDataParams = z.object({
  page: z
    .enum([
      "overview",
      "sessions",
      "tasks",
      "agents",
      "plans",
      "models",
      "providers",
      "skills",
      "memory",
      "tools",
      "mcp",
      "plugins",
      "scheduler",
      "gateway",
      "usage",
      "logs",
      "permissions",
      "settings"
    ])
    .default("overview"),
  sessionId: z.string().min(1).optional(),
  limit: z.number().int().positive().max(500).default(100)
});

export const gatewayPairParams = z.object({
  name: z.string().min(1).max(80).optional(),
  ttl_ms: z.number().int().min(60_000).max(600_000).optional()
});
export const gatewayDeviceParams = z.object({ id: z.string().min(1) });
export const gatewayRoleParams = z.object({
  id: z.string().min(1),
  role: z.enum(["owner", "operator", "viewer", "approver"])
});

export const messagingSendParams = z.object({
  chat_id: z.number().int(),
  text: z.string().min(1).max(12_000),
  thread_id: z.number().int().optional()
});

export const agentListParams = z.object({
  status: z.enum(["starting", "running", "waiting", "done", "failed", "cancelled", "orphaned"]).optional(),
  parent_id: z.string().min(3).max(40).optional(),
  limit: z.number().int().min(1).max(500).optional(),
  tree: z.boolean().optional()
});

export const agentIdParams = z.object({
  id: z.string().min(3).max(40)
});

export const agentMessageParams = z.object({
  from: z.string().min(3).max(40),
  to: z.string().min(3).max(40),
  subject: z.string().min(1).max(200),
  body: z.string().min(1).max(8_000),
  type: z.string().min(1).max(40).default("note"),
  priority: z.enum(["low", "normal", "high"]).default("normal"),
  refs: z.array(z.string().max(200)).max(20).optional()
});

export const methodParams = {
  health: empty,
  shutdown: shutdownParams,
  "session.create": sessionCreateParams,
  "project.list": empty,
  "session.list": sessionListParams,
  "session.get": sessionGetParams,
  "session.rename": sessionRenameParams,
  "session.fork": sessionForkParams,
  "session.send": sessionSendParams,
  "session.cancel": sessionCancelParams,
  "turn.get": turnGetParams,
  "turn.runtime": turnGetParams,
  "turn.events": turnEventsParams,
  "model.list": empty,
  "provider.list": empty,
  "config.explain": configExplainParams,
  "config.get": empty,
  "provider.test": providerTestParams,
  "usage.summary": usageSummaryParams,
  "permission.respond": permissionRespondParams,
  "memory.list": memoryListParams,
  "memory.search": memorySearchParams,
  "memory.add": memoryAddParams,
  "memory.update": memoryUpdateParams,
  "memory.remove": memoryRemoveParams,
  "memory.pending": memoryPendingParams,
  "memory.approve": memoryReviewParams,
  "memory.reject": memoryRejectParams,
  "memory.prune": memoryPruneParams,
  "skill.list": skillListParams,
  "skill.conflicts": z.object({ projectPath: z.string().min(1).optional() }).default({}),
  "skill.view": skillViewParams,
  "skill.create": skillCreateParams,
  "skill.remove": skillRemoveParams,
  "secret.list": empty,
  "secret.set": secretSetParams,
  "secret.remove": secretRemoveParams,
  "secret.export": secretExportParams,
  "secret.rotate": empty,
  "budget.status": empty,
  "route.explain": routeExplainParams,
  "tool.list": z.object({}),
  "tool.test": toolTestParams,
  "plan.list": planListParams,
  "plan.show": planShowParams,
  "plan.export": planExportParams,
  "plan.import": planImportParams,
  "checkpoint.list": checkpointListParams,
  "checkpoint.restore": checkpointRestoreParams,
  "task.list": taskListParams,
  "task.priority": taskPriorityParams,
  "goal.get": goalGetParams,
  "goal.list": goalListParams,
  "goal.set": goalSetParams,
  "goal.update": goalUpdateParams,
  "goal.finish": goalFinishParams,
  "background.enqueue": backgroundEnqueueParams,
  "background.list": backgroundListParams,
  "background.get": backgroundIdParams,
  "background.cancel": backgroundIdParams,
  "background.retry": backgroundIdParams,
  "background.logs": backgroundLogsParams,
  "scheduler.add": schedulerAddParams,
  "scheduler.list": schedulerListParams,
  "scheduler.run": schedulerIdParams,
  "scheduler.update": schedulerUpdateParams,
  "scheduler.remove": schedulerIdParams,
  "scheduler.history": schedulerHistoryParams,
  "dashboard.data": dashboardDataParams,
  "mcp.list": empty,
  "mcp.test": z.object({ name: z.string().min(1).optional() }),
  "mcp.reload": empty,
  "gateway.status": empty,
  "gateway.start": empty,
  "gateway.stop": empty,
  "gateway.pair": gatewayPairParams,
  "gateway.devices": empty,
  "gateway.revoke": gatewayDeviceParams,
  "gateway.role": gatewayRoleParams,
  "gateway.stats": empty,
  "messaging.status": empty,
  "messaging.send": messagingSendParams,
  "agent.list": agentListParams,
  "agent.get": agentIdParams,
  "agent.cancel": agentIdParams,
  "agent.message": agentMessageParams,
  "agent.profiles": empty
} as const;

export type MethodName = keyof typeof methodParams;

export function methodParamsSchema(method: string): z.ZodTypeAny | undefined {
  return methodParams[method as MethodName];
}
