// ────────────────────────────────────────────────────────────────────────────
//  logVoiceTranscript – Audit-Trail-Eintrag in voice_transcripts.
//
//  Extrahiert aus VoiceAngebotDialog (Phase 5), damit BEIDE KI-Dialoge den
//  identischen Audit-Pfad nutzen (DRY):
//    - VoiceAngebotDialog  (Komplettangebot per Sprache)
//    - AddPositionDialog   ("+ KI Leistung" – Einzelposition)
//
//  organization_id + created_by kommen aus den DB-Column-Defaults
//  (current_org_id() / auth.uid()) — der Insert braucht nur die Nutzdaten.
//
//  Füttert:
//    - die Cockpit-Wochenstatistik "Sprach-Angebote" (produced_offer-Zähler)
//    - den Audit-Trail für Fehleranalyse (error_message bei Fails)
//
//  Fehler beim Insert werden geschluckt — ein kaputter Audit-Pfad darf den
//  Voice-Flow nie blockieren. Der supabase-Import bleibt dynamisch, damit
//  Tests der reinen Dialog-Logik keinen Supabase-Client initialisieren.
// ────────────────────────────────────────────────────────────────────────────

export interface VoiceTranscriptEntry {
  transcript: string
  producedOffer: boolean
  errorMessage?: string
}

export async function logVoiceTranscript(
  entry: VoiceTranscriptEntry,
): Promise<void> {
  try {
    const { supabase } = await import('../supabase')
    await supabase.from('voice_transcripts').insert({
      transcript_raw: entry.transcript.slice(0, 20_000),
      transcript_corrected: null,
      transcribe_model: 'gpt-4o-transcribe',
      produced_offer: entry.producedOffer,
      error_message: entry.errorMessage ? entry.errorMessage.slice(0, 1000) : null,
    })
  } catch {
    /* best-effort — Audit darf den Flow nie stoppen */
  }
}
