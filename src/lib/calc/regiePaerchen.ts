// ────────────────────────────────────────────────────────────────────────────
//  regiePaerchen – Regie-/Material-Pärchen-Logik
//
//  Quelle: bau4you-app/src/lib/claude.js Z. 719-1258
//    - findMaterialFuerRegieInCatalog (Z. 730-743)
//    - ensureRegieMaterial            (Z. 1115-1180)
//    - applyRegieMaterial             (Z. 1193-1258)
//
//  Konzept:
//    Eine Regiestunden-Position (z. B. "09-998 Regiestunden Maler", Einheit
//    "Std") wird in Hero immer von einer Material-für-Regie-Pos (10 % vom
//    Regie-Gesamtpreis) flankiert. Wenn die KI die Material-Pos vergisst,
//    fügen wir sie aus dem Katalog (-990 … -999 Bereich) auto-ein und
//    berechnen den Preis als prozentualen Anteil der Regie-Gesamtsumme.
//
//  Side-Effect-frei: Spread + map, kein Input wird mutiert.
//  Numerische Genauigkeit: round2 = Math.round(n*100)/100
// ────────────────────────────────────────────────────────────────────────────

import { isMaterialFuerRegiePos, isRegiestundenPos } from './enrichFromCatalog'
import type { Catalog, CatalogPosition, Gewerk, Position } from './types'

const round2 = (n: number): number => Math.round(n * 100) / 100

/** Liefert nur den Anzeige-Teil der Beschreibung (vor "Berechnung:"). */
function trimBeschreibung(text: string | null | undefined): string {
  if (!text) return ''
  const idx = text.indexOf('Berechnung:')
  return idx !== -1 ? text.substring(0, idx).trim() : text
}

/**
 * Liberale Variante von isRegiestundenPos für Auto-Material-Insertion.
 * Bau4you Z. 700-713.
 *
 * Strenge Variante (Name "Regie" + Einheit Std) trifft immer zu.
 * Erweiterung: Wenn aus_preisliste=true UND Einheit Std/Stunde UND
 * Leistungsnummer im Format XX-997 oder XX-998 → ebenfalls Regie-Kandidat.
 *
 * NUR hier verwenden – die strenge isRegiestundenPos bleibt für andere
 * Stellen (z. B. Stundensatz-Lookup) unverändert.
 *
 * Lokale Kopie statt Cross-Modul-Import, um den enrichFromCatalog-Vertrag
 * (isRegiestundenPos nur Name+Einheit) nicht zu verbiegen.
 */
function isStundenbasierteRegiePosKandidat(pos: Position): boolean {
  if (isRegiestundenPos(pos)) return true
  const einheit = String(pos.einheit || '').toLowerCase()
  const isStd = einheit.includes('std') || einheit.includes('stunde')
  if (!isStd) return false
  if (pos.aus_preisliste !== true) return false
  const nr = String(pos.leistungsnummer || '')
  return /-(997|998)$/.test(nr)
}

// ─── findMaterialFuerRegieInCatalog (Z. 730-743) ──────────────────────────

/**
 * Findet die "Material für Regiestunden"-Position im Katalog für ein
 * Gewerk-Prefix. Sucht im 990-999-Suffix-Bereich nach einer Position,
 * deren Name oder Beschreibung "Material" + "Regie" enthält.
 *
 * Gibt `null` zurück, wenn kein Treffer existiert.
 */
export function findMaterialFuerRegieInCatalog(
  catalog: Catalog,
  gewerkPrefix: string,
): CatalogPosition | null {
  const entries = catalog?.positionen || []
  for (const e of entries) {
    const nr = String(e.leistungsnummer || '')
    if (!nr.startsWith(gewerkPrefix + '-')) continue
    const m = nr.match(/[-–](\d{3,})$/)
    if (!m) continue
    const suffix = parseInt(m[1], 10)
    if (suffix < 990 || suffix > 999) continue
    const name = String(e.leistungsname || '').toLowerCase()
    const beschr = String(e.beschreibung || '').toLowerCase()
    const hit =
      (name.includes('material') && name.includes('regie')) ||
      (beschr.includes('material') && beschr.includes('regie'))
    if (hit) return e
  }
  return null
}

// ─── ensureRegieMaterial (Z. 1115-1180) ───────────────────────────────────

/**
 * Safety Net: Wenn eine Regiestunden-Position existiert, aber keine
 * zugehörige "Material für Regiestunden"-Position direkt danach kommt,
 * wird sie automatisch aus dem Katalog eingefügt (Preise = 0; der finale
 * Preis kommt aus `applyRegieMaterial`).
 *
 * Erkennung über Name + Einheit, NICHT über hardcodierte Nummern – die
 * Suffixe variieren je Gewerk.
 *
 * Muss VOR `applyRegieMaterial` aufgerufen werden.
 *
 * Side-Effect-frei: Input bleibt unverändert.
 */
export function ensureRegieMaterial(gewerke: Gewerk[], catalog: Catalog): Gewerk[] {
  if (!gewerke || gewerke.length === 0) return gewerke
  const entries = catalog?.positionen || []
  if (entries.length === 0) return gewerke

  let changed = false
  const newGewerke = gewerke.map((gewerk) => {
    const positionen = gewerk.positionen || []
    const newPositionen: Position[] = []
    let gewerkChanged = false

    for (let i = 0; i < positionen.length; i++) {
      const pos = positionen[i]
      newPositionen.push(pos)

      if (!isStundenbasierteRegiePosKandidat(pos)) continue

      const nr = String(pos.leistungsnummer || '')
      const prefixMatch = nr.match(/^(\d{2})/)
      if (!prefixMatch) continue
      const prefix = prefixMatch[1]

      // Nächste Position bereits Material-für-Regie? → nichts tun.
      const nextPos = positionen[i + 1]
      if (nextPos && isMaterialFuerRegiePos(nextPos)) continue

      // Material-Position im Katalog suchen
      const materialEntry = findMaterialFuerRegieInCatalog(catalog, prefix)
      if (!materialEntry) continue

      gewerkChanged = true
      changed = true
      newPositionen.push({
        leistungsnummer: String(materialEntry.leistungsnummer),
        leistungsname: materialEntry.leistungsname || 'Material für Regiestunden',
        beschreibung: trimBeschreibung(materialEntry.beschreibung) || '',
        einheit: materialEntry.einheit || 'pauschal',
        menge: 1,
        vk_netto_einheit: 0,
        gesamtpreis: 0,
        materialkosten_einheit: 0,
        lohnkosten_einheit: 0,
        lohnkosten_minuten: 0,
        stundensatz: 0,
        materialanteil_prozent: 100,
        lohnanteil_prozent: 0,
        aus_preisliste: true,
      })
    }

    if (!gewerkChanged) return gewerk
    const zwischensumme = round2(
      newPositionen.reduce((s, p) => s + (Number(p.gesamtpreis) || 0), 0),
    )
    return { ...gewerk, positionen: newPositionen, zwischensumme }
  })

  return changed ? newGewerke : gewerke
}

// ─── applyRegieMaterial (Z. 1193-1258) ────────────────────────────────────

/**
 * Berechnet den Preis für "Material für Regiestunden".
 * Prozentsatz steht im Katalog-Eintrag (Beschreibung/Name, z. B. "10 %").
 * Preis = `gesamtpreis` der vorhergehenden Regiestunden-Position × Prozent.
 *
 * Default-Prozent wenn nichts gefunden: 10 %.
 *
 * Side-Effect-frei: liefert eine neue Gewerk-Liste; Input bleibt unverändert.
 */
export function applyRegieMaterial(gewerke: Gewerk[], catalog: Catalog): Gewerk[] {
  if (!gewerke || gewerke.length === 0) return gewerke
  const entries = catalog?.positionen || []
  if (entries.length === 0) return gewerke

  const catalogMap = new Map<string, CatalogPosition>(
    entries.map((p) => [String(p.leistungsnummer), p]),
  )

  let changed = false
  const newGewerke = gewerke.map((gewerk) => {
    const positionen = gewerk.positionen || []
    let posChanged = false

    const newPositionen = positionen.map((pos, idx) => {
      if (!isMaterialFuerRegiePos(pos)) return pos

      const nr = String(pos.leistungsnummer || '')
      const catalogEntry = catalogMap.get(nr) || null

      // Prozentsatz aus Katalog-Beschreibung/Name extrahieren (default 10 %)
      const searchText =
        (catalogEntry?.beschreibung || '') +
        ' ' +
        (catalogEntry?.leistungsname || '') +
        ' ' +
        (pos.leistungsname || '') +
        ' ' +
        (pos.beschreibung || '')
      const pctMatch = searchText.match(/(\d+)\s*%/)
      const prozent = pctMatch ? Number(pctMatch[1]) : 10

      // Vorhergehende Regie-Position finden (rückwärts ab idx-1)
      let regieGesamt = 0
      for (let i = idx - 1; i >= 0; i--) {
        if (isStundenbasierteRegiePosKandidat(positionen[i])) {
          regieGesamt = Number(positionen[i].gesamtpreis) || 0
          break
        }
      }

      if (regieGesamt <= 0) return pos

      const materialPreis = round2((regieGesamt * prozent) / 100)
      posChanged = true
      changed = true

      return {
        ...pos,
        vk_netto_einheit: materialPreis,
        gesamtpreis: materialPreis,
        materialkosten_einheit: materialPreis,
        lohnkosten_einheit: 0,
        lohnkosten_minuten: 0,
        materialanteil_prozent: 100,
        lohnanteil_prozent: 0,
        menge: 1,
      }
    })

    if (!posChanged) return gewerk
    const zwischensumme = round2(
      newPositionen.reduce((s, p) => s + (Number(p.gesamtpreis) || 0), 0),
    )
    return { ...gewerk, positionen: newPositionen, zwischensumme }
  })

  return changed ? newGewerke : gewerke
}
