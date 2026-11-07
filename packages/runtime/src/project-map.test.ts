import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildProjectMap, ensureProjectMap, loadProjectMap, saveProjectMap } from "./project-map.js";

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), "rann-map-"));
  writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: 9\n", "utf8");
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({
      name: "contoh",
      main: "src/index.ts",
      scripts: { test: "vitest run", build: "tsc -p tsconfig.json", lint: "eslint ." },
      dependencies: { fastify: "^5.0.0" },
      devDependencies: { vitest: "^2.0.0" }
    }),
    "utf8"
  );
  mkdirSync(join(root, "src", "fitur"), { recursive: true });
  writeFileSync(join(root, "src", "index.ts"), "export const x = 1;\n", "utf8");
  writeFileSync(join(root, "src", "fitur", "a.ts"), "export const a = 1;\n", "utf8");
  writeFileSync(join(root, "README.md"), "# contoh\n", "utf8");
  mkdirSync(join(root, "node_modules", "palsu"), { recursive: true });
  writeFileSync(join(root, "node_modules", "palsu", "index.js"), "x", "utf8");
  return root;
}

describe("project map", () => {
  it("mendeteksi bahasa, package manager, perintah, dan entry point", () => {
    const root = repo();
    const map = buildProjectMap(root);
    expect(map.package_manager).toBe("pnpm");
    expect(map.languages[0]?.name).toBe("TypeScript");
    expect(map.languages.find((item) => item.name === "JavaScript")).toBeUndefined();
    expect(map.commands.test).toBe("pnpm test");
    expect(map.commands.build).toBe("pnpm build");
    expect(map.commands.lint).toBe("pnpm lint");
    expect(map.entry_points).toContain("src/index.ts");
    expect(map.frameworks).toContain("Fastify");
    expect(map.directories.find((item) => item.path === "src")?.files).toBe(2);
  });

  it("menyimpan dan memuat peta, lalu membangun ulang saat refresh", () => {
    const root = repo();
    const map = buildProjectMap(root);
    const path = saveProjectMap(root, map);
    expect(path.endsWith(join(".rann", "project-map.json"))).toBe(true);
    expect(loadProjectMap(root)?.file_count).toBe(map.file_count);
    expect(ensureProjectMap(root).generated_at).toBe(map.generated_at);

    writeFileSync(join(root, "src", "baru.ts"), "export const b = 2;\n", "utf8");
    const refreshed = ensureProjectMap(root, { refresh: true });
    expect(refreshed.file_count).toBe(map.file_count + 1);
  });

  it("mencatat asumsi saat lockfile tidak ada", () => {
    const root = mkdtempSync(join(tmpdir(), "rann-map-kosong-"));
    const map = buildProjectMap(root);
    expect(map.package_manager).toBeNull();
    expect(map.assumptions.length).toBeGreaterThan(0);
  });
});
