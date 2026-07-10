// ============================================================
// Tests fuer kalkSettingsFromCompanyRow (Migr. 0125 Mapping)
// ============================================================

import { describe, expect, it } from "vitest";
import { kalkSettingsFromCompanyRow } from "./loadStammdatenForVoice";
import { DEFAULT_KALK_SETTINGS } from "../calc/types";

describe("kalkSettingsFromCompanyRow", () => {
  it("null-Row → komplette Defaults", () => {
    expect(kalkSettingsFromCompanyRow(null)).toEqual(DEFAULT_KALK_SETTINGS);
  });

  it("vollstaendige Row wird 1:1 gemappt", () => {
    const out = kalkSettingsFromCompanyRow({
      kalk_aufschlag_gesamt: 25,
      kalk_aufschlag_material: 35,
      kalk_stundensatz_default: 85,
      kalk_material_cap: 40,
    });
    expect(out).toEqual({
      aufschlagGesamt: 25,
      aufschlagMaterial: 35,
      stundensatzDefault: 85,
      materialCapPercent: 40,
      autoNebenpositionen: true,
    });
  });

  it("halb gepflegte Row: fehlende Felder fallen einzeln auf Default", () => {
    const out = kalkSettingsFromCompanyRow({
      kalk_aufschlag_gesamt: 15,
      kalk_aufschlag_material: null,
      kalk_stundensatz_default: undefined,
    });
    expect(out.aufschlagGesamt).toBe(15);
    expect(out.aufschlagMaterial).toBe(DEFAULT_KALK_SETTINGS.aufschlagMaterial);
    expect(out.stundensatzDefault).toBe(DEFAULT_KALK_SETTINGS.stundensatzDefault);
    expect(out.materialCapPercent).toBe(DEFAULT_KALK_SETTINGS.materialCapPercent);
  });

  it("Postgres numeric kommt als String an → wird geparst", () => {
    const out = kalkSettingsFromCompanyRow({
      // supabase-js liefert numeric je nach Konfiguration als string
      kalk_aufschlag_gesamt: "22.5" as unknown as number,
      kalk_stundensatz_default: "90" as unknown as number,
    });
    expect(out.aufschlagGesamt).toBe(22.5);
    expect(out.stundensatzDefault).toBe(90);
  });

  it("negative/ungueltige Werte fallen auf Default (kein Absturz)", () => {
    const out = kalkSettingsFromCompanyRow({
      kalk_aufschlag_gesamt: -5,
      kalk_aufschlag_material: NaN,
      kalk_stundensatz_default: "abc" as unknown as number,
    });
    expect(out.aufschlagGesamt).toBe(DEFAULT_KALK_SETTINGS.aufschlagGesamt);
    expect(out.aufschlagMaterial).toBe(DEFAULT_KALK_SETTINGS.aufschlagMaterial);
    expect(out.stundensatzDefault).toBe(DEFAULT_KALK_SETTINGS.stundensatzDefault);
  });

  it("0 ist ein gueltiger Wert (kein Fallback)", () => {
    const out = kalkSettingsFromCompanyRow({ kalk_aufschlag_gesamt: 0 });
    expect(out.aufschlagGesamt).toBe(0);
  });
});
