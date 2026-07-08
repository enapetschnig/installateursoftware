// ============================================================
// Installateursoftware – KI-Prompt: Regiebericht per Sprache
//
// Wandelt ein Sprach-Transkript eines Monteurs in einen sauberen,
// kundentauglichen Regiebericht + strukturierte Zusatzangaben um.
// Vorbild: Fasching parse-voice-input (context "arbeiten"/"material"),
// hier zusammengeführt in EINEN JSON-Aufruf über /api/ai/chat.
//
// Mandantenfähig: der Firmenname wird eingesetzt (kein Hardcoding).
// Österreich-Kontext (Einheiten Stk/m/m²/lfm/h, 24h-Zeiten).
// ============================================================

export type RegieParseResult = {
  beschreibung: string;
  kunde_name?: string | null;
  kunde_ort?: string | null;
  start_time?: string | null;      // "HH:MM"
  end_time?: string | null;        // "HH:MM"
  pause_minutes?: number | null;
  materials: { material: string; menge: number; einheit: string; einzelpreis?: number | null }[];
};

/** System-Prompt für die Sprach-Auswertung eines Regieberichts (JSON-Ausgabe). */
export function regieParsePrompt(firmaName: string): string {
  const firma = (firmaName || "unserer Firma").trim();
  return `Du bist ein Assistent für ${firma} (Installateur / Haustechnik: Bad, Heizung, Sanitär, Service).
Du erhältst das Transkript einer Sprachaufnahme eines Monteurs zu einem Regie-/Arbeitseinsatz.
Erzeuge daraus einen sauberen Regiebericht als JSON.

Gib AUSSCHLIESSLICH gültiges JSON in genau diesem Schema zurück (keine Erklärung, kein Markdown):
{
  "beschreibung": string,            // durchgeführte Arbeiten, sauber formuliert
  "kunde_name": string|null,         // falls genannt (Person oder Firma), sonst null
  "kunde_ort": string|null,          // Ort/Adresse falls genannt, sonst null
  "start_time": string|null,         // "HH:MM" falls genannt, sonst null
  "end_time": string|null,           // "HH:MM" falls genannt, sonst null
  "pause_minutes": number|null,      // Pausenminuten falls genannt, sonst null
  "materials": [                     // verwendetes Material, leeres Array wenn keins
    { "material": string, "menge": number, "einheit": string }
  ]
}

Regeln für "beschreibung":
- Sachlich, professionell, kundentauglich – so wie es auf einem Regiebericht steht.
- Vollständige deutsche Sätze im Perfekt/Präteritum (z. B. "Der Heizkörper wurde montiert.", "Die Dichtheitsprüfung wurde durchgeführt.").
- Keine Ich-Form, keine Füllwörter ("also", "halt", "dann", "hab"), keine Umgangssprache.
- Tipp-/Erkennungsfehler still korrigieren, Fachbegriffe korrekt schreiben (Fußbodenheizung, Absperrventil, Silikonfuge …).
- Mehrere Tätigkeiten logisch gliedern (Sätze oder Aufzählung), nichts hinzuerfinden, nichts fachlich Relevantes weglassen.

Regeln für "materials":
- Jede Position: menge (Zahl), einheit (Stk, m, m², lfm, h, Rolle, Pauschale …), material (Bezeichnung).
- Nur explizit genanntes Material; wenn keine Menge genannt ist, menge = 1.

Regeln allgemein:
- Zeiten als 24h "HH:MM". Wenn Kunde/Zeiten/Material nicht genannt werden: null bzw. leeres Array.
- Antworte NUR mit dem JSON-Objekt.`;
}
