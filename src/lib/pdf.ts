// ============================================================
// B4Y SuperAPP – Zentraler PDF-Zugriff (echtes PDF, eine Quelle)
// ============================================================
// Vorschau, Download, Druck und Versionen verwenden DENSELBEN Output:
// Das Dokument-HTML (inkl. paged.js) wird serverseitig (api/render-pdf,
// PDFShift) in ein ECHTES PDF gerendert und im PDF-Viewer geöffnet.
// Fällt die Render-Funktion aus, greift der bisherige Druckweg (Fallback).
//
// Wichtig fürs Nutzererlebnis: Der Ziel-Tab wird SOFORT (im Klick) geöffnet
// und zeigt „PDF wird erstellt …" – sobald das PDF fertig ist, wird er
// dorthin umgeleitet. So passiert beim Klick sofort etwas Sichtbares.
// ============================================================
import {
  renderDocumentHtml, printDocument, printStoredHtml, PrintMeta,
} from "../components/document/printDocument";
import { DocPosition, DocSummary } from "./document-types";
import { supabase } from "./supabase";

// Server-PDF aktiv (externer Dienst). Bei Fehler → Fallback auf den bisherigen Weg.
const SERVER_PDF_ENABLED = true;

// ============================================================
// Zentrale Dateinamen-Logik (eine Quelle der Wahrheit)
// ============================================================
/** Entfernt/ersetzt für Dateinamen ungültige Zeichen ( / \ : * ? " < > | sowie Leerzeichen). */
function sanitizeFileBase(s: string): string {
  return String(s ?? "")
    .replace(/[\\/:*?"<>|]/g, "-")  // ungültige Dateizeichen -> "-"
    .replace(/\s+/g, "-")            // Leerzeichen -> "-"
    .replace(/-+/g, "-")             // Mehrfach-"-" zusammenfassen
    .replace(/^[-.]+|[-.]+$/g, "");  // führende/abschließende "-"/"." entfernen
}

/**
 * Baut den PDF-Dateinamen aus der echten Dokumentnummer – mandantenfähig, weil
 * die Nummer aus dem (frei konfigurierbaren) Nummernkreis stammt.
 * Beispiel: ANGEBOT-0009-2026.pdf · AUFTRAG-0001-2026.pdf · RECHNUNG-0001-2026.pdf
 * Ohne Nummer (Entwurf): "<Grund-Dokumenttyp>-Entwurf.pdf" – nie UUID/blob/undefined.
 * Zentral verwendet für Download, Versions-Download, PDF-Mailanhang, Export, Sammeldownload.
 */
export function buildDocumentPdfFileName(opts: { number?: string | null; baseLabel?: string | null }): string {
  const num = sanitizeFileBase(opts.number || "");
  if (num) return `${num}.pdf`;
  const base = sanitizeFileBase(opts.baseLabel || "Dokument") || "Dokument";
  return `${base}-Entwurf.pdf`;
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Öffnet sofort (im Klick) ein Ziel-Fenster mit Lade-Hinweis. */
export function openPdfWindow(): Window | null {
  const w = window.open("", "_blank");
  if (w) {
    w.document.write(
      '<!doctype html><html lang="de"><head><meta charset="utf-8">' +
      "<title>PDF wird erstellt …</title></head>" +
      '<body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;display:grid;place-items:center;height:100vh;margin:0;color:#475569;background:#f8fafc">' +
      '<div style="text-align:center"><div style="font-size:15px">PDF wird erstellt …</div>' +
      '<div style="margin-top:8px;font-size:12px;color:#94a3b8">Einen Moment bitte</div></div>' +
      "</body></html>"
    );
    w.document.close();
  }
  return w;
}

/** Fehler beim Server-PDF-Rendern – mit HTTP-Status für eine klare Nutzermeldung. */
export type PdfRenderError = { status: number; message: string };
/** Ergebnis von htmlToPdfBlob: entweder ein PDF-Blob oder ein aussagekräftiger Fehler. */
export type PdfRenderResult = { blob: Blob } | { error: PdfRenderError };

/** Übersetzt einen HTTP-Status in eine klare, deutsche Nutzermeldung (ohne Secrets). */
function pdfErrorMessage(status: number): string {
  if (status === 401 || status === 403) return "PDF-Dienst nicht korrekt konfiguriert. Bitte den Administrator informieren.";
  if (status === 429) return "Zu viele PDF-Anfragen. Bitte einen Moment warten und erneut versuchen.";
  if (status === 408 || status === 504) return "Zeitüberschreitung beim Erstellen des PDFs. Bitte erneut versuchen.";
  if (status === 502 || status === 503) return `PDF-Dienst nicht erreichbar (HTTP ${status}). Bitte erneut versuchen.`;
  if (status === 0) return "Keine Verbindung zum PDF-Dienst. Bitte Internetverbindung prüfen und erneut versuchen.";
  return `PDF-Dienst-Fehler (HTTP ${status}). Bitte erneut versuchen.`;
}

// ── PDF-Cache (zwei Stufen, ohne stale-Risiko) ───────────────────────────
// Gleiches HTML ⇒ identisches PDF. Der SHA-256-Hash des KOMPLETTEN gerenderten
// HTML ist der Cache-Schlüssel: Positionen, Texte, Preise, Empfänger, Firmen-
// daten/Logo-URL UND das eingebettete PDF-CSS/Layout stecken im HTML – jede
// Änderung (auch ein Layout-Update per Deploy) ergibt einen neuen Hash.
// Es kann daher NIE ein veraltetes PDF angezeigt werden.
//  Stufe 1: Session-LRU im Speicher (sofort, gleiche Sitzung).
//  Stufe 2: persistenter Cache in Supabase (Tabelle document_pdf_cache +
//           privater Bucket "document-pdfs", org-getrennt via RLS, Migr. 0129) –
//           wirkt über Reload/Tab-/Gerätewechsel hinweg.
//           version_no = 0 → Entwurf/Live (wird überschrieben),
//           version_no > 0 → finalisierte Version (einmal erzeugt, stabil).
const pdfCache = new Map<string, Blob>();
const PDF_CACHE_MAX = 6;
const PDF_BUCKET = "document-pdfs";

/** Bezug für den persistenten PDF-Cache (Quelle des Dokuments). */
export type PdfCacheRef = {
  sourceTable: string;        // wie document_versions.source_table: 'offer' | 'order' | 'invoice' | …
  sourceId: string;
  versionNo?: number | null;  // undefined/0 = Entwurf/Live; >0 = finalisierte Version
};

async function htmlHash(html: string): Promise<string | null> {
  try {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(html));
    return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null; // kein Secure Context o. ä. → einfach ohne Cache arbeiten
  }
}

function memCachePut(key: string, blob: Blob) {
  pdfCache.delete(key);
  pdfCache.set(key, blob);
  while (pdfCache.size > PDF_CACHE_MAX) {
    const oldest = pdfCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    pdfCache.delete(oldest);
  }
}

const ms = (t: number) => `${Math.round(t)}ms`;

/** Persistenten Cache-Eintrag lesen; nur bei EXAKT passendem Hash das PDF laden. */
async function loadPersistedPdf(ref: PdfCacheRef, hash: string): Promise<Blob | null> {
  try {
    const vNo = ref.versionNo ?? 0;
    const { data: row } = await supabase.from("document_pdf_cache")
      .select("html_hash,storage_path")
      .eq("source_table", ref.sourceTable).eq("source_id", ref.sourceId).eq("version_no", vNo)
      .maybeSingle();
    if (!row || row.html_hash !== hash) return null; // kein/veralteter Eintrag → neu rendern
    const dl = await supabase.storage.from(PDF_BUCKET).download(row.storage_path);
    if (dl.error || !dl.data || dl.data.size === 0) return null;
    return dl.data.type.includes("pdf") ? dl.data : new Blob([dl.data], { type: "application/pdf" });
  } catch {
    return null; // Cache ist optional – Fehler nie blockierend
  }
}

/** Fertiges PDF persistent ablegen (fire-and-forget; Fehler nie blockierend). */
async function persistPdf(ref: PdfCacheRef, hash: string, blob: Blob): Promise<void> {
  try {
    const { data: orgId } = await supabase.rpc("current_org_id");
    if (!orgId) return;
    const vNo = ref.versionNo ?? 0;
    const path = `${orgId}/${ref.sourceTable}/${ref.sourceId}/v${vNo}.pdf`;
    const up = await supabase.storage.from(PDF_BUCKET)
      .upload(path, blob, { contentType: "application/pdf", upsert: true });
    if (up.error) return;
    await supabase.from("document_pdf_cache").upsert({
      source_table: ref.sourceTable, source_id: ref.sourceId, version_no: vNo,
      html_hash: hash, storage_path: path, updated_at: new Date().toISOString(),
    }, { onConflict: "source_table,source_id,version_no" });
  } catch { /* Cache-Ablage ist Komfort – nie blockierend */ }
}

/**
 * Dokument-HTML serverseitig zu echtem PDF rendern – mit zweistufigem Cache.
 * Liefert entweder { blob } oder { error: { status, message } }. So kann der Aufrufer
 * zwischen „Dienst aus/Fehler" und „Netzwerk" unterscheiden (statt allem als Netzwerkfehler).
 * status 0 = Netzwerk-/Verbindungsfehler. Bei deaktiviertem Server-PDF → 503 (→ Client-Fallback).
 * `cacheRef` (optional) aktiviert zusätzlich den persistenten Cache (Supabase Storage).
 */
export async function htmlToPdfBlob(html: string, cacheRef?: PdfCacheRef | null): Promise<PdfRenderResult> {
  if (!SERVER_PDF_ENABLED) return { error: { status: 503, message: pdfErrorMessage(503) } };
  const t0 = performance.now();
  const cacheKey = await htmlHash(html);
  if (cacheKey) {
    const hit = pdfCache.get(cacheKey);
    if (hit) {
      memCachePut(cacheKey, hit); // LRU: Treffer nach hinten schieben
      console.debug(`[pdf] Session-Cache-Treffer (${ms(performance.now() - t0)}, hash=${cacheKey.slice(0, 8)})`);
      return { blob: hit };
    }
    if (cacheRef) {
      const persisted = await loadPersistedPdf(cacheRef, cacheKey);
      if (persisted) {
        memCachePut(cacheKey, persisted);
        console.debug(`[pdf] Storage-Cache-Treffer (${ms(performance.now() - t0)}, `
          + `${cacheRef.sourceTable}/${cacheRef.sourceId} v${cacheRef.versionNo ?? 0}, hash=${cacheKey.slice(0, 8)})`);
        return { blob: persisted };
      }
    }
  }
  const tCache = performance.now();
  let res: Response;
  try {
    // Server-PDF erfordert ein gültiges User-JWT (Auth-Schutz des Render-Endpunkts).
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    res = await fetch("/api/render-pdf", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ html }),
    });
  } catch {
    // Echter Netzwerk-/Verbindungsfehler (fetch wirft) → Status 0.
    return { error: { status: 0, message: pdfErrorMessage(0) } };
  }
  if (!res.ok) return { error: { status: res.status, message: pdfErrorMessage(res.status) } };
  const blob = await res.blob();
  if (blob && blob.size > 0 && blob.type.includes("pdf")) {
    console.debug(`[pdf] Server-Rendering (Cache-Lookup ${ms(tCache - t0)}, PDFShift/API ${ms(performance.now() - tCache)}, `
      + `${Math.round(blob.size / 1024)} KB${cacheKey ? `, hash=${cacheKey.slice(0, 8)}` : ""})`);
    if (cacheKey) {
      memCachePut(cacheKey, blob);
      // Persistente Ablage im Hintergrund (blockiert das Anzeigen nicht).
      if (cacheRef) void persistPdf(cacheRef, cacheKey, blob);
    }
    return { blob };
  }
  // 200 ohne brauchbares PDF (z. B. leere/falsche Antwort) → als Dienstfehler behandeln.
  return { error: { status: 502, message: pdfErrorMessage(502) } };
}

/**
 * PDF im HINTERGRUND vorbereiten (z. B. direkt nach dem Finalisieren): rendert das
 * übergebene HTML – falls noch nicht im persistenten Cache – und legt es dort ab.
 * Öffnet KEIN Fenster, wirft nie (fire-and-forget); das erste „PDF ansehen" einer
 * finalen Version ist damit sofort da.
 */
export async function prepareDocumentPdf(ref: PdfCacheRef, html: string): Promise<void> {
  try {
    const hash = await htmlHash(html);
    if (!hash) return;
    const existing = await loadPersistedPdf(ref, hash);
    if (existing) { memCachePut(hash, existing); return; } // schon vorbereitet
    await htmlToPdfBlob(html, ref); // rendert + persistiert (persistPdf im Erfolgsfall)
  } catch { /* Vorbereitung ist Komfort – nie blockierend */ }
}

/**
 * Zeigt das fertige PDF in einem schlanken Viewer-Fenster: oben eine Leiste mit
 * dem sauberen Dateinamen + „Herunterladen" (Anchor mit download-Attribut →
 * garantiert sauberer Dateiname, browserübergreifend) + „Drucken"; darunter das
 * PDF in einem iframe (Vorschau/Druck). So sind Vorschau, Download und Druck eins.
 */
function showPdf(win: Window, url: string, fileName: string, returnUrl?: string) {
  const safe = esc(fileName);
  // Rücksprung-Ziel als sicheres JS-String-Literal (Herkunft der App: exakte Ansicht,
  // inkl. ggf. ?versions=1 → Versionshistorie wird beim Zurück wieder geöffnet).
  const retLit = JSON.stringify(returnUrl || "");
  const html =
    '<!doctype html><html lang="de"><head><meta charset="utf-8">' +
    `<title>${safe}</title>` +
    "<style>html,body{margin:0;height:100%;background:#475569}" +
    ".bar{position:fixed;top:0;left:0;right:0;height:46px;display:flex;align-items:center;gap:10px;" +
    "padding:0 12px;background:#1e293b;color:#fff;font:14px -apple-system,Segoe UI,Roboto,sans-serif;z-index:2;box-sizing:border-box}" +
    ".bar .nm{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}" +
    ".bar a,.bar button{display:inline-flex;align-items:center;gap:6px;background:#334155;color:#fff;border:0;" +
    "border-radius:8px;padding:8px 13px;font:inherit;text-decoration:none;cursor:pointer;white-space:nowrap}" +
    ".bar a:hover,.bar button:hover{background:#64748b}" +
    ".bar button.close{background:#dc2626}.bar button.close:hover{background:#ef4444}" +
    "iframe{position:absolute;top:46px;left:0;width:100%;height:calc(100% - 46px);border:0;background:#fff}</style></head>" +
    // body tabindex=-1 → fokussierbar ohne sichtbaren Rahmen; nötig, um den Fokus nach
    // Download/Druck oder Klick ins PDF zurück in unsere Shell zu holen (für ESC).
    `<body tabindex="-1"><div class="bar"><span class="nm">${safe}</span>` +
    // Download/Druck laufen über UNSERE App-Buttons (native PDF-Toolbar ist via #toolbar=0 aus),
    // danach wird der Fokus erzwungen zurückgeholt → ESC bleibt aktiv.
    `<a id="b4yDl" href="${url}" download="${safe}" onclick="b4yDownload(event)">⬇ Herunterladen</a>` +
    "<button onclick=\"b4yPrint()\">🖨 Drucken</button>" +
    "<button id=\"b4yClose\" class=\"close\" onclick=\"b4yCloseView()\">✕ Schließen</button>" +
    // #toolbar=0&navpanes=0&statusbar=0 → native Browser-PDF-Toolbar aus; der User nutzt unsere
    // Buttons, dadurch wandert der Fokus nicht in die native Plugin-Toolbar (Hauptursache des Bugs).
    `</div><iframe id="b4yFrame" src="${url}#toolbar=0&navpanes=0&statusbar=0"></iframe>` +
    "<script>" +
    "var b4yF=document.getElementById('b4yFrame');" +
    // Programmatischer Download mit GARANTIERT sauberem Dateinamen: ein frischer Anchor mit
    // download-Attribut wird erzeugt und geklickt (zuverlässiger Name browserübergreifend),
    // dann der Standard-Klick auf den sichtbaren Link unterbunden. Danach Fokus zurückholen.
    `var b4yUrl=${JSON.stringify(url)};var b4yName=${JSON.stringify(fileName)};` +
    "function b4yDownload(ev){try{if(ev&&ev.preventDefault)ev.preventDefault();}catch(e){}" +
    "try{var a=document.createElement('a');a.href=b4yUrl;a.download=b4yName;a.style.display='none';" +
    "document.body.appendChild(a);a.click();setTimeout(function(){try{document.body.removeChild(a);}catch(e){}},0);}catch(e){" +
    "try{var l=document.getElementById('b4yDl');if(l){l.click();}}catch(e2){}}b4yForce();}" +
    // Fokus in unsere Shell (Schließen-Button) holen – Voraussetzung, dass document/window ESC empfängt.
    "function b4yShellFocus(){try{window.focus();}catch(e){}try{(document.getElementById('b4yClose')||document.body).focus({preventScroll:true});}catch(e){}}" +
    // Erzwungen zurückholen (nach unseren Buttons): iframe blurren + Shell fokussieren, mehrfach (Plugin greift evtl. verzögert).
    "function b4yForce(){try{if(b4yF)b4yF.blur();}catch(e){}b4yShellFocus();[60,250,600,1000].forEach(function(t){setTimeout(function(){try{if(b4yF&&document.activeElement===b4yF)b4yF.blur();}catch(e){}b4yShellFocus();},t);});}" +
    // Watchdog: solange UNSER Tab aktiv ist und der Fokus ins PDF-Plugin (iframe) gewandert ist,
    // den Fokus zurückholen → ESC funktioniert beim ersten Versuch, auch nach Klick ins PDF.
    // Bei Tabwechsel (document.hasFocus()===false) NICHT eingreifen.
    "function b4yReclaim(){try{if(document.hasFocus()&&b4yF&&document.activeElement===b4yF){b4yF.blur();b4yShellFocus();}}catch(e){}}" +
    // Schließen: erst Tab schließen (→ Herkunfts-Fenster behält seinen Zustand, z.B. offene
    // Versionshistorie). Falls Schließen blockiert: zurück zur GENAU gespeicherten Herkunfts-URL
    // (returnUrl = Angebot/Auftrag/Rechnung/SUB/Projekt/Liste, inkl. ?versions=1) – sonst Opener-URL/Referrer.
    `var b4yRet=${retLit};` +
    "function b4yCloseView(){clearInterval(b4yWatch);try{window.close();}catch(e){}" +
    "setTimeout(function(){if(!window.closed){var u=b4yRet||'';" +
    "try{if(!u&&window.opener&&!window.opener.closed&&window.opener.location)u=window.opener.location.href;}catch(e){}" +
    "try{if(window.opener&&!window.opener.closed){window.opener.focus();window.close();}}catch(e){}" +
    "if(!window.closed){location.href=u||document.referrer||'/';}}},300);}" +
    // Drucken über unseren Button: iframe drucken, danach Fokus erzwungen zurück.
    "function b4yPrint(){try{b4yF.focus();b4yF.contentWindow.focus();b4yF.contentWindow.print();}catch(e){}b4yForce();}" +
    // ESC zentral: Capture-Phase auf window UND document (greift unabhängig vom Fokus-Ziel innerhalb unseres Dokuments).
    "function b4yKey(e){if(e.key==='Escape'||e.key==='Esc'){e.preventDefault();e.stopPropagation();b4yCloseView();}}" +
    "window.addEventListener('keydown',b4yKey,true);document.addEventListener('keydown',b4yKey,true);" +
    // ESC zusätzlich im (gleich-origin) Blob-iframe registrieren + nach Laden Fokus in die Shell.
    "if(b4yF){b4yF.addEventListener('load',function(){try{b4yF.contentWindow.addEventListener('keydown',b4yKey,true);}catch(e){}b4yShellFocus();});}" +
    "var b4yWatch=setInterval(b4yReclaim,700);" +
    "window.addEventListener('pagehide',function(){clearInterval(b4yWatch);});" +
    "b4yShellFocus();" +
    // Getrennt konkateniert, damit im (per Singlefile inline eingebetteten) Bundle
    // nie ein literales schließendes script-Tag steht.
    "</scr" + "ipt>" +
    "</body></html>";
  win.document.open();
  win.document.write(html);
  win.document.close();
}

/**
 * Zeigt im Ziel-Fenster eine klare Fehlermeldung (HTTP-Status differenziert) statt es
 * still zu schließen (das hätte wie ein Netzwerkfehler ausgesehen). Bietet zwei bewusste
 * Optionen: erneut versuchen (zurück zur App) und den Client-Druck-Fallback (printDocument).
 * Der Fallback wird über ein einmaliges Fenster-Callback ausgelöst (kein Inline-Secret).
 */
function showPdfError(win: Window, err: PdfRenderError, fallback: () => void) {
  // Fallback-Auslöser am Fenster registrieren (vom Button im Fehlerscreen aufgerufen).
  try { (win as any).__b4yFallback = () => { try { win.close(); } catch { /* ignore */ } fallback(); }; } catch { /* ignore */ }
  const msg = esc(err.message);
  const html =
    '<!doctype html><html lang="de"><head><meta charset="utf-8">' +
    "<title>PDF konnte nicht erstellt werden</title>" +
    "<style>html,body{margin:0;height:100%;font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f8fafc;color:#334155}" +
    ".wrap{display:grid;place-items:center;height:100vh;padding:24px;box-sizing:border-box}" +
    ".card{max-width:440px;text-align:center;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:28px 24px;box-shadow:0 4px 18px rgba(15,23,42,.08)}" +
    ".t{font-size:16px;font-weight:700;margin-bottom:10px;color:#0f172a}" +
    ".m{font-size:14px;line-height:1.5;margin-bottom:20px}" +
    ".row{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}" +
    "button{font:inherit;font-size:14px;padding:9px 15px;border:0;border-radius:9px;cursor:pointer}" +
    ".p{background:#dc2626;color:#fff}.o{background:#e2e8f0;color:#0f172a}" +
    "button:hover{filter:brightness(1.06)}</style></head>" +
    '<body><div class="wrap"><div class="card">' +
    '<div class="t">PDF konnte nicht erstellt werden</div>' +
    `<div class="m">${msg}</div>` +
    '<div class="row">' +
    '<button class="o" onclick="try{window.close();}catch(e){}">Schließen</button>' +
    '<button class="p" onclick="try{if(window.__b4yFallback)window.__b4yFallback();}catch(e){}">Stattdessen drucken</button>' +
    "</div></div></div></body></html>";
  win.document.open();
  win.document.write(html);
  win.document.close();
}

/** Fertiges PDF in das (ggf. vorab geöffnete) Fenster laden; bei Fehler klare Meldung + Fallback-Option. */
function finish(win: Window | null, result: PdfRenderResult, fallback: (targetWin?: Window | null) => void, fileName?: string, returnUrl?: string) {
  if ("blob" in result) {
    const url = URL.createObjectURL(result.blob);
    const name = fileName || "Dokument.pdf";
    if (win) showPdf(win, url, name, returnUrl);
    else {
      const w2 = window.open("", "_blank");
      if (w2) showPdf(w2, url, name, returnUrl); else window.open(url, "_blank");
    }
    setTimeout(() => URL.revokeObjectURL(url), 300_000);
    return;
  }
  // Server-PDF nicht verfügbar: Bei 503 (PDFShift nicht konfiguriert/aus) hilft "erneut
  // versuchen" nie → direkt den Browser-Druck-Fallback im bereits offenen Tab rendern
  // (kein neues window.open → kein Popup-Blocker). So funktioniert PDF/Druck auch ohne
  // PDFShift-Key. Bei transienten Fehlern (429/502/504/…): klare Meldung + Fallback-Button.
  if (result.error.status === 503) {
    fallback(win);
    return;
  }
  if (win) showPdfError(win, result.error, () => fallback());
  else fallback();
}

/** Aktuelle App-URL als Rücksprung-Ziel (Herkunft) – beim Klick im App-Kontext erfasst. */
function currentReturnUrl(explicit?: string | null): string {
  if (explicit) return explicit;
  try { return window.location.href; } catch { return ""; }
}

/**
 * Live-Dokument als echtes PDF öffnen (Vorschau = Download = Druck).
 * `win` = vorab im Klick geöffnetes Fenster (für sofortiges Feedback).
 * `opts.cacheRef` (Quelle, versionNo 0/undefined = Entwurf) aktiviert den
 * persistenten PDF-Cache – unverändertes Dokument = kein neuer PDFShift-Lauf.
 */
export async function openDocumentPdf(
  positions: DocPosition[], summary: DocSummary, meta: PrintMeta, win?: Window | null,
  fileName?: string, opts?: { returnUrl?: string | null; cacheRef?: PdfCacheRef | null },
): Promise<void> {
  const w = win ?? openPdfWindow();
  const ret = currentReturnUrl(opts?.returnUrl);
  const tHtml = performance.now();
  const html = await renderDocumentHtml(positions, summary, meta);
  console.debug(`[pdf] HTML-Erzeugung ${Math.round(performance.now() - tHtml)}ms (${Math.round(html.length / 1024)} KB)`);
  const result = await htmlToPdfBlob(html, opts?.cacheRef);
  const name = fileName || buildDocumentPdfFileName({ number: meta.number, baseLabel: meta.numberLabel || meta.docLabel });
  finish(w, result, (tw) => printDocument(positions, summary, meta, ret, tw), name, ret);
}

/**
 * Gespeicherten Versions-Snapshot (print_html) als echtes PDF öffnen.
 * `opts.cacheRef` mit versionNo > 0 → das einmal gerenderte PDF der finalen
 * Version wird persistent wiederverwendet (kein PDFShift-Roundtrip mehr).
 */
export async function openSnapshotPdf(
  printHtml: string, win?: Window | null, fileName?: string,
  opts?: { returnUrl?: string | null; cacheRef?: PdfCacheRef | null },
): Promise<void> {
  const w = win ?? openPdfWindow();
  const ret = currentReturnUrl(opts?.returnUrl);
  const result = await htmlToPdfBlob(printHtml, opts?.cacheRef);
  finish(w, result, (tw) => printStoredHtml(printHtml, ret, tw), fileName, ret);
}
