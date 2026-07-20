import { describe, expect, it } from 'vitest'
import { formatDurationMinutes } from './duration'

describe('formatDurationMinutes', () => {
  it('never exposes floating-point hours', () => {
    expect(formatDurationMinutes(644)).toBe('10小时44分')
    expect(formatDurationMinutes(600)).toBe('10 小时')
    expect(formatDurationMinutes(25)).toBe('25 分钟')
    expect(formatDurationMinutes(0)).toBe('0 小时')
  })
})
