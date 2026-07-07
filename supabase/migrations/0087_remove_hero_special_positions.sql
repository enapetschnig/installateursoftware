-- ============================================================
-- 0087 – Hero-Import: reservierte Spezial-Leistungen 980–999 entfernen
-- ------------------------------------------------------------
-- Der einmalige Hero-Import (scripts/import-hero-to-b4y.ts) hat Variable-/Regie-/
-- Material-Positionen als aktive Katalog-Leistungen im Nummernbereich XX-980–999
-- angelegt. Seit Migration 0060 werden diese Positionen jedoch dokumentlokal über
-- die Editor-Buttons erzeugt (service_id = null) und NICHT mehr als Stammleistungen
-- geführt. Die importierten Katalogzeilen doppeln daher die saubere Logik und
-- erscheinen fälschlich in der normalen Leistungsauswahl.
--
-- Diese Migration entfernt ausschließlich den reservierten Spezialbereich
-- XX-980–999. Echte Leistungen außerhalb (z. B. „Mulde" XX-910/911/912) bleiben
-- vollständig erhalten. Bestehende Dokumente sind nicht betroffen: Positionen sind
-- als JSONB-Snapshot gespeichert (kein Fremdschlüssel auf services).
--
-- Idempotent: erneutes Ausführen ist gefahrlos (löscht nichts mehr, wenn bereits leer).
-- ============================================================

-- 1) Eventuelle Komponenten der betroffenen Leistungen zuerst lösen (FK-Sicherheit).
delete from public.service_components
where service_id in (
  select id from public.services
  where service_number ~ '^[0-9]{2}-9[89][0-9]$'
);

-- 2) Die reservierten Spezial-Leistungen 980–999 löschen.
delete from public.services
where service_number ~ '^[0-9]{2}-9[89][0-9]$';

-- 3) Aufräumen: das im Import inkonsistent gesetzte Flag is_variable_template
--    auf verbleibenden (echten) Leistungen zurücksetzen – betraf z. B. die Mulden.
update public.services
set is_variable_template = false
where is_variable_template = true
  and service_number !~ '^[0-9]{2}-9[89][0-9]$';
