-- ============================================================
-- 0089 – Nummernkreise finalisieren (Dubletten/Altlasten bereinigen)
-- ------------------------------------------------------------
-- EINMALIG, von Lukasz im Supabase SQL-Editor auszuführen.
-- Enthält Löschungen von KONFIG-Zeilen (number_ranges), KEINE Belege/Stammdaten.
-- Läuft in einer Transaktion – bei Fehler wird alles zurückgerollt.
--
--   1) nachtrag-Dublette zusammenführen: der Code vergibt Angebot-Nachtrag-Nummern
--      über doc_type 'nachtrag'. Der zweite, ungenutzte Kreis 'angebot_nachtrag'
--      wird entfernt und 'nachtrag' an die Dokumentart angebot_nachtrag gehängt.
--   2) Verwaiste Alt-Kreise ohne Dokumentart entfernen (customer_mail, protokoll,
--      regiebericht – keine Vergabe im Code).
--   3) Kontaktkreis 'sonstige' entfernen, sofern keine Kontakte dieses Typs existieren.
-- ============================================================
begin;

-- 1) nachtrag-Dublette
delete from public.number_ranges where doc_type = 'angebot_nachtrag';

update public.number_ranges nr
set document_type_id = dt.id,
    label            = dt.name,
    protected        = dt.is_system,
    updated_at       = now()
from public.document_types dt
where nr.doc_type = 'nachtrag'
  and dt.slug = 'angebot_nachtrag';

-- 2) Verwaiste Alt-Kreise
delete from public.number_ranges
where doc_type in ('customer_mail', 'protokoll', 'regiebericht');

-- 3) 'sonstige' nur entfernen, wenn unbenutzt
delete from public.number_ranges nr
where nr.doc_type = 'sonstige'
  and not exists (select 1 from public.contacts c where lower(c.type) = 'sonstige');

commit;
