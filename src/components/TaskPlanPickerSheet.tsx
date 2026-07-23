import { useRef, useState } from 'react'
import type { Task } from '../lib/db'
import { deleteTaskPlan, saveTaskPlan } from '../lib/tasks'
import AppIcon from './AppIcon'
import GestureSheet, { type GestureSheetHandle } from './GestureSheet'

export default function TaskPlanPickerSheet({
  plans,
  selectedId,
  startDate,
  onSelect,
  onClose,
  onFeedback,
}: {
  plans: Task[]
  selectedId: string
  startDate: string
  onSelect: (id: string) => void
  onClose: () => void
  onFeedback: (message: string) => void
}) {
  const dialogRef = useRef<HTMLElement>(null)
  const sheetRef = useRef<GestureSheetHandle>(null)
  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState('')
  const [editingTitle, setEditingTitle] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function createPlan() {
    if (!draft.trim() || saving) return
    setSaving(true)
    setError('')
    try {
      const id = await saveTaskPlan({ title: draft, startDate })
      onSelect(id)
      onFeedback('计划已创建并选中')
      sheetRef.current?.close()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '创建计划失败')
    } finally {
      setSaving(false)
    }
  }

  async function renamePlan() {
    if (!editingId || !editingTitle.trim() || saving) return
    setSaving(true)
    setError('')
    try {
      await saveTaskPlan({ id: editingId, title: editingTitle })
      setEditingId('')
      setEditingTitle('')
      onFeedback('计划名称已更新')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '更新计划失败')
    } finally {
      setSaving(false)
    }
  }

  async function removePlan(plan: Task) {
    const detach = window.confirm(`删除“${plan.title}”，并将其中内容移出计划？`)
    let mode: 'detach' | 'cascade'
    if (detach) mode = 'detach'
    else if (window.confirm(`要连同“${plan.title}”中的全部内容一起删除吗？`)) mode = 'cascade'
    else return
    setSaving(true)
    setError('')
    try {
      await deleteTaskPlan(plan.id, mode)
      if (selectedId === plan.id) onSelect('')
      onFeedback(mode === 'cascade' ? '计划及其内容已删除' : '计划已删除，原内容已移出计划')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '删除计划失败')
    } finally {
      setSaving(false)
    }
  }

  return (
    <GestureSheet
      ref={sheetRef}
      dialogRef={dialogRef}
      labelledBy="task-plan-picker-title"
      className="editor-sheet task-plan-picker-sheet"
      onClose={onClose}
    >
      <div className="task-plan-picker-layout">
        <header className="task-plan-picker-header" data-sheet-drag-handle>
          <button type="button" onClick={() => sheetRef.current?.close()}>取消</button>
          <h2 id="task-plan-picker-title">所属计划</h2>
          <button type="button" className="primary" onClick={() => { onSelect(''); sheetRef.current?.close() }}>不加入</button>
        </header>
        <div className="task-plan-picker-body">
          <section className="task-plan-create" aria-labelledby="task-plan-create-title">
            <div>
              <strong id="task-plan-create-title">新建计划</strong>
            </div>
            <div className="task-plan-create-fields">
              <input
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="例如 回国"
                autoComplete="off"
              />
              <button type="button" disabled={!draft.trim() || saving} onClick={() => void createPlan()}>
                <AppIcon name="plus" size={17} /> 创建并选择
              </button>
            </div>
          </section>
          <section className="task-plan-list" aria-label="已有计划">
            {plans.length === 0 && <p className="task-plan-empty">还没有计划</p>}
            {plans.map((plan) => {
              const editing = editingId === plan.id
              return (
                <div key={plan.id} className="task-plan-manage-row" data-selected={selectedId === plan.id || undefined}>
                  {editing ? (
                    <input value={editingTitle} onChange={(event) => setEditingTitle(event.target.value)} autoFocus />
                  ) : (
                    <button type="button" className="task-plan-select" onClick={() => { onSelect(plan.id); sheetRef.current?.close() }}>
                      <AppIcon name="list" size={18} />
                      <span>{plan.title}</span>
                      {selectedId === plan.id && <AppIcon name="check" size={17} />}
                    </button>
                  )}
                  <div className="task-plan-row-actions">
                    {editing ? (
                      <>
                        <button type="button" disabled={saving || !editingTitle.trim()} onClick={() => void renamePlan()}>保存</button>
                        <button type="button" onClick={() => setEditingId('')}>取消</button>
                      </>
                    ) : (
                      <>
                        <button type="button" onClick={() => { setEditingId(plan.id); setEditingTitle(plan.title) }}>重命名</button>
                        <button type="button" className="danger" disabled={saving} onClick={() => void removePlan(plan)}>删除</button>
                      </>
                    )}
                  </div>
                </div>
              )
            })}
          </section>
          {error && <p role="alert" className="task-plan-picker-error">{error}</p>}
        </div>
      </div>
    </GestureSheet>
  )
}
