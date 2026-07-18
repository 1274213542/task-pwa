import AppIcon, { type AppIconName } from './AppIcon'

export default function MobilePageHeader({
  title,
  eyebrow,
  onPrimary,
  primaryLabel = '新增',
  primaryIcon = 'plus',
  backHref,
  showSecondary = true,
  secondaryHref = '#/settings',
  secondaryLabel = '设置',
  secondaryIcon = 'settings',
}: {
  title: string
  eyebrow?: string
  onPrimary?: () => void
  primaryLabel?: string
  primaryIcon?: AppIconName
  backHref?: string
  showSecondary?: boolean
  secondaryHref?: string
  secondaryLabel?: string
  secondaryIcon?: AppIconName
}) {
  return (
    <header className={`mobile-page-header ${backHref ? 'has-leading' : 'has-no-leading'}`}>
      {backHref ? (
        <a href={backHref} aria-label="返回" className="mobile-page-avatar">
          <AppIcon name="chevronLeft" size={23} />
        </a>
      ) : null}
      <div className="mobile-page-heading">
        {eyebrow && <p>{eyebrow}</p>}
        <h1>{title}</h1>
      </div>
      <div className="mobile-page-actions">
        {onPrimary && (
          <button type="button" aria-label={primaryLabel} onClick={onPrimary} className="mobile-page-primary">
            <AppIcon name={primaryIcon} size={26} />
          </button>
        )}
        {showSecondary && <a href={secondaryHref} aria-label={secondaryLabel} className="mobile-page-secondary">
          <AppIcon name={secondaryIcon} size={22} />
        </a>}
      </div>
    </header>
  )
}
