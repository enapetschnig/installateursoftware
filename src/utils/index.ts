/** Klassennamen bedingt zusammenführen. */
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

/** Fortschritt (0–100) aus Pipeline-Stufe berechnen. */
export function stageProgress(stageIndex: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round(((stageIndex + 1) / total) * 100);
}
