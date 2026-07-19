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
  if (account.ownership === 'self' || account.ownership === 'external') return account.ownership
  if (hasHighConfidenceExternalOwnerHint(account)) return 'external'
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
 * 也不改写金额、主键或排序。之后修改账户归属时，历史流水的
 * fundingParty 保持不变，避免过去的统计被未来配置静默改写。
 */
export async function ensureFinanceOwnershipMigration(db: Dexie): Promise<void> {
  const accountsTable = db.table<Account, string>('accounts')
  const transactionsTable = db.table<FinanceTransaction, string>('financeTransactions')
  const categoriesTable = db.table<ExpenseCategory, string>('expenseCategories')
  const accounts = await accountsTable.toArray()
  const accountById = new Map<string, Account>()

  await db.transaction('rw', accountsTable, transactionsTable, categoriesTable, async () => {
    for (const account of accounts) {
      const ownership = inferredOwnership(account)
      accountById.set(account.id, { ...account, ownership })
      const accountChanges: Partial<Account> = {}
      if (!account.ownership) accountChanges.ownership = ownership
      if (ownership === 'external' && account.includeInNetWorth !== false) {
        accountChanges.includeInNetWorth = false
      }
      if (Object.keys(accountChanges).length) {
        await accountsTable.update(account.id, accountChanges)
      }
    }

    const transactions = await transactionsTable.toArray()
    for (const transaction of transactions) {
      if (!transaction.fundingParty) {
        await transactionsTable.update(transaction.id, {
          fundingParty: inferredFundingParty(transaction, accountById),
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
