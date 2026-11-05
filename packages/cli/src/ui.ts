const COLOR_ENABLED =
  process.stdout.isTTY === true && process.env.NO_COLOR === undefined && process.env.TERM !== "dumb" && process.env.RANN_NO_COLOR !== "1";

function wrap(code: number, text: string): string {
  return COLOR_ENABLED ? `\u001b[${code}m${text}\u001b[0m` : text;
}

export const ui = {
  bold: (text: string) => wrap(1, text),
  dim: (text: string) => wrap(2, text),
  red: (text: string) => wrap(31, text),
  green: (text: string) => wrap(32, text),
  yellow: (text: string) => wrap(33, text),
  cyan: (text: string) => wrap(36, text)
};

export function print(line = ""): void {
  process.stdout.write(`${line}\n`);
}

export function printErr(line: string): void {
  process.stderr.write(`${line}\n`);
}

export function table(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, index) => Math.max(header.length, ...rows.map((row) => (row[index] ?? "").length)));
  const render = (row: string[]): string => row.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join("  ").trimEnd();
  const lines = [render(headers), ...rows.map(render)];
  return lines.join("\n");
}

export function relativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "baru saja";
  if (minutes < 60) return `${minutes} menit lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} jam lalu`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} hari lalu`;
  return new Date(timestamp).toISOString().slice(0, 10);
}

export interface Choice<T extends string> {
  key: T;
  label: string;
}

export async function chooseWith<T extends string>(
  ask: (question: string) => Promise<string>,
  prompt: string,
  choices: Array<Choice<T>>,
  fallback: T
): Promise<T> {
  for (;;) {
    process.stderr.write(`${prompt}\n`);
    choices.forEach((choice, index) => process.stderr.write(`  [${index + 1}] ${choice.label}\n`));
    const answer = (await ask(`Pilih 1-${choices.length} (Enter = ${fallback}): `)).trim().toLowerCase();
    if (answer.length === 0) return fallback;
    const numeric = Number.parseInt(answer, 10);
    if (Number.isInteger(numeric) && numeric >= 1 && numeric <= choices.length) return choices[numeric - 1]!.key;
    const direct = choices.find((choice) => choice.key === answer);
    if (direct) return direct.key;
    process.stderr.write("Pilihan tidak dikenal, coba lagi.\n");
  }
}

export async function choose<T extends string>(prompt: string, choices: Array<Choice<T>>, fallback: T): Promise<T> {
  if (process.stdin.isTTY !== true) return fallback;
  const { createInterface } = await import("node:readline/promises");
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    return await chooseWith((question) => rl.question(question), prompt, choices, fallback);
  } finally {
    rl.close();
  }
}
