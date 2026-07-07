import { describe, it, expect } from "vitest";
import {
  contactRecipientLines,
  formatAddressInline,
  addressExtraParts,
  formatAddressExtraSuffix,
  formatStreetLine,
  hasRecipientOverride,
  recipientLinesFromOverride,
  resolveRecipientLines,
  getSalutationOptions,
} from "./contact-name";

describe("contactRecipientLines", () => {
  it("rendert zeilenweise; Adresszusatz im Slash-Format an die Straße angehängt, leere Zeilen entfallen", () => {
    const lines = contactRecipientLines({
      customer_type: "firma",
      company: "GRAWE",
      recipient_extra_line1: "z. Hd. Ing. Pittner",
      recipient_extra_line2: "",
      street: "Schrottgasse 7",
      address_extra: "Stiege 2, Top 4",
      zip: "1030",
      city: "Wien",
    });
    expect(lines).toEqual(["GRAWE", "z. Hd. Ing. Pittner", "Schrottgasse 7 / Stiege 2 / Top 4", "1030 Wien"]);
  });

  it("klebt Name/Firma und Straße NICHT mit Komma zusammen", () => {
    const lines = contactRecipientLines({
      customer_type: "firma",
      company: "Firma X",
      street: "Hauptstraße 1",
      zip: "1010",
      city: "Wien",
    });
    expect(lines).toEqual(["Firma X", "Hauptstraße 1", "1010 Wien"]);
    expect(lines.join("\n")).not.toContain(",");
  });

  it("liefert leeres Array ohne Kontakt", () => {
    expect(contactRecipientLines(null)).toEqual([]);
  });
});

describe("Adresszusatz (Slash-Format)", () => {
  it("zerlegt Komma- und Slash-getrennte Zusätze in Einzelteile", () => {
    expect(addressExtraParts("Stiege 2, Top 4")).toEqual(["Stiege 2", "Top 4"]);
    expect(addressExtraParts("Stiege 2 / Top 4 / Keller")).toEqual(["Stiege 2", "Top 4", "Keller"]);
    expect(addressExtraParts("")).toEqual([]);
    expect(addressExtraParts(null)).toEqual([]);
  });

  it("baut den Slash-Suffix für die Straßenzeile", () => {
    expect(formatAddressExtraSuffix("Stiege 2, Top 4")).toBe(" / Stiege 2 / Top 4");
    expect(formatAddressExtraSuffix("")).toBe("");
  });

  it("kombiniert Straße + Zusatz zu einer Slash-Zeile", () => {
    expect(formatStreetLine("Schrottgasse 7", "Stiege 2, Top 4")).toBe("Schrottgasse 7 / Stiege 2 / Top 4");
    expect(formatStreetLine("Schrottgasse 7", "")).toBe("Schrottgasse 7");
    expect(formatStreetLine("", "Stiege 2, Top 4")).toBe("Stiege 2 / Top 4");
    expect(formatStreetLine("", "")).toBe("");
  });
});

describe("Empfänger-Override (dokumentbezogene Anschrift)", () => {
  const ovr = {
    enabled: true,
    name: "Abweichend GmbH",
    line1: "z. Hd. Buchhaltung",
    line2: "",
    street: "Andere Gasse 9",
    address_extra: "Top 1",
    zip: "1020",
    city: "Wien",
    country: "Österreich",
  };
  const kunde = {
    customer_type: "firma",
    company: "Kunde AG",
    street: "Kundenweg 1",
    zip: "1010",
    city: "Wien",
  };

  it("hasRecipientOverride: aktiv nur wenn enabled und befüllt", () => {
    expect(hasRecipientOverride(ovr)).toBe(true);
    expect(hasRecipientOverride({ ...ovr, enabled: false })).toBe(false);
    expect(hasRecipientOverride({ enabled: true })).toBe(false);
    expect(hasRecipientOverride(null)).toBe(false);
  });

  it("recipientLinesFromOverride: Slash-Zusatz + Land als letzte Zeile, leere entfallen", () => {
    expect(recipientLinesFromOverride(ovr)).toEqual([
      "Abweichend GmbH",
      "z. Hd. Buchhaltung",
      "Andere Gasse 9 / Top 1",
      "1020 Wien",
      "Österreich",
    ]);
  });

  it("resolveRecipientLines: Override gewinnt, sonst Kundenstamm", () => {
    expect(resolveRecipientLines(ovr, kunde)[0]).toBe("Abweichend GmbH");
    expect(resolveRecipientLines({ ...ovr, enabled: false }, kunde)).toEqual([
      "Kunde AG",
      "Kundenweg 1",
      "1010 Wien",
    ]);
    expect(resolveRecipientLines(null, kunde)).toEqual(["Kunde AG", "Kundenweg 1", "1010 Wien"]);
  });
});

describe("formatAddressInline", () => {
  it("trimmt und setzt kein Leerzeichen vor das Komma", () => {
    expect(formatAddressInline({ street: "Heygasse 3 ", zip: "1030", city: "Wien" })).toBe(
      "Heygasse 3, 1030 Wien"
    );
  });

  it("enthält Adresszusatz im Slash-Format in der Einzeiler-Adresse", () => {
    expect(
      formatAddressInline({
        street: "Heygasse 3",
        address_extra: "Top 4, Stiege 2",
        zip: "1030",
        city: "Wien",
      })
    ).toBe("Heygasse 3 / Top 4 / Stiege 2, 1030 Wien");
  });

  it("nur Ort ohne Straße → keine führende Kommastelle", () => {
    expect(formatAddressInline({ street: "", zip: "1030", city: "Wien" })).toBe("1030 Wien");
  });

  it("leere/fehlende Eingabe → leerer String", () => {
    expect(formatAddressInline(null)).toBe("");
    expect(formatAddressInline({})).toBe("");
  });
});

describe("getSalutationOptions", () => {
  it("liefert die Standardanreden und hält bestehende Werte erhalten", () => {
    expect(getSalutationOptions()).toEqual(["Herr", "Frau"]);
    expect(getSalutationOptions("Divers")).toEqual(["Divers", "Herr", "Frau"]);
  });
});
