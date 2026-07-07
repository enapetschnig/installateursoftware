import { describe, it, expect } from "vitest";
import { isReverseCharge, withParagraph19Note, PARAGRAPH_19_NOTE } from "./offer-types";

describe("§19 Reverse-Charge (Bauleistung ohne MwSt)", () => {
  it("isReverseCharge: 0 % USt bei positivem Netto", () => {
    expect(isReverseCharge(1000, 0)).toBe(true);
    expect(isReverseCharge(1000, 200)).toBe(false); // reguläre 20 %
    expect(isReverseCharge(0, 0)).toBe(false);       // leere Rechnung
    expect(isReverseCharge(null, null)).toBe(false);
  });

  it("withParagraph19Note: hängt §19-Hinweis nur bei Reverse-Charge an", () => {
    expect(withParagraph19Note("<p>Danke.</p>", true)).toBe(`<p>Danke.</p><p>${PARAGRAPH_19_NOTE}</p>`);
    expect(withParagraph19Note("<p>Danke.</p>", false)).toBe("<p>Danke.</p>");
  });

  it("withParagraph19Note: idempotent – kein doppelter Hinweis", () => {
    const once = withParagraph19Note("<p>Danke.</p>", true)!;
    expect(withParagraph19Note(once, true)).toBe(once);
    // bereits vorhandener §19-Text wird nicht erneut angehängt
    expect(withParagraph19Note("<p>… gemäß § 19 Abs. 1a UStG …</p>", true)).toBe("<p>… gemäß § 19 Abs. 1a UStG …</p>");
  });

  it("withParagraph19Note: greift für ALLE Varianten unabhängig vom Schlusstext", () => {
    for (const closing of ["", "<p>Standard</p>", "<p>Pauschal</p>", "<p>Regie</p>"]) {
      const out = withParagraph19Note(closing, true) ?? "";
      expect(out).toContain(PARAGRAPH_19_NOTE);
    }
  });
});
