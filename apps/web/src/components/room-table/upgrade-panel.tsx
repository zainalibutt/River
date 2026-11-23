import type { FormEvent } from 'react'

export type UpgradeState = 'idle' | 'editing' | 'sent' | 'expired' | 'error' | 'complete'

export function UpgradePanel({
  state,
  email,
  onEmail,
  onSubmit,
  onRetry,
  onClose,
}: {
  state: UpgradeState
  email: string
  onEmail: (value: string) => void
  onSubmit: (event: FormEvent) => void
  onRetry: () => void
  onClose: () => void
}) {
  if (state === 'sent')
    return (
      <aside className="upgrade-panel" aria-live="polite">
        <strong>CHECK YOUR EMAIL.</strong>
        <span>You can keep playing while River saves your progress.</span>
        <button type="button" onClick={onClose}>
          DONE
        </button>
      </aside>
    )
  if (state === 'complete')
    return (
      <aside className="upgrade-panel positive" aria-live="polite">
        <strong>PROGRESS SAVED.</strong>
        <span>Your seat, stack and history stayed put.</span>
        <button type="button" onClick={onClose}>
          DONE
        </button>
      </aside>
    )
  if (state === 'expired' || state === 'error')
    return (
      <aside className="upgrade-panel" aria-live="polite">
        <strong>
          {state === 'expired'
            ? 'THAT SIGN-IN LINK HAS EXPIRED.'
            : 'RIVER COULD NOT SEND THAT LINK.'}
        </strong>
        <span>You are still playing as a guest. Your chips are safe.</span>
        <button type="button" onClick={onRetry}>
          SEND A FRESH LINK
        </button>
      </aside>
    )
  return (
    <form className="upgrade-panel" onSubmit={onSubmit}>
      <label htmlFor="save-email">SAVE YOUR PROGRESS</label>
      <input
        id="save-email"
        type="email"
        value={email}
        onChange={(event) => onEmail(event.target.value)}
        placeholder="you@email.com"
        required
      />
      <button type="submit">SEND MAGIC LINK</button>
      <button type="button" onClick={onClose}>
        NOT NOW
      </button>
      {/* A new tab, so reading it never costs the seat. */}
      <a className="upgrade-privacy" href="/privacy" target="_blank" rel="noopener">
        How River uses your email
      </a>
    </form>
  )
}
