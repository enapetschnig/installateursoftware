import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";

type Profile = { id: string; name: string | null; role: string | null; position: string | null };
type AuthState = {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthState>({} as AuthState);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      // Nach Klick auf einen Passwort-zurücksetzen-Link den Nutzer zwingend auf die
      // „Passwort festlegen"-Seite leiten (statt stumm in der App zu landen).
      if (event === "PASSWORD_RECOVERY") window.location.hash = "#/passwort-setzen";
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session?.user) { setProfile(null); return; }
    supabase.from("profiles").select("id,name,role,position").eq("id", session.user.id).maybeSingle()
      .then(({ data }) => setProfile(data as Profile | null));
  }, [session]);

  async function signIn(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error ? error.message : null };
  }
  // scope 'local': nur DIESES Gerät abmelden. Der supabase-js-Default 'global'
  // würde alle Sessions des Users widerrufen – beim Parallelbetrieb PC + iPad
  // fliegt sonst das jeweils andere Gerät mit raus (wirkt eingeloggt, aber alle
  // /api/*-Aufrufe antworten "Nicht angemeldet.").
  async function signOut() { await supabase.auth.signOut({ scope: "local" }); }

  return <Ctx.Provider value={{ session, profile, loading, signIn, signOut }}>{children}</Ctx.Provider>;
}
export const useAuth = () => useContext(Ctx);
