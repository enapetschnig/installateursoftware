// ============================================================
// B4Y SuperAPP – Browser-Smoke: Dokumenteditor (Stand 2026-07-07)
//  Test 1 (rein lesend, abgeschlossenes Angebot):
//   - prominentes Dokumenttyp-Band in der Toolbar
//   - „Versenden/Erneut versenden" statt totem Abschließen-Button (ohne Klick)
//   - Drei-Punkte-Menü: Duplikat-Schutz „Auftrag bereits erstellt" (falls Auftrag existiert)
//  Test 2 (Wegwerf-Entwurf, wird am Ende gelöscht):
//   - EINE zentrale Toolbar-Aktion „Positionen einfügen" (Stamm + Aus Dokument in einem Dialog)
//   - Einfügen scrollt + leuchtet kurz auf; gezieltes „Einfügen nach Position" (Dropdown)
//   - PDF-Fallback (paged.js): Seitenzahl + Screenshots der Umbrüche –
//     Server-PDF ist im Vite-Dev nicht verfügbar → bewusst „Stattdessen drucken".
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

test("Abgeschlossenes Angebot: Typ-Band, Versenden-Aktion, Duplikat-Schutz", async ({ page }) => {
  await login(page);
  await page.goto("/app/dokumente?typ=angebote");
  await expect(page.getByRole("heading", { name: "Dokumente" })).toBeVisible({ timeout: 15_000 });
  // Gezielt ein ABGESCHLOSSENES Angebot wählen (die erste Zeile kann ein Entwurf
  // sein – z. B. ein liegengebliebener Wegwerf-Entwurf – ohne Versenden-Aktion).
  const firstRow = page.locator("tbody tr").filter({ hasText: /Abgeschlossen|Versendet|Angenommen/ }).first();
  const hasRows = await firstRow.waitFor({ state: "visible", timeout: 15_000 }).then(() => true).catch(() => false);
  if (!hasRows) test.skip(true, "Kein abgeschlossenes Angebot in der Entwicklungs-DB.");
  await firstRow.click();
  await expect(page).toHaveURL(/\/angebote\//, { timeout: 15_000 });

  // Punkt 12: Typ-Band (sticky, unübersehbar)
  await expect(page.getByTitle(/Sie bearbeiten: Angebot/)).toBeVisible({ timeout: 15_000 });

  // Punkt 10: abgeschlossen → Senden-Aktion statt totem Abschließen (NICHT klicken)
  await expect(page.getByRole("button", { name: /Versenden|Erneut versenden/ })).toBeVisible();

  // Punkt 11: Drei-Punkte-Menü – falls bereits ein Auftrag existiert, ist die
  // Erstellung sichtbar gesperrt + „Zum Auftrag wechseln" vorhanden.
  await page.getByTitle("Mehr", { exact: true }).click();
  const already = page.getByRole("button", { name: /Auftrag bereits erstellt/ });
  if (await already.count()) {
    await expect(already).toBeDisabled();
    await expect(page.getByRole("button", { name: "Zum Auftrag wechseln" })).toBeVisible();
    console.log("[editor-smoke] Duplikat-Schutz aktiv (Auftrag existiert).");
  } else {
    console.log("[editor-smoke] Kein bestehender Auftrag zu diesem Angebot – Duplikat-Schutz-UI nicht prüfbar.");
  }
  await page.keyboard.press("Escape");
});

test("Neuer Entwurf: Übernehmen-Aktion, Insert-Flash, PDF-Pagination (danach löschen)", async ({ page }) => {
  test.setTimeout(240_000);
  await login(page);
  await page.goto("/app/dokumente");
  await expect(page.getByRole("heading", { name: "Dokumente" })).toBeVisible({ timeout: 15_000 });

  // Wegwerf-Entwurf anlegen (nummernlos; wird am Testende gelöscht – auch bei
  // Testfehlern, damit keine „Neues Angebot"-Leichen in der Dev-DB liegen bleiben)
  await page.getByRole("button", { name: "Dokument erstellen" }).click();
  await page.getByRole("button", { name: /Standardangebot/i }).first().click();
  await expect(page).toHaveURL(/\/angebote\//, { timeout: 20_000 });
  await expect(page.getByTitle(/Sie bearbeiten: Angebot/)).toBeVisible({ timeout: 15_000 });
  const draftUrl = page.url();

  try {

  // EINE zentrale Toolbar-Aktion „Positionen einfügen" (Stamm + Aus Dokument im Dialog);
  // die früheren zwei Buttons („Mehrere" / „Aus Dokument übernehmen") existieren nicht mehr.
  const insertBtn = page.getByRole("button", { name: "Positionen einfügen", exact: true });
  await expect(insertBtn).toBeVisible();
  await expect(page.getByRole("button", { name: "Mehrere", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Aus Dokument übernehmen", exact: true })).toHaveCount(0);

  // Mehrere Leistungen einfügen → letzte Position leuchtet kurz auf
  await insertBtn.click();
  // Beide Quellen sind im Dialog wählbar (Umschalter statt zweiter Toolbar-Button).
  await expect(page.locator(".modal-sheet").getByRole("button", { name: "Aus Dokument übernehmen" })).toBeVisible();
  const boxes = page.locator(".modal-sheet input[type='checkbox']");
  await boxes.first().waitFor({ state: "visible", timeout: 15_000 });
  const n = Math.min(await boxes.count(), 10);
  if (n === 0) test.skip(true, "Keine Stammdaten (Leistungen) in der Entwicklungs-DB.");
  for (let i = 0; i < n; i++) await boxes.nth(i).check();
  await page.getByRole("button", { name: /Ausgewählte einfügen/ }).click();
  await expect(page.locator(".pos-flash")).toHaveCount(1, { timeout: 5_000 });
  await expect(page.locator('[id^="pos-"]').first()).toBeVisible();

  // Für einen mehrseitigen PDF-Test dieselben Positionen noch einmal einfügen –
  // diesmal GEZIELT „Einfügen nach Position" (erste Position) statt ans Ende.
  await insertBtn.click();
  await boxes.first().waitFor({ state: "visible", timeout: 15_000 });
  for (let i = 0; i < n; i++) await boxes.nth(i).check();
  const afterSelect = page.locator(".modal-sheet label:has-text('Einfügen nach Position') select");
  await expect(afterSelect).toBeVisible();
  await afterSelect.selectOption({ index: 1 }); // „Nach <erster Position>"
  await page.getByRole("button", { name: /Ausgewählte einfügen/ }).click();
  await expect(page.locator(".pos-flash")).toHaveCount(1, { timeout: 5_000 });

  // Punkt 7: PDF über den Client-Fallback (paged.js) – Seiten prüfen/screenshotten
  const [pdfWin] = await Promise.all([
    page.waitForEvent("popup"),
    page.getByRole("button", { name: "PDF" }).click(),
  ]);
  await pdfWin.waitForLoadState("domcontentloaded");
  const fallbackBtn = pdfWin.getByRole("button", { name: /Stattdessen drucken/ });
  await expect(fallbackBtn).toBeVisible({ timeout: 30_000 });
  const [printWin] = await Promise.all([
    page.waitForEvent("popup", { timeout: 30_000 }),
    // Das Fehlerfenster schließt sich beim Klick selbst → Click-Fehler ignorieren.
    fallbackBtn.click().catch(() => {}),
  ]);
  await printWin.waitForFunction(() => (window as unknown as { __pagedReady?: boolean }).__pagedReady === true, undefined, { timeout: 90_000 });
  const pages = await printWin.locator(".pagedjs_page").count();
  console.log(`[pdf-smoke] paged.js Seiten: ${pages}`);
  expect(pages).toBeGreaterThan(1); // mit 2× Stammdaten muss es mehrseitig sein
  // ALLE Seiten screenshotten (inkl. Seite 1 + Zusammenfassungs-/Schlussseite).
  for (let i = 0; i < pages; i++) {
    await printWin.locator(".pagedjs_page").nth(i).screenshot({ path: `tmp/e2e-shots/pdf-page-${i + 1}.png` });
  }
  // Regressionscheck „gequetschte Tabelle": Auf Seite 1 darf die Leistungstabelle
  // höchstens EINE colgroup haben und muss (fast) die volle Inhaltsbreite nutzen.
  const tableCheck = await printWin.evaluate(() => {
    const t = document.querySelector(".pagedjs_page table.lv") as HTMLTableElement | null;
    const box = t?.closest(".pagedjs_page_content") as HTMLElement | null;
    if (!t || !box) return null;
    return {
      colgroups: t.querySelectorAll(":scope > colgroup").length,
      tableW: t.getBoundingClientRect().width,
      contentW: box.getBoundingClientRect().width,
    };
  });
  expect(tableCheck, "Leistungstabelle auf Seite 1 nicht gefunden").not.toBeNull();
  expect(tableCheck!.colgroups).toBeLessThanOrEqual(1);
  expect(tableCheck!.tableW).toBeGreaterThan(tableCheck!.contentW * 0.9);
  await printWin.close();

  } finally {
    // Aufräumen IMMER (auch bei Testfehler): Wegwerf-Entwurf löschen
    // (Entwürfe sind lt. Masterregeln löschbar).
    await page.goto(draftUrl);
    await page.getByTitle("Mehr", { exact: true }).click();
    await page.getByRole("button", { name: "Entwurf löschen" }).click();
    await page.getByRole("button", { name: "Entwurf löschen" }).last().click();
    await expect(page).not.toHaveURL(/\/angebote\/[0-9a-f-]{20,}/, { timeout: 15_000 });
  }
});
