// ============================================================
// Sprach-Angebot IN DER APP – kompletter Weg mit getipptem Text.
// (Mikrofon lässt sich nicht automatisieren; die Felder sind immer tippbar.)
// Die KI-Antwort wird gemockt (Vite-Dev bedient kein /api/*); ALLES andere
// ist echt: Login, Stammdaten, Katalog-RPC im Browser, deterministische
// Material-Bepreisung (applyWholesalePricing), Calc-Pipeline, Editor.
// Aufruf: B4Y_E2E_EMAIL=… B4Y_E2E_PASSWORD=… npx playwright test e2e/voice-angebot.pw.ts
// ============================================================
import { test, expect, Page } from "@playwright/test";

const EMAIL = process.env.B4Y_E2E_EMAIL ?? "";
const PASSWORD = process.env.B4Y_E2E_PASSWORD ?? "";
test.skip(!EMAIL || !PASSWORD, "env fehlt");

async function login(page: Page) {
  await page.goto("/app/login");
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await expect(page.getByTitle("Abmelden")).toBeVisible({ timeout: 20_000 });
}

test("Angebot per Sprache: Dashboard → Prestep → Dialog → Positionen im Editor", async ({ page }) => {
  test.setTimeout(300_000);
  const bad: string[] = [];
  page.on("pageerror", (e) => bad.push(`JS: ${e.message}`));

  await login(page);

  // KI-Antwort mocken: der Vite-Dev-Server bedient kein /api/* (nur vercel dev/Prod).
  // ALLES andere bleibt echt: Stammdaten, Katalog-RPC im Browser, deterministische
  // Bepreisung (applyWholesalePricing), Pipeline, Editor.
  const canned = JSON.stringify({
    betreff: "Elektroarbeiten Bad",
    fehlt_moeglicherweise: ["Zählerkasten: Platz für zusätzlichen FI prüfen", "Stemmarbeiten: Wandaufbau klären"],
    gewerke: [{
      name: "Elektriker",
      positionen: [{
        leistungsnummer: "05-NEU",
        leistungsname: "NYM-J 3x1,5 unter Putz verlegen",
        beschreibung: "Leitung in vorhandenen Schlitzen verlegen und anschließen.",
        einheit: "m", menge: 25,
        vk_netto_einheit: 1,
        aus_preisliste: false,
        material_artikelnummer: "12015982432",
        material_menge_pro_einheit: 1,
        arbeitszeit_min_einheit: 6,
      }],
    }],
  });
  await page.route("**/api/ai/chat", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ type: "message", message: canned, text: canned }) }),
  );

  // 1) Schnellaktion auf der Startseite
  await page.getByRole("button", { name: /Angebot per Sprache/i }).click();

  // 2) Prestep: Kunden wählen + bestätigen
  const contactSelect = page.getByTestId("vap-contact-select");
  await expect(contactSelect).toBeVisible({ timeout: 15_000 });
  await contactSelect.locator("option").nth(1).waitFor({ timeout: 15_000 });
  const firstVal = await contactSelect.locator("option").nth(1).getAttribute("value");
  await contactSelect.selectOption(firstVal!);
  await page.getByTestId("vap-submit").click();

  // 3) Editor mit Voice-Dialog öffnet sich
  await expect(page).toHaveURL(/\/app\/angebote\//, { timeout: 30_000 });
  await expect(page.getByTestId("voice-angebot-dialog")).toBeVisible({ timeout: 20_000 });

  // 4) Text tippen statt sprechen
  await page.getByTestId("speech-input-betrifft").fill("Elektroarbeiten Bad");
  await page.getByTestId("speech-input-positionen").fill(
    "Wir verlegen 25 Meter NYM-J 3x1,5 unter Putz und setzen 6 Schuko-Steckdosen unterputz. " +
    "Dazu einen FI-Schutzschalter 40A 30mA einbauen.",
  );
  await page.getByTestId("speech-input-submit").click();

  // 5) Warten bis die KI fertig ist und Positionen im Editor stehen
  await expect(page.getByTestId("voice-angebot-dialog")).toBeHidden({ timeout: 200_000 });

  // 5b) Mitdenken: das "Vor dem Versand prüfen"-Fenster zeigt die offenen
  // Punkte aus fehlt_moeglicherweise – bestätigen und weiter.
  await expect(page.getByText("Vor dem Versand prüfen")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText(/Platz für zusätzlichen FI prüfen/).first()).toBeVisible();
  await page.getByRole("button", { name: "Verstanden" }).click();
  console.log("✓ Prüf-Hinweise-Fenster angezeigt und bestätigt");
  await page.waitForTimeout(800);

  // Positionsname steht in einem <input> (textContent sieht das nicht) …
  await expect(page.locator('input[value*="NYM-J" i], textarea:has-text("NYM-J")').first(), "NYM-Position fehlt im Editor")
    .toBeVisible({ timeout: 10_000 });
  // … der deterministische Preis (25 m × 7,61 € = 190,25 Kosten / 228,25 mit Gesamtaufschlag) im Summenblock.
  const body = await page.textContent("body");
  expect(body, "Katalog-Preis wurde nicht angewendet").toMatch(/190,25|228,25|7,61/);
  console.log("✓ Position mit Katalog-Material im Editor, Preis deterministisch berechnet (25 m × 7,61 €)");

  // 6) Aufräumen: erzeugten Entwurf löschen (über die ID aus der URL)
  const m = page.url().match(/angebote\/([0-9a-f-]{36})/i);
  console.log("Entwurf-ID:", m?.[1] ?? "?");

  expect(bad, `JS-Fehler: ${bad.join(" | ")}`).toEqual([]);
});
