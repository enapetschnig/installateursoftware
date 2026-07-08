// ============================================================
// Installateursoftware – Mitarbeiter-App: Projekt-Detail (/m/projekte/:id)
//
// Kompakter Projektkopf (Titel/Nummer/Ort/Status) + der zentrale Foto-/Video-
// Bereich (wiederverwendete <ProjectMediaGallery/> mit Kamera & Upload) sowie
// große Aktionen: „Regiebericht für dieses Projekt" (→ /m/regie/neu?projekt=)
// und „Stunden buchen" (→ /m/zeit?projekt=). uploadedBy = eingeloggter Nutzer;
// RLS greift serverseitig. Mandantenfähig: Status-Badge via zentraler
// stageTone-Logik.
// ============================================================
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ClipboardList, Clock, MapPin } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { Badge, Empty, Spinner } from "../../components/ui";
import { ErrorBanner } from "../../components/calc-ui";
import { stageTone } from "../../lib/types";
import { useAuth } from "../../lib/auth";
import ProjectMediaGallery from "../../components/media/ProjectMediaGallery";
import ProjectFilesSection from "../../components/mitarbeiter/ProjectFilesSection";

type ProjectRow = {
  id: string;
  title: string | null;
  project_number: string | null;
  city: string | null;
  street: string | null;
  stage: string | null;
};

export default function MProjektDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { session } = useAuth();
  const [project, setProject] = useState<ProjectRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    supabase
      .from("projects")
      .select("id,title,project_number,city,street,stage")
      .eq("id", id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setErr(error.message);
        setProject((data as ProjectRow) ?? null);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [id]);

  if (loading) return <Spinner />;
  if (!project) {
    return (
      <div className="space-y-4">
        <button className="btn-ghost min-h-[44px] px-2" onClick={() => navigate("/m/projekte")}>
          <ArrowLeft size={18} /> Zurück
        </button>
        <ErrorBanner message={err} />
        <Empty title="Projekt nicht gefunden" hint="Es ist für dich nicht (mehr) sichtbar oder wurde entfernt." />
      </div>
    );
  }

  const ort = [project.street, project.city].filter(Boolean).join(", ");

  return (
    <div className="space-y-4">
      <button className="btn-ghost min-h-[44px] px-2" onClick={() => navigate("/m/projekte")}>
        <ArrowLeft size={18} /> Zurück
      </button>

      {/* Projektkopf */}
      <div className="glass p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <h1 className="min-w-0 text-xl font-extrabold tracking-tight">{project.title || "(ohne Titel)"}</h1>
          {project.stage && <Badge tone={stageTone(project.stage)}>{project.stage}</Badge>}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500 dark:text-slate-400">
          {project.project_number && <span className="tabular-nums">Nr. {project.project_number}</span>}
          {ort && (
            <span className="flex items-center gap-1">
              <MapPin size={13} /> {ort}
            </span>
          )}
        </div>
      </div>

      {/* Aktionen */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Link
          to={`/m/regie/neu?projekt=${project.id}`}
          className="btn-primary min-h-[52px] w-full justify-center text-base"
        >
          <ClipboardList size={18} /> Regiebericht
        </Link>
        <Link
          to={`/m/zeit?projekt=${project.id}`}
          className="btn-outline min-h-[52px] w-full justify-center text-base"
        >
          <Clock size={18} /> Stunden buchen
        </Link>
      </div>

      {/* Fotos & Videos (zentrale Galerie inkl. Upload + Kamera). */}
      <ProjectMediaGallery
        projectId={project.id}
        uploadedBy={session?.user.id ?? null}
        perms={{ canUpload: true, canCapture: true, canDelete: false }}
      />

      {/* Pläne & Dokumente (PDF/Zeichnungen) – Upload aufs Projekt, Ansehen per Signed URL. */}
      <ProjectFilesSection
        projectId={project.id}
        bucket="project-plans"
        title="Pläne & Dokumente"
        accept="application/pdf,image/*"
        hint="Pläne, Skizzen oder Fotos vom Plan – am Handy fotografieren oder Datei wählen."
      />
    </div>
  );
}
