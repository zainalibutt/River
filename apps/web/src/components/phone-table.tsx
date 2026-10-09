'use client'

import { DEFAULT_STAKE, type TurnAction } from '@river/engine'
import type { RoomView } from '@river/server'
import { type CSSProperties, type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { BETTING_ICON } from '@/components/betting-icons'
import { RiverHandHistory } from '@/components/river-hand-history'
import { RiverSettings } from '@/components/river-settings'
import { RollingAmount } from '@/components/rolling-amount'
import { Table2D, type Table2DProps } from '@/components/table-2d/table-2d'
import { CardBack, PlayingCard } from '@/components/table-pieces'
import { sizingPresets } from '@/lib/betting'
import type { SessionHand } from '@/lib/history'
import { phoneGeometry } from '@/lib/phone-layout'
import { censorProfanity, type Preferences } from '@/lib/preferences'
import { formatAmount } from '@/lib/presentation'
import { PRESET_LABELS, type PresetKind } from '@/lib/preset'
import { CHAT_MAX_LENGTH, type SocialFeedEntry } from '@/lib/social'
import { tableSound } from '@/lib/table-sound'
import { usePhoneSheetFocus } from '@/lib/use-phone-sheet-focus'
import { useVisibleViewport } from '@/lib/use-visible-viewport'
import './phone-table.css'

type Panel = 'menu' | 'chat' | 'history' | 'settings' | 'verify' | 'invite' | 'raise' | 'account'

export interface PhoneTableProps {
  view: RoomView
  /** Your stack as it should read now: until a showdown pays, without what it will pay you. */
  heroStack: number | null
  /** Whether the showdown is telling your hand right now. */
  heroShowing: boolean
  viewport: { width: number; height: number }
  table: Omit<Table2DProps, 'view' | 'geometry'>
  peek: boolean
  onPeek: (held: boolean) => void
  localTurn: boolean
  connected: boolean
  status: string | null
  waitingActions: ReactNode
  raiseTo: number
  onRaiseTo: (value: number) => void
  onAction: (action: TurnAction) => void
  preset: PresetKind | null
  onPreset: (preset: PresetKind | null) => void
  presetArmable: boolean
  onLeave: () => void
  leaveLabel: string
  leaveDisabled: boolean
  preferences: Preferences
  onPreferences: (next: Preferences) => void
  hands: readonly SessionHand[]
  feed: readonly SocialFeedEntry[]
  unread: number
  onChatOpen: (open: boolean) => void
  chatDraft: string
  onChatDraft: (value: string) => void
  onSendChat: () => void
  onInvite: () => Promise<void>
  /** Friends to invite by name, beside the link; null for a guest. */
  inviteFriends: ReactNode
  verifyContent: ReactNode
  accountContent: (onClose: () => void) => ReactNode
  onAccount: () => void
  /** A guest with chips worth keeping: offer to save them, once, in the status line. */
  askToSave: boolean
  onNotNowSave: () => void
  /** The showdown as it is told, over the felt; null between showdowns. */
  showdownStage: ReactNode
}

export function PhoneTable(props: PhoneTableProps) {
  const { view, peek, onPeek } = props
  const [panel, setPanel] = useState<Panel | null>(null)
  const [inspected, setInspected] = useState<number | null>(null)
  const visibleViewport = useVisibleViewport()
  const root = useRef<HTMLElement | null>(null)
  const [safeInset, setSafeInset] = useState(0)
  const geometry = phoneGeometry(props.viewport.width, props.viewport.height - safeInset)
  const hero = view.seats.find((seat) => seat.playerId === view.selfId)
  const holding = hero?.hasHole && hero.hole !== null
  const legal = props.localTurn ? view.legal : null
  const bigBlind = props.table.bigBlind ?? null
  const turnKey = props.table.turnKey
  const lastTurn = useRef(turnKey)
  const close = useCallback(() => setPanel(null), [])
  usePhoneSheetFocus(root, panel, close)
  const open = (next: Panel) => {
    onPeek(false)
    setInspected(null)
    setPanel(next)
  }

  useEffect(() => {
    const element = root.current
    if (element === null) return
    const measure = () => {
      const style = getComputedStyle(element)
      setSafeInset(Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    props.onChatOpen(panel === 'chat')
    return () => props.onChatOpen(false)
  }, [panel, props.onChatOpen])

  useEffect(() => {
    if (lastTurn.current !== turnKey) {
      lastTurn.current = turnKey
      setPanel((current) => (current === 'raise' ? null : current))
      onPeek(false)
    }
  }, [turnKey, onPeek])

  useEffect(() => {
    const release = () => onPeek(false)
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setPanel(null)
        release()
      }
    }
    window.addEventListener('blur', release)
    document.addEventListener('visibilitychange', release)
    window.addEventListener('keydown', key)
    return () => {
      release()
      window.removeEventListener('blur', release)
      document.removeEventListener('visibilitychange', release)
      window.removeEventListener('keydown', key)
    }
  }, [onPeek])

  const min = legal?.raiseTo.min ?? 0
  const max = legal?.allIn.amount ?? min
  const amount = Math.min(max, Math.max(min, props.raiseTo))
  const sizeRaise = (value: number) => {
    if (Math.min(max, Math.max(min, value)) !== amount) {
      tableSound.play('wheel_tick')
    }
    props.onRaiseTo(value)
  }
  const sizes =
    legal === null
      ? []
      : sizingPresets({
          pot: view.pot,
          currentBet: view.currentBet,
          toCall: legal.call.amount,
          minRaiseTo: min,
          allInTo: max,
        })
  const inspectedSeat = view.seats.find((seat) => seat.seat === inspected)

  return (
    <section
      ref={root}
      className="phone-table"
      aria-label="River poker table"
      style={
        { '--phone-keyboard-inset': `${visibleViewport?.bottomInset ?? 0}px` } as CSSProperties
      }
    >
      <header className="phone-header" data-phone-region="header">
        <PhoneHold
          className="phone-leave"
          onComplete={props.onLeave}
          disabled={props.leaveDisabled}
          label="Hold to leave table"
        >
          {props.leaveLabel}
        </PhoneHold>
        <div className="phone-pot" role="status">
          <span>
            POT{' '}
            <strong>
              <RollingAmount value={view.pot} abbreviated={false} bigBlind={bigBlind} />
            </strong>
          </span>
          <small>
            {DEFAULT_STAKE.smallBlind} / {DEFAULT_STAKE.bigBlind} ·{' '}
            <span className={`phone-network ${props.connected ? 'connected' : 'reconnecting'}`}>
              {props.connected ? 'LIVE' : 'LINK'}
            </span>
          </small>
        </div>
        <button
          type="button"
          aria-label="Table menu"
          aria-expanded={panel !== null}
          onClick={() => (panel === null ? open('menu') : close())}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
          {props.unread > 0 ? <i className="phone-unread" /> : null}
        </button>
      </header>
      <div
        className="phone-felt"
        style={{ height: geometry.stage.height }}
        data-phone-region="table"
      >
        <Table2D
          {...props.table}
          view={view}
          geometry={geometry}
          platesHeld
          phone
          onSelect={setInspected}
        />
        {props.showdownStage}
        {inspectedSeat?.playerId ? (
          <button className="phone-inspected" type="button" onClick={() => setInspected(null)}>
            {inspectedSeat.name} · {formatAmount(inspectedSeat.stack, false, bigBlind)} · Close
          </button>
        ) : null}
      </div>
      <p className="phone-status" aria-live="polite" data-phone-region="status">
        {props.askToSave && !props.status ? (
          <>
            <button type="button" className="phone-save" onClick={() => open('account')}>
              Save your progress
            </button>
            <button type="button" className="phone-save-dismiss" onClick={props.onNotNowSave}>
              Not now
            </button>
          </>
        ) : (
          props.status
        )}
      </p>
      <footer className="phone-dock" data-phone-region="dock">
        <div className={`phone-hand${props.heroShowing ? ' showing' : ''}`}>
          <div>
            <span>{hero?.name ?? 'Take your place'}</span>
            <strong>
              {hero ? (
                <RollingAmount
                  value={props.heroStack ?? hero.stack}
                  abbreviated={false}
                  bigBlind={bigBlind}
                />
              ) : (
                'Joining table…'
              )}
            </strong>
            <small>
              {hero?.dealer && view.seats.length === 2 ? 'DEALER · ' : ''}
              In {formatAmount(hero?.betStreet ?? 0, true, bigBlind)}
            </small>
          </div>
          <button
            type="button"
            className="phone-peek"
            disabled={!holding || hero?.folded === true || panel !== null}
            aria-label="Press and hold to look at your cards"
            aria-pressed={peek && holding}
            onContextMenu={(event) => event.preventDefault()}
            onPointerDown={(event) => {
              if (event.button !== 0 || !holding) return
              event.preventDefault()
              event.currentTarget.setPointerCapture(event.pointerId)
              onPeek(true)
            }}
            onPointerUp={() => onPeek(false)}
            onPointerCancel={() => onPeek(false)}
            onLostPointerCapture={() => onPeek(false)}
            onKeyDown={(event) => {
              if (event.key === ' ' || event.key === 'Enter') {
                event.preventDefault()
                onPeek(true)
              }
            }}
            onKeyUp={() => onPeek(false)}
            onBlur={() => onPeek(false)}
          >
            <span className="phone-card-backs">
              <CardBack />
              <CardBack />
            </span>
            <span>Hold to peek</span>
          </button>
        </div>
        <section
          className="phone-actions"
          aria-label={legal === null ? 'Waiting actions' : 'Your actions'}
        >
          {legal !== null ? (
            <>
              <button
                type="button"
                className="phone-fold"
                disabled={!props.connected || !legal.fold.enabled}
                onClick={() => props.onAction({ kind: 'fold' })}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  {BETTING_ICON.fold}
                </svg>
                <span>Fold</span>
              </button>
              <button
                type="button"
                className={`phone-call${legal.check.enabled ? ' phone-check' : ''}`}
                disabled={!props.connected || !(legal.check.enabled || legal.call.enabled)}
                onClick={() =>
                  props.onAction(legal.check.enabled ? { kind: 'check' } : { kind: 'call' })
                }
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  {legal.check.enabled ? BETTING_ICON.check : BETTING_ICON.call}
                </svg>
                <span>
                  {legal.check.enabled ? 'Check' : 'Call'}
                  {legal.check.enabled ? null : (
                    <small>{formatAmount(legal.call.amount, false, bigBlind)}</small>
                  )}
                </span>
              </button>
              {legal.raiseTo.enabled ? (
                <button
                  type="button"
                  className="phone-raise"
                  disabled={!props.connected}
                  onClick={() => open('raise')}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    {BETTING_ICON.raise}
                  </svg>
                  <span>Raise</span>
                </button>
              ) : (
                <PhoneHold
                  key={turnKey}
                  className="phone-raise"
                  disabled={!props.connected || !legal.allIn.enabled}
                  onComplete={() => props.onAction({ kind: 'allIn' })}
                  label="Hold to go all in"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    {BETTING_ICON.allIn}
                  </svg>
                  <span>All in</span>
                </PhoneHold>
              )}
            </>
          ) : props.presetArmable ? (
            (['fold', 'check-fold', 'call-any'] as const).map((preset) => (
              <button
                type="button"
                key={preset}
                className={`phone-preset ${preset === 'fold' ? 'phone-fold' : preset === 'call-any' ? 'phone-call' : 'phone-check'}`}
                aria-pressed={props.preset === preset}
                onClick={() => props.onPreset(props.preset === preset ? null : preset)}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  {preset === 'fold'
                    ? BETTING_ICON.fold
                    : preset === 'call-any'
                      ? BETTING_ICON.call
                      : BETTING_ICON.checkFold}
                </svg>
                <span>{PRESET_LABELS[preset]}</span>
              </button>
            ))
          ) : (
            props.waitingActions
          )}
        </section>
        {props.localTurn && view.turnBudgetMs !== null ? (
          <progress
            className="phone-turn-progress"
            aria-label="Time left to act"
            max={view.turnBudgetMs}
            value={props.table.turnRemaining ?? 0}
          />
        ) : null}
        <span className="phone-turn-label">
          {props.localTurn
            ? 'Your turn'
            : view.phase === 'hand'
              ? 'Waiting for the table'
              : 'Ready when you are'}
        </span>
      </footer>
      {peek && holding && hero.hole !== null && panel === null ? (
        <section className="phone-peek-display" aria-label="Your enlarged cards">
          <div>
            {hero.hole.map((card) => (
              <PlayingCard key={`${card.rank}${card.suit}`} card={card} />
            ))}
          </div>
          <span>YOUR HAND</span>
        </section>
      ) : null}
      {panel === 'history' ? (
        <RiverHandHistory
          hands={props.hands}
          selfId={view.selfId}
          bigBlind={bigBlind}
          onClose={close}
        />
      ) : panel !== null ? (
        <div className="phone-sheet-backdrop">
          <section
            className={`phone-sheet${panel === 'raise' ? ' phone-raise-sheet' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="phone-sheet-title"
          >
            <header>
              <h2 id="phone-sheet-title">
                {panel === 'raise'
                  ? 'Raise to'
                  : panel === 'menu'
                    ? 'At the table'
                    : panel === 'chat'
                      ? 'Table chat'
                      : panel === 'verify'
                        ? 'Fairness'
                        : panel === 'invite'
                          ? 'Invite friends'
                          : panel === 'account'
                            ? 'Keep your chips'
                            : 'Settings'}
              </h2>
              <button type="button" onClick={close} aria-label="Close panel">
                Close
              </button>
            </header>
            {panel === 'menu' ? (
              <nav className="phone-menu" aria-label="Table panels">
                <button type="button" onClick={() => open('chat')}>
                  Chat{props.unread > 0 ? ` · ${props.unread} new` : ''}
                </button>
                <button type="button" onClick={() => open('history')}>
                  Hand history · {props.hands.length}
                </button>
                <button type="button" onClick={() => open('settings')}>
                  Settings
                </button>
                <button
                  type="button"
                  disabled={view.commit === null}
                  onClick={() => open('verify')}
                >
                  Verify hand
                </button>
                <button type="button" onClick={() => open('invite')}>
                  Invite friends
                </button>
                <button
                  type="button"
                  onClick={() => {
                    props.onAccount()
                    open('account')
                  }}
                >
                  Log in
                </button>
              </nav>
            ) : null}
            {panel === 'settings' ? (
              <RiverSettings preferences={props.preferences} onChange={props.onPreferences} />
            ) : null}
            {panel === 'chat' ? (
              <>
                <ol className="phone-chat-feed" aria-live="polite">
                  {props.feed.map((entry) => (
                    <li key={entry.id}>
                      <strong>{entry.name}</strong>
                      <span>
                        {props.preferences.censorProfanity
                          ? censorProfanity(entry.text)
                          : entry.text}
                      </span>
                    </li>
                  ))}
                </ol>
                <form
                  className="phone-chat-entry"
                  onSubmit={(event) => {
                    event.preventDefault()
                    props.onSendChat()
                  }}
                >
                  <label className="visually-hidden" htmlFor="phone-chat">
                    Message the table
                  </label>
                  <input
                    id="phone-chat"
                    autoComplete="off"
                    placeholder="Say something"
                    value={props.chatDraft}
                    onChange={(event) => props.onChatDraft(event.target.value)}
                    maxLength={CHAT_MAX_LENGTH}
                  />
                  <button type="submit" disabled={!props.connected}>
                    Send
                  </button>
                </form>
              </>
            ) : null}
            {panel === 'invite' ? (
              <>
                <p>Share this code or copy the link to your table.</p>
                <strong className="phone-invite-code">{view.inviteCode || 'Connecting…'}</strong>
                <button
                  type="button"
                  disabled={!view.inviteCode}
                  onClick={() => void props.onInvite()}
                >
                  Copy invite link
                </button>
                {props.inviteFriends}
              </>
            ) : null}
            {panel === 'verify' ? props.verifyContent : null}
            {panel === 'account' ? props.accountContent(close) : null}
            {panel === 'raise' && legal !== null ? (
              <>
                <output className="phone-raise-amount">
                  {formatAmount(amount, false, bigBlind)}
                </output>
                <label
                  className="phone-raise-slider"
                  style={
                    {
                      '--phone-raise-progress': `${max === min ? 0 : ((amount - min) / (max - min)) * 100}%`,
                    } as CSSProperties
                  }
                >
                  <span className="visually-hidden">Raise amount</span>
                  <input
                    type="range"
                    min={min}
                    max={max}
                    step={1}
                    value={amount}
                    onChange={(event) => sizeRaise(Number(event.target.value))}
                  />
                </label>
                <div className="phone-sizing">
                  {sizes.map((size) => (
                    <button
                      type="button"
                      key={size.id}
                      aria-pressed={amount === size.amount}
                      onClick={() => sizeRaise(size.amount)}
                    >
                      {size.label}
                    </button>
                  ))}
                </div>
                <div className="phone-confirm">
                  <PhoneHold
                    key={turnKey}
                    className="phone-all-in"
                    disabled={!props.connected || !legal.allIn.enabled}
                    label="Hold to go all in"
                    onComplete={() => {
                      props.onAction({ kind: 'allIn' })
                      close()
                    }}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      {BETTING_ICON.allIn}
                    </svg>
                    <span>Hold all in</span>
                  </PhoneHold>
                  <button
                    type="button"
                    className="phone-call phone-confirm-raise"
                    disabled={!props.connected || amount >= max}
                    onClick={() => {
                      props.onAction({ kind: 'raiseTo', to: amount })
                      close()
                    }}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      {BETTING_ICON.raise}
                    </svg>
                    <span>
                      {amount >= max
                        ? 'Hold all in to confirm'
                        : `Confirm ${formatAmount(amount, false, bigBlind)}`}
                    </span>
                  </button>
                </div>
              </>
            ) : null}
          </section>
        </div>
      ) : null}
    </section>
  )
}

function PhoneHold({
  children,
  onComplete,
  label,
  className,
  disabled = false,
}: {
  children: ReactNode
  onComplete: () => void
  label: string
  className: string
  disabled?: boolean
}) {
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [holding, setHolding] = useState(false)
  const cancel = useCallback(() => {
    if (timeout.current !== null) clearTimeout(timeout.current)
    timeout.current = null
    setHolding(false)
  }, [])
  const begin = () => {
    if (disabled || timeout.current !== null) return
    setHolding(true)
    timeout.current = setTimeout(() => {
      cancel()
      onComplete()
    }, 600)
  }
  useEffect(() => {
    const release = () => {
      if (timeout.current !== null) clearTimeout(timeout.current)
      timeout.current = null
      setHolding(false)
    }
    window.addEventListener('blur', release)
    document.addEventListener('visibilitychange', release)
    return () => {
      release()
      window.removeEventListener('blur', release)
      document.removeEventListener('visibilitychange', release)
    }
  }, [])
  useEffect(() => {
    if (disabled) cancel()
  }, [disabled, cancel])
  return (
    <button
      type="button"
      className={`${className} phone-hold${holding ? ' holding' : ''}`}
      disabled={disabled}
      aria-label={label}
      style={{ '--hold-duration': '600ms' } as CSSProperties}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        if (event.button !== 0) return
        event.currentTarget.setPointerCapture(event.pointerId)
        begin()
      }}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onPointerLeave={cancel}
      onKeyDown={(event) => {
        if (!event.repeat && (event.key === ' ' || event.key === 'Enter')) {
          event.preventDefault()
          begin()
        }
      }}
      onKeyUp={cancel}
      onBlur={cancel}
    >
      {children}
    </button>
  )
}
