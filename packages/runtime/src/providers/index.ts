import { readFileSync } from "node:fs";
import { RannError, type ProviderConfig } from "@rann/shared";
import { MockProvider } from "./mock.js";
import { OpenAiCompatibleProvider } from "./openai.js";
import { AnthropicProvider } from "./anthropic.js";
import { GeminiProvider } from "./gemini.js";
import { OpenAiResponsesProvider } from "./openai-responses.js";
import type { Provider } from "./types.js";
import type { SecretStore } from "@rann/storage";

export * from "./types.js";
export { MockProvider, OpenAiCompatibleProvider, AnthropicProvider, GeminiProvider, OpenAiResponsesProvider };

export function createProvider(
  name: string,
  config: ProviderConfig,
  env: NodeJS.ProcessEnv = process.env,
  secrets?: SecretStore
): Provider {
  if (config.kind === "mock") return new MockProvider();

  const baseUrl = config.base_url ?? (config.kind === "openrouter" ? "https://openrouter.ai/api/v1" : undefined);
  if (!baseUrl) {
    throw new RannError("E_CONFIG_INVALID", `Provider ${name} butuh base_url`, { data: { provider: name } });
  }

  let apiKey = "";
  if (config.api_key_ref && secrets) apiKey = secrets.get(config.api_key_ref) ?? "";
  if (config.api_key_env) apiKey = env[config.api_key_env] ?? "";
  if (!apiKey && config.api_key_file) {
    try {
      apiKey = readFileSync(config.api_key_file, "utf8").trim();
    } catch (error) {
      throw new RannError("E_PROVIDER_AUTH", `File API key tidak bisa dibaca: ${config.api_key_file}`, { cause: error });
    }
  }
  if (!apiKey) {
    throw new RannError("E_PROVIDER_AUTH", `API key provider ${name} belum diset. Isi env ${config.api_key_env ?? "<kosong>"} atau api_key_file.`, {
      data: { provider: name }
    });
  }

  if (config.kind === "openrouter") {
    return new OpenAiCompatibleProvider({
      name,
      baseUrl,
      apiKey,
      headers: {
        "HTTP-Referer": "https://github.com/RannD101/rann-code",
        "X-Title": "Rann Code",
        ...config.headers
      },
      timeoutMs: config.timeout_ms
    });
  }

  if (config.kind === "anthropic") {
    return new AnthropicProvider({
      name,
      baseUrl,
      apiKey,
      headers: config.headers,
      timeoutMs: config.timeout_ms
    });
  }

  if (config.kind === "gemini") {
    return new GeminiProvider({
      name,
      baseUrl,
      apiKey,
      headers: config.headers,
      timeoutMs: config.timeout_ms
    });
  }

  if (config.kind === "openai-responses") {
    return new OpenAiResponsesProvider({
      name,
      baseUrl,
      apiKey,
      headers: config.headers,
      timeoutMs: config.timeout_ms
    });
  }

  return new OpenAiCompatibleProvider({
    name,
    baseUrl,
    apiKey,
    headers: config.headers,
    timeoutMs: config.timeout_ms,
    stream: config.stream
  });
}

export function resolveModel(config: ProviderConfig, requested?: string): string {
  if (requested && requested !== "auto") return requested;
  if (config.default_model) return config.default_model;
  if (config.models.length > 0) return config.models[0]!;
  if (config.kind === "mock") return "mock-1";
  throw new RannError("E_CONFIG_INVALID", "Model default belum ditentukan untuk provider ini");
}
