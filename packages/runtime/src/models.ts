import { RannError, type RannConfig } from "@rann/shared";
import { getModel, getProvider, listModels, recordCapabilityChange, upsertModel, upsertProvider } from "@rann/storage";
import type { Db } from "@rann/storage";

export const CAPABILITIES = [
  "streaming",
  "toolCalling",
  "parallelToolCalls",
  "structuredOutput",
  "strictSchema",
  "reasoning",
  "vision",
  "audio",
  "pdf",
  "promptCaching",
  "embeddings"
] as const;

export type Capability = (typeof CAPABILITIES)[number];
export type ModelCapabilities = Record<Capability, boolean>;

export interface ModelPricing {
  inputPerMTok: number;
  outputPerMTok: number;
  cacheReadPerMTok?: number;
  cacheWritePerMTok?: number;
  currency: "USD";
  source: string;
  updatedAt: string;
}

export interface ModelDescriptor {
  id: string;
  provider: string;
  model: string;
  displayName: string;
  aliases: string[];
  contextWindow: number;
  maxOutputTokens: number;
  capabilities: ModelCapabilities;
  pricing?: ModelPricing;
  tokenizer?: { type: "provider" | "tiktoken" | "heuristic"; name?: string };
  quality?: { coding: number; reasoning: number; writing: number };
  latencyClass?: "fast" | "standard" | "slow";
  deprecated?: boolean;
  source?: "catalog" | "config" | "user";
  /** Asal capability: katalog bawaan, provider, config manual, atau asumsi aman. */
  capabilitySource?: "catalog" | "provider" | "config" | "manual" | "assumed";
  /** True bila capability belum diketahui dan memakai asumsi aman. */
  capabilitiesUnknown?: boolean;
}

const ALL_FALSE: ModelCapabilities = Object.fromEntries(CAPABILITIES.map((name) => [name, false])) as ModelCapabilities;

function caps(overrides: Partial<ModelCapabilities>): ModelCapabilities {
  return { ...ALL_FALSE, streaming: true, ...overrides };
}

interface CatalogEntry {
  match: RegExp;
  contextWindow: number;
  maxOutputTokens: number;
  capabilities: Partial<ModelCapabilities>;
  pricing?: Omit<ModelPricing, "currency" | "source" | "updatedAt">;
  quality?: ModelDescriptor["quality"];
  latencyClass?: ModelDescriptor["latencyClass"];
}

const CATALOG: CatalogEntry[] = [
  {
    match: /gpt-6|gpt-5|gpt-4\.1|gpt-4o/i,
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    capabilities: {
      toolCalling: true,
      parallelToolCalls: true,
      structuredOutput: true,
      strictSchema: true,
      reasoning: true,
      vision: true,
      promptCaching: true
    },
    quality: { coding: 0.92, reasoning: 0.9, writing: 0.9 },
    latencyClass: "standard"
  },
  {
    match: /claude/i,
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    capabilities: {
      toolCalling: true,
      parallelToolCalls: true,
      structuredOutput: true,
      reasoning: true,
      vision: true,
      pdf: true,
      promptCaching: true
    },
    quality: { coding: 0.93, reasoning: 0.92, writing: 0.92 },
    latencyClass: "standard"
  },
  {
    match: /gemini/i,
    contextWindow: 1_000_000,
    maxOutputTokens: 64_000,
    capabilities: {
      toolCalling: true,
      parallelToolCalls: true,
      structuredOutput: true,
      reasoning: true,
      vision: true,
      audio: true,
      pdf: true,
      promptCaching: true
    },
    quality: { coding: 0.88, reasoning: 0.88, writing: 0.86 },
    latencyClass: "fast"
  },
  {
    match: /deepseek/i,
    contextWindow: 128_000,
    maxOutputTokens: 32_000,
    capabilities: { toolCalling: true, structuredOutput: true, reasoning: true },
    quality: { coding: 0.85, reasoning: 0.86, writing: 0.8 },
    latencyClass: "standard"
  },
  {
    match: /embedding|embed/i,
    contextWindow: 8_192,
    maxOutputTokens: 0,
    capabilities: { embeddings: true },
    latencyClass: "fast"
  },
  {
    match: /mock/i,
    contextWindow: 32_000,
    maxOutputTokens: 4_000,
    capabilities: caps({ toolCalling: true, parallelToolCalls: true, structuredOutput: true, reasoning: true }),
    latencyClass: "fast"
  }
];

export function builtinDescriptor(provider: string, model: string, kind = "openai-compatible"): ModelDescriptor {
  const entry = CATALOG.find((candidate) => candidate.match.test(model));
  // Model yang tidak ada di katalog hanya diasumsikan streaming. Tool calling,
  // schema, dan vision tidak boleh dianggap ada sebelum dibuktikan provider,
  // dokumentasi, atau override manual (PRD FR-105 butir 4).
  const baseCaps =
    entry?.capabilities ??
    (kind === "mock" ? caps({ toolCalling: true, parallelToolCalls: true, structuredOutput: true, reasoning: true }) : caps({}));
  return {
    id: `${provider}/${model}`,
    provider,
    model,
    displayName: model,
    aliases: [],
    contextWindow: entry?.contextWindow ?? 128_000,
    maxOutputTokens: entry?.maxOutputTokens ?? 16_000,
    capabilities: caps(baseCaps),
    ...(entry?.pricing
      ? { pricing: { ...entry.pricing, currency: "USD" as const, source: "builtin", updatedAt: "2026-11-07" } }
      : {}),
    tokenizer: { type: "heuristic" },
    ...(entry?.quality ? { quality: entry.quality } : {}),
    latencyClass: entry?.latencyClass ?? "standard",
    source: entry ? "catalog" : "user",
    capabilitySource: entry ? "catalog" : "assumed",
    capabilitiesUnknown: entry === undefined
  };
}

export function mergeCapabilities(
  base: Partial<ModelCapabilities>,
  override?: Record<string, unknown>
): ModelCapabilities {
  const merged = {} as ModelCapabilities;
  for (const name of CAPABILITIES) {
    const value = base[name];
    merged[name] = typeof value === "boolean" ? value : name === "streaming";
  }
  if (!override) return merged;
  for (const name of CAPABILITIES) {
    const value = override[name];
    if (typeof value === "boolean") merged[name] = value;
  }
  return merged;
}

export interface ModelOverrides {
  contextWindow?: number;
  maxOutputTokens?: number;
  capabilities?: Record<string, unknown>;
  inputPrice?: number;
  outputPrice?: number;
  cacheReadPrice?: number;
  cacheWritePrice?: number;
  aliases?: string[];
}

export function resolveDescriptor(
  db: Db,
  config: RannConfig,
  providerName: string,
  requested?: string,
  overrides?: ModelOverrides
): ModelDescriptor {
  const providerConfig = config.providers[providerName];
  const kind = providerConfig?.kind ?? (providerName === "mock" ? "mock" : "openai-compatible");
  const aliasEntry = requested && requested !== "auto"
    ? Object.entries(config.models ?? {}).find(([, value]) => value.aliases.includes(requested))
    : undefined;
  let aliasedModel: string | undefined;
  if (aliasEntry) {
    const [key] = aliasEntry;
    const slash = key.indexOf("/");
    const aliasProvider = slash > 0 ? key.slice(0, slash) : providerName;
    if (aliasProvider !== providerName) {
      throw new RannError("E_CONFIG_INVALID", `Alias ${requested} menunjuk provider ${aliasProvider}, bukan ${providerName}`);
    }
    aliasedModel = slash > 0 ? key.slice(slash + 1) : key;
  }
  const modelName =
    aliasedModel ??
    (requested && requested !== "auto"
      ? requested
      : providerConfig?.default_model ?? providerConfig?.models[0] ?? (kind === "mock" ? "mock-1" : ""));
  if (!modelName) {
    throw new RannError("E_CONFIG_INVALID", `Model default belum ditentukan untuk provider ${providerName}`);
  }
  const base = builtinDescriptor(providerName, modelName, kind);
  const row = db ? getModel(db, providerName, modelName) : undefined;
  const rowCaps = row ? (JSON.parse(row.capabilities_json) as Record<string, unknown>) : undefined;
  const rowHasPrice =
    row !== undefined &&
    (row.input_price !== null || row.output_price !== null || row.cache_read_price !== null || row.cache_write_price !== null);
  const hasPriceOverride =
    overrides?.inputPrice !== undefined ||
    overrides?.outputPrice !== undefined ||
    overrides?.cacheReadPrice !== undefined ||
    overrides?.cacheWritePrice !== undefined;
  const cacheReadPrice = overrides?.cacheReadPrice ?? row?.cache_read_price ?? base.pricing?.cacheReadPerMTok;
  const cacheWritePrice = overrides?.cacheWritePrice ?? row?.cache_write_price ?? base.pricing?.cacheWritePerMTok;
  const isConfigured = config.models?.[`${providerName}/${modelName}`] !== undefined;
  const mergedCapabilities = mergeCapabilities(mergeCapabilities(base.capabilities, rowCaps), overrides?.capabilities);
  const rowSource = row?.capability_source as ModelDescriptor["capabilitySource"] | undefined;
  const capabilitySource: NonNullable<ModelDescriptor["capabilitySource"]> =
    overrides?.capabilities && Object.keys(overrides.capabilities).length > 0
      ? "manual"
      : rowCaps && Object.keys(rowCaps).length > 0
        ? (rowSource ?? "manual")
        : (base.capabilitySource ?? "assumed");
  const merged: ModelDescriptor = {
    ...base,
    source: isConfigured ? "config" : base.source,
    displayName: row?.display_name ?? base.displayName,
    contextWindow: overrides?.contextWindow ?? row?.context_window ?? base.contextWindow,
    maxOutputTokens: overrides?.maxOutputTokens ?? row?.max_output_tokens ?? base.maxOutputTokens,
    capabilities: mergedCapabilities,
    capabilitySource,
    capabilitiesUnknown: capabilitySource === "assumed",
    ...(hasPriceOverride || rowHasPrice
      ? {
          pricing: {
            inputPerMTok: overrides?.inputPrice ?? row?.input_price ?? base.pricing?.inputPerMTok ?? 0,
            outputPerMTok: overrides?.outputPrice ?? row?.output_price ?? base.pricing?.outputPerMTok ?? 0,
            ...(cacheReadPrice !== undefined ? { cacheReadPerMTok: cacheReadPrice } : {}),
            ...(cacheWritePrice !== undefined ? { cacheWritePerMTok: cacheWritePrice } : {}),
            currency: "USD" as const,
            source: "manual",
            updatedAt: new Date().toISOString()
          }
        }
      : {}),
    aliases: overrides?.aliases ?? []
  };
  return merged;
}

export function seedRegistry(db: Db, config: RannConfig): void {
  for (const [name, provider] of Object.entries(config.providers)) {
    upsertProvider(db, {
      name,
      kind: provider.kind,
      ...(provider.base_url ? { baseUrl: provider.base_url } : {}),
      ...(provider.default_model ? { defaultModel: provider.default_model } : {}),
      models: provider.models,
      headers: provider.headers,
      timeoutMs: provider.timeout_ms,
      stream: provider.stream
    });
    for (const model of provider.models) {
      const descriptor = builtinDescriptor(name, model, provider.kind);
      const override = config.models?.[`${name}/${model}`];
      const previous = getModel(db, name, model);
      // Capability hasil discovery tidak boleh ditimpa katalog setiap kali
      // daemon start; config hanya menambah override di atasnya.
      const baseCaps =
        previous?.capability_source === "provider"
          ? (JSON.parse(previous.capabilities_json) as Partial<ModelCapabilities>)
          : descriptor.capabilities;
      logCapabilityChanges(db, name, model, override?.capabilities, "config", baseCaps);
      upsertModel(db, {
        provider: name,
        name: model,
        displayName: descriptor.displayName,
        contextWindow: override?.context_window ?? descriptor.contextWindow,
        maxOutputTokens: override?.max_output_tokens ?? descriptor.maxOutputTokens,
        capabilities: mergeCapabilities(baseCaps, override?.capabilities),
        capabilitySource: override?.capabilities
          ? "config"
          : previous?.capability_source === "provider"
            ? "provider"
            : "catalog",
        ...(previous ? { available: previous.available === 1 } : {}),
        ...(override?.input_price !== undefined ? { inputPrice: override.input_price } : {}),
        ...(override?.output_price !== undefined ? { outputPrice: override.output_price } : {}),
        ...(override?.cache_read_price !== undefined ? { cacheReadPrice: override.cache_read_price } : {}),
        ...(override?.cache_write_price !== undefined ? { cacheWritePrice: override.cache_write_price } : {})
      });
    }
    if (provider.default_model && !provider.models.includes(provider.default_model)) {
      const descriptor = builtinDescriptor(name, provider.default_model, provider.kind);
      upsertModel(db, {
        provider: name,
        name: provider.default_model,
        displayName: descriptor.displayName,
        contextWindow: descriptor.contextWindow,
        maxOutputTokens: descriptor.maxOutputTokens,
        capabilities: descriptor.capabilities
      });
    }
  }
}

/**
 * Config manual yang mengubah capability dicatat dengan sumber `config` supaya
 * perbedaan antara katalog dan keadaan nyata bisa ditelusuri (FR-105 butir 5).
 */
function logCapabilityChanges(
  db: Db,
  provider: string,
  model: string,
  override: Record<string, boolean> | undefined,
  source: string,
  baseCaps: Partial<ModelCapabilities>
): void {
  if (!override || Object.keys(override).length === 0) return;
  const row = getModel(db, provider, model);
  const before = row ? (JSON.parse(row.capabilities_json) as Record<string, unknown>) : {};
  const merged = mergeCapabilities(baseCaps, override);
  for (const capability of CAPABILITIES) {
    // Saat model pertama kali terdaftar, capability bawaan bukan "perubahan":
    // yang dicatat hanya kunci yang memang diatur di config.
    if (!row && capability in override === false) continue;
    const previous = typeof before[capability] === "boolean" ? (before[capability] as boolean) : undefined;
    if (previous === merged[capability]) continue;
    recordCapabilityChange(db, {
      provider,
      model,
      capability,
      ...(previous === undefined ? {} : { oldValue: previous }),
      newValue: merged[capability],
      source
    });
  }
}

export function registrySnapshot(db: Db, config: RannConfig): ModelDescriptor[] {
  seedRegistry(db, config);
  const providers = Object.keys(config.providers);
  const output: ModelDescriptor[] = [];
  for (const provider of providers) {
    for (const row of listModels(db, provider)) {
      const aliases = config.models?.[`${provider}/${row.name}`]?.aliases ?? [];
      const descriptor = resolveDescriptor(db, config, provider, row.name, { aliases });
      output.push(descriptor);
    }
  }
  if (output.length === 0 && config.provider === "mock") {
    output.push(resolveDescriptor(db, config, "mock", "mock-1"));
  }
  return output;
}

export function providerRow(db: Db, name: string): ReturnType<typeof getProvider> {
  return getProvider(db, name);
}

export function requireCapability(descriptor: ModelDescriptor, capability: Capability, context: string): void {
  if (!descriptor.capabilities[capability]) {
    throw new RannError(
      "E_PROVIDER_CAPABILITY",
      `Model ${descriptor.id} tidak mendukung ${capability} untuk ${context}`,
      { data: { model: descriptor.id, capability } }
    );
  }
}

export function costFor(
  descriptor: ModelDescriptor,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens = 0,
  cacheWriteTokens = 0
): number | null {
  if (!descriptor.pricing) return null;
  const input = (inputTokens / 1_000_000) * descriptor.pricing.inputPerMTok;
  const output = (outputTokens / 1_000_000) * descriptor.pricing.outputPerMTok;
  // Harga cache yang tidak diisi memakai harga input biasa supaya biaya tidak tercatat terlalu rendah.
  const cacheRead = (cacheReadTokens / 1_000_000) * (descriptor.pricing.cacheReadPerMTok ?? descriptor.pricing.inputPerMTok);
  const cacheWrite = (cacheWriteTokens / 1_000_000) * (descriptor.pricing.cacheWritePerMTok ?? descriptor.pricing.inputPerMTok);
  return Math.round((input + output + cacheRead + cacheWrite) * 1_000_000) / 1_000_000;
}
