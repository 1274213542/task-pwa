import type { HTMLAttributes, ReactNode } from 'react'

export function GroupedList({
  children,
  className = '',
  ...props
}: HTMLAttributes<HTMLUListElement>) {
  return (
    <ul className={`grouped-list ${className}`.trim()} {...props}>
      {children}
    </ul>
  )
}

export function GroupedListRow({
  leading,
  title,
  subtitle,
  value,
  trailing,
  className = '',
  children,
  ...props
}: Omit<HTMLAttributes<HTMLLIElement>, 'title'> & {
  leading?: ReactNode
  title?: ReactNode
  subtitle?: ReactNode
  value?: ReactNode
  trailing?: ReactNode
}) {
  return (
    <li
      className={`grouped-list-row ${subtitle ? 'has-subtitle' : ''} ${leading ? 'has-leading' : ''} ${className}`.trim()}
      {...props}
    >
      {leading && <span className="grouped-list-leading">{leading}</span>}
      <span className="grouped-list-copy">
        {title && <span className="grouped-list-title">{title}</span>}
        {subtitle && <span className="grouped-list-subtitle">{subtitle}</span>}
        {children}
      </span>
      {value && <span className="grouped-list-value tabular">{value}</span>}
      {trailing && <span className="grouped-list-trailing">{trailing}</span>}
    </li>
  )
}
