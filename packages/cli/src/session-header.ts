import { truncateWidth, ui } from "./ui.js";
import { breakpoint, terminalWidth } from "./tui/layout.js";
import { isCompact, type UiMode } from "./tui/modes.js";

export interface HeaderInput {
  cwd: string;
  branch?: string;
  session: string;
  model: string;
  permission: string;
  profile: string;
  provider?: string;
  mode?: UiMode;
}

function shortenHome(path: string): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  if (home.length > 0 && path.startsWith(home)) return `~${path.slice(home.length)}`;
  return path;
}

function fitted(value: string, width: number): string {
  return truncateWidth(value, Math.max(8, width));
}

/**
 * Header premium: identitas, konteks sesi, lalu satu rule.
 * Lebar < 60 memakai blok tiga baris agar tidak overflow.
 */
export function renderHeader(input: HeaderInput, width = terminalWidth()): string[] {
  const mode = breakpoint(width);
  const workspace = input.mode === "debug" ? input.cwd : shortenHome(input.cwd);
  const branch = input.branch && input.branch.length > 0 ? ` (${input.branch})` : "";
  const title = `${ui.bold(ui.accent("Rann Code"))}${ui.dim("  autonomous development agent")}`;
  if (isCompact(input.mode ?? "interactive")) {
    return [
      ui.bold(ui.accent("Rann Code")),
      `${ui.label("workspace")} ${fitted(`${workspace}${branch}`, width - 12)}`,
      ui.border("─".repeat(width))
    ];
  }
  if (mode === "narrow") {
    return [
      ui.bold(ui.accent("Rann Code")),
      `${ui.label("model")} ${fitted(input.model, width - 8)}`,
      `${ui.label("dir")} ${fitted(`${workspace}${branch}`, width - 6)}`,
      ui.border("─".repeat(width))
    ];
  }
  const model = `${ui.label("model")} ${fitted(input.model, mode === "medium" ? 28 : 38)}`;
  const provider = input.provider
    ? `  ${ui.label("provider")} ${fitted(input.provider, mode === "medium" ? Math.max(8, width - 45) : 20)}`
    : "";
  const place = `${ui.label("workspace")} ${fitted(`${workspace}${branch}`, mode === "medium" ? 42 : 60)}`;
  const metaParts = [
    `${ui.label("session")} ${fitted(input.session, 14)}`,
    `${ui.label("permission")} ${fitted(input.permission, 14)}`,
    ...(mode === "medium" ? [] : [`${ui.label("profile")} ${fitted(input.profile, 14)}`])
  ];
  const meta = metaParts.join("  ");
  return [
    fitted(title, width),
    `${model}${provider}`,
    place,
    meta,
    ui.border("─".repeat(width))
  ];
}

export function headerLines(input: HeaderInput): string[] {
  return [
    ui.bold("Rann Code") + ui.dim(`  ${input.cwd}${input.branch ? `  (${input.branch})` : ""}`),
    ui.dim(`sesi ${input.session}  model ${input.model}  izin ${input.permission}  profil ${input.profile}`),
    ui.dim("ketik /help untuk perintah, /plan <tugas> untuk rencana, /exit untuk keluar")
  ];
}

export type CtrlDAction = "wait" | "cancel" | "background" | "exit";

export async function ctrlDAction(
  isBusy: boolean,
  choose: (title: string, options: Array<{ key: CtrlDAction; label: string }>, fallback: CtrlDAction) => Promise<CtrlDAction>
): Promise<CtrlDAction> {
  if (!isBusy) return "exit";
  return choose(
    "Turn masih berjalan. Pilih tindakan:",
    [
      { key: "wait", label: "tunggu sampai selesai" },
      { key: "cancel", label: "batalkan turn" },
      { key: "background", label: "biarkan berjalan di background" },
      { key: "exit", label: "keluar dan hentikan klien" }
    ],
    "wait"
  );
}
