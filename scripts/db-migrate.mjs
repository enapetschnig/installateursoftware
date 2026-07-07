#!/usr/bin/env node
// ============================================================
// Installateursoftware – Migrationsrunner (plattformunabhängig)
//
// Wendet neue Dateien aus supabase/migrations/ direkt über die
// Supabase-Management-API an und trackt sie in
// b4y_internal.migration_files (gleiche Tracking-Tabelle wie der
// frühere PowerShell-Runner der B4Y SuperAPP).
//
// Zugang: .env.supabase.local (gitignored) mit
//   SUPABASE_PROJECT_REF=<ref>
//   SUPABASE_ACCESS_TOKEN=<sbp_...>
//
// Aufruf:  node scripts/db-migrate.mjs [--dry-run]
// ============================================================
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const migrationsDir = join(root, "supabase", "migrations");
const dryRun = process.argv.includes("--dry-run");

// Übersprungene Altdateien (durch neuere Varianten ersetzt, siehe
// scripts/supabase-migration-policy.json der B4Y-Historie).
const SKIP = new Set([
  "0114_microsoft_oauth_tokens.sql",
  "0115_microsoft_mail_audit_log.sql",
  "0116_api_rate_limit.sql",
]);

function loadEnv() {
  const env = { ...process.env };
  for (const file of [".env.supabase.local", ".env.local"]) {
    const p = join(root, file);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !(m[1] in process.env)) env[m[1]] = m[2];
    }
  }
  return env;
}

const env = loadEnv();
const ref = env.SUPABASE_PROJECT_REF;
const token = env.SUPABASE_ACCESS_TOKEN;
if (!ref || !token) {
  console.error("FEHLER: SUPABASE_PROJECT_REF / SUPABASE_ACCESS_TOKEN fehlen (.env.supabase.local).");
  process.exit(1);
}

async function query(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "installateursoftware-db-migrate",
    },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 1500)}`);
  return text ? JSON.parse(text) : [];
}

const main = async () => {
  await query(`create schema if not exists b4y_internal;
    create table if not exists b4y_internal.migration_files (
      filename text primary key,
      applied_at timestamptz not null default now()
    );`);
  const done = new Set((await query("select filename from b4y_internal.migration_files;")).map((r) => r.filename));
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  const pending = files.filter((f) => !done.has(f) && !SKIP.has(f));
  if (pending.length === 0) {
    console.log("Keine neuen Migrationen – DB ist aktuell.");
    return;
  }
  console.log(`${pending.length} neue Migration(en):`);
  for (const fn of pending) {
    if (dryRun) {
      console.log(`  würde anwenden: ${fn}`);
      continue;
    }
    const sql = readFileSync(join(migrationsDir, fn), "utf8");
    process.stdout.write(`  ${fn} ... `);
    try {
      await query(sql);
      await query(`insert into b4y_internal.migration_files (filename) values ('${fn.replaceAll("'", "''")}') on conflict do nothing;`);
      console.log("OK");
    } catch (err) {
      console.log("FEHLER");
      console.error(String(err).slice(0, 2000));
      process.exit(1);
    }
  }
  console.log("Fertig.");
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
