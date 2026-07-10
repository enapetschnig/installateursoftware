-- ============================================================
-- Installateur SuperAPP – Migration 0155
-- Fachwissen-Regeln: die KI denkt mit wie ein Elektriker
-- ------------------------------------------------------------
-- Der Betrieb hinterlegt sein Fachwissen als Regeln (pflegbar unter
-- Einstellungen → Kalkulation, mandantenfähig – jede Firma ihr Wissen):
--   { "stichwort": "unterverteil|verteiler",     -- Regex auf das Transkript
--     "dann": "FI + LS je Stromkreis …",         -- was fachlich dazugehört
--     "frage": "Wie viele Stromkreise …?" }      -- Rückfrage, wenn unklar (optional)
-- Das Sprach-Angebot injiziert die Regeln als {{FACHREGELN}}-Block:
--   * "dann" fließt ins Mitdenken (gehört in Stückliste/Positionen)
--   * "frage" wird zur RÜCKFRAGE, wenn die Info im Transkript fehlt –
--     der Dialog zeigt sie VOR der Übernahme, der Anwender antwortet,
--     die KI kalkuliert neu (max. eine Runde).
-- Seed = Elektriker-Startwissen (österreichische Praxis) – änderbar/erweiterbar.
-- ============================================================

alter table public.company_settings
  add column if not exists kalk_fachregeln jsonb;

comment on column public.company_settings.kalk_fachregeln is
  'Fachwissen-Regeln des Betriebs für das Sprach-Angebot (JSONB-Array: stichwort-Regex, dann-Text, optionale frage). Die KI ergänzt Zugehöriges und stellt Rückfragen, wenn preisrelevante Angaben fehlen.';

update public.company_settings
   set kalk_fachregeln = '[
  { "stichwort": "unterverteil|verteilerkasten|sicherungskasten|zählerkasten|verteilung",
    "dann": "Zur Verteilung gehören: FI-Schutzschalter (mind. 1, ab ~8 Stromkreisen 2), LS-Automat JE Stromkreis, Beschriftung, Anschluss- und Verdrahtungsarbeit sowie Prüfung mit Messprotokoll (E-Befund) als eigene Position. Überspannungsschutz Typ 2 aktiv anbieten.",
    "frage": "Wie viele Stromkreise soll die Verteilung bekommen, und ist ein Überspannungsschutz (Typ 2) gewünscht?" },
  { "stichwort": "steckdose|schalter|taster|dimmer",
    "dann": "Je Auslass: Einsatz + UP-/Gerätedose + (anteiliger) Rahmen aus dem Katalog. In Feucht-/Außenbereichen IP44-Ausführung.",
    "frage": "Welches Schalterprogramm (Hersteller/Serie) und welche Farbe sind gewünscht?" },
  { "stichwort": "herd|kochfeld|backrohr",
    "dann": "E-Herd: Herdanschlussdose + Zuleitung 5x2,5 + 3-poliger LS B16 im Verteiler.",
    "frage": "Wie lang ist die Zuleitung vom Verteiler zum Herd ungefähr?" },
  { "stichwort": "wallbox|ladestation|e-auto",
    "dann": "Wallbox: eigener Stromkreis, FI Typ A-EV oder B, Zuleitung nach Ladeleistung, LS passend; ggf. Lastmanagement und Netzbetreiber-Meldung als Position.",
    "frage": "Welche Ladeleistung (kW) und wie lang ist die Leitungsstrecke zum Stellplatz?" },
  { "stichwort": "durchlauferhitzer|boiler|warmwasserspeicher|elektroheizung",
    "dann": "Eigene Zuleitung mit passender Absicherung im Verteiler einplanen (Leistung beachten).",
    "frage": null },
  { "stichwort": "außen|garten|terrasse|carport|keller.*feucht",
    "dann": "Außen-/Feuchtbereich: IP44-Material zwingend, FI-Schutz zwingend, ggf. Erdkabel E-YY statt NYM.",
    "frage": null },
  { "stichwort": "stromkreis|zuleitung|neu.*leitung",
    "dann": "Je neuem Stromkreis: Leitung + LS-Automat im Verteiler + Anschlussarbeit mitkalkulieren.",
    "frage": null },
  { "stichwort": "sanierung|altbau|umbau|zubau",
    "dann": "Bei Arbeiten an bestehenden Anlagen: Prüfung/Messprotokoll (E-Befund) nach Fertigstellung als Position anbieten; Stemm-/Wiederherstellungsarbeiten bei UP-Verlegung erwähnen (hinweis).",
    "frage": null }
]'::jsonb
 where kalk_fachregeln is null;
