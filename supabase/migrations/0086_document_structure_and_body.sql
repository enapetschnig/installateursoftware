-- ============================================================
-- B4Y SuperAPP – Dokumentstruktur je Dokumentart + Textinhalt
-- ------------------------------------------------------------
-- (Ursprünglich als 0084 gebaut; auf 0086 umnummeriert, da 0084/0085 bereits
--  durch die Voice-Angebote-Pipeline belegt sind. Inhaltlich unverändert.)
-- Neben den positionsbasierten Standarddokumenten (Angebot/Nachtrag/Auftrag/SUB/
-- Rechnung) sollen Textdokumente (Briefe), Formulare und reine Uploads möglich sein.
-- `document_types.document_structure` legt je Dokumentart die Struktur fest.
-- Rein additiv. is_system-Typen sind/bleiben 'positions' (Schutz zusätzlich im UI/Service).
-- Mandantenfähigkeit/RLS unverändert.
--   positions    = Leistungstabelle/Kalkulation/Summen (die 5 Standarddokumente)
--   text         = reines Textdokument (Brief/Anschreiben) – Rich-Text, kein Tabelle
--   form         = Formular-/Berichtsdokument (Editor folgt später)
--   upload_only  = nur Dateiablage, kein App-Editor
-- ============================================================

alter table public.document_types
  add column if not exists document_structure text not null default 'upload_only';

do $$ begin
  alter table public.document_types
    add constraint document_types_structure_check
    check (document_structure in ('positions','text','form','upload_only'));
exception when duplicate_object then null; end $$;

comment on column public.document_types.document_structure is
  'Dokumentstruktur: positions (Leistungstabelle), text (Brief/Anschreiben), form (Formular/Bericht), upload_only (nur Ablage). is_system-Typen bleiben positions.';

-- Defaults setzen (Slug-basiert = Seed/Config, kein Hardcode in der App-Logik):
update public.document_types set document_structure = 'positions' where is_system = true;
update public.document_types set document_structure = 'positions'
  where lower(slug) in ('angebote','angebot_nachtrag','auftraege','auftrag_sub','rechnungen','gutschriften','mahnungen','kalkulation','materialbestellung');
update public.document_types set document_structure = 'text'
  where lower(slug) in ('briefe','anschreiben','arbeitsanweisung','baustellenbericht','parkflaechenabsperrung');

-- Textinhalt + optionaler PDF-Snapshot für generische App-Dokumente.
alter table public.documents
  add column if not exists body_html text,
  add column if not exists print_html_snapshot text;

comment on column public.documents.body_html is 'Rich-Text-Inhalt eines Textdokuments (Brief/Anschreiben). Optional.';
comment on column public.documents.print_html_snapshot is 'Eingefrorener PDF-/Druckstand beim Abschließen eines Textdokuments. Optional.';
