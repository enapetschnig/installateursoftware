// ============================================================
// Installateursoftware – Mitarbeiter-App: Projektliste (/m/projekte)
//
// Mobil-optimierte Projektauswahl als große Karten mit Suchfeld. Tippen auf
// ein Projekt öffnet die Detailseite (Fotos hochladen, Regiebericht, Stunden).
// RLS greift serverseitig – der Mitarbeiter sieht nur die für ihn sichtbaren
// Projekte. Status-Badge nutzt die zentrale, mandantenfähige stageTone-Logik
// (keine hartcodierten Statuswerte).
// ============================================================
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronRight, MapPin } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { Badge, Empty, Spinner } from "../../components/ui";
import { SearchInput, ErrorBanner } from "../../components/calc-ui";
import { stageTone } from "../../lib/types";

type ProjectRow = {
  id: string;
  title: string | null;
  project_number: string | null;
  city: string | null;
  stage: string | null;
};

export default function MProjekte() {
  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    supabase
      .from("projects")
      .select("id,title,project_number,city,stage")
      .eq("archived", false)
      .order("created_at", { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setErr(error.message);
        setProjects((data as ProjectRow[]) ?? []);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return projects;
    return projects.filter((p) =>
      [p.title, p.project_number, p.city, p.stage]
        .filter(Boolean)
        .some((v) => (v as string).toLowerCase().includes(needle)),
    );
  }, [projects, q]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-extrabold tracking-tight">Projekte</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Projekt öffnen, Fotos & Regie erfassen.</p>
      </div>

      <SearchInput value={q} onChange={setQ} placeholder="Projekt suchen (Name, Nummer, Ort) …" />

      <ErrorBanner message={err} />

      {loading ? (
        <Spinner />
      ) : shown.length === 0 ? (
        <Empty
          title={projects.length === 0 ? "Keine Projekte vorhanden" : "Keine Treffer"}
          hint={projects.length === 0 ? "Es sind noch keine für dich sichtbaren Projekte angelegt." : "Passe deine Suche an."}
        />
      ) : (
        <div className="space-y-3">
          {shown.map((p) => (
            <Link
              key={p.id}
              to={`/m/projekte/${p.id}`}
              className="glass glass-hover flex min-h-[64px] items-center gap-3 p-4"
            >
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="min-w-0 truncate font-bold">{p.title || "(ohne Titel)"}</span>
                  {p.stage && <Badge tone={stageTone(p.stage)}>{p.stage}</Badge>}
                </span>
                <span className="mt-0.5 flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
                  {p.project_number && <span className="shrink-0 tabular-nums">{p.project_number}</span>}
                  {p.city && (
                    <span className="flex min-w-0 items-center gap-1">
                      <MapPin size={13} className="shrink-0" />
                      <span className="truncate">{p.city}</span>
                    </span>
                  )}
                </span>
              </span>
              <ChevronRight size={20} className="shrink-0 text-slate-400" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
