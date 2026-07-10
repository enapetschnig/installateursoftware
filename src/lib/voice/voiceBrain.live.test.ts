// ============================================================
// LIVE-Integrationstest: das komplette "Gehirn" des Sprach-Angebots
// ------------------------------------------------------------
// Fährt den ECHTEN Orchestrator (runVoiceAngebot) mit echten Stammdaten,
// echtem Großhandels-Katalog (catalog_search) und echter OpenAI-Antwort
// (api/ai/chat.js-Handler direkt) – nur Mikrofon/UI sind ausgelassen.
//
// Bewusst NICHT Teil von `npm run test` (Netzwerk + Kosten):
//   VOICE_LIVE=1 npx vitest run src/lib/voice/voiceBrain.live.test.ts
// ============================================================
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const LIVE = process.env.VOICE_LIVE === "1";

describe.skipIf(!LIVE)("Sprach-Angebot live (echte KI + echter Katalog)", () => {
  it("erstellt aus einem Elektro-/Sanitär-Transkript ein kalkuliertes Angebot mit Großhandels-EKs", async () => {
    // ── ENV für den API-Handler (OpenAI-Key aus .env.local) ──
    for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const i = t.indexOf("=");
      if (i > 0 && !process.env[t.slice(0, i)]) process.env[t.slice(0, i)] = t.slice(i + 1);
    }

    const { supabase } = await import("../supabase");
    const { data: auth, error: authErr } = await supabase.auth.signInWithPassword({
      email: process.env.B4Y_E2E_EMAIL || "napetschnig.chris@gmail.com",
      password: process.env.B4Y_E2E_PASSWORD || "nereirtsiger",
    });
    expect(authErr).toBeNull();
    const token = auth.session!.access_token;

    // ── Echte Stammdaten + echter Orchestrator ──
    const { loadStammdatenForVoice } = await import("./loadStammdatenForVoice");
    const { runVoiceAngebot } = await import("../../components/voice/VoiceAngebotDialog");
    const { runCalcPipeline } = await import("../calc/pipeline");
    const { extractErgaenzungenHinweise } = await import("../speech/extractFields");
    const { parseJsonResponse } = await import("../ai/parseJson");
    // @ts-expect-error – bewusster Import der JS-Serverless-Function (keine Typen)
    const { default: chatHandler } = await import("../../../api/ai/chat.js");

    const stammdaten = await loadStammdatenForVoice();
    expect(stammdaten.catalog.positionen.length).toBeGreaterThan(30);

    // aiComplete → direkt gegen den echten Vercel-Handler (kein HTTP-Server nötig).
    const aiComplete = async (opts: {
      systemPrompt: string; userMessage: string; cachedContext?: string;
      maxTokens?: number; responseFormat?: string;
    }) => {
      const req = {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: {
          system: opts.systemPrompt + (opts.cachedContext ? `\n\n${opts.cachedContext}` : ""),
          messages: [{ role: "user", content: opts.userMessage }],
          max_tokens: opts.maxTokens ?? 8000,
          response_format: "json",
        },
      };
      const out = await new Promise<{ code: number; body: { text?: string; message?: string; error?: string } }>((resolve) => {
        const res = {
          _c: 200,
          setHeader() {},
          status(c: number) { this._c = c; return this; },
          json(o: never) { resolve({ code: this._c, body: o }); },
        };
        chatHandler(req, res);
      });
      if (out.code !== 200) throw new Error(`KI-Fehler HTTP ${out.code}: ${out.body?.error}`);
      const text = out.body.text ?? out.body.message ?? "";
      console.log(`KI-ANTWORT: ${text.length} Zeichen | Ende: …${text.slice(-100).replace(/\n/g, " ")}`);
      return { text };
    };

    // Sichtbar machen, was das Katalog-Retrieval liefert (Qualitätsurteil).
    const { searchCatalogForTranscript } = await import("../wholesale");
    // Realistische Praxis-Szenarien eines österreichischen Installateur-/Elektrobetriebs.
    const SZENARIO = Number(process.env.VOICE_SZENARIO || 1);
    const transcripts: Record<number, string> = {
      1:
        "Betrifft: Elektro- und Sanitärarbeiten Badumbau. " +
        "Wir verlegen 25 Meter NYM-J 3x1,5 unter Putz, setzen 6 Schuko-Steckdosen unterputz " +
        "und bauen einen FI-Schutzschalter 40A 30mA in den Verteiler ein. " +
        "Dazu montieren wir ein Wand-WC mit Vorwandinstallation und einen Waschtisch mit Eckventilen.",
      2:
        "Betrifft: Komplettsanierung Badezimmer, zirka acht Quadratmeter, Einfamilienhaus in Hallein. " +
        "Altes Bad komplett demontieren und entsorgen. Dann eine bodengleiche Dusche mit Glasabtrennung, " +
        "neunzig mal hundertzwanzig, einbauen, Abdichtung nach Norm. Wand-WC mit Unterputzspülkasten, " +
        "Waschtisch mit Unterschrank und Spiegelschrank. Rund fünfundzwanzig Quadratmeter Wandfliesen " +
        "und acht Quadratmeter Bodenfliesen verlegen. Armaturen für Dusche und Waschtisch von Grohe. " +
        "Der Kunde will noch einen Handtuchheizkörper, den schließen wir ans Warmwasser an.",
      3:
        // Umgangssprache + Korrektur mitten im Satz – so reden Monteure wirklich.
        "Ja servus, also beim Huber in der Bahnstraße hauen wir das alte Klo raus und " +
        "hängen ein neues Wand-WC hin. Dann brauch ma noch, warte, zehn Meter, na doch " +
        "fünfzehn Meter Kupferrohr, achtzehner, für die neue Warmwasserleitung. Und der " +
        "Boiler, also der Warmwasserspeicher, der alte 80-Liter, kommt raus und ein neuer " +
        "hundertfünfzig Liter kommt rein. Ach ja, und zwei Eckventile tauschen wir a noch.",
      4:
        // Regie-/Notdienstfall: keine fixen Positionen, Stunden + Material.
        "Betrifft: Notdienst Wasserschaden Keller, Familie Leitner, Salzburg. " +
        "Wasserleitung im Keller geplatzt, wir waren am Samstag zwei Monteure vier Stunden " +
        "vor Ort auf Regie. Leitung provisorisch abgedichtet und ein Absperrventil getauscht. " +
        "Anfahrt fünfunddreißig Kilometer. Material: ein Kugelhahn halb Zoll und zwei Meter " +
        "Kupferrohr achtzehner. Trocknungsgerät haben wir dagelassen, drei Tage Miete.",
      5:
        // Elektriker-Feinheiten: Rahmen, Kombinationen, Schalterprogramm.
        "Betrifft: Wohnzimmer Elektrik erneuern. Wir setzen vier Steckdosen Gira System 55 " +
        "reinweiß, zwei davon zusammen in einem 2-fach Rahmen. Dazu einen Wechselschalter " +
        "mit Steckdose in einer Kombination beim Eingang. Und über der Kommode noch eine " +
        "einzelne Steckdose mit eigenem Rahmen.",
    };
    const transcript = transcripts[SZENARIO] ?? transcripts[1];
    console.log(`\n===== SZENARIO ${SZENARIO} =====`);

    const hits = await searchCatalogForTranscript(transcript);
    console.log(`\nGROSSHANDELS-RETRIEVAL: ${hits.length} Artikel`);
    for (const h of hits.slice(0, 10)) {
      console.log(`  ${h.artikelnummer} | ${h.bezeichnung.slice(0, 56)} | EK ${(h.ek_cent / 100).toFixed(3)} €/${h.einheit}`);
    }

    const result = await runVoiceAngebot(
      {
        text: transcript,
        organizationName: "Bad.Werk GmbH",
        catalog: stammdaten.catalog,
        stundensaetze: stammdaten.stundensaetze,
        settings: stammdaten.kalkSettings,
      },
      // deps: echte Pipeline, echter Parser – nur aiComplete gegen den Handler verdrahtet
      { aiComplete: aiComplete as never, runCalcPipeline, extractErgaenzungenHinweise, parseJsonResponse },
    );

    // ── Ergebnis sichtbar machen (Qualitätsurteil) ──
    let sum = 0;
    for (const g of result.gewerke) {
      console.log(`\n■ GEWERK: ${g.name}`);
      for (const p of g.positionen ?? []) {
        const vk = Number(p.vk_netto_einheit ?? 0) * Number(p.menge ?? 0);
        sum += vk;
        console.log(
          `  ${p.leistungsnummer ?? "?"} | ${p.leistungsname} | ${p.menge} ${p.einheit} × ${Number(p.vk_netto_einheit ?? 0).toFixed(2)} € = ${vk.toFixed(2)} € ${p.aus_preisliste ? "[Preisliste]" : "[Neu-Kalkulation]"}`,
        );
        if (p.beschreibung?.includes("Großhandelskatalog")) {
          console.log(`     ↳ ${String(p.beschreibung).split("\n").find((l: string) => l.includes("Großhandelskatalog"))}`);
        }
      }
    }
    console.log(`\nSUMME NETTO: ${sum.toFixed(2)} €`);

    // ── Harte Erwartungen ──
    expect(result.gewerke.length).toBeGreaterThan(0);
    const alle = result.gewerke.flatMap((g) => g.positionen ?? []);
    expect(alle.length).toBeGreaterThanOrEqual(SZENARIO === 5 ? 3 : 4);
    // Jede Position hat eine Menge; Neu-Kalkulationen haben IMMER einen Preis.
    // 0-€-Positionen aus der eigenen Preisliste (Stammdaten-Lücke) sind erlaubt,
    // MÜSSEN aber einen Prüf-Hinweis erzeugen (Plausibilitäts-Wache).
    const hinweise = result.meta.hinweise ?? [];
    if (hinweise.length) console.log("\nPRÜF-HINWEISE:\n  " + hinweise.join("\n  "));
    for (const p of alle) {
      expect(Number(p.menge ?? 0), `Menge fehlt: ${p.leistungsname}`).toBeGreaterThan(0);
      const vk = Number(p.vk_netto_einheit ?? 0);
      if (!p.aus_preisliste) {
        expect(vk, `Preis fehlt (Neu-Kalkulation): ${p.leistungsname}`).toBeGreaterThan(0);
      } else if (vk <= 0) {
        expect(
          hinweise.some((h) => h.includes(String(p.leistungsname ?? ""))),
          `0-€-Preislisten-Position ohne Prüf-Hinweis: ${p.leistungsname}`,
        ).toBe(true);
      }
    }
    // Mindestens eine Position referenziert den Großhandelskatalog (echter EK verwendet)
    const mitKatalog = alle.filter((p) => String(p.beschreibung ?? "").includes("Großhandelskatalog"));
    if (SZENARIO === 1) {
      expect(mitKatalog.length, "keine Position nutzt den Großhandelskatalog").toBeGreaterThan(0);
    } else {
      console.log(`Katalog-Positionen: ${mitKatalog.length}`);
    }

    // WICHTIG: scope 'local' – der supabase-js-Default 'global' widerruft ALLE
    // Sessions des Test-Users, also auch echte Browser-Logins auf anderen Geräten
    // (Symptom dort: "Nicht angemeldet." bei allen /api/*-Aufrufen).
    await supabase.auth.signOut({ scope: "local" });
  }, 180_000);
});
