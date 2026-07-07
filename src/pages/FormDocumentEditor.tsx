// ============================================================
// B4Y SuperAPP – Formular-/Bericht-Editor
// Für generische Dokumentarten mit document_structure = 'form'.
// Strukturierte Felder (Überschrift/Text/Mehrzeilig/Datum) werden als JSON in
// `documents.body_html` gespeichert (keine eigene Spalte nötig). Für das PDF
// werden die Felder zur Druckzeit in HTML gerendert und über die zentrale
// Text-Render-/Druck-Engine ausgegeben (Empfänger/Logo/Fußzeile zentral).
// ============================================================
import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, FileDown, Save, CheckCircle2, Plus, Trash2, ArrowUp, ArrowDown } from "lucide-react";
import { supabase } from "../lib/supabase";
import { Spinner, Badge } from "../components/ui";
import { ErrorBanner } from "../components/calc-ui";
import { useUnsavedChanges, useUnsavedGuard } from "../lib/unsaved-changes";
import { Contact, Project } from "../lib/types";
import { contactDisplayName, contactRecipientLines } from "../lib/contact-name";
import { buildDocPlaceholders, resolveBodyHtml } from "../lib/document-placeholders";
import { loadCompanySettings, CompanySettings } from "../lib/company";
import { useAuth } from "../lib/auth";
import { dateAt } from "../lib/format";
import {
  DocumentRow,
  DocumentType,
  loadDocument,
  saveTextDocument,
  parseFormData,
  FormField,
  FormFieldType,
  DOC_STATUS_LABEL,
  DOC_STATUS_TONE,
  isFormDocumentType,
} from "../lib/documents";
import { printTextDocument, renderTextDocumentHtml } from "../components/document/printDocument";
import ProjectContextChips from "../components/project/ProjectContextChips";

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Rendert die Formularfelder zu HTML für die PDF-Ausgabe (Überschrift / Label: Wert). */
function renderFormFieldsHtml(fields: FormField[]): string {
  return fields
    .map((f) => {
      const label = escapeHtml((f.label ?? "").trim());
      if (f.type === "heading") {
        return label ? `<h3 style="margin:16px 0 6px;font-size:13px;font-weight:700;">${label}</h3>` : "";
      }
      const val = escapeHtml(f.value ?? "").replace(/\n/g, "<br/>");
      if (!label && !val) return "";
      return `<div style="margin:5px 0;"><strong>${label}${label ? ":" : ""}</strong> ${val}</div>`;
    })
    .filter(Boolean)
    .join("\n");
}

const FIELD_TYPES: { value: FormFieldType; label: string }[] = [
  { value: "text", label: "Textfeld" },
  { value: "textarea", label: "Mehrzeilig" },
  { value: "date", label: "Datum" },
  { value: "heading", label: "Überschrift / Abschnitt" },
];

export default function FormDocumentEditor() {
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
    title: "",
    subject: "",
    contact_id: "",
    doc_date: "",
    status: "entwurf",
  });
  const [fields, setFields] = useState<FormField[]>([]);
  const setF = (k: keyof typeof head, v: string) => {
    setHead((p) => ({ ...p, [k]: v }));
    setDirty(true);
  };

  useUnsavedChanges("form-document-editor", dirty && head.status !== "abgeschlossen", () => save());
  const guard = useUnsavedGuard();

  async function load() {
    if (!id) return;
    setLoading(true);
    setErr(null);
    const d = await loadDocument(id);
    if (!d) {
      setErr("Dokument nicht gefunden.");
      setLoading(false);
      return;
    }
    setDoc(d);
    setHead({
      title: d.title ?? "",
      subject: d.subject ?? "",
      contact_id: d.customer_id ?? "",
      doc_date: d.doc_date ?? new Date().toISOString().slice(0, 10),
      status: d.status ?? "entwurf",
    });
    setFields(parseFormData(d.body_html).fields);
    const [dt, cs, co] = await Promise.all([
      d.document_type_id
        ? supabase.from("document_types").select("*").eq("id", d.document_type_id).maybeSingle()
        : Promise.resolve({ data: null }),
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
  // load bewusst nicht in den Deps: Neuladen nur bei Dokumentwechsel.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [id]);

  const customer = useMemo(
    () => contacts.find((c) => c.id === head.contact_id) ?? null,
    [contacts, head.contact_id]
  );
  // Kunde des PROJEKTS (für den Projektkontext im Kopf – wie in der Projektakte).
  const projectCustomer = useMemo(
    () => contacts.find((c) => c.id === project?.contact_id) ?? null,
    [contacts, project]
  );
  const isLocked = head.status === "abgeschlossen";

  // Feld-Operationen (nur wenn nicht abgeschlossen).
  const addField = (type: FormFieldType) => {
    setFields((p) => [...p, { id: uid(), label: "", type, value: "" }]);
    setDirty(true);
  };
  const patchField = (fid: string, patch: Partial<FormField>) => {
    setFields((p) => p.map((f) => (f.id === fid ? { ...f, ...patch } : f)));
    setDirty(true);
  };
  const removeField = (fid: string) => {
    setFields((p) => p.filter((f) => f.id !== fid));
    setDirty(true);
  };
  const moveField = (idx: number, dir: -1 | 1) => {
    setFields((p) => {
      const next = [...p];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return p;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
    setDirty(true);
  };

  function buildMeta() {
    const docLabel = docType?.name || "Dokument";
    const ph = buildDocPlaceholders({
      customer,
      project,
      docNumber: doc?.document_number,
      docDate: head.doc_date,
      docLabel,
      company,
      bearbeiter: profile?.name ?? "",
    });
    // Felder → HTML → Platzhalter auflösen (gleiche Platzhalter wie Textdokumente).
    const bodyHtml = resolveBodyHtml(renderFormFieldsHtml(fields), ph);
    return {
      docLabel,
      numberLabel: docType?.name,
      number: doc?.document_number || "",
      title: head.subject || head.title,
      customer: customer ? contactDisplayName(customer, { fallback: "" }) : "",
      date: dateAt(head.doc_date),
      recipientLines: customer ? contactRecipientLines(customer) : undefined,
      projectNumber: project?.project_number ?? null,
      bodyHtml,
      createdBy: (doc as { created_by?: string | null } | null)?.created_by ?? null,
    };
  }

  async function save(nextStatus?: string): Promise<boolean> {
    if (!doc) return false;
    setSaving(true);
    setErr(null);
    const status = nextStatus ?? head.status;
    let snapshot: string | null = doc.print_html_snapshot ?? null;
    if (nextStatus === "abgeschlossen") {
      try {
        snapshot = await renderTextDocumentHtml({ ...buildMeta(), date: dateAt(head.doc_date) });
      } catch {
        /* Snapshot optional */
      }
    }
    const { error } = await saveTextDocument(doc.id, {
      title: head.title || null,
      subject: head.subject || null,
      customer_id: head.contact_id || null,
      recipient: customer ? contactDisplayName(customer, { fallback: "" }) : null,
      doc_date: head.doc_date || null,
      body_html: JSON.stringify({ fields }),
      status,
      print_html_snapshot: snapshot,
      completed_at: nextStatus === "abgeschlossen" ? new Date().toISOString() : undefined,
    });
    setSaving(false);
    if (error) {
      setErr(error);
      setHead((p) => ({ ...p, status: doc.status }));
      return false;
    }
    setDirty(false);
    setHead((p) => ({ ...p, status }));
    setDoc((d) => (d ? { ...d, status, print_html_snapshot: snapshot } : d));
    return true;
  }

  async function doPdf() {
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

  if (loading)
    return (
      <div className="glass p-6">
        <Spinner />
      </div>
    );
  if (!doc)
    return (
      <div className="p-4">
        <ErrorBanner message={err || "Dokument nicht gefunden."} />
      </div>
    );
  if (docType && !isFormDocumentType(docType)) {
    return (
      <div className="p-4">
        <ErrorBanner message="Diese Dokumentart ist kein Formular/Bericht." />
      </div>
    );
  }

  return (
    <div className="pt-1">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <button className="btn-ghost" onClick={() => guard(goBack)}>
            <ArrowLeft size={16} /> Zurück
          </button>
          {/* Ausführlicher Projektkontext – zentral, identisch zur Projektakte. */}
          <ProjectContextChips
            project={project}
            customerName={contactDisplayName(projectCustomer ?? customer, { fallback: "" })}
          />
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={DOC_STATUS_TONE[head.status] ?? "slate"}>
            {DOC_STATUS_LABEL[head.status] ?? head.status}
          </Badge>
          <span className="px-1 text-xs">
            {dirty ? (
              <span className="text-amber-500">ungespeichert</span>
            ) : (
              <span className="text-emerald-500">gespeichert</span>
            )}
          </span>
          <button className="btn-outline px-3 py-1.5 text-sm" onClick={doPdf}>
            <FileDown size={15} /> PDF
          </button>
          {!isLocked && (
            <button className="btn-primary px-3 py-1.5 text-sm" onClick={() => save()} disabled={saving}>
              <Save size={15} /> {saving ? "Speichert …" : "Speichern"}
            </button>
          )}
          {!isLocked && (
            <button
              className="btn-outline px-3 py-1.5 text-sm"
              onClick={() => save("abgeschlossen")}
              disabled={saving}
            >
              <CheckCircle2 size={15} /> Abschließen
            </button>
          )}
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
          <div>
            <label className="label">Betreff / Titel</label>
            <input
              className="input"
              value={head.subject}
              disabled={isLocked}
              placeholder="z. B. Abnahmeprotokoll"
              onChange={(e) => setF("subject", e.target.value)}
            />
          </div>
          <div>
            <label className="label">Datum</label>
            <input
              type="date"
              className="input"
              value={head.doc_date}
              disabled={isLocked}
              onChange={(e) => setF("doc_date", e.target.value)}
            />
          </div>
          <div>
            <label className="label">Empfänger (Kontakt)</label>
            <select
              className="input"
              value={head.contact_id}
              disabled={isLocked}
              onChange={(e) => setF("contact_id", e.target.value)}
            >
              <option value="">– kein Empfänger –</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.contact_number ? `${c.contact_number} · ` : ""}
                  {contactDisplayName(c, { fallback: "–" })}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Interner Titel</label>
            <input
              className="input"
              value={head.title}
              disabled={isLocked}
              placeholder="Ablage-/Listentitel"
              onChange={(e) => setF("title", e.target.value)}
            />
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="label mb-0">Felder</label>
            {!isLocked && (
              <div className="flex flex-wrap gap-1">
                {FIELD_TYPES.map((t) => (
                  <button
                    key={t.value}
                    className="btn-outline px-2 py-1 text-xs"
                    onClick={() => addField(t.value)}
                  >
                    <Plus size={13} /> {t.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {fields.length === 0 ? (
            <div
              className="rounded-xl border border-dashed p-6 text-center text-sm text-slate-400"
              style={{ borderColor: "var(--border)" }}
            >
              Noch keine Felder. Oben ein Feld (Textfeld, Mehrzeilig, Datum) oder eine Überschrift hinzufügen.
            </div>
          ) : (
            <div className="space-y-2">
              {fields.map((f, idx) => (
                <div key={f.id} className="rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
                  <div className="mb-2 flex items-center gap-2">
                    <span
                      className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
                      style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
                    >
                      {FIELD_TYPES.find((t) => t.value === f.type)?.label ?? f.type}
                    </span>
                    <input
                      className="input flex-1"
                      value={f.label}
                      disabled={isLocked}
                      placeholder={
                        f.type === "heading"
                          ? "Abschnittsüberschrift"
                          : "Bezeichnung (z. B. Ort, Teilnehmer …)"
                      }
                      onChange={(e) => patchField(f.id, { label: e.target.value })}
                    />
                    {!isLocked && (
                      <div className="flex shrink-0 items-center gap-0.5">
                        <button
                          className="btn-ghost px-1.5"
                          title="Nach oben"
                          disabled={idx === 0}
                          onClick={() => moveField(idx, -1)}
                        >
                          <ArrowUp size={14} />
                        </button>
                        <button
                          className="btn-ghost px-1.5"
                          title="Nach unten"
                          disabled={idx === fields.length - 1}
                          onClick={() => moveField(idx, 1)}
                        >
                          <ArrowDown size={14} />
                        </button>
                        <button
                          className="btn-ghost px-1.5 text-rose-500"
                          title="Feld entfernen"
                          onClick={() => removeField(f.id)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                  {f.type !== "heading" &&
                    (f.type === "textarea" ? (
                      <textarea
                        className="input min-h-[80px]"
                        value={f.value}
                        disabled={isLocked}
                        placeholder="Inhalt … Platzhalter wie {{kunde.name}} sind möglich."
                        onChange={(e) => patchField(f.id, { value: e.target.value })}
                      />
                    ) : (
                      <input
                        type={f.type === "date" ? "date" : "text"}
                        className="input"
                        value={f.value}
                        disabled={isLocked}
                        onChange={(e) => patchField(f.id, { value: e.target.value })}
                      />
                    ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
