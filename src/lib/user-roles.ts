// ============================================================
// Zentrale, idempotente Rollenzuweisung (genau EINE Rolle je Benutzer).
// Vermeidet den Duplicate-Key-Fehler "user_roles_user_id_role_id_key":
//  - dieselbe Rolle erneut wählen  -> No-Op (ON CONFLICT DO NOTHING)
//  - Rollenwechsel                 -> nur fremde Rollen löschen, Ziel upserten
//  - leere Rolle                   -> alle Rollen des Benutzers entfernen
// organization_id wird per DB-Default current_org_id() gesetzt (mandantensicher).
// Wird von AccessControl (Rollenzuweisung) UND EmployeeDetail (Berechtigungen) genutzt.
// ============================================================
import { supabase } from "./supabase";

export type AssignRoleResult = { error: string | null };

/** Weist einem Benutzer genau eine Rolle zu (oder entfernt sie, wenn roleId leer). Idempotent. */
export async function assignSingleRole(userId: string, roleId: string): Promise<AssignRoleResult> {
  if (!userId) return { error: "Kein Benutzer angegeben." };

  // Rolle entfernen (keine Rolle gewählt)
  if (!roleId) {
    const del = await supabase.from("user_roles").delete().eq("user_id", userId);
    return { error: del.error ? del.error.message : null };
  }

  // 1) Andere Rollen des Benutzers entfernen (nicht die Zielrolle – die bleibt ggf. bestehen).
  const delOthers = await supabase
    .from("user_roles")
    .delete()
    .eq("user_id", userId)
    .neq("role_id", roleId);
  if (delOthers.error) return { error: delOthers.error.message };

  // 2) Zielrolle anlegen, falls noch nicht vorhanden (ON CONFLICT DO NOTHING → kein Duplicate-Key).
  const up = await supabase
    .from("user_roles")
    .upsert({ user_id: userId, role_id: roleId } as never, {
      onConflict: "user_id,role_id",
      ignoreDuplicates: true,
    });
  return { error: up.error ? up.error.message : null };
}
