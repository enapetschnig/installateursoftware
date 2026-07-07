# Angebote per Sprache

Sprachgesteuertes Erstellen vollständiger Angebote inkl. cent-genauer Kalkulation, Gewerk-Routing und Sonderregeln (Reinigung, Baustelleneinrichtung, Material-Cap).

## Was es kann

Im **leeren Entwurf-Angebot** erscheint im "+ KI"-Menü ein neuer Eintrag `+ KI <Variante>angebot` (Variante = Standard/Pauschal/Regie je nach `offer_types.slug`). Klick öffnet ein Modal mit Mikrofon-Aufnahme. Nach dem Sprechen:

1. **Transkription** über `/api/ai/transcribe` (OpenAI `gpt-4o-transcribe`).
2. **Feld-Extraktion**: aus dem Roh-Text werden Projektnummer, Adresse, Betrifft und Positionen-Text getrennt; Ergänzungen/Hinweise herausgefiltert.
3. **KI-Generierung** über `/api/ai/chat` (gpt-4o) mit dem deutschen Bau-Prompt (`KOMPLETT_ANGEBOT_PROMPT`), der 1:1 aus der bau4you-App portiert wurde.
4. **Kalkulations-Pipeline** (`runCalcPipeline`) wendet alle Sonderregeln an: Katalog-Matching, Regie+Material-Pärchen, Baustelleneinrichtung-Staffel, Reinigung-Auto-Kalk, Material-Cap 30 %, 2-Stufen-Aufschlag, Gewerk-Sortierung.
5. **Mapping** in `DocPosition[]` (b4y-internes Format) via `heroToDocPositions`-Adapter.
6. **Einfügen** in den Editor — Autosave läuft automatisch.

## Sichtbarkeits-Regeln

Der Voice-Knopf wird strikt gegated:

| Angebots-Zustand | "+ KI \<X\>angebot" (Voice) | "+ KI Leistung" (Einzel) |
|---|---|---|
| `status="entwurf"` + 0 Positionen | ✅ sichtbar | ✅ sichtbar |
| `status="entwurf"` + Positionen | ❌ versteckt | ✅ sichtbar |
| `status` ∈ {versendet, angenommen, abgelehnt, abgeschlossen, storniert} | ❌ versteckt | ❌ versteckt |

Damit kann ein bestehendes Angebot nicht versehentlich durch eine neue Sprachaufnahme überschrieben werden.

## Komponenten-Karte

```
src/pages/OfferEditor.tsx
  └─ buildAiActions()             — Sichtbarkeits-Logik
  └─ VoiceAngebotDialog           — Modal mit SpeechInput + Status-LED
  └─ applyVoiceResult()           — Result-Handler: heroToDocPositions → builder.append

src/components/voice/
  ├─ VoiceAngebotDialog.tsx       — Hauptmodal (Mic-Eingabe + KI-Flow)
  ├─ SpeechInput.tsx              — 4-Felder-Eingabe mit Mikrofon
  └─ InlineMicButton.tsx          — Kleiner Mic-Button für Inline-Edit

src/components/dialog/
  └─ AddPositionDialog.tsx        — Stub für Einzelposition (Phase-6)

src/lib/calc/                     — Pipeline & Adapter
  ├─ pipeline.ts                  — runCalcPipeline-Orchestrator
  ├─ types.ts                     — Position, Gewerk, KalkSettings, GEWERKE_REIHENFOLGE, GEWERK_PREFIX_MAP (Hero-konform)
  ├─ fixPositionKosten.ts         — VK-Konsistenz mit Snap-to-glatt
  ├─ enforceUserZeitangabe.ts     — User-Stunden gewinnen + 30%-Material-Cap
  ├─ enrichFromCatalog.ts         — Katalog-Matching mit Hero-Quirks
  ├─ regiePaerchen.ts             — ensureRegieMaterial + applyRegieMaterial
  ├─ baustelleneinrichtung.ts     — Staffel-Parser für 01-001/01-002
  ├─ smartReinigung.ts            — Bodenfläche schätzen, 13-001/13-100 wählen, Cap 3000 €
  ├─ fixNullpreise.ts             — 0-€-Fallbacks (Reinigung 10.40, Pauschal ≥ 2h)
  ├─ aufschlagModel.ts            — 2-Stufen-Aufschlag (Material +30 %, dann Total +20 %)
  ├─ fixGewerk.ts                 — Präfix-Routing + SPEZIAL_REGELN (Container → Abbruch etc.)
  ├─ sortPositionen.ts            — GEWERKE_REIHENFOLGE + Regie-Pärchen unzertrennlich
  ├─ zimmer.ts                    — Räume aus Text in Beschreibungen einbauen
  ├─ detectKiVorschlag.ts         — KI-Vorschlag-Badge (3-Ebenen-Match)
  ├─ dedup.ts                     — deduplicatePositionen + deduplicateReinigung
  └─ heroToDocPositions.ts        — Gewerk[] → DocPosition[] Adapter

src/lib/ai/
  ├─ aiComplete.ts                — Wrapper um /api/ai/chat (429/529-Retry, Vision)
  ├─ parseJson.ts                 — 4-stufige JSON-Extraktion + repairTruncatedJson
  ├─ recalcNewPositions.ts        — Sequentieller Modus-1-Recalc (Phase-2: Web-Search)
  └─ prompts/                     — Alle deutschen Prompts (1:1 aus bau4you, multi-tenant)
       ├─ base.ts                 — buildPrompt + Catalog-Helpers + GEWERK_KEYWORDS
       ├─ modus1.ts               — Einzelposition-Nachkalk (~3 200 Tokens)
       ├─ komplettangebot.ts      — Komplett-Angebot (~45 KB)
       ├─ addPosition.ts          — Single-Position (~500 Tokens)
       └─ edit.ts                 — Edit-Varianten (Position, Gewerk, Komplett, Aufgliederung)

src/lib/speech/                   — Speech-Helpers
  ├─ extractFields.ts             — extractFields + extractErgaenzungenHinweise
  ├─ transcribeClient.ts          — Frontend-Client für /api/ai/transcribe
  └─ recorderHelpers.ts           — MIME-Sniffing, Auto-Send-Detection

src/hooks/
  └─ useAudioRecorder.ts          — MediaRecorder + SpeechRecognition Hook

src/lib/voice/
  └─ loadStammdatenForVoice.ts    — DB-Loader für Pipeline (services + hourly_rates → Catalog)
```

## DB-Schema-Erweiterungen

| Migration | Inhalt |
|---|---|
| `0084_trades_default_surcharge.sql` | `trades.default_surcharge_percent` für gewerkspezifische Default-Aufschläge |
| `0085_voice_templates_and_transcripts.sql` | `voice_input_templates` (Sprach-Vorlagen) + `voice_transcripts` (Audit-Trail) + Storage-Bucket `voice-recordings` mit org/user-Prefix-RLS |

## Cent-Identität zu bau4you

Die Pipeline ist als pure TypeScript-Funktionen 1:1 portiert. Tests in `src/lib/calc/*.test.ts` decken Cent-Identität gegen die bau4you-Original-Logik ab. Stand: **541 Tests grün**.

Hero-Stammdaten wurden einmalig aus der bau4you-`catalog`-Tabelle (`Hero_2026-06-19_07-25`, 788 Positionen) in die b4y-superapp gespiegelt — siehe `scripts/import-hero-to-b4y.ts`. Konflikt-Strategie: **Hero gewinnt** (Wert wird überschrieben, vorherige Werte im `services.internal_note` als Audit-Log).

## Was NICHT (mehr) passiert

- ❌ Kein Hero-API-Aufruf zur Laufzeit. Die Pipeline arbeitet ausschließlich gegen die b4y-DB.
- ❌ Kein Eingriff in `bau4you-app` (legacy bleibt parallel produktiv).
- ❌ Kein laufender Stammdaten-Sync. Re-Import ist manuell via Script.

## Bekannte Einschränkungen

- **Modus-1-Nachkalk (`recalcNewPositions`) ist verfügbar, wird aber im Voice-Flow noch nicht aufgerufen** — `runCalcPipeline` markiert Neu-Positionen, KI-Web-Search ist Phase-2.
- **Web-Search für Wiener Marktpreise** entfällt aktuell (OpenAI hat keinen integrierten Tool, Tavily-Integration wird nachgerüstet falls Tests zeigen dass Marktpreise zu niedrig liegen).
- **Einzelposition-Dialog (`AddPositionDialog`)** ist ein Stub — kommt in Phase 6.
- **`korrigiereTranskription`** (Bau-Vokabular-Korrektur post-Whisper) ist noch nicht portiert — moderne `gpt-4o-transcribe` braucht es weniger, kann aber nachgerüstet werden.

## Manuelles Testen

1. Vercel-Preview-Build aus `feat/voice-angebote-pipeline` öffnen.
2. Neues Angebot anlegen (`/dokumente` → "Dokument erstellen" → "Angebote").
3. Im leeren Editor: `+ KI Standardangebot` klicken.
4. Im Modal: Mikrofon drücken, sprechen ("Wand spachteln 30 m² im Vorzimmer, Hyegasse 3 Wien"), kurz warten.
5. "Generieren" → Pipeline läuft, Positionen erscheinen im Editor.
6. Status-Check: ist die VK-Summe plausibel? Wurde Reinigung automatisch hinzugefügt? Stimmt die Gewerk-Reihenfolge?
