import { initials } from "../lib/format";
import { useSignedUrl } from "../lib/storage";

// Zentraler Avatar: zeigt das (private) Mitarbeiterfoto rund/zentriert über eine
// signierte URL, sonst die Initialen als Farbkreis. Überall statt eigener
// Initialen-Logik verwenden, damit Foto/Fallback konsistent sind.
export default function Avatar({ name, url, size = 36, className = "", title }: {
  name?: string | null;
  url?: string | null;          // Storage-Pfad/URL in 'project-files' (employees.photo_url)
  size?: number;                // Durchmesser in px
  className?: string;
  title?: string;
}) {
  const signed = useSignedUrl("project-files", url ?? null);
  const px = `${size}px`;
  if (url && signed) {
    return (
      <img src={signed} alt={name ?? ""} title={title ?? name ?? undefined}
        className={`shrink-0 rounded-full object-cover ${className}`}
        style={{ width: px, height: px }} />
    );
  }
  return (
    <div title={title ?? name ?? undefined}
      className={`grid shrink-0 place-items-center rounded-full font-bold text-white ${className}`}
      style={{ width: px, height: px, fontSize: Math.max(10, Math.round(size * 0.4)),
        background: "linear-gradient(135deg,var(--accent),var(--accent2))" }}>
      {initials(name)}
    </div>
  );
}
