// ============================================================
// B4Y SuperAPP – Playwright-Konfiguration (Browser-Smoke)
// Start: `npm run e2e` (Dev-Server wird automatisch gestartet).
// Zugangsdaten: B4Y_E2E_EMAIL/B4Y_E2E_PASSWORD aus .env.local
// (gitignored; einmalig einrichten mit `npm run e2e:setup`).
// Specs heißen bewusst *.pw.ts, damit Vitest sie nicht einsammelt.
// ============================================================
import { defineConfig } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";

// .env.local laden (nur fehlende Variablen setzen, nichts überschreiben).
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"|"$/g, "");
  }
}

export default defineConfig({
  testDir: "./e2e",
  testMatch: /.*\.pw\.ts$/,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  // Smoke läuft sequenziell gegen EINE echte Entwicklungs-DB – keine Parallelität.
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:5173",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run dev",
    url: "http://localhost:5173/app/login",
    reuseExistingServer: true,
    timeout: 90_000,
  },
});
