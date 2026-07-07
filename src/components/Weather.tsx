import { useEffect, useState } from "react";
import {
  Sun, Cloud, Cloudy, CloudFog, CloudDrizzle, CloudRain, CloudSnow,
  CloudLightning, Wind, Droplets, RefreshCw,
} from "lucide-react";
import { loadCompanySettings } from "../lib/company";

// Standort. Wien ist nur der Default (mandantenneutral).
// Mandanten-Vorbereitung: Später kann der Standort als prop übergeben werden –
// z. B. aus den Firmeneinstellungen (company_settings: Stadt/PLZ) oder aus der
// Projektadresse abgeleitet. Keine Firma wird hier hartcodiert.
export type WeatherLocation = { name: string; lat: number; lon: number };
const DEFAULT_LOC: WeatherLocation = { name: "Wien", lat: 48.2082, lon: 16.3738 };

type WMO = { label: string; Icon: typeof Sun };
function wmo(code: number): WMO {
  if (code === 0) return { label: "Klar", Icon: Sun };
  if (code <= 2) return { label: "Heiter", Icon: Cloud };
  if (code === 3) return { label: "Bedeckt", Icon: Cloudy };
  if (code <= 48) return { label: "Nebel", Icon: CloudFog };
  if (code <= 57) return { label: "Niesel", Icon: CloudDrizzle };
  if (code <= 67) return { label: "Regen", Icon: CloudRain };
  if (code <= 77) return { label: "Schnee", Icon: CloudSnow };
  if (code <= 82) return { label: "Regenschauer", Icon: CloudRain };
  if (code <= 86) return { label: "Schneeschauer", Icon: CloudSnow };
  return { label: "Gewitter", Icon: CloudLightning };
}

type WeatherData = {
  current?: { temperature_2m?: number; weather_code?: number; wind_speed_10m?: number };
  daily?: { temperature_2m_max?: number[]; temperature_2m_min?: number[]; precipitation_probability_max?: number[]; weather_code?: number[] };
  hourly?: { time?: string[]; temperature_2m?: number[]; weather_code?: number[] };
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

// Bauwetter-Bewertung für Außenarbeiten (nach den vorgegebenen Schwellen, schärfste Lage zuerst).
function bauwetter(maxT: number | null, minT: number | null, wind: number | null, precip: number | null): { label: string; tone: string } {
  if (wind !== null && wind > 40) return { label: "Wind kritisch – Sicherung prüfen", tone: "text-rose-500" };
  if (minT !== null && minT < 5) return { label: "Frostgefahr – Außenarbeiten prüfen", tone: "text-sky-500" };
  if (maxT !== null && maxT > 30) return { label: "Hitze beachten", tone: "text-amber-500" };
  if (precip !== null && precip > 60) return { label: "Regenrisiko beachten", tone: "text-amber-500" };
  return { label: "Außenarbeiten grundsätzlich möglich", tone: "text-ok-500" };
}

export default function Weather({ location }: { location?: WeatherLocation }) {
  const [loc, setLoc] = useState<WeatherLocation>(location ?? DEFAULT_LOC);
  const [data, setData] = useState<WeatherData | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  // Standort mandantenfähig: expliziter location-Prop hat Vorrang, sonst aus den
  // Firmeneinstellungen (Stadt → Open-Meteo-Geocoding). Wien bleibt Fallback bei
  // fehlender/nicht auflösbarer Stadt. Keine Koordinaten hartcodiert (außer Wien-Default).
  useEffect(() => {
    if (location) { setLoc(location); return; }
    let alive = true;
    (async () => {
      try {
        const cs = await loadCompanySettings();
        const city = cs?.city?.trim();
        if (!city) return;
        const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=de&format=json`);
        if (!r.ok) return;
        const j = await r.json();
        const hit = j?.results?.[0];
        if (alive && hit && typeof hit.latitude === "number" && typeof hit.longitude === "number") {
          setLoc({ name: hit.name || city, lat: hit.latitude, lon: hit.longitude });
        }
      } catch { /* Wien-Default bleibt */ }
    })();
    return () => { alive = false; };
  }, [location]);

  function load() {
    setError(false);
    setLoading(true);
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${loc.lat}&longitude=${loc.lon}` +
      `&current=temperature_2m,weather_code,wind_speed_10m` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code` +
      `&hourly=temperature_2m,weather_code&timezone=auto&forecast_days=1`;
    fetch(url)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("HTTP " + r.status))))
      .then((j) => { setData(j as WeatherData); setUpdatedAt(new Date()); })
      .catch(() => setError(true))
      .finally(() => setLoading(false));
  }

  // Neu laden, wenn sich der Standort ändert (z. B. später aus Firmeneinstellungen).
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.lat, loc.lon]);

  const title = (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 font-bold">
        <Sun size={16} className="text-warn-500" /> Wetter in {loc.name}
      </h2>
      <button
        onClick={load}
        disabled={loading}
        title="Aktualisieren"
        aria-label="Wetter aktualisieren"
        className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-500 transition hover:bg-slate-100 disabled:opacity-50 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/5"
      >
        <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Aktualisieren
      </button>
    </div>
  );

  if (loading && !data) {
    return <div className="glass p-4">{title}<p className="text-sm text-slate-400">Lädt aktuelle Wetterdaten …</p></div>;
  }
  if (error || !data || !data.current) {
    return (
      <div className="glass p-4">
        {title}
        <p className="text-sm text-slate-500 dark:text-slate-400">Wetterdaten aktuell nicht verfügbar.</p>
      </div>
    );
  }

  const temp = num(data.current.temperature_2m);
  const code = num(data.current.weather_code) ?? 0;
  const cur = wmo(code);
  const maxT = num(data.daily?.temperature_2m_max?.[0]);
  const minT = num(data.daily?.temperature_2m_min?.[0]);
  const precip = num(data.daily?.precipitation_probability_max?.[0]);
  const wind = num(data.current.wind_speed_10m);
  const bw = bauwetter(maxT, minT, wind, precip);

  // Tagesverlauf: 06–21 Uhr in 3-h-Schritten (nur sofern Stundendaten vorhanden).
  const times = data.hourly?.time ?? [];
  const temps = data.hourly?.temperature_2m ?? [];
  const codes = data.hourly?.weather_code ?? [];
  const slots = times
    .map((t, i) => ({ h: new Date(t).getHours(), temp: num(temps[i]), code: num(codes[i]) ?? 0 }))
    .filter((x) => [6, 9, 12, 15, 18, 21].includes(x.h) && x.temp !== null);

  return (
    <div className="glass p-4">
      {title}
      <div className="flex items-center gap-4">
        <cur.Icon size={40} className="text-warn-500" />
        <div>
          <div className="text-3xl font-extrabold tabular-nums">{temp !== null ? `${Math.round(temp)}°C` : "–"}</div>
          <div className="text-sm text-slate-500 dark:text-slate-400">{cur.label}</div>
        </div>
        <div className="ml-auto space-y-0.5 text-right text-xs text-slate-400">
          <div className="tabular-nums">Tag {maxT !== null ? `${Math.round(maxT)}°` : "–"} / Nacht {minT !== null ? `${Math.round(minT)}°` : "–"}</div>
          <div className="flex items-center justify-end gap-1"><Droplets size={12} /> {precip !== null ? `${precip}% Regen` : "Regen –"}</div>
          <div className="flex items-center justify-end gap-1"><Wind size={12} /> {wind !== null ? `${Math.round(wind)} km/h` : "Wind –"}</div>
        </div>
      </div>

      <div className={`mt-3 text-sm font-semibold ${bw.tone}`}>Bauwetter: {bw.label}</div>

      {slots.length > 0 && (
        <div className="mt-3 grid grid-cols-6 gap-1 border-t pt-3 text-center" style={{ borderColor: "var(--border)" }}>
          {slots.map((s) => {
            const w = wmo(s.code);
            return (
              <div key={s.h} className="flex flex-col items-center gap-1">
                <span className="text-[11px] text-slate-400">{String(s.h).padStart(2, "0")}h</span>
                <w.Icon size={16} className="text-slate-500 dark:text-slate-300" />
                <span className="text-xs font-semibold tabular-nums">{s.temp !== null ? `${s.temp}°` : "–"}</span>
              </div>
            );
          })}
        </div>
      )}

      {updatedAt && (
        <div className="mt-3 text-right text-[11px] text-slate-400">
          Aktualisiert {updatedAt.toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" })}
        </div>
      )}
    </div>
  );
}
