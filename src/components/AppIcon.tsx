import type { Icon, IconWeight } from '@phosphor-icons/react'
import { Alarm } from '@phosphor-icons/react/dist/icons/Alarm'
import { ArrowUpRight } from '@phosphor-icons/react/dist/icons/ArrowUpRight'
import { ArrowsClockwise } from '@phosphor-icons/react/dist/icons/ArrowsClockwise'
import { BellSimple } from '@phosphor-icons/react/dist/icons/BellSimple'
import { Briefcase } from '@phosphor-icons/react/dist/icons/Briefcase'
import { CalendarBlank } from '@phosphor-icons/react/dist/icons/CalendarBlank'
import { CalendarCheck } from '@phosphor-icons/react/dist/icons/CalendarCheck'
import { CalendarDots } from '@phosphor-icons/react/dist/icons/CalendarDots'
import { CaretDown } from '@phosphor-icons/react/dist/icons/CaretDown'
import { CaretLeft } from '@phosphor-icons/react/dist/icons/CaretLeft'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import { CaretUp } from '@phosphor-icons/react/dist/icons/CaretUp'
import { ChartPieSlice } from '@phosphor-icons/react/dist/icons/ChartPieSlice'
import { Check } from '@phosphor-icons/react/dist/icons/Check'
import { CheckCircle } from '@phosphor-icons/react/dist/icons/CheckCircle'
import { Clock } from '@phosphor-icons/react/dist/icons/Clock'
import { Compass } from '@phosphor-icons/react/dist/icons/Compass'
import { DotsSixVertical } from '@phosphor-icons/react/dist/icons/DotsSixVertical'
import { DotsThree } from '@phosphor-icons/react/dist/icons/DotsThree'
import { FolderSimple } from '@phosphor-icons/react/dist/icons/FolderSimple'
import { GearSix } from '@phosphor-icons/react/dist/icons/GearSix'
import { HouseSimple } from '@phosphor-icons/react/dist/icons/HouseSimple'
import { ListBullets } from '@phosphor-icons/react/dist/icons/ListBullets'
import { MagnifyingGlass } from '@phosphor-icons/react/dist/icons/MagnifyingGlass'
import { Palette } from '@phosphor-icons/react/dist/icons/Palette'
import { PencilSimple } from '@phosphor-icons/react/dist/icons/PencilSimple'
import { Plus } from '@phosphor-icons/react/dist/icons/Plus'
import { Receipt } from '@phosphor-icons/react/dist/icons/Receipt'
import { ShoppingBagOpen } from '@phosphor-icons/react/dist/icons/ShoppingBagOpen'
import { SlidersHorizontal } from '@phosphor-icons/react/dist/icons/SlidersHorizontal'
import { SquaresFour } from '@phosphor-icons/react/dist/icons/SquaresFour'
import { Sun } from '@phosphor-icons/react/dist/icons/Sun'
import { Trash } from '@phosphor-icons/react/dist/icons/Trash'
import { UsersThree } from '@phosphor-icons/react/dist/icons/UsersThree'
import { Wallet } from '@phosphor-icons/react/dist/icons/Wallet'
import { X } from '@phosphor-icons/react/dist/icons/X'

export type AppIconName =
  | 'dashboard'
  | 'tasks'
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
  | 'chevronUp'
  | 'palette'
  | 'clock'
  | 'month'
  | 'week'
  | 'list'
  | 'trash'
  | 'home'
  | 'folder'
  | 'people'
  | 'arrowUpRight'
  | 'more'
  | 'drag'
  | 'finance'
  | 'receipt'
  | 'work'

const icons: Record<AppIconName, Icon> = {
  dashboard: ChartPieSlice,
  tasks: CheckCircle,
  today: Sun,
  calendar: CalendarDots,
  shopping: ShoppingBagOpen,
  browse: Compass,
  settings: GearSix,
  search: MagnifyingGlass,
  plus: Plus,
  close: X,
  edit: PencilSimple,
  filter: SlidersHorizontal,
  bell: BellSimple,
  category: SquaresFour,
  reminder: Alarm,
  sync: ArrowsClockwise,
  check: Check,
  chevronLeft: CaretLeft,
  chevronRight: CaretRight,
  chevronDown: CaretDown,
  chevronUp: CaretUp,
  palette: Palette,
  clock: Clock,
  month: CalendarBlank,
  week: CalendarCheck,
  list: ListBullets,
  trash: Trash,
  home: HouseSimple,
  folder: FolderSimple,
  people: UsersThree,
  arrowUpRight: ArrowUpRight,
  more: DotsThree,
  drag: DotsSixVertical,
  finance: Wallet,
  receipt: Receipt,
  work: Briefcase,
}

export default function AppIcon({
  name,
  size = 22,
  className,
  weight = 'regular',
}: {
  name: AppIconName
  size?: number
  className?: string
  weight?: IconWeight
}) {
  const Glyph = icons[name]
  return (
    <Glyph
      aria-hidden
      size={size}
      weight={weight}
      className={className}
      mirrored={false}
    />
  )
}
