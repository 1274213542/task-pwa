import type { Recurrence, Weekday } from '../lib/recurrence'

type RepeatMode = 'none' | 'fixed' | 'after'
type FixedFrequency = 'daily' | 'weekly' | 'monthly'

const WEEKDAY_NAMES = ['一', '二', '三', '四', '五', '六', '日']

export default function RecurrencePicker({
  value,
  onChange,
}: {
  value: Recurrence | undefined
  onChange: (r: Recurrence | undefined) => void
}) {
  const repeatMode: RepeatMode = !value
    ? 'none'
    : value.mode === 'after_completion'
      ? 'after'
      : 'fixed'
  const fixedFrequency: FixedFrequency = value?.mode === 'fixed_schedule'
    ? value.frequency
    : 'daily'
  const today = new Date()

  function setMode(mode: RepeatMode) {
    if (mode === 'none') {
      onChange(undefined)
      return
    }
    if (mode === 'after') {
      onChange({
        mode: 'after_completion',
        intervalValue: value?.mode === 'after_completion' ? value.intervalValue : 1,
        intervalUnit: value?.mode === 'after_completion' ? value.intervalUnit : 'day',
        overflowPolicy: value?.overflowPolicy ?? 'clamp',
      })
      return
    }
    setFrequency(value?.mode === 'fixed_schedule' ? value.frequency : 'daily')
  }

  function setFrequency(frequency: FixedFrequency) {
    const interval = value?.mode === 'fixed_schedule' ? value.interval : 1
    const overflowPolicy = value?.overflowPolicy ?? 'clamp'
    if (frequency === 'daily') {
      onChange({ mode: 'fixed_schedule', frequency, interval, overflowPolicy })
      return
    }
    if (frequency === 'weekly') {
      onChange({
        mode: 'fixed_schedule',
        frequency,
        interval,
        weekdays: value?.mode === 'fixed_schedule' && value.frequency === 'weekly'
          ? value.weekdays
          : [1],
        overflowPolicy,
      })
      return
    }
    onChange({
      mode: 'fixed_schedule',
      frequency,
      interval,
      dayOfMonth: value?.mode === 'fixed_schedule' && value.frequency === 'monthly'
        ? value.dayOfMonth
        : today.getDate(),
      overflowPolicy,
    })
  }

  return (
    <div className="recurrence-editor">
      <div className="recurrence-mode-control" role="radiogroup" aria-label="循环方式">
        {([
          ['none', '不重复'],
          ['fixed', '固定周期'],
          ['after', '完成后重复'],
        ] as const).map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            role="radio"
            aria-checked={repeatMode === mode}
            onClick={() => setMode(mode)}
          >
            {label}
          </button>
        ))}
      </div>

      {value?.mode === 'fixed_schedule' && (
        <div className="recurrence-config-panel">
          <div className="recurrence-frequency-control" role="radiogroup" aria-label="周期单位">
            {([
              ['daily', '按天'],
              ['weekly', '按周'],
              ['monthly', '按月'],
            ] as const).map(([frequency, label]) => (
              <button
                key={frequency}
                type="button"
                role="radio"
                aria-checked={fixedFrequency === frequency}
                onClick={() => setFrequency(frequency)}
              >
                {label}
              </button>
            ))}
          </div>

          <label className="recurrence-step-row">
            <span>每</span>
            <input
              type="number"
              min={1}
              max={365}
              aria-label="重复间隔"
              value={value.interval}
              onChange={(event) => onChange({
                ...value,
                interval: Math.min(365, Math.max(1, Number(event.target.value) || 1)),
              })}
            />
            <strong>{value.frequency === 'daily' ? '天' : value.frequency === 'weekly' ? '周' : '个月'}</strong>
          </label>

          {value.frequency === 'weekly' && (
            <div className="recurrence-weekdays" role="group" aria-label="每周执行日">
              {WEEKDAY_NAMES.map((name, index) => {
                const weekday = (index + 1) as Weekday
                const selected = value.weekdays?.includes(weekday) ?? false
                return (
                  <button
                    key={weekday}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      const current = value.weekdays ?? []
                      const next = selected
                        ? current.filter((entry) => entry !== weekday)
                        : [...current, weekday]
                      if (next.length === 0) return
                      onChange({ ...value, weekdays: next.sort() })
                    }}
                  >
                    {name}
                  </button>
                )
              })}
            </div>
          )}

          {value.frequency === 'monthly' && (
            <div className="recurrence-monthly-config">
              <div className="recurrence-monthly-mode" role="radiogroup" aria-label="每月执行方式">
                <button
                  type="button"
                  role="radio"
                  aria-checked={value.dayOfMonth !== -1}
                  onClick={() => onChange({ ...value, dayOfMonth: today.getDate() })}
                >
                  指定日期
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={value.dayOfMonth === -1}
                  onClick={() => onChange({ ...value, dayOfMonth: -1 })}
                >
                  最后一天
                </button>
              </div>
              {value.dayOfMonth !== -1 && (
                <label className="recurrence-step-row">
                  <span>每月</span>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    aria-label="每月日期"
                    value={value.dayOfMonth ?? 1}
                    onChange={(event) => onChange({
                      ...value,
                      dayOfMonth: Math.min(31, Math.max(1, Number(event.target.value) || 1)),
                    })}
                  />
                  <strong>日</strong>
                </label>
              )}
              {(value.dayOfMonth ?? 1) >= 29 && value.dayOfMonth !== -1 && (
                <label className="recurrence-overflow-row">
                  <span>短月份</span>
                  <select
                    aria-label="短月处理"
                    value={value.overflowPolicy}
                    onChange={(event) => onChange({
                      ...value,
                      overflowPolicy: event.target.value as 'clamp' | 'skip',
                    })}
                  >
                    <option value="clamp">使用当月最后一天</option>
                    <option value="skip">跳过该月</option>
                  </select>
                </label>
              )}
            </div>
          )}
        </div>
      )}

      {value?.mode === 'after_completion' && (
        <div className="recurrence-config-panel">
          <label className="recurrence-step-row recurrence-after-row">
            <span>完成后</span>
            <input
              type="number"
              min={1}
              max={365}
              aria-label="完成后重复间隔"
              value={value.intervalValue}
              onChange={(event) => onChange({
                ...value,
                intervalValue: Math.min(365, Math.max(1, Number(event.target.value) || 1)),
              })}
            />
            <select
              aria-label="完成后间隔单位"
              value={value.intervalUnit}
              onChange={(event) => onChange({
                ...value,
                intervalUnit: event.target.value as 'day' | 'week' | 'month',
              })}
            >
              <option value="day">天</option>
              <option value="week">周</option>
              <option value="month">个月</option>
            </select>
            <strong>再次出现</strong>
          </label>
          {value.intervalUnit === 'month' && (
            <label className="recurrence-overflow-row">
              <span>短月份</span>
              <select
                aria-label="完成后短月处理"
                value={value.overflowPolicy}
                onChange={(event) => onChange({
                  ...value,
                  overflowPolicy: event.target.value as 'clamp' | 'skip',
                })}
              >
                <option value="clamp">使用当月最后一天</option>
                <option value="skip">跳到下个有效月份</option>
              </select>
            </label>
          )}
        </div>
      )}
    </div>
  )
}
