-- Firmeneinstellungen: Gesellschafter + mehrere Geschäftsführer sauber getrennt.
alter table public.company_settings
  add column if not exists gesellschafter text[] not null default '{}',
  add column if not exists geschaeftsfuehrer text[] not null default '{}';

-- Migration des bestehenden Einzelwerts: der bisher als „Geschäftsführer" gepflegte
-- Wert wird als GESELLSCHAFTER übernommen (fachlich korrekt, z. B. Lukasz Baranowski),
-- Geschäftsführer bleibt leer. Keine falsche Annahme „ist Geschäftsführer".
-- ceo wird geleert, damit die PDF-Logik nicht fälschlich auf den Altwert zurückfällt.
update public.company_settings
set gesellschafter = array[btrim(ceo)],
    geschaeftsfuehrer = '{}',
    ceo = null
where coalesce(array_length(gesellschafter, 1), 0) = 0
  and nullif(btrim(ceo), '') is not null;
