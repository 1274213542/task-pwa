import { describe, expect, it } from 'vitest'
import {
  recurringInstanceId,
  recurringTransactionId,
  scheduledDateForPeriod,
} from './recurringFinance'

describe('固定扣款周期键与短月规则', () => {
  it('同一规则和账期生成稳定唯一键', () => {
    expect(recurringInstanceId('rent', '2026-07')).toBe('recurring-instance:rent:2026-07')
    expect(recurringInstanceId('rent', '2026-07')).toBe(recurringInstanceId('rent', '2026-07'))
    expect(recurringTransactionId('rent', '2026-07')).toBe('recurring-transaction:rent:2026-07')
  })

  it('29、30、31 日在短月份落到当月最后一天', () => {
    expect(scheduledDateForPeriod('2026-02', 31)).toBe('2026-02-28')
    expect(scheduledDateForPeriod('2028-02', 31)).toBe('2028-02-29')
    expect(scheduledDateForPeriod('2026-04', 31)).toBe('2026-04-30')
  })
})
