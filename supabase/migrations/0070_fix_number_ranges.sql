-- 0070_fix_number_ranges.sql
-- B4Y SuperAPP – Nummernkreise reparieren & absichern (mandantenfähig, org-scoped).
-- ------------------------------------------------------------------------------
-- Hintergrund:
--   1) Der Projekt-Nummernkreis (doc_type='projekt') stand auf next_number=1,
--      obwohl bereits Projekte mit Nummern existierten. Die nächste atomare Vergabe
--      über next_document_number('projekt') hätte damit eine bereits vergebene
--      Nummer erzeugt. Fix: next_number auf MAX(vergebene Projektnummer)+1 anheben
--      (nur ERHÖHEN, nie verringern – GREATEST), je Organisation.
--   2) Zentrale Nummernkreise (Kontakte + Dokumente) werden als `protected`
--      markiert, damit Präfix/nächste Nr./Aktiv-Status nicht versehentlich in den
--      Einstellungen geändert/deaktiviert werden (siehe src/components/NumberRanges.tsx).
--   3) Der ungenutzte "partner"-Kreis wird entfernt (es gibt keine Partner-Kontakte;
--      die Kontaktart ist auch nicht mehr in der Anwendung auswählbar). Der DELETE
--      ist je Organisation gegen vorhandene Partner-Kontakte abgesichert.
--
-- Echte Spalten (gegen Codebasis geprüft, NICHT gegen die ChatGPT-Vorlage):
--   number_ranges(doc_type, organization_id, next_number, protected, active, …)
--   projects.project_number  (offers.number / orders.order_number / invoices.number
--   werden hier bewusst NICHT angefasst – diese Nummern werden ausschließlich atomar
--   über next_document_number() vergeben, ihre Kreise laufen daher synchron.)
-- Die Zählnummer steht in project_number immer als erste Ziffernfolge (Präfix ohne
-- Ziffern, danach Zähler, optional Jahr) → substring(... from '[0-9]+') liefert sie.
-- ------------------------------------------------------------------------------

-- 1) Projekt-Nummernkreis je Organisation auf MAX(vergebene Nummer)+1 anheben.
update public.number_ranges nr
set next_number = greatest(nr.next_number, coalesce(m.max_num, 0) + 1),
    updated_at  = now()
from (
  select organization_id,
         max(substring(project_number from '[0-9]+')::int) as max_num
  from public.projects
  where project_number ~ '[0-9]'
  group by organization_id
) m
where nr.doc_type = 'projekt'
  and nr.organization_id = m.organization_id
  and nr.next_number < m.max_num + 1;

-- 2) Zentrale Nummernkreise schützen (nur tatsächlich vorhandene Zeilen betroffen).
update public.number_ranges
set protected  = true,
    updated_at = now()
where doc_type in (
  -- Kontakt-Kreise
  'kunde', 'lieferant', 'subunternehmer', 'sonstige',
  -- Dokument-Kreise
  'projekt', 'angebot', 'nachtrag', 'auftrag', 'auftrag_sub', 'rechnung', 'reminder'
)
  and protected is distinct from true;

-- 3) Ungenutzten "partner"-Kreis entfernen – je Organisation nur, wenn es dort
--    keine Partner-Kontakte (mehr) gibt.
delete from public.number_ranges nr
where nr.doc_type = 'partner'
  and not exists (
    select 1
    from public.contacts c
    where c.type = 'partner'
      and c.organization_id = nr.organization_id
  );
