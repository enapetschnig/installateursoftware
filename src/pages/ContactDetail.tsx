import { useEffect, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Mail, Phone, MapPin, Building2, FolderKanban } from "lucide-react";
import { supabase } from "../lib/supabase";
import { Contact, Project } from "../lib/types";
import { PageHeader, Spinner, Badge, Empty } from "../components/ui";
import { contactDisplayName } from "../lib/contact-name";

export default function ContactDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const [c, setC] = useState<Contact | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("contacts").select("*").eq("id", id).maybeSingle();
      setC(data as Contact | null);
      const { data: pr } = await supabase
        .from("projects")
        .select("*")
        .eq("contact_id", id)
        .order("created_at", { ascending: false });
      setProjects((pr as Project[]) ?? []);
      setLoading(false);
    })();
  }, [id]);

  if (loading) return <Spinner />;
  if (!c) return <Empty title="Kontakt nicht gefunden" />;
  const name = contactDisplayName(c, { withSalutation: true });
  const addr = [c.street, [c.zip, c.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");

  return (
    <>
      <button onClick={() => nav(-1)} className="btn-ghost mb-4 px-2">
        <ArrowLeft size={18} /> Zurück
      </button>
      <PageHeader
        title={name}
        subtitle={c.company ?? undefined}
        action={<Badge tone="blue">{c.type}</Badge>}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="glass p-4 lg:col-span-1">
          <h3 className="mb-3 font-bold">Kontaktdaten</h3>
          <div className="space-y-3 text-sm">
            {c.company && (
              <div className="flex items-center gap-2">
                <Building2 size={16} className="text-slate-400" /> {c.company}
              </div>
            )}
            {c.customer_number && (
              <div className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
                <span className="text-slate-400">Kundennr.</span> {c.customer_number}
              </div>
            )}
            {c.email && (
              <a className="flex items-center gap-2 hover:text-brand-600" href={`mailto:${c.email}`}>
                <Mail size={16} className="text-slate-400" /> {c.email}
              </a>
            )}
            {c.phone && (
              <a className="flex items-center gap-2 hover:text-brand-600" href={`tel:${c.phone}`}>
                <Phone size={16} className="text-slate-400" /> {c.phone}
              </a>
            )}
            {addr && (
              <a
                className="flex items-center gap-2 hover:text-brand-600"
                target="_blank"
                href={`https://maps.google.com/?q=${encodeURIComponent(addr)}`}
              >
                <MapPin size={16} className="text-slate-400" /> {addr}
              </a>
            )}
            <div className="pt-1 text-xs text-slate-400">
              Anrede: {c.address_form === "du" ? "Du-Form" : "Sie-Form"}
            </div>
          </div>
          {c.notes && (
            <div className="mt-4 border-t border-slate-100 pt-3 text-sm text-slate-600 dark:border-white/10 dark:text-slate-300">
              {c.notes}
            </div>
          )}
        </div>
        <div className="glass p-4 lg:col-span-2">
          <h3 className="mb-3 flex items-center gap-2 font-bold">
            <FolderKanban size={18} /> Projekte ({projects.length})
          </h3>
          {projects.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-400">Keine Projekte mit diesem Kontakt.</p>
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-white/5">
              {projects.map((p) => (
                <li key={p.id} className="flex items-center justify-between py-3">
                  <Link to={`/projekte/${p.id}`} className="font-medium hover:text-brand-600">
                    {p.title}
                  </Link>
                  <Badge tone="blue">{p.stage}</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
