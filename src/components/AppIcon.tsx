import type { Icon, IconWeight } from '@phosphor-icons/react'
import {
  Alarm,
  ArrowUpRight,
  ArrowsClockwise,
  BellSimple,
  CalendarBlank,
  CalendarCheck,
  CalendarDots,
  CaretDown,
  CaretLeft,
  CaretRight,
  Check,
  Clock,
  Compass,
  FolderSimple,
  GearSix,
  HouseSimple,
  ListBullets,
  MagnifyingGlass,
  Palette,
  PencilSimple,
  Plus,
  ShoppingBagOpen,
  SlidersHorizontal,
  SquaresFour,
  Sun,
  Trash,
  UsersThree,
  X,
} from '@phosphor-icons/react'

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
  | 'home'
  | 'folder'
  | 'people'
  | 'arrowUpRight'

const icons: Record<AppIconName, Icon> = {
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
