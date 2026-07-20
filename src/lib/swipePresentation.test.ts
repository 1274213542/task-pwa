import { describe, expect, it, vi } from 'vitest'
import { applySwipePresentation } from './swipePresentation'

function presentationAt(value: number, reveal = 224) {
  const values = new Map<string, string>()
  const element = {
    style: {
      setProperty: vi.fn((name: string, next: string) => values.set(name, next)),
    },
  } as unknown as HTMLElement

  applySwipePresentation(element, value, reveal)
  return values
}

describe('applySwipePresentation', () => {
  it('keeps every presentation channel closed at rest', () => {
    const values = presentationAt(0)

    expect(values.get('--swipe-progress')).toBe('0.0000')
    expect(values.get('--swipe-delete-progress')).toBe('0.0000')
    expect(values.get('--swipe-secondary-progress')).toBe('0.0000')
    expect(values.get('--swipe-leading-progress')).toBe('0.0000')
    expect(values.get('--swipe-overshoot')).toBe('0.0000')
  })

  it('reveals actions in danger, secondary, leading order', () => {
    const early = presentationAt(-56)
    const middle = presentationAt(-112)
    const late = presentationAt(-190)

    expect(Number(early.get('--swipe-delete-progress'))).toBeGreaterThan(0)
    expect(Number(early.get('--swipe-secondary-progress'))).toBe(0)
    expect(Number(middle.get('--swipe-secondary-progress'))).toBeGreaterThan(0)
    expect(Number(middle.get('--swipe-leading-progress'))).toBe(0)
    expect(Number(late.get('--swipe-leading-progress'))).toBeGreaterThan(0)
  })

  it('clamps progress while exposing bounded overshoot for the danger pill', () => {
    const values = presentationAt(-242)

    expect(values.get('--swipe-progress')).toBe('1.0000')
    expect(values.get('--swipe-overshoot')).toBe('1.0000')
  })
})
