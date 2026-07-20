/**
 * Dexie Cloud 数据库 URL。
 * - 这是公开可进前端的地址（数据隔离靠 OTP 认证 + 私有 realm，v4.2 §2），
 *   管理密钥（dexie-cloud.key）绝不入库、绝不进前端。
 * - 留空 = 纯本地模式：App 完整可用，仅无跨设备同步（免费服务消失时的退化形态）。
 * - 由 `npx dexie-cloud create` 生成后填入。
 */
export const DEXIE_CLOUD_URL: string = 'https://zcgk53qk8.dexie.cloud'

export const cloudEnabled = DEXIE_CLOUD_URL.length > 0

/**
 * 新账本通过可撤销开关隔离。部署时可用 VITE_FINANCE_LEDGER_V2=false
 * 立即退回旧财务页面，数据表和旧记录均不会被删除。
 */
export const financeLedgerV2Enabled =
  import.meta.env.VITE_FINANCE_LEDGER_V2 !== 'false'
