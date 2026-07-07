// ============================================================
// B4Y SuperAPP – Browser-Smoke (Playwright)
// Grundlegende Flows gegen den lokalen Dev-Server (echte Entwicklungs-DB):
// Login, Kernnavigation, Einstellungen-Tab-URL-Sync.
// LESEND: legt keine Datensätze an. Neue UI-Blöcke ergänzen bei Bedarf
// eigene *.pw.ts-Specs (Testdaten immer mit „E2E-TEST" kennzeichnen).
// ============================================================
import { test, expect, Page } from "@playwright/test";

const EMAIL = process.env.B4Y_E2E_EMAIL ?? "";
const PASSWORD = process.env.B4Y_E2E_PASSWORD ?? "";

test.skip(
  !EMAIL || !PASSWORD,
  "B4Y_E2E_EMAIL/B4Y_E2E_PASSWORD fehlen in .env.local – zuerst `npm run e2e:setup` ausführen."
);

async function login(page: Page) {
  await page.goto("/app/login");
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "Anmelden" }).click();
  // Erfolgreich = App-Chrome sichtbar (Abmelden-Button im Layout).
  await expect(page.getByTitle("Abmelden")).toBeVisible({ timeout: 15_000 });
}

test("Login funktioniert und Dashboard lädt", async ({ page }) => {
  await login(page);
  await expect(page).not.toHaveURL(/\/login/);
});

test("Einstellungen: Reiter-Klick hält ?tab= synchron", async ({ page }) => {
  await login(page);
  await page.goto("/app/einstellungen?tab=modulmap");
  // Modulmap-Reiter aktiv (aus der URL übernommen)
  await expect(page.getByRole("button", { name: "Modulmap" })).toBeVisible();
  // Manueller Reiterwechsel muss die URL mitziehen (State→URL-Sync)
  await page.getByRole("button", { name: "Firmeneinstellungen" }).click();
  await expect(page).toHaveURL(/tab=firma/);
  await expect(page.getByRole("button", { name: "Nummernkreise" })).toBeVisible();
  await page.getByRole("button", { name: "Nummernkreise" }).click();
  await expect(page).toHaveURL(/tab=nummernkreise/);
});

test("Projekte-Liste lädt", async ({ page }) => {
  await login(page);
  await page.goto("/app/projekte");
  await expect(page.getByRole("heading", { name: "Projekte" })).toBeVisible();
});
