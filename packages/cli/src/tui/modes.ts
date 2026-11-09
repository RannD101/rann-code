export type UiMode = "interactive" | "compact" | "verbose" | "debug";

const MODES: UiMode[] = ["interactive", "compact", "verbose", "debug"];

export function resolveUiMode(value: string | undefined): UiMode {
  if (!value) return "interactive";
  const mode = value.trim().toLowerCase();
  if ((MODES as string[]).includes(mode)) return mode as UiMode;
  throw new Error(`mode UI tidak dikenal: ${value}. Pilihan: ${MODES.join(", ")}`);
}

export function isCompact(mode: UiMode): boolean {
  return mode === "compact";
}

export function isVerbose(mode: UiMode): boolean {
  return mode === "verbose" || mode === "debug";
}
