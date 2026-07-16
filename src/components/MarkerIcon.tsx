import type { Icon } from '@phosphor-icons/react'
import {
  Circle,
  Diamond,
  Flower,
  Sparkle,
  Square,
  StarFour,
} from '@phosphor-icons/react'
import type { ColorToken, MarkerSymbol } from '../lib/db'

const markers: Record<MarkerSymbol, Icon> = {
  dot: Circle,
  flower: Flower,
  star: StarFour,
  diamond: Diamond,
  spark: Sparkle,
  squircle: Square,
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
  const Glyph = markers[symbol]
  return (
    <Glyph
      aria-hidden
      size={size}
      weight="fill"
      data-color-token={color}
      data-marker-symbol={symbol}
      className={`marker-icon ${className}`}
    />
  )
}
