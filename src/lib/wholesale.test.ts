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
    catalog_id: "cat-1", katalog_name: "Sonepar Österreich",
    hersteller: "KABEL-LEITUNG", hersteller_artnr: "NYM-J 3X1,5 RE",
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

// ── Sicherheitsnetz für die deterministische Preisformel ────────────────────
// Diese Tests fixieren das exakte Rechen-/Rundungsverhalten von
// applyWholesalePricing, damit Refactorings (z. B. Extraktion des Preis-Kerns)
// keine Cent-Abweichungen zwischen Voice-Pipeline und Editor-Picker erzeugen.
import { applyWholesalePricing, calcWholesaleVk, catalogHitToDocPosition, normalizeCatalogUnit } from "./wholesale";

const mkHit = (over: Partial<CatalogHit> = {}): CatalogHit => ({
  artikelnummer: "120159824", bezeichnung: "PVC-Mantelleitungen NYM-J 3X1,5",
  einheit: "MTR", ek_cent: 1000, listen_cent: null, rabatt_prozent: 0,
  warengruppe: null, ean: null, metall: null, score: 1,
  catalog_id: "cat-1", katalog_name: "Sonepar Österreich",
  hersteller: "MERTEN", hersteller_artnr: "MEG2301-0419", ...over,
});

describe("applyWholesalePricing", () => {
  it("rechnet VK = EK×Menge×(1+Materialaufschlag) + Minuten/60×Stundensatz (round2 auf die Summe)", () => {
    const gewerke = [{
      name: "Elektriker", stundensatz: 85,
      positionen: [{
        leistungsname: "Leitung verlegen", beschreibung: "" as string | null, einheit: "m", menge: 15,
        vk_netto_einheit: 0, aus_preisliste: false,
        material_artikelnummer: "120159824", material_menge_pro_einheit: 2, arbeitszeit_min_einheit: 30,
      }],
    }];
    const n = applyWholesalePricing(gewerke, [mkHit()], { aufschlagMaterialProzent: 30, stundensatzDefault: 70 });
    expect(n).toBe(1);
    // 10 € × 2 × 1,30 = 26 € Material + 0,5 h × 85 € = 42,50 € Lohn → 68,50 €
    expect(gewerke[0].positionen[0].vk_netto_einheit).toBe(68.5);
    expect(gewerke[0].positionen[0].beschreibung).toContain("Art. 120159824");
  });

  it("lässt Positionen aus der eigenen Preisliste unberührt", () => {
    const gewerke = [{
      name: "Elektriker",
      positionen: [{ leistungsname: "Regiestunde", vk_netto_einheit: 85, aus_preisliste: true, material_artikelnummer: "120159824" }],
    }];
    const n = applyWholesalePricing(gewerke, [mkHit()], { aufschlagMaterialProzent: 30, stundensatzDefault: 70 });
    expect(n).toBe(0);
    expect(gewerke[0].positionen[0].vk_netto_einheit).toBe(85);
  });

  it("Notnagel bepreist 0-€-Positionen per Token-Match mit Default-Minuten", () => {
    const gewerke = [{
      name: "Elektriker", stundensatz: 85,
      positionen: [{ leistungsname: "NYM-J 3x1,5 verlegen", beschreibung: "", einheit: "m", vk_netto_einheit: 0, aus_preisliste: false }],
    }];
    const n = applyWholesalePricing(gewerke, [mkHit()], { aufschlagMaterialProzent: 30, stundensatzDefault: 70 });
    expect(n).toBe(1);
    // m-Einheit → 6 Default-Minuten: 10 × 1,30 + 0,1 h × 85 = 13 + 8,50 = 21,50 €
    expect(gewerke[0].positionen[0].vk_netto_einheit).toBe(21.5);
    expect(gewerke[0].positionen[0].beschreibung).toContain("automatisch nachkalkuliert");
  });

  it("kennzeichnet Metall-Artikel mit Zuschlags-Hinweis", () => {
    const gewerke = [{
      positionen: [{ leistungsname: "x", beschreibung: "" as string | null, einheit: "m", vk_netto_einheit: 0, aus_preisliste: false,
        material_artikelnummer: "120159824", arbeitszeit_min_einheit: 0 }],
    }];
    applyWholesalePricing(gewerke, [mkHit({ metall: "CU" })], { aufschlagMaterialProzent: 0, stundensatzDefault: 70 });
    expect(gewerke[0].positionen[0].beschreibung).toContain("zzgl. tagesaktueller Metallzuschlag");
  });

  it("deterministischer VK übersteht die Calc-Pipeline unverändert (kein Doppelaufschlag durch verifyAufschlaege)", async () => {
    const { runCalcPipeline } = await import("./calc/pipeline");
    const { DEFAULT_KALK_SETTINGS } = await import("./calc/types");
    const gewerke = [{
      name: "Elektriker", stundensatz: 85,
      positionen: [{
        leistungsname: "NYM-J 3x1,5 verlegen", beschreibung: "" as string | null, einheit: "m", menge: 15,
        vk_netto_einheit: 0, aus_preisliste: false,
        material_artikelnummer: "120159824", material_menge_pro_einheit: 1, arbeitszeit_min_einheit: 6,
      }],
    }];
    applyWholesalePricing(gewerke, [mkHit()], { aufschlagMaterialProzent: 30, stundensatzDefault: 70, aufschlagGesamtProzent: 20 });
    // (10×1,30 + 0,1 h×85)×1,20 = (13 + 8,50)×1,2 = 25,80 €
    expect(gewerke[0].positionen[0].vk_netto_einheit).toBe(25.8);
    const out = runCalcPipeline(gewerke as never, {
      eingabeText: "", catalog: { positionen: [] }, stundensaetze: {}, settings: DEFAULT_KALK_SETTINGS,
    });
    // Vor dem preis_deterministisch-Guard hob verifyAufschlaege auf 30,60 € an
    // (vkSoll = vk×1,2) und fixPositionKosten driftete via Minutenrundung.
    expect(out[0].positionen[0].vk_netto_einheit).toBe(25.8);
  });

  it("summiert eine Material-Stückliste (mehrere Bauteile, anteilige Mengen) und listet sie in der Beschreibung", () => {
    const einsatz = mkHit({ artikelnummer: "111", bezeichnung: "SCHUKO-Einsatz reinweiß", ek_cent: 500 });
    const dose = mkHit({ artikelnummer: "222", bezeichnung: "Gerätedose UP", ek_cent: 50 });
    const rahmen = mkHit({ artikelnummer: "333", bezeichnung: "Rahmen 2-fach reinweiß", ek_cent: 310 });
    const gewerke = [{
      name: "Elektriker", stundensatz: 85,
      positionen: [{
        leistungsname: "Steckdose setzen", beschreibung: "" as string | null, einheit: "Stk", menge: 2,
        vk_netto_einheit: 0, aus_preisliste: false, arbeitszeit_min_einheit: 24,
        material_stueckliste: [
          { artikelnummer: "111", menge_pro_einheit: 1 },
          { artikelnummer: "222", menge_pro_einheit: 1 },
          { artikelnummer: "333", menge_pro_einheit: 0.5 }, // anteiliger 2-fach-Rahmen
          { artikelnummer: "999-fremd", menge_pro_einheit: 1 }, // NICHT im Block → ignorieren
        ],
      }],
    }];
    const n = applyWholesalePricing(gewerke, [einsatz, dose, rahmen], {
      aufschlagMaterialProzent: 30, stundensatzDefault: 70, aufschlagGesamtProzent: 20,
    });
    expect(n).toBe(1);
    // Material: 5,00 + 0,50 + 1,55 = 7,05 € → ×1,3 = 9,165; Lohn 24 min × 85 = 34,00
    // VK = (9,165 + 34) × 1,2 = 51,798 → 51,80 €
    expect(gewerke[0].positionen[0].vk_netto_einheit).toBe(51.8);
    const b = String(gewerke[0].positionen[0].beschreibung);
    expect(b).toContain("(Art. 111)");
    expect(b).toContain("0.50× ");
    expect(b).toContain("(Art. 333)");
    expect(b).toContain("Merten MEG2301-0419");
    expect(b).not.toContain("999-fremd");
  });

  it("wendet den Gesamtaufschlag an, wenn übergeben (Kalibrierung wie Prompt-Formel)", () => {
    const gewerke = [{
      stundensatz: 85,
      positionen: [{ leistungsname: "x", einheit: "Stk", vk_netto_einheit: 0, aus_preisliste: false,
        material_artikelnummer: "120159824", material_menge_pro_einheit: 1, arbeitszeit_min_einheit: 30 }],
    }];
    applyWholesalePricing(gewerke, [mkHit()], { aufschlagMaterialProzent: 30, stundensatzDefault: 70, aufschlagGesamtProzent: 20 });
    // (10×1,30 + 0,5×85) × 1,20 = (13 + 42,50) × 1,2 = 66,60 €
    expect(gewerke[0].positionen[0].vk_netto_einheit).toBe(66.6);
  });
});

describe("calcWholesaleVk", () => {
  it("rundet erst auf die Summe (Cent-identisch für Voice und Editor)", () => {
    expect(calcWholesaleVk({ ekCent: 333, stundensatz: 85, minuten: 7, aufschlagMaterialProzent: 30 }))
      .toBe(Math.round((3.33 * 1.3 + (7 / 60) * 85) * 100) / 100);
  });
  it("Default: Menge 1, 0 Minuten, kein Gesamtaufschlag", () => {
    expect(calcWholesaleVk({ ekCent: 1000, stundensatz: 85, aufschlagMaterialProzent: 30 })).toBe(13);
  });
});

describe("catalogHitToDocPosition", () => {
  const kalk = { aufschlagMaterial: 30, aufschlagGesamt: 20, stundensatzDefault: 85 };

  it("erzeugt eine fertige Materialposition mit VK, EK und Katalog-Verweis", () => {
    const p = catalogHitToDocPosition(mkHit({ einheit: "PCE", metall: "CU" }), { kalk, vatRate: 20 });
    expect(p.type).toBe("free");
    expect(p.name).toContain("NYM-J");
    expect(p.unit).toBe("Stk");                 // PCE → Stk
    expect(p.unit_cost).toBe(10);               // EK 10 €
    expect(p.material_cost).toBe(10);
    expect(p.unit_price).toBe(15.6);            // 10×1,30×1,20 (0 Minuten)
    expect(p.vat_rate).toBe(20);
    expect(p.surcharge_baked).toBe(true);       // kein Doppelaufschlag beim Speichern
    expect(p.price_overridden).toBe(false);
    expect(p.description).toContain("Art. 120159824");
    expect(p.description).toContain("Sonepar Österreich");
    expect(p.description).toContain("Metallzuschlag");
  });

  it("kalkuliert Montagezeit ein und respektiert vatRate 0 (Reverse Charge §19)", () => {
    const p = catalogHitToDocPosition(mkHit(), { kalk, minuten: 30, vatRate: 0 });
    // (10×1,30 + 0,5×85) × 1,2 = 66,60 €
    expect(p.unit_price).toBe(66.6);
    expect(p.labor_minutes).toBe(30);
    expect(p.vat_rate).toBe(0);
  });

  it("mappt Datanorm-Einheiten", () => {
    expect(normalizeCatalogUnit("MTR")).toBe("m");
    expect(normalizeCatalogUnit("PCE")).toBe("Stk");
    expect(normalizeCatalogUnit(null)).toBe("Stk");
    expect(normalizeCatalogUnit("XYZ")).toBe("XYZ");
  });
});
