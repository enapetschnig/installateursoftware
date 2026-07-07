// ============================================================
// B4Y SuperAPP – Tour-Overlay (KI-Schulungsmodus, Orchestrator)
// ------------------------------------------------------------
// Rendert pro Schritt: dezente Abdunkelung mit „Cutout"-Highlight auf das
// Zielelement, den virtuellen Cursor und die Sprechblase. Findet Ziele NUR
// über data-tour-id (keine Pixelkoordinaten). Das gesamte Overlay nutzt
// pointer-events:none (nur die Sprechblase ist klickbar) → die App bleibt
// bedienbar (Mitklick-Modus). Themes-konform über CSS-Tokens.
//
// Modi:
//  - explain/demo : Tour darf UI-Schritte (z. B. Modal öffnen) selbst per
//    DOM-Klick auslösen (kein OS-Klick, keine Datenänderung). Demo füllt
//    klar markierte DEMO-Werte rein.
//  - coach        : klickt NICHTS selbst; wartet via waitFor auf den Nutzer.
//  - live         : echte Aktion (Speichern) NUR an requiresConfirmation-
//    Schritten nach ausdrücklicher Bestätigung (+ best-effort Audit).
// ============================================================
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  subscribeTour, getTourState, findTourEl, nextStep, prevStep, endTour,
  TourState,
} from "../../lib/ai-tour";
import { supabase } from "../../lib/supabase";
import AiDemoCursor from "./AiDemoCursor";
import AiTourBubble from "./AiTourBubble";

type Rect = { x: number; y: number; w: number; h: number } | null;

// Wert in ein echtes Input/Textarea schreiben, sodass React es übernimmt (Demo-Modus).
function fillValue(el: HTMLElement, value: string) {
  const tag = el.tagName.toLowerCase();
  const input = (tag === "input" || tag === "textarea") ? el as HTMLInputElement
    : el.querySelector<HTMLInputElement>("input, textarea");
  if (!input) return;
  const proto = input.tagName.toLowerCase() === "textarea" ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

export default function AiTourOverlay() {
  const [st, setSt] = useState<TourState>(getTourState());
  const [rect, setRect] = useState<Rect>(null);
  const [waiting, setWaiting] = useState(false);
  const [clicking, setClicking] = useState(false);
  const lastStepKey = useRef<string>("");

  // Store abonnieren.
  useEffect(() => subscribeTour(() => setSt({ ...getTourState() })), []);

  const def = st.def;
  const step = def?.steps[st.index] ?? null;

  // Navigation + einmalige Schritt-Effekte (Klick simulieren / Demo-Wert füllen).
  useEffect(() => {
    if (!st.active || !step) return;
    const key = `${def?.id}:${st.index}:${st.mode}`;
    if (lastStepKey.current === key) return;
    lastStepKey.current = key;

    if (step.navigateTo) {
      const want = "#" + step.navigateTo;
      if (window.location.hash.replace(/\?.*$/, "") !== want) window.location.hash = want;
    }

    // Effekt nach kurzer Verzögerung (Element/Modal kann erst erscheinen).
    const t = window.setTimeout(() => {
      const el = findTourEl(step.targetTourId);
      // explain/demo: UI-Schritte (Modal öffnen) selbst auslösen – kein OS-Klick, keine Daten.
      if (el && step.action === "click" && (st.mode === "explain" || st.mode === "demo")) {
        setClicking(true);
        try { el.click(); } catch { /* ignore */ }
        window.setTimeout(() => setClicking(false), 650);
      }
      // Demo-Werte klar markiert einfüllen (nur Demo-Modus, kein Speichern).
      if (el && step.demoValue && st.mode === "demo") {
        try { fillValue(el, step.demoValue); } catch { /* ignore */ }
      }
    }, 350);
    return () => window.clearTimeout(t);
  }, [st.active, st.index, st.mode, step, def]);

  // Ziel-Rect + waitFor laufend verfolgen (Modal/Scroll können Position ändern).
  useEffect(() => {
    if (!st.active || !step) { setRect(null); return; }
    const tick = () => {
      const el = findTourEl(step.targetTourId);
      if (el) {
        el.scrollIntoView?.({ block: "center", behavior: "smooth", inline: "nearest" });
        const r = el.getBoundingClientRect();
        setRect({ x: r.left, y: r.top, w: r.width, h: r.height });
      } else {
        setRect(null);
      }
      // waitFor: warten bis Zielelement (z. B. Modal) sichtbar ist.
      if (step.waitFor) {
        const w = findTourEl(step.waitFor);
        setWaiting(!(w && w.offsetParent !== null));
      } else {
        setWaiting(false);
      }
    };
    tick();
    const iv = window.setInterval(tick, 250);
    const onResize = () => tick();
    window.addEventListener("resize", onResize);
    window.addEventListener("scroll", onResize, true);
    return () => { window.clearInterval(iv); window.removeEventListener("resize", onResize); window.removeEventListener("scroll", onResize, true); };
  }, [st.active, st.index, step]);

  if (!st.active || !def || !step) return null;
  // Non-null-Aliasse für Closures (TS-Narrowing gilt in onConfirm sonst nicht).
  const tourDef = def;
  const tourStep = step;

  // Optionales Ziel fehlt → Schritt überspringen.
  if (!rect && step.optional && !step.waitFor) { nextStep(); return null; }

  const vw = window.innerWidth, vh = window.innerHeight;
  const pad = 8;
  const ring: Rect = rect ? { x: rect.x - pad, y: rect.y - pad, w: rect.w + pad * 2, h: rect.h + pad * 2 } : null;

  // Cursor-Zielpunkt: rechte untere Ecke des Zielelements (wie ein zeigender Finger).
  const cursorX = rect ? Math.min(rect.x + rect.w * 0.5, vw - 30) : vw / 2;
  const cursorY = rect ? rect.y + rect.h * 0.5 : vh / 2;

  // Sprechblase platzieren (unter dem Ziel, sonst darüber); ohne Ziel zentriert unten.
  const bubbleW = 300, bubbleH = 168;
  const bLeft = rect ? Math.min(Math.max(rect.x, 12), vw - bubbleW - 12) : (vw - bubbleW) / 2;
  let bTop: number; let placement: "top" | "bottom";
  if (rect && rect.y + rect.h + bubbleH + 16 < vh) { bTop = rect.y + rect.h + 14; placement = "bottom"; }
  else if (rect) { bTop = Math.max(12, rect.y - bubbleH - 14); placement = "top"; }
  else { bTop = vh - bubbleH - 24; placement = "top"; }

  const liveConfirm = st.mode === "live" && !!step.requiresConfirmation;

  async function onConfirm() {
    // Live-Modus: echte Aktion an diesem Schritt (z. B. Projekt speichern) – mit Audit.
    const el = findTourEl(tourStep.targetTourId);
    // Best-effort Audit (RLS/Default greifen serverseitig; Fehler werden ignoriert).
    try {
      const { data: u } = await supabase.auth.getUser();
      await supabase.from("ai_action_logs").insert({
        user_id: u.user?.id ?? null,
        user_input_summary: `Schulung Live: ${tourDef.title}`,
        tool_name: `tour:${tourDef.id}:${tourStep.id}`,
        tool_arguments_summary: null,
        action_level: 3,
        target_type: tourDef.area || "tour",
        status: "ok",
        confirmation_required: true,
        confirmed_at: new Date().toISOString(),
      });
    } catch { /* best-effort */ }
    setClicking(true);
    try { el?.click(); } catch { /* ignore */ }
    window.setTimeout(() => { setClicking(false); endTour(); }, 700);
  }

  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 2147482999, pointerEvents: "none" }} aria-live="polite">
      {/* Abdunkelung + Highlight-Cutout (dezent, Theme-neutral) */}
      {ring && (
        <div
          style={{
            position: "fixed",
            left: ring.x, top: ring.y, width: ring.w, height: ring.h,
            borderRadius: 12,
            boxShadow: "0 0 0 9999px rgba(15, 23, 42, 0.45)",
            outline: "2px solid var(--accent)",
            transition: "all 300ms cubic-bezier(0.22,1,0.36,1)",
            pointerEvents: "none",
          }}
        />
      )}
      {/* Sanftes Glühen am Ziel */}
      {ring && (
        <div style={{
          position: "fixed", left: ring.x, top: ring.y, width: ring.w, height: ring.h,
          borderRadius: 12, boxShadow: "0 0 0 4px var(--accent-soft, rgba(99,102,241,0.25))",
          pointerEvents: "none", transition: "all 300ms",
        }} />
      )}

      <AiDemoCursor x={cursorX} y={cursorY} clicking={clicking} />

      <AiTourBubble
        title={def.title}
        text={step.text}
        stepIndex={st.index}
        stepCount={def.steps.length}
        mode={st.mode}
        pos={{ left: bLeft, top: bTop, placement }}
        canConfirm={liveConfirm}
        confirmText={step.confirmText}
        waiting={waiting && (st.mode === "coach" || st.mode === "live")}
        onPrev={prevStep}
        onNext={nextStep}
        onConfirm={onConfirm}
        onEnd={endTour}
      />
    </div>,
    document.body,
  );
}
