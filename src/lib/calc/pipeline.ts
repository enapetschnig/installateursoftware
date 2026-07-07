// ────────────────────────────────────────────────────────────────────────────
//  pipeline.ts – Orchestrator für die gesamte Calc-Pipeline.
//
//  Quelle: bau4you-app/src/pages/Kalkulation/KleinesAngebot.jsx Z. 670-704.
//  Ruft die einzelnen Module in exakt der Reihenfolge auf, in der sie in der
//  bau4you-Version ausgeführt werden. Side-Effect-frei: jeder Schritt liefert
//  eine neue Gewerk-Liste; der Input wird nie mutiert (die einzelnen Module
//  garantieren das bereits, der Orchestrator addiert keine Mutation).
//
//  Bewusste Abweichungen vom Original:
//    - Modus-1-Nachkalkulation (web-search) ist *nicht* Teil dieses
//      Orchestrators – sie ist asynchron und wird vom Caller ausgelöst.
//    - Post-Filter (Ergänzung/Hinweis aus Positionen) ist UI-Concern und
//      gehört nicht in die reine Calc-Pipeline.
// ────────────────────────────────────────────────────────────────────────────

import type {
  Gewerk,
  Position,
  Catalog,
  KalkSettings,
  StundensaetzeMap,
} from './types'
import { DEFAULT_KALK_SETTINGS } from './types'

import { fixPositionKosten } from './fixPositionKosten'
import { stripVorschlag, detectKiVorschlag } from './detectKiVorschlag'
import { enforceUserZeitangabe } from './enforceUserZeitangabe'
import { enrichFromCatalog } from './enrichFromCatalog'
import { deduplicatePositionen } from './dedup'
import { ensureRegieMaterial, applyRegieMaterial } from './regiePaerchen'
import {
  fixGewerkeLeistungsnummern,
  fixGewerkeByLeistungsnummer,
  fixGewerkZuordnung,
} from './fixGewerk'
import {
  applyBaustelleneinrichtung,
  recalcBaustelleneinrichtung,
} from './baustelleneinrichtung'
import { fixNullpreise } from './fixNullpreise'
import { verifyAufschlaegeGewerke } from './aufschlagModel'
import { fixSplitRoomReferences, injectZimmerbezeichnungen } from './zimmer'
import { smartReinigung } from './smartReinigung'
import { sortGewerkeAndPositionen } from './sortPositionen'

// ─── Options ─────────────────────────────────────────────────────────────

/**
 * Optionen für `runCalcPipeline`.
 *
 *  - `eingabeText`      User-Freitext (Voice/Chat). Für injectZimmerbezeichnungen
 *                       und smartReinigung-Raum-Erkennung benötigt.
 *  - `catalog`          Vollständiger Stammdaten-Katalog (services).
 *  - `stundensaetze`    Map Gewerk → Stundensatz €/h.
 *  - `settings`         KalkSettings (Aufschlag, Cap, Fallback-Stundensatz).
 *                       Fallback: `DEFAULT_KALK_SETTINGS`.
 *  - `enforceUserStunden` Wenn `true`, wird `enforceUserZeitangabe` für jede
 *                       Position als zusätzlicher Schritt aufgerufen.
 *                       (Im KleinesAngebot-Pfad nicht standardmäßig aktiv, in
 *                       der Voice-Pipeline schon.)
 */
export interface PipelineOpts {
  eingabeText: string
  catalog: Catalog
  stundensaetze: StundensaetzeMap
  settings?: KalkSettings
  enforceUserStunden?: boolean
}

// ─── Helper ──────────────────────────────────────────────────────────────

/** Wendet eine Pos-zu-Pos-Funktion auf alle Positionen aller Gewerke an. */
function mapPositionen(
  gewerke: Gewerk[],
  fn: (pos: Position) => Position,
): Gewerk[] {
  return gewerke.map((g) => ({
    ...g,
    positionen: (g.positionen || []).map(fn),
  }))
}

// ─── runCalcPipeline ─────────────────────────────────────────────────────

/**
 * Vollständige Calc-Pipeline: bringt die rohe KI-Antwort in den finalen,
 * exportierbaren Zustand. Reihenfolge ist semantisch wichtig und entspricht
 * 1:1 dem KleinesAngebot-Flow.
 *
 *  1. `fixPositionKosten`           – numerische Felder normalisieren
 *  2. `stripVorschlag`              – "[VORSCHLAG]"-Tags entfernen
 *  3. `enforceUserZeitangabe` *opt* – User-Stundenzahl erzwingen
 *  4. `enrichFromCatalog`           – Stammdaten-Werte einsetzen
 *  5. `deduplicatePositionen`       – doppelte Nummern zusammenfassen
 *  6. `ensureRegieMaterial`         – Material-für-Regie-Stub einhängen
 *  7. `applyRegieMaterial`          – Material-für-Regie-Preise berechnen
 *  8. `fixGewerkeLeistungsnummern`  – Nr-Präfix an Gewerk anpassen
 *  9. `fixGewerkeByLeistungsnummer` – Gewerk-Name aus Nr-Präfix herleiten
 * 10. `fixGewerkZuordnung`          – Positionen ins richtige Gewerk-Bucket
 * 11. `applyBaustelleneinrichtung`  – Formel-Positionen (Staffel) anwenden
 * 12. `recalcBaustelleneinrichtung` – 01-001 / 01-002 final berechnen
 * 13. `fixNullpreise`               – VK=0 reparieren (Katalog/Regie)
 * 14. `verifyAufschlaegeGewerke`    – Aufschlag/Gesamt nochmal verifizieren
 * 15. `fixSplitRoomReferences`      – getrennte Raum-Erwähnungen mergen
 * 16. `injectZimmerbezeichnungen`   – Räume aus User-Text in Texte einfügen
 * 17. `detectKiVorschlag`           – KI-Vorschlag-Badges setzen
 * 18. `smartReinigung`              – Reinigungs-Position automatisch
 * 19. `sortGewerkeAndPositionen`    – finale Sortierung (Reinigung ans Ende)
 *
 * @param gewerke  Rohe Gewerk-Liste aus der KI-Antwort (nach JSON-Parse).
 * @param opts     Pipeline-Options inkl. Katalog, Settings, eingabeText.
 * @returns        Neue Gewerk-Liste – fertig zum Anzeigen/Exportieren.
 */
export function runCalcPipeline(
  gewerke: Gewerk[],
  opts: PipelineOpts,
): Gewerk[] {
  if (!gewerke || gewerke.length === 0) return gewerke || []

  const settings: KalkSettings = opts.settings ?? DEFAULT_KALK_SETTINGS
  const catalog: Catalog = opts.catalog ?? { positionen: [] }
  const stundensaetze: StundensaetzeMap = opts.stundensaetze ?? {}
  const eingabeText: string = opts.eingabeText ?? ''
  const enforceUserStunden = !!opts.enforceUserStunden

  // 1 + 2: fixPositionKosten und stripVorschlag pro Position.
  let result: Gewerk[] = mapPositionen(gewerke, (p) =>
    stripVorschlag(fixPositionKosten(p)),
  )

  // 3: enforceUserZeitangabe (optional).
  if (enforceUserStunden && eingabeText) {
    result = mapPositionen(result, (p) =>
      enforceUserZeitangabe(p, eingabeText, stundensaetze),
    )
  }

  // 4: enrichFromCatalog.
  result = enrichFromCatalog(result, catalog, stundensaetze)

  // 5: deduplicatePositionen.
  result = deduplicatePositionen(result)

  // 6 + 7: Regie-Material-Pärchen.
  result = ensureRegieMaterial(result, catalog)
  result = applyRegieMaterial(result, catalog)

  // 8-10: Gewerk-Zuordnung über Leistungsnummer-Präfixe.
  result = fixGewerkeLeistungsnummern(result)
  result = fixGewerkeByLeistungsnummer(result)
  result = fixGewerkZuordnung(result)

  // 11 + 12: Baustelleneinrichtung (Formel-/Pauschal-Positionen).
  result = applyBaustelleneinrichtung(result, catalog, stundensaetze)
  result = recalcBaustelleneinrichtung(result, catalog)

  // 13: Nullpreise reparieren.
  result = fixNullpreise(result, catalog, stundensaetze)

  // 14: Aufschläge verifizieren (Cent-Identität).
  result = verifyAufschlaegeGewerke(result, settings)

  // 15 + 16: Räume.
  result = fixSplitRoomReferences(result)
  result = injectZimmerbezeichnungen(result, eingabeText)

  // 17: KI-Vorschlag-Badges.
  result = detectKiVorschlag(result, eingabeText)

  // 18: Smart-Reinigung (kann ein neues Gewerk hinzufügen).
  result = smartReinigung(result, catalog, stundensaetze, { eingabeText })

  // 19: Finale Sortierung – Reinigung ans Ende, Positionen pro Gewerk sortiert.
  result = sortGewerkeAndPositionen(result)

  return result
}
