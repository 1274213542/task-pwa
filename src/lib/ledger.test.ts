import { describe, expect, it } from 'vitest'
import {
  accountCurrencies,
  accountSupportsCurrency,
  calculateAccountBalances,
  calculateAccountBalancesByCurrency,
  convertMinor,
  ledgerSummary,
  toMinor,
} from './ledger'
import type { Account, ExchangeRate, FinanceTransaction } from './ledgerTypes'

const timestamp = '2026-07-19T12:00:00.000Z'

function account(
  id: string,
  kind: Account['kind'],
  subtype: Account['subtype'],
  openingBalanceMinor: number,
  currency: Account['currency'] = 'JPY',
): Account {
  return {
    id,
    name: id,
    kind,
    subtype,
    currency,
    openingBalanceMinor,
    includeInNetWorth: kind !== 'external',
    includeInSpending: true,
    rank: id,
    lifecycleStatus: 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

function transaction(
  id: string,
  type: FinanceTransaction['type'],
  amountMinor: number,
  accountId: string,
  extra: Partial<FinanceTransaction> = {},
): FinanceTransaction {
  return {
    id,
    type,
    amountMinor,
    currency: 'JPY',
    occurredAt: timestamp,
    localDate: '2026-07-19',
    accountId,
    includeInSpending: !['transfer', 'topup', 'credit_payment', 'income'].includes(type),
    affectsNetWorth: type !== 'external_payment',
    lifecycleStatus: 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
    ...extra,
  }
}

describe('账户余额与消费口径', () => {
  it('银行、本人信用卡、外部代付和 Suica 使用不同规则', () => {
    const accounts = [
      account('bank', 'asset', 'bank', 100_000),
      account('card', 'credit', 'credit_card', 0),
      account('father-card', 'external', 'external_payer', 0),
      account('suica', 'asset', 'stored_value', 1_000),
    ]
    const transactions = [
      transaction('bank-expense', 'expense', 1_000, 'bank'),
      transaction('card-spend', 'credit_purchase', 2_000, 'card'),
      transaction('external', 'external_payment', 3_000, 'father-card', {
        affectsNetWorth: false,
      }),
      transaction('topup', 'topup', 1_000, 'bank', {
        counterpartyAccountId: 'suica',
        counterpartyAmountMinor: 1_000,
        counterpartyCurrency: 'JPY',
        includeInSpending: false,
      }),
      transaction('suica-spend', 'expense', 500, 'suica'),
      transaction('card-payment', 'credit_payment', 2_000, 'bank', {
        counterpartyAccountId: 'card',
        counterpartyAmountMinor: 2_000,
        counterpartyCurrency: 'JPY',
        includeInSpending: false,
      }),
    ]

    const balances = calculateAccountBalances(accounts, transactions)
    expect(balances.get('bank')).toBe(96_000)
    expect(balances.get('card')).toBe(0)
    expect(balances.get('father-card')).toBe(0)
    expect(balances.get('suica')).toBe(1_500)

    const summary = ledgerSummary({
      accounts,
      transactions,
      rates: [],
      reportingCurrency: 'JPY',
      startDate: '2026-07-01',
      endDate: '2026-07-31',
    })
    expect(summary.assetsMinor).toBe(97_500)
    expect(summary.liabilitiesMinor).toBe(0)
    expect(summary.netWorthMinor).toBe(97_500)
    expect(summary.actualPaidMinor).toBe(3_500)
    expect(summary.externalPaidMinor).toBe(3_000)
    expect(summary.consumptionMinor).toBe(6_500)
    expect(summary.assetAccountDecreaseMinor).toBe(4_500)
  })

  it('信用卡还款不重复计入支出', () => {
    const accounts = [
      account('bank', 'asset', 'bank', 10_000),
      account('card', 'credit', 'credit_card', 0),
    ]
    const transactions = [
      transaction('purchase', 'credit_purchase', 2_000, 'card'),
      transaction('payment', 'credit_payment', 1_000, 'bank', {
        counterpartyAccountId: 'card',
        counterpartyAmountMinor: 1_000,
        includeInSpending: false,
      }),
    ]
    const summary = ledgerSummary({
      accounts,
      transactions,
      rates: [],
      reportingCurrency: 'JPY',
    })
    expect(summary.actualPaidMinor).toBe(2_000)
    expect(summary.assetAccountDecreaseMinor).toBe(1_000)
    expect(summary.liabilitiesMinor).toBe(1_000)
    expect(summary.netWorthMinor).toBe(8_000)
  })

  it('信用卡类型与账户归属分开，外部信用卡进入消费但不进入个人负债', () => {
    const fatherCard = {
      ...account('father-card', 'credit', 'credit_card', 0),
      name: '爸爸信用卡',
      ownership: 'external' as const,
      includeInNetWorth: false,
    }
    const purchase = transaction('rakuten', 'credit_purchase', 8_492, fatherCard.id, {
      merchantNameSnapshot: 'Rakuten Ichiba',
      fundingParty: 'external',
      affectsNetWorth: false,
    })
    const refund = transaction('rakuten-refund', 'refund', 1_000, fatherCard.id, {
      linkedTransactionId: purchase.id,
      fundingParty: 'external',
      affectsNetWorth: false,
    })
    const summary = ledgerSummary({
      accounts: [fatherCard],
      transactions: [purchase, refund],
      rates: [],
      reportingCurrency: 'JPY',
    })
    expect(summary.actualPaidMinor).toBe(0)
    expect(summary.externalPaidMinor).toBe(7_492)
    expect(summary.consumptionMinor).toBe(7_492)
    expect(summary.liabilitiesMinor).toBe(0)
    expect(summary.netWorthMinor).toBe(0)
  })

  it('外部代付 8492 进入总消费但本人自付为 0', () => {
    const fatherCard = {
      ...account('father-card', 'credit', 'credit_card', 0),
      name: '爸爸信用卡',
      ownership: 'external' as const,
      includeInNetWorth: false,
    }
    const summary = ledgerSummary({
      accounts: [fatherCard],
      transactions: [
        transaction('rakuten', 'credit_purchase', 8_492, fatherCard.id, {
          merchantNameSnapshot: 'Rakuten Ichiba',
          fundingParty: 'external',
          affectsNetWorth: false,
        }),
      ],
      rates: [],
      reportingCurrency: 'JPY',
    })
    expect(summary.consumptionMinor).toBe(8_492)
    expect(summary.actualPaidMinor).toBe(0)
    expect(summary.externalPaidMinor).toBe(8_492)
    expect(summary.assetAccountDecreaseMinor).toBe(0)
    expect(summary.liabilitiesMinor).toBe(0)
  })

  it('转账、充值和还款本金不算消费，手续费只统计一次', () => {
    const accounts = [
      account('bank', 'asset', 'bank', 20_000),
      account('wallet', 'asset', 'stored_value', 0),
      account('card', 'credit', 'credit_card', 0),
    ]
    const transactions = [
      transaction('topup', 'topup', 2_000, 'bank', {
        counterpartyAccountId: 'wallet',
        counterpartyAmountMinor: 2_000,
        includeInSpending: false,
        feeMinor: 50,
      }),
      transaction('payment', 'credit_payment', 1_000, 'bank', {
        counterpartyAccountId: 'card',
        counterpartyAmountMinor: 1_000,
        includeInSpending: false,
        feeMinor: 25,
      }),
    ]
    const balances = calculateAccountBalances(accounts, transactions)
    expect(balances.get('bank')).toBe(16_925)
    expect(balances.get('wallet')).toBe(2_000)
    const summary = ledgerSummary({ accounts, transactions, rates: [], reportingCurrency: 'JPY' })
    expect(summary.actualPaidMinor).toBe(75)
    expect(summary.externalPaidMinor).toBe(0)
    expect(summary.consumptionMinor).toBe(75)
    expect(summary.assetAccountDecreaseMinor).toBe(3_075)
  })
})

describe('多币种', () => {
  const rate: ExchangeRate = {
    id: 'CNY:JPY:2026-07-19:manual',
    baseCurrency: 'CNY',
    quoteCurrency: 'JPY',
    rate: 20,
    rateDate: '2026-07-19',
    fetchedAt: timestamp,
    source: 'manual',
    providerLabel: '测试汇率',
    isManual: true,
  }

  it('原币种 minor unit 换算正确', () => {
    expect(toMinor(12.34, 'CNY')).toBe(1_234)
    expect(toMinor(1234, 'JPY')).toBe(1_234)
    expect(convertMinor(1_234, 'CNY', 'JPY', 20)).toBe(247)
  })

  it('外部代付来源可以承接多币种，而每笔流水仍保留原币种', () => {
    const fatherCard = {
      ...account('father-card', 'credit', 'credit_card', 0),
      ownership: 'external' as const,
      includeInNetWorth: false,
      supportedCurrencies: ['JPY', 'CNY'],
    }
    expect(accountCurrencies(fatherCard)).toEqual(['JPY', 'CNY'])
    expect(accountSupportsCurrency(fatherCard, 'CNY')).toBe(true)

    const summary = ledgerSummary({
      accounts: [fatherCard],
      transactions: [transaction('cny-external', 'external_payment', 1_000, fatherCard.id, {
        currency: 'CNY',
        fundingParty: 'external',
        affectsNetWorth: false,
        reportingCurrency: 'JPY',
        reportingAmountMinor: 200,
      })],
      rates: [rate],
      reportingCurrency: 'JPY',
    })
    expect(summary.externalPaidMinor).toBe(200)
    expect(summary.actualPaidMinor).toBe(0)
    expect(summary.netWorthMinor).toBe(0)
  })

  it('同一本人账户按币种分别结算，修改默认币种不会重解释历史余额', () => {
    const multi = {
      ...account('multi-bank', 'asset', 'bank', 100_000, 'CNY'),
      supportedCurrencies: ['JPY', 'CNY'],
      openingBalanceCurrency: 'JPY',
    }
    const transactions = [
      transaction('jpy-spend', 'expense', 1_000, multi.id, { currency: 'JPY' }),
      transaction('cny-income', 'income', 5_000, multi.id, {
        currency: 'CNY',
        includeInSpending: false,
      }),
    ]
    const balances = calculateAccountBalancesByCurrency([multi], transactions).get(multi.id)
    expect(balances?.get('JPY')).toBe(99_000)
    expect(balances?.get('CNY')).toBe(5_000)

    const summary = ledgerSummary({
      accounts: [multi],
      transactions,
      rates: [rate],
      reportingCurrency: 'JPY',
    })
    expect(summary.assetsMinor).toBe(100_000)
  })

  it('余额使用最新率，历史消费优先使用交易快照', () => {
    const alipay = account('alipay', 'asset', 'wallet', 10_000, 'CNY') // CNY 100
    const spend = transaction('cny-spend', 'expense', 1_000, 'alipay', {
      currency: 'CNY',
      reportingCurrency: 'JPY',
      reportingAmountMinor: 180,
      exchangeRate: 18,
      exchangeRateDate: '2026-07-01',
      exchangeRateSource: 'transaction_snapshot',
    })
    const summary = ledgerSummary({
      accounts: [alipay],
      transactions: [spend],
      rates: [rate],
      reportingCurrency: 'JPY',
    })
    expect(summary.assetsMinor).toBe(1_800) // CNY 90 × latest 20
    expect(summary.actualPaidMinor).toBe(180) // CNY 10 × historical 18
  })
})
