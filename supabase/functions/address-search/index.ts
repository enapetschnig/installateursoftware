// ============================================================
// B4Y SuperAPP – Edge Function: address-search
// ------------------------------------------------------------
// Adress-Autovervollständigung (Österreich). Proxy zum Adress-/Geokodierungs-Provider,
// damit:
//   • kein CORS-Problem im Browser (Frontend ruft nur die eigene Function),
//   • kein Provider-Key im Frontend liegt (Key bleibt serverseitig),
//   • der Provider/Upstream je Mandant/Deployment per ENV austauschbar ist
//     (z. B. BEV/data.gv.at), ohne Frontend-Änderung.
//
// ENV (Function-Secrets, optional):
//   ADDRESS_UPSTREAM_URL  – Vorlage mit {q}, liefert Photon-kompatibles GeoJSON
//                           ODER { results:[{street,zip,city,country}] }.
//                           Default: Photon (OSM, kostenlos, kein Key), AT-gefiltert.
//   ADDRESS_API_KEY       – optional, wird als Bearer-Header an den Upstream gesendet.
//
// Antwort: { suggestions: [{ label, street, zip, city, country }] }
// ============================================================
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

type Suggestion = { label: string; street: string; zip: string; city: string; country: string };

const trim = (s: unknown) => String(s ?? "").trim();

function fromPhoton(json: any): Suggestion[] {
  const feats = Array.isArray(json?.features) ? json.features : [];
  return feats
    .map((f: any) => {
      const p = f?.properties ?? {};
      const street = trim([p.street || p.name, p.housenumber].filter(Boolean).join(" "));
      const zip = trim(p.postcode);
      const city = trim(p.city || p.town || p.village || p.district);
      const country = trim(p.country);
      const cc = trim(p.countrycode).toUpperCase();
      return { street, zip, city, country, cc };
    })
    // nur Österreich, nur Treffer mit verwertbarer Adresse
    .filter((s: any) => (!s.cc || s.cc === "AT") && (s.street || s.zip || s.city))
    .map((s: any): Suggestion => ({
      label: [s.street, [s.zip, s.city].filter(Boolean).join(" ")].filter(Boolean).join(", "),
      street: s.street, zip: s.zip, city: s.city, country: s.country || "Österreich",
    }));
}

function fromGeneric(json: any): Suggestion[] {
  const rows = Array.isArray(json?.results) ? json.results : (Array.isArray(json) ? json : []);
  return rows.map((r: any): Suggestion => ({
    street: trim(r.street), zip: trim(r.zip ?? r.postcode), city: trim(r.city ?? r.ort),
    country: trim(r.country ?? r.land) || "Österreich",
    label: trim(r.label) || [trim(r.street), [trim(r.zip ?? r.postcode), trim(r.city ?? r.ort)].filter(Boolean).join(" ")].filter(Boolean).join(", "),
  })).filter((s: Suggestion) => s.street || s.zip || s.city);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const url = new URL(req.url);
    let q = url.searchParams.get("q") ?? "";
    if (!q && (req.method === "POST")) { try { q = (await req.json())?.q ?? ""; } catch { /* ignore */ } }
    q = trim(q);
    if (q.length < 3) return new Response(JSON.stringify({ suggestions: [] }), { headers: { ...CORS, "Content-Type": "application/json" } });

    const upstreamTpl = Deno.env.get("ADDRESS_UPSTREAM_URL") || "";
    const apiKey = Deno.env.get("ADDRESS_API_KEY") || "";
    const isCustom = !!upstreamTpl;
    const target = isCustom
      ? upstreamTpl.replace("{q}", encodeURIComponent(q))
      // Default: Photon (Komoot, OSM) – kostenlos, kein Key, auf Österreich eingegrenzt.
      : `https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&lang=de&limit=6`;

    const headers: Record<string, string> = { "User-Agent": "B4Y-SuperAPP/1.0 (address-search)" };
    if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

    const res = await fetch(target, { headers });
    if (!res.ok) return new Response(JSON.stringify({ suggestions: [], error: `upstream ${res.status}` }), { headers: { ...CORS, "Content-Type": "application/json" } });
    const json = await res.json();
    const suggestions = isCustom ? fromGeneric(json) : fromPhoton(json);
    return new Response(JSON.stringify({ suggestions }), { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ suggestions: [], error: String(e) }), { headers: { ...CORS, "Content-Type": "application/json" }, status: 200 });
  }
});
