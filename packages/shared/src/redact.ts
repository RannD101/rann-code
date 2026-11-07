const SECRET_KEY = /(api[-_]?key|apikey|access[-_]?token|refresh[-_]?token|token|password|passwd|secret|authorization|cookie|private[-_]?key)/i;
const SECRET_VALUE = /(sk-[A-Za-z0-9_-]{10,}|rd-[A-Za-z0-9_-]{10,}|Bearer\s+[A-Za-z0-9._~+/=-]{10,})/g;
const URL_CREDENTIALS = /(\b[a-z][a-z0-9+.-]*:\/\/)[^/\s:@]+:[^/\s@]+@/gi;

export function redactText(text: string): string {
  return text.replace(SECRET_VALUE, "[REDACTED]").replace(URL_CREDENTIALS, "$1[REDACTED]@");
}

export function redactSecrets(value: unknown): unknown {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map((item) => redactSecrets(item));
  if (value === null || typeof value !== "object") return value;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = SECRET_KEY.test(key) && item !== undefined && item !== null ? "[REDACTED]" : redactSecrets(item);
  }
  return out;
}
