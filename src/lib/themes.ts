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
    swatches: ['#dbe77d', '#dcd9ef', '#efeee9', '#20211f'],
  },
  {
    id: 'aqua-garden',
    name: '浅蓝花园',
    description: '浅蓝、叶绿与柔紫的冷静组合',
    swatches: ['#b9e2d2', '#cbdbe9', '#e9f0ed', '#18322b'],
  },
  {
    id: 'mono-green',
    name: '黑白青柠',
    description: '黑白基础配合克制的绿色强调',
    swatches: ['#cfe36f', '#dfe4d9', '#eceee8', '#181a18'],
  },
  {
    id: 'soft-mix',
    name: '柔和彩色',
    description: '紫、粉、浅黄和青色的柔和组合',
    swatches: ['#ead48f', '#d8cfeb', '#f0eaed', '#282225'],
  },
]

export function nextColorToken(current: ColorToken): ColorToken {
  return COLOR_TOKEN_ORDER[(COLOR_TOKEN_ORDER.indexOf(current) + 1) % COLOR_TOKEN_ORDER.length]
}

export function nextMarkerSymbol(current: MarkerSymbol | undefined): MarkerSymbol {
  const resolved = current ?? 'dot'
  return MARKER_SYMBOLS[(MARKER_SYMBOLS.indexOf(resolved) + 1) % MARKER_SYMBOLS.length]
}
