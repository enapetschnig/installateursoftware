// Tests für src/lib/wholesale.ts – reine Helfer (ohne Netzwerk/DB).
import { describe, it, expect } from "vitest";

import { extractSearchQueries, buildWholesaleBlock, type CatalogHit } from "./wholesale";

describe("extractSearchQueries", () => {
  it("zerlegt ein typisches Elektro-Transkript in fachliche Suchbegriffe", () => {
    const t =
      "Wir verlegen 15 Meter NYM-J 3x1,5 und setzen 8 Steckdosen Gira weiß, " +
      "dann noch einen FI Schutzschalter 40A 30mA einbauen.";
    const qs = extractSearchQueries(t);
    expect(qs.some((q) => q.includes("nym-j") && q.includes("3x1,5"))).toBe(true);
    expect(qs.some((q) => q.includes("steckdosen") && q.includes("gira"))).toBe(true);
    expect(qs.some((q) => q.includes("schutzschalter") && q.includes("40a"))).toBe(true);
  });

  it("filtert Stoppwörter und reine Mengen, behält Dimensionen", () => {
    const qs = extractSearchQueries("Bitte 25 Stück Schuko Steckdose unterputz montieren");
    expect(qs.length).toBeGreaterThan(0);
    const joined = qs.join(" ");
    expect(joined).not.toMatch(/\bbitte\b|\bmontieren\b|\b25\b/);
    expect(joined).toContain("schuko");
  });

  it("liefert [] für leere/inhaltslose Eingaben", () => {
    expect(extractSearchQueries("")).toEqual([]);
    expect(extractSearchQueries("und dann noch bitte")).toEqual([]);
  });
});

describe("buildWholesaleBlock", () => {
  const hit: CatalogHit = {
    artikelnummer: "12015982432", bezeichnung: "PVC-Mantelleitungen NYM-J 3X1,5",
    einheit: "MTR", ek_cent: 46.6, listen_cent: 145.6, rabatt_prozent: 68,
    warengruppe: "10", ean: null, metall: "CU", score: 1,
  };
  it("formatiert EK in Euro mit Komma und kennzeichnet Metallzuschlag", () => {
    const block = buildWholesaleBlock([hit]);
    expect(block).toContain("GROSSHANDELSKATALOG");
    expect(block).toContain("12015982432");
    expect(block).toContain("EK 0,47 €");
    expect(block).toContain("(+CU-Zuschlag)");
  });
  it("liefert leeren String ohne Treffer (Voice-Flow bleibt unverändert)", () => {
    expect(buildWholesaleBlock([])).toBe("");
  });
});
