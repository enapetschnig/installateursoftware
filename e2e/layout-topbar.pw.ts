// ============================================================
// B4Y SuperAPP – Browser-Smoke: Layout-Scrollverhalten + Topbar-Indikatoren
//  - Modulwechsel über die Sidebar setzt den Inhaltsbereich (<main>) auf oben zurück.
//  - Topbar: Benachrichtigungen / Aufgaben / Neue E-Mails sind klickbare Panels
//    mit datenbasierten Zählern bzw. erklärten Leerzuständen (keine Fake-Badges).
// LESEND: legt keine Datensätze an.
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
  await expect(page.getByTitle("Abmelden")).toBeVisible({ timeout: 15_000 });
}

test("Sidebar-Modulwechsel: Inhalt startet wieder oben", async ({ page }) => {
  await login(page);
  await page.goto("/app/einstellungen");
  await expect(page.getByRole("heading", { name: "Einstellungen" })).toBeVisible();
  // Inhaltsbereich nach unten scrollen
  await page.locator("main").evaluate((el) => { el.scrollTop = 600; });
  expect(await page.locator("main").evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  // Modulwechsel über die Sidebar → Mitarbeiter → zurück zu Einstellungen
  await page.getByRole("link", { name: "Mitarbeiter", exact: true }).click();
  await expect(page).toHaveURL(/\/mitarbeiter/);
  await page.getByRole("link", { name: "Einstellungen", exact: true }).click();
  await expect(page).toHaveURL(/\/einstellungen/);
  await expect(page.getByRole("heading", { name: "Einstellungen" })).toBeVisible();
  expect(await page.locator("main").evaluate((el) => el.scrollTop)).toBe(0);
});

test("Topbar: Benachrichtigungen/Aufgaben/Mails-Panels öffnen und schließen", async ({ page }) => {
  await login(page);
  // Erst warten, bis die Rollenrechte geladen sind (Sidebar zeigt Module) –
  // die Indikatoren sind rechtegeprüft und erscheinen erst danach.
  await expect(page.getByRole("link", { name: "Projekte", exact: true })).toBeVisible({ timeout: 15_000 });

  // Screenshot-Button ist immer sichtbar (Aufnahme selbst = Browser-Dialog, nicht automatisierbar)
  await expect(page.getByRole("button", { name: "Screenshot aufnehmen" })).toBeVisible();

  // Benachrichtigungen (Glocke): Panel mit Inhalt oder erklärtem Leerzustand
  await page.getByRole("button", { name: "Benachrichtigungen" }).click();
  const bellPanel = page.getByRole("dialog", { name: "Benachrichtigungen" });
  await expect(bellPanel).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(bellPanel).not.toBeVisible();

  // Aufgaben: Panel zeigt offene Aufgaben oder Leerzustand
  await page.getByRole("button", { name: "Aufgaben" }).click();
  const taskPanel = page.getByRole("dialog", { name: "Aufgaben" });
  await expect(taskPanel).toBeVisible();
  await expect(taskPanel.getByText(/Offene Aufgaben|Keine offenen Aufgaben/).first()).toBeVisible();
  await page.keyboard.press("Escape");

  // Neue E-Mails: ohne Microsoft-Verbindung erklärter Zustand + Link zur E-Mail-Seite
  await page.getByRole("button", { name: "Neue E-Mails" }).click();
  const mailPanel = page.getByRole("dialog", { name: "Neue E-Mails" });
  await expect(mailPanel).toBeVisible();
  await mailPanel.getByRole("button", { name: /Zur E-Mail-Seite/ }).click();
  await expect(page).toHaveURL(/\/email/);
});
