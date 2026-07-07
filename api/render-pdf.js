// ============================================================
// B4Y SuperAPP – Server-PDF-Renderer (Vercel Serverless Function)
// ============================================================
// Rendert das fertige Dokument-HTML (inkl. paged.js) über einen externen
// HTML→PDF-Dienst (PDFShift) zu einem ECHTEN PDF. Dadurch sind Vorschau,
// Download, Druck und Version exakt identisch – dasselbe HTML wie in der App.
//
// Kein eigenes Chromium → keine Lambda-Bibliotheks-Probleme (libnss3 etc.).
// Der API-Key kommt aus der Umgebungsvariable PDFSHIFT_API_KEY (in Vercel
// hinterlegen – wird NIE im Code gespeichert). Ohne Key → 503 → Client-Fallback.
//
// Sicherheit:
//  • Zugriff NUR mit gültigem Supabase-JWT (Authorization: Bearer <token>) –
//    sonst 401. Verhindert offenen PDF-Render-Proxy (PDFShift-Kosten/SSRF/DoS).
//  • Pro-User-Rate-Limit (Schutz vor Kostenmissbrauch).
// ============================================================
import { bearerFromRequest, verifyUser, checkRateLimit } from "./_lib/security.js";

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Nur POST erlaubt." });
    return;
  }

  // Auth: gültiges User-JWT verlangen (analog api/ai/chat.js).
  const token = bearerFromRequest(req);
  const user = await verifyUser(token);
  if (!user) {
    res.status(401).json({ error: "Nicht angemeldet." });
    return;
  }
  if (!checkRateLimit(user.id)) {
    res.status(429).json({ error: "Zu viele Anfragen. Bitte kurz warten." });
    return;
  }

  let html = "";
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    html = (body && body.html) || "";
  } catch {
    html = "";
  }
  if (!html || typeof html !== "string") {
    res.status(400).json({ error: "Feld 'html' fehlt." });
    return;
  }

  const key = process.env.PDFSHIFT_API_KEY;
  if (!key) {
    res.status(503).json({ error: "PDF-Dienst nicht konfiguriert (PDFSHIFT_API_KEY fehlt)." });
    return;
  }

  // Ready-Funktion defensiv sicherstellen (für ÄLTERE gespeicherte print_html-Snapshots,
  // die b4yPdfReady noch nicht definieren – __pagedReady setzen sie bereits). Zusätzlich
  // ein 9s-Sicherheitsdeckel: hängt die Paginierung, wird trotzdem gerendert statt bis
  // zum 30s-wait_for-Timeout zu warten.
  const readySnippet =
    "<script>if(!window.b4yPdfReady){window.b4yPdfReady=function(){return window.__pagedReady===true};}" +
    "setTimeout(function(){window.__pagedReady=true;},9000);</script>";
  const source = html.includes("</body>")
    ? html.replace("</body>", readySnippet + "</body>")
    : html + readySnippet;

  try {
    const r = await fetch("https://api.pdfshift.io/v3/convert/pdf", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": key,
      },
      body: JSON.stringify({
        source,
        format: "A4",
        margin: "0",          // Ränder bringt paged.js bereits in die Seiten ein
        use_print: false,     // Bildschirm-Medium → paged.js-Layout wie in der App
        // Statt fixem delay: PDFShift pollt die globale Funktion b4yPdfReady()
        // (printDocument.ts setzt sie; true sobald paged.js fertig paginiert hat,
        // max. 30s). Kleine Dokumente werden dadurch DEUTLICH schneller gerendert,
        // große warten exakt so lange wie nötig (kein zu frühes Capturen mehr).
        wait_for: "b4yPdfReady",
        sandbox: false,
      }),
    });
    if (!r.ok) {
      // PDFShift-Fehler auf sinnvolle Client-Codes mappen, OHNE Secrets/Key durchzureichen:
      //  • 401/403 (PDFShift-Auth) → 401 für den Client = "Konfigurationsproblem" (Key ungültig)
      //  • 429 (PDFShift-Rate-Limit) → 429 = "zu viele Anfragen"
      //  • alles andere (5xx/Sonstiges) → 502 = "PDF-Dienst nicht erreichbar"
      // Der PDFShift-Antworttext wird NICHT an den Client gegeben (könnte Kontoinfos enthalten).
      const upstream = r.status;
      const status = (upstream === 401 || upstream === 403) ? 401
        : upstream === 429 ? 429
        : 502;
      const message = status === 401
        ? "PDF-Dienst nicht korrekt konfiguriert."
        : status === 429
        ? "PDF-Dienst überlastet. Bitte kurz warten und erneut versuchen."
        : "PDF-Dienst aktuell nicht erreichbar.";
      res.status(status).json({ error: message });
      return;
    }
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Cache-Control", "no-store");
    res.status(200).send(buf);
  } catch (e) {
    // Netz-/Timeout-Fehler beim Aufruf des PDF-Dienstes – Detail NICHT an den Client (keine Secrets/Stacktrace).
    res.status(502).json({ error: "PDF-Dienst aktuell nicht erreichbar." });
  }
}
