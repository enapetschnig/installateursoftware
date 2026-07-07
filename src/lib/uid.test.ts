import { describe, it, expect } from "vitest";
import { normalizeUid, isValidUid, uidSuffix, applyUidInput } from "./uid";

describe("normalizeUid", () => {
  it("normalisiert österreichische UID in verschiedenen Schreibweisen auf ATU…", () => {
    expect(normalizeUid("ATU12345678")).toBe("ATU12345678");
    expect(normalizeUid("atu12345678")).toBe("ATU12345678");
    expect(normalizeUid("ATU 1234 5678")).toBe("ATU12345678");
    expect(normalizeUid("atu-12345678")).toBe("ATU12345678");
    expect(normalizeUid("12345678")).toBe("ATU12345678");
    expect(normalizeUid("AT12345678")).toBe("ATU12345678"); // U vergessen
    expect(normalizeUid("U12345678")).toBe("ATU12345678");
  });

  it("liefert leeren String für leere/whitespace Eingabe", () => {
    expect(normalizeUid("")).toBe("");
    expect(normalizeUid("   ")).toBe("");
    expect(normalizeUid(null)).toBe("");
    expect(normalizeUid(undefined)).toBe("");
  });

  it("behält ausländische UID (Ländercode) unverändert (tolerant)", () => {
    expect(normalizeUid("DE123456789")).toBe("DE123456789");
    expect(normalizeUid("de 123456789")).toBe("DE123456789");
    expect(normalizeUid("IT12345678901")).toBe("IT12345678901");
  });
});

describe("isValidUid", () => {
  it("leere UID ist gültig (optionales Feld)", () => {
    expect(isValidUid("")).toBe(true);
    expect(isValidUid(null)).toBe(true);
  });

  it("österreichische UID braucht ATU + genau 8 Ziffern", () => {
    expect(isValidUid("ATU12345678")).toBe(true);
    expect(isValidUid("12345678")).toBe(true); // wird zu ATU12345678 normalisiert
    expect(isValidUid("ATU1234567")).toBe(false); // 7 Ziffern
    expect(isValidUid("ATU123456789")).toBe(false); // 9 Ziffern
    expect(isValidUid("ATU1234567X")).toBe(false); // Buchstabe
  });

  it("ausländische UID wird tolerant akzeptiert", () => {
    expect(isValidUid("DE123456789")).toBe(true);
    expect(isValidUid("X")).toBe(false); // zu kurz / kein Ländercode
  });
});

describe("uidSuffix", () => {
  it("entfernt das führende ATU für die Feldanzeige", () => {
    expect(uidSuffix("ATU12345678")).toBe("12345678");
    expect(uidSuffix("atu12345678")).toBe("12345678");
    expect(uidSuffix("")).toBe("");
  });

  it("gibt ausländische UID vollständig zurück", () => {
    expect(uidSuffix("DE123456789")).toBe("DE123456789");
  });
});

describe("applyUidInput", () => {
  it("getippte Ziffern werden als österreichisches ATU-Suffix interpretiert", () => {
    expect(applyUidInput("12345678")).toBe("ATU12345678");
    expect(applyUidInput("1")).toBe("ATU1");
  });

  it("eingefügte vollständige UID wird korrekt normalisiert", () => {
    expect(applyUidInput("ATU12345678")).toBe("ATU12345678");
    expect(applyUidInput("DE123456789")).toBe("DE123456789");
  });

  it("leere Eingabe bleibt leer", () => {
    expect(applyUidInput("")).toBe("");
  });
});
