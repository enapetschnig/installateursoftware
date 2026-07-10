// ────────────────────────────────────────────────────────────────────────────
//  ai/prompts/base – Helper-Funktionen für Prompt-Aufbau
//
//  Portiert aus bau4you-app/src/lib/prompts.js (Z. 737-1052):
//    - buildPrompt        → Z. 737-752 (+ {{FIRMA_NAME}} neu für Multi-Tenant)
//    - buildCompactCatalog→ Z. 1034-1044
//    - buildFilteredCatalog→ Z. 1052-1107 (KEYWORD_MAP-Regex)
//    - GEWERK_KEYWORDS    → Z. 975-992 (lowercase Keywords pro Gewerk)
//
//  Multi-Tenant: Statt fest verdrahteter "BAU4YOU Baranowski Bau GmbH" wird
//  der Firmenname über `PromptContext.firmaName` injiziert (Platzhalter
//  {{FIRMA_NAME}} in Prompt-Templates).
//
//  Token-Effizienz: buildFilteredCatalog reduziert ~25k → ~2-3k Token,
//  indem über KEYWORD_MAP nur relevante Gewerk-Präfixe gesendet werden.
// ────────────────────────────────────────────────────────────────────────────

import type {
  Catalog,
  CatalogPosition,
  StundensaetzeMap,
} from '../../calc/types'

// ──── Platzhalter-Konstanten ────────────────────────────────────────────────

/** Platzhalter in Prompt-Templates – ersetzt durch eine Liste von "- Gewerk: N €/Std". */
export const STUNDENSAETZE_PLACEHOLDER = '{{STUNDENSAETZE}}'
/** Platzhalter für Gesamt-Aufschlag in Prozent (z. B. 20). */
export const AUFSCHLAG_GESAMT_PLACEHOLDER = '{{AUFSCHLAG_GESAMT}}'
/** Platzhalter für Material-Aufschlag in Prozent (z. B. 30). */
export const AUFSCHLAG_MATERIAL_PLACEHOLDER = '{{AUFSCHLAG_MATERIAL}}'
/** Platzhalter für den Firmennamen – ermöglicht Multi-Tenant-Prompts. */
export const FIRMA_NAME_PLACEHOLDER = '{{FIRMA_NAME}}'
/** Platzhalter für handelsübliche Richtwert-Spannen (company_settings.kalk_richtwerte, Migr. 0150). */
export const RICHTWERTE_PLACEHOLDER = '{{RICHTWERTE}}'
/** Platzhalter für die aktiven Gewerke des Betriebs (Angebots-Gliederung). */
export const GEWERKE_PLACEHOLDER = '{{GEWERKE}}'
/** Platzhalter für die Nebenpositions-Politik (Baubetrieb vs. Fachbetrieb). */
export const NEBENPOSITIONEN_PLACEHOLDER = '{{NEBENPOSITIONEN}}'

// ──── Kontext-Interface ─────────────────────────────────────────────────────

/**
 * Kontext für den Prompt-Aufbau. Wird typischerweise einmal pro Request aus
 * Tenant-Settings + aktiver Preisliste zusammengebaut.
 */
export interface PromptContext {
  /** Tenant-Firmenname, z. B. "BAU4YOU Baranowski Bau GmbH". */
  firmaName: string
  /** Map Gewerk-Name → Stundensatz €/h (aus aktiver Preisliste). */
  stundensaetze: StundensaetzeMap
  /** Gesamt-Aufschlag in % auf (Material + Lohn). */
  aufschlagGesamt: number
  /** Material-Aufschlag in % auf den reinen Material-EK. */
  aufschlagMaterial: number
  /**
   * Handelsübliche VK-Richtwert-Spannen des Mandanten (Migr. 0150) – kalibriert
   * die KI von vornherein auf marktübliche Preise. Optional: ohne Richtwerte
   * wird ein neutraler Hinweistext eingesetzt.
   */
  richtwerte?: Array<{ bezeichnung: string; einheit?: string | null; vk_min: number; vk_max: number }>
  /**
   * Aktive Gewerke des Betriebs (Name + Positionsnummern-Prefix). Bestimmt die
   * Angebots-Gliederung: ein Elektriker-Betrieb bekommt ein Elektriker-Angebot,
   * kein Baubetriebs-Gerüst. Leer/undefined = keine Einschränkung (B4Y-Verhalten).
   */
  gewerke?: Array<{ name: string; prefix: string }>
  /**
   * Automatische Nebenpositionen (Baustelleneinrichtung/Reinigung): true =
   * Baubetriebs-Verhalten, false = Fachbetrieb (nichts Ungesprochenes ergänzen).
   */
  autoNebenpositionen?: boolean
}

// ──── buildPrompt ───────────────────────────────────────────────────────────

/**
 * Ersetzt alle bekannten Platzhalter in einem Prompt-Template:
 *   - {{STUNDENSAETZE}}      → Liste "- Gewerk: N €/Std" pro Eintrag
 *   - {{AUFSCHLAG_GESAMT}}   → numerischer Wert (ohne %-Zeichen)
 *   - {{AUFSCHLAG_MATERIAL}} → numerischer Wert (ohne %-Zeichen)
 *   - {{FIRMA_NAME}}         → Tenant-Firmenname
 *
 * Falls keine Stundensätze vorhanden sind, wird ein Hinweistext eingesetzt
 * (1:1 wie bau4you/prompts.js Z. 746).
 *
 * Reine Funktion: mutiert das Template nicht, gibt neuen String zurück.
 */
export function buildPrompt(basePrompt: string, ctx: PromptContext): string {
  const stundensaetzeText =
    !ctx.stundensaetze || Object.keys(ctx.stundensaetze).length === 0
      ? '(keine Regiestunden in Preisliste gefunden)'
      : Object.entries(ctx.stundensaetze)
          .map(([gewerk, satz]) => `- ${gewerk}: ${satz} €/Std`)
          .join('\n')

  const richtwerteText =
    !ctx.richtwerte || ctx.richtwerte.length === 0
      ? '(keine Richtwerte hinterlegt – kalkuliere nach Formel und Preisliste)'
      : ctx.richtwerte
          .map((r) => `- ${r.bezeichnung}: ${r.vk_min}–${r.vk_max} € netto${r.einheit ? ` je ${r.einheit}` : ''}`)
          .join('\n')

  // Gewerke-Gliederung: mit konfigurierten Gewerken wird die Struktur des
  // Betriebs erzwungen; ohne Konfiguration bleibt das generische Verhalten.
  const gewerkeText =
    !ctx.gewerke || ctx.gewerke.length === 0
      ? 'Gliedere in fachlich passende Gewerke (branchenübliche Reihenfolge).'
      : 'Dieser Betrieb führt AUSSCHLIESSLICH folgende Gewerke – verwende NUR diese als Gliederung ' +
        '(KEIN Gemeinkosten-/Abbruch-/Reinigungs-Gewerk erfinden, wenn es hier nicht steht):\n' +
        ctx.gewerke.map((g) => `- ${g.name} (Positionsnummern-Prefix ${g.prefix})`).join('\n') +
        '\nBei nur einem Gewerk: EINE durchgehende Positionsliste in diesem Gewerk.' +
        '\nLeistungen, die keinem dieser Gewerke entsprechen (z. B. Reinigung), nur aufnehmen, wenn der ' +
        'Sprecher sie AUSDRÜCKLICH nennt – dann dem fachlich nächsten Gewerk oben zuordnen.'

  const nebenText =
    ctx.autoNebenpositionen === false
      ? 'FACHBETRIEB-MODUS: Füge KEINE Positionen hinzu, die nicht gesprochen wurden – KEINE automatische ' +
        'Baustelleneinrichtung, KEINE Reinigung, KEINE Anfahrt, KEINE Gemeinkosten. Fachlich zwingendes ' +
        'Kleinmaterial (Dosen, Klemmen, Rahmen, Befestigung) gehört IN die gesprochenen Positionen ' +
        '(Neu-Kalkulation), nicht als eigene Zusatzposition. Alles, was du darüber hinaus für nötig hältst, ' +
        'kommt NUR in "fehlt_moeglicherweise".'
      : 'Füge IMMER eine Baustelleneinrichtungs-Position im Gewerk Gemeinkosten ein. Wähle die Nummer anhand ' +
        'der geschätzten Gesamtsumme des Angebots:\n' +
        '- 01-002 (Kleinbaustellen-Einrichtung) bei Projekten BIS 3.000 € netto\n' +
        '- 01-001 (Baustelleneinrichtung) bei Projekten ÜBER 3.000 € netto\n' +
        'Bei jedem Angebot MUSS genau EINE Reinigungsposition im Gewerk Reinigung enthalten sein.'

  return basePrompt
    .split(GEWERKE_PLACEHOLDER)
    .join(gewerkeText)
    .split(NEBENPOSITIONEN_PLACEHOLDER)
    .join(nebenText)
    .split(AUFSCHLAG_GESAMT_PLACEHOLDER)
    .join(String(ctx.aufschlagGesamt))
    .split(AUFSCHLAG_MATERIAL_PLACEHOLDER)
    .join(String(ctx.aufschlagMaterial))
    .split(FIRMA_NAME_PLACEHOLDER)
    .join(ctx.firmaName)
    .split(STUNDENSAETZE_PLACEHOLDER)
    .join(stundensaetzeText)
    .split(RICHTWERTE_PLACEHOLDER)
    .join(richtwerteText)
}

// ──── buildCompactCatalog ───────────────────────────────────────────────────

/**
 * Baut einen kompakten Katalog-String für den KI-Prompt.
 * Format: eine Zeile pro Position
 *   "Leistungsnummer | Kurztext | Einheit | VK-Netto[ | Beschreibung]"
 *
 * Optimiert für Token-Effizienz: kein JSON, keine Whitespace-Verschwendung.
 *
 * Positionen ohne `leistungsnummer` werden übersprungen (bau4you-Verhalten:
 * `filter(p => p.nr)`).
 */
export function buildCompactCatalog(catalog: Catalog): string {
  if (!catalog || !catalog.positionen || catalog.positionen.length === 0) {
    return '(keine Preisliste verfügbar)'
  }

  const lines = catalog.positionen
    .filter((p) => !!p.leistungsnummer)
    .map((p) => formatCatalogLine(p, /* withDescription */ true))

  if (lines.length === 0) return '(keine Preisliste verfügbar)'

  return (
    'Leistungsnummer | Kurztext | Einheit | VK-Netto | Beschreibung\n' +
    lines.join('\n')
  )
}

// ──── buildFilteredCatalog ──────────────────────────────────────────────────

/**
 * Max. Anzahl Einträge im gefilterten Katalog. Verhindert Token-Explosion.
 * Quelle: bau4you/prompts.js Z. 1055.
 */
export const FILTERED_CATALOG_MAX_ENTRIES = 100

/**
 * Normalisiert einen String für Keyword-Matching:
 *   - lowercase
 *   - ä→ae, ö→oe, ü→ue, ß→ss
 *
 * Quelle: bau4you/prompts.js Z. 1058-1060.
 */
function normalizeForMatch(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
}

/**
 * Keyword → Gewerk-Präfix(e). Wird im Eingabetext gesucht; bei Treffer
 * werden Katalogeinträge mit den entsprechenden Leistungsnummer-Präfixen
 * (z. B. "09-XXX") zurückgegeben.
 *
 * WICHTIG: Reihenfolge spielt nur insofern eine Rolle, als alle Treffer
 * additiv in `matchedPrefixes: Set` aufgenommen werden.
 *
 * Präfix-Mapping vgl. b4y-superapp/src/lib/calc/types.ts GEWERK_PREFIX_MAP
 * (identisch zu Hero/bau4you-Katalog):
 *   01 Gemeinkosten · 02 Abbruch    · 03 Bautischler  · 04 Glaser
 *   05 Elektriker   · 06 Installateur · 07 Baumeister · 08 Trockenbau
 *   09 Maler        · 10 Anstreicher · 11 Fliesenleger · 12 Bodenleger
 *   13 Reinigung    · 16 Elektrozuleitung (14, 15 nicht belegt)
 *
 * Hinweis: Die Regex-Liste entspricht bau4you/prompts.js Z. 1063-1081 –
 * dort werden teils andere Präfixe verwendet (z. B. Maler→09+10), wir
 * behalten das 1:1 bei, weil bau4you-Katalog und b4y-superapp-Katalog
 * dasselbe Schema teilen.
 */
const KEYWORD_MAP: ReadonlyArray<readonly [RegExp, readonly string[]]> = [
  [/fliesen|kacheln|keramik|mosaik|naturstein|fuge/, ['11']],
  [/parkett|laminat|vinyl|teppich|bodenbel|klickboden/, ['12']],
  [
    /\bmaler|streichen|anstrich|tapez|spacht|lasur|farban|grundier|malerarbeit/,
    ['09', '10'],
  ],
  [/anstreicher|lackier|holzlack|metallanstrich/, ['10']],
  [
    /trockenbau|rigips|gipskarton|gkb|staenderwand|abhaengdecke|vorsatzschale/,
    ['08'],
  ],
  [
    /\belektrik|strom|steckdose|kabel|leitung|\blicht\b|schalter|sicherung|verteiler|elektroarbeit/,
    ['05', '16'],
  ],
  [
    /installateur|wasserleit|rohr|heizung|sanitaer|\bbad\b|\bwc\b|badezimmer|wanne|dusche/,
    ['06'],
  ],
  [
    /abbruch|abriss|abreissen|abreiss|demontage|demontieren|rueckbau|stemmen|stemmarbeit|abbrucharbeit|entsorgen|abschlagen|abscher|abtragen|aufbrechen|abbrechen|abnehmen|wegreiss|wegmachen|entfernen/,
    ['02'],
  ],
  [/tischler|tuer|fenster|schrank|einbauschrank|holzarbeit/, ['03']],
  [/\bglaser|\bglas\b|verglas|glasarbeit/, ['04']],
  [
    /baumeister|maurer|beton|estrich|putz|mauerwerk|innenputz|aussenputz|verputz/,
    ['07'],
  ],
  [/reinigung|sauber|putzen|bauschluss|feinrein/, ['13']],
  [/fahrer|lkw|transport|entsorgung/, ['01']],
]

/**
 * Filtert die Preisliste anhand des Eingabetexts auf relevante Gewerke.
 *
 * Strategie:
 *   1. Normalisiere Eingabetext (Umlaute → ascii, lowercase)
 *   2. Matche gegen KEYWORD_MAP-Regex → Set von Präfixen ("09", "13", ...)
 *   3. Filtere Katalog auf Einträge deren leistungsnummer-Präfix matched
 *   4. Slice auf max FILTERED_CATALOG_MAX_ENTRIES (=100) Einträge
 *
 * Fallback (wenn kein Gewerk erkannt ODER < 3 Treffer):
 *   Erste 100 Einträge des gesamten Katalogs.
 *
 * Reduziert KI-Input von ~25 000 auf ~2 000–3 000 Token.
 */
export function buildFilteredCatalog(catalog: Catalog, eingabeText: string): string {
  if (!catalog || !catalog.positionen || catalog.positionen.length === 0) {
    return '(keine Preisliste verfügbar)'
  }

  const t = normalizeForMatch(eingabeText)
  const matchedPrefixes = new Set<string>()
  for (const [re, prefixes] of KEYWORD_MAP) {
    if (re.test(t)) {
      for (const p of prefixes) matchedPrefixes.add(p)
    }
  }

  const formatLines = (entries: CatalogPosition[]): string =>
    'Leistungsnummer | Kurztext | Einheit | VK-Netto\n' +
    entries
      .filter((p) => !!p.leistungsnummer)
      .slice(0, FILTERED_CATALOG_MAX_ENTRIES)
      .map((p) => formatCatalogLine(p, /* withDescription */ false))
      .join('\n')

  if (matchedPrefixes.size > 0) {
    const filtered = catalog.positionen.filter((e) => {
      const nr = String(e.leistungsnummer || '')
      const prefix = nr.split('-')[0]
      return matchedPrefixes.has(prefix)
    })
    if (filtered.length >= 3) return formatLines(filtered)
  }

  // Fallback: erste MAX_ENTRIES des gesamten Katalogs
  return formatLines(catalog.positionen)
}

// ──── GEWERK_KEYWORDS (Export) ──────────────────────────────────────────────

/**
 * Keywords pro Gewerk (lowercase) zur groben Erkennung aus Benutzertext.
 *
 * Quelle: bau4you/prompts.js Z. 975-992.
 *
 * Die Schlüssel sind die *lowercase* Gewerk-Namen. Die in dieser Datei
 * exportierten Schlüssel decken alle Einträge von
 * `GEWERKE_REIHENFOLGE` aus calc/types.ts ab (siehe Test #6).
 *
 * Hinweis: `bautrocknung` und `tapezierer` waren in bau4you nicht
 * explizit gelistet – wir fügen sinnvolle Keywords hinzu, um die
 * Reihenfolge-Konsistenz mit GEWERKE_REIHENFOLGE zu wahren.
 */
export const GEWERK_KEYWORDS: Record<string, string[]> = {
  gemeinkosten: [
    'gemeinkost',
    'bauleitung',
    'koordination',
    'gerüst',
    'container',
    'allgemein',
    'abdeck',
    'schutzfolie',
    'abkleb',
    'abdeckung',
  ],
  abbruch: [
    'abbruch',
    'abriss',
    'demontage',
    'abbau',
    'entfern',
    'rückbau',
    'abreißen',
  ],
  entrümpelung: ['entrümpel', 'räumung', 'entsorg', 'sperrmüll', 'müll'],
  bautrocknung: ['bautrocknung', 'trocknung', 'trockner', 'entfeucht'],
  bodenleger: [
    'parkett',
    'laminat',
    'vinyl',
    'linoleum',
    'teppich',
    'bodenbelag',
    'bodenleger',
    'holzboden',
  ],
  fliesenleger: [
    'fliesen',
    'kachel',
    'keramik',
    'mosaik',
    'verfug',
    'bodenfliesen',
    'wandfliesen',
    'fliesenarbeit',
  ],
  trockenbau: [
    'trockenbau',
    'gipskarton',
    'rigips',
    'knauf',
    'ständerwand',
    'raumteiler',
    'vorsatzschale',
    'trockenbauwand',
  ],
  estrich: ['estrich', 'unterlagsboden', 'fließestrich', 'zementestrich'],
  maler: [
    'maler',
    'streichen',
    'anstrich',
    'farbe',
    'tapete',
    'spachtel',
    'grundierung',
    'malerarbeit',
  ],
  tapezierer: ['tapezier', 'tapete', 'raufaser', 'vliestapete'],
  installateur: [
    'installateur',
    'sanitär',
    'rohr',
    'wc',
    'toilette',
    'waschbecken',
    'dusche',
    'badewanne',
    'bad ',
    'wasser',
    'heizung',
    'heizkörper',
    'thermostat',
    'armatur',
    'boiler',
  ],
  elektroinstallation: [
    'elektro',
    'strom',
    'steckdose',
    'licht',
    'leuchte',
    'kabel',
    'schalter',
    'sicherung',
    'verteiler',
    'beleuchtung',
  ],
  // Alias fuer 'Elektriker' aus GEWERKE_REIHENFOLGE (Praefix 05). bau4you/Hero
  // unterscheidet zwischen Elektriker (Innenarbeiten) und Elektrozuleitung (Anschluss).
  elektriker: [
    'elektriker',
    'elektro',
    'strom',
    'steckdose',
    'licht',
    'leuchte',
    'kabel',
    'schalter',
    'sicherung',
    'verteiler',
    'beleuchtung',
  ],
  elektrozuleitung: [
    'zuleitung',
    'hauptleitung',
    'hausanschluss',
    'zuleitungskabel',
  ],
  sanitär: ['sanitär', 'wc', 'waschbecken', 'badewanne', 'dusche', 'armatur'],
  spengler: ['spengler', 'blech', 'dachrinne', 'attika', 'spenglerarbeit'],
  reinigung: ['reinig', 'putzen', 'säuber', 'endreinig', 'badreinig'],
  // Zusatz-Aliasse (nicht in GEWERKE_REIHENFOLGE, aber in bau4you-Katalog
  // präsent – z. B. Anstreicher als Sub-Maler, Fassade als Sub-Baumeister).
  bautischler: [
    'tischler',
    'holztür',
    'türblatt',
    'einbauschrank',
    'holzarbeit',
    'tür einbau',
  ],
  glaser: [
    'glas',
    'verglas',
    'glasscheibe',
    'spiegel',
    'glastür',
    'glasduschwand',
  ],
  baumeister: [
    'baumeister',
    'maurer',
    'beton',
    'ziegel',
    'mauerwerk',
    'fundament',
    'estrich',
    'unterlagsboden',
    'betonarbeit',
  ],
  anstreicher: ['anstreicher', 'lackier', 'lack', 'holzlack'],
  fassade: [
    'fassade',
    'außenwand',
    'wärmedämmung',
    'außenputz',
    'fassadenputz',
    'wdvs',
  ],
}

// ──── interne Helpers ───────────────────────────────────────────────────────

/**
 * Formatiert eine Katalog-Position als eine Zeile.
 *   "Leistungsnummer | Kurztext | Einheit | VK-Netto[ | Beschreibung]"
 *
 * `withDescription=true` hängt die (auf eine Zeile gequetschte) Beschreibung an.
 */
function formatCatalogLine(p: CatalogPosition, withDescription: boolean): string {
  const nr = p.leistungsnummer ?? ''
  const name = p.leistungsname ?? ''
  const einheit = p.einheit ?? ''
  const vk = Number(p.vk_netto_einheit ?? 0).toFixed(2)
  const base = `${nr} | ${name} | ${einheit} | ${vk}`

  if (!withDescription) return base
  const desc = p.beschreibung ? p.beschreibung.replace(/\r?\n/g, ' ').trim() : ''
  return desc ? `${base} | ${desc}` : base
}
