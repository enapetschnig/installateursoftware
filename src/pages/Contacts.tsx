import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  Plus,
  Pencil,
  Info,
  MapPin,
  Users,
  CreditCard,
  UserPlus,
  ToggleLeft,
  ToggleRight,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import {
  Contact,
  ContactPerson,
  ContactType,
  CustomerType,
  ContactStatus,
  CONTACT_TYPES,
  CUSTOMER_TYPES,
  TITLE_SUGGESTIONS,
  NumberRange,
  numberPreview,
} from "../lib/types";
import { PageHeader, Spinner, Empty, Badge, Modal, TableCell } from "../components/ui";
import { Toggle, ErrorBanner, SearchInput } from "../components/calc-ui";
import AddressAutocomplete from "../components/AddressAutocomplete";
import { SortHeader } from "../components/SortHeader";
import { useTableSort } from "../lib/useTableSort";
import { useAuth } from "../lib/auth";
import { dateAt } from "../lib/format";
import { contactDisplayName, getSalutationOptions } from "../lib/contact-name";
import { germanError } from "../lib/error-messages";
import { normalizeUid, isValidUid, uidSuffix, applyUidInput } from "../lib/uid";

const TYPE_TONE: Record<string, any> = {
  kunde: "blue",
  lieferant: "amber",
  subunternehmer: "green",
  sonstige: "slate",
};
const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`;
const typeLabel = (t: ContactType) => CONTACT_TYPES.find((x) => x.value === t)?.label ?? t;
const custLabel = (t: CustomerType) => CUSTOMER_TYPES.find((x) => x.value === t)?.label ?? t;
// Kontaktarten mit eigenem Nummernkreis (doc_type entspricht der Kontaktart).
const CONTACT_DOC_TYPES = ["kunde", "lieferant", "subunternehmer", "sonstige"];

const displayName = (c: Contact): string => contactDisplayName(c);
// Kontaktart ist der Hauptfilter (Tabs). "alle" = alle Arten, "ansprechpersonen" = eigene Personen-Liste.
type Folder = ContactType | "alle" | "ansprechpersonen";
const personFullName = (p: { first_name: string | null; last_name: string | null }) =>
  [p.first_name, p.last_name].filter(Boolean).join(" ");

export default function Contacts() {
  const { session } = useAuth();
  const userId = session?.user?.id ?? null;
  const [list, setList] = useState<Contact[]>([]);
  const [persons, setPersons] = useState<ContactPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [folder, setFolder] = useState<Folder>("alle");
  const [fStatus, setFStatus] = useState("");
  const [edit, setEdit] = useState<Contact | "new" | null>(null);
  const [openOnPersons, setOpenOnPersons] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const [c, p] = await Promise.all([
      supabase.from("contacts").select("*").order("contact_number"),
      supabase.from("contact_persons").select("*"),
    ]);
    if (c.error) {
      console.error("Kontakte laden:", c.error);
      setErr(germanError(c.error, "Kontakte konnten nicht geladen werden."));
    }
    setList((c.data as Contact[]) ?? []);
    setPersons((p.data as ContactPerson[]) ?? []);
    setLoading(false);
  }
  useEffect(() => {
    load();
  }, []);

  const personsByContact = useMemo(() => {
    const m: Record<string, ContactPerson[]> = {};
    for (const p of persons) (m[p.contact_id] ||= []).push(p);
    return m;
  }, [persons]);

  const contactById = useMemo(() => {
    const m: Record<string, Contact> = {};
    for (const c of list) m[c.id] = c;
    return m;
  }, [list]);

  // ---- Kontaktliste (alle Arten außer Personen-Ansicht) ----
  const shown = useMemo(
    () =>
      list.filter((c) => {
        if (folder !== "alle" && folder !== "ansprechpersonen" && c.type !== folder) return false;
        if (fStatus && c.status !== fStatus) return false;
        if (q.trim()) {
          const s = q.toLowerCase();
          const ap = (personsByContact[c.id] ?? []).flatMap((p) => [
            p.first_name,
            p.last_name,
            p.email,
            p.phone,
            p.mobile,
          ]);
          const hit = [
            c.contact_number,
            c.customer_number,
            c.company,
            c.first_name,
            c.last_name,
            c.email,
            c.invoice_email,
            c.phone,
            c.mobile,
            c.city,
            c.street,
            c.recipient_extra_line1,
            c.recipient_extra_line2,
            ...ap,
          ]
            .filter(Boolean)
            .some((v) => v!.toLowerCase().includes(s));
          if (!hit) return false;
        }
        return true;
      }),
    [list, folder, fStatus, q, personsByContact]
  );

  // ---- Ansprechpersonen-Ansicht (eigene Tabelle contact_persons) ----
  type PersonRow = ContactPerson & { _contactName: string };
  const personRows = useMemo<PersonRow[]>(() => {
    const s = q.trim().toLowerCase();
    return persons
      .map((p) => ({
        ...p,
        _contactName: contactById[p.contact_id] ? displayName(contactById[p.contact_id]) : "",
      }))
      .filter((p) => {
        // Statusfilter in der Ansprechpersonen-Ansicht wirkt auf das active-Flag der Person
        // (passend zur angezeigten Status-Spalte), nicht auf den Status des Hauptkontakts.
        if (fStatus && (fStatus === "aktiv") !== !!p.active) return false;
        if (!s) return true;
        return [p.first_name, p.last_name, p.function, p.email, p.phone, p.mobile, p._contactName]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(s));
      });
  }, [persons, contactById, q, fStatus]);

  const personSort = useTableSort<PersonRow>(
    "contact_persons",
    {
      name: { get: (p) => personFullName(p), type: "text" },
      function: { get: (p) => p.function, type: "text" },
      contact: { get: (p) => p._contactName, type: "text" },
      email: { get: (p) => p.email, type: "text" },
      mobile: { get: (p) => p.mobile, type: "text" },
      phone: { get: (p) => p.phone, type: "text" },
    },
    { userId, default: { key: "name", dir: "asc" } }
  );
  const personRowsSorted = useMemo(() => personSort.sortRows(personRows), [personSort, personRows]);

  // ---- Gemischte Hauptliste: Hauptkontakte + (in „Alle") Ansprechpersonen als eigene Zeilen ----
  // Ansprechpersonen bleiben fachlich KEINE eigenen Kontakte: Klick öffnet den Elternkontakt
  // direkt im Reiter „Ansprechpartner". Suche/Status/Sortierung/Zähler arbeiten über beide Arten.
  type Row = { kind: "contact"; c: Contact } | { kind: "person"; p: PersonRow };
  const tableRows = useMemo<Row[]>(() => {
    const cs: Row[] = shown.map((c) => ({ kind: "contact", c }));
    if (folder !== "alle") return cs;
    const ps: Row[] = personRows.map((p) => ({ kind: "person", p }));
    return [...cs, ...ps];
  }, [shown, personRows, folder]);

  const rowSort = useTableSort<Row>(
    "contacts",
    {
      contact_number: {
        get: (r) => (r.kind === "contact" ? r.c.contact_number : r.p.contact_number),
        type: "text",
      },
      type: { get: (r) => (r.kind === "contact" ? typeLabel(r.c.type) : "Ansprechpartner"), type: "text" },
      customer_type: {
        get: (r) =>
          r.kind === "contact"
            ? custLabel(r.c.customer_type)
            : contactById[r.p.contact_id]?.customer_type
              ? custLabel(contactById[r.p.contact_id].customer_type)
              : "",
        type: "text",
      },
      name: { get: (r) => (r.kind === "contact" ? displayName(r.c) : personFullName(r.p)), type: "text" },
      email: { get: (r) => (r.kind === "contact" ? r.c.email : r.p.email), type: "text" },
      invoice_email: { get: (r) => (r.kind === "contact" ? r.c.invoice_email : ""), type: "text" },
      phone: { get: (r) => (r.kind === "contact" ? r.c.phone : r.p.phone), type: "text" },
      city: {
        get: (r) => (r.kind === "contact" ? r.c.city : (contactById[r.p.contact_id]?.city ?? "")),
        type: "text",
      },
      status: {
        get: (r) => (r.kind === "contact" ? r.c.status : r.p.active ? "aktiv" : "inaktiv"),
        type: "text",
      },
      updated_at: {
        get: (r) =>
          r.kind === "contact" ? (r.c.updated_at ?? r.c.created_at) : (r.p.updated_at ?? r.p.created_at),
        type: "date",
      },
    },
    { userId, default: { key: "contact_number", dir: "asc" } }
  );
  const tableRowsSorted = useMemo(() => rowSort.sortRows(tableRows), [rowSort, tableRows]);

  const folders: { value: Folder; label: string; count: number }[] = [
    { value: "alle", label: "Alle", count: list.length + persons.length },
    ...CONTACT_TYPES.map((t) => ({
      value: t.value as Folder,
      label: t.label,
      count: list.filter((c) => c.type === t.value).length,
    })),
    { value: "ansprechpersonen", label: "Ansprechpersonen", count: persons.length },
  ];
  const showPersons = folder === "ansprechpersonen";
  // Neue Kontakte: sinnvolle Vorbelegung der Kontaktart (nicht „alle"/„ansprechpersonen").
  const defaultType: ContactType = folder === "alle" || folder === "ansprechpersonen" ? "kunde" : folder;

  // Kontakte werden nicht gelöscht – nur fachlich aktiviert/deaktiviert (Aktiv/Inaktiv).
  async function toggleContactStatus(c: Contact) {
    const next: ContactStatus = c.status === "aktiv" ? "inaktiv" : "aktiv";
    setBusyId(c.id);
    // Optimistisch lokal aktualisieren (sofort sichtbar, ohne Reload) + persistieren.
    setList((rows) => rows.map((x) => (x.id === c.id ? { ...x, status: next } : x)));
    const { error } = await supabase
      .from("contacts")
      .update({ status: next, updated_at: new Date().toISOString() })
      .eq("id", c.id);
    setBusyId(null);
    if (error) {
      console.error("Kontaktstatus ändern:", error);
      setErr(germanError(error, "Status konnte nicht geändert werden."));
      load();
    }
  }

  return (
    <>
      <PageHeader
        title="Kontakte"
        subtitle={`${list.length} Kontakte · Kunden, Lieferanten, Subunternehmer`}
        action={
          <button
            className="btn-primary"
            onClick={() => {
              setOpenOnPersons(false);
              setEdit("new");
            }}
          >
            <Plus size={18} /> Neuer Kontakt
          </button>
        }
      />

      <div
        className="mb-4 flex flex-wrap gap-1.5 rounded-2xl border p-1.5"
        style={{ background: "var(--card)", borderColor: "var(--border)" }}
      >
        {folders.map((t) => (
          <button
            key={t.value}
            onClick={() => setFolder(t.value)}
            className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-all ${folder === t.value ? "text-white" : "text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5"}`}
            style={
              folder === t.value
                ? { background: "linear-gradient(135deg,var(--accent),var(--accent-h))" }
                : undefined
            }
          >
            {t.label}
            <span
              className={`rounded-full px-1.5 text-[11px] ${folder === t.value ? "bg-white/20" : "bg-slate-200 dark:bg-white/10"}`}
            >
              {t.count}
            </span>
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <SearchInput
          value={q}
          onChange={setQ}
          placeholder="Suche: Nr., Name, Firma, E-Mail, Telefon, Ort, Ansprechperson"
        />
        <select
          className="input max-w-[14rem]"
          value={folder}
          onChange={(e) => setFolder(e.target.value as Folder)}
          title="Kontaktgruppe wählen"
        >
          <option value="alle">Alle Kontaktformen</option>
          {CONTACT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
          <option value="ansprechpersonen">Ansprechpersonen</option>
        </select>
        <select className="input max-w-[10rem]" value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
          <option value="">Alle Status</option>
          <option value="aktiv">Aktiv</option>
          <option value="inaktiv">Inaktiv</option>
        </select>
        {(folder !== "alle" || fStatus || q) && (
          <button
            className="btn-ghost"
            onClick={() => {
              setFolder("alle");
              setFStatus("");
              setQ("");
            }}
          >
            Filter zurücksetzen
          </button>
        )}
      </div>

      <ErrorBanner message={err} />

      {loading ? (
        <Spinner />
      ) : showPersons ? (
        persons.length === 0 ? (
          <Empty
            title="Noch keine Ansprechpersonen"
            hint="Ansprechpersonen werden im Kontakt unter dem Reiter Ansprechpartner gepflegt."
          />
        ) : personRowsSorted.length === 0 ? (
          <Empty title="Keine Ansprechpersonen gefunden" hint="Suche/Filter anpassen." />
        ) : (
          <div className="glass overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5">
                <tr>
                  <SortHeader label="Name" sortKey="name" sort={personSort.sort} onSort={personSort.onSort} />
                  <SortHeader
                    label="Funktion"
                    sortKey="function"
                    sort={personSort.sort}
                    onSort={personSort.onSort}
                  />
                  <SortHeader
                    label="Firma / Kontakt"
                    sortKey="contact"
                    sort={personSort.sort}
                    onSort={personSort.onSort}
                  />
                  <SortHeader
                    label="E-Mail"
                    sortKey="email"
                    sort={personSort.sort}
                    onSort={personSort.onSort}
                  />
                  <SortHeader
                    label="Mobil"
                    sortKey="mobile"
                    sort={personSort.sort}
                    onSort={personSort.onSort}
                  />
                  <SortHeader
                    label="Festnetz"
                    sortKey="phone"
                    sort={personSort.sort}
                    onSort={personSort.onSort}
                  />
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {personRowsSorted.map((p) => {
                  const parent = contactById[p.contact_id] ?? null;
                  return (
                    <tr
                      key={p.id}
                      className={`${parent ? "cursor-pointer hover:bg-slate-50 dark:hover:bg-white/5" : ""} ${p.active ? "" : "opacity-60"}`}
                      onClick={() => {
                        if (parent) {
                          setOpenOnPersons(true);
                          setEdit(parent);
                        }
                      }}
                    >
                      <td className="px-4 py-3 font-medium">
                        {personFullName(p) || "–"}
                        {p.title ? <span className="ml-1 text-xs text-slate-400">{p.title}</span> : null}
                      </td>
                      <td className="px-4 py-3 text-slate-500">{p.function ?? "–"}</td>
                      <td className="px-4 py-3 text-slate-500">{p._contactName || "–"}</td>
                      <td className="px-4 py-3 text-slate-500">{p.email ?? "–"}</td>
                      <td className="px-4 py-3 text-slate-500">{p.mobile ?? "–"}</td>
                      <td className="px-4 py-3 text-slate-500">{p.phone ?? "–"}</td>
                      <td className="px-4 py-3">
                        {p.active ? <Badge tone="green">aktiv</Badge> : <Badge tone="slate">inaktiv</Badge>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )
      ) : list.length === 0 ? (
        <Empty title="Noch keine Kontakte" hint="Lege Kunden, Lieferanten oder Subunternehmer an." />
      ) : tableRowsSorted.length === 0 ? (
        <Empty
          title="Keine Kontakte in diesem Ordner"
          hint="Suche/Filter anpassen oder neuen Kontakt anlegen."
        />
      ) : (
        <div className="glass overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5">
              <tr>
                <SortHeader
                  label="Nr."
                  sortKey="contact_number"
                  sort={rowSort.sort}
                  onSort={rowSort.onSort}
                />
                <SortHeader label="Kontaktart" sortKey="type" sort={rowSort.sort} onSort={rowSort.onSort} />
                <SortHeader
                  label="Kontaktform"
                  sortKey="customer_type"
                  sort={rowSort.sort}
                  onSort={rowSort.onSort}
                />
                <SortHeader label="Name / Firma" sortKey="name" sort={rowSort.sort} onSort={rowSort.onSort} />
                <SortHeader label="E-Mail" sortKey="email" sort={rowSort.sort} onSort={rowSort.onSort} />
                <SortHeader
                  label="Rechnungs-Mail"
                  sortKey="invoice_email"
                  sort={rowSort.sort}
                  onSort={rowSort.onSort}
                />
                <SortHeader label="Festnetz" sortKey="phone" sort={rowSort.sort} onSort={rowSort.onSort} />
                <SortHeader label="Ort" sortKey="city" sort={rowSort.sort} onSort={rowSort.onSort} />
                <SortHeader label="Status" sortKey="status" sort={rowSort.sort} onSort={rowSort.onSort} />
                <SortHeader
                  label="Letzte Änderung"
                  sortKey="updated_at"
                  sort={rowSort.sort}
                  onSort={rowSort.onSort}
                />
                <th className="px-4 py-3 text-right">Aktionen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-white/5">
              {tableRowsSorted.map((r) =>
                r.kind === "contact"
                  ? (() => {
                      const c = r.c;
                      return (
                        <tr
                          key={`c-${c.id}`}
                          className="cursor-pointer hover:bg-slate-50 dark:hover:bg-white/5"
                          onClick={() => {
                            setOpenOnPersons(false);
                            setEdit(c);
                          }}
                        >
                          <td className="px-4 py-3 font-mono text-xs text-slate-400">
                            {c.contact_number ?? "–"}
                          </td>
                          <td className="px-4 py-3">
                            <Badge tone={TYPE_TONE[c.type]}>{typeLabel(c.type)}</Badge>
                          </td>
                          <td className="px-4 py-3 text-slate-500">{custLabel(c.customer_type)}</td>
                          <TableCell tdClassName="font-medium" maxW="220px">
                            {displayName(c)}
                          </TableCell>
                          <TableCell tdClassName="text-slate-500" maxW="200px">
                            {c.email ?? "–"}
                          </TableCell>
                          <TableCell tdClassName="text-slate-500" maxW="200px">
                            {c.invoice_email ?? "–"}
                          </TableCell>
                          <TableCell tdClassName="text-slate-500" maxW="150px">
                            {c.phone ?? "–"}
                          </TableCell>
                          <TableCell tdClassName="text-slate-500" maxW="140px">
                            {c.city ?? "–"}
                          </TableCell>
                          <td className="px-4 py-3">
                            {c.status === "aktiv" ? (
                              <Badge tone="green">aktiv</Badge>
                            ) : (
                              <Badge tone="slate">inaktiv</Badge>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-400">
                            {dateAt(c.updated_at ?? c.created_at)}
                          </td>
                          <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                            <div className="flex justify-end gap-1">
                              <button
                                className="btn-ghost px-2"
                                title="Bearbeiten"
                                onClick={() => {
                                  setOpenOnPersons(false);
                                  setEdit(c);
                                }}
                              >
                                <Pencil size={16} />
                              </button>
                              <button
                                className="btn-ghost px-2"
                                disabled={busyId === c.id}
                                title={c.status === "aktiv" ? "Auf inaktiv setzen" : "Auf aktiv setzen"}
                                onClick={() => toggleContactStatus(c)}
                              >
                                {c.status === "aktiv" ? (
                                  <ToggleRight size={18} className="text-emerald-500" />
                                ) : (
                                  <ToggleLeft size={18} className="text-slate-400" />
                                )}
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })()
                  : (() => {
                      const p = r.p;
                      const parent = contactById[p.contact_id] ?? null;
                      return (
                        <tr
                          key={`p-${p.id}`}
                          className={`cursor-pointer hover:bg-slate-50 dark:hover:bg-white/5 ${p.active ? "" : "opacity-60"}`}
                          onClick={() => {
                            if (parent) {
                              setOpenOnPersons(true);
                              setEdit(parent);
                            }
                          }}
                        >
                          <td className="px-4 py-3 font-mono text-xs text-slate-400">
                            {p.contact_number ?? "–"}
                          </td>
                          <td className="px-4 py-3">
                            <Badge tone="violet">Ansprechpartner</Badge>
                          </td>
                          <td className="px-4 py-3 text-slate-500">
                            {parent && parent.customer_type ? custLabel(parent.customer_type) : "–"}
                          </td>
                          <TableCell
                            tdClassName="font-medium"
                            maxW="220px"
                            title={`${personFullName(p)}${p._contactName ? " · " + p._contactName : ""}`}
                          >
                            {personFullName(p) || "–"}
                            {p._contactName ? (
                              <span className="ml-1 text-xs font-normal text-slate-400">
                                · {p._contactName}
                              </span>
                            ) : null}
                          </TableCell>
                          <TableCell tdClassName="text-slate-500" maxW="200px">
                            {p.email ?? "–"}
                          </TableCell>
                          <td className="px-4 py-3 text-slate-500">–</td>
                          <TableCell tdClassName="text-slate-500" maxW="150px">
                            {p.phone ?? p.mobile ?? "–"}
                          </TableCell>
                          <TableCell tdClassName="text-slate-500" maxW="140px">
                            {parent?.city ?? "–"}
                          </TableCell>
                          <td className="px-4 py-3">
                            {p.active ? (
                              <Badge tone="green">aktiv</Badge>
                            ) : (
                              <Badge tone="slate">inaktiv</Badge>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-400">
                            {dateAt(p.updated_at ?? p.created_at)}
                          </td>
                          <td className="px-4 py-3 text-right text-xs text-slate-400">im Kontakt</td>
                        </tr>
                      );
                    })()
              )}
            </tbody>
          </table>
        </div>
      )}

      {edit && (
        <ContactForm
          contact={edit === "new" ? null : edit}
          defaultType={defaultType}
          initialTab={openOnPersons ? "personen" : "stamm"}
          existingNumbers={list.map((c) => c.contact_number).filter(Boolean) as string[]}
          onClose={() => {
            setOpenOnPersons(false);
            setEdit(null);
          }}
          onSaved={(savedType) => {
            setOpenOnPersons(false);
            setEdit(null);
            // Auf die Kontaktart-Lade des gespeicherten Kontakts wechseln UND aktive Filter
            // (Suche/Status) zurücksetzen, damit der gespeicherte Kontakt sofort sichtbar ist
            // (verhindert „stale" Liste durch verbleibende Filter); danach Refetch.
            setFolder(CONTACT_TYPES.some((t) => t.value === savedType) ? savedType : "alle");
            setQ("");
            setFStatus("");
            load();
          }}
        />
      )}
    </>
  );
}

type Tab = "stamm" | "adresse" | "personen" | "zahlung";
type EditPerson = Omit<ContactPerson, "contact_id" | "created_at" | "updated_at">;

function ContactForm({
  contact,
  defaultType,
  initialTab = "stamm",
  existingNumbers,
  onClose,
  onSaved,
}: {
  contact: Contact | null;
  defaultType: ContactType;
  initialTab?: Tab;
  existingNumbers: string[];
  onClose: () => void;
  onSaved: (savedType: ContactType) => void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [f, setF] = useState({
    contact_number: contact?.contact_number ?? "",
    customer_number: (contact as Contact | null)?.customer_number ?? "",
    type: (contact?.type ?? defaultType) as ContactType,
    customer_type: (contact?.customer_type ??
      (defaultType === "lieferant" || defaultType === "subunternehmer" ? "firma" : "privat")) as CustomerType,
    status: (contact?.status ?? "aktiv") as ContactStatus,
    salutation: contact?.salutation ?? "",
    title: contact?.title ?? "",
    first_name: contact?.first_name ?? "",
    last_name: contact?.last_name ?? "",
    company: contact?.company ?? "",
    uid_number: contact?.uid_number ?? "",
    email: contact?.email ?? "",
    invoice_email: contact?.invoice_email ?? "",
    phone: contact?.phone ?? "",
    mobile: contact?.mobile ?? "",
    website: contact?.website ?? "",
    street: contact?.street ?? "",
    address_extra: contact?.address_extra ?? "",
    recipient_extra_line1: contact?.recipient_extra_line1 ?? "",
    recipient_extra_line2: contact?.recipient_extra_line2 ?? "",
    zip: contact?.zip ?? "",
    city: contact?.city ?? "",
    country: contact?.country ?? "Österreich",
    notes: contact?.notes ?? "",
    payment_term_days: (contact?.payment_term_days ?? 14) as number | "",
    skonto_percent: (contact?.skonto_percent ?? "") as number | "",
    skonto_days: (contact?.skonto_days ?? "") as number | "",
    default_discount_percent: (contact?.default_discount_percent ?? "") as number | "",
    default_surcharge_percent: (contact?.default_surcharge_percent ?? "") as number | "",
    is_invoice_recipient: contact?.is_invoice_recipient ?? false,
    auto_accept_supplements: contact?.auto_accept_supplements ?? false,
    payment_method: contact?.payment_method ?? "",
    payment_note: contact?.payment_note ?? "",
    in_payment_term_days: (contact?.in_payment_term_days ?? "") as number | "",
    in_skonto_percent: (contact?.in_skonto_percent ?? "") as number | "",
    in_skonto_days: (contact?.in_skonto_days ?? "") as number | "",
    in_discount_percent: (contact?.in_discount_percent ?? "") as number | "",
    in_payment_note: contact?.in_payment_note ?? "",
  });
  const [persons, setPersons] = useState<EditPerson[]>([]);
  const [editingPersonId, setEditingPersonId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: keyof typeof f, v: any) => setF((p) => ({ ...p, [k]: v }));
  const [uidError, setUidError] = useState<string | null>(null);

  useEffect(() => {
    if (!contact) {
      setPersons([]);
      return;
    }
    supabase
      .from("contact_persons")
      .select("*")
      .eq("contact_id", contact.id)
      .order("sort_order")
      .then(({ data }) =>
        setPersons(
          ((data as ContactPerson[]) ?? []).map((p) => ({
            id: p.id,
            contact_number: p.contact_number ?? null,
            salutation: p.salutation,
            title: p.title,
            first_name: p.first_name,
            last_name: p.last_name,
            function: p.function,
            email: p.email,
            phone: p.phone,
            mobile: p.mobile,
            note: p.note,
            sort_order: p.sort_order,
            active: p.active ?? true,
          }))
        )
      );
  }, [contact]);

  // Konditions-Sichtbarkeit je Kontaktart: Kunde → Ausgang; Lieferant/Sub → Eingang;
  // Partner/Sonstige → beide (Rolle offen). Mehrrollen werden über die jeweiligen Blöcke abgebildet.
  const showOut = f.type === "kunde" || f.type === "sonstige";
  const showIn = f.type === "lieferant" || f.type === "subunternehmer" || f.type === "sonstige";

  // Standardwerte NUR beim Neuanlegen, je Kontaktart. Bestehende Werte werden nie überschrieben.
  const lastDefaultType = useRef<ContactType | null>(null);
  useEffect(() => {
    if (contact) return; // bestehende Kontakte nie ungefragt überschreiben
    if (lastDefaultType.current === f.type) return;
    lastDefaultType.current = f.type;
    setF((p) => {
      if (f.type === "kunde") {
        return {
          ...p,
          payment_term_days: 14,
          skonto_percent: 0,
          skonto_days: 0,
          default_discount_percent: 0,
          default_surcharge_percent: 0,
          is_invoice_recipient: true,
          in_payment_term_days: "",
          in_skonto_percent: "",
          in_skonto_days: "",
          in_discount_percent: "",
        };
      }
      if (f.type === "lieferant" || f.type === "subunternehmer") {
        return {
          ...p,
          in_payment_term_days: 21,
          in_skonto_percent: 3,
          in_skonto_days: 21,
          in_discount_percent: 5,
          payment_term_days: "",
          skonto_percent: "",
          skonto_days: "",
          default_discount_percent: "",
          is_invoice_recipient: false,
        };
      }
      return p; // partner/sonstige: keine starken Defaults
    });
  }, [f.type, contact]);

  const [ranges, setRanges] = useState<NumberRange[]>([]);
  const [numTouched, setNumTouched] = useState(false);
  const [reassignNumber, setReassignNumber] = useState(true);

  useEffect(() => {
    supabase
      .from("number_ranges")
      .select("*")
      .in("doc_type", CONTACT_DOC_TYPES)
      .then(({ data }) => setRanges((data as NumberRange[]) ?? []));
  }, []);

  // Genau die Zeile lesen, die next_document_number() beim Speichern hochzählt: aktive Zeile
  // der Kontaktart (RLS scoped die Org). So entspricht die Vorschau den Einstellungen >
  // Nummernkreisen (gleiche zentrale Quelle number_ranges.next_number + numberPreview()).
  const activeRange =
    ranges.find((r) => r.doc_type === f.type && r.active) ??
    ranges.find((r) => r.doc_type === f.type) ??
    null;
  const autoNum = activeRange ? numberPreview(activeRange) : "";
  const rangeLabel = activeRange?.label || typeLabel(f.type);
  const typeChanged = !!contact && f.type !== contact.type;

  // Neuer Kontakt: Nummernvorschau der gewählten Art übernehmen, solange nicht manuell geändert.
  useEffect(() => {
    if (contact || numTouched || !autoNum) return;
    setF((p) => ({ ...p, contact_number: autoNum }));
  }, [autoNum, contact, numTouched]);

  const isFirma = f.customer_type === "firma";
  const numOrNull = (v: number | "") => (v === "" || Number.isNaN(Number(v)) ? null : Number(v));

  const addPerson = () => {
    const id = uid();
    setPersons((ps) => [
      ...ps,
      {
        id,
        contact_number: null,
        salutation: "",
        title: "",
        first_name: "",
        last_name: "",
        function: "",
        email: "",
        phone: "",
        mobile: "",
        note: "",
        sort_order: ps.length,
        active: true,
      },
    ]);
    setEditingPersonId(id);
  };
  const patchPerson = (id: string, p: Partial<EditPerson>) =>
    setPersons((ps) => ps.map((x) => (x.id === id ? { ...x, ...p } : x)));

  // Übersetzt technische DB-/Supabase-Fehler beim Speichern in verständliche Meldungen
  // (eine Quelle für Insert UND Update – keine doppelte Fehlerlogik). Kontaktspezifische
  // Fälle bleiben hier; alles Übrige geht über den zentralen germanError()-Mapper.
  const friendlySaveError = (error: { message?: string; code?: string } | string | null | undefined): string => {
    const m = typeof error === "string" ? error : error?.message || "";
    if (/duplicate|unique/i.test(m))
      return `Die Kontaktnummer ${f.contact_number.trim()} ist bereits vergeben.`;
    if (/contacts_type_check/i.test(m))
      return "Diese Kontaktart kann derzeit nicht gespeichert werden. Bitte den Administrator kontaktieren.";
    return germanError(error, "Kontakt konnte nicht gespeichert werden.");
  };

  async function save() {
    setErr(null);
    if (!f.type) {
      setErr("Bitte Kontaktart auswählen.");
      setTab("stamm");
      return;
    }
    if (!f.customer_type) {
      setErr("Bitte Kontaktform auswählen.");
      setTab("stamm");
      return;
    }
    if (!f.status) {
      setErr("Bitte Status auswählen.");
      setTab("stamm");
      return;
    }
    if (isFirma) {
      if (!f.company.trim()) {
        setErr("Bitte Firmenname eingeben.");
        setTab("stamm");
        return;
      }
      if (!f.first_name.trim()) {
        setErr("Bitte Vorname eingeben.");
        setTab("stamm");
        return;
      }
      if (!f.last_name.trim()) {
        setErr("Bitte Nachname eingeben.");
        setTab("stamm");
        return;
      }
      if (f.uid_number.trim() && !isValidUid(f.uid_number)) {
        setErr("Bitte gültige UID eingeben (z. B. ATU12345678).");
        setUidError("Bitte gültige UID eingeben (z. B. ATU12345678).");
        setTab("stamm");
        return;
      }
    } else {
      if (!f.salutation) {
        setErr("Bitte Anrede auswählen.");
        setTab("stamm");
        return;
      }
      if (!f.first_name.trim()) {
        setErr("Bitte Vorname eingeben.");
        setTab("stamm");
        return;
      }
      if (!f.last_name.trim()) {
        setErr("Bitte Nachname eingeben.");
        setTab("stamm");
        return;
      }
    }
    if (!f.email.trim()) {
      setErr("Bitte E-Mail-Adresse eingeben.");
      setTab("stamm");
      return;
    }
    if (!isEmail(f.email)) {
      setErr("Bitte gültige E-Mail-Adresse eingeben.");
      setTab("stamm");
      return;
    }
    if (f.invoice_email.trim() && !isEmail(f.invoice_email)) {
      setErr("Bitte gültige Rechnungs-Mail eingeben.");
      setTab("stamm");
      return;
    }
    if (!f.mobile.trim()) {
      setErr("Bitte Mobiltelefon eingeben.");
      setTab("stamm");
      return;
    }
    const numTrim = f.contact_number.trim();
    // Nummer atomar aus dem Kreis der Kontaktart ziehen, wenn: neuer Kontakt mit
    // Vorschlag/leer, oder bestehender Kontakt mit geänderter Art + Neuvergabe gewünscht.
    const useRange = contact ? typeChanged && reassignNumber : !numTrim || numTrim === autoNum;
    if (!useRange) {
      if (!numTrim) {
        setErr("Bitte Kontaktnummer eingeben.");
        setTab("stamm");
        return;
      }
      if (existingNumbers.some((n) => n === numTrim && n !== contact?.contact_number)) {
        setErr(`Die Kontaktnummer ${numTrim} ist bereits vergeben.`);
        setTab("stamm");
        return;
      }
    }
    if (!f.street.trim()) {
      setErr("Bitte Straße und Hausnummer eingeben.");
      setTab("adresse");
      return;
    }
    if (!f.zip.trim()) {
      setErr("Bitte PLZ eingeben.");
      setTab("adresse");
      return;
    }
    if (!f.city.trim()) {
      setErr("Bitte Ort eingeben.");
      setTab("adresse");
      return;
    }
    if (!f.country.trim()) {
      setErr("Bitte Land auswählen.");
      setTab("adresse");
      return;
    }
    const validPersons = persons.filter(
      (p) =>
        p.salutation?.trim() ||
        p.title?.trim() ||
        p.first_name?.trim() ||
        p.last_name?.trim() ||
        p.email?.trim() ||
        p.phone?.trim() ||
        p.function?.trim()
    );
    for (const p of validPersons) {
      if (!p.salutation?.trim()) {
        setErr("Bitte Anrede auswählen.");
        setTab("personen");
        return;
      }
      if (!p.first_name?.trim()) {
        setErr("Bitte Vorname eingeben.");
        setTab("personen");
        return;
      }
      if (!p.last_name?.trim()) {
        setErr("Bitte Nachname eingeben.");
        setTab("personen");
        return;
      }
      // E-Mail ist bei Ansprechpartnern NICHT mehr Pflicht. Nur falls eine eingegeben
      // wurde, wird das Format geprüft (leeres Feld ist erlaubt – DB-Spalte ist nullable).
      if (p.email?.trim() && !isEmail(p.email)) {
        setErr("Bitte gültige E-Mail-Adresse eingeben.");
        setTab("personen");
        return;
      }
    }

    setBusy(true);
    let finalNum: string | null = numTrim || null;
    if (useRange) {
      const { data: rpcNum, error: rpcErr } = await supabase.rpc("next_document_number", {
        p_doc_type: f.type,
      });
      if (rpcErr || !rpcNum) {
        if (rpcErr) console.error("next_document_number (Kontakt):", rpcErr);
        setBusy(false);
        setErr(
          rpcErr
            ? germanError(rpcErr, "Die Kontaktnummer konnte nicht vergeben werden.")
            : "Kein aktiver Nummernkreis für diese Kontaktart."
        );
        setTab("stamm");
        return;
      }
      finalNum = rpcNum as string;
    }
    const payload = {
      contact_number: finalNum,
      type: f.type,
      customer_type: f.customer_type,
      status: f.status,
      salutation: f.salutation || null,
      title: f.title || null,
      first_name: f.first_name || null,
      last_name: f.last_name || null,
      company: f.company || null,
      uid_number: normalizeUid(f.uid_number) || null,
      customer_number: f.customer_number || null,
      email: f.email || null,
      invoice_email: f.invoice_email || null,
      phone: f.phone || null,
      mobile: f.mobile || null,
      website: f.website || null,
      street: f.street || null,
      address_extra: f.address_extra || null,
      recipient_extra_line1: f.recipient_extra_line1 || null,
      recipient_extra_line2: f.recipient_extra_line2 || null,
      zip: f.zip || null,
      city: f.city || null,
      country: f.country || null,
      notes: f.notes || null,
      payment_term_days: numOrNull(f.payment_term_days),
      skonto_percent: numOrNull(f.skonto_percent),
      skonto_days: numOrNull(f.skonto_days),
      is_invoice_recipient: f.is_invoice_recipient,
      auto_accept_supplements: f.auto_accept_supplements,
      default_discount_percent: numOrNull(f.default_discount_percent),
      default_surcharge_percent: numOrNull(f.default_surcharge_percent) ?? 0,
      payment_method: f.payment_method || null,
      payment_note: f.payment_note || null,
      in_payment_term_days: numOrNull(f.in_payment_term_days),
      in_skonto_percent: numOrNull(f.in_skonto_percent),
      in_skonto_days: numOrNull(f.in_skonto_days),
      in_discount_percent: numOrNull(f.in_discount_percent),
      in_payment_note: f.in_payment_note || null,
      updated_at: new Date().toISOString(),
    };

    let contactId = contact?.id;
    if (contact) {
      const res = await supabase.from("contacts").update(payload).eq("id", contact.id);
      if (res.error) {
        console.error("Kontakt speichern (update):", res.error);
        setBusy(false);
        setErr(friendlySaveError(res.error));
        return;
      }
    } else {
      const res = await supabase.from("contacts").insert(payload).select("id").single();
      if (res.error || !res.data) {
        if (res.error) console.error("Kontakt speichern (insert):", res.error);
        setBusy(false);
        setErr(friendlySaveError(res.error));
        return;
      }
      contactId = res.data.id;
    }

    await supabase.from("contact_persons").delete().eq("contact_id", contactId!);
    if (validPersons.length) {
      // Ansprechpartner-Nummer beibehalten (Bestand aus dem Formularzustand) bzw. für NEUE
      // Personen ohne Nummer aus dem Nummernkreis 'ansprechpartner' ziehen (AP-0001 …).
      // Hinweis: Die Maske schreibt Personen bei jedem Speichern neu – die Nummer kommt daher
      // aus p.contact_number (geladen), damit Bestandsnummern stabil bleiben.
      const rows: Record<string, unknown>[] = [];
      for (let i = 0; i < validPersons.length; i++) {
        const p = validPersons[i];
        let number = p.contact_number ?? null;
        if (!number) {
          const { data: apNum, error: apErr } = await supabase.rpc("next_document_number", {
            p_doc_type: "ansprechpartner",
          });
          if (apErr || !apNum) {
            if (apErr) console.error("next_document_number (Ansprechpartner):", apErr);
            setBusy(false);
            setErr(
              apErr
                ? germanError(apErr, "Die Ansprechpartner-Nummer konnte nicht vergeben werden.")
                : "Kein aktiver Nummernkreis 'Ansprechpartner' gefunden - bitte in Einstellungen unter Nummernkreise anlegen."
            );
            setTab("personen");
            return;
          }
          number = apNum as string;
        }
        rows.push({
          contact_id: contactId,
          contact_number: number,
          salutation: p.salutation || null,
          title: p.title || null,
          first_name: p.first_name || null,
          last_name: p.last_name || null,
          function: p.function || null,
          email: p.email || null,
          phone: p.phone || null,
          mobile: p.mobile || null,
          note: p.note || null,
          sort_order: i,
          active: p.active ?? true,
        });
      }
      const ins = await supabase.from("contact_persons").insert(rows);
      if (ins.error) {
        console.error("Ansprechpartner speichern:", ins.error);
        setBusy(false);
        setErr(germanError(ins.error, "Ansprechpartner konnten nicht gespeichert werden."));
        return;
      }
    }
    setBusy(false);
    onSaved(f.type);
  }

  const TABS: { key: Tab; label: string; icon: typeof Info }[] = [
    { key: "stamm", label: "Stammdaten", icon: Info },
    { key: "adresse", label: "Adresse", icon: MapPin },
    { key: "personen", label: "Ansprechpartner", icon: Users },
    { key: "zahlung", label: "Zahlung / Konditionen", icon: CreditCard },
  ];

  return (
    <Modal
      open
      onClose={onClose}
      title={contact ? `Kontakt bearbeiten: ${contactDisplayName(contact)}` : "Neuer Kontakt"}
      size="xl"
    >
      <ErrorBanner message={err} />
      <datalist id="titel-opts">
        {TITLE_SUGGESTIONS.map((t) => (
          <option key={t} value={t} />
        ))}
      </datalist>

      <div
        className="mb-5 flex flex-wrap gap-1.5 rounded-2xl border p-1.5"
        style={{ background: "var(--card)", borderColor: "var(--border)" }}
      >
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`inline-flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold transition-all ${tab === t.key ? "text-white" : "text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5"}`}
            style={
              tab === t.key
                ? { background: "linear-gradient(135deg,var(--accent),var(--accent-h))" }
                : undefined
            }
          >
            <t.icon size={16} /> {t.label}
            {t.key === "personen" && persons.length > 0 && (
              <span className="rounded-full bg-white/20 px-1.5 text-[11px]">{persons.length}</span>
            )}
          </button>
        ))}
      </div>

      {tab === "stamm" && (
        <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
          <div>
            <label className="label label-req">Kontaktart</label>
            <select
              className="input"
              value={f.type}
              onChange={(e) => {
                const t = e.target.value as ContactType;
                setF((p) => ({
                  ...p,
                  type: t,
                  customer_type: t === "lieferant" || t === "subunternehmer" ? "firma" : p.customer_type,
                }));
              }}
            >
              {CONTACT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label label-req">Kontaktform</label>
            <select
              className="input"
              value={f.customer_type}
              onChange={(e) => set("customer_type", e.target.value)}
            >
              {CUSTOMER_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-slate-400">
              Firma oder Person – frei wählbar, auch für Lieferanten und Subunternehmer.
            </p>
          </div>
          <div>
            <label className="label label-req">Kontaktnummer</label>
            <input
              className="input font-mono"
              value={f.contact_number}
              onChange={(e) => {
                set("contact_number", e.target.value);
                setNumTouched(true);
              }}
              placeholder={autoNum || "wird automatisch vergeben"}
              disabled={typeChanged && reassignNumber}
            />
            {!contact && (
              <p className="mt-0.5 text-[10px] text-slate-400">
                Vorschlag aus Kreis „{rangeLabel}" – die echte Nummer wird beim Speichern automatisch
                vergeben.
              </p>
            )}
            {typeChanged && (
              <label className="mt-1 flex items-center gap-2 text-[11px] text-slate-500">
                <input
                  type="checkbox"
                  checked={reassignNumber}
                  onChange={(e) => setReassignNumber(e.target.checked)}
                />
                Neue Nummer aus Kreis „{rangeLabel}" vergeben (Art geändert){autoNum ? ` → ${autoNum}` : ""}
              </label>
            )}
          </div>
          <div>
            <label className="label label-req">Status</label>
            <select className="input" value={f.status} onChange={(e) => set("status", e.target.value)}>
              <option value="aktiv">Aktiv</option>
              <option value="inaktiv">Inaktiv</option>
            </select>
          </div>

          <div className="sm:col-span-2 mt-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Name</div>
          {isFirma ? (
            <>
              <div className="sm:col-span-2">
                <label className="label label-req">Firmenname</label>
                <input className="input" value={f.company} onChange={(e) => set("company", e.target.value)} />
              </div>
              <div>
                <label className="label label-req">Vorname</label>
                <input
                  className="input"
                  value={f.first_name}
                  onChange={(e) => set("first_name", e.target.value)}
                  placeholder="Ansprechpartner"
                />
              </div>
              <div>
                <label className="label label-req">Nachname</label>
                <input
                  className="input"
                  value={f.last_name}
                  onChange={(e) => set("last_name", e.target.value)}
                  placeholder="Ansprechpartner"
                />
              </div>
              <div>
                <label className="label">UID-Nummer</label>
                <div className="flex">
                  {/* ATU als fixes Präfix vorgegeben; eingegeben werden nur die Ziffern.
                      Paste von „ATU12345678" oder „12345678" wird zentral normalisiert
                      (src/lib/uid.ts); ausländische UID (z. B. DE…) bleiben erhalten. */}
                  <span className="inline-flex items-center rounded-l-lg border border-r-0 px-3 text-sm font-mono text-slate-500 dark:text-slate-400"
                    style={{ borderColor: "var(--border)", background: "var(--hover)" }}>
                    ATU
                  </span>
                  <input
                    className="input rounded-l-none font-mono"
                    value={uidSuffix(f.uid_number)}
                    onChange={(e) => {
                      set("uid_number", applyUidInput(e.target.value));
                      if (uidError) setUidError(null);
                    }}
                    onBlur={(e) => {
                      const v = applyUidInput(e.target.value);
                      set("uid_number", v);
                      setUidError(isValidUid(v) ? null : "Bitte gültige UID eingeben (z. B. ATU12345678).");
                    }}
                    inputMode="text"
                    placeholder="12345678"
                  />
                </div>
                {uidError && <p className="mt-0.5 text-[11px] text-rose-600 dark:text-rose-400">{uidError}</p>}
              </div>
              <div>
                <label className="label">Kundennummer</label>
                <input
                  className="input"
                  value={f.customer_number}
                  onChange={(e) => set("customer_number", e.target.value)}
                  placeholder="optional"
                />
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="label label-req">Anrede</label>
                <select
                  className="input"
                  value={f.salutation}
                  onChange={(e) => set("salutation", e.target.value)}
                >
                  <option value="">– bitte wählen –</option>
                  {getSalutationOptions(f.salutation).map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Titel</label>
                <input
                  className="input"
                  list="titel-opts"
                  value={f.title}
                  onChange={(e) => set("title", e.target.value)}
                  placeholder="z.B. Mag., Dipl.-Ing."
                />
              </div>
              <div>
                <label className="label label-req">Vorname</label>
                <input
                  className="input"
                  value={f.first_name}
                  onChange={(e) => set("first_name", e.target.value)}
                />
              </div>
              <div>
                <label className="label label-req">Nachname</label>
                <input
                  className="input"
                  value={f.last_name}
                  onChange={(e) => set("last_name", e.target.value)}
                />
              </div>
              <div>
                <label className="label">Kundennummer</label>
                <input
                  className="input"
                  value={f.customer_number}
                  onChange={(e) => set("customer_number", e.target.value)}
                  placeholder="optional"
                />
              </div>
            </>
          )}

          <div className="sm:col-span-2 mt-1 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Kommunikation
          </div>
          <div>
            <label className="label label-req">E-Mail</label>
            <input
              type="email"
              className="input"
              value={f.email}
              onChange={(e) => set("email", e.target.value)}
            />
          </div>
          <div>
            <label className="label">Rechnungs-Mail</label>
            <input
              type="email"
              className="input"
              value={f.invoice_email}
              onChange={(e) => set("invoice_email", e.target.value)}
              placeholder="optional – sonst E-Mail"
            />
          </div>
          <div>
            <label className="label label-req">Mobiltelefon</label>
            <input
              className="input"
              value={f.mobile}
              onChange={(e) => set("mobile", e.target.value)}
              placeholder="z.B. +43 664 1112233"
            />
          </div>
          <div>
            <label className="label">Festnetz</label>
            <input
              className="input"
              value={f.phone}
              onChange={(e) => set("phone", e.target.value)}
              placeholder="z.B. +43 1 2345678"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Website</label>
            <input
              className="input"
              value={f.website}
              onChange={(e) => set("website", e.target.value)}
              placeholder="z.B. www.bau4you.at"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Interne Notiz</label>
            <textarea
              className="input min-h-[70px]"
              value={f.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </div>
        </div>
      )}

      {tab === "adresse" && (
        <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
          <div className="sm:col-span-2 -mb-1 text-xs text-slate-400">
            Empfänger-Anschrift im Dokument (je eigene Zeile): Name → Zusatzzeile 1 → Zusatzzeile 2 → Straße →
            Adresszusatz → PLZ Ort. Leere Zeilen erscheinen nicht im PDF. Zusatzzeilen z. B. für „z. Hd. …",
            Abteilung, Hausverwaltung oder c/o.
          </div>
          <div className="sm:col-span-2">
            <label className="label">Anschrift Zusatzzeile 1</label>
            <input
              className="input"
              value={f.recipient_extra_line1}
              onChange={(e) => set("recipient_extra_line1", e.target.value)}
              placeholder="z. B. z. Hd. Ing. Andreas Pittner"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Anschrift Zusatzzeile 2</label>
            <input
              className="input"
              value={f.recipient_extra_line2}
              onChange={(e) => set("recipient_extra_line2", e.target.value)}
              placeholder="z. B. Hausverwaltung / Abteilung"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label label-req">Straße und Hausnummer</label>
            <AddressAutocomplete
              value={f.street}
              zip={f.zip}
              city={f.city}
              placeholder="z. B. Schrottgasse 7 – Vorschläge ab 3 Zeichen"
              onChange={(v) => set("street", v)}
              onSelect={(s) => {
                set("street", s.street);
                if (s.zip) set("zip", s.zip);
                if (s.city) set("city", s.city);
                if (s.country) set("country", s.country);
              }}
            />
          </div>
          <div className="sm:col-span-2">
            <label className="label">Adresszusatz</label>
            <input
              className="input"
              value={f.address_extra}
              onChange={(e) => set("address_extra", e.target.value)}
              placeholder="z. B. / Stiege 1 / Top 14 oder / Hof"
            />
          </div>
          <div>
            <label className="label label-req">PLZ</label>
            <input className="input" value={f.zip} onChange={(e) => set("zip", e.target.value)} />
          </div>
          <div>
            <label className="label label-req">Ort</label>
            <input className="input" value={f.city} onChange={(e) => set("city", e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className="label label-req">Land</label>
            <input className="input" value={f.country} onChange={(e) => set("country", e.target.value)} />
          </div>
        </div>
      )}

      {tab === "personen" && (
        <div className="space-y-3">
          {persons.length === 0 ? (
            <div
              className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-slate-500"
              style={{ borderColor: "var(--border)" }}
            >
              Noch keine Ansprechpartner. Besonders bei Firmen sinnvoll.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--border)" }}>
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500 dark:bg-white/5">
                  <tr>
                    <th className="px-3 py-2">Name</th>
                    <th className="px-3 py-2">Funktion</th>
                    <th className="px-3 py-2">E-Mail</th>
                    <th className="px-3 py-2">Mobil / Festnetz</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2 text-right">Aktionen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                  {persons.map((p) => {
                    const editing = editingPersonId === p.id;
                    const name = [p.first_name, p.last_name].filter(Boolean).join(" ");
                    return (
                      <Fragment key={p.id}>
                        <tr className={p.active ? "" : "opacity-60"}>
                          <td className="px-3 py-2 font-medium">
                            {name || <span className="text-slate-400">– neuer Ansprechpartner –</span>}
                            {p.title ? <span className="ml-1 text-xs text-slate-400">{p.title}</span> : null}
                          </td>
                          <td className="px-3 py-2 text-slate-500">{p.function || "–"}</td>
                          <td className="px-3 py-2 text-slate-500">{p.email || "–"}</td>
                          <td className="px-3 py-2 text-slate-500">
                            {[p.mobile, p.phone].filter(Boolean).join(" · ") || "–"}
                          </td>
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              onClick={() => patchPerson(p.id, { active: !p.active })}
                              title="Aktiv/Inaktiv umschalten"
                            >
                              {p.active ? (
                                <Badge tone="green">aktiv</Badge>
                              ) : (
                                <Badge tone="slate">inaktiv</Badge>
                              )}
                            </button>
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex justify-end gap-1">
                              <button
                                className="btn-ghost px-2"
                                title={editing ? "Schließen" : "Bearbeiten"}
                                onClick={() => setEditingPersonId(editing ? null : p.id)}
                              >
                                <Pencil size={15} />
                              </button>
                              {/* Kein Löschen mehr – Ansprechpartner werden über Aktiv/Inaktiv deaktiviert. */}
                            </div>
                          </td>
                        </tr>
                        {editing && (
                          <tr>
                            <td colSpan={6} className="px-3 py-3" style={{ background: "var(--card)" }}>
                              <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                                <div>
                                  <label className="label label-req">Anrede</label>
                                  <select
                                    className="input"
                                    value={p.salutation ?? ""}
                                    onChange={(e) => patchPerson(p.id, { salutation: e.target.value })}
                                  >
                                    <option value="">– bitte wählen –</option>
                                    {getSalutationOptions(p.salutation).map((s) => (
                                      <option key={s} value={s}>
                                        {s}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <div>
                                  <label className="label">Titel</label>
                                  <input
                                    className="input"
                                    list="titel-opts"
                                    value={p.title ?? ""}
                                    onChange={(e) => patchPerson(p.id, { title: e.target.value })}
                                    placeholder="z.B. Mag., Dipl.-Ing."
                                  />
                                </div>
                                <div>
                                  <label className="label label-req">Vorname</label>
                                  <input
                                    className="input"
                                    value={p.first_name ?? ""}
                                    onChange={(e) => patchPerson(p.id, { first_name: e.target.value })}
                                  />
                                </div>
                                <div>
                                  <label className="label label-req">Nachname</label>
                                  <input
                                    className="input"
                                    value={p.last_name ?? ""}
                                    onChange={(e) => patchPerson(p.id, { last_name: e.target.value })}
                                  />
                                </div>
                                <div className="sm:col-span-2">
                                  <label className="label">Funktion</label>
                                  <input
                                    className="input"
                                    value={p.function ?? ""}
                                    onChange={(e) => patchPerson(p.id, { function: e.target.value })}
                                    placeholder="z.B. Buchhaltung, Technik"
                                  />
                                </div>
                                <div>
                                  <label className="label">E-Mail</label>
                                  <input
                                    type="email"
                                    className="input"
                                    value={p.email ?? ""}
                                    onChange={(e) => patchPerson(p.id, { email: e.target.value })}
                                  />
                                </div>
                                <div>
                                  <label className="label">Mobiltelefon</label>
                                  <input
                                    className="input"
                                    value={p.mobile ?? ""}
                                    onChange={(e) => patchPerson(p.id, { mobile: e.target.value })}
                                  />
                                </div>
                                <div>
                                  <label className="label">Festnetz</label>
                                  <input
                                    className="input"
                                    value={p.phone ?? ""}
                                    onChange={(e) => patchPerson(p.id, { phone: e.target.value })}
                                  />
                                </div>
                                <div className="sm:col-span-2">
                                  <label className="label">Notiz</label>
                                  <input
                                    className="input"
                                    value={p.note ?? ""}
                                    onChange={(e) => patchPerson(p.id, { note: e.target.value })}
                                  />
                                </div>
                              </div>
                              <div className="mt-2 flex justify-end">
                                <button
                                  className="btn-outline px-3 py-1 text-xs"
                                  onClick={() => setEditingPersonId(null)}
                                >
                                  Fertig
                                </button>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <button className="btn-outline" onClick={addPerson}>
            <UserPlus size={16} /> Ansprechpartner hinzufügen
          </button>
        </div>
      )}

      {tab === "zahlung" && (
        <div className="space-y-5">
          {showOut && (
            /* Ausgang: wir berechnen den Kunden */
            <div>
              <h4 className="mb-2 text-sm font-semibold text-slate-600 dark:text-slate-300">
                Ausgangsrechnungen <span className="font-normal text-slate-400">(Sie → Kunde)</span>
              </h4>
              <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                <div>
                  <label className="label">Zahlungsziel (Tage)</label>
                  <input
                    type="number"
                    min="0"
                    className="input"
                    value={f.payment_term_days}
                    onChange={(e) =>
                      set("payment_term_days", e.target.value === "" ? "" : Number(e.target.value))
                    }
                    placeholder="14"
                  />
                </div>
                <div>
                  <label className="label">Standardnachlass %</label>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    className="input"
                    value={f.default_discount_percent}
                    onChange={(e) =>
                      set("default_discount_percent", e.target.value === "" ? "" : Number(e.target.value))
                    }
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="label">Skonto %</label>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    className="input"
                    value={f.skonto_percent}
                    onChange={(e) =>
                      set("skonto_percent", e.target.value === "" ? "" : Number(e.target.value))
                    }
                    placeholder="z.B. 2"
                  />
                </div>
                <div>
                  <label className="label">Skontoziel (Tage)</label>
                  <input
                    type="number"
                    min="0"
                    className="input"
                    value={f.skonto_days}
                    onChange={(e) => set("skonto_days", e.target.value === "" ? "" : Number(e.target.value))}
                    placeholder="z.B. 7"
                  />
                </div>
                <div>
                  <label className="label">Standardaufschlag %</label>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    className="input"
                    value={f.default_surcharge_percent ?? ""}
                    onChange={(e) =>
                      set("default_surcharge_percent", e.target.value === "" ? "" : Number(e.target.value))
                    }
                    placeholder="0"
                  />
                  <p className="mt-1 text-[11px] text-slate-400">
                    Interner Aufschlag – erscheint nicht im Angebot/PDF, wird in die Einzelpreise
                    eingerechnet.
                  </p>
                </div>
                <div className="sm:col-span-2">
                  {/* Beide Schalter in EINER Zeile (auf schmalen Breiten umbrechend),
                      Erläuterung darunter. */}
                  <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
                    <Toggle
                      checked={f.is_invoice_recipient}
                      onChange={(v) => set("is_invoice_recipient", v)}
                      label="Rechnungsempfänger"
                    />
                    <Toggle
                      checked={f.auto_accept_supplements}
                      onChange={(v) => set("auto_accept_supplements", v)}
                      label="Nachträge automatisch akzeptieren"
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-slate-400">
                    Wenn aktiv, gilt ein abgeschlossener Angebot-Nachtrag dieses Kunden automatisch als
                    akzeptiert und wird in den zugehörigen Auftrag übernommen (bei mehreren Aufträgen mit
                    Auswahl).
                  </p>
                </div>
                <div className="sm:col-span-2">
                  <label className="label">Zahlungsnotiz</label>
                  <textarea
                    className="input min-h-[70px]"
                    value={f.payment_note}
                    onChange={(e) => set("payment_note", e.target.value)}
                    placeholder="z.B. Rechnung immer an Buchhaltung senden."
                  />
                </div>
              </div>
            </div>
          )}

          {showIn && (
            /* Eingang: Lieferant/Subunternehmer berechnet uns */
            <div>
              <h4 className="mb-2 text-sm font-semibold text-slate-600 dark:text-slate-300">
                Eingangsrechnungen{" "}
                <span className="font-normal text-slate-400">(Lieferant/Subunternehmer → Sie)</span>
              </h4>
              <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
                <div>
                  <label className="label">Zahlungsziel (Tage)</label>
                  <input
                    type="number"
                    min="0"
                    className="input"
                    value={f.in_payment_term_days}
                    onChange={(e) =>
                      set("in_payment_term_days", e.target.value === "" ? "" : Number(e.target.value))
                    }
                    placeholder="z.B. 21"
                  />
                </div>
                <div>
                  <label className="label">Standardnachlass %</label>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    className="input"
                    value={f.in_discount_percent}
                    onChange={(e) =>
                      set("in_discount_percent", e.target.value === "" ? "" : Number(e.target.value))
                    }
                    placeholder="z.B. 5"
                  />
                </div>
                <div>
                  <label className="label">Skonto %</label>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    className="input"
                    value={f.in_skonto_percent}
                    onChange={(e) =>
                      set("in_skonto_percent", e.target.value === "" ? "" : Number(e.target.value))
                    }
                    placeholder="z.B. 3"
                  />
                </div>
                <div>
                  <label className="label">Skontoziel (Tage)</label>
                  <input
                    type="number"
                    min="0"
                    className="input"
                    value={f.in_skonto_days}
                    onChange={(e) =>
                      set("in_skonto_days", e.target.value === "" ? "" : Number(e.target.value))
                    }
                    placeholder="z.B. 21"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="label">Zahlungsnotiz (Eingang)</label>
                  <textarea
                    className="input min-h-[70px]"
                    value={f.in_payment_note}
                    onChange={(e) => set("in_payment_note", e.target.value)}
                    placeholder="z.B. Lieferantenrechnung, Skonto bei Zahlung binnen 14 Tagen."
                  />
                </div>
              </div>
            </div>
          )}

          <p className="text-[11px] text-slate-400">
            Ausgang = wenn Sie diesen Kontakt berechnen (Kunde). Eingang = wenn dieser Kontakt Sie berechnet
            (Lieferant/Subunternehmer). Standard-Zahlungsart ist Überweisung; alle Werte werden in Dokumenten
            vorgeschlagen und sind dort überschreibbar.
          </p>
        </div>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <button className="btn-outline" onClick={onClose}>
          Abbrechen
        </button>
        <button className="btn-primary" disabled={busy} onClick={save}>
          {busy ? "Speichern …" : "Speichern"}
        </button>
      </div>
    </Modal>
  );
}
