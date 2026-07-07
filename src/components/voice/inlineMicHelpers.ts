// ────────────────────────────────────────────────────────────────────────────
//  inlineMicHelpers
//
//  Pure, framework-unabhängige Logik für `InlineMicButton`. Wir extrahieren
//  alles, was sich ohne DOM testen lässt (TestMode-Detection, Size-Mapping,
//  State-Machine-Übergänge, CSS-Klassen-Komposition), damit der React-Wrapper
//  selbst minimal bleibt — vitest läuft hier mit `environment: 'node'` und
//  ohne React-Testing-Library, deswegen können nur Pure-Helpers getestet werden.
//
//  Vorbild: `src/lib/testMode.js` aus bau4you + `InlineMicButton.jsx`-Logik.
// ────────────────────────────────────────────────────────────────────────────

/** Mögliche Button-Größen. */
export type InlineMicSize = 'sm' | 'md' | 'lg'

/** Rec-State-Machine: passt zur idle/recording/processing-Konvention von
 *  Isabella.tsx und vom bau4you-Original (idle/recording/transcribing). */
export type InlineMicState = 'idle' | 'recording' | 'transcribing'

/** Mapping Size → Pixel-Maße (Tailwind-arbitrary-value-fähig). */
export const INLINE_MIC_SIZE_PX: Record<InlineMicSize, number> = {
  sm: 32,
  md: 40,
  lg: 48,
}

/** Mapping Size → Icon-Pixelgröße innerhalb des Buttons. */
export const INLINE_MIC_ICON_PX: Record<InlineMicSize, number> = {
  sm: 14,
  md: 16,
  lg: 20,
}

/**
 * Default-Größe: 40 × 40 px (entspricht `md`) — wie im bau4you-Original.
 * Wird sowohl von der Komponente als auch in Tests referenziert, damit die
 * "40 × 40 px"-Anforderung an einer Stelle gepflegt wird.
 */
export const INLINE_MIC_DEFAULT_SIZE: InlineMicSize = 'md'

/**
 * Maximale Aufnahmedauer in Millisekunden bevor wir hart abbrechen.
 *
 * Spec: "Aufnahme stoppt automatisch nach 30s Stille oder erneutem Click".
 * Echte Voice-Activity-Detection (VAD) brauchen wir hier nicht — der Hook
 * `useAudioRecorder` läuft ohne Pausenerkennung. Wir setzen daher einen
 * Safety-Net-Timer auf 30 s Gesamt-Dauer, der den Recorder zwangsstoppt,
 * wenn der User vergisst, manuell zu beenden. Das verhindert
 * Memory-Leaks und unkontrollierte Whisper-Kosten.
 */
export const INLINE_MIC_MAX_RECORDING_MS = 30_000

/**
 * Erkennt Test-Mode aus einem Window-ähnlichen Objekt (URL-Param `?testmode=1`).
 *
 * Bewusst window-injectable für Tests — der bau4you-Original `isTestMode()`
 * greift hart auf `window.location.search` zu, was in node-Tests crasht.
 */
export function isInlineMicTestMode(
  win: Pick<Window, 'location'> | undefined = typeof window !== 'undefined'
    ? window
    : undefined,
): boolean {
  if (!win) return false
  try {
    const search = win.location?.search ?? ''
    const params = new URLSearchParams(search)
    return params.get('testmode') === '1'
  } catch {
    return false
  }
}

/**
 * Liefert die Pixel-Größe (number) für eine gegebene Size-Prop.
 * `undefined` / unbekannt → Default (`md` = 40).
 */
export function inlineMicSizePx(size?: InlineMicSize): number {
  if (!size) return INLINE_MIC_SIZE_PX[INLINE_MIC_DEFAULT_SIZE]
  return INLINE_MIC_SIZE_PX[size] ?? INLINE_MIC_SIZE_PX[INLINE_MIC_DEFAULT_SIZE]
}

/** Liefert die Icon-Größe (number) passend zur Button-Size. */
export function inlineMicIconPx(size?: InlineMicSize): number {
  if (!size) return INLINE_MIC_ICON_PX[INLINE_MIC_DEFAULT_SIZE]
  return INLINE_MIC_ICON_PX[size] ?? INLINE_MIC_ICON_PX[INLINE_MIC_DEFAULT_SIZE]
}

/**
 * State-Machine: nächster Zustand bei Click.
 *
 *   idle           + click → 'start_recording'  (Hook.start())
 *   recording      + click → 'stop_recording'   (Hook.stop())
 *   transcribing   + click → 'noop'             (Klick blockiert während STT)
 *
 * Bei `disabled` → immer 'noop'. Die Komponente verlässt sich auf diese
 * Funktion, damit die Übergänge deterministisch und unit-testbar sind.
 */
export type InlineMicClickAction =
  | 'start_recording'
  | 'stop_recording'
  | 'noop'

export function nextInlineMicAction(
  state: InlineMicState,
  opts: { disabled?: boolean } = {},
): InlineMicClickAction {
  if (opts.disabled) return 'noop'
  if (state === 'idle') return 'start_recording'
  if (state === 'recording') return 'stop_recording'
  return 'noop'
}

/**
 * Liefert die Tailwind-Klassen für den Button — round, gleiche Pixel-Größe in
 * Breite & Höhe, Hintergrund-Farben pro State.
 *
 * Wir geben die Klassen als reinen String zurück (keine `clsx`-Dependency),
 * damit der Helper komplett pur und ohne Side-Imports bleibt.
 */
export function inlineMicButtonClasses(
  state: InlineMicState,
  opts: { disabled?: boolean; supported?: boolean } = {},
): string {
  const base = [
    'inline-flex',
    'items-center',
    'justify-center',
    'rounded-full',
    'flex-shrink-0',
    'transition-colors',
  ]
  let stateCls: string
  switch (state) {
    case 'recording':
      stateCls = 'bg-red-500 text-white shadow-sm animate-pulse'
      break
    case 'transcribing':
      stateCls = 'bg-gray-200 text-gray-500 cursor-wait'
      break
    case 'idle':
    default:
      stateCls = 'bg-gray-100 text-gray-500 hover:bg-gray-200'
      break
  }
  const blocked =
    opts.disabled || opts.supported === false
      ? 'opacity-40 cursor-not-allowed'
      : ''
  return [...base, stateCls, blocked].filter(Boolean).join(' ')
}

/**
 * Hilfs-Mapping: Aria-Label & title-Tooltip pro State.
 * Wir trennen das vom Render-Code, damit die Strings i18n-tauglich an einem
 * Ort gepflegt werden und Tests die Texte gegen Regressionen sichern.
 */
export function inlineMicAccessibleLabel(state: InlineMicState): string {
  switch (state) {
    case 'recording':
      return 'Aufnahme stoppen'
    case 'transcribing':
      return 'Transkription läuft …'
    case 'idle':
    default:
      return 'Spracheingabe starten'
  }
}
