// ────────────────────────────────────────────────────────────────────────────
//  dedup.ts – Deduplizierung von Positionen innerhalb eines Gewerks
//  Quelle: bau4you-app/src/lib/claude.js Zeilen 670-676 (isSpecialPosition)
//                                       2303-2374 (deduplicate*)
//
//  Verhalten 1:1 mit bau4you – Cent-Identität bei Mengen-Aggregation und
//  Beschreibungs-Merge. Side-Effect-frei: Input-Arrays/Objekte werden nie
//  mutiert (spread + map).
// ────────────────────────────────────────────────────────────────────────────

import type { Gewerk, Position } from './types'

/**
 * Prüft ob eine Leistungsnummer im Spezial-Bereich liegt (990-999).
 * Alle Positionen in diesem Bereich (Regie, Material, Variable, Sonderrabatt)
 * sind Spezial-Positionen die nicht nachkalkuliert/dedupliziert werden.
 *
 * Bau4you Z. 670-676.
 */
export function isSpecialPosition(
  leistungsnummer: string | null | undefined,
): boolean {
  const nr = String(leistungsnummer || '')
  const m = nr.match(/[-–](\d{3,})$/)
  if (!m) return false
  const suffix = parseInt(m[1], 10)
  return suffix >= 990 && suffix <= 999
}

/**
 * Fasst Positionen mit gleicher Leistungsnummer innerhalb eines Gewerks zusammen.
 *
 * Mengen werden addiert, gesamtpreis wird mit dem bestehenden vk_netto_einheit
 * neu berechnet. Langtexte (beschreibung) werden zusammengeführt, sofern der
 * neue Text nicht bereits enthalten ist (substring-check).
 *
 * Nicht zusammengefasst werden:
 *   - Header-Positionen mit Endung "-000" (auch "–000" mit Geviertstrich)
 *   - Spezial-Positionen 990-999 (siehe isSpecialPosition)
 *   - Positionen ohne (leere) Leistungsnummer
 *
 * NEU-Nummern (XX-NEU, XX-NEU1 …) sind in der Regel individuell unterscheidbar.
 * Falls die KI zwei Positionen mit *identischer* NEU-Nummer liefert würden sie
 * zwar zusammengefasst – das entspricht exakt dem bau4you-Verhalten.
 *
 * Bau4you Z. 2303-2354.
 */
export function deduplicatePositionen(gewerke: Gewerk[]): Gewerk[] {
  if (!gewerke || gewerke.length === 0) return gewerke

  return gewerke.map((g) => {
    const positionen = g.positionen || []
    if (positionen.length <= 1) return g

    const merged: Position[] = []
    const seen = new Map<string, number>() // leistungsnummer → index in merged[]

    for (const pos of positionen) {
      const nr = String(pos.leistungsnummer || '').trim()

      // Header (-000) und Spezial-Positionen (990-999) nie zusammenfassen
      if (!nr || /[-–]\s*000$/.test(nr) || isSpecialPosition(nr)) {
        merged.push(pos)
        continue
      }

      if (seen.has(nr)) {
        // Duplikat gefunden → Mengen addieren
        const idx = seen.get(nr) as number
        const existing = merged[idx]
        const newMenge = (existing.menge || 0) + (pos.menge || 0)
        const vk = existing.vk_netto_einheit || 0

        // Langtext zusammenführen wenn unterschiedlich
        let beschreibung = existing.beschreibung || ''
        const posBeschreibung = pos.beschreibung || ''
        if (posBeschreibung && !beschreibung.includes(posBeschreibung)) {
          beschreibung = beschreibung + ' ' + posBeschreibung
        }

        merged[idx] = {
          ...existing,
          menge: Number(newMenge.toFixed(2)),
          gesamtpreis: Number((newMenge * vk).toFixed(2)),
          beschreibung,
        }
      } else {
        seen.set(nr, merged.length)
        merged.push({ ...pos })
      }
    }

    // Zwischensumme neu berechnen
    const zwischensumme = merged.reduce(
      (sum, p) => sum + (Number(p.gesamtpreis) || 0),
      0,
    )

    return {
      ...g,
      positionen: merged,
      zwischensumme: Number(zwischensumme.toFixed(2)),
    } as Gewerk
  })
}

/**
 * Finaler Sicherheitscheck: Falls im Gewerk Reinigung mehr als eine Position
 * vorhanden ist, wird nur die teuerste behalten.
 *
 * Verhindert zuverlässig doppelte Reinigungspositionen die durch verschiedene
 * Pipeline-Stufen entstehen könnten.
 *
 * Bau4you Z. 2360-2375.
 */
export function deduplicateReinigung(gewerke: Gewerk[]): Gewerk[] {
  if (!gewerke || gewerke.length === 0) return gewerke

  const norm = (s: string | null | undefined): string =>
    String(s || '')
      .toLowerCase()
      .replace(/ä/g, 'ae')
      .replace(/ö/g, 'oe')
      .replace(/ü/g, 'ue')
      .replace(/ß/g, 'ss')

  const rIdx = gewerke.findIndex((g) => norm(g.name).includes('reinigung'))
  if (rIdx === -1) return gewerke

  const rGewerk = gewerke[rIdx]
  const pos = rGewerk.positionen || []
  if (pos.length <= 1) return gewerke

  const teuerste = pos.reduce(
    (best, p) => ((p.gesamtpreis || 0) >= (best.gesamtpreis || 0) ? p : best),
    pos[0],
  )

  const newGewerke = [...gewerke]
  newGewerke[rIdx] = {
    ...rGewerk,
    positionen: [teuerste],
    zwischensumme: teuerste.gesamtpreis || 0,
  } as Gewerk
  return newGewerke
}
