export type TurnFailureAction = "retry" | "alternative" | "replan" | "continue";

/**
 * Pilihan eksplisit setelah turn gagal total (FR-007) atau tool gagal (FR-034).
 * Enter dianggap ulangi karena itu tindakan paling aman yang diminta user.
 */
export async function chooseTurnFailureAction(
  code: string | undefined,
  ask: (question: string) => Promise<string>
): Promise<TurnFailureAction> {
  if (code === "E_CANCELLED") return "continue";
  const answer = (await ask("Turn gagal. [r] ulangi, [a] pendekatan alternatif, [p] susun ulang rencana, [l] lanjut: "))
    .trim()
    .toLowerCase();
  if (answer === "" || answer.startsWith("r")) return "retry";
  if (answer.startsWith("a")) return "alternative";
  if (answer.startsWith("p")) return "replan";
  return "continue";
}
