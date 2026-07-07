-- Neue Rechte-Module für die zusätzlichen Hauptbereiche (RBAC-vorbereitet).
-- "documents" existiert bereits (zentrale Dokumente). Nur News + Delegieren ergänzen.
insert into permission_modules (key, label, sort_order)
values
  ('news', 'News', 81),
  ('delegieren', 'Delegieren', 82)
on conflict (key) do nothing;
