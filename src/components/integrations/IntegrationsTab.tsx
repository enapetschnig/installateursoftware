// ============================================================
// B4Y SuperAPP – Settings-Tab "Integrationen"
// ------------------------------------------------------------
// Container fuer alle Drittanbieter-Verknuepfungen. Aktuell nur
// Microsoft/Outlook; Struktur (Grid) ist bewusst zukunftsfaehig,
// damit z. B. Google, DATEV, WhatsApp spaeter dazukommen koennen.
// ============================================================

import MicrosoftConnectCard from "./MicrosoftConnectCard";

export default function IntegrationsTab() {
  return (
    <div className="space-y-5">
      <div className="glass p-4">
        <h2 className="mb-1 text-lg font-bold">Integrationen</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Verknuepfe externe Dienste mit b4y, damit E-Mails, Kalender und
          Dokumente nahtlos zusammenspielen. Verbindungen kannst du jederzeit
          hier trennen.
        </p>
      </div>

      {/* Grid: derzeit eine Karte, spaeter mehrere Anbieter nebeneinander. */}
      <div className="grid gap-4 md:grid-cols-2">
        <MicrosoftConnectCard />
      </div>
    </div>
  );
}
