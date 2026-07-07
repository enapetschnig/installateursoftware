// ============================================================
// B4Y SuperAPP – E2E-Benutzer einrichten (einmalig / idempotent)
// ------------------------------------------------------------
// Legt den Playwright-Smoke-Benutzer an bzw. setzt sein Passwort neu:
//   1. Service-Key über die Supabase-Management-API beziehen
//      (SUPABASE_PROJECT_REF + SUPABASE_ACCESS_TOKEN aus .env.supabase.local)
//   2. Auth-User erstellen/aktualisieren (email_confirm, Zufallspasswort)
//   3. memberships-Zeile (Org 'bau4you') + profiles-Zeile (role 'admin') upserten
//   4. Zugangsdaten nach .env.local schreiben (B4Y_E2E_EMAIL/B4Y_E2E_PASSWORD)
// Secrets werden NIE geloggt und NIE committed (.env*.local ist gitignored).
// Aufruf: npm run e2e:setup
// ============================================================
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";

const E2E_EMAIL = "e2e-test@b4y-superapp.app";
const E2E_NAME = "E2E-TEST Bot";

function parseEnvFile(path) {
  if (!existsSync(path)) return {};
  const out = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^"|"$/g, "");
  }
  return out;
}

async function jsonFetch(url, options, okStatus = [200, 201]) {
  const res = await fetch(url, options);
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: res.status, ok: okStatus.includes(res.status), body };
}

const supaEnv = parseEnvFile(".env.supabase.local");
const ref = supaEnv.SUPABASE_PROJECT_REF;
const accessToken = supaEnv.SUPABASE_ACCESS_TOKEN;
if (!ref || !accessToken) {
  console.error("FEHLER: SUPABASE_PROJECT_REF / SUPABASE_ACCESS_TOKEN fehlen in .env.supabase.local");
  process.exit(1);
}
const supaUrl = `https://${ref}.supabase.co`;

// 1) Service-Key über die Management-API (wird nur im Speicher gehalten)
const keysRes = await jsonFetch(`https://api.supabase.com/v1/projects/${ref}/api-keys`, {
  headers: { Authorization: `Bearer ${accessToken}` },
});
if (!keysRes.ok) {
  console.error(`FEHLER: Management-API api-keys → HTTP ${keysRes.status}`);
  process.exit(1);
}
const serviceKey = (keysRes.body || []).find((k) => k.name === "service_role")?.api_key;
if (!serviceKey) {
  console.error("FEHLER: service_role-Key nicht in der Management-API-Antwort gefunden.");
  process.exit(1);
}
const adminHeaders = {
  apikey: serviceKey,
  Authorization: `Bearer ${serviceKey}`,
  "Content-Type": "application/json",
};

// 2) Auth-User erstellen bzw. Passwort neu setzen (idempotent)
const password = randomBytes(18).toString("base64url");
let userId = null;
const createRes = await jsonFetch(`${supaUrl}/auth/v1/admin/users`, {
  method: "POST",
  headers: adminHeaders,
  body: JSON.stringify({
    email: E2E_EMAIL,
    password,
    email_confirm: true,
    user_metadata: { name: E2E_NAME },
  }),
});
if (createRes.ok) {
  userId = createRes.body?.id ?? null;
  console.log("E2E-Benutzer neu angelegt.");
} else {
  // Existiert vermutlich schon → per E-Mail suchen und Passwort aktualisieren.
  const listRes = await jsonFetch(
    `${supaUrl}/auth/v1/admin/users?page=1&per_page=200`,
    { headers: adminHeaders }
  );
  const existing = (listRes.body?.users || []).find(
    (u) => (u.email || "").toLowerCase() === E2E_EMAIL
  );
  if (!existing) {
    console.error(`FEHLER: Benutzer konnte weder angelegt (HTTP ${createRes.status}) noch gefunden werden.`);
    process.exit(1);
  }
  userId = existing.id;
  const updRes = await jsonFetch(`${supaUrl}/auth/v1/admin/users/${userId}`, {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({ password, email_confirm: true }),
  });
  if (!updRes.ok) {
    console.error(`FEHLER: Passwort-Update → HTTP ${updRes.status}`);
    process.exit(1);
  }
  console.log("E2E-Benutzer existierte bereits – Passwort neu gesetzt.");
}

// 3) Mandanten-Zuordnung (memberships) + Vollzugriff (profiles.role='admin')
const orgRes = await jsonFetch(
  `${supaUrl}/rest/v1/organizations?slug=eq.bau4you&select=id`,
  { headers: adminHeaders }
);
const orgId = orgRes.body?.[0]?.id;
if (!orgId) {
  console.error("FEHLER: Organisation 'bau4you' nicht gefunden.");
  process.exit(1);
}
const memRes = await jsonFetch(
  `${supaUrl}/rest/v1/memberships?on_conflict=user_id,organization_id`,
  {
    method: "POST",
    headers: { ...adminHeaders, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ user_id: userId, organization_id: orgId }),
  },
  [200, 201]
);
if (!memRes.ok) {
  console.error(`FEHLER: membership-Upsert → HTTP ${memRes.status}`);
  process.exit(1);
}
const profRes = await jsonFetch(
  `${supaUrl}/rest/v1/profiles?on_conflict=id`,
  {
    method: "POST",
    headers: { ...adminHeaders, Prefer: "resolution=merge-duplicates" },
    body: JSON.stringify({ id: userId, name: E2E_NAME, role: "admin" }),
  },
  [200, 201]
);
if (!profRes.ok) {
  console.error(`FEHLER: profiles-Upsert → HTTP ${profRes.status}`);
  process.exit(1);
}

// 4) Zugangsdaten nach .env.local (bestehende Einträge erhalten, E2E-Zeilen ersetzen)
const envPath = ".env.local";
let lines = existsSync(envPath)
  ? readFileSync(envPath, "utf8").split(/\r?\n/).filter((l) => !/^B4Y_E2E_(EMAIL|PASSWORD)=/.test(l))
  : [];
while (lines.length && lines[lines.length - 1] === "") lines.pop();
lines.push(`B4Y_E2E_EMAIL=${E2E_EMAIL}`, `B4Y_E2E_PASSWORD=${password}`, "");
writeFileSync(envPath, lines.join("\n"), "utf8");

console.log(`Fertig: ${E2E_EMAIL} eingerichtet (Org bau4you, Rolle admin); Zugangsdaten in .env.local.`);
