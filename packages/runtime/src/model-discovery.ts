import { RannError, type ProviderConfig, type RannConfig } from "@rann/shared";
import {
  getModel,
  listModels,
  recordCapabilityChange,
  setModelAvailability,
  getProvider,
  upsertModel,
  upsertProvider,
  type Db
} from "@rann/storage";
import type { SecretStore } from "@rann/storage";
import { createProvider } from "./providers/index.js";
import { CAPABILITIES, builtinDescriptor, mergeCapabilities } from "./models.js";

export interface DiscoverOptions {
  force?: boolean;
  maxAgeMs?: number;
  persist?: boolean;
  now?: number;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}

export interface DiscoverResult {
  provider: string;
  supported: boolean;
  cached: boolean;
  fetched_at: number | null;
  discovered: string[];
  added: string[];
  unavailable: string[];
  capability_changes: number;
  reason?: string;
}

const DEFAULT_MAX_AGE_MS = 6 * 60 * 60 * 1_000;

function configuredModels(config: RannConfig, providerName: string): string[] {
  const entry = config.providers[providerName];
  return entry?.models ?? [];
}

export function lastDiscoveryAt(db: Db, providerName: string): number | null {
  const row = db
    .prepare(
      `SELECT MAX(discovered_at) AS last FROM models
       WHERE discovered_at IS NOT NULL AND provider_id = (SELECT id FROM providers WHERE name = ?)`
    )
    .get(providerName) as { last: number | null } | undefined;
  return row?.last ?? null;
}

/**
 * Mengambil daftar model dari provider bila adapter mendukung `listModels`,
 * menyimpannya ke registry, dan menandai model lama yang tidak muncul lagi
 * sebagai `unavailable`. Model tidak pernah dihapus supaya sesi lama tetap bisa
 * menjelaskan model yang sudah tidak tersedia.
 */
export async function discoverModels(
  db: Db,
  config: RannConfig,
  providerName: string,
  secrets?: SecretStore,
  options: DiscoverOptions = {}
): Promise<DiscoverResult> {
  const providerConfig = config.providers[providerName];
  if (!providerConfig && providerName !== "mock") {
    throw new RannError("E_CONFIG_INVALID", `Provider ${providerName} belum terdaftar di config`, {
      data: { provider: providerName }
    });
  }
  const now = options.now ?? Date.now();
  const persist = options.persist ?? true;
  const cachedAt = lastDiscoveryAt(db, providerName);
  const maxAge = options.maxAgeMs ?? DEFAULT_MAX_AGE_MS;
  const existing = listModels(db, providerName, { includeUnavailable: true }).map((row) => row.name);

  if (!options.force && cachedAt !== null && now - cachedAt < maxAge) {
    const available = listModels(db, providerName).map((row) => row.name);
    return {
      provider: providerName,
      supported: true,
      cached: true,
      fetched_at: cachedAt,
      discovered: available,
      added: [],
      unavailable: existing.filter((name) => !available.includes(name)),
      capability_changes: 0
    };
  }

  const provider = createProvider(
    providerName,
    (providerConfig ?? ({ kind: "mock", models: ["mock-1"] } as unknown)) as ProviderConfig,
    options.env ?? process.env,
    secrets
  );
  if (typeof provider.listModels !== "function" || !provider.support.listModels) {
    return {
      provider: providerName,
      supported: false,
      cached: false,
      fetched_at: null,
      discovered: existing,
      added: [],
      unavailable: [],
      capability_changes: 0,
      reason: `Adapter ${provider.kind} tidak punya method listModels`
    };
  }

  const remote = await provider.listModels();
  const kind = providerConfig?.kind ?? "mock";
  const ids = remote.map((entry) => entry.id);
  const added: string[] = [];
  let capabilityChanges = 0;

  if (persist) {
    // Discovery bisa dipanggil sebelum registry pernah di-seed, jadi baris
    // provider dipastikan ada lebih dulu.
    if (!getProvider(db, providerName)) {
      upsertProvider(db, {
        name: providerName,
        kind,
        ...(providerConfig?.base_url ? { baseUrl: providerConfig.base_url } : {}),
        ...(providerConfig?.default_model ? { defaultModel: providerConfig.default_model } : {}),
        models: configuredModels(config, providerName),
        ...(providerConfig?.headers ? { headers: providerConfig.headers } : {}),
        ...(providerConfig?.timeout_ms ? { timeoutMs: providerConfig.timeout_ms } : {}),
        stream: providerConfig?.stream ?? true
      });
    }
    for (const info of remote) {
      const base = builtinDescriptor(providerName, info.id, kind);
      const capabilities = mergeCapabilities(base.capabilities, info.capabilities);
      const previous = getModel(db, providerName, info.id);
      const previousCaps = previous ? (JSON.parse(previous.capabilities_json) as Record<string, unknown>) : undefined;
      if (!previous) added.push(info.id);
      upsertModel(db, {
        provider: providerName,
        name: info.id,
        displayName: info.displayName ?? info.id,
        contextWindow: info.contextWindow ?? base.contextWindow,
        maxOutputTokens: info.maxOutputTokens ?? base.maxOutputTokens,
        capabilities,
        available: true,
        discoveredAt: now,
        capabilitySource: "provider"
      });
      for (const capability of CAPABILITIES) {
        const before = typeof previousCaps?.[capability] === "boolean" ? (previousCaps[capability] as boolean) : undefined;
        if (before === capabilities[capability]) continue;
        if (before === undefined && previous !== undefined) continue;
        recordCapabilityChange(db, {
          provider: providerName,
          model: info.id,
          capability,
          ...(before === undefined ? {} : { oldValue: before }),
          newValue: capabilities[capability],
          source: "provider"
        });
        capabilityChanges += 1;
      }
    }

    for (const row of listModels(db, providerName, { includeUnavailable: true })) {
      if (ids.includes(row.name)) continue;
      if (row.available !== 1) continue;
      if (row.discovered_at === null && configuredModels(config, providerName).includes(row.name)) continue;
      setModelAvailability(db, providerName, row.name, false, now);
    }
  }

  const unavailable = persist
    ? listModels(db, providerName, { includeUnavailable: true })
        .filter((row) => row.available !== 1)
        .map((row) => row.name)
    : [];
  const discovered = persist ? listModels(db, providerName).map((row) => row.name) : ids;
  return {
    provider: providerName,
    supported: true,
    cached: false,
    fetched_at: now,
    discovered,
    added,
    unavailable,
    capability_changes: capabilityChanges
  };
}

export async function discoverAllProviders(
  db: Db,
  config: RannConfig,
  secrets?: SecretStore,
  options: DiscoverOptions = {}
): Promise<DiscoverResult[]> {
  const names = new Set<string>([...Object.keys(config.providers), config.provider, "mock"]);
  const results: DiscoverResult[] = [];
  for (const name of names) {
    if (name !== "mock" && !config.providers[name]) continue;
    try {
      results.push(await discoverModels(db, config, name, secrets, options));
    } catch (error) {
      results.push({
        provider: name,
        supported: false,
        cached: false,
        fetched_at: null,
        discovered: [],
        added: [],
        unavailable: [],
        capability_changes: 0,
        reason: error instanceof RannError ? `${error.code}: ${error.message}` : (error as Error).message
      });
    }
  }
  return results;
}
