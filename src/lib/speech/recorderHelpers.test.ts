// ────────────────────────────────────────────────────────────────────────────
//  recorderHelpers – Tests (Vitest)
//
//  Da das Vitest-Environment für dieses Projekt `node` ist (kein jsdom,
//  keine React-Testing-Library), testen wir hier die _reine_ Logik, die der
//  Hook `useAudioRecorder` orchestriert. Die fünf Pflicht-Szenarien aus dem
//  Modul-Auftrag bilden den Kern; dazu Extra-Coverage für die MIME-Sniffing-
//  und Permission-Mapping-Helfer.
// ────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest'
import {
  describeRecorderError,
  detectAutoSendTrigger,
  getSpeechRecognitionCtor,
  isSpeechRecognitionSupported,
  pickSupportedMimeType,
} from './recorderHelpers'
import type {
  MediaRecorderCtor,
  SREvent,
  SRResultItem,
  SpeechRecognitionCtor,
} from './types'

// ──── Helpers für Mocks ────────────────────────────────────────────────────

function makeMrCtor(supported: string[]): Pick<MediaRecorderCtor, 'isTypeSupported'> {
  return {
    isTypeSupported: (mime: string) => supported.includes(mime),
  }
}

function makeSrEvent(
  results: Array<{ transcript: string; isFinal: boolean }>,
  resultIndex = 0,
): SREvent {
  const list = results.map<SRResultItem>((r) => ({
    isFinal: r.isFinal,
    length: 1,
    0: { transcript: r.transcript },
  }))
  return {
    resultIndex,
    results: Object.assign(list, { length: list.length }) as unknown as SREvent['results'],
  }
}

// ──── pickSupportedMimeType ────────────────────────────────────────────────

describe('pickSupportedMimeType', () => {
  it('bevorzugt webm/opus, wenn unterstützt', () => {
    const mr = makeMrCtor(['audio/webm;codecs=opus', 'audio/mp4', 'audio/wav'])
    expect(pickSupportedMimeType(mr)).toBe('audio/webm;codecs=opus')
  })

  it('fällt auf audio/mp4 zurück (iOS-Safari-Fall)', () => {
    const mr = makeMrCtor(['audio/mp4', 'audio/wav'])
    expect(pickSupportedMimeType(mr)).toBe('audio/mp4')
  })

  it('fällt auf audio/wav zurück, wenn weder opus noch mp4', () => {
    const mr = makeMrCtor(['audio/wav'])
    expect(pickSupportedMimeType(mr)).toBe('audio/wav')
  })

  it('liefert audio/webm-Default, wenn nichts unterstützt wird', () => {
    const mr = makeMrCtor([])
    expect(pickSupportedMimeType(mr)).toBe('audio/webm')
  })

  it('verträgt fehlenden Ctor (kein MediaRecorder im Window)', () => {
    expect(pickSupportedMimeType(undefined)).toBe('audio/webm')
  })

  it('verträgt Ctor ohne isTypeSupported-Funktion', () => {
    expect(
      pickSupportedMimeType({} as Pick<MediaRecorderCtor, 'isTypeSupported'>),
    ).toBe('audio/webm')
  })

  it('verträgt isTypeSupported, das wirft', () => {
    const mr: Pick<MediaRecorderCtor, 'isTypeSupported'> = {
      isTypeSupported: () => {
        throw new Error('boom')
      },
    }
    expect(pickSupportedMimeType(mr)).toBe('audio/webm')
  })
})

// ──── SpeechRecognition-Verfügbarkeit ──────────────────────────────────────

describe('getSpeechRecognitionCtor / isSpeechRecognitionSupported', () => {
  it('liefert null, wenn weder SpeechRecognition noch webkitSpeechRecognition vorhanden', () => {
    expect(getSpeechRecognitionCtor({})).toBeNull()
    expect(isSpeechRecognitionSupported({})).toBe(false)
  })

  it('liefert null bei null/undefined Window', () => {
    expect(getSpeechRecognitionCtor(null)).toBeNull()
    expect(getSpeechRecognitionCtor(undefined)).toBeNull()
  })

  it('bevorzugt SpeechRecognition vor webkitSpeechRecognition', () => {
    const standard = function () {} as unknown as SpeechRecognitionCtor
    const webkit = function () {} as unknown as SpeechRecognitionCtor
    const win = { SpeechRecognition: standard, webkitSpeechRecognition: webkit }
    expect(getSpeechRecognitionCtor(win)).toBe(standard)
    expect(isSpeechRecognitionSupported(win)).toBe(true)
  })

  it('fällt auf webkitSpeechRecognition zurück (Safari)', () => {
    const webkit = function () {} as unknown as SpeechRecognitionCtor
    expect(getSpeechRecognitionCtor({ webkitSpeechRecognition: webkit })).toBe(
      webkit,
    )
  })
})

// ──── detectAutoSendTrigger ────────────────────────────────────────────────

describe('detectAutoSendTrigger', () => {
  it('triggert, wenn ein finales Result mit "senden" endet', () => {
    const ev = makeSrEvent([{ transcript: 'Bitte das Angebot senden', isFinal: true }])
    const res = detectAutoSendTrigger(ev, 'senden')
    expect(res.triggered).toBe(true)
    expect(res.final).toBe('Bitte das Angebot senden')
  })

  it('triggert NICHT bei einem interim-Result, auch wenn das Wort fällt', () => {
    const ev = makeSrEvent([
      { transcript: 'Bitte senden', isFinal: false },
    ])
    const res = detectAutoSendTrigger(ev, 'senden')
    expect(res.triggered).toBe(false)
    expect(res.interim).toBe('Bitte senden')
  })

  it('triggert NICHT, wenn das Trigger-Wort mitten im Satz steht', () => {
    const ev = makeSrEvent([
      { transcript: 'senden Sie mir eine Antwort', isFinal: true },
    ])
    const res = detectAutoSendTrigger(ev, 'senden')
    expect(res.triggered).toBe(false)
  })

  it('ignoriert Groß-/Kleinschreibung und Whitespace', () => {
    const ev = makeSrEvent([{ transcript: 'Jetzt SENDEN.  ', isFinal: true }])
    // Punkt am Ende verhindert exakten endsWith-Match → also kein Trigger.
    // Wir prüfen separat den sauberen Fall:
    expect(detectAutoSendTrigger(ev, 'senden').triggered).toBe(false)

    const ev2 = makeSrEvent([{ transcript: '  Jetzt SENDEN  ', isFinal: true }])
    expect(detectAutoSendTrigger(ev2, 'SENDEN').triggered).toBe(true)
  })

  it('triggert nur ab resultIndex (verhindert Doppel-Trigger bei alten Results)', () => {
    const ev = makeSrEvent(
      [
        { transcript: 'Bitte senden', isFinal: true },
        { transcript: 'noch ein satz', isFinal: false },
      ],
      1, // resultIndex = 1 → der erste, finale "senden"-Eintrag wird ignoriert
    )
    const res = detectAutoSendTrigger(ev, 'senden')
    expect(res.triggered).toBe(false)
  })

  it('liefert sauber leere Strings, wenn nichts erkannt wurde', () => {
    const ev = makeSrEvent([])
    const res = detectAutoSendTrigger(ev, 'senden')
    expect(res).toEqual({ triggered: false, interim: '', final: '' })
  })

  it('akkumuliert interim + final getrennt', () => {
    const ev = makeSrEvent([
      { transcript: 'Position eins: Estrich', isFinal: true },
      { transcript: ' und Bodenbeschich', isFinal: false },
    ])
    const res = detectAutoSendTrigger(ev, 'senden')
    expect(res.final).toBe('Position eins: Estrich')
    expect(res.interim).toBe('und Bodenbeschich')
    expect(res.triggered).toBe(false)
  })

  it('triggert nicht bei leerem Trigger-Wort', () => {
    const ev = makeSrEvent([{ transcript: 'irgendwas', isFinal: true }])
    expect(detectAutoSendTrigger(ev, '').triggered).toBe(false)
    expect(detectAutoSendTrigger(ev, '   ').triggered).toBe(false)
  })
})

// ──── describeRecorderError ────────────────────────────────────────────────

describe('describeRecorderError', () => {
  it('mappt NotAllowedError → Mikrofon verweigert', () => {
    const err = Object.assign(new Error('denied'), { name: 'NotAllowedError' })
    expect(describeRecorderError(err)).toMatch(/Mikrofonzugriff verweigert/)
  })

  it('mappt PermissionDeniedError analog', () => {
    const err = { name: 'PermissionDeniedError' }
    expect(describeRecorderError(err)).toMatch(/Mikrofonzugriff verweigert/)
  })

  it('mappt NotFoundError → Kein Mikrofon gefunden', () => {
    expect(describeRecorderError({ name: 'NotFoundError' })).toMatch(
      /Kein Mikrofon gefunden/,
    )
  })

  it('mappt NotReadableError → bereits verwendet', () => {
    expect(describeRecorderError({ name: 'NotReadableError' })).toMatch(
      /bereits verwendet/,
    )
  })

  it('fällt auf Error.message zurück', () => {
    expect(describeRecorderError(new Error('Spezialfehler'))).toBe('Spezialfehler')
  })

  it('liefert generischen Default für unbekannte Werte', () => {
    expect(describeRecorderError('string')).toMatch(/konnte nicht gestartet/)
    expect(describeRecorderError(null)).toMatch(/konnte nicht gestartet/)
    expect(describeRecorderError(undefined)).toMatch(/konnte nicht gestartet/)
  })
})
