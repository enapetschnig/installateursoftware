import { PageHeader, Empty } from "../components/ui";

/**
 * Platzhalterseite für noch nicht gebaute Module.
 * `subtitle` optional – sonst neutraler Standardtext „In Vorbereitung".
 */
export default function Placeholder({ title, note, subtitle }: { title: string; note: string; subtitle?: string }) {
  return (
    <>
      <PageHeader title={title} subtitle={subtitle ?? "In Vorbereitung"} />
      <Empty title="Dieses Modul wird als Nächstes gebaut" hint={note} />
    </>
  );
}
