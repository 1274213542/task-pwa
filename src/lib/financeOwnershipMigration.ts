import type Dexie from 'dexie'
import type { ExpenseCategory } from './db'
import type { Account, FinanceTransaction, FundingParty } from './ledgerTypes'

function normalizedName(value: string) {
  return value.replace(/\s+/g, '').toLocaleLowerCase()
}

function hasHighConfidenceExternalOwnerHint(account: Account) {
  if (account.subtype === 'external_payer') return true
  const name = normalizedName(account.name)
  const ownerHint = /(爸爸|父亲|父親|父の|father|dad(?:dy)?)/i.test(name)
  const paymentHint = /(信用卡|银行卡|卡|credit|card|クレジット|カード)/i.test(name)
  return ownerHint && paymentHint
}

function inferredOwnership(account: Account): 'self' | 'external' {
  // A previous migration version filled missing ownership with `self`.
  // Correct only unconfirmed high-confidence family-card records. Once the
  // user edits the account, ownershipConfirmedAt protects that decision.
  if (!account.ownershipConfirmedAt && hasHighConfidenceExternalOwnerHint(account)) return 'external'
  if (account.ownership === 'self' || account.ownership === 'external') return account.ownership
  return account.kind === 'external' ? 'external' : 'self'
}

function inferredFundingParty(
  transaction: FinanceTransaction,
  accountById: Map<string, Account>,
): FundingParty {
  if (transaction.fundingParty === 'self' || transaction.fundingParty === 'external') {
    return transaction.fundingParty
  }
  const account = accountById.get(transaction.accountId)
  return transaction.type === 'external_payment' || account?.ownership === 'external' || account?.kind === 'external'
    ? 'external'
    : 'self'
}

/**
 * 可重复执行：只补缺失的归属 / 资金来源快照，不复制、不清空，
 * 也不改写金额、主键或排序。只对旧迁移误写成 self、且账户尚未
 * 经用户确认的高置信家人卡修正快照；其余历史 fundingParty 保持
 * 不变，避免未来账户设置静默改写过去统计。
 */
export async function ensureFinanceOwnershipMigration(db: Dexie): Promise<void> {
  const accountsTable = db.table<Account, string>('accounts')
  const transactionsTable = db.table<FinanceTransaction, string>('financeTransactions')
  const categoriesTable = db.table<ExpenseCategory, string>('expenseCategories')
  const accounts = await accountsTable.toArray()
  const accountById = new Map<string, Account>()
  const reclassifiedAccountIds = new Set<string>()

  await db.transaction('rw', accountsTable, transactionsTable, categoriesTable, async () => {
    for (const account of accounts) {
      const ownership = inferredOwnership(account)
      accountById.set(account.id, { ...account, ownership })
      const accountChanges: Partial<Account> = {}
      if (account.ownership !== ownership) {
        accountChanges.ownership = ownership
        reclassifiedAccountIds.add(account.id)
      }
      if (ownership === 'external' && account.includeInNetWorth !== false) {
        accountChanges.includeInNetWorth = false
      }
      if (Object.keys(accountChanges).length) {
        await accountsTable.update(account.id, accountChanges)
      }
    }

    const transactions = await transactionsTable.toArray()
    for (const transaction of transactions) {
      const correctBrokenLegacySnapshot =
        reclassifiedAccountIds.has(transaction.accountId) &&
        transaction.fundingParty === 'self' &&
        ['expense', 'credit_purchase', 'external_payment'].includes(transaction.type)
      if (!transaction.fundingParty || correctBrokenLegacySnapshot) {
        await transactionsTable.update(transaction.id, {
          fundingParty: correctBrokenLegacySnapshot
            ? 'external'
            : inferredFundingParty(transaction, accountById),
          ...(correctBrokenLegacySnapshot && { affectsNetWorth: false }),
        })
      }
    }

    const categories = await categoriesTable.orderBy('rank').toArray()
    for (const [index, category] of categories.entries()) {
      const changes: Partial<ExpenseCategory> = {}
      if (category.sortOrder === undefined) changes.sortOrder = index
      if (category.archived === undefined) changes.archived = category.lifecycleStatus !== 'active'
      if (Object.keys(changes).length) await categoriesTable.update(category.id, changes)
    }
  })
}
