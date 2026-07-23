import { useState } from 'react'
import type { Category } from '../lib/db'
import { addCategory } from '../lib/categories'
import AppIcon from './AppIcon'

export default function CategoryPickerControl({
  categories,
  value,
  onChange,
  onManage,
}: {
  categories: Category[]
  value: string
  onChange: (id: string) => void
  onManage?: () => void
}) {
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function create() {
    if (!draft.trim() || saving) return
    setSaving(true)
    setError('')
    try {
      const id = await addCategory(draft)
      onChange(id)
      setDraft('')
      setCreating(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '创建分类失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="category-picker-control">
      <label className="category-picker-select">
        <AppIcon name="category" size={18} />
        <select
          aria-label="分类"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">无分类</option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>{category.name}</option>
          ))}
        </select>
        <AppIcon name="chevronDown" size={15} />
      </label>

      <div className="category-picker-actions">
        <button type="button" onClick={() => { setCreating((open) => !open); setError('') }}>
          <AppIcon name="plus" size={15} /> 新建分类
        </button>
        {onManage && <button type="button" onClick={onManage}>管理分类</button>}
      </div>

      {creating && (
        <div className="category-picker-create">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="分类名称"
            autoFocus
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void create()
              }
            }}
          />
          <button type="button" disabled={!draft.trim() || saving} onClick={() => void create()}>
            {saving ? '保存中…' : '创建并选择'}
          </button>
        </div>
      )}
      {error && <small role="alert">{error}</small>}
    </div>
  )
}
