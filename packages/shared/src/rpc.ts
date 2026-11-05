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
  data: z.record(z.unknown()).optional()
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

export const sessionSendParams = z.object({
  sessionId: z.string().min(1),
  text: z.string().min(1).max(200_000),
  model: z.string().min(1).optional(),
  permissionMode: z.enum(["read-only", "ask", "accept-edits", "trusted", "custom"]).optional(),
  idempotencyKey: z.string().min(8).max(200).optional()
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

export const methodParams = {
  health: empty,
  shutdown: shutdownParams,
  "session.create": sessionCreateParams,
  "session.list": sessionListParams,
  "session.get": sessionGetParams,
  "session.send": sessionSendParams,
  "session.cancel": sessionCancelParams,
  "turn.get": turnGetParams,
  "turn.events": turnEventsParams,
  "model.list": empty,
  "provider.list": empty,
  "config.explain": configExplainParams,
  "provider.test": providerTestParams,
  "usage.summary": usageSummaryParams,
  "permission.respond": permissionRespondParams
} as const;

export type MethodName = keyof typeof methodParams;

export function methodParamsSchema(method: string): z.ZodTypeAny | undefined {
  return methodParams[method as MethodName];
}
