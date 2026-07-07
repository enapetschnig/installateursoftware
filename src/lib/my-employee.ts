// ============================================================
// Installateursoftware – Aktueller Mitarbeiter (Login → employees)
// Zentrale Auflösung auth.users.id -> employees-Datensatz. Für
// Zeiterfassung, Regieberichte und die Mitarbeiter-App: jeder dieser
// Bereiche braucht die employee_id des eingeloggten Nutzers.
// ============================================================
import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { useAuth } from "./auth";

export type MyEmployee = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  position: string | null;
  photo_url: string | null;
  work_time_model_id: string | null;
  worktime_model: string | null;
  weekly_hours: number | null;
  vacation_days_per_year: number | null;
  week_short: Record<string, number> | null;
  week_long: Record<string, number> | null;
};

const COLS =
  "id,first_name,last_name,email,position,photo_url,work_time_model_id,worktime_model,weekly_hours,vacation_days_per_year,week_short,week_long";

/** Lädt den Mitarbeiter-Datensatz des eingeloggten Nutzers (oder null). */
export async function loadMyEmployee(userId: string): Promise<MyEmployee | null> {
  const { data } = await supabase
    .from("employees")
    .select(COLS)
    .eq("auth_user_id", userId)
    .maybeSingle();
  return (data as MyEmployee) ?? null;
}

/** Hook: eigener Mitarbeiter-Datensatz inkl. Ladezustand. */
export function useMyEmployee(): { employee: MyEmployee | null; loading: boolean; reload: () => void } {
  const { session } = useAuth();
  const uid = session?.user?.id ?? null;
  const [employee, setEmployee] = useState<MyEmployee | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    if (!uid) { setEmployee(null); setLoading(false); return; }
    setLoading(true);
    loadMyEmployee(uid).then((e) => {
      if (cancelled) return;
      setEmployee(e);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [uid, tick]);

  return { employee, loading, reload: () => setTick((t) => t + 1) };
}
