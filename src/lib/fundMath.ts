import type {
  CurrencyCode,
  FundPool,
  FundPoolTransfer,
  FundReservation,
  TransactionFundAllocation,
} from './ledgerTypes'

export interface FundPoolState {
  grossMinor: number
  reservedMinor: number
  availableMinor: number
  usedMinor: number
}

export function calculateFundPoolStates(input: {
  pools: FundPool[]
  allocations: TransactionFundAllocation[]
  transfers: FundPoolTransfer[]
  reservations: FundReservation[]
}): Map<string, FundPoolState> {
  const states = new Map<string, FundPoolState>()
  for (const pool of input.pools) {
    if (pool.lifecycleStatus !== 'active') continue
    states.set(pool.id, {
      grossMinor: pool.openingBalanceMinor,
      reservedMinor: 0,
      availableMinor: pool.openingBalanceMinor,
      usedMinor: 0,
    })
  }
  const addGross = (id: string | undefined, delta: number) => {
    if (!id) return
    const current = states.get(id)
    if (current) current.grossMinor += delta
  }
  for (const transfer of input.transfers) {
    if (transfer.lifecycleStatus !== 'active') continue
    addGross(transfer.sourcePoolId, -transfer.amountMinor)
    addGross(transfer.destinationPoolId, transfer.amountMinor)
  }
  for (const allocation of input.allocations) {
    if (allocation.lifecycleStatus !== 'active') continue
    if (allocation.effect === 'debit') {
      addGross(allocation.fundPoolId, -allocation.amountMinor)
      const current = states.get(allocation.fundPoolId)
      if (current) current.usedMinor += allocation.amountMinor
    }
    if (allocation.effect === 'credit') {
      addGross(allocation.fundPoolId, allocation.amountMinor)
      const current = states.get(allocation.fundPoolId)
      if (current) current.usedMinor = Math.max(0, current.usedMinor - allocation.amountMinor)
    }
  }
  for (const reservation of input.reservations) {
    if (reservation.status === 'voided') continue
    const current = states.get(reservation.fundPoolId)
    if (!current) continue
    current.reservedMinor += Math.max(
      0,
      reservation.amountMinor - reservation.settledAmountMinor - reservation.releasedAmountMinor,
    )
  }
  for (const state of states.values()) {
    state.availableMinor = state.grossMinor - state.reservedMinor
  }
  return states
}

/** Largest-remainder allocation keeps every partial refund/payment exact. */
export function prorateMinor<T extends { amountMinor: number }>(
  rows: T[],
  targetMinor: number,
): Array<{ row: T; amountMinor: number }> {
  if (targetMinor <= 0 || rows.length === 0) return []
  const total = rows.reduce((sum, row) => sum + Math.max(0, row.amountMinor), 0)
  if (total <= 0) return []
  const target = Math.min(targetMinor, total)
  const portions = rows.map((row, index) => {
    const exact = (target * Math.max(0, row.amountMinor)) / total
    const floor = Math.floor(exact)
    return { row, amountMinor: floor, fraction: exact - floor, index }
  })
  let remaining = target - portions.reduce((sum, part) => sum + part.amountMinor, 0)
  portions
    .slice()
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index)
    .forEach((part) => {
      if (remaining <= 0) return
      part.amountMinor += 1
      remaining -= 1
    })
  return portions
    .filter((part) => part.amountMinor > 0)
    .map(({ row, amountMinor }) => ({ row, amountMinor }))
}

export function sumByCurrency<T>(
  rows: T[],
  currencyOf: (row: T) => CurrencyCode,
  amountOf: (row: T) => number,
): Map<CurrencyCode, number> {
  const result = new Map<CurrencyCode, number>()
  for (const row of rows) {
    const currency = currencyOf(row)
    result.set(currency, (result.get(currency) ?? 0) + amountOf(row))
  }
  return result
}
