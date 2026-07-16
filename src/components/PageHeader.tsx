import type { ReactNode } from 'react'

export default function PageHeader({
  title,
  eyebrow,
  leading,
  actions,
}: {
  title: string
  eyebrow?: ReactNode
  leading?: ReactNode
  actions?: ReactNode
}) {
  return (
    <header className="page-header">
      <div className="flex min-w-0 items-center gap-2.5">
        {leading}
        <div className="min-w-0">
          {eyebrow && <p className="page-eyebrow">{eyebrow}</p>}
          <h1 className="page-title">{title}</h1>
        </div>
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </header>
  )
}
