// ============================================================
// B4Y SuperAPP – Mitarbeiterverwaltung
// Typen, Enums und Labels für Personalstammdaten.
// ============================================================

export type EmploymentType =
  | "vollzeit" | "teilzeit" | "geringfuegig" | "freier_dienstnehmer" | "praktikant";

export type WorktimeModel = "buak" | "buero" | "individuell";

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type WeekHours = Partial<Record<Weekday, number>>;

export const WEEKDAYS: { key: Weekday; short: string; full: string; weekend?: boolean }[] = [
  { key: "mon", short: "Mo", full: "Montag" },
  { key: "tue", short: "Di", full: "Dienstag" },
  { key: "wed", short: "Mi", full: "Mittwoch" },
  { key: "thu", short: "Do", full: "Donnerstag" },
  { key: "fri", short: "Fr", full: "Freitag" },
  { key: "sat", short: "Sa", full: "Samstag", weekend: true },
  { key: "sun", short: "So", full: "Sonntag", weekend: true },
];

export const sumWeek = (w: WeekHours | null | undefined): number =>
  WEEKDAYS.reduce((a, d) => a + (Number((w || {})[d.key]) || 0), 0);

export type Employee = {
  id: string;
  auth_user_id: string | null;

  // Persönliches
  salutation: string | null;
  title: string | null;
  first_name: string;
  last_name: string;
  birth_date: string | null;
  email: string;
  phone: string | null;
  mobile: string | null;
  street: string | null;
  address_extra: string | null;
  zip: string | null;
  city: string | null;
  country: string;
  photo_url: string | null;
  notes_internal: string | null;
  active: boolean;

  // Anstellung
  entry_date: string | null;
  exit_date: string | null;
  employment_type: EmploymentType | null;
  position: string | null;
  weekly_hours: number | null;
  normal_weekly_hours: number | null;
  vacation_days_per_year: number | null;
  probation_until: string | null;
  notice_period: string | null;
  supervisor_id: string | null;
  personnel_number: string | null;
  work_state: string | null;
  worktime_model: WorktimeModel | null;     // Legacy (vor Vorlagen) – bleibt als Override-Hinweis
  work_time_model_id: string | null;        // zugewiesene Arbeitszeitmodell-Vorlage (work_time_models)
  trade_kv: string | null;            // Kollektivvertrag (Anstellung)
  hours_short_week: number | null;    // Summe kurze Woche (abgeleitet aus week_short)
  hours_long_week: number | null;     // Summe lange Woche (abgeleitet aus week_long)
  week_rhythm: string | null;
  worktime_valid_from: string | null;
  week_short: WeekHours;              // Tagesstunden kurze Woche
  week_long: WeekHours;               // Tagesstunden lange Woche

  // Lohngruppe
  wage_group: string | null;
  collective_agreement: string | null;
  wage_category: string | null;
  hourly_wage_gross: number | null;
  monthly_wage_gross: number | null;
  overtime_rate: number | null;
  surcharges: string | null;
  wage_valid_from: string | null;
  wage_note: string | null;

  // E-Mail-Signatur
  signature_active: boolean;
  signature_html: string | null;

  // Dokument-Signatur (getrennt von der E-Mail-Signatur)
  document_signature_active: boolean;
  document_signature_html: string | null;

  // Steuerdaten (sensibel)
  ssn: string | null;
  citizenship: string | null;
  birth_place: string | null;
  marital_status: string | null;
  commuter_allowance: boolean;
  sole_earner: string | null;
  tax_note: string | null;

  // Bankdaten (sensibel)
  account_holder: string | null;
  iban: string | null;
  bic: string | null;
  bank_name: string | null;
  bank_note: string | null;

  created_at: string | null;
  updated_at: string | null;
};

// Bewusst "*" – die Spaltenliste ist lang; "*" vermeidet den Supabase-Typ-Parser
// (sehr lange select-Strings → GenericStringError).
export const EMPLOYEE_COLUMNS = "*";

export const EMPLOYMENT_TYPES: { value: EmploymentType; label: string }[] = [
  { value: "vollzeit", label: "Vollzeit" },
  { value: "teilzeit", label: "Teilzeit" },
  { value: "geringfuegig", label: "Geringfügig" },
  { value: "freier_dienstnehmer", label: "Freier Dienstnehmer" },
  { value: "praktikant", label: "Praktikant" },
];

export const WORKTIME_MODELS: { value: WorktimeModel; label: string }[] = [
  { value: "buak", label: "Kurze/lange Woche laut BUAK-Kalender" },
  { value: "buero", label: "Büro Standardwoche" },
  { value: "individuell", label: "Individuell" },
];

// Funktion / Position (Dropdown)
export const POSITIONS: string[] = [
  "Geschäftsführer", "Büro", "Bauleitung", "Techniker", "Vorarbeiter",
  "Facharbeiter", "Helfer", "Lehrling", "Reinigung", "Sonstige",
];

// Kollektivvertrag (Dropdown)
export const KV_OPTIONS: string[] = ["Bau", "Maler und Anstreicher", "Angestellter"];

// Österreichische Bundesländer (für Arbeitsstätte / spätere Feiertagslogik)
export const AT_STATES: string[] = [
  "Burgenland", "Kärnten", "Niederösterreich", "Oberösterreich",
  "Salzburg", "Steiermark", "Tirol", "Vorarlberg", "Wien",
];

export const employmentLabel = (v: string | null): string =>
  EMPLOYMENT_TYPES.find((e) => e.value === v)?.label ?? (v || "–");

export const worktimeLabel = (v: string | null): string =>
  WORKTIME_MODELS.find((w) => w.value === v)?.label ?? (v || "–");

export const fullName = (e: Pick<Employee, "salutation" | "title" | "first_name" | "last_name">): string =>
  [e.title, e.first_name, e.last_name].filter(Boolean).join(" ") || "Ohne Namen";
