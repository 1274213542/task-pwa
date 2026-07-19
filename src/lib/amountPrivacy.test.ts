import { describe, expect, it } from 'vitest'
import { maskAmountText } from './amountPrivacy'

describe('金额隐私格式', () => {
  it('保留币种提示但隐藏真实数字', () => {
    expect(maskAmountText('JP¥8,492')).toBe('JP¥ ••••')
    expect(maskAmountText('CN¥1,280.50')).toBe('CN¥ ••••')
    expect(maskAmountText('−JP¥9,000')).toBe('−JP¥ ••••')
  })

  it('没有数字时仍返回统一占位', () => {
    expect(maskAmountText('—')).toBe('••••')
  })
})
