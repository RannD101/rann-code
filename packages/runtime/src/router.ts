import type { ModelDescriptor } from "./models.js";

export type RouteClass = "answer" | "extraction" | "inspect" | "coding" | "reasoning" | "review" | "writing" | "vision" | "embedding";

interface Weights {
  quality: number;
  taskFit: number;
  context: number;
  tool: number;
  cost: number;
  latency: number;
  health: number;
}

export const ROUTE_WEIGHTS: Record<RouteClass, Weights> = {
  answer: { quality: 0.2, taskFit: 0.1, context: 0.05, tool: 0.05, cost: 0.35, latency: 0.2, health: 0.05 },
  extraction: { quality: 0.15, taskFit: 0.1, context: 0.05, tool: 0.1, cost: 0.45, latency: 0.1, health: 0.05 },
  inspect: { quality: 0.2, taskFit: 0.15, context: 0.2, tool: 0.2, cost: 0.15, latency: 0.05, health: 0.05 },
  coding: { quality: 0.3, taskFit: 0.2, context: 0.15, tool: 0.2, cost: 0.08, latency: 0.02, health: 0.05 },
  reasoning: { quality: 0.45, taskFit: 0.2, context: 0.2, tool: 0.05, cost: 0.05, latency: 0, health: 0.05 },
  review: { quality: 0.4, taskFit: 0.25, context: 0.15, tool: 0.1, cost: 0.05, latency: 0, health: 0.05 },
  writing: { quality: 0.35, taskFit: 0.25, context: 0.2, tool: 0, cost: 0.1, latency: 0.05, health: 0.05 },
  vision: { quality: 0.25, taskFit: 0.2, context: 0.1, tool: 0.05, cost: 0.15, latency: 0.15, health: 0.1 },
  embedding: { quality: 0.2, taskFit: 0.1, context: 0.1, tool: 0.05, cost: 0.4, latency: 0.1, health: 0.05 }
};

const CODING = /\b(ubah|edit|refactor|perbaiki|fix|implement|buat file|tulis kode|test|debug|migrasi)\b/i;
const REVIEW = /\b(audit|review|periksa keamanan|security|celah|vulnerab)\b/i;
const REASONING = /\b(arsitektur|architecture|desain sistem|kenapa|analisis|analisa|rencana|strategi)\b/i;
const INSPECT = /\b(baca|lihat|cari|grep|telusuri|repo|kode ini|file)\b/i;
const EXTRACTION = /\b(ambil|ekstrak|klasifikasi|ringkas|simpulkan|daftar)\b/i;
const WRITING = /\b(tulis|dokumentasi|artikel|laporan|caption|prd)\b/i;
const VISION = /\b(gambar|screenshot|foto|diagram|vision|ocr)\b/i;
const EMBEDDING = /\b(embedding|indeks|index vektor)\b/i;

export function classifyRoute(text: string): RouteClass {
  const clean = text.trim();
  if (EMBEDDING.test(clean)) return "embedding";
  if (VISION.test(clean)) return "vision";
  if (REVIEW.test(clean)) return "review";
  if (CODING.test(clean)) return "coding";
  if (REASONING.test(clean)) return "reasoning";
  if (INSPECT.test(clean)) return "inspect";
  if (EXTRACTION.test(clean)) return "extraction";
  if (WRITING.test(clean)) return "writing";
  return "answer";
}

export type HealthState = "healthy" | "degraded" | "rate_limited" | "auth_error" | "down" | "unknown";

export interface RouteCandidate {
  model: string;
  score: number;
  reason: string;
}

export interface RouteDecision {
  taskClass: RouteClass;
  chosen: string | null;
  score: number;
  candidates: RouteCandidate[];
  policy: string;
  pinned: boolean;
  rejected: Array<{ model: string; reason: string }>;
  warning?: string;
}

export interface RouteInput {
  prompt: string;
  descriptors: ModelDescriptor[];
  estimatedTokens?: number;
  health?: Record<string, HealthState>;
  pinned?: string;
  policy?: string;
  prefer?: string[];
  minQuality?: number;
  maxCostPerTask?: number;
  strictBudget?: boolean;
  taskClass?: RouteClass;
}

function qualityFor(descriptor: ModelDescriptor, taskClass: RouteClass): number {
  const quality = descriptor.quality;
  if (!quality) return 0.5;
  if (taskClass === "coding") return quality.coding;
  if (taskClass === "reasoning") return quality.reasoning;
  if (taskClass === "review") return (quality.reasoning + quality.coding) / 2;
  if (taskClass === "writing") return quality.writing;
  return (quality.coding + quality.reasoning + quality.writing) / 3;
}

function latencyScore(descriptor: ModelDescriptor): number {
  if (descriptor.latencyClass === "fast") return 1;
  if (descriptor.latencyClass === "slow") return 0.2;
  return 0.6;
}

function healthScore(state: HealthState | undefined): number {
  if (state === "healthy" || state === undefined) return state === undefined ? 0.5 : 1;
  if (state === "degraded") return 0.6;
  if (state === "rate_limited") return 0.3;
  if (state === "unknown") return 0.5;
  return 0;
}

function priceOf(descriptor: ModelDescriptor): number | null {
  if (!descriptor.pricing) return null;
  return descriptor.pricing.inputPerMTok + descriptor.pricing.outputPerMTok;
}

function requiredCapability(taskClass: RouteClass): "toolCalling" | "vision" | "embeddings" | null {
  if (taskClass === "coding" || taskClass === "inspect" || taskClass === "review") return "toolCalling";
  if (taskClass === "vision") return "vision";
  if (taskClass === "embedding") return "embeddings";
  return null;
}

function findAlias(descriptors: ModelDescriptor[], name: string): ModelDescriptor | undefined {
  return descriptors.find((descriptor) => descriptor.id === name || descriptor.model === name || descriptor.aliases.includes(name));
}

export function routeModel(input: RouteInput): RouteDecision {
  const taskClass = input.taskClass ?? classifyRoute(input.prompt);
  const weights = ROUTE_WEIGHTS[taskClass];
  const estimated = input.estimatedTokens ?? Math.ceil(input.prompt.length / 4);
  const policy = input.policy ?? "balanced";
  const rejected: Array<{ model: string; reason: string }> = [];

  const pinnedDescriptor = input.pinned ? findAlias(input.descriptors, input.pinned) : undefined;
  if (pinnedDescriptor) {
    return {
      taskClass,
      chosen: pinnedDescriptor.id,
      score: 1,
      candidates: [{ model: pinnedDescriptor.id, score: 1, reason: "dipin oleh pengguna" }],
      policy,
      pinned: true,
      rejected
    };
  }

  const usable: Array<{ descriptor: ModelDescriptor; price: number | null; quality: number }> = [];
  for (const descriptor of input.descriptors) {
    if (descriptor.deprecated) {
      rejected.push({ model: descriptor.id, reason: "deprecated" });
      continue;
    }
    const state = input.health?.[descriptor.provider];
    if (state === "down" || state === "auth_error") {
      rejected.push({ model: descriptor.id, reason: `provider ${state}` });
      continue;
    }
    const capability = requiredCapability(taskClass);
    if (capability && !descriptor.capabilities[capability]) {
      rejected.push({ model: descriptor.id, reason: `tidak mendukung ${capability}` });
      continue;
    }
    if (descriptor.contextWindow < estimated) {
      rejected.push({ model: descriptor.id, reason: `context ${descriptor.contextWindow} < ${estimated}` });
      continue;
    }
    const quality = qualityFor(descriptor, taskClass);
    if (input.minQuality !== undefined && quality < input.minQuality) {
      rejected.push({ model: descriptor.id, reason: `quality ${quality.toFixed(2)} < ${input.minQuality}` });
      continue;
    }
    const price = priceOf(descriptor);
    usable.push({ descriptor, price, quality });
  }

  if (usable.length === 0) {
    return { taskClass, chosen: null, score: 0, candidates: [], policy, pinned: false, rejected, warning: "tidak ada kandidat yang lolos syarat" };
  }

  const prices = usable.map((item) => item.price).filter((price): price is number => price !== null);
  const minPrice = prices.length > 0 ? Math.min(...prices) : 0;
  const maxPrice = prices.length > 0 ? Math.max(...prices) : 0;
  const prefer = new Set(input.prefer ?? []);

  const candidates = usable.map(({ descriptor, price, quality }) => {
    const costScore = price === null ? 0.5 : maxPrice === minPrice ? 1 : 1 - (price - minPrice) / (maxPrice - minPrice);
    const contextScore = Math.min(1, descriptor.contextWindow / Math.max(estimated * 4, 1));
    const toolScore = descriptor.capabilities.toolCalling ? 1 : 0.5;
    const bonus = descriptor.aliases.some((alias) => prefer.has(alias)) || prefer.has(descriptor.model) ? 0.05 : 0;
    const score =
      weights.quality * quality +
      weights.taskFit * quality +
      weights.context * contextScore +
      weights.tool * toolScore +
      weights.cost * costScore +
      weights.latency * latencyScore(descriptor) +
      weights.health * healthScore(input.health?.[descriptor.provider]) +
      bonus;
    const parts = [
      `${taskClass} ${quality.toFixed(2)}`,
      `context ${descriptor.contextWindow}`,
      price === null ? "harga tidak diketahui" : `harga $${price.toFixed(2)}/Mtok`
    ];
    if (bonus > 0) parts.push("prefer");
    return { model: descriptor.id, score: Math.round(score * 1000) / 1000, reason: parts.join(", ") };
  });

  candidates.sort((a, b) => b.score - a.score);
  const limit = input.maxCostPerTask;
  const overBudget = limit !== undefined && usable.every((item) => item.price !== null && item.price > limit);
  if (overBudget && input.strictBudget) {
    return {
      taskClass,
      chosen: null,
      score: 0,
      candidates,
      policy,
      pinned: false,
      rejected,
      warning: `semua kandidat melebihi maxCostPerTask ${input.maxCostPerTask}; strictBudget aktif`
    };
  }
  if (overBudget) {
    const cheapest = [...usable].sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity))[0]!;
    const candidate = candidates.find((item) => item.model === cheapest.descriptor.id)!;
    return {
      taskClass,
      chosen: candidate.model,
      score: candidate.score,
      candidates,
      policy,
      pinned: false,
      rejected,
      warning: `semua kandidat melebihi maxCostPerTask ${input.maxCostPerTask}; memilih yang termurah`
    };
  }
  const best = candidates[0]!;
  return {
    taskClass,
    chosen: best.model,
    score: best.score,
    candidates,
    policy,
    pinned: false,
    rejected
  };
}
