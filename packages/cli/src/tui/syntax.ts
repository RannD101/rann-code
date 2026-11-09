import { colorEnabled, ui } from "../ui.js";

const JS_KEYWORDS = new Set([
  "const", "let", "var", "function", "return", "if", "else", "for", "while", "await", "async",
  "import", "from", "export", "default", "class", "new", "try", "catch", "throw", "finally",
  "switch", "case", "break", "continue", "typeof", "instanceof", "in", "of", "this", "super",
  "interface", "type", "enum", "implements", "extends", "public", "private", "protected", "readonly"
]);
const PY_KEYWORDS = new Set(["def", "return", "if", "else", "elif", "for", "while", "import", "from", "class", "try", "except", "finally", "with", "as", "lambda", "yield", "async", "await", "True", "False", "None"]);
const SHELL_KEYWORDS = new Set(["if", "then", "else", "fi", "for", "do", "done", "while", "case", "esac", "function", "export", "local", "echo", "cd", "npm", "pnpm", "node", "git", "curl"]);

function family(language: string): "js" | "py" | "shell" | "json" | "text" {
  const value = language.toLowerCase();
  if (["ts", "tsx", "js", "jsx", "javascript", "typescript"].includes(value)) return "js";
  if (["py", "python"].includes(value)) return "py";
  if (["sh", "bash", "shell", "zsh", "console"].includes(value)) return "shell";
  if (value === "json") return "json";
  return "text";
}

function keywordSet(language: string): Set<string> | undefined {
  const kind = family(language);
  if (kind === "js") return JS_KEYWORDS;
  if (kind === "py") return PY_KEYWORDS;
  if (kind === "shell") return SHELL_KEYWORDS;
  return undefined;
}

/**
 * Highlighter baris tunggal tanpa dependency. Token yang tidak dikenal
 * dikembalikan apa adanya, sehingga stripAnsi(hasil) selalu sama dengan input.
 */
export function highlightCode(line: string, language = ""): string {
  if (!colorEnabled() || line.length === 0) return line;
  const kind = family(language);
  const keywords = keywordSet(language);
  const token = /(\/\/[^\n]*|#[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_$][\w$]*\b)/g;
  let output = "";
  let last = 0;
  for (const match of line.matchAll(token)) {
    const index = match.index ?? 0;
    const text = match[0];
    output += line.slice(last, index);
    if ((text.startsWith("//") || (text.startsWith("#") && kind !== "text" && kind !== "json"))) {
      output += ui.dim(text);
    } else if (text.startsWith('"') || text.startsWith("'") || text.startsWith("`")) {
      output += ui.green(text);
    } else if (/^\d/.test(text)) {
      output += ui.yellow(text);
    } else if (keywords?.has(text)) {
      output += ui.bold(ui.accent(text));
    } else if (kind === "json" && line.slice(index + text.length).trimStart().startsWith(":")) {
      output += ui.accent(text);
    } else {
      output += text;
    }
    last = index + text.length;
  }
  return output + line.slice(last);
}

export function languageLabel(language: string): string {
  const value = language.trim();
  if (value.length === 0) return "teks";
  return value.length > 16 ? `${value.slice(0, 15)}…` : value;
}
