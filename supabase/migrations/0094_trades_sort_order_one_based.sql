-- 0094_trades_sort_order_one_based.sql
-- Gewerke-Nummerierung von 0-basiert auf 1-basiert korrigieren.
-- Befund: Die bestehenden service_number/article_number sind bereits 1-basiert
-- (GEMEINKOSTEN-Leistungen = Praefix "01", ABBRUCH = "02", ...), nur trades.sort_order
-- begann bei 0 (GEMEINKOSTEN=0). Dadurch lieferte gewerkNo(0) = null (keine Gewerknummer).
-- Loesung: sort_order je betroffenem Mandanten um +1 verschieben, dann stimmen
-- gewerkNo (1->"01") und die vorhandenen Nummern-Praefixe ueberein.
--
-- Additiv & datenbewahrend: trade_id-Referenzen (Stundensaetze/Artikel/Leistungen/
-- Titel/Texte) bleiben unveraendert; service_number/article_number werden NICHT
-- umgeschrieben (sind bereits korrekt). Nur Mandanten mit einem Gewerk sort_order=0
-- werden verschoben (idempotent gegen erneutes Anwenden, solange kein 0 mehr existiert).
update public.trades t
   set sort_order = sort_order + 1
 where exists (
   select 1 from public.trades z
    where z.organization_id is not distinct from t.organization_id
      and z.sort_order = 0
 );
