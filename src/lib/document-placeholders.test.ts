import { describe, it, expect } from "vitest";
import { buildDocPlaceholders, skontoSentence, paymentTermsSentence } from "./document-placeholders";
import { KNOWN_PLACEHOLDERS } from "./text-blocks";

const company = {
  id: 1, name: "Muster Bau GmbH", street: "Hauptstraße 1", zip: "1010", city: "Wien",
  country: "Österreich", fn: "123456a", fn_court: "Wien", tax_number: null, uid: "ATU12345678",
  ceo: null, gesellschafter: ["Max Muster"], geschaeftsfuehrer: ["Max Muster"],
  bank_name: "Bank", iban: "AT00 0000 0000 0000 0000", bic: "BANKATWW",
  phone: "+43 1 234", mobile: null, email: "office@muster.at", web: "www.muster.at",
  logo_url: null, icon_logo_url: null, document_signature_html: null,
} as any;

const customer = {
  id: "c1", customer_type: "firma", company: "Kunde AG", salutation: "Herr", title: null,
  first_name: "Hans", last_name: "Huber", street: "Kundengasse 5", address_extra: "Stiege 2, Top 4",
  zip: "1030", city: "Wien", uid: "ATU99999999",
} as any;

describe("buildDocPlaceholders – Vollständigkeit & Werte", () => {
  const ph = buildDocPlaceholders({
    customer, project: { title: "Projekt X", project_number: "P-2026-001", street: "Baustelle 9", zip: "1100", city: "Wien" },
    docNumber: "AN-0001", docDate: "2026-06-27", docLabel: "Angebot", company, bearbeiter: "Sachbearbeiter",
    conditions: { paymentTermDays: 30, skontoPercent: 3, skontoDays: 14 },
  });

  it("befüllt Firmen-Platzhalter aus company_settings (white-label)", () => {
    expect(ph["firma.name"]).toBe("Muster Bau GmbH");
    expect(ph["firma.iban"]).toBe("AT00 0000 0000 0000 0000");
    expect(ph["firma.bic"]).toBe("BANKATWW");
    expect(ph["firma.uid"]).toBe("ATU12345678");
    expect(ph["firma.adresse"]).toBe("Hauptstraße 1, 1010 Wien");
    expect(ph["firma.fn"]).toBe("FN 123456a Wien");
    expect(ph["firma.geschaeftsfuehrer"]).toBe("Max Muster");
    expect(ph["firma.web"]).toBe("www.muster.at");
  });

  it("befüllt Kunden-/Projekt-/Konditions-Platzhalter", () => {
    expect(ph["kunde.name"]).toBe("Kunde AG");
    expect(ph["kunde.adresse"]).toBe("Kundengasse 5 / Stiege 2 / Top 4, 1030 Wien");
    expect(ph["kunde.uid"]).toBe("ATU99999999");
    expect(ph["projekt.nummer"]).toBe("P-2026-001");
    expect(ph["kondition.zahlungsziel"]).toBe("30");
    expect(ph["kondition.skonto_prozent"]).toBe("3");
    expect(ph["kondition.skonto_tage"]).toBe("14");
  });

  it("liefert für JEDEN bekannten Platzhalter einen definierten Wert (kein undefined)", () => {
    for (const key of KNOWN_PLACEHOLDERS) {
      expect(ph[key], `Platzhalter ${key} fehlt in buildDocPlaceholders`).toBeDefined();
    }
  });

  it("ist robust gegen leere Eingaben (keine Exception, leere Strings)", () => {
    const empty = buildDocPlaceholders({ customer: null, project: null, docLabel: "Brief", company: null, bearbeiter: "" });
    expect(empty["firma.iban"]).toBe("");
    expect(empty["kunde.name"]).toBe("");
    expect(empty["kunde.anrede_zeile"]).toBe("Sehr geehrte Damen und Herren,");
  });
});

describe("Konditionen-Sätze (skonto_text / zahlungsbedingungen_text)", () => {
  it("Skonto > 0 → vollständiger Skonto-Satz mit Prozent und Tagen", () => {
    expect(skontoSentence({ skontoPercent: 3, skontoDays: 7 }))
      .toBe("Bei Zahlung innerhalb von 7 Tagen gewähren wir Ihnen 3 % Skonto.");
    expect(skontoSentence({ skontoPercent: 2.5, skontoDays: null }))
      .toBe("Bei Zahlung innerhalb der Skontofrist gewähren wir Ihnen 2,5 % Skonto.");
  });

  it("Skonto 0 %, leer oder nicht gesetzt → KEIN Skonto-Satz", () => {
    expect(skontoSentence({ skontoPercent: 0, skontoDays: 7 })).toBe("");
    expect(skontoSentence({ skontoPercent: null, skontoDays: 7 })).toBe("");
    expect(skontoSentence(null)).toBe("");
    expect(skontoSentence(undefined)).toBe("");
  });

  it("Zahlungsbedingungen-Satz kombiniert Ziel + Skonto; leer ohne Konditionen", () => {
    expect(paymentTermsSentence({ paymentTermDays: 14, skontoPercent: 3, skontoDays: 7 }))
      .toBe("Zahlbar innerhalb von 14 Tagen netto. Bei Zahlung innerhalb von 7 Tagen gewähren wir Ihnen 3 % Skonto.");
    expect(paymentTermsSentence({ paymentTermDays: 14, skontoPercent: 0 }))
      .toBe("Zahlbar innerhalb von 14 Tagen netto.");
    expect(paymentTermsSentence({ paymentTermDays: null, skontoPercent: null })).toBe("");
    expect(paymentTermsSentence(null)).toBe("");
  });

  it("Platzhaltermap enthält die neuen Konditionen-Sätze", () => {
    const ph = buildDocPlaceholders({
      customer: null, project: null, docLabel: "Auftrag", company: null, bearbeiter: "",
      conditions: { paymentTermDays: 14, skontoPercent: 3, skontoDays: 7 },
    });
    expect(ph["kondition.skonto_text"]).toContain("3 % Skonto");
    expect(ph["kondition.zahlungsbedingungen_text"]).toContain("14 Tagen netto");
    const none = buildDocPlaceholders({ customer: null, project: null, docLabel: "Auftrag", company: null, bearbeiter: "" });
    expect(none["kondition.skonto_text"]).toBe("");
    expect(none["kondition.zahlungsbedingungen_text"]).toBe("");
  });
});
