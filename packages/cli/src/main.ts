#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { RannError, toRannError } from "@rann/shared";
import { buildProjectMap, ensureLayout, projectMapSummary, resolveHome, resolveLayout, saveProjectMap, type RpcClient } from "@rann/runtime";
import { inspectDatabase, renderGoal, type GoalView } from "@rann/storage";
import { parseArgs, flagBool, flagString, type ParsedArgs } from "./args.js";
import { ensureDaemon, packageVersion, tryConnect } from "./daemon.js";
import { setConfigValue, unsetConfigValue } from "./config-store.js";
import { choose, chooseWith, clearScreen, colorsEnabled, loadCustomThemeIfPresent, print, printErr, relativeTime, setTheme, table, themeTokens, truncateWidth, ui } from "./ui.js";
import { runStreaming, type ApprovalDecision, type ApprovalRequest, type OutputFormat, type StreamResult } from "./stream.js";
import { commandName, completeReplLine, findReplCommand, isAvailable, matchReplCommands, REPL_COMMANDS, type ReplCommand } from "./repl-commands.js";
import { HistoryStore } from "./history.js";
import { expandCustomCommand, loadCustomCommands, type CustomCommand } from "./custom-commands.js";
import { LineEditor, ReplExit } from "./line-editor.js";

const HELP = `rann-code ${packageVersion()}

Pemakaian:
  rann "instruksi"              kirim tugas ke sesi terbaru, buat sesi baru kalau perlu
  rann plan "instruksi"         susun rencana saja, belum menjalankan tool
  rann chat                     sesi interaktif (REPL)
  rann -p "instruksi"           sama, gaya non-interaktif
  rann send <sesi> "instruksi"  kirim ke sesi tertentu
  rann resume <sesi> "instruksi" lanjutkan sesi tertentu
  rann turn <id> [--wait]        lihat hasil turn, tunggu kalau perlu
  rann new [--title teks]       buat sesi baru
  rann sessions [--limit N]     daftar sesi di folder ini (--all untuk semua)
  rann models                   daftar model provider aktif
  rann route explain "<prompt>"  jelaskan pilihan model tanpa mengirim request
  rann usage                    ringkasan token, biaya, dan budget hari ini
  rann providers                daftar provider dan status key
  rann provider add <nama> --type openai-compatible --base-url URL --key-env ENV
  rann provider login <nama> --env ENV   simpan kunci ke vault terenkripsi
  rann provider remove <nama>     hapus kunci provider dari vault
  rann provider test [nama]       uji koneksi provider dan model default
  rann secret list               daftar secret terenkripsi (tanpa nilai)
  rann secret set <nama> --env ENV  simpan secret dari environment
  rann secret remove <nama>      hapus secret
  rann memory list|search|add|update|remove  kelola memori lokal
  rann skill list|view|create|remove         kelola skill lokal
  rann config get [kunci]       lihat config efektif atau satu kunci
  rann config explain <kunci>   asal nilai config
  rann config set <kunci> <v>   tulis config global
  rann daemon start|stop|status kelola daemon
  rann doctor [--json]          periksa instalasi
  rann init                     siapkan folder .rann di project

Flag umum:
  --model <nama>        override model
  --permission <mode>   read-only | ask | accept-edits | trusted | custom
  --yes                 setujui otomatis semua permintaan tool
  --plan                susun rencana saja, belum menjalankan tool
  --detach              jalankan turn di latar, langsung cetak id turn
  --output-format <f>   text | json | stream-json
  --json                keluaran JSON
  -v, --version         versi
  -h, --help            bantuan`;

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
  "skill"
]);

async function main(argv: string[]): Promise<number> {
  const first = argv[0];
  const args =
    first !== undefined && !first.startsWith("-") && !KNOWN_COMMANDS.has(first)
      ? parseArgs(["run", ...argv])
      : parseArgs(argv);

  if (flagBool(args, "version")) {
    print(`rann-code ${packageVersion()}`);
    return 0;
  }
  const barePrompt = flagString(args, "prompt");
  if (args.command === undefined) {
    const positionalPrompt = args.positionals.join(" ").trim();
    if (positionalPrompt.length > 0) return await runPrompt(args, positionalPrompt);
    if (barePrompt) return await runPrompt(args, barePrompt);
    if (process.stdin.isTTY && process.stdout.isTTY) return await chatCommand(args);
  }
  if (flagBool(args, "help") || args.command === undefined) {
    print(HELP);
    return 0;
  }

  switch (args.command) {
    case "version":
      print(`rann-code ${packageVersion()}`);
      return 0;
    case "help":
      print(HELP);
      return 0;
    case "daemon":
      return await daemonCommand(args);
    case "doctor":
      return await doctorCommand(args);
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

interface Check {
  name: string;
  ok: boolean;
  detail: string;
  level: "ok" | "warn" | "fail";
}

async function doctorCommand(args: ParsedArgs): Promise<number> {
  const layout = homeLayout();
  ensureLayout(layout);
  const checks: Check[] = [];

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
      ? `skema ${inspection.schemaVersion}, quick_check ok`
      : dbExists
        ? inspection.problems.join("; ")
        : "belum dibuat, akan dibuat saat daemon start"
  });

  try {
    const { loadConfig, providerFor } = await import("@rann/shared");
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
  return Buffer.concat(chunks).toString("utf8").trim();
}

async function runPrompt(args: ParsedArgs, text: string): Promise<number> {
  const stdin = await readPipedStdin();
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
  if (!reused && resolveOutputFormat(args) === "text") print(ui.dim(`sesi ${sessionId}`));
  return await sendToSession(sessionId, prompt, args);
}

function resolveOutputFormat(args: ParsedArgs): OutputFormat {
  const raw = flagString(args, "output-format") ?? (flagBool(args, "json") ? "json" : "text");
  if (raw === "text" || raw === "json" || raw === "stream-json") return raw;
  throw new RannError("E_INVALID_PARAMS", `output-format tidak dikenal: ${raw}. Pakai text, json, atau stream-json.`);
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
      planOnly: flagBool(args, "plan") || args.command === "plan",
      onApproval: makeApprovalHandler(args)
    });
    if (output === "json") {
      const payload = {
        ok: result.ok,
        result: result.text,
        session_id: sessionId,
        turn_id: result.turnId,
        steps: result.steps,
        usage: {
          input_tokens: result.usage.inputTokens,
          output_tokens: result.usage.outputTokens
        },
        error: result.error ?? null
      };
      process.stdout.write(`${JSON.stringify(payload)}\n`);
    }
    return result.ok ? 0 : 1;
  } finally {
    client.close();
  }
}

function makeApprovalHandler(
  args: ParsedArgs,
  ask?: (question: string) => Promise<string>
): ((request: ApprovalRequest) => Promise<ApprovalDecision>) | undefined {
  if (flagBool(args, "yes")) return async () => ({ approved: true });
  if (process.stdin.isTTY !== true) return undefined;
  return async (request) => {
    const detail =
      request.args !== null && typeof request.args === "object" && "command" in (request.args as Record<string, unknown>)
        ? String((request.args as Record<string, unknown>).command)
        : JSON.stringify(request.args ?? {});
    const prompt = `\nPerlu izin: ${request.tool}\n  ${detail.slice(0, 500)}`;
    const choices = [
      { key: "once", label: "Setujui sekali" },
      { key: "always", label: "Selalu untuk tool ini di sesi ini" },
      { key: "deny", label: "Tolak" }
    ] as const;
    const answer = ask ? await chooseWith(ask, prompt, [...choices], "deny") : await choose(prompt, [...choices], "deny");
    return { approved: answer !== "deny", remember: answer === "always" };
  };
}

const PERMISSION_MODES = ["read-only", "ask", "accept-edits", "trusted", "custom"] as const;

async function chatCommand(args: ParsedArgs): Promise<number> {
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
    const custom = loadCustomCommands({
      homeDir: join(resolveHome(), "commands"),
      projectDir: join(process.cwd(), ".rann", "commands"),
      coreNames: REPL_COMMANDS.map((command) => command.name)
    });
    for (const error of custom.errors) printErr(ui.dim(`[command] ${error}`));
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
    let lastTurnId: string | undefined;
    let lastResponse = "";
    let pendingAttachment: { name: string; content: string } | undefined;

    const sessionLabel = (): string => (sessionId.length > 8 ? sessionId.slice(0, 8) : sessionId);
    const statusPrompt = (): string => {
      const width = process.stdout.columns ?? 80;
      const parts = [model ?? "default"];
      if (totalTokens > 0) parts.push(`${(totalTokens / 1000).toFixed(1)}k tok`);
      if (totalCost > 0) parts.push(`$${totalCost.toFixed(3)}`);
      parts.push(permissionMode ?? "ask");
      if (pendingAttachment) parts.push(`lampiran ${pendingAttachment.name}`);
      const text = parts.join("  ");
      return ui.cyan("› ") + (width >= 64 ? ui.dim(`${truncateWidth(text, Math.max(10, width - 8))} `) : "");
    };

    const editor = new LineEditor({
      history,
      busy: () => busy,
      prompt: statusPrompt,
      palette: [
        ...REPL_COMMANDS.filter((command) => isAvailable(command)).map((command: ReplCommand) => ({
          name: command.name,
          description: command.description,
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
          return { start: tokenStart, items: ["dark", "light", "auto", "custom"].filter((item) => item.startsWith(query)).map((value) => ({ value })) };
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
      onCtrlD: async (isBusy: boolean) => {
        if (!isBusy) return "exit";
        return choose("Turn masih berjalan. Pilih tindakan:", [
          { key: "wait" as const, label: "tunggu sampai selesai" },
          { key: "cancel" as const, label: "batalkan turn" },
          { key: "exit" as const, label: "keluar tanpa menunggu" }
        ], "wait");
      },
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
    const onApproval = makeApprovalHandler(args, (question) => editor.readLine(question));

    const header = (): void => {
      print(ui.bold("Rann Code") + ui.dim(`  ${process.cwd()}${branch ? `  (${branch})` : ""}`));
      print(ui.dim(`sesi ${sessionLabel()}  model ${model ?? "default"}  izin ${permissionMode ?? "default"}  profil ${process.env.RANN_PROFILE ?? "default"}`));
      print(ui.dim("ketik /help untuk perintah, /plan <tugas> untuk rencana, /exit untuk keluar"));
    };

    const outgoing = (text: string): string => {
      const attachment = pendingAttachment;
      pendingAttachment = undefined;
      if (!attachment) return text;
      return `<file name="${attachment.name}">\n${attachment.content}\n</file>\n\n${text}`;
    };

    const recordResult = async (result: StreamResult): Promise<void> => {
      totalTokens += result.usage.inputTokens + result.usage.outputTokens;
      lastResponse = result.text;
      lastTurnId = result.turnId;
      try {
        const budget = await client.request<Record<string, unknown>>("budget.status", {});
        totalCost = Number(budget.spent_usd_today ?? totalCost);
      } catch {
        // status biaya bersifat pelengkap
      }
    };

    if (process.stdin.isTTY !== true) {
      const text = readFileSync(0, "utf8").trim();
      if (text.length === 0) throw new RannError("E_INVALID_PARAMS", "Tidak ada input di stdin");
      const result = await runStreaming(client, sessionId, text, {
        ...(model ? { model } : {}),
        ...(permissionMode ? { permissionMode } : {}),
        ...(onApproval ? { onApproval } : {})
      });
      return result.ok ? 0 : 1;
    }

    header();
    const bootHealth = await client.request<Record<string, unknown>>("health");
    const recoveredTurns = Array.isArray(bootHealth.recovered_turns) ? bootHealth.recovered_turns : [];
    if (recoveredTurns.length > 0) {
      print(ui.yellow(`${recoveredTurns.length} turn sebelumnya terputus, riwayat sudah ditandai. Kirim pesan untuk melanjutkan.`));
    }
    try {
      for (;;) {
        let line = (await editor.readLine()).trim();
        if (line.length === 0) continue;
        if (line === "/exit" || line === "/quit" || line === "/q") break;
        if (line === "/review" || line.startsWith("/review ")) {
          const focus = line.slice(7).trim();
          line =
            "Lakukan code review pada perubahan yang belum di-commit di workspace ini. " +
            "Baca diff dengan git_read, cari bug, risiko keamanan, dan pelanggaran gaya. " +
            (focus ? `Fokus tambahan: ${focus}. ` : "") +
            "Tulis temuan berurutan berdasarkan tingkat bahaya, sertakan path dan baris.";
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
                ["PgUp / PgDn", "gulir transcript", "pakai scrollback terminal"]
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
          const risky = /\brm\s+-[a-zA-Z]*[rf]|\bsudo\b|\bmkfs|\bdd\s+if=|\bshutdown\b|\breboot\b|>\s*\/dev\/sd|\bchmod\s+777/.test(command);
          if (risky && permissionMode !== "trusted") {
            const answer = (await editor.readLine(ui.yellow("perintah berisiko. jalankan? [y/N] "))).trim().toLowerCase();
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
          const suggestions = matchReplCommands(commandName(line)).slice(0, 3);
          print(`perintah tidak dikenal: ${commandName(line)}`);
          if (suggestions.length > 0) print(`mungkin: ${suggestions.map((item) => `/${item.name}`).join(", ")}`);
          continue;
        }
        if (line.startsWith("/")) {
          const registered = findReplCommand(commandName(line));
          if (registered && !isAvailable(registered)) {
            print(ui.yellow(`/${registered.name} belum tersedia: ${registered.unavailableReason ?? "backend belum ada"}`));
            continue;
          }
        }
        if (line === "/memory" || line.startsWith("/memory ")) {
          const query = line.slice(7).trim();
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
        if (line === "/skills") {
          const skills = await client.request<Array<Record<string, unknown>>>("skill.list", {
            projectPath: process.cwd(),
            limit: 40
          });
          if (skills.length === 0) print("belum ada skill");
          else {
            for (const skill of skills) {
              print(`${String(skill.name)}  [${String(skill.scope)}] ${String(skill.description).slice(0, 70)}`);
            }
          }
          continue;
        }
        if (line.startsWith("/skill ")) {
          const name = line.slice(7).trim();
          if (name.length === 0) {
            print("Pakai: /skill <nama>");
            continue;
          }
          const skill = await client.request<Record<string, unknown>>("skill.view", {
            projectPath: process.cwd(),
            name
          });
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
          print("tool: repo_map, search_code, read_file, write_file, edit_file, delete_file, list_dir, stat_file, apply_patch, project_check, goal_status, goal_update, shell_run, git_read, git_write, checkpoint_create, checkpoint_list, checkpoint_restore, memory, skill, task, mcp__<server>__<tool>");
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
            print(`model aktif: ${model ?? "default"}`);
            for (const item of (data.models as string[]) ?? []) print(`- ${item}`);
          } else {
            model = name;
            print(ui.dim(`model ${model}`));
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
            print(`tema aktif: ${process.env.RANN_THEME ?? "auto"}  warna ${colorsEnabled() ? "aktif" : "nonaktif"}`);
            const tokens = themeTokens();
            print(`contoh  ${ui.fg("teks")}  ${ui.dim("dim")}  ${ui.accent("accent")}  ${ui.green("ok")}  ${ui.yellow("peringatan")}  ${ui.red("bahaya")}`);
            print(`token   ${Object.keys(tokens).join(", ")}`);
            continue;
          }
          if (!["dark", "light", "auto", "custom"].includes(argument)) {
            print(ui.red("tema tidak dikenal. Pilihan: dark, light, auto, custom"));
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
            setTheme(argument as "dark" | "light" | "auto");
          }
          history.add(`/theme ${argument}`);
          print(ui.dim(`tema ${argument}`));
          continue;
        }
        if (line === "/history" || line.startsWith("/history ")) {
          const argument = line.slice(8).trim();
          const limit = Number(/--limit\s+(\d+)/.exec(argument)?.[1] ?? 20);
          const search = /--search\s+(.+)$/.exec(argument)?.[1]?.trim();
          const data = await client.request<Record<string, unknown>>("session.get", { sessionId });
          const messages = ((data.messages as Array<Record<string, unknown>> | undefined) ?? [])
            .filter((message) => message.role === "user" || message.role === "assistant")
            .filter((message) => (search ? String(message.content ?? "").toLowerCase().includes(search.toLowerCase()) : true))
            .slice(-Math.max(1, Math.min(200, limit)));
          if (messages.length === 0) print(ui.dim("belum ada pesan cocok"));
          else {
            for (const message of messages) {
              const text = String(message.content ?? "").replace(/\s+/g, " ").slice(0, 240);
              print(`${String(message.role).padEnd(9)} ${text}`);
            }
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
        if (line === "/diff" || line.startsWith("/diff ")) {
          try {
            const stat = execFileSync("git", ["diff", "--no-color", "--stat"], { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
            const diff = execFileSync("git", ["diff", "--no-color"], { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
            print(stat.trim() || ui.dim("tidak ada perubahan"));
            if (diff.trim().length > 0) print(diff.length > 60_000 ? `${diff.slice(0, 60_000)}\n[dipotong]` : diff);
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
        if (line === "/resume" || line.startsWith("/resume ")) {
          const target = line.slice(7).trim();
          if (target.length === 0) {
            const list = await client.request<Array<Record<string, unknown>>>("session.list", { limit: 15, projectPath: process.cwd() });
            for (const item of list) print(`${item.id === sessionId ? "*" : " "} ${String(item.id)}  ${String(item.title)}`);
            print(ui.dim("pakai /resume <id> untuk melanjutkan"));
            continue;
          }
          const data = await client.request<Record<string, unknown>>("session.get", { sessionId: target });
          sessionId = String(data.id);
          if (data.model) model = String(data.model);
          if (data.permission_mode) permissionMode = String(data.permission_mode);
          print(ui.dim(`sesi ${sessionId}  model ${model ?? "default"}`));
          const messages = ((data.messages as Array<Record<string, unknown>> | undefined) ?? []).slice(-6);
          for (const message of messages) print(`${String(message.role).padEnd(9)} ${String(message.content ?? "").replace(/\s+/g, " ").slice(0, 200)}`);
          continue;
        }
        if (line === "/project" || line.startsWith("/project ")) {
          const sub = line.slice(8).trim();
          if (sub.length > 0 && sub !== "show") {
            print(ui.dim("subcommand project belum tersedia di REPL, pakai rann init atau edit .rann/project-map.json"));
            continue;
          }
          print(projectMapSummary(buildProjectMap(process.cwd())));
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
          const argument = line.slice(13).trim();
          const separator = argument.indexOf("|");
          const name = (separator >= 0 ? argument.slice(0, separator) : argument).trim();
          const description = (separator >= 0 ? argument.slice(separator + 1) : "").trim();
          if (name.length === 0 || description.length < 12) {
            print("Pakai: /create-skill <nama> | <deskripsi minimal 12 karakter>");
            continue;
          }
          const body = `# ${name}\n\n${description}\n\n## Kapan dipakai\n\nJelaskan pemicu dan konteks pemakaian skill ini.\n\n## Langkah\n\n1. Langkah pertama.\n2. Verifikasi hasil dengan perintah nyata.\n\n## Pitfall\n\nCatat kesalahan yang pernah terjadi dan cara menghindarinya.\n`;
          const skill = await client.request<Record<string, unknown>>("skill.create", {
            projectPath: process.cwd(),
            name,
            description,
            body,
            scope: "project",
            overwrite: false
          });
          print(ui.green(`skill ${String(skill.name)} dibuat di ${String(skill.path)}`));
          continue;
        }
        if (line === "/mcp" || line.startsWith("/mcp ")) {
          print(ui.yellow("backend MCP belum tersedia di versi ini"));
          continue;
        }
        if (line === "/sessions") {
          const list = await client.request<Array<Record<string, unknown>>>("session.list", { limit: 10, projectPath: process.cwd() });
          for (const item of list) print(`${item.id === sessionId ? "*" : " "} ${String(item.id)}  ${String(item.title)}`);
          continue;
        }
        if (line === "/tasks") {
          const plans = await client.request<Array<Record<string, unknown>>>("plan.list", { sessionId, limit: 5 });
          if (plans.length === 0) {
            print(ui.dim("belum ada rencana di sesi ini"));
            continue;
          }
          for (const plan of plans) {
            print(`${String(plan.id)}  ${String(plan.status)}  ${String(plan.goal)}`);
            const tasks = (plan.tasks as Array<Record<string, unknown>> | undefined) ?? [];
            for (const task of tasks) print(`  - [${String(task.status)}] ${String(task.title)}`);
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
        if (line.startsWith("/plan ")) {
          const text = line.slice(6).trim();
          if (text.length === 0) {
            print(ui.red("Pakai: /plan <tugas>"));
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
          print(ui.red(`perintah tidak dikenal: ${line}. Coba /help`));
          continue;
        }

        busy = true;
        try {
          const result = await runStreaming(client, sessionId, outgoing(line), {
            ...(model ? { model } : {}),
            ...(permissionMode ? { permissionMode } : {}),
            ...(onApproval ? { onApproval } : {})
          });
          await recordResult(result);
          if (!result.ok) print(ui.red("[turn gagal]"));
        } finally {
          busy = false;
        }
      }
    } catch (error) {
      if (error instanceof ReplExit) return error.code;
      throw error;
    } finally {
      editor.close();
    }
    return 0;
  } finally {
    client.close();
  }
}

async function modelsCommand(args: ParsedArgs): Promise<number> {
  const data = await withClient((client) => client.request<Record<string, unknown>>("model.list"));
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
      print(`- ${descriptor.id}  ctx ${descriptor.contextWindow}  out ${descriptor.maxOutputTokens}${price}`);
      print(`  ${capabilities}`);
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
        overwrite: flagBool(args, "overwrite")
      })
    );
    print(asJson ? JSON.stringify(skill, null, 2) : `skill ${skill.name} disimpan (${skill.scope})`);
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

function initCommand(): number {
  const dir = join(process.cwd(), ".rann");
  mkdirSync(dir, { recursive: true });
  const configPath = join(dir, "config.toml");
  if (!existsSync(configPath)) writeFileSync(configPath, "# Config project Rann Code\n", "utf8");
  const instructions = join(process.cwd(), "RANN.md");
  if (!existsSync(instructions)) {
    writeFileSync(instructions, "# Instruksi proyek\n\nTulis aturan yang harus diikuti agent di repo ini.\n", "utf8");
  }
  const map = buildProjectMap(process.cwd());
  saveProjectMap(process.cwd(), map);
  print(`project disiapkan: ${dir}`);
  print(projectMapSummary(map));
  return 0;
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    const err = toRannError(error);
    printErr(`${ui.red("rann")}: ${err.code}: ${err.message}`);
    process.exitCode = err.exitCode;
  });
