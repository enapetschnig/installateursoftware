// ============================================================
// B4Y SuperAPP – Microsoft-OAuth Reason-Mapping
// ------------------------------------------------------------
// Uebersetzt die technischen ?reason=...-Keys aus dem Callback-
// Redirect in benutzerfreundliche deutsche Fehlermeldungen.
//
// Reason-Keys stammen aus api/auth/microsoft-callback.js:
//   state, token, idtoken, denied, noorg, encrypt, db, config,
//   network, nocode. Unbekannte Werte -> generischer Fallback.
//
// Extrahiert als reine Funktion, damit sie ohne DOM/React
// getestet werden kann (siehe MicrosoftConnectCard.test.ts).
// ============================================================

const REASON_MESSAGES: Record<string, string> = {
  state:
    "Sicherheitspruefung fehlgeschlagen. Bitte den Vorgang erneut starten.",
  token:
    "Microsoft hat den Zugriff verweigert (Token-Austausch fehlgeschlagen).",
  idtoken:
    "Microsoft-Identitaet konnte nicht verifiziert werden.",
  denied:
    "Zustimmung wurde nicht erteilt.",
  noorg:
    "Deinem Konto ist keine Organisation zugeordnet. Bitte an den Administrator wenden.",
  encrypt:
    "Interner Fehler beim Speichern der Zugangsdaten.",
  db:
    "Zugangsdaten konnten nicht gespeichert werden.",
  config:
    "Microsoft-Anbindung ist nicht konfiguriert. Bitte an den Administrator wenden.",
  network:
    "Netzwerkfehler beim Verbinden mit Microsoft. Bitte erneut versuchen.",
  nocode:
    "Microsoft hat keinen Autorisierungscode geliefert. Bitte erneut versuchen.",
};

const GENERIC_FAIL_MESSAGE =
  "Verbindung fehlgeschlagen. Bitte erneut versuchen.";

/**
 * Wandelt einen Reason-Key (z. B. "state") in eine deutsche Meldung.
 * Gibt bei unbekanntem/leeren Key eine generische Fallback-Meldung zurueck.
 */
export function reasonMessage(reason: string | null | undefined): string {
  if (!reason) return GENERIC_FAIL_MESSAGE;
  const key = String(reason).toLowerCase();
  return REASON_MESSAGES[key] ?? GENERIC_FAIL_MESSAGE;
}

/**
 * Liest die aktuelle Connect-Result-Info aus URLSearchParams. Rueckgabe
 * beschreibt was die UI aus der URL erfahren hat:
 *   - status "none":     keine ?connected=-Angabe (Frisch geladen, kein Toast)
 *   - status "ok":       Verbindung erfolgreich
 *   - status "fail":     Verbindung fehlgeschlagen (message enthaelt die
 *                        deutsche Meldung basierend auf ?reason=)
 */
export interface ConnectReason {
  status: "none" | "ok" | "fail";
  reason?: string;
  message?: string;
}

export function extractConnectReason(params: URLSearchParams): ConnectReason {
  const connected = params.get("connected");
  if (!connected) return { status: "none" };
  if (connected === "ok") return { status: "ok" };
  if (connected === "fail") {
    const reason = params.get("reason") || "";
    return {
      status: "fail",
      reason,
      message: reasonMessage(reason),
    };
  }
  return { status: "none" };
}
