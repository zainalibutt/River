import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'

export function HoldAction({
  duration,
  disabled = false,
  className,
  style,
  ariaLabel,
  keyShortcut,
  onComplete,
  onAnimationEnd,
  children,
}: {
  duration: number
  disabled?: boolean
  className: string
  style?: CSSProperties
  ariaLabel?: string
  /** The key that does the same, announced to assistive technology. */
  keyShortcut?: string | undefined
  onComplete: () => void
  onAnimationEnd?: () => void
  children: React.ReactNode
}) {
  const timeout = useRef<number | null>(null)
  const [holding, setHolding] = useState(false)
  const cancel = useCallback(() => {
    if (timeout.current !== null) window.clearTimeout(timeout.current)
    timeout.current = null
    setHolding(false)
  }, [])
  // Held with a pointer or with Space or Enter: a control that can only be held by a hand
  // on a mouse is one a keyboard can never reach.
  const begin = () => {
    if (disabled || timeout.current !== null) return
    if (duration === 0) {
      onComplete()
      return
    }
    setHolding(true)
    timeout.current = window.setTimeout(() => {
      timeout.current = null
      setHolding(false)
      onComplete()
    }, duration)
  }
  useEffect(() => cancel, [cancel])
  return (
    <button
      type="button"
      className={`${className}${holding ? ' holding' : ''}`}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-keyshortcuts={keyShortcut}
      style={{ ...style, '--hold-duration': `${duration}ms` } as CSSProperties}
      onPointerDown={(event: ReactPointerEvent<HTMLButtonElement>) => {
        if (event.button !== 0) return
        event.currentTarget.setPointerCapture(event.pointerId)
        begin()
      }}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onKeyDown={(event) => {
        if (!event.repeat && (event.key === ' ' || event.key === 'Enter')) {
          event.preventDefault()
          begin()
        }
      }}
      onKeyUp={cancel}
      onBlur={cancel}
      onAnimationEnd={onAnimationEnd}
    >
      {children}
    </button>
  )
}
