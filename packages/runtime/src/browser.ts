import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { RannError } from "@rann/shared";

export type BrowserAction =
  | "navigate"
  | "click"
  | "type"
  | "scroll"
  | "select"
  | "screenshot"
  | "extract"
  | "download"
  | "upload"
  | "evaluate"
  | "wait"
  | "close";

export interface BrowserActionInput {
  action: BrowserAction;
  url?: string;
  selector?: string;
  text?: string;
  value?: string;
  path?: string;
  script?: string;
  delta_y?: number;
  timeout_ms?: number;
  full_page?: boolean;
}

export interface BrowserConfig {
  enabled?: boolean;
  headless?: boolean;
  timeout_ms?: number;
  blocked_domains?: string[];
  max_text?: number;
  artifacts_dir?: string;
  user_agent?: string;
  persistent_profile?: string;
}

interface BrowserContextHandle {
  context: import("playwright").BrowserContext;
  page: import("playwright").Page;
  created_at: number;
  last_used: number;
  persistent: boolean;
}

const MAX_TEXT = 100_000;
const MAX_SCRIPT = 8_000;
const DEFAULT_TIMEOUT = 30_000;
const IDLE_MS = 10 * 60 * 1_000;

function blockedHost(url: string, blocked: string[]): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return blocked.some((item) => {
      const pattern = item.toLowerCase().trim();
      if (!pattern) return false;
      return host === pattern || host.endsWith(`.${pattern}`);
    });
  } catch {
    return true;
  }
}

function safeEvaluateScript(script: string): string {
  if (script.length > MAX_SCRIPT) throw new RannError("E_TOOL_INVALID_ARGS", `Skrip evaluate maksimal ${MAX_SCRIPT} karakter`);
  if (/\b(require|import|process|globalThis|Function\s*\(|eval\s*\()\b/.test(script)) {
    throw new RannError("E_PERMISSION", "Skrip evaluate tidak boleh mengakses require, import, process, atau eval");
  }
  if (/\b(fetch|XMLHttpRequest|WebSocket|EventSource)\b/.test(script)) {
    throw new RannError("E_PERMISSION", "Skrip evaluate tidak boleh melakukan request jaringan; pakai aksi navigate atau extract");
  }
  return script;
}

export class BrowserManager {
  private browser?: import("playwright").Browser;
  private contexts = new Map<string, BrowserContextHandle>();
  private readonly config: Required<Pick<BrowserConfig, "enabled" | "headless" | "timeout_ms" | "blocked_domains" | "max_text" | "artifacts_dir">> & BrowserConfig;

  constructor(
    workspaceRoot: string,
    config: BrowserConfig = {},
    private readonly profileDir?: string
  ) {
    this.config = {
      enabled: config.enabled ?? true,
      headless: config.headless ?? true,
      timeout_ms: config.timeout_ms ?? DEFAULT_TIMEOUT,
      blocked_domains: config.blocked_domains ?? [],
      max_text: config.max_text ?? MAX_TEXT,
      artifacts_dir: config.artifacts_dir ?? join(workspaceRoot, ".rann", "artifacts"),
      ...config
    };
  }

  private async ensureBrowser(): Promise<import("playwright").Browser> {
    if (this.browser?.isConnected()) return this.browser;
    let playwright: typeof import("playwright");
    try {
      playwright = await import("playwright");
    } catch {
      throw new RannError("E_UNSUPPORTED", "Playwright belum terpasang. Jalankan: npm install playwright && npx playwright install chromium");
    }
    this.browser = await playwright.chromium.launch({ headless: this.config.headless });
    return this.browser;
  }

  private async handle(taskKey: string, persistent = false): Promise<BrowserContextHandle> {
    const existing = this.contexts.get(taskKey);
    if (existing) {
      existing.last_used = Date.now();
      return existing;
    }
    const browser = await this.ensureBrowser();
    let context: import("playwright").BrowserContext;
    if (persistent && this.profileDir) {
      const dir = join(this.profileDir, "browser-profiles", taskKey.replace(/[^a-zA-Z0-9._-]/g, "_"));
      mkdirSync(dir, { recursive: true });
      context = await browser.newContext({ storageState: join(dir, "storage.json") });
    } else {
      context = await browser.newContext({
        userAgent: this.config.user_agent,
        viewport: { width: 1280, height: 800 }
      });
    }
    const page = await context.newPage();
    page.setDefaultTimeout(this.config.timeout_ms);
    const handle: BrowserContextHandle = { context, page, created_at: Date.now(), last_used: Date.now(), persistent };
    this.contexts.set(taskKey, handle);
    return handle;
  }

  async close(taskKey: string): Promise<boolean> {
    const handle = this.contexts.get(taskKey);
    if (!handle) return false;
    this.contexts.delete(taskKey);
    await handle.context.close().catch(() => undefined);
    return true;
  }

  async closeAll(): Promise<void> {
    for (const key of [...this.contexts.keys()]) await this.close(key);
    await this.browser?.close().catch(() => undefined);
    this.browser = undefined;
  }

  async gc(): Promise<void> {
    for (const [key, handle] of this.contexts) {
      if (Date.now() - handle.last_used > IDLE_MS) await this.close(key);
    }
  }

  private checkUrl(url: string): string {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new RannError("E_TOOL_INVALID_ARGS", `URL tidak valid: ${url}`);
    }
    if (!["http:", "https:"].includes(parsed.protocol)) throw new RannError("E_PERMISSION", "Browser hanya boleh membuka http atau https");
    if (blockedHost(url, this.config.blocked_domains)) throw new RannError("E_PERMISSION", `Domain diblokir: ${parsed.hostname}`);
    return parsed.toString();
  }

  async perform(taskKey: string, input: BrowserActionInput, options: { mutating?: boolean; persistent?: boolean } = {}): Promise<Record<string, unknown>> {
    if (!this.config.enabled) throw new RannError("E_PERMISSION", "Browser tidak aktif di config");
    if (input.action === "close") return { closed: await this.close(taskKey) };
    const handle = await this.handle(taskKey, options.persistent === true);
    const page = handle.page;
    const timeout = Math.min(Math.max(input.timeout_ms ?? this.config.timeout_ms, 1_000), 120_000);
    page.setDefaultTimeout(timeout);
    try {
      if (input.action === "navigate") {
        if (!input.url) throw new RannError("E_TOOL_INVALID_ARGS", "navigate butuh url");
        const url = this.checkUrl(input.url);
        const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout });
        return { url: page.url(), status: response?.status() ?? null, title: await page.title() };
      }
      if (input.action === "click") {
        if (!input.selector) throw new RannError("E_TOOL_INVALID_ARGS", "click butuh selector");
        await page.locator(input.selector).first().click({ timeout });
        return { url: page.url(), clicked: input.selector };
      }
      if (input.action === "type") {
        if (!input.selector) throw new RannError("E_TOOL_INVALID_ARGS", "type butuh selector");
        const text = input.text ?? input.value ?? "";
        await page.locator(input.selector).first().fill(text, { timeout });
        return { url: page.url(), filled: input.selector, chars: text.length };
      }
      if (input.action === "select") {
        if (!input.selector || input.value === undefined) throw new RannError("E_TOOL_INVALID_ARGS", "select butuh selector dan value");
        const selected = await page.locator(input.selector).first().selectOption(input.value, { timeout });
        return { url: page.url(), selected };
      }
      if (input.action === "scroll") {
        const delta = input.delta_y ?? 600;
        await page.mouse.wheel(0, delta);
        await page.waitForTimeout(250);
        return { url: page.url(), delta_y: delta, scroll_y: await page.evaluate("window.scrollY") };
      }
      if (input.action === "extract") {
        const text = String(await page.evaluate("document.body ? document.body.innerText : \"\""));
        const clipped = text.slice(0, this.config.max_text);
        return { url: page.url(), title: await page.title(), text: clipped, truncated: text.length > clipped.length, chars: text.length };
      }
      if (input.action === "screenshot") {
        mkdirSync(this.config.artifacts_dir, { recursive: true });
        const filename = `browser-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
        const path = join(this.config.artifacts_dir, filename);
        await page.screenshot({ path, fullPage: input.full_page === true });
        return { url: page.url(), artifact: path, bytes: (await import("node:fs")).statSync(path).size };
      }
      if (input.action === "evaluate") {
        if (!input.script) throw new RannError("E_TOOL_INVALID_ARGS", "evaluate butuh script");
        const script = safeEvaluateScript(input.script);
        const value = await page.evaluate(`(() => { ${script} })()`);
        return { url: page.url(), result: JSON.parse(JSON.stringify(value ?? null)) };
      }
      if (input.action === "wait") {
        const selector = input.selector;
        if (selector) await page.locator(selector).first().waitFor({ timeout });
        else await page.waitForTimeout(Math.min(timeout, 10_000));
        return { url: page.url(), waited: selector ?? timeout };
      }
      if (input.action === "download") {
        if (!input.selector) throw new RannError("E_TOOL_INVALID_ARGS", "download butuh selector");
        mkdirSync(this.config.artifacts_dir, { recursive: true });
        const suggested = join(this.config.artifacts_dir, `download-${Date.now()}`);
        const [download] = await Promise.all([page.waitForEvent("download", { timeout }), page.locator(input.selector).first().click({ timeout })]);
        const path = input.path ?? suggested;
        await download.saveAs(path);
        return { url: page.url(), artifact: path, suggested_filename: download.suggestedFilename() };
      }
      if (input.action === "upload") {
        if (!input.selector || !input.path) throw new RannError("E_TOOL_INVALID_ARGS", "upload butuh selector dan path");
        await page.locator(input.selector).first().setInputFiles(input.path, { timeout });
        return { url: page.url(), uploaded: input.path };
      }
      throw new RannError("E_TOOL_INVALID_ARGS", `Aksi browser tidak dikenal: ${String(input.action)}`);
    } catch (error) {
      if (error instanceof RannError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (/verification code|two-factor|2fa|otp/i.test(message)) {
        throw new RannError("E_APPROVAL_REQUIRED", `Situs meminta verifikasi dua langkah. Selesaikan manual di browser, lalu ulangi aksi: ${message}`);
      }
      throw new RannError("E_TOOL_FAILED", `Aksi browser ${input.action} gagal: ${message.slice(0, 500)}`);
    }
  }
}
