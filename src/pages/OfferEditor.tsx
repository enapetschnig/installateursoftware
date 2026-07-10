import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate, useSearchParams, Link } from "react-router-dom";
import { ArrowLeft, Settings, AlertTriangle, ClipboardList } from "lucide-react";
import { supabase } from "../lib/supabase";
import { Spinner, Badge, Modal } from "../components/ui";
import { ErrorBanner, ConfirmDialog } from "../components/calc-ui";
import { useCan } from "../lib/permissions";
import { isDeletable, softDeleteDocument, DELETE_CONFIRM_TEXT, DELETE_GONE_TEXT } from "../lib/document-delete";
import {
  Offer, OfferStatus, OFFER_STATUS_LABEL, OFFER_STATUS_TONE, VatMode, withParagraph19Note,
} from "../lib/offer-types";
import { loadGlobalDisplay, resolveOfferDisplay, OfferDisplay, DEFAULT_DISPLAY, DISPLAY_FIELDS } from "../lib/offer-display";
import { OfferType, loadOfferTypes, pickDefaultType } from "../lib/offer-kinds";
import { Toggle } from "../components/calc-ui";
import { Contact, Project } from "../lib/types";
import { contactDisplayName, formatAddressInline, resolveRecipientLines, RecipientOverride } from "../lib/contact-name";
import RecipientOverrideEditor from "../components/document/RecipientOverrideEditor";
import SignatureSourcePicker from "../components/document/SignatureSourcePicker";
import { SignatureSource, normalizeSignatureSource } from "../lib/document-signature";
import { dateAt, eur } from "../lib/format";
import { useAuth } from "../lib/auth";
import { logProject } from "../lib/projectlog";
import { addSupplementToOrder } from "../lib/document-supplement";
import { createOrderFromOffers, createInvoiceFromOffer, findActiveOrderForOffer } from "../lib/document-chain";
import { isUuid, docPath } from "../lib/documents-overview";
import { buildDocPlaceholders } from "../lib/document-placeholders";
import { canConvertOffer } from "../lib/document-transitions";
import { buildDocumentMoreActions } from "../lib/document-actions";
import { aiDocActionLabels } from "../lib/ai-doc-actions";
import { toast, toastError } from "../lib/toast";
import VoiceAngebotDialog, { type VoiceAngebotDialogMeta } from "../components/voice/VoiceAngebotDialog";
import AddPositionDialog from "../components/dialog/AddPositionDialog";
import { heroToDocPositions } from "../lib/calc/heroToDocPositions";
import { loadStammdatenForVoice, EMPTY_VOICE_STAMMDATEN, type VoiceStammdaten } from "../lib/voice/loadStammdatenForVoice";
import { mergeVoiceNotes } from "../lib/voice/voiceMetaToNotes";
import type { Gewerk } from "../lib/calc/types";
import { useDocumentBuilder } from "../hooks/useDocumentBuilder";
import { useModalParam } from "../hooks/useModalParam";
import { rememberProjectSection } from "../lib/project-nav";
import { ensureDocumentNumber } from "../lib/document-numbers";
import ProjectContextChips from "../components/project/ProjectContextChips";
import { normalizePositions, applySurchargeToPositions, computeSummary, type DocPosition } from "../lib/document-types";
import {
  DocumentConditions, emptyDocumentConditions, resolveDocumentConditions,
  conditionsFromSnapshot, conditionsToSnapshot, conditionsToPaymentMeta, showPaymentForDoc,
} from "../lib/payment-conditions";
import ConditionsSettings from "../components/document/ConditionsSettings";
import DocumentWorkspace from "../components/document/DocumentWorkspace";
import RichTextEditor from "../components/RichTextEditor";
import {
  TextBlock, loadTextBlocks, pickBestText, snapshotText, applyPlaceholders,
  blockHtml, plainToHtml, looksLikeHtml, isEmptyHtml, PlaceholderValues, MatchContext, TextType,
} from "../lib/text-blocks";
import { loadDocumentTypes, loadDocumentSubtypes, DocumentSubtype, DocumentType } from "../lib/documents";
import { loadCompanySettings, CompanySettings } from "../lib/company";
import { renderDocumentHtml } from "../components/document/printDocument";
import { htmlToPdfBlob, buildDocumentPdfFileName } from "../lib/pdf";
import { sendMail } from "../lib/microsoft/mailClient";
import { useMicrosoftConnection } from "../hooks/useMicrosoftConnection";
import { buildOfferMailSubject, buildOfferMailHtml } from "../lib/microsoft/offerMailTemplate";
import { finalizeDocumentVersion, finalizeStamp, logReopen, loadDocumentVersions, DocVersion } from "../lib/document-versions";
import VersionHistoryModal from "../components/document/VersionHistoryModal";
import { Unlock } from "lucide-react";

// ── KI-Pipelines: Service-Lookup für heroToDocPositions ──
// heroToDocPositions erwartet `service_number: string` (kein null) – aus
// unserem Service[] (mit nullable Nummer) den passenden Lookup bauen.
// Genutzt vom Voice-Komplettangebot UND von "+ KI Leistung" (EINE Quelle).
function buildSvcLookup(services: VoiceStammdaten["services"]) {
  return services
    .filter((s) => !!s.service_number)
    .map((s) => ({
      id: s.id,
      service_number: s.service_number as string,
      name: s.name,
      unit: s.unit ?? undefined,
      vat_rate: s.vat_rate,
    }));
}

// ── Textbaustein-System v1: Vor-/Nachtexte, Rechts-/Zahlungstexte, Platzhalter ──
function buildPhValues(
  customer: Contact | null, project: Project | null, offer: Offer | null,
  docLabel: string, co: CompanySettings | null, bearbeiter: string,
  conditions?: { termDays: number | null; skontoPercent: number | null; skontoDays: number | null },
): PlaceholderValues {
  // Zentrale Werte (keine Doppellogik) – alle Platzhalter inkl. firma.*/kondition.*
  // stammen aus buildDocPlaceholders (EINE Quelle, gilt für alle Dokumente).
  return buildDocPlaceholders({
    customer, project, docNumber: offer?.number, docDate: offer?.created_at,
    docLabel, company: co, bearbeiter,
    validUntil: (offer as { valid_until?: string | null } | null)?.valid_until ?? null,
    conditions: conditions
      ? { paymentTermDays: conditions.termDays, skontoPercent: conditions.skontoPercent, skontoDays: conditions.skontoDays }
      : null,
  });
}

export default function OfferEditor() {
  const { id } = useParams();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [offer, setOffer] = useState<Offer | null>(null);
  const [head, setHead] = useState({
    title: "", number: "", contact_id: "", project_id: "", status: "entwurf" as OfferStatus,
    notes: "", vatMode: "standard" as VatMode,
    useGlobalDisplay: true, display: DEFAULT_DISPLAY as OfferDisplay,
    offerTypeId: "" as string, introText: "" as string, prePositionsText: "" as string,
    createdBy: "" as string, signatureSource: "company" as SignatureSource,
  });
  // Dokument-Konditionen (Zahlung/Nachlass/Aufschlag) – Snapshot je Beleg.
  const [conditions, setConditions] = useState<DocumentConditions>(emptyDocumentConditions());
  const [recipientOverride, setRecipientOverride] = useState<RecipientOverride | null>(null);
  // Auswahl-Dialog: mehrere mögliche Aufträge für die Nachtrags-Übernahme.
  const [orderChoices, setOrderChoices] = useState<{ id: string; order_number: string | null }[] | null>(null);
  const [globalDisplay, setGlobalDisplay] = useState<OfferDisplay>(DEFAULT_DISPLAY);
  const [offerTypes, setOfferTypes] = useState<OfferType[]>([]);
  // Textbaustein-System
  const [textBlocks, setTextBlocks] = useState<TextBlock[]>([]);
  const [angeboteDocTypeId, setAngeboteDocTypeId] = useState<string | null>(null);
  const [docSubtypes, setDocSubtypes] = useState<DocumentSubtype[]>([]);
  const [angeboteDocType, setAngeboteDocType] = useState<DocumentType | null>(null);
  const [projTypeRows, setProjTypeRows] = useState<{ id: string; slug: string }[]>([]);
  const [company, setCompany] = useState<CompanySettings | null>(null);
  // Versions-Historie
  const snapshotRef = useRef<{ positions: any; summary: any; meta: any } | null>(null);
  // Versionshistorie URL-gekoppelt (?versions=1): überlebt den Rücksprung aus dem PDF-Viewer
  // (Escape im PDF → exakt zurück zur geöffneten Historie).
  const [versionsOpen, setVersionsOpen] = useModalParam("versions");
  const [reopenOpen, setReopenOpen] = useState(false);
  const [restoreVer, setRestoreVer] = useState<DocVersion | null>(null); // Wiederherstellen-Dialog
  const [workingBaseVer, setWorkingBaseVer] = useState<number | null>(null); // Arbeitsstand aus Vx
  const [typeChange, setTypeChange] = useState<OfferType | null>(null); // Warnung bei Typwechsel
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [delOpen, setDelOpen] = useState(false);
  // Phase 5: KI-Voice-Dialog + Single-Position-Dialog (Stub). Sichtbar laut
  // User-Constraint nur bei leeren Entwuerfen bzw. arbeitbaren Entwuerfen.
  const [voiceDialogOpen, setVoiceDialogOpen] = useState(false);
  // Mitdenken-Hinweise der Voice-KI ("Prüfen: …") – nach dem Erzeugen sichtbar
  // anzeigen statt sie nur still in den internen Notizen zu versenken.
  const [voiceHints, setVoiceHints] = useState<string[] | null>(null);
  const [addPositionDialogOpen, setAddPositionDialogOpen] = useState(false);
  const [voiceStammdaten, setVoiceStammdaten] = useState<VoiceStammdaten>(EMPTY_VOICE_STAMMDATEN);
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "dirty" | "error">("saved");
  const pendingWasClosed = useRef(false);
  const savingRef = useRef(false);
  const { session, profile } = useAuth();
  const can = useCan();
  // Bereits aus diesem Angebot erstellter aktiver Auftrag → „Auftrag erstellen" wird
  // sichtbar deaktiviert + „Zum Auftrag wechseln" angeboten (Duplikat-Schutz, Punkt-of-truth
  // in document-chain.findActiveOrderForOffer; serverseitig zusätzlich Positions-Guard).
  const [existingOrder, setExistingOrder] = useState<{ id: string; order_number: string | null } | null>(null);
  useEffect(() => {
    let cancelled = false;
    const oid = offer?.id;
    if (!oid) { setExistingOrder(null); return; }
    findActiveOrderForOffer(oid).then((r) => { if (!cancelled) setExistingOrder(r); }).catch(() => {});
    return () => { cancelled = true; };
    // head.status: nach Konversion wechselt der Status (in_auftrag_uebernommen) → neu prüfen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offer?.id, head.status]);
  // Microsoft-Graph-OAuth-Status. Ohne connected===true kann der SendDialog
  // keine Mail schicken – wir zeigen dann einen Info-Banner mit Link auf die
  // Einstellungen (Integrationen-Tab) und blockieren den Send-Button.
  const microsoft = useMicrosoftConnection();

  const vatOverride = head.vatMode === "par19" ? 0 : null;
  const vatLabel = head.vatMode === "par19" ? "MwSt §19 (0 %)" : "MwSt 20 %";
  const builder = useDocumentBuilder([], vatOverride, conditions.discountPercent);

  async function load() {
    if (!id) return;
    setLoading(true); setErr(null);
    const [o, c, p, g, types, tb, dts, dsub, pts, co] = await Promise.all([
      supabase.from("offers").select("*").eq(isUuid(id) ? "id" : "number", id).maybeSingle(),
      supabase.from("contacts").select("*"),
      supabase.from("projects").select("*").order("created_at", { ascending: false }),
      loadGlobalDisplay().catch(() => DEFAULT_DISPLAY),
      loadOfferTypes(false).catch(() => [] as OfferType[]),
      loadTextBlocks().catch(() => [] as TextBlock[]),
      loadDocumentTypes(true).catch(() => []),
      loadDocumentSubtypes(true).catch(() => [] as DocumentSubtype[]),
      supabase.from("project_types").select("id,slug").eq("active", true),
      loadCompanySettings().catch(() => null),
    ]);
    setGlobalDisplay(g);
    setOfferTypes(types);
    setTextBlocks(tb);
    const angDt = dts.find((d) => d.slug === "angebote") ?? null;
    setAngeboteDocTypeId(angDt?.id ?? null);
    setAngeboteDocType(angDt);
    setDocSubtypes(dsub);
    setProjTypeRows((pts.data as { id: string; slug: string }[]) ?? []);
    setCompany(co);
    if (o.error) setErr(o.error.message);
    const off = o.data as Offer | null;
    setOffer(off);
    if (off) {
      // Expliziter MwSt-Modus (Spalte) bevorzugt; Fallback: aus vat=0 erschließen (Altbelege).
      const inferredVat: VatMode = ((off as any).vat_mode as VatMode)
        ?? (Number(off.vat) === 0 && Number(off.net) > 0 ? "par19" : "standard");
      const st = (off.status as OfferStatus) ?? "entwurf";
      const isDraft = st === "entwurf";
      // Angebotstyp ermitteln (gespeichert oder – bei Altbestand/Entwurf – Standardtyp)
      const savedTypeId = (off as any).offer_type_id as string | null;
      const type = types.find((t) => t.id === savedTypeId) ?? (savedTypeId ? null : pickDefaultType(types));
      const hasSnapshot = savedTypeId != null;

      const hasNotes = !!(off.notes && off.notes.trim());
      const closing = (off as any).offer_closing_text as string | null;
      // KEINE automatischen Standardtexte: Vor-/Nachtext/Einleitung NUR aus gespeichertem
      // Wert. Keine type-/Default-/Baustein-Auto-Auflösung mehr – Texte kommen
      // ausschließlich aus manuell gewählten Textvorlagen (TextPicker).
      const notes = closing ?? (hasNotes ? off.notes! : "");
      const intro = ((off as any).offer_intro_text as string | null) ?? "";
      const prePos = ((off as any).pre_positions_text as string | null) ?? "";

      // Auto-Vorbelegung aus zentralen Standard-Textbausteinen (nur wenn leer)
      const offCustomer = (c.data as Contact[] | null)?.find((x) => x.id === off.contact_id) ?? null;
      const offProject = (p.data as Project[] | null)?.find((x) => x.id === off.project_id) ?? null;
      const subId = dsub.find((s) => s.document_type_id === angDt?.id && s.slug === type?.slug)?.id ?? null;
      const projId = ((pts.data as { id: string; slug: string }[]) ?? [])
        .find((x) => x.slug === (offProject as any)?.category)?.id ?? null;
      // Auto-Standardtexte greifen EINMALIG bei einem neuen Entwurf (Flag texts_initialized=false).
      // Danach hat die manuelle Auswahl/Änderung im Dokument Vorrang und „Keine Einleitung"
      // (leeres Feld) bleibt erhalten. Nur is_default-Bausteine, nach Kriterien/Priorität.
      const ctxLoad: MatchContext = {
        documentTypeId: angDt?.id ?? null, documentSubtypeId: subId,
        projectTypeId: projId, customerType: offCustomer?.customer_type ?? null, language: "de",
      };
      const phLoad = buildPhValues(offCustomer, offProject, off, type?.pdf_label || "Angebot", co, profile?.name ?? "");
      let introResolved = intro;
      let notesResolved = notes;
      let prePosResolved = prePos;
      let didInitTexts = false;
      const textsInitialized = (off as any).texts_initialized === true;
      if (isDraft && !textsInitialized) {
        // Einheitliche Standardquelle: Standardtext DER VARIANTE (offer_types) zuerst,
        // sonst bester text_blocks-Default. „Einleitung vor Positionen" bleibt optional/leer
        // (keine Variante-Quelle) und wird nur aus text_blocks vorbelegt, wenn vorhanden.
        if (!introResolved.trim()) {
          if (type?.intro_text && type.intro_text.trim()) { introResolved = type.intro_text; didInitTexts = true; }
          else { const m = pickBestText(tb, "dokument_vortext", ctxLoad, true); if (m.block) { introResolved = snapshotText(m.block, phLoad).html; didInitTexts = true; } }
        }
        if (!prePosResolved.trim()) {
          const m = pickBestText(tb, "einleitung_vor_positionen", ctxLoad, true);
          if (m.block) { prePosResolved = snapshotText(m.block, phLoad).html; didInitTexts = true; }
        }
        if (!notesResolved.trim()) {
          if (type?.closing_text && type.closing_text.trim()) { notesResolved = type.closing_text; didInitTexts = true; }
          else { const m = pickBestText(tb, "dokument_nachtext", ctxLoad, true); if (m.block) { notesResolved = snapshotText(m.block, phLoad).html; didInitTexts = true; } }
        }
      }

      // Darstellung: eigener Snapshot > altes display-Feld > Typ-Defaults
      const snapshot = ((off as any).display_settings_snapshot as OfferDisplay | null)
        ?? ((off as any).display as OfferDisplay | null)
        ?? type?.display ?? g;
      const useGlobal = (off as any).use_global_display ?? !hasSnapshot;

      setHead({
        title: off.title ?? "", number: off.number ?? "", contact_id: off.contact_id ?? "",
        project_id: off.project_id ?? "", status: st,
        notes: notesResolved, vatMode: inferredVat,
        useGlobalDisplay: useGlobal,
        display: snapshot,
        offerTypeId: type?.id ?? "",
        introText: introResolved,
        prePositionsText: prePosResolved,
        createdBy: (off as any).created_by ?? "",
        signatureSource: normalizeSignatureSource((off as any).signature_source),
      });
      builder.reset(normalizePositions(off.items));
      // Konditionen: gespeicherten Snapshot übernehmen; fehlt er (Altbeleg/neuer Entwurf),
      // beim Entwurf live vom Kunden ableiten (sonst leer lassen – Altbelege unverändert).
      setWorkingBaseVer((off as any).working_base_version_no ?? null);
      setRecipientOverride(((off as any).recipient_override as RecipientOverride) ?? null);
      const condSnap = conditionsFromSnapshot((off as any).conditions_snapshot);
      if (condSnap) setConditions(condSnap);
      else {
        const cust = ((c.data as Contact[]) ?? []).find((x) => x.id === off.contact_id) ?? null;
        setConditions(isDraft && cust ? resolveDocumentConditions(cust, "out") : emptyDocumentConditions());
      }
      // Bei Entwürfen ohne gespeicherten Typ/Snapshot: einmal persistieren
      if (isDraft && (!savedTypeId || !hasNotes)) builder.setDirty(true);
      // Automatisch gesetzte Standardtexte beim ersten Öffnen mitspeichern (danach fix).
      if (didInitTexts) builder.setDirty(true);
    }
    setContacts((c.data as Contact[]) ?? []);
    setProjects((p.data as Project[]) ?? []);
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-line */ }, [id]);

  const setHeadF = (k: keyof typeof head, v: any) => { setHead((p) => ({ ...p, [k]: v })); builder.setDirty(true); };

  // Stammdaten fuer Voice-Pipeline EAGER laden, sobald der Editor steht und
  // der Voice-Knopf ueberhaupt erscheinen koennte (status=entwurf). Wichtig:
  // vorher war das LAZY beim ersten Dialog-Open — wenn der User aber sofort
  // diktiert + sendet bevor die Stammdaten da waren, lief die Calc-Pipeline
  // mit EMPTY_VOICE_STAMMDATEN und die Positionen kamen ohne richtige
  // Preise/Kalkulation im Editor an (User-Beschwerde 2026-06-30
  // "Positionen mit richtiger Kalkulation"). Daher: jetzt eager.
  const voiceLoadedRef = useRef(false);
  useEffect(() => {
    if (loading || voiceLoadedRef.current) return;
    if (head.status !== "entwurf") return;
    voiceLoadedRef.current = true;
    void (async () => {
      const sd = await loadStammdatenForVoice();
      setVoiceStammdaten(sd);
    })();
  }, [loading, head.status]);

  // Auto-Open via URL: `?voice=1` oeffnet den Sprach-Dialog einmalig, sobald
  // der Beleg geladen ist (entwurf + leer). Der Param wird sofort entfernt,
  // damit ein Schliessen+Reload nicht erneut triggert.
  const voiceAutoOpenedRef = useRef(false);
  const voiceParam = sp.get("voice");
  useEffect(() => {
    if (loading) return;
    if (voiceAutoOpenedRef.current) return;
    if (voiceParam !== "1") return;
    if (head.status !== "entwurf" || builder.positions.length !== 0) return;
    voiceAutoOpenedRef.current = true;
    setVoiceDialogOpen(true);
    setSp(
      (prev) => { const next = new URLSearchParams(prev); next.delete("voice"); return next; },
      { replace: true },
    );
  }, [loading, head.status, builder.positions.length, voiceParam]); // eslint-disable-line react-hooks/exhaustive-deps

  // Bei Kundenwechsel im Entwurf die Konditionen neu vom Kunden ableiten (nicht beim Erst-Load).
  const condContactRef = useRef<string | null>(null);
  useEffect(() => {
    if (loading) return;
    const cid = head.contact_id || "";
    if (condContactRef.current === null) { condContactRef.current = cid; return; }
    if (condContactRef.current === cid) return;
    condContactRef.current = cid;
    if (head.status !== "entwurf") return;
    const cust = contacts.find((x) => x.id === cid) ?? null;
    setConditions(cust ? resolveDocumentConditions(cust, "out") : emptyDocumentConditions());
    builder.setDirty(true);
  }, [head.contact_id, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(nextStatus?: OfferStatus): Promise<boolean> {
    if (!offer) return false;
    savingRef.current = true;
    setSaving(true); setErr(null); setSaveStatus("saving");
    const status = nextStatus ?? head.status;
    // Standardaufschlag (intern/unsichtbar) einmalig in die Einzelpreise einrechnen.
    // Guard je Position (surcharge_baked) + Schutz manuell geänderter Preise.
    let positions = builder.positions;
    const surchargePct = Number(conditions.surchargePercent) || 0;
    if (surchargePct > 0) {
      positions = applySurchargeToPositions(positions, surchargePct);
      builder.setPositions(positions);
    }
    const condSave: DocumentConditions = { ...conditions, surchargeApplied: conditions.surchargeApplied || surchargePct > 0 };
    if (condSave.surchargeApplied !== conditions.surchargeApplied) setConditions(condSave);
    const s = computeSummary(positions, vatOverride, condSave.discountPercent);
    const typeBase = offerTypes.find((t) => t.id === head.offerTypeId)?.display ?? globalDisplay;
    const effectiveDisplay = resolveOfferDisplay(typeBase, { use_global_display: head.useGlobalDisplay, display: head.display });
    const { error } = await supabase.from("offers").update({
      // number wird bewusst NICHT mitgeschrieben: die Nummer vergibt ausschließlich
      // ensure_document_number beim Abschließen (kein Zurück-Nullen durch Autosave).
      title: head.title || null,
      contact_id: head.contact_id || null, project_id: head.project_id || null,
      status, notes: head.notes || null,
      offer_type_id: head.offerTypeId || null,
      offer_intro_text: head.introText || null,
      pre_positions_text: isEmptyHtml(head.prePositionsText) ? null : head.prePositionsText,
      offer_closing_text: head.notes || null,
      // Ab jetzt sind die Texte benutzergesteuert – Auto-Standardtexte greifen nicht erneut.
      texts_initialized: true,
      use_global_display: head.useGlobalDisplay,
      display: head.useGlobalDisplay ? null : head.display,
      display_settings_snapshot: effectiveDisplay,
      conditions_snapshot: conditionsToSnapshot(condSave),
      working_base_version_no: workingBaseVer,
      recipient_override: recipientOverride,
      vat_mode: head.vatMode,
      signature_source: head.signatureSource,
      items: positions, net: s.net, vat: s.vat, gross: s.gross,
    }).eq("id", offer.id);
    setSaving(false); savingRef.current = false;
    if (error) { setErr(error.message); setSaveStatus("error"); return false; }
    if (nextStatus) setHead((p) => ({ ...p, status: nextStatus }));
    builder.markSaved();
    setSaveStatus("saved");
    return true;
  }

  // ── Autosave: debounced bei jeder Änderung (kein manueller Speichern-Button) ──
  useEffect(() => {
    if (!offer || !builder.dirty) return;
    setSaveStatus("dirty");
    const t = setTimeout(() => { if (!savingRef.current) save(); }, 800);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [builder.dirty, builder.positions, head]);

  // ── Warnung beim Verlassen, wenn noch ungespeicherte Änderungen ──
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => { if (builder.dirty) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [builder.dirty]);

  // Frühere Version als Arbeitskopie übernehmen → beim erneuten Abschließen entsteht
  // eine NEUE Version (V1/V2 bleiben erhalten, nichts wird gelöscht).
  // Schritt 1: Bestätigung im App-Design (kein natives Popup) – Dialog öffnen.
  function restoreVersion(v: DocVersion) { setRestoreVer(v); }

  // Schritt 2: Nach Bestätigung den Snapshot als bearbeitbaren Arbeitsstand übernehmen,
  // PERSISTENT speichern (nicht nur State), Arbeitsstand-Basis vermerken + Audit/Logbuch.
  async function doRestore() {
    const v = restoreVer;
    if (!v || !offer) return;
    const d = (v.data || {}) as { head?: Record<string, any>; positions?: unknown };
    const h = d.head ?? {};
    const validType = offerTypes.some((t) => t.id === h.offerTypeId) ? h.offerTypeId : head.offerTypeId;
    setHead((p) => ({
      ...p,
      status: "entwurf" as OfferStatus,
      title: typeof h.title === "string" ? h.title : p.title,
      notes: typeof h.notes === "string" ? h.notes : p.notes,
      introText: typeof h.introText === "string" ? h.introText : p.introText,
      prePositionsText: typeof h.prePositionsText === "string" ? h.prePositionsText : p.prePositionsText,
      vatMode: h.vatMode === "par19" || h.vatMode === "standard" ? h.vatMode : p.vatMode,
      offerTypeId: validType,
    }));
    if (Array.isArray(d.positions)) builder.reset(normalizePositions(d.positions));
    builder.setDirty(true);
    setWorkingBaseVer(v.version_no);
    setVersionsOpen(false);
    setRestoreVer(null);
    // Persistieren: save() schreibt Positionen/Texte + working_base_version_no in die DB.
    const ok = await save("entwurf");
    if (!ok) { toastError("Wiederherstellen fehlgeschlagen – bitte erneut versuchen."); return; }
    if (head.project_id) await logProject(head.project_id, "angebot", `Version V${v.version_no} als Arbeitsstand wiederhergestellt`, offer.id);
    toast(`Version V${v.version_no} wurde als Arbeitsstand wiederhergestellt.`);
  }

  // Abgeschlossenes Angebot bewusst zur Korrektur entsperren (erzeugt beim Abschließen eine neue Version).
  async function reopenForCorrection() {
    if (!offer) return;
    setReopenOpen(false);
    await save("entwurf");
    setHead((p) => ({ ...p, status: "entwurf" as OfferStatus }));
    await logReopen("offer", offer.id, `Angebot ${head.number || ""} zur Korrektur entsperrt`);
    if (head.project_id) await logProject(head.project_id, "angebot", `Angebot ${head.number || ""} zur Korrektur entsperrt – neue Version beim Abschließen`, offer.id);
  }

  const isClosed = head.status !== "entwurf";

  // Auto-Korrektur: aus dem Canvas (erste Umreihung/Bearbeitung eines abgeschlossenen Angebots)
  // ausgelöst. Erzeugt revisionssicher einen Korrekturstand (Status→Entwurf, Bezug auf die letzte
  // Version). Alte Version + PDF-Snapshot bleiben; neue Version entsteht erst beim Abschließen.
  async function beginCorrection(): Promise<boolean> {
    if (!offer) return false;
    if (head.status === "entwurf") return true;
    try {
      let baseVer: number | null = workingBaseVer;
      try {
        const vs = await loadDocumentVersions("offer", offer.id);
        const maxV = vs.reduce((m, v) => Math.max(m, v.version_no || 0), 0);
        if (maxV > 0) baseVer = maxV;
      } catch { /* ignore */ }
      setWorkingBaseVer(baseVer);
      setHead((p) => ({ ...p, status: "entwurf" as OfferStatus }));
      const ok = await save("entwurf");
      if (!ok) return false;
      // working_base_version_no zuverlässig persistieren (save() kann den frischen State noch nicht sehen).
      if (baseVer != null) await supabase.from("offers").update({ working_base_version_no: baseVer }).eq("id", offer.id);
      await logReopen("offer", offer.id, `Angebot ${head.number || ""} zur Korrektur entsperrt (Umreihung/Bearbeitung)`);
      if (head.project_id) await logProject(head.project_id, "angebot", `Angebot ${head.number || ""} zur Korrektur entsperrt – neue Version beim Abschließen`, offer.id);
      return true;
    } catch { return false; }
  }

  // Angebot abschließen (optional anschließend versenden)
  async function closeOffer(thenSend: boolean) {
    if (!offer) return;
    const wasClosed = head.status !== "entwurf";
    // Fachliche Nummer JETZT atomar sicherstellen (Entwürfe haben keine): idempotent –
    // Re-Finalize/Korrekturversionen behalten ihre bestehende Nummer, es entsteht keine neue.
    const ensured = await ensureDocumentNumber("offer", offer.id);
    if (!ensured.number) {
      setErr(ensured.error ?? "Angebotsnummer konnte nicht vergeben werden.");
      setCloseOpen(false);
      return;
    }
    const docNumber = ensured.number;
    if (head.number !== docNumber) setHead((p) => ({ ...p, number: docNumber }));
    await save("abgeschlossen");
    // Dokumentdatum = Abschlussdatum: bei JEDEM Abschluss neu stempeln (auch Re-Finalize →
    // neue Version bekommt neues Datum; alte Snapshots bleiben unverändert).
    const closedAt = finalizeStamp().iso;
    // Mit dem Abschluss endet der wiederhergestellte Arbeitsstand – die neue Version ersetzt ihn.
    await supabase.from("offers").update({ closed_at: closedAt, working_base_version_no: null }).eq("id", offer.id);
    setWorkingBaseVer(null);
    setOffer((o) => (o ? { ...o, status: "abgeschlossen", closed_at: closedAt } : o));

    // Laufzeit-Versionierung: bei aktiver Versionierung unveränderlichen Snapshot (V1, V2, …) anlegen
    if (angeboteDocType?.versioning_enabled && snapshotRef.current) {
      let printHtml: string | null = null;
      if (angeboteDocType.create_pdf_snapshot_on_finalize) {
        try {
          // Snapshot mit Abschlussdatum + frisch vergebener Nummer rendern (der Ref wurde
          // durch den Re-Render nach setHead bereits aktualisiert; Override als Absicherung).
          printHtml = await renderDocumentHtml(
            snapshotRef.current.positions, snapshotRef.current.summary,
            { ...snapshotRef.current.meta, number: docNumber, date: dateAt(closedAt) });
        } catch { /* Druckstand optional */ }
      }
      await finalizeDocumentVersion({
        sourceTable: "offer", sourceId: offer.id, status: "abgeschlossen",
        title: head.title || null, docNumber,
        data: { head: { ...head, number: docNumber }, positions: snapshotRef.current.positions },
        summary: snapshotRef.current.summary, printHtml,
        withAudit: angeboteDocType.audit_log_enabled,
        auditDetail: `Angebot ${docNumber} abgeschlossen`,
        finalizedByName: profile?.name ?? session?.user.email ?? null,
      });
    }

    setCloseOpen(false);

    // Auto-Akzeptanz UNABHÄNGIG vom Versandweg ausführen, damit sie für „Nur abschließen"
    // UND „Abschließen und versenden" greift (der thenSend-Zweig returnt sonst früh, bevor die
    // Übernahme liefe – Codex-Finding #89). Bei mehreren möglichen Aufträgen öffnet sich der
    // Auswahl-Dialog → dann NICHT verlassen und keinen Versand-Dialog darüberlegen.
    const supplementDialogOpen = await autoAcceptSupplementOnFinalize();

    if (thenSend && !supplementDialogOpen) {
      // Versand-Dialog zuerst; Navigation erst nach Versand/Abbruch (confirmSend/cancelSend).
      pendingWasClosed.current = wasClosed;
      setSendOpen(true);
      return;
    }
    if (head.project_id && !wasClosed) {
      await logProject(head.project_id, "angebot", `Angebot ${docNumber} abgeschlossen`, offer.id);
    }
    if (supplementDialogOpen) return;
    leaveAfterFinalize();
  }

  // Versand bestätigen: Wenn Microsoft-Konto verbunden ist, echten E-Mail-Versand
  // über /api/microsoft/mail-send fahren (inkl. PDF-Anhang). Sonst: nur "als
  // versendet markieren" – der SendDialog gibt den User über den Info-Banner
  // ohnehin einen Hinweis auf die Integrations-Einstellungen.
  //
  // WICHTIG: Der PDF-Anhang wird OPTIONAL angehängt. Schlägt das PDF-Rendering
  // fehl (503 – kein Server-Key, 429 – Rate-Limit, 502 – Dienst unerreichbar),
  // versenden wir die Mail trotzdem OHNE Anhang und toasten einen Hinweis –
  // besser als das Angebot gar nicht zu verschicken. Das ist Absicht (MVP).
  async function confirmSend(input: {
    to: string;
    cc: string;
    bcc: string;
    subject: string;
    html: string;
  }) {
    if (!offer) return;

    // Ohne Microsoft-Anbindung: Verhalten wie bisher (Angebot als "versendet"
    // markieren, kein Netzwerk-Versand). Der Info-Banner im Dialog erklärt es
    // dem User schon vorher.
    if (!microsoft.connected) {
      await save("versendet");
      await supabase.from("offers").update({ sent_at: new Date().toISOString(), sent_by: session?.user.id ?? null }).eq("id", offer.id);
      setOffer((o) => (o ? { ...o, status: "versendet" } : o));
      if (head.project_id) await logProject(head.project_id, "angebot", `Angebot ${head.number || "(Entwurf)"} abgeschlossen und versendet`, offer.id);
      setSendOpen(false);
      leaveAfterFinalize();
      return;
    }

    // Empfänger-Parsing (Komma/Semikolon getrennt, wie Outlook). Leere Adressen
    // werden verworfen; ein leeres to-Feld führt zu einer Fehlermeldung, ohne
    // die Mail zu schicken.
    const parseRecipients = (s: string): { address: string }[] =>
      String(s || "")
        .split(/[,;]/)
        .map((v) => v.trim())
        .filter(Boolean)
        .map((address) => ({ address }));

    const to = parseRecipients(input.to);
    if (to.length === 0) {
      toastError("Bitte mindestens eine Empfänger-Adresse angeben.");
      return;
    }
    const cc = parseRecipients(input.cc);
    const bcc = parseRecipients(input.bcc);

    setSaving(true);
    try {
      // PDF optional: aktuellen Druck-Snapshot in echtes PDF rendern. Bei
      // Fehler NICHT abbrechen – Mail geht ohne Anhang raus (MVP-Kompromiss,
      // klarer Toast an den User). Der Snapshot ist beim Öffnen des
      // SendDialogs stets aktuell (wird oben im Render aufgebaut).
      let attachments: { name: string; mime: string; base64: string }[] | undefined;
      const snap = snapshotRef.current;
      if (snap) {
        try {
          const html = await renderDocumentHtml(snap.positions, snap.summary, snap.meta);
          // Persistenter PDF-Cache (Live-Stand): identisches HTML wie „PDF ansehen" →
          // kein doppelter PDFShift-Lauf für Vorschau + Mail-Anhang.
          const pdfRes = await htmlToPdfBlob(html, { sourceTable: "offer", sourceId: offer.id, versionNo: 0 });
          if ("blob" in pdfRes) {
            const buf = await pdfRes.blob.arrayBuffer();
            const bytes = new Uint8Array(buf);
            let bin = "";
            for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
            const base64 = btoa(bin);
            const name = buildDocumentPdfFileName({
              number: head.number,
              baseLabel: snap.meta?.docLabel || "Angebot",
            });
            attachments = [{ name, mime: "application/pdf", base64 }];
          } else {
            // Kein PDF – wir schicken die Mail trotzdem. Klarer Toast, damit der
            // Absender das entdeckt und ggf. später manuell nachschickt.
            toastError(`Angebot wird ohne PDF-Anhang versendet (${pdfRes.error.message}).`);
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          toastError(`Angebot wird ohne PDF-Anhang versendet (${msg}).`);
        }
      }

      // Eigentlicher Versand über den Microsoft-Graph-Proxy. Backend loggt
      // in microsoft_mail_audit_log (inkl. related_offer_id via documentContext).
      await sendMail({
        to,
        cc: cc.length ? cc : undefined,
        bcc: bcc.length ? bcc : undefined,
        subject: input.subject,
        html: input.html,
        attachments,
        documentContext: { kind: "offer", id: offer.id },
      });

      // DB-Status auf "versendet" ziehen – erst nach erfolgreichem Graph-Call,
      // damit ein Fehler nicht in einem Zwitterzustand endet.
      await save("versendet");
      await supabase.from("offers").update({ sent_at: new Date().toISOString(), sent_by: session?.user.id ?? null }).eq("id", offer.id);
      setOffer((o) => (o ? { ...o, status: "versendet" } : o));
      if (head.project_id) {
        await logProject(head.project_id, "angebot", `Angebot ${head.number || "(Entwurf)"} abgeschlossen und versendet`, offer.id);
      }
      toast("Angebot wurde per E-Mail versendet.");
      setSendOpen(false);
      leaveAfterFinalize();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toastError(`Versand fehlgeschlagen: ${msg}`);
    } finally {
      setSaving(false);
    }
  }
  function cancelSend() {
    // Abschluss ist bereits erfolgt → nur „abgeschlossen" protokollieren (wenn neu)
    if (head.project_id && !pendingWasClosed.current) {
      logProject(head.project_id, "angebot", `Angebot ${head.number || "(Entwurf)"} abgeschlossen`, offer?.id);
    }
    setSendOpen(false);
    leaveAfterFinalize();
  }

  // Kontextsensitiv zurück: in ein Projekt-Angebot → zurück zum Projekt (Dokumente),
  // sonst zurück in der Historie. KEINE projektübergreifende Gesamtliste mehr.
  const goBack = () => (head.project_id ? nav(`/projekte/${head.project_id}`) : nav(-1));

  // Nach erfolgreichem Abschluss zurück in den passenden Projektbereich (Angebote – auch
  // für Nachträge, die als Angebot geführt werden). Sidebar-Reiter wird vorab gemerkt, das
  // Projekt remountet → Listen/Beträge/Versionen sind frisch. Ohne Projekt: normale Historie.
  const leaveAfterFinalize = () => {
    if (head.project_id) rememberProjectSection(head.project_id, "angebote");
    goBack();
  };

  async function deleteDraft() {
    if (!offer) return;
    const { error } = await softDeleteDocument("offer", offer.id, session?.user.id ?? null);
    if (error) { setErr(error); return; }
    goBack();
  }

  // Angebot duplizieren (neue Angebots-ID, Status „entwurf", neue Nummer über Nummernkreis).
  async function duplicate() {
    if (!offer) return;
    // Angebot-Nachträge dürfen NICHT über diesen Weg kopiert werden: der Pfad vergibt eine
    // Angebots-Nummer und lässt kind/related_order_id weg → aus einem Nachtrag würde stillschweigend
    // ein normales Angebot (falscher Nummernkreis, kaputter Nachtrag-Workflow). Menüpunkt ist für
    // Nachträge ausgeblendet; diese Prüfung sichert zusätzlich ab.
    if ((offer as any)?.kind === "nachtrag") {
      window.alert("Ein Angebot-Nachtrag kann nicht über „Kopieren“ dupliziert werden.");
      return;
    }
    // Kopieren legt ein NEUES Angebot an (insert) → Erstellrecht serverseitig wie im
    // normalen Anlage-Flow voraussetzen (nicht nur über das ausgeblendete Menü absichern).
    if (!can("offers", "create")) { window.alert("Keine Berechtigung zum Anlegen eines Angebots."); return; }
    // Kopie = neuer Entwurf OHNE Nummer (Vergabe erst beim Abschließen).
    const { data: newOffer, error } = await supabase.from("offers").insert({
      number: null,
      title: `${head.title || "Angebot"} (Kopie)`,
      contact_id: head.contact_id || null, project_id: head.project_id || null,
      status: "entwurf", notes: head.notes || null,
      offer_type_id: head.offerTypeId || null,
      offer_intro_text: head.introText || null,
      pre_positions_text: isEmptyHtml(head.prePositionsText) ? null : head.prePositionsText,
      offer_closing_text: head.notes || null,
      use_global_display: head.useGlobalDisplay,
      display: head.useGlobalDisplay ? null : head.display,
      display_settings_snapshot: (offer as any).display_settings_snapshot ?? null,
      conditions_snapshot: conditionsToSnapshot(conditions),
      items: builder.positions, net: builder.summary.net, vat: builder.summary.vat, gross: builder.summary.gross,
      texts_initialized: true,
    }).select("id").single();
    if (error || !newOffer) { setErr(error?.message ?? "Fehler beim Kopieren"); return; }
    nav(docPath("offer", newOffer.id, null));
  }

  // Echte Konversion Angebot → Auftrag über die zentrale Dokumentketten-Engine (setzt source_*,
  // Doppelbeauftragungsschutz). Nur für finalisierte Nicht-Nachtrags-Angebote mit Projekt;
  // Nachträge nutzen „Zum Auftrag hinzufügen".
  async function createOrderFromThis() {
    if (!offer || !head.project_id) return;
    if (!can("orders", "create")) { window.alert("Keine Berechtigung zum Erstellen von Aufträgen."); return; }
    // Eine evtl. noch laufende Autosave-Speicherung ZUERST abwarten – sonst konkurrieren zwei
    // save()-Vorgänge und der Auftrag könnte aus einem veralteten Zwischenstand entstehen (Race).
    for (let waited = 0; savingRef.current && waited < 5000; waited += 100) {
      await new Promise((r) => setTimeout(r, 100));
    }
    // Danach die offenen Änderungen als EINZIGE, autoritative Speicherung persistieren, sonst
    // würde aus einem veralteten Snapshot konvertiert (falsche Positionen/Titel, Quellverweise).
    const saved = await save();
    if (!saved) { window.alert("Bitte zuerst speichern – Auftrag wurde nicht erstellt."); return; }
    // Das frisch gespeicherte Angebot neu laden und DARAUS konvertieren – so nutzt
    // createOrderFromOffers garantiert den AKTUELLEN Stand (Positionen, Titel, Variante/
    // offer_type_id, display_settings_snapshot, pre_positions_text), nicht einen veralteten Snapshot.
    const { data: fresh, error: reloadErr } = await supabase.from("offers").select("*").eq("id", offer.id).maybeSingle();
    if (reloadErr || !fresh) { window.alert(reloadErr?.message ?? "Angebot konnte nicht neu geladen werden – Auftrag nicht erstellt."); return; }
    const c = canConvertOffer(fresh as any);
    if (!c.ok) { window.alert(c.reason); return; }
    const r = await createOrderFromOffers({ projectId: head.project_id, contactId: (fresh as any).contact_id ?? head.contact_id ?? null, offers: [fresh] });
    if (r.error) { window.alert(r.error); return; }
    if (head.project_id) await logProject(head.project_id, "auftrag", `Auftrag ${r.number || ""} aus Angebot ${head.number || ""} erstellt`, offer.id);
    if (r.id) nav(docPath("order", r.id, r.number));
  }

  // Direktweg: aus diesem Angebot SOFORT eine Rechnung erstellen. Im Hintergrund wird
  // (wie beim manuellen Weg) ein Auftrag miterzeugt, damit die Kette lückenlos bleibt
  // und §19/Snapshots/Quellverweise korrekt übernommen werden.
  async function createInvoiceFromThis() {
    if (!offer) return;
    if (!can("invoices", "create")) { window.alert("Keine Berechtigung zum Erstellen von Rechnungen."); return; }
    for (let waited = 0; savingRef.current && waited < 5000; waited += 100) {
      await new Promise((r) => setTimeout(r, 100));
    }
    const saved = await save();
    if (!saved) { window.alert("Bitte zuerst speichern – Rechnung wurde nicht erstellt."); return; }
    const { data: fresh, error: reloadErr } = await supabase.from("offers").select("*").eq("id", offer.id).maybeSingle();
    if (reloadErr || !fresh) { window.alert(reloadErr?.message ?? "Angebot konnte nicht neu geladen werden – Rechnung nicht erstellt."); return; }
    const c = canConvertOffer(fresh as any);
    if (!c.ok) { window.alert(c.reason); return; }
    const r = await createInvoiceFromOffer(fresh, { projectId: head.project_id, contactId: (fresh as any).contact_id ?? head.contact_id ?? null });
    if (r.error) { window.alert(r.error); return; }
    if (head.project_id) {
      await logProject(head.project_id, "rechnung", `Rechnung ${r.number || ""} direkt aus Angebot ${head.number || ""} erstellt (Auftrag ${r.orderNumber || ""})`, offer.id);
    }
    if (r.id) nav(docPath("invoice", r.id, r.number));
  }

  if (loading) return <div className="pt-4"><Spinner /></div>;
  if (!offer || (offer as any).deleted_at) return (
    <div className="pt-4">
      <button className="btn-ghost mb-4" onClick={() => nav(-1)}><ArrowLeft size={16} /> Zurück</button>
      <ErrorBanner message={DELETE_GONE_TEXT} />
    </div>
  );

  const customer = contacts.find((c) => c.id === head.contact_id);
  const customerName = contactDisplayName(customer ?? null, { fallback: "" });
  const project = projects.find((p) => p.id === head.project_id) || null;
  // Kunde des PROJEKTS (für den Projektkontext im Kopf – wie in der Projektakte).
  const projectCustomerName = contactDisplayName(
    contacts.find((c) => c.id === project?.contact_id) ?? null, { fallback: "" });
  // Zentrale, getrimmte Einzeiler-Adresse (kein Leerzeichen vor dem Komma) – keine lokale Duplikat-Logik.
  const address = formatAddressInline(project) || formatAddressInline(customer);
  // Nachtrag vs. normales Angebot (steuert Zahlungskonditionen-Sichtbarkeit + Übernahme-Logik).
  const isNachtrag = (offer as any)?.kind === "nachtrag";
  const showPayment = showPaymentForDoc(isNachtrag ? "nachtrag" : "angebot");

  // Dokumentdatum: finalisiert → Abschlussdatum (closed_at); Entwurf → Erstelldatum
  // (Vorschau). So zeigt das finale Angebot/PDF das Abschlussdatum, nicht das Erstelldatum.
  const offerDocDate = head.status !== "entwurf" && offer.closed_at ? offer.closed_at : offer.created_at;

  // ── Angebotstyp: Ableitungen für Darstellung + PDF ──
  const selectedType = offerTypes.find((t) => t.id === head.offerTypeId) ?? null;
  const typeBaseDisplay = selectedType?.display ?? globalDisplay;
  const docLabel = selectedType?.pdf_label || "Angebot";
  const effDisplay = resolveOfferDisplay(typeBaseDisplay, { use_global_display: head.useGlobalDisplay, display: head.display });
  // ── Textbausteine: Kontext, Platzhalter, Rich-Text für PDF ──
  const subtypeId = docSubtypes.find((s) => s.document_type_id === angeboteDocTypeId && s.slug === selectedType?.slug)?.id ?? null;
  const projectTypeId = projTypeRows.find((x) => x.slug === (project as any)?.category)?.id ?? null;
  const textCtx: MatchContext = {
    documentTypeId: angeboteDocTypeId, documentSubtypeId: subtypeId,
    projectTypeId, customerType: customer?.customer_type ?? null, language: "de",
  };
  const phValues = buildPhValues(customer ?? null, project, offer, docLabel, company, profile?.name ?? "", conditions);
  const phApply = (s: string) => applyPlaceholders(s, phValues, { markMissing: false }).html;
  const introHtml = head.introText
    ? phApply(looksLikeHtml(head.introText) ? head.introText : plainToHtml(head.introText))
    : undefined;
  const closingHtml = withParagraph19Note(
    head.notes ? phApply(looksLikeHtml(head.notes) ? head.notes : plainToHtml(head.notes)) : undefined,
    head.vatMode === "par19",
  );
  const prePositionsHtml = !isEmptyHtml(head.prePositionsText)
    ? phApply(looksLikeHtml(head.prePositionsText) ? head.prePositionsText : plainToHtml(head.prePositionsText))
    : undefined;
  // Rechtstext + Zahlungsbedingung (passende Standardtexte) → unter den Nachtext
  const legalParts: string[] = [];
  // Zahlungsbedingungs-Textbaustein nur bei Dokumenttypen mit Zahlungskonditionen
  // (Nachtrag/Auftrag/Rechnung) – ein normales Angebot zeigt keine Zahlungskonditionen.
  const zb = showPayment ? pickBestText(textBlocks, "zahlungsbedingung", textCtx, true).block : null;
  const rt = pickBestText(textBlocks, "rechtstext", textCtx, true).block;
  if (zb) legalParts.push(phApply(blockHtml(zb)));
  if (rt) legalParts.push(phApply(blockHtml(rt)));
  const legalHtml = legalParts.length ? legalParts.join("") : undefined;

  // Aktueller Druckstand für Versions-Snapshots (wird bei Abschluss verwendet)
  snapshotRef.current = {
    positions: builder.positions,
    summary: builder.summary,
    meta: {
      docLabel, vatLabel,
      footerNote: selectedType?.footer_text ?? undefined,
      showPageNumbers: selectedType?.show_page_numbers ?? true,
      number: head.number, title: head.title, customer: customerName,
      date: dateAt(offerDocDate), introHtml, prePositionsHtml, closingHtml, legalHtml,
      projectNumber: project?.project_number ?? null,
      projectAddress: address || null,
      display: effDisplay,
      payment: showPayment ? conditionsToPaymentMeta(conditions) : undefined,
      recipientLines: resolveRecipientLines(recipientOverride, customer),
      createdBy: head.createdBy || null,
      signatureSource: head.signatureSource,
    },
  };

  const activeTypes = offerTypes.filter((t) => t.is_active || t.id === head.offerTypeId);

  // Typ anwenden (übernimmt Texte + Standard-Darstellung des Typs)
  function applyType(t: OfferType) {
    setHead((p) => ({
      ...p,
      offerTypeId: t.id,
      introText: t.intro_text ?? "",
      notes: t.closing_text ?? "",
      useGlobalDisplay: true,
      display: t.display,
    }));
    builder.setDirty(true);
    setTypeChange(null);
  }

  // ── Angebot-Nachtrag → Positionen einem BESTEHENDEN Auftrag hinzufügen (kein neuer Auftrag) ──

  // Aktive Aufträge des Projekts (mögliche Bezugsaufträge für die Nachtrags-Übernahme).
  async function findSupplementOrders(): Promise<{ id: string; order_number: string | null }[]> {
    if (!head.project_id) return [];
    const { data } = await supabase.from("orders").select("id, order_number")
      .eq("project_id", head.project_id).is("deleted_at", null)
      .neq("status", "storniert").neq("status", "archiviert").neq("status", "entwurf");
    return (data ?? []) as { id: string; order_number: string | null }[];
  }

  // Zentrale Übernahme in einen konkreten Auftrag (serverseitiger Schutz steckt in addSupplementToOrder).
  async function doAddSupplement(orderId: string, opts: { navigate?: boolean } = {}) {
    if (!offer) return;
    const r = await addSupplementToOrder({ supplementOfferId: offer.id, orderId });
    if (r.error) { toastError(r.error); return; }
    if (head.project_id) {
      await logProject(head.project_id, "auftrag",
        `Nachtrag ${head.number || ""} dem Auftrag ${r.orderNumber || ""} hinzugefügt – ${r.count} Position(en), netto ${eur(r.net ?? 0)}.`, offer.id);
    }
    setHead((p) => ({ ...p, status: "in_auftrag_uebernommen" as OfferStatus }));
    setOrderChoices(null);
    toast(`Nachtrag in Auftrag ${r.orderNumber || ""} übernommen (${r.count} Position(en)).`);
    if (opts.navigate !== false) nav(docPath("order", orderId, r.orderNumber));
  }

  // Manuelle Aktion „Zum Auftrag hinzufügen": eindeutig → direkt; mehrere → Auswahl-Dialog; keiner → Hinweis.
  async function addToOrder() {
    if (!offer) return;
    if (head.status === "in_auftrag_uebernommen") { window.alert("Dieser Nachtrag wurde bereits in einen Auftrag übernommen."); return; }
    if (!["abgeschlossen", "versendet", "angenommen"].includes(head.status)) {
      window.alert("Bitte den Nachtrag zuerst abschließen/annehmen, bevor er in einen Auftrag übernommen wird.");
      return;
    }
    const direct = (offer as any).related_order_id as string | null;
    if (direct) { await doAddSupplement(direct); return; }
    const ords = await findSupplementOrders();
    if (ords.length === 0) {
      window.alert("Für diesen Nachtrag ist noch kein bestehender Auftrag vorhanden. Bitte zuerst einen Auftrag erstellen oder zuordnen.");
      return;
    }
    if (ords.length === 1) { await doAddSupplement(ords[0].id); return; }
    setOrderChoices(ords); // mehrere mögliche Aufträge → Auswahl-Dialog
  }

  // Auto-Akzeptanz nach dem Finalisieren eines Nachtrags (Kunde mit auto_accept_supplements).
  // Eindeutiger Auftrag → automatisch übernehmen; mehrere → Auswahl-Dialog; keiner → still (manueller Weg bleibt).
  // Rückgabe: true, wenn ein Auswahl-Dialog geöffnet wurde (dann Editor nicht verlassen).
  async function autoAcceptSupplementOnFinalize(): Promise<boolean> {
    if (!offer || !isNachtrag || !customer?.auto_accept_supplements) return false;
    if (head.status === "in_auftrag_uebernommen") return false; // bereits übernommen → nichts tun
    const direct = (offer as any).related_order_id as string | null;
    const ords = direct ? [{ id: direct, order_number: null }] : await findSupplementOrders();
    if (ords.length === 1) { await doAddSupplement(ords[0].id, { navigate: false }); return false; }
    if (ords.length > 1) { setOrderChoices(ords); return true; }
    return false;
  }

  // Konversion am AKTUELLEN Editor-Status prüfen (entsperrte Korrekturversion = „entwurf" →
  // nicht konvertierbar) und zusätzlich das Erstellrecht für Aufträge verlangen.
  const offerNow = { ...(offer as any), status: head.status };
  const offerMoreActions = buildDocumentMoreActions({
    kind: "offer",
    canCopy: !isNachtrag && can("offers", "create"),
    canDelete: isDeletable("offer", offer) && can("offers", "delete"),
    canCreateOrder: !isNachtrag && !!head.project_id && can("orders", "create") && canConvertOffer(offerNow).ok,
    // Direktweg Angebot → Rechnung (Auftrag wird im Hintergrund miterzeugt). Kein Projekt nötig.
    canCreateInvoice: !isNachtrag && can("invoices", "create") && canConvertOffer(offerNow).ok,
    // Duplikat-Schutz: existiert bereits ein aktiver Auftrag aus diesem Angebot,
    // wird „Auftrag erstellen" deaktiviert + „Zum Auftrag wechseln" angeboten.
    existingOrderNumber: !isNachtrag && existingOrder ? (existingOrder.order_number || "ohne Nummer") : null,
    onGoToOrder: existingOrder ? () => nav(docPath("order", existingOrder.id, existingOrder.order_number)) : undefined,
    onCopy: duplicate,
    onCreateOrder: createOrderFromThis,
    onCreateInvoice: createInvoiceFromThis,
    onDelete: () => setDelOpen(true),
  });

  // ── KI-Aktionen ────────────────────────────────────────────────────────────
  // Regeln:
  //   1) status=entwurf → beide KI-Buttons (Voice-Komplettangebot + Einzelposition).
  //      Voice-Komplettangebot ist auch bei bestehenden Positionen verfuegbar —
  //      neue Positionen werden ANGEHAENGT (siehe applyVoiceResult). Das Label
  //      bekommt einen "anfuegen"-Hinweis sobald schon Positionen drin sind,
  //      damit klar ist dass nichts ueberschrieben wird.
  //   2) Versendet/abgeschlossen/etc. → KEINE KI-Buttons.
  // Nachtraege folgen demselben Gating (status reicht).
  function buildAiActions(): { label: string; onClick: () => void }[] {
    const isWorkableDraft = head.status === "entwurf";
    if (!isWorkableDraft) return [];
    const isEmptyDraft = builder.positions.length === 0;
    const labels = aiDocActionLabels(isNachtrag ? "nachtrag" : "angebot", selectedType?.name);
    // labels[0] = "+ KI Leistung"            → Einzelposition (Stub Phase 5)
    // labels[1] = "+ KI <Variant><Dokument>" → Voice-Komplettangebot
    const leistungLabel = labels[0] ?? "+ KI Leistung";
    const voiceLabelBase = labels[1] ?? "+ KI Komplettangebot";
    const voiceLabel = isEmptyDraft ? voiceLabelBase : `${voiceLabelBase} anfügen`;
    return [
      { label: voiceLabel, onClick: () => setVoiceDialogOpen(true) },
      { label: leistungLabel, onClick: () => setAddPositionDialogOpen(true) },
    ];
  }

  /**
   * Übernimmt das KI-generierte Angebot in den Editor:
   *   - Gewerke → DocPositionen via heroToDocPositions (nutzt Stamm-Services falls
   *     gefunden, sonst free-Positionen mit den von der KI gelieferten Preisen).
   *   - Meta (Betreff/Adresse) in den Editor-Head spielen, wenn jeweils noch
   *     leer; bestehende User-Eingaben werden NICHT überschrieben.
   *   - Modal schliessen + Erfolgs-Toast.
   * Autosave läuft danach automatisch (builder ist dirty).
   */
  function applyVoiceResult(gewerke: Gewerk[], meta: VoiceAngebotDialogMeta) {
    const docPositions = heroToDocPositions(gewerke, { services: buildSvcLookup(voiceStammdaten.services) });
    if (docPositions.length === 0) {
      toastError("Die KI hat keine Positionen erzeugt. Bitte erneut versuchen.");
      return;
    }
    // setPositions in einem Aufruf statt N x append() im Loop:
    // React batcht setState-Aufrufe in einem Tick, wodurch der latestRef in
    // append() stale wuerde und nur die letzte Position uebrigbliebe.
    // setPositions setzt das gesamte Array atomar (siehe useDocumentBuilder).
    builder.setPositions([...builder.positions, ...docPositions]);

    // Title + Notizen aus Voice-Meta uebernehmen.
    //   - title: nur fuellen wenn aktuell leer (User-Eingaben nicht ueberschreiben)
    //   - Ergaenzungen/Hinweise: angehaengt an die Notizen via mergeVoiceNotes()
    // Adresse wird hier NICHT mehr beruehrt — sie kommt automatisch ueber
    // den im Pre-Step-Modal gewaehlten Kunden (contact_id).
    setHead((prev) => ({
      ...prev,
      title: prev.title?.trim() ? prev.title : (meta.betrifft ?? prev.title),
      notes: mergeVoiceNotes(prev.notes, meta),
    }));
    setVoiceDialogOpen(false);
    toast(`Angebot mit ${docPositions.length} Position(en) erzeugt.`);
    // Prüf-Hinweise prominent zeigen (zusätzlich stehen sie in den Notizen).
    const pruefen = (meta.hinweise ?? []).filter((h) => h.trim().length > 0);
    if (pruefen.length > 0) setVoiceHints(pruefen);
  }

  /**
   * Übernimmt die per "+ KI Leistung" erzeugten DocPositionen in den Editor:
   * ANHÄNGEN via setPositions in EINEM Aufruf statt N × append() im Loop —
   * React batcht setState, wodurch append() nur die letzte Position behielte
   * (gleiches Muster wie applyVoiceResult). Autosave läuft danach automatisch.
   */
  function applyAddPositionResult(positions: DocPosition[]) {
    if (positions.length === 0) {
      toastError("Die KI hat keine Position erzeugt. Bitte erneut versuchen.");
      return;
    }
    builder.setPositions([...builder.positions, ...positions]);
    setAddPositionDialogOpen(false);
    // Gewerk-Titelzeilen nicht mitzählen – der User hat Leistungen diktiert.
    const count = positions.filter((p) => p.type !== "title").length || positions.length;
    toast(`${count} Position(en) hinzugefügt.`);
  }

  return (
    <div className="pt-1">
      {/* Kopfzeile: Infozeile (links) + Status/Aktionen (rechts) – in EINER Zeile (spart oben Platz).
          Zurück-Button nur für freistehende Dokumente (ohne Projekt); bei Projektdokumenten
          übernimmt „Zum Projekt" in der Toolbar die Rücknavigation. */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        {/* Links: Zurück (nur freistehend) + Typ-Badge + Orientierungs-Chips */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {!head.project_id && (
            <button className="btn-ghost px-2" onClick={goBack}><ArrowLeft size={16} /> Zurück</button>
          )}
          <span className="inline-flex items-center rounded-lg px-2 py-1 font-semibold text-white"
            style={{ background: "linear-gradient(135deg,var(--accent),var(--accent-h))" }}>{isNachtrag ? "Angebot Nachtrag" : (selectedType?.name || "Angebot")}</span>
          {isNachtrag && (offer as any)?.related_order_id && (
            <span className="inline-flex items-center rounded-lg border px-2 py-1 text-slate-500" style={{ borderColor: "var(--border)" }}>Bezug: bestehender Auftrag</span>
          )}
          {project ? (
            // Ausführlicher Projektkontext – zentral, identisch zur Projektakte.
            // Kunde: Projekt-Kontakt, sonst Beleg-Kunde (Projekt kann ohne Kontakt sein).
            <ProjectContextChips project={project} customerName={projectCustomerName || customerName} />
          ) : (
            <>
              <InfoChip label="Adresse" value={address || "–"} />
              <InfoChip label="Betreff" value={head.title || "–"} />
              <InfoChip label="Kunde" value={customerName || "–"} />
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={OFFER_STATUS_TONE[head.status]}>{OFFER_STATUS_LABEL[head.status]}</Badge>
          {workingBaseVer != null && (
            <span className="inline-flex items-center rounded-lg border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300"
              title="Dies ist ein bearbeitbarer Arbeitsstand auf Basis einer früheren Version – nicht die alte Version selbst. Beim Abschließen entsteht eine neue Version.">
              Arbeitsstand aus V{workingBaseVer}
            </span>
          )}
          {isClosed && can("offers", "update") && (
            <button className="btn-outline whitespace-nowrap px-2 py-1 text-xs" title="Abgeschlossenes Angebot zur Korrektur entsperren – beim Abschließen entsteht eine neue Version"
              onClick={() => setReopenOpen(true)}>
              <Unlock size={14} /> Korrekturversion
            </button>
          )}
          {isNachtrag && head.status !== "in_auftrag_uebernommen" && (
            <button className="btn-outline whitespace-nowrap px-2 py-1 text-xs" title="Nachtrag in den bestehenden Auftrag übernehmen" onClick={addToOrder}>
              <ClipboardList size={14} /> Zum Auftrag hinzufügen
            </button>
          )}
          <button className="btn-ghost px-2" title="Angebotseinstellungen" onClick={() => setSettingsOpen(true)}>
            <Settings size={16} />
          </button>
        </div>
      </div>
      <ErrorBanner message={err} />

      <DocumentWorkspace
        builder={builder}
        docType="angebot"
        docLabel={docLabel}
        numberLabel="Angebot"
        projectId={head.project_id || null}
        sourceTable="offer"
        sourceId={offer.id}
        vatOverride={vatOverride}
        vatLabel={vatLabel}
        printMeta={{
          footerNote: selectedType?.footer_text ?? undefined,
          showPageNumbers: selectedType?.show_page_numbers ?? true,
          number: head.number, title: head.title, customer: customerName,
          date: dateAt(offerDocDate),
          introHtml, prePositionsHtml, closingHtml, legalHtml,
          projectNumber: project?.project_number ?? null,
          projectAddress: address || null,
          display: effDisplay,
          payment: showPayment ? conditionsToPaymentMeta(conditions) : undefined,
          recipientLines: resolveRecipientLines(recipientOverride, customer),
          createdBy: head.createdBy || null,
          signatureSource: head.signatureSource,
        }}
        onSave={() => save()}
        saving={saving}
        autoSave
        saveStatus={saveStatus}
        onRetry={() => save()}
        onFinalize={() => setCloseOpen(true)}
        onSettings={() => setSettingsOpen(true)}
        onHistory={() => setVersionsOpen(true)}
        moreActions={offerMoreActions}
        aiActions={buildAiActions()}
        readOnly={isClosed}
        correctable={isClosed && head.status !== "in_auftrag_uebernommen"}
        onBeginCorrection={beginCorrection}
        correctionPending={head.status === "entwurf" && workingBaseVer != null}
        // Abgeschlossen + unverändert: erneut versenden OHNE neue Version/Snapshot –
        // öffnet direkt den Versand-Dialog; closed_at/Versionen bleiben unangetastet.
        onResend={["abgeschlossen", "versendet", "angenommen"].includes(head.status)
          ? () => { pendingWasClosed.current = true; setSendOpen(true); }
          : undefined}
        resendLabel={head.status === "versendet" ? "Erneut versenden" : "Versenden"}
      />

      {/* Angebotseinstellungen (ausgelagerter Kopfblock) */}
      {settingsOpen && (
        <Modal open onClose={() => setSettingsOpen(false)} title="Angebotseinstellungen" size="xl">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2 mt-1 text-xs font-semibold uppercase tracking-wide text-slate-400">Grunddaten</div>
            <div className="sm:col-span-2"><label className="label">Angebotstyp</label>
              <select className="input" value={head.offerTypeId} disabled={isClosed}
                onChange={(e) => { const t = offerTypes.find((x) => x.id === e.target.value); if (t) setTypeChange(t); }}>
                {activeTypes.length === 0 && <option value="">– keine Typen –</option>}
                {activeTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              {selectedType?.description && <p className="mt-1 text-xs text-slate-400">{selectedType.description}</p>}
              {isClosed && <p className="mt-1 text-xs text-amber-600">Bei abgeschlossenen Angeboten nicht änderbar.</p>}
            </div>
            <div className="sm:col-span-2"><label className="label">Betreff</label>
              <input className="input" value={head.title} placeholder="z.B. Arbeiten im Büro"
                onChange={(e) => setHeadF("title", e.target.value)} /></div>
            <div><label className="label">Angebotsnummer</label>
              <input className="input cursor-not-allowed opacity-70" value={head.number || ""} readOnly
                placeholder="wird automatisch vergeben"
                title="Wird automatisch über den Nummernkreis vergeben – nicht manuell editierbar." /></div>
            <div><label className="label">Status</label>
              <select className="input" value={head.status} onChange={(e) => setHeadF("status", e.target.value)}>
                {(Object.keys(OFFER_STATUS_LABEL) as OfferStatus[]).map((s) => <option key={s} value={s}>{OFFER_STATUS_LABEL[s]}</option>)}
              </select></div>
            <div><label className="label">Kunde</label>
              <select className="input" value={head.contact_id} onChange={(e) => setHeadF("contact_id", e.target.value)}>
                <option value="">– kein Kunde –</option>
                {contacts.map((c) => <option key={c.id} value={c.id}>{[c.salutation, c.first_name, c.last_name].filter(Boolean).join(" ") || c.company}</option>)}
              </select></div>
            <div><label className="label">Projekt (Betreff)</label>
              <select className="input" value={head.project_id} onChange={(e) => setHeadF("project_id", e.target.value)}>
                <option value="">– kein Projekt –</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
              </select></div>
            <div className="sm:col-span-2"><label className="label">MwSt-Modus</label>
              <select className="input" value={head.vatMode} onChange={(e) => setHeadF("vatMode", e.target.value)}>
                <option value="standard">Regulär 20 %</option>
                <option value="par19">§19 Bauleistung (Reverse Charge, 0 %)</option>
              </select></div>
            <SignatureSourcePicker value={head.signatureSource} createdBy={head.createdBy || null}
              onChange={(v) => setHeadF("signatureSource", v)} />
            <details className="sm:col-span-2 rounded-xl border px-3 py-2" style={{ borderColor: "var(--border)" }} open>
              <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wide text-slate-400">Texte fürs PDF (Vor-/Nachtext, Einleitung)</summary>
              <div className="mt-3 space-y-3">
            <div className="sm:col-span-2">
              <div className="mb-1 flex items-center justify-between gap-2">
                <label className="label mb-0">Dokument-Vortext (erscheint im PDF vor den Positionen)</label>
                <TextPicker value={head.introText} blocks={textBlocks} textType="dokument_vortext" ctx={textCtx} phValues={phValues}
                  variantStandard={selectedType?.intro_text ?? null}
                  onInsert={(html) => setHeadF("introText", html)} />
              </div>
              <RichTextEditor value={head.introText} onChange={(html) => setHeadF("introText", html)} minHeight={90}
                placeholder="z.B. Gerne übermitteln wir Ihnen unser Angebot … Platzhalter wie {{kunde.name}} möglich." />
            </div>
            <div className="sm:col-span-2">
              <div className="mb-1 flex items-center justify-between gap-2">
                <label className="label mb-0">Einleitung vor Positionen (direkt über der Tabelle)</label>
                <TextPicker value={head.prePositionsText} blocks={textBlocks} textType="einleitung_vor_positionen" ctx={textCtx} phValues={phValues}
                  clearLabel="Keine Einleitung" onInsert={(html) => setHeadF("prePositionsText", html)} />
              </div>
              <RichTextEditor value={head.prePositionsText} onChange={(html) => setHeadF("prePositionsText", html)} minHeight={70}
                placeholder="Optional – leer lassen für „keine Einleitung“. Textvorlage über das Dropdown wählen oder eigenen Text eingeben." />
            </div>
            <div className="sm:col-span-2">
              <div className="mb-1 flex items-center justify-between gap-2">
                <label className="label mb-0">Dokument-Nachtext (erscheint im PDF nach den Positionen)</label>
                <TextPicker value={head.notes} blocks={textBlocks} textType="dokument_nachtext" ctx={textCtx} phValues={phValues}
                  variantStandard={selectedType?.closing_text ?? null}
                  onInsert={(html) => setHeadF("notes", html)} />
              </div>
              <RichTextEditor value={head.notes} onChange={(html) => setHeadF("notes", html)} minHeight={120}
                placeholder="z.B. Preisgültigkeit, Aufmaß/ÖNORM-Hinweis …" />
            </div>
              </div>
            </details>
          </div>

          <div className="mt-5 rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
            <ConditionsSettings conditions={conditions}
              onChange={(next) => { setConditions(next); builder.setDirty(true); }} />
          </div>

          <div className="mt-5 rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
            <div className="mb-2 text-sm font-bold">Abweichende Empfängeranschrift</div>
            <RecipientOverrideEditor value={recipientOverride}
              onChange={(next) => { setRecipientOverride(next); builder.setDirty(true); }} />
          </div>

          <div className="mt-5 rounded-xl border p-3" style={{ borderColor: "var(--border)" }}>
            <div className="mb-1 text-sm font-bold">Darstellung im Angebot / PDF</div>
            <p className="mb-2 text-xs text-slate-400">
              Steuert nur, was der Kunde im PDF sieht – nicht die Berechnung. Interne Kalkulation, Einkaufspreise (EK),
              Kosten und alle Stammdaten bleiben unverändert erhalten. Je nach Angebotstyp lassen sich z. B. Einzelpreise
              oder Mengen für den Kunden ausblenden (Pauschalangebot zeigt nur Gruppensummen).
            </p>
            <Toggle checked={head.useGlobalDisplay} onChange={(v) => setHeadF("useGlobalDisplay", v)} label="Standard des Angebotstyps verwenden" />
            {!head.useGlobalDisplay && (
              <div className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
                {DISPLAY_FIELDS.map((fld) => (
                  <Toggle key={fld.key} checked={head.display[fld.key]}
                    onChange={(v) => setHeadF("display", { ...head.display, [fld.key]: v })} label={fld.label} />
                ))}
              </div>
            )}
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <button className="btn-primary" onClick={() => setSettingsOpen(false)}>Fertig</button>
          </div>
          <p className="mt-1 text-right text-xs text-slate-400">Änderungen werden automatisch gespeichert.</p>
        </Modal>
      )}

      {/* Typwechsel-Warnung */}
      {typeChange && (
        <Modal open onClose={() => setTypeChange(null)} title="Angebotstyp ändern?">
          <div className="flex items-start gap-2 rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-700 dark:text-amber-300">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" />
            <div>
              Der Typ wird auf <b>{typeChange.name}</b> geändert. Dabei werden die <b>PDF-Darstellung</b> sowie
              Einleitungs- und Abschlusstext auf die Standardwerte dieses Typs gesetzt – die <b>interne Kalkulation bleibt erhalten</b>.
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button className="btn-ghost" onClick={() => setTypeChange(null)}>Abbrechen</button>
            <button className="btn-primary" onClick={() => applyType(typeChange)}>Typ übernehmen</button>
          </div>
        </Modal>
      )}

      {/* Auswahl-Dialog: Nachtrag in welchen Auftrag übernehmen? (mehrere mögliche Aufträge) */}
      {orderChoices && (
        <Modal open onClose={() => setOrderChoices(null)} title="Nachtrag welchem Auftrag hinzufügen?">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Im Projekt gibt es mehrere mögliche Aufträge. Bitte den Bezugsauftrag wählen – die Nachtrags-Positionen
            werden diesem Auftrag hinzugefügt.
          </p>
          <div className="mt-4 flex flex-col gap-2">
            {orderChoices.map((o) => (
              <button key={o.id} className="btn-outline justify-start text-left"
                onClick={() => doAddSupplement(o.id)}>
                {o.order_number || "Auftrag ohne Nummer"}
              </button>
            ))}
          </div>
          <div className="mt-5 flex justify-end">
            <button className="btn-ghost" onClick={() => setOrderChoices(null)}>Abbrechen</button>
          </div>
        </Modal>
      )}

      {/* Abschließen-Dialog */}
      {closeOpen && (
        <Modal open onClose={() => setCloseOpen(false)} title="Angebot abschließen">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Möchten Sie das Angebot nur abschließen oder direkt abschließen und versenden?
          </p>
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
            <button className="btn-ghost" onClick={() => setCloseOpen(false)}>Abbrechen</button>
            <button className="btn-outline" disabled={saving} onClick={() => closeOffer(false)}>Nur abschließen</button>
            <button className="btn-primary" disabled={saving} onClick={() => closeOffer(true)}>Abschließen und versenden</button>
          </div>
        </Modal>
      )}

      {/* Versand-Dialog: bei verbundenem Microsoft-Konto echter Graph-Send,
          sonst weiterhin "Als versendet markieren" mit Info-Banner. Der
          Dialog kennt seinen Zustand über `connected` und schaltet den
          Button-Text/Banner entsprechend um. */}
      {sendOpen && (
        <SendDialog
          recipient={customer?.email ?? ""}
          number={head.number}
          customerName={customerName}
          senderName={profile?.name ?? session?.user.email ?? ""}
          saving={saving}
          connected={microsoft.connected}
          connectionLoading={microsoft.loading}
          onSend={confirmSend}
          onClose={cancelSend}
        />
      )}

      <ConfirmDialog open={delOpen} title="Entwurf löschen?" confirmLabel="Entwurf löschen"
        message={DELETE_CONFIRM_TEXT} onConfirm={() => { setDelOpen(false); deleteDraft(); }} onClose={() => setDelOpen(false)} />

      <ConfirmDialog open={!!restoreVer} title="Version wiederherstellen?" confirmLabel="Version wiederherstellen" tone="info"
        message={<>Version V{restoreVer?.version_no} als aktuellen Arbeitsstand übernehmen? Beim erneuten Abschließen entsteht eine neue Version. Die alte Version bleibt unverändert erhalten.</>}
        onConfirm={doRestore} onClose={() => setRestoreVer(null)} />

      {versionsOpen && (
        <VersionHistoryModal
          sourceTable="offer"
          sourceId={offer.id}
          baseLabel="Angebot"
          currentNumber={head.number}
          canRestore={can("offers", "update")}
          onRestore={restoreVersion}
          onClose={() => setVersionsOpen(false)}
        />
      )}

      <ConfirmDialog open={reopenOpen} title="Korrekturversion erstellen?"
        confirmLabel="Entsperren & bearbeiten"
        message={<>Dieses Angebot ist abgeschlossen. Beim Entsperren kannst du Positionen/Texte ändern. <b>Beim erneuten Abschließen entsteht eine neue Version</b> – die bisherige Version bleibt in der Historie erhalten.</>}
        onConfirm={reopenForCorrection} onClose={() => setReopenOpen(false)} />

      {/* Voice-Angebot-Pipeline. Verfuegbar bei status=entwurf — neue Positionen
          werden an die bestehenden ANGEHAENGT (applyVoiceResult). Der Voice-
          Button im aiActions-Menue heisst entsprechend "…anfuegen" sobald
          bereits Positionen drin sind. Das Modal selbst kennt keine Gates. */}
      <VoiceAngebotDialog
        open={voiceDialogOpen}
        onClose={() => setVoiceDialogOpen(false)}
        onComplete={applyVoiceResult}
        organizationName={company?.name ?? undefined}
        catalog={voiceStammdaten.catalog}
        stundensaetze={voiceStammdaten.stundensaetze}
        settings={voiceStammdaten.kalkSettings}
        richtwerte={voiceStammdaten.richtwerte}
        gewerkeProfil={voiceStammdaten.gewerke}
      />

      {/* Mitdenken: was die KI zum gesprochenen Auftrag noch klären würde.
          Die Punkte stehen auch in den internen Notizen – hier nur die
          sichtbare Erinnerung direkt nach dem Erzeugen. */}
      <Modal open={!!voiceHints} onClose={() => setVoiceHints(null)} title="Vor dem Versand prüfen" size="md">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Die KI hat das Angebot erstellt und dabei folgende offene Punkte erkannt:
        </p>
        <ul className="mt-3 space-y-2">
          {(voiceHints ?? []).map((h, i) => (
            <li key={i} className="flex items-start gap-2 text-sm">
              <span className="mt-0.5 shrink-0" style={{ color: "var(--accent)" }}>•</span>
              <span>{h.replace(/^Prüfen:\s*/i, "")}</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-slate-400">
          Diese Punkte stehen auch in den internen Notizen des Angebots.
        </p>
        <div className="mt-4 flex justify-end">
          <button className="btn-primary" onClick={() => setVoiceHints(null)}>Verstanden</button>
        </div>
      </Modal>

      {/* "+ KI Leistung": Einzelposition per Sprache/Text. Nutzt dieselben
          eager geladenen Stammdaten wie das Voice-Komplettangebot; neue
          Positionen werden ANGEHÄNGT (applyAddPositionResult). */}
      <AddPositionDialog
        open={addPositionDialogOpen}
        onClose={() => setAddPositionDialogOpen(false)}
        onComplete={applyAddPositionResult}
        organizationName={company?.name ?? undefined}
        catalog={voiceStammdaten.catalog}
        stundensaetze={voiceStammdaten.stundensaetze}
        settings={voiceStammdaten.kalkSettings}
        services={buildSvcLookup(voiceStammdaten.services)}
      />
    </div>
  );
}

function SendDialog({
  recipient, number, customerName, senderName, saving,
  connected, connectionLoading, onSend, onClose,
}: {
  recipient: string; number: string; customerName: string; senderName: string;
  saving: boolean;
  /** Microsoft-OAuth verbunden. Steuert Banner + Button-Text/-Verhalten. */
  connected: boolean;
  /** true, solange der Status-Endpoint noch antwortet – wir sind dann
   *  optimistisch (Button aktiv, kein Info-Banner), damit der Dialog nicht
   *  bei jedem Öffnen "flimmert". */
  connectionLoading: boolean;
  onSend: (input: {
    to: string; cc: string; bcc: string; subject: string; html: string;
  }) => void;
  onClose: () => void;
}) {
  const [to, setTo] = useState(recipient);
  const [cc, setCc] = useState("");
  const [bcc, setBcc] = useState("");
  // Zentraler Textbaustein – identisch mit dem Modul-Wrapper, damit
  // Betreff/Body auch in Preview/Tests reproduzierbar sind.
  const [subject, setSubject] = useState(
    buildOfferMailSubject({ offerNumber: number || null, customerName }),
  );
  // Der Body ist HTML (Graph erwartet contentType=html) – wir zeigen ihn
  // dennoch in einem <textarea>, damit der User ihn frei bearbeiten kann.
  // Rich-Text-Editor waere übersteuert für einen einfachen Baustein.
  const [msg, setMsg] = useState(
    buildOfferMailHtml({ offerNumber: number || null, customerName, senderName }),
  );

  // Ob wir tatsächlich versenden können. `connectionLoading` behandeln wir als
  // "noch verbunden" (Optimismus), damit der Send-Button nicht kurz greyed
  // aussieht – der finale Check läuft in confirmSend gegen microsoft.connected.
  const canSend = connected || connectionLoading;

  return (
    <Modal open onClose={onClose} title="Angebot versenden" size="xl">
      {!canSend && (
        // Info-Banner (kein Fehler): E-Mail-Versand ist optional. Der User kann
        // das Angebot weiterhin "als versendet markieren" (siehe confirmSend).
        <div className="mb-3 flex items-start gap-2 rounded-xl border border-amber-400/40 bg-amber-400/10 p-3 text-sm text-amber-700 dark:text-amber-300">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div>
            E-Mail-Versand ist noch nicht verbunden. Du kannst das Angebot als „versendet" markieren –
            oder{" "}
            <Link
              to="/einstellungen"
              className="underline underline-offset-2 hover:no-underline"
            >
              dein Microsoft-Konto in den Einstellungen verbinden
            </Link>
            , dann wird die Mail inkl. PDF-Anhang direkt aus der App verschickt.
          </div>
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><label className="label">Empfänger</label>
          <input className="input" value={to} onChange={(e) => setTo(e.target.value)} placeholder={customerName || "E-Mail des Kunden"} /></div>
        <div><label className="label">CC</label><input className="input" value={cc} onChange={(e) => setCc(e.target.value)} /></div>
        <div><label className="label">BCC</label><input className="input" value={bcc} onChange={(e) => setBcc(e.target.value)} /></div>
        <div className="sm:col-span-2"><label className="label">Betreff</label>
          <input className="input" value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
        <div className="sm:col-span-2"><label className="label">Nachricht</label>
          <textarea className="input min-h-[160px] font-mono text-xs" value={msg} onChange={(e) => setMsg(e.target.value)} /></div>
      </div>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button className="btn-ghost" onClick={onClose}>Abbrechen</button>
        <button
          className="btn-primary"
          disabled={saving}
          onClick={() => onSend({ to, cc, bcc, subject, html: msg })}
        >
          {canSend ? "Versenden" : "Als versendet markieren"}
        </button>
      </div>
    </Modal>
  );
}

function TextPicker({ value, blocks, textType, ctx, phValues, onInsert, clearLabel = "Kein Text", variantStandard }: {
  value: string; blocks: TextBlock[]; textType: TextType; ctx: MatchContext; phValues: PlaceholderValues;
  onInsert: (html: string) => void; clearLabel?: string;
  // Standardtext der gewählten Variante (offer_types.intro_text/closing_text) – primärer Standard.
  variantStandard?: string | null;
}) {
  // NUR kontextpassende Bausteine, nach Priorität. defaultsOnly=false = alle passenden.
  const opts = pickBestText(blocks, textType, ctx, false).candidates;
  // Primärer Standard = Variante (offer_types); Fallback = bester text_blocks-Default.
  const vStd = variantStandard && !isEmptyHtml(variantStandard)
    ? (looksLikeHtml(variantStandard) ? variantStandard : plainToHtml(variantStandard))
    : null;
  const blockDefault = pickBestText(blocks, textType, ctx, true).block;
  const hasStandard = !!vStd || !!blockDefault;
  const norm = (h: string) => (h || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  const empty = isEmptyHtml(value);
  // Zustand aus dem Inhalt ableiten: leer → „Kein Text" · = Variante-Standard → „__variant__"
  // · = ein Baustein → dieser · sonst → „Eigener Text".
  const current = empty
    ? "__clear__"
    : (vStd && norm(value) === norm(vStd) ? "__variant__"
      : (opts.find((b) => norm(snapshotText(b, phValues).html) === norm(value))?.id ?? "__custom__"));
  const stdLabel = vStd ? "Standardtext dieser Variante übernehmen" : (blockDefault ? "Standardtext übernehmen" : "Kein Standardtext hinterlegt");
  return (
    <select className="input w-auto py-1 text-xs" value={current}
      onChange={(e) => {
        const v = e.target.value;
        if (v === "__clear__") onInsert("");                               // bewusst leeren („Kein Text")
        else if (v === "__default__") {                                    // Standard übernehmen: Variante zuerst, sonst Baustein-Default
          if (vStd) onInsert(vStd);
          else if (blockDefault) onInsert(snapshotText(blockDefault, phValues).html);
        } else if (v === "__custom__" || v === "__variant__") { /* reine Anzeige-Zustände */ }
        else { const b = blocks.find((x) => x.id === v); if (b) onInsert(snapshotText(b, phValues).html); }
      }}>
      <option value="__custom__" disabled>{empty ? "— bitte wählen —" : "Eigener Text"}</option>
      {vStd && <option value="__variant__" disabled>Standardtext dieser Variante</option>}
      <option value="__default__" disabled={!hasStandard}>{stdLabel}</option>
      <option value="__clear__">{clearLabel}</option>
      {opts.length > 0 && (
        <optgroup label="Textbausteine">
          {opts.map((b) => <option key={b.id} value={b.id}>Textbaustein: {b.title}</option>)}
        </optgroup>
      )}
    </select>
  );
}

function InfoChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-lg border bg-[var(--card)] px-2 py-1"
      style={{ borderColor: "var(--border)" }}>
      <span className="text-slate-400">{label}:</span>
      <span className="max-w-[220px] truncate font-medium">{value}</span>
    </span>
  );
}
