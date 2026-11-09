/**
 * Validator JSON Schema kecil untuk runtime: cukup untuk kontrak output tool
 * dan structured output provider, tanpa menambah dependensi baru.
 */
export function validateJsonSchema(value: unknown, schema: unknown, path = "$"): string[] {
  if (schema === undefined || schema === null || typeof schema !== "object") return [];
  const node = schema as Record<string, unknown>;
  const errors: string[] = [];
  const type = node.type;
  if (typeof type === "string") {
    const ok =
      type === "object"
        ? value !== null && typeof value === "object" && !Array.isArray(value)
        : type === "array"
          ? Array.isArray(value)
          : type === "string"
            ? typeof value === "string"
            : type === "number"
              ? typeof value === "number" && Number.isFinite(value)
              : type === "integer"
                ? Number.isInteger(value)
                : type === "boolean"
                  ? typeof value === "boolean"
                  : type === "null"
                    ? value === null
                    : true;
    if (!ok) {
      errors.push(`${path} harus ${type}`);
      return errors;
    }
  }
  if (Array.isArray(node.enum) && !node.enum.some((entry) => JSON.stringify(entry) === JSON.stringify(value))) {
    errors.push(`${path} tidak ada di enum`);
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const object = value as Record<string, unknown>;
    for (const key of (node.required as string[] | undefined) ?? []) {
      if (!(key in object)) errors.push(`${path}.${key} wajib ada`);
    }
    const properties = (node.properties ?? {}) as Record<string, unknown>;
    for (const [key, subschema] of Object.entries(properties)) {
      if (key in object) errors.push(...validateJsonSchema(object[key], subschema, `${path}.${key}`));
    }
    if (node.additionalProperties === false) {
      for (const key of Object.keys(object)) {
        if (!(key in properties)) errors.push(`${path}.${key} tidak diizinkan`);
      }
    }
  }
  if (Array.isArray(value) && node.items !== undefined) {
    value.forEach((item, index) => errors.push(...validateJsonSchema(item, node.items, `${path}[${index}]`)));
  }
  return errors;
}
