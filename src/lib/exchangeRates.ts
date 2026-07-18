import { db } from './db'
import { convertMinor, findRate } from './ledger'
import type { CurrencyCode, ExchangeRate } from './ledgerTypes'

const FRANKFURTER_ENDPOINT = 'https://api.frankfurter.dev/v2/rates'

type FrankfurterRate = {
  date: string
  base: string
  quote: string
  rate: number
}

function rateId(base: CurrencyCode, quote: CurrencyCode, date: string, source: string) {
  return `${base}:${quote}:${date}:${source}`
}

export async function refreshExchangeRate(input: {
  baseCurrency: CurrencyCode
  quoteCurrency: CurrencyCode
  date?: string
  signal?: AbortSignal
}): Promise<ExchangeRate> {
  if (input.baseCurrency === input.quoteCurrency) {
    const date = input.date ?? new Date().toISOString().slice(0, 10)
    return {
      id: rateId(input.baseCurrency, input.quoteCurrency, date, 'same-currency'),
      baseCurrency: input.baseCurrency,
      quoteCurrency: input.quoteCurrency,
      rate: 1,
      rateDate: date,
      fetchedAt: new Date().toISOString(),
      source: 'transaction_snapshot',
      providerLabel: '同币种',
      isManual: false,
    }
  }
  const params = new URLSearchParams({
    base: input.baseCurrency,
    quotes: input.quoteCurrency,
    providers: 'ECB',
  })
  if (input.date) params.set('date', input.date)
  const response = await fetch(`${FRANKFURTER_ENDPOINT}?${params}`, {
    headers: { Accept: 'application/json' },
    signal: input.signal,
  })
  if (!response.ok) throw new Error(`汇率服务暂时不可用（${response.status}）`)
  const payload = (await response.json()) as FrankfurterRate[]
  const match = payload.find(
    (item) => item.base === input.baseCurrency && item.quote === input.quoteCurrency,
  )
  if (!match || !Number.isFinite(match.rate) || match.rate <= 0) {
    throw new Error('汇率服务没有返回所需币种')
  }
  const row: ExchangeRate = {
    id: rateId(match.base, match.quote, match.date, 'frankfurter-ecb'),
    baseCurrency: match.base,
    quoteCurrency: match.quote,
    rate: match.rate,
    rateDate: match.date,
    fetchedAt: new Date().toISOString(),
    source: 'frankfurter',
    providerLabel: 'Frankfurter · ECB 参考汇率',
    isManual: false,
  }
  await db.exchangeRates.put(row)
  return row
}

export async function saveManualExchangeRate(input: {
  baseCurrency: CurrencyCode
  quoteCurrency: CurrencyCode
  rate: number
  rateDate: string
}): Promise<ExchangeRate> {
  if (!Number.isFinite(input.rate) || input.rate <= 0) throw new Error('请输入有效汇率')
  const row: ExchangeRate = {
    id: rateId(input.baseCurrency, input.quoteCurrency, input.rateDate, 'manual'),
    baseCurrency: input.baseCurrency,
    quoteCurrency: input.quoteCurrency,
    rate: input.rate,
    rateDate: input.rateDate,
    fetchedAt: new Date().toISOString(),
    source: 'manual',
    providerLabel: '手动汇率',
    isManual: true,
  }
  await db.exchangeRates.put(row)
  return row
}

export async function cachedRate(
  baseCurrency: CurrencyCode,
  quoteCurrency: CurrencyCode,
  onOrBeforeDate?: string,
): Promise<ExchangeRate | undefined> {
  const rates = await db.exchangeRates
    .where('baseCurrency')
    .equals(baseCurrency)
    .toArray()
  const candidates = rates
    .filter(
      (rate) =>
        rate.quoteCurrency === quoteCurrency &&
        (!onOrBeforeDate || rate.rateDate <= onOrBeforeDate),
    )
    .sort((a, b) => {
      if (a.rateDate !== b.rateDate) return b.rateDate.localeCompare(a.rateDate)
      return Number(b.isManual) - Number(a.isManual)
    })
  if (candidates[0]) return candidates[0]
  const inverse = await db.exchangeRates
    .where('baseCurrency')
    .equals(quoteCurrency)
    .toArray()
  const found = inverse
    .filter(
      (rate) =>
        rate.quoteCurrency === baseCurrency &&
        (!onOrBeforeDate || rate.rateDate <= onOrBeforeDate),
    )
    .sort((a, b) => b.rateDate.localeCompare(a.rateDate))[0]
  if (!found) return undefined
  return { ...found, rate: 1 / found.rate }
}

export async function convertWithCachedRate(input: {
  amountMinor: number
  baseCurrency: CurrencyCode
  quoteCurrency: CurrencyCode
  date?: string
}) {
  const rate = await cachedRate(
    input.baseCurrency,
    input.quoteCurrency,
    input.date,
  )
  if (!rate) return undefined
  return {
    amountMinor: convertMinor(
      input.amountMinor,
      input.baseCurrency,
      input.quoteCurrency,
      rate.rate,
    ),
    rate,
  }
}

export async function latestRates() {
  const rates = await db.exchangeRates.toArray()
  const pairs = new Map<string, ExchangeRate>()
  for (const rate of rates) {
    const key = `${rate.baseCurrency}:${rate.quoteCurrency}`
    const existing = pairs.get(key)
    if (!existing || rate.rateDate > existing.rateDate || rate.isManual) pairs.set(key, rate)
  }
  return [...pairs.values()]
}

export function rateForPair(
  rates: ExchangeRate[],
  baseCurrency: CurrencyCode,
  quoteCurrency: CurrencyCode,
) {
  return findRate(rates, baseCurrency, quoteCurrency)
}
