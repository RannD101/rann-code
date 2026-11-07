import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";

const IGNORED = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".rann",
  ".next",
  ".nuxt",
  ".svelte-kit",
  "target",
  "vendor",
  ".venv",
  "venv",
  "__pycache__",
  ".mypy_cache",
  ".pytest_cache",
  ".turbo",
  ".cache"
]);

const LANGUAGES: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".mjs": "JavaScript",
  ".cjs": "JavaScript",
  ".py": "Python",
  ".go": "Go",
  ".rs": "Rust",
  ".java": "Java",
  ".kt": "Kotlin",
  ".kts": "Kotlin",
  ".swift": "Swift",
  ".php": "PHP",
  ".rb": "Ruby",
  ".cs": "C#",
  ".cpp": "C++",
  ".cc": "C++",
  ".c": "C",
  ".h": "C/C++",
  ".dart": "Dart",
  ".scala": "Scala",
  ".ex": "Elixir",
  ".exs": "Elixir",
  ".lua": "Lua",
  ".sh": "Shell",
  ".sql": "SQL",
  ".css": "CSS",
  ".scss": "CSS",
  ".html": "HTML",
  ".md": "Markdown"
};

const LOCKFILES: Array<[string, string]> = [
  ["pnpm-lock.yaml", "pnpm"],
  ["package-lock.json", "npm"],
  ["yarn.lock", "yarn"],
  ["bun.lockb", "bun"],
  ["bun.lock", "bun"],
  ["Cargo.lock", "cargo"],
  ["poetry.lock", "poetry"],
  ["uv.lock", "uv"],
  ["Pipfile.lock", "pipenv"],
  ["go.sum", "go"],
  ["composer.lock", "composer"],
  ["Gemfile.lock", "bundler"],
  ["mix.lock", "mix"]
];

export interface ProjectMap {
  version: 1;
  root: string;
  generated_at: string;
  file_count: number;
  truncated: boolean;
  languages: Array<{ name: string; files: number; share: number }>;
  package_manager: string | null;
  frameworks: string[];
  scripts: Record<string, string>;
  entry_points: string[];
  directories: Array<{ path: string; files: number }>;
  commands: Record<string, string | null>;
  assumptions: string[];
}

function walk(root: string, limit: number): { files: string[]; truncated: boolean } {
  const files: string[] = [];
  let truncated = false;
  const visit = (dir: string): void => {
    if (truncated) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= limit) {
        truncated = true;
        return;
      }
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (IGNORED.has(entry.name)) continue;
        visit(join(dir, entry.name));
      } else if (entry.isFile()) {
        files.push(join(dir, entry.name));
      }
    }
  };
  visit(root);
  return { files, truncated };
}

function readJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function scriptsFromPackage(root: string): Record<string, string> {
  const pkg = readJson(join(root, "package.json"));
  if (!pkg || typeof pkg.scripts !== "object" || pkg.scripts === null) return {};
  const scripts: Record<string, string> = {};
  for (const [name, value] of Object.entries(pkg.scripts as Record<string, unknown>)) {
    if (typeof value === "string") scripts[name] = value;
  }
  return scripts;
}

function detectFrameworks(root: string, scripts: Record<string, string>): string[] {
  const pkg = readJson(join(root, "package.json"));
  const deps: Record<string, unknown> = {};
  if (pkg) {
    for (const key of ["dependencies", "devDependencies", "peerDependencies"]) {
      const value = pkg[key];
      if (value && typeof value === "object") Object.assign(deps, value as Record<string, unknown>);
    }
  }
  const known: Array<[string, string]> = [
    ["next", "Next.js"],
    ["react", "React"],
    ["vue", "Vue"],
    ["svelte", "Svelte"],
    ["@angular/core", "Angular"],
    ["express", "Express"],
    ["fastify", "Fastify"],
    ["@nestjs/core", "NestJS"],
    ["vitest", "Vitest"],
    ["jest", "Jest"],
    ["playwright", "Playwright"]
  ];
  const found = known.filter(([name]) => name in deps).map(([, label]) => label);
  if (existsSync(join(root, "pyproject.toml")) || existsSync(join(root, "requirements.txt"))) {
    const text = `${readIf(join(root, "pyproject.toml"))}\n${readIf(join(root, "requirements.txt"))}`.toLowerCase();
    if (text.includes("fastapi")) found.push("FastAPI");
    if (text.includes("django")) found.push("Django");
    if (text.includes("flask")) found.push("Flask");
    if (text.includes("pytest")) found.push("pytest");
  }
  if (existsSync(join(root, "Cargo.toml"))) found.push("Cargo");
  if (existsSync(join(root, "go.mod"))) found.push("Go modules");
  if (Object.keys(scripts).length > 0) found.push("npm scripts");
  return [...new Set(found)];
}

function readIf(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function detectPackageManager(root: string): string | null {
  for (const [file, name] of LOCKFILES) {
    if (existsSync(join(root, file))) return name;
  }
  if (existsSync(join(root, "pyproject.toml"))) return "pip";
  return null;
}

function packageJsonEntry(root: string): string[] {
  const pkg = readJson(join(root, "package.json"));
  if (!pkg) return [];
  const out: string[] = [];
  for (const key of ["main", "module"]) {
    if (typeof pkg[key] === "string") out.push(pkg[key] as string);
  }
  if (typeof pkg.bin === "string") out.push(pkg.bin);
  if (pkg.bin && typeof pkg.bin === "object") {
    out.push(...Object.values(pkg.bin as Record<string, unknown>).filter((item): item is string => typeof item === "string"));
  }
  return out;
}

function detectEntryPoints(root: string): string[] {
  const candidates = [
    ...packageJsonEntry(root),
    "src/main.ts",
    "src/index.ts",
    "src/main.tsx",
    "src/index.tsx",
    "src/main.js",
    "src/index.js",
    "index.js",
    "main.py",
    "app.py",
    "manage.py",
    "cmd/main.go",
    "src/main.rs",
    "src/lib.rs"
  ];
  return [...new Set(candidates)].filter((path) => existsSync(join(root, path)));
}

function makeTargets(root: string): Set<string> {
  const file = join(root, "Makefile");
  if (!existsSync(file)) return new Set();
  try {
    const names = new Set<string>();
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = /^([A-Za-z0-9_.-]+)\s*:(?!=)/.exec(line);
      if (match?.[1] !== undefined) names.add(match[1]);
    }
    return names;
  } catch {
    return new Set();
  }
}

function detectCommands(manager: string | null, scripts: Record<string, string>, root: string): Record<string, string | null> {
  const make = makeTargets(root);
  const run = (name: string): string | null => {
    if (!(name in scripts)) return null;
    if (manager === "pnpm") return `pnpm ${name}`;
    if (manager === "yarn") return `yarn ${name}`;
    if (manager === "bun") return `bun run ${name}`;
    return `npm run ${name}`;
  };
  const out: Record<string, string | null> = {
    test: null,
    lint: null,
    build: null,
    typecheck: null
  };
  for (const name of ["test", "lint", "build", "typecheck", "type-check", "check"]) {
    const command = run(name);
    if (!command) continue;
    if (name === "check") {
      out.typecheck ??= command;
      out.test ??= command;
    } else if (name === "type-check") {
      out.typecheck ??= command;
    } else {
      out[name] = command;
    }
  }
  if (out.test === null) {
    if (existsSync(join(root, "pytest.ini")) || existsSync(join(root, "tests"))) out.test = "pytest -q";
    else if (existsSync(join(root, "go.mod"))) out.test = "go test ./...";
    else if (existsSync(join(root, "Cargo.toml"))) out.test = "cargo test";
  }
  if (out.lint === null) {
    if (existsSync(join(root, "ruff.toml")) || existsSync(join(root, ".ruff.toml"))) out.lint = "ruff check .";
    else if (existsSync(join(root, "go.mod"))) out.lint = "go vet ./...";
  }
  if (out.build === null) {
    if (existsSync(join(root, "Cargo.toml"))) out.build = "cargo build";
    else if (existsSync(join(root, "go.mod"))) out.build = "go build ./...";
  }
  for (const name of ["test", "lint", "build", "typecheck"] as const) {
    if (out[name] === null && make.has(name)) out[name] = `make ${name}`;
  }
  return out;
}

export function buildProjectMap(root: string, options: { maxFiles?: number } = {}): ProjectMap {
  const absolute = resolve(root);
  const { files, truncated } = walk(absolute, options.maxFiles ?? 20_000);
  const counts = new Map<string, number>();
  const dirCounts = new Map<string, number>();
  for (const file of files) {
    const language = LANGUAGES[extname(file).toLowerCase()];
    if (language) counts.set(language, (counts.get(language) ?? 0) + 1);
    const rel = relative(absolute, file);
    const first = rel.split(sep)[0] ?? ".";
    if (first !== rel) dirCounts.set(first, (dirCounts.get(first) ?? 0) + 1);
  }
  const total = [...counts.values()].reduce((sum, value) => sum + value, 0);
  const languages = [...counts.entries()]
    .map(([name, count]) => ({ name, files: count, share: total === 0 ? 0 : Math.round((count / total) * 1000) / 10 }))
    .sort((a, b) => b.files - a.files);
  const packageManager = detectPackageManager(absolute);
  const scripts = scriptsFromPackage(absolute);
  const assumptions: string[] = [];
  if (packageManager === null) assumptions.push("Package manager tidak terdeteksi dari lockfile.");
  if (files.length === 0) assumptions.push("Tidak ada berkas yang bisa dipindai.");
  if (truncated) assumptions.push("Pemindaian dipotong karena batas jumlah berkas.");
  if (scripts.test === undefined && existsSync(join(absolute, "tests"))) assumptions.push("Perintah test ditebak dari folder tests.");

  return {
    version: 1,
    root: absolute,
    generated_at: new Date().toISOString(),
    file_count: files.length,
    truncated,
    languages,
    package_manager: packageManager,
    frameworks: detectFrameworks(absolute, scripts),
    scripts,
    entry_points: detectEntryPoints(absolute),
    directories: [...dirCounts.entries()]
      .map(([path, count]) => ({ path, files: count }))
      .sort((a, b) => b.files - a.files)
      .slice(0, 30),
    commands: detectCommands(packageManager, scripts, absolute),
    assumptions
  };
}

export function loadProjectMap(root: string, options: { maxAgeMs?: number } = {}): ProjectMap | null {
  const path = join(root, ".rann", "project-map.json");
  if (!existsSync(path)) return null;
  try {
    const map = JSON.parse(readFileSync(path, "utf8")) as ProjectMap;
    if (map.version !== 1 || typeof map.generated_at !== "string") return null;
    const age = Date.now() - Date.parse(map.generated_at);
    if (options.maxAgeMs !== undefined && age > options.maxAgeMs) return null;
    return map;
  } catch {
    return null;
  }
}

export function saveProjectMap(root: string, map: ProjectMap): string {
  const dir = join(root, ".rann");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "project-map.json");
  writeFileSync(path, JSON.stringify(map, null, 2), "utf8");
  return path;
}

export function ensureProjectMap(root: string, options: { refresh?: boolean; maxAgeMs?: number } = {}): ProjectMap {
  const existing = options.refresh ? null : loadProjectMap(root, { maxAgeMs: options.maxAgeMs ?? 24 * 60 * 60 * 1000 });
  if (existing) return existing;
  const map = buildProjectMap(root);
  saveProjectMap(root, map);
  return map;
}

export function projectMapSummary(map: ProjectMap): string {
  const languages = map.languages.slice(0, 5).map((item) => `${item.name} ${item.share}%`).join(", ");
  return [
    `root: ${map.root}`,
    `berkas: ${map.file_count}${map.truncated ? " (dipotong)" : ""}`,
    `bahasa: ${languages || "tidak diketahui"}`,
    `package manager: ${map.package_manager ?? "tidak diketahui"}`,
    `framework: ${map.frameworks.join(", ") || "tidak diketahui"}`,
    `entry point: ${map.entry_points.join(", ") || "tidak diketahui"}`,
    `test: ${map.commands.test ?? "tidak diketahui"}`,
    `build: ${map.commands.build ?? "tidak diketahui"}`,
    `lint: ${map.commands.lint ?? "tidak diketahui"}`
  ].join("\n");
}
