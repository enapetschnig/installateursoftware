// ============================================================
// B4Y SuperAPP – Edge Function: buak-calendar
// action "search": sucht via Google Custom Search nach dem BUAK-
//   Arbeitszeitkalender eines Jahres (Domain-Priorität).
// action "parse": lädt eine PDF serverseitig, extrahiert den Text
//   und erkennt je KW kurze/lange Woche (mit Confidence).
// Keys ausschließlich aus Secrets (nie im Frontend/Repo/Log).
// ============================================================
import { extractText, getDocumentProxy } from "https://esm.sh/unpdf@0.12.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// ---------- ISO-Kalenderwoche ----------
const pad = (n: number) => String(n).padStart(2, "0");
const fmt = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
function isoWeekYear(d: Date) {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7) + 3);
  const year = date.getUTCFullYear();
  const firstThu = new Date(Date.UTC(year, 0, 4));
  firstThu.setUTCDate(firstThu.getUTCDate() - ((firstThu.getUTCDay() + 6) % 7) + 3);
  return { year, week: 1 + Math.round((date.getTime() - firstThu.getTime()) / 6.048e8) };
}
function mondayOfISOWeek(year: number, week: number) {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const w1 = new Date(jan4);
  w1.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7));
  const m = new Date(w1);
  m.setUTCDate(w1.getUTCDate() + (week - 1) * 7);
  return m;
}
const weeksInYear = (y: number) => isoWeekYear(new Date(Date.UTC(y, 11, 28))).week;

// ---------- Domain-Priorität ----------
function domainScore(domain: string): number {
  const d = domain.toLowerCase();
  if (d.includes("buak.at")) return 100;
  if (d.includes("wko.at")) return 80;
  if (d.includes("gbh")) return 60;
  if (d.includes("oegb") || d.includes("arbeiterkammer") || d.includes(".gv.at")) return 50;
  return 20;
}

// ---------- Internetsuche via Claude (Anthropic Websuche-Tool) ----------
async function searchCalendar(year: number) {
  const aiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!aiKey) {
    return json({ error: "secrets_missing", message: "ANTHROPIC_API_KEY ist nicht gesetzt. Bitte als Edge-Function-Secret hinterlegen." });
  }
  const prompt =
    `Finde den offiziellen österreichischen BUAK-Arbeitszeitkalender für das Jahr ${year} als herunterladbare Datei (bevorzugt PDF). ` +
    `Bevorzuge Quellen in dieser Reihenfolge: buak.at, wko.at, gbh. Nutze die Websuche. ` +
    `Gib am Ende AUSSCHLIESSLICH JSON zurück: {"results":[{"title":"...","url":"https://...","domain":"..."}]} mit bis zu 8 Treffern, beste zuerst. Keine Erklärung.`;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": aiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2048,
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
        messages: [{ role: "user", content: prompt }],
      }),
    });
    if (!r.ok) {
      let detail = "";
      try { const eb = await r.json(); detail = eb?.error?.message || eb?.error?.type || ""; } catch { /* ignore */ }
      console.error("search non-ok", r.status);
      return json({ error: "search_failed", message: `Websuche fehlgeschlagen (HTTP ${r.status})${detail ? ": " + detail : ""}.` });
    }
    const data = await r.json();
    const text = (data.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
    const jsonStr = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
    let parsed: any = { results: [] };
    try { parsed = JSON.parse(jsonStr); } catch { /* leer */ }
    const all = (parsed.results ?? [])
      .map((x: any) => {
        let domain = x.domain as string | undefined;
        if (!domain) { try { domain = new URL(x.url).hostname.replace(/^www\./, ""); } catch { domain = ""; } }
        const isPdf = String(x.url || "").toLowerCase().endsWith(".pdf");
        return { title: x.title || x.url, link: x.url, domain, fileType: isPdf ? "PDF" : "HTML", score: domainScore(domain || "") + (isPdf ? 25 : 0) };
      })
      .filter((x: any) => x.link)
      .sort((a: any, b: any) => b.score - a.score);
    // Wunsch: ausschließlich buak.at verwenden, sofern vorhanden
    const buak = all.filter((x: any) => (x.domain || "").includes("buak.at"));
    const results = (buak.length ? buak : all).slice(0, 12);
    return json({ ok: true, year, results, buakOnly: buak.length > 0 });
  } catch (e) {
    console.error("search_error", String(e).slice(0, 120));
    return json({ error: "search_failed", message: "Websuche fehlgeschlagen." });
  }
}

// ---------- KI-Auslese (Claude) – Ergänzung, wenn Parser unsicher ----------
async function aiDetect(apiKey: string, text: string, year: number): Promise<Map<number, "kurz" | "lang">> {
  const prompt =
    `Das ist der Text eines österreichischen BUAK-Arbeitszeitkalenders für ${year}. ` +
    `Erkenne je Kalenderwoche, ob es eine KURZE oder LANGE Woche ist (oft mit K bzw. L markiert). ` +
    `Antworte AUSSCHLIESSLICH mit JSON: {"weeks":[{"w":1,"t":"kurz"},{"w":2,"t":"lang"}]} – ` +
    `nur eindeutig erkennbare Wochen, keine Erklärung.\n\nTEXT:\n${text.slice(0, 16000)}`;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 4096, messages: [{ role: "user", content: prompt }] }),
  });
  if (!r.ok) throw new Error("anthropic_" + r.status);
  const data = await r.json();
  const txt = (data.content?.[0]?.text || "").trim();
  const jsonStr = txt.slice(txt.indexOf("{"), txt.lastIndexOf("}") + 1);
  const parsed = JSON.parse(jsonStr);
  const map = new Map<number, "kurz" | "lang">();
  for (const it of parsed.weeks ?? []) {
    const w = Number(it.w); const t = String(it.t).toLowerCase();
    if (w >= 1 && w <= 53 && (t === "kurz" || t === "lang")) map.set(w, t as "kurz" | "lang");
  }
  return map;
}

// ---------- PDF laden + auslesen ----------
async function parseCalendar(year: number, sourceUrl: string) {
  if (!/^https:\/\//i.test(sourceUrl)) {
    return json({ error: "bad_url", message: "Nur HTTPS-Quellen erlaubt." });
  }
  let buf: Uint8Array;
  let resp: Response;
  try {
    resp = await fetch(sourceUrl, { redirect: "follow" });
    if (!resp.ok) return json({ error: "download_failed", message: `Download fehlgeschlagen (HTTP ${resp.status}).` });
    buf = new Uint8Array(await resp.arrayBuffer());
  } catch (_e) {
    return json({ error: "download_failed", message: "Datei konnte nicht heruntergeladen werden." });
  }
  const ct = (resp.headers.get("content-type") || "").toLowerCase();
  const isPdf = ct.includes("pdf") || sourceUrl.toLowerCase().endsWith(".pdf");

  async function pdfText(bytes: Uint8Array): Promise<string> {
    const pdf = await getDocumentProxy(bytes);
    const res = await extractText(pdf, { mergePages: true });
    return Array.isArray(res.text) ? res.text.join("\n") : (res.text as string);
  }

  let text = "";
  try {
    if (isPdf) {
      text = await pdfText(buf);
    } else {
      // HTML: zuerst eine verlinkte PDF (Kalender) suchen und diese auslesen
      const html = new TextDecoder("utf-8").decode(buf);
      const links = [...html.matchAll(/href=["']([^"']+\.pdf[^"']*)["']/gi)].map((m) => m[1]);
      const abs = links.map((h) => { try { return new URL(h, sourceUrl).href; } catch { return ""; } }).filter(Boolean);
      const pref = abs.find((u) => /kalender/i.test(u) && new RegExp(String(year)).test(u))
        || abs.find((u) => /kalender/i.test(u)) || abs[0];
      if (pref) {
        try {
          const pr = await fetch(pref, { redirect: "follow" });
          if (pr.ok) text = await pdfText(new Uint8Array(await pr.arrayBuffer()));
        } catch { /* fällt auf HTML-Text zurück */ }
      }
      if (!text) {
        text = html
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ");
      }
    }
  } catch (_e) {
    return json({ error: "parse_failed", message: "Konnte Datei nicht auslesen (Status: Prüfung erforderlich)." });
  }

  // Erkennung: <Tag-im-Jahr 3-stellig> <KW 1-2-stellig> <K|L>
  const found = new Map<number, "kurz" | "lang">();
  for (const m of text.matchAll(/(\d{3})\s+(\d{1,2})\s*([KL])\b/g)) {
    const kw = parseInt(m[2], 10);
    if (kw >= 1 && kw <= 53) found.set(kw, m[3] === "K" ? "kurz" : "lang");
  }
  // Fallback ohne Tag-Anker, falls zu wenige Treffer
  if (found.size < 30) {
    for (const m of text.matchAll(/\b(\d{1,2})\s*([KL])\b/g)) {
      const kw = parseInt(m[1], 10);
      if (kw >= 1 && kw <= 53 && !found.has(kw)) found.set(kw, m[2] === "K" ? "kurz" : "lang");
    }
  }

  const total = weeksInYear(year);

  // KI-Ergänzung nur, wenn deterministisch unsicher UND Key gesetzt
  const aiKey = Deno.env.get("ANTHROPIC_API_KEY");
  const aiFound = new Map<number, "kurz" | "lang">();
  let aiUsed = false;
  if (found.size < total - 1 && aiKey) {
    aiUsed = true;
    try {
      const got = await aiDetect(aiKey, text, year);
      for (const [k, v] of got) if (!found.has(k)) aiFound.set(k, v);
    } catch (e) { console.error("ai_error", String(e).slice(0, 120)); }
  }

  const rows = [];
  for (let w = 1; w <= total; w++) {
    const mon = mondayOfISOWeek(year, w);
    const sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6);
    const det = found.get(w);
    const ai = aiFound.get(w);
    const type = det ?? ai ?? "unbekannt";
    rows.push({
      week: w, date_from: fmt(mon), date_to: fmt(sun),
      week_type: type, confidence: det ? 0.97 : ai ? 0.8 : 0,
    });
  }
  const detected = found.size + aiFound.size;
  const status = detected >= total - 1 ? "ausgelesen" : "pruefung";
  return json({
    ok: true, year, status, detected, total, aiUsed,
    message: detected >= total - 1
      ? `${detected} von ${total} Wochen erkannt${aiUsed ? " (inkl. KI)" : ""}.`
      : `Nur ${detected} von ${total} Wochen erkannt – bitte prüfen und korrigieren.`,
    rows,
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const { action, year, url } = await req.json();
    const y = Number(year);
    if (!y || y < 2000 || y > 2100) return json({ error: "bad_year", message: "Ungültiges Jahr." });
    if (action === "search") return await searchCalendar(y);
    if (action === "parse") {
      if (!url) return json({ error: "no_url", message: "Keine Quelle angegeben." });
      return await parseCalendar(y, String(url));
    }
    return json({ error: "bad_action", message: "Unbekannte Aktion." });
  } catch (_e) {
    return json({ error: "bad_request", message: "Ungültige Anfrage." });
  }
});
