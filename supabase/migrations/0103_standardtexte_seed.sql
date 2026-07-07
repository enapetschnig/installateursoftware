-- ============================================================
-- 0103 – Standard-Vor-/Nachtexte (abgestimmte Sammlung) seeden
-- ------------------------------------------------------------
-- Quelle: B4Y_Dokumenttexte_Vor_und_Nachtexte.pdf. Übernimmt die Vor-/Nachtexte je
-- Dokumentart + Variante in die bestehende Variantenlogik:
--   • Angebot Standard/Pauschal/Regie → offer_types.intro_text/closing_text (diese
--     gewinnen beim Vorbefüllen, siehe OfferEditor).
--   • Auftrag / Rechnung / Nachtrag / Auftrag-SUB je Variante → document_type_transitions
--     (order_/invoice_/nachtrag_/sub_order_-Texte je offer_type; gewinnen als Stufe A).
--
-- Bewusst NICHT übernommen: Signaturzeilen ("Mit freundlichen Grüßen / Name / Firma") –
-- die PDF-Engine rendert genau EINE Signatur zentral (Migr. 0101).
-- White-Label: BAU4YOU-Bank/UID/Adresse NICHT hartcodiert, sondern als Platzhalter
-- ({{firma.iban}}, {{firma.bic}}, {{firma.uid}}, {{firma.name}}, {{firma.adresse}}) –
-- je Mandant aus company_settings. Anrede über {{kunde.anrede_zeile}}.
-- Alte {{CustomerDocument.discount_time/_rate/due_time}} → {{kondition.skonto_tage}},
-- {{kondition.skonto_prozent}}, {{kondition.zahlungsziel}}.
-- §19-Rechnung (ohne MwSt): NICHT als eigener Variantentext geseedet (eigener VAT-Modus,
-- kein offer_type). Der gesetzliche Reverse-Charge-Hinweis wird zentral im Code an JEDE
-- §19-Rechnung (alle 3 Varianten) angehängt: src/lib/offer-types.ts withParagraph19Note(),
-- angewendet in InvoiceEditor (Live + finaler Snapshot).
--
-- Datenbewahrend: offer_types werden mit den abgestimmten Texten gesetzt; transitions
-- per UNIQUE(organization_id, offer_type_id) upserted (Texte gesetzt). Reine Konfiguration,
-- jederzeit in den Einstellungen überschreibbar.
-- ============================================================

-- ---- Angebote: offer_types (intro/closing) ----
update public.offer_types set
  intro_text = $i$Vielen Dank für Ihre Anfrage und Ihr Interesse an unseren Leistungen. Gerne übermitteln wir Ihnen unser Angebot und hoffen, dass es Ihren Vorstellungen entspricht.$i$,
  closing_text = $c$Preise gültig für die Dauer von 3 Monaten.
Die Aufmaß-Abrechnung erfolgt nach tatsächlichem Aufwand und ÖNORM.

Wir würden uns freuen, Ihr Projekt gemeinsam mit Ihnen umzusetzen und stehen Ihnen für Rückfragen jederzeit gerne zur Verfügung.$c$,
  updated_at = now()
where slug = 'standard';

update public.offer_types set
  intro_text = $i$Vielen Dank für Ihre Anfrage und Ihr Interesse an unseren Leistungen. Gerne übermitteln wir Ihnen unser Pauschalangebot und hoffen, dass es Ihren Vorstellungen entspricht.$i$,
  closing_text = $c$Preise gültig für die Dauer von drei Monaten.

Die Abrechnung erfolgt pauschal. Es werden keine Zusätze und keine Abzüge gerechnet. Kleine Änderungen in Mengen und Ausstattung sind im Pauschalpreis enthalten.

Nicht im Pauschalpreis enthalten sind:
- zusätzliche Mieter- oder Kundenwünsche
- Arbeiten, welche uns von der Baubehörde vorgeschrieben werden
- verdeckte Mängel, welche vor Beginn der Arbeiten nicht ersichtlich waren
- Arbeiten am Fallstrang bei Kanal- und Wasserleitungen

Wir würden uns freuen, Ihr Projekt gemeinsam mit Ihnen umzusetzen und stehen Ihnen für Rückfragen jederzeit gerne zur Verfügung.$c$,
  updated_at = now()
where slug = 'pauschal';

update public.offer_types set
  intro_text = $i$Vielen Dank für Ihre Anfrage und Ihr Interesse an unseren Leistungen.

Da der genaue Leistungsumfang derzeit noch nicht vollständig feststeht beziehungsweise vorab nicht exakt kalkulierbar ist, übermitteln wir Ihnen hiermit unser Regieangebot.

Die angeführten Leistungen werden nach tatsächlichem Aufwand auf Basis der nachstehenden Regiesätze, Materialkosten, Geräte, Fahrtzeiten, Entsorgungen und allfälligen Fremdleistungen abgerechnet.$i$,
  closing_text = $c$Preise gültig für die Dauer von drei Monaten.

Die Abrechnung erfolgt nach tatsächlichem Aufwand und gemäß den jeweils gültigen Bestimmungen der ÖNORM.

Die tatsächlich erbrachten Leistungen werden entsprechend dokumentiert und auf Grundlage der Stundenaufzeichnungen, Materialnachweise und sonstigen Leistungsnachweise abgerechnet.

Wir würden uns freuen, Ihr Projekt gemeinsam mit Ihnen umzusetzen und stehen Ihnen für Rückfragen jederzeit gerne zur Verfügung.$c$,
  updated_at = now()
where slug = 'regie';

-- ---- Folgedokumente je Variante: document_type_transitions (Stufe-A-Texte) ----
-- Hinweis SUB: Der lange SUB-Vertragstext ist rechtlich sensibel (siehe Quell-PDF) und
-- wird hier NICHT seitenweise hartcodiert. Es werden die Einleitungen sowie ein kompakter,
-- mandantenneutraler SUB-Nachtext geseedet; den ausführlichen SUB-Vertrag pflegt der
-- Mandant in den Einstellungen (Dokumentvarianten) ein → bewusst „zu prüfen".

-- Variante STANDARD
insert into public.document_type_transitions
  (organization_id, offer_type_id,
   order_intro_text, order_closing_text,
   invoice_intro_text, invoice_closing_text,
   nachtrag_intro_text, nachtrag_closing_text,
   sub_order_intro_text, sub_order_closing_text)
select o.id, ot.id,
  $oi$Vielen Dank für Ihre Anfrage und das entgegengebrachte Vertrauen. Gerne übermitteln wir Ihnen hiermit unsere Auftragsbestätigung mit einer Übersicht der besprochenen Leistungen und Konditionen.$oi$,
  $oc$Die angegebenen Preise gelten für die Dauer von 6 Monaten ab Ausstellungsdatum dieses Schreibens.
Die Abrechnung erfolgt nach tatsächlichem Aufwand und gemäß den jeweils gültigen Bestimmungen der ÖNORM.

Zahlungsfristen:
Zahlung innerhalb von {{kondition.skonto_tage}} Tagen mit {{kondition.skonto_prozent}} % Skonto oder innerhalb von {{kondition.zahlungsziel}} Tagen ohne Abzug, jeweils ab Rechnungsdatum.

Sollte die Zahlung nicht innerhalb der genannten Fristen erfolgen, behalten wir uns vor, die Arbeiten bis zur Begleichung offener Beträge zu unterbrechen. Etwaige Verzögerungen der Bauzeit infolgedessen sind möglich.

Hinweise zur Bauausführung:
Bei Wänden mit einer Stärke unter 25 cm kann es im Zuge von Stemmarbeiten zu Beschädigungen auf der gegenüberliegenden Wandseite kommen. Ebenso kann es bei angrenzenden Wohneinheiten aufgrund der Arbeiten zu feinen Rissen in Wänden oder Decken kommen. Wir übernehmen hierfür keine Haftung, sofern diese Schäden technisch nicht vermeidbar waren.

Verzugszinsen:
Bei Zahlungsverzug gelten die gesetzlichen Verzugszinsen gemäß den aktuellen Regelungen.

Stornobedingungen:
Bei Stornierung bis 8 Wochen vor Baubeginn: 10 % der Netto-Auftragssumme
Bei Stornierung 4 bis 6 Wochen vor Baubeginn: 20 % der Netto-Auftragssumme
Bei Stornierung 0 bis 4 Wochen vor Baubeginn: 30 % der Netto-Auftragssumme

Ich, ........................................................, beauftrage hiermit {{firma.name}} mit der Durchführung der oben beschriebenen Leistungen zu den genannten Konditionen und Preisen.$oc$,
  $ii$Für folgende Leistungen erlauben wir uns, eine Rechnung zu stellen.$ii$,
  $ic$Wir danken für Ihren Auftrag und ersuchen um Überweisung des aushaftenden Rechnungsbetrages auf unser Konto.

IBAN: {{firma.iban}}
BIC: {{firma.bic}}

Gerichtsstand: Wien.$ic$,
  $ni$Im Rahmen der laufenden Arbeiten wurden zusätzliche Leistungen erforderlich, die nicht Bestandteil des ursprünglich beauftragten Leistungsumfangs sind. Mit diesem Schreiben bestätigen wir, dass es sich hierbei um Nachtragsleistungen handelt.

Die entsprechenden Positionen sind in der folgenden Aufstellung ersichtlich und dienen Ihrer Information und Dokumentation.$ni$,
  $nc$Wir hoffen, dass diese Zusammenstellung zur Transparenz des Bauablaufs beiträgt, und bedanken uns für die vertrauensvolle Zusammenarbeit.

Für Rückfragen oder ergänzende Informationen stehen wir Ihnen jederzeit gerne zur Verfügung.$nc$,
  $si$Hiermit beauftragen wir Sie mit der Ausführung der nachfolgend beschriebenen Leistungen im Rahmen des oben genannten Bauvorhabens. Den Pauschalpreis für die gesamte Leistung netto finden Sie nach den Positionen.

Sie verpflichten sich, sämtliche Arbeiten fachgerecht, termingetreu und unter Verwendung hochwertiger Materialien auszuführen. Jegliche Änderungen dieses Auftrags, insbesondere nachträgliche Bauänderungen oder Mehrkosten, bedürfen der schriftlichen Zustimmung des Auftraggebers.

Vor Beginn und nach Abschluss der Arbeiten sind aussagekräftige Fotos zur Dokumentation anzufertigen; diese sind der Schlussrechnung beizulegen. Für Ausführung und Qualität gelten die einschlägigen ÖNORMEN in der zum Zeitpunkt der Auftragserteilung gültigen Fassung.$si$,
  $sc$Rechnungsadresse:
{{firma.name}}
{{firma.adresse}}
UID-Nr.: {{firma.uid}}
Rechnung gemäß § 19 Abs. 1 und 2 UStG – ohne Umsatzsteuer
Gerichtsstand: Handelsgericht Wien.

Zahlungsbedingungen: 21 Tage ab Rechnungseingang 3 % Skonto, 28 Tage netto ohne Abzug.

Hinweis: Die ausführlichen Subunternehmer-Vertragsbedingungen sind rechtlich zu prüfen und in den Einstellungen (Dokumentvarianten) zu hinterlegen.$sc$
from public.organizations o
cross join public.offer_types ot
where ot.slug = 'standard'
on conflict (organization_id, offer_type_id) do update set
  order_intro_text = excluded.order_intro_text,
  order_closing_text = excluded.order_closing_text,
  invoice_intro_text = excluded.invoice_intro_text,
  invoice_closing_text = excluded.invoice_closing_text,
  nachtrag_intro_text = excluded.nachtrag_intro_text,
  nachtrag_closing_text = excluded.nachtrag_closing_text,
  sub_order_intro_text = excluded.sub_order_intro_text,
  sub_order_closing_text = excluded.sub_order_closing_text,
  updated_at = now();

-- Variante PAUSCHAL
insert into public.document_type_transitions
  (organization_id, offer_type_id,
   order_intro_text, order_closing_text,
   invoice_intro_text, invoice_closing_text,
   nachtrag_intro_text, nachtrag_closing_text,
   sub_order_intro_text, sub_order_closing_text)
select o.id, ot.id,
  $oi$Vielen Dank für Ihre Anfrage und das entgegengebrachte Vertrauen. Gerne übermitteln wir Ihnen hiermit unsere Auftragsbestätigung mit einer Übersicht der besprochenen Leistungen und Konditionen.$oi$,
  $oc$Die angegebenen Preise gelten für die Dauer von 6 Monaten ab Ausstellungsdatum dieses Schreibens.
Die Abrechnung erfolgt pauschal.

Zahlungsfristen:
Zahlung innerhalb von {{kondition.skonto_tage}} Tagen mit {{kondition.skonto_prozent}} % Skonto oder innerhalb von {{kondition.zahlungsziel}} Tagen ohne Abzug, jeweils ab Rechnungsdatum.

Sollte die Zahlung nicht innerhalb der genannten Fristen erfolgen, behalten wir uns vor, die Arbeiten bis zur Begleichung offener Beträge zu unterbrechen. Etwaige Verzögerungen der Bauzeit infolgedessen sind möglich.

Hinweise zur Bauausführung:
Bei Wänden mit einer Stärke unter 25 cm kann es im Zuge von Stemmarbeiten zu Beschädigungen auf der gegenüberliegenden Wandseite kommen. Ebenso kann es bei angrenzenden Wohneinheiten aufgrund der Arbeiten zu feinen Rissen in Wänden oder Decken kommen. Wir übernehmen hierfür keine Haftung, sofern diese Schäden technisch nicht vermeidbar waren.

Verzugszinsen:
Bei Zahlungsverzug gelten die gesetzlichen Verzugszinsen gemäß den aktuellen Regelungen.$oc$,
  $ii$Für folgende Leistungen erlauben wir uns, eine Rechnung zu stellen.$ii$,
  $ic$Wir danken für Ihren Auftrag und ersuchen um Überweisung des aushaftenden Rechnungsbetrages auf unser Konto.

IBAN: {{firma.iban}}
BIC: {{firma.bic}}

Gerichtsstand: Wien.$ic$,
  $ni$Im Rahmen der laufenden Arbeiten wurden zusätzliche beziehungsweise geänderte Leistungen erforderlich, die nicht Bestandteil des ursprünglich beauftragten Leistungsumfangs sind. Für diese Leistungen dürfen wir Ihnen hiermit unser Pauschal-Nachtragsangebot übermitteln.

Der angeführte Pauschalpreis bezieht sich ausschließlich auf die in der folgenden Aufstellung beschriebenen Nachtragsleistungen.$ni$,
  $nc$Der Pauschalpreis gilt ausschließlich für den beschriebenen Leistungsumfang dieses Nachtragsangebotes.

Weitere Zusatzleistungen, geänderte Ausführungen, zusätzliche Kundenwünsche, behördliche Vorschreibungen oder vorab nicht erkennbare Mängel sind nicht Bestandteil dieses Pauschalpreises und werden bei Bedarf gesondert angeboten oder nach tatsächlichem Aufwand verrechnet.

Wir hoffen, dass diese Zusammenstellung zur Transparenz des Bauablaufs beiträgt, und bedanken uns für die vertrauensvolle Zusammenarbeit.$nc$,
  $si$Hiermit beauftragen wir Sie mit der Ausführung der nachfolgend beschriebenen Leistungen im Rahmen des oben genannten Bauvorhabens auf Pauschalbasis. Der Pauschalpreis für die gesamte Leistung netto ist nach den Positionen angeführt.

Der vereinbarte Pauschalpreis umfasst sämtliche zur vollständigen, fachgerechten und termingerechten Ausführung der beschriebenen Leistungen erforderlichen Arbeiten, Materialien, Nebenleistungen, Werkzeuge, Geräte, Transporte und Entsorgungen, sofern nicht ausdrücklich schriftlich anders vereinbart.$si$,
  $sc$Der Auftragnehmer bestätigt, den Leistungsumfang geprüft zu haben und die beschriebenen Leistungen zum vereinbarten Pauschalpreis vollständig, fachgerecht und mangelfrei auszuführen. Zusätzliche oder geänderte Leistungen sind nur dann vergütungsfähig, wenn diese vor Ausführung schriftlich durch den Auftraggeber freigegeben wurden.

Zahlungsbedingungen: 21 Tage ab Rechnungseingang 3 % Skonto, 28 Tage netto ohne Abzug.

Rechnungsadresse:
{{firma.name}}
{{firma.adresse}}
UID-Nr.: {{firma.uid}}
Rechnung gemäß § 19 Abs. 1 und 2 UStG – ohne Umsatzsteuer
Gerichtsstand: Handelsgericht Wien.

Hinweis: Die ausführlichen Subunternehmer-Vertragsbedingungen sind rechtlich zu prüfen und in den Einstellungen (Dokumentvarianten) zu hinterlegen.$sc$
from public.organizations o
cross join public.offer_types ot
where ot.slug = 'pauschal'
on conflict (organization_id, offer_type_id) do update set
  order_intro_text = excluded.order_intro_text,
  order_closing_text = excluded.order_closing_text,
  invoice_intro_text = excluded.invoice_intro_text,
  invoice_closing_text = excluded.invoice_closing_text,
  nachtrag_intro_text = excluded.nachtrag_intro_text,
  nachtrag_closing_text = excluded.nachtrag_closing_text,
  sub_order_intro_text = excluded.sub_order_intro_text,
  sub_order_closing_text = excluded.sub_order_closing_text,
  updated_at = now();

-- Variante REGIE
insert into public.document_type_transitions
  (organization_id, offer_type_id,
   order_intro_text, order_closing_text,
   invoice_intro_text, invoice_closing_text,
   nachtrag_intro_text, nachtrag_closing_text,
   sub_order_intro_text, sub_order_closing_text)
select o.id, ot.id,
  $oi$Wir danken Ihnen für den erteilten Auftrag und bestätigen hiermit die Durchführung der vereinbarten Arbeiten im Rahmen des Projekts auf Regiebasis.

Die Preise entnehmen Sie der folgenden Aufstellung. Die Leistungen werden nach tatsächlichem Arbeits- und Materialeinsatz abgerechnet.$oi$,
  $oc$Die Arbeiten erfolgen entsprechend den aktuellen fachlichen Standards und unter Berücksichtigung der geltenden gesetzlichen und technischen Vorschriften.

Die Abrechnung erfolgt auf Grundlage der Stundenaufzeichnungen.

Wir freuen uns auf die weitere Zusammenarbeit und stehen Ihnen für Rückfragen jederzeit gerne zur Verfügung.$oc$,
  $ii$Für folgende Leistungen erlauben wir uns, eine Rechnung zu stellen.$ii$,
  $ic$Wir danken für Ihren Auftrag und ersuchen um Überweisung des aushaftenden Rechnungsbetrages auf unser Konto.

IBAN: {{firma.iban}}
BIC: {{firma.bic}}

Gerichtsstand: Wien.$ic$,
  $ni$Im Rahmen der laufenden Arbeiten wurden zusätzliche beziehungsweise geänderte Leistungen erforderlich, die nicht Bestandteil des ursprünglich beauftragten Leistungsumfangs sind. Da der genaue Umfang dieser Nachtragsleistungen derzeit nicht vollständig vorab kalkulierbar ist, übermitteln wir Ihnen hiermit unser Regie-Nachtragsangebot.

Die Abrechnung erfolgt nach tatsächlichem Aufwand auf Grundlage der angeführten Regiesätze, Materialkosten, Geräte, Fahrtzeiten, Entsorgungen und allfälligen Fremdleistungen.$ni$,
  $nc$Die tatsächlich erbrachten Leistungen werden entsprechend dokumentiert und auf Grundlage der Stundenaufzeichnungen, Materialnachweise und sonstigen Leistungsnachweise abgerechnet.

Die Abrechnung erfolgt nach tatsächlichem Aufwand und gemäß den jeweils gültigen Bestimmungen der ÖNORM.

Wir hoffen, dass diese Zusammenstellung zur Transparenz des Bauablaufs beiträgt, und bedanken uns für die vertrauensvolle Zusammenarbeit.$nc$,
  $si$Hiermit beauftragen wir Sie, im Rahmen des Projekts die nachstehend beschriebenen Leistungen auf Regiebasis auszuführen.

Die geleisteten Regiestunden sind wöchentlich bis spätestens Dienstag der Bauleitung zu melden und schriftlich zu übermitteln. Nach Abschluss der Regieleistungen ist eine aussagekräftige Fotodokumentation aller betroffenen Bereiche der Rechnung beizulegen.$si$,
  $sc$Zahlungsbedingungen: 21 Tage ab Rechnungseingang 3 % Skonto, 28 Tage netto ohne Abzug. Rechnungen sind spätestens 14 Tage nach Abschluss der Regieleistung zu legen; der genaue Leistungszeitraum ist tagesgenau zu vermerken.

Rechnungsadresse:
{{firma.name}}
{{firma.adresse}}
UID-Nr.: {{firma.uid}}
Rechnung gemäß § 19 Abs. 1 und 2 UStG – ohne Umsatzsteuer
Gerichtsstand: Handelsgericht Wien.

Hinweis: Die ausführlichen Subunternehmer-Vertragsbedingungen sind rechtlich zu prüfen und in den Einstellungen (Dokumentvarianten) zu hinterlegen.$sc$
from public.organizations o
cross join public.offer_types ot
where ot.slug = 'regie'
on conflict (organization_id, offer_type_id) do update set
  order_intro_text = excluded.order_intro_text,
  order_closing_text = excluded.order_closing_text,
  invoice_intro_text = excluded.invoice_intro_text,
  invoice_closing_text = excluded.invoice_closing_text,
  nachtrag_intro_text = excluded.nachtrag_intro_text,
  nachtrag_closing_text = excluded.nachtrag_closing_text,
  sub_order_intro_text = excluded.sub_order_intro_text,
  sub_order_closing_text = excluded.sub_order_closing_text,
  updated_at = now();
