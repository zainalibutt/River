import { DEFAULT_STAKE, type TurnAction } from '@river/engine'
import type { RoomView } from '@river/server'
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from 'react'
import { BETTING_ICON as MENU_ICON } from '@/components/betting-icons'
import { HoldAction } from '@/components/room-table/hold-action'
import { focusFirstAction, isKeyboardDriven } from '@/components/room-table/keyboard-focus'
import { sizingPresets } from '@/lib/betting'
import { coachLine, firstHandPlayed } from '@/lib/first-hand'
import { formatAmount } from '@/lib/presentation'
import { PRESET_LABELS, type PresetKind } from '@/lib/preset'
import type { SeatRequest } from '@/lib/seat-request'
import { tableSound } from '@/lib/table-sound'

type MenuSlot = 'call' | 'raise' | 'fold'

/**
 * The action menu: three buttons, fixed at the lower centre of the screen.
 *
 * Call or check at the top left, bet or raise at the top right, fold at the
 * bottom. The slots never move, so fold is in the same place whether or not a
 * raise is legal. Before your turn the same three buttons arm presets, ghosted,
 * which keeps every action in one place instead of a second row of chips.
 * Raising opens a layer in the same spot rather than a second surface.
 */
export function ActionMenu({
  view,
  localTurn,
  raiseTo,
  onRaiseTo,
  onAction,
  onDeal,
  rebuyAmount,
  onRebuy,
  onStand,
  pendingSeat,
  balance,
  claimsEnabled,
  onClaimDaily,
  onClaimRescue,
  canDeal,
  seated,
  kicked,
  rejoinLabel,
  onRejoin,
  preset,
  onPreset,
  presetArmable,
  remainingMs,
  budgetMs,
  turnKey,
  bigBlind,
}: {
  view: RoomView
  localTurn: boolean
  raiseTo: number
  onRaiseTo: (value: number) => void
  onAction: (action: TurnAction) => void
  onDeal: () => void
  /** The rebuy the bankroll can cover, or null when it cannot cover the minimum. */
  rebuyAmount: number | null
  onRebuy: (amount: number) => void
  onStand: () => void
  pendingSeat: { kind: SeatRequest['kind']; waiting: boolean } | null
  balance: number
  claimsEnabled: boolean
  onClaimDaily: () => void
  onClaimRescue: () => void
  canDeal: boolean
  seated: boolean
  kicked: boolean
  /** What the way back says: PLAY HERE when another tab has the seat. */
  rejoinLabel: string
  onRejoin: () => void
  preset: PresetKind | null
  onPreset: (kind: PresetKind | null) => void
  presetArmable: boolean
  remainingMs: number | null
  budgetMs: number | null
  turnKey: string
  /** Amounts in this many chips to the big blind, or in chips when null. */
  bigBlind: number | null
}) {
  const [lit, setLit] = useState<MenuSlot | null>(null)
  const [raising, setRaising] = useState(false)
  // Read per turn rather than once: the first hand ends between two turns.
  const [coaching, setCoaching] = useState(false)
  useEffect(() => {
    if (turnKey.length > 0) setCoaching(!firstHandPlayed())
  }, [turnKey])
  const legal = localTurn ? view.legal : null

  // A raise layer left open, or a slot left lit, must not survive into the
  // next decision.
  useEffect(() => {
    if (turnKey.length === 0) return
    setRaising(false)
    setLit(null)
  }, [turnKey])

  const hasTurn = legal !== null
  useEffect(() => {
    if (!hasTurn || turnKey.length === 0 || !isKeyboardDriven()) return
    const focused = document.activeElement
    if (focused === null || focused === document.body || !focused.isConnected) focusFirstAction()
  }, [hasTurn, turnKey])

  useEffect(() => {
    if (legal === null) return
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
        return
      // Ctrl+R is reload and Shift is held to read the table: neither raises.
      if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return
      const key = event.key.toLowerCase()
      if (!raising && key === 'r' && legal.raiseTo.enabled) {
        event.preventDefault()
        setRaising(true)
      } else if (raising && key === 'escape') {
        event.preventDefault()
        setRaising(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [legal, raising])

  const slotEvents = (slot: MenuSlot) => ({
    onPointerEnter: () => setLit(slot),
    onPointerLeave: () => setLit(null),
    onFocus: () => setLit(slot),
    onBlur: () => setLit(null),
  })

  if (kicked)
    return (
      <div className="ram ram-solo">
        <button type="button" onClick={onRejoin}>
          {rejoinLabel}
        </button>
      </div>
    )
  if (!seated)
    return (
      <div className={`ram ram-waiting${balance < DEFAULT_STAKE.minBuyIn ? ' recovery' : ''}`}>
        <span>
          {balance < DEFAULT_STAKE.minBuyIn
            ? `NEED ${formatAmount(DEFAULT_STAKE.minBuyIn, false, bigBlind)} TO SIT`
            : view.seats.some((seat) => seat.playerId === null)
              ? 'SITTING IN AFTER THIS HAND'
              : 'TABLE IS FULL'}
        </span>
        {balance < DEFAULT_STAKE.minBuyIn ? (
          <div className="recovery-actions">
            <button type="button" disabled={!claimsEnabled} onClick={onClaimDaily}>
              DAILY CHIPS
            </button>
            <button type="button" disabled={!claimsEnabled} onClick={onClaimRescue}>
              BUST RESCUE
            </button>
          </div>
        ) : null}
      </div>
    )
  if (legal === null) {
    if (view.phase === 'open' && canDeal)
      return (
        <div className="ram ram-solo">
          <button type="button" onClick={onDeal}>
            DEAL
          </button>
        </div>
      )
    // Seated, with the table to yourself. There is nothing to press until
    // somebody else is in a seat, and saying so beats an empty rail.
    if (view.phase === 'open' && view.seats.filter((seat) => seat.playerId !== null).length < 2)
      return (
        <div className="ram ram-waiting">
          <span>WAITING FOR PLAYERS</span>
        </div>
      )
    // A busted player is not dealt in, so this stays up through the hands that
    // follow rather than only in the gap between them. It used to offer one
    // full rebuy the bankroll often could not cover, with no way out of the
    // seat - and the rescue is only for somebody out of one.
    if (view.seats.some((seat) => seat.playerId === view.selfId && seat.busted)) {
      const waitingFor = pendingSeat?.waiting === true ? pendingSeat.kind : null
      return (
        <div className="ram ram-waiting recovery">
          <span>
            {waitingFor === 'rebuy'
              ? 'REBUYING AFTER THIS HAND'
              : waitingFor === 'stand'
                ? 'STANDING AFTER THIS HAND'
                : rebuyAmount === null
                  ? `NEED ${formatAmount(DEFAULT_STAKE.minBuyIn, false, bigBlind)} TO REBUY`
                  : 'OUT OF CHIPS'}
          </span>
          <div className="recovery-actions">
            {rebuyAmount === null ? null : (
              <button
                type="button"
                className={pendingSeat?.kind === 'rebuy' ? 'queued' : undefined}
                aria-pressed={pendingSeat?.kind === 'rebuy'}
                onClick={() => onRebuy(rebuyAmount)}
              >
                REBUY {formatAmount(rebuyAmount, false, bigBlind)}
              </button>
            )}
            <button
              type="button"
              className={pendingSeat?.kind === 'stand' ? 'queued' : undefined}
              aria-pressed={pendingSeat?.kind === 'stand'}
              onClick={onStand}
            >
              STAND UP
            </button>
          </div>
        </div>
      )
    }
    if (presetArmable) {
      const arm = (kind: PresetKind) => onPreset(preset === kind ? null : kind)
      const presetLabel =
        lit === 'call'
          ? PRESET_LABELS['call-any']
          : lit === 'fold'
            ? PRESET_LABELS['check-fold']
            : preset === null
              ? 'PRESET'
              : `${PRESET_LABELS[preset]} ARMED`
      return (
        <section className="action-menu ghosted" aria-label="Preset actions">
          <p className="action-label">{presetLabel}</p>
          <div className="action-base" data-lit={lit ?? undefined}>
            <span className="action-seams" />
          </div>
          <span className="action-slot call" {...slotEvents('call')}>
            <button
              type="button"
              className={`action-button${preset === 'call-any' ? ' armed' : ''}`}
              aria-pressed={preset === 'call-any'}
              aria-label={PRESET_LABELS['call-any']}
              onClick={() => arm('call-any')}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                {MENU_ICON.call}
              </svg>
            </button>
          </span>
          <span className="action-slot raise">
            <span className="action-button placeholder" aria-hidden="true" />
          </span>
          <span className="action-slot fold" {...slotEvents('fold')}>
            <button
              type="button"
              className={`action-button${preset === 'check-fold' ? ' armed' : ''}`}
              aria-pressed={preset === 'check-fold'}
              aria-label={PRESET_LABELS['check-fold']}
              onClick={() => arm('check-fold')}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                {MENU_ICON.checkFold}
              </svg>
            </button>
          </span>
        </section>
      )
    }
    return (
      <div className="ram ram-waiting">
        <span>WAITING</span>
      </div>
    )
  }

  const min = legal.raiseTo.min
  const max = legal.allIn.amount
  const clampRaise = (value: number) => Math.min(max, Math.max(min, Math.round(value)))
  const clamped = clampRaise(raiseTo)
  const checking = legal.check.enabled

  if (raising && legal.raiseTo.enabled) {
    return (
      <RaiseLayer
        view={view}
        legal={legal}
        value={clamped}
        onValue={(value) => onRaiseTo(clampRaise(value))}
        onRaise={() => onAction({ kind: 'raiseTo', to: clamped })}
        onAllIn={() => onAction({ kind: 'allIn' })}
        onCancel={() => setRaising(false)}
        bigBlind={bigBlind}
      />
    )
  }

  const labels: Record<MenuSlot, string> = {
    call: checking ? 'CHECK' : `CALL ${formatAmount(legal.call.amount, false, bigBlind)}`,
    raise: legal.raiseTo.enabled
      ? checking
        ? 'BET'
        : 'RAISE'
      : `ALL IN ${formatAmount(max, false, bigBlind)}`,
    fold: 'FOLD',
  }
  return (
    <section className="action-menu" aria-label="Your action">
      <TurnArc key={turnKey} remainingMs={remainingMs} budgetMs={budgetMs} />
      <p className="action-label">{lit === null ? 'YOUR TURN' : labels[lit]}</p>
      {coaching ? (
        <p className="action-coach" role="note">
          {coachLine(
            checking,
            checking ? 'Check' : `Call ${formatAmount(legal.call.amount, false, bigBlind)}`,
            legal.raiseTo.enabled,
          )}
        </p>
      ) : null}
      {/* Shown only once a keyboard is on the buttons: the keys that skip them. */}
      <p className="action-keys" aria-hidden="true">
        <kbd>C</kbd> {checking ? 'CHECK' : 'CALL'}
        {legal.raiseTo.enabled ? (
          <>
            {' '}
            <kbd>R</kbd> {checking ? 'BET' : 'RAISE'}
          </>
        ) : null}
        {checking ? null : (
          <>
            {' '}
            <kbd>F</kbd> FOLD
          </>
        )}
      </p>
      <div className="action-base" data-lit={lit ?? undefined}>
        <span className="action-seams" />
      </div>
      <span className="action-slot call" {...slotEvents('call')}>
        <HoldAction
          className={`action-button${checking ? ' check' : ''}`}
          duration={0}
          disabled={!(checking || legal.call.enabled)}
          ariaLabel={labels.call}
          keyShortcut="C"
          onComplete={() => onAction(checking ? { kind: 'check' } : { kind: 'call' })}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {checking ? MENU_ICON.check : MENU_ICON.call}
          </svg>
        </HoldAction>
        <span className="action-caption" aria-hidden="true">
          {labels.call}
        </span>
      </span>
      <span className="action-slot raise" {...slotEvents('raise')}>
        {legal.raiseTo.enabled ? (
          <button
            type="button"
            className="action-button"
            aria-label={labels.raise}
            aria-keyshortcuts="R"
            onClick={() => setRaising(true)}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {MENU_ICON.raise}
            </svg>
          </button>
        ) : (
          <HoldAction
            className="action-button all-in"
            duration={600}
            disabled={!legal.allIn.enabled}
            ariaLabel={labels.raise}
            onComplete={() => onAction({ kind: 'allIn' })}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              {MENU_ICON.allIn}
            </svg>
          </HoldAction>
        )}
        <span className="action-caption" aria-hidden="true">
          {labels.raise}
        </span>
      </span>
      <span className="action-slot fold" {...slotEvents('fold')}>
        {/* Folding when checking is free is always a mistake, so it is the one
            ordinary action that asks for a short hold. Facing a bet it is a
            normal decision and takes a plain press. */}
        <HoldAction
          className="action-button"
          duration={checking ? 400 : 0}
          disabled={!legal.fold.enabled}
          ariaLabel={checking ? 'Fold, hold to confirm' : 'Fold'}
          keyShortcut={checking ? undefined : 'F'}
          onComplete={() => onAction({ kind: 'fold' })}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {MENU_ICON.fold}
          </svg>
        </HoldAction>
        {/* Said, because a fold that wants a hold looked like a button that
            had not heard the click, and the second click landed on Check. */}
        <span className="action-caption" aria-hidden="true">
          {checking ? 'HOLD TO FOLD' : 'FOLD'}
        </span>
      </span>
    </section>
  )
}

/** The turn clock around your own menu, on the same sweep as the watch. */
function TurnArc({
  remainingMs,
  budgetMs,
}: {
  remainingMs: number | null
  budgetMs: number | null
}) {
  const [elapsed] = useState(() =>
    remainingMs === null || budgetMs === null
      ? 0
      : Math.max(0, Math.min(budgetMs, budgetMs - remainingMs)),
  )
  if (remainingMs === null || budgetMs === null) return null
  return (
    <span
      className="action-timer"
      aria-hidden="true"
      style={
        { '--turn-budget': `${budgetMs}ms`, '--turn-elapsed': `-${elapsed}ms` } as CSSProperties
      }
    />
  )
}

const ARC = { cx: 150, cy: 146, r: 124 }
const ARC_LENGTH = Math.PI * ARC.r
/** Within this fraction of the arc, the knob snaps to a pot size. */
const NOTCH_SNAP = 0.03
/** How hard the arc favours small raises; see RaiseLayer. */
const ARC_CURVE = 200
/** Notch labels closer than this, in arc fraction, are staggered outward. */
const LABEL_CLEARANCE = 0.09

function arcPoint(fraction: number, radius = ARC.r): { x: number; y: number } {
  const angle = Math.PI * (1 - fraction)
  return { x: ARC.cx + radius * Math.cos(angle), y: ARC.cy - radius * Math.sin(angle) }
}

/**
 * The raise layer: a half arc from the minimum raise to your stack.
 *
 * The arc is logarithmic. A stack is often forty times a pot-sized raise, and on
 * a linear arc every sensible raise sat in the first few degrees. A square-root
 * curve was tried first and still stacked the half, three-quarter and pot
 * labels on top of one another against a 100K stack; the log curve spread the
 * same three across about 35 degrees. Half, three-quarter and full pot are
 * notches the knob snaps to, and keys 1 to 4 jump to minimum, half,
 * three-quarter and pot.
 */
function RaiseLayer({
  view,
  legal,
  value,
  onValue,
  onRaise,
  onAllIn,
  onCancel,
  bigBlind,
}: {
  view: RoomView
  legal: NonNullable<RoomView['legal']>
  value: number
  onValue: (value: number) => void
  onRaise: () => void
  onAllIn: () => void
  onCancel: () => void
  /** Amounts in this many chips to the big blind, or in chips when null. */
  bigBlind: number | null
}) {
  const min = legal.raiseTo.min
  const max = legal.allIn.amount
  const step = DEFAULT_STAKE.bigBlind
  // One notch per change of amount, however it was changed: dragging the wheel,
  // its arrows, the mouse wheel, the keys or a preset. An amount pinned at either
  // end does not change, so it does not tick.
  const ticked = useRef(value)
  useEffect(() => {
    if (value === ticked.current) return
    ticked.current = value
    tableSound.play('wheel_tick')
  }, [value])
  const sizes = sizingPresets({
    pot: view.pot,
    currentBet: view.currentBet,
    toCall: legal.call.amount,
    minRaiseTo: min,
    allInTo: max,
  })
  const span = Math.max(1, max - min)
  const fractionOf = (amount: number) =>
    Math.log1p(ARC_CURVE * Math.min(1, Math.max(0, (amount - min) / span))) / Math.log1p(ARC_CURVE)
  const amountAt = (fraction: number) =>
    min + (span * Math.expm1(fraction * Math.log1p(ARC_CURVE))) / ARC_CURVE
  const arc = useRef<HTMLDivElement | null>(null)
  const latest = useRef({ value, onValue, onRaise, onCancel, sizes })
  latest.current = { value, onValue, onRaise, onCancel, sizes }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
        return
      const current = latest.current
      if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
        event.preventDefault()
        current.onValue(current.value + step)
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
        event.preventDefault()
        current.onValue(current.value - step)
      } else if (event.key === 'Enter') {
        event.preventDefault()
        current.onRaise()
      } else if (/^[1-4]$/.test(event.key)) {
        const size = current.sizes[Number(event.key) - 1]
        if (size !== undefined) current.onValue(size.amount)
      }
    }
    // Bound here rather than through onWheel: React attaches wheel passively,
    // so preventDefault there is ignored and the page scrolls with the raise.
    const node = arc.current
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      latest.current.onValue(latest.current.value + (event.deltaY > 0 ? -step : step))
    }
    window.addEventListener('keydown', onKey)
    node?.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      window.removeEventListener('keydown', onKey)
      node?.removeEventListener('wheel', onWheel)
    }
  }, [])

  const pick = (event: ReactPointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect()
    const scale = box.width / 300
    const centreX = box.left + ARC.cx * scale
    const centreY = box.top + ARC.cy * scale
    let angle = Math.atan2(centreY - event.clientY, event.clientX - centreX)
    if (angle < 0) angle = event.clientX < centreX ? Math.PI : 0
    const fraction = 1 - angle / Math.PI
    const snapped = sizes
      .slice(1)
      .find((size) => Math.abs(fractionOf(size.amount) - fraction) < NOTCH_SNAP)
    if (snapped !== undefined) {
      onValue(snapped.amount)
      return
    }
    const raw = amountAt(fraction)
    onValue(fraction >= 0.995 ? max : Math.round(raw / step) * step)
  }

  const fraction = fractionOf(value)
  const knob = arcPoint(fraction)
  const track = `M ${ARC.cx - ARC.r} ${ARC.cy} A ${ARC.r} ${ARC.r} 0 0 1 ${ARC.cx + ARC.r} ${ARC.cy}`
  return (
    <section className="raise-layer" aria-label="Raise">
      <div
        ref={arc}
        className="raise-arc"
        role="slider"
        tabIndex={0}
        aria-label="Raise to"
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={formatAmount(value, false, bigBlind)}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          pick(event)
        }}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) pick(event)
        }}
      >
        <svg viewBox="0 0 300 158" aria-hidden="true">
          <defs>
            <linearGradient id="raise-brass" x1="0" x2="1" y1="0" y2="1">
              <stop offset="0" stopColor="#f4dfae" />
              <stop offset="0.45" stopColor="#c2953f" />
              <stop offset="1" stopColor="#6a4716" />
            </linearGradient>
            <linearGradient id="raise-fill" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0" stopColor="#2f7d4e" />
              <stop offset="1" stopColor="#6fe09a" />
            </linearGradient>
          </defs>
          <path className="raise-rim" d={track} />
          <path className="raise-track" d={track} />
          <path
            className="raise-fill"
            d={track}
            strokeDasharray={`${fraction * ARC_LENGTH} ${ARC_LENGTH}`}
          />
          {sizes.slice(1).map((size, index, all) => {
            if (size.amount <= min || size.amount >= max) return null
            const at = fractionOf(size.amount)
            const previous = all[index - 1]
            const crowded =
              previous !== undefined &&
              previous.amount > min &&
              Math.abs(fractionOf(previous.amount) - at) < LABEL_CLEARANCE &&
              index % 2 === 1
            const inner = arcPoint(at, ARC.r - 15)
            const outer = arcPoint(at, ARC.r + 15)
            const label = arcPoint(at, ARC.r + (crowded ? 44 : 28))
            return (
              <g key={size.id}>
                <line className="raise-notch" x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} />
                <text className="raise-notch-label" x={label.x} y={label.y} textAnchor="middle">
                  {size.label}
                </text>
              </g>
            )
          })}
          <text className="raise-end" x={ARC.cx - ARC.r} y={ARC.cy + 26} textAnchor="middle">
            {formatAmount(min, true, bigBlind)}
          </text>
          <text className="raise-end" x={ARC.cx + ARC.r} y={ARC.cy + 26} textAnchor="middle">
            {formatAmount(max, true, bigBlind)}
          </text>
          <g className="raise-knob" transform={`translate(${knob.x} ${knob.y})`}>
            <circle r="15" />
            <circle className="raise-knob-well" r="9" />
          </g>
        </svg>
        <div className="raise-readout">
          <span>{legal.check.enabled ? 'BET' : 'RAISE TO'}</span>
          <strong>{formatAmount(value, false, bigBlind)}</strong>
        </div>
      </div>
      <div className="raise-steps">
        <button
          type="button"
          className="raise-step"
          aria-label="One big blind less"
          onClick={() => onValue(value - step)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {MENU_ICON.back}
          </svg>
        </button>
        <button
          type="button"
          className="raise-step"
          aria-label="One big blind more"
          onClick={() => onValue(value + step)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {MENU_ICON.forward}
          </svg>
        </button>
      </div>
      <div className="raise-actions">
        <HoldAction
          className="raise-action all-in"
          duration={600}
          disabled={!legal.allIn.enabled}
          ariaLabel={`All in ${formatAmount(max, false, bigBlind)}, hold to confirm`}
          onComplete={onAllIn}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {MENU_ICON.allIn}
          </svg>
          ALL IN
        </HoldAction>
        <button type="button" className="raise-action cancel" onClick={onCancel}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {MENU_ICON.fold}
          </svg>
          CANCEL
        </button>
        <button type="button" className="raise-action confirm" onClick={onRaise}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {MENU_ICON.raise}
          </svg>
          {legal.check.enabled ? 'BET' : 'RAISE'}
        </button>
      </div>
    </section>
  )
}
