import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { RannError } from "@rann/shared";

const MAX_BODY = 5 * 1024 * 1024;
const MAX_TEXT = 200_000;
const USER_AGENT = "RannBot/1.0 (+https://github.com/RannD101/rann-code)";
const SEARCH_TIMEOUT = 20_000;

function privateAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const parts = address.split(".").map(Number);
    const [a, b] = parts;
    if (a === undefined || b === undefined) return true;
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  const value = address.toLowerCase();
  return value === "::1" || value === "::" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe80");
}

export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new RannError("E_TOOL_INVALID_ARGS", `URL tidak valid: ${raw}`);
  }
  if (!["http:", "https:"].includes(url.protocol)) throw new RannError("E_PERMISSION", "Hanya http dan https yang diizinkan");
  if (url.username || url.password) throw new RannError("E_PERMISSION", "URL tidak boleh membawa kredensial");
  const host = url.hostname;
  if (host === "localhost" || host.endsWith(".localhost")) throw new RannError("E_PERMISSION", "Host lokal diblokir");
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true });
  if (addresses.some((entry) => privateAddress(entry.address))) {
    throw new RannError("E_PERMISSION", `Alamat privat diblokir: ${host}`);
  }
  return url;
}

async function robotsAllows(url: URL): Promise<boolean> {
  try {
    const robots = new URL("/robots.txt", url.origin);
    const response = await fetch(robots, { signal: AbortSignal.timeout(5_000), headers: { "user-agent": USER_AGENT } });
    if (!response.ok) return true;
    const body = (await response.text()).slice(0, 100_000);
    const lines = body.split("\n").map((line) => line.replace(/#.*/, "").trim());
    let applies = false;
    let best = "";
    const rules: Array<{ allow: boolean; path: string }> = [];
    for (const line of lines) {
      const [rawKey, ...rest] = line.split(":");
      const key = rawKey?.trim().toLowerCase();
      const value = rest.join(":").trim();
      if (key === "user-agent") {
        applies = value === "*" || USER_AGENT.toLowerCase().includes(value.toLowerCase());
        best = value;
      } else if (applies && (key === "allow" || key === "disallow") && value) {
        rules.push({ allow: key === "allow", path: value });
      }
    }
    void best;
    const path = `${url.pathname}${url.search}`;
    const matches = rules.filter((rule) => path.startsWith(rule.path)).sort((a, b) => b.path.length - a.path.length);
    return matches.length === 0 ? true : (matches[0]?.allow ?? true);
  } catch {
    return true;
  }
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export interface FetchResult {
  url: string;
  status: number;
  content_type: string;
  bytes: number;
  text: string;
  truncated: boolean;
}

export async function httpFetch(input: { url: string; method?: string; headers?: Record<string, string>; body?: string; max_chars?: number; ignore_robots?: boolean }): Promise<FetchResult> {
  const url = await assertPublicUrl(input.url);
  if (!input.ignore_robots && !(await robotsAllows(url))) throw new RannError("E_PERMISSION", `robots.txt melarang ${url.pathname}`);
  const method = (input.method ?? "GET").toUpperCase();
  if (!["GET", "HEAD", "POST"].includes(method)) throw new RannError("E_PERMISSION", "Metode HTTP yang diizinkan: GET, HEAD, POST");
  const response = await fetch(url, {
    method,
    headers: { "user-agent": USER_AGENT, accept: "text/html,application/json,text/plain,*/*", ...(input.headers ?? {}) },
    ...(input.body !== undefined && method !== "GET" && method !== "HEAD" ? { body: input.body } : {}),
    redirect: "follow",
    signal: AbortSignal.timeout(30_000)
  });
  if (response.status === 429) {
    const retryAfter = Number(response.headers.get("retry-after") ?? "");
    throw new RannError("E_PROVIDER_RATE_LIMIT", `HTTP 429 dari ${url.hostname}`, {
      data: { status: 429, ...(Number.isFinite(retryAfter) && retryAfter > 0 ? { retryAfterMs: retryAfter * 1000 } : {}) }
    });
  }
  if (response.status >= 500) {
    throw new RannError("E_PROVIDER_UNAVAILABLE", `HTTP ${response.status} dari ${url.hostname}`, {
      data: { status: response.status }
    });
  }
  const contentType = response.headers.get("content-type") ?? "";
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_BODY) throw new RannError("E_INPUT_TOO_LARGE", `Respons melebihi ${MAX_BODY} byte`);
  const maxChars = Math.min(input.max_chars ?? MAX_TEXT, MAX_TEXT);
  let text: string;
  if (/json/i.test(contentType)) {
    try {
      text = JSON.stringify(JSON.parse(buffer.toString("utf8")), null, 2);
    } catch {
      text = buffer.toString("utf8");
    }
  } else if (/html/i.test(contentType)) {
    text = htmlToText(buffer.toString("utf8"));
  } else if (/text|xml|csv|markdown/i.test(contentType)) {
    text = buffer.toString("utf8");
  } else {
    text = `[biner ${contentType}] ${buffer.byteLength} byte`;
  }
  return {
    url: response.url,
    status: response.status,
    content_type: contentType,
    bytes: buffer.byteLength,
    text: text.slice(0, maxChars),
    truncated: text.length > maxChars
  };
}

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

function decodeHtml(value: string): string {
  return htmlToText(value);
}

async function tavilySearch(query: string, limit: number): Promise<SearchHit[]> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return [];
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ api_key: key, query, max_results: limit, search_depth: "basic" }),
    signal: AbortSignal.timeout(SEARCH_TIMEOUT)
  });
  if (!response.ok) throw new RannError("E_TOOL_FAILED", `Tavily HTTP ${response.status}`);
  const data = (await response.json()) as { results?: Array<{ title?: string; url?: string; content?: string }> };
  return (data.results ?? []).flatMap((item) =>
    item.title && item.url ? [{ title: item.title, url: item.url, snippet: item.content ?? "" }] : []
  );
}

async function braveSearch(query: string, limit: number): Promise<SearchHit[]> {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) return [];
  const url = new URL("https://api.search.brave.com/res/v1/web/search");
  url.searchParams.set("q", query);
  url.searchParams.set("count", String(limit));
  const response = await fetch(url, {
    headers: { "x-subscription-token": key, accept: "application/json" },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT)
  });
  if (!response.ok) throw new RannError("E_TOOL_FAILED", `Brave HTTP ${response.status}`);
  const data = (await response.json()) as { web?: { results?: Array<{ title?: string; url?: string; description?: string }> } };
  return (data.web?.results ?? []).flatMap((item) =>
    item.title && item.url ? [{ title: item.title, url: item.url, snippet: decodeHtml(item.description ?? "") }] : []
  );
}

async function duckSearch(query: string, limit: number): Promise<SearchHit[]> {
  const url = new URL("https://html.duckduckgo.com/html/");
  url.searchParams.set("q", query);
  const response = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/126 Safari/537.36" },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT)
  });
  if (!response.ok) throw new RannError("E_TOOL_FAILED", `DuckDuckGo HTTP ${response.status}`);
  const html = await response.text();
  const hits: SearchHit[] = [];
  const pattern = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  for (const match of html.matchAll(pattern)) {
    const raw = match[1] ?? "";
    const target = raw.startsWith("//duckduckgo.com/l/") ? new URL(`https:${raw}`).searchParams.get("uddg") ?? "" : raw;
    if (!target) continue;
    hits.push({ title: decodeHtml(match[2] ?? ""), url: target, snippet: decodeHtml(match[3] ?? "") });
    if (hits.length >= limit) break;
  }
  return hits;
}

export async function webSearch(query: string, limit = 5): Promise<{ query: string; provider: string; results: SearchHit[] }> {
  if (process.env.TAVILY_API_KEY) return { query, provider: "tavily", results: await tavilySearch(query, limit) };
  if (process.env.BRAVE_SEARCH_API_KEY) return { query, provider: "brave", results: await braveSearch(query, limit) };
  const results = await duckSearch(query, limit);
  if (results.length === 0) throw new RannError("E_TOOL_FAILED", "Pencarian tidak mengembalikan hasil. Set TAVILY_API_KEY atau BRAVE_SEARCH_API_KEY untuk hasil stabil.");
  return { query, provider: "duckduckgo", results };
}
