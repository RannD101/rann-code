#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { RannError, exitCodeFor, loadConfig, providerFor, toRannError, type ErrorCode } from "@rann/shared";
import { destructiveReason } from "@rann/runtime";
import { buildProjectMap, commitMessage, ensureLayout, formatReview, projectMapSummary, resolveHome, resolveLayout, reviewUnifiedDiff, saveProjectMap, type RpcClient } from "@rann/runtime";
import { appendAudit, createBackup, createGatewayUser, disableGatewayUser, exportAuditJsonl, listGatewayUsers, openDatabase, updateGatewayUserRole, inspectDatabase, verifyAuditChain, listBackups, renderGoal, restoreBackup, verifyBackup, type GoalView } from "@rann/storage";
import { parseArgs, flagBool, flagString, type ParsedArgs } from "./args.js";
import { ensureDaemon, packageVersion, tryConnect } from "./daemon.js";
import { setConfigValue, unsetConfigValue } from "./config-store.js";
import { choose, chooseWith, clearScreen, colorDepth, colorEnabled, colorsEnabled, loadCustomThemeIfPresent, print, printErr, relativeTime, setTheme, table, themeTokens, ui } from "./ui.js";
import { runStreaming, type ApprovalDecision, type ApprovalRequest, type OutputFormat, type StreamResult } from "./stream.js";
import { commandName, completeReplLine, findReplCommand, isAvailable, matchReplCommands, nearestCommands, renderCommandCatalog, REPL_COMMANDS, type ReplCommand } from "./repl-commands.js";
import { registerProjectCommands } from "./project-commands.js";
import { HistoryStore } from "./history.js";
import { expandCustomCommand, loadCustomCommands, type CustomCommand } from "./custom-commands.js";
import { LineEditor, ReplExit } from "./line-editor.js";
import { previewEdit } from "./edit-preview.js";
import { formatApprovalArgs } from "./approval.js";
import { ctrlDAction, renderHeader } from "./session-header.js";
import { statusPrompt as renderStatusPrompt } from "./tui/status.js";
import { renderEditPreview } from "./tui/tool-view.js";
import { renderPlan } from "./tui/plan-view.js";
import { renderAgents } from "./tui/agent-view.js";
import { resolveUiMode, type UiMode } from "./tui/modes.js";
import { renderDiffText } from "./tui/diff-view.js";
import { chooseTurnFailureAction } from "./turn-failure.js";
import { setLocale, tr } from "./i18n.js";



const KNOWN_COMMANDS = new Set([
  "version",
  "help",
  "daemon",
  "doctor",
  "sessions",
  "new",
  "send",
  "resume",
  "run",
  "plan",
  "chat",
  "models",
  "providers",
  "provider",
  "secret",
  "route",
  "usage",
  "turn",
  "config",
  "init",
  "memory",
  "skill",
  "gateway",
  "messaging",
  "agent",
  "backup",
  "plugin",
  "plugins",
  "hooks",
  "audit"
]);

async function main(argv: string[]): Promise<number> {
  const first = argv[0];
  const args =
    first !== undefined && !first.startsWith("-") && !KNOWN_COMMANDS.has(first)
      ? parseArgs(["run", ...argv])
      : parseArgs(argv);
  try {
    setLocale(loadConfig({ home: resolveHome() }).config.ui.language);
  } catch {
    setLocale("id");
  }

  if (flagBool(args, "no-color")) process.env.NO_COLOR = "1";
  const themeFlag = flagString(args, "theme");
  if (themeFlag !== undefined) {
    if (themeFlag !== "dark" && themeFlag !== "light" && themeFlag !== "minimal" && themeFlag !== "auto" && themeFlag !== "custom") {
      throw new RannError("E_INVALID_PARAMS", "--theme harus dark, light, minimal, auto, atau custom.");
    }
    setTheme(themeFlag);
  }

  if (flagBool(args, "version")) {
    print(`rann-code ${packageVersion()}`);
    return 0;
  }
  if (flagBool(args, "help")) {
    print(renderCommandCatalog(packageVersion(), args.positionals[0]));
    return 0;
  }
  const barePrompt = flagString(args, "prompt");
  if (args.command === undefined) {
    const positionalPrompt = args.positionals.join(" ").trim();
    if (positionalPrompt.length > 0) return await runPrompt(args, positionalPrompt);
    if (barePrompt) return await runPrompt(args, barePrompt);
    if (process.stdin.isTTY && process.stdout.isTTY) return await chatCommand(args);
    if (!process.stdin.isTTY) return await chatCommand(args);
  }
  if (args.command === undefined) {
    print(renderCommandCatalog(packageVersion()));
    return 0;
  }

  switch (args.command) {
    case "version":
      print(`rann-code ${packageVersion()}`);
      return 0;
    case "help":
      print(renderCommandCatalog(packageVersion(), args.positionals[0]));
      return 0;
    case "daemon":
      return await daemonCommand(args);
    case "gateway":
      return await gatewayCommand(args);
    case "messaging":
      return await messagingCommand(args);
    case "agent":
      return await agentCommand(args);
    case "doctor":
      return await doctorCommand(args);
    case "backup":
      return await backupCommand(args);
    case "audit":
      return await auditCommand(args);
    case "sessions":
      return await sessionsCommand(args);
    case "new":
      return await newCommand(args);
    case "send":
      return await sendCommand(args);
    case "resume":
      return await sendCommand(args);
    case "chat":
      return await chatCommand(args);
    case "models":
      return await modelsCommand(args);
    case "providers":
      return await providersCommand(args);
    case "provider":
      return await providerCommand(args);
    case "usage":
      return await usageCommand(args);
    case "turn":
      return await turnCommand(args);
    case "config":
      return await configCommand(args);
    case "memory":
      return await memoryCommand(args);
    case "secret":
      return await secretCommand(args);
    case "route":
      return await routeCommand(args);
    case "skill":
      return await skillCommand(args);
    case "plugin":
    case "plugins":
      return await pluginCommand(args);
    case "hooks":
      return await hooksCommand(args);
    case "init":
      return initCommand();
    case "run": {
      const prompt = [flagString(args, "prompt"), args.positionals.join(" ").trim()].filter((part): part is string => Boolean(part)).join("\n");
      return await runPrompt(args, prompt);
    }
    case "plan": {
      const prompt = args.positionals.join(" ").trim();
      if (prompt.length === 0) throw new RannError("E_INVALID_PARAMS", "Pakai: rann plan \"instruksi\"");
      return await runPrompt(args, prompt);
    }
    default: {
      const prompt = args.positionals.join(" ").trim();
      if (prompt.length > 0) return await runPrompt(args, prompt);
      throw new RannError("E_INVALID_PARAMS", `Command tidak dikenal: ${args.command}. Jalankan rann --help.`);
    }
  }
}

function homeLayout() {
  return resolveLayout(resolveHome(), process.env.RANN_PROFILE ?? "default");
}

async function withClient<T>(fn: (client: RpcClient) => Promise<T>): Promise<T> {
  const client = await ensureDaemon();
  try {
    return await fn(client);
  } finally {
    client.close();
  }
}

async function daemonCommand(args: ParsedArgs): Promise<number> {
  if (args.subcommand === "start") {
    const client = await ensureDaemon();
    const health = await client.request<Record<string, unknown>>("health");
    client.close();
    print(`daemon jalan, pid ${health.pid}, socket ${health.socket}`);
    const recovered = Array.isArray(health.recovered_turns) ? health.recovered_turns : [];
    if (recovered.length > 0) print(`memulihkan ${recovered.length} turn yang terputus`);
    return 0;
  }
  if (args.subcommand === "stop") {
    const client = await tryConnect();
    if (!client) {
      print("daemon tidak berjalan");
      return 0;
    }
    await client.request("shutdown", { graceful: true });
    client.close();
    print("daemon dihentikan");
    return 0;
  }
  if (args.subcommand === "status" || args.subcommand === undefined) {
    const client = await tryConnect();
    if (!client) {
      print(`daemon tidak berjalan (socket ${homeLayout().socketPath})`);
      return 1;
    }
    const health = await client.request<Record<string, unknown>>("health");
    client.close();
    if (flagBool(args, "json")) {
      print(JSON.stringify(health, null, 2));
    } else {
      print(`status   ${health.status}`);
      print(`pid      ${health.pid}`);
      print(`uptime   ${Math.round((health.uptime_ms as number) / 1000)} detik`);
      print(`socket   ${health.socket}`);
      print(`database ${(health.database as { path: string }).path} (skema ${(health.database as { schema_version: number }).schema_version})`);
    }
    return 0;
  }
  throw new RannError("E_INVALID_PARAMS", `Subcommand daemon tidak dikenal: ${args.subcommand}`);
}

interface GatewayDevice {
  id: string;
  name: string;
  role: string;
  scopes: string[];
  last_seen_at: number | null;
  revoked_at: number | null;
}

interface GatewayStatus {
  running: boolean;
  host: string;
  port: number;
  public_url: string | null;
  tls: boolean;
  clients: number;
  devices: number;
  started_at: number | null;
}

async function gatewayCommand(args: ParsedArgs): Promise<number> {
  const sub = args.subcommand ?? "status";
  if (sub === "enable" || sub === "disable") {
    const home = resolveHome();
    mkdirSync(join(home, "config"), { recursive: true });
    setConfigValue(home, "gateway.enabled", sub === "enable" ? "true" : "false");
    print(`gateway.enabled ${sub === "enable" ? "true" : "false"} ditulis ke config global.`);
    if (sub === "enable") {
      return withClient(async (client) => {
        const status = await client.request<GatewayStatus>("gateway.start", {});
        printGatewayStatus(status);
        return 0;
      });
    }
    print("Gateway yang sedang berjalan tetap hidup sampai daemon di-restart.");
    return 0;
  }
  return withClient(async (client) => {
    if (sub === "status") {
      const status = await client.request<GatewayStatus>("gateway.status", {});
      printGatewayStatus(status);
      if (flagBool(args, "json")) print(JSON.stringify(status, null, 2));
      return 0;
    }
    if (sub === "start") {
      printGatewayStatus(await client.request<GatewayStatus>("gateway.start", {}));
      return 0;
    }
    if (sub === "stop") {
      printGatewayStatus(await client.request<GatewayStatus>("gateway.stop", {}));
      return 0;
    }
    if (sub === "pair") {
      const status = await client.request<GatewayStatus>("gateway.status", {});
      const result = await client.request<{ code: string; expiresAt: number }>("gateway.pair", {});
      const url = status.public_url ?? `http://${status.host}:${String(status.port)}`;
      print(`Kode pairing : ${result.code}`);
      print(`Dashboard    : ${url}`);
      print(`Berlaku      : ${Math.max(1, Math.round((result.expiresAt - Date.now()) / 60_000))} menit`);
      print("Buka dashboard, masukkan kode dan nama perangkat.");
      return 0;
    }
    if (sub === "devices") {
      const devices = await client.request<GatewayDevice[]>("gateway.devices", {});
      if (flagBool(args, "json")) {
        print(JSON.stringify(devices, null, 2));
        return 0;
      }
      if (devices.length === 0) {
        print("Belum ada perangkat terdaftar.");
        return 0;
      }
      print(
        table(
          ["id", "nama", "role", "scope", "terakhir", "status"],
          devices.map((device) => [
            device.id,
            device.name,
            device.role,
            device.scopes.join(","),
            device.last_seen_at ? relativeTime(device.last_seen_at) : "-",
            device.revoked_at ? "dicabut" : "aktif"
          ])
        )
      );
      return 0;
    }
    if (sub === "revoke") {
      const id = args.positionals[0];
      if (!id) throw new RannError("E_INVALID_PARAMS", "Pakai: rann gateway revoke <id>");
      const result = await client.request<{ revoked: boolean }>("gateway.revoke", { id });
      print(result.revoked ? `Perangkat ${id} dicabut.` : `Perangkat ${id} tidak ditemukan atau sudah dicabut.`);
      return result.revoked ? 0 : 1;
    }
    if (sub === "role") {
      const id = args.positionals[0];
      const role = args.positionals[1];
      if (!id || !role) throw new RannError("E_INVALID_PARAMS", "Pakai: rann gateway role <id> owner|operator|viewer|approver");
      const device = await client.request<GatewayDevice | null>("gateway.role", { id, role });
      if (!device) throw new RannError("E_NOT_FOUND", `Perangkat tidak ditemukan: ${id}`);
      print(`${device.name}: role ${device.role}, scope ${device.scopes.join(",")}`);
      return 0;
    }
    if (sub === "stats") {
      const stats = await client.request<Record<string, number>>("gateway.stats", {});
      print(JSON.stringify(stats, null, 2));
      return 0;
    }
    if (sub === "nodes") {
      const data = await client.request<{ local: Record<string, unknown>; nodes: Array<Record<string, unknown>> }>("gateway.nodes", {});
      if (flagBool(args, "json")) print(JSON.stringify(data, null, 2));
      else {
        print(`lokal  ${String(data.local.name)}  versi ${String(data.local.version)}  pid ${String(data.local.pid)}`);
        for (const node of data.nodes) print(`${node.ok ? "OK  " : "FAIL"}  ${String(node.name)}  ${String(node.url)}  ${node.ok ? `versi ${String(node.version)}` : String(node.error ?? node.status)}`);
      }
      return 0;
    }
    if (sub === "users") {
      const opened = openDatabase({ path: homeLayout().dbPath, backupBeforeMigrate: false });
      try {
        const users = listGatewayUsers(opened.db);
        if (flagBool(args, "json")) print(JSON.stringify(users, null, 2));
        else if (users.length === 0) print("Belum ada pengguna lokal.");
        else {
          print(table(["id", "nama", "role", "status"], users.map((user) => [user.id, user.name, user.role, user.disabled_at ? "nonaktif" : "aktif"])));
        }
      } finally {
        opened.db.close();
      }
      return 0;
    }
    if (sub === "user") {
      const action = args.positionals[0];
      const opened = openDatabase({ path: homeLayout().dbPath, backupBeforeMigrate: false });
      try {
        if (action === "add") {
          const name = args.positionals[1];
          const role = (args.positionals[2] ?? "operator") as "owner" | "operator" | "viewer" | "approver";
          if (!name) throw new RannError("E_INVALID_PARAMS", "Pakai: rann gateway user add <nama> [owner|operator|viewer|approver]");
          if (!["owner", "operator", "viewer", "approver"].includes(role)) throw new RannError("E_INVALID_PARAMS", "Role tidak valid");
          print(JSON.stringify(createGatewayUser(opened.db, { name, role }), null, 2));
          return 0;
        }
        if (action === "role") {
          const id = args.positionals[1];
          const role = args.positionals[2] as "owner" | "operator" | "viewer" | "approver";
          if (!id || !role) throw new RannError("E_INVALID_PARAMS", "Pakai: rann gateway user role <id> <role>");
          const updated = updateGatewayUserRole(opened.db, id, role);
          if (!updated) throw new RannError("E_NOT_FOUND", `Pengguna tidak ditemukan: ${id}`);
          print(`${updated.name}: role ${updated.role}`);
          return 0;
        }
        if (action === "disable") {
          const id = args.positionals[1];
          if (!id) throw new RannError("E_INVALID_PARAMS", "Pakai: rann gateway user disable <id>");
          print(disableGatewayUser(opened.db, id) ? `Pengguna ${id} dinonaktifkan.` : `Pengguna ${id} tidak ditemukan.`);
          return 0;
        }
      } finally {
        opened.db.close();
      }
      print("Pakai: rann gateway user add|role|disable");
      return 0;
    }
    throw new RannError(
      "E_INVALID_PARAMS",
      "Pakai: rann gateway status|start|stop|pair|devices|revoke|role|stats|users|user|enable|disable"
    );
  });
}

interface MessagingStatus {
  telegram: { enabled: boolean; active: boolean; chats: number; pending: number };
}

async function messagingCommand(args: ParsedArgs): Promise<number> {
  const sub = args.subcommand ?? "status";
  if (sub === "enable" || sub === "disable") {
    const home = resolveHome();
    mkdirSync(join(home, "config"), { recursive: true });
    setConfigValue(home, "messaging.telegram.enabled", sub === "enable" ? "true" : "false");
    print(`messaging.telegram.enabled ${sub === "enable" ? "true" : "false"} ditulis ke config global.`);
    print("Restart daemon agar perubahan berlaku.");
    return 0;
  }
  return withClient(async (client) => {
    if (sub === "status") {
      const status = await client.request<MessagingStatus>("messaging.status", {});
      const telegram = status.telegram;
      print(`telegram  ${telegram.active ? "aktif" : telegram.enabled ? "gagal start" : "mati"}`);
      print(`chat      ${telegram.chats} diizinkan`);
      print(`approval  ${telegram.pending} menunggu`);
      if (flagBool(args, "json")) print(JSON.stringify(status, null, 2));
      return 0;
    }
    if (sub === "send") {
      const chatId = Number(args.positionals[0]);
      const text = args.positionals.slice(1).join(" ").trim();
      if (!Number.isFinite(chatId) || !text) {
        throw new RannError("E_INVALID_PARAMS", "Pakai: rann messaging send <chat_id> <teks>");
      }
      const result = await client.request<{ sent: boolean; chunks: number }>("messaging.send", {
        chat_id: chatId,
        text
      });
      print(`Terkirim ke ${chatId} dalam ${result.chunks} bagian.`);
      return 0;
    }
    throw new RannError("E_INVALID_PARAMS", "Pakai: rann messaging status|enable|disable|send");
  });
}

interface AgentRow {
  id: string;
  profile: string;
  goal: string;
  status: string;
  depth: number;
  steps: number;
  cost_usd: number;
  model?: string | null;
  children?: AgentRow[];
  result?: { text?: string; files_changed?: string[]; error?: string } | string;
}

interface AgentProfileInfo {
  name: string;
  description: string;
  permission: string;
  max_steps: number;
  source: string;
  tools: string[] | "*";
}

function printAgentTree(rows: AgentRow[], indent = 0): void {
  for (const row of rows) {
    const pad = "  ".repeat(indent);
    const color = row.status === "done" || row.status === "completed" ? ui.green : row.status === "failed" ? ui.red : row.status === "running" ? ui.yellow : ui.dim;
    print(`${pad}${ui.accent(row.id)}  ${ui.fg(row.profile.padEnd(10))} ${color(row.status.padEnd(9))} ${ui.dim(`${row.steps} langkah  $${row.cost_usd.toFixed(4)}`)}  ${row.goal.slice(0, 60)}`);
    if (row.children && row.children.length > 0) printAgentTree(row.children, indent + 1);
  }
}

async function agentCommand(args: ParsedArgs): Promise<number> {
  const sub = args.subcommand ?? "list";
  return withClient(async (client) => {
    if (sub === "list") {
      const tree = flagBool(args, "tree");
      const rows = await client.request<AgentRow[]>("agent.list", {
        ...(tree ? { tree: true } : {}),
        ...(typeof args.flags.status === "string" ? { status: args.flags.status } : {}),
        ...(typeof args.flags.limit === "string" ? { limit: Number(args.flags.limit) } : {})
      });
      if (flagBool(args, "json")) {
        print(JSON.stringify(rows, null, 2));
        return 0;
      }
      if (rows.length === 0) {
        print("Belum ada subagent.");
        return 0;
      }
      if (tree) printAgentTree(rows);
      else {
        for (const line of renderAgents(rows.map((row) => ({
          id: row.id,
          profile: row.profile,
          status: row.status,
          goal: `${row.goal.slice(0, 60)}  ${row.steps} langkah  $${row.cost_usd.toFixed(4)}`
        })))) print(line);
      }
      return 0;
    }
    if (sub === "get") {
      const id = args.positionals[0];
      if (!id) throw new RannError("E_INVALID_PARAMS", "Pakai: rann agent get <agent_id>");
      const row = await client.request<AgentRow & { messages: unknown[] }>("agent.get", { id });
      if (flagBool(args, "json")) {
        print(JSON.stringify(row, null, 2));
        return 0;
      }
      print(`agent    ${row.id}`);
      print(`profil   ${row.profile}`);
      print(`status   ${row.status}`);
      print(`model    ${row.model ?? "-"}`);
      print(`langkah  ${row.steps}`);
      print(`biaya    $${row.cost_usd.toFixed(4)}`);
      print(`tujuan   ${row.goal}`);
      if (row.result && typeof row.result === "object") {
        if (row.result.text) print(`hasil    ${row.result.text.slice(0, 2_000)}`);
        if (row.result.error) print(`error    ${row.result.error}`);
        if (row.result.files_changed && row.result.files_changed.length > 0) {
          print(`berkas   ${row.result.files_changed.join(", ")}`);
        }
      }
      print(`pesan    ${row.messages.length}`);
      return 0;
    }
    if (sub === "cancel") {
      const id = args.positionals[0];
      if (!id) throw new RannError("E_INVALID_PARAMS", "Pakai: rann agent cancel <agent_id>");
      const result = await client.request<{ cancelled: string[] }>("agent.cancel", { id });
      print(`Dibatalkan: ${result.cancelled.join(", ")}`);
      return 0;
    }
    if (sub === "message") {
      const [to, subject, ...rest] = args.positionals;
      const body = rest.join(" ").trim();
      if (!to || !subject || !body) {
        throw new RannError("E_INVALID_PARAMS", "Pakai: rann agent message <agent_id> <subjek> <isi>");
      }
      const result = await client.request<{ id: string }>("agent.message", {
        from: "cli",
        to,
        subject,
        body,
        type: "note",
        priority: "normal"
      });
      print(`Pesan ${result.id} dikirim ke ${to}.`);
      return 0;
    }
    if (sub === "profiles") {
      const rows = await client.request<AgentProfileInfo[]>("agent.profiles", {});
      if (flagBool(args, "json")) {
        print(JSON.stringify(rows, null, 2));
        return 0;
      }
      for (const row of rows) {
        const tools = row.tools === "*" ? "semua" : `${row.tools.length} tool`;
        print(`${row.name.padEnd(11)} ${row.permission.padEnd(12)} ${String(row.max_steps).padStart(2)} langkah  ${tools.padEnd(10)} ${row.source}  ${row.description}`);
      }
      return 0;
    }
    throw new RannError("E_INVALID_PARAMS", "Pakai: rann agent list|get|cancel|profiles|message");
  });
}

function printGatewayStatus(status: GatewayStatus): void {
  print(`status   ${status.running ? "aktif" : "mati"}`);
  print(`alamat   ${status.public_url ?? `${status.host}:${String(status.port)}`}${status.tls ? " (TLS)" : ""}`);
  print(`klien    ${status.clients}`);
  print(`perangkat ${status.devices}`);
  if (status.started_at) print(`uptime   ${Math.round((Date.now() - status.started_at) / 1000)} detik`);
}

interface Check {
  name: string;
  ok: boolean;
  detail: string;
  level: "ok" | "warn" | "fail";
}

async function auditCommand(args: ParsedArgs): Promise<number> {
  const layout = homeLayout();
  ensureLayout(layout);
  if (!existsSync(layout.dbPath)) throw new RannError("E_NOT_FOUND", "Database belum ada. Jalankan daemon dulu.");
  const opened = openDatabase({ path: layout.dbPath, backupBeforeMigrate: true });
  try {
    const sub = args.positionals[0] ?? "verify";
    if (sub === "verify") {
      const result = verifyAuditChain(opened.db);
      print(result.ok ? "rantai audit valid" : `rantai audit rusak di ${result.brokenAt ?? "entri tidak diketahui"}`);
      return result.ok ? 0 : 1;
    }
    if (sub === "export") {
      const target = args.positionals[1];
      if (!target) throw new RannError("E_INVALID_PARAMS", "Pakai: rann audit export <file>");
      const result = exportAuditJsonl(opened.db, isAbsolute(target) ? target : resolve(process.cwd(), target));
      print(`${result.entries} entri audit diekspor ke ${result.path}`);
      return 0;
    }
    throw new RannError("E_INVALID_PARAMS", "Pakai: rann audit verify|export <file>");
  } finally {
    opened.db.close();
  }
}

async function backupCommand(args: ParsedArgs): Promise<number> {
  const layout = homeLayout();
  ensureLayout(layout);
  const backupDir = join(dirname(layout.dbPath), "backups");
  if (!existsSync(layout.dbPath)) {
    const created = openDatabase({ path: layout.dbPath, backupBeforeMigrate: false });
    created.db.close();
  }
  const sub = args.positionals[0] ?? "create";
  const file = args.positionals[1];
  if (sub === "create") {
    const result = createBackup(layout.dbPath, backupDir);
    print(`backup dibuat: ${result.path} (${(result.size / 1_048_576).toFixed(2)} MB)`);
    return 0;
  }
  if (sub === "list") {
    const rows = listBackups(backupDir);
    if (rows.length === 0) {
      print("belum ada backup");
      return 0;
    }
    for (const row of rows) print(`${row.created_at}  ${(row.size / 1_048_576).toFixed(2)} MB  ${row.path}`);
    return 0;
  }
  if (sub === "verify") {
    if (!file) throw new RannError("E_INVALID_PARAMS", "Pakai: rann backup verify <file>");
    const result = verifyBackup(isAbsolute(file) ? file : resolve(process.cwd(), file));
    print(`integrity: ${result.integrity}; foreign_key_violations: ${result.foreign_keys}`);
    return result.ok ? 0 : 1;
  }
  if (sub === "restore") {
    if (!file) throw new RannError("E_INVALID_PARAMS", "Pakai: rann backup restore <file>");
    if (existsSync(layout.socketPath)) {
      throw new RannError("E_CONFLICT", "Daemon masih berjalan. Hentikan dulu (rann daemon stop) lalu ulangi restore.");
    }
    const result = restoreBackup(isAbsolute(file) ? file : resolve(process.cwd(), file), layout.dbPath);
    print(`database dipulihkan dari ${result.restored}; salinan sebelum restore: ${result.safety_copy}`);
    return 0;
  }
  throw new RannError("E_INVALID_PARAMS", "Pakai: rann backup create|list|verify <file>|restore <file>");
}

async function doctorCommand(args: ParsedArgs): Promise<number> {
  const layout = homeLayout();
  ensureLayout(layout);
  const checks: Check[] = [];

  checks.push({ name: "versi", ok: true, level: "ok", detail: `rann-code ${packageVersion()}` });
  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  const minor = Number.parseInt(process.versions.node.split(".")[1] ?? "0", 10);
  const nodeOk = major > 22 || (major === 22 && minor >= 11);
  checks.push({ name: "node", ok: nodeOk, level: nodeOk ? "ok" : "fail", detail: `v${process.versions.node} (butuh >= 22.11)` });

  const { statSync } = await import("node:fs");
  try {
    const mode = statSync(layout.home).mode & 0o777;
    const ok = (mode & 0o077) === 0;
    checks.push({ name: "home", ok, level: ok ? "ok" : "warn", detail: `${layout.home} mode ${mode.toString(8)}` });
  } catch (error) {
    checks.push({ name: "home", ok: false, level: "fail", detail: `tidak bisa dibaca: ${(error as Error).message}` });
  }

  const client = await tryConnect();
  if (client) {
    const health = await client.request<Record<string, unknown>>("health");
    client.close();
    checks.push({ name: "daemon", ok: true, level: "ok", detail: `pid ${health.pid}, socket aktif` });
  } else {
    checks.push({ name: "daemon", ok: false, level: "warn", detail: `belum jalan (${layout.socketPath})` });
  }

  const inspection = inspectDatabase(layout.dbPath);
  const dbExists = inspection.schemaVersion > 0 || inspection.ok;
  checks.push({
    name: "database",
    ok: inspection.ok,
    level: inspection.ok ? "ok" : dbExists ? "fail" : "warn",
    detail: inspection.ok
      ? `skema ${inspection.schemaVersion}, integrity ${inspection.integrity ?? "ok"}, foreign key ${inspection.foreignKeyViolations ?? 0}`
      : dbExists
        ? inspection.problems.join("; ")
        : "belum dibuat, akan dibuat saat daemon start"
  });

  try {
    const loaded = loadConfig({ home: layout.home });
    const provider = providerFor(loaded.config);
    const envName = provider.api_key_env;
    const envOk = provider.kind === "mock" || (envName !== undefined && Boolean(process.env[envName])) || Boolean(provider.api_key_file);
    checks.push({
      name: "config",
      ok: true,
      level: "ok",
      detail: `${loaded.files.length} berkas, provider ${loaded.config.provider}, mode ${loaded.config.permissions.mode}`
    });
    checks.push({
      name: "provider-key",
      ok: envOk,
      level: envOk ? "ok" : "warn",
      detail: envName ? `env ${envName}${process.env[envName] ? " terisi" : " kosong"}` : provider.kind === "mock" ? "mock tidak butuh key" : "key belum diatur"
    });
    const gateway = loaded.config.gateway;
    const loopback = gateway.host === "127.0.0.1" || gateway.host === "::1" || gateway.host === "localhost";
    checks.push({
      name: "gateway",
      ok: !gateway.enabled || loopback,
      level: gateway.enabled && !loopback ? "warn" : "ok",
      detail: gateway.enabled ? `${gateway.host}:${gateway.port}${loopback ? " (lokal)" : " (terbuka)"}` : "nonaktif"
    });
    const tlsOk = gateway.tls_cert === undefined || (existsSync(gateway.tls_cert) && gateway.tls_key !== undefined && existsSync(gateway.tls_key));
    checks.push({
      name: "gateway-tls",
      ok: tlsOk,
      level: tlsOk ? "ok" : "warn",
      detail: gateway.tls_cert === undefined ? "tidak memakai TLS" : tlsOk ? "sertifikat dan key ada" : "sertifikat atau key tidak ditemukan"
    });
  } catch (error) {
    const err = toRannError(error);
    checks.push({ name: "config", ok: false, level: "fail", detail: err.message });
  }

  const failed = checks.filter((check) => check.level === "fail").length;
  if (flagBool(args, "json")) {
    print(JSON.stringify({ ok: failed === 0, checks }, null, 2));
  } else {
    for (const check of checks) {
      const label = check.level === "ok" ? ui.green("OK  ") : check.level === "warn" ? ui.yellow("WARN") : ui.red("FAIL");
      print(`${label} ${check.name.padEnd(12)} ${check.detail}`);
    }
    print("");
    print(failed === 0 ? "instalasi siap dipakai" : `${failed} pemeriksaan gagal`);
  }
  return failed === 0 ? 0 : 1;
}

async function sessionsCommand(args: ParsedArgs): Promise<number> {
  const limit = Number.parseInt(flagString(args, "limit") ?? "20", 10);
  const status = flagString(args, "status");
  const project = flagString(args, "project");
  const scopeProject = flagBool(args, "all") ? undefined : (project ?? process.cwd());
  const sessions = await withClient((client) =>
    client.request<Array<Record<string, unknown>>>("session.list", {
      limit,
      ...(status ? { status } : {}),
      ...(scopeProject ? { projectPath: scopeProject } : {})
    })
  );
  if (flagBool(args, "json")) {
    print(JSON.stringify(sessions, null, 2));
    return 0;
  }
  if (sessions.length === 0) {
    print("belum ada sesi. Jalankan rann \"tugas pertama\".");
    return 0;
  }
  const rows = sessions.map((session) => [
    String(session.id),
    String(session.status),
    String(session.model),
    relativeTime(Number(session.updated_at)),
    String(session.title)
  ]);
  print(table(["ID", "STATUS", "MODEL", "DIUBAH", "JUDUL"], rows));
  return 0;
}

async function newCommand(args: ParsedArgs): Promise<number> {
  const session = await withClient((client) =>
    client.request<Record<string, unknown>>("session.create", {
      title: flagString(args, "title"),
      model: flagString(args, "model"),
      permissionMode: flagString(args, "permission"),
      projectPath: process.cwd()
    })
  );
  if (flagBool(args, "json")) {
    print(JSON.stringify(session, null, 2));
  } else {
    print(`${session.id}  ${session.title}  (${session.model}, ${session.permission_mode})`);
  }
  return 0;
}

async function sendCommand(args: ParsedArgs): Promise<number> {
  const sessionId = args.positionals[0];
  const text = args.positionals.slice(1).join(" ").trim();
  if (!sessionId || text.length === 0) throw new RannError("E_INVALID_PARAMS", "Pakai: rann send <sesi> \"instruksi\"");
  return await sendToSession(sessionId, text, args);
}

async function readPipedStdin(): Promise<string> {
  if (process.stdin.isTTY === true) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  const buffer = Buffer.concat(chunks);
  const sample = buffer.subarray(0, 8_192);
  const control = [...sample].filter((byte) => byte < 9 || (byte > 13 && byte < 32)).length;
  if (buffer.includes(0) || (sample.length > 0 && control / sample.length > 0.15)) {
    throw new RannError("E_INVALID_PARAMS", "Input stdin terlihat biner. Kirim teks, atau lampirkan berkas dengan @path.");
  }
  return buffer.toString("utf8").trim();
}

async function runPrompt(args: ParsedArgs, text: string): Promise<number> {
  const stdin = await readPipedStdin();
  if (stdin.length > 200_000) printErr(ui.yellow(`stdin dipotong dari ${stdin.length} ke 200.000 karakter.`));
  const prompt = stdin.length > 0 ? `${text}\n\nKonteks tambahan dari stdin:\n${stdin.slice(0, 200_000)}` : text;
  if (prompt.trim().length === 0) throw new RannError("E_INVALID_PARAMS", "Prompt kosong. Pakai: rann \"instruksi\"");
  const { sessionId, reused } = await withClient(async (client) => {
    const sessions = await client.request<Array<Record<string, unknown>>>("session.list", {
      limit: 50,
      status: "active",
      projectPath: process.cwd()
    });
    const target = sessions[0];
    if (target?.id) return { sessionId: target.id as string, reused: true };
    const created = await client.request<Record<string, unknown>>("session.create", {
      title: prompt.slice(0, 70),
      model: flagString(args, "model"),
      permissionMode: flagString(args, "permission"),
      projectPath: process.cwd()
    });
    return { sessionId: created.id as string, reused: false };
  });
  if (!reused && resolveOutputFormat(args) === "text") printErr(ui.dim(`sesi ${sessionId}`));
  return await sendToSession(sessionId, prompt, args);
}

function resolveOutputFormat(args: ParsedArgs): OutputFormat {
  const raw = flagString(args, "output-format") ?? (flagBool(args, "json") ? "json" : "text");
  if (raw === "text" || raw === "json" || raw === "stream-json" || raw === "ndjson") return raw;
  throw new RannError("E_INVALID_PARAMS", `output-format tidak dikenal: ${raw}. Pakai text, json, stream-json, atau ndjson.`);
}

async function sendToSession(sessionId: string, text: string, args: ParsedArgs): Promise<number> {
  const output = resolveOutputFormat(args);
  const client = await ensureDaemon();
  try {
    if (flagBool(args, "detach")) {
      const started = await client.request<Record<string, unknown>>("session.send", {
        sessionId,
        text,
        ...(flagString(args, "model") ? { model: flagString(args, "model") } : {}),
        ...(flagString(args, "permission") ? { permissionMode: flagString(args, "permission") } : {}),
        ...(flagBool(args, "plan") || args.command === "plan" ? { planOnly: true } : {})
      });
      const turnId = String(started.turnId);
      if (output === "json") {
        print(JSON.stringify({ ok: true, session_id: sessionId, turn_id: turnId, status: "running" }));
      } else if (output === "stream-json") {
        print(JSON.stringify({ type: "detached", session_id: sessionId, turn_id: turnId }));
      } else {
        print(`turn ${turnId} berjalan di latar (sesi ${sessionId})`);
        print(ui.dim(`cek: rann turn ${turnId} --wait`));
      }
      return 0;
    }
    const result = await runStreaming(client, sessionId, text, {
      model: flagString(args, "model"),
      permissionMode: flagString(args, "permission"),
      output,
      planOnly: flagBool(args, "plan") || flagBool(args, "plan-only") || args.command === "plan",
      onApproval: makeApprovalHandler(args)
    });
    const planOnly = flagBool(args, "plan") || flagBool(args, "plan-only") || args.command === "plan";
    if (output === "json" || (planOnly && result.plan)) {
      const payload = {
        ok: result.ok,
        text: result.text,
        result: result.text,
        sessionId,
        session_id: sessionId,
        taskId: result.turnId,
        turn_id: result.turnId,
        status: result.ok ? "done" : "failed",
        steps: result.steps,
        usage: {
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          input_tokens: result.usage.inputTokens,
          output_tokens: result.usage.outputTokens
        },
        ...(result.plan ? { plan: result.plan } : {}),
        error: result.error ?? null
      };
      process.stdout.write(`${JSON.stringify(payload)}\n`);
    }
    if (result.ok) return 0;
    return result.error ? (exitCodeFor(result.error.code as ErrorCode) ?? 1) : 1;
  } finally {
    client.close();
  }
}

function makeApprovalHandler(
  args: ParsedArgs,
  ask?: (question: string) => Promise<string>
): ((request: ApprovalRequest) => Promise<ApprovalDecision>) | undefined {
  if (flagBool(args, "yes")) {
    return async (request) => {
      const requestArgs = request.args !== null && typeof request.args === "object" ? (request.args as Record<string, unknown>) : {};
      const destructive = request.tool === "shell_run" && typeof requestArgs.command === "string"
        ? destructiveReason(requestArgs.command)
        : undefined;
      if (destructive || request.risk === "high") return { approved: false };
      return { approved: true };
    };
  }
  if (process.stdin.isTTY !== true) return undefined;
  return async (request) => {
    const args = request.args !== null && typeof request.args === "object" ? (request.args as Record<string, unknown>) : {};
    const detail = formatApprovalArgs(args, 600);
    const fullDetail = (): string => formatApprovalArgs(args);
    const dangerous = request.risk === "high" ? "task rencana berisiko tinggi" : request.reason ?? (request.tool === "shell_run" && typeof args.command === "string" ? destructiveReason(args.command) : undefined);
    const impact = dangerous
      ? `DESTRUKTIF: ${dangerous}. Operasi ini bisa menghilangkan data dan tidak selalu bisa dibatalkan.`
      : request.tool === "shell_run"
      ? "menjalankan perintah shell di folder project"
      : request.tool === "git_write"
        ? "mengubah riwayat git atau mendorong commit ke remote"
        : request.tool === "checkpoint_restore"
          ? "mengembalikan berkas ke snapshot lama"
          : /write|edit|delete|patch|apply/.test(request.tool)
            ? "menulis atau mengubah berkas di workspace"
            : "menjalankan tool dengan izin tulis di workspace";
    const targetValue = args.path ?? args.file ?? args.cwd ?? args.url ?? args.domain ?? args.target;
    const target = typeof targetValue === "string" ? `\n  target: ${targetValue}` : "";
    const preview = previewEdit(request.tool, request.args, process.cwd());
    const width = process.stdout.columns ?? 80;
    const prompt = [
      "",
      ui.border("─".repeat(Math.max(20, width))),
      `${ui.bold(ui.yellow("Perlu izin"))}  ${ui.accent(request.tool)}`,
      `  ${ui.dim("args")}    ${detail}`,
      `  ${ui.dim("dampak")}  ${impact}${target}`,
      ...(preview ? ["", ...renderEditPreview(preview)] : []),
      ui.border("─".repeat(Math.max(20, width))),
      ui.dim(width >= 100 ? "A izinkan sekali   S izinkan sesi ini   D tolak   V detail   Esc tolak" : "A/S/D/V · Esc tolak")
    ].join("\n");
    if (request.tool === "plan" && ask) {
      const planText = typeof args.text === "string" ? args.text : fullDetail();
      print(planText);
      const reply = (await ask("Setujui rencana? semua / sebagian / tolak [a/s/t]: ")).trim().toLowerCase();
      if (reply === "s" || reply === "sebagian") {
        const ids = (await ask("ID task yang disetujui, pisahkan dengan koma: ")).split(",").map((item) => item.trim()).filter(Boolean);
        if (ids.length === 0) return { approved: false, reason: "tidak ada task dipilih" };
        return { approved: true, taskIds: ids, note: "persetujuan sebagian" };
      }
      if (reply === "a" || reply === "semua" || reply === "y" || reply === "ya") {
        return { approved: true, reason: "disetujui semua lewat dialog rencana" };
      }
      return { approved: false, reason: "rencana ditolak user" };
    }
    const choices = [
      { key: "once", shortcut: "A", label: "Izinkan sekali" },
      { key: "always", shortcut: "S", label: "Selalu izinkan pola ini (tool + target) di sesi ini" },
      { key: "deny", shortcut: "D", label: "Tolak" }
    ] as const;
    const showDetails = (): void => {
      print("");
      print(ui.border("─".repeat(Math.max(20, width))));
      print(`${ui.label("detail")} ${ui.accent(request.tool)}${request.risk ? ui.dim(`  risiko ${request.risk}`) : ""}`);
      print(fullDetail());
      print(ui.border("─".repeat(Math.max(20, width))));
    };
    const answer = ask
      ? await chooseWith(async (question) => {
          const reply = (await ask(question)).trim();
          return /^(n|no|tidak)$/i.test(reply) ? "deny" : reply;
        }, prompt, [...choices], "deny", showDetails)
      : await choose(prompt, [...choices], "deny");
    return {
      approved: answer !== "deny",
      remember: answer === "always",
      reason: answer === "deny" ? "ditolak user lewat dialog izin" : "disetujui user lewat dialog izin"
    };
  };
}

const PERMISSION_MODES = ["read-only", "ask", "accept-edits", "trusted", "custom"] as const;

function extractAttachments(line: string): { text: string; attachments: Array<{ path: string; name: string }> } {
  const attachments: Array<{ path: string; name: string }> = [];
  const pattern = /(^|\s)@(?:"([^"]+)"|'([^']+)'|(\S+))/g;
  for (const match of line.matchAll(pattern)) {
    const raw = (match[2] ?? match[3] ?? match[4] ?? "").trim();
    if (raw.length === 0) continue;
    const expanded = raw.startsWith("~") ? join(process.env.HOME ?? process.env.USERPROFILE ?? "", raw.slice(1)) : raw;
    const absolute = isAbsolute(expanded) ? expanded : join(process.cwd(), expanded);
    if (!existsSync(absolute)) {
      throw new RannError("E_INVALID_PARAMS", `Lampiran tidak ditemukan: ${raw}. Periksa path atau kutip nama yang mengandung spasi.`);
    }
    const name = basename(absolute);
    if (!attachments.some((item) => item.path === absolute)) attachments.push({ path: absolute, name });
  }
  return { text: line, attachments };
}

async function chatCommand(args: ParsedArgs): Promise<number> {
  let uiMode: UiMode = "interactive";
  try {
    uiMode = resolveUiMode(flagString(args, "ui") ?? process.env.RANN_UI_MODE);
  } catch (error) {
    throw new RannError("E_INVALID_PARAMS", error instanceof Error ? error.message : String(error));
  }
  // Header dicetak sebelum daemon dinyalakan supaya REPL terlihat di bawah
  // satu detik, lalu diulang dengan data sesi setelah tersambung (AC-001).
  if (process.stdin.isTTY === true) {
    for (const line of renderHeader({
      cwd: process.cwd(),
      session: "baru",
      model: flagString(args, "model") ?? "default",
      permission: flagString(args, "permission") ?? "default",
      profile: process.env.RANN_PROFILE ?? "default",
      mode: uiMode
    })) {
      print(line);
    }
  }
  const client = await ensureDaemon();
  try {
    const requestedSession = flagString(args, "session");
    let session: Record<string, unknown> | undefined;
    if (requestedSession) {
      session = await client.request<Record<string, unknown>>("session.get", { sessionId: requestedSession });
    } else {
      const sessions = await client.request<Array<Record<string, unknown>>>("session.list", {
        limit: 1,
        status: "active",
        projectPath: process.cwd()
      });
      session = sessions[0];
    }
    if (!session?.id) {
      session = await client.request<Record<string, unknown>>("session.create", {
        title: `Chat ${process.cwd().split("/").pop() ?? "project"}`,
        model: flagString(args, "model"),
        permissionMode: flagString(args, "permission"),
        projectPath: process.cwd()
      });
    }
    let sessionId = String(session.id);
    let model = flagString(args, "model") ?? (session.model ? String(session.model) : undefined);
    let permissionMode = flagString(args, "permission") ?? (session.permission_mode ? String(session.permission_mode) : undefined);
    const layout = homeLayout();
    loadCustomThemeIfPresent(resolveHome());
    const history = new HistoryStore(layout.historyDir, process.cwd());
    const reloadCustomCommands = (): CustomCommand[] => {
      const loaded = loadCustomCommands({
        homeDir: join(resolveHome(), "commands"),
        projectDir: join(process.cwd(), ".rann", "commands"),
        coreNames: REPL_COMMANDS.map((command) => command.name)
      });
      for (const message of loaded.errors) printErr(ui.yellow(`perintah kustom: ${message}`));
      return loaded.commands;
    };
    const custom = { commands: reloadCustomCommands() };
    const findCustom = (name: string): CustomCommand | undefined =>
      custom.commands.find((command) => command.name === name || command.aliases.includes(name));
    let branch = "";
    try {
      branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      branch = "";
    }
    let busy = false;
    let totalTokens = 0;
    let totalCost = 0;
    let lastTurnCost: number | null | undefined;
    let lastInputTokens = 0;
    let lastOutputTokens = 0;
    let contextLimit = 24_000;
    let providerName = "";
    let providerStatus = "unknown";
    let agentCount = 0;
    let lastTurnMs = 0;
    let lastTurnId: string | undefined;
    let lastCancelled = false;
    let lastResponse = "";
    let pendingAttachment: { name: string; content: string } | undefined;
    const onSigint = async (): Promise<void> => {
      if (!busy) return;
      try {
        await client.request("session.cancel", { sessionId });
        print(ui.yellow("SIGINT: turn dibatalkan"));
      } catch (error) {
        printErr(ui.red(`gagal membatalkan turn: ${error instanceof Error ? error.message : String(error)}`));
      }
    };
    const sigintListener = (): void => { void onSigint(); };
    process.on("SIGINT", sigintListener);

    let showStatusBar = true;
    let hideUnavailable = true;
    const sessionLabel = (): string => (sessionId.length > 8 ? sessionId.slice(0, 8) : sessionId);
    const statusPrompt = (): string => {
      const width = process.stdout.columns ?? 80;
      const percent = contextLimit > 0 ? Math.min(100, Math.round((lastInputTokens / contextLimit) * 100)) : undefined;
      return renderStatusPrompt({
        width,
        model: model ?? "default",
        ...(providerName ? { provider: providerName } : {}),
        ...(providerStatus ? { providerStatus } : {}),
        ...(branch ? { branch } : {}),
        ...(permissionMode ? { permission: permissionMode } : {}),
        session: sessionLabel(),
        project: process.cwd().split(/[\\/]/).pop() ?? process.cwd(),
        ...(percent !== undefined ? { contextPercent: percent } : {}),
        inputTokens: lastInputTokens,
        outputTokens: lastOutputTokens,
        totalTokens,
        turnCost: lastTurnCost,
        dayCost: totalCost,
        agents: agentCount,
        mode: uiMode,
        task: busy ? `${tr("aktif", "active")}${lastTurnMs > 0 ? ` ${(lastTurnMs / 1000).toFixed(1)}s` : ""}` : tr("siap", "ready"),
        ...(pendingAttachment ? { task: tr("lampiran", "attachment") + " " + pendingAttachment.name } : {})
      }, showStatusBar);
    };

    let disabledShortcuts: string[] = (process.env.RANN_DISABLED_SHORTCUTS ?? "").split(",").map((item) => item.trim()).filter(Boolean);
    try {
      const configReply = await client.request<Record<string, unknown>>("config.get", {});
      const configValue = (configReply.config as Record<string, unknown> | undefined) ?? configReply;
      if (typeof configValue.provider === "string") providerName = configValue.provider;
      const uiConfig = (configValue.ui as Record<string, unknown> | undefined) ?? {};
      if (uiConfig.status_bar === false || uiConfig.statusBar === false) showStatusBar = false;
      hideUnavailable = uiConfig.hide_unavailable !== false && uiConfig.hideUnavailable !== false;
      try {
        const listed = await client.request<Array<Record<string, unknown>>>("provider.list");
        const active = listed.find((item) => item.name === providerName) ?? listed[0];
        if (active && typeof active.health === "string") providerStatus = active.health;
        if (active && active.health !== "ok") {
          const backup = listed.find((item) => item.name !== providerName && item.health === "ok");
          if (backup) providerStatus = `${providerStatus} -> ${String(backup.name)}`;
        }
      } catch {
        // status provider tidak menghalangi sesi
      }
      const contextValue = configValue.context as Record<string, unknown> | undefined;
      if (typeof contextValue?.max_tokens === "number" && contextValue.max_tokens > 0) contextLimit = contextValue.max_tokens;
      try {
        const listedModels = await client.request<Record<string, unknown>>("model.list");
        const descriptors = (listedModels.descriptors as Array<Record<string, unknown>> | undefined) ?? [];
        const activeModel = descriptors.find((item) => item.id === model || item.model === model);
        if (typeof activeModel?.contextWindow === "number" && activeModel.contextWindow > 0) contextLimit = activeModel.contextWindow;
      } catch {
        // context window model bersifat pelengkap
      }
      const uiValue = configValue.ui as Record<string, unknown> | undefined;
      const configured = uiValue?.disabled_shortcuts ?? uiValue?.disable_shortcuts;
      if (Array.isArray(configured)) disabledShortcuts = configured.map((item) => String(item));
    } catch {
      // config lama atau daemon yang belum siap tidak boleh menghalangi sesi chat
    }
    const editor = new LineEditor({
      plain: !colorEnabled(),
      disabledShortcuts,
      history,
      busy: () => busy,
      prompt: statusPrompt,
      palette: [
        ...REPL_COMMANDS.filter((command: ReplCommand) => !hideUnavailable || isAvailable(command)).map((command: ReplCommand) => ({
          name: command.name,
          description: isAvailable(command)
            ? command.description
            : `${command.description} [tidak tersedia${command.unavailableReason ? `: ${command.unavailableReason}` : ""}]`,
          category: command.category,
          usage: command.usage
        })),
        ...custom.commands.map((command) => ({
          name: command.name,
          description: command.description,
          category: command.source === "project" ? "proyek" : "umum",
          usage: `/${command.name}${command.args.map((arg) => (arg.required ? ` <${arg.name}>` : ` [${arg.name}]`)).join("")}`
        }))
      ],
      completer: async (line: string, cursor: number) => {
        const before = line.slice(0, cursor);
        if (/^\/[^\s]*$/.test(before)) {
          const [items] = completeReplLine(before);
          const query = before.slice(1).toLowerCase();
          const extra = custom.commands
            .filter((command) => command.name.startsWith(query) || command.aliases.some((alias) => alias.startsWith(query)))
            .map((command) => `/${command.name}`);
          return { start: 0, items: [...new Set([...items, ...extra])].map((value) => ({ value })) };
        }
        const match = /^(\/[a-z-]+)\s+(.*)$/.exec(before);
        if (!match) return { start: cursor, items: [] };
        const command = match[1] ?? "";
        const rest = match[2] ?? "";
        const start = before.length - rest.length;
        const query = rest.split(/\s+/).pop() ?? "";
        const tokenStart = start + Math.max(0, rest.length - query.length);
        if (command === "/model") {
          const data = await client.request<Record<string, unknown>>("model.list");
          const models = (data.models as string[] | undefined) ?? [];
          return { start: tokenStart, items: models.filter((item) => item.startsWith(query)).map((value) => ({ value })) };
        }
        if (command === "/provider" || command === "/providers") {
          const list = await client.request<Array<Record<string, unknown>>>("provider.list");
          return { start: tokenStart, items: list.map((item) => String(item.name)).filter((item) => item.startsWith(query)).map((value) => ({ value })) };
        }
        if (command === "/permission") {
          return { start: tokenStart, items: PERMISSION_MODES.filter((item) => item.startsWith(query)).map((value) => ({ value })) };
        }
        if (command === "/theme") {
          return { start: tokenStart, items: ["dark", "light", "minimal", "auto", "custom"].filter((item) => item.startsWith(query)).map((value) => ({ value })) };
        }
        if (command === "/task") {
          return { start: tokenStart, items: ["list", "show", "add", "prioritas", "priority", "retry", "cancel", "block"].filter((item) => item.startsWith(query)).map((value) => ({ value })) };
        }
        if (command === "/plan") {
          return { start: tokenStart, items: ["show", "approve", "reject", "revise", "pause", "resume"].filter((item) => item.startsWith(query)).map((value) => ({ value })) };
        }
        if (command === "/mcp") {
          const list = await client.request<Array<Record<string, unknown>>>("mcp.list");
          return { start: tokenStart, items: ["list", "add", "remove", "test", "reload", ...list.map((item) => String(item.name))].filter((item) => item.startsWith(query)).map((value) => ({ value })) };
        }
        if (command === "/agent" || command === "/agents") {
          const list = await client.request<Array<Record<string, unknown>>>("agent.list", { sessionId, limit: 20 });
          return { start: tokenStart, items: list.map((item) => String(item.id ?? item.profile ?? "")).filter((item) => item.length > 0 && item.startsWith(query)).map((value) => ({ value })) };
        }
        if (command === "/resume" || command === "/history") {
          const list = await client.request<Array<Record<string, unknown>>>("session.list", { limit: 20, projectPath: process.cwd() });
          return { start: tokenStart, items: list.map((item) => String(item.id)).filter((item) => item.startsWith(query)).map((value) => ({ value })) };
        }
        if (command === "/skill") {
          const list = await client.request<Array<Record<string, unknown>>>("skill.list", { projectPath: process.cwd(), limit: 50 });
          return { start: tokenStart, items: list.map((item) => String(item.name)).filter((item) => item.startsWith(query)).map((value) => ({ value })) };
        }
        if (command === "/attach" || command === "/files" || command === "/export") {
          try {
            const directory = resolve(process.cwd(), rest.slice(0, rest.length - query.length));
            const items = readdirSync(directory, { withFileTypes: true })
              .filter((entry) => entry.name.startsWith(query))
              .slice(0, 50)
              .map((entry) => ({ value: `${entry.name}${entry.isDirectory() ? "/" : ""}` }));
            return { start: tokenStart, items };
          } catch {
            return { start: tokenStart, items: [] };
          }
        }
        return { start: cursor, items: [] };
      },
      onCancel: async () => {
        if (!busy) return false;
        const result = await client.request<Record<string, unknown>>("session.cancel", { sessionId });
        return result.cancelled === true;
      },
      onCtrlD: async (isBusy: boolean) => ctrlDAction(isBusy, (title, options, fallback) => choose(title, options, fallback)),
      onExpand: async () => {
        if (!lastTurnId) return lastResponse || undefined;
        const data = await client.request<Record<string, unknown>>("session.get", { sessionId });
        const messages = ((data.messages as Array<Record<string, unknown>> | undefined) ?? []).filter(
          (message) => message.role === "tool" && message.turn_id === lastTurnId
        );
        const blocks: string[] = [];
        for (const message of messages) {
          const text = String(message.content ?? "");
          const label = String((message.content_json as Record<string, unknown> | undefined)?.toolName ?? "tool");
          if (text.length > 20_000) {
            const name = `tool-${Date.now()}-${blocks.length}.txt`;
            const path = join(layout.artifactsDir, name);
            writeFileSync(path, text, { mode: 0o600 });
            blocks.push(`${label}: output ${String(text.length)} karakter, disimpan di ${path}`);
          } else if (text.length > 0) {
            blocks.push(`${label}:\n${text}`);
          }
        }
        return blocks.length > 0 ? blocks.join("\n\n") : lastResponse || undefined;
      }
    });
    const askApproval = (question: string): Promise<string> => {
      const pending = editor.readLine(question, { escapeSubmits: true });
      const onData = (chunk: Buffer | string): void => {
        const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        if (text.includes("\u001b")) editor.cancelRead();
      };
      process.stdin.on("data", onData);
      return pending.finally(() => process.stdin.off("data", onData));
    };
    const onApproval = makeApprovalHandler(args, askApproval);

    const header = (): void => {
      for (const line of renderHeader({
        cwd: process.cwd(),
        ...(branch ? { branch } : {}),
        session: sessionLabel(),
        model: model ?? "default",
        permission: permissionMode ?? "default",
        profile: process.env.RANN_PROFILE ?? "default",
        mode: uiMode,
        ...(providerName ? { provider: providerName } : {})
      })) {
        print(line);
      }
    };

    const outgoing = (text: string): string => {
      const attachment = pendingAttachment;
      pendingAttachment = undefined;
      if (!attachment) return text;
      return `<file name="${attachment.name}">\n${attachment.content}\n</file>\n\n${text}`;
    };

    const recordResult = async (result: StreamResult): Promise<void> => {
      lastInputTokens = result.usage.inputTokens;
      lastOutputTokens = result.usage.outputTokens;
      totalTokens += result.usage.inputTokens + result.usage.outputTokens;
      lastResponse = result.text;
      lastTurnId = result.turnId;
      lastCancelled = !result.ok && result.error?.code === "E_CANCELLED";
      lastTurnMs = result.durationMs;
      try {
        const listed = await client.request<Array<Record<string, unknown>>>("provider.list");
        const active = listed.find((item) => item.name === providerName);
        if (active && typeof active.health === "string") providerStatus = active.health;
      } catch {
        // abaikan kegagalan pembacaan status
      }
      lastTurnCost = result.costUsd;
      try {
        const listedAgents = await client.request<Array<Record<string, unknown>>>("agent.list", { limit: 100 });
        agentCount = listedAgents.length;
      } catch {
        // jumlah agen bersifat pelengkap
      }
      try {
        const budget = await client.request<Record<string, unknown>>("budget.status", {});
        totalCost = Number(budget.spent_usd_today ?? totalCost);
      } catch {
        // status biaya bersifat pelengkap
      }
    };

    if (process.stdin.isTTY !== true) {
      const rawText = readFileSync(0, "utf8").trim();
      const text = rawText.slice(0, 200_000);
      if (text.length === 0) throw new RannError("E_INVALID_PARAMS", "Tidak ada input di stdin");
      if (rawText.length > text.length) printErr(ui.yellow(`stdin dipotong dari ${rawText.length} ke 200.000 karakter.`));
      const result = await runStreaming(client, sessionId, text, {
        ...(model ? { model } : {}),
        ...(permissionMode ? { permissionMode } : {}),
        ...(onApproval ? { onApproval } : {})
      });
      if (result.ok) return 0;
      return result.error ? (exitCodeFor(result.error.code as ErrorCode) ?? 1) : 1;
    }

    registerProjectCommands(process.cwd());
    header();
    try {
      const listedAgents = await client.request<Array<Record<string, unknown>>>("agent.list", { limit: 100 });
      agentCount = listedAgents.length;
    } catch {
      // jumlah agen bersifat pelengkap
    }
    const bootHealth = await client.request<Record<string, unknown>>("health");
    const recoveredTurns = Array.isArray(bootHealth.recovered_turns) ? bootHealth.recovered_turns : [];
    if (recoveredTurns.length > 0) {
      print(ui.yellow(`${recoveredTurns.length} turn sebelumnya terputus, riwayat sudah ditandai. Kirim pesan untuk melanjutkan.`));
    }
    try {
      for (;;) {
        const line = (await editor.readLine()).trim();
        if (line.length === 0) continue;
        if (line === "/exit" || line === "/quit" || line === "/q") {
          try {
            await client.request("session.end", { sessionId });
          } catch {
            // Sesi mungkin sudah berakhir; keluar tetap dilanjutkan.
          }
          break;
        }
        if (line === "/review" || line.startsWith("/review ")) {
          const target = line.slice(7).trim();
          try {
            const args = ["diff", "--no-color"];
            if (target.length > 0) {
              const pathArg = existsSync(resolve(process.cwd(), target)) ? "--" : target;
              args.push(pathArg);
              if (pathArg === "--") args.push(target);
            }
            const diff = execFileSync("git", args, { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
            print(renderDiffText(formatReview(reviewUnifiedDiff(diff))));
          } catch {
            print(ui.red("gagal membaca diff: bukan repositori git, ref tidak dikenal, atau git tidak tersedia"));
          }
          continue;
        }
        if (line === "/help" || line.startsWith("/help ")) {
          const query = line.slice(5).trim();
          if (query === "keys") {
            print(ui.bold("shortcut"));
            print(table(
              ["tombol", "aksi", "status"],
              [
                ["Enter", "kirim", "aktif"],
                ["Shift+Enter / Ctrl+J", "baris baru", "aktif"],
                ["Alt+Up / Alt+Down", "pindah baris", "aktif"],
                ["Ctrl+P / Ctrl+N", "pindah baris", "aktif"],
                ["Ctrl+A", "awal baris", "aktif"],
                ["Ctrl+U", "hapus ke awal baris", "aktif"],
                ["Ctrl+W", "hapus kata", "aktif"],
                ["Ctrl+R", "cari riwayat", "aktif"],
                ["Ctrl+K", "command palette", "aktif"],
                ["Ctrl+O", "perluas output tool", "aktif"],
                ["Ctrl+E", "editor eksternal", "aktif"],
                ["Ctrl+L", "bersihkan layar", "aktif"],
                ["Ctrl+C", "bersihkan atau batalkan", "aktif"],
                ["Ctrl+D", "keluar saat input kosong", "aktif"],
                ["PgUp / PgDn", "gulir transcript", "tidak tersedia di editor internal; pakai scrollback terminal"]
              ]
            ));
            print(ui.dim("Ctrl+E dipakai untuk editor eksternal; akhir baris memakai End atau Ctrl+End."));
            continue;
          }
          const commands = query ? matchReplCommands(query, { includeUnavailable: true }) : REPL_COMMANDS;
          if (commands.length === 0) {
            print(`tidak ada perintah cocok "${query}"`);
          } else {
            const categories = ["umum", "sesi", "model", "agen", "memori", "skill", "tool", "proyek", "konfigurasi", "infra"] as const;
            for (const category of categories) {
              const items = commands.filter((command) => command.category === category);
              if (items.length === 0) continue;
              print(ui.bold(category));
              for (const command of items) {
                const suffix = isAvailable(command) ? "" : `  [belum tersedia: ${command.unavailableReason ?? "backend"}]`;
                print(`  ${command.usage.padEnd(32)} ${command.description}${suffix}`);
              }
            }
            if (custom.commands.length > 0) {
              print(ui.bold("command kustom"));
              for (const command of custom.commands) {
                const usage = `/${command.name}${command.args.map((arg) => (arg.required ? ` <${arg.name}>` : ` [${arg.name}]`)).join("")}`;
                print(`  ${usage.padEnd(32)} ${command.description}  [${command.source}]`);
              }
            }
          }
          continue;
        }
        if (line.startsWith("!")) {
          const toModel = line.startsWith("!!");
          const command = line.slice(toModel ? 2 : 1).trim();
          if (command.length === 0) {
            print(ui.red("Pakai: !<command> atau !!<command>"));
            continue;
          }
          if (permissionMode === "read-only") {
            printErr(ui.red("Mode read-only menolak shell passthrough. Ubah mode izin lewat /permission."));
            continue;
          }
          const riskReason = destructiveReason(command);
          const risky = riskReason !== undefined || /\bsudo\b|\bmkfs|\bdd\s+if=|\bshutdown\b|\breboot\b|>\s*\/dev\/sd|\bchmod\s+777/.test(command);
          if (risky && permissionMode !== "trusted") {
            const answer = (await editor.readLine(ui.yellow(`perintah berisiko${riskReason ? ` (${riskReason})` : ""}. jalankan? [y/N] `))).trim().toLowerCase();
            if (answer !== "y" && answer !== "ya") {
              print(ui.dim("dibatalkan"));
              continue;
            }
          }
          busy = true;
          try {
            const result = spawnSync("bash", ["-lc", command], {
              cwd: process.cwd(),
              encoding: "utf8",
              timeout: 120_000,
              maxBuffer: 10 * 1024 * 1024,
              env: Object.fromEntries(Object.entries(process.env).filter(([name]) => !/(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|COOKIE|SESSION)/i.test(name)))
            });
            const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
            const status = result.status ?? (result.error ? 1 : 0);
            if (output.length > 100_000) {
              const path = join(layout.artifactsDir, `shell-${Date.now()}.txt`);
              writeFileSync(path, output, { mode: 0o600 });
              print(output.slice(0, 6_000));
              print(ui.dim(`output ${output.length} karakter, disimpan di ${path}`));
            } else if (output.length > 0) {
              process.stdout.write(output.endsWith("\n") ? output : `${output}\n`);
            }
            print(ui.dim(`[shell] exit ${status}`));
            if (toModel) {
              const context = `Konteks dari perintah shell \`${command}\` (exit ${status}):\n\n${output.slice(0, 50_000)}`;
              const resultTurn = await runStreaming(client, sessionId, outgoing(context), {
                ...(model ? { model } : {}),
                ...(permissionMode ? { permissionMode } : {}),
                ...(onApproval ? { onApproval } : {})
              });
              await recordResult(resultTurn);
            }
          } catch (error) {
            print(ui.red(`gagal menjalankan shell: ${error instanceof Error ? error.message : String(error)}`));
          } finally {
            busy = false;
          }
          continue;
        }
        if (line.startsWith("/")) {
          const requested = commandName(line);
          const customCommand = findCustom(requested);
          if (customCommand) {
            const rawArguments = line.slice(requested.length + 1).trim();
            let promptText: string;
            try {
              promptText = expandCustomCommand(customCommand, rawArguments);
            } catch (error) {
              print(ui.red(error instanceof Error ? error.message : String(error)));
              continue;
            }
            busy = true;
            try {
              const result = await runStreaming(client, sessionId, outgoing(promptText), {
                ...(model ? { model } : {}),
                ...(permissionMode ? { permissionMode } : {}),
                ...(onApproval ? { onApproval } : {})
              });
              await recordResult(result);
              if (!result.ok) print(ui.red("[command gagal]"));
            } finally {
              busy = false;
            }
            continue;
          }
        }
        if (line.startsWith("/") && !findReplCommand(commandName(line))) {
          const suggestions = nearestCommands(commandName(line), 3);
          print(ui.red(`E_UNKNOWN_COMMAND: /${commandName(line)} tidak dikenal di mode ini.`));
          if (suggestions.length > 0) print(`mungkin: ${suggestions.map((item) => `/${item.name}`).join(", ")}`);
          else print("jalankan /help untuk daftar perintah.");
          continue;
        }
        if (line.startsWith("/")) {
          const registered = findReplCommand(commandName(line));
          if (registered && !isAvailable(registered)) {
            print(ui.yellow(`/${registered.name} belum tersedia: ${registered.unavailableReason ?? "backend belum ada"}`));
            continue;
          }
          if (registered?.source === "project") {
            const argument = line.trim().slice(registered.name.length + 1).trim();
            busy = true;
            try {
              const result = await runStreaming(client, sessionId, argument ? `${registered.handler}\n\nArgumen: ${argument}` : registered.handler, {
                ...(model ? { model } : {}),
                ...(permissionMode ? { permissionMode } : {}),
                ...(onApproval ? { onApproval } : {})
              });
              await recordResult(result);
              if (!result.ok) print(ui.red("[command proyek gagal]"));
            } finally {
              busy = false;
            }
            continue;
          }
        }
        if (line === "/memory" || line.startsWith("/memory ")) {
          const query = line.slice(7).trim();
          if (query === "pending") {
            const candidates = await client.request<MemoryView[]>("memory.pending", { projectPath: process.cwd(), limit: 50 });
            if (candidates.length === 0) print("tidak ada kandidat memori");
            else for (const entry of candidates) print(`${entry.id}  [${entry.kind}] ${entry.text}`);
            continue;
          }
          if (query.startsWith("approve ") || query.startsWith("reject ")) {
            const [action, id, ...rest] = query.split(/\s+/);
            if (!id) {
              print(`Pakai: /memory ${action} <id> [teks baru]`);
              continue;
            }
            if (action === "approve") {
              const entry = await client.request<MemoryView>("memory.approve", {
                projectPath: process.cwd(),
                id,
                ...(rest.length > 0 ? { text: rest.join(" ") } : {})
              });
              print(`memori ${entry.id} disetujui`);
            } else {
              const result = await client.request<{ rejected: number }>("memory.reject", { projectPath: process.cwd(), id });
              print(result.rejected > 0 ? `kandidat ${id} ditolak` : `kandidat ${id} tidak ditemukan`);
            }
            continue;
          }
          const entries = await client.request<MemoryView[]>(query ? "memory.search" : "memory.list", {
            projectPath: process.cwd(),
            ...(query ? { query, limit: 20 } : { scope: "all", limit: 30 })
          });
          if (entries.length === 0) print(query ? `tidak ada memori cocok "${query}"` : "belum ada memori");
          else for (const entry of entries) print(`${entry.id}  [${entry.scope}] ${entry.text}`);
          continue;
        }
        if (line.startsWith("/remember ")) {
          const text = line.slice(10).trim();
          if (text.length === 0) {
            print("Pakai: /remember <teks>");
            continue;
          }
          const entry = await client.request<MemoryView>("memory.add", {
            projectPath: process.cwd(),
            text,
            scope: "project",
            kind: "fact",
            tags: []
          });
          print(`memori ${entry.id} disimpan`);
          continue;
        }
        if (line.startsWith("/forget ")) {
          const target = line.slice(8).trim();
          if (target.length === 0) {
            print("Pakai: /forget <id>");
            continue;
          }
          const result = await client.request<{ removed: number }>("memory.remove", {
            projectPath: process.cwd(),
            id: target
          });
          print(result.removed > 0 ? `memori ${target} dihapus` : `memori ${target} tidak ditemukan`);
          continue;
        }
        if (line === "/plugins" || line.startsWith("/plugins ")) {
          const argument = line.slice(8).trim();
          const [action = "list", ...rest] = argument.split(/\s+/).filter(Boolean);
          if (action === "list" || argument.length === 0) {
            const plugins = await client.request<Array<Record<string, unknown>>>("plugin.list", { projectPath: process.cwd() });
            if (plugins.length === 0) print("belum ada plugin");
            else for (const plugin of plugins) print(`${String(plugin.name)} v${String(plugin.version)} [${String(plugin.status)}] ${(plugin.permissions as string[]).join(",")}`);
            continue;
          }
          if (action === "install") {
            const source = rest[0];
            if (!source) { print("Pakai: /plugins install <folder|https-url> [--checksum <sha256>]"); continue; }
            const checksumIndex = rest.indexOf("--checksum");
            const checksum = checksumIndex >= 0 ? rest[checksumIndex + 1] : undefined;
            const plugin = await client.request<Record<string, unknown>>("plugin.install", { projectPath: process.cwd(), source, checksum });
            print(`plugin ${String(plugin.name)} v${String(plugin.version)} ${String(plugin.status)}`);
            continue;
          }
          const name = rest[0];
          if (!name) { print(`Pakai: /plugins ${action} <nama>`); continue; }
          if (action === "enable" || action === "disable" || action === "remove" || action === "rollback") {
            await client.request(`plugin.${action}`, { projectPath: process.cwd(), name });
            print(`plugin ${name}: ${action} selesai`);
            continue;
          }
          print("subcommand: list, install, enable, disable, remove, rollback");
          continue;
        }
        if (line === "/hooks" || line.startsWith("/hooks ")) {
          const argument = line.slice(6).trim();
          const [action = "list", ...rest] = argument.split(/\s+/).filter(Boolean);
          if (action === "list" || argument.length === 0) {
            const result = await client.request<{ hooks: Array<Record<string, unknown>>; invalid: Array<Record<string, unknown>> }>("hooks.list", { projectPath: process.cwd() });
            if (result.hooks.length === 0) print("belum ada hook");
            else for (const hook of result.hooks) print(`${String(hook.event)} [${String(hook.kind)}] ${String(hook.command ?? hook.path ?? hook.url ?? hook.plugin ?? "")}`);
            for (const invalid of result.invalid) print(`hook #${String(invalid.index)} tidak valid: ${(invalid.errors as string[]).join("; ")}`);
            continue;
          }
          if (action === "test") {
            const event = rest[0];
            if (!event) { print("Pakai: /hooks test <Event> [--dry-run]"); continue; }
            const result = await client.request<Record<string, unknown>>("hooks.test", { projectPath: process.cwd(), event, dryRun: rest.includes("--dry-run") });
            print(JSON.stringify(result, null, 2));
            continue;
          }
          print("subcommand: list, test");
          continue;
        }
        if (line === "/skills") {
          const skills = await client.request<Array<Record<string, unknown>>>("skill.list", {
            projectPath: process.cwd(),
            limit: 40
          });
          if (skills.length === 0) print("belum ada skill");
          else {
            for (const skill of skills) {
              const triggers = (skill.triggers as string[] | undefined)?.join(", ") ?? "-";
              print(
                `${String(skill.name)}  v${String(skill.version ?? "?")}  [${String(skill.scope)}]  sumber ${String(skill.source ?? skill.scope)}  trigger ${triggers}  ${String(skill.description).slice(0, 60)}`
              );
            }
            const conflicts = await client.request<Array<Record<string, unknown>>>("skill.conflicts", { projectPath: process.cwd() });
            for (const conflict of conflicts) print(ui.yellow(`bentrok ${String(conflict.name)}: ${(conflict.scopes as string[]).join(" + ")} (project menang)`));
          }
          continue;
        }
        if (line.startsWith("/skill ")) {
          const parts = line.slice(7).trim().split(/\s+/);
          const sub = parts[0] ?? "";
          if (sub === "info") {
            const name = parts[1];
            if (!name) {
              print("Pakai: /skill info <nama>");
              continue;
            }
            const skill = await client.request<Record<string, unknown>>("skill.view", { projectPath: process.cwd(), name });
            const info = await client.request<Record<string, unknown>>("skill.history", { projectPath: process.cwd(), name });
            print(`${String(skill.name)}  versi ${String(skill.version)}  scope ${String(skill.scope)}  aktif ${skill.active === true ? "ya" : "tidak"}`);
            print(`deskripsi: ${String(skill.description)}`);
            print(`trigger: ${(skill.triggers as string[] | undefined)?.join(", ") ?? "-"}`);
            print(`dependensi: ${(skill.dependencies as string[] | undefined)?.join(", ") ?? "-"}`);
            print(`checksum: ${String(skill.checksum ?? "-")}`);
            print(`riwayat: ${((info.versions as unknown[] | undefined) ?? []).length} versi`);
            continue;
          }
          const force = parts.includes("--force");
          const deny = parts.includes("--deny");
          const name = parts.find((part) => !part.startsWith("--") && part !== "info");
          if (name === undefined || name.length === 0) {
            print("Pakai: /skill <nama> [--force|--deny] atau /skill info <nama>");
            continue;
          }
          if (force || deny) {
            const current = await client.request<Record<string, unknown>>("session.get", { sessionId });
            let overrides: Record<string, unknown> = {};
            try {
              overrides = (JSON.parse(String(current.metadata_json ?? "{}")) as { overrides?: Record<string, unknown> }).overrides ?? {};
            } catch {
              overrides = {};
            }
            const forceList = new Set<string>((overrides.skills_force as string[] | undefined) ?? []);
            const denyList = new Set<string>((overrides.skills_deny as string[] | undefined) ?? []);
            if (force) {
              forceList.add(name);
              denyList.delete(name);
            } else {
              denyList.add(name);
              forceList.delete(name);
            }
            await client.request("session.configure", {
              sessionId,
              skills_force: [...forceList],
              skills_deny: [...denyList]
            });
            print(`${force ? "memaksa" : "melarang"} skill ${name} untuk sesi ini`);
            if (deny) continue;
          }
          const skill = await client.request<Record<string, unknown>>("skill.view", { projectPath: process.cwd(), name });
          print(String(skill.body ?? ""));
          continue;
        }
        if (line === "/goal" || line.startsWith("/goal ")) {
          const argument = line.slice(5).trim();
          const sub = argument.toLowerCase();
          if (argument.length === 0 || sub === "status") {
            const goal = await client.request<GoalView | null>("goal.get", { sessionId });
            print(goal ? renderGoal(goal) : "belum ada goal aktif");
            continue;
          }
          if (sub.startsWith("check ")) {
            const rest = argument.slice(6).trim();
            const space = rest.indexOf(" ");
            const id = space >= 0 ? rest.slice(0, space) : rest;
            const evidence = space >= 0 ? rest.slice(space + 1).trim() : "";
            if (id.length === 0 || evidence.length === 0) {
              print("pakai: /goal check <id> <bukti>");
              continue;
            }
            const goal = await client.request<GoalView>("goal.update", {
              sessionId,
              complete: [{ id, evidence }]
            });
            print(renderGoal(goal));
            continue;
          }
          if (sub === "done" || sub === "cancel" || sub === "fail") {
            const status = sub === "done" ? "done" : sub === "cancel" ? "cancelled" : "failed";
            try {
              const goal = await client.request<GoalView>("goal.finish", { sessionId, status });
              print(renderGoal(goal));
            } catch (error) {
              const rannError = error instanceof RannError ? error : null;
              print(rannError ? `${rannError.code}: ${rannError.message}` : String(error));
            }
            continue;
          }
          const separator = argument.indexOf("|");
          const text = (separator >= 0 ? argument.slice(0, separator) : argument).trim();
          const criteria =
            separator >= 0
              ? argument
                  .slice(separator + 1)
                  .split(";")
                  .map((item) => item.trim())
                  .filter((item) => item.length > 0)
              : [];
          const goal = await client.request<GoalView>("goal.set", {
            sessionId,
            goal: text,
            ...(criteria.length > 0 ? { criteria } : {}),
            createdBy: "user"
          });
          print(renderGoal(goal));
          continue;
        }
        if (line === "/messaging" || line === "/msg" || line.startsWith("/messaging ") || line.startsWith("/msg ")) {
          const argument = line.replace(/^\/(?:messaging|msg)\s*/, "").trim();
          const tokens = tokenizeInline(argument);
          const sub = (tokens[0] ?? "status").toLowerCase();
          if (sub === "status") {
            const status = await client.request<MessagingStatus>("messaging.status", {});
            print(`telegram  ${status.telegram.active ? "aktif" : status.telegram.enabled ? "gagal start" : "mati"}`);
            print(`chat      ${status.telegram.chats} diizinkan`);
            print(`approval  ${status.telegram.pending} menunggu`);
            continue;
          }
          if (sub === "send") {
            const chatId = Number(tokens[1]);
            const text = tokens.slice(2).join(" ").trim();
            if (!Number.isFinite(chatId) || !text) {
              print("pakai: /messaging send <chat_id> <teks>");
              continue;
            }
            const result = await client.request<{ sent: boolean; chunks: number }>("messaging.send", {
              chat_id: chatId,
              text
            });
            print(`terkirim ke ${chatId} dalam ${result.chunks} bagian`);
            continue;
          }
          print("pakai: /messaging status|send <chat_id> <teks>");
          continue;
        }
        if (line === "/agents" || line.startsWith("/agents ")) {
          const argument = line.replace(/^\/agents\s*/, "").trim();
          const tokens = tokenizeInline(argument);
          const sub = (tokens[0] ?? "list").toLowerCase();
          if (sub === "list") {
            const rows = await client.request<AgentRow[]>("agent.list", { tree: true, limit: 100 });
            if (rows.length === 0) print("belum ada subagent");
            else printAgentTree(rows);
            continue;
          }
          if (sub === "get") {
            if (!tokens[1]) {
              print("pakai: /agents get <agent_id>");
              continue;
            }
            const row = await client.request<AgentRow & { messages: unknown[] }>("agent.get", { id: tokens[1] });
            print(`${row.id}  ${row.profile}  ${row.status}  ${row.steps} langkah  $${row.cost_usd.toFixed(4)}`);
            print(row.goal);
            if (row.result && typeof row.result === "object" && row.result.text) print(row.result.text);
            continue;
          }
          if (sub === "cancel") {
            if (!tokens[1]) {
              print("pakai: /agents cancel <agent_id>");
              continue;
            }
            const result = await client.request<{ cancelled: string[] }>("agent.cancel", { id: tokens[1] });
            print(`dibatalkan: ${result.cancelled.join(", ")}`);
            continue;
          }
          if (sub === "profiles") {
            const rows = await client.request<AgentProfileInfo[]>("agent.profiles", {});
            for (const row of rows) {
              print(`${row.name.padEnd(11)} ${row.permission.padEnd(12)} ${row.description}`);
            }
            continue;
          }
          if (sub === "message") {
            const to = tokens[1];
            const subject = tokens[2];
            const body = tokens.slice(3).join(" ").trim();
            if (!to || !subject || !body) {
              print("pakai: /agents message <agent_id> <subjek> <isi>");
              continue;
            }
            const result = await client.request<{ id: string }>("agent.message", {
              from: "repl",
              to,
              subject,
              body,
              type: "note",
              priority: "normal"
            });
            print(`pesan ${result.id} dikirim ke ${to}`);
            continue;
          }
          print("pakai: /agents list|get|cancel|profiles|message");
          continue;
        }
        if (line === "/pair" || line.startsWith("/pair ")) {
          const status = await client.request<GatewayStatus>("gateway.status", {});
          const result = await client.request<{ code: string; expiresAt: number }>("gateway.pair", {});
          print(`kode    ${result.code}`);
          print(`buka    ${status.public_url ?? `http://${status.host}:${String(status.port)}`}`);
          print(`berlaku ${Math.max(1, Math.round((result.expiresAt - Date.now()) / 60_000))} menit`);
          continue;
        }
        if (line === "/gateway" || line === "/gw" || line.startsWith("/gateway ") || line.startsWith("/gw ")) {
          const argument = line.replace(/^\/(?:gateway|gw)\s*/, "").trim();
          const tokens = tokenizeInline(argument);
          const sub = (tokens[0] ?? "status").toLowerCase();
          if (sub === "status" || sub === "start" || sub === "stop") {
            const status =
              sub === "start"
                ? await client.request<GatewayStatus>("gateway.start", {})
                : sub === "stop"
                  ? await client.request<GatewayStatus>("gateway.stop", {})
                  : await client.request<GatewayStatus>("gateway.status", {});
            printGatewayStatus(status);
            continue;
          }
          if (sub === "pair") {
            const status = await client.request<GatewayStatus>("gateway.status", {});
            const result = await client.request<{ code: string; expiresAt: number }>("gateway.pair", {});
            print(`kode    ${result.code}`);
            print(`buka    ${status.public_url ?? `http://${status.host}:${String(status.port)}`}`);
            print(`berlaku ${Math.max(1, Math.round((result.expiresAt - Date.now()) / 60_000))} menit`);
            continue;
          }
          if (sub === "devices") {
            const devices = await client.request<GatewayDevice[]>("gateway.devices", {});
            if (devices.length === 0) print("belum ada perangkat");
            else
              print(
                table(
                  ["id", "nama", "role", "scope", "status"],
                  devices.map((device) => [
                    device.id,
                    device.name,
                    device.role,
                    device.scopes.join(","),
                    device.revoked_at ? "dicabut" : "aktif"
                  ])
                )
              );
            continue;
          }
          if (sub === "revoke" && tokens[1]) {
            const result = await client.request<{ revoked: boolean }>("gateway.revoke", { id: tokens[1] });
            print(result.revoked ? `perangkat ${tokens[1]} dicabut` : "perangkat tidak ditemukan");
            continue;
          }
          print("pakai: /gateway status|start|stop|pair|devices|revoke <id>");
          continue;
        }
        if (line === "/queue" || line.startsWith("/queue ")) {
          const argument = line.slice(6).trim();
          const tokens = tokenizeInline(argument);
          const sub = (tokens[0] ?? "list").toLowerCase();
          const options = parseInlineOptions(tokens.slice(1), new Set(["status", "limit"]));
          if (sub === "cancel" || sub === "retry") {
            const id = options.positionals[0];
            if (!id) {
              print(`Pakai: /queue ${sub} <id>`);
              continue;
            }
            const job = await client.request<JobView>(`background.${sub}`, { id });
            print(`job ${job.id} ${job.status}`);
            continue;
          }
          const rows = await client.request<JobView[]>("background.list", {
            ...(inlineFlag(options.flags, "status") ? { status: inlineFlag(options.flags, "status") } : {}),
            limit: inlineNumber(options.flags, "limit") ?? 50
          });
          const pending = rows.filter((job) => job.status === "queued" || job.status === "running");
          if (options.flags.json === true) print(JSON.stringify(pending, null, 2));
          else if (pending.length === 0) print(ui.dim("antrean kosong"));
          else {
            for (const job of pending) print(renderJobRow(job));
            const running = pending.filter((job) => job.status === "running").length;
            print(ui.dim(`${pending.length} job menunggu, ${running} berjalan`));
          }
          continue;
        }
        if (line === "/background" || line === "/bg" || line.startsWith("/background ") || line.startsWith("/bg ")) {
          const argument = line.replace(/^\/(?:background|bg)\s*/, "");
          const tokens = tokenizeInline(argument);
          const sub = (tokens[0] ?? "list").toLowerCase();
          const options = parseInlineOptions(tokens.slice(1), new Set(["status", "queue", "limit", "since", "until", "history", "priority", "max-attempts", "after", "idempotency-key", "session"]));
          const asJson = options.flags.json === true;
          if (sub === "list" || sub === "ls") {
            const rows = await client.request<JobView[]>("background.list", {
              ...(inlineFlag(options.flags, "status") ? { status: inlineFlag(options.flags, "status") } : {}),
              ...(inlineFlag(options.flags, "queue") ? { queue: inlineFlag(options.flags, "queue") } : {}),
              ...(inlineFlag(options.flags, "since") ? { since: Date.parse(inlineFlag(options.flags, "since") ?? "") || undefined } : {}),
              ...(inlineFlag(options.flags, "until") ? { until: Date.parse(inlineFlag(options.flags, "until") ?? "") || undefined } : {}),
              ...(options.flags.history === true ? { history: true } : {}),
              limit: inlineNumber(options.flags, "limit") ?? 20
            });
            if (asJson) print(JSON.stringify(rows, null, 2));
            else if (rows.length === 0) print(ui.dim("belum ada job"));
            else for (const job of rows) print(renderJobRow(job));
            continue;
          }
          if (sub === "add") {
            const kind = (options.positionals[0] ?? "").toLowerCase();
            const text = options.positionals.slice(1).join(" ").trim();
            if (kind !== "prompt" && kind !== "shell") {
              print("Pakai: /background add <prompt|shell> \"<teks>\" [--queue q] [--priority n] [--max-attempts n] [--after 5m]");
              continue;
            }
            if (text.length === 0) {
              print("teks job kosong");
              continue;
            }
            const after = inlineFlag(options.flags, "after");
            let nextRunAt: number | undefined;
            if (after !== undefined) {
              const parsed = parseLooseDuration(after) ?? (Number.isFinite(Date.parse(after)) ? Date.parse(after) - Date.now() : undefined);
              if (parsed === undefined) {
                print(ui.red("--after tidak valid, contoh 30s, 5m, 2h, atau tanggal ISO"));
                continue;
              }
              nextRunAt = Date.now() + Math.max(0, parsed);
            }
            const explicitSession = inlineFlag(options.flags, "session");
            const job = await client.request<JobView>("background.enqueue", {
              kind,
              text,
              queue: inlineFlag(options.flags, "queue") ?? "default",
              priority: inlineNumber(options.flags, "priority") ?? 100,
              maxAttempts: inlineNumber(options.flags, "max-attempts") ?? 3,
              ...(kind === "prompt" ? { sessionId: explicitSession ?? sessionId } : {}),
              ...(inlineFlag(options.flags, "idempotency-key") ? { idempotencyKey: inlineFlag(options.flags, "idempotency-key") } : {}),
              ...(nextRunAt !== undefined ? { nextRunAt } : {})
            });
            print(asJson ? JSON.stringify(job, null, 2) : `job ${job.id} masuk antrean ${job.queue} (${job.status})`);
            continue;
          }
          const id = options.positionals[0];
          if (!id) {
            print("Pakai: /background <list|add|get|logs|cancel|retry> [id]");
            continue;
          }
          if (sub === "get" || sub === "show") {
            const job = await client.request<JobView>("background.get", { id });
            if (asJson) print(JSON.stringify(job, null, 2));
            else {
              print(`id       ${job.id}`);
              print(`jenis    ${job.kind}`);
              print(`status   ${job.status}`);
              print(`antrean  ${job.queue}`);
              print(`prioritas ${job.priority}`);
              print(`percobaan ${job.attempts}/${job.max_attempts}`);
              print(`jadwal   ${formatWhen(job.next_run_at)}`);
              print(`dibuat   ${formatWhen(job.created_at)}`);
              if (job.last_error) print(`error    ${job.last_error}`);
            }
            continue;
          }
          if (sub === "logs" || sub === "log") {
            const events = await client.request<Array<Record<string, unknown>>>("background.logs", {
              id,
              limit: inlineNumber(options.flags, "limit") ?? 50
            });
            if (asJson) print(JSON.stringify(events, null, 2));
            else if (events.length === 0) print(ui.dim("belum ada event"));
            else {
              for (const event of events) {
                const when = formatWhen(Number(event.created_at ?? 0));
                print(`${when}  ${String(event.type)}  ${String(event.data_json ?? "{}").slice(0, 240)}`);
              }
            }
            continue;
          }
          if (sub === "cancel") {
            await client.request("background.cancel", { id });
            print(ui.green(`job ${id} dibatalkan`));
            continue;
          }
          if (sub === "retry") {
            await client.request("background.retry", { id });
            print(ui.green(`job ${id} diantrekan ulang`));
            continue;
          }
          print(`subcommand background tidak dikenal: ${sub}`);
          continue;
        }
        if (line === "/scheduler" || line === "/cron" || line.startsWith("/scheduler ") || line.startsWith("/cron ")) {
          const argument = line.replace(/^\/(?:scheduler|cron)\s*/, "");
          const tokens = tokenizeInline(argument);
          const sub = (tokens[0] ?? "list").toLowerCase();
          const options = parseInlineOptions(tokens.slice(1), new Set(["timezone", "overlap", "max-attempts", "limit"]));
          const asJson = options.flags.json === true;
          if (sub === "list" || sub === "ls") {
            const rows = await client.request<SchedulerView[]>("scheduler.list", {});
            if (asJson) print(JSON.stringify(rows, null, 2));
            else if (rows.length === 0) print(ui.dim("belum ada jadwal"));
            else for (const row of rows) print(renderSchedulerRow(row));
            continue;
          }
          if (sub === "add") {
            const name = options.positionals[0];
            const schedule = options.positionals[1];
            const command = options.positionals.slice(2).join(" ").trim();
            if (!name || !schedule || command.length === 0) {
              print('Pakai: /scheduler add <nama> "<jadwal>" "<shell:perintah|prompt:teks>" [--timezone Asia/Jakarta] [--overlap skip|queue|replace] [--no-catch-up]');
              print("Contoh: /scheduler add backup \"cron:0 2 * * *\" \"shell:tar -czf backup.tgz src\"");
              continue;
            }
            const overlap = inlineFlag(options.flags, "overlap") ?? "skip";
            if (!["skip", "queue", "replace"].includes(overlap)) {
              print(ui.red("--overlap harus skip, queue, atau replace"));
              continue;
            }
            try {
              const row = await client.request<SchedulerView>("scheduler.add", {
                name,
                schedule,
                command,
                ...(inlineFlag(options.flags, "timezone") ? { timezone: inlineFlag(options.flags, "timezone") } : {}),
                overlapPolicy: overlap,
                catchUp: options.flags["no-catch-up"] !== true,
                maxAttempts: inlineNumber(options.flags, "max-attempts") ?? 3
              });
              print(asJson ? JSON.stringify(row, null, 2) : `jadwal ${row.name} dibuat, next ${formatWhen(row.next_run_at)}`);
            } catch (error) {
              print(ui.red(error instanceof Error ? error.message : String(error)));
            }
            continue;
          }
          const id = options.positionals[0];
          if (!id) {
            print("Pakai: /scheduler <list|add|run|enable|disable|remove|history> [id|nama]");
            continue;
          }
          if (sub === "run") {
            const result = await client.request<{ job: JobView }>("scheduler.run", { id });
            print(ui.green(`jadwal ${id} dijalankan, job ${result.job.id}`));
            continue;
          }
          if (sub === "enable" || sub === "disable") {
            const row = await client.request<SchedulerView>("scheduler.update", { id, enabled: sub === "enable" });
            print(`jadwal ${row.name} ${row.enabled === 1 ? "aktif" : "nonaktif"}, next ${formatWhen(row.next_run_at)}`);
            continue;
          }
          if (sub === "remove" || sub === "rm") {
            await client.request("scheduler.remove", { id });
            print(ui.green(`jadwal ${id} dihapus`));
            continue;
          }
          if (sub === "history" || sub === "runs") {
            const runs = await client.request<Array<Record<string, unknown>>>("scheduler.history", {
              id,
              limit: inlineNumber(options.flags, "limit") ?? 20
            });
            if (asJson) print(JSON.stringify(runs, null, 2));
            else if (runs.length === 0) print(ui.dim("belum ada riwayat"));
            else {
              for (const run of runs) {
                const when = formatWhen(Number(run.started_at ?? run.created_at ?? 0));
                const duration = run.duration_ms === null || run.duration_ms === undefined ? "-" : `${String(run.duration_ms)}ms`;
                print(`${when}  ${String(run.status).padEnd(9)} ${duration}  ${String(run.output ?? run.error_message ?? "").slice(0, 160)}`);
              }
            }
            continue;
          }
          print(`subcommand scheduler tidak dikenal: ${sub}`);
          continue;
        }
        if (line === "/status" || line === "/status --json" || line === "/st --json") {
          const data = await client.request<Record<string, unknown>>("session.get", { sessionId });
          if (line.includes("--json")) {
            const goal = await client.request<GoalView | null>("goal.get", { sessionId });
            print(JSON.stringify({ sessionId, model: model ?? data.model ?? null, permission: permissionMode ?? data.permission_mode ?? null, cwd: process.cwd(), status: data.status ?? "active", goal }, null, 2));
            continue;
          }
          print(`sesi     ${sessionId}`);
          print(`model    ${model ?? String(data.model ?? "default")}`);
          print(`izin     ${permissionMode ?? String(data.permission_mode ?? "default")}`);
          print(`folder   ${process.cwd()}`);
          print(`status   ${String(data.status ?? "active")}`);
          const goal = await client.request<GoalView | null>("goal.get", { sessionId });
          if (goal) {
            print("");
            print(renderGoal(goal));
            const pending = goal.criteria.filter((criterion) => !criterion.done);
            if (pending.length > 0) print(`kriteria belum terpenuhi: ${pending.map((criterion) => criterion.id).join(", ")}`);
          }
          continue;
        }
        if (line === "/tools") {
          try {
            const specs = await client.request<Array<Record<string, unknown>>>("tool.list", {});
            for (const spec of specs) {
              const parameters = (spec.parameters as { properties?: Record<string, unknown> } | undefined)?.properties ?? {};
              print(
                `${String(spec.name).padEnd(18)} ${String(spec.permission).padEnd(6)} ${String(spec.timeout_ms)}ms  ${Object.keys(parameters).join(", ")}`
              );
            }
          } catch {
            print("tool: repo_map, search_code, read_file, write_file, edit_file, delete_file, apply_patch, shell_run, memory, skill, task, mcp__<server>__<tool>");
          }
          continue;
        }
        if (line === "/usage") {
          const rows = await client.request<Array<Record<string, unknown>>>("usage.summary", { sessionId });
          if (rows.length === 0) print("belum ada pemakaian token di sesi ini");
          else for (const row of rows) print(formatUsageRow(row));
          continue;
        }
        if (line === "/cost") {
          const rows = await client.request<Array<Record<string, unknown>>>("usage.summary", { sessionId });
          let total = 0;
          for (const row of rows) {
            total += Number(row.cost_usd ?? 0);
            print(formatUsageRow(row));
          }
          print(`total biaya sesi $${total.toFixed(4)}`);
          continue;
        }
        if (line === "/budget") {
          const status = await client.request<Record<string, unknown>>("budget.status", {});
          print(`biaya hari ini $${Number(status.spent_usd_today ?? 0).toFixed(4)} dari $${Number(status.max_usd_per_day ?? 0).toFixed(2)}`);
          print(`token hari ini ${String(status.tokens_today ?? 0)} dari ${String(status.max_tokens_per_day ?? 0)}`);
          const unknown = Number(status.unknown_cost_events_today ?? 0);
          if (unknown > 0) print(`biaya tidak diketahui: ${unknown} event`);
          continue;
        }
        if (line.startsWith("/new")) {
          const title = line.slice(4).trim();
          const created = await client.request<Record<string, unknown>>("session.create", {
            ...(title ? { title } : {}),
            model,
            permissionMode,
            projectPath: process.cwd()
          });
          sessionId = String(created.id);
          print(ui.dim(`sesi baru ${sessionId}`));
          continue;
        }
        if (line === "/model" || line.startsWith("/model ")) {
          const name = line.slice(6).trim();
          if (name.length === 0) {
            const data = await client.request<Record<string, unknown>>("model.list");
            const descriptors = (data.descriptors as Array<Record<string, unknown>> | undefined) ?? [];
            const active = descriptors.find((item) => item.id === model || item.model === model);
            print(`model aktif: ${model ?? "default"}${active ? `  sumber ${String(active.source ?? "?")}  ctx ${String(active.contextWindow ?? "?")}` : ""}`);
            const rows: Array<Record<string, unknown>> = descriptors.length > 0
              ? descriptors
              : ((data.models as string[]) ?? []).map((id) => ({ id }));
            for (const item of rows) {
              print(`- ${String(item.id)}  ${String(item.provider ?? "")}  sumber ${String(item.source ?? "?")}`);
            }
          } else {
            model = name;
            try {
              await client.request("session.setModel", { sessionId, model });
              print(ui.dim(`model ${model} disimpan ke sesi`));
            } catch (error) {
              print(ui.yellow(`model lokal diganti, tetapi gagal disimpan ke sesi: ${(error as Error).message}`));
            }
          }
          continue;
        }
        if (line === "/models") {
          const data = await client.request<Record<string, unknown>>("model.list");
          print(`provider ${String(data.provider)}  default ${String(data.default)}`);
          for (const descriptor of (data.descriptors as Array<Record<string, unknown>> | undefined) ?? []) {
            const caps = Object.entries((descriptor.capabilities as Record<string, boolean>) ?? {})
              .filter(([, enabled]) => enabled)
              .map(([name]) => name)
              .join(",");
            print(`${String(descriptor.id)}  ctx ${String(descriptor.contextWindow)}  ${caps}`);
          }
          continue;
        }
        if (line === "/provider" || line.startsWith("/provider ") || line === "/providers") {
          const name = line === "/providers" ? "" : line.slice(9).trim();
          const list = await client.request<Array<Record<string, unknown>>>("provider.list");
          if (name.length === 0) {
            for (const item of list) {
              const active = item.name === (model?.includes("/") ? model.split("/")[0] : undefined);
              print(`${active ? "*" : " "} ${String(item.name)}  ${String(item.kind)}  key ${item.has_key ? "ada" : "belum"}  status ${String(item.health ?? "unknown")}  default ${String(item.default_model ?? "-")}`);
            }
            continue;
          }
          const picked = list.find((item) => item.name === name);
          if (!picked) {
            print(ui.red(`provider tidak dikenal: ${name}`));
            continue;
          }
          const defaultModel = String(picked.default_model ?? (picked.models as string[] | undefined)?.[0] ?? "");
          if (!defaultModel) {
            print(ui.red(`provider ${name} belum punya model default`));
            continue;
          }
          model = `${name}/${defaultModel}`;
          print(ui.dim(`provider ${name}, model ${model}`));
          continue;
        }
        if (line.startsWith("/permission")) {
          const mode = line.slice(11).trim();
          if (mode.length === 0) {
            print(`mode izin: ${permissionMode ?? "default"} (${PERMISSION_MODES.join(", ")})`);
          } else if (!(PERMISSION_MODES as readonly string[]).includes(mode)) {
            print(ui.red(`mode tidak dikenal. Pilihan: ${PERMISSION_MODES.join(", ")}`));
          } else {
            permissionMode = mode;
            print(ui.dim(`izin ${permissionMode}`));
          }
          continue;
        }
        if (line === "/clear" || line === "/cls") {
          clearScreen(true);
          header();
          continue;
        }
        if (line === "/version" || line === "/v" || line === "/version --json" || line === "/v --json") {
          const health = await client.request<Record<string, unknown>>("health");
          if (line.includes("--json")) {
            print(JSON.stringify({ cli: packageVersion(), node: process.version, platform: process.platform, arch: process.arch, daemon: health.status ?? "ok", protocol: health.protocol ?? "1" }));
            continue;
          }
          print(`rann-code ${packageVersion()}  node ${process.version}  ${process.platform}/${process.arch}`);
          print(`daemon ${String(health.status ?? "ok")}  protokol ${String(health.protocol ?? "1")}`);
          continue;
        }
        if (line === "/whoami") {
          print(`profil   ${process.env.RANN_PROFILE ?? "default"}`);
          print(`home     ${resolveHome()}`);
          print(`user     ${process.env.USER ?? process.env.USERNAME ?? "tidak diketahui"}`);
          print(`folder   ${process.cwd()}`);
          print(`sesi     ${sessionId}`);
          continue;
        }
        if (line === "/health") {
          const health = await client.request<Record<string, unknown>>("health");
          const rows = Object.entries(health).map(([key, value]) => [key, typeof value === "object" ? JSON.stringify(value) : String(value)]);
          print(table(["komponen", "nilai"], rows));
          continue;
        }
        if (line === "/doctor" || line.startsWith("/doctor ")) {
          const health = await client.request<Record<string, unknown>>("health");
          const checks: Array<[string, boolean, string]> = [
            ["node", Number(process.versions.node.split(".")[0]) >= 22, process.version],
            ["daemon", health.status === "ok" || health.ok === true, String(health.status ?? "ok")],
            ["database", health.db === undefined ? true : Boolean(health.db), String(health.db ?? "ok")],
            ["provider", true, model ?? "default"],
            ["folder", existsSync(process.cwd()), process.cwd()]
          ];
          for (const [name, ok, detail] of checks) print(`${ok ? ui.green("[ok]") : ui.red("[gagal]")} ${name}  ${detail}`);
          continue;
        }
        if (line === "/theme" || line.startsWith("/theme ")) {
          const argument = line.slice(6).trim();
          if (argument.length === 0 || argument === "list" || argument === "status") {
            print(`tema aktif: ${process.env.RANN_THEME ?? "auto"}  warna ${colorsEnabled() ? "aktif" : "nonaktif"}  depth ${colorDepth()}`);
            const tokens = themeTokens();
            print(`contoh  ${ui.fg("teks")}  ${ui.dim("dim")}  ${ui.accent("accent")}  ${ui.green("ok")}  ${ui.yellow("peringatan")}  ${ui.red("bahaya")}`);
            print(`token   ${Object.keys(tokens).join(", ")}`);
            continue;
          }
          if (!["dark", "light", "minimal", "auto", "custom"].includes(argument)) {
            print(ui.red("tema tidak dikenal. Pilihan: dark, light, minimal, auto, custom"));
            continue;
          }
          if (argument === "custom") {
            const path = join(resolveHome(), "theme.json");
            if (!existsSync(path)) {
              print(ui.yellow(`buat ${path} dengan token foreground, dim, accent, success, warning, danger, border`));
              continue;
            }
            loadCustomThemeIfPresent(resolveHome());
          } else {
            setTheme(argument as "dark" | "light" | "minimal" | "auto");
          }
          history.add(`/theme ${argument}`);
          print(ui.dim(`tema ${argument}`));
          continue;
        }
        if (line === "/history" || line.startsWith("/history ")) {
          const argument = line.slice(8).trim();
          if (argument === "clear") {
            print(ui.green(`${history.clear()} entri riwayat prompt dihapus`));
            continue;
          }
          const limit = Math.max(1, Math.min(1_000, Number(/--limit\s+(\d+)/.exec(argument)?.[1] ?? 20)));
          const search = /--search\s+(?:"([^"]+)"|(\S+))/.exec(argument);
          const since = /--(?:since|from)\s+(\d{4}-\d{2}-\d{2})/.exec(argument)?.[1];
          const until = /--(?:until|to)\s+(\d{4}-\d{2}-\d{2})/.exec(argument)?.[1];
          const from = since ? new Date(`${since}T00:00:00`).getTime() : undefined;
          const to = until ? new Date(`${until}T23:59:59`).getTime() : undefined;
          const rows = history.search({
            ...(search?.[1] || search?.[2] ? { search: search[1] ?? search[2] ?? "" } : {}),
            ...(from !== undefined && Number.isFinite(from) ? { from } : {}),
            ...(to !== undefined && Number.isFinite(to) ? { to } : {}),
            limit
          });
          if (rows.length === 0) print(ui.dim("belum ada prompt cocok"));
          else {
            for (const entry of rows) {
              const when = new Date(entry.at).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" });
              print(`${when}  ${entry.text.replace(/\s+/g, " ").slice(0, 240)}`);
            }
            print(ui.dim(`${rows.length} entri, file ${history.path}`));
          }
          continue;
        }
        if (line === "/export" || line.startsWith("/export ")) {
          const data = await client.request<Record<string, unknown>>("session.get", { sessionId });
          const messages = (data.messages as Array<Record<string, unknown>> | undefined) ?? [];
          const target = line.slice(7).trim() || join(process.cwd(), `rann-session-${sessionLabel()}.md`);
          const body = [`# Sesi ${sessionId}`, "", `model: ${model ?? "default"}`, `folder: ${process.cwd()}`, ""];
          for (const message of messages) body.push(`## ${String(message.role)}`, "", String(message.content ?? ""), "");
          writeFileSync(target, `${body.join("\n")}\n`, { mode: 0o600 });
          print(ui.green(`sesi diekspor ke ${target}`));
          continue;
        }
        if (line === "/attach" || line.startsWith("/attach ")) {
          const target = line.slice(7).trim();
          if (target.length === 0) {
            print("Pakai: /attach <path>");
            continue;
          }
          const path = resolve(process.cwd(), target);
          if (!existsSync(path) || !statSync(path).isFile()) {
            print(ui.red(`berkas tidak ditemukan: ${target}`));
            continue;
          }
          const size = statSync(path).size;
          if (size > 256 * 1024) {
            print(ui.red(`berkas terlalu besar (${size} byte), batas 262144 byte`));
            continue;
          }
          const content = readFileSync(path, "utf8");
          if (content.includes("\u0000")) {
            print(ui.red("berkas biner tidak bisa dilampirkan"));
            continue;
          }
          pendingAttachment = { name: relative(process.cwd(), path) || target, content };
          print(ui.green(`dilampirkan ${pendingAttachment.name} (${content.length} karakter)`));
          continue;
        }
        if (line === "/files" || line.startsWith("/files ")) {
          const target = resolve(process.cwd(), line.slice(6).trim() || ".");
          if (!existsSync(target)) {
            print(ui.red(`path tidak ditemukan: ${target}`));
            continue;
          }
          const info = statSync(target);
          if (info.isFile()) {
            print(`${target}  ${formatBytes(info.size)}`);
            continue;
          }
          const entries = readdirSync(target, { withFileTypes: true })
            .filter((entry) => !entry.name.startsWith(".git") && entry.name !== "node_modules")
            .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
            .slice(0, 200);
          for (const entry of entries) {
            const path = join(target, entry.name);
            const stat = statSync(path);
            print(`${entry.isDirectory() ? "d" : "-"} ${String(entry.name).padEnd(40)} ${entry.isDirectory() ? "" : formatBytes(stat.size)}`);
          }
          continue;
        }
        if (line === "/git" || line.startsWith("/git ")) {
          const tokens = tokenizeInline(line.slice(4).trim());
          const sub = tokens[0] ?? "status";
          const allowed = new Set(["status", "diff", "log", "add", "commit", "branch", "worktree", "push", "pull"]);
          if (!allowed.has(sub)) {
            print(ui.red("Subcommand git tidak diizinkan. Pakai status, diff, log, add, commit, branch, worktree, push, pull."));
            continue;
          }
          const args = tokens.slice(1);
          if (args.some((arg) => arg === "--force" || arg === "-f" || arg === "--hard" || arg === "--force-with-lease")) {
            print(ui.red("Operasi force ditolak."));
            continue;
          }
          if (sub === "commit" && !args.includes("-m")) {
            print(ui.red('Pakai: /git commit -m "pesan" atau /commit -m "pesan"'));
            continue;
          }
          try {
            const output = execFileSync("git", [sub, ...args], { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
            print(output.trim() || ui.dim("selesai"));
          } catch (error) {
            const err = error as { stderr?: string; stdout?: string };
            printErr((err.stderr ?? err.stdout ?? "git gagal").trim());
          }
          continue;
        }
        if (line === "/commit" || line.startsWith("/commit ") || line === "/branch" || line.startsWith("/branch ") || line === "/worktree" || line.startsWith("/worktree ")) {
          const command = line.split(/\s+/, 1)[0] ?? "/git";
          const rest = line.slice(command.length).trim();
          if (command === "/commit") {
            try {
              execFileSync("git", ["add", "-A"], { cwd: process.cwd(), stdio: "ignore" });
              let message = "";
              if (rest.startsWith("-m ")) {
                message = tokenizeInline(rest)[1] ?? "";
              } else {
                const files = execFileSync("git", ["diff", "--cached", "--name-only"], { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n").filter(Boolean);
                if (files.length === 0) {
                  print(ui.dim("tidak ada perubahan untuk di-commit"));
                  continue;
                }
                const stat = execFileSync("git", ["diff", "--cached", "--stat"], { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
                message = `chore: perbarui ${files.length} berkas\n\n${files.slice(0, 20).join("\n")}\n\n${stat}`;
              }
              if (message.trim().length === 0) throw new Error("pesan commit kosong");
              const output = execFileSync("git", ["commit", ...commitMessage(message, sessionId)], { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
              print(output.trim().split("\n")[0] ?? "commit dibuat");
            } catch (error) {
              const err = error as { stderr?: string; stdout?: string };
              printErr((err.stderr ?? err.stdout ?? "commit gagal").trim());
            }
            continue;
          }
          if (command === "/branch") {
            const tokens = tokenizeInline(rest);
            const sub = tokens[0] ?? "list";
            if (sub === "list") {
              try { print(execFileSync("git", ["branch", "--list"], { cwd: process.cwd(), encoding: "utf8" }).trim()); } catch { printErr("git gagal"); }
              continue;
            }
            if (sub === "create" && tokens[1]) {
              try { print(execFileSync("git", ["switch", "-c", tokens[1]], { cwd: process.cwd(), encoding: "utf8" }).trim()); } catch (error) { printErr((error as { stderr?: string }).stderr ?? "git gagal"); }
              continue;
            }
            if (sub === "switch" && tokens[1]) {
              try { print(execFileSync("git", ["switch", tokens[1]], { cwd: process.cwd(), encoding: "utf8" }).trim()); } catch (error) { printErr((error as { stderr?: string }).stderr ?? "git gagal"); }
              continue;
            }
            print("Pakai: /branch list|create <nama>|switch <nama>");
            continue;
          }
          const tokens = tokenizeInline(rest);
          const sub = tokens[0] ?? "list";
          if (sub === "list") {
            try { print(execFileSync("git", ["worktree", "list"], { cwd: process.cwd(), encoding: "utf8" }).trim()); } catch { printErr("git gagal"); }
            continue;
          }
          if (sub === "create" && tokens[1]) {
            const name = tokens[1];
            if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) { printErr("nama worktree tidak valid"); continue; }
            try { print(execFileSync("git", ["worktree", "add", "-b", `rann/${name}`, `.rann/worktrees/${name}`], { cwd: process.cwd(), encoding: "utf8" }).trim()); } catch (error) { printErr((error as { stderr?: string }).stderr ?? "git gagal"); }
            continue;
          }
          if (sub === "remove" && tokens[1]) {
            const name = tokens[1];
            if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name)) { printErr("nama worktree tidak valid"); continue; }
            try { print(execFileSync("git", ["worktree", "remove", `.rann/worktrees/${name}`], { cwd: process.cwd(), encoding: "utf8" }).trim()); } catch (error) { printErr((error as { stderr?: string }).stderr ?? "git gagal"); }
            continue;
          }
          if (sub === "merge" && tokens[1]) {
            const lock = join(process.cwd(), ".rann", "merge.lock");
            try {
              mkdirSync(dirname(lock), { recursive: true });
              writeFileSync(lock, String(process.pid), { flag: "wx", mode: 0o600 });
            } catch {
              printErr(ui.red("merge queue sedang dipakai proses lain; tunggu sampai selesai"));
              continue;
            }
            try {
              print(execFileSync("git", ["merge", "--no-ff", "--no-edit", tokens[1]], { cwd: process.cwd(), encoding: "utf8" }).trim());
            } catch (error) {
              printErr((error as { stderr?: string }).stderr ?? "merge gagal");
            } finally {
              try { unlinkSync(lock); } catch { /* lock sudah hilang */ }
            }
            continue;
          }
          print("Pakai: /worktree list|create <nama>|remove <nama>|merge <branch>");
          continue;
        }
        if (line === "/diff" || line.startsWith("/diff ")) {
          try {
            const stat = execFileSync("git", ["diff", "--no-color", "--stat"], { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
            const diff = execFileSync("git", ["diff", "--no-color"], { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
            print(stat.trim() || ui.dim("tidak ada perubahan"));
            if (diff.trim().length > 0) print(renderDiffText(diff.length > 60_000 ? `${diff.slice(0, 60_000)}\n[dipotong]` : diff));
          } catch {
            print(ui.red("bukan repositori git atau git tidak tersedia"));
          }
          continue;
        }
        if (line === "/search" || line.startsWith("/search ")) {
          const query = line.slice(7).trim();
          if (query.length === 0) {
            print("Pakai: /search <teks>");
            continue;
          }
          const hits = searchLocal(process.cwd(), query, 100);
          if (hits.length === 0) print(ui.dim(`tidak ada hasil untuk "${query}"`));
          else for (const hit of hits) print(`${hit.path}:${hit.line}  ${hit.text.slice(0, 160)}`);
          continue;
        }
        if (line === "/recall" || line.startsWith("/recall ")) {
          const query = line.slice(7).trim();
          if (query.length === 0) {
            print("Pakai: /recall <query>");
            continue;
          }
          const entries = await client.request<MemoryView[]>("memory.search", { projectPath: process.cwd(), query, limit: 20 });
          if (entries.length === 0) print(ui.dim(`tidak ada memori cocok "${query}"`));
          else for (const entry of entries) print(`${entry.id}  [${entry.scope}] ${entry.text}`);
          continue;
        }
        if (line === "/index rebuild" || line.startsWith("/index rebuild ")) {
          const result = await client.request<{ files: number; chunks: number; skipped: number }>("memory.index", {
            projectPath: process.cwd(),
            root: process.cwd(),
            maxFiles: 2_000
          });
          const symbols = await client.request<{ entries: { entries?: unknown[] } }>("symbol.index", { root: process.cwd() });
          print(ui.green(`indeks dibangun ulang: ${result.files} berkas, ${result.chunks} chunk, ${result.skipped} dilewati, ${symbols.entries.entries?.length ?? 0} simbol`));
          continue;
        }
        if (line === "/resume" || line.startsWith("/resume ")) {
          const target = line.slice(7).trim();
          if (target.length === 0 && lastTurnId && lastCancelled) {
            let resumeDetail = "langkah terakhir";
            try {
              const checkpoint = await client.request<Record<string, unknown> | null>("checkpoint.latest", { sessionId });
              if (checkpoint) {
                const state = (checkpoint.state as Record<string, unknown> | undefined) ?? {};
                const step = Number(state.step ?? 0);
                const tool = typeof state.tool === "string" ? state.tool : undefined;
                resumeDetail = `${checkpoint.id}${step > 0 ? ` langkah ${step}` : ""}${tool ? ` (${tool})` : ""}`;
                print(ui.dim(`checkpoint ${resumeDetail}, label ${String(checkpoint.label)}`));
              }
            } catch {
              // checkpoint opsional; turn tetap dilanjutkan dari riwayat
            }
            try {
              const events = await client.request<Array<Record<string, unknown>>>("turn.events", {
                turnId: lastTurnId,
                afterSeq: 0
              });
              for (const event of events.slice(-10)) {
                const payload = (event.payload ?? event.data ?? {}) as Record<string, unknown>;
                const detail =
                  typeof payload.text === "string"
                    ? payload.text.slice(0, 120)
                    : typeof payload.tool === "string"
                      ? payload.tool
                      : typeof payload.phase === "string"
                        ? payload.phase
                        : "";
                print(ui.dim(`replay ${String(event.type)}${detail ? `: ${detail}` : ""}`));
              }
            } catch {
              // Replay bersifat bantuan; lanjutan tetap dikirim.
            }
            const continuation = `Lanjutkan turn ${lastTurnId} dari ${resumeDetail}. Jangan ulangi tool yang sudah berhasil; periksa riwayat tool di konteks, selesaikan sisa pekerjaan, lalu laporkan hasil dan bukti verifikasi.`;
            busy = true;
            try {
              const result = await runStreaming(client, sessionId, continuation, {
                ...(model ? { model } : {}),
                ...(permissionMode ? { permissionMode } : {}),
                ...(onApproval ? { onApproval } : {})
              });
              await recordResult(result);
              if (!result.ok) print(ui.red("[lanjutan gagal]"));
            } finally {
              busy = false;
            }
            continue;
          }
          if (target.length === 0) {
            const list = await client.request<Array<Record<string, unknown>>>("session.list", { limit: 15, projectPath: process.cwd() });
            for (const item of list) {
            const updated = Number(item.updated_at ?? item.updatedAt ?? 0);
            print(`${item.id === sessionId ? "*" : " "} ${String(item.id)}  ${String(item.status ?? "?")}  ${String(item.model ?? "?")}  ${String(item.title)}${updated > 0 ? `  ${relativeTime(updated)}` : ""}`);
          }
            print(ui.dim("pakai /resume <id> untuk melanjutkan"));
            continue;
          }
          const data = await client.request<Record<string, unknown>>("session.get", { sessionId: target });
          sessionId = String(data.id);
          if (data.model) model = String(data.model);
          if (data.permission_mode) permissionMode = String(data.permission_mode);
          if (typeof data.project_path === "string" && existsSync(data.project_path)) {
            process.chdir(data.project_path);
            history.switchTo(data.project_path);
            try {
              branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
            } catch {
              branch = "";
            }
          }
          print(ui.dim(`sesi ${sessionId}  model ${model ?? "default"}  folder ${process.cwd()}`));
          const messages = ((data.messages as Array<Record<string, unknown>> | undefined) ?? []).slice(-6);
          for (const message of messages) print(`${String(message.role).padEnd(9)} ${String(message.content ?? "").replace(/\s+/g, " ").slice(0, 200)}`);
          continue;
        }
        if (line === "/project" || line.startsWith("/project ")) {
          const sub = line.slice(8).trim();
          const projects = await client.request<Array<Record<string, unknown>>>("project.list");
          if (sub.length === 0 || sub === "show") {
            if (projects.length === 0) print(ui.dim("belum ada project terdaftar"));
            for (const project of projects) {
              const active = project.path === process.cwd() ? "*" : " ";
              print(`${active} ${String(project.path)}  ${String(project.session_count ?? 0)} sesi  ${String(project.name ?? "")}`);
            }
            print(ui.dim("pakai /project switch <path> untuk pindah project"));
            continue;
          }
          const parts = sub.split(/\s+/);
          const action = parts[0] === "switch" || parts[0] === "add" ? parts[0] : "switch";
          const requested = action === parts[0] ? parts.slice(1).join(" ") : sub;
          if (requested.length === 0) {
            print(ui.red("Pakai: /project switch <path>"));
            continue;
          }
          const target = resolve(process.cwd(), requested);
          if (!existsSync(target) || !statSync(target).isDirectory()) {
            print(ui.red(`folder project tidak ditemukan: ${target}`));
            continue;
          }
          const previousProject = process.cwd();
          history.saveDraft(previousProject, editor.draft());
          const session = await client.request<Record<string, unknown>>("session.create", { projectPath: target, model, permissionMode });
          process.chdir(target);
          history.switchTo(target);
          try {
            await client.request("config.reload", {});
          } catch {
            // Config global mungkin belum berubah; sesi tetap bisa dipakai.
          }
          editor.setDraft(history.takeDraft(target));
          custom.commands = reloadCustomCommands();
          loadCustomThemeIfPresent(resolveHome());
          sessionId = String(session.id);
          model = String(session.model ?? model ?? "default");
          permissionMode = String(session.permission_mode ?? permissionMode ?? "ask");
          try {
            branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
          } catch {
            branch = "";
          }
          clearScreen();
          header();
          print(ui.green(`pindah ke ${target}`));
          continue;
        }
        if (line === "/init") {
          initCommand();
          continue;
        }
        if (line === "/checkpoint" || line.startsWith("/checkpoint ")) {
          const items = await client.request<Array<Record<string, unknown>>>("checkpoint.list", { limit: 20 });
          if (items.length === 0) print(ui.dim("belum ada checkpoint berkas"));
          else for (const item of items) print(`${String(item.id)}  ${String(item.files)} berkas  ${String(item.created_at)}  ${String(item.label)}`);
          print(ui.dim("buat checkpoint lewat tool checkpoint_create saat turn berjalan"));
          continue;
        }
        if (line === "/logs" || line.startsWith("/logs ")) {
          const requested = line.slice(5).trim();
          if (!existsSync(layout.logsDir)) {
            print(ui.dim("belum ada log"));
            continue;
          }
          const files = readdirSync(layout.logsDir)
            .map((name) => ({ name, path: join(layout.logsDir, name), mtime: statSync(join(layout.logsDir, name)).mtimeMs }))
            .sort((a, b) => b.mtime - a.mtime);
          const picked = requested ? files.find((file) => file.name.includes(requested)) : files[0];
          if (!picked) {
            print(ui.dim("belum ada log"));
            continue;
          }
          const lines = readFileSync(picked.path, "utf8").trimEnd().split("\n").slice(-40);
          print(ui.dim(`log ${picked.path}`));
          print(lines.join("\n"));
          continue;
        }
        if (line === "/route" || line.startsWith("/route ")) {
          const text = line.slice(6).trim();
          if (text.length === 0) {
            print("Pakai: /route explain <prompt>");
            continue;
          }
          const result = await client.request<Record<string, unknown>>("route.explain", { prompt: text });
          print(JSON.stringify(result, null, 2));
          continue;
        }
        if (line === "/create-skill" || line.startsWith("/create-skill ")) {
          const parts = line.slice(13).split("|").map((part) => part.trim());
          const name = parts[0] ?? "";
          let description = parts[1] ?? "";
          let triggers = parts[2] ?? "";
          let steps = parts[3] ?? "";
          if (name.length === 0) {
            print("Pakai: /create-skill <nama> | <deskripsi> [| trigger1,trigger2 | langkah]");
            continue;
          }
          if (description.length < 12) description = (await editor.readLine("deskripsi skill (minimal 12 karakter): ")).trim();
          if (triggers.length === 0) triggers = (await editor.readLine("trigger, pisahkan dengan koma: ")).trim();
          if (steps.length === 0) steps = (await editor.readLine("langkah kerja, pisahkan dengan titik koma: ")).trim();
          if (description.length < 12) {
            print(ui.red("deskripsi minimal 12 karakter"));
            continue;
          }
          const body = `# ${name}\n\n${description}\n\n## Kapan dipakai\n\n${triggers || description}\n\n## Langkah\n\n${steps || "1. Langkah pertama.\n2. Verifikasi hasil dengan perintah nyata."}\n\n## Pitfall\n\nCatat kesalahan yang pernah terjadi dan cara menghindarinya.\n`;
          const skill = await client.request<Record<string, unknown>>("skill.create", {
            projectPath: process.cwd(),
            name,
            description,
            body,
            scope: "project",
            triggers: triggers.split(",").map((item) => item.trim()).filter(Boolean),
            overwrite: false
          });
          print(ui.green(`skill ${String(skill.name)} dibuat di ${String(skill.path)}`));
          continue;
        }
        if (line === "/mcp" || line === "/mcp list" || line.startsWith("/mcp ")) {
          const parts = line.split(/\s+/).slice(1);
          const action = parts[0] ?? "list";
          if (action === "list" || parts.length === 0) {
            const servers = await client.request<Array<Record<string, unknown>>>("mcp.list", {});
            if (servers.length === 0) print(ui.dim("belum ada server MCP"));
            for (const server of servers) {
              print(`${server.enabled ? "*" : " "} ${String(server.name)}  ${String(server.transport)}  ${String(server.target)}`);
            }
            continue;
          }
          if (action === "test") {
            const tools = await client.request<Array<Record<string, unknown>>>("mcp.test", parts[1] ? { name: parts[1] } : {});
            if (tools.length === 0) print(ui.dim("tidak ada tool MCP yang ditemukan"));
            for (const tool of tools) print(`${String(tool.name)}  ${String(tool.description ?? "")}`);
            continue;
          }
          if (action === "reload") {
            await client.request("mcp.reload", {});
            print(ui.green("server MCP ditutup, akan disambung ulang saat dipakai"));
            continue;
          }
          if (action === "add") {
            const name = parts[1];
            if (!name) {
              print(ui.yellow("Pakai: /mcp add <nama> <command> [argumen...] atau /mcp add <nama> --url <url>"));
              continue;
            }
            const layout = homeLayout();
            const urlIndex = parts.indexOf("--url");
            if (urlIndex > 0 && parts[urlIndex + 1]) {
              setConfigValue(layout.home, `mcp.servers.${name}.url`, parts[urlIndex + 1]!);
              setConfigValue(layout.home, `mcp.servers.${name}.transport`, "http");
            } else {
              const command = parts[2];
              if (!command) {
                print(ui.yellow("Pakai: /mcp add <nama> <command> [argumen...]"));
                continue;
              }
              setConfigValue(layout.home, `mcp.servers.${name}.command`, command);
              const args = parts.slice(3);
              if (args.length > 0) setConfigValue(layout.home, `mcp.servers.${name}.args`, JSON.stringify(args));
            }
            print(ui.green(`MCP ${name} disimpan. Jalankan rann daemon restart, lalu /mcp test ${name}.`));
            continue;
          }
          if (action === "remove") {
            const name = parts[1];
            if (!name) {
              print(ui.yellow("Pakai: /mcp remove <nama>"));
              continue;
            }
            setConfigValue(homeLayout().home, `mcp.servers.${name}.enabled`, "false");
            print(ui.green(`MCP ${name} dinonaktifkan. Jalankan rann daemon restart untuk menerapkan.`));
            continue;
          }
          print(ui.yellow("Pakai: /mcp list|add|remove|test|reload"));
          continue;
        }
        if (line === "/sessions") {
          const list = await client.request<Array<Record<string, unknown>>>("session.list", { limit: 10, projectPath: process.cwd() });
          if (list.length === 0) {
            print(ui.dim("belum ada sesi di folder ini"));
            continue;
          }
          print(table(
            ["", "sesi", "judul", "status", "diperbarui"],
            list.map((item) => [
              item.id === sessionId ? ui.accent("*") : " ",
              String(item.id),
              String(item.title ?? ""),
              String(item.status ?? ""),
              typeof item.updated_at === "number" ? relativeTime(item.updated_at) : String(item.updated_at ?? "")
            ])
          ));
          continue;
        }
        if (line === "/tasks") {
          const plans = await client.request<Array<Record<string, unknown>>>("plan.list", { sessionId, limit: 5 });
          const jobs = await client.request<Array<Record<string, unknown>>>("background.list", { limit: 10 });
          if (plans.length === 0 && jobs.length === 0) {
            print(ui.dim("belum ada rencana atau job background"));
            continue;
          }
          for (const plan of plans) {
            print(`${ui.accent(String(plan.id))}  ${String(plan.status)}  ${String(plan.goal)}`);
            const tasks = (plan.tasks as Array<Record<string, unknown>> | undefined) ?? [];
            for (const line of renderPlan(tasks.map((task) => ({
              title: String(task.title ?? ""),
              status: String(task.status ?? "pending"),
              ...(typeof task.agent === "string" ? { agent: task.agent } : {})
            })))) print(line);
          }
          if (jobs.length > 0) {
            print(ui.dim("job background:"));
            for (const job of jobs) {
              print(`  - [${String(job.status)}] ${String(job.id)}  ${String(job.kind)}  ${String(job.next_run_at ?? "")}`);
            }
          }
          continue;
        }
        if (line === "/checkpoints") {
          const items = await client.request<Array<Record<string, unknown>>>("checkpoint.list", { limit: 10 });
          if (items.length === 0) {
            print(ui.dim("belum ada checkpoint berkas"));
            continue;
          }
          for (const item of items) {
            print(`${String(item.id)}  ${String(item.files)} berkas  ${String(item.created_at)}  ${String(item.label)}`);
          }
          continue;
        }
        if (line === "/undo" || line.startsWith("/undo ")) {
          const requested = line.slice(6).trim();
          const items = await client.request<Array<Record<string, unknown>>>("checkpoint.list", { limit: 20 });
          const target = requested.length > 0 ? items.find((item) => item.id === requested) : items[0];
          if (!target) {
            print(ui.red(requested.length > 0 ? "checkpoint tidak ditemukan" : "belum ada checkpoint untuk di-undo"));
            continue;
          }
          const answer = await editor.readLine(ui.yellow(`Kembalikan ${String(target.files)} berkas dari ${String(target.id)}? (y/N) `));
          if (!/^y(es)?$/i.test(answer.trim())) {
            print(ui.dim("undo dibatalkan"));
            continue;
          }
          const result = await client.request<Record<string, unknown>>("checkpoint.restore", { id: target.id, force: true });
          print(ui.green(`dipulihkan: ${String((result.restored as unknown[] | undefined)?.length ?? 0)} berkas`));
          continue;
        }
        if (line === "/config" || line.startsWith("/config ")) {
          const argument = line.slice(7).trim();
          if (argument.startsWith("explain ")) {
            const key = argument.slice(8).trim();
            if (key.length === 0) {
              print(ui.yellow("Pakai: /config explain <kunci>"));
              continue;
            }
            const data = await client.request<Record<string, unknown>>("config.explain", { key });
            print(`${key} = ${JSON.stringify(data.value)}  sumber ${String(data.source)}  ${String(data.path ?? "")}`);
            continue;
          }
          const key = argument.length > 0 && argument !== "get" ? argument : "";
          if (key.length > 0) {
            const data = await client.request<Record<string, unknown>>("config.explain", { key });
            print(`${key} = ${JSON.stringify(data.value)}  sumber ${String(data.source)}`);
            continue;
          }
          const data = await client.request<Record<string, unknown>>("config.get", {});
          print(JSON.stringify(data.config, null, 2));
          print(ui.dim(`file: ${(data.files as string[] | undefined)?.join(", ") ?? "-"}`));
          continue;
        }
        if (line === "/permissions" || line === "/permission") {
          const data = await client.request<Record<string, unknown>>("config.get", {});
          const config = (data.config as Record<string, unknown> | undefined) ?? {};
          const permissions = (config.permissions as Record<string, unknown> | undefined) ?? {};
          print(`mode: ${String(permissions.mode ?? "read-only")}`);
          for (const [key, value] of Object.entries(permissions).filter(([name]) => name !== "mode")) {
            print(`  ${key}: ${JSON.stringify(value)}`);
          }
          continue;
        }
        if (line === "/settings") {
          const data = await client.request<Record<string, unknown>>("config.get", {});
          print(JSON.stringify(data.config, null, 2));
          continue;
        }
        if (line === "/secrets") {
          const rows = await client.request<Array<Record<string, unknown>>>("secret.list", {});
          if (rows.length === 0) print(ui.dim("belum ada secret tersimpan"));
          for (const row of rows) print(`${String(row.name)}  ${String(row.provider ?? "-")}  ${String(row.created_at ?? "")}`);
          continue;
        }
        if (line === "/env") {
          const names = Object.keys(process.env).filter((name) => /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|COOKIE|SESSION)/i.test(name));
          for (const name of names.sort()) print(`${name}=[REDACTED]`);
          print(ui.dim(`${names.length} variabel sensitif terlihat oleh proses CLI, nilai tidak ditampilkan`));
          continue;
        }
        if (line === "/sandbox") {
          const data = await client.request<Record<string, unknown>>("config.explain", { key: "sandbox" });
          print(JSON.stringify(data.value ?? data, null, 2));
          continue;
        }
        if (line === "/context") {
          const data = await client.request<Record<string, unknown>>("session.get", { sessionId });
          const messages = (data.messages as unknown[] | undefined) ?? [];
          const approx = JSON.stringify(messages).length;
          print(`sesi ${sessionId}`);
          print(`pesan ${messages.length}, perkiraan konteks ${Math.ceil(approx / 4)} token`);
          const usage = (data.usage as Record<string, unknown> | undefined) ?? {};
          print(`token masuk ${String(usage.input_tokens ?? 0)}, keluar ${String(usage.output_tokens ?? 0)}`);
          continue;
        }
        if (line === "/tool" || line.startsWith("/tool ")) {
          const parts = line.split(/\s+/).slice(1);
          const action = parts[0] ?? "list";
          if (action === "list" || parts.length === 0) {
            const tools = await client.request<Array<Record<string, unknown>>>("tool.list", {});
            for (const tool of tools) print(`${tool.enabled === false ? " " : "*"} ${String(tool.name)}`);
            continue;
          }
          if (action === "test") {
            const name = parts[1];
            if (!name) {
              print(ui.yellow("Pakai: /tool test <nama> [json-args]"));
              continue;
            }
            const raw = parts.slice(2).join(" ");
            let args: unknown = {};
            if (raw.length > 0) {
              try {
                args = JSON.parse(raw);
              } catch {
                print(ui.red("argumen bukan JSON valid"));
                continue;
              }
            }
            const result = await client.request<Record<string, unknown>>("tool.test", { name, args });
            print(`${result.ok ? ui.green("ok") : ui.red("gagal")} ${String(result.duration_ms)}ms`);
            print(JSON.stringify(result.output, null, 2));
            continue;
          }
          if (action === "info") {
            const name = parts[1];
            if (!name) {
              print(ui.yellow("Pakai: /tool info <nama>"));
              continue;
            }
            const tools = await client.request<Array<Record<string, unknown>>>("tool.list", {});
            const tool = tools.find((item) => item.name === name);
            if (!tool) {
              print(ui.red(`tool ${name} tidak ditemukan`));
              continue;
            }
            print(JSON.stringify(tool, null, 2));
            continue;
          }
          print(ui.yellow("Pakai: /tool list|info <nama>|test <nama> [json]"));
          continue;
        }
        if (line === "/test" || line.startsWith("/test ")) {
          const pattern = line.slice(5).trim();
          const manager = existsSync(join(process.cwd(), "pnpm-lock.yaml")) ? "pnpm" : existsSync(join(process.cwd(), "yarn.lock")) ? "yarn" : "npm";
          const argv = manager === "npm" ? ["test"] : ["test"];
          if (pattern.length > 0) argv.push("--", pattern);
          print(ui.dim(`$ ${manager} ${argv.join(" ")}`));
          const result = spawnSync(manager, argv, { cwd: process.cwd(), stdio: "inherit", env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", TMPDIR: process.env.TMPDIR ?? "" } });
          print(result.status === 0 ? ui.green("tes lulus") : ui.red(`tes gagal, exit ${String(result.status)}`));
          continue;
        }
        if (line.startsWith("/debug ")) {
          const symptom = line.slice(6).trim();
          if (symptom.length === 0) {
            print(ui.yellow("Pakai: /debug \"gejala\""));
            continue;
          }
          busy = true;
          try {
            const prompt = `Debug masalah berikut secara sistematis: kumpulkan bukti, ajukan hipotesis, uji satu per satu, lalu perbaiki dan verifikasi. Gejala: ${symptom}`;
            const result = await runStreaming(client, sessionId, outgoing(prompt), {
              ...(model ? { model } : {}),
              ...(permissionMode ? { permissionMode } : {}),
              taskClass: "answer",
              ...(onApproval ? { onApproval } : {})
            });
            await recordResult(result);
          } finally {
            busy = false;
          }
          continue;
        }
        if (line === "/profile" || line === "/profile show") {
          const rows = await client.request<Array<Record<string, unknown>>>("memory.list", {});
          const profile = rows.filter((row) => row.scope === "global").slice(0, 20);
          if (profile.length === 0) print(ui.dim("profil belum memiliki entri memori global"));
          for (const row of profile) print(`${String(row.id)}  ${String(row.content)}`);
          continue;
        }
        if (line === "/login" || line.startsWith("/login ")) {
          const parts = line.split(/\s+/).slice(1);
          const name = parts[0];
          const envFlag = parts.indexOf("--env");
          const envName = envFlag > 0 ? parts[envFlag + 1] : undefined;
          if (!name || !envName) {
            print(ui.yellow("Pakai: /login <provider> --env NAMA_VAR"));
            continue;
          }
          const value = process.env[envName];
          if (!value) {
            print(ui.red(`environment ${envName} kosong`));
            continue;
          }
          const ref = `${name}.api_key`;
          await client.request("secret.set", { name: ref, value, provider: name });
          setConfigValue(resolveHome(), `providers.${name}.api_key_ref`, ref);
          print(ui.green(`kunci ${name} tersimpan, akhiran ****${value.slice(-4)}`));
          continue;
        }
        if (line === "/logout" || line.startsWith("/logout ")) {
          const name = line.split(/\s+/)[1];
          if (!name) {
            print(ui.yellow("Pakai: /logout <provider>"));
            continue;
          }
          const result = await client.request<{ removed: boolean }>("secret.remove", { name: `${name}.api_key` });
          print(result.removed ? ui.green(`kunci ${name} dihapus`) : ui.dim(`tidak ada kunci ${name}`));
          continue;
        }
        if (line === "/task" || line.startsWith("/task ")) {
          const parts = line.split(/\s+/);
          if (parts[1] === "priority") {
            const taskId = parts[2];
            const value = Number(parts[3]);
            if (!taskId || !Number.isInteger(value)) {
              print(ui.yellow("Pakai: /task priority <id> <bilangan bulat>"));
              continue;
            }
            const updated = await client.request<Record<string, unknown>>("task.priority", { taskId, priority: value });
            print(ui.green(`prioritas ${String(updated.id)} = ${String(updated.priority)}`));
            continue;
          }
          const id = parts[1];
          const plans = await client.request<Array<Record<string, unknown>>>("plan.list", { sessionId, limit: 10 });
          const tasks: Array<Record<string, unknown>> = plans.flatMap((plan) =>
            ((plan.tasks as Array<Record<string, unknown>> | undefined) ?? []).map((task) => ({ ...task, plan_id: plan.id }) as Record<string, unknown>)
          );
          if (!id || id === "list") {
            if (tasks.length === 0) print(ui.dim("belum ada task"));
            for (const task of tasks) print(`${String(task.id)}  [${String(task.status)}]  ${String(task.title)}`);
            continue;
          }
          const task = tasks.find((item) => item.id === id);
          if (!task) {
            print(ui.red(`task ${id} tidak ditemukan`));
            continue;
          }
          print(JSON.stringify(task, null, 2));
          continue;
        }
        if (line === "/compact") {
          const data = await client.request<Record<string, unknown>>("session.get", { sessionId });
          const messages = (data.messages as unknown[] | undefined) ?? [];
          print(`sesi berisi ${messages.length} pesan. Compaction otomatis berjalan saat konteks melewati batas model.`);
          continue;
        }
        if (line === "/whatsnew") {
          const changelog = join(process.cwd(), "CHANGELOG.md");
          if (existsSync(changelog)) {
            print(readFileSync(changelog, "utf8").split("\n").slice(0, 80).join("\n"));
          } else {
            print(`rann-code ${packageVersion()}  lihat https://github.com/RannD101/rann-code/releases`);
          }
          continue;
        }
        if (line.startsWith("/feedback ")) {
          const text = line.slice(10).trim();
          const file = join(resolveHome(), "feedback.jsonl");
          writeFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), text })}\n`, { flag: "a", mode: 0o600 });
          print(ui.green(`masukan disimpan lokal di ${file}`));
          continue;
        }
        if (line === "/rename" || line.startsWith("/rename ")) {
          const title = line.slice(7).trim();
          if (title.length === 0) {
            print(ui.yellow("Pakai: /rename <judul baru>"));
            continue;
          }
          const result = await client.request<Record<string, unknown>>("session.rename", { sessionId, title });
          print(ui.green(`sesi diganti nama: ${String(result.title)}`));
          continue;
        }
        if (line === "/fork" || line.startsWith("/fork ")) {
          const title = line.slice(5).trim();
          const result = await client.request<Record<string, unknown>>("session.fork", { sessionId, ...(title.length > 0 ? { title } : {}) });
          sessionId = String(result.id);
          print(ui.green(`sesi dicabang ke ${sessionId}`));
          continue;
        }
        if (line === "/cancel") {
          await client.request("session.cancel", { sessionId });
          print(ui.dim("permintaan batal dikirim"));
          continue;
        }
        if (line.startsWith("/execute ")) {
          const text = line.slice(9).trim();
          if (text.length === 0) {
            print(ui.red("Pakai: /execute <tugas>"));
            continue;
          }
          busy = true;
          try {
            const result = await runStreaming(client, sessionId, outgoing(text), {
              ...(model ? { model } : {}),
              ...(permissionMode ? { permissionMode } : {}),
              forcePlan: true,
              ...(onApproval ? { onApproval } : {})
            });
            await recordResult(result);
            if (!result.ok) print(ui.red("[eksekusi gagal]"));
          } finally {
            busy = false;
          }
          continue;
        }
        if (line === "/plan show" || line.startsWith("/plan show ")) {
          const wanted = line.slice(10).trim();
          const plans = await client.request<Array<Record<string, unknown>>>("plan.list", { sessionId, limit: 20 });
          const active = plans.find((plan) => String(plan.status) === "active") ?? plans[0];
          const planId = wanted || (active ? String(active.id) : "");
          if (!planId) {
            print(ui.dim("belum ada rencana"));
            continue;
          }
          const view = await client.request<Record<string, unknown>>("plan.show", { planId });
          print(`plan ${String(view.id)}  status ${String(view.status)}  versi aktif ${String(view.active_version)}`);
          print(`goal: ${String(view.goal)}`);
          for (const snapshot of (view.snapshots as Array<Record<string, unknown>> | undefined) ?? []) {
            print(`  v${String(snapshot.version)}  ${new Date(Number(snapshot.at)).toISOString()}  ${String(snapshot.reason)}`);
          }
          for (const task of (view.tasks as Array<Record<string, unknown>> | undefined) ?? []) {
            print(`  [${String(task.status)}] p${String(task.priority)} ${String(task.title)}  ${String(task.id)}`);
          }
          continue;
        }
        if (line === "/plan export" || line.startsWith("/plan export ")) {
          const parts = line.slice(12).trim().split(/\s+/).filter(Boolean);
          const plans = await client.request<Array<Record<string, unknown>>>("plan.list", { sessionId, limit: 20 });
          const planId = parts[0] || String((plans.find((plan) => String(plan.status) === "active") ?? plans[0])?.id ?? "");
          if (!planId) {
            print(ui.dim("belum ada rencana"));
            continue;
          }
          const exported = await client.request<Record<string, unknown>>("plan.export", { planId });
          const destination = resolve(parts[1] ?? `rann-plan-${planId}.json`);
          writeFileSync(destination, `${JSON.stringify(exported, null, 2)}\n`, { mode: 0o600 });
          print(ui.green(`rencana diekspor ke ${destination}`));
          continue;
        }
        if (line === "/plan import" || line.startsWith("/plan import ")) {
          const source = line.slice(12).trim();
          if (source.length === 0) {
            print(ui.yellow("Pakai: /plan import <berkas.json>"));
            continue;
          }
          const parsed = JSON.parse(readFileSync(resolve(source), "utf8")) as Record<string, unknown>;
          const draft = (parsed.draft ?? parsed) as Record<string, unknown>;
          const imported = await client.request<Record<string, unknown>>("plan.import", { sessionId, draft });
          print(ui.green(`rencana diimpor sebagai ${String(imported.plan_id)} (${String(imported.tasks)} task)`));
          continue;
        }
        if (line.startsWith("/plan ")) {
          const text = line.slice(6).trim();
          if (text.length === 0) {
            print(ui.red("Pakai: /plan <tugas> | /plan show [id] | /plan export [id] [berkas] | /plan import <berkas>"));
            continue;
          }
          busy = true;
          try {
            const result = await runStreaming(client, sessionId, outgoing(text), {
              ...(model ? { model } : {}),
              ...(permissionMode ? { permissionMode } : {}),
              planOnly: true,
              ...(onApproval ? { onApproval } : {})
            });
            await recordResult(result);
            if (!result.ok) print(ui.red("[rencana gagal]"));
          } finally {
            busy = false;
          }
          continue;
        }
        if (line.startsWith("/")) {
          print(ui.red(`E_UNKNOWN_COMMAND: /${commandName(line)} tidak dikenal.`));
          print(`mungkin: ${nearestCommands(commandName(line), 3).map((item) => `/${item.name}`).join(", ")}, atau /help`);
          continue;
        }

        const parsedInput = extractAttachments(line);
        if (parsedInput.attachments.length > 0) {
          print(ui.dim(`lampiran: ${parsedInput.attachments.map((item) => item.name).join(", ")}`));
        }
        busy = true;
        try {
          let attemptText = line;
          for (;;) {
            const result = await runStreaming(client, sessionId, outgoing(attemptText), {
              ...(model ? { model } : {}),
              ...(permissionMode ? { permissionMode } : {}),
              ...(parsedInput.attachments.length > 0 ? { attachments: parsedInput.attachments } : {}),
              ...(onApproval ? { onApproval } : {})
            });
            await recordResult(result);
            if (result.ok) break;
            print(ui.red("[turn gagal]"));
            const action = await chooseTurnFailureAction(result.error?.code, (question) => editor.readLine(question));
            if (action === "retry") continue;
            if (action === "alternative") {
              const alternative = (await editor.readLine("Pendekatan alternatif: ")).trim();
              if (alternative.length === 0) break;
              attemptText = alternative;
              continue;
            }
            if (action === "replan") {
              attemptText = `Susun ulang rencana untuk tugas berikut, lalu kerjakan: ${line}`;
              continue;
            }
            break;
          }
        } finally {
          busy = false;
        }
      }
    } catch (error) {
      if (error instanceof ReplExit) return error.code;
      throw error;
    } finally {
      process.off("SIGINT", sigintListener);
      editor.close();
    }
    return 0;
  } finally {
    client.close();
  }
}

async function modelsCommand(args: ParsedArgs): Promise<number> {
  const discover = flagBool(args, "discover");
  const data = await withClient(async (client) => {
    if (!discover) return client.request<Record<string, unknown>>("model.list");
    const discovered = await client.request<Record<string, unknown>>("model.discover", {
      force: flagBool(args, "force")
    });
    if (!flagBool(args, "json")) {
      const results = (discovered.results as Array<Record<string, unknown>> | undefined) ?? [discovered];
      for (const result of results) {
        const name = String(result.provider ?? "?");
        if (result.supported === false) {
          print(`${name}: discovery tidak didukung (${String(result.reason ?? "-")})`);
          continue;
        }
        const added = (result.added as string[] | undefined) ?? [];
        const dropped = (result.unavailable as string[] | undefined) ?? [];
        print(
          `${name}: ${(result.discovered as string[] | undefined)?.length ?? 0} model${result.cached === true ? " (cache)" : ""}` +
            `${added.length > 0 ? `, baru ${added.length}` : ""}${dropped.length > 0 ? `, tidak tersedia ${dropped.length}` : ""}`
        );
      }
    }
    return client.request<Record<string, unknown>>("model.list");
  });
  if (flagBool(args, "json")) {
    print(JSON.stringify(data, null, 2));
    return 0;
  }
  print(`provider ${data.provider}`);
  print(`default  ${data.default}`);
  const descriptors = (data.descriptors as Array<Record<string, unknown>> | undefined) ?? [];
  if (descriptors.length > 0) {
    for (const descriptor of descriptors) {
      const capabilities = Object.entries((descriptor.capabilities as Record<string, boolean>) ?? {})
        .filter(([, enabled]) => enabled)
        .map(([name]) => name)
        .join(",");
      const pricing = descriptor.pricing as Record<string, number> | undefined;
      const price = pricing ? ` $${pricing.inputPerMTok}/${pricing.outputPerMTok} per Mtok` : " harga belum diketahui";
      const source = String(descriptor.capabilitySource ?? "catalog");
      const assumed = descriptor.capabilitiesUnknown === true ? "  capability: asumsi aman" : "";
      print(`- ${descriptor.id}  ctx ${descriptor.contextWindow}  out ${descriptor.maxOutputTokens}${price}`);
      print(`  ${capabilities || "hanya streaming"}  sumber: ${source}${assumed}`);
    }
    const unavailable = (data.unavailable as string[] | undefined) ?? [];
    if (unavailable.length > 0) {
      print("");
      print(`tidak tersedia (${unavailable.length}): ${unavailable.join(", ")}`);
    }
    return 0;
  }
  const models = data.models as string[];
  if (models.length === 0) print("belum ada daftar model");
  else for (const model of models) print(`- ${model}`);
  return 0;
}

async function turnCommand(args: ParsedArgs): Promise<number> {
  const turnId = args.positionals[0];
  if (!turnId) throw new RannError("E_INVALID_PARAMS", "Pakai: rann turn <id-turn> [--wait] [--json]");
  const wait = flagBool(args, "wait") || flagBool(args, "follow");
  const client = await ensureDaemon();
  try {
    let data: Record<string, unknown>;
    for (;;) {
      data = await client.request<Record<string, unknown>>("turn.get", { turnId });
      const status = String(data.status);
      if (!wait || status === "done" || status === "failed" || status === "cancelled") break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    if (flagBool(args, "json")) {
      print(JSON.stringify(data, null, 2));
    } else {
      const status = String(data.status);
      print(`turn ${turnId}  ${status}`);
      if (typeof data.usage_json === "string" && data.usage_json.length > 0) {
        try {
          const usage = JSON.parse(data.usage_json) as { inputTokens?: number; outputTokens?: number };
          print(`token masuk ${usage.inputTokens ?? 0}  keluar ${usage.outputTokens ?? 0}`);
        } catch {
          // usage lama bisa berupa JSON yang tidak lengkap; abaikan saja
        }
      }
      const messages = Array.isArray(data.messages) ? (data.messages as Array<Record<string, unknown>>) : [];
      const last = [...messages].reverse().find((message) => message.role === "assistant");
      if (last && String(last.content ?? "").trim().length > 0) {
        print("");
        print(String(last.content));
      }
      if (status === "failed") print(ui.red(String(data.error_message ?? data.error_code ?? "turn gagal")));
    }
    return String(data.status) === "failed" ? 1 : 0;
  } finally {
    client.close();
  }
}

interface JobView {
  id: string;
  queue: string;
  kind: string;
  status: string;
  priority: number;
  attempts: number;
  max_attempts: number;
  next_run_at: number;
  last_error: string | null;
  created_at: number;
}

interface SchedulerView {
  id: string;
  name: string;
  schedule: string;
  command: string;
  enabled: number;
  next_run_at: number | null;
  last_run_at: number | null;
  timezone: string;
  overlap_policy: string;
  catch_up: number;
  max_attempts: number;
}

function tokenizeInline(input: string): string[] {
  const tokens: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (const match of input.matchAll(pattern)) {
    const value = match[1] ?? match[2] ?? match[3] ?? "";
    if (value.length > 0) tokens.push(value);
  }
  return tokens;
}

function parseInlineOptions(
  tokens: string[],
  valueFlags: Set<string>
): { positionals: string[]; flags: Record<string, string | boolean> } {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] as string;
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const body = token.slice(2);
    const eq = body.indexOf("=");
    if (eq >= 0) {
      flags[body.slice(0, eq)] = body.slice(eq + 1);
      continue;
    }
    const next = tokens[index + 1];
    if (valueFlags.has(body) && next !== undefined && !next.startsWith("--")) {
      flags[body] = next;
      index += 1;
      continue;
    }
    flags[body] = true;
  }
  return { positionals, flags };
}

function inlineFlag(flags: Record<string, string | boolean>, name: string): string | undefined {
  const value = flags[name];
  return typeof value === "string" ? value : undefined;
}

function inlineNumber(flags: Record<string, string | boolean>, name: string): number | undefined {
  const raw = inlineFlag(flags, name);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function parseLooseDuration(value: string): number | undefined {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(value.trim());
  if (!match) return undefined;
  const amount = Number(match[1]);
  const unit = match[2] as "ms" | "s" | "m" | "h" | "d";
  return amount * { ms: 1, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[unit];
}

function formatWhen(at: number | null): string {
  if (at === null) return "-";
  return new Date(at).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" });
}

function renderJobRow(job: JobView): string {
  const error = job.last_error ? `  error: ${job.last_error.slice(0, 120)}` : "";
  return `${job.id}  ${job.status.padEnd(9)} ${job.kind.padEnd(12)} ${job.queue}  ${job.attempts}/${job.max_attempts}  next ${formatWhen(job.next_run_at)}${error}`;
}

function renderSchedulerRow(row: SchedulerView): string {
  const state = row.enabled === 1 ? "aktif" : "nonaktif";
  const running = row.last_run_at === null ? "" : `  terakhir ${formatWhen(row.last_run_at)}`;
  return `${row.id}  ${row.name}  ${state}  ${row.schedule}  next ${formatWhen(row.next_run_at)}  ${row.command.slice(0, 80)}${running}`;
}

function formatUsageRow(row: Record<string, unknown>): string {
  return (
    `${String(row.provider)}/${String(row.model)}  ${String(row.turns)} turn  ` +
    `masuk ${String(row.input_tokens)}  keluar ${String(row.output_tokens)}  ` +
    `biaya $${Number(row.cost_usd ?? 0).toFixed(4)}  terakhir ${relativeTime(Number(row.last_at ?? Date.now()))}`
  );
}

async function usageCommand(args: ParsedArgs): Promise<number> {
  const sessionId = args.positionals[0] ?? flagString(args, "session");
  const rows = await withClient((client) =>
    client.request<Array<Record<string, unknown>>>("usage.summary", {
      ...(sessionId ? { sessionId } : {})
    })
  );
  if (flagBool(args, "json")) {
    print(JSON.stringify(rows, null, 2));
    return 0;
  }
  if (rows.length === 0) {
    print("belum ada pemakaian token");
    return 0;
  }
  for (const row of rows) {
    print(formatUsageRow(row));
  }
  const budget = await withClient((client) =>
    client.request<{
      max_usd_per_day: number;
      max_tokens_per_day: number;
      spent_usd_today: number;
      unknown_cost_events_today: number;
      tokens_today: number;
    }>("budget.status")
  );
  const limitUsd = budget.max_usd_per_day > 0 ? `$${budget.max_usd_per_day}` : "tanpa batas";
  const limitTokens = budget.max_tokens_per_day > 0 ? String(budget.max_tokens_per_day) : "tanpa batas";
  print(
    `hari ini: $${budget.spent_usd_today.toFixed(6)} / ${limitUsd}, ${budget.tokens_today} token / ${limitTokens}` +
      (budget.unknown_cost_events_today > 0 ? `, ${budget.unknown_cost_events_today} usage tanpa harga` : "")
  );
  return 0;
}

async function providersCommand(args: ParsedArgs): Promise<number> {
  const providers = await withClient((client) => client.request<Array<Record<string, unknown>>>("provider.list"));
  if (flagBool(args, "json")) {
    print(JSON.stringify(providers, null, 2));
    return 0;
  }
  if (providers.length === 0) {
    print("belum ada provider. Pakai rann provider add <nama> --base-url ... --key-env ...");
    return 0;
  }
  const rows = providers.map((provider) => [
    String(provider.name),
    String(provider.kind),
    provider.base_url ? String(provider.base_url) : "-",
    provider.key_hint ? String(provider.key_hint) : provider.has_key ? "ada" : "tidak",
    String(provider.health ?? "unknown"),
    (provider.models as string[]).join(",") || "-"
  ]);
  print(table(["NAMA", "TIPE", "BASE URL", "KEY", "STATUS", "MODEL"], rows));
  return 0;
}

async function providerCommand(args: ParsedArgs): Promise<number> {
  if (args.subcommand === "list" || args.subcommand === undefined) {
    const list = await withClient((client) => client.request<Array<Record<string, unknown>>>("provider.list"));
    if (flagBool(args, "json")) {
      print(JSON.stringify(list, null, 2));
      return 0;
    }
    for (const item of list) {
      print(
        `${String(item.name)}  ${String(item.kind)}  key ${item.has_key ? "ada" : "belum"}  ` +
          `status ${String(item.health ?? "unknown")}  default ${String(item.default_model ?? "-")}`
      );
    }
    return 0;
  }
  if (args.subcommand === "test") {
    const name = args.positionals[0];
    const data = await withClient((client) =>
      client.request<Record<string, unknown>>("provider.test", {
        ...(name ? { name } : {}),
        ...(flagString(args, "model") ? { model: flagString(args, "model") } : {})
      })
    );
    if (flagBool(args, "json")) {
      print(JSON.stringify(data, null, 2));
    } else {
      print(`OK  ${String(data.provider)}  ${String(data.model)}  ${String(data.latency_ms)} ms`);
      print(`balasan: ${String(data.reply)}`);
    }
    return 0;
  }
  if (args.subcommand === "login") {
    const name = args.positionals[0];
    if (!name) throw new RannError("E_INVALID_PARAMS", "Pakai: rann provider login <nama> --env ENV_VAR");
    const list = await withClient((client) => client.request<Array<Record<string, unknown>>>("provider.list"));
    if (!list.some((item) => item.name === name)) {
      throw new RannError("E_INVALID_PARAMS", `Provider ${name} belum terdaftar. Jalankan rann provider add dulu.`);
    }
    const envName = flagString(args, "env");
    const value = envName ? process.env[envName] : await readPipedStdin();
    if (!value) {
      throw new RannError("E_INVALID_PARAMS", "Nilai kunci kosong. Pakai --env ENV_VAR atau pipe lewat stdin.");
    }
    const ref = `${name}.api_key`;
    await withClient((client) =>
      client.request<Record<string, unknown>>("secret.set", { name: ref, value, provider: name })
    );
    const layout = homeLayout();
    ensureLayout(layout);
    setConfigValue(layout.home, `providers.${name}.api_key_ref`, ref);
    await stopDaemonForConfig();
    print(`kunci ${name} tersimpan di vault, akhiran ****${value.slice(-4)}`);
    return 0;
  }
  if (args.subcommand === "remove" || args.subcommand === "rm") {
    const name = args.positionals[0];
    if (!name) throw new RannError("E_INVALID_PARAMS", "Pakai: rann provider remove <nama>");
    const data = await withClient((client) => client.request<Record<string, unknown>>("config.get"));
    const config = (data.config as Record<string, unknown> | undefined) ?? data;
    const providers = (config.providers as Record<string, Record<string, unknown>> | undefined) ?? {};
    const entry = providers[name];
    if (!entry) throw new RannError("E_INVALID_PARAMS", `Provider ${name} belum terdaftar`);
    const ref = typeof entry.api_key_ref === "string" ? entry.api_key_ref : `${name}.api_key`;
    const removed = await withClient((client) =>
      client.request<{ removed: boolean }>("secret.remove", { name: ref })
    );
    const layout = homeLayout();
    ensureLayout(layout);
    const unset = unsetConfigValue(layout.home, `providers.${name}.api_key_ref`);
    await stopDaemonForConfig();
    print(removed.removed || unset ? `kunci ${name} dihapus` : `tidak ada kunci tersimpan untuk ${name}`);
    return 0;
  }
  if (args.subcommand !== "add") throw new RannError("E_INVALID_PARAMS", "Pakai: rann provider add <nama> ..., rann provider login <nama>, rann provider remove <nama>, atau rann provider test [nama]");
  const name = args.positionals[0];
  if (!name) throw new RannError("E_INVALID_PARAMS", "Nama provider wajib diisi");
  const baseUrl = flagString(args, "base-url");
  const keyEnv = flagString(args, "key-env");
  const kind = flagString(args, "type") ?? "openai-compatible";
  const lines = [`[providers.${name}]`, `kind = "${kind}"`];
  if (baseUrl) lines.push(`base_url = "${baseUrl}"`);
  if (keyEnv) lines.push(`api_key_env = "${keyEnv}"`);
  const model = flagString(args, "model");
  if (model) lines.push(`default_model = "${model}"`);
  const layout = homeLayout();
  ensureLayout(layout);
  const { appendFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  appendFileSync(join(layout.home, "config", "config.toml"), `\n${lines.join("\n")}\n`, { mode: 0o600 });
  await stopDaemonForConfig();
  print(`provider ${name} ditambahkan. Set rann config set provider ${name} untuk memakainya.`);
  return 0;
}

async function stopDaemonForConfig(): Promise<void> {
  const client = await tryConnect();
  if (!client) return;
  try {
    await client.request("shutdown", { graceful: true });
  } finally {
    client.close();
  }
  print(ui.dim("daemon dihentikan, config baru dipakai pada perintah berikutnya"));
}

function localProject(args: ParsedArgs): string {
  return flagString(args, "project") ?? process.cwd();
}

function limitFlag(args: ParsedArgs, fallback: number): number {
  const raw = flagString(args, "limit");
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new RannError("E_INVALID_PARAMS", `--limit harus angka positif, dapat: ${raw}`);
  }
  return parsed;
}

function commaFlag(args: ParsedArgs, name: string): string[] | undefined {
  const raw = flagString(args, name);
  if (raw === undefined) return undefined;
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function tagFlag(args: ParsedArgs): string[] | undefined {
  const raw = flagString(args, "tags");
  if (raw === undefined) return undefined;
  const tags = raw
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => tag.length > 0);
  return tags;
}

interface MemoryView {
  id: string;
  scope: string;
  kind: string;
  text: string;
  tags: string[];
  updated_at: number;
}

function renderMemories(entries: MemoryView[]): string {
  if (entries.length === 0) return "belum ada memori";
  return table(
    ["id", "scope", "kind", "teks", "diperbarui"],
    entries.map((entry) => [
      entry.id,
      entry.scope,
      entry.kind,
      entry.text.replace(/\s+/g, " ").slice(0, 60),
      relativeTime(entry.updated_at)
    ])
  );
}

async function routeCommand(args: ParsedArgs): Promise<number> {
  if (args.subcommand !== "explain") {
    throw new RannError("E_INVALID_PARAMS", "Pakai: rann route explain \"<prompt>\"");
  }
  const prompt = args.positionals[0];
  if (!prompt) throw new RannError("E_INVALID_PARAMS", "Prompt kosong");
  const decision = await withClient((client) =>
    client.request<{
      taskClass: string;
      chosen: string | null;
      score: number;
      policy: string;
      pinned: boolean;
      warning?: string;
      candidates: Array<{ model: string; score: number; reason: string }>;
      rejected: Array<{ model: string; reason: string }>;
    }>("route.explain", {
      prompt,
      ...(flagString(args, "policy") ? { policy: flagString(args, "policy") } : {})
    })
  );
  if (flagBool(args, "json")) {
    print(JSON.stringify(decision, null, 2));
    return 0;
  }
  print(`kelas tugas: ${decision.taskClass}`);
  print(`dipilih: ${decision.chosen ?? "(tidak ada)"} skor=${decision.score.toFixed(3)} policy=${decision.policy}${decision.pinned ? " pinned" : ""}`);
  for (const candidate of decision.candidates) {
    print(`  ${candidate.model}  ${candidate.score.toFixed(3)}  ${candidate.reason}`);
  }
  for (const item of decision.rejected) print(`  x ${item.model}  ${item.reason}`);
  if (decision.warning) print(`peringatan: ${decision.warning}`);
  return decision.chosen ? 0 : 4;
}

async function secretCommand(args: ParsedArgs): Promise<number> {
  const sub = args.subcommand ?? "list";
  const asJson = flagBool(args, "json");
  if (sub === "list") {
    const secrets = await withClient((client) => client.request<Array<Record<string, unknown>>>("secret.list"));
    if (asJson) {
      print(JSON.stringify(secrets, null, 2));
      return 0;
    }
    if (secrets.length === 0) print("belum ada secret");
    for (const secret of secrets) {
      print(`${secret.name}  provider=${secret.provider ?? "-"}  dibuat=${secret.created}  dipakai=${secret.lastUsed ?? "-"}`);
    }
    return 0;
  }
  if (sub === "set") {
    const name = args.positionals[0];
    if (!name) throw new RannError("E_INVALID_PARAMS", "Pakai: rann secret set <nama> --env ENV_VAR");
    const envName = flagString(args, "env");
    const value = envName ? process.env[envName] : await readPipedStdin();
    if (!value) {
      throw new RannError("E_INVALID_PARAMS", "Nilai secret kosong. Pakai --env ENV_VAR atau pipe lewat stdin.");
    }
    const meta = await withClient((client) =>
      client.request<Record<string, unknown>>("secret.set", {
        name,
        value,
        ...(flagString(args, "provider") ? { provider: flagString(args, "provider") } : {})
      })
    );
    print(`secret ${meta.name} tersimpan (${meta.id})`);
    return 0;
  }
  if (sub === "remove" || sub === "rm") {
    const name = args.positionals[0];
    if (!name) throw new RannError("E_INVALID_PARAMS", "Pakai: rann secret remove <nama>");
    const result = await withClient((client) => client.request<{ removed: boolean }>("secret.remove", { name }));
    print(result.removed ? `secret ${name} dihapus` : `secret ${name} tidak ditemukan`);
    return result.removed ? 0 : 6;
  }
  throw new RannError("E_INVALID_PARAMS", `Subcommand secret tidak dikenal: ${sub}`);
}

async function memoryCommand(args: ParsedArgs): Promise<number> {
  const projectPath = localProject(args);
  const asJson = flagBool(args, "json");
  const sub = args.subcommand ?? "list";

  if (sub === "add") {
    const text = flagString(args, "text") ?? args.positionals.join(" ").trim();
    if (!text) throw new RannError("E_INVALID_PARAMS", "memory add butuh teks");
    const scope = (flagString(args, "scope") ?? "project") as "global" | "project";
    const entry = await withClient((client) =>
      client.request<MemoryView>("memory.add", {
        projectPath,
        text,
        scope,
        kind: flagString(args, "kind") ?? "fact",
        tags: tagFlag(args) ?? []
      })
    );
    print(asJson ? JSON.stringify(entry, null, 2) : `memori ${entry.id} disimpan (${entry.scope})`);
    return 0;
  }

  if (sub === "search") {
    const query = args.positionals.join(" ").trim() || flagString(args, "text");
    if (!query) throw new RannError("E_INVALID_PARAMS", "memory search butuh kata kunci");
    const entries = await withClient((client) =>
      client.request<MemoryView[]>("memory.search", { projectPath, query, limit: limitFlag(args, 10) })
    );
    print(asJson ? JSON.stringify(entries, null, 2) : renderMemories(entries));
    return 0;
  }

  if (sub === "update") {
    const id = args.positionals[0];
    if (!id) throw new RannError("E_INVALID_PARAMS", "memory update butuh id");
    const text = flagString(args, "text");
    const kind = flagString(args, "kind");
    const tags = tagFlag(args);
    if (text === undefined && kind === undefined && tags === undefined) {
      throw new RannError("E_INVALID_PARAMS", "memory update butuh --text, --kind, atau --tags");
    }
    const entry = await withClient((client) =>
      client.request<MemoryView>("memory.update", { projectPath, id, text, kind, tags })
    );
    print(asJson ? JSON.stringify(entry, null, 2) : `memori ${entry.id} diperbarui`);
    return 0;
  }

  if (sub === "remove") {
    const id = args.positionals[0];
    if (!id) throw new RannError("E_INVALID_PARAMS", "memory remove butuh id");
    const result = await withClient((client) => client.request<{ removed: boolean }>("memory.remove", { projectPath, id }));
    print(result.removed ? `memori ${id} dihapus` : `memori ${id} tidak ditemukan`);
    return result.removed ? 0 : 1;
  }

  if (sub === "export") {
    const payload = await withClient((client) =>
      client.request<unknown>("memory.export", { projectPath })
    );
    const target = flagString(args, "out");
    const exportPayload = payload as { version?: number; exported_at?: number; entries?: unknown[] };
    const text = flagBool(args, "jsonl")
      ? `${JSON.stringify({ _meta: { version: exportPayload.version ?? 1, exported_at: exportPayload.exported_at ?? Date.now(), schema: "rann-memory" } })}\n${(exportPayload.entries ?? []).map((entry) => JSON.stringify(entry)).join("\n")}\n`
      : `${JSON.stringify(payload, null, 2)}\n`;
    if (target) writeFileSync(target, text, { mode: 0o600 });
    else process.stdout.write(text);
    return 0;
  }

  if (sub === "import") {
    const source = flagString(args, "from") ?? args.positionals[0];
    if (!source) throw new RannError("E_INVALID_PARAMS", "memory import butuh --from <berkas.json>");
    const raw = readFileSync(source, "utf8");
    const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
    const jsonlEntries = lines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((item) => item._meta === undefined);
    const payload = source.endsWith(".jsonl")
      ? { version: 1, exported_at: Date.now(), entries: jsonlEntries }
      : JSON.parse(raw) as unknown;
    const strategy = flagString(args, "strategy") ?? "merge";
    if (!["skip", "overwrite", "merge"].includes(strategy)) {
      throw new RannError("E_INVALID_PARAMS", "Strategi impor harus skip, overwrite, atau merge");
    }
    const result = await withClient((client) =>
      client.request<{ imported: number; skipped: number }>("memory.import", {
        projectPath,
        payload,
        replace: flagBool(args, "replace"),
        strategy
      })
    );
    print(`memori diimpor: ${result.imported}, dilewati: ${result.skipped}`);
    return 0;
  }

  if (sub === "index") {
    const root = flagString(args, "root") ?? projectPath;
    const result = await withClient((client) =>
      client.request<{ files: number; chunks: number; skipped: number }>("memory.index", {
        projectPath,
        root,
        maxFiles: limitFlag(args, 500)
      })
    );
    print(`knowledge: ${result.files} berkas, ${result.chunks} bagian, ${result.skipped} dilewati`);
    return 0;
  }

  if (sub === "supersede") {
    const id = args.positionals[0];
    const text = flagString(args, "text") ?? args.positionals.slice(1).join(" ").trim();
    if (!id || !text) throw new RannError("E_INVALID_PARAMS", "memory supersede butuh id dan teks baru");
    const entry = await withClient((client) =>
      client.request<MemoryView>("memory.supersede", {
        projectPath,
        id,
        text,
        reason: flagString(args, "reason") ?? "diganti"
      })
    );
    print(`memori baru ${entry.id}, lama ditandai superseded`);
    return 0;
  }

  if (sub !== "list") throw new RannError("E_INVALID_PARAMS", `Subcommand memory tidak dikenal: ${sub}`);
  const scope = (flagString(args, "scope") ?? "all") as "global" | "project" | "all";
  const entries = await withClient((client) =>
    client.request<MemoryView[]>("memory.list", { projectPath, scope, limit: limitFlag(args, 30) })
  );
  print(asJson ? JSON.stringify(entries, null, 2) : renderMemories(entries));
  return 0;
}

interface SkillView {
  name: string;
  description: string;
  scope: string;
  version: string;
  updated_at: number;
  body?: string;
}

async function pluginCommand(args: ParsedArgs): Promise<number> {
  const projectPath = localProject(args);
  const asJson = flagBool(args, "json");
  const sub = args.subcommand ?? "list";

  if (sub === "list") {
    const plugins = await withClient((client) =>
      client.request<Array<{ name: string; version: string; status: string; permissions: string[]; stale: boolean; last_error?: string }>>("plugin.list", { projectPath })
    );
    if (asJson) print(JSON.stringify(plugins, null, 2));
    else if (plugins.length === 0) print("belum ada plugin");
    else print(table(["nama", "versi", "status", "izin", "stale"], plugins.map((plugin) => [plugin.name, plugin.version, plugin.status, plugin.permissions.join(","), plugin.stale ? "ya" : "tidak"])));
    return 0;
  }

  if (sub === "install") {
    const source = args.positionals[0];
    if (!source) throw new RannError("E_INVALID_PARAMS", "plugin install butuh folder atau URL tarball HTTPS");
    const plugin = await withClient((client) =>
      client.request<{ name: string; version: string; status: string }>("plugin.install", {
        projectPath,
        source,
        scope: flagString(args, "scope") ?? "project",
        name: flagString(args, "name"),
        checksum: flagString(args, "checksum"),
        allowUnsigned: flagBool(args, "allow-unsigned"),
        overwrite: flagBool(args, "overwrite")
      })
    );
    print(`plugin ${plugin.name} v${plugin.version} ${plugin.status}`);
    return 0;
  }

  const name = args.positionals[0];
  if (!name && sub !== "list") throw new RannError("E_INVALID_PARAMS", `plugin ${sub} butuh nama`);
  if (sub === "enable" || sub === "disable" || sub === "remove" || sub === "update" || sub === "rollback") {
    const result = await withClient((client) =>
      client.request<Record<string, unknown>>(`plugin.${sub}`, {
        projectPath,
        name,
        source: flagString(args, "source")
      })
    );
    print(asJson ? JSON.stringify(result, null, 2) : `plugin ${name}: ${sub} selesai`);
    return 0;
  }
  if (sub === "invoke") {
    const method = flagString(args, "method");
    if (!method) throw new RannError("E_INVALID_PARAMS", "plugin invoke butuh --method");
    const result = await withClient((client) =>
      client.request<Record<string, unknown>>("plugin.invoke", { projectPath, name, method, params: flagString(args, "params") ?? "{}" })
    );
    print(asJson ? JSON.stringify(result, null, 2) : JSON.stringify(result.output ?? result));
    return 0;
  }
  throw new RannError("E_INVALID_PARAMS", "plugin subcommand: list, install, enable, disable, remove, update, rollback, invoke");
}

async function hooksCommand(args: ParsedArgs): Promise<number> {
  const projectPath = localProject(args);
  const asJson = flagBool(args, "json");
  const sub = args.subcommand ?? "list";
  if (sub === "list") {
    const result = await withClient((client) =>
      client.request<{ hooks: Array<{ event: string; kind: string; command?: string; path?: string; url?: string; plugin?: string; priority?: number; enabled?: boolean }>; invalid: Array<{ index: number; errors: string[] }> }>("hooks.list", { projectPath })
    );
    if (asJson) print(JSON.stringify(result, null, 2));
    else if (result.hooks.length === 0) print("belum ada hook");
    else print(table(["event", "jenis", "target", "prioritas"], result.hooks.map((hook) => [hook.event, hook.kind, hook.command ?? hook.path ?? hook.url ?? hook.plugin ?? "", String(hook.priority ?? 0)])));
    return 0;
  }
  if (sub === "test") {
    const event = args.positionals[0];
    if (!event) throw new RannError("E_INVALID_PARAMS", "hooks test butuh nama event");
    const result = await withClient((client) =>
      client.request<Record<string, unknown>>("hooks.test", {
        projectPath,
        event,
        tool: flagString(args, "tool"),
        prompt: flagString(args, "prompt"),
        args: flagString(args, "args"),
        dryRun: flagBool(args, "dry-run")
      })
    );
    print(asJson ? JSON.stringify(result, null, 2) : JSON.stringify(result, null, 2));
    return 0;
  }
  throw new RannError("E_INVALID_PARAMS", "hooks subcommand: list, test");
}

async function skillCommand(args: ParsedArgs): Promise<number> {
  const projectPath = localProject(args);
  const asJson = flagBool(args, "json");
  const sub = args.subcommand ?? "list";

  if (sub === "list") {
    const skills = await withClient((client) =>
      client.request<SkillView[]>("skill.list", { projectPath, limit: limitFlag(args, 40) })
    );
    if (asJson) {
      print(JSON.stringify(skills, null, 2));
    } else if (skills.length === 0) {
      print("belum ada skill");
    } else {
      print(
        table(
          ["nama", "scope", "versi", "deskripsi"],
          skills.map((skill) => [skill.name, skill.scope, skill.version, skill.description.slice(0, 60)])
        )
      );
    }
    return 0;
  }

  if (sub === "view") {
    const name = args.positionals[0];
    if (!name) throw new RannError("E_INVALID_PARAMS", "skill view butuh nama");
    const skill = await withClient((client) => client.request<SkillView>("skill.view", { projectPath, name }));
    if (asJson) {
      print(JSON.stringify(skill, null, 2));
    } else {
      print(`# ${skill.name} (${skill.scope}, v${skill.version})`);
      print(skill.description);
      print("");
      print(skill.body ?? "");
    }
    return 0;
  }

  if (sub === "create") {
    const name = args.positionals[0];
    if (!name) throw new RannError("E_INVALID_PARAMS", "skill create butuh nama");
    const description = flagString(args, "description");
    if (!description) throw new RannError("E_INVALID_PARAMS", "skill create butuh --description");
    const bodyFile = flagString(args, "body-file");
    const body = flagString(args, "body") ?? (bodyFile ? readFileSync(bodyFile, "utf8") : args.positionals.slice(1).join("\n"));
    if (!body.trim()) throw new RannError("E_INVALID_PARAMS", "skill create butuh --body atau --body-file");
    const skill = await withClient((client) =>
      client.request<SkillView>("skill.create", {
        projectPath,
        name,
        description,
        body,
        scope: (flagString(args, "scope") ?? "project") as "global" | "project",
        overwrite: flagBool(args, "overwrite"),
        triggers: commaFlag(args, "triggers"),
        dependencies: commaFlag(args, "dependencies"),
        reason: flagString(args, "reason"),
        dryRun: flagBool(args, "dry-run")
      })
    );
    print(asJson ? JSON.stringify(skill, null, 2) : `skill ${skill.name} disimpan (${skill.scope})`);
    return 0;
  }

  if (sub === "select") {
    const task = args.positionals.join(" ").trim() || flagString(args, "task");
    if (!task) throw new RannError("E_INVALID_PARAMS", "skill select butuh teks tugas");
    const result = await withClient((client) =>
      client.request<{ skills: SkillView[]; reasons: string[] }>("skill.select", {
        projectPath,
        task,
        max: limitFlag(args, 3)
      })
    );
    if (asJson) print(JSON.stringify(result, null, 2));
    else {
      for (const reason of result.reasons) print(`- ${reason}`);
      if (result.skills.length === 0) print("tidak ada skill yang cocok");
    }
    return 0;
  }

  if (sub === "edit") {
    const name = args.positionals[0];
    if (!name) throw new RannError("E_INVALID_PARAMS", "skill edit butuh nama");
    const bodyFile = flagString(args, "body-file");
    const body = flagString(args, "body") ?? (bodyFile ? readFileSync(bodyFile, "utf8") : undefined);
    const skill = await withClient((client) =>
      client.request<SkillView>("skill.edit", {
        projectPath,
        name,
        body,
        description: flagString(args, "description"),
        triggers: commaFlag(args, "triggers"),
        reason: flagString(args, "reason")
      })
    );
    print(`skill ${skill.name} v${skill.version} diperbarui`);
    return 0;
  }

  if (sub === "history") {
    const name = args.positionals[0];
    if (!name) throw new RannError("E_INVALID_PARAMS", "skill history butuh nama");
    const result = await withClient((client) =>
      client.request<{ versions: Array<{ version: string; at: number }>; changelog: Array<Record<string, unknown>> }>(
        "skill.history",
        { projectPath, name }
      )
    );
    print(asJson ? JSON.stringify(result, null, 2) : table(["versi", "waktu"], result.versions.map((item) => [item.version, new Date(item.at).toISOString()])));
    return 0;
  }

  if (sub === "rollback") {
    const name = args.positionals[0];
    if (!name) throw new RannError("E_INVALID_PARAMS", "skill rollback butuh nama");
    const skill = await withClient((client) =>
      client.request<SkillView>("skill.rollback", { projectPath, name, version: flagString(args, "version") })
    );
    print(`skill ${skill.name} dipulihkan ke v${skill.version}`);
    return 0;
  }

  if (sub === "install") {
    const source = args.positionals[0];
    if (!source) throw new RannError("E_INVALID_PARAMS", "skill install butuh sumber folder atau URL Git");
    const skill = await withClient((client) =>
      client.request<SkillView>("skill.install", {
        projectPath,
        source,
        scope: (flagString(args, "scope") ?? "project") as "global" | "project",
        approve: flagBool(args, "approve")
      })
    );
    print(`skill ${skill.name} v${skill.version} terpasang dari ${source}`);
    return 0;
  }

  if (sub === "update") {
    const name = args.positionals[0];
    if (!name) throw new RannError("E_INVALID_PARAMS", "skill update butuh nama");
    const skill = await withClient((client) =>
      client.request<SkillView>("skill.update", { projectPath, name, source: flagString(args, "source") })
    );
    print(`skill ${skill.name} v${skill.version}`);
    return 0;
  }

  if (sub === "conflicts") {
    const conflicts = await withClient((client) =>
      client.request<Array<{ name: string; scopes: string[] }>>("skill.conflicts", { projectPath })
    );
    print(asJson ? JSON.stringify(conflicts, null, 2) : conflicts.length === 0 ? "tidak ada bentrok nama" : conflicts.map((item) => `${item.name}: ${item.scopes.join(", ")}`).join("\n"));
    return 0;
  }

  if (sub === "remove") {
    const name = args.positionals[0];
    if (!name) throw new RannError("E_INVALID_PARAMS", "skill remove butuh nama");
    const result = await withClient((client) =>
      client.request<{ removed: boolean }>("skill.remove", {
        projectPath,
        name,
        scope: (flagString(args, "scope") ?? "project") as "global" | "project"
      })
    );
    print(result.removed ? `skill ${name} dihapus` : `skill ${name} tidak ditemukan`);
    return result.removed ? 0 : 1;
  }

  throw new RannError("E_INVALID_PARAMS", `Subcommand skill tidak dikenal: ${sub}`);
}

async function configCommand(args: ParsedArgs): Promise<number> {
  if (args.subcommand === "get" || args.subcommand === undefined) {
    const key = args.positionals[0];
    if (key) {
      const data = await withClient((client) => client.request<Record<string, unknown>>("config.explain", { key }));
      if (flagBool(args, "json")) print(JSON.stringify(data, null, 2));
      else print(`${data.key} = ${JSON.stringify(data.value)}  (${data.source})`);
      return 0;
    }
    const data = await withClient((client) => client.request<Record<string, unknown>>("config.get", {}));
    print(JSON.stringify(data, null, 2));
    return 0;
  }
  if (args.subcommand === "explain") {
    const key = args.positionals[0];
    if (!key) throw new RannError("E_INVALID_PARAMS", "Pakai: rann config explain <kunci>");
    const data = await withClient((client) => client.request<Record<string, unknown>>("config.explain", { key }));
    if (flagBool(args, "json")) print(JSON.stringify(data, null, 2));
    else print(`${data.key} = ${JSON.stringify(data.value)}  (${data.source})`);
    return 0;
  }
  if (args.subcommand === "set") {
    const key = args.positionals[0];
    const value = args.positionals.slice(1).join(" ");
    if (!key || value.length === 0) throw new RannError("E_INVALID_PARAMS", "Pakai: rann config set <kunci> <nilai>");
    const layout = homeLayout();
    ensureLayout(layout);
    setConfigValue(layout.home, key, value);
    await stopDaemonForConfig();
    try {
      const opened = openDatabase({ path: layout.dbPath, backupBeforeMigrate: false });
      appendAudit(opened.db, {
        actor: "user",
        action: "config.set",
        resource: key,
        decision: "ok",
        metadata: { source: "cli", permission_change: key.startsWith("permissions.") }
      });
      opened.db.close();
    } catch {
      // audit config tidak boleh menggagalkan perubahan yang sudah ditulis
    }
    print(`${key} = ${value}`);
    return 0;
  }
  throw new RannError("E_INVALID_PARAMS", "Pakai: rann config get [kunci] | rann config set <kunci> <nilai>");
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

const SEARCH_SKIP = new Set([".git", "node_modules", "dist", "build", ".next", "coverage", ".rann"]);

function searchLocal(root: string, query: string, limit: number): Array<{ path: string; line: number; text: string }> {
  const hits: Array<{ path: string; line: number; text: string }> = [];
  const stack = [root];
  const needle = query.toLowerCase();
  while (stack.length > 0 && hits.length < limit) {
    const directory = stack.pop();
    if (!directory) break;
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (hits.length >= limit) break;
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!SEARCH_SKIP.has(entry.name)) stack.push(path);
        continue;
      }
      if (!entry.isFile()) continue;
      let info;
      try {
        info = statSync(path);
      } catch {
        continue;
      }
      if (info.size > 512 * 1024) continue;
      let content: string;
      try {
        content = readFileSync(path, "utf8");
      } catch {
        continue;
      }
      if (content.includes("\u0000")) continue;
      const lines = content.split("\n");
      for (let index = 0; index < lines.length && hits.length < limit; index += 1) {
        const text = lines[index] ?? "";
        if (text.toLowerCase().includes(needle)) hits.push({ path: relative(root, path), line: index + 1, text: text.trim() });
      }
    }
  }
  return hits;
}

function rannInstructions(map: ReturnType<typeof buildProjectMap>, lang: "id" | "en"): string {
  const lines: string[] = [];
  const primary = map.languages[0];
  if (lang === "en") {
    lines.push("# Project instructions", "", `Generated by /init on ${map.generated_at.slice(0, 10)} from the repository contents.`, "", "## Facts");
    if (primary) lines.push(`- Primary language: ${primary.name} (${Math.round(primary.share)}% of ${map.file_count} files)`);
    lines.push(`- Package manager: ${map.package_manager ?? "not detected"}`);
    if (map.frameworks.length > 0) lines.push(`- Frameworks: ${map.frameworks.join(", ")}`);
    lines.push("", "## Commands");
    for (const [name, command] of Object.entries(map.commands)) lines.push(`- ${name}: ${command === null ? "not detected" : `\`${command}\``}`);
    lines.push("", "## Structure");
    for (const dir of map.directories.slice(0, 8)) lines.push(`- ${dir.path}/: ${dir.files} files`);
    lines.push("", "## Conventions", "- Follow the existing module layout and import style.", "- Do not change generated files or lockfiles without approval.");
    if (map.assumptions.length > 0) lines.push("", "## Assumptions", ...map.assumptions.map((item) => `- ${item}`));
    return `${lines.join("\n")}\n`;
  }
  lines.push("# Instruksi proyek", "", `Dihasilkan oleh /init pada ${map.generated_at.slice(0, 10)} dari isi repo.`, "", "## Fakta");
  if (primary) lines.push(`- Bahasa utama: ${primary.name} (${Math.round(primary.share)}% dari ${map.file_count} berkas)`);
  lines.push(`- Package manager: ${map.package_manager ?? "tidak terdeteksi"}`);
  if (map.frameworks.length > 0) lines.push(`- Framework: ${map.frameworks.join(", ")}`);
  lines.push("", "## Perintah");
  for (const [name, command] of Object.entries(map.commands)) lines.push(`- ${name}: ${command === null ? "tidak terdeteksi" : `\`${command}\``}`);
  lines.push("", "## Struktur");
  for (const dir of map.directories.slice(0, 8)) lines.push(`- ${dir.path}/: ${dir.files} berkas`);
  lines.push("", "## Konvensi", "- Ikuti susunan modul dan gaya impor yang sudah ada.", "- Jangan ubah berkas generated atau lockfile tanpa persetujuan.");
  if (map.assumptions.length > 0) lines.push("", "## Asumsi", ...map.assumptions.map((item) => `- ${item}`));
  return `${lines.join("\n")}\n`;
}

function initCommand(): number {
  const dir = join(process.cwd(), ".rann");
  mkdirSync(dir, { recursive: true });
  const configPath = join(dir, "config.toml");
  if (!existsSync(configPath)) writeFileSync(configPath, "# Config project Rann Code\n", "utf8");
  // Salinan JSON yang bisa diedit, sesuai RC-AC-052; config.toml tetap kanonik.
  const configJson = join(dir, "config.json");
  if (!existsSync(configJson)) {
    writeFileSync(configJson, JSON.stringify({ profile: "default", permissions: { mode: "ask" } }, null, 2), "utf8");
  }
  const instructions = join(process.cwd(), "RANN.md");
  const map = buildProjectMap(process.cwd());
  saveProjectMap(process.cwd(), map);
  if (!existsSync(instructions)) {
    const lang = process.env.RANN_DOC_LANG === "en" ? "en" : "id";
    writeFileSync(instructions, rannInstructions(map, lang), "utf8");
  }
  print(`project disiapkan: ${dir}`);
  print(projectMapSummary(map));
  return 0;
}

process.stdout.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});
process.stderr.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EPIPE") process.exit(0);
  throw error;
});

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    const err = toRannError(error);
    printErr(`${ui.red("rann")}: ${err.code}: ${err.message}`);
    const hint = typeof err.data?.hint === "string" ? err.data.hint : undefined;
    if (hint) printErr(ui.dim(`saran: ${hint}`));
    const trace = typeof err.data?.trace_id === "string" ? err.data.trace_id : undefined;
    if (trace) printErr(ui.dim(`trace: ${trace}`));
    if (process.argv.includes("--debug") && error instanceof Error && error.stack) printErr(ui.dim(error.stack));
    process.exitCode = err.exitCode;
  });
