// ────────────────────────────────────────────────────────────────────────────
//  aufschlagModel – Aufschlags-Berechnung & VK-Korrektur
//
//  Portiert aus bau4you-app/src/lib/claude.js  Z. 2641-2686
//  (verifyAufschlaege / verifyAufschlaegeGewerke).
//
//  Modell-Erweiterung für b4y-superapp:
//    - bau4you nutzt nur einen einzigen "aufschlag_gesamt_prozent" auf
//      (mat + lohn). b4y-superapp trennt das Modell sauber:
//        1. aufschlagMaterial → Materialkosten erhöhen (Aufschlag NUR auf
//           den Material-EK, NICHT auf den Lohn).
//        2. aufschlagGesamt   → GU-/Risiko-Aufschlag auf die Summe aus
//           (lohn + material*aufschlagMaterial).
//    - Pro-Gewerk-Override via settings.aufschlagPerGewerk.
//    - Toleranz 2 %: VK wird NUR nach OBEN korrigiert (KI gibt häufig
//      zu niedrige Preise; zu hohe Preise lassen wir stehen, weil die KI
//      gezielt Spezial-/Premium-Positionen höher bepreisen darf).
//
//  Pure Functions: kein Input-Mutate, alles via spread/map.
// ────────────────────────────────────────────────────────────────────────────

import {
  type Position,
  type Gewerk,
  type KalkSettings,
  SPEZIAL_TECHNIK_KEYWORDS,
} from './types'

/** round2: 14.4049 → 14.40 ; 14.405 → 14.41 (kaufmännisch über *100). */
function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Berechnet den Soll-VK netto pro Einheit nach dem b4y-Modell.
 *
 *   materialMitAufschlag = material × (1 + aufschlagMaterial/100)
 *   vorTotal             = lohn + materialMitAufschlag
 *   vk                   = vorTotal × (1 + aufschlagGesamt/100)
 *
 * @param material  Material-EK netto pro Einheit
 * @param lohn      Lohn-EK netto pro Einheit
 * @param settings  Globale Kalk-Settings (aufschlagMaterial, aufschlagGesamt, aufschlagPerGewerk)
 * @param gewerk    Optionaler Gewerk-Name → triggert Pro-Gewerk-Override
 * @returns         VK netto pro Einheit, auf 2 Nachkommastellen gerundet
 */
export function calcAufschlag(
  material: number,
  lohn: number,
  settings: KalkSettings,
  gewerk?: string,
): number {
  const mat = Number(material) || 0
  const loh = Number(lohn) || 0

  const aufschlagMaterial = (Number(settings.aufschlagMaterial) || 0) / 100

  // Pro-Gewerk-Override hat Vorrang. Achtung: 0 ist ein valider Override-Wert
  // → wir prüfen explizit auf undefined/null, nicht auf falsy.
  const perGewerkRaw =
    gewerk != null ? settings.aufschlagPerGewerk?.[gewerk] : undefined
  const aufschlagGesamtPct =
    perGewerkRaw != null ? Number(perGewerkRaw) : Number(settings.aufschlagGesamt) || 0
  const aufschlagGesamt = aufschlagGesamtPct / 100

  const materialMitAufschlag = mat * (1 + aufschlagMaterial)
  const vorTotal = loh + materialMitAufschlag
  const vk = vorTotal * (1 + aufschlagGesamt)

  return round2(vk)
}

/**
 * Prüft, ob es sich um eine Spezial-Technik (Venezianisch, Tadelakt …) handelt.
 * Diese Positionen werden – wenn aus dem Katalog – NICHT verifiziert, weil
 * die KI sie absichtlich höher bepreisen darf (Marktpreis-Strategie).
 */
function isSpezialPos(pos: Position): boolean {
  const text = `${pos.leistungsname ?? ''} ${pos.beschreibung ?? ''}`.toLowerCase()
  return SPEZIAL_TECHNIK_KEYWORDS.some((kw) => text.includes(kw))
}

/**
 * Verifiziert den Aufschlag einer einzelnen Position.
 *
 * Regeln (1:1 bau4you-Verhalten, erweitert um das b4y-Modell):
 *   1. Katalog-Spezial-Pos (aus_preisliste=true UND Spezial-Keyword) → unverändert
 *   2. Fehlende Kosten-Felder (mat ODER lohn undefiniert) → unverändert
 *   3. mat=0 UND lohn=0 → unverändert (z. B. reine Pauschal-Posten)
 *   4. |vk_soll − vk_ist| / vk_soll ≤ 2 % → unverändert (Toleranz)
 *   5. vk_ist > vk_soll (KI zu teuer) → unverändert (nur nach OBEN korrigieren)
 *   6. vk_ist < vk_soll − Toleranz → auf vk_soll heben, Gesamtpreis +
 *      Material-/Lohnanteil neu berechnen.
 *
 * @returns Neues Position-Objekt (kein Mutate des Inputs)
 */
export function verifyAufschlaege(
  pos: Position,
  settings: KalkSettings,
  gewerk?: string,
): Position {
  if (!pos) return pos

  // Deterministisch aus dem Großhandels-EK bepreiste Positionen NIE anheben –
  // der Gesamtaufschlag steckt bereits im VK (calcWholesaleVk); ein erneutes
  // vkSoll = (mat×Aufschlag + Lohn)×Aufschlag wäre ein Doppelaufschlag.
  if (pos.preis_deterministisch) return pos

  // Katalog-Spezial-Positionen NIE anfassen
  if (pos.aus_preisliste === true && isSpezialPos(pos)) return pos

  // Beide Kosten-Felder müssen vorhanden sein (null/undefined → skip)
  if (pos.lohnkosten_einheit == null || pos.materialkosten_einheit == null) {
    return pos
  }

  const mat = Number(pos.materialkosten_einheit) || 0
  const lohn = Number(pos.lohnkosten_einheit) || 0

  // mat=0 UND lohn=0 → nichts zu prüfen
  if (mat === 0 && lohn === 0) return pos

  const vkSoll = calcAufschlag(mat, lohn, settings, gewerk)
  const vkIst = Number(pos.vk_netto_einheit) || 0

  // Soll=0 vermeidet Division-by-zero
  if (vkSoll <= 0) return pos

  const diff = vkSoll - vkIst
  const tol = 0.02 // 2 %

  // Innerhalb Toleranz → ok
  if (Math.abs(diff) / vkSoll <= tol) return pos

  // vk_ist ist HÖHER als Soll → nicht runterkorrigieren
  if (vkIst > vkSoll) return pos

  // vk_ist deutlich zu niedrig → auf Soll heben
  const menge = Number(pos.menge) || 0
  const gesamtpreis = round2(menge * vkSoll)

  // Effektiver Gewerk-Aufschlag in %, der angewendet wurde
  const perGewerkRaw =
    gewerk != null ? settings.aufschlagPerGewerk?.[gewerk] : undefined
  const effektiverAufschlagProzent =
    perGewerkRaw != null ? Number(perGewerkRaw) : Number(settings.aufschlagGesamt) || 0

  // Material-/Lohnanteil neu berechnen – Basis ist der reine EK, NICHT der VK
  // (so wie bau4you das vor dem Aufschlag macht).
  const ekSumme = mat + lohn
  let materialanteil = 0
  let lohnanteil = 0
  if (ekSumme > 0) {
    materialanteil = Math.round((mat / ekSumme) * 1000) / 10
    lohnanteil = Math.round((100 - materialanteil) * 10) / 10
  }

  return {
    ...pos,
    vk_netto_einheit: vkSoll,
    gesamtpreis,
    aufschlag_prozent: effektiverAufschlagProzent,
    materialanteil_prozent: materialanteil,
    lohnanteil_prozent: lohnanteil,
  }
}

/**
 * Wendet verifyAufschlaege auf alle Positionen aller Gewerke an.
 * Reine Funktion: Input-Array & alle Sub-Objekte bleiben unangetastet.
 */
export function verifyAufschlaegeGewerke(
  gewerke: Gewerk[],
  settings: KalkSettings,
): Gewerk[] {
  return gewerke.map((g) => ({
    ...g,
    positionen: (g.positionen || []).map((p) => verifyAufschlaege(p, settings, g.name)),
  }))
}
