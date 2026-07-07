-- Öffentliche Logo-Freigabe für die Login-Seite.
-- Gibt NUR die Logo-URLs frei (keine sensiblen Firmendaten wie IBAN/Steuernummer).
-- Die Logo-Bilddateien liegen ohnehin in einem öffentlichen Storage-Bucket.
-- Die View läuft als Eigentümer (security_invoker=false) und umgeht damit bewusst
-- die RLS von company_settings – sie liefert aber ausschließlich die beiden Logo-Spalten.
create or replace view public.company_branding
with (security_invoker = false) as
  select id, logo_url, icon_logo_url
  from public.company_settings
  where id = 1;

grant select on public.company_branding to anon, authenticated;
