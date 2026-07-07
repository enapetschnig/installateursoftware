// ============================================================
// B4Y SuperAPP – Textdokument-Editor (Brief / Anschreiben)
// Für generische Dokumentarten mit document_structure = 'text'.
// Speichert in `documents` (body_html). KEINE Leistungstabelle/Summen –
// PDF über den zentralen Text-Renderweg (printTextDocument). Empfänger-
// Anschrift, Logo, Fußzeile etc. kommen zentral aus der PDF-Engine.
// ============================================================
import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, FileDown, Save, CheckCircle2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { Spinner, Badge } from "../components/ui";
import { ErrorBanner } from "../components/calc-ui";
import RichTextEditor from "../components/RichTextEditor";
import { useUnsavedChanges, useUnsavedGuard } from "../lib/unsaved-changes";
import { Contact, Project } from "../lib/types";
import { contactDisplayName, contactRecipientLines } from "../lib/contact-name";
import { buildDocPlaceholders, resolveBodyHtml } from "../lib/document-placeholders";
import { loadCompanySettings, CompanySettings } from "../lib/company";
import { useAuth } from "../lib/auth";
import { dateAt } from "../lib/format";
import { logProject } from "../lib/projectlog";
import {
  DocumentRow, DocumentType, loadDocument, saveTextDocument,
  DOC_STATUS_LABEL, DOC_STATUS_TONE, isTextDocumentType,
} from "../lib/documents";
import { printTextDocument, renderTextDocumentHtml } from "../components/document/printDocument";
import ProjectContextChips from "../components/project/ProjectContextChips";

export default function TextDocumentEditor() {
  const { id } = useParams();
  const nav = useNavigate();
  const [doc, setDoc] = useState<DocumentRow | null>(null);
  const [docType, setDocType] = useState<DocumentType | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [project, setProject] = useState<Project | null>(null);
  const [company, setCompany] = useState<CompanySettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const { profile } = useAuth();

  const [head, setHead] = useState({
    title: "", subject: "", contact_id: "", doc_date: "", body_html: "", status: "entwurf",
  });
  const setF = (k: keyof typeof head, v: string) => { setHead((p) => ({ ...p, [k]: v })); setDirty(true); };

  // Schutz vor ungespeicherten Änderungen (abgeschlossene Dokumente sind gesperrt → kein Guard nötig).
  useUnsavedChanges("text-document-editor", dirty && head.status !== "abgeschlossen", () => save());
  const guard = useUnsavedGuard(); // programmatische Navigation (Zurück-Button) absichern

  async function load() {
    if (!id) return;
    setLoading(true); setErr(null);
    const d = await loadDocument(id);
    if (!d) { setErr("Dokument nicht gefunden."); setLoading(false); return; }
    setDoc(d);
    setHead({
      title: d.title ?? "", subject: d.subject ?? "", contact_id: d.customer_id ?? "",
      doc_date: d.doc_date ?? new Date().toISOString().slice(0, 10),
      body_html: d.body_html ?? "", status: d.status ?? "entwurf",
    });
    const [dt, cs, co] = await Promise.all([
      d.document_type_id ? supabase.from("document_types").select("*").eq("id", d.document_type_id).maybeSingle() : Promise.resolve({ data: null }),
      supabase.from("contacts").select("*").order("contact_number"),
      loadCompanySettings().catch(() => null),
    ]);
    setDocType((dt.data as DocumentType) ?? null);
    setContacts((cs.data as Contact[]) ?? []);
    setCompany(co);
    if (d.project_id) {
      const { data: pr } = await supabase.from("projects").select("*").eq("id", d.project_id).maybeSingle();
      setProject((pr as Project) ?? null);
    }
    setDirty(false);
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-line */ }, [id]);

  const customer = useMemo(() => contacts.find((c) => c.id === head.contact_id) ?? null, [contacts, head.contact_id]);
  // Kunde des PROJEKTS (für den Projektkontext im Kopf – wie in der Projektakte).
  const projectCustomer = useMemo(() => contacts.find((c) => c.id === project?.contact_id) ?? null, [contacts, project]);
  const isLocked = head.status === "abgeschlossen";

  function buildMeta() {
    const docLabel = docType?.name || "Dokument";
    // Platzhalter ({{kunde.*}}, {{firma.*}}, {{dokument.*}} …) auch in Textdokumenten
    // zentral auflösen – damit Briefe/Anschreiben dieselben Platzhalter nutzen können
    // wie Angebot/Auftrag/Rechnung. Idempotent (bereits aufgelöste Texte bleiben gleich).
    const ph = buildDocPlaceholders({
      customer, project,
      docNumber: doc?.document_number, docDate: head.doc_date,
      docLabel, company, bearbeiter: profile?.name ?? "",
    });
    return {
      docLabel,
      numberLabel: docType?.name,
      number: doc?.document_number || "",
      title: head.subject || head.title,
      customer: customer ? contactDisplayName(customer, { fallback: "" }) : "",
      date: dateAt(head.doc_date),
      recipientLines: customer ? contactRecipientLines(customer) : undefined,
      projectNumber: project?.project_number ?? null,
      bodyHtml: resolveBodyHtml(head.body_html, ph),
      createdBy: (doc as { created_by?: string | null } | null)?.created_by ?? null,
    };
  }

  async function save(nextStatus?: string): Promise<boolean> {
    if (!doc) return false;
    setSaving(true); setErr(null);
    const status = nextStatus ?? head.status;
    let snapshot: string | null = doc.print_html_snapshot ?? null;
    // Beim Abschließen einen unveränderlichen Druckstand einfrieren. WICHTIG:
    // Snapshot-Datum == gespeichertes doc_date (Projektregel: finales PDF und
    // Liste zeigen dasselbe Dokumentdatum). Daher hier KEIN `new Date()`, sondern
    // exakt das Datum, das auch in doc_date persistiert wird.
    if (nextStatus === "abgeschlossen") {
      try { snapshot = await renderTextDocumentHtml({ ...buildMeta(), date: dateAt(head.doc_date) }); } catch { /* Snapshot optional */ }
    }
    const { error } = await saveTextDocument(doc.id, {
      title: head.title || null, subject: head.subject || null,
      customer_id: head.contact_id || null,
      recipient: customer ? contactDisplayName(customer, { fallback: "" }) : null,
      doc_date: head.doc_date || null, body_html: head.body_html || null,
      status, print_html_snapshot: snapshot,
      completed_at: nextStatus === "abgeschlossen" ? new Date().toISOString() : undefined,
    });
    setSaving(false);
    if (error) { setErr(error); setHead((p) => ({ ...p, status: doc.status })); return false; }
    setDirty(false);
    setHead((p) => ({ ...p, status }));
    setDoc((d) => (d ? { ...d, status, print_html_snapshot: snapshot } : d));
    if (doc.project_id && nextStatus === "abgeschlossen") {
      await logProject(doc.project_id, "dokument", `${docType?.name || "Dokument"} abgeschlossen`, undefined);
    }
    return true;
  }

  async function doPdf() {
    // Finalisiert: eingefrorenen Snapshot zeigen; sonst Live-Stand.
    if (isLocked && doc?.print_html_snapshot) {
      const { printStoredHtml } = await import("../components/document/printDocument");
      printStoredHtml(doc.print_html_snapshot);
      return;
    }
    await printTextDocument(buildMeta());
  }

  function goBack() {
    if (doc?.project_id) nav(`/projekte/${doc.project_id}`);
    else nav("/dokumente");
  }

  if (loading) return <div className="glass p-6"><Spinner /></div>;
  if (!doc) return <div className="p-4"><ErrorBanner message={err || "Dokument nicht gefunden."} /></div>;
  if (docType && !isTextDocumentType(docType)) {
    return <div className="p-4"><ErrorBanner message="Diese Dokumentart ist kein Textdokument." /></div>;
  }

  return (
    <div className="pt-1">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <button className="btn-ghost" onClick={() => guard(goBack)}><ArrowLeft size={16} /> Zurück</button>
          {/* Ausführlicher Projektkontext – zentral, identisch zur Projektakte. */}
          <ProjectContextChips
            project={project}
            customerName={contactDisplayName(projectCustomer ?? customer, { fallback: "" })}
          />
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={DOC_STATUS_TONE[head.status] ?? "slate"}>{DOC_STATUS_LABEL[head.status] ?? head.status}</Badge>
          <span className="px-1 text-xs text-emerald-500">{dirty ? <span className="text-amber-500">ungespeichert</span> : "gespeichert"}</span>
          <button className="btn-outline px-3 py-1.5 text-sm" onClick={doPdf}><FileDown size={15} /> PDF</button>
          {!isLocked && <button className="btn-primary px-3 py-1.5 text-sm" onClick={() => save()} disabled={saving}><Save size={15} /> {saving ? "Speichert …" : "Speichern"}</button>}
          {!isLocked && <button className="btn-outline px-3 py-1.5 text-sm" onClick={() => save("abgeschlossen")} disabled={saving}><CheckCircle2 size={15} /> Abschließen</button>}
        </div>
      </div>
      <ErrorBanner message={err} />

      {isLocked && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
          Dieses Dokument ist abgeschlossen. Zum Bearbeiten bitte neu erstellen.
        </div>
      )}

      <div className="glass space-y-4 p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div><label className="label">Betreff</label>
            <input className="input" value={head.subject} disabled={isLocked} placeholder="z. B. Terminbestätigung"
              onChange={(e) => setF("subject", e.target.value)} /></div>
          <div><label className="label">Datum</label>
            <input type="date" className="input" value={head.doc_date} disabled={isLocked} onChange={(e) => setF("doc_date", e.target.value)} /></div>
          <div><label className="label">Empfänger (Kontakt)</label>
            <select className="input" value={head.contact_id} disabled={isLocked} onChange={(e) => setF("contact_id", e.target.value)}>
              <option value="">– kein Empfänger –</option>
              {contacts.map((c) => <option key={c.id} value={c.id}>{c.contact_number ? `${c.contact_number} · ` : ""}{contactDisplayName(c, { fallback: "–" })}</option>)}
            </select></div>
          <div><label className="label">Interner Titel</label>
            <input className="input" value={head.title} disabled={isLocked} placeholder="Ablage-/Listentitel"
              onChange={(e) => setF("title", e.target.value)} /></div>
        </div>
        <div>
          <label className="label">Inhalt</label>
          <RichTextEditor value={head.body_html} onChange={(html) => setF("body_html", html)} minHeight={320}
            disabled={isLocked}
            placeholder="Brieftext … Platzhalter wie {{kunde.name}} sind möglich." />
        </div>
      </div>
    </div>
  );
}
