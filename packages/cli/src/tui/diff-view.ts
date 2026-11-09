import { truncateWidth, ui } from "../ui.js";

/** Mewarnai unified diff tanpa mengubah teks yang terlihat. */
export function renderDiffText(text: string, width = process.stdout.columns ?? 80): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const output: string[] = [];
  let added = 0;
  let removed = 0;
  for (const raw of lines) {
    const line = truncateWidth(raw, Math.max(10, width));
    if (line.startsWith("+++") || line.startsWith("---")) {
      output.push(ui.bold(line));
    } else if (line.startsWith("+")) {
      added += 1;
      output.push(ui.green(line));
    } else if (line.startsWith("-")) {
      removed += 1;
      output.push(ui.red(line));
    } else if (line.startsWith("@@")) {
      output.push(ui.accent(line));
    } else if (line.startsWith("diff ") || line.startsWith("index ")) {
      output.push(ui.dim(line));
    } else {
      output.push(line);
    }
  }
  if (added > 0 || removed > 0) output.push(ui.dim(`${added} tambah  ${removed} hapus`));
  return output.join("\n");
}
