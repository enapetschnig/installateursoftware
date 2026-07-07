// ============================================================
// B4Y SuperAPP – Browser-Smoke: Enter löst die primäre Modal-Aktion aus
// Prüft das zentrale Bedienmuster (Modal in src/components/ui.tsx):
//  - Enter in einem einzeiligen Feld wirkt wie Klick auf den blauen Button
//    (nachweisbar über die Validierungsmeldung – es wird NICHTS gespeichert).
//  - Enter in textarea erzeugt weiterhin nur eine neue Zeile.
//  - Adresszusatz-Platzhalter ist appweit im Slash-Format vereinheitlicht.
// LESEND: legt keine Datensätze an (Validierung stoppt vor dem Insert).
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

test("Projektformular: Enter = Primäraktion, Textarea-Ausnahme, Slash-Platzhalter", async ({ page }) => {
  await login(page);
  await page.goto("/app/projekte");
  await page.getByRole("button", { name: "Neues Projekt" }).click();
  await expect(page.getByRole("heading", { name: "Neues Projekt" })).toBeVisible();

  // Block 3: einheitlicher Adresszusatz-Platzhalter (Slash-Format)
  await expect(page.getByPlaceholder("z. B. / Stiege 1 / Top 14 oder / Hof")).toBeVisible();

  // Enter im Betreff-Feld löst die Primäraktion aus → Validierung meldet
  // das nächste Pflichtfeld (kein Datensatz wird angelegt).
  const betreff = page.getByPlaceholder("z.B. Altbausanierung Beheimgasse");
  await betreff.fill("E2E-TEST Enter-Muster (wird nicht gespeichert)");
  await betreff.press("Enter");
  await expect(page.getByText("Bitte Kunde auswählen.")).toBeVisible();

  // Textarea-Ausnahme: Enter erzeugt eine neue Zeile, keine erneute Aktion.
  const noteArea = page.locator("textarea").first();
  await noteArea.fill("Zeile 1");
  await noteArea.press("Enter");
  await noteArea.type("Zeile 2");
  await expect(noteArea).toHaveValue("Zeile 1\nZeile 2");

  // Modal schließen, nichts gespeichert.
  await page.getByRole("button", { name: "Abbrechen" }).click();
});
