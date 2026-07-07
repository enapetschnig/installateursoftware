// ============================================================
// B4Y SuperAPP – E-Mail-Modul: Adapter + Demo-Fixtures
// ------------------------------------------------------------
// EINE Adapter-Schnittstelle (EmailAdapter) entkoppelt die UI von der
// Datenquelle. Heute liefert `mockAdapter` isolierte UI-Fixtures (NUR im
// Frontend, nichts wird in Supabase geseedet, keine echten Inhalte) und meldet
// `connected: false` (Demo-/Vorschau-Modus). Später wird ein graphAdapter mit
// identischem Interface ergänzt – serverseitig/Token-sicher, ohne UI-Umbau.
// KEINE Graph-Calls, kein OAuth, keine Token, keine Service-Role in diesem Block.
// ============================================================
import { Mailbox, Folder, Message, EmailCategory, EmailConnection } from "./email-types";

export interface EmailAdapter {
  connection(): EmailConnection;
  listMailboxes(): Promise<Mailbox[]>;
  listFolders(mailboxId: string): Promise<Folder[]>;
  listMessages(mailboxId: string, folderId: string): Promise<Message[]>;
  listCategories(): EmailCategory[];
}

// Outlook-ähnliche, gedeckte Kategorie-Palette (keine grellen Sonderfarben).
export const DEMO_CATEGORIES: EmailCategory[] = [
  { id: "cat-red", displayName: "Wichtig", color: "#dc2626" },
  { id: "cat-amber", displayName: "Angebot", color: "#d97706" },
  { id: "cat-green", displayName: "Erledigt", color: "#16a34a" },
  { id: "cat-blue", displayName: "Projekt", color: "#2563eb" },
  { id: "cat-violet", displayName: "Privat", color: "#7c3aed" },
];

// ── Demo-Fixtures (rein lokal, fiktiv) ─────────────────────
const MAILBOXES: Mailbox[] = [
  { id: "mb-primary", displayName: "BAU4YOU Posteingang", emailAddress: "office@bau4you.at", type: "primary", active: true },
  { id: "mb-shared", displayName: "Buchhaltung (geteilt)", emailAddress: "buchhaltung@bau4you.at", type: "shared", active: true },
];

const FOLDERS: Record<string, Folder[]> = {
  "mb-primary": [
    { id: "f-inbox", displayName: "Posteingang", wellKnownName: "inbox", parentFolderId: null, unreadCount: 2, totalCount: 4, childFolderCount: 0, sortOrder: 1 },
    { id: "f-drafts", displayName: "Entwürfe", wellKnownName: "drafts", parentFolderId: null, unreadCount: 0, totalCount: 1, childFolderCount: 0, sortOrder: 2 },
    { id: "f-sent", displayName: "Gesendet", wellKnownName: "sentitems", parentFolderId: null, unreadCount: 0, totalCount: 1, childFolderCount: 0, sortOrder: 3 },
    { id: "f-archive", displayName: "Archiv", wellKnownName: "archive", parentFolderId: null, unreadCount: 0, totalCount: 0, childFolderCount: 0, sortOrder: 4 },
    { id: "f-deleted", displayName: "Gelöscht", wellKnownName: "deleteditems", parentFolderId: null, unreadCount: 0, totalCount: 0, childFolderCount: 0, sortOrder: 5 },
  ],
  "mb-shared": [
    { id: "fs-inbox", displayName: "Posteingang", wellKnownName: "inbox", parentFolderId: null, unreadCount: 1, totalCount: 1, childFolderCount: 0, sortOrder: 1 },
    { id: "fs-archive", displayName: "Archiv", wellKnownName: "archive", parentFolderId: null, unreadCount: 0, totalCount: 0, childFolderCount: 0, sortOrder: 2 },
  ],
};

const A = (name: string, address: string) => ({ name, address });

const MESSAGES: Message[] = [
  {
    id: "m1", parentFolderId: "f-inbox", conversationId: "c1",
    subject: "Angebot Dachsanierung – Rückfrage zur Ausführung",
    bodyPreview: "Sehr geehrter Herr Baranowski, vielen Dank für das Angebot. Eine Frage zur Ziegelwahl …",
    bodyHtml: "<p>Sehr geehrter Herr Baranowski,</p><p>vielen Dank für das Angebot <b>ANGEBOT-0010-2026</b>. Eine Frage zur Ziegelwahl: Ist auch ein Tonziegel möglich?</p><p>Mit freundlichen Grüßen<br>A. Pittner</p>",
    from: A("Ing. Andreas Pittner", "a.pittner@example.at"), to: [A("Office", "office@bau4you.at")], cc: [], bcc: [],
    receivedDateTime: "2026-06-20T08:42:00Z", isRead: false, hasAttachments: true, importance: "high",
    categories: ["Angebot", "Projekt"], flag: "flagged", isDraft: false, pinned: true,
  },
  {
    id: "m2", parentFolderId: "f-inbox", conversationId: "c2",
    subject: "Terminbestätigung Baubesprechung KW 26",
    bodyPreview: "Hallo, wir bestätigen den Termin am Dienstag um 9:00 Uhr auf der Baustelle …",
    bodyHtml: "<p>Hallo,</p><p>wir bestätigen den Termin am <b>Dienstag, 9:00 Uhr</b> auf der Baustelle Beheimgasse.</p><p>LG, J. Rosenauer</p>",
    from: A("Dipl.-Ing. Jakob Rosenauer", "j.rosenauer@example.at"), to: [A("Office", "office@bau4you.at")], cc: [], bcc: [],
    receivedDateTime: "2026-06-19T15:10:00Z", isRead: false, hasAttachments: false, importance: "normal",
    categories: ["Projekt"], flag: "notFlagged", isDraft: false,
  },
  {
    id: "m3", parentFolderId: "f-inbox", conversationId: "c3",
    subject: "Materiallieferung verzögert sich",
    bodyPreview: "Guten Tag, leider verzögert sich die Lieferung der Dämmplatten um zwei Tage …",
    bodyHtml: "<p>Guten Tag,</p><p>leider verzögert sich die Lieferung der Dämmplatten um zwei Tage. Neuer Termin: Donnerstag.</p>",
    from: A("Baustoff Müller GmbH", "lager@baustoff-mueller.example"), to: [A("Office", "office@bau4you.at")], cc: [], bcc: [],
    receivedDateTime: "2026-06-18T11:05:00Z", isRead: true, hasAttachments: false, importance: "normal",
    categories: ["Wichtig"], flag: "notFlagged", isDraft: false,
  },
  {
    id: "m4", parentFolderId: "f-inbox", conversationId: "c4",
    subject: "Newsletter: Neue Förderungen 2026",
    bodyPreview: "Erfahren Sie, welche Sanierungsförderungen 2026 verfügbar sind …",
    bodyHtml: "<p>Erfahren Sie, welche Sanierungsförderungen 2026 verfügbar sind.</p>",
    from: A("WKO Service", "news@wko.example"), to: [A("Office", "office@bau4you.at")], cc: [], bcc: [],
    receivedDateTime: "2026-06-17T07:00:00Z", isRead: true, hasAttachments: false, importance: "low",
    categories: [], flag: "complete", isDraft: false,
  },
  {
    id: "m5", parentFolderId: "f-sent", conversationId: "c1",
    subject: "AW: Angebot Dachsanierung",
    bodyPreview: "Sehr geehrter Herr Pittner, gerne ist auch ein Tonziegel möglich …",
    bodyHtml: "<p>Sehr geehrter Herr Pittner,</p><p>gerne ist auch ein Tonziegel möglich. Ich passe das Angebot an.</p><p>Liebe Grüße, Lukasz Baranowski</p>",
    from: A("Lukasz Baranowski", "office@bau4you.at"), to: [A("Ing. Andreas Pittner", "a.pittner@example.at")], cc: [], bcc: [],
    receivedDateTime: "2026-06-20T09:15:00Z", sentDateTime: "2026-06-20T09:15:00Z", isRead: true, hasAttachments: false, importance: "normal",
    categories: ["Angebot"], flag: "notFlagged", isDraft: false,
  },
  {
    id: "m6", parentFolderId: "f-drafts", conversationId: "c6",
    subject: "(Entwurf) Mahnung Rechnung RECHNUNG-0007-2026",
    bodyPreview: "Sehr geehrte Damen und Herren, wir möchten Sie höflich erinnern …",
    bodyHtml: "<p>Sehr geehrte Damen und Herren,</p><p>wir möchten Sie höflich an die offene Rechnung erinnern.</p>",
    from: A("Lukasz Baranowski", "office@bau4you.at"), to: [A("Frau Elisabeth Thausing", "e.thausing@example.at")], cc: [], bcc: [],
    receivedDateTime: "2026-06-16T13:30:00Z", isRead: true, hasAttachments: false, importance: "normal",
    categories: [], flag: "notFlagged", isDraft: true,
  },
  {
    id: "ms1", parentFolderId: "fs-inbox", conversationId: "c7",
    subject: "Eingangsrechnung Subunternehmer",
    bodyPreview: "Anbei unsere Rechnung für die erbrachten Leistungen …",
    bodyHtml: "<p>Anbei unsere Rechnung für die erbrachten Leistungen.</p>",
    from: A("Elektro Lucic e.U.", "office@elektro-lucic.example"), to: [A("Buchhaltung", "buchhaltung@bau4you.at")], cc: [], bcc: [],
    receivedDateTime: "2026-06-19T10:20:00Z", isRead: false, hasAttachments: true, importance: "normal",
    categories: ["Wichtig"], flag: "notFlagged", isDraft: false,
  },
];

const wait = (ms = 120) => new Promise((r) => setTimeout(r, ms));

export const mockAdapter: EmailAdapter = {
  connection: () => ({ connected: false, mode: "demo", note: "Microsoft Graph noch nicht verbunden – Demo-/Vorschau-Modus." }),
  async listMailboxes() { await wait(); return MAILBOXES.filter((m) => m.active); },
  async listFolders(mailboxId) { await wait(); return (FOLDERS[mailboxId] ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder); },
  async listMessages(_mailboxId, folderId) {
    await wait();
    // Kopien zurückgeben, damit lokale UI-Mutationen die Fixtures nicht verändern.
    return MESSAGES.filter((m) => m.parentFolderId === folderId).map((m) => ({ ...m, categories: [...m.categories], to: [...m.to], cc: [...m.cc], bcc: [...m.bcc] }));
  },
  listCategories: () => DEMO_CATEGORIES,
};

// Aktiver Adapter (später per Settings/Feature-Flag auf graphAdapter umstellbar).
export const emailAdapter: EmailAdapter = mockAdapter;

// ── UI-Helfer ──────────────────────────────────────────────
export const categoryColor = (name: string): string =>
  DEMO_CATEGORIES.find((c) => c.displayName === name)?.color || "var(--accent)";

export const addressLabel = (a?: { name?: string; address: string } | null): string =>
  !a ? "" : (a.name && a.name.trim() ? a.name : a.address);
