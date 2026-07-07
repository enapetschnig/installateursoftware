// ============================================================
// B4Y SuperAPP – E-Mail: Empty-State ohne Microsoft-Verbindung
// ------------------------------------------------------------
// Wird von /email gerendert, solange useMicrosoftConnection()
// `connected=false` liefert. Der CTA schickt den User in die
// Einstellungen (Tab "integrationen"), wo der eigentliche
// Connect-Flow ueber /api/auth/microsoft-link angestossen wird.
// Bewusst kein direkter Redirect zu Microsoft aus dieser Seite,
// damit alle Connect-Aktionen zentral in den Einstellungen
// stattfinden (dort auch die Disconnect-/Status-UI).
// ============================================================
import { useNavigate } from "react-router-dom";
import { Mail, PlugZap, ArrowRight } from "lucide-react";

export default function ConnectEmptyState() {
  const navigate = useNavigate();
  return (
    <div className="grid place-items-center py-16">
      <div className="glass mx-4 max-w-xl px-6 py-10 text-center">
        <div
          className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full"
          style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
        >
          <Mail size={26} />
        </div>
        <h2 className="mb-2 text-xl font-bold">
          E-Mail-Postfach noch nicht verbunden
        </h2>
        <p className="mx-auto mb-6 max-w-md text-sm text-slate-500 dark:text-slate-400">
          Verbinde dein Microsoft-Konto in den Einstellungen, um Mails direkt in
          der SuperAPP zu lesen und zu senden. Der Zugriff ist mandantengetrennt
          und kann jederzeit widerrufen werden.
        </p>
        <button
          type="button"
          className="btn-primary mx-auto"
          onClick={() => navigate("/einstellungen?tab=integrationen")}
        >
          <PlugZap size={16} />
          Zu den Einstellungen
          <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
}
