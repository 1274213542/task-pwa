import type { ColorToken, MarkerSymbol } from '../lib/db'

function Shape({ symbol }: { symbol: MarkerSymbol }) {
  switch (symbol) {
    case 'flower':
      return <path d="M12 2.5c2.2 0 2.7 2.3 2.1 4 1.5-1 3.9-.8 4.6 1.2.7 2-1.2 3.4-3 3.5 1.6.6 2.8 2.7 1.5 4.5-1.3 1.8-3.5.9-4.4-.5-.1 1.8-1.5 3.7-3.7 3-2.1-.7-2.2-3.1-1.2-4.5-1.8.4-4-.6-4-2.8 0-2.2 2.2-3.1 3.9-2.6-.9-1.5-.7-3.9 1.4-4.6 1.2-.4 2.2.1 2.8.8Z" />
    case 'star':
      return <path d="m12 2.6 2.6 5.1 5.7.8-4.1 4 1 5.7-5.2-2.7-5.1 2.7 1-5.7-4.2-4 5.7-.8L12 2.6Z" />
    case 'diamond':
      return <path d="m12 2.7 8.4 9.3-8.4 9.3L3.6 12 12 2.7Z" />
    case 'spark':
      return <path d="M12 1.8c.8 5.8 2.4 8 8.2 8.8-5.8.8-7.4 3-8.2 8.8-.8-5.8-2.4-8-8.2-8.8C9.6 9.8 11.2 7.6 12 1.8Z" />
    case 'squircle':
      return <path d="M4.4 5.3C5.8 3.2 8 2.7 12 2.7s6.2.5 7.6 2.6c1.1 1.7 1.2 3.7 1.2 6.7s-.1 5-1.2 6.7c-1.4 2.1-3.6 2.6-7.6 2.6s-6.2-.5-7.6-2.6C3.3 17 3.2 15 3.2 12s.1-5 1.2-6.7Z" />
    default:
      return <circle cx="12" cy="12" r="8.2" />
  }
}

export default function MarkerIcon({
  symbol = 'dot',
  color = 'gray',
  size = 28,
  className = '',
}: {
  symbol?: MarkerSymbol
  color?: ColorToken
  size?: number
  className?: string
}) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      width={size}
      height={size}
      data-color-token={color}
      data-marker-symbol={symbol}
      className={`marker-icon ${className}`}
      fill="currentColor"
    >
      <Shape symbol={symbol} />
    </svg>
  )
}
