'use client'

import { type RefObject, useEffect } from 'react'

export function usePhoneSheetFocus(
  root: RefObject<HTMLElement | null>,
  panel: string | null,
  onClose: () => void,
) {
  useEffect(() => {
    const element = root.current
    if (panel === null || element === null) return
    const dialog = element.querySelector<HTMLElement>('[role="dialog"]')
    if (dialog === null) return
    const previousFocus = document.activeElement
    const background = [...element.children]
      .filter(
        (child): child is HTMLElement => child instanceof HTMLElement && !child.contains(dialog),
      )
      .map((child) => ({ child, inert: child.inert }))
    for (const { child } of background) child.inert = true
    const controls = () =>
      [
        ...dialog.querySelectorAll<HTMLElement>(
          'button, input, textarea, select, a[href], [tabindex]',
        ),
      ].filter(
        (control) =>
          control.tabIndex >= 0 &&
          !control.matches(':disabled') &&
          control.getClientRects().length > 0,
      )
    const first = () => controls()[0]?.focus({ preventScroll: true })
    first()
    const key = (event: KeyboardEvent) => {
      // The sheet owns keys before the table's window-level game shortcuts.
      event.stopPropagation()
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose()
      } else if (event.key === 'Tab') {
        const targets = controls()
        const next = event.shiftKey ? targets.at(-1) : targets[0]
        const edge = event.shiftKey ? targets[0] : targets.at(-1)
        if (document.activeElement === edge || !dialog.contains(document.activeElement)) {
          event.preventDefault()
          next?.focus()
        }
      }
    }
    const focus = (event: FocusEvent) => {
      if (event.target instanceof Node && !dialog.contains(event.target)) first()
    }
    document.addEventListener('keydown', key)
    document.addEventListener('focusin', focus)
    return () => {
      document.removeEventListener('keydown', key)
      document.removeEventListener('focusin', focus)
      for (const { child, inert } of background) child.inert = inert
      const target =
        previousFocus instanceof HTMLElement &&
        previousFocus.isConnected &&
        !previousFocus.matches(':disabled') &&
        previousFocus.closest('[inert]') === null
          ? previousFocus
          : element.querySelector<HTMLElement>('[aria-label="Table menu"]')
      target?.focus({ preventScroll: true })
    }
  }, [root, panel, onClose])
}
