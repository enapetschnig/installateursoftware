// ============================================================
// B4Y SuperAPP – E-Mail: responsives 3-Spalten-Shell (Outlook-ähnlich)
// PC/iPad-Landscape: 3 Spalten (Postfach/Ordner · Liste · Lesebereich).
// Schmaler (iPad-Portrait/Handy): zwei-Pane – Liste ODER Lesebereich (mit Zurück).
// Demo-Banner zeigt klar, dass keine echte Graph-Verbindung besteht.
// ============================================================
import { ReactNode } from "react";
import { ArrowLeft, Info } from "lucide-react";
import { EmailConnection } from "../../lib/email-types";

export default function EmailLayout({
  connection, sidebar, list, reader, mobileReader, onBack,
}: {
  connection: EmailConnection;
  sidebar: ReactNode;
  list: ReactNode;
  reader: ReactNode;
  mobileReader: boolean;
  onBack: () => void;
}) {
  return (
    <div className="flex h-[calc(100dvh-7.5rem)] flex-col">
      {!connection.connected && (
        <div className="mb-2 flex items-center gap-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
          <Info size={14} className="shrink-0" />
          <span><b>Demo-/Vorschau-Modus.</b> {connection.note} Aktionen wirken lokal und werden nicht synchronisiert oder versendet.</span>
        </div>
      )}
      <div className="glass flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
        {/* Postfächer + Ordner */}
        <aside className={`shrink-0 border-b lg:w-60 lg:border-b-0 lg:border-r ${mobileReader ? "hidden lg:block" : "block"}`}
          style={{ borderColor: "var(--border)" }}>
          {sidebar}
        </aside>
        {/* Nachrichtenliste */}
        <section className={`min-h-0 flex-1 overflow-hidden border-b lg:w-[340px] lg:flex-none lg:border-b-0 lg:border-r ${mobileReader ? "hidden lg:block" : "block"}`}
          style={{ borderColor: "var(--border)" }}>
          {list}
        </section>
        {/* Lesebereich */}
        <section className={`min-h-0 flex-1 overflow-hidden ${mobileReader ? "block" : "hidden lg:block"}`}>
          {mobileReader && (
            <button onClick={onBack} className="btn-ghost m-2 px-2 lg:hidden"><ArrowLeft size={16} /> Zurück zur Liste</button>
          )}
          {reader}
        </section>
      </div>
    </div>
  );
}
