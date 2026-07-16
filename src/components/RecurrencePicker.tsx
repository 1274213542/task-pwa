import type { Recurrence, Weekday } from '../lib/recurrence'

/**
 * 重复规则选择器（MS3 精简版；MS4 起换 Radix 弹层与完整参数）。
 * 产出即 v4.2 §7 的结构化规则，不经过任何中间格式。
 */

type Kind = 'none' | 'daily' | 'weekly' | 'monthly' | 'monthlyLast' | 'after'

const WEEKDAY_NAMES = ['一', '二', '三', '四', '五', '六', '日']

export default function RecurrencePicker({
  value,
  onChange,
}: {
  value: Recurrence | undefined
  onChange: (r: Recurrence | undefined) => void
}) {
  const kind: Kind = !value
    ? 'none'
    : value.mode === 'after_completion'
      ? 'after'
      : value.frequency === 'daily'
        ? 'daily'
        : value.frequency === 'weekly'
          ? 'weekly'
          : value.dayOfMonth === -1
            ? 'monthlyLast'
            : 'monthly'

  function setKind(k: Kind) {
    const today = new Date()
    switch (k) {
      case 'none':
        return onChange(undefined)
      case 'daily':
        return onChange({
          mode: 'fixed_schedule',
          frequency: 'daily',
          interval: 1,
          overflowPolicy: 'clamp',
        })
      case 'weekly':
        return onChange({
          mode: 'fixed_schedule',
          frequency: 'weekly',
          interval: 1,
          weekdays: [1], // 默认每周一（原始需求）
          overflowPolicy: 'clamp',
        })
      case 'monthly':
        return onChange({
          mode: 'fixed_schedule',
          frequency: 'monthly',
          interval: 1,
          dayOfMonth: today.getDate(),
          overflowPolicy: 'clamp',
        })
      case 'monthlyLast':
        return onChange({
          mode: 'fixed_schedule',
          frequency: 'monthly',
          interval: 1,
          dayOfMonth: -1,
          overflowPolicy: 'clamp',
        })
      case 'after':
        return onChange({
          mode: 'after_completion',
          intervalValue: 7,
          intervalUnit: 'day',
          overflowPolicy: 'clamp',
        })
    }
  }

  const selectCls =
    'min-h-11 rounded-xl bg-white px-2 py-1.5 text-[13px] dark:bg-neutral-800'

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-neutral-500">
      <select
        aria-label="重复"
        value={kind}
        onChange={(e) => setKind(e.target.value as Kind)}
        className={selectCls}
      >
        <option value="none">不重复</option>
        <option value="daily">每天</option>
        <option value="weekly">每周</option>
        <option value="monthly">每月（指定日期）</option>
        <option value="monthlyLast">每月最后一天</option>
        <option value="after">完成后再重复</option>
      </select>

      {value?.mode === 'fixed_schedule' && value.frequency === 'weekly' && (
        <div className="flex gap-1" role="group" aria-label="星期几">
          {WEEKDAY_NAMES.map((name, i) => {
            const wd = (i + 1) as Weekday
            const on = value.weekdays?.includes(wd) ?? false
            return (
              <button
                key={wd}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  const cur = value.weekdays ?? []
                  const next = on ? cur.filter((w) => w !== wd) : [...cur, wd]
                  if (next.length === 0) return // 至少保留一天
                  onChange({ ...value, weekdays: next.sort() })
                }}
                className={`h-10 w-10 rounded-full text-[12px] transition ${
                  on
                    ? 'bg-[#2f765f] text-white'
                    : 'bg-white text-neutral-500 dark:bg-neutral-800'
                }`}
              >
                {name}
              </button>
            )
          })}
        </div>
      )}

      {value?.mode === 'fixed_schedule' &&
        value.frequency === 'monthly' &&
        value.dayOfMonth !== -1 && (
          <label className="flex items-center gap-1">
            每月
            <input
              type="number"
              min={1}
              max={31}
              value={value.dayOfMonth ?? 1}
              onChange={(e) =>
                onChange({
                  ...value,
                  dayOfMonth: Math.min(31, Math.max(1, Number(e.target.value))),
                })
              }
              className={`${selectCls} w-14 text-center`}
            />
            日
            {(value.dayOfMonth ?? 1) >= 29 && (
              <select
                aria-label="短月处理"
                value={value.overflowPolicy}
                onChange={(e) =>
                  onChange({
                    ...value,
                    overflowPolicy: e.target.value as 'clamp' | 'skip',
                  })
                }
                className={selectCls}
              >
                <option value="clamp">短月→月底</option>
                <option value="skip">短月跳过</option>
              </select>
            )}
          </label>
        )}

      {value?.mode === 'after_completion' && (
        <label className="flex items-center gap-1">
          完成后
          <input
            type="number"
            min={1}
            max={365}
            value={value.intervalValue}
            onChange={(e) =>
              onChange({
                ...value,
                intervalValue: Math.max(1, Number(e.target.value)),
              })
            }
            className={`${selectCls} w-14 text-center`}
          />
          <select
            aria-label="间隔单位"
            value={value.intervalUnit}
            onChange={(e) =>
              onChange({
                ...value,
                intervalUnit: e.target.value as 'day' | 'week' | 'month',
              })
            }
            className={selectCls}
          >
            <option value="day">天</option>
            <option value="week">周</option>
            <option value="month">个月</option>
          </select>
          再来一次
        </label>
      )}
    </div>
  )
}
