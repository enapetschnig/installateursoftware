// B4Y SuperAPP – Mitarbeiterverwaltung Phase A (Liste)
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Eye, Pencil, Power, Trash2 } from "lucide-react";
import { supabase } from "../lib/supabase";
import { PageHeader, Spinner, Empty, Badge, Modal } from "../components/ui";
import SignedImage from "../components/SignedImage";
import { ConfirmDialog, ErrorBanner, SearchInput } from "../components/calc-ui";
import { initials } from "../lib/format";
import { usePermissions } from "../lib/permissions";
import {
  Employee, EMPLOYEE_COLUMNS, EMPLOYMENT_TYPES, employmentLabel, fullName,
} from "../lib/employee-types";
import { SortHeader } from "../components/SortHeader";
import { useTableSort } from "../lib/useTableSort";
import { useAuth } from "../lib/auth";

const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());

export default function Employees() {
  const nav = useNavigate();
  const { isAdmin, can } = usePermissions();
  const canEdit = isAdmin || can("employees", "edit");
  const canDelete = isAdmin || can("employees", "delete");

  const [list, setList] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fFunction, setFFunction] = useState("");
  const [fType, setFType] = useState("");
  const [fWage, setFWage] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [del, setDel] = useState<Employee | null>(null);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("employees").select(EMPLOYEE_COLUMNS).order("last_name").order("first_name");
    if (error) setErr(error.message);
    setList((data as unknown as Employee[]) ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const functions = useMemo(
    () => Array.from(new Set(list.map((e) => e.position).filter(Boolean))).sort() as string[],
    [list],
  );
  const wageGroups = useMemo(
    () => Array.from(new Set(list.map((e) => e.wage_group).filter(Boolean))).sort() as string[],
    [list],
  );

  const shown = list.filter((e) => {
    if (fStatus === "active" && !e.active) return false;
    if (fStatus === "inactive" && e.active) return false;
    if (fFunction && (e.position || "") !== fFunction) return false;
    if (fType && (e.employment_type || "") !== fType) return false;
    if (fWage && (e.wage_group || "") !== fWage) return false;
    if (q.trim()) {
      const s = q.toLowerCase();
      const hit = [e.first_name, e.last_name, e.email, e.phone, e.mobile]
        .filter(Boolean).some((v) => v!.toLowerCase().includes(s));
      if (!hit) return false;
    }
    return true;
  });

  const { session } = useAuth();
  const empSort = useTableSort<Employee>(
    "employees",
    {
      firstName: { get: (e) => e.first_name, type: "text" },
      lastName: { get: (e) => e.last_name, type: "text" },
      email: { get: (e) => e.email, type: "text" },
      phone: { get: (e) => e.phone || e.mobile, type: "text" },
      position: { get: (e) => e.position, type: "text" },
      employment: { get: (e) => (e.employment_type ? employmentLabel(e.employment_type) : null), type: "text" },
      wage: { get: (e) => e.wage_group, type: "text" },
      status: { get: (e) => (e.active ? 0 : 1), type: "number" },
    },
    { userId: session?.user?.id ?? null, default: { key: "lastName", dir: "asc" } }
  );
  const shownSorted = empSort.sortRows(shown);

  async function toggleActive(e: Employee) {
    if (!canEdit) return;
    const { error } = await supabase.from("employees").update({ active: !e.active }).eq("id", e.id);
    if (error) setErr(error.message); else load();
  }
  async function confirmDelete() {
    if (!del) return;
    setBusy(true); setErr(null);
    const { error } = await supabase.from("employees").delete().eq("id", del.id);
    setBusy(false);
    if (error) setErr(error.message); else { setDel(null); load(); }
  }

  const resetFilters = () => { setQ(""); setFStatus(""); setFFunction(""); setFType(""); setFWage(""); };
  const hasFilter = q || fStatus || fFunction || fType || fWage;

  return (
    <>
      <PageHeader
        title="Mitarbeiter"
        subtitle={`${list.length} Mitarbeiter · ${list.filter((e) => e.active).length} aktiv`}
        action={canEdit ? <button className="btn-primary" onClick={() => setShowNew(true)}><Plus size={18} /> Neuer Mitarbeiter</button> : undefined}
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput value={q} onChange={setQ} placeholder="Suche: Name, E-Mail, Telefon" />
        <select className="input max-w-[10rem]" value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
          <option value="">Alle Status</option>
          <option value="active">Nur aktive</option>
          <option value="inactive">Nur inaktive</option>
        </select>
        <select className="input max-w-[12rem]" value={fFunction} onChange={(e) => setFFunction(e.target.value)}>
          <option value="">Alle Funktionen</option>
          {functions.map((f) => <option key={f} value={f}>{f}</option>)}
        </select>
        <select className="input max-w-[12rem]" value={fType} onChange={(e) => setFType(e.target.value)}>
          <option value="">Alle Beschäftigungsarten</option>
          {EMPLOYMENT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <select className="input max-w-[10rem]" value={fWage} onChange={(e) => setFWage(e.target.value)}>
          <option value="">Alle Lohngruppen</option>
          {wageGroups.map((w) => <option key={w} value={w}>{w}</option>)}
        </select>
        {hasFilter && <button className="btn-ghost" onClick={resetFilters}>Filter zurücksetzen</button>}
      </div>

      <ErrorBanner message={err} />

      {loading ? <Spinner /> : list.length === 0 ? (
        <Empty title="Noch keine Mitarbeiter" hint="Lege deinen ersten Mitarbeiter an – Stammdaten, Anstellung und Lohngruppe an einem Ort." />
      ) : shown.length === 0 ? (
        <Empty title="Keine Treffer" hint="Suche oder Filter anpassen." />
      ) : (
        <div className="glass overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5">
              <tr>
                <th className="px-4 py-3 w-12"></th>
                <SortHeader label="Vorname" sortKey="firstName" sort={empSort.sort} onSort={empSort.onSort} />
                <SortHeader label="Nachname" sortKey="lastName" sort={empSort.sort} onSort={empSort.onSort} />
                <SortHeader label="E-Mail" sortKey="email" sort={empSort.sort} onSort={empSort.onSort} />
                <SortHeader label="Telefon" sortKey="phone" sort={empSort.sort} onSort={empSort.onSort} />
                <SortHeader label="Funktion" sortKey="position" sort={empSort.sort} onSort={empSort.onSort} />
                <SortHeader label="Beschäftigung" sortKey="employment" sort={empSort.sort} onSort={empSort.onSort} />
                <SortHeader label="Lohngruppe" sortKey="wage" sort={empSort.sort} onSort={empSort.onSort} />
                <SortHeader label="Status" sortKey="status" sort={empSort.sort} onSort={empSort.onSort} />
                <th className="px-4 py-3 text-right">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {shownSorted.map((e) => (
                <tr key={e.id} className="cursor-pointer hover:bg-slate-50 dark:hover:bg-white/5" onClick={() => nav(`/mitarbeiter/${e.id}`)}>
                  <td className="px-4 py-3">
                    {e.photo_url ? (
                      <SignedImage bucket="project-files" value={e.photo_url} alt="" className="h-9 w-9 rounded-full object-cover" />
                    ) : (
                      <span className="grid h-9 w-9 place-items-center rounded-full text-xs font-bold text-white"
                        style={{ background: "linear-gradient(135deg,var(--accent),var(--accent2))" }}>
                        {initials(`${e.first_name} ${e.last_name}`)}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 font-medium">{e.first_name}</td>
                  <td className="px-4 py-3 font-medium">{e.last_name}</td>
                  <td className="px-4 py-3 text-slate-500">{e.email || "–"}</td>
                  <td className="px-4 py-3 text-slate-500">{e.phone || e.mobile || "–"}</td>
                  <td className="px-4 py-3 text-slate-500">{e.position || "–"}</td>
                  <td className="px-4 py-3 text-slate-500">{e.employment_type ? employmentLabel(e.employment_type) : "–"}</td>
                  <td className="px-4 py-3 text-slate-500">{e.wage_group || "–"}</td>
                  <td className="px-4 py-3">{e.active ? <Badge tone="green">aktiv</Badge> : <Badge tone="slate">inaktiv</Badge>}</td>
                  <td className="px-4 py-3" onClick={(ev) => ev.stopPropagation()}>
                    <div className="flex justify-end gap-1">
                      <button className="btn-ghost px-2" title="Anzeigen" onClick={() => nav(`/mitarbeiter/${e.id}`)}><Eye size={16} /></button>
                      <button className="btn-ghost px-2" title="Bearbeiten" disabled={!canEdit} onClick={() => nav(`/mitarbeiter/${e.id}`)}><Pencil size={16} /></button>
                      <button className="btn-ghost px-2" title={e.active ? "Deaktivieren" : "Aktivieren"} disabled={!canEdit} onClick={() => toggleActive(e)}><Power size={16} /></button>
                      <button className="btn-ghost px-2 text-rose-500" title="Löschen" disabled={!canDelete} onClick={() => setDel(e)}><Trash2 size={16} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showNew && <NewEmployeeModal onClose={() => setShowNew(false)} onCreated={(id) => { setShowNew(false); nav(`/mitarbeiter/${id}`); }} />}
      <ConfirmDialog
        open={!!del}
        title="Mitarbeiter löschen?"
        message={<>Soll <b>{del ? fullName(del) : ""}</b> dauerhaft gelöscht werden? Das ist nur sinnvoll, solange keine Zeiten, Dokumente oder Abwesenheiten hinterlegt sind.</>}
        busy={busy} onConfirm={confirmDelete} onClose={() => setDel(null)}
      />
    </>
  );
}

// ---------- Schnell-Anlage (Pflichtfelder), danach Detailseite ----------
function NewEmployeeModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [f, setF] = useState({ first_name: "", last_name: "", email: "" });
  const [invite, setInvite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  async function save() {
    setErr(null); setInfo(null);
    if (!f.first_name.trim()) { setErr("Bitte Vorname eingeben."); return; }
    if (!f.last_name.trim()) { setErr("Bitte Nachname eingeben."); return; }
    if (!f.email.trim() || !isEmail(f.email)) { setErr("Bitte gültige E-Mail-Adresse eingeben."); return; }
    setBusy(true);
    const { data, error } = await supabase.from("employees")
      .insert({ first_name: f.first_name.trim(), last_name: f.last_name.trim(), email: f.email.trim() })
      .select("id").single();
    if (error || !data) { setBusy(false); setErr(error?.message ?? "Fehler beim Anlegen."); return; }
    // Optional: sicheren App-Zugang per Einladungs-Link (kein Klartext-Passwort) versenden.
    if (invite) {
      const { data: res, error: invErr } = await supabase.functions.invoke("invite-employee", {
        body: { employeeId: data.id, email: f.email.trim() },
      });
      if (invErr || (res as any)?.error) {
        setBusy(false);
        setErr(`Mitarbeiter angelegt, aber Einladung fehlgeschlagen: ${(res as any)?.message || invErr?.message || "unbekannt"}. Du kannst die Einladung später auf der Detailseite erneut senden.`);
        return;
      }
    }
    setBusy(false);
    onCreated(data.id);
  }

  return (
    <Modal open onClose={onClose} title="Neuer Mitarbeiter">
      <ErrorBanner message={err} />
      {info && <div className="mb-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">{info}</div>}
      <p className="mb-3 text-sm text-slate-500 dark:text-slate-400">
        Nur die Pflichtfelder – alle weiteren Daten füllst du danach auf der Detailseite.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div><label className="label label-req">Vorname</label>
          <input className="input" value={f.first_name} onChange={(e) => set("first_name", e.target.value)} autoFocus /></div>
        <div><label className="label label-req">Nachname</label>
          <input className="input" value={f.last_name} onChange={(e) => set("last_name", e.target.value)} /></div>
        <div className="sm:col-span-2"><label className="label label-req">E-Mail</label>
          <input type="email" className="input" value={f.email} onChange={(e) => set("email", e.target.value)} /></div>
      </div>
      <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5 h-4 w-4" checked={invite} onChange={(e) => setInvite(e.target.checked)} />
        <span>App-Zugang einladen – sendet einen sicheren Einladungs-/Passwort-Link per E-Mail (kein Klartext-Passwort). Rolle/Rechte werden danach auf der Detailseite vergeben (nicht automatisch Admin).</span>
      </label>
      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-outline" onClick={onClose}>Abbrechen</button>
        <button className="btn-primary" disabled={busy} onClick={save}>{busy ? "Anlegen …" : (invite ? "Anlegen & einladen" : "Anlegen & öffnen")}</button>
      </div>
    </Modal>
  );
}
