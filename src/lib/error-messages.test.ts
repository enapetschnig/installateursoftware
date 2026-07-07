import { describe, it, expect } from "vitest";
import { germanError } from "./error-messages";

describe("germanError", () => {
  it("mappt den Schema-Cache-/Spalten-Fehler (Kernfall customer_number)", () => {
    const msg = "Could not find the 'customer_number' column of 'contacts' in the schema cache";
    const out = germanError(msg, "Kontakt konnte nicht gespeichert werden.");
    expect(out).toContain("Kontakt konnte nicht gespeichert werden.");
    expect(out).toContain("Die Datenbankstruktur ist noch nicht aktuell");
    expect(out).not.toContain("schema cache");
    expect(out).not.toContain("column");
  });

  it("erkennt PostgREST-Code PGRST204 (fehlende Spalte)", () => {
    expect(germanError({ message: "x", code: "PGRST204" })).toContain(
      "Die Datenbankstruktur ist noch nicht aktuell"
    );
  });

  it("mappt RLS/Berechtigungsfehler", () => {
    expect(germanError("new row violates row-level security policy")).toBe(
      "Keine Berechtigung für diese Aktion."
    );
    expect(germanError({ message: "permission denied", code: "42501" })).toBe(
      "Keine Berechtigung für diese Aktion."
    );
  });

  it("mappt Duplikat-/Unique-Fehler", () => {
    expect(
      germanError({ message: "duplicate key value violates unique constraint", code: "23505" })
    ).toContain("existiert bereits");
  });

  it("mappt Netzwerkfehler", () => {
    expect(germanError("TypeError: Failed to fetch")).toContain("Verbindungsproblem");
  });

  it("mappt Auth-/Token-Fehler", () => {
    expect(germanError("JWT expired")).toContain("Anmeldung");
  });

  it("zeigt für unbekannte Fehler keinen rohen englischen Text, sondern generisches Deutsch", () => {
    const out = germanError("Some totally unexpected english error xyz");
    expect(out).toBe("Es ist ein Fehler aufgetreten. Bitte erneut versuchen.");
    expect(out).not.toContain("english");
  });

  it("stellt den Kontext-Satz voran", () => {
    const out = germanError("boom", "Kontakt konnte nicht gespeichert werden.");
    expect(out.startsWith("Kontakt konnte nicht gespeichert werden.")).toBe(true);
  });

  it("verarbeitet null/undefined ohne Absturz", () => {
    expect(germanError(null)).toContain("Fehler aufgetreten");
    expect(germanError(undefined, "Kontext.")).toContain("Kontext.");
  });
});
