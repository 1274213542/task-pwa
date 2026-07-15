/**
 * 持久存储（v4.2 §3）：降低系统在存储压力下清除 IndexedDB 的概率。
 * Safari 17+ 完整支持；Safari 不弹窗，按站点交互历史自动决定。
 * 返回 false 时 App 照常使用，只是更依赖云同步与 JSON 备份。
 */
export async function ensurePersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false
  if (await navigator.storage.persisted()) return true
  try {
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

export async function isStoragePersisted(): Promise<boolean> {
  if (!navigator.storage?.persisted) return false
  try {
    return await navigator.storage.persisted()
  } catch {
    return false
  }
}
