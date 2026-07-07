export type ContactType = "kunde" | "lieferant" | "sonstige" | "subunternehmer";
export type CustomerType = "privat" | "firma";
export type ContactStatus = "aktiv" | "inaktiv";

export type Contact = {
  id: string;
  contact_number: string | null;
  customer_number: string | null;
  type: ContactType;
  customer_type: CustomerType;
  status: ContactStatus;
  salutation: string | null; // Anrede, z.B. "Herr"
  title: string | null; // Titel, z.B. "Mag."
  first_name: string | null;
  last_name: string | null;
  company: string | null; // Firmenname
  uid_number: string | null;
  email: string | null;
  invoice_email: string | null; // Rechnungs-Mail
  phone: string | null;
  mobile: string | null;
  website: string | null;
  street: string | null;
  address_extra: string | null;
  recipient_extra_line1: string | null; // Empfänger-Zusatzzeile 1 (Migr. 0083) – z. B. „z. Hd. …"
  recipient_extra_line2: string | null; // Empfänger-Zusatzzeile 2 (Migr. 0083) – Hausverwaltung/Abteilung
  zip: string | null;
  city: string | null;
  country: string | null;
  notes: string | null; // Interne Notiz
  address_form: "du" | "sie";
  payment_term_days: number | null;
  skonto_percent: number | null;
  skonto_days: number | null;
  is_invoice_recipient: boolean;
  auto_accept_supplements: boolean; // Nachträge dieses Kontakts automatisch akzeptieren (Migr. 0093) – fachlich v.a. Kunden
  payment_method: string | null;
  payment_note: string | null;
  default_discount_percent: number | null;
  default_surcharge_percent: number | null; // Ausgangs-Standardaufschlag % (Migr. 0081) – intern/unsichtbar, einmalig in EP eingerechnet
  // Eingangskonditionen (Lieferant/Sub berechnet uns) – getrennt von den Ausgangsfeldern oben (Migr. 0066)
  in_payment_term_days: number | null;
  in_skonto_percent: number | null;
  in_skonto_days: number | null;
  in_payment_method: string | null;
  in_payment_note: string | null;
  in_discount_percent: number | null; // Eingangs-Standardnachlass % (Migr. 0069) – Gegenstück zu default_discount_percent
  created_at: string;
  updated_at: string | null;
};

export type ContactPerson = {
  id: string;
  contact_id: string;
  contact_number: string | null; // eigene Ansprechpartner-Nummer, z. B. AP-0001 (Migr. 0079)
  salutation: string | null;
  title: string | null;
  first_name: string | null;
  last_name: string | null;
  function: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  note: string | null;
  sort_order: number;
  active: boolean; // Ansprechperson aktiv/inaktiv (Migr. 0073)
  created_at?: string;
  updated_at?: string;
};

export const CONTACT_TYPES: { value: ContactType; label: string }[] = [
  { value: "kunde", label: "Kunden" },
  { value: "lieferant", label: "Lieferanten" },
  { value: "subunternehmer", label: "Subunternehmer" },
];

export const CUSTOMER_TYPES: { value: CustomerType; label: string }[] = [
  // Interner Wert bleibt "privat" (DB/Bestandsdaten stabil); sichtbares Label = "Person".
  { value: "privat", label: "Person" },
  { value: "firma", label: "Firma" },
];

export const SALUTATIONS = ["Herr", "Frau"] as const;
export const TITLE_SUGGESTIONS = ["Dr.", "DI", "Dipl.-Ing.", "Mag.", "Ing.", "BSc", "MSc", "MBA"] as const;

export type Project = {
  id: string;
  project_number: string | null;
  title: string;
  category: string | null; // Projekttyp
  stage: string; // Projektstatus
  contact_id: string | null;
  street: string | null;
  address_extra: string | null;
  zip: string | null;
  city: string | null;
  country: string | null;
  gewerk: string | null;
  responsible: string | null; // zuständiger Mitarbeiter
  description: string | null;
  internal_note: string | null;
  budget: number | null; // Projektvolumen
  start_date: string | null; // Baubeginn (Datum) – Altfeld, bleibt erhalten
  start_at: string | null; // Baubeginn inkl. Uhrzeit (timestamptz, Migr. 0077)
  end_date: string | null; // Geplante Fertigstellung (nur Datum)
  priority: string | null;
  reminder_date: string | null;
  reminder_text: string | null;
  reminder_done: boolean;
  archived: boolean;
  created_at: string;
  updated_at: string | null;
};

export type ProjectParticipant = {
  id: string;
  project_id: string;
  contact_id: string | null;
  person_id: string | null;
  role: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  note: string | null;
  sort_order: number;
  created_at?: string;
};

export type ProjectAppointment = {
  id: string;
  project_id: string;
  title: string | null;
  kind: string | null;
  date: string | null;
  time: string | null;
  location: string | null;
  participants: string | null;
  description: string | null;
  reminder: boolean;
  status: string | null;
  created_at?: string;
  updated_at?: string;
};

export type ProjectChecklist = {
  id: string;
  project_id: string;
  name: string;
  sort_order: number;
  created_at?: string;
};
export type ProjectChecklistItem = {
  id: string;
  checklist_id: string;
  label: string;
  done: boolean;
  responsible: string | null;
  due_date: string | null;
  sort_order: number;
  created_at?: string;
};

export type ProjectLogEntry = {
  id: string;
  project_id: string;
  entry: string;
  kind: string | null;
  created_by: string | null;
  created_at: string;
};
export type MediaType = "photo" | "video";
export type MediaSource = "upload" | "camera" | "mobile_camera" | "ipad_camera";

export type ProjectMedia = {
  id: string;
  project_id: string;
  file_name: string;
  file_type: string | null;
  file_size: number | null;
  file_url: string;
  description: string | null;
  category: string | null;
  archived: boolean;
  created_by: string | null;
  created_at: string;
  // Medienmodul (Migration 0005)
  thumbnail_url: string | null;
  mime_type: string | null;
  media_type: MediaType;
  category_id: string | null;
  title: string | null;
  taken_at: string | null;
  source: MediaSource;
  sort_order: number;
  is_favorite: boolean;
};

// Zentral verwaltete Foto-/Video-Kategorien (Migration 0005)
export type MediaCategory = {
  id: string;
  name: string;
  description: string | null;
  applies_to_photos: boolean;
  applies_to_videos: boolean;
  is_default: boolean;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export const PARTICIPANT_ROLES = [
  "Kunde",
  "Ansprechpartner Kunde",
  "Architekt",
  "Hausverwaltung",
  "Eigentümer",
  "Mieter",
  "Bauleiter",
  "Techniker",
  "Mitarbeiter",
  "Subunternehmer",
  "Lieferant",
  "Statiker",
  "Rauchfangkehrer",
  "Elektriker",
  "Installateur",
  "Sonstige",
] as const;

export const APPOINTMENT_KINDS = [
  "Erstbesichtigung",
  "Baubesprechung",
  "Vor-Ort-Termin",
  "Ausmessung",
  "Übergabe",
  "Abnahme",
  "Sonstiger Termin",
] as const;

export const PROJECT_PRIORITIES = ["Niedrig", "Normal", "Hoch", "Dringend"] as const;

// HINWEIS: Die frühere Hardcode-Konstante EMPLOYEES wurde entfernt. Mitarbeiter-Auswahlen
// kommen jetzt aus der echten employees-Tabelle über useEmployees() (src/lib/project-config.ts).

// Dokument-Kategorien (Bereich Dokumente)
export const DOC_CATEGORIES = [
  "Pläne",
  "Angebote",
  "Rechnungen",
  "Nachträge",
  "Verträge",
  "Fotos",
  "Ausschreibungen",
  "Behördenunterlagen",
  "Sonstige Dokumente",
] as const;
// ===== Nummernkreise =====
export type NumberRange = {
  id: string;
  doc_type: string;
  document_type_id?: string | null;
  label: string;
  prefix: string;
  use_year: boolean;
  separator: string;
  min_digits: number;
  next_number: number;
  active: boolean;
  protected: boolean;
  created_at?: string;
  updated_at?: string;
};

export function numberPreview(r: {
  prefix: string;
  use_year: boolean;
  separator: string;
  min_digits: number;
  next_number: number;
}): string {
  const sep = r.separator ?? "";
  // Reihenfolge: Präfix, dann Nummer, dann Jahr
  let s = r.prefix || "";
  if (sep && s) s += sep;
  s += String(r.next_number).padStart(Math.max(1, r.min_digits || 1), "0");
  if (r.use_year) {
    if (sep) s += sep;
    s += String(new Date().getFullYear());
  }
  return s;
}

// ===== Aufträge =====
export type Order = {
  id: string;
  order_number: string | null;
  order_date: string;
  title: string | null;
  project_id: string | null;
  contact_id: string | null;
  person_id: string | null;
  offer_ids: string[];
  service_period: string | null;
  payment_term_days: number | null;
  discount_percent: number | null;
  internal_note: string | null;
  status: string;
  invoice_status: string;
  offer_type_id: string | null; // Variante (Standard/Pauschal/Regie) – Spalte existiert in DB
  net: number;
  vat: number;
  gross: number;
  snapshot: any;
  conditions_snapshot?: Record<string, unknown> | null; // festgeschriebene Konditionen (Migr. 0081)
  created_at: string;
  updated_at: string | null;
};

export type OrderItem = {
  id: string;
  order_id: string;
  pos_no: string | null;
  service_number: string | null;
  short_text: string | null;
  long_text: string | null;
  qty: number;
  unit: string | null;
  unit_price: number;
  discount_percent: number;
  vat_rate: number;
  net: number;
  gross: number;
  source_offer_id: string | null;
  source_offer_item_id: string | null;
  invoiced_qty: number;
  sort_order: number;
};

export const ORDER_STATUS = [
  "entwurf",
  "beauftragt",
  "in_arbeit",
  "teilw_verrechnet",
  "voll_verrechnet",
  "storniert",
  "archiviert",
] as const;
export const ORDER_STATUS_LABEL: Record<string, string> = {
  entwurf: "Entwurf",
  beauftragt: "Beauftragt",
  in_arbeit: "In Arbeit",
  teilw_verrechnet: "Teilweise verrechnet",
  voll_verrechnet: "Vollständig verrechnet",
  storniert: "Storniert",
  archiviert: "Archiviert",
};
export const ORDER_INVOICE_STATUS_LABEL: Record<string, string> = {
  offen: "Noch nicht verrechnet",
  teilw_verrechnet: "Teilweise verrechnet",
  voll_verrechnet: "Vollständig verrechnet",
  ueberverrechnet: "Überverrechnet / Prüfung",
  storniert: "Storniert",
};

export const STAGES = [
  "Neu – Erstkontakt",
  "Vor-Ort-Termin",
  "Angebotserstellung",
  "Angebotsprüfung",
  "Angebotsweiterleitung",
  "Detailgespräch",
  "Auftragsvergabe",
  "Auftragsbestätigung",
  "Umsetzungsbeginn",
  "In Umsetzung",
  "Kundenrechnung",
  "Reklamation",
  "Abgeschlossen",
  "Abgelehnt",
] as const;

/* ──────────────────────────────────────────────────────────────
   Zentrale Projektstatus-/Workflow-Farblogik (mandantenfähig).
   Keine harte Sonderfarbe je Status, sondern Schlüsselwort-basiert mit
   sinnvollem Fallback (slate) – funktioniert auch für eigene/zukünftige
   Stages anderer Mandanten. Töne entsprechen der zentralen Badge-Palette.
────────────────────────────────────────────────────────────── */
export type StageTone = "slate" | "blue" | "green" | "amber" | "red";
export function stageTone(stage?: string | null): StageTone {
  const s = (stage ?? "").toLowerCase();
  if (!s) return "slate";
  if (s.includes("abgeschlossen") || s.includes("fertig") || s.includes("erledigt")) return "green";
  if (s.includes("abgelehnt") || s.includes("reklamation") || s.includes("storn") || s.includes("verloren"))
    return "red";
  if (
    s.includes("auftrag") ||
    s.includes("umsetzung") ||
    s.includes("in arbeit") ||
    s.includes("rechnung") ||
    s.includes("beginn")
  )
    return "amber";
  if (s.includes("angebot") || s.includes("detailgespräch") || s.includes("angbot")) return "blue";
  return "slate";
}

export const CATEGORIES = [
  "Geschäftslokale / Büros / Häuser",
  "Generalsanierung Wohnungen",
  "Oberflächensanierung Wohnungen",
  "Fassaden",
  "Sofortaufträge",
  "Fenster",
  "Wasserschäden",
  "Objektinstandhaltungen",
  "Feuchtesanierungen",
  "Badezimmersanierungen",
  "Küchen / Geräte",
  "Einreichungen / Pläne",
] as const;

// Projekttypen für die Sidebar-Navigation + Filter (exakte Reihenfolge, keine Auto-Sortierung).
// label = Anzeige, slug = Query-Param (?typ=), category = exakter Wert in projects.category
export type ProjectType = { label: string; slug: string; category: string };

export const PROJECT_TYPES: ProjectType[] = [
  { label: "Einreichungen / Pläne", slug: "einreichungen-plaene", category: "Einreichungen / Pläne" },
  {
    label: "Geschäftslokale / Büros / Häuser",
    slug: "geschaeftslokale",
    category: "Geschäftslokale / Büros / Häuser",
  },
  { label: "Generalsanierung Wohnungen", slug: "generalsanierung", category: "Generalsanierung Wohnungen" },
  {
    label: "Oberflächensanierung Wohnungen",
    slug: "oberflaechensanierung",
    category: "Oberflächensanierung Wohnungen",
  },
  { label: "Fassaden", slug: "fassaden", category: "Fassaden" },
  { label: "Sofortaufträge", slug: "sofortauftraege", category: "Sofortaufträge" },
  { label: "Fenster", slug: "fenster", category: "Fenster" },
  { label: "Wasserschäden", slug: "wasserschaeden", category: "Wasserschäden" },
  { label: "Objektinstandhaltung", slug: "objektinstandhaltung", category: "Objektinstandhaltungen" },
  { label: "Feuchtesanierung", slug: "feuchtesanierung", category: "Feuchtesanierungen" },
  { label: "Badezimmersanierung", slug: "badezimmersanierung", category: "Badezimmersanierungen" },
  { label: "Küchen / Geräte", slug: "kuechen-geraete", category: "Küchen / Geräte" },
];
