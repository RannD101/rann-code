/**
 * Bikin paket rilis tunggal: satu berkas ESM berisi CLI, daemon, runtime,
 * storage, dan shared. Dependensi pihak ketiga tetap eksternal supaya
 * better-sqlite3 memakai binary native yang cocok dengan mesin pengguna.
 *
 * Pakai: node scripts/build-release.mjs <versi>
 * Hasil: dist-release/rann-code-<versi>.tgz
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync } from "node:fs";
import { join, resolve } from "node:path";

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("Pakai: node scripts/build-release.mjs <versi, misal 1.0.0>");
  process.exit(2);
}

const root = resolve(import.meta.dirname, "..");
const outDir = join(root, "dist-release");
const workDir = join(outDir, `rann-code-${version}`);
const esbuild = join(root, "node_modules/.pnpm/esbuild@0.21.5/node_modules/esbuild/bin/esbuild");

rmSync(workDir, { recursive: true, force: true });
mkdirSync(join(workDir, "dist"), { recursive: true });

const common = [
  "--bundle",
  "--platform=node",
  "--target=node22",
  "--format=esm",
  "--external:better-sqlite3",
  "--external:ws",
  "--external:croner",
  "--external:zod",
  "--external:smol-toml",
  "--external:@noble/ciphers/chacha.js",
  "--external:yaml",
  "--external:playwright",
  "--legal-comments=none"
];

execFileSync(esbuild, [...common, join(root, "packages/cli/src/main.ts"), `--outfile=${join(workDir, "dist/main.js")}`], {
  stdio: "inherit"
});
execFileSync(esbuild, [...common, join(root, "packages/cli/src/daemon-main.ts"), `--outfile=${join(workDir, "dist/daemon-main.js")}`], {
  stdio: "inherit"
});

for (const file of ["main.js", "daemon-main.js"]) chmodSync(join(workDir, "dist", file), 0o755);

const manifest = {
  name: "rann-code",
  version,
  description: "Rann Code, autonomous coding agent CLI dengan daemon persisten",
  license: "MIT",
  type: "module",
  bin: { rann: "./dist/main.js", rannd: "./dist/daemon-main.js" },
  files: ["dist"],
  engines: { node: ">=22.11.0" },
  dependencies: JSON.parse(readFileSync(join(root, "package.json"), "utf8")).releaseDependencies
};
if (!manifest.dependencies) {
  console.error("package.json belum punya releaseDependencies");
  process.exit(2);
}
writeFileSync(join(workDir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);

execFileSync("npm", ["pack", "--pack-destination", outDir], { cwd: workDir, stdio: "inherit" });
console.log(`selesai: ${join(outDir, `rann-code-${version}.tgz`)}`);
