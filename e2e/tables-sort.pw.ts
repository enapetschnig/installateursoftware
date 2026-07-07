// ============================================================
// B4Y SuperAPP – Browser-Smoke: sortierbare Tabellenköpfe + Zeilenklick
// Prüft den globalen Tabellenstandard (useTableSort + SortHeader):
// Kontakte (Referenz), Kalkulation/Leistungen, Projekte, Dokumente
// (serverseitige Sortierung) und Einstellungen → Dokumentarten.
// LESEND: legt keine Datensätze an. Screenshots landen in tmp/e2e-shots
// (gitignored) zur optischen Kontrolle von Kopfzeile/Scrollbar.
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

// Sortier-Kopf (Button im th) über sein Label finden
const sortBtn = (page: Page, label: string) =>
  page.locator('thead button[aria-sort]').filter({ hasText: label }).first();

test("Tabellen: Sortier-Header + Zeilenklick funktionieren appweit", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    // Ressourcen-404s (z. B. Bilder) sind kein App-Fehler
    if (m.type() === "error" && !/Failed to load resource/i.test(m.text())) errors.push(m.text());
  });

  await login(page);

  // ── Kontakte (Referenz, unverändert funktionsfähig) ──
  await page.goto("/app/kontakte");
  await expect(sortBtn(page, "Name / Firma")).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: "tmp/e2e-shots/kontakte.png" });

  // ── Kalkulation → Leistungen: Sortierung auf/ab + Zeilenklick ──
  await page.goto("/app/kalkulation/leistungen");
  const kurz = sortBtn(page, "Kurztext");
  await expect(kurz).toBeVisible({ timeout: 15_000 });
  await kurz.click();
  await expect(kurz).toHaveAttribute("aria-sort", "ascending");
  await kurz.click();
  await expect(kurz).toHaveAttribute("aria-sort", "descending");
  await page.screenshot({ path: "tmp/e2e-shots/leistungen.png" });
  const firstServiceRow = page.locator("tbody tr").first();
  if (await firstServiceRow.count()) {
    await firstServiceRow.click();
    await expect(page).toHaveURL(/\/kalkulation\/leistungen\/[0-9a-f-]+/, { timeout: 10_000 });
    await page.screenshot({ path: "tmp/e2e-shots/leistung-editor-kalkulation.png" });
  }

  // ── Projekte ──
  await page.goto("/app/projekte");
  await expect(sortBtn(page, "Betreff")).toBeVisible({ timeout: 15_000 });
  await sortBtn(page, "Betreff").click();
  await expect(sortBtn(page, "Betreff")).toHaveAttribute("aria-sort", "ascending");
  await page.screenshot({ path: "tmp/e2e-shots/projekte.png" });

  // ── Dokumente (serverseitige Sortierung über documents_unified) ──
  await page.goto("/app/dokumente");
  const nummer = sortBtn(page, "Nummer");
  await expect(nummer).toBeVisible({ timeout: 20_000 });
  await nummer.click();
  await expect(nummer).toHaveAttribute("aria-sort", /ascending|descending/);
  await page.screenshot({ path: "tmp/e2e-shots/dokumente.png" });

  // ── Einstellungen → Dokumentarten (Verwaltungstabelle) ──
  await page.goto("/app/einstellungen?tab=dokumente");
  const bez = sortBtn(page, "Bezeichnung");
  if (await bez.count()) {
    await bez.click();
    await expect(bez).toHaveAttribute("aria-sort", "ascending");
  }
  await page.screenshot({ path: "tmp/e2e-shots/einstellungen-dokumentarten.png" });

  expect(errors, `Konsolen-/Seitenfehler: ${errors.join("\n")}`).toEqual([]);
});
