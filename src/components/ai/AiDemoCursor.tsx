// ============================================================
// B4Y SuperAPP – Virtueller Demo-Cursor (KI-Schulungsmodus)
// Reines UI-Overlay: ein künstlicher Mauszeiger, der sich animiert zu
// einem Zielpunkt bewegt. Steuert NICHT den echten OS-Cursor und löst
// KEINE Systemklicks aus. `pointer-events:none` – blockiert die App nie.
// Nutzt Theme-Tokens (var(--accent)), sichtbar in Hell/Dunkel/Augenschon.
// ============================================================

export default function AiDemoCursor({ x, y, clicking }: { x: number; y: number; clicking?: boolean }) {
  return (
    <div
      aria-hidden
      style={{
        position: "fixed",
        left: 0,
        top: 0,
        transform: `translate(${x}px, ${y}px)`,
        transition: "transform 600ms cubic-bezier(0.22, 1, 0.36, 1)",
        zIndex: 2147483000,
        pointerEvents: "none",
        willChange: "transform",
      }}
    >
      {/* Klick-Welle (nur visuell) */}
      {clicking && (
        <span
          style={{
            position: "absolute",
            left: -6,
            top: -6,
            width: 34,
            height: 34,
            borderRadius: "9999px",
            border: "2px solid var(--accent)",
            opacity: 0.55,
            animation: "b4yTourPing 600ms ease-out",
          }}
        />
      )}
      {/* Pfeil-Cursor */}
      <svg width="26" height="26" viewBox="0 0 24 24" style={{ filter: "drop-shadow(0 2px 4px rgba(0,0,0,0.35))" }}>
        <path
          d="M4 2 L4 19 L9 14.5 L12.5 22 L15.5 20.7 L12 13.3 L19 13 Z"
          fill="var(--accent)"
          stroke="#ffffff"
          strokeWidth="1.3"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
