// ============================================================
// B4Y SuperAPP – E-Mail-Modul: Graph-ready Datenmodell
// ------------------------------------------------------------
// Die Typen sind bewusst an die Microsoft-Graph Outlook-Mail-API angelehnt
// (resources: message, mailFolder, outlookCategory), damit eine spätere
// Anbindung ohne Modellumbau möglich ist. In DIESEM Block gibt es KEINE
// Graph-Verbindung – die Daten kommen aus einem Mock-Adapter (siehe email.ts).
// Felder, die Graph nicht kennt (z. B. „pinned"), sind als lokale App-Metadaten
// markiert und werden nicht an Graph gesendet.
// ============================================================

export type EmailAddress = { name?: string; address: string };

export type MailboxType = "primary" | "shared";
export type Mailbox = {
  id: string;
  displayName: string;
  emailAddress: string;
  type: MailboxType;
  active: boolean;
};

// Graph wellKnownName (Auszug der für die App relevanten Ordner).
export type WellKnownFolder =
  | "inbox" | "drafts" | "sentitems" | "deleteditems" | "archive" | "junkemail" | null;

export type Folder = {
  id: string;
  externalFolderId?: string | null; // Graph mailFolder.id (später)
  parentFolderId?: string | null;
  displayName: string;
  wellKnownName?: WellKnownFolder;
  unreadCount: number;
  totalCount: number;
  childFolderCount: number;
  sortOrder: number;
};

export type Importance = "low" | "normal" | "high";
// Graph followupFlag.flagStatus
export type FlagStatus = "notFlagged" | "flagged" | "complete";

// Outlook outlookCategory: displayName + (Preset-)Farbe. Farbe hier token-/CSS-tauglich.
export type EmailCategory = { id: string; displayName: string; color: string };

export type Message = {
  id: string;
  externalMessageId?: string | null;   // Graph message.id (später)
  internetMessageId?: string | null;
  conversationId?: string | null;
  parentFolderId: string;
  subject: string;
  bodyPreview: string;
  bodyHtml: string;                     // wird NUR über sanitizeHtml() gerendert
  from: EmailAddress;
  sender?: EmailAddress;
  to: EmailAddress[];
  cc: EmailAddress[];
  bcc: EmailAddress[];
  receivedDateTime: string;             // ISO
  sentDateTime?: string | null;
  isRead: boolean;
  hasAttachments: boolean;
  importance: Importance;
  categories: string[];                 // displayName-Referenzen (Outlook-konform)
  flag: FlagStatus;
  isDraft: boolean;
  // ── Lokale App-Metadaten (NICHT in Graph) ──
  pinned?: boolean;                     // „Anpinnen" – später message_meta je Org/User
  archived?: boolean;                   // im Mock: als gesetzt markiert (echt = Move in Archiv)
};

/** Verbindungsstatus-Info für die UI (kein Graph in diesem Block). */
export type EmailConnection = { connected: boolean; mode: "demo" | "graph"; note?: string };
