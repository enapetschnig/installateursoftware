// ============================================================
// B4Y SuperAPP – Auto-Update / Versions-Watcher
// Erkennt automatisch, wenn ein neuer Build deployt wurde, und lädt die App
// dann selbsttätig neu – der Anwender muss NIE manuell hart neu laden.
//
// Funktionsweise: Beim Start merkt sich der Watcher die gehashten Asset-Namen
// aus der ausgelieferten index.html (Vite vergibt bei jedem Build neue Hashes).
// In Intervallen / bei Fenster-Fokus wird die index.html erneut (ohne Cache)
// geholt und verglichen. Ändern sich die Hashes → neuer Build ist live → Reload.
//
// Datenschutz vor Datenverlust: Solange im Dokumenteditor ungespeicherte
// Änderungen offen sind (window.__b4yDirty === true), wird der Reload
// aufgeschoben und erst ausgeführt, sobald gespeichert/verlassen wurde.
// ============================================================

// (Deploy-Trigger: Commit-Autor korrigiert auf gültige GitHub-Mail.)
const POLL_MS = 60_000;          // reguläre Prüfung
const MIN_GAP_MS = 15_000;       // Mindestabstand zwischen zwei Netzwerk-Checks
let baseline: string | null = null;
let newVersion = false;
let lastCheck = 0;
let started = false;

/** Gehashte Asset-Referenzen aus der index.html als stabile Signatur. */
async function fetchSignature(): Promise<string | null> {
  try {
    const res = await fetch(`/?_v=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return null;
    const html = await res.text();
    const assets = html.match(/\/assets\/[A-Za-z0-9._-]+\.(?:js|css)/g);
    if (!assets || assets.length === 0) return null;
    return Array.from(new Set(assets)).sort().join("|");
  } catch {
    return null; // Netzwerkfehler → still ignorieren, später erneut versuchen
  }
}

function dirty(): boolean {
  return ((window as unknown as { __b4yDirtyCount?: number }).__b4yDirtyCount ?? 0) > 0;
}

async function check(force = false) {
  const now = Date.now();
  if (!force && now - lastCheck < MIN_GAP_MS) {
    // Trotzdem reloaden, falls bereits eine neue Version erkannt wurde und jetzt nichts mehr offen ist.
    if (newVersion && !dirty()) window.location.reload();
    return;
  }
  lastCheck = now;

  const sig = await fetchSignature();
  if (!sig) return;
  if (baseline === null) { baseline = sig; return; }
  if (sig !== baseline) newVersion = true;

  // Reload, sobald eine neue Version live ist UND keine ungespeicherten Änderungen offen sind.
  if (newVersion && !dirty()) window.location.reload();
}

/** Einmalig beim App-Start aufrufen. Nur im Produktiv-Build aktiv. */
export function initVersionWatcher() {
  if (started) return;
  started = true;
  if (!import.meta.env.PROD) return; // im Dev-Server (HMR) nicht nötig

  // Baseline holen
  void check(true);

  // Regelmäßig prüfen
  setInterval(() => { void check(); }, POLL_MS);

  // Bei Fokus/Sichtbarkeit/Navigation prüfen (reagiert schnell nach Deploys)
  window.addEventListener("focus", () => { void check(); });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") void check(); });
  window.addEventListener("hashchange", () => { void check(); });
}
