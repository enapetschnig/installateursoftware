import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useTheme } from "../lib/theme";
import { supabase } from "../lib/supabase";
import { Moon, Sun, Eye } from "lucide-react";
import { LogoFull } from "../components/Logo";
import { APP_NAME, appUrl } from "../lib/branding";

export default function Login() {
  const { signIn } = useAuth();
  const { base, care, toggleCare } = useTheme();
  const nav = useNavigate();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [msg, setMsg] = useState<{ kind: "err" | "ok"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setMsg(null);
    if (mode === "login") {
      const { error } = await signIn(email.trim(), password);
      setBusy(false);
      if (error) setMsg({ kind: "err", text: error }); else nav("/");
    } else {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(), password,
        options: { data: { name: name.trim() } },
      });
      setBusy(false);
      if (error) { setMsg({ kind: "err", text: error.message }); return; }
      if (data.session) { nav("/"); return; }
      setMsg({ kind: "ok", text: "Konto erstellt. Falls eine Bestätigungs-E-Mail kommt, bitte bestätigen – danach anmelden." });
      setMode("login");
    }
  }

  async function forgotPassword() {
    if (!email.trim()) { setMsg({ kind: "err", text: "Bitte zuerst deine E-Mail-Adresse eingeben." }); return; }
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: appUrl("/#/passwort-setzen") });
    setBusy(false);
    setMsg(error
      ? { kind: "err", text: error.message }
      : { kind: "ok", text: "Falls die Adresse existiert, wurde ein Link zum Passwort-Zurücksetzen gesendet." });
  }

  return (
    <div className="relative grid h-full place-items-center overflow-hidden bg-gradient-to-br from-brand-950 via-slate-900 to-black p-4">
      <div className="pointer-events-none absolute -left-32 -top-32 h-96 w-96 rounded-full bg-brand-600/30 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-32 -right-32 h-96 w-96 rounded-full bg-brand-400/20 blur-3xl" />
      <button onClick={toggleCare} className="absolute right-4 top-4 rounded-xl p-2 text-white/70 hover:bg-white/10">
        {care ? <Eye size={18} /> : base === "dark" ? <Moon size={18} /> : <Sun size={18} />}
      </button>
      <div className="relative w-full max-w-sm rounded-3xl border border-white/10 bg-white/5 p-8 shadow-2xl backdrop-blur-xl">
        <div className="mb-6 flex flex-col items-center">
          <div className="text-white"><LogoFull height={62} /></div>
          <h1 className="mt-3 text-base font-extrabold text-white">{APP_NAME}</h1>
          <p className="text-sm text-white/60">{mode === "login" ? "Anmeldung" : "Konto erstellen"}</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          {mode === "signup" && (
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-white/60">Name</label>
              <input className="input border-white/15 bg-white/10 text-white placeholder:text-white/40"
                value={name} onChange={(e) => setName(e.target.value)} placeholder="Lukasz Baranowski" />
            </div>
          )}
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-white/60">E-Mail</label>
            <input className="input border-white/15 bg-white/10 text-white placeholder:text-white/40" type="email" autoComplete="email"
              value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="name@bau4you.at" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-white/60">Passwort</label>
            <input className="input border-white/15 bg-white/10 text-white placeholder:text-white/40" type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} placeholder="••••••••" />
          </div>
          {msg && <div className={`rounded-xl px-3 py-2 text-sm ${msg.kind === "err" ? "bg-rose-500/15 text-rose-200" : "bg-emerald-500/15 text-emerald-200"}`}>{msg.text}</div>}
          <button className="btn-primary w-full" disabled={busy}>{busy ? "Bitte warten …" : mode === "login" ? "Anmelden" : "Konto erstellen"}</button>
        </form>
        <button onClick={() => { setMode(mode === "login" ? "signup" : "login"); setMsg(null); }}
          className="mt-4 w-full text-center text-sm text-white/60 hover:text-white">
          {mode === "login" ? "Noch kein Konto? Jetzt erstellen" : "Schon ein Konto? Zur Anmeldung"}
        </button>
        {mode === "login" && (
          <button type="button" onClick={forgotPassword} disabled={busy}
            className="mt-2 w-full text-center text-xs text-white/45 hover:text-white/80">
            Passwort vergessen?
          </button>
        )}
      </div>
    </div>
  );
}
