// ============================================================
// B4Y SuperAPP – Zentrale Aktionen für das Dokument-Drei-Punkte-Menü
// ------------------------------------------------------------
// EINE Quelle der Wahrheit, welche Overflow-Aktionen ein Dokumenteditor
// (Angebot/Auftrag/Rechnung) anbietet – inkl. Reihenfolge, Icons, „danger"
// und disabled. Die eigentlichen Handler/Logik bleiben im jeweiligen Editor
// (Status, Konversion, Storno, Löschen) und werden als Callbacks übergeben.
//
// Grundsätze:
//  • Keine zweite Kopier-/Ketten-/Status-Logik – nur Darstellung + Komposition.
//  • Aktionen ohne sichere Bestandslogik werden NICHT angezeigt (nicht erfinden).
//  • „Positionen aus Dokument übernehmen" ist bewusst NICHT hier: das läuft
//    zentral über die Toolbar („Positionen einfügen" → MultiInsertModal,
//    reine Kopie via document-copy.ts) – keine Duplizierung.
// ============================================================
import { Copy, FileText, Ban, Trash2, CheckCircle2, ArrowLeft, ArrowRight } from "lucide-react";
import type { MoreAction } from "../components/document/DocumentToolbar";

export type DocActionsInput =
  | {
      kind: "offer";
      canCopy?: boolean;          // Kopieren anbieten (Default an); für Angebot-Nachträge bewusst aus
      canDelete?: boolean;
      canCreateOrder?: boolean;   // fachlich zulässig (finalisiert, kein Nachtrag, mit Projekt) → echte Kette
      /** Aus diesem Angebot existiert bereits ein aktiver Auftrag → „Auftrag erstellen"
       *  wird sichtbar deaktiviert und „Zum Auftrag wechseln" angeboten (kein Duplikat). */
      existingOrderNumber?: string | null;
      onGoToOrder?: () => void;
      onCopy: () => void;
      onCreateOrder?: () => void;
      onDelete?: () => void;
    }
  | {
      kind: "order";
      isDraft?: boolean;
      canConvert?: boolean;       // Rechnung erstellen erlaubt
      canCancel?: boolean;
      canDelete?: boolean;
      onBeauftragen?: () => void;
      onCopy: () => void;
      onCreateInvoice?: () => void;
      onStorno?: () => void;
      onDelete?: () => void;
      // Bewusst ENTFERNT (Stand 2026-07-06):
      //  • „Aus Angebot übernehmen" → zentrale Toolbar-Aktion „Positionen
      //    einfügen" (MultiInsertModal, Modus „Aus Dokument übernehmen", reine Kopie).
      //  • „Archivieren" → Projekte werden nur in der Projektübersicht archiviert,
      //    nicht missverständlich aus dem Dokumenteditor heraus.
    }
  | {
      kind: "invoice";
      isLocked?: boolean;
      isStorniert?: boolean;
      hasStornoOf?: boolean;
      canDelete?: boolean;
      onStorno?: () => void;
      onToOriginal?: () => void;
      onDelete?: () => void;
    };

const ic = (node: MoreAction["icon"]) => node;

/** Baut die Liste der Overflow-Aktionen je Dokumenttyp (verhaltensgleich zum bisherigen Inline-Code). */
export function buildDocumentMoreActions(input: DocActionsInput): MoreAction[] {
  const actions: MoreAction[] = [];

  if (input.kind === "order") {
    if (input.isDraft && input.onBeauftragen) {
      actions.push({ label: "Beauftragen / Abschließen", icon: ic(<CheckCircle2 size={15} />), onClick: input.onBeauftragen });
    }
    actions.push({ label: "Kopieren", icon: ic(<Copy size={15} />), onClick: input.onCopy });
    if (input.onCreateInvoice) {
      actions.push({ label: "Rechnung erstellen", icon: ic(<FileText size={15} />), onClick: input.onCreateInvoice, disabled: !input.canConvert });
    }
    if (input.onStorno) {
      actions.push({ label: "Stornieren", icon: ic(<Ban size={15} />), onClick: input.onStorno, danger: true, disabled: !input.canCancel });
    }
    if (input.canDelete && input.onDelete) {
      actions.push({ label: "Entwurf löschen", icon: ic(<Trash2 size={15} />), onClick: input.onDelete, danger: true });
    }
    return actions;
  }

  if (input.kind === "invoice") {
    if (input.isLocked && !input.isStorniert && input.onStorno) {
      actions.push({ label: "Storno erstellen", icon: ic(<Ban size={15} />), onClick: input.onStorno, danger: true });
    }
    if (input.hasStornoOf && input.onToOriginal) {
      actions.push({ label: "Zur Original-Rechnung", icon: ic(<ArrowLeft size={15} />), onClick: input.onToOriginal });
    }
    if (input.canDelete && input.onDelete) {
      actions.push({ label: "Entwurf löschen", icon: ic(<Trash2 size={15} />), onClick: input.onDelete, danger: true });
    }
    return actions;
  }

  // kind === "offer"
  // Kopieren standardmäßig anbieten; für Angebot-Nachträge bewusst NICHT (würde sonst
  // einen normalen Angebot-Entwurf mit falschem Nummernkreis erzeugen → Nachtrag-Bezug ginge verloren).
  if (input.canCopy !== false) {
    actions.push({ label: "Kopieren", icon: ic(<Copy size={15} />), onClick: input.onCopy });
  }
  // Doppelte Auftragserstellung verhindern: existiert bereits ein aktiver Auftrag aus
  // diesem Angebot, wird die Aktion sichtbar deaktiviert und stattdessen der Wechsel
  // zum bestehenden Auftrag angeboten. (Serverseitig schützt zusätzlich der
  // Doppelbeauftragungs-Guard in document-chain.ts.)
  if (input.existingOrderNumber) {
    actions.push({
      label: `Auftrag bereits erstellt (${input.existingOrderNumber})`,
      icon: ic(<FileText size={15} />), onClick: () => {}, disabled: true,
    });
    if (input.onGoToOrder) {
      actions.push({ label: "Zum Auftrag wechseln", icon: ic(<ArrowRight size={15} />), onClick: input.onGoToOrder });
    }
  } else if (input.canCreateOrder && input.onCreateOrder) {
    actions.push({ label: "Auftrag erstellen", icon: ic(<FileText size={15} />), onClick: input.onCreateOrder });
  }
  if (input.canDelete && input.onDelete) {
    actions.push({ label: "Entwurf löschen", icon: ic(<Trash2 size={15} />), onClick: input.onDelete, danger: true });
  }
  return actions;
}
