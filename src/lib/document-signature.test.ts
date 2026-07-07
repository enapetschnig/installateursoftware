import { describe, it, expect } from "vitest";
import {
  pickDocumentSignatureHtml,
  normalizeSignatureSource,
  normalizeSignatureMode,
  previewEmployeeDocSignature,
} from "./document-signature";

describe("pickDocumentSignatureHtml", () => {
  it("nimmt die Mitarbeiter-Signatur nur, wenn sie AKTIV und befüllt ist", () => {
    expect(pickDocumentSignatureHtml(
      { document_signature_active: true, document_signature_html: "<p>Max Muster</p>" },
      "<p>Firma GmbH</p>",
    )).toBe("<p>Max Muster</p>");
    // inaktiv → Firmen-Default, auch wenn eigene Signatur befüllt ist
    expect(pickDocumentSignatureHtml(
      { document_signature_active: false, document_signature_html: "<p>Max</p>" },
      "<p>Firma GmbH</p>",
    )).toBe("<p>Firma GmbH</p>");
  });

  it("fällt auf Firmen-Default zurück, wenn Mitarbeiter-Signatur leer/fehlt", () => {
    expect(pickDocumentSignatureHtml(
      { document_signature_active: true, document_signature_html: "   " },
      "<p>Firma GmbH</p>",
    )).toBe("<p>Firma GmbH</p>");
    expect(pickDocumentSignatureHtml(null, "<p>Firma GmbH</p>")).toBe("<p>Firma GmbH</p>");
  });

  it("liefert leer, wenn nichts konfiguriert ist (Fallback auf Auto-Signatur in der Engine)", () => {
    expect(pickDocumentSignatureHtml(null, null)).toBe("");
    expect(pickDocumentSignatureHtml({ document_signature_active: true, document_signature_html: "" }, "  ")).toBe("");
  });
});

describe("normalizeSignatureSource", () => {
  it("akzeptiert gültige Quellen", () => {
    expect(normalizeSignatureSource("company")).toBe("company");
    expect(normalizeSignatureSource("creator")).toBe("creator");
    expect(normalizeSignatureSource("none")).toBe("none");
  });
  it("fällt bei unbekannten/leeren Werten auf 'company' zurück", () => {
    expect(normalizeSignatureSource(null)).toBe("company");
    expect(normalizeSignatureSource(undefined)).toBe("company");
    expect(normalizeSignatureSource("")).toBe("company");
    expect(normalizeSignatureSource("foo")).toBe("company");
  });
});

describe("normalizeSignatureMode", () => {
  it("erkennt force_company, sonst allow_employee (Default)", () => {
    expect(normalizeSignatureMode("force_company")).toBe("force_company");
    expect(normalizeSignatureMode("allow_employee")).toBe("allow_employee");
    expect(normalizeSignatureMode(null)).toBe("allow_employee");
    expect(normalizeSignatureMode(undefined)).toBe("allow_employee");
    expect(normalizeSignatureMode("foo")).toBe("allow_employee");
  });
});

describe("previewEmployeeDocSignature", () => {
  const emp = { document_signature_active: true, document_signature_html: "<p>Ich</p>" };

  it("force_company → immer Firmensignatur (Quelle 'forced_company')", () => {
    const r = previewEmployeeDocSignature(emp, "<p>Firma</p>", "force_company");
    expect(r.source).toBe("forced_company");
    expect(r.html).toBe("<p>Firma</p>");
  });

  it("allow_employee + aktiv+befüllt → eigene Signatur", () => {
    const r = previewEmployeeDocSignature(emp, "<p>Firma</p>", "allow_employee");
    expect(r.source).toBe("employee");
    expect(r.html).toBe("<p>Ich</p>");
  });

  it("allow_employee + inaktiv → Firmen-Fallback", () => {
    const r = previewEmployeeDocSignature(
      { document_signature_active: false, document_signature_html: "<p>Ich</p>" },
      "<p>Firma</p>",
      "allow_employee",
    );
    expect(r.source).toBe("company_fallback");
    expect(r.html).toBe("<p>Firma</p>");
  });

  it("allow_employee + nichts hinterlegt → auto (Engine-Fallback)", () => {
    const r = previewEmployeeDocSignature(null, "", "allow_employee");
    expect(r.source).toBe("auto");
    expect(r.html).toBe("");
  });
});
