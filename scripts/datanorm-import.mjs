#!/usr/bin/env node
// ============================================================
// Installateur SuperAPP – Datanorm-Import (Großhandels-Katalog)
// ------------------------------------------------------------
// Importiert ein Datanorm-5-Paket eines Großhändlers (z. B. Sonepar) in die
// Katalog-Ebene (supplier_catalogs / supplier_catalog_items / catalog_discounts /
// catalog_groups / catalog_metal_rates).
//
//   node scripts/datanorm-import.mjs --dir ~/Downloads/datanorm --name "Sonepar Österreich"
//
// Erwartete Dateien im Verzeichnis (Groß-/Kleinschreibung egal):
//   DATANORM.001[, .002 …]  Artikelstamm (V/A/T/Z-Sätze)
//   DATANORM.rab            Rabattgruppen (kundenspezifisch)
//   DATANORM.wrg            Warengruppen
//   DATPREIS.*              kundenspezifische Nettopreise (P-Sätze)
//   Metallbasis.csv         Kupfer-/Alu-Notierung (optional)
//
// Eigenschaften:
//   • Streaming (725-MB-Dateien ok), Batch-Upserts à 2000 Zeilen.
//   • Encoding-Autodetect je Datei (CP850 vs. Latin-1 – Händler mischen das).
//   • EK wird NICHT eingefroren: nur Listenpreis/Rabattgruppe/Nettopreis
//     gespeichert; die Berechnung macht die DB-Funktion catalog_search.
//   • Idempotent: Wiederholter Import aktualisiert per Upsert.
//   • Langtexte (T-Sätze, ~10 Mio Zeilen) werden bewusst NICHT importiert –
//     Kurztexte + Matchcode reichen für Suche & Angebotspositionen.
//
// Secrets: SUPABASE_SERVICE_ROLE_KEY + VITE_SUPABASE_URL aus .env.local
// (gitignored) – wie scripts/db-migrate.mjs nie im Repo.
// ============================================================
import { createReadStream, readFileSync, existsSync, readdirSync } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";

// ── CLI ────────────────────────────────────────────────────
const args = process.argv.slice(2);
function arg(name, fallback = null) {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const DIR = arg("dir");
const NAME = arg("name", "Großhandel");
if (!DIR || !existsSync(DIR)) {
  console.error("Aufruf: node scripts/datanorm-import.mjs --dir <verzeichnis> --name \"Sonepar Österreich\"");
  process.exit(1);
}

// ── ENV ────────────────────────────────────────────────────
for (const f of [".env.local", ".env.supabase.local"]) {
  if (!existsSync(f)) continue;
  for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const k = t.slice(0, i);
    if (!process.env[k]) process.env[k] = t.slice(i + 1);
  }
}
const URL = process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !KEY) { console.error("VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY fehlen (.env.local)."); process.exit(1); }

const HEADERS = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

async function rest(pathname, init = {}) {
  const r = await fetch(`${URL}/rest/v1/${pathname}`, { ...init, headers: { ...HEADERS, ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`${init.method || "GET"} ${pathname}: HTTP ${r.status} ${(await r.text()).slice(0, 300)}`);
  return r;
}

// ── Encoding: CP850 vs Latin-1 (Autodetect je Datei) ───────
// Wir lesen Bytes als Latin-1 (verlustfrei 1:1) und mappen bei CP850 die
// deutschen Sonderzeichen um. Heuristik: CP850-Umlautbytes vs Latin-1-Umlautbytes.
const CP850_MAP = {
  "\x81": "ü", "\x84": "ä", "\x94": "ö", "\x8E": "Ä", "\x99": "Ö", "\x9A": "Ü",
  "\xE1": "ß", "\xF8": "°", "\xE6": "µ", "\x9B": "ø", "\x9C": "£", "\xF5": "§",
  "\x82": "é", "\x85": "à", "\x8A": "è", "\xA7": "º", "\xFD": "²", "\xFC": "³",
};
function detectEncoding(file) {
  const buf = readFileSync(file, { encoding: null }).subarray(0, 262144);
  let cp850 = 0, latin = 0;
  for (const b of buf) {
    if (b === 0x81 || b === 0x84 || b === 0x94 || b === 0x8e || b === 0x99 || b === 0x9a || b === 0xe1) cp850++;
    else if (b === 0xe4 || b === 0xf6 || b === 0xfc || b === 0xc4 || b === 0xd6 || b === 0xdc || b === 0xdf) latin++;
  }
  return cp850 >= latin ? "cp850" : "latin1";
}
function decodeLine(line, enc) {
  if (enc === "latin1") return line;
  return line.replace(/[\x80-\xFF]/g, (c) => CP850_MAP[c] ?? c);
}

const clean = (s) => (s ?? "").trim() || null;
const num = (s) => { const n = Number(String(s ?? "").trim()); return Number.isFinite(n) ? n : null; };

// ── Dateien finden ─────────────────────────────────────────
const files = readdirSync(DIR);
const find = (re) => files.filter((f) => re.test(f)).map((f) => path.join(DIR, f));
const mainFiles = find(/^datanorm\.\d+$/i).sort();
const rabFile = find(/^datanorm\.rab$/i)[0];
const wrgFile = find(/^datanorm\.wrg$/i)[0];
const preisFiles = find(/^datpreis\./i);
const metalFile = find(/^metallbasis\.csv$/i)[0];
if (mainFiles.length === 0) { console.error(`Keine DATANORM.NNN-Datei in ${DIR} gefunden.`); process.exit(1); }

console.log(`Import "${NAME}" aus ${DIR}`);
console.log(`  Artikeldateien: ${mainFiles.map((f) => path.basename(f)).join(", ")}`);
console.log(`  Rabatte: ${rabFile ? "ja" : "nein"} · Warengruppen: ${wrgFile ? "ja" : "nein"} · Nettopreise: ${preisFiles.length} · Metall: ${metalFile ? "ja" : "nein"}`);

// ── Organisation + Katalog anlegen ─────────────────────────
const orgRes = await rest("organizations?select=id&order=created_at&limit=1");
const org = (await orgRes.json())[0];
if (!org) { console.error("Keine Organisation gefunden."); process.exit(1); }
const ORG = org.id;

// valid_from aus dem Vorlaufsatz der ersten Datei
let validFrom = null;
{
  const enc = detectEncoding(mainFiles[0]);
  const firstLine = await new Promise((resolve) => {
    const rl = createInterface({ input: createReadStream(mainFiles[0], { encoding: "latin1" }) });
    rl.once("line", (l) => { rl.close(); resolve(decodeLine(l, enc)); });
  });
  const f = firstLine.split(";");
  if (f[0] === "V" && /^\d{8}$/.test(f[3] || "")) validFrom = `${f[3].slice(0, 4)}-${f[3].slice(4, 6)}-${f[3].slice(6, 8)}`;
}

const catRes = await rest(
  `supplier_catalogs?on_conflict=organization_id,name`,
  { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify([{ organization_id: ORG, name: NAME, format: "datanorm5", valid_from: validFrom }]) },
);
const CAT = (await catRes.json())[0].id;
console.log(`  Katalog: ${CAT} (gültig ab ${validFrom ?? "?"})`);

// ── 1) Nettopreise (DATPREIS) vorab in eine Map ────────────
const netto = new Map(); // artnr -> { preiseinheit, cent }
for (const pf of preisFiles) {
  const enc = detectEncoding(pf);
  const rl = createInterface({ input: createReadStream(pf, { encoding: "latin1" }) });
  for await (const raw of rl) {
    const f = decodeLine(raw, enc).split(";");
    if (f[0] !== "P") continue;
    const artnr = clean(f[1]);
    const cent = num(f[4]);
    if (artnr && cent != null) netto.set(artnr, { preiseinheit: num(f[3]) ?? 1, cent });
  }
}
console.log(`  Nettopreise geladen: ${netto.size}`);

// ── 2) Rabattgruppen ───────────────────────────────────────
if (rabFile) {
  const enc = detectEncoding(rabFile);
  const rows = [];
  const rl = createInterface({ input: createReadStream(rabFile, { encoding: "latin1" }) });
  for await (const raw of rl) {
    const f = decodeLine(raw, enc).split(";");
    if (f[0] !== "R") continue;
    const grp = clean(f[1]);
    const proz = num(f[3]);
    if (!grp || proz == null) continue;
    rows.push({ organization_id: ORG, catalog_id: CAT, rabattgruppe: grp, prozent: proz / 100, bezeichnung: clean(f[4]) });
  }
  for (let i = 0; i < rows.length; i += 2000) {
    await rest(`catalog_discounts?on_conflict=organization_id,catalog_id,rabattgruppe`,
      { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows.slice(i, i + 2000)) });
  }
  console.log(`  Rabattgruppen: ${rows.length}`);
}

// ── 3) Warengruppen ────────────────────────────────────────
if (wrgFile) {
  const enc = detectEncoding(wrgFile);
  const rows = [];
  const rl = createInterface({ input: createReadStream(wrgFile, { encoding: "latin1" }) });
  for await (const raw of rl) {
    const f = decodeLine(raw, enc).split(";");
    if (f[0] !== "S") continue;
    const haupt = clean(f[1]);
    if (!haupt) continue;
    rows.push({ organization_id: ORG, catalog_id: CAT, hauptgruppe: haupt, untergruppe: clean(f[2]) ?? "", bezeichnung: clean(f[3]) });
  }
  for (let i = 0; i < rows.length; i += 2000) {
    await rest(`catalog_groups?on_conflict=organization_id,catalog_id,hauptgruppe,untergruppe`,
      { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows.slice(i, i + 2000)) });
  }
  console.log(`  Warengruppen: ${rows.length}`);
}

// ── 4) Metallkurse ─────────────────────────────────────────
if (metalFile) {
  const lines = readFileSync(metalFile, "utf8").split(/\r?\n/).slice(1);
  const rows = [];
  for (const l of lines) {
    const f = l.split(";");
    const metall = clean(f[0]);
    const kurs = num(f[1]);
    if (!metall || kurs == null) continue;
    const stand = (f[2] || "").trim().replace(/^(\d{4})\.(\d{2})\.(\d{2})$/, "$1-$2-$3") || null;
    rows.push({ organization_id: ORG, catalog_id: CAT, metall, kurs, stand });
  }
  if (rows.length) {
    await rest(`catalog_metal_rates?on_conflict=organization_id,catalog_id,metall`,
      { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(rows) });
  }
  console.log(`  Metallkurse: ${rows.length}`);
}

// ── 5) Artikelstamm (A- und Z-Sätze, Streaming) ────────────
// Z-Sätze (Metallzuschlag) folgen direkt auf den A-Satz desselben Artikels –
// wir merken den letzten A-Satz-Puffer-Index je Artikelnummer im Batch.
const BATCH = 2000;
let batch = [];
let batchIdx = new Map(); // artikelnummer -> index im aktuellen Batch (für Z-Merge)
let total = 0, zCount = 0, lines = 0;

async function flush() {
  if (batch.length === 0) return;
  await rest(`supplier_catalog_items?on_conflict=organization_id,catalog_id,artikelnummer`,
    { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(batch) });
  total += batch.length;
  batch = [];
  batchIdx = new Map();
}

for (const mf of mainFiles) {
  const enc = detectEncoding(mf);
  console.log(`  Lese ${path.basename(mf)} (${enc}) …`);
  const rl = createInterface({ input: createReadStream(mf, { encoding: "latin1" }), crlfDelay: Infinity });
  for await (const raw of rl) {
    lines++;
    if (lines % 1000000 === 0) console.log(`    … ${(lines / 1e6).toFixed(0)} Mio Zeilen, ${total + batch.length} Artikel`);
    const kind = raw.charCodeAt(0);
    if (kind === 65 /* A */) {
      const f = decodeLine(raw, enc).split(";");
      const artnr = clean(f[2]);
      if (!artnr) continue;
      const nettoHit = netto.get(artnr);
      const zusatz = [clean(f[15]), clean(f[16]), clean(f[17])].filter(Boolean).join(" ") || null;
      const row = {
        organization_id: ORG, catalog_id: CAT,
        artikelnummer: artnr,
        kurztext1: clean(f[3]), kurztext2: clean(f[4]),
        einheit: clean(f[5]),
        preiseinheit: num(f[7]) || 1,
        listenpreis_cent: num(f[8]),
        rabattgruppe: clean(f[9]),
        warengruppe: clean(f[10]), untergruppe: clean(f[11]),
        matchcode: clean(f[12]), zusatz,
        ean: clean(f[18]),
        langtext_nr: clean(f[23]),
        nettopreis_cent: nettoHit ? nettoHit.cent : null,
        // PostgREST-Bulk-Upsert verlangt IDENTISCHE Schlüssel in allen Zeilen –
        // Metallfelder daher immer mitschicken (Z-Satz füllt sie ggf. später).
        metall: null, metall_gewicht: null, metall_basis: null,
      };
      if (batchIdx.has(artnr)) batch[batchIdx.get(artnr)] = { ...batch[batchIdx.get(artnr)], ...row };
      else { batchIdx.set(artnr, batch.length); batch.push(row); }
      if (batch.length >= BATCH) await flush();
    } else if (kind === 90 /* Z */) {
      const f = decodeLine(raw, enc).split(";");
      const artnr = clean(f[2]);
      const idx = artnr ? batchIdx.get(artnr) : undefined;
      if (idx !== undefined) {
        batch[idx].metall = clean(f[5]);
        batch[idx].metall_gewicht = num(f[8]);
        batch[idx].metall_basis = num(f[10]);
        zCount++;
      }
    }
  }
}
await flush();

// ── 6) Katalog-Statistik aktualisieren ─────────────────────
await rest(`supplier_catalogs?id=eq.${CAT}`, {
  method: "PATCH", headers: { Prefer: "return=minimal" },
  body: JSON.stringify({
    item_count: total,
    imported_at: new Date().toISOString(),
    source_info: { dateien: files, artikel: total, nettopreise: netto.size, metall_saetze: zCount, zeilen: lines },
  }),
});

console.log(`\nFertig: ${total} Artikel importiert (${zCount} mit Metallzuschlag, ${netto.size} Nettopreise gemerged).`);
