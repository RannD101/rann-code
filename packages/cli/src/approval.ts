/**
 * Format detail args untuk dialog izin. Batas 10.000 karakter membuat argumen
 * panjang (patch, skrip, payload) tidak terbaca, jadi dipakai batas 100.000
 * dengan penanda eksplisit saat masih terpotong.
 */
export function formatApprovalArgs(args: Record<string, unknown>, max = 100_000): string {
  const method = typeof args.method === "string" ? args.method : undefined;
  const target =
    typeof args.url === "string"
      ? args.url
      : typeof args.domain === "string"
        ? args.domain
        : typeof args.target === "string"
          ? args.target
          : undefined;
  if (method && target) return `${method} ${target}`;
  if (method) return `${method} ${JSON.stringify(args)}`;
  if (typeof args.command === "string") return args.command;
  const detail = JSON.stringify(args ?? {});
  if (detail.length <= max) return detail;
  return `${detail.slice(0, max)}\n... (${detail.length - max} karakter lagi, lihat log tool)`;
}
