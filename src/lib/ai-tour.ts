// ============================================================
// B4Y SuperAPP – KI-Schulungsmodus: zentrale Tour-Engine
// ------------------------------------------------------------
// Datengetriebene Touren (id/targetTourId/text/action/waitFor/optional/
// requiresConfirmation). Reines UI-Overlay (kein OS-Cursor, keine Pixel-
// koordinaten): Ziele werden ausschließlich über stabile `data-tour-id`-
// Attribute gefunden. Vier sauber getrennte Modi:
//   - explain : Cursor + Highlight + Sprechblase, KEINE Datenänderung.
//   - coach   : Nutzer klickt selbst; Tour erkennt den nächsten Schritt (waitFor).
//   - demo    : wie explain, füllt klar markierte DEMO-Werte (kein Speichern).
//   - live    : echte Datenänderung NUR an Schritten mit requiresConfirmation
//               und ausdrücklicher Bestätigung (+ Audit über ai_action_logs).
// Der Store ist framework-agnostisch (Subscribe); die eigentliche DOM-Wirkung
// (Scrollen/Highlight/Klick-Simulation) liegt gekapselt im AiTourOverlay.
// ============================================================

export type TourMode = "explain" | "coach" | "demo" | "live";
export type TourActionKind = "highlight" | "click" | "focus" | "input" | "navigate" | "info";

export type TourStep = {
  id: string;
  /** Stabile data-tour-id des Zielelements (keine Pixelkoordinaten!). */
  targetTourId?: string;
  /** Erklärtext für die Sprechblase. */
  text: string;
  /** Was an diesem Schritt passiert (Standard: highlight). */
  action?: TourActionKind;
  /** Route (Hash), zu der vor dem Schritt navigiert wird (z. B. "/projekte"). */
  navigateTo?: string;
  /** data-tour-id, das erscheinen muss, bevor weitergegangen wird (z. B. Modal). */
  waitFor?: string;
  /** Schritt darf übersprungen werden, wenn das Ziel fehlt. */
  optional?: boolean;
  /** Im Demo-Modus klar markierter Beispielwert (wird visuell eingetragen). */
  demoValue?: string;
  /** Echte Aktion (z. B. Speichern) – nur mit ausdrücklicher Bestätigung (live). */
  requiresConfirmation?: boolean;
  /** Bestätigungstext, falls requiresConfirmation. */
  confirmText?: string;
};

export type TourDefinition = {
  id: string;
  title: string;
  /** App-Bereich, in dem die Tour spielt (für Kontext/Hinweis). */
  area?: string;
  steps: TourStep[];
};

export type TourState = {
  active: boolean;
  def: TourDefinition | null;
  mode: TourMode;
  index: number;
};

const initial: TourState = { active: false, def: null, mode: "explain", index: 0 };
let state: TourState = { ...initial };
const listeners = new Set<() => void>();

function emit() { listeners.forEach((l) => l()); }

export function subscribeTour(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
export function getTourState(): TourState { return state; }

export function startTour(tourId: string, mode: TourMode = "explain"): boolean {
  const def = TOURS[tourId];
  if (!def) return false;
  state = { active: true, def, mode, index: 0 };
  emit();
  return true;
}
export function endTour() { state = { ...initial }; emit(); }
export function nextStep() {
  if (!state.active || !state.def) return;
  if (state.index >= state.def.steps.length - 1) { endTour(); return; }
  state = { ...state, index: state.index + 1 }; emit();
}
export function prevStep() {
  if (!state.active || state.index <= 0) return;
  state = { ...state, index: state.index - 1 }; emit();
}
export function setMode(mode: TourMode) { if (state.active) { state = { ...state, mode }; emit(); } }

/** Findet ein Tour-Ziel über die stabile data-tour-id (kein Pixel/Selector-Hack). */
export function findTourEl(tourId?: string): HTMLElement | null {
  if (!tourId) return null;
  return document.querySelector<HTMLElement>(`[data-tour-id="${CSS.escape(tourId)}"]`);
}

// ============================================================
// Tour-Katalog (erweiterbar). Erste Tour: „Projekt anlegen".
// ============================================================
export const TOURS: Record<string, TourDefinition> = {
  "project-create": {
    id: "project-create",
    title: "Projekt anlegen",
    area: "projekte",
    steps: [
      {
        id: "open-projects",
        targetTourId: "project-nav",
        navigateTo: "/projekte",
        text: "Links in der Navigation findest du den Bereich „Projekte“. Hier verwaltest du alle Bauvorhaben.",
        action: "highlight",
      },
      {
        id: "click-new",
        targetTourId: "project-create-button",
        text: "Mit „Neues Projekt“ öffnest du das Anlageformular. Ich öffne es jetzt zum Zeigen.",
        action: "click",
        waitFor: "project-form-modal",
      },
      {
        id: "field-customer",
        targetTourId: "project-form-customer",
        text: "Zuerst wählst du den Kunden. Tippe zum Suchen – Isabella kann auch nach passenden Kontakten suchen.",
        action: "highlight",
      },
      {
        id: "field-type",
        targetTourId: "project-form-type",
        text: "Der Projekttyp bestimmt die verfügbaren Status (z. B. Neubau, Sanierung).",
        action: "highlight",
      },
      {
        id: "field-address",
        targetTourId: "project-form-address",
        text: "Hier kommt die Bauadresse rein (Straße & Hausnummer).",
        action: "highlight",
        demoValue: "DEMO – Musterstraße 1",
      },
      {
        id: "field-status",
        targetTourId: "project-form-status",
        text: "Der Status steuert den Workflow des Projekts (z. B. Anfrage, in Arbeit).",
        action: "highlight",
      },
      {
        id: "field-responsible",
        targetTourId: "project-form-responsible",
        text: "Lege fest, wer im Team für das Projekt verantwortlich ist.",
        action: "highlight",
      },
      {
        id: "field-note",
        targetTourId: "project-form-internal-note",
        text: "Optional: eine interne Notiz – nur intern sichtbar, nicht für Kunden.",
        action: "highlight",
        demoValue: "DEMO – über Isabella-Schulung angelegt",
      },
      {
        id: "save",
        targetTourId: "project-form-save",
        text: "Mit „Speichern“ wird das Projekt angelegt. Im Erklär-/Demo-Modus passiert hier nichts Echtes.",
        action: "highlight",
        requiresConfirmation: true,
        confirmText: "Soll ich das Projekt jetzt wirklich anlegen?",
      },
    ],
  },
};

export function tourExists(id: string): boolean { return !!TOURS[id]; }
