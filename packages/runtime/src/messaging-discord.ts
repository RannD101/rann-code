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
import type { MessagingLogger, MessagingOptions } from "./messaging.js";
import {
  approvalText,
  asNumber,
  asRecord,
  asString,
  discordIdToBigInt,
  looksLikeCommand,
  MAX_ATTACHMENT_BYTES,
  normalizeApprovalReply,
  readBodyLimited,
  runTextCommand,
  saveAttachment,
  splitPlatformMessage,
  stripCommandPrefix,
  type Invoke,
  type JsonRecord
} from "./messaging-support.js";

interface DiscordUser {
  id: string;
  username?: string;
  bot?: boolean;
}

interface DiscordMember {
  roles?: string[];
  nick?: string;
}

interface DiscordAttachment {
  id: string;
  filename: string;
  size?: number;
  url: string;
  content_type?: string;
}

interface DiscordThread {
  id: string;
}

interface DiscordMessage {
  id: string;
  channel_id: string;
  guild_id?: string;
  content?: string;
  author?: DiscordUser;
  member?: DiscordMember;
  thread?: DiscordThread;
  attachments?: DiscordAttachment[];
}

interface DiscordChannel {
  id: string;
  type?: number;
  parent_id?: string | null;
  guild_id?: string | null;
  name?: string;
}

interface PendingApproval {
  requestId: string;
  sessionId: string;
}

interface SessionBinding {
  channelId: string;
  channelKey: string;
  threadId?: string;
}

const DISCORD_LIMIT = 1_900;
const DISCORD_HARD_LIMIT = 12_000;
const THREAD_TYPES = new Set([10, 11, 12]);
const THREAD_NAME_MAX = 80;
const MAX_TRACKED_THREADS = 50;

function threadName(content: string): string {
  const cleaned = content.replace(/\s+/gu, " ").trim();
  if (!cleaned) return "Rann";
  return cleaned.slice(0, THREAD_NAME_MAX);
}

function compareMessageIds(left: string, right: string): number {
  const a = discordIdToBigInt(left);
  const b = discordIdToBigInt(right);
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export class DiscordAdapter {
  private readonly db: Db;
  private readonly token: string;
  private readonly allowedChannels: Set<string>;
  private readonly allowedRoles: Set<string>;
  private readonly invoke: Invoke;
  private readonly logger?: MessagingLogger;
  private readonly fetchImpl: typeof fetch;
  private readonly apiBase: string;
  private readonly autoPoll: boolean;
  private readonly pollMs: number;
  private readonly projectPath = process.cwd();
  private readonly profile: string;
  private readonly pending = new Map<string, PendingApproval>();
  private readonly bindings = new Map<string, SessionBinding>();
  private readonly channels = new Map<string, DiscordChannel | null>();
  private readonly threadParents = new Map<string, string>();
  private readonly extraChannels = new Set<string>();
  private readonly abort = new AbortController();
  private selfId?: string;
  private running = false;
  private loop?: Promise<void>;

  constructor(options: MessagingOptions) {
    const discord = options.config.messaging.discord;
    const token = discord.token_env ? process.env[discord.token_env]?.trim() : "";
    if (!token) throw new RannError("E_CONFIG_INVALID", `Env ${discord.token_env} belum diisi`);
    this.db = options.db;
    this.token = token;
    this.allowedChannels = new Set((discord.allowed_channels ?? []).map((value) => value.trim()).filter(Boolean));
    this.allowedRoles = new Set((discord.allowed_roles ?? []).map((value) => value.trim()).filter(Boolean));
    this.invoke = options.invoke;
    this.logger = options.logger;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.apiBase = (options.discordApiBase ?? "https://discord.com/api/v10").replace(/\/+$/u, "");
    this.autoPoll = options.autoPoll ?? true;
    this.pollMs = discord.poll_ms ?? 3_000;
    this.profile = options.config.gateway?.profile ?? "default";
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.loadSelf();
    await Promise.all([...this.allowedChannels].map((channelId) => this.channelInfo(channelId)));
    this.logger?.info("adapter discord aktif");
    if (this.autoPoll) this.loop = this.runLoop();
  }

  async stop(): Promise<void> {
    this.running = false;
    this.abort.abort();
    await this.loop?.catch(() => undefined);
    this.loop = undefined;
  }

  pendingCount(): number {
    return this.pending.size;
  }

  private async loadSelf(): Promise<void> {
    try {
      const body = asRecord(await this.api("GET", "/users/@me"));
      const id = asString(body.id);
      if (id) this.selfId = id;
    } catch (error) {
      this.logger?.warn(`gagal membaca identitas bot discord: ${toRannError(error).message}`);
    }
  }

  private async runLoop(): Promise<void> {
    while (this.running) {
      try {
        await this.pollOnce();
      } catch (error) {
        if (!this.running) return;
        this.logger?.warn(`discord polling gagal: ${toRannError(error).message}`);
      }
      await this.sleep(this.pollMs);
    }
  }

  async pollOnce(): Promise<void> {
    const channels = new Set([...this.allowedChannels, ...this.extraChannels]);
    for (const channelId of channels) {
      if (!this.running) return;
      try {
        await this.pollChannel(channelId);
      } catch (error) {
        this.logger?.warn(`kanal discord ${channelId} gagal: ${toRannError(error).message}`);
      }
    }
  }

  private cursorKey(channelId: string): string {
    return `discord:${channelId}`;
  }

  private async pollChannel(channelId: string): Promise<void> {
    const key = this.cursorKey(channelId);
    const stored = getChannelCursor(this.db, key);
    if (!stored) {
      const newest = await this.latestMessageId(channelId);
      if (newest) {
        setChannelCursor(this.db, key, newest);
        this.logger?.info(`cursor ${key} dimulai dari pesan ${newest}`);
      }
      return;
    }
    const messages = await this.fetchMessages(channelId, stored);
    const ordered = [...messages].sort((left, right) => compareMessageIds(left.id, right.id));
    for (const message of ordered) {
      if (!this.running) return;
      if (compareMessageIds(message.id, stored) <= 0) continue;
      setChannelCursor(this.db, key, message.id);
      try {
        await this.handleMessage(message);
      } catch (error) {
        this.logger?.warn(`pesan discord ${message.id} gagal: ${toRannError(error).message}`);
      }
    }
  }

  private async latestMessageId(channelId: string): Promise<string | undefined> {
    const body = await this.api("GET", `/channels/${channelId}/messages?limit=1`);
    if (!Array.isArray(body)) return undefined;
    const first = asRecord(body[0]);
    return asString(first.id);
  }

  private async fetchMessages(channelId: string, after: string): Promise<DiscordMessage[]> {
    const query = new URLSearchParams({ after, limit: "50" });
    const body = await this.api("GET", `/channels/${channelId}/messages?${query.toString()}`);
    if (!Array.isArray(body)) throw new RannError("E_INTERNAL", "Discord tidak mengembalikan daftar pesan");
    return body.map((item) => this.toMessage(asRecord(item))).filter((item): item is DiscordMessage => item !== undefined);
  }

  private toMessage(row: JsonRecord): DiscordMessage | undefined {
    const id = asString(row.id);
    const channelId = asString(row.channel_id);
    if (!id || !channelId) return undefined;
    const authorRow = asRecord(row.author);
    const authorId = asString(authorRow.id);
    const memberRow = asRecord(row.member);
    const roles = Array.isArray(memberRow.roles) ? memberRow.roles.filter((role): role is string => typeof role === "string") : undefined;
    const threadRow = asRecord(row.thread);
    const threadId = asString(threadRow.id);
    const attachments = Array.isArray(row.attachments)
      ? row.attachments
          .map((item) => asRecord(item))
          .map((item): DiscordAttachment | undefined => {
            const url = asString(item.url);
            if (!url) return undefined;
            const attachment: DiscordAttachment = {
              id: asString(item.id) ?? url,
              filename: asString(item.filename) ?? "lampiran",
              url
            };
            const size = asNumber(item.size);
            if (size !== undefined) attachment.size = size;
            const contentType = asString(item.content_type);
            if (contentType) attachment.content_type = contentType;
            return attachment;
          })
          .filter((item): item is DiscordAttachment => item !== undefined)
      : [];
    return {
      id,
      channel_id: channelId,
      content: asString(row.content) ?? "",
      ...(asString(row.guild_id) ? { guild_id: asString(row.guild_id) } : {}),
      ...(authorId
        ? {
            author: {
              id: authorId,
              username: asString(authorRow.username),
              bot: authorRow.bot === true
            }
          }
        : {}),
      ...(roles ? { member: { roles, nick: asString(memberRow.nick) } } : {}),
      ...(threadId ? { thread: { id: threadId } } : {}),
      attachments
    };
  }

  async handleMessage(message: DiscordMessage): Promise<void> {
    if (!message.id || !message.channel_id) return;
    const author = message.author;
    if (!author || author.bot === true) return;
    if (this.selfId && author.id === this.selfId) return;
    if (!(await this.accessAllowed(message))) {
      this.logger?.warn(`kanal discord ${message.channel_id} tidak diizinkan untuk pengirim ${author.id}`);
      return;
    }
    const channelKey = await this.sessionKeyFor(message.channel_id);
    const sessionId = await this.sessionFor(message, channelKey);
    const text = this.cleanText(message.content ?? "");
    const target = message.thread?.id ?? message.channel_id;
    const reply = (body: string): Promise<void> => this.send(target, body);
    const decision = normalizeApprovalReply(text);
    if (decision !== undefined && this.hasPending(sessionId)) {
      await this.resolveApproval(decision, undefined, sessionId, reply);
      return;
    }
    const stripped = stripCommandPrefix(text, ["!rann", "/rann"]);
    const commandText = stripped.prefixed ? stripped.text || "help" : looksLikeCommand(text) ? text : "";
    if (commandText) {
      const handled = await runTextCommand(commandText, {
        invoke: this.invoke,
        sessionId,
        reply,
        resolveApproval: (approved, requestId) => this.resolveApproval(approved, requestId, sessionId, reply)
      });
      if (handled) return;
    }
    const threadId = await this.ensureThread(message);
    this.bindings.set(sessionId, {
      channelId: message.channel_id,
      channelKey,
      ...(threadId ? { threadId } : {})
    });
    let attachments: Array<{ path: string; name: string }>;
    try {
      attachments = await this.download(message, sessionId);
    } catch (error) {
      const failure = toRannError(error);
      this.logger?.warn(`lampiran discord ${message.id} gagal: ${failure.message}`);
      await this.send(threadId ?? message.channel_id, `Lampiran gagal diproses: ${failure.message}`);
      return;
    }
    const body = text.length > 0 ? text : attachments.length > 0 ? "[lampiran]" : "";
    if (!body) return;
    recordGatewayMessage(this.db, {
      channel: "discord",
      channelKey,
      direction: "in",
      body,
      externalId: message.id
    });
    await this.invoke("session.send", {
      sessionId,
      text: body,
      ...(attachments.length > 0 ? { attachments } : {})
    });
    await this.send(threadId ?? message.channel_id, "Sedang dikerjakan...");
  }

  private cleanText(content: string): string {
    const trimmed = content.trim();
    if (!this.selfId) return trimmed;
    return trimmed.replace(new RegExp(`^<@!?${this.selfId}>\\s*`, "u"), "").trim();
  }

  private async accessAllowed(message: DiscordMessage): Promise<boolean> {
    const channelId = message.channel_id;
    if (!this.allowedChannels.has(channelId)) {
      const parent = await this.parentChannel(channelId);
      if (!parent || !this.allowedChannels.has(parent)) return false;
    }
    if (this.allowedRoles.size === 0) return true;
    const roles = message.member?.roles ?? [];
    if (roles.length === 0) return false;
    return roles.some((role) => this.allowedRoles.has(role));
  }

  private async parentChannel(channelId: string): Promise<string | undefined> {
    const known = this.threadParents.get(channelId);
    if (known) return known;
    if (this.allowedChannels.has(channelId)) return channelId;
    const info = await this.channelInfo(channelId);
    const parent = asString(info?.parent_id);
    if (parent) this.threadParents.set(channelId, parent);
    return parent;
  }

  private async sessionKeyFor(channelId: string): Promise<string> {
    if (!this.allowedChannels.has(channelId)) return (await this.parentChannel(channelId)) ?? channelId;
    const info = await this.channelInfo(channelId);
    if (info && info.type !== undefined && THREAD_TYPES.has(info.type)) {
      return asString(info.parent_id) ?? channelId;
    }
    return channelId;
  }

  private async sessionFor(message: DiscordMessage, channelKey: string): Promise<string> {
    const existing = getMappedSession(this.db, "discord", "discord", channelKey);
    if (existing) return existing;
    const title = `Discord ${message.guild_id ?? channelKey}`.slice(0, 200);
    const created = asRecord(
      await this.invoke("session.create", {
        title,
        projectPath: this.projectPath,
        permissionMode: "ask"
      })
    );
    const id = asString(created.id);
    if (!id) throw new RannError("E_INTERNAL", "session.create tidak mengembalikan id");
    ensureChannelDevice(this.db, { id: "discord", name: "Discord", profile: this.profile });
    mapSession(this.db, { deviceId: "discord", sessionId: id, channel: "discord", channelKey });
    return id;
  }

  private async ensureThread(message: DiscordMessage): Promise<string | undefined> {
    if (message.thread?.id) {
      this.trackThread(message.thread.id, message.channel_id, message.id);
      return message.thread.id;
    }
    const info = await this.channelInfo(message.channel_id);
    if (info && info.type !== undefined && THREAD_TYPES.has(info.type)) {
      this.trackThread(message.channel_id, asString(info.parent_id) ?? message.channel_id, message.id);
      return message.channel_id;
    }
    try {
      const body = asRecord(
        await this.api("POST", `/channels/${message.channel_id}/messages/${message.id}/threads`, {
          name: threadName(message.content ?? ""),
          auto_archive_duration: 1440
        })
      );
      const id = asString(body.id);
      if (!id) throw new RannError("E_INTERNAL", "Discord tidak mengembalikan id thread");
      this.trackThread(id, message.channel_id, message.id);
      return id;
    } catch (error) {
      this.logger?.warn(`gagal membuat thread discord: ${toRannError(error).message}`);
      return undefined;
    }
  }

  private trackThread(threadId: string, parentId: string, starterId: string): void {
    this.threadParents.set(threadId, parentId);
    if (!this.allowedChannels.has(threadId) && !this.extraChannels.has(threadId)) {
      if (this.extraChannels.size >= MAX_TRACKED_THREADS) {
        const oldest = this.extraChannels.values().next().value;
        if (oldest) {
          this.extraChannels.delete(oldest);
          this.threadParents.delete(oldest);
        }
      }
      this.extraChannels.add(threadId);
    }
    if (getChannelCursor(this.db, `discord:${threadId}`) === undefined) {
      setChannelCursor(this.db, `discord:${threadId}`, starterId);
    }
  }

  private async channelInfo(channelId: string): Promise<DiscordChannel | undefined> {
    if (this.channels.has(channelId)) return this.channels.get(channelId) ?? undefined;
    try {
      const body = asRecord(await this.api("GET", `/channels/${channelId}`));
      const channel: DiscordChannel = {
        id: asString(body.id) ?? channelId,
        ...(asNumber(body.type) !== undefined ? { type: asNumber(body.type) } : {}),
        parent_id: asString(body.parent_id) ?? null,
        name: asString(body.name)
      };
      this.channels.set(channelId, channel);
      return channel;
    } catch (error) {
      this.logger?.warn(`info kanal discord ${channelId} gagal: ${toRannError(error).message}`);
      this.channels.set(channelId, null);
      return undefined;
    }
  }

  private async download(message: DiscordMessage, sessionId: string): Promise<Array<{ path: string; name: string }>> {
    const files = message.attachments ?? [];
    if (files.length === 0) return [];
    const session = asRecord(await this.invoke("session.get", { sessionId }));
    const projectPath = asString(session.project_path) || this.projectPath;
    const saved: Array<{ path: string; name: string }> = [];
    for (const file of files) {
      const name = file.filename;
      if ((file.size ?? 0) > MAX_ATTACHMENT_BYTES) {
        throw new RannError("E_INPUT_TOO_LARGE", `Lampiran Discord ${file.filename} melebihi 20 MB`);
      }
      const response = await this.fetchImpl(file.url, {
        headers: { authorization: `Bot ${this.token}` },
        signal: this.abort.signal
      });
      if (!response.ok) throw new RannError("E_INTERNAL", `Unduh lampiran Discord gagal: ${String(response.status)}`);
      const bytes = await readBodyLimited(response, MAX_ATTACHMENT_BYTES);
      saved.push(saveAttachment({ bytes, name, projectPath, platform: "discord" }));
    }
    return saved;
  }

  private hasPending(sessionId: string): boolean {
    for (const item of this.pending.values()) {
      if (item.sessionId === sessionId) return true;
    }
    return false;
  }

  private findPending(sessionId: string): PendingApproval | undefined {
    let found: PendingApproval | undefined;
    for (const item of this.pending.values()) {
      if (item.sessionId === sessionId) found = item;
    }
    return found;
  }

  private async resolveApproval(
    approved: boolean,
    requestId: string | undefined,
    sessionId: string,
    reply: (text: string) => Promise<void>
  ): Promise<void> {
    const target = requestId ? this.pending.get(requestId) : this.findPending(sessionId);
    if (!target) {
      await reply("Tidak ada permintaan izin yang menunggu.");
      return;
    }
    await this.invoke("permission.respond", { requestId: target.requestId, approved, remember: false });
    this.pending.delete(target.requestId);
    await reply(approved ? `Izin ${target.requestId} disetujui.` : `Izin ${target.requestId} ditolak.`);
  }

  onEvent(event: EventEnvelope): void {
    if (event.type === "approval.request") {
      const data = asRecord(event.data);
      const requestId = asString(data.request_id);
      const binding = this.bindings.get(event.sessionId);
      if (!requestId || !binding) return;
      const tool = asString(data.tool) ?? "tool";
      const args = asRecord(data.args);
      this.pending.set(requestId, {
        requestId,
        sessionId: event.sessionId
      });
      const text = approvalText({ tool, args, requestId });
      void this.send(binding.threadId ?? binding.channelId, text).catch((error: unknown) =>
        this.logger?.warn(`gagal kirim approval discord: ${toRannError(error).message}`)
      );
      return;
    }
    if (event.type === "turn.end" && this.bindings.has(event.sessionId)) {
      void this.finishTurn(event).catch((error: unknown) =>
        this.logger?.warn(`gagal kirim hasil turn discord: ${toRannError(error).message}`)
      );
    }
  }

  private async finishTurn(event: EventEnvelope): Promise<void> {
    const binding = this.bindings.get(event.sessionId);
    if (!binding) return;
    const data = asRecord(event.data);
    if (data.status === "failed") {
      await this.send(binding.threadId ?? binding.channelId, `Turn gagal: ${String(data.error_code ?? "E_TURN_FAILED")}`);
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
      await this.send(binding.threadId ?? binding.channelId, "(selesai tanpa teks)");
      return;
    }
    recordGatewayMessage(this.db, {
      channel: "discord",
      channelKey: binding.channelKey,
      direction: "out",
      body: content,
      ...(event.turnId ? { externalId: event.turnId } : {})
    });
    await this.send(binding.threadId ?? binding.channelId, content);
  }

  async send(channelId: string, text: string): Promise<void> {
    for (const chunk of splitPlatformMessage(text, DISCORD_LIMIT, DISCORD_HARD_LIMIT)) {
      await this.api("POST", `/channels/${channelId}/messages`, {
        content: chunk,
        allowed_mentions: { parse: [] }
      });
    }
  }

  private async api(method: "GET" | "POST", path: string, payload?: JsonRecord): Promise<unknown> {
    const response = await this.fetchImpl(`${this.apiBase}${path}`, {
      method,
      headers: {
        authorization: ["Bot", this.token].join(" "),
        "content-type": "application/json"
      },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
      signal: AbortSignal.timeout(30_000)
    });
    const raw = await response.text();
    let parsed: unknown = {};
    if (raw.trim().length > 0) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = {};
      }
    }
    const body = asRecord(parsed);
    if (response.status === 429) {
      const retryAfter = Number(body.retry_after ?? 1);
      throw new RannError("E_RATE_LIMITED", `Discord rate limit, coba lagi ${retryAfter.toFixed(1)} detik`);
    }
    if (!response.ok) {
      const detail = asString(body.message) ?? `HTTP ${String(response.status)}`;
      throw new RannError("E_INTERNAL", `Discord ${method} ${path} gagal: ${detail}`);
    }
    return parsed;
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
