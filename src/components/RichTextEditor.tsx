import { useEffect, useRef } from "react";
import { Bold, Italic, List, Pilcrow, Link2 } from "lucide-react";
import { sanitizeHtml } from "../lib/sanitize";
import PlaceholderMenu from "./PlaceholderMenu";
import type { PlaceholderGroup } from "../lib/document-placeholders";

/**
 * Leichter WYSIWYG-Editor (Fett, Kursiv, Aufzählung, Absatz, Link).
 * Speichert HTML über onChange. Uncontrolled DOM, um Cursor-Sprünge zu vermeiden.
 *
 * Optional: `placeholders` aktiviert ein Platzhalter-Menü (Popover) in der Toolbar
 * (neben dem Link-Button). Ein Klick fügt den Token an der Cursorposition ein.
 * Ohne diese Prop bleibt der Editor unverändert (kein Button) – bestehende Verwender
 * sind nicht betroffen.
 */
export default function RichTextEditor({ value, onChange, placeholder, minHeight = 160, disabled, placeholders }: {
  value: string; onChange: (html: string) => void; placeholder?: string; minHeight?: number; disabled?: boolean;
  placeholders?: PlaceholderGroup[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);

  // Externe Wertänderung ins DOM übernehmen (z.B. Vorlage einfügen / Feld leeren).
  // Läuft bei JEDER value-Änderung – aber NICHT während der Nutzer im Editor tippt
  // (dann ist el === activeElement und value entspricht ohnehin dem Inhalt) → kein
  // Cursor-Sprung, kein Überschreiben manueller Eingaben.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (document.activeElement !== el && el.innerHTML !== (value || "")) {
      // Gespeicherten Wert vor dem Einsetzen sanitisieren (Stored-XSS-Schutz).
      el.innerHTML = sanitizeHtml(value);
    }
  }, [value]);

  function saveSel() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && ref.current?.contains(sel.anchorNode)) {
      savedRange.current = sel.getRangeAt(0).cloneRange();
    }
  }
  function restoreSel() {
    const sel = window.getSelection();
    if (savedRange.current && sel) { sel.removeAllRanges(); sel.addRange(savedRange.current); }
  }
  function emit() { onChange(ref.current?.innerHTML ?? ""); }
  function exec(cmd: string, val?: string) {
    if (disabled) return;
    ref.current?.focus(); restoreSel();
    document.execCommand(cmd, false, val);
    emit(); saveSel();
  }
  function makeLink() {
    const url = window.prompt("Link-URL eingeben:", "https://");
    if (url) exec("createLink", url);
  }
  // Platzhalter-Token an der aktuellen Cursorposition einfügen (gleicher Pfad wie exec).
  function insertToken(token: string) {
    if (disabled) return;
    ref.current?.focus(); restoreSel();
    document.execCommand("insertText", false, token);
    emit(); saveSel();
  }

  const Btn = ({ onClick, title, children }: { onClick: () => void; title: string; children: any }) => (
    <button type="button" title={title} disabled={disabled} onMouseDown={(e) => e.preventDefault()} onClick={onClick}
      className="grid h-8 w-8 place-items-center rounded-lg text-slate-600 hover:bg-[var(--hover)] disabled:opacity-40 dark:text-slate-300">
      {children}
    </button>
  );

  return (
    <div className="rounded-xl border" style={{ borderColor: "var(--border)" }}>
      <div className="flex flex-wrap items-center gap-1 border-b p-1" style={{ borderColor: "var(--border)" }}>
        <Btn title="Fett" onClick={() => exec("bold")}><Bold size={16} /></Btn>
        <Btn title="Kursiv" onClick={() => exec("italic")}><Italic size={16} /></Btn>
        <Btn title="Aufzählung" onClick={() => exec("insertUnorderedList")}><List size={16} /></Btn>
        <Btn title="Absatz" onClick={() => exec("formatBlock", "p")}><Pilcrow size={16} /></Btn>
        <Btn title="Link" onClick={makeLink}><Link2 size={16} /></Btn>
        {placeholders && placeholders.length > 0 && (
          <>
            <div className="mx-1 h-5 w-px bg-slate-200 dark:bg-white/10" />
            <PlaceholderMenu groups={placeholders} onInsert={insertToken} disabled={disabled} />
          </>
        )}
      </div>
      <div
        ref={ref}
        contentEditable={!disabled}
        suppressContentEditableWarning
        data-placeholder={placeholder ?? "Text eingeben …"}
        onInput={emit}
        onKeyUp={saveSel}
        onMouseUp={saveSel}
        onBlur={saveSel}
        className="mail-editor max-w-none p-3 text-sm leading-relaxed focus:outline-none"
        style={{ minHeight, wordBreak: "break-word" }}
      />
    </div>
  );
}
