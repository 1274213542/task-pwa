import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import AppIcon from './AppIcon'
import { maskAmountText } from '../lib/amountPrivacy'

type AmountPrivacyContextValue = {
  visible: boolean
  pending: boolean
  setVisible: (visible: boolean) => Promise<void>
  toggle: () => Promise<void>
}

const AmountPrivacyContext = createContext<AmountPrivacyContextValue | null>(null)

export function AmountPrivacyProvider({
  visible: persistedVisible,
  onVisibleChange,
  children,
}: {
  visible: boolean
  onVisibleChange: (visible: boolean) => Promise<unknown>
  children: ReactNode
}) {
  const [optimisticVisible, setOptimisticVisible] = useState<boolean | null>(null)
  const [pending, setPending] = useState(false)
  const visible = optimisticVisible ?? persistedVisible

  useEffect(() => {
    if (optimisticVisible === persistedVisible) setOptimisticVisible(null)
  }, [optimisticVisible, persistedVisible])

  const setVisible = useCallback(async (nextVisible: boolean) => {
    if (pending || nextVisible === visible) return
    setOptimisticVisible(nextVisible)
    setPending(true)
    try {
      await onVisibleChange(nextVisible)
    } catch (error) {
      setOptimisticVisible(null)
      throw error
    } finally {
      setPending(false)
    }
  }, [onVisibleChange, pending, visible])

  const value = useMemo<AmountPrivacyContextValue>(() => ({
    visible,
    pending,
    setVisible,
    toggle: () => setVisible(!visible),
  }), [pending, setVisible, visible])

  return (
    <AmountPrivacyContext.Provider value={value}>
      {children}
    </AmountPrivacyContext.Provider>
  )
}

function useAmountPrivacy() {
  const value = useContext(AmountPrivacyContext)
  if (!value) throw new Error('useAmountPrivacy 必须在 AmountPrivacyProvider 内使用')
  return value
}

export function PrivateAmount({
  children,
  className,
  hiddenText,
}: {
  children: string | number
  className?: string
  hiddenText?: string
}) {
  const { visible } = useAmountPrivacy()
  const rendered = visible ? children : (hiddenText ?? maskAmountText(children))
  return (
    <span
      className={`private-amount${className ? ` ${className}` : ''}`}
      data-amount-hidden={!visible || undefined}
      aria-label={visible ? undefined : '金额已隐藏'}
    >
      {rendered}
    </span>
  )
}

export function AmountPrivacyToggle({
  className,
  compact = false,
}: {
  className?: string
  compact?: boolean
}) {
  const { visible, pending, toggle } = useAmountPrivacy()
  return (
    <button
      type="button"
      className={`amount-privacy-toggle${compact ? ' is-compact' : ''}${className ? ` ${className}` : ''}`}
      aria-label={visible ? '隐藏所有金额' : '显示所有金额'}
      aria-pressed={!visible}
      disabled={pending}
      data-amounts-visible={visible || undefined}
      onClick={() => void toggle()}
    >
      <AppIcon name={visible ? 'eye' : 'eyeOff'} size={compact ? 18 : 20} />
    </button>
  )
}
