import { describe, it, expect } from "vitest";
import { showPaymentForDoc, conditionsToPaymentMeta, emptyDocumentConditions } from "./payment-conditions";

describe("showPaymentForDoc", () => {
  it("normales Angebot zeigt KEINE Zahlungskonditionen", () => {
    expect(showPaymentForDoc("angebot")).toBe(false);
  });

  it("Auftrag zeigt KEINE automatische Zahlungsbox (nur Textbausteine)", () => {
    expect(showPaymentForDoc("auftrag")).toBe(false);
  });

  it("Nachtrag/Rechnung/SUB zeigen Zahlungskonditionen", () => {
    expect(showPaymentForDoc("nachtrag")).toBe(true);
    expect(showPaymentForDoc("rechnung")).toBe(true);
    expect(showPaymentForDoc("sub")).toBe(true);
  });
});

describe("conditionsToPaymentMeta", () => {
  it("liefert undefined ohne Zahlungsziel/Skonto", () => {
    expect(conditionsToPaymentMeta(emptyDocumentConditions())).toBeUndefined();
  });

  it("setzt withSkonto und Skontoziel korrekt", () => {
    const meta = conditionsToPaymentMeta({
      ...emptyDocumentConditions(),
      termDays: 30,
      skontoPercent: 3,
      skontoDays: 7,
    });
    expect(meta).toEqual({ termDays: 30, withSkonto: true, skontoPercent: 3, skontoDays: 7 });
  });
});
