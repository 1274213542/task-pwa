import { describe, expect, it } from 'vitest'
import { shouldSpinTaskSync } from './taskToolbarMotion'

describe('task toolbar sync motion', () => {
  it('keeps normal progress feedback but removes continuous reduced-motion rotation', () => {
    expect(shouldSpinTaskSync(true, false)).toBe(true)
    expect(shouldSpinTaskSync(true, null)).toBe(true)
    expect(shouldSpinTaskSync(true, true)).toBe(false)
    expect(shouldSpinTaskSync(false, false)).toBe(false)
  })
})
