// ============================================================
// B4Y SuperAPP – KI-Assistent (Vercel Serverless Function, OpenAI)
// Serverseitige OpenAI-Anbindung + kontrolliertes Tool-/Function-Calling.
// Key nur via OPENAI_API_KEY env. Auth über Supabase-JWT.
//
// Sicherheit:
//  • Read-Tools (Level 1) werden serverseitig MIT DEM USER-TOKEN ausgeführt
//    → Supabase-RLS erzwingt Mandantentrennung & Sichtbarkeit automatisch.
//  • Schreibende/rechtlich relevante Aktionen (Level 2-4) sind NICHT als
//    ausführbare Tools freigegeben – die KI darf sie nur vorschlagen.
//  • Audit (ai_action_logs) + Usage (ai_usage_logs) via Service-Role.
// ============================================================
import { checkRateLimit } from "../_lib/security.js";

// 60 s statt 30 s: das Voice-Komplettangebot bittet die KI um bis zu 16 000
// Output-Tokens (komplexer Prompt + alle Gewerke kalkuliert). gpt-4o-mini
// braucht dafuer regelmaessig 30-45 s; bei 30 s schlug Vercel mit 504 zu
// (User-Beschwerde 2026-06-30 "Fehler: KI-Fehler (HTTP 504)").
// Der Hobby-Plan erlaubt 60 s, Pro bis 300 s — 60 s ist der sichere Mittel-
// wert und greift in beiden Plaenen.
export const config = { maxDuration: 60 };

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://xyhgckqxowqnzjtoblfs.supabase.co";
const SUPABASE_ANON = process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_akH66S1-i4WaHAbVrCd50A_qd7OrwfD";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const DEFAULT_SYSTEM =
  "Du bist der B4Y SuperAPP Assistent für eine Bau-, Handwerks- und Projektmanagement-App. " +
  "Du hilfst bei Projekten, Kontakten, Angeboten, Aufträgen, Rechnungen, Dokumenten, Aufgaben, Terminen, Planung und Einstellungen. " +
  "Antworte auf Deutsch, kurz, klar und praxisorientiert. Erfinde keine Daten. " +
  "Nutze für Suchen/Öffnen/Navigieren ausschließlich die bereitgestellten Tools. " +
  "Zum Öffnen eines Dokuments/Projekts/Kontakts per Name oder Nummer rufe zuerst das passende Such-Tool auf. " +
  "Zum Weiterführen eines Angebots zu einem Auftrag oder eines Auftrags zu einer Rechnung nutze die Vorschau-Tools " +
  "(continueOfferToOrderPreview / continueOrderToInvoicePreview): Diese führen NICHTS aus, sondern zeigen nur eine Vorschau, " +
  "die der Nutzer ausdrücklich bestätigen muss. Weitere schreibende, versendende oder löschende Aktionen sind NICHT verfügbar – " +
  "beschreibe in solchen Fällen nur die nötigen Schritte. " +
  "Entwürfe dürfen nicht als Grundlage für die nächste Dokumentstufe dienen. " +
  "Sicherheitsstufen (action_level): 1 Lesen/Suchen/Navigieren ohne Bestätigung; 2 Texte/Entwürfe vorbereiten – " +
  "diese gibst du als Vorschlag direkt im Chat aus und speicherst NICHTS in der Datenbank; 3+ Datenänderung/Finalisierung/" +
  "Senden/Löschen nur über Vorschau-Tools mit ausdrücklicher Bestätigung. " +
  // ── Der Nutzer soll nie suchen müssen: Weg nennen UND hinführen ──
  "WICHTIGSTE REGEL – der Nutzer soll nie selbst suchen müssen:\n" +
  "• Fragt jemand, WO etwas ist oder WIE er irgendwo hinkommt („wo finde ich die offenen Posten?“, „wie komme ich zu den Anfragen?“), " +
  "nenne in EINEM kurzen Satz den Weg im Menü (z. B. „Menü → Finanzen → Buchhaltung, Reiter ‚Offene Posten‘“) und rufe SOFORT navigateTo auf. " +
  "Nicht fragen, ob du hingehen sollst – einfach öffnen. Navigieren ändert keine Daten.\n" +
  "• Fragt jemand, WIE er etwas TUT („wie lege ich ein Projekt an?“, „wie plane ich einen Beitrag?“, „wie erfasse ich eine Eingangsrechnung?“), " +
  "und es gibt dafür eine Tour, dann rufe startTour auf – die App klickt den Weg dann vor. Beschreibe es NICHT nur.\n" +
  "• Gibt es keine passende Tour, antworte mit einer kurzen nummerierten Schrittfolge (max. 5 Schritte, jeder Schritt eine Zeile, " +
  "konkrete Buttonnamen in Anführungszeichen) und navigiere zusätzlich an den Startpunkt.\n" +
  "• Kennt der Nutzer den Fachbegriff nicht, übersetze in seine Worte: „Rechnungen, die WIR bekommen“ = Eingangsrechnungen (Buchhaltung); " +
  "„Geld, das uns Kunden schulden“ = Offene Posten; „Facebook-Beitrag“ = Marketing → Redaktionsplan; „Kundenanfragen“ = Anfragen.\n" +
  "• Der Leitstand (Firmen-Kennzahlen, Angebots-Pipeline, Mitarbeiter-Einteilung) ist Teil der Startseite und nur für Administratoren sichtbar – " +
  "es gibt keine eigene Cockpit-Seite mehr.\n" +
  "Sollst du Angebots-/Auftragstexte, E-Mails, Erinnerungen, Gesprächsnotizen, Logbucheinträge oder Berichte „vorbereiten“, " +
  "formuliere den Entwurf direkt als Text-Antwort (Stufe 2) – ohne zu speichern; das Speichern übernimmt der Nutzer.";

// ── Auth & Logging ─────────────────────────────────────────
async function verifyUser(token) {
  if (!token) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON } });
    if (!r.ok) return null;
    const u = await r.json();
    return u && u.id ? u : null;
  } catch { return null; }
}
async function logRow(table, row) {
  if (!SERVICE_KEY) return;
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
      method: "POST",
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
      body: JSON.stringify(row),
    });
  } catch { /* best-effort */ }
}

// ── Supabase-REST mit USER-Token (RLS greift) ──────────────
async function sbGet(path, token) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, { headers: { apikey: SUPABASE_ANON, Authorization: `Bearer ${token}` } });
  if (!r.ok) return [];
  return r.json().catch(() => []);
}
const clean = (s) => String(s || "").replace(/[(),*]/g, " ").trim();
const ilikePart = (col, term) => `${col}.ilike.*${encodeURIComponent(clean(term))}*`;
// Normalisiert wie DB-Spalte search_norm (lower, nur a-z0-9) → fehlertolerante
// Dokumentnummern unabhängig von Bindestrichen/Leerzeichen/Schreibweise.
const normTerm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");

// ── Routen-Helfer (Hash-Routing) ───────────────────────────
const KIND_ROUTE = { offer: "/angebote", order: "/auftraege", invoice: "/rechnungen" };
function docRoute(kind, id) { return KIND_ROUTE[kind] ? `${KIND_ROUTE[kind]}/${id}` : "/dokumente"; }
const NAV_TARGETS = {
  dashboard: "/", projects: "/projekte", contacts: "/kontakte", documents: "/dokumente",
  offers: "/dokumente?typ=angebote", orders: "/dokumente?typ=auftraege", invoices: "/dokumente?typ=rechnungen",
  calendar: "/einsatzplanung?ansicht=termine", planning: "/einsatzplanung?ansicht=termine", settings: "/einstellungen",
  email: "/email", accounting: "/buchhaltung", marketing: "/marketing",
  requests: "/anfragen", plantafel: "/einsatzplanung?ansicht=plan", employees: "/mitarbeiter",
  calculation: "/kalkulation", reports: "/auswertungen", automations: "/automationen",
  timesheets: "/stundenauswertung", myhours: "/meine-stunden", regie: "/regieberichte",
};
// Deutsche Anzeigenamen – der Nutzer darf nie den internen Schlüssel sehen.
const NAV_LABELS = {
  dashboard: "Übersicht", projects: "Projekte", contacts: "Kontakte", documents: "Dokumente",
  offers: "Angebote", orders: "Aufträge", invoices: "Rechnungen",
  calendar: "Einsatzplanung", planning: "Einsatzplanung", settings: "Einstellungen",
  email: "E-Mail", accounting: "Buchhaltung", marketing: "Marketing",
  requests: "Anfragen", plantafel: "Einsatzplanung (Plantafel)", employees: "Mitarbeiter",
  calculation: "Kalkulation", reports: "Auswertungen", automations: "Automationen",
  timesheets: "Stundenauswertung", myhours: "Meine Stunden", regie: "Regieberichte",
};
const DOCTYPE_TO_SLUG = {
  angebot: "angebote", angebote: "angebote", offer: "angebote",
  auftrag: "auftraege", auftraege: "auftraege", order: "auftraege",
  rechnung: "rechnungen", rechnungen: "rechnungen", invoice: "rechnungen",
};
const custName = (c) => c?.customer_type === "firma" ? (c.company || "Firma") : [c?.first_name, c?.last_name].filter(Boolean).join(" ") || c?.company || "Kontakt";

// ── Tool-Definitionen (OpenAI function-calling) ────────────
const TOOLS = [
  { type: "function", function: { name: "searchProjects", description: "Projekte nach Nummer, Betreff, Adresse/Ort oder Kundenname suchen.", parameters: { type: "object", properties: { query: { type: "string" }, customerName: { type: "string" }, status: { type: "string" }, limit: { type: "number" } } } } },
  { type: "function", function: { name: "openProject", description: "Ein konkretes Projekt per ID öffnen.", parameters: { type: "object", properties: { projectId: { type: "string" } }, required: ["projectId"] } } },
  { type: "function", function: { name: "searchDocuments", description: "Dokumente suchen: Angebote, Aufträge, Rechnungen. Filter nach Typ, Nummer, Kunde, Status.", parameters: { type: "object", properties: { documentType: { type: "string" }, number: { type: "string" }, query: { type: "string" }, customerName: { type: "string" }, status: { type: "string" }, limit: { type: "number" } } } } },
  { type: "function", function: { name: "openDocument", description: "Ein konkretes Dokument öffnen.", parameters: { type: "object", properties: { documentId: { type: "string" }, documentType: { type: "string" } }, required: ["documentId"] } } },
  { type: "function", function: { name: "searchContacts", description: "Kontakte/Kunden/Lieferanten nach Name oder E-Mail suchen.", parameters: { type: "object", properties: { query: { type: "string" }, contactType: { type: "string" } }, required: ["query"] } } },
  { type: "function", function: { name: "openContact", description: "Einen Kontakt per ID öffnen.", parameters: { type: "object", properties: { contactId: { type: "string" } }, required: ["contactId"] } } },
  { type: "function", function: { name: "navigateTo", description: "Zu einem App-Bereich navigieren.", parameters: { type: "object", properties: { target: { type: "string", enum: Object.keys(NAV_TARGETS) } }, required: ["target"] } } },
  { type: "function", function: { name: "continueOfferToOrderPreview", description: "Bereitet vor, aus einem ABGESCHLOSSENEN Angebot einen Auftrag zu erstellen. Zeigt nur eine Vorschau; Erstellung erst nach Bestätigung. Entwürfe sind nicht erlaubt. offerId weglassen, wenn gerade ein Angebot geöffnet ist.", parameters: { type: "object", properties: { offerId: { type: "string" } } } } },
  { type: "function", function: { name: "continueOrderToInvoicePreview", description: "Bereitet vor, aus einem Auftrag eine Rechnung zu erstellen. Nur Vorschau; Erstellung erst nach Bestätigung. orderId weglassen, wenn gerade ein Auftrag geöffnet ist.", parameters: { type: "object", properties: { orderId: { type: "string" } } } } },
  { type: "function", function: { name: "startTour", description: "Startet eine visuelle Schritt-für-Schritt-Schulung in der App (KI-Schulungsmodus mit virtuellem Cursor): die App scrollt, hebt hervor und klickt den Weg vor. Nutze dies IMMER, wenn der Nutzer wissen will, WIE etwas geht und eine passende Tour existiert (z. B. „Wie lege ich ein Projekt an?“, „Wie plane ich einen Beitrag?“, „Wie erfasse ich eine Eingangsrechnung?“). Es werden keine Daten geändert (Erklär-Modus).", parameters: { type: "object", properties: { tourId: { type: "string", enum: ["project-create", "marketing-post", "eingangsrechnung-erfassen"], description: "project-create = Projekt anlegen; marketing-post = Social-Beitrag mit KI planen; eingangsrechnung-erfassen = Eingangsrechnung in der Buchhaltung erfassen." } }, required: ["tourId"] } } },
];

// Verfügbare Touren (müssen den Definitionen in src/lib/ai-tour.ts entsprechen).
const TOUR_IDS = new Set(["project-create", "marketing-post", "eingangsrechnung-erfassen"]);

// ── Tool-Handler (alle Level 1 = lesend/navigieren) ────────
function variantToTarget(v, noun) {
  const s = `${v?.slug || ""} ${v?.name || ""}`.toLowerCase();
  const fam = s.includes("pausch") ? "Pauschal" : s.includes("regie") ? "Regie" : "Standard";
  return fam + noun; // z. B. "Standardauftrag", "Pauschalrechnung"
}

async function runTool(name, args, token, context) {
  const limit = Math.min(Math.max(Number(args.limit) || 8, 1), 12);

  if (name === "continueOfferToOrderPreview") {
    const offerId = args.offerId || context?.offerId;
    if (!offerId) return { type: "message", message: "Bitte öffne zuerst das Angebot oder nenne die Angebotsnummer." };
    const rows = await sbGet(`offers?select=id,number,status,contact_id,project_id,gross,offer_type_id&id=eq.${encodeURIComponent(offerId)}&deleted_at=is.null&limit=1`, token);
    if (!rows.length) return { type: "error", message: "Angebot nicht gefunden oder kein Zugriff." };
    const o = rows[0];
    if (String(o.status || "").toLowerCase() === "entwurf")
      return { type: "message", message: "Dieses Angebot ist noch ein Entwurf. Es muss zuerst abgeschlossen werden, bevor daraus ein Auftrag erstellt werden kann." };
    let customer = "–";
    if (o.contact_id) { const cs = await sbGet(`contacts?select=company,first_name,last_name,customer_type&id=eq.${o.contact_id}&limit=1`, token); if (cs[0]) customer = custName(cs[0]); }
    let variant = null;
    if (o.offer_type_id) { const vs = await sbGet(`offer_types?select=name,slug&id=eq.${o.offer_type_id}&limit=1`, token); if (vs[0]) variant = vs[0]; }
    return {
      type: "confirmation_required", _level: 3, _target: "angebot", _id: o.id,
      message: `Ich kann aus Angebot ${o.number || ""} einen Auftrag vorbereiten. Bitte prüfe die Vorschau und bestätige.`,
      preview: { title: `Auftrag aus Angebot ${o.number || ""}`, rows: [["Angebot", o.number || o.id], ["Kunde", customer], ["Summe (brutto)", o.gross != null ? eur(o.gross) : "–"], ["Zielvariante", variantToTarget(variant, "auftrag")]] },
      action: { kind: "offerToOrder", offerId: o.id },
    };
  }

  if (name === "continueOrderToInvoicePreview") {
    const orderId = args.orderId || context?.orderId;
    if (!orderId) return { type: "message", message: "Bitte öffne zuerst den Auftrag oder nenne die Auftragsnummer." };
    const rows = await sbGet(`orders?select=id,order_number,status,contact_id,project_id,gross,offer_type_id&id=eq.${encodeURIComponent(orderId)}&deleted_at=is.null&limit=1`, token);
    if (!rows.length) return { type: "error", message: "Auftrag nicht gefunden oder kein Zugriff." };
    const o = rows[0];
    if (["entwurf", "storniert", "archiviert"].includes(String(o.status || "").toLowerCase()))
      return { type: "message", message: `Aus diesem Auftrag (Status: ${o.status}) kann keine Rechnung erstellt werden.` };
    let customer = "–";
    if (o.contact_id) { const cs = await sbGet(`contacts?select=company,first_name,last_name,customer_type&id=eq.${o.contact_id}&limit=1`, token); if (cs[0]) customer = custName(cs[0]); }
    let variant = null;
    if (o.offer_type_id) { const vs = await sbGet(`offer_types?select=name,slug&id=eq.${o.offer_type_id}&limit=1`, token); if (vs[0]) variant = vs[0]; }
    return {
      type: "confirmation_required", _level: 3, _target: "auftrag", _id: o.id,
      message: `Ich kann aus Auftrag ${o.order_number || ""} eine Rechnung vorbereiten. Bitte prüfe die Vorschau und bestätige.`,
      preview: { title: `Rechnung aus Auftrag ${o.order_number || ""}`, rows: [["Auftrag", o.order_number || o.id], ["Kunde", customer], ["Summe (brutto)", o.gross != null ? eur(o.gross) : "–"], ["Zielvariante", variantToTarget(variant, "rechnung")]] },
      action: { kind: "orderToInvoice", orderId: o.id },
    };
  }

  if (name === "startTour") {
    const tourId = String(args.tourId || "");
    if (!TOUR_IDS.has(tourId)) return { type: "message", message: "Für diese Funktion gibt es noch keine Schulung. Ich kann es dir aber in Worten erklären." };
    return { type: "start_tour", tourId, _level: 1, _target: "tour", message: "Ich starte die Schulung in der App – folge dem Cursor." };
  }

  if (name === "navigateTo") {
    const route = NAV_TARGETS[args.target];
    if (!route) return { type: "message", message: "Diesen Bereich kenne ich nicht." };
    const label = NAV_LABELS[args.target] || args.target;
    return { type: "navigate", route, message: `Ich öffne „${label}“.`, _target: args.target };
  }

  if (name === "searchProjects") {
    let contactIds = [];
    if (args.customerName) {
      const cs = await sbGet(`contacts?select=id&or=(${ilikePart("company", args.customerName)},${ilikePart("last_name", args.customerName)},${ilikePart("first_name", args.customerName)})&limit=20`, token);
      contactIds = cs.map((c) => c.id);
    }
    let q = `projects?select=id,project_number,title,street,zip,city,stage,contact_id&order=created_at.desc&limit=${limit}`;
    if (args.query) q += `&or=(${ilikePart("title", args.query)},${ilikePart("project_number", args.query)},${ilikePart("city", args.query)},${ilikePart("street", args.query)})`;
    if (contactIds.length) q += `&contact_id=in.(${contactIds.join(",")})`;
    if (!args.query && !contactIds.length && args.status) q += `&${ilikePart("stage", args.status)}`;
    const rows = await sbGet(q, token);
    // Kundennamen nachladen
    const cids = [...new Set(rows.map((r) => r.contact_id).filter(Boolean))];
    let cmap = {};
    if (cids.length) { const cs = await sbGet(`contacts?select=id,company,first_name,last_name,customer_type&id=in.(${cids.join(",")})`, token); cs.forEach((c) => { cmap[c.id] = custName(c); }); }
    const items = rows.map((r) => ({
      id: r.id, title: `${r.project_number ? r.project_number + " · " : ""}${r.title || "Projekt"}`,
      subtitle: [cmap[r.contact_id], [r.zip, r.city].filter(Boolean).join(" ")].filter(Boolean).join(" · "),
      route: `/projekte/${r.id}`, kind: "Projekt",
    }));
    return packResults(items, "Projekt");
  }

  if (name === "openProject") {
    const rows = await sbGet(`projects?select=id,title,project_number&id=eq.${encodeURIComponent(args.projectId)}&limit=1`, token);
    if (!rows.length) return { type: "error", message: "Projekt nicht gefunden oder kein Zugriff." };
    return { type: "navigate", route: `/projekte/${rows[0].id}`, message: `Ich öffne Projekt ${rows[0].project_number || rows[0].title || ""}.`, _target: "projekte", _id: rows[0].id };
  }

  if (name === "searchDocuments") {
    let q = `documents_unified?select=id,kind,type_slug,type_name,variant_name,doc_number,status_norm,project_number,customer_name,net,gross,created_at&order=last_change.desc&limit=${limit}`;
    const slug = args.documentType ? DOCTYPE_TO_SLUG[String(args.documentType).toLowerCase()] : null;
    if (slug) q += `&type_slug=eq.${slug}`;
    if (args.number) {
      // Dokumentnummer fehlertolerant (Bindestriche/Leerzeichen/Schreibweise egal)
      const n = normTerm(args.number);
      if (n) q += `&search_norm.ilike.*${encodeURIComponent(n)}*`;
    }
    if (args.query) {
      // Volltext ODER normalisiert (Namen/Titel + Nummern)
      const raw = clean(args.query);
      const nq = normTerm(args.query);
      const parts = [];
      if (raw) parts.push(`search_text.ilike.*${encodeURIComponent(raw)}*`);
      if (nq) parts.push(`search_norm.ilike.*${encodeURIComponent(nq)}*`);
      if (parts.length) q += `&or=(${parts.join(",")})`;
    }
    if (args.customerName) q += `&${ilikePart("customer_name", args.customerName)}`;
    if (args.status) {
      const s = String(args.status).toLowerCase();
      if (s === "offen") q += `&status_norm=in.(abgeschlossen,versendet,teilbezahlt,ueberfaellig)`;
      else q += `&${ilikePart("status_norm", s)}`;
    }
    const rows = await sbGet(q, token);
    const items = rows.map((r) => ({
      id: r.id, title: `${r.doc_number || r.type_name}${r.variant_name ? " · " + r.variant_name : ""}`,
      subtitle: [r.type_name, r.customer_name, r.project_number, r.gross != null ? eur(r.gross) : null, r.status_norm].filter(Boolean).join(" · "),
      route: docRoute(r.kind, r.id), kind: "Dokument",
    }));
    return packResults(items, "Dokument");
  }

  if (name === "openDocument") {
    const rows = await sbGet(`documents_unified?select=id,kind,doc_number,type_name&id=eq.${encodeURIComponent(args.documentId)}&limit=1`, token);
    if (!rows.length) return { type: "error", message: "Dokument nicht gefunden oder kein Zugriff." };
    return { type: "navigate", route: docRoute(rows[0].kind, rows[0].id), message: `Ich öffne ${rows[0].doc_number || rows[0].type_name}.`, _target: "dokument", _id: rows[0].id };
  }

  if (name === "searchContacts") {
    const rows = await sbGet(`contacts?select=id,company,first_name,last_name,email,mobile,customer_type,type&or=(${ilikePart("company", args.query)},${ilikePart("last_name", args.query)},${ilikePart("first_name", args.query)},${ilikePart("email", args.query)})&order=created_at.desc&limit=${limit}`, token);
    const items = rows.map((r) => ({
      id: r.id, title: custName(r),
      subtitle: [r.email, r.mobile].filter(Boolean).join(" · "),
      route: `/kontakte/${r.id}`, kind: "Kontakt",
    }));
    return packResults(items, "Kontakt");
  }

  if (name === "openContact") {
    const rows = await sbGet(`contacts?select=id,company,first_name,last_name,customer_type&id=eq.${encodeURIComponent(args.contactId)}&limit=1`, token);
    if (!rows.length) return { type: "error", message: "Kontakt nicht gefunden oder kein Zugriff." };
    return { type: "navigate", route: `/kontakte/${rows[0].id}`, message: `Ich öffne ${custName(rows[0])}.`, _target: "kontakt", _id: rows[0].id };
  }

  return { type: "message", message: "Unbekanntes Tool." };
}

function eur(n) { try { return new Intl.NumberFormat("de-AT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(Number(n) || 0); } catch { return String(n); } }

function packResults(items, label) {
  if (!items.length) return { type: "message", message: `Ich habe nichts Passendes gefunden (${label}).` };
  if (items.length === 1) return { type: "navigate", route: items[0].route, message: `Ich öffne: ${items[0].title}`, _id: items[0].id };
  return { type: "selection_required", message: `Ich habe mehrere Treffer gefunden – welchen möchtest du öffnen?`, items };
}

// ── Handler ────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "Nur POST erlaubt." }); return; }
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const user = await verifyUser(token);
  if (!user) { res.status(401).json({ error: "Nicht angemeldet." }); return; }
  if (!checkRateLimit(user.id)) { res.status(429).json({ type: "error", error: "Zu viele Anfragen. Bitte kurz warten." }); return; }

  let body;
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : req.body; } catch { body = null; }
  const messages = body && Array.isArray(body.messages) ? body.messages : null;
  const systemIn = (body && body.system) || "";
  const context = (body && body.context) || null;
  const route = (body && body.route) || (context && context.route) || null;
  if (!messages || messages.length === 0) { res.status(400).json({ error: "messages (Array) ist erforderlich." }); return; }

  // ── JSON-Modus-Detektion (Voice-Pipeline) ──────────────────
  // Client kann explizit response_format/responseFormat angeben, oder es wird
  // automatisch anhand des System-Prompts erkannt (KOMPLETT_ANGEBOT / MODUS_1).
  const rawRf = (body && (body.response_format ?? body.responseFormat)) ?? null;
  let rfType = null;
  if (typeof rawRf === "string") rfType = rawRf;
  else if (rawRf && typeof rawRf === "object" && typeof rawRf.type === "string") rfType = rawRf.type;
  const explicitJson = rfType === "json" || rfType === "json_object";
  const autoJson = !!(systemIn && (systemIn.includes("KOMPLETT_ANGEBOT") || systemIn.includes("MODUS_1")));
  const jsonMode = explicitJson || autoJson;

  // max_tokens-Override (nur sinnvoll für JSON-Modus, Tool-Pfad behält 800).
  const OPENAI_MAX_TOKENS_LIMIT = 16000;
  let requestedMaxTokens = null;
  if (body && (body.max_tokens != null || body.maxTokens != null)) {
    const n = Number(body.max_tokens ?? body.maxTokens);
    if (Number.isFinite(n) && n > 0) requestedMaxTokens = Math.floor(n);
  }
  if (requestedMaxTokens != null && requestedMaxTokens > OPENAI_MAX_TOKENS_LIMIT) {
    res.status(400).json({ type: "error", error: `max_tokens darf maximal ${OPENAI_MAX_TOKENS_LIMIT} sein (angefragt: ${requestedMaxTokens}).` });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { res.status(503).json({ error: "Die KI ist noch nicht verbunden (OPENAI_API_KEY fehlt)." }); return; }

  // Im JSON-Modus verzichten wir auf den App-Default-System-Prompt (Tool-Anweisungen
  // wären nur Ballast und kontraproduktiv). Nur der vom Client übergebene Prompt zählt.
  let system = jsonMode
    ? (systemIn || DEFAULT_SYSTEM)
    : `${DEFAULT_SYSTEM}${systemIn ? "\n\n" + systemIn : ""}`;
  if (!jsonMode && context && typeof context === "object") {
    const parts = [];
    if (context.area) parts.push(`Aktueller Bereich: ${context.area}`);
    if (context.route) parts.push(`Route: ${context.route}`);
    if (context.project) parts.push(`Aktuelles Projekt (ID): ${context.project}`);
    if (context.offerId) parts.push(`Aktuell geöffnetes Angebot (ID): ${context.offerId} – nutze dieses, wenn der Nutzer „dieses Angebot" meint.`);
    if (context.orderId) parts.push(`Aktuell geöffneter Auftrag (ID): ${context.orderId} – nutze diesen, wenn der Nutzer „diesen Auftrag" meint.`);
    if (parts.length) system += `\n\nApp-Kontext:\n${parts.join("\n")}`;
  }
  const oaMessages = [{ role: "system", content: system },
    ...messages.filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string").map((m) => ({ role: m.role, content: m.content }))];
  const model = process.env.OPENAI_CHAT_MODEL || "gpt-4o-mini";
  const lastUser = [...messages].reverse().find((m) => m.role === "user")?.content || "";

  // Request-Body bauen: JSON-Modus (Voice) ohne Tools, Default-Modus (Isabella) mit Tools.
  const oaBody = jsonMode
    ? {
        model,
        messages: oaMessages,
        max_tokens: requestedMaxTokens ?? 16000,
        temperature: 0.3,
        response_format: { type: "json_object" },
      }
    : {
        model,
        messages: oaMessages,
        tools: TOOLS,
        tool_choice: "auto",
        max_tokens: requestedMaxTokens ?? 800,
        temperature: 0.3,
      };

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(oaBody),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = data?.error?.message || `OpenAI-Fehler (HTTP ${r.status}).`;
      await logRow("ai_usage_logs", { user_id: user.id, action_type: "chat", model, provider: "openai", success: false, error: msg.slice(0, 300), route });
      res.status(502).json({ type: "error", error: "Die KI konnte gerade nicht antworten. Bitte später erneut versuchen." });
      return;
    }
    const usage = data?.usage || null;
    const choice = data?.choices?.[0]?.message;
    const toolCall = choice?.tool_calls?.[0];

    // JSON-Modus: Tool-Loop überspringen, Text direkt zurückgeben.
    if (jsonMode) {
      const text = (choice?.content || "").trim();
      await logRow("ai_usage_logs", { user_id: user.id, action_type: "chat", model, provider: "openai", input_length: lastUser.length, output_length: text.length, tokens_input: usage?.prompt_tokens ?? null, tokens_output: usage?.completion_tokens ?? null, success: true, route });
      res.status(200).json({ type: "message", message: text, text });
      return;
    }

    if (toolCall?.function?.name) {
      let args = {};
      try { args = JSON.parse(toolCall.function.arguments || "{}"); } catch { args = {}; }
      let result;
      try { result = await runTool(toolCall.function.name, args, token, context); }
      catch { result = { type: "error", message: "Aktion konnte nicht ausgeführt werden." }; }
      const needsConfirm = result.type === "confirmation_required";
      await logRow("ai_usage_logs", { user_id: user.id, action_type: "tool", model, provider: "openai", input_length: lastUser.length, tokens_input: usage?.prompt_tokens ?? null, tokens_output: usage?.completion_tokens ?? null, success: result.type !== "error", route });
      await logRow("ai_action_logs", {
        user_id: user.id, user_input_summary: String(lastUser).slice(0, 200), tool_name: toolCall.function.name,
        tool_arguments_summary: JSON.stringify(args).slice(0, 300), action_level: result._level || 1,
        target_type: result._target || null, target_id: result._id ? String(result._id) : null,
        status: result.type === "error" ? "error" : needsConfirm ? "needs_confirmation" : "ok",
        confirmation_required: needsConfirm,
        error_message: result.type === "error" ? (result.message || "").slice(0, 300) : null,
      });
      delete result._target; delete result._id; delete result._level;
      res.status(200).json(result);
      return;
    }

    const text = (choice?.content || "").trim();
    await logRow("ai_usage_logs", { user_id: user.id, action_type: "chat", model, provider: "openai", input_length: lastUser.length, output_length: text.length, tokens_input: usage?.prompt_tokens ?? null, tokens_output: usage?.completion_tokens ?? null, success: true, route });
    res.status(200).json({ type: "message", message: text, text });
  } catch (e) {
    res.status(500).json({ type: "error", error: "Die KI konnte gerade nicht antworten. Bitte später erneut versuchen." });
  }
}
