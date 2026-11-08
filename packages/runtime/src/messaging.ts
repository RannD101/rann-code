import { createHash } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, extname, join, relative } from "node:path";
import { RannError, toRannError, type EventEnvelope } from "@rann/shared";
import {
  ensureChannelDevice,
  getChannelCursor,
  getMappedSession,
  mapSession,
  recordGatewayMessage,
  setChannelCursor,
  type Db
} from "@rann/storage";
import { findTool } from "./tools/index.js";
import type { MessagingLogger, MessagingOptions } from "./messaging-support.js";
import { DiscordAdapter } from "./messaging-discord.js";
import { SlackAdapter } from "./messaging-slack.js";

export type { MessagingLogger, MessagingOptions } from "./messaging-support.js";

type Json = Record<string, unknown>;

interface TelegramChat {
  id: number;
  type?: string;
  title?: string;
  username?: string;
}

interface TelegramMessage {
  message_id: number;
  message_thread_id?: number;
  chat: TelegramChat;
  text?: string;
  caption?: string;
  photo?: Array<{ file_id: string; file_size?: number }>;
  document?: { file_id: string; file_name?: string; mime_type?: string; file_size?: number };
}

interface TelegramCallback {
  id: string;
  data?: string;
  message?: TelegramMessage;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
  callback_query?: TelegramCallback;
}

interface PendingApproval {
  requestId: string;
  sessionId: string;
  chatId: number;
  threadId?: number;
}

const TELEGRAM_LIMIT = 3_800;
const TELEGRAM_HARD_LIMIT = 12_000;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const POLL_TIMEOUT_SECONDS = 25;

function asRecord(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Json) : {};
}

function cleanName(value: string): string {
  return value.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "lampiran";
}

function impactFor(tool: string): string {
  const spec = findTool(tool);
  if (!spec) return "tidak diketahui";
  if (spec.risk === "exec") return "menjalankan perintah di workspace";
  if (spec.risk === "write") return "mengubah berkas di workspace";
  if (spec.risk === "net") return "mengakses jaringan";
  if (spec.risk === "admin") return "mengubah konfigurasi agent";
  return "hanya membaca data";
}

function approvalReason(args: Json): string {
  if (typeof args.reason === "string" && args.reason.trim()) return args.reason.trim().slice(0, 300);
  if (typeof args.command === "string") return `Perintah: ${args.command.slice(0, 200)}`;
  if (typeof args.path === "string") return `Berkas: ${args.path.slice(0, 200)}`;
  if (typeof args.url === "string") return `URL: ${args.url.slice(0, 200)}`;
  return "Tool ini butuh persetujuan sebelum dijalankan.";
}

export function splitTelegramMessage(text: string, limit = TELEGRAM_LIMIT): string[] {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  if (normalized.length === 0) return [""];
  const clipped =
    normalized.length > TELEGRAM_HARD_LIMIT
      ? `${normalized.slice(0, TELEGRAM_HARD_LIMIT)}\n\n[... dipotong, ${normalized.length} karakter total]`
      : normalized;
  if (clipped.length <= limit) return [clipped];
  const chunks: string[] = [];
  let rest = clipped;
  while (rest.length > limit) {
    let cut = rest.lastIndexOf("\n", limit);
    if (cut < limit * 0.5) cut = limit;
    chunks.push(rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest.length > 0) chunks.push(rest);
  return chunks.map((chunk, index) => `${chunk}\n\n(${String(index + 1)}/${String(chunks.length)})`);
}

export class TelegramAdapter {
  private readonly db: Db;
  private readonly token: string;
  private readonly allowedChats: Set<string>;
  private readonly invoke: MessagingOptions["invoke"];
  private readonly logger?: MessagingLogger;
  private readonly fetchImpl: typeof fetch;
  private readonly apiBase: string;
  private readonly autoPoll: boolean;
  private readonly projectPath = process.cwd();
  private readonly profile: string;
  private readonly pending = new Map<string, PendingApproval>();
  private readonly bindings = new Map<string, { chatId: number; threadId?: number; channelKey: string }>();
  private readonly abort = new AbortController();
  private offset = 0;
  private running = false;
  private loop?: Promise<void>;

  constructor(options: MessagingOptions) {
    const telegram = options.config.messaging.telegram;
    const token = process.env[telegram.token_env]?.trim();
    if (!token) throw new RannError("E_CONFIG_INVALID", `Env ${telegram.token_env} belum diisi`);
    this.db = options.db;
    this.token = token;
    this.allowedChats = new Set(telegram.allowed_chats.map((value) => value.trim()).filter(Boolean));
    this.invoke = options.invoke;
    this.logger = options.logger;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.apiBase = options.apiBase ?? "https://api.telegram.org";
    this.autoPoll = options.autoPoll ?? true;
    this.profile = options.config.gateway?.profile ?? "default";
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    const stored = getChannelCursor(this.db, "telegram");
    this.offset = stored ? Number(stored) : 0;
    if (!Number.isFinite(this.offset) || this.offset < 0) this.offset = 0;
    this.logger?.info("adapter telegram aktif");
    if (this.autoPoll) this.loop = this.runLoop();
  }

  pendingCount(): number {
    return this.pending.size;
  }

  async stop(): Promise<void> {
    this.running = false;
    this.abort.abort();
    await this.loop?.catch(() => undefined);
    this.loop = undefined;
  }

  private async runLoop(): Promise<void> {
    while (this.running) {
      try {
        await this.pollOnce();
      } catch (error) {
        if (!this.running) return;
        this.logger?.warn(`telegram polling gagal: ${toRannError(error).message}`);
        await this.sleep(3_000);
      }
    }
  }

  async pollOnce(): Promise<void> {
    const payload = {
      offset: this.offset,
      timeout: POLL_TIMEOUT_SECONDS,
      allowed_updates: ["message", "callback_query"]
    };
    const result = await this.call("getUpdates", payload, POLL_TIMEOUT_SECONDS * 1_000 + 5_000);
    const updates = Array.isArray(result) ? (result as TelegramUpdate[]) : [];
    for (const update of updates) {
      if (typeof update.update_id !== "number") continue;
      if (update.update_id < this.offset) continue;
      this.offset = update.update_id + 1;
      setChannelCursor(this.db, "telegram", String(this.offset));
      try {
        await this.handleUpdate(update);
      } catch (error) {
        this.logger?.warn(`update telegram ${String(update.update_id)} gagal: ${toRannError(error).message}`);
      }
    }
  }

  async handleUpdate(update: TelegramUpdate): Promise<void> {
    if (update.callback_query) {
      await this.handleCallback(update.callback_query);
      return;
    }
    const message = update.message;
    if (!message) return;
    if (!this.allowed(message.chat.id)) {
      this.logger?.warn(`chat telegram ${String(message.chat.id)} tidak diizinkan`);
      return;
    }
    const threadId = message.message_thread_id;
    const channelKey = `${String(message.chat.id)}:${String(threadId ?? 0)}`;
    const sessionId = await this.sessionFor(message, channelKey);
    const text = (message.text ?? message.caption ?? "").trim();
    if (text.startsWith("/")) {
      const handled = await this.command(text, sessionId, message);
      if (handled) return;
    }
    const attachments = await this.download(message, sessionId);
    const body = text.length > 0 ? text : attachments.length > 0 ? "[lampiran]" : "";
    if (!body) return;
    recordGatewayMessage(this.db, {
      channel: "telegram",
      channelKey,
      direction: "in",
      body,
      externalId: String(message.message_id)
    });
    await this.invoke("session.send", {
      sessionId,
      text: body,
      ...(attachments.length > 0 ? { attachments } : {})
    });
    await this.reply(message.chat.id, "Sedang dikerjakan...", threadId);
  }

  private allowed(chatId: number): boolean {
    return this.allowedChats.has(String(chatId));
  }

  private async sessionFor(message: TelegramMessage, channelKey: string): Promise<string> {
    const existing = getMappedSession(this.db, "telegram", "telegram", channelKey);
    if (existing) {
      this.bindings.set(existing, { chatId: message.chat.id, channelKey, ...(message.message_thread_id ? { threadId: message.message_thread_id } : {}) });
      return existing;
    }
    const title = (message.chat.title ?? message.chat.username ?? `Telegram ${String(message.chat.id)}`).slice(0, 200);
    const created = asRecord(
      await this.invoke("session.create", {
        title,
        projectPath: this.projectPath,
        permissionMode: "ask"
      })
    );
    const id = typeof created.id === "string" ? created.id : "";
    if (!id) throw new RannError("E_INTERNAL", "session.create tidak mengembalikan id");
    ensureChannelDevice(this.db, { id: "telegram", name: "Telegram", profile: this.profile });
    mapSession(this.db, { deviceId: "telegram", sessionId: id, channel: "telegram", channelKey });
    this.bindings.set(id, { chatId: message.chat.id, channelKey, ...(message.message_thread_id ? { threadId: message.message_thread_id } : {}) });
    return id;
  }

  private async command(text: string, sessionId: string, message: TelegramMessage): Promise<boolean> {
    const [raw, ...rest] = text.split(/\s+/);
    const name = (raw ?? "").replace(/^\//, "").split("@")[0]?.toLowerCase();
    const argument = rest.join(" ").trim();
    const threadId = message.message_thread_id;
    if (!name) return false;
    if (name === "status") {
      const health = asRecord(await this.invoke("health", {}));
      const usage = asRecord(await this.invoke("usage.summary", { sessionId }));
      await this.reply(
        message.chat.id,
        [
          `status daemon: ${String(health.status ?? "?")}`,
          `sesi: ${sessionId}`,
          `turn: ${String(usage.turns ?? 0)}`,
          `token: ${String(usage.total_tokens ?? 0)}`,
          `biaya: $${Number(usage.cost_usd ?? 0).toFixed(4)}`
        ].join("\n"),
        threadId
      );
      return true;
    }
    if (name === "cancel") {
      const result = asRecord(await this.invoke("session.cancel", { sessionId }));
      await this.reply(message.chat.id, result.cancelled ? "Turn dibatalkan." : "Tidak ada turn berjalan.", threadId);
      return true;
    }
    if (name === "resume") {
      await this.invoke("session.send", { sessionId, text: "lanjutkan dari langkah terakhir" });
      await this.reply(message.chat.id, "Melanjutkan sesi...", threadId);
      return true;
    }
    if (name === "model") {
      const models = await this.invoke("model.list", {});
      const list = Array.isArray(models) ? models.slice(0, 15) : [];
      const lines = list.map((item) => {
        const row = asRecord(item);
        return `${String(row.id ?? row.name ?? "?")} (${String(row.provider ?? "?")})`;
      });
      await this.reply(message.chat.id, lines.length > 0 ? `Model tersedia:\n${lines.join("\n")}` : "Belum ada model.", threadId);
      return true;
    }
    if (name === "cost") {
      const usage = asRecord(await this.invoke("usage.summary", { sessionId }));
      await this.reply(
        message.chat.id,
        `token masuk: ${String(usage.input_tokens ?? 0)}\ntoken keluar: ${String(usage.output_tokens ?? 0)}\nbiaya: $${Number(usage.cost_usd ?? 0).toFixed(4)}`,
        threadId
      );
      return true;
    }
    if (name === "approve" || name === "deny") {
      await this.resolveApproval(name === "approve", argument || undefined, sessionId, message.chat.id, threadId);
      return true;
    }
    if (name === "help" || name === "start") {
      await this.reply(
        message.chat.id,
        "Perintah: /status /cancel /resume /model /cost /approve <id> /deny <id>",
        threadId
      );
      return true;
    }
    return false;
  }

  private async resolveApproval(
    approved: boolean,
    requestId: string | undefined,
    sessionId: string,
    chatId: number,
    threadId?: number
  ): Promise<void> {
    const id = requestId ?? [...this.pending.values()].reverse().find((item) => item.sessionId === sessionId)?.requestId;
    if (!id) {
      await this.reply(chatId, "Tidak ada permintaan izin yang menunggu.", threadId);
      return;
    }
    await this.invoke("permission.respond", { requestId: id, approved, remember: false });
    this.pending.delete(id);
    await this.reply(chatId, approved ? `Izin ${id} disetujui.` : `Izin ${id} ditolak.`, threadId);
  }

  private async handleCallback(callback: TelegramCallback): Promise<void> {
    const message = callback.message;
    if (!message || !this.allowed(message.chat.id)) {
      await this.call("answerCallbackQuery", { callback_query_id: callback.id, text: "Tidak diizinkan" }).catch(() => undefined);
      return;
    }
    const data = callback.data ?? "";
    const match = /^(ap|dn):(.+)$/.exec(data);
    if (!match) {
      await this.call("answerCallbackQuery", { callback_query_id: callback.id, text: "Aksi tidak dikenal" }).catch(() => undefined);
      return;
    }
    const approved = match[1] === "ap";
    const requestId = match[2]!;
    try {
      await this.invoke("permission.respond", { requestId, approved, remember: false });
      this.pending.delete(requestId);
      await this.call("answerCallbackQuery", { callback_query_id: callback.id, text: approved ? "Disetujui" : "Ditolak" });
      if (message.message_id) {
        await this.call("editMessageReplyMarkup", {
          chat_id: message.chat.id,
          message_id: message.message_id,
          reply_markup: { inline_keyboard: [] }
        }).catch(() => undefined);
      }
    } catch (error) {
      await this.call("answerCallbackQuery", {
        callback_query_id: callback.id,
        text: toRannError(error).message.slice(0, 180)
      }).catch(() => undefined);
    }
  }

  onEvent(event: EventEnvelope): void {
    if (event.type === "approval.request") {
      const data = asRecord(event.data);
      const requestId = typeof data.request_id === "string" ? data.request_id : "";
      const binding = this.bindings.get(event.sessionId);
      if (!requestId || !binding) return;
      const tool = typeof data.tool === "string" ? data.tool : "tool";
      const args = asRecord(data.args);
      this.pending.set(requestId, {
        requestId,
        sessionId: event.sessionId,
        chatId: binding.chatId,
        ...(binding.threadId ? { threadId: binding.threadId } : {})
      });
      const text = [
        "Izin diperlukan",
        `tool: ${tool}`,
        `dampak: ${impactFor(tool)}`,
        `alasan: ${approvalReason(args)}`,
        `id: ${requestId}`
      ].join("\n");
      void this.reply(binding.chatId, text, binding.threadId, [
        [
          { text: "Izinkan", callback_data: `ap:${requestId}` },
          { text: "Tolak", callback_data: `dn:${requestId}` }
        ]
      ]).catch((error: unknown) => this.logger?.warn(`gagal kirim approval: ${toRannError(error).message}`));
      return;
    }
    if (event.type === "turn.end" && this.bindings.has(event.sessionId)) {
      void this.finishTurn(event).catch((error: unknown) =>
        this.logger?.warn(`gagal kirim hasil turn: ${toRannError(error).message}`)
      );
    }
  }

  private async finishTurn(event: EventEnvelope): Promise<void> {
    const binding = this.bindings.get(event.sessionId);
    if (!binding) return;
    const data = asRecord(event.data);
    if (data.status === "failed") {
      await this.reply(binding.chatId, `Turn gagal: ${String(data.error_code ?? "E_TURN_FAILED")}`, binding.threadId);
      return;
    }
    const session = asRecord(await this.invoke("session.get", { sessionId: event.sessionId }));
    const messages = Array.isArray(session.messages) ? session.messages : [];
    const mine = messages.filter((item) => {
      const row = asRecord(item);
      return row.role === "assistant" && (row.turn_id === event.turnId || row.turnId === event.turnId);
    });
    const last = mine.length > 0 ? mine[mine.length - 1] : messages.filter((item) => asRecord(item).role === "assistant").pop();
    const content = last ? String(asRecord(last).content ?? "") : "";
    if (!content) {
      await this.reply(binding.chatId, "(selesai tanpa teks)", binding.threadId);
      return;
    }
    recordGatewayMessage(this.db, {
      channel: "telegram",
      channelKey: binding.channelKey,
      direction: "out",
      body: content,
      ...(event.turnId ? { externalId: event.turnId } : {})
    });
    await this.reply(binding.chatId, content, binding.threadId);
  }

  private async download(message: TelegramMessage, sessionId: string): Promise<Array<{ path: string; name: string }>> {
    const file = message.document
      ? {
          fileId: message.document.file_id,
          name: message.document.file_name ?? "lampiran",
          size: message.document.file_size ?? 0,
          mime: message.document.mime_type ?? "application/octet-stream"
        }
      : message.photo && message.photo.length > 0
        ? { fileId: message.photo[message.photo.length - 1]!.file_id, name: "foto.jpg", size: message.photo[message.photo.length - 1]!.file_size ?? 0, mime: "image/jpeg" }
        : undefined;
    if (!file) return [];
    if (file.size > MAX_FILE_BYTES) throw new RannError("E_INPUT_TOO_LARGE", "Lampiran Telegram melebihi 20 MB");
    const info = asRecord(await this.call("getFile", { file_id: file.fileId }));
    const remotePath = typeof info.file_path === "string" ? info.file_path : "";
    if (!remotePath) throw new RannError("E_INTERNAL", "getFile tidak mengembalikan file_path");
    const response = await this.fetchImpl(`${this.apiBase}/file/bot${this.token}/${remotePath}`, { signal: this.abort.signal });
    if (!response.ok) throw new RannError("E_INTERNAL", `Unduh berkas Telegram gagal: ${String(response.status)}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_FILE_BYTES) throw new RannError("E_INPUT_TOO_LARGE", "Lampiran Telegram melebihi 20 MB");
    const session = asRecord(await this.invoke("session.get", { sessionId }));
    const projectPath = typeof session.project_path === "string" && session.project_path ? session.project_path : this.projectPath;
    const targetDir = join(projectPath, ".rann", "telegram");
    mkdirSync(targetDir, { recursive: true, mode: 0o700 });
    const extension = extname(file.name).toLowerCase();
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
    const stored = join(targetDir, `${hash}-${cleanName(basename(file.name, extension))}${extension}`);
    if (!existsSync(stored)) writeFileSync(stored, bytes, { mode: 0o600 });
    return [{ path: relative(projectPath, stored), name: cleanName(file.name) }];
  }

  async reply(chatId: number, text: string, threadId?: number, keyboard?: Array<Array<{ text: string; callback_data: string }>>): Promise<void> {
    const chunks = splitTelegramMessage(text);
    for (let index = 0; index < chunks.length; index += 1) {
      const payload: Json = { chat_id: chatId, text: chunks[index], disable_web_page_preview: true };
      if (threadId) payload.message_thread_id = threadId;
      if (keyboard && index === chunks.length - 1) payload.reply_markup = { inline_keyboard: keyboard };
      await this.call("sendMessage", payload);
    }
  }

  private async call(method: string, payload: Json, timeoutMs = 30_000): Promise<unknown> {
    const response = await this.fetchImpl(`${this.apiBase}/bot${this.token}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs)
    });
    const body = asRecord(await response.json().catch(() => ({})));
    if (!response.ok || body.ok !== true) {
      throw new RannError("E_INTERNAL", `Telegram ${method} gagal: ${String(body.description ?? response.status)}`);
    }
    return body.result;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(resolve, ms);
      this.abort.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          resolve();
        },
        { once: true }
      );
    });
  }
}

export class MessagingService {
  private readonly options: MessagingOptions;
  private readonly listeners = new Set<(event: EventEnvelope) => void>();
  private telegram?: TelegramAdapter;
  private discord?: DiscordAdapter;
  private slack?: SlackAdapter;
  private unsubscribe?: () => void;

  constructor(options: MessagingOptions) {
    this.options = options;
  }

  async start(): Promise<void> {
    const config = this.options.config.messaging;
    if (config.telegram.enabled) {
      try {
        this.telegram = new TelegramAdapter(this.options);
        this.listeners.add((event) => this.telegram?.onEvent(event));
        await this.telegram.start();
      } catch (error) {
        this.options.logger?.warn(`telegram tidak aktif: ${toRannError(error).message}`);
        this.telegram = undefined;
      }
    }
    if (config.discord?.enabled) {
      try {
        this.discord = new DiscordAdapter(this.options);
        this.listeners.add((event) => this.discord?.onEvent(event));
        await this.discord.start();
      } catch (error) {
        this.options.logger?.warn(`discord tidak aktif: ${toRannError(error).message}`);
        this.discord = undefined;
      }
    }
    if (config.slack?.enabled) {
      try {
        this.slack = new SlackAdapter(this.options);
        this.listeners.add((event) => this.slack?.onEvent(event));
        await this.slack.start();
      } catch (error) {
        this.options.logger?.warn(`slack tidak aktif: ${toRannError(error).message}`);
        this.slack = undefined;
      }
    }
    if (this.listeners.size > 0) {
      this.unsubscribe = this.options.subscribe((event) => {
        for (const listener of this.listeners) {
          try {
            listener(event);
          } catch (error) {
            this.options.logger?.warn(`listener messaging gagal: ${toRannError(error).message}`);
          }
        }
      });
    }
  }

  async handleDiscordInteraction(payload: Record<string, unknown>): Promise<string> {
    if (!this.discord) return "Discord tidak aktif";
    return this.discord.handleInteraction(payload);
  }

  async stop(): Promise<void> {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    await this.telegram?.stop();
    await this.discord?.stop();
    await this.slack?.stop();
    this.telegram = undefined;
    this.discord = undefined;
    this.slack = undefined;
    this.listeners.clear();
  }

  status(): {
    telegram: { enabled: boolean; active: boolean; chats: number; pending: number };
    discord: { enabled: boolean; active: boolean; channels: number; pending: number };
    slack: { enabled: boolean; active: boolean; channels: number; pending: number };
  } {
    const telegram = this.options.config.messaging.telegram;
    const discord = this.options.config.messaging.discord;
    const slack = this.options.config.messaging.slack;
    return {
      telegram: {
        enabled: telegram.enabled,
        active: this.telegram !== undefined,
        chats: telegram.allowed_chats.length,
        pending: this.telegram?.pendingCount() ?? 0
      },
      discord: {
        enabled: discord?.enabled ?? false,
        active: this.discord !== undefined,
        channels: discord?.allowed_channels.length ?? 0,
        pending: this.discord?.pendingCount() ?? 0
      },
      slack: {
        enabled: slack?.enabled ?? false,
        active: this.slack !== undefined,
        channels: slack?.allowed_channels.length ?? 0,
        pending: this.slack?.pendingCount() ?? 0
      }
    };
  }

  async send(chatId: number, text: string, threadId?: number): Promise<{ sent: boolean; chunks: number }> {
    if (!this.telegram) throw new RannError("E_CONFIG_INVALID", "Adapter Telegram belum aktif");
    const chunks = splitTelegramMessage(text).length;
    await this.telegram.reply(chatId, text, threadId);
    return { sent: true, chunks };
  }

  telegramAdapter(): TelegramAdapter | undefined {
    return this.telegram;
  }

  discordAdapter(): DiscordAdapter | undefined {
    return this.discord;
  }

  slackAdapter(): SlackAdapter | undefined {
    return this.slack;
  }
}
