import type { ColorToken, MarkerSymbol } from '../lib/db'
import {
  COLOR_TOKEN_ORDER,
  MARKER_LABELS,
  MARKER_SYMBOLS,
} from '../lib/themes'
import MarkerIcon from './MarkerIcon'

export default function VisualPicker({
  color,
  marker,
  onColorChange,
  onMarkerChange,
  allowInherit = true,
}: {
  color?: ColorToken
  marker?: MarkerSymbol
  onColorChange: (value: ColorToken | undefined) => void
  onMarkerChange: (value: MarkerSymbol | undefined) => void
  allowInherit?: boolean
}) {
  const previewColor = color ?? 'gray'
  return (
    <fieldset className="visual-picker">
      <legend>卡片颜色与标记</legend>
      <div className="visual-picker-row" aria-label="颜色">
        {COLOR_TOKEN_ORDER.map((token) => (
          <button
            key={token}
            type="button"
            aria-label={`选择 ${token} 颜色`}
            aria-pressed={color === token}
            data-color-token={token}
            className="visual-color-button"
            onClick={() => onColorChange(token)}
          />
        ))}
      </div>
      <div className="visual-picker-row marker-picker-row" aria-label="小图标">
        {MARKER_SYMBOLS.map((symbol) => (
          <button
            key={symbol}
            type="button"
            title={MARKER_LABELS[symbol]}
            aria-label={`选择${MARKER_LABELS[symbol]}`}
            aria-pressed={marker === symbol}
            className="visual-marker-button"
            onClick={() => onMarkerChange(symbol)}
          >
            <MarkerIcon symbol={symbol} color={previewColor} size={23} />
          </button>
        ))}
      </div>
      {allowInherit && (color || marker) && (
        <button
          type="button"
          className="visual-reset-button"
          onClick={() => {
            onColorChange(undefined)
            onMarkerChange(undefined)
          }}
        >
          使用分类或主题默认样式
        </button>
      )}
    </fieldset>
  )
}
