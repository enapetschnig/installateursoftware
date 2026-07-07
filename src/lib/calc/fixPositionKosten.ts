// ────────────────────────────────────────────────────────────────────────────
//  fixPositionKosten – Cent-identische Portierung aus bau4you/src/lib/claude.js
//  (siehe Quell-Zeilen 1595-1660).
//
//  Erzwingt Konsistenz in genau dieser Reihenfolge:
//    1. vk_netto_einheit + materialkosten_einheit gelten als KI-Quelle.
//    2. lohnkosten_einheit = vk_netto_einheit – materialkosten_einheit
//    3. lohnkosten_minuten = round(lohn / stundensatz × 60)            (ganze Minuten)
//    4. lohnkosten_einheit neu = (minuten / 60) × stundensatz          (Rundungs-Drift)
//    5. vk_netto_einheit neu = lohn + material                         (Folge-Anpassung)
//    5b. SNAP – wenn vkRaw schon ein glatter Wert war und der Drift < 5 Cent ist,
//        snap zurück auf vkRaw (verhindert 599.99 statt 600.00).
//    5c. lohnFinal = vk – material  (garantiert mat + lohn = vk ohne Cent-Drift)
//    6. gesamtpreis = menge × vk    (Fallback: gerundete gesamtpreis-Quelle).
//    7. Material-/Lohn-Anteil in % – summiert exakt auf 100.
//
//  Side-Effect-frei: liefert ein NEUES Objekt; Input wird nicht mutiert.
// ────────────────────────────────────────────────────────────────────────────

import type { Position } from './types'

const round2 = (n: number): number => Math.round(n * 100) / 100
const round1 = (n: number): number => Math.round(n * 10) / 10

export function fixPositionKosten(pos: Position): Position {
  // Guard: ungültige/gelöschte Position unverändert durchreichen.
  if (!pos || typeof pos !== 'object' || pos.deleted) return pos

  const mat = round2(Number(pos.materialkosten_einheit) || 0)
  const stundensatz = Number(pos.stundensatz) || 0
  const menge = Number(pos.menge) || 0

  // Step 2: lohn aus vk – material (gerundet).
  const vkRaw = round2(Number(pos.vk_netto_einheit) || 0)
  const lohnRaw = round2(vkRaw - mat)

  // Step 3: Minuten auf ganze Minute runden – aus lohnRaw und Stundensatz.
  //         Ohne Stundensatz: Fallback auf bestehende pos.lohnkosten_minuten.
  const minuten = stundensatz > 0
    ? Math.round((lohnRaw / stundensatz) * 60)
    : Math.round(Number(pos.lohnkosten_minuten) || 0)

  // Step 4: Lohn neu berechnen aus gerundeten Minuten.
  const lohn = stundensatz > 0
    ? round2((minuten / 60) * stundensatz)
    : lohnRaw

  // Step 5: VK an Minuten-Rundung anpassen.
  let vk = round2(lohn + mat)

  // Step 5b: SNAP – verhindert 599.99 statt 600.00 wenn vkRaw glatt war
  // und nur winziger Drift entstand.
  if (Math.abs(vk - vkRaw) < 0.05 && Math.abs(vkRaw - Math.round(vkRaw)) < 0.005) {
    vk = round2(vkRaw)
  }

  // Step 5c: lohnFinal als exakte Differenz – garantiert mat + lohn === vk.
  const lohnFinal = round2(vk - mat)

  // Step 6: gesamtpreis – aus menge × vk, sonst gerundeter Quellwert.
  const gesamtpreis = menge > 0
    ? round2(menge * vk)
    : round2(Number(pos.gesamtpreis) || 0)

  // Step 7: Prozente – Summe exakt 100.
  const materialProzent = vk > 0 ? round1((mat / vk) * 100) : 0
  const lohnProzent = vk > 0 ? round1(100 - materialProzent) : 0

  return {
    ...pos,
    vk_netto_einheit: vk,
    materialkosten_einheit: mat,
    lohnkosten_einheit: lohnFinal,
    lohnkosten_minuten: minuten,
    gesamtpreis,
    materialanteil_prozent: materialProzent,
    lohnanteil_prozent: lohnProzent,
  }
}
