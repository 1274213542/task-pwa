export type AppIconName =
  | 'today'
  | 'calendar'
  | 'shopping'
  | 'browse'
  | 'settings'
  | 'search'
  | 'plus'
  | 'close'
  | 'edit'
  | 'filter'
  | 'bell'
  | 'category'
  | 'reminder'
  | 'sync'
  | 'check'
  | 'chevronLeft'
  | 'chevronRight'
  | 'chevronDown'
  | 'palette'
  | 'clock'
  | 'month'
  | 'week'
  | 'list'
  | 'trash'

const paths: Record<AppIconName, React.ReactNode> = {
  today: (
    <>
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="4.5" width="18" height="16" rx="3" />
      <path d="M7.5 2.5v4M16.5 2.5v4M3 9h18M7 13h3M14 13h3M7 17h3" />
    </>
  ),
  shopping: (
    <>
      <path d="M4 7.5h16l-1.2 12H5.2L4 7.5Z" />
      <path d="M8.5 9V6a3.5 3.5 0 0 1 7 0v3" />
    </>
  ),
  browse: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.8 8.2-2.1 5.5-5.5 2.1 2.1-5.5 5.5-2.1Z" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H2.8v-4H3a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1a1.7 1.7 0 0 0 1.9.3A1.7 1.7 0 0 0 10 3V2.8h4V3a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z" />
    </>
  ),
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 4.5 4.5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="m6.5 6.5 11 11m0-11-11 11" />,
  edit: (
    <>
      <path d="m4 20 4.1-1 10.6-10.6a2.2 2.2 0 0 0-3.1-3.1L5 15.9 4 20Z" />
      <path d="m13.8 7.1 3.1 3.1" />
    </>
  ),
  filter: (
    <>
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="8" cy="17" r="2" />
    </>
  ),
  bell: (
    <>
      <path d="M6.5 10a5.5 5.5 0 0 1 11 0c0 5 2.2 5.5 2.2 5.5H4.3S6.5 15 6.5 10Z" />
      <path d="M10 19h4" />
    </>
  ),
  category: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="2.2" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="2.2" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="2.2" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="2.2" />
    </>
  ),
  reminder: (
    <>
      <circle cx="12" cy="13" r="7.5" />
      <path d="M12 9v4.5l3 1.5M7 3.5 4.5 6M17 3.5 19.5 6" />
    </>
  ),
  sync: (
    <>
      <path d="M20 7v5h-5" />
      <path d="M4 17v-5h5" />
      <path d="M6.1 8.2A7 7 0 0 1 18.7 7L20 12M4 12l1.3 5A7 7 0 0 0 17.9 15.8" />
    </>
  ),
  check: <path d="m5 12.5 4.2 4.2L19 7" />,
  chevronLeft: <path d="m14.5 5-7 7 7 7" />,
  chevronRight: <path d="m9.5 5 7 7-7 7" />,
  chevronDown: <path d="m5 9 7 7 7-7" />,
  palette: (
    <>
      <path d="M12 3a9 9 0 1 0 0 18h1.5a2 2 0 0 0 0-4H12a1.5 1.5 0 0 1 0-3h2.5A6.5 6.5 0 0 0 21 7.5C21 5 17 3 12 3Z" />
      <circle cx="7.5" cy="9" r=".8" fill="currentColor" stroke="none" />
      <circle cx="10" cy="6.5" r=".8" fill="currentColor" stroke="none" />
      <circle cx="14" cy="6.3" r=".8" fill="currentColor" stroke="none" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2" />
    </>
  ),
  month: (
    <>
      <rect x="3" y="4.5" width="18" height="16" rx="3" />
      <path d="M3 9h18M8 2.5v4M16 2.5v4M7 13h2M11 13h2M15 13h2M7 17h2M11 17h2" />
    </>
  ),
  week: (
    <>
      <rect x="3" y="5" width="18" height="15" rx="3" />
      <path d="M3 9h18M8 3v4M16 3v4M8 12v5M12 12v5M16 12v5" />
    </>
  ),
  list: (
    <>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <circle cx="5" cy="6" r="1" fill="currentColor" stroke="none" />
      <circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="5" cy="18" r="1" fill="currentColor" stroke="none" />
    </>
  ),
  trash: (
    <>
      <path d="M4.5 7h15M9 7V4.5h6V7M7 7l.8 13h8.4L17 7" />
      <path d="M10 11v5M14 11v5" />
    </>
  ),
}

export default function AppIcon({
  name,
  size = 22,
  className,
}: {
  name: AppIconName
  size?: number
  className?: string
}) {
  return (
    <svg
      aria-hidden
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {paths[name]}
    </svg>
  )
}
