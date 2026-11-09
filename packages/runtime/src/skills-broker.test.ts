import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SkillStore } from "./skills.js";

const SCRIPT = `#!/usr/bin/env node
const http = require("node:http");
const body = JSON.stringify({ tool: "fs_read", args: { path: "catatan.txt" } });
const request = http.request(
  {
    socketPath: process.env.RANN_TOOL_BROKER_SOCKET,
    path: "/tool",
    method: "POST",
    headers: {
      authorization: "Bearer " + process.env.RANN_TOOL_BROKER_TOKEN,
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body)
    }
  },
  (response) => {
    let data = "";
    response.on("data", (chunk) => (data += chunk));
    response.on("end", () => {
      process.stdout.write(data);
    });
  }
);
request.on("error", (error) => {
  process.stderr.write(String(error.message));
  process.exit(1);
});
request.end(body);
`;

describe("broker tool untuk skrip skill", () => {
  it("meneruskan panggilan tool dari skrip dan mengembalikan hasilnya", async () => {
    const project = mkdtempSync(join(tmpdir(), "rann-skill-broker-"));
    const store = new SkillStore(join(project, "profile"), project);
    store.create({ name: "broker", description: "Skill menguji broker tool", body: "Jalankan skrip dan pakai broker tool untuk membaca berkas.", scope: "project" });
    const scripts = join(project, ".rann", "skills", "broker", "scripts");
    mkdirSync(scripts, { recursive: true });
    writeFileSync(join(scripts, "panggil.js"), SCRIPT, { mode: 0o755 });
    writeFileSync(join(project, "catatan.txt"), "isi catatan");

    const calls: Array<{ tool: string; args: unknown }> = [];
    const result = await store.runScript("broker", "panggil.js", [], {
      broker: async (tool, args) => {
        calls.push({ tool, args });
        return { content: "isi catatan" };
      }
    });
    expect(result.ok).toBe(true);
    expect(calls).toEqual([{ tool: "fs_read", args: { path: "catatan.txt" } }]);
    expect(result.stdout).toContain("isi catatan");
  });

  it("menolak token broker yang salah", async () => {
    const project = mkdtempSync(join(tmpdir(), "rann-skill-broker-"));
    const store = new SkillStore(join(project, "profile"), project);
    store.create({ name: "broker", description: "Skill menguji broker tool", body: "Jalankan skrip dan pakai broker tool untuk membaca berkas.", scope: "project" });
    const scripts = join(project, ".rann", "skills", "broker", "scripts");
    mkdirSync(scripts, { recursive: true });
    const bad = SCRIPT.replace('process.env.RANN_TOOL_BROKER_TOKEN', '"salah"');
    writeFileSync(join(scripts, "salah.js"), bad, { mode: 0o755 });
    const result = await store.runScript("broker", "salah.js", [], { broker: async () => "tidak boleh" });
    expect(result.ok).toBe(true);
    expect(result.stdout).toContain("token broker tidak valid");
  });
});
