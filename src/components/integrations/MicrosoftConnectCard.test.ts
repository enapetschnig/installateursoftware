// ============================================================
// B4Y SuperAPP – Tests fuer die Pure-Helper des Integrations-Tabs
// ------------------------------------------------------------
// Nur die reinen Funktionen (kein React/RTL) werden getestet:
//   * reasonMessage() – Mapping Reason-Key -> deutsche Meldung
//   * extractConnectReason() – Auslesen der URL-Parameter
// ============================================================

import { describe, it, expect } from "vitest";
import { extractConnectReason, reasonMessage } from "./connect-reason";

describe("reasonMessage()", () => {
  it("mapped bekannte Reason-Keys auf deutsche Meldungen", () => {
    expect(reasonMessage("state")).toMatch(/Sicherheitspruefung/);
    expect(reasonMessage("token")).toMatch(/Token/);
    expect(reasonMessage("idtoken")).toMatch(/Identitaet/);
    expect(reasonMessage("denied")).toMatch(/Zustimmung/);
    expect(reasonMessage("noorg")).toMatch(/Organisation/);
    expect(reasonMessage("encrypt")).toMatch(/Zugangsdaten/);
    expect(reasonMessage("db")).toMatch(/gespeichert/);
    expect(reasonMessage("config")).toMatch(/konfiguriert/);
    expect(reasonMessage("network")).toMatch(/Netzwerk/);
    expect(reasonMessage("nocode")).toMatch(/Autorisierungscode/);
  });

  it("ignoriert Gross-/Kleinschreibung", () => {
    expect(reasonMessage("STATE")).toBe(reasonMessage("state"));
    expect(reasonMessage("Denied")).toBe(reasonMessage("denied"));
  });

  it("liefert Fallback bei unbekanntem / leerem Reason", () => {
    const fallback = reasonMessage("");
    expect(fallback).toMatch(/fehlgeschlagen/i);
    expect(reasonMessage("xyz")).toBe(fallback);
    expect(reasonMessage(null)).toBe(fallback);
    expect(reasonMessage(undefined)).toBe(fallback);
  });
});

describe("extractConnectReason()", () => {
  it("liefert status 'none' wenn kein connected-Parameter gesetzt ist", () => {
    const r = extractConnectReason(new URLSearchParams("tab=integrationen"));
    expect(r.status).toBe("none");
  });

  it("erkennt connected=ok", () => {
    const r = extractConnectReason(
      new URLSearchParams("tab=integrationen&connected=ok"),
    );
    expect(r.status).toBe("ok");
  });

  it("erkennt connected=fail und liefert die passende Meldung", () => {
    const r = extractConnectReason(
      new URLSearchParams("tab=integrationen&connected=fail&reason=state"),
    );
    expect(r.status).toBe("fail");
    expect(r.reason).toBe("state");
    expect(r.message).toBe(reasonMessage("state"));
  });

  it("liefert fail + Fallback wenn reason fehlt", () => {
    const r = extractConnectReason(
      new URLSearchParams("tab=integrationen&connected=fail"),
    );
    expect(r.status).toBe("fail");
    expect(r.message).toMatch(/fehlgeschlagen/i);
  });

  it("behandelt unerwartete connected-Werte als 'none'", () => {
    const r = extractConnectReason(
      new URLSearchParams("tab=integrationen&connected=weird"),
    );
    expect(r.status).toBe("none");
  });
});
