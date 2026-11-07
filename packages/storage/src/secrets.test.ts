import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SecretStore } from "./secrets.js";

const dirs: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "rann-secret-"));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("SecretStore", () => {
  it("menyimpan, membaca, dan menghapus secret", () => {
    const store = new SecretStore({ dir: tempDir() });
    const meta = store.set("openai", "sk-uji-123", "rann");
    expect(meta.provider).toBe("rann");
    expect(store.get("openai")).toBe("sk-uji-123");
    expect(store.list()).toHaveLength(1);
    expect(store.remove("openai")).toBe(true);
    expect(store.get("openai")).toBeUndefined();
  });

  it("tidak menulis nilai plaintext ke disk", () => {
    const dir = tempDir();
    const store = new SecretStore({ dir });
    store.set("token", "rahasia-sekali");
    const vault = readFileSync(join(dir, "vault.enc"), "utf8");
    expect(vault.includes("rahasia-sekali")).toBe(false);
  });

  it("mengganti nilai saat nama sama dipakai lagi", () => {
    const store = new SecretStore({ dir: tempDir() });
    store.set("kunci", "lama");
    const rotated = store.set("kunci", "baru");
    expect(rotated.rotated).toBeTruthy();
    expect(store.get("kunci")).toBe("baru");
    expect(store.list()).toHaveLength(1);
  });

  it("gagal mendekripsi bila master key berubah", () => {
    const dir = tempDir();
    const store = new SecretStore({ dir });
    store.set("kunci", "nilai");
    writeFileSync(join(dir, "master.key"), Buffer.alloc(32, 7), { mode: 0o600 });
    const lain = new SecretStore({ dir });
    expect(() => lain.get("kunci")).toThrow(/tidak bisa didekripsi/);
  });

  it("mode passphrase menurunkan kunci yang sama dari salt tersimpan", () => {
    const dir = tempDir();
    const first = new SecretStore({ dir, passphrase: "kalimat-rahasia" });
    first.set("api", "nilai-passphrase");
    const second = new SecretStore({ dir, passphrase: "kalimat-rahasia" });
    expect(second.get("api")).toBe("nilai-passphrase");
  });

  it("menolak nama dengan karakter aneh", () => {
    const store = new SecretStore({ dir: tempDir() });
    expect(() => store.set("../x", "y")).toThrow(/Nama secret tidak valid/);
  });
});
