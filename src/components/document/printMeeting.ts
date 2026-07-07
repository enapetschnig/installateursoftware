// ============================================================
// B4Y SuperAPP – Baubesprechungs-Protokoll (A4-HTML für PDF)
// Mandantenfähige Kopf-/Fußzeile (Logo + Firmendaten aus company_settings).
// Wird über openSnapshotPdf(html) zu echtem PDF gerendert → Vorschau =
// Download = Druck identisch. Beim Abschluss wird dieses HTML als
// unveränderlicher Snapshot (document_versions.print_html) gespeichert.
// ============================================================
import { CompanySettings, companyLines } from "../../lib/company";
import { ProjectMeeting, MeetingParticipant, MeetingItem, PARTICIPANT_ROLE_LABEL } from "../../lib/project-meetings";
import { ProjectSignature } from "../../lib/project-signatures";

const esc = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const deDate = (s?: string | null) => {
  if (!s) return "";
  const d = new Date(s);
  return isNaN(d.getTime()) ? esc(s) : d.toLocaleDateString("de-AT", { day: "2-digit", month: "2-digit", year: "numeric" });
};

export type MeetingTaskLine = { title: string; responsible?: string | null; due_date?: string | null; done?: boolean };

export type MeetingPdfParams = {
  company: CompanySettings | null;
  project: { project_number?: string | null; title?: string | null; address?: string | null } | null;
  meeting: ProjectMeeting;
  participants: MeetingParticipant[];
  items: MeetingItem[];
  tasks: MeetingTaskLine[];
  signatures: ProjectSignature[];
};

export function buildMeetingHtml(p: MeetingPdfParams): string {
  const co = companyLines(p.company);
  const m = p.meeting;

  const itemsOf = (kind: string) => p.items.filter((i) => i.kind === kind && (i.text ?? "").trim());
  const agenda = itemsOf("agenda");
  const decisions = itemsOf("decision");
  const opens = itemsOf("open");
  const notes = itemsOf("note");

  const timeStr = [m.time_from, m.time_to].filter(Boolean).join(" – ");
  const titleLine = `Besprechungsprotokoll${m.meeting_number ? ` ${esc(m.meeting_number)}` : ""}`;

  const logo = co.logoUrl
    ? `<img src="${esc(co.logoUrl)}" alt="Logo" style="max-height:54px;max-width:230px;object-fit:contain">`
    : `<div style="font-size:18px;font-weight:800;color:#0f172a">${esc(co.name)}</div>`;

  const infoRow = (label: string, val: string) =>
    val ? `<tr><td class="lbl">${esc(label)}</td><td>${val}</td></tr>` : "";

  const partRows = p.participants.length
    ? p.participants.map((pt) => `
        <tr>
          <td>${esc(pt.name || "–")}</td>
          <td>${esc(pt.company || "")}</td>
          <td>${esc(PARTICIPANT_ROLE_LABEL[(pt.role as keyof typeof PARTICIPANT_ROLE_LABEL)] || pt.role || "")}</td>
          <td style="text-align:center">${pt.present ? "✓" : "–"}</td>
        </tr>`).join("")
    : `<tr><td colspan="4" style="color:#94a3b8">Keine Teilnehmer erfasst.</td></tr>`;

  const ul = (arr: MeetingItem[]) =>
    `<ul class="pts">${arr.map((i) => `<li>${esc(i.text)}</li>`).join("")}</ul>`;

  const section = (title: string, body: string) =>
    `<div class="sec"><h2>${esc(title)}</h2>${body}</div>`;

  const taskRows = p.tasks.length
    ? p.tasks.map((t) => `
        <tr>
          <td>${esc(t.title)}</td>
          <td>${esc(t.responsible || "")}</td>
          <td>${esc(deDate(t.due_date))}</td>
          <td style="text-align:center">${t.done ? "erledigt" : "offen"}</td>
        </tr>`).join("")
    : `<tr><td colspan="4" style="color:#94a3b8">Keine Aufgaben aus dieser Besprechung.</td></tr>`;

  const sigCards = p.signatures.length
    ? `<div class="sigs">${p.signatures.map((s) => `
        <div class="sig">
          <div class="sigimg">${s.signature_data ? `<img src="${esc(s.signature_data)}" alt="Unterschrift">` : ""}</div>
          <div class="signm">${esc(s.signer_name || "")}${s.signer_company ? `, ${esc(s.signer_company)}` : ""}</div>
          <div class="sigrole">${esc(s.signer_role || "")} · ${esc(deDate(s.signed_at))}</div>
        </div>`).join("")}</div>`
    : `<div class="sigline"><div></div><div></div></div>
       <div class="sigcap"><span>Auftragnehmer / Firma</span><span>Auftraggeber / Bauherr</span></div>`;

  return `<!doctype html><html lang="de"><head><meta charset="utf-8">
<title>${esc(titleLine)}</title>
<style>
  @page { size: A4; margin: 16mm 14mm 24mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #1e293b; font-size: 12px; line-height: 1.5; margin: 0; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #0f172a; padding-bottom: 8px; margin-bottom: 14px; }
  .head .co { font-size: 10px; color: #64748b; max-width: 55%; }
  h1 { font-size: 19px; margin: 4px 0 2px; color: #0f172a; }
  h2 { font-size: 13px; margin: 0 0 6px; color: #0f172a; border-bottom: 1px solid #e2e8f0; padding-bottom: 3px; }
  .sub { color: #64748b; font-size: 11px; margin-bottom: 12px; }
  .sec { margin: 0 0 14px; page-break-inside: avoid; }
  table { width: 100%; border-collapse: collapse; }
  .info td { padding: 2px 0; vertical-align: top; }
  .info .lbl { color: #64748b; width: 130px; }
  .grid th, .grid td { border: 1px solid #e2e8f0; padding: 5px 7px; text-align: left; vertical-align: top; }
  .grid th { background: #f1f5f9; font-size: 11px; }
  .pts { margin: 0; padding-left: 18px; }
  .pts li { margin: 2px 0; }
  .notes { white-space: pre-wrap; }
  .sigs { display: flex; flex-wrap: wrap; gap: 16px; margin-top: 8px; }
  .sig { width: 220px; }
  .sigimg { height: 80px; border-bottom: 1px solid #0f172a; display: flex; align-items: flex-end; }
  .sigimg img { max-height: 78px; max-width: 100%; object-fit: contain; }
  .signm { font-weight: 600; margin-top: 3px; }
  .sigrole { color: #64748b; font-size: 11px; }
  .sigline { display: flex; gap: 40px; margin-top: 46px; }
  .sigline > div { flex: 1; border-top: 1px solid #0f172a; }
  .sigcap { display: flex; gap: 40px; }
  .sigcap > span { flex: 1; color: #64748b; font-size: 11px; }
  .foot { position: fixed; bottom: 8mm; left: 14mm; right: 14mm; border-top: 1px solid #e2e8f0; padding-top: 4px; font-size: 9px; color: #94a3b8; text-align: center; }
</style></head>
<body>
  <div class="head">
    <div>${logo}</div>
    <div class="co">${esc(co.headLine)}</div>
  </div>

  <h1>${esc(titleLine)}</h1>
  <div class="sub">${esc(m.title || "Baubesprechung")}</div>

  <div class="sec">
    <table class="info">
      ${infoRow("Projekt", esc([p.project?.project_number, p.project?.title].filter(Boolean).join(" · ")))}
      ${infoRow("Bauvorhaben/Adresse", esc(p.project?.address || ""))}
      ${infoRow("Datum", esc(deDate(m.meeting_date)))}
      ${infoRow("Uhrzeit", esc(timeStr))}
      ${infoRow("Ort", esc(m.location || ""))}
      ${infoRow("Nächste Besprechung", esc(deDate(m.next_meeting_date)))}
    </table>
  </div>

  ${section("Teilnehmer", `<table class="grid"><thead><tr><th>Name</th><th>Firma</th><th>Rolle</th><th style="width:60px;text-align:center">Anw.</th></tr></thead><tbody>${partRows}</tbody></table>`)}

  ${agenda.length ? section("Tagesordnung", ul(agenda)) : ""}
  ${notes.length ? section("Besprechungsnotizen", ul(notes)) : ""}
  ${m.notes && m.notes.trim() ? section("Protokoll", `<div class="notes">${esc(m.notes)}</div>`) : ""}
  ${decisions.length ? section("Beschlüsse", ul(decisions)) : ""}
  ${opens.length ? section("Offene Punkte", ul(opens)) : ""}

  ${section("Aufgaben", `<table class="grid"><thead><tr><th>Aufgabe</th><th style="width:130px">Verantwortlich</th><th style="width:80px">Frist</th><th style="width:70px;text-align:center">Status</th></tr></thead><tbody>${taskRows}</tbody></table>`)}

  ${section("Unterschriften", sigCards)}

  <div class="foot">
    ${esc(co.regLine)}${co.bankLine ? " &nbsp;·&nbsp; " + esc(co.bankLine) : ""}${co.contactLine ? " &nbsp;·&nbsp; " + esc(co.contactLine) : ""}
  </div>
</body></html>`;
}
