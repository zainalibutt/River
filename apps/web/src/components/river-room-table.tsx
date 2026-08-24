'use client'

import { type Card, DEFAULT_STAKE, type Street, type TurnAction } from '@river/engine'
import type { RoomEvent, RoomSeatView, RoomView } from '@river/server'
import type { ClientRoomCommand, ServerMessage } from '@river/server/wire'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  type CSSProperties,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { RiverVenue } from '@/components/river-venue'
import {
  createRiverAuthClient,
  ensureRiverSession,
  loadBrowserAuthConfig,
  upgradeRiverSession,
} from '@/lib/auth'
import { formatAmount } from '@/lib/presentation'
import { defaultRiverSocketUrl, RiverSocket, type RiverSocketState } from '@/lib/socket'

const boardSlots = ['flop-one', 'flop-two', 'flop-three', 'turn', 'river'] as const
const turnBudgets: Record<Street, number> = {
  preflop: 15_000,
  flop: 20_000,
  turn: 20_000,
  river: 25_000,
}
const seatPositions = [
  { x: 57, y: 78 },
  { x: 23, y: 76 },
  { x: 13, y: 55.9 },
  { x: 13.6, y: 33 },
  { x: 35.6, y: 18.1 },
  { x: 64.4, y: 18.1 },
  { x: 86.4, y: 33 },
  { x: 87, y: 55.9 },
  { x: 77, y: 76 },
] as const

type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'offline'
type UpgradeState = 'idle' | 'editing' | 'sent' | 'expired' | 'error' | 'complete'
type KickState = { reason: 'host' | 'idle' | 'duplicate-session' } | null

function initialRoomTarget(): { roomId: string; inviteCode?: string; expired: boolean } {
  if (typeof window === 'undefined') return { roomId: 'river-table', expired: false }
  const params = new URLSearchParams(window.location.search)
  const roomId = params.get('room')?.trim() || `river-${crypto.randomUUID().slice(0, 8)}`
  const inviteCode = params.get('code')?.trim() || undefined
  return {
    roomId,
    ...(inviteCode === undefined ? {} : { inviteCode }),
    expired: params.has('error') || params.has('error_code'),
  }
}

function emptyView(selfId = 'pending'): RoomView {
  return {
    handNumber: 0,
    phase: 'open',
    street: 'preflop',
    board: [],
    pot: 0,
    currentBet: 0,
    countdownMs: 0,
    seats: Array.from({ length: 9 }, (_, seat) => ({
      seat,
      playerId: null,
      name: null,
      stack: 0,
      betHand: 0,
      betStreet: 0,
      folded: false,
      allIn: false,
      hole: null,
      hasHole: false,
      sittingOut: false,
      busted: false,
      disconnected: false,
      dealer: false,
    })),
    currentActor: null,
    legal: null,
    commit: null,
    message: null,
    revealed: false,
    selfId,
    hostPlayerId: '',
    inviteCode: '',
  }
}

function orderedSeats(view: RoomView): RoomSeatView[] {
  const heroIndex = view.seats.findIndex((seat) => seat.playerId === view.selfId)
  if (heroIndex < 0) return view.seats
  return [...view.seats.slice(heroIndex), ...view.seats.slice(0, heroIndex)]
}

function eventNotice(events: RoomEvent[], selfId: string): string | null {
  for (const event of [...events].reverse()) {
    if (event.kind === 'identityUpgraded' && event.playerId === selfId) return 'Progress saved.'
    if (event.kind === 'reconnected' && event.playerId === selfId) return 'Reconnected.'
    if (event.kind === 'awayPlayed')
      return `${event.playerId === selfId ? 'You were' : 'A player was'} AWAY.`
    if (
      event.kind === 'kicked' &&
      event.playerId !== selfId &&
      event.reason !== 'duplicate-session'
    ) {
      return 'A player left the table.'
    }
  }
  return null
}

function joinUrl(roomId: string, inviteCode: string): string {
  if (typeof window === 'undefined') return ''
  const url = new URL(window.location.href)
  url.search = new URLSearchParams({ room: roomId, code: inviteCode }).toString()
  return url.toString()
}

export function RiverRoomTable() {
  const [{ roomId, inviteCode, expired }] = useState(initialRoomTarget)
  const [view, setView] = useState<RoomView>(() => emptyView())
  const [connection, setConnection] = useState<ConnectionState>('connecting')
  const [notice, setNotice] = useState<string | null>(null)
  const [joinCode, setJoinCode] = useState(inviteCode ?? '')
  const [upgradeState, setUpgradeState] = useState<UpgradeState>(expired ? 'expired' : 'idle')
  const [upgradeEmail, setUpgradeEmail] = useState('')
  const [kick, setKick] = useState<KickState>(null)
  const [peek, setPeek] = useState(false)
  const [selectedSeat, setSelectedSeat] = useState<number | null>(null)
  const [turnRemaining, setTurnRemaining] = useState(turnBudgets.preflop)
  const [raiseTo, setRaiseTo] = useState(0)
  const [dialBand, setDialBand] = useState(0)
  const [stageScale, setStageScale] = useState(2 / 3)
  const [graphicsMode, setGraphicsMode] = useState<'two' | 'three'>('two')
  const socketRef = useRef<RiverSocket | null>(null)
  const authRef = useRef<SupabaseClient | null>(null)
  const kickRef = useRef<KickState>(null)
  const nameRef = useRef('Guest')
  const seatRefs = useRef(new Map<string, HTMLElement>())
  const reconnectRef = useRef<number | null>(null)

  const command = useCallback((next: ClientRoomCommand) => {
    try {
      socketRef.current?.command(next)
    } catch {
      setNotice('Reconnecting…')
    }
  }, [])

  useEffect(() => {
    let disposed = false
    let unsubscribeMessage: (() => void) | null = null
    let unsubscribeState: (() => void) | null = null
    const connect = async (): Promise<void> => {
      setConnection((previous) => (previous === 'connected' ? 'reconnecting' : 'connecting'))
      try {
        const config = await loadBrowserAuthConfig()
        if (disposed) return
        const auth = createRiverAuthClient(config)
        authRef.current = auth
        const session = await ensureRiverSession(auth)
        if (disposed) return
        const socket = new RiverSocket({ url: defaultRiverSocketUrl(window.location) })
        socketRef.current = socket
        unsubscribeMessage = socket.subscribe((message: ServerMessage) => {
          if (message.kind === 'error') {
            setNotice(message.message)
            return
          }
          if (message.kind !== 'snapshot') return
          setView(message.view)
          const ownKick = message.events.find(
            (event) => event.kind === 'kicked' && event.playerId === message.view.selfId,
          )
          if (ownKick?.kind === 'kicked') {
            const nextKick = { reason: ownKick.reason } as const
            kickRef.current = nextKick
            setKick(nextKick)
            if (ownKick.reason === 'duplicate-session') socket.close()
          }
          const nextNotice = eventNotice(message.events, message.view.selfId)
          if (nextNotice !== null) setNotice(nextNotice)
          if (
            message.events.some(
              (event) =>
                event.kind === 'identityUpgraded' && event.playerId === message.view.selfId,
            )
          ) {
            setUpgradeState('complete')
          }
        })
        unsubscribeState = socket.subscribeState((state: RiverSocketState) => {
          if (state === 'connected') {
            setConnection('connected')
            setNotice(null)
            return
          }
          if (state !== 'closed' || disposed || kickRef.current?.reason === 'duplicate-session')
            return
          setConnection('reconnecting')
          setNotice('Reconnecting…')
          reconnectRef.current = window.setTimeout(() => void connect(), 900)
        })
        await socket.connect(session.access_token)
        if (disposed) return
        socket.enter(roomId, nameRef.current, inviteCode)
      } catch {
        if (!disposed) {
          setConnection('offline')
          setNotice('River is reconnecting. Your table remains visible.')
        }
      }
    }
    void connect()
    return () => {
      disposed = true
      if (reconnectRef.current !== null) window.clearTimeout(reconnectRef.current)
      unsubscribeMessage?.()
      unsubscribeState?.()
      socketRef.current?.close()
      socketRef.current = null
    }
  }, [inviteCode, roomId])

  useEffect(() => {
    const resize = () =>
      setStageScale(Math.min(window.innerWidth / 1920, window.innerHeight / 1080))
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  useEffect(() => {
    const minimum = view.legal?.raiseTo.min ?? 0
    setRaiseTo(minimum)
    setDialBand(3)
  }, [view.legal?.raiseTo.min])

  useEffect(() => {
    const current = view.currentActor
    if (current === null) return
    const budget = turnBudgets[view.street]
    const started = Date.now()
    const interval = window.setInterval(() => {
      setTurnRemaining(Math.max(0, budget - (Date.now() - started)))
    }, 100)
    setTurnRemaining(budget)
    return () => window.clearInterval(interval)
  }, [view.currentActor, view.street])

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
        return
      if (event.code === 'Space') setPeek(true)
      if (event.key.toLowerCase() === 'c') {
        if (view.legal?.check.enabled) command({ kind: 'act', action: { kind: 'check' } })
        else if (view.legal?.call.enabled) command({ kind: 'act', action: { kind: 'call' } })
      }
      if (event.key.toLowerCase() === 'r' && view.legal?.raiseTo.enabled) setDialBand(1)
    }
    const up = (event: KeyboardEvent) => {
      if (event.code === 'Space') setPeek(false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [command, view.legal])

  const seats = useMemo(() => orderedSeats(view), [view])
  const selfSeat = view.seats.find((seat) => seat.playerId === view.selfId) ?? null
  const seatedCount = view.seats.filter((seat) => seat.playerId !== null && seat.stack > 0).length
  const isHost = view.hostPlayerId === view.selfId
  const localTurn = view.currentActor?.playerId === view.selfId
  const urgency = localTurn && turnRemaining <= turnBudgets[view.street] / 2
  const selected =
    selectedSeat === null ? null : view.seats.find((seat) => seat.seat === selectedSeat)
  const selectedPlayerId = selected?.playerId ?? null

  const submitJoinCode = (event: FormEvent) => {
    event.preventDefault()
    if (joinCode.trim().length === 0) return
    try {
      socketRef.current?.enter(roomId, nameRef.current, joinCode.trim())
    } catch {
      setNotice('Reconnecting…')
    }
  }

  const share = async () => {
    const url = joinUrl(roomId, view.inviteCode)
    await navigator.clipboard?.writeText(url).catch(() => undefined)
    setNotice('Invite link copied.')
  }

  const sendUpgrade = async (event: FormEvent) => {
    event.preventDefault()
    const auth = authRef.current
    if (auth === null) return
    try {
      await upgradeRiverSession(auth, upgradeEmail.trim(), window.location.origin)
      setUpgradeState('sent')
    } catch {
      setUpgradeState('error')
    }
  }

  return (
    <main className="river-app">
      <div className="stage-fit">
        <section
          className="river-stage three-dimensional"
          aria-label="River poker table"
          style={{ transform: `scale(${stageScale})` }}
        >
          {graphicsMode === 'three' ? (
            <RiverVenue
              seatIds={seats.map((seat) => seat.playerId ?? `seat-${seat.seat}`)}
              seatRefs={seatRefs}
            />
          ) : null}
          <div className="hud-layer">
            {graphicsMode === 'two' ? (
              <div className="dom-table-fallback" aria-hidden="true" />
            ) : null}
            <nav className="menu-cluster" aria-label="Table menu">
              <button
                type="button"
                onClick={() => setGraphicsMode((mode) => (mode === 'two' ? 'three' : 'two'))}
              >
                {graphicsMode === 'two' ? '2D' : '3D'}
              </button>
              <button
                type="button"
                onClick={() =>
                  setUpgradeState((state) => (state === 'editing' ? 'idle' : 'editing'))
                }
              >
                SAVE
              </button>
              <span className={`network-mark ${connection}`}>
                {connection === 'connected' ? 'LIVE' : 'LINK'}
              </span>
            </nav>
            <section className="invite-strip" aria-label="Private table invite">
              <span>TABLE CODE</span>
              <strong>{view.inviteCode || '------'}</strong>
              <button
                type="button"
                disabled={view.inviteCode.length === 0}
                onClick={() => void share()}
              >
                COPY INVITE
              </button>
            </section>
            <div className="pot-readout" role="status" aria-label={`Pot ${view.pot}`}>
              <span>POT</span>
              <strong>{formatAmount(view.pot, false)}</strong>
            </div>
            <Board cards={view.board} street={view.street} />
            <div className="status-line populated" aria-live="polite">
              {kick === null
                ? (notice ?? view.message ?? waitingCopy(view, seatedCount, isHost))
                : kickCopy(kick.reason)}
            </div>
            <div className="seat-ring">
              {seats.map((seat, index) => (
                <RoomSeat
                  key={seat.seat}
                  seat={seat}
                  index={index}
                  active={seat.playerId === view.currentActor?.playerId}
                  local={seat.playerId === view.selfId}
                  peek={peek}
                  timer={seat.playerId === view.currentActor?.playerId ? turnRemaining : null}
                  timerTotal={turnBudgets[view.street]}
                  onSit={() =>
                    command({ kind: 'sit', seat: seat.seat, buyIn: DEFAULT_STAKE.defaultBuyIn })
                  }
                  onSelect={() => setSelectedSeat(seat.seat)}
                  anchorRef={(element) => {
                    const key = seat.playerId ?? `seat-${seat.seat}`
                    if (element === null) seatRefs.current.delete(key)
                    else seatRefs.current.set(key, element)
                  }}
                />
              ))}
            </div>
            {selectedPlayerId !== null && isHost && selectedPlayerId !== view.selfId ? (
              <HoldAction
                className="kick-control"
                duration={600}
                onComplete={() =>
                  command({ kind: 'kick', targetPlayerId: selectedPlayerId, reason: 'host' })
                }
              >
                HOLD TO REMOVE {selected?.name}
              </HoldAction>
            ) : null}
            {connection !== 'connected' ? <div className="network-bar">Reconnecting…</div> : null}
            <RadialActionMenu
              view={view}
              localTurn={localTurn}
              urgency={urgency}
              raiseTo={raiseTo}
              dialBand={dialBand}
              onDialBand={setDialBand}
              onRaiseTo={setRaiseTo}
              onAction={(action) => command({ kind: 'act', action })}
              onDeal={() => command({ kind: 'startHand' })}
              onRebuy={() => command({ kind: 'rebuy', amount: DEFAULT_STAKE.defaultBuyIn })}
              canDeal={isHost && seatedCount >= 2 && view.handNumber === 0}
              seated={selfSeat !== null}
              kicked={kick !== null}
              onRejoin={() => {
                kickRef.current = null
                setKick(null)
                socketRef.current?.enter(roomId, nameRef.current, joinCode || undefined)
              }}
            />
            {upgradeState !== 'idle' ? (
              <UpgradePanel
                state={upgradeState}
                email={upgradeEmail}
                onEmail={setUpgradeEmail}
                onSubmit={sendUpgrade}
                onRetry={() => setUpgradeState('editing')}
                onClose={() => setUpgradeState('idle')}
              />
            ) : null}
            {view.selfId === 'pending' ? (
              <form className="inline-join" onSubmit={submitJoinCode}>
                <label htmlFor="invite-code">JOIN WITH CODE</label>
                <input
                  id="invite-code"
                  value={joinCode}
                  onChange={(event) => setJoinCode(event.target.value)}
                  maxLength={6}
                />
                <button type="submit">RETRY</button>
              </form>
            ) : null}
          </div>
        </section>
      </div>
      <div className="viewport-warning">
        <strong>River needs a wider table.</strong>
        <span>Minimum supported viewport: 1280×720.</span>
      </div>
    </main>
  )
}

function waitingCopy(view: RoomView, seatedCount: number, isHost: boolean): string | null {
  if (view.phase !== 'open') return null
  if (seatedCount === 0) return 'Take an open seat to join the table.'
  if (seatedCount < 2) return 'Waiting for one more player.'
  return isHost
    ? 'Table is ready. DEAL when your group is seated.'
    : 'Waiting for the host to deal.'
}

function kickCopy(reason: Exclude<KickState, null>['reason']): string {
  if (reason === 'host') return 'The host removed you from the table.'
  if (reason === 'idle') return 'You were removed for inactivity.'
  return 'This table is open in another window.'
}

function Board({ cards, street }: { cards: Card[]; street: Street }) {
  return (
    <section className="board" aria-label={`${street}, ${cards.length} community cards`}>
      <span className="street-label">{street.toUpperCase()}</span>
      <div className="board-cards">
        {boardSlots.map((slot, index) =>
          cards[index] === undefined ? (
            <div className="card-well" key={slot} />
          ) : (
            <PlayingCard card={cards[index]} key={slot} />
          ),
        )}
      </div>
    </section>
  )
}

function PlayingCard({ card, peek = false }: { card: Card; peek?: boolean }) {
  const symbol = { s: '♠', h: '♥', d: '♦', c: '♣' }[card.suit]
  return (
    <div
      className={`playing-card suit-${card.suit}${peek ? ' hero-card peeked' : ''}`}
      role="img"
      aria-label={`${card.rank} ${card.suit}`}
    >
      <span>{card.rank}</span>
      <b>{symbol}</b>
      <span className="card-corner">{card.rank}</span>
    </div>
  )
}

function CardBack() {
  return (
    <div className="card-back" role="img" aria-label="Face-down card">
      <span>R</span>
    </div>
  )
}

function RoomSeat({
  seat,
  index,
  active,
  local,
  peek,
  timer,
  timerTotal,
  onSit,
  onSelect,
  anchorRef,
}: {
  seat: RoomSeatView
  index: number
  active: boolean
  local: boolean
  peek: boolean
  timer: number | null
  timerTotal: number
  onSit: () => void
  onSelect: () => void
  anchorRef: (element: HTMLElement | null) => void
}) {
  const position = seatPositions[index] ?? seatPositions[0]
  const label = seat.disconnected
    ? 'RECONNECTING'
    : seat.folded
      ? 'FOLDED'
      : seat.allIn
        ? 'ALL IN'
        : active
          ? 'TO ACT'
          : seat.sittingOut
            ? 'SITTING OUT'
            : local
              ? 'YOU'
              : null
  if (seat.playerId === null) {
    return (
      <article
        ref={anchorRef}
        className="seat open-seat"
        style={{ '--seat-x': `${position.x}%`, '--seat-y': `${position.y}%` } as CSSProperties}
      >
        <button type="button" onClick={onSit}>
          SIT
          <br />
          <small>{formatAmount(DEFAULT_STAKE.defaultBuyIn, false)}</small>
        </button>
      </article>
    )
  }
  return (
    <article
      ref={anchorRef}
      className={`seat${active ? ' active' : ''}${seat.disconnected ? ' reconnecting' : ''}${local ? ' hero-seat' : ''}`}
      style={{ '--seat-x': `${position.x}%`, '--seat-y': `${position.y}%` } as CSSProperties}
    >
      <button
        className="seat-select"
        type="button"
        onClick={onSelect}
        aria-label={`Inspect ${seat.name}`}
      />
      <div className="seat-cards">
        {seat.hasHole && seat.hole === null ? (
          <>
            <CardBack />
            <CardBack />
          </>
        ) : null}
        {local
          ? seat.hole?.map((card) => (
              <PlayingCard card={card} peek={peek} key={`${card.rank}${card.suit}`} />
            ))
          : null}
      </div>
      <div className="avatar" aria-hidden="true">
        {seat.name?.slice(0, 1) ?? '?'}
      </div>
      <div className="seat-copy">
        <span>{seat.name}</span>
        <strong>{formatAmount(seat.stack, !local)}</strong>
        <small>{label}</small>
      </div>
      {active && !local && timer !== null ? (
        <div
          className="remote-timer"
          style={{ '--timer-progress': `${Math.max(0, timer / timerTotal)}` } as CSSProperties}
        >
          TURN
        </div>
      ) : null}
      {seat.dealer ? <div className="dealer-button">D</div> : null}
      {seat.betStreet > 0 ? (
        <div className="seat-bet">
          <i />
          <b>{formatAmount(seat.betStreet, !local)}</b>
        </div>
      ) : null}
    </article>
  )
}

function RadialActionMenu({
  view,
  localTurn,
  urgency,
  raiseTo,
  dialBand,
  onDialBand,
  onRaiseTo,
  onAction,
  onDeal,
  onRebuy,
  canDeal,
  seated,
  kicked,
  onRejoin,
}: {
  view: RoomView
  localTurn: boolean
  urgency: boolean
  raiseTo: number
  dialBand: number
  onDialBand: (value: number) => void
  onRaiseTo: (value: number) => void
  onAction: (action: TurnAction) => void
  onDeal: () => void
  onRebuy: () => void
  canDeal: boolean
  seated: boolean
  kicked: boolean
  onRejoin: () => void
}) {
  if (kicked)
    return (
      <div className="ram ram-waiting">
        <button type="button" onClick={onRejoin}>
          RETURN TO TABLE
        </button>
      </div>
    )
  if (!seated)
    return (
      <div className="ram ram-waiting">
        <span>CHOOSE AN OPEN SEAT</span>
      </div>
    )
  if (!localTurn || view.legal === null) {
    if (view.phase === 'open' && canDeal)
      return (
        <div className="ram ram-waiting">
          <button type="button" onClick={onDeal}>
            DEAL
          </button>
        </div>
      )
    if (
      view.phase !== 'hand' &&
      view.seats.some((seat) => seat.playerId === view.selfId && seat.busted)
    )
      return (
        <div className="ram ram-waiting">
          <button type="button" onClick={onRebuy}>
            REBUY {formatAmount(DEFAULT_STAKE.defaultBuyIn, false)}
          </button>
        </div>
      )
    return (
      <div className="ram ram-waiting">
        <span>WAITING</span>
      </div>
    )
  }
  const legal = view.legal
  const min = legal.raiseTo.min
  const max = legal.allIn.amount
  const clamped = Math.min(max, Math.max(min, raiseTo))
  const step = DEFAULT_STAKE.bigBlind
  const rangeWidth = Math.max(step, Math.ceil((max - min) / 2 ** dialBand / step) * step)
  const rangeStart = Math.max(min, min + Math.floor((clamped - min) / rangeWidth) * rangeWidth)
  const rangeEnd = Math.min(max, rangeStart + rangeWidth)
  const setDialValue = (value: number) => onRaiseTo(Math.min(rangeEnd, Math.max(rangeStart, value)))
  const wedge = (
    label: string,
    enabled: boolean,
    action: TurnAction,
    className: string,
    hold = 0,
  ) => (
    <HoldAction
      className={`ram-wedge ${className}`}
      disabled={!enabled}
      duration={hold}
      onComplete={() => onAction(action)}
    >
      {label}
    </HoldAction>
  )
  return (
    <section className={`ram${urgency ? ' urgent' : ''}`} aria-label="Radial action menu">
      {wedge('FOLD', legal.fold.enabled, { kind: 'fold' }, 'fold', legal.check.enabled ? 400 : 0)}
      {legal.check.enabled
        ? wedge('CHECK', true, { kind: 'check' }, 'check')
        : wedge(
            `CALL ${formatAmount(legal.call.amount, false)}`,
            legal.call.enabled,
            { kind: 'call' },
            'call',
          )}
      {legal.raiseTo.enabled
        ? wedge(
            `RAISE TO ${formatAmount(clamped, false)}`,
            true,
            { kind: 'raiseTo', to: clamped },
            'raise',
          )
        : null}
      {wedge(
        `ALL IN ${formatAmount(max, false)}`,
        legal.allIn.enabled,
        { kind: 'allIn' },
        'all-in',
        600,
      )}
      {legal.raiseTo.enabled ? (
        <div
          className="betting-dial"
          onWheel={(event) => {
            event.preventDefault()
            setDialValue(clamped + (event.deltaY > 0 ? -step : step))
          }}
        >
          <button
            type="button"
            aria-label="Halve betting range"
            onClick={() => onDialBand(Math.min(3, dialBand + 1))}
          >
            ½
          </button>
          <output>
            RAISE TO
            <br />
            <strong>{formatAmount(clamped, false)}</strong>
          </output>
          <button
            type="button"
            aria-label="Double betting range"
            onClick={() => onDialBand(Math.max(0, dialBand - 1))}
          >
            2×
          </button>
          <button
            type="button"
            aria-label="Decrease raise amount"
            onClick={() => setDialValue(clamped - step)}
          >
            −
          </button>
          <button
            type="button"
            aria-label="Increase raise amount"
            onClick={() => setDialValue(clamped + step)}
          >
            +
          </button>
          <div className="dial-presets">
            {[
              { id: 'minimum', label: 'MIN', amount: min },
              { id: 'half-pot', label: '½', amount: Math.round(view.pot / 2) },
              { id: 'pot', label: 'POT', amount: view.pot },
              { id: 'maximum', label: 'MAX', amount: max },
            ].map(({ id, label, amount }) => (
              <button
                type="button"
                key={id}
                onClick={() => onRaiseTo(Math.min(max, Math.max(min, amount)))}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="ram-centre">YOUR TURN</div>
      )}
    </section>
  )
}

function HoldAction({
  duration,
  disabled = false,
  className,
  onComplete,
  children,
}: {
  duration: number
  disabled?: boolean
  className: string
  onComplete: () => void
  children: React.ReactNode
}) {
  const timeout = useRef<number | null>(null)
  const [holding, setHolding] = useState(false)
  const cancel = useCallback(() => {
    if (timeout.current !== null) window.clearTimeout(timeout.current)
    timeout.current = null
    setHolding(false)
  }, [])
  const begin = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (disabled || timeout.current !== null) return
    event.currentTarget.setPointerCapture(event.pointerId)
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
      style={{ '--hold-duration': `${duration}ms` } as CSSProperties}
      onPointerDown={begin}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
    >
      {children}
    </button>
  )
}

function UpgradePanel({
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
    </form>
  )
}
