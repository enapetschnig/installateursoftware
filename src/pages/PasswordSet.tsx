import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { KeyRound } from "lucide-react";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { toast, toastError } from "../lib/toast";

// Passwort-festlegen-Seite für Einladungs- und Passwort-zurücksetzen-Links.
// Der Link meldet den Nutzer per Supabase-Auth an (Session vorhanden); hier setzt
// er sein eigenes Passwort über supabase.auth.updateUser – kein Klartext, keine
// service_role, keine Rollen-/Adminvergabe.
export default function PasswordSet() {
  const { session } = useAuth();
  const nav = useNavigate();
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw1.length < 8) { toastError("Passwort muss mindestens 8 Zeichen haben."); return; }
    if (pw1 !== pw2) { toastError("Die Passwörter stimmen nicht überein."); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw1 });
    setBusy(false);
    if (error) { toastError(error.message); return; }
    toast("Passwort gesetzt – du bist angemeldet.");
    nav("/");
  }

  return (
    <div className="grid place-items-center py-16">
      <div className="glass w-full max-w-sm p-8">
        <h1 className="mb-1 flex items-center gap-2 text-lg font-bold"><KeyRound size={18} /> Passwort festlegen</h1>
        <p className="mb-5 text-sm text-slate-500 dark:text-slate-400">
          Lege ein Passwort für dein Konto fest. Danach meldest du dich künftig mit E-Mail und Passwort an.
        </p>
        {!session ? (
          <p className="rounded-xl bg-amber-500/15 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
            Bitte öffne den Einladungs- bzw. Zurücksetzen-Link aus deiner E-Mail (er meldet dich automatisch an), um hier ein Passwort zu setzen.
          </p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <label className="label">Neues Passwort</label>
              <input className="input" type="password" autoComplete="new-password" value={pw1}
                onChange={(e) => setPw1(e.target.value)} required minLength={8} placeholder="mindestens 8 Zeichen" />
            </div>
            <div>
              <label className="label">Passwort wiederholen</label>
              <input className="input" type="password" autoComplete="new-password" value={pw2}
                onChange={(e) => setPw2(e.target.value)} required minLength={8} placeholder="••••••••" />
            </div>
            <button className="btn-primary w-full" disabled={busy}>
              <KeyRound size={16} /> {busy ? "Speichern …" : "Passwort speichern"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
