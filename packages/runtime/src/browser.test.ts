import { createServer } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BrowserManager } from "./browser.js";

let server: ReturnType<typeof createServer>;
let base = "";

beforeAll(async () => {
  server = createServer((req, res) => {
    res.setHeader("content-type", "text/html");
    res.end(`<!doctype html><html><head><title>Uji</title></head><body>
      <h1 id="judul">Halo browser</h1>
      <input id="nama" /><button id="kirim" onclick="document.getElementById('hasil').textContent='Halo '+document.getElementById('nama').value">Kirim</button>
      <p id="hasil"></p></body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (address && typeof address === "object") base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("BrowserManager", () => {
  it("membuka halaman, mengisi form, klik, dan mengekstrak teks", async () => {
    const manager = new BrowserManager("/tmp", { headless: true, artifacts_dir: "/tmp/rann-browser-art" });
    const nav = await manager.perform("uji", { action: "navigate", url: base });
    expect(nav.title).toBe("Uji");
    await manager.perform("uji", { action: "type", selector: "#nama", text: "Rann" }, { mutating: true });
    await manager.perform("uji", { action: "click", selector: "#kirim" }, { mutating: true });
    const text = await manager.perform("uji", { action: "extract" });
    expect(String(text.text)).toContain("Halo Rann");
    const shot = await manager.perform("uji", { action: "screenshot" });
    expect(String(shot.artifact)).toContain("browser-");
    await manager.closeAll();
  }, 60_000);

  it("menolak domain sensitif dan skrip jaringan", async () => {
    const manager = new BrowserManager("/tmp", { blocked_domains: ["localhost"] });
    await expect(manager.perform("blok", { action: "navigate", url: "http://localhost:1" })).rejects.toMatchObject({ code: "E_PERMISSION" });
    await manager.closeAll();
  });

  it("AC-119 dua task memakai context terpisah dan cookie tidak bocor", async () => {
    const manager = new BrowserManager("/tmp", { headless: true, artifacts_dir: "/tmp/rann-browser-ctx" });
    try {
      await manager.perform("task-a", { action: "navigate", url: base });
      await manager.perform("task-a", { action: "evaluate", script: "document.cookie = 'sesi=a'; document.cookie" });
      await manager.perform("task-b", { action: "navigate", url: base });
      const cookie = await manager.perform("task-b", { action: "evaluate", script: "document.cookie" });
      expect(String(cookie.result)).not.toContain("sesi=a");
    } finally {
      await manager.closeAll();
    }
  }, 60_000);
});
