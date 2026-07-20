-- ============================================================
-- Installateur SuperAPP – Migration 0162
-- Fix: eingehende Mails/Anrufe erschienen DOPPELT im Zeitstrahl
-- ------------------------------------------------------------
-- Befund im Test: Eine eingehende Mail tauchte zweimal auf – einmal über
-- den `incoming_mails`-Zweig der View und einmal als `contact_events`-Zeile,
-- die der Zuordnungs-Trigger zusätzlich angelegt hat. Dasselbe galt für
-- Telefonate (Zweig `anfragen` + 'call'-Ereignis).
--
-- Korrektur nach dem ursprünglichen Grundsatz: contact_events ist NUR für
-- Ereignisse, die keine eigene Quelle haben (manuelle Erfassung, ausgehende
-- Mail). Alles mit eigener Tabelle liefert die View direkt.
-- `last_contact_at` wird von den Triggern jetzt selbst gepflegt.
-- ============================================================

-- ── 1) Eingehende Mail: nur zuordnen + Kontaktdatum stempeln ──
create or replace function public.crm_assign_incoming_mail()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.contact_id is null then
    new.contact_id := public.crm_match_contact_by_email(new.from_email, new.organization_id);
  end if;

  -- KEIN contact_events-Insert: die Mail steht bereits über den
  -- incoming_mails-Zweig der View `contact_timeline` in der Akte.
  if new.contact_id is not null then
    update public.contacts
       set last_contact_at = greatest(
             coalesce(last_contact_at, coalesce(new.received_at, now())),
             coalesce(new.received_at, now()))
     where id = new.contact_id;
  end if;

  return new;
end $$;

-- ── 2) Anfrage/Anruf: nur zuordnen + Kontaktdatum stempeln ──
create or replace function public.crm_assign_anfrage_contact()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_zeit timestamptz;
begin
  if new.related_contact_id is null then
    new.related_contact_id := coalesce(
      public.crm_match_contact_by_phone(new.caller_phone, new.organization_id),
      public.crm_match_contact_by_email(new.caller_email, new.organization_id));
  end if;

  -- KEIN contact_events-Insert: Anfragen (inkl. Anruf-Transkript und
  -- KI-Zusammenfassung) stehen bereits über den anfragen-Zweig der View.
  if new.related_contact_id is not null then
    v_zeit := coalesce(new.call_started_at, new.created_at, now());
    update public.contacts
       set last_contact_at = greatest(coalesce(last_contact_at, v_zeit), v_zeit)
     where id = new.related_contact_id;
  end if;

  return new;
end $$;

-- ── 3) Bereits erzeugte Doppel-Ereignisse entfernen ──
-- Betrifft ausschließlich automatisch erzeugte Zeilen (source mail_in/call);
-- manuell erfasste Gespräche und ausgehende Mails bleiben unberührt.
delete from public.contact_events where source in ('mail_in', 'call');
