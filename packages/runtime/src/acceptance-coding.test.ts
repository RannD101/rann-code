import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildProjectMap } from "./project-map.js";
import { reviewUnifiedDiff } from "./review.js";
import { executeTool } from "./tools/index.js";
import { runTurn, type AgentConfig } from "./agent.js";
import { createSession, createTurn, openDatabase } from "@rann/storage";
import { MockProvider } from "./providers/mock.js";

function repo(): string {
  const root = mkdtempSync(join(tmpdir(), "rann-ac-code-"));
  writeFileSync(join(root, "package.json"), JSON.stringify({ name: "uji", scripts: { test: "vitest", build: "tsc", lint: "eslint ." } }));
  writeFileSync(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\\n");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(join(root, "src", "index.ts"), "export const x = 1;\\n");
  return root;
}

describe("acceptance coding", () => {
  it("AC-040 memetakan repo 5.000 berkas di bawah 30 detik", () => {
    const root = repo();
    for (let dir = 0; dir < 50; dir += 1) {
      const path = join(root, "src", `d${dir}`);
      mkdirSync(path, { recursive: true });
      for (let file = 0; file < 100; file += 1) writeFileSync(join(path, `f${file}.ts`), "export const n = 1;\\n");
    }
    const started = Date.now();
    const map = buildProjectMap(root);
    expect(Date.now() - started).toBeLessThan(30_000);
    expect(map.package_manager).toBe("pnpm");
    expect(map.languages[0]?.name).toBe("TypeScript");
    expect(map.commands.build).toBe("pnpm build");
    expect(map.entry_points.length).toBeGreaterThan(0);
  }, 60_000);

  it("AC-048 review diff memuat path, baris, severity, dan saran", () => {
    const diff = [
      "diff --git a/src/a.ts b/src/a.ts",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,2 +1,3 @@",
      " const a = 1;",
      "+eval(input);",
      "+console.log(\"debug\");",
      " const b = 2;"
    ].join("\n");
    const result = reviewUnifiedDiff(diff);
    expect(result.findings.length).toBeGreaterThanOrEqual(2);
    for (const finding of result.findings) {
      expect(finding.path).toBe("src/a.ts");
      expect(finding.line).toBeGreaterThan(0);
      expect(["blocker", "major", "minor", "nit"]).toContain(finding.severity);
      expect(finding.suggestion.length).toBeGreaterThan(0);
    }
    expect(result.findings[0]?.severity).toBe("blocker");
  });

  it("AC-050 build terdeteksi dari lockfile dan exit code asli dilaporkan", async () => {
    const root = repo();
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({ name: "uji", scripts: { build: 'node -e "process.exit(3)"' } })
    );
    const map = buildProjectMap(root);
    expect(map.package_manager).toBe("pnpm");
    expect(map.commands.build).toBe("pnpm build");
    const result = await executeTool("package_run", { manager: "npm", args: ["run", "build"] }, {
      workspaceRoot: root,
      workspaceOnly: true,
      permissionMode: "trusted",
      approved: false
    });
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(3);
  }, 60_000);

  it("AC-051 baseline git mencatat diff awal dan tidak commit otomatis", async () => {
    const root = repo();
    const git = (args: string[]): string => execFileSync("git", args, { cwd: root, encoding: "utf8" });
    git(["init"]);
    git(["config", "user.email", "uji@contoh.test"]);
    git(["config", "user.name", "Uji"]);
    git(["add", "."]);
    git(["commit", "-m", "awal"]);
    writeFileSync(join(root, "src", "index.ts"), "export const x = 2;\n");
    const { db } = openDatabase({ path: join(root, "rann.db") });
    const session = createSession(db, { projectPath: root, model: "mock-1", permissionMode: "trusted" });
    const turn = createTurn(db, { sessionId: session.id });
    const agentConfig: AgentConfig = {
      permissionMode: "trusted",
      workspaceOnly: true,
      allow: [],
      deny: [],
      maxSteps: 2,
      systemExtra: ""
    };
    await runTurn({
      db,
      session,
      turnId: turn.id,
      userText: "halo",
      provider: new MockProvider(),
      model: "mock-1",
      workspaceRoot: root,
      checkpointsDir: join(root, ".rann", "checkpoints"),
      config: agentConfig
    });
    const logs = db.prepare("SELECT payload_json FROM events WHERE type = 'log'").all() as Array<{ payload_json: string }>;
    const baseline = logs.map((row) => JSON.parse(row.payload_json) as Record<string, unknown>).find((data) => data.event === "git.baseline");
    expect(baseline).toBeTruthy();
    expect(Number(baseline?.dirty_files)).toBeGreaterThanOrEqual(1);
    expect(git(["rev-list", "--count", "HEAD"]).trim()).toBe("1");
  }, 60_000);
});
