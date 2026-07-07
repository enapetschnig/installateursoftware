// ============================================================
// Showcase-Smoke: loggt sich als Demo-Nutzer ein und öffnet jede
// Installateur-relevante Seite. Prüft, dass keine Seite abstürzt
// (Error-Boundary / leere weiße Seite) und sammelt Konsolenfehler.
// Screenshots landen in test-results/demo/.
//   Aufruf: B4Y_E2E_EMAIL=… B4Y_E2E_PASSWORD=… npx playwright test e2e/installateur-demo.pw.ts
// ============================================================
import { test, expect, Page } from "@playwright/test";

const EMAIL = process.env.B4Y_E2E_EMAIL ?? "";
const PASSWORD = process.env.B4Y_E2E_PASSWORD ?? "";
const OUT = "test-results/demo";

const consoleErrors: Record<string, string[]> = {};
let current = "start";

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${OUT}/${name}.png`, fullPage: false });
}

test.describe.configure({ mode: "serial" });

test("Installateur-Showcase durchklicken", async ({ page }) => {
  test.skip(!EMAIL || !PASSWORD, "B4Y_E2E_EMAIL/PASSWORD fehlen");
  page.on("console", (m) => { if (m.type() === "error") (consoleErrors[current] ??= []).push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => (consoleErrors[current] ??= []).push("PAGEERROR: " + String(e).slice(0, 200)));

  // Login
  current = "login";
  await page.goto("/app/login");
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await page.waitForURL(/\/app\/?($|\?)/, { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await shot(page, "01-dashboard");

  const routes: { name: string; path: string; expect?: RegExp }[] = [
    { name: "02-projekte-liste", path: "/app/projekte" },
    { name: "03-kontakte", path: "/app/kontakte" },
    { name: "04-kalkulation-leistungen", path: "/app/kalkulation/leistungen" },
    { name: "05-dokumente-angebote", path: "/app/dokumente?typ=angebote" },
    { name: "06-meine-stunden", path: "/app/meine-stunden" },
    { name: "07-stundenauswertung", path: "/app/stundenauswertung" },
    { name: "08-regieberichte", path: "/app/regieberichte" },
    { name: "09-plantafel", path: "/app/plantafel" },
    { name: "10-einstellungen", path: "/app/einstellungen" },
  ];

  for (const r of routes) {
    current = r.name;
    await page.goto(r.path);
    await page.waitForTimeout(2200);
    // Harter Absturz? -> Body dürfte nicht leer/weiß sein.
    const bodyText = (await page.locator("body").innerText().catch(() => "")) || "";
    expect(bodyText.length, `${r.name} rendert Inhalt`).toBeGreaterThan(20);
    await shot(page, r.name);
  }

  // Projekt-Board-Ansicht (Kanban mit Pipelines)
  current = "11-projekte-board";
  await page.goto("/app/projekte");
  await page.waitForTimeout(1500);
  // zweiter Ansicht-Button (Board) in der Kopfzeile
  const viewButtons = page.locator("button:has(svg)");
  await page.getByRole("button").nth(0).waitFor().catch(() => {});
  try {
    // Board-Umschalter: das LayoutGrid-Icon (zweiter Toggle)
    await page.locator("button").filter({ has: page.locator("svg") }).nth(1).click({ timeout: 3000 });
  } catch { /* ignore */ }
  await page.waitForTimeout(1500);
  await shot(page, "11-projekte-board");

  // Mitarbeiter-App (eigenes Layout /m)
  current = "12-mitarbeiter-app";
  await page.goto("/app/m");
  await page.waitForTimeout(2500);
  await shot(page, "12-mitarbeiter-app");
  const bodyM = (await page.locator("body").innerText().catch(() => "")) || "";
  expect(bodyM.length, "Mitarbeiter-App rendert").toBeGreaterThan(20);

  // Konsolenfehler ausgeben (nicht hart failen – reine Diagnose)
  const summary = Object.entries(consoleErrors).filter(([, v]) => v.length);
  console.log("\n===== KONSOLENFEHLER JE SEITE =====");
  if (!summary.length) console.log("KEINE Konsolenfehler auf allen Seiten ✅");
  for (const [k, v] of summary) { console.log(`[${k}]`); v.slice(0, 6).forEach((e) => console.log("   -", e)); }
});
