import { describe, it, expect } from "vitest";
import { pickEmailSignatureHtml, resolveEmailSignature } from "./email-signature";

describe("pickEmailSignatureHtml", () => {
  it("nimmt aktive Mitarbeiter-E-Mail-Signatur vor dem Firmen-Default", () => {
    expect(pickEmailSignatureHtml(
      { signature_active: true, signature_html: "<p>Max Muster</p>" },
      "<p>Firma GmbH</p>",
    )).toBe("<p>Max Muster</p>");
  });

  it("fällt auf Firmen-Default zurück, wenn Mitarbeiter-Signatur inaktiv oder leer ist", () => {
    expect(pickEmailSignatureHtml(
      { signature_active: false, signature_html: "<p>Max</p>" },
      "<p>Firma GmbH</p>",
    )).toBe("<p>Firma GmbH</p>");
    expect(pickEmailSignatureHtml(
      { signature_active: true, signature_html: "   " },
      "<p>Firma GmbH</p>",
    )).toBe("<p>Firma GmbH</p>");
    expect(pickEmailSignatureHtml(null, "<p>Firma GmbH</p>")).toBe("<p>Firma GmbH</p>");
  });

  it("liefert leer, wenn weder Mitarbeiter- noch Firmen-Signatur vorhanden ist", () => {
    expect(pickEmailSignatureHtml(null, null)).toBe("");
    expect(pickEmailSignatureHtml({ signature_active: false, signature_html: "" }, "  ")).toBe("");
  });

  it("behandelt visuell leeres RichText-Markup (<p><br></p>) als leer und nutzt den Firmen-Fallback", () => {
    expect(pickEmailSignatureHtml(
      { signature_active: true, signature_html: "<p><br></p>" },
      "<p>Firma GmbH</p>",
    )).toBe("<p>Firma GmbH</p>");
    // auch der Firmen-Default kann visuell leer sein → dann keine Signatur
    expect(pickEmailSignatureHtml(
      { signature_active: true, signature_html: "<div>&nbsp;</div>" },
      "<p><br></p>",
    )).toBe("");
  });
});

describe("resolveEmailSignature (Quelle für UI)", () => {
  it("source=employee bei aktiver eigener Signatur", () => {
    expect(resolveEmailSignature(
      { signature_active: true, signature_html: "<p>Ich</p>" }, "<p>Firma</p>",
    )).toEqual({ html: "<p>Ich</p>", source: "employee" });
  });

  it("source=company bei inaktiver/leerer Mitarbeiter-Signatur + vorhandenem Firmen-Default", () => {
    expect(resolveEmailSignature(
      { signature_active: false, signature_html: "<p>Ich</p>" }, "<p>Firma</p>",
    )).toEqual({ html: "<p>Firma</p>", source: "company" });
    expect(resolveEmailSignature(null, "<p>Firma</p>")).toEqual({ html: "<p>Firma</p>", source: "company" });
  });

  it("source=none, wenn gar keine Signatur konfiguriert ist", () => {
    expect(resolveEmailSignature(null, null)).toEqual({ html: "", source: "none" });
    expect(resolveEmailSignature({ signature_active: true, signature_html: " " }, " "))
      .toEqual({ html: "", source: "none" });
  });
});
