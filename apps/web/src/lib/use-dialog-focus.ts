'use client'

import { type RefObject, useEffect, useRef } from 'react'

/** Controls a keyboard can reach inside an element, in document order. */
export function focusableIn(element: HTMLElement): HTMLElement[] {
  return [
    ...element.querySelectorAll<HTMLElement>(
      'button, input, textarea, select, a[href], [tabindex]',
    ),
  ].filter(
    (control) =>
      control.tabIndex >= 0 && !control.matches(':disabled') && control.getClientRects().length > 0,
  )
}

/**
 * A desktop dialog over the table behaves as a dialog: focus moves in when it
 * opens, Tab stays inside it, Escape closes it, and focus goes back to where it
 * was when it closes. While it is open it owns the keyboard, so the table's
 * window-level shortcuts (C to call, Space to peek) cannot act behind it.
 *
 * The phone sheets have their own version, usePhoneSheetFocus, which also
 * makes the rest of the phone layout inert.
 */
export function useDialogFocus(dialog: RefObject<HTMLElement | null>, onClose: () => void) {
  // Held in a ref so a parent passing a fresh closure every render does not
  // re-run the effect and throw focus back to the first control each time.
  const close = useRef(onClose)
  close.current = onClose

  useEffect(() => {
    const element = dialog.current
    if (element === null) return
    const previousFocus = document.activeElement
    const first = () => (focusableIn(element)[0] ?? element).focus({ preventScroll: true })
    first()
    const key = (event: KeyboardEvent) => {
      event.stopPropagation()
      if (event.key === 'Escape') {
        event.preventDefault()
        close.current()
      } else if (event.key === 'Tab') {
        const targets = focusableIn(element)
        const next = event.shiftKey ? targets.at(-1) : targets[0]
        const edge = event.shiftKey ? targets[0] : targets.at(-1)
        if (document.activeElement === edge || !element.contains(document.activeElement)) {
          event.preventDefault()
          next?.focus()
        }
      }
    }
    const focus = (event: FocusEvent) => {
      if (event.target instanceof Node && !element.contains(event.target)) first()
    }
    document.addEventListener('keydown', key)
    document.addEventListener('focusin', focus)
    return () => {
      document.removeEventListener('keydown', key)
      document.removeEventListener('focusin', focus)
      if (
        previousFocus instanceof HTMLElement &&
        previousFocus.isConnected &&
        !previousFocus.matches(':disabled')
      ) {
        previousFocus.focus({ preventScroll: true })
      }
    }
  }, [dialog])
}
