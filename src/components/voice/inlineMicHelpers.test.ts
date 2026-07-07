// ────────────────────────────────────────────────────────────────────────────
//  inlineMicHelpers – Vitest (pure, node env)
//
//  Wir können `InlineMicButton.tsx` selbst nicht via @testing-library/react
//  rendern (devDependencies haben weder jsdom noch RTL — siehe
//  `vitest.config.ts` → environment: 'node'). Stattdessen prüfen wir hier
//  alle State-Übergänge, TestMode-Detection, Size-Maps und Klassen-Komposition.
//
//  Insgesamt ≥ 5 Tests (Modul-Auftrag), gegliedert nach Helper. Wenn später
//  RTL hinzukommt, sollten zusätzlich `renderHook` / `render`-Tests die hier
//  abgedeckte Logik im echten DOM verifizieren.
// ────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest'
import {
  INLINE_MIC_DEFAULT_SIZE,
  INLINE_MIC_ICON_PX,
  INLINE_MIC_MAX_RECORDING_MS,
  INLINE_MIC_SIZE_PX,
  inlineMicAccessibleLabel,
  inlineMicButtonClasses,
  inlineMicIconPx,
  inlineMicSizePx,
  isInlineMicTestMode,
  nextInlineMicAction,
} from './inlineMicHelpers'

// ──── 1. Konstanten ─────────────────────────────────────────────────────────

describe('inlineMicHelpers – Konstanten', () => {
  it('hat Default-Size "md" mit 40 px (40 × 40 px-Anforderung)', () => {
    expect(INLINE_MIC_DEFAULT_SIZE).toBe('md')
    expect(INLINE_MIC_SIZE_PX.md).toBe(40)
  })

  it('liefert konsistente Pixel-Maße sm=32 / md=40 / lg=48', () => {
    expect(INLINE_MIC_SIZE_PX.sm).toBe(32)
    expect(INLINE_MIC_SIZE_PX.md).toBe(40)
    expect(INLINE_MIC_SIZE_PX.lg).toBe(48)
  })

  it('liefert Icon-Pixel-Maße, die kleiner als der Button sind (für padding)', () => {
    for (const size of ['sm', 'md', 'lg'] as const) {
      expect(INLINE_MIC_ICON_PX[size]).toBeLessThan(INLINE_MIC_SIZE_PX[size])
    }
  })

  it('Safety-Net-Timer beträgt exakt 30 s (Spec-Anforderung)', () => {
    expect(INLINE_MIC_MAX_RECORDING_MS).toBe(30_000)
  })
})

// ──── 2. Size-Helpers ───────────────────────────────────────────────────────

describe('inlineMicHelpers – Size-Helpers', () => {
  it('inlineMicSizePx() ohne Argument liefert Default (40)', () => {
    expect(inlineMicSizePx()).toBe(40)
  })

  it('inlineMicSizePx() mappt alle Größen korrekt', () => {
    expect(inlineMicSizePx('sm')).toBe(32)
    expect(inlineMicSizePx('md')).toBe(40)
    expect(inlineMicSizePx('lg')).toBe(48)
  })

  it('inlineMicIconPx() ohne Argument liefert md-Icon (16)', () => {
    expect(inlineMicIconPx()).toBe(INLINE_MIC_ICON_PX.md)
  })

  it('inlineMicIconPx() variiert mit der Button-Size', () => {
    expect(inlineMicIconPx('sm')).toBe(INLINE_MIC_ICON_PX.sm)
    expect(inlineMicIconPx('lg')).toBe(INLINE_MIC_ICON_PX.lg)
  })
})

// ──── 3. TestMode-Detection ────────────────────────────────────────────────

describe('inlineMicHelpers – isInlineMicTestMode', () => {
  it('liefert false ohne Window-Objekt (SSR-/Node-Safe)', () => {
    expect(isInlineMicTestMode(undefined)).toBe(false)
  })

  it('liefert true bei ?testmode=1', () => {
    const fakeWin = { location: { search: '?testmode=1' } } as Pick<
      Window,
      'location'
    >
    expect(isInlineMicTestMode(fakeWin)).toBe(true)
  })

  it('liefert false bei ?testmode=0', () => {
    const fakeWin = { location: { search: '?testmode=0' } } as Pick<
      Window,
      'location'
    >
    expect(isInlineMicTestMode(fakeWin)).toBe(false)
  })

  it('ignoriert andere Query-Params', () => {
    const fakeWin = { location: { search: '?foo=bar&baz=1' } } as Pick<
      Window,
      'location'
    >
    expect(isInlineMicTestMode(fakeWin)).toBe(false)
  })

  it('liefert false bei leerem search-String', () => {
    const fakeWin = { location: { search: '' } } as Pick<Window, 'location'>
    expect(isInlineMicTestMode(fakeWin)).toBe(false)
  })

  it('crasht nicht, wenn location.search wirft', () => {
    const fakeWin = {
      get location() {
        throw new Error('hostile environment')
      },
    } as unknown as Pick<Window, 'location'>
    expect(() => isInlineMicTestMode(fakeWin)).not.toThrow()
    expect(isInlineMicTestMode(fakeWin)).toBe(false)
  })
})

// ──── 4. State-Machine ─────────────────────────────────────────────────────

describe('inlineMicHelpers – nextInlineMicAction', () => {
  it('idle + click → start_recording', () => {
    expect(nextInlineMicAction('idle')).toBe('start_recording')
  })

  it('recording + click → stop_recording', () => {
    expect(nextInlineMicAction('recording')).toBe('stop_recording')
  })

  it('transcribing + click → noop (blockiert)', () => {
    expect(nextInlineMicAction('transcribing')).toBe('noop')
  })

  it('disabled überstimmt jeden State', () => {
    expect(nextInlineMicAction('idle', { disabled: true })).toBe('noop')
    expect(nextInlineMicAction('recording', { disabled: true })).toBe('noop')
    expect(nextInlineMicAction('transcribing', { disabled: true })).toBe('noop')
  })
})

// ──── 5. Klassen-Komposition ───────────────────────────────────────────────

describe('inlineMicHelpers – inlineMicButtonClasses', () => {
  it('idle-State hat keine recording-/transcribing-Klassen', () => {
    const cls = inlineMicButtonClasses('idle')
    expect(cls).toContain('bg-gray-100')
    expect(cls).not.toContain('bg-red-500')
    expect(cls).not.toContain('cursor-wait')
  })

  it('recording-State zeigt rote Pulse-Klasse', () => {
    const cls = inlineMicButtonClasses('recording')
    expect(cls).toContain('bg-red-500')
    expect(cls).toContain('animate-pulse')
  })

  it('transcribing-State zeigt cursor-wait', () => {
    const cls = inlineMicButtonClasses('transcribing')
    expect(cls).toContain('cursor-wait')
  })

  it('disabled fügt opacity- und cursor-Klassen hinzu', () => {
    const cls = inlineMicButtonClasses('idle', { disabled: true })
    expect(cls).toContain('opacity-40')
    expect(cls).toContain('cursor-not-allowed')
  })

  it('!supported behandelt sich wie disabled (opacity + cursor)', () => {
    const cls = inlineMicButtonClasses('idle', { supported: false })
    expect(cls).toContain('opacity-40')
    expect(cls).toContain('cursor-not-allowed')
  })

  it('supported=true ohne disabled → kein opacity-40', () => {
    const cls = inlineMicButtonClasses('idle', {
      supported: true,
      disabled: false,
    })
    expect(cls).not.toContain('opacity-40')
  })

  it('enthält Round-Button-Basisklassen (rounded-full, inline-flex)', () => {
    const cls = inlineMicButtonClasses('idle')
    expect(cls).toContain('rounded-full')
    expect(cls).toContain('inline-flex')
  })
})

// ──── 6. Accessible Label ──────────────────────────────────────────────────

describe('inlineMicHelpers – inlineMicAccessibleLabel', () => {
  it('liefert unterschiedliche Texte pro State', () => {
    const idle = inlineMicAccessibleLabel('idle')
    const recording = inlineMicAccessibleLabel('recording')
    const transcribing = inlineMicAccessibleLabel('transcribing')
    expect(idle).not.toBe(recording)
    expect(recording).not.toBe(transcribing)
    expect(idle).toMatch(/Spracheingabe/i)
    expect(recording).toMatch(/stoppen/i)
    expect(transcribing).toMatch(/Transkription/i)
  })
})
