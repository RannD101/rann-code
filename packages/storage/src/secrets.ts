import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { randomBytes, scryptSync } from "node:crypto";
import { join } from "node:path";
import { xchacha20poly1305 } from "@noble/ciphers/chacha.js";
import { RannError } from "@rann/shared";

export interface SecretMeta {
  id: string;
  name: string;
  provider?: string;
  created: string;
  rotated?: string;
  lastUsed?: string;
}

interface VaultEntry extends SecretMeta {
  nonce: string;
  ciphertext: string;
}

interface VaultFile {
  version: 1;
  entries: VaultEntry[];
}

export interface SecretStoreOptions {
  dir: string;
  passphrase?: string;
  keychain?: boolean;
  account?: string;
}

function keychainRead(account: string): Uint8Array | null {
  try {
    if (process.platform === "darwin") {
      const value = execFileSync("security", ["find-generic-password", "-s", "rann-code", "-a", account, "-w"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      return value ? new Uint8Array(Buffer.from(value, "base64")) : null;
    }
    if (process.platform === "linux") {
      const value = execFileSync("secret-tool", ["lookup", "service", "rann-code", "account", account], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
      return value ? new Uint8Array(Buffer.from(value, "base64")) : null;
    }
  } catch {
    return null;
  }
  return null;
}

function keychainWrite(account: string, key: Uint8Array): boolean {
  const encoded = Buffer.from(key).toString("base64");
  try {
    if (process.platform === "darwin") {
      execFileSync("security", ["add-generic-password", "-U", "-s", "rann-code", "-a", account, "-w", encoded], { stdio: "ignore" });
      return true;
    }
    if (process.platform === "linux") {
      execFileSync("secret-tool", ["store", "--label", "Rann Code master key", "service", "rann-code", "account", account], { input: encoded, stdio: ["pipe", "ignore", "ignore"] });
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

/**
 * Vault lokal dengan XChaCha20-Poly1305. Kunci utama 32 byte disimpan di
 * master.key mode 0600, atau diturunkan dengan scrypt bila passphrase diberikan.
 */
export class SecretStore {
  private readonly dir: string;
  private readonly vaultPath: string;
  private key: Uint8Array;

  constructor(options: SecretStoreOptions) {
    this.dir = options.dir;
    this.vaultPath = join(this.dir, "vault.enc");
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    this.key = options.passphrase ? this.keyFromPassphrase(options.passphrase) : this.keyFromKeychainOrFile(options.keychain !== false, options.account ?? "default");
  }

  private keyFromKeychainOrFile(useKeychain: boolean, account: string): Uint8Array {
    const filePath = join(this.dir, "master.key");
    const vaultExists = existsSync(this.vaultPath);
    if (vaultExists && existsSync(filePath)) return this.keyFromFile();
    if (vaultExists && !existsSync(filePath)) {
      const fromKeychainOnly = useKeychain ? keychainRead(account) : null;
      if (fromKeychainOnly) {
        if (fromKeychainOnly.length !== 32) throw new RannError("E_CONFIG_INVALID", "Master key dari keychain OS bukan 32 byte");
        return fromKeychainOnly;
      }
      throw new RannError("E_PROVIDER_AUTH", "Vault ada tetapi master key hilang. Pulihkan master.key dari backup, atau set RANN_SECRET_PASSPHRASE bila memakai passphrase. Jangan membuat master.key baru karena isi vault tidak bisa didekripsi.");
    }
    if (useKeychain) {
      const fromKeychain = keychainRead(account);
      if (fromKeychain) {
        if (fromKeychain.length !== 32) throw new RannError("E_CONFIG_INVALID", "Master key dari keychain OS bukan 32 byte");
        return fromKeychain;
      }
      if (!vaultExists && !existsSync(filePath)) {
        const generated = new Uint8Array(randomBytes(32));
        if (keychainWrite(account, generated)) return generated;
      }
    }
    return this.keyFromFile();
  }

  private keyFromFile(): Uint8Array {
    const path = join(this.dir, "master.key");
    if (!existsSync(path)) {
      const key = randomBytes(32);
      writeFileSync(path, key, { mode: 0o600 });
      return new Uint8Array(key);
    }
    const key = readFileSync(path);
    if (key.length !== 32) throw new RannError("E_CONFIG_INVALID", `master.key harus 32 byte: ${path}`);
    return new Uint8Array(key);
  }

  private keyFromPassphrase(passphrase: string): Uint8Array {
    const saltPath = join(this.dir, "salt.bin");
    const salt = existsSync(saltPath) ? readFileSync(saltPath) : randomBytes(16);
    if (!existsSync(saltPath)) writeFileSync(saltPath, salt, { mode: 0o600 });
    return new Uint8Array(scryptSync(passphrase, salt, 32, { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 }));
  }

  private read(): VaultFile {
    if (!existsSync(this.vaultPath)) return { version: 1, entries: [] };
    try {
      const parsed = JSON.parse(readFileSync(this.vaultPath, "utf8")) as VaultFile;
      if (parsed.version !== 1 || !Array.isArray(parsed.entries)) throw new Error("format vault tidak dikenal");
      return parsed;
    } catch (error) {
      throw new RannError("E_STORAGE", `Vault secret tidak bisa dibaca: ${(error as Error).message}`, { cause: error });
    }
  }

  private write(vault: VaultFile): void {
    const temp = `${this.vaultPath}.tmp`;
    writeFileSync(temp, JSON.stringify(vault), { mode: 0o600 });
    chmodSync(temp, 0o600);
    renameSync(temp, this.vaultPath);
  }

  private encrypt(value: string): { nonce: string; ciphertext: string } {
    const nonce = randomBytes(24);
    const cipher = xchacha20poly1305(this.key, nonce);
    return {
      nonce: Buffer.from(nonce).toString("base64"),
      ciphertext: Buffer.from(cipher.encrypt(new TextEncoder().encode(value))).toString("base64")
    };
  }

  private decrypt(entry: VaultEntry): string {
    try {
      const cipher = xchacha20poly1305(this.key, Buffer.from(entry.nonce, "base64"));
      return new TextDecoder().decode(cipher.decrypt(Buffer.from(entry.ciphertext, "base64")));
    } catch (error) {
      throw new RannError("E_PROVIDER_AUTH", `Secret ${entry.name} tidak bisa didekripsi. Kunci utama berubah?`, { cause: error });
    }
  }

  set(name: string, value: string, provider?: string): SecretMeta {
    if (!/^[a-zA-Z0-9._-]+$/.test(name)) throw new RannError("E_INVALID_PARAMS", `Nama secret tidak valid: ${name}`);
    if (value.length === 0) throw new RannError("E_INVALID_PARAMS", "Nilai secret kosong");
    const vault = this.read();
    const now = new Date().toISOString();
    const existing = vault.entries.find((entry) => entry.name === name);
    const encrypted = this.encrypt(value);
    if (existing) {
      existing.nonce = encrypted.nonce;
      existing.ciphertext = encrypted.ciphertext;
      existing.rotated = now;
      if (provider) existing.provider = provider;
      this.write(vault);
      return this.meta(existing);
    }
    const entry: VaultEntry = {
      id: `sec_${randomBytes(8).toString("hex")}`,
      name,
      ...(provider ? { provider } : {}),
      created: now,
      ...encrypted
    };
    vault.entries.push(entry);
    this.write(vault);
    return this.meta(entry);
  }

  get(name: string): string | undefined {
    const vault = this.read();
    const entry = vault.entries.find((item) => item.name === name);
    if (!entry) return undefined;
    entry.lastUsed = new Date().toISOString();
    this.write(vault);
    return this.decrypt(entry);
  }

  has(name: string): boolean {
    return this.read().entries.some((entry) => entry.name === name);
  }

  list(): SecretMeta[] {
    return this.read().entries.map((entry) => this.meta(entry));
  }

  exportEncrypted(destination: string): string {
    if (!existsSync(this.vaultPath)) throw new RannError("E_NOT_FOUND", "Vault belum berisi secret");
    copyFileSync(this.vaultPath, destination);
    chmodSync(destination, 0o600);
    return destination;
  }

  rotateMasterKey(): void {
    const vault = this.read();
    const oldKey = this.key;
    const next = new Uint8Array(randomBytes(32));
    const plain: Array<{ entry: VaultEntry; value: string }> = [];
    for (const entry of vault.entries) {
      const cipher = xchacha20poly1305(oldKey, Buffer.from(entry.nonce, "base64"));
      plain.push({ entry, value: new TextDecoder().decode(cipher.decrypt(Buffer.from(entry.ciphertext, "base64"))) });
    }
    const temp = join(this.dir, "master.key.next");
    writeFileSync(temp, next, { mode: 0o600 });
    const previousKey = join(this.dir, "master.key.bak");
    const currentKey = join(this.dir, "master.key");
    if (existsSync(currentKey)) copyFileSync(currentKey, previousKey);
    renameSync(temp, currentKey);
    this.key = next;
    for (const item of plain) {
      const encrypted = this.encrypt(item.value);
      item.entry.nonce = encrypted.nonce;
      item.entry.ciphertext = encrypted.ciphertext;
      item.entry.rotated = new Date().toISOString();
    }
    this.write(vault);
  }

  remove(name: string): boolean {
    const vault = this.read();
    const before = vault.entries.length;
    vault.entries = vault.entries.filter((entry) => entry.name !== name);
    if (vault.entries.length === before) return false;
    this.write(vault);
    return true;
  }

  private meta(entry: VaultEntry): SecretMeta {
    return {
      id: entry.id,
      name: entry.name,
      ...(entry.provider ? { provider: entry.provider } : {}),
      created: entry.created,
      ...(entry.rotated ? { rotated: entry.rotated } : {}),
      ...(entry.lastUsed ? { lastUsed: entry.lastUsed } : {})
    };
  }
}
