/**
 * Whether the last input was a key rather than a pointer. A keyboard player
 * whose focus was dropped - the DEAL button they pressed is gone - is put back
 * on their actions when the turn comes; a mouse player's focus is left alone.
 */
let keyboardDriven = false

export function setKeyboardDriven(value: boolean): void {
  keyboardDriven = value
}

export function isKeyboardDriven(): boolean {
  return keyboardDriven
}

/** The first control a keyboard player can press in the action area. */
export function focusFirstAction(): boolean {
  const target = document.querySelector<HTMLElement>(
    '.action-menu button:not(:disabled), .raise-layer button:not(:disabled), .ram button:not(:disabled)',
  )
  target?.focus({ preventScroll: true })
  return target !== null
}
