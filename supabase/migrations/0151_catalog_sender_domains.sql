-- ============================================================
-- Installateur SuperAPP – Migration 0151
-- Absender-Zuordnung für die automatische Datanorm-Preiswartung
-- ------------------------------------------------------------
-- Bei MEHREREN Großhändler-Katalogen (z. B. Sonepar + Rexel) muss eine
-- eingehende Preis-Mail dem richtigen Katalog zugeordnet werden – sonst
-- würden Rexel-Preise den Sonepar-Katalog überschreiben. Zuordnung über
-- die Absender-Domain(s) des Händlers (z. B. {sonepar.at, sonepar.com}).
-- Pflege in Einstellungen → Großhandel & Kataloge. Bei genau EINEM Katalog
-- bleibt alles wie bisher (keine Zuordnung nötig).
-- ============================================================

alter table public.supplier_catalogs
  add column if not exists sender_domains text[];

comment on column public.supplier_catalogs.sender_domains is
  'E-Mail-Absender-Domains des Großhändlers (z. B. {sonepar.at}). Ordnet eingehende Datanorm-Preismails dem richtigen Katalog zu, sobald mehrere Kataloge existieren.';
