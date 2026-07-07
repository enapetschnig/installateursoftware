import { describe, it, expect } from "vitest";
import { shouldBlockNavigation } from "./unsaved-changes";

describe("shouldBlockNavigation", () => {
  it("blockt nur bei ungespeicherten Änderungen UND echtem Pfadwechsel", () => {
    expect(shouldBlockNavigation(true, "/einstellungen", "/mitarbeiter")).toBe(true);
  });

  it("blockt nicht ohne ungespeicherte Änderungen", () => {
    expect(shouldBlockNavigation(false, "/einstellungen", "/mitarbeiter")).toBe(false);
  });

  it("blockt nicht bei gleichem Pfad (z. B. nur Query/Hash-Parameter)", () => {
    expect(shouldBlockNavigation(true, "/einstellungen", "/einstellungen")).toBe(false);
  });
});
