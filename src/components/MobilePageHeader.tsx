import AppIcon, { type AppIconName } from './AppIcon'

export default function MobilePageHeader({
  title,
  eyebrow,
  onPrimary,
  primaryLabel = '新增',
  primaryIcon = 'plus',
  backHref,
  showSecondary = true,
}: {
  title: string
  eyebrow?: string
  onPrimary?: () => void
  primaryLabel?: string
  primaryIcon?: AppIconName
  backHref?: string
  showSecondary?: boolean
}) {
  return (
    <header className="mobile-page-header">
      {backHref ? (
        <a href={backHref} aria-label="返回" className="mobile-page-avatar">
          <AppIcon name="chevronLeft" size={23} />
        </a>
      ) : (
        <span className="mobile-page-avatar" aria-hidden>
          <img src={`${import.meta.env.BASE_URL}icons/icon-192.png`} alt="" />
        </span>
      )}
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
        {showSecondary && <a href="#/settings" aria-label="同步和提醒设置" className="mobile-page-secondary">
          <AppIcon name="bell" size={23} />
          <span aria-hidden />
        </a>}
      </div>
    </header>
  )
}
