// ============================================================
// B4Y SuperAPP – Zentrale deutsche Fehlertexte (UI-sichtbar)
// ------------------------------------------------------------
// Übersetzt technische Supabase-/PostgREST-/Postgres-/Auth-/Netzwerk-Fehler in
// verständliche deutsche Meldungen für Error-Banner/Toasts/Formulare.
// Die technischen Originalmeldungen bleiben für die Diagnose in console.error –
// der Benutzer sieht hier nur Deutsch (keine rohen englischen DB-Texte mehr).
//
// Verwendung:
//   setErr(germanError(error, "Kontakt konnte nicht gespeichert werden."));
//   toastError(germanError(error));
//
// Der optionale `context` wird der Meldung als Satz vorangestellt
// (z. B. "Kontakt konnte nicht gespeichert werden. Die Datenbankstruktur …").
// ============================================================

export type SupabaseLikeError =
  | { message?: string | null; code?: string | null; details?: string | null; hint?: string | null }
  | string
  | null
  | undefined;

function errorBlob(error: SupabaseLikeError): { blob: string; code: string } {
  if (typeof error === "string") return { blob: error.toLowerCase(), code: "" };
  if (!error) return { blob: "", code: "" };
  const code = (error.code ?? "").toString();
  const parts = [error.message, error.details, error.hint, code].filter(Boolean).join(" ");
  return { blob: parts.toLowerCase(), code };
}

const withContext = (context: string | undefined, msg: string): string =>
  context && context.trim() ? `${context.trim()} ${msg}` : msg;

/**
 * Liefert eine benutzerfreundliche deutsche Fehlermeldung zu einem technischen Fehler.
 * Deckt die wichtigsten Fälle ab; unbekannte Fehler erhalten einen generischen
 * deutschen Text statt der rohen englischen Originalmeldung.
 */
export function germanError(error: SupabaseLikeError, context?: string): string {
  const { blob, code } = errorBlob(error);

  // Schema-Cache / fehlende Spalte (z. B. PostgREST "Could not find the 'x' column … schema cache").
  if (
    /schema cache|could not find the .* column|undefined column|column .* does not exist/.test(blob) ||
    code === "PGRST204" ||
    code === "PGRST205" ||
    code === "42703"
  ) {
    return withContext(
      context,
      "Die Datenbankstruktur ist noch nicht aktuell. Bitte erneut laden oder Administrator kontaktieren."
    );
  }

  // Berechtigung / Row-Level-Security.
  if (/row-level security|violates row-level|permission denied|not authorized|42501/.test(blob)) {
    return withContext(context, "Keine Berechtigung für diese Aktion.");
  }

  // Doppelter Wert / Unique-Constraint.
  if (/duplicate key|unique constraint|already exists|23505/.test(blob)) {
    return withContext(context, "Dieser Eintrag existiert bereits (doppelter Wert).");
  }

  // Pflichtfeld fehlt (NOT NULL).
  if (/not-null|null value in column|23502/.test(blob)) {
    return withContext(context, "Ein Pflichtfeld fehlt. Bitte alle erforderlichen Felder ausfüllen.");
  }

  // Ungültiger Wert / Check-Constraint.
  if (/check constraint|23514/.test(blob)) {
    return withContext(
      context,
      "Eine Eingabe entspricht nicht den erlaubten Werten. Bitte die Felder prüfen."
    );
  }

  // Foreign-Key-Verletzung.
  if (/foreign key|23503/.test(blob)) {
    return withContext(context, "Der Vorgang verweist auf einen nicht (mehr) vorhandenen Datensatz.");
  }

  // Netzwerk / Verbindung.
  if (
    /failed to fetch|networkerror|network request failed|fetch failed|timeout|timed out|econnrefused/.test(
      blob
    )
  ) {
    return withContext(context, "Verbindungsproblem. Bitte Internetverbindung prüfen und erneut versuchen.");
  }

  // Anmeldung / Token.
  if (
    /jwt|invalid token|token expired|not authenticated|invalid login|invalid claim|refresh token/.test(blob)
  ) {
    return withContext(context, "Anmeldung abgelaufen oder ungültig. Bitte neu anmelden.");
  }

  // Fallback: niemals rohen englischen Text zeigen – generischer deutscher Hinweis.
  return withContext(context, "Es ist ein Fehler aufgetreten. Bitte erneut versuchen.");
}
