// ============================================================
// Installateur SuperAPP – Datanorm-Parser (automatische Preiswartung)
// ------------------------------------------------------------
// Serverseitiges Gegenstück zu scripts/datanorm-import.mjs für die
// AUTOMATISCHE Preiswartung: Großhändler (z. B. Sonepar) senden regelmäßig
// kleine Datanorm-Dateien per E-Mail (DATPREIS = Nettopreise, .rab =
// Rabattgruppen, kleine Artikel-Deltas). Der Mail-Poller erkennt solche
// Anhänge und aktualisiert den Katalog – Preisänderungen sind damit ohne
// manuellen Import "immer drin".
//
// Der EK wird ohnehin zur Abfragezeit berechnet (Liste − Rabatt bzw. Netto),
// d. h. ein aktualisiertes Rabattblatt wirkt sofort auf ALLE Artikel.
// ============================================================

// ── Encoding: CP850 vs Latin-1 (Autodetect je Datei) ───────
const CP850_MAP = {
  "\x81": "ü", "\x84": "ä", "\x94": "ö", "\x8E": "Ä", "\x99": "Ö", "\x9A": "Ü",
  "\xE1": "ß", "\xF8": "°", "\xE6": "µ", "\x9B": "ø", "\x9C": "£", "\xF5": "§",
  "\x82": "é", "\x85": "à", "\x8A": "è", "\xA7": "º", "\xFD": "²", "\xFC": "³",
};

/** Dekodiert einen Datanorm-Datei-Buffer (CP850 oder Latin-1) zu UTF-8-Text. */
export function decodeDatanorm(buf) {
  let cp850 = 0, latin = 0;
  const n = Math.min(buf.length, 262144);
  for (let i = 0; i < n; i++) {
    const b = buf[i];
    if (b === 0x81 || b === 0x84 || b === 0x94 || b === 0x8e || b === 0x99 || b === 0x9a || b === 0xe1) cp850++;
    else if (b === 0xe4 || b === 0xf6 || b === 0xfc || b === 0xc4 || b === 0xd6 || b === 0xdc || b === 0xdf) latin++;
  }
  const raw = buf.toString("latin1");
  if (latin > cp850) return raw;
  return raw.replace(/[\x80-\xFF]/g, (c) => CP850_MAP[c] ?? c);
}

/** Erkennt am Dateinamen, ob ein Anhang eine Datanorm-Datei ist. */
export function isDatanormFile(filename) {
  const f = String(filename || "").toLowerCase();
  return /^datanorm\.(\d+|rab|wrg)$/.test(f) || /^datpreis\./.test(f) || /^metallbasis\.csv$/.test(f);
}

const clean = (s) => (s ?? "").trim() || null;
const num = (s) => { const n = Number(String(s ?? "").trim()); return Number.isFinite(n) ? n : null; };

/**
 * Parst Datanorm-Text in strukturierte Updates.
 * @returns {{ items: object[], nettos: {artikelnummer,preiseinheit,nettopreis_cent}[],
 *             discounts: {rabattgruppe,prozent,bezeichnung}[], metals: {metall,kurs,stand}[] }}
 */
export function parseDatanorm(text, filename = "") {
  const out = { items: [], nettos: [], discounts: [], metals: [] };

  if (/^metallbasis\.csv$/i.test(filename)) {
    for (const line of text.split(/\r?\n/).slice(1)) {
      const f = line.split(";");
      const metall = clean(f[0]);
      const kurs = num(f[1]);
      if (!metall || kurs == null) continue;
      const stand = (f[2] || "").trim().replace(/^(\d{4})\.(\d{2})\.(\d{2})$/, "$1-$2-$3") || null;
      out.metals.push({ metall, kurs, stand });
    }
    return out;
  }

  for (const raw of text.split(/\r?\n/)) {
    const kind = raw.charAt(0);
    if (kind === "P") {
      // Nettopreis: P;Artnr;PreisKz;Preiseinheit;Preis(cent);
      const f = raw.split(";");
      const artikelnummer = clean(f[1]);
      const cent = num(f[4]);
      if (artikelnummer && cent != null) {
        out.nettos.push({ artikelnummer, preiseinheit: num(f[3]) || 1, nettopreis_cent: cent });
      }
    } else if (kind === "R") {
      // Rabattgruppe: R;Gruppe;Kz;Prozent(6800=68%);Bezeichnung;
      const f = raw.split(";");
      const rabattgruppe = clean(f[1]);
      const proz = num(f[3]);
      if (rabattgruppe && proz != null) {
        out.discounts.push({ rabattgruppe, prozent: proz / 100, bezeichnung: clean(f[4]) });
      }
    } else if (kind === "A") {
      // Artikel (Delta-Dateien): gleiche Feldbelegung wie der Vollimport.
      const f = raw.split(";");
      const artikelnummer = clean(f[2]);
      if (!artikelnummer) continue;
      const zusatz = [clean(f[15]), clean(f[16]), clean(f[17])].filter(Boolean).join(" ") || null;
      out.items.push({
        artikelnummer,
        kurztext1: clean(f[3]), kurztext2: clean(f[4]),
        einheit: clean(f[5]),
        preiseinheit: num(f[7]) || 1,
        listenpreis_cent: num(f[8]),
        rabattgruppe: clean(f[9]),
        warengruppe: clean(f[10]), untergruppe: clean(f[11]),
        matchcode: clean(f[12]), zusatz,
        ean: clean(f[18]),
        langtext_nr: clean(f[23]),
        nettopreis_cent: null,
        metall: null, metall_gewicht: null, metall_basis: null,
      });
    } else if (kind === "Z") {
      // Metallzuschlag zum vorangehenden Artikel derselben Delta-Datei.
      const f = raw.split(";");
      const artnr = clean(f[2]);
      const item = artnr ? out.items.find((i) => i.artikelnummer === artnr) : null;
      if (item) {
        item.metall = clean(f[5]);
        item.metall_gewicht = num(f[8]);
        item.metall_basis = num(f[10]);
      }
    }
  }
  return out;
}

/**
 * Wendet geparste Datanorm-Updates auf den (einzigen) Katalog der Organisation an.
 * Nettopreise werden NUR für existierende Artikel gesetzt (kein Skelett-Insert).
 * @returns {{ applied: boolean, stats: object }}
 */
export async function applyDatanormUpdates(admin, orgId, parsed) {
  const { data: cat } = await admin
    .from("supplier_catalogs")
    .select("id,name")
    .eq("organization_id", orgId)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!cat) return { applied: false, stats: { grund: "kein Katalog vorhanden" } };

  const stats = { katalog: cat.name, artikel: 0, nettopreise: 0, rabatte: 0, metalle: 0 };

  // Rabattgruppen (klein, direkt upserten – wirkt sofort auf alle EKs)
  for (let i = 0; i < parsed.discounts.length; i += 500) {
    const rows = parsed.discounts.slice(i, i + 500).map((d) => ({
      organization_id: orgId, catalog_id: cat.id, ...d,
    }));
    const { error } = await admin.from("catalog_discounts")
      .upsert(rows, { onConflict: "organization_id,catalog_id,rabattgruppe" });
    if (error) throw new Error(`Rabatt-Update: ${error.message}`);
    stats.rabatte += rows.length;
  }

  // Metallkurse
  if (parsed.metals.length) {
    const rows = parsed.metals.map((m) => ({ organization_id: orgId, catalog_id: cat.id, ...m }));
    const { error } = await admin.from("catalog_metal_rates")
      .upsert(rows, { onConflict: "organization_id,catalog_id,metall" });
    if (error) throw new Error(`Metall-Update: ${error.message}`);
    stats.metalle = rows.length;
  }

  // Artikel-Deltas (voller Zeilensatz, identische Schlüssel je Batch)
  for (let i = 0; i < parsed.items.length; i += 1000) {
    const rows = parsed.items.slice(i, i + 1000).map((it) => ({
      organization_id: orgId, catalog_id: cat.id, ...it,
    }));
    const { error } = await admin.from("supplier_catalog_items")
      .upsert(rows, { onConflict: "organization_id,catalog_id,artikelnummer" });
    if (error) throw new Error(`Artikel-Update: ${error.message}`);
    stats.artikel += rows.length;
  }

  // Nettopreise: nur existierende Artikel aktualisieren (Chunk-weise prüfen).
  for (let i = 0; i < parsed.nettos.length; i += 200) {
    const chunk = parsed.nettos.slice(i, i + 200);
    const { data: existing, error: selErr } = await admin
      .from("supplier_catalog_items")
      .select("artikelnummer")
      .eq("organization_id", orgId)
      .eq("catalog_id", cat.id)
      .in("artikelnummer", chunk.map((c) => c.artikelnummer));
    if (selErr) throw new Error(`Nettopreis-Lookup: ${selErr.message}`);
    const known = new Set((existing ?? []).map((r) => r.artikelnummer));
    const rows = chunk
      .filter((c) => known.has(c.artikelnummer))
      .map((c) => ({ organization_id: orgId, catalog_id: cat.id, ...c }));
    if (rows.length === 0) continue;
    const { error } = await admin.from("supplier_catalog_items")
      .upsert(rows, { onConflict: "organization_id,catalog_id,artikelnummer" });
    if (error) throw new Error(`Nettopreis-Update: ${error.message}`);
    stats.nettopreise += rows.length;
  }

  await admin.from("supplier_catalogs")
    .update({ imported_at: new Date().toISOString() })
    .eq("id", cat.id);

  return { applied: true, stats };
}
