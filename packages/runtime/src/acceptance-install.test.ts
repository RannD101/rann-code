import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SkillStore } from "./skills.js";

describe("instalasi skill HTTPS", () => {
  it("AC-084 checksum benar diterima dan checksum salah ditolak", async () => {
    const work = mkdtempSync(join(tmpdir(), "rann-ac-install-"));
    const source = join(work, "sumber");
    mkdirSync(source, { recursive: true });
    writeFileSync(join(source, "SKILL.md"), "---\nname: jaringan\ndescription: Gunakan saat menguji instalasi HTTPS\nversion: 1.0.0\n---\nLangkah yang cukup panjang untuk validasi skill.\n");
    const archive = join(work, "skill.tgz");
    execFileSync("tar", ["-czf", archive, "-C", source, "."]);
    const hash = createHash("sha256").update(readFileSync(archive)).digest("hex");
    const key = join(work, "key.pem");
    const cert = join(work, "cert.pem");
    execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "1", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" });
    const serverScript = join(work, "server.cjs");
    writeFileSync(
      serverScript,
      `const https=require("node:https"),fs=require("node:fs");const [key,cert,file]=process.argv.slice(2);const server=https.createServer({key:fs.readFileSync(key),cert:fs.readFileSync(cert)},(req,res)=>{res.writeHead(200,{"content-type":"application/gzip"});res.end(fs.readFileSync(file));});server.listen(0,"127.0.0.1",()=>console.log(server.address().port));`
    );
    const child = spawn(process.execPath, [serverScript, key, cert, archive], { stdio: ["ignore", "pipe", "inherit"] });
    const port = await new Promise<number>((resolve, reject) => {
      child.stdout.on("data", (chunk) => resolve(Number(String(chunk).trim())));
      child.on("error", reject);
    });
    process.env.CURL_CA_BUNDLE = cert;
    try {
      const store = new SkillStore(join(work, "profil"), join(work, "proyek"));
      const installed = store.install(`https://127.0.0.1:${port}/skill.tgz#sha256=${hash}`, { approve: true, scope: "project" });
      expect(installed.name).toBe("jaringan");
      const target = new SkillStore(join(work, "profil2"), join(work, "proyek2"));
      expect(() => target.install(`https://127.0.0.1:${port}/skill.tgz#sha256=${"0".repeat(64)}`, { approve: true, scope: "project" })).toThrow(/Checksum/);
    } finally {
      delete process.env.CURL_CA_BUNDLE;
      child.kill("SIGKILL");
    }
  }, 60_000);
});
