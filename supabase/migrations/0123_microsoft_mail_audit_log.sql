-- ============================================================
-- 0123 – Microsoft Mail Audit-Log
-- ------------------------------------------------------------
-- Audit-Trail fuer JEDEN Versand-Versuch via Microsoft Graph.
-- User-Entscheidung 2026-06-29 (Phase 3): Metadaten + Body-Vorschau
-- (erste 500 Zeichen plain) — fuer Debugging + Compliance.
--
-- Loeschpfade (DSGVO):
--   * User wird geloescht → user_id auf NULL (set null), Logs bleiben
--     fuer Compliance (Anonymisierung). Empfaenger/Inhalt bleibt
--     stehen (rechtlich nachweisbarer Versand).
--   * Org geloescht → CASCADE.
--   * Verknuepfte Dokumente (offer/order/invoice) gelöscht → SET NULL.
-- ============================================================

create table public.microsoft_mail_audit_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null default public.current_org_id()
    references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,

  action text not null
    check (action in ('sent', 'failed', 'reply', 'forward')),

  -- Empfaenger-Listen, NULL = leer.
  recipient_to text[],
  recipient_cc text[],
  recipient_bcc text[],

  subject text,
  -- Body-Vorschau: hard-capped auf 500 Zeichen (Plain-Text, ohne HTML).
  body_preview text check (body_preview is null or length(body_preview) <= 500),
  attachment_count int not null default 0 check (attachment_count >= 0),

  -- Microsoft-Message-ID nach erfolgreichem Send (aus Graph-Response).
  microsoft_message_id text,

  -- Optionaler Bezug zum versendeten Geschaeftsdokument.
  related_offer_id uuid references public.offers(id) on delete set null,
  related_order_id uuid references public.orders(id) on delete set null,
  related_invoice_id uuid references public.invoices(id) on delete set null,

  -- Bei action='failed': Fehlermeldung (Klartext, kein Token).
  error_message text,

  -- Performance-Telemetrie.
  duration_ms int check (duration_ms is null or duration_ms >= 0),

  sent_at timestamptz not null default now()
);

alter table public.microsoft_mail_audit_log enable row level security;

create policy "mmal_app_all"
  on public.microsoft_mail_audit_log
  for all to authenticated
  using (true) with check (true);

-- Audit-Log ist auf Org-Ebene sichtbar (Admins sollen es lesen koennen)
-- aber NICHT zwischen Orgs.
create policy "mmal_org_isolation"
  on public.microsoft_mail_audit_log
  as restrictive for all to authenticated
  using (organization_id = public.current_org_id())
  with check (organization_id = public.current_org_id());

create index idx_mmal_org_sent
  on public.microsoft_mail_audit_log(organization_id, sent_at desc);
create index idx_mmal_offer
  on public.microsoft_mail_audit_log(related_offer_id)
  where related_offer_id is not null;
create index idx_mmal_order
  on public.microsoft_mail_audit_log(related_order_id)
  where related_order_id is not null;
create index idx_mmal_invoice
  on public.microsoft_mail_audit_log(related_invoice_id)
  where related_invoice_id is not null;

comment on table public.microsoft_mail_audit_log is
  'Audit-Trail fuer Mail-Versand via Microsoft Graph. Metadaten + Body-Vorschau.';
comment on column public.microsoft_mail_audit_log.body_preview is
  'Erste 500 Zeichen Plain-Text-Body. Hard-capped via CHECK.';
