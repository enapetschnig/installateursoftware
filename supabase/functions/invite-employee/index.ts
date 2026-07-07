// ============================================================
// B4Y SuperAPP – Edge Function: invite-employee
// Lädt einen Mitarbeiter sicher zur App ein (Supabase Auth Invite / Magic-Link).
//  - service_role NUR serverseitig (von Supabase automatisch als Secret bereitgestellt).
//  - Kein Klartext-Passwort: der Mitarbeiter setzt sein Passwort über den Einladungslink.
//  - Nur Administratoren dürfen einladen (serverseitige Rollenprüfung).
//  - Verknüpft employees.auth_user_id, legt/ergänzt das Profil und optional eine Rolle.
//  - Mandantenfähig: organization_id wird vom Mitarbeiter-Datensatz übernommen.
// ============================================================
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "Content-Type": "application/json" } });

// Muss mit src/lib/permissions.tsx übereinstimmen (Fallback-Admin via profiles.role).
const ADMIN_ROLE_NAMES = [
  "admin", "administrator",
  "geschaeftsfuehrer", "geschäftsführer", "geschaeftsfuehrung", "geschäftsführung",
  "gf", "gesellschafter",
];
const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test((v || "").trim());

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!url || !serviceKey) return json({ error: "secrets_missing", message: "Server nicht konfiguriert." }, 500);

    // 1) Aufrufer authentifizieren (JWT aus dem Authorization-Header).
    const authHeader = req.headers.get("Authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "unauthorized", message: "Nicht angemeldet." }, 401);

    const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
    const { data: caller, error: callerErr } = await admin.auth.getUser(jwt);
    if (callerErr || !caller?.user) return json({ error: "unauthorized", message: "Ungültige Sitzung." }, 401);
    const callerId = caller.user.id;

    // 2) Admin-Prüfung serverseitig: Legacy-Rolle (profiles.role) ODER roles.is_admin via user_roles.
    let isAdmin = false;
    const { data: prof } = await admin.from("profiles").select("role").eq("id", callerId).maybeSingle();
    if (prof?.role && ADMIN_ROLE_NAMES.includes(String(prof.role).toLowerCase())) isAdmin = true;
    if (!isAdmin) {
      const { data: uroles } = await admin.from("user_roles").select("role_id").eq("user_id", callerId);
      const roleIds = (uroles ?? []).map((r: any) => r.role_id);
      if (roleIds.length) {
        const { data: roles } = await admin.from("roles").select("id,is_admin").in("id", roleIds);
        if ((roles ?? []).some((r: any) => r.is_admin)) isAdmin = true;
      }
    }
    if (!isAdmin) return json({ error: "forbidden", message: "Nur Administratoren dürfen Mitarbeiter einladen." }, 403);

    // 3) Eingaben.
    const { employeeId, email, roleId } = await req.json();
    if (!employeeId) return json({ error: "bad_input", message: "Mitarbeiter fehlt." }, 400);
    if (!isEmail(email)) return json({ error: "bad_input", message: "Ungültige E-Mail-Adresse." }, 400);

    // Mitarbeiter laden (Name + Organisation für Profil/Mandanten).
    const { data: emp, error: empErr } = await admin.from("employees")
      .select("id, first_name, last_name, email, organization_id, auth_user_id").eq("id", employeeId).maybeSingle();
    if (empErr || !emp) return json({ error: "not_found", message: "Mitarbeiter nicht gefunden." }, 404);
    if (emp.auth_user_id) return json({ error: "already_linked", message: "Dieser Mitarbeiter hat bereits einen App-Zugang." }, 409);

    const fullName = [emp.first_name, emp.last_name].filter(Boolean).join(" ").trim() || email;
    // Einladungslink landet direkt auf der „Passwort festlegen"-Seite (HashRouter-Route).
    const redirectTo = (Deno.env.get("APP_URL") || "https://b4y-superapp.app") + "/#/passwort-setzen";

    // 4) Einladung versenden (Magic-Link, kein Klartext-Passwort).
    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: { full_name: fullName, employee_id: emp.id },
    });
    if (inviteErr || !invited?.user) {
      return json({ error: "invite_failed", message: inviteErr?.message || "Einladung konnte nicht versendet werden. SMTP/E-Mail in Supabase prüfen." }, 400);
    }
    const newUserId = invited.user.id;

    // 5) Verknüpfungen: employees.auth_user_id + Profil (Name/Org) + optionale Rolle.
    await admin.from("employees").update({ auth_user_id: newUserId, updated_at: new Date().toISOString() }).eq("id", emp.id);
    await admin.from("profiles").upsert(
      { id: newUserId, name: fullName, organization_id: emp.organization_id ?? null },
      { onConflict: "id" },
    );
    if (roleId) {
      await admin.from("user_roles").upsert({ user_id: newUserId, role_id: roleId }, { onConflict: "user_id,role_id" });
    }

    return json({ ok: true, user_id: newUserId, email, message: `Einladung an ${email} versendet.` });
  } catch (e) {
    return json({ error: "server_error", message: (e as Error).message }, 500);
  }
});
