import { ui } from "./ui.js";

export interface HeaderInput {
  cwd: string;
  branch?: string;
  session: string;
  model: string;
  permission: string;
  profile: string;
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
