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
    expect(stammdaten.catalog.positionen.length).toBeGreaterThan(100);

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
    const transcript =
      "Betrifft: Elektro- und Sanitärarbeiten Badumbau. " +
      "Wir verlegen 25 Meter NYM-J 3x1,5 unter Putz, setzen 6 Schuko-Steckdosen unterputz " +
      "und bauen einen FI-Schutzschalter 40A 30mA in den Verteiler ein. " +
      "Dazu montieren wir ein Wand-WC mit Vorwandinstallation und einen Waschtisch mit Eckventilen.";

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
    expect(alle.length).toBeGreaterThanOrEqual(4);
    // Jede Position hat Menge + Preis > 0
    for (const p of alle) {
      expect(Number(p.menge ?? 0), `Menge fehlt: ${p.leistungsname}`).toBeGreaterThan(0);
      expect(Number(p.vk_netto_einheit ?? 0), `Preis fehlt: ${p.leistungsname}`).toBeGreaterThan(0);
    }
    // Mindestens eine Position referenziert den Großhandelskatalog (echter EK verwendet)
    const mitKatalog = alle.filter((p) => String(p.beschreibung ?? "").includes("Großhandelskatalog"));
    expect(mitKatalog.length, "keine Position nutzt den Großhandelskatalog").toBeGreaterThan(0);

    await supabase.auth.signOut();
  }, 180_000);
});
