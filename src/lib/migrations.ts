export interface LegacyTaskScopeRow {
  taskScope?: 'daily' | 'weekly'
}

/** v7 原地迁移：只补作用域，不修改任何既有业务字段或记录主键。 */
export function ensureTaskScope(row: LegacyTaskScopeRow): void {
  if (!row.taskScope) row.taskScope = 'daily'
}
