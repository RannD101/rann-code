import { newId } from "@rann/shared";
import type { Db } from "./db.js";

export interface ProviderRow {
  id: string;
  name: string;
  kind: string;
  base_url: string | null;
  api_key_ref: string | null;
  default_model: string | null;
  models_json: string;
  headers_json: string;
  timeout_ms: number;
  stream: number;
  enabled: number;
  created_at: number;
  updated_at: number;
}

export interface ModelRow {
  id: string;
  provider_id: string;
  name: string;
  display_name: string | null;
  context_window: number | null;
  max_output_tokens: number | null;
  input_price: number | null;
  output_price: number | null;
  cache_read_price: number | null;
  cache_write_price: number | null;
  capabilities_json: string;
  created_at: number;
  updated_at: number;
}

export interface AddProviderInput {
  name: string;
  kind: string;
  baseUrl?: string;
  apiKeyRef?: string;
  defaultModel?: string;
  models?: string[];
  headers?: Record<string, string>;
  timeoutMs?: number;
  stream?: boolean;
  enabled?: boolean;
}

export interface AddModelInput {
  provider: string;
  name: string;
  displayName?: string;
  contextWindow?: number;
  maxOutputTokens?: number;
  inputPrice?: number;
  outputPrice?: number;
  cacheReadPrice?: number;
  cacheWritePrice?: number;
  capabilities?: Record<string, boolean>;
}

export function upsertProvider(db: Db, input: AddProviderInput): ProviderRow {
  const now = Date.now();
  db.prepare(
    `INSERT INTO providers (id, name, kind, base_url, api_key_ref, default_model, models_json, headers_json, timeout_ms, stream, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET
       kind = excluded.kind,
       base_url = excluded.base_url,
       api_key_ref = excluded.api_key_ref,
       default_model = excluded.default_model,
       models_json = excluded.models_json,
       headers_json = excluded.headers_json,
       timeout_ms = excluded.timeout_ms,
       stream = excluded.stream,
       enabled = excluded.enabled,
       updated_at = excluded.updated_at`
  ).run(
    newId("prov"),
    input.name,
    input.kind,
    input.baseUrl ?? null,
    input.apiKeyRef ?? null,
    input.defaultModel ?? null,
    JSON.stringify(input.models ?? []),
    JSON.stringify(input.headers ?? {}),
    input.timeoutMs ?? 120_000,
    input.stream === false ? 0 : 1,
    input.enabled === false ? 0 : 1,
    now,
    now
  );
  return db.prepare("SELECT * FROM providers WHERE name = ?").get(input.name) as ProviderRow;
}

export function listProviders(db: Db): ProviderRow[] {
  return db.prepare("SELECT * FROM providers ORDER BY name").all() as ProviderRow[];
}

export function getProvider(db: Db, name: string): ProviderRow | undefined {
  return db.prepare("SELECT * FROM providers WHERE name = ?").get(name) as ProviderRow | undefined;
}

export function upsertModel(db: Db, input: AddModelInput): ModelRow {
  const provider = getProvider(db, input.provider);
  if (!provider) throw new Error(`Provider belum terdaftar: ${input.provider}`);
  const now = Date.now();
  db.prepare(
    `INSERT INTO models (id, provider_id, name, display_name, context_window, max_output_tokens, input_price, output_price, cache_read_price, cache_write_price, capabilities_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(provider_id, name) DO UPDATE SET
       display_name = excluded.display_name,
       context_window = excluded.context_window,
       max_output_tokens = excluded.max_output_tokens,
       input_price = excluded.input_price,
       output_price = excluded.output_price,
       cache_read_price = excluded.cache_read_price,
       cache_write_price = excluded.cache_write_price,
       capabilities_json = excluded.capabilities_json,
       updated_at = excluded.updated_at`
  ).run(
    newId("mdl"),
    provider.id,
    input.name,
    input.displayName ?? input.name,
    input.contextWindow ?? null,
    input.maxOutputTokens ?? null,
    input.inputPrice ?? null,
    input.outputPrice ?? null,
    input.cacheReadPrice ?? null,
    input.cacheWritePrice ?? null,
    JSON.stringify(input.capabilities ?? {}),
    now,
    now
  );
  return db.prepare("SELECT * FROM models WHERE provider_id = ? AND name = ?").get(provider.id, input.name) as ModelRow;
}

export function listModels(db: Db, providerName?: string): ModelRow[] {
  if (!providerName) return db.prepare("SELECT * FROM models ORDER BY name").all() as ModelRow[];
  const provider = getProvider(db, providerName);
  if (!provider) return [];
  return db.prepare("SELECT * FROM models WHERE provider_id = ? ORDER BY name").all(provider.id) as ModelRow[];
}

export function getModel(db: Db, providerName: string, modelName: string): ModelRow | undefined {
  const provider = getProvider(db, providerName);
  if (!provider) return undefined;
  return db.prepare("SELECT * FROM models WHERE provider_id = ? AND name = ?").get(provider.id, modelName) as
    | ModelRow
    | undefined;
}

export interface RoutingLogInput {
  sessionId?: string;
  turnId?: string;
  requestedModel?: string;
  selectedModel: string;
  reason?: string;
  fallbackChain?: string[];
  latencyMs?: number;
}

export function recordRoutingLog(db: Db, input: RoutingLogInput): void {
  db.prepare(
    `INSERT INTO routing_logs (id, session_id, turn_id, requested_model, selected_model, reason, fallback_chain_json, latency_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    newId("route"),
    input.sessionId ?? null,
    input.turnId ?? null,
    input.requestedModel ?? null,
    input.selectedModel,
    input.reason ?? "",
    JSON.stringify(input.fallbackChain ?? []),
    input.latencyMs ?? null,
    Date.now()
  );
}

export function setTurnModel(db: Db, turnId: string, model: string): void {
  db.prepare("UPDATE turns SET model = ?, updated_at = ? WHERE id = ?").run(model, Date.now(), turnId);
}
