// ────────────────────────────────────────────────────────────────────────────
//  offerMailTemplate – Tests (Vitest)
//
//  Wir pruefen die kleine Textbaustein-Funktion, die Subject + HTML fuer den
//  E-Mail-Versand eines Angebots erzeugt. Wichtig sind vor allem:
//   - Subject: "Ihr Angebot" ohne Nummer, "Ihr Angebot Nr. …" mit Nummer.
//   - HTML: enthaelt Anrede, die Nummer (wenn vorhanden), den Kundennamen
//     (wenn vorhanden) und die Gruss-Formel; ist HTML (mit <p>-Absaetzen).
// ────────────────────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { buildOfferMailSubject, buildOfferMailHtml } from "./offerMailTemplate";

describe("offerMailTemplate", () => {
  describe("buildOfferMailSubject", () => {
    it("liefert 'Ihr Angebot' ohne Nummer", () => {
      const s = buildOfferMailSubject({ offerNumber: null, customerName: "" });
      expect(s).toBe("Ihr Angebot");
    });

    it("haengt die Nummer korrekt an, wenn vorhanden", () => {
      const s = buildOfferMailSubject({
        offerNumber: "ANGEBOT-0009-2026",
        customerName: "",
      });
      expect(s).toBe("Ihr Angebot Nr. ANGEBOT-0009-2026");
    });

    it("trimmt weissraum in der Nummer", () => {
      const s = buildOfferMailSubject({
        offerNumber: "  ANG-1 ",
        customerName: "",
      });
      expect(s).toBe("Ihr Angebot Nr. ANG-1");
    });
  });

  describe("buildOfferMailHtml", () => {
    it("enthaelt Anrede, Nummer und Kundenname als HTML-Absaetze", () => {
      const html = buildOfferMailHtml({
        offerNumber: "ANGEBOT-0009-2026",
        customerName: "Mustermann GmbH",
        senderName: "Anna Musterfrau",
      });
      expect(html).toContain("<p>Sehr geehrte Damen und Herren,</p>");
      expect(html).toContain("Nr. ANGEBOT-0009-2026");
      expect(html).toContain("Mustermann GmbH");
      expect(html).toContain("Mit freundlichen Gruessen");
      expect(html).toContain("Anna Musterfrau");
    });

    it("liefert HTML auch ohne Nummer und Namen (Entwurf-Fall)", () => {
      const html = buildOfferMailHtml({ offerNumber: null, customerName: "" });
      expect(html).toContain("<p>Sehr geehrte Damen und Herren,</p>");
      // Kein " Nr. " → " " davor darf nicht als Leer-Referenz auftauchen.
      expect(html).not.toContain(" Nr. ");
      // Kein " fuer " ohne Empfaenger.
      expect(html).not.toContain(" fuer ");
      expect(html).toContain("Mit freundlichen Gruessen");
    });

    it("escaped HTML-Sonderzeichen im Kundennamen", () => {
      const html = buildOfferMailHtml({
        offerNumber: null,
        customerName: "<script>alert(1)</script>",
      });
      expect(html).not.toContain("<script>");
      expect(html).toContain("&lt;script&gt;");
    });
  });
});
