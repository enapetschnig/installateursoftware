// ============================================================
// Tests fuer src/lib/voice/voiceMetaToNotes.ts
// ============================================================

import { describe, expect, it } from "vitest";
import { buildVoiceNotesSuffix, mergeVoiceNotes } from "./voiceMetaToNotes";

describe("buildVoiceNotesSuffix", () => {
  it("leerer Suffix bei beiden Listen leer", () => {
    expect(buildVoiceNotesSuffix({})).toBe("");
    expect(buildVoiceNotesSuffix({ ergaenzungen: [], hinweise: [] })).toBe("");
  });

  it("nur Ergaenzungen formatiert mit Header + Bullets", () => {
    const out = buildVoiceNotesSuffix({ ergaenzungen: ["Schlüssel abholen", "Parkplatz im Hof"] });
    expect(out).toBe(
      "\n\nErgänzungen aus Sprachnotiz:\n• Schlüssel abholen\n• Parkplatz im Hof",
    );
  });

  it("nur Hinweise formatiert mit Header + Bullets", () => {
    const out = buildVoiceNotesSuffix({ hinweise: ["Vor 18 Uhr melden"] });
    expect(out).toBe("\n\nHinweise aus Sprachnotiz:\n• Vor 18 Uhr melden");
  });

  it("beide Bloecke mit Leerzeile getrennt", () => {
    const out = buildVoiceNotesSuffix({
      ergaenzungen: ["hochwertige Farbe"],
      hinweise: ["rostfreie Schrauben"],
    });
    expect(out).toBe(
      "\n\nErgänzungen aus Sprachnotiz:\n• hochwertige Farbe\n\nHinweise aus Sprachnotiz:\n• rostfreie Schrauben",
    );
  });
});

describe("mergeVoiceNotes", () => {
  it("haengt Suffix an bestehende Notizen an (mit Leerzeile)", () => {
    const out = mergeVoiceNotes("Bestehende Notiz", {
      ergaenzungen: ["Bitte vor 18 Uhr melden"],
    });
    expect(out).toBe(
      "Bestehende Notiz\n\nErgänzungen aus Sprachnotiz:\n• Bitte vor 18 Uhr melden",
    );
  });

  it("leere prev-Notes → Suffix ohne fuehrende Leerzeilen (getrimmt)", () => {
    const out = mergeVoiceNotes("", { hinweise: ["Achtung"] });
    expect(out).toBe("Hinweise aus Sprachnotiz:\n• Achtung");
  });

  it("null/undefined prev-Notes verhalten sich wie leerer String", () => {
    expect(mergeVoiceNotes(null, { ergaenzungen: ["a"] })).toBe(
      "Ergänzungen aus Sprachnotiz:\n• a",
    );
    expect(mergeVoiceNotes(undefined, { ergaenzungen: ["b"] })).toBe(
      "Ergänzungen aus Sprachnotiz:\n• b",
    );
  });

  it("keine Meta-Listen → prev unveraendert (getrimmt)", () => {
    expect(mergeVoiceNotes("Bestehend  ", {})).toBe("Bestehend");
    expect(mergeVoiceNotes("", {})).toBe("");
  });

  it("idempotent: zweimaliges Mergen liefert nicht doppelten Block (das ist Aufgabe des Callers)", () => {
    // Vertrag: diese Funktion ist NICHT idempotent — sie haengt jedes Mal
    // wieder an. Der Caller darf sie nur einmal pro Voice-Submit aufrufen.
    const first = mergeVoiceNotes("X", { ergaenzungen: ["a"] });
    const second = mergeVoiceNotes(first, { ergaenzungen: ["a"] });
    expect(second).toContain("• a\n\nErgänzungen aus Sprachnotiz:\n• a");
  });
});
