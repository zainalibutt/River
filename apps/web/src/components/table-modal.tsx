'use client'

import { type ReactNode, useRef } from 'react'
import { useDialogFocus } from '@/lib/use-dialog-focus'

/** A modal over the desktop table: backdrop, dialog semantics and keyboard handling. */
export function TableModal({
  className,
  labelledBy,
  onClose,
  children,
}: {
  className: string
  labelledBy: string
  onClose: () => void
  children: ReactNode
}) {
  const dialog = useRef<HTMLElement | null>(null)
  useDialogFocus(dialog, onClose)
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        ref={dialog}
        className={`modal ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
      >
        {children}
      </section>
    </div>
  )
}
