// ============================================================
// B4Y SuperAPP – Zentrale Dokument-Erstellung (Projektkontext)
// ============================================================
// EINE zentrale Erstell-Logik für ALLE Einbaustellen (Projektkopf + Dokumente-
// Bereich). Zeigt die für den Mandanten aktiven, erlaubten und im Projekt
// erstellbaren Dokumenttypen aus den Dokumenttyp-Einstellungen (NICHT
// hartcodiert), mit Rechteprüfung.
//
// ZWEISPALTIG: links die Dokumenttypen, rechts SOFORT die Varianten des aktuell
// markierten Typs (offer_types, kontextkorrekt beschriftet: „Standardauftrag"
// statt „Standardangebot"). KEIN zweites Fenster/kein Zwischenschritt mehr.
//  • Chain-Typen (Angebot/Nachtrag/Auftrag/Rechnung) → onCreate(kind, offerType).
//  • Auftrag SUB → onCreateSub(offerType) (öffnet die SUB-Vergabe, Variante voreingestellt).
//  • Sonstige Typen ohne Varianten → onCreateGeneric(docType).
// Rechte- und mandantenfähig; Einzahl-Labels; feste Top-Reihenfolge, Rest alphabetisch.
//
// Als MODAL (Portal an <body>) gerendert – immer sauber im Vordergrund.
// ============================================================
import { useEffect, useMemo, useState } from "react";
import { FilePlus2, ChevronRight, FileText, ClipboardList, Receipt, File, Users, Mic } from "lucide-react";
import { usePermissions } from "../../lib/permissions";
import { loadDocumentTypes, DocumentType, CHAIN_SLUGS } from "../../lib/documents";
import { loadOfferTypes, OfferType, variantLabel } from "../../lib/offer-kinds";
import { Modal } from "../ui";

export type ChainKind = "offer" | "nachtrag" | "order" | "invoice";

const CHAIN_SINGULAR: Record<ChainKind, string> = { offer: "Angebot", nachtrag: "Angebot Nachtrag", order: "Auftrag", invoice: "Rechnung" };
const CHAIN_NOUN: Record<ChainKind, "angebot" | "auftrag" | "rechnung" | "nachtrag"> = { offer: "angebot", nachtrag: "nachtrag", order: "auftrag", invoice: "rechnung" };
const CHAIN_MODULE: Record<ChainKind, string> = { offer: "offers", nachtrag: "offers", order: "orders", invoice: "invoices" };
const CHAIN_ICON: Record<ChainKind, typeof FileText> = { offer: FileText, nachtrag: FilePlus2, order: ClipboardList, invoice: Receipt };

// Feste obere Reihenfolge (nicht alphabetisch); danach Trennlinie + Rest alphabetisch.
const FIXED_TOP_SLUGS = ["angebote", "angebot_nachtrag", "auftraege", "auftrag_sub", "rechnungen"];

type Entry = {
  t: DocumentType;
  kind: ChainKind | null;   // Chain-Dokument (eigener Editor)
  isSub: boolean;           // Auftrag SUB (Varianten via onCreateSub → Vergabe)
  label: string;
  Icon: typeof FileText;
};

export type DocumentCreateOpts = { voice?: boolean };

export default function DocumentCreateMenu({
  onCreate, onCreateGeneric, onCreateSub, label = "Dokument erstellen", buttonClassName = "btn-primary",
}: {
  onCreate: (kind: ChainKind, offerType: OfferType | null, opts?: DocumentCreateOpts) => void;
  onCreateGeneric?: (docType: DocumentType) => void;
  onCreateSub?: (offerType: OfferType | null) => void;
  label?: string;
  buttonClassName?: string;
}) {
  const { can, isAdmin } = usePermissions();
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [docTypes, setDocTypes] = useState<DocumentType[]>([]);
  const [offerTypes, setOfferTypes] = useState<OfferType[]>([]);

  useEffect(() => {
    loadDocumentTypes(true).then(setDocTypes).catch(() => setDocTypes([]));
    loadOfferTypes(true).then(setOfferTypes).catch(() => setOfferTypes([]));
  }, []);

  const mayCreate = (module: string) => isAdmin || can(module, "create") || can(module, "edit");
  const creatable = useMemo(() => docTypes.filter((t) => t.is_active && t.allow_create && t.belongs_to_project), [docTypes]);

  // Obere Hauptgruppe (feste Reihenfolge)
  const topEntries = useMemo<Entry[]>(() => FIXED_TOP_SLUGS
    .map((slug) => creatable.find((t) => t.slug === slug))
    .filter((t): t is DocumentType => !!t)
    .map((t): Entry | null => {
      const kind = CHAIN_SLUGS[t.slug] ?? null;
      if (kind) return mayCreate(CHAIN_MODULE[kind]) ? { t, kind, isSub: false, label: CHAIN_SINGULAR[kind], Icon: CHAIN_ICON[kind] } : null;
      if (t.slug === "auftrag_sub" && onCreateSub && (isAdmin || can("orders", "create") || can("orders", "edit")))
        return { t, kind: null, isSub: true, label: t.name, Icon: Users };
      return (onCreateGeneric && (isAdmin || can("documents", "create"))) ? { t, kind: null, isSub: false, label: t.name, Icon: File } : null;
    })
    .filter((e): e is Entry => !!e), [creatable, offerTypes, isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  // Untere Gruppe: übrige generische Typen, alphabetisch (de)
  const genericEntries = useMemo<Entry[]>(() => (onCreateGeneric
    ? creatable
      .filter((t) => !CHAIN_SLUGS[t.slug] && !FIXED_TOP_SLUGS.includes(t.slug) && (isAdmin || can("documents", "create")))
      .sort((a, b) => (a.name || "").localeCompare(b.name || "", "de"))
      .map((t): Entry => ({ t, kind: null, isSub: false, label: t.name, Icon: File }))
    : []), [creatable, isAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  const allEntries = useMemo(() => [...topEntries, ...genericEntries], [topEntries, genericEntries]);

  // Varianten eines Eintrags (Chain-Typen + SUB nutzen dieselbe offer_types-Liste).
  const variantsOf = (e: Entry | null): { ot: OfferType; label: string }[] => {
    if (!e || offerTypes.length === 0) return [];
    if (e.kind) return offerTypes.map((ot) => ({ ot, label: variantLabel(CHAIN_NOUN[e.kind!], ot) }));
    if (e.isSub) return offerTypes.map((ot) => ({ ot, label: `${variantLabel("auftrag", ot)} SUB` }));
    return [];
  };

  // Beim Öffnen ersten Top-Eintrag vorauswählen (rechts gleich Varianten sichtbar).
  useEffect(() => {
    if (open && (!selectedId || !allEntries.some((e) => e.t.id === selectedId))) {
      setSelectedId(allEntries[0]?.t.id ?? null);
    }
  }, [open, allEntries, selectedId]);

  const selected = allEntries.find((e) => e.t.id === selectedId) ?? null;
  const variants = variantsOf(selected);

  const close = () => setOpen(false);

  function pickVariant(e: Entry, ot: OfferType) {
    if (e.kind) onCreate(e.kind, ot);
    else if (e.isSub) onCreateSub?.(ot);
    close();
  }
  function pickVariantVoice(e: Entry, ot: OfferType | null) {
    if (e.kind === "offer") onCreate(e.kind, ot, { voice: true });
    close();
  }
  function createDirect(e: Entry) {
    if (e.kind) onCreate(e.kind, offerTypes[0] ?? null);
    else if (e.isSub) onCreateSub?.(offerTypes[0] ?? null);
    else onCreateGeneric?.(e.t);
    close();
  }

  const rowCls = (active: boolean) =>
    `flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left text-sm transition ${
      active ? "bg-[var(--accent-soft)] font-semibold text-[var(--text)]" : "hover:bg-[var(--hover)]"}`;

  return (
    <>
      <button className={buttonClassName} onClick={() => setOpen(true)}>
        <FilePlus2 size={16} /> {label}
      </button>

      {open && (
        <Modal open onClose={close} title="Dokument erstellen" size="2xl">
          {allEntries.length === 0 ? (
            <div className="px-2.5 py-6 text-center text-sm text-slate-400">Keine erstellbaren Dokumenttypen.</div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-[minmax(0,260px)_1fr]">
              {/* Links: Dokumenttypen */}
              <div className="space-y-1 sm:border-r sm:pr-3" style={{ borderColor: "var(--border)" }}>
                <div className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text2)" }}>
                  Dokumenttyp
                </div>
                {topEntries.map((e) => {
                  const hv = variantsOf(e).length > 0;
                  return (
                    <button key={e.t.id} onClick={() => setSelectedId(e.t.id)} className={rowCls(selected?.t.id === e.t.id)}>
                      <e.Icon size={16} className="shrink-0 text-slate-400" />
                      <span className="flex-1 truncate">{e.label}</span>
                      {hv && <ChevronRight size={14} className="shrink-0 text-slate-400" />}
                    </button>
                  );
                })}
                {genericEntries.length > 0 && <div className="my-1 h-px" style={{ background: "var(--border)" }} />}
                {genericEntries.map((e) => (
                  <button key={e.t.id} onClick={() => setSelectedId(e.t.id)} className={rowCls(selected?.t.id === e.t.id)}>
                    <e.Icon size={16} className="shrink-0 text-slate-400" />
                    <span className="flex-1 truncate">{e.label}</span>
                  </button>
                ))}
              </div>

              {/* Rechts: Varianten des markierten Typs */}
              <div className="space-y-1">
                {!selected ? (
                  <div className="px-2.5 py-8 text-center text-sm text-slate-400">Dokumenttyp links auswählen …</div>
                ) : variants.length > 0 ? (
                  <>
                    <div className="px-1 pb-1 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--text2)" }}>
                      {selected.label} – Variante
                    </div>
                    {variants.map(({ ot, label: vlabel }) => (
                      <button key={ot.id} onClick={() => pickVariant(selected, ot)}
                        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-left text-sm transition hover:bg-[var(--hover)]">
                        <FileText size={16} className="shrink-0 text-slate-400" />
                        <span className="flex-1 capitalize">{vlabel}</span>
                      </button>
                    ))}
                    {selected.kind === "offer" && (
                      <div className="mt-3 border-t pt-3" style={{ borderColor: "var(--border)" }}>
                        <button
                          onClick={() => pickVariantVoice(selected, offerTypes[0] ?? null)}
                          className="btn-primary flex w-full items-center justify-center gap-2"
                        >
                          <Mic size={16} /> Per Sprache erstellen
                        </button>
                        <p className="mt-2 px-1 text-[11px] text-slate-400">
                          Diktiere dein Angebot – KI fuellt Positionen automatisch.
                        </p>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex h-full flex-col items-start justify-center gap-3 px-2.5 py-6">
                    <p className="text-sm text-slate-400">Keine Varianten verfügbar – direkt erstellen.</p>
                    <button className="btn-primary" onClick={() => createDirect(selected)}>
                      <FilePlus2 size={16} /> {selected.label} erstellen
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
