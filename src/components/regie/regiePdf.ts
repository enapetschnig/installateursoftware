// ============================================================
// Installateursoftware – Regiebericht-PDF (druckbare A4-HTML)
// Öffnet den Regiebericht als sauberes A4-Dokument im neuen Fenster und
// startet den Druckdialog (Drucken / „Als PDF speichern"). KEINE externe
// PDF-Lib. Kopf-/Fußzeile mandantenfähig aus company_settings (Logo +
// Firmendaten). Enthält Kunde, Einsatzdaten, Material-Tabelle mit
// Netto-Summe, Beteiligte und – falls vorhanden – das Unterschriftsbild.
// ============================================================
import { supabase } from "../../lib/supabase";
import { loadCompanySettings, companyLines } from "../../lib/company";
import { loadRegieReport, materialSum, regieStatusMeta } from "../../lib/regie";
import { employeeDisplayName } from "../../lib/project-config";

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const eur = (n: number) =>
  new Intl.NumberFormat("de-AT", { style: "currency", currency: "EUR" }).format(Number(n) || 0);

const deDate = (s?: string | null) => {
  if (!s) return "";
  const d = new Date(s);
  return isNaN(d.getTime()) ? esc(s) : d.toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" });
};

const timeStr = (t: string | null | undefined) => (t ? String(t).slice(0, 5) : "");

export async function openRegiePdf(reportId: string): Promise<void> {
  // Fenster synchron öffnen (vor await), damit der Popup-Blocker nicht greift.
  const w = window.open("", "_blank", "width=900,height=1200");
  if (!w) { alert("Bitte Popups erlauben, um das PDF zu erstellen."); return; }

  try {
    const { report, materials, workers } = await loadRegieReport(reportId);
    if (!report) { w.document.write("<p style='font-family:sans-serif;padding:2rem'>Regiebericht nicht gefunden.</p>"); w.document.close(); return; }

    const company = await loadCompanySettings().catch(() => null);
    const co = companyLines(company);

    // Projekt- und Mitarbeiterdaten für die Anzeige nachladen.
    const [projRes, empRes] = await Promise.all([
      report.project_id
        ? supabase.from("projects").select("project_number,title").eq("id", report.project_id).maybeSingle()
        : Promise.resolve({ data: null }),
      workers.length
        ? supabase.from("employees").select("id,first_name,last_name,email").in("id", workers.map((x) => x.employee_id))
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const proj = projRes.data as { project_number: string | null; title: string | null } | null;
    const empMap = new Map<string, string>(
      ((empRes.data as any[]) ?? []).map((e) => [e.id, employeeDisplayName(e)]),
    );

    const total = materialSum(materials);
    const meta = regieStatusMeta(report.status);

    const logo = co.logoUrl
      ? `<img src="${esc(co.logoUrl)}" alt="Logo" style="max-height:54px;max-width:230px;object-fit:contain">`
      : `<div style="font-size:18px;font-weight:800;color:#0f172a">${esc(co.name)}</div>`;

    const infoRow = (label: string, val: string) =>
      val ? `<tr><td class="lbl">${esc(label)}</td><td>${val}</td></tr>` : "";

    const kundeBlock = [
      report.kunde_name,
      report.kunde_strasse,
      [report.kunde_plz, report.kunde_ort].filter(Boolean).join(" "),
      report.kunde_email ? `E-Mail: ${report.kunde_email}` : "",
      report.kunde_telefon ? `Tel.: ${report.kunde_telefon}` : "",
    ].filter(Boolean).map((l) => esc(l)).join("<br>");

    const zeitStr = [timeStr(report.start_time), timeStr(report.end_time)].filter(Boolean).join(" – ");

    const matRows = materials.length
      ? materials.map((m) => `
        <tr>
          <td>${esc(m.material)}</td>
          <td style="text-align:right">${esc((Number(m.menge) || 0).toLocaleString("de-AT"))}</td>
          <td>${esc(m.einheit)}</td>
          <td style="text-align:right">${esc(eur(Number(m.einzelpreis) || 0))}</td>
          <td style="text-align:right">${esc(eur((Number(m.menge) || 0) * (Number(m.einzelpreis) || 0)))}</td>
        </tr>`).join("")
      : `<tr><td colspan="5" style="color:#94a3b8">Kein Material erfasst.</td></tr>`;

    const workerRows = workers.length
      ? workers.map((wk) => `
        <tr>
          <td>${esc(empMap.get(wk.employee_id) || "Mitarbeiter")}${wk.is_main ? ' <span style="color:#b45309">· Hauptmonteur</span>' : ""}</td>
          <td style="text-align:right">${esc(((wk.hours ?? report.stunden) || 0).toLocaleString("de-AT"))} h</td>
        </tr>`).join("")
      : `<tr><td colspan="2" style="color:#94a3b8">Keine Beteiligten erfasst.</td></tr>`;

    const sigBlock = report.unterschrift_kunde
      ? `<div class="sig">
           <div class="sigimg"><img src="${esc(report.unterschrift_kunde)}" alt="Unterschrift"></div>
           <div class="signm">${esc(report.unterschrift_name || report.kunde_name || "")}</div>
           <div class="sigrole">Unterschrift Kunde${report.unterschrift_am ? " · " + esc(deDate(report.unterschrift_am)) : ""}</div>
         </div>`
      : `<div class="sigline"><div></div></div>
         <div class="sigcap"><span>Unterschrift Kunde</span></div>`;

    const titleLine = `Regiebericht${report.report_number ? ` ${esc(report.report_number)}` : ""}`;

    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8">
<title>${esc(titleLine)}</title>
<style>
  @page { size: A4; margin: 16mm 14mm 24mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #1e293b; font-size: 12px; line-height: 1.5; margin: 0; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f172a; padding-bottom: 8px; margin-bottom: 14px; }
  .head .co { font-size: 10px; color: #64748b; max-width: 55%; text-align: right; }
  h1 { font-size: 19px; margin: 4px 0 2px; color: #0f172a; }
  h2 { font-size: 13px; margin: 0 0 6px; color: #0f172a; border-bottom: 1px solid #e2e8f0; padding-bottom: 3px; }
  .sub { color: #64748b; font-size: 11px; margin-bottom: 12px; }
  .sec { margin: 0 0 14px; page-break-inside: avoid; }
  .cols { display: flex; gap: 24px; }
  .cols > div { flex: 1; }
  table { width: 100%; border-collapse: collapse; }
  .info td { padding: 2px 0; vertical-align: top; }
  .info .lbl { color: #64748b; width: 130px; }
  .grid th, .grid td { border: 1px solid #e2e8f0; padding: 5px 7px; text-align: left; vertical-align: top; }
  .grid th { background: #f1f5f9; font-size: 11px; }
  .grid tfoot td { font-weight: 700; background: #f8fafc; }
  .desc { white-space: pre-wrap; }
  .sig { width: 260px; margin-top: 8px; }
  .sigimg { height: 90px; border-bottom: 1px solid #0f172a; display: flex; align-items: flex-end; }
  .sigimg img { max-height: 88px; max-width: 100%; object-fit: contain; }
  .signm { font-weight: 600; margin-top: 3px; }
  .sigrole { color: #64748b; font-size: 11px; }
  .sigline { display: flex; margin-top: 56px; width: 260px; }
  .sigline > div { flex: 1; border-top: 1px solid #0f172a; }
  .sigcap { width: 260px; }
  .sigcap > span { color: #64748b; font-size: 11px; }
  .foot { position: fixed; bottom: 8mm; left: 14mm; right: 14mm; border-top: 1px solid #e2e8f0; padding-top: 4px; font-size: 9px; color: #94a3b8; text-align: center; }
  @media screen { body { background:#f1f5f9; } .sheet { background:#fff; max-width: 210mm; margin: 12px auto; padding: 16mm 14mm; box-shadow: 0 2px 12px rgba(0,0,0,.12); } }
</style></head>
<body>
  <div class="sheet">
    <div class="head">
      <div>${logo}</div>
      <div class="co">${esc(co.headLine)}</div>
    </div>

    <h1>${esc(titleLine)}</h1>
    <div class="sub">Status: ${esc(meta.label)}${report.is_verrechnet ? " · verrechnet" : ""}</div>

    <div class="sec cols">
      <div>
        <h2>Kunde</h2>
        <div>${kundeBlock || '<span style="color:#94a3b8">–</span>'}</div>
      </div>
      <div>
        <h2>Einsatzdaten</h2>
        <table class="info">
          ${infoRow("Datum", esc(deDate(report.datum)))}
          ${infoRow("Uhrzeit", esc(zeitStr))}
          ${infoRow("Pause", report.pause_minutes ? esc(report.pause_minutes) + " Min." : "")}
          ${infoRow("Stunden", esc((Number(report.stunden) || 0).toLocaleString("de-AT")) + " h")}
          ${infoRow("Projekt", esc([proj?.project_number, proj?.title].filter(Boolean).join(" · ")))}
        </table>
      </div>
    </div>

    ${report.beschreibung && report.beschreibung.trim()
      ? `<div class="sec"><h2>Durchgeführte Arbeiten</h2><div class="desc">${esc(report.beschreibung)}</div></div>`
      : ""}

    <div class="sec">
      <h2>Material</h2>
      <table class="grid">
        <thead><tr>
          <th>Bezeichnung</th>
          <th style="width:70px;text-align:right">Menge</th>
          <th style="width:70px">Einheit</th>
          <th style="width:90px;text-align:right">Einzelpreis</th>
          <th style="width:90px;text-align:right">Summe</th>
        </tr></thead>
        <tbody>${matRows}</tbody>
        <tfoot><tr>
          <td colspan="4" style="text-align:right">Materialsumme (netto)</td>
          <td style="text-align:right">${esc(eur(total))}</td>
        </tr></tfoot>
      </table>
    </div>

    <div class="sec">
      <h2>Beteiligte Mitarbeiter</h2>
      <table class="grid">
        <thead><tr><th>Name</th><th style="width:90px;text-align:right">Stunden</th></tr></thead>
        <tbody>${workerRows}</tbody>
      </table>
    </div>

    <div class="sec">
      <h2>Unterschrift</h2>
      ${sigBlock}
    </div>

    <div class="foot">
      ${esc(co.regLine)}${co.bankLine ? " &nbsp;·&nbsp; " + esc(co.bankLine) : ""}${co.contactLine ? " &nbsp;·&nbsp; " + esc(co.contactLine) : ""}
    </div>
  </div>
  <script>
    window.addEventListener("load", function () { setTimeout(function () { try { window.focus(); window.print(); } catch (e) {} }, 250); });
  </script>
</body></html>`;

    w.document.open();
    w.document.write(html);
    w.document.close();
    w.focus();
  } catch (e) {
    try {
      w.document.write(`<p style='font-family:sans-serif;padding:2rem;color:#b91c1c'>Fehler beim Erstellen des PDF: ${esc(e instanceof Error ? e.message : String(e))}</p>`);
      w.document.close();
    } catch { /* ignore */ }
  }
}
