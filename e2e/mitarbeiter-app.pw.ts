// Smoke der umgebauten Mitarbeiter-App (/m): Home-Launcher + Regie-Formular
// mit Sprach-Erfassung. Screenshots -> test-results/ma/. Prüft Rendering +
// Konsolenfehler. Der eigentliche KI-Parse braucht /api (Vercel) und wird
// hier nicht ausgelöst – geprüft wird die UI.
import { test, expect } from "@playwright/test";

const EMAIL = process.env.B4Y_E2E_EMAIL ?? "";
const PASSWORD = process.env.B4Y_E2E_PASSWORD ?? "";
const OUT = "test-results/ma";

test("Mitarbeiter-App durchklicken", async ({ page }) => {
  test.skip(!EMAIL || !PASSWORD, "Login fehlt");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 160)); });

  await page.goto("/app/login");
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole("button", { name: "Anmelden" }).click();
  await page.waitForURL(/\/app\/?($|\?)/, { timeout: 30_000 }).catch(() => {});

  for (const [name, path] of [
    ["01-home", "/app/m"],
    ["02-zeit", "/app/m/zeit"],
    ["03-regie-liste", "/app/m/regie"],
    ["04-regie-neu", "/app/m/regie/neu"],
  ] as const) {
    await page.goto(path);
    await page.waitForTimeout(1800);
    const body = (await page.locator("body").innerText().catch(() => "")) || "";
    expect(body.length, `${name} rendert`).toBeGreaterThan(20);
    await page.screenshot({ path: `${OUT}/${name}.png` });
  }

  // Regie-Formular: Sprach-Karte + Mikro-Buttons vorhanden?
  await expect(page.getByText("Per Sprache erfassen")).toBeVisible();
  await expect(page.getByText("Material", { exact: false }).first()).toBeVisible();

  console.log("pageerrors:", errors.length ? errors : "keine");
  expect(errors, "keine Laufzeitfehler").toEqual([]);
});
