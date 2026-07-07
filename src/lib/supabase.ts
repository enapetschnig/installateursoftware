import { createClient } from "@supabase/supabase-js";

// Publishable/anon key ist bewusst öffentlich (Frontend). Schutz erfolgt über RLS.
const url = (import.meta.env.VITE_SUPABASE_URL as string) || "https://xyhgckqxowqnzjtoblfs.supabase.co";
const key = (import.meta.env.VITE_SUPABASE_ANON_KEY as string) || "sb_publishable_akH66S1-i4WaHAbVrCd50A_qd7OrwfD";

export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    // PKCE: Einladungs-/Recovery-Links liefern `?code=` in der Query.
    flowType: "pkce",
  },
});
