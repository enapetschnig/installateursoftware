// ============================================================
// B4Y SuperAPP – E-Mail: Compose-Dialog (Neu / Antwort / Weiterleiten)
// ------------------------------------------------------------
// Modal-Composer, der sendMail() (src/lib/microsoft/mailClient.ts)
// aufruft. Deckt drei Modi ab:
//   - "new":      leer, Empfaenger/Betreff selber ausfuellen.
//   - "reply":    inReplyTo gesetzt, To vorbelegt, Betreff mit "AW:".
//   - "forward":  To leer, Betreff mit "WG:", Body als Zitat.
//
// Empfaenger werden mit parseEmailList() live validiert; das
// Senden-Button bleibt gesperrt, solange invalide Adressen im
// To/Cc/Bcc-Feld stehen oder Pflichtfelder fehlen. Attachments
// werden per FileReader zu {name, mime, base64} und in-memory
// bis zum Senden gehalten (Max 25 MB gesamt, matcht Backend).
//
// Bei Reply lehnt das Backend Attachments ab (MVP) – die UI
// verhindert das Anhaengen im Reply-Modus deshalb aktiv.
// ============================================================
import { useMemo, useRef, useState } from "react";
import { AlertTriangle, Eye, Loader2, Paperclip, Send, X, Info } from "lucide-react";
import { Modal } from "../ui";
import { sendMail, type MailAttachment } from "../../lib/microsoft/mailClient";
import { toast, toastError } from "../../lib/toast";
import { parseEmailList } from "./parseEmailList";

export type ComposeMode = "new" | "reply" | "forward";

export interface ComposeInitial {
  mode: ComposeMode;
  to?: string; // comma-separated pre-filled string
  cc?: string;
  bcc?: string;
  subject?: string;
  html?: string;
  /** Graph-Message-ID – nur "reply" nutzt diesen Wert. */
  inReplyTo?: string;
}

// UI-seitiges 24-MB-Limit (etwas unter Backend-Cap 25 MB, damit der
// base64-Overhead nicht die Grenze reisst). base64 blaeht ~4/3.
const MAX_TOTAL_BYTES = 24 * 1024 * 1024;

interface AttachmentState extends MailAttachment {
  size: number; // originale Byte-Groesse fuer die UI (nicht base64)
}

/**
 * Wandelt eine File in unser {name, mime, base64, size}-Format.
 * FileReader.readAsDataURL liefert "data:mime;base64,<payload>" –
 * wir schneiden den Prefix ab, weil das Backend rohes base64
 * erwartet.
 */
function fileToAttachment(file: File): Promise<AttachmentState> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("read_failed"));
    reader.onload = () => {
      const result = String(reader.result || "");
      const idx = result.indexOf(",");
      const base64 = idx >= 0 ? result.slice(idx + 1) : result;
      resolve({
        name: file.name || "Datei",
        mime: file.type || "application/octet-stream",
        base64,
        size: file.size,
      });
    };
    reader.readAsDataURL(file);
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function ComposeDialog({
  initial,
  onClose,
  onSent,
}: {
  initial: ComposeInitial;
  onClose: () => void;
  onSent: () => void;
}) {
  const [to, setTo] = useState(initial.to || "");
  const [cc, setCc] = useState(initial.cc || "");
  const [bcc, setBcc] = useState(initial.bcc || "");
  const [subject, setSubject] = useState(initial.subject || "");
  const [html, setHtml] = useState(initial.html || "");
  const [preview, setPreview] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentState[]>([]);
  const [sending, setSending] = useState(false);
  const [showCc, setShowCc] = useState(Boolean(initial.cc));
  const [showBcc, setShowBcc] = useState(Boolean(initial.bcc));
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const isReply = initial.mode === "reply";
  const title =
    initial.mode === "forward"
      ? "Weiterleiten"
      : initial.mode === "reply"
        ? "Antworten"
        : "Neue Mail";

  // Live-Validierung der Empfaengerfelder.
  const toParsed = useMemo(() => parseEmailList(to), [to]);
  const ccParsed = useMemo(() => parseEmailList(cc), [cc]);
  const bccParsed = useMemo(() => parseEmailList(bcc), [bcc]);

  const totalAttBytes = attachments.reduce((s, a) => s + a.size, 0);
  const totalRecipients =
    toParsed.recipients.length + ccParsed.recipients.length + bccParsed.recipients.length;

  const canSend =
    !sending &&
    subject.trim().length > 0 &&
    html.trim().length > 0 &&
    toParsed.recipients.length > 0 &&
    toParsed.invalid.length === 0 &&
    ccParsed.invalid.length === 0 &&
    bccParsed.invalid.length === 0 &&
    totalRecipients > 0 &&
    totalAttBytes <= MAX_TOTAL_BYTES;

  async function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const list = e.target.files;
    if (!list || list.length === 0) return;
    const files = Array.from(list);
    try {
      const converted = await Promise.all(files.map(fileToAttachment));
      // Groesse VOR dem State-Merge pruefen, damit wir dem Nutzer
      // frueh signalisieren, dass eine Datei nicht mehr reinpasst.
      const nextTotal =
        totalAttBytes + converted.reduce((s, a) => s + a.size, 0);
      if (nextTotal > MAX_TOTAL_BYTES) {
        toastError(
          `Anhaenge zu gross (Max ${formatSize(MAX_TOTAL_BYTES)} gesamt).`,
        );
      } else {
        setAttachments((prev) => [...prev, ...converted]);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unbekannter Fehler";
      toastError(`Anhang konnte nicht gelesen werden: ${msg}`);
    } finally {
      // Reset, damit dieselbe Datei erneut ausgewaehlt werden kann.
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function removeAttachment(idx: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handleSend() {
    if (!canSend) return;
    setSending(true);
    try {
      await sendMail({
        to: toParsed.recipients,
        cc: ccParsed.recipients.length ? ccParsed.recipients : undefined,
        bcc: bccParsed.recipients.length ? bccParsed.recipients : undefined,
        subject: subject.trim(),
        html,
        attachments: attachments.length
          ? attachments.map(({ name, mime, base64 }) => ({ name, mime, base64 }))
          : undefined,
        inReplyTo: isReply ? initial.inReplyTo : undefined,
      });
      toast("Mail gesendet.");
      onSent();
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unbekannter Fehler";
      toastError(`Senden fehlgeschlagen: ${msg}`);
    } finally {
      setSending(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={title} size="2xl">
      <div className="space-y-3">
        {/* Empfaenger */}
        <RecipientField
          label="An"
          value={to}
          onChange={setTo}
          invalid={toParsed.invalid}
          required
          autoFocus={initial.mode !== "reply"}
        />
        {showCc ? (
          <RecipientField
            label="Cc"
            value={cc}
            onChange={setCc}
            invalid={ccParsed.invalid}
          />
        ) : (
          <button
            type="button"
            className="text-xs text-slate-500 hover:text-[var(--accent)]"
            onClick={() => setShowCc(true)}
          >
            + Cc
          </button>
        )}
        {showBcc ? (
          <RecipientField
            label="Bcc"
            value={bcc}
            onChange={setBcc}
            invalid={bccParsed.invalid}
          />
        ) : (
          <button
            type="button"
            className="ml-3 text-xs text-slate-500 hover:text-[var(--accent)]"
            onClick={() => setShowBcc(true)}
          >
            + Bcc
          </button>
        )}

        <div>
          <label className="label">Betreff</label>
          <input
            className="input"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Kurze Zusammenfassung ..."
            maxLength={998}
          />
        </div>

        {/* Body: Textarea + optionale Vorschau */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="label mb-0">Nachricht (HTML erlaubt)</label>
            <button
              type="button"
              className="btn-ghost px-2 py-1 text-xs"
              onClick={() => setPreview((p) => !p)}
              title="HTML-Vorschau umschalten"
            >
              <Eye size={13} /> {preview ? "Bearbeiten" : "Vorschau"}
            </button>
          </div>
          {preview ? (
            <div
              className="glass min-h-[220px] rounded-lg p-3 text-sm"
              // Vorschau NUR fuer den vom User selbst geschriebenen Content;
              // Absender-HTML wird hier nicht gerendert.
              dangerouslySetInnerHTML={{ __html: html }}
            />
          ) : (
            <textarea
              className="input min-h-[220px] font-mono text-sm"
              value={html}
              onChange={(e) => setHtml(e.target.value)}
              placeholder="<p>Hallo ...</p>"
            />
          )}
        </div>

        {/* Attachments – bei Reply deaktiviert (Backend-MVP-Grenze) */}
        <div>
          <div className="mb-1 flex items-center justify-between">
            <label className="label mb-0">Anhaenge</label>
            <span className="text-[11px] text-slate-400">
              {formatSize(totalAttBytes)} / {formatSize(MAX_TOTAL_BYTES)}
            </span>
          </div>
          {isReply ? (
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
              <Info size={13} className="mt-0.5 shrink-0" />
              <span>Anhaenge sind im Antwort-Modus derzeit nicht moeglich.</span>
            </div>
          ) : (
            <>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                onChange={handleFilePick}
                className="text-xs text-slate-500 file:mr-3 file:rounded-lg file:border file:border-solid file:px-3 file:py-1.5 file:text-sm"
                style={{ ["--tw-file-border" as string]: "var(--border)" }}
              />
              {attachments.length > 0 && (
                <ul className="mt-2 space-y-1">
                  {attachments.map((a, i) => (
                    <li
                      key={`${a.name}-${i}`}
                      className="flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs"
                      style={{ borderColor: "var(--border)" }}
                    >
                      <Paperclip size={12} className="shrink-0 text-slate-400" />
                      <span className="min-w-0 flex-1 truncate" title={a.name}>
                        {a.name}
                      </span>
                      <span className="shrink-0 text-slate-400">
                        {formatSize(a.size)}
                      </span>
                      <button
                        type="button"
                        className="shrink-0 text-slate-400 hover:text-rose-500"
                        onClick={() => removeAttachment(i)}
                        title="Entfernen"
                      >
                        <X size={12} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        {/* Fehler-Feedback: aggregierter Hinweis */}
        {(toParsed.invalid.length > 0 ||
          ccParsed.invalid.length > 0 ||
          bccParsed.invalid.length > 0) && (
          <div className="flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            <span>
              Ungueltige Adressen:{" "}
              {[...toParsed.invalid, ...ccParsed.invalid, ...bccParsed.invalid].join(", ")}
            </span>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="mt-5 flex items-center justify-between">
        <span className="text-[11px] text-slate-400">
          {totalRecipients} Empfaenger
          {attachments.length > 0 ? ` · ${attachments.length} Anhang` : ""}
        </span>
        <div className="flex gap-2">
          <button type="button" className="btn-outline" onClick={onClose}>
            <X size={15} /> Abbrechen
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleSend}
            disabled={!canSend}
          >
            {sending ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Send size={15} />
            )}
            Senden
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Empfaenger-Feld mit Live-Validation ─────────────────────
function RecipientField({
  label,
  value,
  onChange,
  invalid,
  required,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  invalid: string[];
  required?: boolean;
  autoFocus?: boolean;
}) {
  const hasError = invalid.length > 0;
  return (
    <div>
      <label className="label">
        {label}
        {required ? <span className="ml-0.5 text-rose-500">*</span> : null}
      </label>
      <input
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        placeholder="name@firma.at, Bob <bob@firma.at>"
        style={
          hasError
            ? { borderColor: "rgb(244 63 94 / 0.6)" }
            : undefined
        }
      />
    </div>
  );
}
