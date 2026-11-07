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
import {
  approvalText,
  asNumber,
  asRecord,
  asString,
  looksLikeCommand,
  MAX_ATTACHMENT_BYTES,
  normalizeApprovalReply,
  readBodyLimited,
  runTextCommand,
  saveAttachment,
  slackTsToMicros,
  splitPlatformMessage,
  stripCommandPrefix,
  type Invoke,
  type JsonRecord,
  type MessagingLogger,
  type MessagingOptions
} from "./messaging-support.js";

interface SlackFile {
  id?: string;
  name?: string;
  title?: string;
  size?: number;
  url_private?: string;
  mimetype?: string;
}

interface SlackMessage {
  type?: string;
  subtype?: string;
  user?: string;
  bot_id?: string;
  text?: string;
  ts: string;
  thread_ts?: string;
  files?: SlackFile[];
}

interface PendingApproval {
  requestId: string;
  sessionId: string;
}

interface SessionBinding {
  channelId: string;
  channelKey: string;
  threadTs?: string;
}

const SLACK_LIMIT = 3_800;
const SLACK_HARD_LIMIT = 12_000;
const SLACK_BLOCK_LIMIT = 2_900;
const SKIPPED_SUBTYPES = new Set([
  "bot_message",
  "channel_join",
  "channel_leave",
  "channel_topic",
  "channel_purpose",
  "channel_name",
  "channel_archive",
  "channel_unarchive",
  "group_join",
  "group_leave",
  "pinned_item",
  "unpinned_item"
]);

function escapeSlack(text: string): string {
  return text.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;");
}

export class SlackAdapter {
  private readonly db: Db;
  private readonly token: string;
  private readonly allowedChannels: Set<string>;
  private readonly allowedUsers: Set<string>;
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
  private readonly abort = new AbortController();
  private selfUserId?: string;
  private running = false;
  private loop?: Promise<void>;

  constructor(options: MessagingOptions) {
    const slack = options.config.messaging.slack;
    const token = slack.token_env ? process.env[slack.token_env]?.trim() : "";
    if (!token) throw new RannError("E_CONFIG_INVALID", `Env ${slack.token_env} belum diisi`);
    this.db = options.db;
    this.token = token;
    this.allowedChannels = new Set((slack.allowed_channels ?? []).map((value) => value.trim()).filter(Boolean));
    this.allowedUsers = new Set((slack.allowed_users ?? []).map((value) => value.trim()).filter(Boolean));
    this.invoke = options.invoke;
    this.logger = options.logger;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.apiBase = (options.slackApiBase ?? "https://slack.com/api").replace(/\/+$/u, "");
    this.autoPoll = options.autoPoll ?? true;
    this.pollMs = slack.poll_ms ?? 3_000;
    this.profile = options.config.gateway?.profile ?? "default";
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.loadSelf();
    this.logger?.info("adapter slack aktif");
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
      const body = asRecord(await this.api("POST", "/auth.test"));
      const userId = asString(body.user_id);
      if (userId) this.selfUserId = userId;
    } catch (error) {
      this.logger?.warn(`gagal membaca identitas bot slack: ${toRannError(error).message}`);
    }
  }

  private async runLoop(): Promise<void> {
    while (this.running) {
      try {
        await this.pollOnce();
      } catch (error) {
        if (!this.running) return;
        this.logger?.warn(`slack polling gagal: ${toRannError(error).message}`);
      }
      await this.sleep(this.pollMs);
    }
  }

  async pollOnce(): Promise<void> {
    for (const channelId of this.allowedChannels) {
      if (!this.running) return;
      try {
        await this.pollChannel(channelId);
      } catch (error) {
        this.logger?.warn(`kanal slack ${channelId} gagal: ${toRannError(error).message}`);
      }
    }
  }

  private cursorKey(channelId: string): string {
    return `slack:${channelId}`;
  }

  private async pollChannel(channelId: string): Promise<void> {
    const key = this.cursorKey(channelId);
    const stored = getChannelCursor(this.db, key);
    if (!stored) {
      const newest = await this.latestTs(channelId);
      if (newest) {
        setChannelCursor(this.db, key, newest);
        this.logger?.info(`cursor ${key} dimulai dari ${newest}`);
      }
      return;
    }
    let cursor = slackTsToMicros(stored);
    const messages = await this.fetchHistory(channelId, stored);
    const ordered = [...messages].sort((left, right) => {
      const a = slackTsToMicros(left.ts);
      const b = slackTsToMicros(right.ts);
      if (a === b) return 0;
      return a < b ? -1 : 1;
    });
    for (const message of ordered) {
      if (!this.running) return;
      const stamp = slackTsToMicros(message.ts);
      if (stamp <= cursor) continue;
      cursor = stamp;
      setChannelCursor(this.db, key, message.ts);
      try {
        await this.handleMessage(channelId, message);
      } catch (error) {
        this.logger?.warn(`pesan slack ${message.ts} gagal: ${toRannError(error).message}`);
      }
    }
  }

  private async latestTs(channelId: string): Promise<string | undefined> {
    const query = new URLSearchParams({ channel: channelId, limit: "1" });
    const body = asRecord(await this.api("GET", `/conversations.history?${query.toString()}`));
    const list = Array.isArray(body.messages) ? body.messages : [];
    return asString(asRecord(list[0]).ts);
  }

  private async fetchHistory(channelId: string, oldest: string): Promise<SlackMessage[]> {
    const query = new URLSearchParams({ channel: channelId, oldest, limit: "50" });
    const body = asRecord(await this.api("GET", `/conversations.history?${query.toString()}`));
    if (body.ok !== true) throw new RannError("E_INTERNAL", "Slack conversations.history tidak mengembalikan ok");
    const list = Array.isArray(body.messages) ? body.messages : [];
    return list.map((item) => this.toMessage(asRecord(item))).filter((item): item is SlackMessage => item !== undefined);
  }

  private toMessage(row: JsonRecord): SlackMessage | undefined {
    const ts = asString(row.ts);
    if (!ts) return undefined;
    const files = Array.isArray(row.files)
      ? row.files
          .map((item) => asRecord(item))
          .map((item) => {
            const file: SlackFile = {
              ...(asString(item.id) ? { id: asString(item.id) } : {}),
              ...(asString(item.name) ? { name: asString(item.name) } : {}),
              ...(asString(item.title) ? { title: asString(item.title) } : {}),
              ...(asNumber(item.size) !== undefined ? { size: asNumber(item.size) } : {}),
              ...(asString(item.url_private) ? { url_private: asString(item.url_private) } : {}),
              ...(asString(item.mimetype) ? { mimetype: asString(item.mimetype) } : {})
            };
            return file;
          })
      : [];
    return {
      ts,
      ...(asString(row.type) ? { type: asString(row.type) } : {}),
      ...(asString(row.subtype) ? { subtype: asString(row.subtype) } : {}),
      ...(asString(row.user) ? { user: asString(row.user) } : {}),
      ...(asString(row.bot_id) ? { bot_id: asString(row.bot_id) } : {}),
      ...(asString(row.text) ? { text: asString(row.text) } : {}),
      ...(asString(row.thread_ts) ? { thread_ts: asString(row.thread_ts) } : {}),
      ...(files.length > 0 ? { files } : {})
    };
  }

  async handleMessage(channelId: string, message: SlackMessage): Promise<void> {
    if (!message.ts) return;
    if (message.bot_id) return;
    if (this.selfUserId && message.user === this.selfUserId) return;
    if (message.subtype && SKIPPED_SUBTYPES.has(message.subtype)) return;
    if (!this.allowedChannels.has(channelId)) {
      this.logger?.warn(`kanal slack ${channelId} tidak diizinkan`);
      return;
    }
    if (this.allowedUsers.size > 0) {
      const user = message.user;
      if (!user || !this.allowedUsers.has(user)) {
        this.logger?.warn(`pengguna slack ${user ?? "tidak dikenal"} tidak diizinkan di kanal ${channelId}`);
        return;
      }
    }
    const channelKey = channelId;
    const sessionId = await this.sessionFor(channelId, channelKey);
    const text = this.cleanText(message.text ?? "");
    const threadTs = message.thread_ts ?? message.ts;
    const target = message.thread_ts ?? message.ts;
    const reply = (body: string): Promise<void> => this.send(channelId, body, target);
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
    this.bindings.set(sessionId, { channelId, channelKey, threadTs });
    let attachments: Array<{ path: string; name: string }>;
    try {
      attachments = await this.download(message, sessionId);
    } catch (error) {
      const failure = toRannError(error);
      this.logger?.warn(`lampiran slack ${message.ts} gagal: ${failure.message}`);
      await this.send(channelId, `Lampiran gagal diproses: ${failure.message}`, target);
      return;
    }
    const body = text.length > 0 ? text : attachments.length > 0 ? "[lampiran]" : "";
    if (!body) return;
    recordGatewayMessage(this.db, {
      channel: "slack",
      channelKey,
      direction: "in",
      body,
      externalId: message.ts
    });
    await this.invoke("session.send", {
      sessionId,
      text: body,
      ...(attachments.length > 0 ? { attachments } : {})
    });
    await this.send(channelId, "Sedang dikerjakan...", threadTs);
  }

  private cleanText(content: string): string {
    const trimmed = content.trim();
    if (!this.selfUserId) return trimmed;
    return trimmed.replace(new RegExp(`^<@${this.selfUserId}>\\s*`, "u"), "").trim();
  }

  private async sessionFor(channelId: string, channelKey: string): Promise<string> {
    const existing = getMappedSession(this.db, "slack", "slack", channelKey);
    if (existing) return existing;
    const title = `Slack ${channelId}`.slice(0, 200);
    const created = asRecord(
      await this.invoke("session.create", {
        title,
        projectPath: this.projectPath,
        permissionMode: "ask"
      })
    );
    const id = asString(created.id);
    if (!id) throw new RannError("E_INTERNAL", "session.create tidak mengembalikan id");
    ensureChannelDevice(this.db, { id: "slack", name: "Slack", profile: this.profile });
    mapSession(this.db, { deviceId: "slack", sessionId: id, channel: "slack", channelKey });
    return id;
  }

  private async download(message: SlackMessage, sessionId: string): Promise<Array<{ path: string; name: string }>> {
    const files = message.files ?? [];
    if (files.length === 0) return [];
    const session = asRecord(await this.invoke("session.get", { sessionId }));
    const projectPath = asString(session.project_path) || this.projectPath;
    const saved: Array<{ path: string; name: string }> = [];
    for (const file of files) {
      const url = file.url_private;
      if (!url) continue;
      const name = file.name ?? file.title ?? "lampiran";
      if ((file.size ?? 0) > MAX_ATTACHMENT_BYTES) {
        throw new RannError("E_INPUT_TOO_LARGE", `Lampiran Slack ${name} melebihi 20 MB`);
      }
      const response = await this.fetchImpl(url, {
        headers: { authorization: ["Bearer", this.token].join(" ") },
        signal: this.abort.signal
      });
      if (!response.ok) throw new RannError("E_INTERNAL", `Unduh lampiran Slack gagal: ${String(response.status)}`);
      const bytes = await readBodyLimited(response, MAX_ATTACHMENT_BYTES);
      saved.push(saveAttachment({ bytes, name, projectPath, platform: "slack" }));
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
      void this.postApproval(binding.channelId, approvalText({ tool, args, requestId }), binding.threadTs).catch((error: unknown) =>
        this.logger?.warn(`gagal kirim approval slack: ${toRannError(error).message}`)
      );
      return;
    }
    if (event.type === "turn.end" && this.bindings.has(event.sessionId)) {
      void this.finishTurn(event).catch((error: unknown) =>
        this.logger?.warn(`gagal kirim hasil turn slack: ${toRannError(error).message}`)
      );
    }
  }

  private async finishTurn(event: EventEnvelope): Promise<void> {
    const binding = this.bindings.get(event.sessionId);
    if (!binding) return;
    const data = asRecord(event.data);
    if (data.status === "failed") {
      await this.send(binding.channelId, `Turn gagal: ${String(data.error_code ?? "E_TURN_FAILED")}`, binding.threadTs);
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
      await this.send(binding.channelId, "(selesai tanpa teks)", binding.threadTs);
      return;
    }
    recordGatewayMessage(this.db, {
      channel: "slack",
      channelKey: binding.channelKey,
      direction: "out",
      body: content,
      ...(event.turnId ? { externalId: event.turnId } : {})
    });
    await this.send(binding.channelId, content, binding.threadTs);
  }

  async send(channelId: string, text: string, threadTs?: string): Promise<void> {
    for (const chunk of splitPlatformMessage(text, SLACK_LIMIT, SLACK_HARD_LIMIT)) {
      const payload: JsonRecord = {
        channel: channelId,
        text: chunk,
        unfurl_links: false,
        unfurl_media: false
      };
      if (threadTs) payload.thread_ts = threadTs;
      await this.api("POST", "/chat.postMessage", payload);
    }
  }

  private async postApproval(channelId: string, text: string, threadTs?: string): Promise<void> {
    const payload: JsonRecord = {
      channel: channelId,
      text,
      unfurl_links: false,
      unfurl_media: false
    };
    if (threadTs) payload.thread_ts = threadTs;
    const escaped = escapeSlack(text);
    if (escaped.length <= SLACK_BLOCK_LIMIT) {
      payload.blocks = [
        {
          type: "section",
          text: { type: "mrkdwn", text: escaped }
        }
      ];
    }
    await this.api("POST", "/chat.postMessage", payload);
  }

  private async api(method: "GET" | "POST", path: string, payload?: JsonRecord): Promise<unknown> {
    const response = await this.fetchImpl(`${this.apiBase}${path}`, {
      method,
      headers: {
        authorization: ["Bearer", this.token].join(" "),
        "content-type": "application/json; charset=utf-8"
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
    if (body.ok !== true) {
      const detail = asString(body.error) ?? `HTTP ${String(response.status)}`;
      if (detail === "ratelimited") {
        throw new RannError("E_RATE_LIMITED", "Slack rate limit, coba lagi nanti");
      }
      if (detail === "invalid_auth" || detail === "not_authed" || detail === "account_inactive") {
        throw new RannError("E_CONFIG_INVALID", `Slack auth gagal: ${detail}`);
      }
      throw new RannError("E_INTERNAL", `Slack ${method} ${path} gagal: ${detail}`);
    }
    return body;
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
