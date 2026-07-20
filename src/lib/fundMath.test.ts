import { describe, expect, it } from 'vitest'
import { calculateFundPoolStates, prorateMinor } from './fundMath'
import type {
  FundPool,
  FundPoolTransfer,
  FundReservation,
  TransactionFundAllocation,
} from './ledgerTypes'

const timestamp = '2026-07-19T00:00:00.000Z'

function pool(id: string, openingBalanceMinor: number): FundPool {
  return {
    id,
    name: id,
    purpose: id === 'free' ? 'free' : 'restricted_rent',
    currency: 'JPY',
    openingBalanceMinor,
    includeInDisposable: id === 'free',
    includeInSavings: false,
    restricted: id !== 'free',
    rank: id,
    lifecycleStatus: 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

function allocation(
  id: string,
  fundPoolId: string,
  amountMinor: number,
  effect: TransactionFundAllocation['effect'],
): TransactionFundAllocation {
  return {
    id,
    transactionId: `transaction:${id}`,
    fundPoolId,
    amountMinor,
    currency: 'JPY',
    effect,
    lifecycleStatus: 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

describe('资金池余额、锁定与调拨', () => {
  it('同一现实账户中的专项、自由资金和信用卡锁定分别计算', () => {
    const pools = [pool('rent', 300_000), pool('free', 70_000)]
    const allocations = [
      allocation('rent-payment', 'rent', 100_000, 'debit'),
      allocation('shopping', 'free', 5_000, 'debit'),
      allocation('card-purchase', 'free', 10_000, 'reserve'),
    ]
    const reservations: FundReservation[] = [{
      id: 'reservation:card-purchase:free',
      transactionId: 'transaction:card-purchase',
      creditAccountId: 'card',
      fundPoolId: 'free',
      amountMinor: 10_000,
      settledAmountMinor: 0,
      releasedAmountMinor: 0,
      currency: 'JPY',
      status: 'active',
      createdAt: timestamp,
      updatedAt: timestamp,
    }]
    const states = calculateFundPoolStates({ pools, allocations, transfers: [], reservations })

    expect(states.get('rent')).toMatchObject({ grossMinor: 200_000, reservedMinor: 0, availableMinor: 200_000, usedMinor: 100_000 })
    expect(states.get('free')).toMatchObject({ grossMinor: 65_000, reservedMinor: 10_000, availableMinor: 55_000, usedMinor: 5_000 })
  })

  it('资金池调拨只改变用途分配，不改变所有资金池合计', () => {
    const pools = [pool('rent', 100_000), pool('free', 50_000)]
    const transfers: FundPoolTransfer[] = [{
      id: 'transfer',
      sourcePoolId: 'rent',
      destinationPoolId: 'free',
      amountMinor: 20_000,
      currency: 'JPY',
      localDate: '2026-07-19',
      lifecycleStatus: 'active',
      createdAt: timestamp,
      updatedAt: timestamp,
    }]
    const states = calculateFundPoolStates({ pools, allocations: [], transfers, reservations: [] })
    expect(states.get('rent')?.grossMinor).toBe(80_000)
    expect(states.get('free')?.grossMinor).toBe(70_000)
    expect([...states.values()].reduce((sum, state) => sum + state.grossMinor, 0)).toBe(150_000)
  })

  it('部分退款按原分摊比例精确回滚，余数不会丢失', () => {
    expect(prorateMinor(
      [{ id: 'rent', amountMinor: 80_000 }, { id: 'free', amountMinor: 20_000 }],
      33_333,
    ).map((part) => part.amountMinor)).toEqual([26_666, 6_667])
    expect(prorateMinor(
      [{ id: 'a', amountMinor: 10_000 }, { id: 'b', amountMinor: 10_000 }, { id: 'c', amountMinor: 10_000 }],
      10_001,
    ).map((part) => part.amountMinor)).toEqual([3_334, 3_334, 3_333])
  })
})
