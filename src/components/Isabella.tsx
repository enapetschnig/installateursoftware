import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, X, Send, Mic, Square, Loader2 } from "lucide-react";
import {
  chatAI,
  transcribeAudio,
  AiMessage,
  AiSelItem,
  AiResponse,
  ChatContext,
  loadAiSettings,
  aiModuleEnabled,
} from "../lib/ai";
import { useAuth } from "../lib/auth";
import { APP_NAME } from "../lib/branding";
import { supabase } from "../lib/supabase";
import { createOrderFromOffers, createInvoiceFromOrders } from "../lib/document-chain";
import { logProject } from "../lib/projectlog";
import { refreshOrdersInvoiceStatus } from "../lib/invoice-types";
import { docPath } from "../lib/documents-overview";
import { startTour, tourExists, TourMode, TOURS } from "../lib/ai-tour";
import { useNewAnfragenSubscription } from "../hooks/useNewAnfragenSubscription";
import { toastInfo } from "../lib/toast";
import type { AnfrageRow } from "../lib/anfragen";

const SUGGEST = [
  "Fasse meine offenen Aufgaben zusammen",
  "Formuliere eine freundliche Kunden-E-Mail",
  "Worauf sollte ich diese Woche achten?",
  "Hilf mir, ein Angebot zu strukturieren",
];

const ISABELLA_SYSTEM =
  `Du bist Isabella, die charmante, weibliche KI-Assistentin in der ${APP_NAME} für Installateur- und Haustechnikbetriebe. ` +
  "Antworte immer auf Deutsch, präzise, praxisnah und sofort umsetzbar. Dein Stil ist warm, charmant und " +
  "mit einem Augenzwinkern, aber stets niveauvoll und professionell. Bei geschäftlichen Themen klar und " +
  "lösungsorientiert. Führe keine App-Aktionen aus, solange keine autorisierten Tools freigegeben sind.";

const STORAGE_KEY = "b4y-isabella-position";
const DEFAULT_POSITION = { x: 24, y: 24 };
// Maße des Floating-Buttons (h-14 w-14 = 56px) + Mindestabstand zum Rand.
// Die Begrenzung richtet sich NUR nach dem Button – das Chat-Panel positioniert
// sich beim Öffnen eigenständig im Viewport (siehe panelPlacement).
const FAB_SIZE = 56;
const FAB_MARGIN = 8;

type IsabellaPosition = { x: number; y: number };

function clampPosition(next: IsabellaPosition): IsabellaPosition {
  if (typeof window === "undefined") return next;
  const maxX = Math.max(FAB_MARGIN, window.innerWidth - FAB_SIZE - FAB_MARGIN);
  const maxY = Math.max(FAB_MARGIN, window.innerHeight - FAB_SIZE - FAB_MARGIN);
  return {
    x: Math.min(Math.max(next.x, FAB_MARGIN), maxX),
    y: Math.min(Math.max(next.y, FAB_MARGIN), maxY),
  };
}

function readPosition(): IsabellaPosition {
  if (typeof window === "undefined") return DEFAULT_POSITION;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return DEFAULT_POSITION;
  try {
    const parsed = JSON.parse(raw) as IsabellaPosition;
    // Gespeicherte Position an die aktuelle Fenstergröße anpassen (Monitorwechsel).
    if (typeof parsed?.x === "number" && typeof parsed?.y === "number") return clampPosition(parsed);
  } catch {}
  return DEFAULT_POSITION;
}

const AREA_MAP: Record<string, string> = {
  projekte: "Projekte",
  kontakte: "Kontakte",
  angebote: "Angebote",
  auftraege: "Aufträge",
  rechnungen: "Rechnungen",
  dokumente: "Dokumente",
  planung: "Planung",
  kalkulation: "Kalkulation",
  einstellungen: "Einstellungen",
  mitarbeiter: "Mitarbeiter",
  auswertungen: "Auswertungen",
};
function deriveContext(): ChatContext {
  // BrowserRouter (basename /app): aktueller Bereich kommt aus dem Pfad, nicht aus dem Hash.
  const path = window.location.pathname.replace(/^\/app(?=\/|$)/, "");
  const seg = path.split("?")[0].split("/").filter(Boolean);
  const ctx: ChatContext = { area: AREA_MAP[seg[0]] || "Übersicht", route: "/" + seg.join("/") };
  if (seg[0] === "projekte" && seg[1]) ctx.project = seg[1];
  if (seg[0] === "angebote" && seg[1] && seg[1] !== "new") ctx.offerId = seg[1];
  if (seg[0] === "auftraege" && seg[1] && seg[1] !== "new") ctx.orderId = seg[1];
  return ctx;
}

type RecState = "idle" | "recording" | "processing";
type ChatMsg = {
  role: "user" | "assistant";
  content: string;
  items?: AiSelItem[];
  preview?: AiResponse["preview"];
  action?: AiResponse["action"];
  tour?: string;
  done?: boolean;
};

// Lokale Absichtserkennung für den Schulungsmodus (funktioniert auch ohne KI-Backend).
function detectTourIntent(text: string): string | null {
  const t = text.toLowerCase();
  const wantsHow = /(zeig|zeige|wie|erklär|erklaer|schulung|tour|demonstrier|führ|fuehr)/.test(t);
  if (!wantsHow) return null;
  if (/projekt/.test(t) && /(anleg|erstell|neu|anlegen)/.test(t)) return "project-create";
  return null;
}

export default function Isabella() {
  const { profile } = useAuth();
  const navRouter = useNavigate();
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [position, setPosition] = useState<IsabellaPosition>(() => readPosition());
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [rec, setRec] = useState<RecState>("idle");
  const [secs, setSecs] = useState(0);
  const scrollRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    offsetX: number;
    offsetY: number;
    startX: number;
    startY: number;
  } | null>(null);
  // Merkt sich, ob seit dem PointerDown nennenswert bewegt wurde – ein echter Drag
  // soll den anschließenden Klick NICHT als Öffnen/Schließen werten.
  const draggedRef = useRef(false);
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | undefined>(undefined);

  // Anfragen-Counter: zaehlt neue Anrufe seit der letzten Sichtung —
  // dient als roter Pulse-Dot am FAB. Reset beim Oeffnen des Chats.
  const [newAnfragenCount, setNewAnfragenCount] = useState(0);
  const handleNewAnfrage = useCallback((a: AnfrageRow) => {
    setNewAnfragenCount((c) => c + 1);
    const who = a.caller_name?.trim() || a.caller_phone || "Unbekannt";
    const kind =
      a.source === "phone_fonio"
        ? "📞 Neuer Anruf"
        : a.source === "website_form"
          ? "🌐 Neue Webanfrage"
          : "📨 Neue Anfrage";
    toastInfo(`${kind}: ${who}`);
  }, []);
  useNewAnfragenSubscription(handleNewAnfrage);

  useEffect(() => {
    if (open && newAnfragenCount > 0) setNewAnfragenCount(0);
  }, [open, newAnfragenCount]);

  useEffect(() => {
    if (open)
      loadAiSettings().then((s) => {
        setEnabled(aiModuleEnabled(s, "isabella"));
        setVoiceEnabled(s?.active !== false);
      });
  }, [open]);
  useEffect(() => {
    if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, JSON.stringify(position));
  }, [position]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs, busy, rec]);
  // Auto-wachsendes Eingabefeld: Höhe an Inhalt anpassen, gedeckelt (interner Scroll ab Max).
  useEffect(() => {
    const ta = taRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 140) + "px";
  }, [input, open]);
  // Aufräumen, falls Fenster geschlossen/Unmount während Aufnahme
  useEffect(
    () => () => {
      if (timerRef.current) clearInterval(timerRef.current);
      streamRef.current?.getTracks().forEach((t) => t.stop());
    },
    []
  );

  // Fenstergröße geändert → Button (und damit die gespeicherte Position) im Viewport halten.
  useEffect(() => {
    const onResize = () => setPosition((p) => clampPosition(p));
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  function beginDrag(event: React.PointerEvent<HTMLButtonElement>) {
    if (open) return;
    event.preventDefault();
    dragRef.current = {
      pointerId: event.pointerId,
      offsetX: event.clientX - position.x,
      offsetY: event.clientY - position.y,
      startX: event.clientX,
      startY: event.clientY,
    };
    draggedRef.current = false;
    setDragging(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: React.PointerEvent<HTMLButtonElement>) {
    if (!dragRef.current || dragRef.current.pointerId !== event.pointerId) return;
    // Erst ab einer kleinen Schwelle (4px) als Drag werten – Mikro-Bewegungen beim
    // normalen Klick bleiben ein Klick (Toggle), echtes Ziehen verschiebt nur.
    if (
      Math.hypot(event.clientX - dragRef.current.startX, event.clientY - dragRef.current.startY) > 4
    )
      draggedRef.current = true;
    setPosition(
      clampPosition({
        x: event.clientX - dragRef.current.offsetX,
        y: event.clientY - dragRef.current.offsetY,
      })
    );
  }

  function endDrag(event: React.PointerEvent<HTMLButtonElement>) {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
      setDragging(false);
    }
  }

  function goto(route: string) {
    // BrowserRouter (basename /app): React-Router-Navigation – kein Reload, App bleibt
    // erhalten. Alte "#/xyz"-Routen (z. B. aus KI-Antworten) werden weiter akzeptiert.
    const clean = route.startsWith("#") ? route.slice(1) : route;
    navRouter(clean.startsWith("/") ? clean : "/" + clean);
  }
  function pickItem(it: AiSelItem) {
    setMsgs((m) => [...m, { role: "assistant", content: `Ich öffne: ${it.title}` }]);
    goto(it.route);
  }
  // KI-Schulungsmodus: Tour anbieten (Modus-Auswahl) bzw. starten.
  function offerTour(tourId: string) {
    const def = TOURS[tourId];
    if (!def) return;
    setMsgs((m) => [
      ...m,
      {
        role: "assistant",
        content: `Gerne – ich zeige dir „${def.title}“ direkt in der App. In welchem Modus möchtest du das?`,
        tour: tourId,
      },
    ]);
  }
  function launchTour(tourId: string, mode: TourMode) {
    if (!tourExists(tourId)) return;
    setOpen(false); // Isabella schließen, damit das Tour-Overlay frei sichtbar ist
    window.setTimeout(() => startTour(tourId, mode), 250);
  }
  function cancelAction(idx: number) {
    setMsgs((m) =>
      m
        .map((x, i) => (i === idx ? { ...x, done: true } : x))
        .concat({ role: "assistant", content: "Abgebrochen – es wurde nichts erstellt." })
    );
  }
  async function executeAction(idx: number, action: AiResponse["action"]) {
    if (!action || busy) return;
    setBusy(true);
    setErr(null);
    setMsgs((m) => m.map((x, i) => (i === idx ? { ...x, done: true } : x)));
    try {
      if (action.kind === "offerToOrder" && action.offerId) {
        const { data } = await supabase.from("offers").select("*").eq("id", action.offerId).single();
        const projectId = (data as any)?.project_id;
        const res = await createOrderFromOffers({ projectId, offers: [data] });
        if (res.error) setErr(res.error);
        else if (res.id) {
          // Konsistent zur UI-Weiterführung: Logbuch-Eintrag schreiben.
          if (projectId)
            await logProject(
              projectId,
              "auftrag",
              `Auftrag ${res.number || res.id} wurde aus Angebot ${(data as any)?.number || ""} erstellt (KI).`
            );
          setMsgs((m) => [
            ...m,
            { role: "assistant", content: `Auftrag ${res.number || ""} wurde erstellt. Ich öffne ihn.` },
          ]);
          goto(docPath("order", res.id, res.number));
        }
      } else if (action.kind === "orderToInvoice" && action.orderId) {
        const { data } = await supabase.from("orders").select("*").eq("id", action.orderId).single();
        const projectId = (data as any)?.project_id;
        const res = await createInvoiceFromOrders({ orders: [data], projectId });
        if (res.error) setErr(res.error);
        else if (res.id) {
          // Konsistent zur UI: Logbuch + Verrechnungsstatus des Quell-Auftrags aktualisieren.
          if (projectId)
            await logProject(
              projectId,
              "rechnung",
              `Rechnung ${res.number || res.id} wurde aus Auftrag ${(data as any)?.order_number || ""} erstellt (KI).`
            );
          await refreshOrdersInvoiceStatus(supabase, [action.orderId]);
          setMsgs((m) => [
            ...m,
            { role: "assistant", content: `Rechnung ${res.number || ""} wurde erstellt. Ich öffne sie.` },
          ]);
          goto(docPath("invoice", res.id, res.number));
        }
      }
    } catch {
      setErr("Aktion fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  async function send(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    setErr(null);
    const next: ChatMsg[] = [...msgs, { role: "user", content: t }];
    setMsgs(next);
    setInput("");
    // Schulungsmodus lokal erkennen (kein KI-Aufruf nötig) – z. B. „Zeig mir, wie man ein Projekt anlegt".
    const intent = detectTourIntent(t);
    if (intent) {
      offerTour(intent);
      return;
    }
    setBusy(true);
    const r = await chatAI(next as AiMessage[], { system: ISABELLA_SYSTEM, context: deriveContext() });
    setBusy(false);
    if (r.type === "error") {
      setErr(r.error || r.message || "Die KI konnte gerade nicht antworten.");
      return;
    }
    if (r.type === "start_tour" && r.tourId) {
      offerTour(r.tourId);
      return;
    }
    if (r.type === "navigate" && r.route) {
      setMsgs((m) => [...m, { role: "assistant", content: r.message || "Erledigt." }]);
      goto(r.route);
      return;
    }
    if (r.type === "selection_required") {
      setMsgs((m) => [
        ...m,
        {
          role: "assistant",
          content: r.message || "Ich habe mehrere Treffer gefunden:",
          items: r.items || [],
        },
      ]);
      return;
    }
    if (r.type === "confirmation_required") {
      setMsgs((m) => [
        ...m,
        {
          role: "assistant",
          content: r.message || "Bitte prüfen und bestätigen:",
          preview: r.preview,
          action: r.action,
        },
      ]);
      return;
    }
    setMsgs((m) => [...m, { role: "assistant", content: r.message || r.text || "(keine Antwort)" }]);
  }

  // ── Spracheingabe ──
  async function startRec() {
    setErr(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setErr("Spracheingabe wird von diesem Browser nicht unterstützt.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "";
      const mr = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data && e.data.size) chunksRef.current.push(e.data);
      };
      mr.onstop = onRecStop;
      mediaRef.current = mr;
      mr.start();
      setRec("recording");
      setSecs(0);
      timerRef.current = window.setInterval(
        () =>
          setSecs((s) => {
            if (s + 1 >= 60) stopRec();
            return s + 1;
          }),
        1000
      );
    } catch (e: any) {
      setRec("idle");
      setErr(
        e?.name === "NotAllowedError" || e?.name === "SecurityError"
          ? "Mikrofonzugriff wurde nicht erlaubt. Bitte im Browser freigeben."
          : "Mikrofon konnte nicht gestartet werden."
      );
    }
  }
  function stopRec() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = undefined;
    }
    const mr = mediaRef.current;
    if (mr && mr.state !== "inactive") mr.stop();
    else setRec("idle");
  }
  async function onRecStop() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    const blob = new Blob(chunksRef.current, { type: mediaRef.current?.mimeType || "audio/webm" });
    chunksRef.current = [];
    if (!blob.size) {
      setRec("idle");
      setErr("Ich konnte leider keinen Text erkennen. Bitte nochmal versuchen.");
      return;
    }
    setRec("processing");
    const r = await transcribeAudio(blob, {
      route: window.location.pathname,
      context_type: deriveContext().area,
    });
    setRec("idle");
    if (r.error) {
      setErr(r.error);
      return;
    }
    if (r.warning) {
      setErr(r.warning);
      return;
    }
    if (r.text) setInput((prev) => (prev ? prev.trim() + " " : "") + r.text);
  }

  const mm = String(Math.floor(secs / 60)).padStart(1, "0");
  const ss = String(secs % 60).padStart(2, "0");

  // Panel-Platzierung: bevorzugt unter dem Button; reicht der Platz nicht
  // (Button nahe der Unterkante), öffnet es über dem Button. maxHeight stellt
  // sicher, dass das Panel in jedem Fall vollständig im Viewport bleibt.
  function panelPlacement(): { left: number; top: number; maxHeight: number } {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 16;
    const width = 384; // w-[24rem]
    const gap = 16; // Abstand Button ↔ Panel
    const left = Math.max(margin, Math.min(position.x, vw - width - margin));
    const cap = Math.round(vh * 0.72); // entspricht dem bisherigen max-h-[72vh]
    const below = position.y + FAB_SIZE + gap;
    const roomBelow = vh - below - margin;
    const roomAbove = position.y - gap - margin;
    if (roomBelow >= 280 || roomBelow >= roomAbove) {
      return { left, top: below, maxHeight: Math.max(200, Math.min(cap, roomBelow)) };
    }
    const maxHeight = Math.max(200, Math.min(cap, roomAbove));
    return { left, top: Math.max(margin, position.y - gap - maxHeight), maxHeight };
  }
  const panel = open ? panelPlacement() : null;

  return (
    <>
      <button
        onClick={() => {
          // Nach einem echten Drag den dadurch ausgelösten Klick verschlucken,
          // damit Ziehen den Chat nicht gleichzeitig öffnet/schließt.
          if (draggedRef.current) {
            draggedRef.current = false;
            return;
          }
          setOpen((o) => !o);
        }}
        className={`group fixed z-50 flex h-14 w-14 items-center justify-center rounded-full text-white shadow-lift animate-float ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
        style={{
          background: "linear-gradient(135deg,var(--accent),var(--accent2))",
          left: position.x,
          top: position.y,
        }}
        title="Isabella AI"
        onPointerDown={beginDrag}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <Sparkles size={24} className="transition group-hover:scale-110" />
        {newAnfragenCount > 0 && (
          <span
            className="absolute -right-1 -top-1 grid h-5 min-w-[20px] place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white shadow-md"
            title={`${newAnfragenCount} neue Anfrage${newAnfragenCount === 1 ? "" : "n"}`}
          >
            {newAnfragenCount > 9 ? "9+" : newAnfragenCount}
          </span>
        )}
        <span
          className="absolute -inset-1 -z-10 rounded-full opacity-60 blur-md"
          style={{ background: "linear-gradient(135deg,var(--accent),var(--accent2))" }}
        />
      </button>

      {open && panel && (
        <div
          className="fixed z-50 flex w-[24rem] max-w-[calc(100vw-2rem)] flex-col glass p-4 animate-fadeup"
          style={{ left: panel.left, top: panel.top, maxHeight: panel.maxHeight }}
        >
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div
                className="grid h-9 w-9 place-items-center rounded-xl text-white"
                style={{ background: "linear-gradient(135deg,var(--accent),var(--accent2))" }}
              >
                <Sparkles size={18} />
              </div>
              <div>
                <div className="text-sm font-bold leading-tight">Isabella AI</div>
                <div className="text-[11px] text-ok-500">● Online</div>
              </div>
            </div>
            <button onClick={() => setOpen(false)} className="btn-ghost px-1.5">
              <X size={16} />
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-2 overflow-y-auto pr-1">
            {msgs.length === 0 && (
              <div className="rounded-xl bg-slate-100 p-3 text-sm dark:bg-white/5">
                Hallo {profile?.name?.split(" ")[0] || "zusammen"} 💋 Ich bin Isabella. Tippe oder sprich –
                womit darf ich helfen?
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : ""}>
                <div
                  className={`max-w-[88%] rounded-xl px-3 py-2 text-sm ${m.role === "user" ? "text-white" : "bg-slate-100 dark:bg-white/5"}`}
                  style={
                    m.role === "user"
                      ? { background: "linear-gradient(135deg,var(--accent),var(--accent-h))" }
                      : undefined
                  }
                >
                  <div className="whitespace-pre-wrap">{m.content}</div>
                  {m.items && m.items.length > 0 && (
                    <div className="mt-2 space-y-1.5">
                      {m.items.map((it) => (
                        <button
                          key={it.id}
                          onClick={() => pickItem(it)}
                          className="block w-full rounded-lg border border-slate-200 bg-white/60 px-2.5 py-1.5 text-left transition hover:border-brand-400 dark:border-white/10 dark:bg-white/5"
                        >
                          <div className="text-xs font-semibold text-slate-700 dark:text-slate-100">
                            {it.title}
                          </div>
                          {it.subtitle && <div className="text-[11px] text-slate-400">{it.subtitle}</div>}
                        </button>
                      ))}
                    </div>
                  )}
                  {m.preview && (
                    <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 dark:border-amber-500/40 dark:bg-amber-500/10">
                      {m.preview.title && (
                        <div className="mb-1 text-xs font-bold text-amber-800 dark:text-amber-200">
                          {m.preview.title}
                        </div>
                      )}
                      <table className="w-full text-[11px] text-slate-600 dark:text-slate-300">
                        <tbody>
                          {(m.preview.rows || []).map(([k, v], j) => (
                            <tr key={j}>
                              <td className="pr-2 text-slate-400">{k}</td>
                              <td className="font-medium">{v}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!m.done && m.action && (
                        <div className="mt-2 flex gap-2">
                          <button
                            disabled={busy}
                            onClick={() => executeAction(i, m.action)}
                            className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50"
                          >
                            Bestätigen
                          </button>
                          <button
                            disabled={busy}
                            onClick={() => cancelAction(i)}
                            className="rounded-lg border border-slate-300 px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50 dark:border-white/15 dark:text-slate-300 dark:hover:bg-white/5"
                          >
                            Abbrechen
                          </button>
                        </div>
                      )}
                      {m.done && <div className="mt-1 text-[11px] text-slate-400">Erledigt.</div>}
                    </div>
                  )}
                  {m.tour && (
                    <div className="mt-2 grid grid-cols-2 gap-1.5">
                      {(
                        [
                          ["explain", "Erklären"],
                          ["coach", "Mitmachen"],
                          ["demo", "Demo"],
                          ["live", "Live (echt)"],
                        ] as [TourMode, string][]
                      ).map(([mode, label]) => (
                        <button
                          key={mode}
                          onClick={() => launchTour(m.tour!, mode)}
                          className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 transition hover:border-brand-400 hover:text-brand-600 dark:border-white/10 dark:text-slate-300"
                        >
                          {label}
                        </button>
                      ))}
                      <div className="col-span-2 text-[10px] text-slate-400">
                        Live legt echte Daten nur nach ausdrücklicher Bestätigung an.
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ))}
            {busy && (
              <div className="w-16 rounded-xl bg-slate-100 px-3 py-2 text-sm dark:bg-white/5">
                <span className="inline-flex gap-1">
                  <span className="animate-pulse">•</span>
                  <span className="animate-pulse">•</span>
                  <span className="animate-pulse">•</span>
                </span>
              </div>
            )}
          </div>

          {err && (
            <div className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600 dark:bg-rose-500/10 dark:text-rose-300">
              {err}
            </div>
          )}
          {!enabled && (
            <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-300">
              Isabella ist in den KI-Einstellungen deaktiviert.
            </div>
          )}

          {msgs.length === 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {SUGGEST.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  disabled={busy}
                  className="rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 transition hover:border-brand-400 hover:text-brand-600 disabled:opacity-50 dark:border-white/10 dark:text-slate-300"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {rec === "recording" && (
            <div className="mt-2 flex items-center justify-between rounded-lg bg-rose-50 px-3 py-1.5 text-xs text-rose-600 dark:bg-rose-500/10 dark:text-rose-300">
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 animate-pulse rounded-full bg-rose-500" /> Aufnahme … {mm}:{ss}
              </span>
              <span className="text-rose-400">max. 60s</span>
            </div>
          )}

          <div className="mt-3 flex items-end gap-2 rounded-xl border border-slate-200 px-2 py-1.5 dark:border-white/10">
            {voiceEnabled &&
              (rec === "recording" ? (
                <button
                  onClick={stopRec}
                  title="Aufnahme stoppen"
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-rose-500 text-white animate-pulse"
                >
                  <Square size={16} />
                </button>
              ) : rec === "processing" ? (
                <button
                  disabled
                  title="Verarbeite Sprache …"
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-200 text-slate-500 dark:bg-white/10"
                >
                  <Loader2 size={16} className="animate-spin" />
                </button>
              ) : (
                <button
                  onClick={startRec}
                  disabled={busy}
                  title="Spracheingabe starten"
                  className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-brand-600 disabled:opacity-40 dark:hover:bg-white/5"
                >
                  <Mic size={18} />
                </button>
              ))}
            {/* Mehrzeiliges, automatisch wachsendes Eingabefeld (max-height + interner Scroll);
                Enter = senden, Shift+Enter = Zeilenumbruch. Senden-Pfeil bleibt dauerhaft sichtbar. */}
            <textarea
              ref={taRef}
              rows={1}
              className="min-w-0 flex-1 resize-none self-center bg-transparent text-sm leading-5 outline-none placeholder:text-slate-400"
              style={{ fontSize: 16, maxHeight: 140 }}
              placeholder={
                rec === "processing"
                  ? "Sprache wird verarbeitet …"
                  : "Frag Isabella … (Shift+Enter = neue Zeile)"
              }
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
              disabled={busy || rec === "processing"}
            />
            <button
              className="mb-0.5 shrink-0 self-end text-brand-500 disabled:opacity-40"
              disabled={busy || !input.trim()}
              onClick={() => send(input)}
              title="Senden"
            >
              <Send size={16} />
            </button>
          </div>
          {rec !== "idle" && (
            <p className="mt-1.5 text-center text-[10px] text-slate-400">
              Spracheingaben werden zur Verarbeitung an den KI-Dienst übermittelt.
            </p>
          )}
        </div>
      )}
    </>
  );
}
