import type { ColorToken, MarkerSymbol, UIThemeId } from './db'

export const COLOR_TOKEN_ORDER: ColorToken[] = [
  'gray',
  'blue',
  'green',
  'orange',
  'pink',
  'purple',
]

export const MARKER_SYMBOLS: MarkerSymbol[] = [
  'dot',
  'flower',
  'star',
  'diamond',
  'spark',
  'squircle',
]

export const MARKER_LABELS: Record<MarkerSymbol, string> = {
  dot: '圆点',
  flower: '花形',
  star: '星形',
  diamond: '菱形',
  spark: '闪光',
  squircle: '圆角方块',
}

export const UI_THEMES: Array<{
  id: UIThemeId
  name: string
  description: string
  swatches: [string, string, string, string]
}> = [
  {
    id: 'violet-lime',
    name: '紫绿日程',
    description: '参考图主配色，清爽且有明确对比',
    swatches: ['#aaa3df', '#c8dc7b', '#d9eef1', '#222421'],
  },
  {
    id: 'aqua-garden',
    name: '浅蓝花园',
    description: '浅蓝、叶绿与柔紫的冷静组合',
    swatches: ['#8bdde1', '#b8df8a', '#c0b9e8', '#19302b'],
  },
  {
    id: 'mono-green',
    name: '黑白青柠',
    description: '黑白基础配合克制的绿色强调',
    swatches: ['#b8d36a', '#dce8c5', '#f1f2ee', '#181a18'],
  },
  {
    id: 'soft-mix',
    name: '柔和彩色',
    description: '紫、粉、浅黄和青色的柔和组合',
    swatches: ['#b7afe7', '#efc7bd', '#f1d77d', '#9edfe1'],
  },
]

export function nextColorToken(current: ColorToken): ColorToken {
  return COLOR_TOKEN_ORDER[(COLOR_TOKEN_ORDER.indexOf(current) + 1) % COLOR_TOKEN_ORDER.length]
}

export function nextMarkerSymbol(current: MarkerSymbol | undefined): MarkerSymbol {
  const resolved = current ?? 'dot'
  return MARKER_SYMBOLS[(MARKER_SYMBOLS.indexOf(resolved) + 1) % MARKER_SYMBOLS.length]
}
