import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

function encodeTime(ms: number, length: number): string {
  let out = "";
  let value = ms;
  for (let i = 0; i < length; i += 1) {
    out = ALPHABET[value % 32]! + out;
    value = Math.floor(value / 32);
  }
  return out;
}

function encodeRandom(bytes: number): string {
  const buf = randomBytes(bytes);
  let out = "";
  for (const byte of buf) out += ALPHABET[byte % 32]!;
  return out;
}

export type IdPrefix =
  | "ses"
  | "turn"
  | "msg"
  | "task"
  | "plan"
  | "tool"
  | "req"
  | "evt"
  | "run"
  | "prof"
  | "prj"
  | "job"
  | "dev";

/**
 * ID berurutan waktu, 26 karakter setelah prefiks, aman untuk diurutkan
 * secara leksikografis dalam satu milidetik.
 */
export function newId(prefix: IdPrefix): string {
  return `${prefix}_${encodeTime(Date.now(), 10)}${encodeRandom(10)}`;
}

export function isId(value: string, prefix?: IdPrefix): boolean {
  const pattern = /^[a-z]{2,4}_[0-9a-hjkmnp-tv-z]{20}$/;
  if (!pattern.test(value)) return false;
  return prefix ? value.startsWith(`${prefix}_`) : true;
}
