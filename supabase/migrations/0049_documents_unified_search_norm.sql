-- Fehlertolerante Dokumentsuche: normalisierte Spalte search_norm an documents_unified.
-- search_norm = search_text (bereits lowercase) ohne alle Nicht-[a-z0-9]-Zeichen.
-- Dadurch finden Suchbegriffe Dokumentnummern unabhängig von Bindestrichen,
-- Leerzeichen und Schreibweise (z. B. "0012 2026", "00122026", "angebot-0012"
-- treffen alle ANGEBOT-0012-2026).
--
-- Umsetzung als schlanker Wrapper, damit die umfangreiche UNION-Definition aus
-- 0044 nicht dupliziert werden muss (mandantenfähig, security_invoker bleibt aktiv).

ALTER VIEW documents_unified RENAME TO documents_unified_core;

CREATE VIEW documents_unified
WITH (security_invoker = true) AS
SELECT c.*,
       regexp_replace(c.search_text, '[^a-z0-9]', '', 'g') AS search_norm
FROM documents_unified_core c;

GRANT SELECT ON documents_unified_core TO authenticated, anon;
GRANT SELECT ON documents_unified TO authenticated, anon;
