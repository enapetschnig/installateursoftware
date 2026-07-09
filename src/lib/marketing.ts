// ============================================================
// Installateur SuperAPP – Marketing (Social-Beiträge & Werbeanzeigen)
// ------------------------------------------------------------
// Datenzugriff für das Marketing-Modul. Alles läuft über den supabase-Client
// mit User-JWT; RLS erzwingt die Mandantentrennung.
//
// Ehrliche Abgrenzung: Beiträge werden hier GEPLANT, nicht veröffentlicht.
// Solange kein Kanal verbunden ist (social_accounts.status), erfolgt kein
// automatischer Post – "veröffentlicht" ist ein manueller Statuswechsel.
// ============================================================
import { supabase } from "./supabase";
import { signedUrl } from "./storage";
import type { Tone } from "../components/ui";

// ── Typen ─────────────────────────────────────────────────────────────
export type Platform = "facebook" | "instagram";
export type PostStatus = "entwurf" | "geplant" | "veroeffentlicht" | "archiviert";
export type CampaignStatus = "entwurf" | "aktiv" | "pausiert" | "beendet";
export type CampaignObjective = "reichweite" | "traffic" | "leads" | "conversions";
export type AccountStatus = "nicht_verbunden" | "verbunden" | "fehler";

export interface PostMetrics {
  reach?: number; likes?: number; comments?: number; shares?: number; clicks?: number;
}

export interface SocialPost {
  id: string;
  organization_id: string;
  title: string | null;
  content: string;
  platforms: Platform[];
  status: PostStatus;
  scheduled_at: string | null;
  published_at: string | null;
  image_path: string | null;
  link_url: string | null;
  hashtags: string[];
  ai_generated: boolean;
  campaign_id: string | null;
  project_id: string | null;
  metrics: PostMetrics;
  created_at: string;
  updated_at: string;
}

export interface CampaignMetrics {
  impressions?: number; clicks?: number; leads?: number; spend?: number; ctr?: number; cpl?: number;
}

export interface TargetAudience {
  ort?: string; radius_km?: number; alter_von?: number; alter_bis?: number; interessen?: string[];
}

export interface AdCampaign {
  id: string;
  organization_id: string;
  name: string;
  platform: "facebook" | "instagram" | "google_ads";
  objective: CampaignObjective;
  status: CampaignStatus;
  budget_total: number | null;
  budget_daily: number | null;
  start_date: string | null;
  end_date: string | null;
  target_audience: TargetAudience;
  metrics: CampaignMetrics;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface SocialAccount {
  id: string;
  organization_id: string;
  platform: "facebook" | "instagram" | "linkedin" | "google_ads";
  account_name: string | null;
  status: AccountStatus;
  connected_at: string | null;
}

// ── Label-/Ton-Zuordnung (Badge-Palette der App) ──────────────────────
export const POST_STATUS_LABEL: Record<PostStatus, string> = {
  entwurf: "Entwurf",
  geplant: "Geplant",
  veroeffentlicht: "Veröffentlicht",
  archiviert: "Archiviert",
};
export const POST_STATUS_TONE: Record<PostStatus, Tone> = {
  entwurf: "slate",
  geplant: "amber",
  veroeffentlicht: "green",
  archiviert: "slate",
};

export const CAMPAIGN_STATUS_LABEL: Record<CampaignStatus, string> = {
  entwurf: "Entwurf", aktiv: "Aktiv", pausiert: "Pausiert", beendet: "Beendet",
};
export const CAMPAIGN_STATUS_TONE: Record<CampaignStatus, Tone> = {
  entwurf: "slate", aktiv: "green", pausiert: "amber", beendet: "slate",
};

export const OBJECTIVE_LABEL: Record<CampaignObjective, string> = {
  reichweite: "Reichweite", traffic: "Website-Besuche", leads: "Anfragen (Leads)", conversions: "Abschlüsse",
};

export const PLATFORM_LABEL: Record<string, string> = {
  facebook: "Facebook", instagram: "Instagram", linkedin: "LinkedIn", google_ads: "Google Ads",
};

// ── Beiträge ──────────────────────────────────────────────────────────
export async function listPosts(): Promise<SocialPost[]> {
  const { data, error } = await supabase
    .from("social_posts")
    .select("*")
    .neq("status", "archiviert")
    .order("scheduled_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as SocialPost[]) ?? [];
}

export type PostInput = Partial<
  Pick<SocialPost, "title" | "content" | "platforms" | "status" | "scheduled_at"
    | "image_path" | "link_url" | "hashtags" | "ai_generated" | "campaign_id" | "project_id">
>;

export async function createPost(input: PostInput): Promise<string> {
  const { data, error } = await supabase.from("social_posts").insert(input).select("id").single();
  if (error) throw new Error(error.message);
  return data.id as string;
}

export async function updatePost(id: string, patch: PostInput & { published_at?: string | null }): Promise<void> {
  const { error } = await supabase.from("social_posts").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function deletePost(id: string): Promise<void> {
  const { error } = await supabase.from("social_posts").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ── Kampagnen ─────────────────────────────────────────────────────────
export async function listCampaigns(): Promise<AdCampaign[]> {
  const { data, error } = await supabase
    .from("ad_campaigns").select("*").order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data as AdCampaign[]) ?? [];
}

export type CampaignInput = Partial<
  Pick<AdCampaign, "name" | "platform" | "objective" | "status" | "budget_total"
    | "budget_daily" | "start_date" | "end_date" | "target_audience" | "notes">
>;

export async function createCampaign(input: CampaignInput): Promise<string> {
  const { data, error } = await supabase.from("ad_campaigns").insert(input).select("id").single();
  if (error) throw new Error(error.message);
  return data.id as string;
}
export async function updateCampaign(id: string, patch: CampaignInput): Promise<void> {
  const { error } = await supabase.from("ad_campaigns").update(patch).eq("id", id);
  if (error) throw new Error(error.message);
}
export async function deleteCampaign(id: string): Promise<void> {
  const { error } = await supabase.from("ad_campaigns").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

// ── Kanäle ────────────────────────────────────────────────────────────
export async function listAccounts(): Promise<SocialAccount[]> {
  const { data, error } = await supabase.from("social_accounts").select("*").order("platform");
  if (error) throw new Error(error.message);
  return (data as SocialAccount[]) ?? [];
}

// ── Beitragsbild (Bucket 'marketing', privat + org-isoliert) ──────────
const MARKETING_BUCKET = "marketing";
const ALLOWED_IMAGE_MIME = ["image/jpeg", "image/png", "image/webp"];
export const IMAGE_ACCEPT = ALLOWED_IMAGE_MIME.join(",");

function safeFileName(n: string): string {
  return (String(n || "bild").replace(/[/\\]/g, "_").replace(/[^\w.-]+/g, "_").slice(0, 100)) || "bild";
}

/** Signierte URL eines Beitragsbilds. Leerer String bei Fehler. */
export async function postImageUrl(path: string | null | undefined): Promise<string> {
  if (!path) return "";
  const u = await signedUrl(MARKETING_BUCKET, path);
  return /^https?:\/\//i.test(u) ? u : "";
}

/** Lädt ein Beitragsbild hoch. Pfad org-isoliert: "<orgId>/posts/<ts>-<name>". */
export async function uploadPostImage(file: File): Promise<string> {
  const ct = (file.type || "").toLowerCase();
  if (!ALLOWED_IMAGE_MIME.includes(ct)) {
    throw new Error("Nur JPG, PNG oder WEBP möglich.");
  }
  const { data: orgId, error: orgErr } = await supabase.rpc("current_org_id");
  if (orgErr || !orgId) throw new Error("Organisation konnte nicht ermittelt werden.");
  const path = `${orgId}/posts/${Date.now()}-${safeFileName(file.name)}`;
  const { error } = await supabase.storage
    .from(MARKETING_BUCKET).upload(path, file, { contentType: ct, upsert: false });
  if (error) throw new Error(error.message);
  return path;
}

// ── KI-Textvorschlag (echte OpenAI-Generierung, serverseitig) ─────────
export interface GeneratedPost {
  title: string;
  content: string;
  hashtags: string[];
  best_time_hint: string | null;
}

export async function generatePost(opts: {
  topic: string;
  platform: Platform;
  tone?: "freundlich" | "professionell" | "locker" | "werblich" | "informativ";
  company?: string;
}): Promise<GeneratedPost> {
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  if (!token) throw new Error("Nicht angemeldet");
  const r = await fetch("/api/marketing/generate-post", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(opts),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error || `KI-Fehler (HTTP ${r.status}).`);
  return data as GeneratedPost;
}

// ── Kennzahlen-Helfer ─────────────────────────────────────────────────
export function sumPostMetric(posts: SocialPost[], key: keyof PostMetrics): number {
  return posts.reduce((s, p) => s + Number(p.metrics?.[key] ?? 0), 0);
}
export function sumCampaignMetric(cs: AdCampaign[], key: keyof CampaignMetrics): number {
  return cs.reduce((s, c) => s + Number(c.metrics?.[key] ?? 0), 0);
}
