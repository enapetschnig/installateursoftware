import { describe, it, expect } from "vitest";
import { runVoiceRegie, regieMaterialsFromParse } from "./runVoiceRegie";
import type { AiCompleteOpts, AiCompleteResult } from "../ai/aiComplete";

const okAi = (json: unknown) =>
  async (_opts: AiCompleteOpts): Promise<AiCompleteResult> =>
    ({ text: JSON.stringify(json) }) as AiCompleteResult;

describe("runVoiceRegie", () => {
  it("mappt ein vollständiges KI-JSON auf RegieParseResult", async () => {
    const r = await runVoiceRegie(
      { text: "Diktat", firmaName: "Bad.Werk GmbH" },
      {
        aiComplete: okAi({
          beschreibung: "Der Heizkörper wurde montiert.",
          kunde_name: "Familie Huber",
          kunde_ort: "Hallein",
          start_time: "8:00",
          end_time: "12:30",
          pause_minutes: 30,
          materials: [
            { material: "Kupferrohr 18 mm", menge: 2, einheit: "m" },
            { material: "Pressfitting", menge: 4, einheit: "Stk" },
          ],
        }),
      },
    );
    expect(r.beschreibung).toBe("Der Heizkörper wurde montiert.");
    expect(r.kunde_name).toBe("Familie Huber");
    expect(r.start_time).toBe("08:00"); // normalisiert auf HH:MM
    expect(r.end_time).toBe("12:30");
    expect(r.pause_minutes).toBe(30);
    expect(r.materials).toHaveLength(2);
    expect(r.materials[0]).toEqual({ material: "Kupferrohr 18 mm", menge: 2, einheit: "m" });
  });

  it("setzt Defaults bei fehlenden Feldern und filtert leeres Material", async () => {
    const r = await runVoiceRegie(
      { text: "x" },
      {
        aiComplete: okAi({
          beschreibung: "Nur Arbeit, kein Rest.",
          materials: [
            { material: "", menge: 3, einheit: "Stk" }, // leer → gefiltert
            { material: "Silikon", menge: 0, einheit: "" }, // menge<=0 → 1, einheit → Stk
          ],
        }),
      },
    );
    expect(r.kunde_name).toBeNull();
    expect(r.start_time).toBeNull();
    expect(r.materials).toEqual([{ material: "Silikon", menge: 1, einheit: "Stk" }]);
  });

  it("regieMaterialsFromParse erzeugt speicherbare RegieMaterial-Zeilen", () => {
    const rows = regieMaterialsFromParse({
      beschreibung: "",
      materials: [{ material: "Rohr", menge: 5, einheit: "m" }],
    });
    expect(rows[0]).toMatchObject({ article_id: null, material: "Rohr", menge: 5, einheit: "m", einzelpreis: 0, sort_order: 0 });
  });

  it("wirft bei leerem Text ohne KI-Aufruf", async () => {
    let called = false;
    await expect(
      runVoiceRegie({ text: "   " }, { aiComplete: async () => { called = true; return { text: "{}" } as AiCompleteResult; } }),
    ).rejects.toThrow(/Kein Text/);
    expect(called).toBe(false);
  });
});
