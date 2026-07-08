// ============================================================
// Tests für api/_lib/mail-ai.js
// ------------------------------------------------------------
// Prüft die Klassifizierung/Normalisierung OHNE Netzwerk: der OpenAI-Aufruf
// wird per __setOpenAiCallForTests durch einen Fake ersetzt. Kernpunkt:
// jede Mail wird korrekt eingeordnet und auf ein festes, validiertes Schema
// gebracht (Whitelist für mail_class/priority/anfrage_class, robuste
// Zahlen-/Datums-Parser für die Rechnungsextraktion).
// ============================================================

import { describe, it, expect, afterEach } from "vitest";

import {
  classifyMail,
  __setOpenAiCallForTests,
  __resetOpenAiCallForTests,
  __normalizeForTests,
} from "./mail-ai.js";

afterEach(() => __resetOpenAiCallForTests());

describe("classifyMail – Routing", () => {
  it("ordnet eine Kundenanfrage korrekt ein", async () => {
    __setOpenAiCallForTests(() => ({
      mail_class: "kundenanfrage",
      summary: "Kunde möchte ein Angebot für eine Badsanierung.",
      subject: "Anfrage Badsanierung",
      priority: "mittel",
      anfrage_class: "interessent",
      sender_name: "Familie Berger",
      invoice: {},
    }));
    const r = await classifyMail({ subject: "Badsanierung", from: { email: "a@b.at" }, text: "..." });
    expect(r.mail_class).toBe("kundenanfrage");
    expect(r.anfrage_class).toBe("interessent");
    expect(r.priority).toBe("mittel");
    expect(r.sender_name).toBe("Familie Berger");
  });

  it("erkennt eine Eingangsrechnung und extrahiert die Beträge (AT-Format)", async () => {
    __setOpenAiCallForTests(() => ({
      mail_class: "rechnung",
      summary: "Rechnung von Sanitär Müller.",
      invoice: {
        supplier_name: "Sanitär Müller GmbH",
        invoice_number: "2026-4711",
        amount_gross: "1.234,56",
        currency: "EUR",
        invoice_date: "05.07.2026 Rechnungsdatum 2026-07-05",
        due_date: "2026-07-19",
        iban: "AT61 1904 3002 3457 3201",
      },
    }));
    const r = await classifyMail({ subject: "Rechnung", from: { email: "x@y.at" }, text: "..." });
    expect(r.mail_class).toBe("rechnung");
    expect(r.invoice.amount_gross).toBeCloseTo(1234.56, 2);
    expect(r.invoice.invoice_number).toBe("2026-4711");
    expect(r.invoice.due_date).toBe("2026-07-19");
    expect(r.invoice.iban).toContain("AT61");
  });
});

describe("normalize – Whitelist & Fallbacks", () => {
  it("fällt bei unbekannter mail_class auf 'sonstiges' zurück", () => {
    const r = __normalizeForTests({ mail_class: "irgendwas", priority: "extrem", anfrage_class: "quatsch" });
    expect(r.mail_class).toBe("sonstiges");
    expect(r.priority).toBe("mittel"); // Default
    expect(r.anfrage_class).toBe("sonstiges");
  });

  it("liest 'null'-Strings und leere Werte als null", () => {
    const r = __normalizeForTests({
      mail_class: "spam",
      sender_name: "null",
      sender_email: "   ",
      invoice: { amount_gross: null, invoice_date: "kein datum" },
    });
    expect(r.sender_name).toBeNull();
    expect(r.sender_email).toBeNull();
    expect(r.invoice.amount_gross).toBeNull();
    expect(r.invoice.invoice_date).toBeNull();
  });
});
