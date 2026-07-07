// ============================================================
// B4Y SuperAPP – Zentraler Schutz vor ungespeicherten Änderungen
// ------------------------------------------------------------
// EIN wiederverwendbarer Mechanismus für Formulare mit MANUELLEM Speichern.
// Eine Komponente meldet via useUnsavedChanges(id, dirty, save) ihren Zustand an.
// Solange irgendein Formular „dirty" ist:
//   • interne Navigation (Reiterwechsel, programmatische nav()) kann über
//     useUnsavedGuard().guard(proceed) gesichert werden,
//   • Klicks auf In-App-Links (Sidebar/Links, <a href="/app/…">) werden abgefangen,
//   • Browser-Reload/Tab-schließen löst die native beforeunload-Warnung aus,
//   • window.__b4yDirtyCount wird hochgezählt, damit der version-watcher KEINEN
//     Auto-Reload während ungespeicherter Änderungen auslöst.
// Dialog mit drei Aktionen: Speichern / Verwerfen / Abbrechen.
//
// HINWEIS: React-Routers `useBlocker` benötigt einen Data-Router
// (createBrowserRouter/RouterProvider). Die App nutzt den komponentenbasierten
// BrowserRouter; dort ist useBlocker NICHT verfügbar. Deshalb wird der Route-Wechsel
// über eine Klick-Interception auf In-App-Links + guard() für programmatische Navigation
// abgesichert (kein useBlocker).
//
// Bewusst NICHT angebunden: der Dokument-Builder (Angebot/Auftrag/Rechnung) führt
// seine eigene Dirty-/beforeunload-Logik (window.__b4yDirtyCount via useDocumentBuilder) –
// um Doppelwarnungen zu vermeiden, wird er hier nicht zusätzlich registriert.
// ============================================================
import {
  createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode,
} from "react";
import { Modal } from "../components/ui";

type SaveFn = () => Promise<boolean> | boolean;
type DiscardFn = () => void;
type Entry = { dirty: boolean; save?: SaveFn; discard?: DiscardFn };

type UnsavedCtx = {
  set: (id: string, entry: Entry) => void;
  remove: (id: string) => void;
  /** Sichert eine interne/programmatische Navigation (Reiterwechsel, nav()) ab. */
  guard: (proceed: () => void) => void;
};

const Ctx = createContext<UnsavedCtx>({
  set: () => {}, remove: () => {}, guard: (p) => p(),
});

/** Reine Entscheidungslogik: nur blockieren, wenn dirty UND echter Pfadwechsel. */
export function shouldBlockNavigation(anyDirty: boolean, fromPath: string, toPath: string): boolean {
  return anyDirty && fromPath !== toPath;
}

/**
 * Meldet ein manuell zu speicherndes Formular an. `dirty` = ungespeicherte Änderungen.
 * `save` wird bei „Speichern" im Dialog aufgerufen und sollte true (Erfolg) / false (Fehler) liefern.
 */
export function useUnsavedChanges(id: string, dirty: boolean, save?: SaveFn, discard?: DiscardFn) {
  const { set, remove } = useContext(Ctx);
  const saveRef = useRef<SaveFn | undefined>(save);
  const discardRef = useRef<DiscardFn | undefined>(discard);
  saveRef.current = save;
  discardRef.current = discard;
  useEffect(() => {
    set(id, { dirty, save: () => saveRef.current?.() ?? true, discard: () => discardRef.current?.() });
    return () => remove(id);
  }, [id, dirty, set, remove]);
}

/** Liefert guard(proceed) für interne/programmatische Navigation. */
export function useUnsavedGuard() {
  const { guard } = useContext(Ctx);
  return guard;
}

/** App-Pfad ohne /app-Basename ermitteln. */
function appPath(url: URL): string {
  const path = url.pathname.replace(/^\/app(?=\/|$)/, "") || "/";
  return `${path}${url.search}`;
}

export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const mapRef = useRef<Map<string, Entry>>(new Map());
  const [anyDirty, setAnyDirty] = useState(false);
  const anyDirtyRef = useRef(false);
  const recompute = useCallback(() => {
    const d = Array.from(mapRef.current.values()).some((e) => e.dirty);
    anyDirtyRef.current = d;
    setAnyDirty(d);
  }, []);
  const set = useCallback((id: string, entry: Entry) => { mapRef.current.set(id, entry); recompute(); }, [recompute]);
  const remove = useCallback((id: string) => { mapRef.current.delete(id); recompute(); }, [recompute]);

  // version-watcher pausieren: solange dirty, __b4yDirtyCount > 0 halten.
  useEffect(() => {
    if (!anyDirty) return;
    const w = window as unknown as { __b4yDirtyCount?: number };
    w.__b4yDirtyCount = (w.__b4yDirtyCount ?? 0) + 1;
    return () => { w.__b4yDirtyCount = Math.max(0, (w.__b4yDirtyCount ?? 1) - 1); };
  }, [anyDirty]);

  // Wenn der App-Dialog gerade selbst navigiert (Speichern/Verwerfen), NICHT zusätzlich
  // die native „Website verlassen?"-Warnung zeigen. Verhindert die Doppelwarnung, weil
  // proceedNav bei In-App-Links ein echtes window.location.href-Unload auslöst, während
  // der anyDirty-State noch true ist.
  const bypassUnloadRef = useRef(false);

  // Browser-Reload / Tab schließen → native Warnung (nur ohne App-Dialog-Navigation).
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (bypassUnloadRef.current) return;
      if (anyDirty) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [anyDirty]);

  // Gemerkter „proceed"-Callback der gerade abgefangenen Navigation.
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [busy, setBusy] = useState(false);

  const guard = useCallback((proceed: () => void) => {
    if (anyDirtyRef.current) setPending(() => proceed);
    else proceed();
  }, []);

  // Klick-Interception für In-App-Links (Sidebar etc.) – Ersatz für useBlocker.
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (!anyDirtyRef.current) return;
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as HTMLElement)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank") return;
      const href = a.getAttribute("href") || "";
      const url = href.startsWith("#/")
        ? new URL(`/app${href.slice(1)}`, window.location.origin)
        : new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin || !url.pathname.startsWith("/app")) return;
      const toPath = appPath(url);
      const fromPath = appPath(new URL(window.location.href));
      if (!shouldBlockNavigation(true, fromPath, toPath)) return;
      e.preventDefault();
      e.stopPropagation();
      setPending(() => () => { window.location.href = url.href; });
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  const open = pending !== null;

  const proceedNav = useCallback(() => {
    // App-Dialog hat entschieden → native beforeunload-Warnung für diese Navigation unterdrücken.
    bypassUnloadRef.current = true;
    setPending((p) => { if (p) p(); return null; });
    // Bei reiner SPA-Navigation (kein echtes Unload) das Flag wieder freigeben,
    // damit ein späterer echter Reload/Schließen wieder normal warnt.
    setTimeout(() => { bypassUnloadRef.current = false; }, 200);
  }, []);
  const cancelNav = useCallback(() => setPending(null), []);

  // „Verwerfen": lokale Änderungen der dirty-Formulare zurücksetzen (wichtig bei
  // In-Place-Tabwechsel, wo die Komponente montiert bleibt), dann weiternavigieren.
  const onDiscard = useCallback(() => {
    Array.from(mapRef.current.values()).filter((e) => e.dirty).forEach((e) => e.discard?.());
    proceedNav();
  }, [proceedNav]);

  const saveAll = useCallback(async () => {
    const entries = Array.from(mapRef.current.values()).filter((e) => e.dirty);
    for (const e of entries) {
      const ok = await e.save?.();
      if (ok === false) return false; // Fehler → Formular zeigt eigenen Fehler, Navigation abbrechen
    }
    return true;
  }, []);

  const onSave = useCallback(async () => {
    setBusy(true);
    const ok = await saveAll();
    setBusy(false);
    if (ok) proceedNav();   // Erfolg → weiter navigieren
    else cancelNav();        // Fehler → auf der Ansicht bleiben
  }, [saveAll, proceedNav, cancelNav]);

  return (
    <Ctx.Provider value={{ set, remove, guard }}>
      {children}
      <Modal open={open} onClose={cancelNav} title="Ungespeicherte Änderungen">
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Es gibt ungespeicherte Änderungen. Möchtest du sie speichern, bevor du fortfährst?
        </p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button className="btn-ghost" onClick={cancelNav} disabled={busy}>Abbrechen</button>
          <button className="btn-outline text-rose-600" onClick={onDiscard} disabled={busy}>Verwerfen</button>
          <button className="btn-primary" onClick={onSave} disabled={busy}>{busy ? "Speichern …" : "Speichern"}</button>
        </div>
      </Modal>
    </Ctx.Provider>
  );
}
