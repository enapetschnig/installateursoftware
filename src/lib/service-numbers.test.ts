import { describe, it, expect } from "vitest";
import { isReservedSpecialServiceNumber } from "./service-numbers";

describe("isReservedSpecialServiceNumber", () => {
  it("erkennt den reservierten Spezialbereich 980–999", () => {
    for (const nr of ["01-980", "01-990", "05-996", "01-997", "02-998", "13-999", "99-999"]) {
      expect(isReservedSpecialServiceNumber(nr)).toBe(true);
    }
  });

  it("lässt echte Leistungen außerhalb 980–999 unangetastet", () => {
    for (const nr of ["02-910", "02-911", "02-912", "01-001", "09-100", "07-979", "12-900"]) {
      expect(isReservedSpecialServiceNumber(nr)).toBe(false);
    }
  });

  it("trimmt Leerzeichen", () => {
    expect(isReservedSpecialServiceNumber("  01-997  ")).toBe(true);
  });

  it("behandelt leere/ungültige Werte sicher als false", () => {
    for (const nr of [null, undefined, "", "abc", "1-997", "01-99", "01-9999", "019997"]) {
      expect(isReservedSpecialServiceNumber(nr as string | null | undefined)).toBe(false);
    }
  });
});
