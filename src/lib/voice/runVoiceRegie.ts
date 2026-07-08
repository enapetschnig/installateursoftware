// ============================================================
// Installateursoftware – Sprach-Regiebericht: reiner Runner
//
// Nimmt ein bereits transkribiertes Diktat entgegen, schickt es an die
// KI (aiComplete → /api/ai/chat, JSON-Modus) und liefert ein strukturiertes
// RegieParseResult. Bewusst OHNE React/DOM → testbar, 1:1-Analogie zum
// bewährten runVoiceAngebot. Die Aufnahme + Transkription macht die UI
// (InlineMicButton → transcribeAudio); dieser Runner ist nur der Parse-Teil.
// ============================================================
import { aiComplete as defaultAiComplete, type AiCompleteOpts, type AiCompleteResult } from "../ai/aiComplete";
import { parseJsonResponse as defaultParseJson } from "../ai/parseJson";
import { regieParsePrompt, type RegieParseResult } from "../ai/prompts/regiebericht";
import type { RegieMaterial } from "../regie";

export type RunVoiceRegieArgs = {
  text: string;         // transkribiertes Diktat
  firmaName?: string;   // für den mandantenfähigen Prompt
};

export type RunVoiceRegieDeps = {
  aiComplete?: (opts: AiCompleteOpts) => Promise<AiCompleteResult>;
  parseJsonResponse?: <T = unknown>(raw: string) => T;
};

/** Diktat-Text → strukturierter Regiebericht (KI, JSON). Wirft bei leerem Text/AI-Fehler. */
export async function runVoiceRegie(
  args: RunVoiceRegieArgs,
  deps: RunVoiceRegieDeps = {},
): Promise<RegieParseResult> {
  const aiComplete = deps.aiComplete ?? defaultAiComplete;
  const parseJsonResponse = deps.parseJsonResponse ?? defaultParseJson;

  const text = (args.text || "").trim();
  if (!text) throw new Error("Kein Text zum Auswerten vorhanden.");

  const result = await aiComplete({
    systemPrompt: regieParsePrompt(args.firmaName ?? ""),
    userMessage: text,
    maxTokens: 2000,
    responseFormat: "json",
  });

  const parsed = parseJsonResponse<RegieParseResult>(result.text);
  return {
    beschreibung: typeof parsed?.beschreibung === "string" ? parsed.beschreibung.trim() : "",
    kunde_name: parsed?.kunde_name ?? null,
    kunde_ort: parsed?.kunde_ort ?? null,
    start_time: normTime(parsed?.start_time),
    end_time: normTime(parsed?.end_time),
    pause_minutes: numOrNull(parsed?.pause_minutes),
    materials: Array.isArray(parsed?.materials)
      ? parsed.materials
          .filter((m) => m && typeof m.material === "string" && m.material.trim())
          .map((m) => ({
            material: String(m.material).trim(),
            menge: Number(m.menge) > 0 ? Number(m.menge) : 1,
            einheit: (m.einheit && String(m.einheit).trim()) || "Stk",
          }))
      : [],
  };
}

/** RegieParseResult → RegieMaterial[] (Freitext, article_id null) für saveRegieReport. */
export function regieMaterialsFromParse(result: RegieParseResult): RegieMaterial[] {
  return (result.materials ?? []).map((m, i) => ({
    article_id: null,
    material: m.material,
    menge: m.menge,
    einheit: m.einheit,
    einzelpreis: Number(m.einzelpreis) || 0,
    notizen: null,
    sort_order: i,
  }));
}

function normTime(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = v.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Math.min(23, Number(m[1]));
  return `${String(h).padStart(2, "0")}:${m[2]}`;
}
function numOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
