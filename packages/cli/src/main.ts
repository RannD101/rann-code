#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RannError, toRannError } from "@rann/shared";
import { ensureLayout, resolveHome, resolveLayout, type RpcClient } from "@rann/runtime";
import { inspectDatabase } from "@rann/storage";
import { parseArgs, flagBool, flagString, type ParsedArgs } from "./args.js";
import { ensureDaemon, packageVersion, tryConnect } from "./daemon.js";
import { setConfigValue } from "./config-store.js";
import { choose, chooseWith, print, printErr, relativeTime, table, ui } from "./ui.js";
import { runStreaming, type ApprovalDecision, type ApprovalRequest } from "./stream.js";

const HELP = `rann-code ${packageVersion()}

Pemakaian:
  rann "instruksi"              kirim tugas ke sesi terbaru, buat sesi baru kalau perlu
  rann chat                     sesi interaktif (REPL)
  rann -p "instruksi"           sama, gaya non-interaktif
  rann send <sesi> "instruksi"  kirim ke sesi tertentu
  rann resume <sesi> "instruksi" lanjutkan sesi tertentu
  rann new [--title teks]       buat sesi baru
  rann sessions [--limit N]     daftar sesi
  rann models                   daftar model provider aktif
  rann providers                daftar provider dan status key
  rann provider add <nama> --type openai-compatible --base-url URL --key-env ENV
  rann config explain <kunci>   asal nilai config
  rann config set <kunci> <v>   tulis config global
  rann daemon start|stop|status kelola daemon
  rann doctor [--json]          periksa instalasi
  rann init                     siapkan folder .rann di project

Flag umum:
  --model <nama>        override model
  --permission <mode>   read-only | ask | accept-edits | trusted | custom
  --yes                 setujui otomatis semua permintaan tool
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
  "chat",
  "models",
  "providers",
  "provider",
  "config",
  "init"
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
    case "config":
      return await configCommand(args);
    case "init":
      return initCommand();
    case "run":
      return await runPrompt(args, args.positionals.join(" "));
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
  const sessions = await withClient((client) =>
    client.request<Array<Record<string, unknown>>>("session.list", {
      limit,
      ...(status ? { status } : {})
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

async function runPrompt(args: ParsedArgs, text: string): Promise<number> {
  if (text.trim().length === 0) throw new RannError("E_INVALID_PARAMS", "Prompt kosong. Pakai: rann \"instruksi\"");
  const { sessionId, reused } = await withClient(async (client) => {
    const sessions = await client.request<Array<Record<string, unknown>>>("session.list", {
      limit: 50,
      status: "active",
      projectPath: process.cwd()
    });
    const target = sessions[0];
    if (target?.id) return { sessionId: target.id as string, reused: true };
    const created = await client.request<Record<string, unknown>>("session.create", {
      title: text.slice(0, 70),
      model: flagString(args, "model"),
      permissionMode: flagString(args, "permission"),
      projectPath: process.cwd()
    });
    return { sessionId: created.id as string, reused: false };
  });
  if (!reused) print(ui.dim(`sesi ${sessionId}`));
  return await sendToSession(sessionId, text, args);
}

async function sendToSession(sessionId: string, text: string, args: ParsedArgs): Promise<number> {
  const client = await ensureDaemon();
  try {
    const result = await runStreaming(client, sessionId, text, {
      model: flagString(args, "model"),
      permissionMode: flagString(args, "permission"),
      onApproval: makeApprovalHandler(args)
    });
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
    const sessions = await client.request<Array<Record<string, unknown>>>("session.list", {
      limit: 1,
      status: "active",
      projectPath: process.cwd()
    });
    let session = sessions[0];
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
    let onApproval = makeApprovalHandler(args);

    const header = (): void => {
      print(ui.bold(`Rann Code`) + ui.dim(`  ${process.cwd()}`));
      print(ui.dim(`sesi ${sessionId}  model ${model ?? "default"}  izin ${permissionMode ?? "default"}`));
      print(ui.dim("ketik /help untuk perintah, /exit untuk keluar"));
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
    const { createInterface } = await import("node:readline/promises");
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    onApproval = makeApprovalHandler(args, (question) => rl.question(question));
    let busy = false;
    rl.on("SIGINT", () => {
      if (busy) {
        void client.request("session.cancel", { sessionId }).catch(() => undefined);
        print(ui.yellow("\n[dibatalkan]"));
        return;
      }
      print("");
      rl.prompt();
    });

    try {
      for (;;) {
        const line = (await rl.question(ui.cyan("› "))).trim();
        if (line.length === 0) continue;
        if (line === "/exit" || line === "/quit" || line === "/q") break;
        if (line === "/help") {
          print("Perintah: /new [judul], /model [nama], /permission [mode], /sessions, /exit");
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
        if (line.startsWith("/model")) {
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
        if (line === "/sessions") {
          const list = await client.request<Array<Record<string, unknown>>>("session.list", { limit: 10, projectPath: process.cwd() });
          for (const item of list) print(`${item.id === sessionId ? "*" : " "} ${String(item.id)}  ${String(item.title)}`);
          continue;
        }
        if (line.startsWith("/")) {
          print(ui.red(`perintah tidak dikenal: ${line}. Coba /help`));
          continue;
        }

        busy = true;
        try {
          const result = await runStreaming(client, sessionId, line, {
            ...(model ? { model } : {}),
            ...(permissionMode ? { permissionMode } : {}),
            ...(onApproval ? { onApproval } : {})
          });
          if (!result.ok) print(ui.red("[turn gagal]"));
        } finally {
          busy = false;
        }
      }
    } finally {
      rl.close();
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
  const models = data.models as string[];
  if (models.length === 0) print("belum ada daftar model");
  else for (const model of models) print(`- ${model}`);
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
    provider.has_key ? "ada" : "tidak",
    (provider.models as string[]).join(",") || "-"
  ]);
  print(table(["NAMA", "TIPE", "BASE URL", "KEY", "MODEL"], rows));
  return 0;
}

async function providerCommand(args: ParsedArgs): Promise<number> {
  if (args.subcommand !== "add") throw new RannError("E_INVALID_PARAMS", "Pakai: rann provider add <nama> ...");
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

async function configCommand(args: ParsedArgs): Promise<number> {
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
  throw new RannError("E_INVALID_PARAMS", "Pakai: rann config explain <kunci> | rann config set <kunci> <nilai>");
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
  print(`project disiapkan: ${dir}`);
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
