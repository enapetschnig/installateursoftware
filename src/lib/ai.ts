// ============================================================
// B4Y SuperAPP – KI-Anbindung (Frontend)
// Ruft die Supabase Edge-Function `ai-assistant` (Claude/Anthropic) auf.
// Modell/Key/System-Prompt + Feature-Flags liegen in ai_settings (mandantenfähig).
// Externe Anbindung (API-Key) kann später in den KI-Einstellungen hinterlegt werden.
// ============================================================
import { supabase } from "./supabase";

export type AiSettings = {
  id?: string;
  org_id?: string | null;
  active: boolean;
  allowed_modules: string[];
  auto_suggestions: boolean;
  language: string | null;
  provider: string | null;
  model: string | null;
  api_key: string | null;
  system_prompt: string | null;
};

export const AI_MODULES = ["isabella", "planung", "dokumente"] as const;
export type AiModule = (typeof AI_MODULES)[number];

export async function loadAiSettings(): Promise<AiSettings | null> {
  const { data, error } = await supabase.from("ai_settings").select("*")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error) return null;
  return (data as AiSettings) ?? null;
}

export async function saveAiSettings(patch: Partial<AiSettings>): Promise<{ error?: string }> {
  const existing = await loadAiSettings();
  const payload: any = { ...patch, updated_at: new Date().toISOString() };
  if (existing?.id) {
    const { error } = await supabase.from("ai_settings").update(payload).eq("id", existing.id);
    return { error: error?.message };
  }
  const { error } = await supabase.from("ai_settings").insert(payload);
  return { error: error?.message };
}

/** Ist die KI insgesamt aktiv und für dieses Modul freigegeben? */
export function aiModuleEnabled(s: AiSettings | null, module: AiModule): boolean {
  if (!s) return true; // keine Einstellung = Standard an (Edge-Function entscheidet über Key)
  if (s.active === false) return false;
  if (Array.isArray(s.allowed_modules) && s.allowed_modules.length > 0) return s.allowed_modules.includes(module);
  return true;
}

export type AiMessage = { role: "user" | "assistant"; content: string };

export type AiCompleteOpts = {
  messages: AiMessage[];
  system?: string;
  model?: string;
  max_tokens?: number;
  module?: string;
  action?: string;
  context_id?: string | null;
  context_type?: string | null;
  prompt?: string | null;
};

/** Generischer KI-Aufruf über die Edge-Function. */
export async function aiComplete(opts: AiCompleteOpts): Promise<{ text?: string; error?: string; log_id?: string | null }> {
  try {
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    const { data, error } = await supabase.functions.invoke("ai-assistant", {
      body: opts,
      headers: token ? { "x-user-token": token } : undefined,
    });
    if (error) {
      // Edge-Function liefert Fehlertext im Body (auch bei non-2xx)
      const ctx = (error as any)?.context;
      try { const j = ctx && (await ctx.json()); if (j?.error) return { error: j.error }; } catch { /* ignore */ }
      return { error: error.message };
    }
    if (data?.error) return { error: data.error };
    return { text: (data?.text as string) ?? "", log_id: data?.log_id ?? null };
  } catch (e: any) {
    return { error: e?.message || "KI-Aufruf fehlgeschlagen." };
  }
}

/** Einfache Frage (eine User-Nachricht). */
export function aiAsk(userText: string, opts: Partial<AiCompleteOpts> = {}) {
  return aiComplete({ messages: [{ role: "user", content: userText }], prompt: userText, ...opts });
}

// ── Spracheingabe (OpenAI Speech-to-Text, serverseitig) ──────────────────
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onloadend = () => { const s = String(fr.result || ""); resolve(s.slice(s.indexOf(",") + 1)); };
    fr.onerror = () => reject(new Error("read"));
    fr.readAsDataURL(blob);
  });
}

export async function transcribeAudio(blob: Blob, ctx: { route?: string | null; context_type?: string | null } = {}): Promise<{ text?: string; warning?: string; error?: string }> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) return { error: "Nicht angemeldet." };
  let audio: string;
  try { audio = await blobToBase64(blob); } catch { return { error: "Audio konnte nicht gelesen werden." }; }
  try {
    const r = await fetch("/api/ai/transcribe", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ audio, mimeType: blob.type || "audio/webm", route: ctx.route ?? null, context_type: ctx.context_type ?? null }),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return { error: data.error || "Die Spracheingabe konnte nicht verarbeitet werden." };
    return { text: data.text ?? "", warning: data.warning };
  } catch { return { error: "Die Spracheingabe konnte nicht verarbeitet werden." }; }
}

// ── KI-Chat: primär OpenAI (serverseitig), Fallback auf bestehenden Assistenten ──
export type ChatContext = { area?: string; route?: string; project?: string; customer?: string; document?: string; offerId?: string; orderId?: string };

export type AiSelItem = { id: string; title: string; subtitle?: string; route: string; kind?: string };
export type AiResponse = {
  type: "message" | "navigate" | "selection_required" | "confirmation_required" | "start_tour" | "error";
  message?: string; text?: string; route?: string; items?: AiSelItem[]; error?: string;
  preview?: { title?: string; rows?: [string, string][] }; action?: { kind: string; offerId?: string; orderId?: string };
  /** KI-Schulungsmodus: zu startende Tour (z. B. "project-create"). */
  tourId?: string;
};

export async function chatAI(messages: AiMessage[], opts: { system?: string; context?: ChatContext; module?: string } = {}): Promise<AiResponse> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (token) {
    try {
      const r = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messages, system: opts.system, context: opts.context, route: opts.context?.route }),
      });
      const data = await r.json().catch(() => ({}));
      if (r.ok) return data as AiResponse;
      // 503 = OpenAI nicht verbunden → auf bestehenden Assistenten zurückfallen, sonst Fehler zeigen
      if (r.status !== 503) return { type: "error", error: data.error || "Die KI konnte gerade nicht antworten. Bitte später erneut versuchen." };
    } catch { /* Netzwerkfehler → Fallback versuchen */ }
  }
  // Fallback: bestehender Assistent (hält die Funktion am Leben, auch ohne OpenAI-Key)
  const fb = await aiComplete({ messages, system: opts.system, module: opts.module || "isabella", action: "chat" });
  return fb.error ? { type: "error", error: fb.error } : { type: "message", message: fb.text || "" };
}

/** Erwartet eine JSON-Antwort und parst sie robust (auch aus ```json-Blöcken). */
export async function aiJson<T = any>(userText: string, system: string, opts: Partial<AiCompleteOpts> = {}): Promise<{ data?: T; error?: string }> {
  const r = await aiComplete({ messages: [{ role: "user", content: userText }], system, prompt: userText, ...opts });
  if (r.error) return { error: r.error };
  const raw = (r.text || "").trim();
  const cleaned = raw.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  try { return { data: JSON.parse(cleaned) as T }; }
  catch {
    const m = cleaned.match(/\{[\s\S]*\}/);
    if (m) { try { return { data: JSON.parse(m[0]) as T }; } catch { /* fall through */ } }
    return { error: "KI-Antwort konnte nicht gelesen werden." };
  }
}
