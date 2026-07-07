// ============================================================
// B4Y SuperAPP – Globale Suche (zentrale, erweiterbare Such-Logik)
// ============================================================
// Architektur:
//  - Rein client-seitig über den bestehenden Supabase-Client.
//  - Sicherheit (Mandant/Rechte/Soft-Delete) wird vollständig durch
//    die RLS-Policies erzwungen (org_isolation, sel = b4y_has_permission,
//    hide_soft_deleted). Zusätzlich filtern wir client-seitig pro Quelle
//    über can(modul,'view') → keine unnötigen Abfragen.
//  - Jede durchsuchbare Datenquelle ist ein Eintrag in SOURCES. Neue
//    Module später = einfach einen weiteren SearchSource ergänzen.
//  - Vorbereitet für eine spätere DB-RPC (unaccent + pg_trgm) für echte
//    Umlaut-/Tippfehler-Toleranz, ohne die UI ändern zu müssen.
// ============================================================
import { supabase } from "./supabase";
import { eur, dateAt } from "./format";
import { OFFER_STATUS_LABEL } from "./offer-types";
import { ORDER_STATUS_LABEL } from "./types";
import { INVOICE_DOC_STATUS_LABEL } from "./invoice-types";
import { contactDisplayName } from "./contact-name";
import { docPath } from "./documents-overview";

// ---------- Einheitliche Ergebnis-Struktur ----------
export type SearchResultType =
  | "project"
  | "customer"
  | "supplier"
  | "subcontractor"
  | "contact"
  | "contact_person"
  | "offer"
  | "order"
  | "invoice"
  | "document"
  | "employee"
  | "service"
  | "article"
  | "trade"
  | "unit";

export interface SearchResult {
  id: string;
  type: SearchResultType;
  group: string; // Anzeigegruppe (z. B. "Projekte")
  title: string; // Hauptbezeichnung
  subtitle?: string; // Zusatzinfo (Nummer, Kunde, Adresse …)
  description?: string; // optionaler längerer Text
  route: string; // direkte Verlinkung zum Datensatz
  status?: string; // Status-Label
  date?: string; // formatiertes Datum
  amount?: string; // formatierter Betrag
  tenantId?: string | null;
  score: number; // Relevanz (höher = besser)
}

export interface PermLike {
  isAdmin: boolean;
  can: (moduleKey: string, action?: string) => boolean;
}

interface SearchSource {
  /** Permission-Modul, das Zugriff erlaubt (RLS-konsistent). */
  module: string;
  /** Führt die Suche für diese Quelle aus und liefert bereits bewertete Treffer. */
  run: (tokens: string[], rawQuery: string) => Promise<SearchResult[]>;
}

// Feste Reihenfolge der Ergebnisgruppen in der Anzeige.
export const GROUP_ORDER = [
  "Projekte",
  "Kunden",
  "Lieferanten",
  "Subunternehmer",
  "Ansprechpartner",
  "Angebote",
  "Aufträge",
  "Rechnungen",
  "Dokumente",
  "Mitarbeiter",
  "Leistungen",
  "Artikel",
  "Gewerke",
  "Einheiten",
  "Kontakte",
];

export interface SearchGroupResult {
  group: string;
  results: SearchResult[];
}

const RAW_LIMIT = 24; // pro Quelle aus der DB holen
export const GROUP_LIMIT = 8; // pro Gruppe anzeigen
const MIN_QUERY = 2; // ab wievielen Zeichen gesucht wird

// ---------- Token-Aufbereitung ----------
/**
 * Zerlegt die Eingabe in Tokens, kleinschreibt sie und entfernt Zeichen,
 * die die PostgREST-`or()`-Syntax brechen würden (Kommas, Klammern, Wildcards).
 */
export function sanitizeTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[,*%()\\]/g, "").trim())
    .filter((t) => t.length >= MIN_QUERY);
}

/** PostgREST-`or()`-Filter über mehrere Felder für EIN Token (Wildcard = *). */
function orFilter(fields: string[], token: string): string {
  return fields.map((f) => `${f}.ilike.*${token}*`).join(",");
}

/**
 * Baut eine Supabase-Query: jedes Token muss in mindestens einem Feld
 * vorkommen (mehrere .or()-Aufrufe werden von PostgREST mit UND verknüpft).
 */
function applyTokens(builder: any, fields: string[], tokens: string[]) {
  let q = builder;
  for (const token of tokens) q = q.or(orFilter(fields, token));
  return q.limit(RAW_LIMIT);
}

// ---------- Relevanz-Scoring ----------
interface ScoreInput {
  number?: string | null; // Nummern-Feld (Projektnr., Dok.-Nr. …)
  title: string; // Hauptbezeichnung
  haystack: string; // alle durchsuchbaren Texte zusammengefügt
  archived?: boolean; // archiviert/inaktiv → Abwertung
  dateMs?: number | null; // Aktualität → leichte Aufwertung
}

function scoreRow(rawQuery: string, tokens: string[], inp: ScoreInput): number {
  const ql = rawQuery.toLowerCase().trim();
  const title = (inp.title || "").toLowerCase();
  const num = (inp.number || "").toLowerCase();
  const hay = (inp.haystack || "").toLowerCase();
  let s = 0;

  if (num) {
    if (num === ql) s += 1000;
    else if (num.startsWith(ql)) s += 650;
    else if (num.includes(ql)) s += 400;
    else if (tokens.some((t) => num.includes(t))) s += 250;
  }
  if (title === ql) s += 500;
  else if (title.startsWith(ql)) s += 320;
  else if (title.includes(ql)) s += 180;

  // Token-Abdeckung: Bezeichnung höher gewichtet als sonstige Felder
  s += tokens.filter((t) => title.includes(t)).length * 30;
  s += tokens.filter((t) => hay.includes(t)).length * 8;

  if (inp.archived) s -= 40; // aktive vor archivierten
  if (inp.dateMs) {
    // neuere vor älteren
    const days = (Date.now() - inp.dateMs) / 86_400_000;
    s += Math.max(0, 15 - days / 30);
  }
  return s;
}

const ms = (d?: string | null) => (d ? new Date(d).getTime() : null);
const join = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(" ");

/** Anzeigename eines Kontakts (Firma vs. Person). */
function contactName(c: any): string {
  if (!c) return "";
  return contactDisplayName(c, { fallback: "Kontakt" });
}

const CONTACT_GROUP: Record<string, { group: string; type: SearchResultType }> = {
  kunde: { group: "Kunden", type: "customer" },
  lieferant: { group: "Lieferanten", type: "supplier" },
  subunternehmer: { group: "Subunternehmer", type: "subcontractor" },
};

// ============================================================
// Quellen-Registry
// ============================================================
const SOURCES: SearchSource[] = [
  // ----- Projekte -----
  {
    module: "projects",
    run: async (tokens, raw) => {
      const fields = [
        "project_number",
        "title",
        "street",
        "city",
        "zip",
        "description",
        "category",
        "internal_note",
      ];
      const { data, error } = await applyTokens(
        supabase
          .from("projects")
          .select(
            "id,project_number,title,street,zip,city,description,category,stage,archived,updated_at,organization_id"
          ),
        fields,
        tokens
      );
      if (error || !data) return [];
      return data.map((p: any): SearchResult => {
        const addr = join(p.street, [p.zip, p.city].filter(Boolean).join(" "));
        return {
          id: p.id,
          type: "project",
          group: "Projekte",
          title: p.title || p.project_number || "Projekt",
          subtitle: join(p.project_number, addr && `· ${addr}`),
          description: p.description || undefined,
          route: `/projekte/${p.id}`,
          status: p.stage || undefined,
          tenantId: p.organization_id,
          score:
            scoreRow(raw, tokens, {
              number: p.project_number,
              title: p.title || "",
              haystack: join(p.project_number, p.title, addr, p.description, p.category),
              archived: !!p.archived,
              dateMs: ms(p.updated_at),
            }) + (p.project_number ? 0 : -5),
        };
      });
    },
  },

  // ----- Kontakte (Kunden / Lieferanten / Subunternehmer / Sonstige) -----
  {
    module: "contacts",
    run: async (tokens, raw) => {
      const fields = [
        "company",
        "first_name",
        "last_name",
        "contact_number",
        "customer_number",
        "email",
        "invoice_email",
        "phone",
        "mobile",
        "street",
        "city",
        "zip",
        "uid_number",
        "website",
        "notes",
      ];
      const { data, error } = await applyTokens(
        supabase
          .from("contacts")
          .select(
            "id,type,customer_type,company,first_name,last_name,contact_number,customer_number,email,phone,mobile,street,zip,city,uid_number,website,notes,status,updated_at,organization_id"
          ),
        fields,
        tokens
      );
      if (error || !data) return [];
      return data.map((c: any): SearchResult => {
        const map = CONTACT_GROUP[c.type] || { group: "Kontakte", type: "contact" as SearchResultType };
        const addr = join(c.street, [c.zip, c.city].filter(Boolean).join(" "));
        const title = contactName(c);
        return {
          id: c.id,
          type: map.type,
          group: map.group,
          title,
          subtitle: join(c.contact_number, c.email, c.phone || c.mobile, addr && `· ${addr}`),
          route: `/kontakte/${c.id}`,
          status: c.status || undefined,
          tenantId: c.organization_id,
          score: scoreRow(raw, tokens, {
            number: c.contact_number,
            title,
            haystack: join(
              c.company,
              c.first_name,
              c.last_name,
              c.contact_number,
              c.customer_number,
              c.email,
              c.phone,
              c.mobile,
              addr,
              c.uid_number,
              c.website
            ),
            dateMs: ms(c.updated_at),
          }),
        };
      });
    },
  },

  // ----- Ansprechpartner -----
  {
    module: "contacts",
    run: async (tokens, raw) => {
      const fields = ["first_name", "last_name", "function", "email", "phone", "mobile"];
      const { data, error } = await applyTokens(
        supabase
          .from("contact_persons")
          .select(
            "id,contact_id,salutation,title,first_name,last_name,function,email,phone,mobile,organization_id"
          ),
        fields,
        tokens
      );
      if (error || !data) return [];
      return data.map((p: any): SearchResult => {
        const title = join(p.title, p.first_name, p.last_name).trim() || "Ansprechpartner";
        return {
          id: p.id,
          type: "contact_person",
          group: "Ansprechpartner",
          title,
          subtitle: join(p.function, p.email, p.phone || p.mobile),
          route: `/kontakte/${p.contact_id}`,
          tenantId: p.organization_id,
          score: scoreRow(raw, tokens, {
            title,
            haystack: join(p.first_name, p.last_name, p.function, p.email, p.phone, p.mobile),
          }),
        };
      });
    },
  },

  // ----- Angebote -----
  {
    module: "offers",
    run: async (tokens, raw) => {
      const fields = ["number", "title", "notes"];
      const { data, error } = await applyTokens(
        supabase
          .from("offers")
          .select(
            "id,number,title,status,gross,created_at,organization_id,proj:projects(project_number,title),kontakt:contacts(company,first_name,last_name,customer_type)"
          ),
        fields,
        tokens
      );
      if (error || !data) return [];
      return data.map(
        (o: any): SearchResult => ({
          id: o.id,
          type: "offer",
          group: "Angebote",
          title: join(o.number, o.title && `– ${o.title}`) || "Angebot",
          subtitle: join(contactName(o.kontakt), o.proj?.project_number && `· ${o.proj.project_number}`),
          route: docPath("offer", o.id, o.number),
          status: OFFER_STATUS_LABEL[o.status as keyof typeof OFFER_STATUS_LABEL] || o.status || undefined,
          amount: o.gross != null ? eur(o.gross) : undefined,
          date: dateAt(o.created_at),
          tenantId: o.organization_id,
          score: scoreRow(raw, tokens, {
            number: o.number,
            title: o.title || o.number || "",
            haystack: join(o.number, o.title, contactName(o.kontakt), o.proj?.title),
            dateMs: ms(o.created_at),
          }),
        })
      );
    },
  },

  // ----- Aufträge -----
  {
    module: "orders",
    run: async (tokens, raw) => {
      const fields = ["order_number", "title", "internal_note"];
      const { data, error } = await applyTokens(
        supabase
          .from("orders")
          .select(
            "id,order_number,title,status,gross,order_date,created_at,organization_id,proj:projects(project_number,title),kontakt:contacts(company,first_name,last_name,customer_type)"
          ),
        fields,
        tokens
      );
      if (error || !data) return [];
      return data.map(
        (o: any): SearchResult => ({
          id: o.id,
          type: "order",
          group: "Aufträge",
          title: join(o.order_number, o.title && `– ${o.title}`) || "Auftrag",
          subtitle: join(contactName(o.kontakt), o.proj?.project_number && `· ${o.proj.project_number}`),
          route: docPath("order", o.id, o.order_number),
          status: ORDER_STATUS_LABEL[o.status] || o.status || undefined,
          amount: o.gross != null ? eur(o.gross) : undefined,
          date: dateAt(o.order_date || o.created_at),
          tenantId: o.organization_id,
          score: scoreRow(raw, tokens, {
            number: o.order_number,
            title: o.title || o.order_number || "",
            haystack: join(o.order_number, o.title, contactName(o.kontakt), o.proj?.title),
            dateMs: ms(o.order_date || o.created_at),
          }),
        })
      );
    },
  },

  // ----- Rechnungen -----
  {
    module: "invoices",
    run: async (tokens, raw) => {
      const fields = ["number", "title", "notes"];
      const { data, error } = await applyTokens(
        supabase
          .from("invoices")
          .select(
            "id,number,title,doc_status,payment_status,gross,invoice_date,created_at,organization_id,proj:projects(project_number,title),kontakt:contacts(company,first_name,last_name,customer_type)"
          ),
        fields,
        tokens
      );
      if (error || !data) return [];
      return data.map(
        (i: any): SearchResult => ({
          id: i.id,
          type: "invoice",
          group: "Rechnungen",
          title: join(i.number, i.title && `– ${i.title}`) || "Rechnung",
          subtitle: join(contactName(i.kontakt), i.proj?.project_number && `· ${i.proj.project_number}`),
          route: docPath("invoice", i.id, i.number),
          status: INVOICE_DOC_STATUS_LABEL[i.doc_status] || i.doc_status || i.payment_status || undefined,
          amount: i.gross != null ? eur(i.gross) : undefined,
          date: dateAt(i.invoice_date || i.created_at),
          tenantId: i.organization_id,
          score: scoreRow(raw, tokens, {
            number: i.number,
            title: i.title || i.number || "",
            haystack: join(i.number, i.title, contactName(i.kontakt), i.proj?.title),
            dateMs: ms(i.invoice_date || i.created_at),
          }),
        })
      );
    },
  },

  // ----- Dokumente -----
  {
    module: "documents",
    run: async (tokens, raw) => {
      const fields = ["document_number", "title", "subject", "sender", "recipient", "note", "file_name"];
      const { data, error } = await applyTokens(
        supabase
          .from("documents")
          .select(
            "id,document_number,title,subject,sender,recipient,note,file_name,status,doc_date,created_at,project_id,customer_id,organization_id,dtype:document_types(name)"
          ),
        fields,
        tokens
      );
      if (error || !data) return [];
      return data.map((d: any): SearchResult => {
        // Keine eigene Dokument-Route → auf Projekt bzw. Kontakt verlinken.
        const route = d.project_id
          ? `/projekte/${d.project_id}`
          : d.customer_id
            ? `/kontakte/${d.customer_id}`
            : "/";
        const title = d.title || d.document_number || d.subject || d.file_name || "Dokument";
        return {
          id: d.id,
          type: "document",
          group: "Dokumente",
          title,
          subtitle: join(d.dtype?.name, d.document_number),
          description: d.subject || undefined,
          route,
          status: d.status || undefined,
          date: dateAt(d.doc_date || d.created_at),
          tenantId: d.organization_id,
          score: scoreRow(raw, tokens, {
            number: d.document_number,
            title,
            haystack: join(
              d.document_number,
              d.title,
              d.subject,
              d.sender,
              d.recipient,
              d.dtype?.name,
              d.file_name
            ),
            dateMs: ms(d.doc_date || d.created_at),
          }),
        };
      });
    },
  },

  // ----- Mitarbeiter -----
  {
    module: "employees",
    run: async (tokens, raw) => {
      const fields = [
        "first_name",
        "last_name",
        "personnel_number",
        "position",
        "email",
        "phone",
        "mobile",
        "city",
      ];
      const { data, error } = await applyTokens(
        supabase
          .from("employees")
          .select(
            "id,first_name,last_name,personnel_number,position,email,phone,mobile,city,active,updated_at,organization_id"
          ),
        fields,
        tokens
      );
      if (error || !data) return [];
      return data.map((e: any): SearchResult => {
        const title = join(e.first_name, e.last_name).trim() || "Mitarbeiter";
        return {
          id: e.id,
          type: "employee",
          group: "Mitarbeiter",
          title,
          subtitle: join(e.personnel_number, e.position, e.email),
          route: `/mitarbeiter/${e.id}`,
          tenantId: e.organization_id,
          score: scoreRow(raw, tokens, {
            number: e.personnel_number,
            title,
            haystack: join(
              e.first_name,
              e.last_name,
              e.personnel_number,
              e.position,
              e.email,
              e.phone,
              e.mobile
            ),
            archived: e.active === false,
            dateMs: ms(e.updated_at),
          }),
        };
      });
    },
  },

  // ----- Leistungen -----
  {
    module: "kalkulation",
    run: async (tokens, raw) => {
      const fields = [
        "service_number",
        "name",
        "short_text",
        "long_text",
        "category",
        "internal_name",
        "positions_nummer",
      ];
      const { data, error } = await applyTokens(
        supabase
          .from("services")
          .select("id,service_number,name,short_text,category,unit,active,updated_at,organization_id"),
        fields,
        tokens
      );
      if (error || !data) return [];
      return data.map(
        (s: any): SearchResult => ({
          id: s.id,
          type: "service",
          group: "Leistungen",
          title: s.name || s.service_number || "Leistung",
          subtitle: join(s.service_number, s.category, s.unit && `· ${s.unit}`),
          description: s.short_text || undefined,
          route: `/kalkulation/leistungen/${s.id}`,
          tenantId: s.organization_id,
          score: scoreRow(raw, tokens, {
            number: s.service_number,
            title: s.name || "",
            haystack: join(s.service_number, s.name, s.short_text, s.category),
            archived: s.active === false,
            dateMs: ms(s.updated_at),
          }),
        })
      );
    },
  },

  // ----- Artikel (keine Detailseite → Liste) -----
  {
    module: "kalkulation",
    run: async (tokens, raw) => {
      const fields = ["article_number", "name", "description", "category", "supplier", "positions_nummer"];
      const { data, error } = await applyTokens(
        supabase
          .from("articles")
          .select(
            "id,article_number,name,description,category,supplier,unit,sale_price,active,updated_at,organization_id"
          ),
        fields,
        tokens
      );
      if (error || !data) return [];
      return data.map(
        (a: any): SearchResult => ({
          id: a.id,
          type: "article",
          group: "Artikel",
          title: a.name || a.article_number || "Artikel",
          subtitle: join(a.article_number, a.category, a.supplier),
          route: `/kalkulation/artikel?q=${encodeURIComponent(a.name || a.article_number || "")}`,
          amount: a.sale_price != null ? eur(a.sale_price) : undefined,
          tenantId: a.organization_id,
          score: scoreRow(raw, tokens, {
            number: a.article_number,
            title: a.name || "",
            haystack: join(a.article_number, a.name, a.description, a.category, a.supplier),
            archived: a.active === false,
            dateMs: ms(a.updated_at),
          }),
        })
      );
    },
  },

  // ----- Gewerke -----
  {
    module: "kalkulation",
    run: async (tokens, raw) => {
      const fields = ["name", "code", "description"];
      const { data, error } = await applyTokens(
        supabase.from("trades").select("id,name,code,description,active,organization_id"),
        fields,
        tokens
      );
      if (error || !data) return [];
      return data.map(
        (t: any): SearchResult => ({
          id: t.id,
          type: "trade",
          group: "Gewerke",
          title: t.name || "Gewerk",
          subtitle: join(t.code, t.description),
          route: `/kalkulation/gewerke`,
          tenantId: t.organization_id,
          score: scoreRow(raw, tokens, {
            number: t.code,
            title: t.name || "",
            haystack: join(t.name, t.code, t.description),
            archived: t.active === false,
          }),
        })
      );
    },
  },

  // ----- Einheiten -----
  {
    module: "kalkulation",
    run: async (tokens, raw) => {
      const fields = ["name", "code"];
      const { data, error } = await applyTokens(
        supabase.from("units").select("id,name,code,active,organization_id"),
        fields,
        tokens
      );
      if (error || !data) return [];
      return data.map(
        (u: any): SearchResult => ({
          id: u.id,
          type: "unit",
          group: "Einheiten",
          title: u.name || u.code || "Einheit",
          subtitle: u.code || undefined,
          route: `/kalkulation/einheiten`,
          tenantId: u.organization_id,
          score: scoreRow(raw, tokens, {
            number: u.code,
            title: u.name || "",
            haystack: join(u.name, u.code),
            archived: u.active === false,
          }),
        })
      );
    },
  },
];

// ============================================================
// Öffentliche API
// ============================================================
/**
 * Führt die globale Suche aus: nur erlaubte Quellen (RLS-konsistent),
 * parallel, fehlertolerant (eine fehlerhafte Quelle bricht nicht alles ab),
 * gruppiert und relevanzsortiert.
 */
export async function runGlobalSearch(query: string, perms: PermLike): Promise<SearchGroupResult[]> {
  const tokens = sanitizeTokens(query);
  if (!tokens.length) return [];

  const sources = SOURCES.filter((s) => perms.isAdmin || perms.can(s.module, "view"));
  const settled = await Promise.allSettled(sources.map((s) => s.run(tokens, query)));

  const byGroup = new Map<string, SearchResult[]>();
  for (const r of settled) {
    if (r.status !== "fulfilled") continue;
    for (const res of r.value) {
      const arr = byGroup.get(res.group) ?? [];
      arr.push(res);
      byGroup.set(res.group, arr);
    }
  }

  const groups: SearchGroupResult[] = [];
  const seen = new Set<string>();
  const pushGroup = (g: string) => {
    const arr = byGroup.get(g);
    if (!arr || !arr.length) return;
    arr.sort((a, b) => b.score - a.score);
    groups.push({ group: g, results: arr.slice(0, GROUP_LIMIT) });
    seen.add(g);
  };
  GROUP_ORDER.forEach(pushGroup);
  // Eventuelle nicht in GROUP_ORDER gelistete Gruppen hinten anhängen.
  for (const g of byGroup.keys()) if (!seen.has(g)) pushGroup(g);

  return groups;
}

export const totalResults = (groups: SearchGroupResult[]) =>
  groups.reduce((sum, g) => sum + g.results.length, 0);
