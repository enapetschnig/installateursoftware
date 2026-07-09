// ============================================================
// B4Y SuperAPP – Storage-Helfer: signierte URLs für PRIVATE Buckets
// ------------------------------------------------------------
// Die Buckets `project-files` und `article-images` sind privat (Fund F-02).
// Dateibytes sind nur noch über zeitlich begrenzte, signierte URLs erreichbar.
//
// In der DB sind teils noch alte „öffentliche" URLs gespeichert
// (…/object/public/<bucket>/<pfad>) – `storagePath()` extrahiert daraus den
// reinen Objektpfad, sodass sowohl Alt-Bestand als auch reine Pfade
// funktionieren (kein Datenmigrations-Bruch nötig). `signedUrl()` cached die
// Ergebnisse, um wiederholtes Signieren beim Re-Render zu vermeiden.
//
// Logos liegen bewusst im ÖFFENTLICHEN `branding`-Bucket (Login/PDF ohne
// Auth) und brauchen diese Helfer NICHT.
// ============================================================
import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export type StorageBucket = "project-files" | "article-images" | "service-images" | "document-images" | "belege" | "marketing";

/** Alle bekannten Buckets (für die Bucket-Erkennung aus gespeicherten URLs/Pfaden). */
const ALL_BUCKETS: StorageBucket[] = ["project-files", "article-images", "service-images", "document-images", "belege", "marketing"];

/**
 * Erkennt den Bucket aus einem gespeicherten Wert (volle URL oder Pfad). Da
 * Positions-Bilder aus verschiedenen Buckets stammen können (Leistung→service-images,
 * Artikel→article-images, dokumentlokaler Upload→document-images), ist der Bucket
 * im Wert selbst enthalten. Gibt null zurück, wenn nicht erkennbar (Fallback beim Aufrufer).
 */
export function detectBucket(value: string | null | undefined): StorageBucket | null {
  if (!value) return null;
  const s = String(value);
  for (const b of ALL_BUCKETS) {
    if (s.includes(`/${b}/`) || s.startsWith(`${b}/`)) return b;
  }
  return null;
}

/**
 * Reinen Objektpfad aus einem gespeicherten Wert ableiten. Akzeptiert sowohl
 * volle (alte) öffentliche/signierte URLs als auch bereits reine Pfade.
 */
export function storagePath(bucket: StorageBucket, value: string | null | undefined): string {
  if (!value) return "";
  let s = String(value).trim();
  if (/^https?:\/\//i.test(s)) {
    s = s.split("#")[0].split("?")[0]; // Query/Hash (z. B. ?token=) entfernen
    const markers = [
      `/object/public/${bucket}/`,
      `/object/sign/${bucket}/`,
      `/object/authenticated/${bucket}/`,
      `/${bucket}/`,
    ];
    for (const mk of markers) {
      const i = s.indexOf(mk);
      if (i >= 0) { s = s.slice(i + mk.length); break; }
    }
  } else {
    s = s.replace(/^\/+/, "");
    if (s.startsWith(`${bucket}/`)) s = s.slice(bucket.length + 1);
  }
  try { return decodeURIComponent(s); } catch { return s; }
}

// Cache: bucket::pfad -> { url, exp }. Etwas vor Ablauf neu signieren.
const cache = new Map<string, { url: string; exp: number }>();

/**
 * Signierte URL für einen gespeicherten Wert (URL oder Pfad). Liefert bei
 * Fehler den Ursprungswert zurück (Fallback), nie eine Exception.
 */
export async function signedUrl(
  bucket: StorageBucket, value: string | null | undefined, expiresIn = 3600,
): Promise<string> {
  const path = storagePath(bucket, value);
  if (!path) return "";
  const key = `${bucket}::${path}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.exp > now) return hit.url;
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
  if (error || !data?.signedUrl) {
    return typeof value === "string" ? value : "";
  }
  cache.set(key, { url: data.signedUrl, exp: now + (expiresIn - 60) * 1000 });
  return data.signedUrl;
}

/** React-Hook: signierte URL für einen Wert (leer während des Auflösens). */
export function useSignedUrl(
  bucket: StorageBucket, value: string | null | undefined, expiresIn = 3600,
): string {
  const [url, setUrl] = useState("");
  useEffect(() => {
    let alive = true;
    if (!value) { setUrl(""); return; }
    signedUrl(bucket, value, expiresIn).then((u) => { if (alive) setUrl(u); });
    return () => { alive = false; };
  }, [bucket, value, expiresIn]);
  return url;
}

/** Signierte URL auflösen und in neuem Tab öffnen (Download/Ansicht). */
export async function openSignedUrl(bucket: StorageBucket, value: string | null | undefined): Promise<void> {
  const u = await signedUrl(bucket, value);
  if (u) window.open(u, "_blank", "noopener,noreferrer");
}
