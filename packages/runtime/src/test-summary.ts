export interface TestSummary {
  passed: number;
  failed: number;
  skipped: number;
  total: number;
  flaky: boolean;
  framework: string | null;
}

const FRAMEWORK_HINTS: Array<{ name: string; pattern: RegExp }> = [
  { name: "vitest", pattern: /\bvitest\b|Test Files\s+\d+/i },
  { name: "jest", pattern: /\bjest\b|Tests:\s+\d+/i },
  { name: "pytest", pattern: /\bpytest\b|={2,}\s+\d+ (?:passed|failed)/i },
  { name: "go test", pattern: /^ok\s+\S+/m },
  { name: "cargo test", pattern: /test result:/i },
  { name: "node test", pattern: /^# (?:pass|fail) \d+/m }
];

function numberAfter(text: string, pattern: RegExp): number | undefined {
  const match = pattern.exec(text);
  if (match?.[1] === undefined) return undefined;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : undefined;
}

export function parseTestSummary(output: string): TestSummary {
  const framework = FRAMEWORK_HINTS.find((item) => item.pattern.test(output))?.name ?? null;
  const passed =
    numberAfter(output, /(\d+)\s+passed\b/i) ??
    numberAfter(output, /Tests:\s*(\d+)\s+passed/i) ??
    numberAfter(output, /^# pass (\d+)/m) ??
    0;
  const failed =
    numberAfter(output, /(\d+)\s+failed\b/i) ??
    numberAfter(output, /Tests:\s*\d+\s+failed,\s*(\d+)/i) ??
    numberAfter(output, /^# fail (\d+)/m) ??
    0;
  const skipped =
    numberAfter(output, /(\d+)\s+(?:skipped|pending|todo)\b/i) ??
    numberAfter(output, /^# skip (\d+)/m) ??
    0;
  const flaky = /\bflaky\b/i.test(output);
  return { passed, failed, skipped, total: passed + failed + skipped, flaky, framework };
}
