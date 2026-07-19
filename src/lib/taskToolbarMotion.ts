/**
 * Continuous rotation is useful progress feedback in the default mode, but it
 * is non-essential motion. `aria-busy`, the disabled state and the result text
 * still communicate progress when reduced motion is requested.
 */
export function shouldSpinTaskSync(syncing: boolean, reduceMotion: boolean | null) {
  return syncing && !reduceMotion
}
