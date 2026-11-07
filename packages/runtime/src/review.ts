export type ReviewSeverity = "blocker" | "major" | "minor" | "nit";
export type ReviewConfidence = "confirmed" | "suspected";
export type ReviewCategory = "bug" | "security" | "performance" | "style";

export interface ReviewFinding {
  path: string;
  line: number;
  severity: ReviewSeverity;
  category: ReviewCategory;
  confidence: ReviewConfidence;
  message: string;
  suggestion: string;
}

export interface ReviewResult {
  findings: ReviewFinding[];
  confirmed: ReviewFinding[];
  suspected: ReviewFinding[];
  counts: Record<ReviewSeverity, number>;
  files: number;
}

interface Rule {
  pattern: RegExp;
  severity: ReviewSeverity;
  category: ReviewCategory;
  confidence: ReviewConfidence;
  message: string;
  suggestion: string;
}

const RULES: Rule[] = [
  { pattern: /\beval\s*\(/, severity: "blocker", category: "security", confidence: "confirmed", message: "eval menjalankan string sebagai kode dan membuka eksekusi arbitrer.", suggestion: "Ganti dengan parser atau pemetaan fungsi eksplisit." },
  { pattern: /new\s+Function\s*\(/, severity: "blocker", category: "security", confidence: "confirmed", message: "new Function membangun kode saat runtime dari input.", suggestion: "Pakai fungsi statis atau whitelist operasi." },
  { pattern: /\.innerHTML\s*=/, severity: "major", category: "security", confidence: "confirmed", message: "Penulisan innerHTML membuka XSS bila isi berasal dari input.", suggestion: "Pakai textContent atau sanitasi dengan allowlist." },
  { pattern: /(password|secret|token|api[_-]?key)\s*[:=]\s*["'][^"']{8,}["']/i, severity: "blocker", category: "security", confidence: "confirmed", message: "Kredensial tampak ditulis langsung di kode.", suggestion: "Baca dari env atau secret store dan rotasi nilai yang bocor." },
  { pattern: /catch\s*(?:\([^)]*\))?\s*\{\s*\}/, severity: "major", category: "bug", confidence: "confirmed", message: "Catch kosong menelan error tanpa jejak.", suggestion: "Catat error atau lempar ulang dengan konteks." },
  { pattern: /\.only\s*\(/, severity: "blocker", category: "bug", confidence: "confirmed", message: "Test focus .only melewati sisa suite.", suggestion: "Hapus .only sebelum commit." },
  { pattern: /TODO|FIXME/, severity: "minor", category: "style", confidence: "confirmed", message: "Catatan TODO atau FIXME masuk ke perubahan.", suggestion: "Selesaikan atau ubah menjadi issue yang dilacak." },
  { pattern: /:\s*any\b|\bas\s+any\b/, severity: "minor", category: "style", confidence: "confirmed", message: "Tipe any mematikan pemeriksaan TypeScript.", suggestion: "Pakai tipe konkret atau unknown dengan penyempitan." },
  { pattern: /console\.(log|debug)\s*\(/, severity: "nit", category: "style", confidence: "confirmed", message: "Log debug tertinggal di kode.", suggestion: "Hapus atau pakai logger yang bisa dimatikan." },
  { pattern: /==(?!=)/, severity: "minor", category: "bug", confidence: "suspected", message: "Perbandingan longgar bisa memicu koersi tipe.", suggestion: "Pakai === kecuali koersi memang disengaja." },
  { pattern: /JSON\.parse\s*\(/, severity: "minor", category: "bug", confidence: "suspected", message: "JSON.parse tanpa penanganan error dapat melempar saat input rusak.", suggestion: "Bungkus dengan try/catch dan validasi bentuk hasil." },
  { pattern: /while\s*\(\s*true\s*\)/, severity: "major", category: "bug", confidence: "suspected", message: "Loop tanpa kondisi keluar eksplisit berisiko menggantung.", suggestion: "Tambahkan batas iterasi atau sinyal pembatalan." },
  { pattern: /await\s+/, severity: "minor", category: "performance", confidence: "suspected", message: "Await di dalam blok berulang dapat membuat eksekusi berurutan.", suggestion: "Pastikan urutan memang dibutuhkan; jika tidak, pakai Promise.all dengan batas konkurensi." },
  { pattern: /\.exec\s*\(|child_process/, severity: "major", category: "security", confidence: "suspected", message: "Eksekusi proses perlu validasi input dan allowlist perintah.", suggestion: "Hindari shell string; pakai argumen array dan tolak input bebas." },
  { pattern: /\$\{[^}]*\}/, severity: "major", category: "security", confidence: "suspected", message: "Interpolasi nilai ke query atau perintah berisiko injeksi.", suggestion: "Pakai parameter terikat atau escaping yang sesuai konteks." }
];

const SEVERITY_ORDER: Record<ReviewSeverity, number> = { blocker: 0, major: 1, minor: 2, nit: 3 };

function addedLines(diff: string): Array<{ path: string; line: number; text: string }> {
  const out: Array<{ path: string; line: number; text: string }> = [];
  let path = "";
  let newLine = 0;
  let inHunk = false;
  for (const raw of diff.split(/\r?\n/)) {
    if (raw.startsWith("+++ b/")) {
      path = raw.slice(6);
      inHunk = false;
      continue;
    }
    if (raw.startsWith("+++ ")) {
      path = raw.slice(4).replace(/^b\//, "");
      inHunk = false;
      continue;
    }
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk?.[1] !== undefined) {
      newLine = Number(hunk[1]);
      inHunk = true;
      continue;
    }
    if (!inHunk || path.length === 0) continue;
    if (raw.startsWith("+")) {
      out.push({ path, line: newLine, text: raw.slice(1) });
      newLine += 1;
    } else if (raw.startsWith(" ")) {
      newLine += 1;
    }
  }
  return out;
}

export function reviewUnifiedDiff(diff: string): ReviewResult {
  const findings: ReviewFinding[] = [];
  const seen = new Set<string>();
  const files = new Set<string>();
  for (const item of addedLines(diff)) {
    files.add(item.path);
    for (const rule of RULES) {
      if (!rule.pattern.test(item.text)) continue;
      const key = `${item.path}:${item.line}:${rule.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push({
        path: item.path,
        line: item.line,
        severity: rule.severity,
        category: rule.category,
        confidence: rule.confidence,
        message: rule.message,
        suggestion: rule.suggestion
      });
    }
  }
  findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.path.localeCompare(b.path) || a.line - b.line);
  const counts: Record<ReviewSeverity, number> = { blocker: 0, major: 0, minor: 0, nit: 0 };
  for (const finding of findings) counts[finding.severity] += 1;
  return {
    findings,
    confirmed: findings.filter((finding) => finding.confidence === "confirmed"),
    suspected: findings.filter((finding) => finding.confidence === "suspected"),
    counts,
    files: files.size
  };
}

export function formatReview(result: ReviewResult): string {
  if (result.findings.length === 0) return "Tidak ada temuan pada baris yang ditambahkan.";
  const lines: string[] = [];
  lines.push(`Temuan: ${result.counts.blocker} blocker, ${result.counts.major} major, ${result.counts.minor} minor, ${result.counts.nit} nit (${result.files} berkas).`);
  for (const label of ["confirmed", "suspected"] as const) {
    const items = label === "confirmed" ? result.confirmed : result.suspected;
    if (items.length === 0) continue;
    lines.push("", label === "confirmed" ? "Temuan pasti:" : "Dugaan:");
    for (const item of items) {
      lines.push(`- ${item.path}:${item.line} [${item.severity}/${item.category}] ${item.message} Saran: ${item.suggestion}`);
    }
  }
  return lines.join("\n");
}
