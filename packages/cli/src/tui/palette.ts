import { displayWidth, padWidth, truncateWidth, ui } from "../ui.js";

export interface PaletteLineItem {
  value: string;
  description?: string;
  category?: string;
  usage?: string;
}

export interface PaletteView {
  title: string;
  items: PaletteLineItem[];
  selected: number;
  width?: number;
  visible?: number;
}

/** Renderer command palette yang dipakai editor; tidak menyentuh state input. */
export function renderPalette(view: PaletteView): string[] {
  const width = Math.max(20, view.width ?? process.stdout.columns ?? 80);
  const visible = view.visible ?? 8;
  const maxStart = Math.max(0, view.items.length - visible);
  const start = Math.max(0, Math.min(view.selected - Math.floor(visible / 2), maxStart));
  const slice = view.items.slice(start, start + visible);
  const lines = [ui.bold(view.title)];
  const nameWidth = Math.min(24, Math.max(12, ...slice.map((item) => displayWidth(item.value))));
  const showCategory = width >= 84;
  slice.forEach((item, offset) => {
    const index = start + offset;
    const selected = index === view.selected;
    const marker = selected ? ui.accent("❯") : " ";
    const name = selected ? ui.accent(item.value) : ui.fg(item.value);
    const categoryWidth = showCategory && item.category ? Math.min(14, item.category.length) + 2 : 0;
    const description = item.description
      ? ui.dim(truncateWidth(item.description, Math.max(10, width - nameWidth - categoryWidth - 5)))
      : "";
    const category = showCategory && item.category ? `  ${ui.dim(truncateWidth(item.category, 14))}` : "";
    lines.push(`${marker} ${padWidth(name, nameWidth)}  ${description}${category}`);
    if (selected && item.usage && item.usage !== item.value && width >= 52) {
      lines.push(`  ${ui.dim("usage")} ${ui.dim(truncateWidth(item.usage, width - 10))}`);
    }
  });
  if (view.items.length > visible) lines.push(ui.dim(`  ${start + 1}-${Math.min(start + visible, view.items.length)} dari ${view.items.length}`));
  lines.push(ui.dim("  ↑↓ pindah   Enter pilih   Esc tutup"));
  return lines;
}
