'use client'

import {
  type BotSkill,
  type Card as CardValue,
  huSeats,
  type SessionStep,
  SoloSession,
  type SoloTableView,
  STAKE_250_500,
  type TurnAction,
  type ViewSeat,
} from '@river/engine'
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import { RiverVenue } from '@/components/river-venue'
import { cloneView, dwellFor, formatAmount, orderedSeats, reduceStep } from '@/lib/presentation'
import { DEFAULT_VENUE } from '@/lib/venue'

const seatPositions: Record<number, { x: number; y: number }[]> = {
  2: [
    { x: 57, y: 78 },
    { x: 50, y: 16 },
  ],
  6: [
    { x: 57, y: 78 },
    { x: 13.6, y: 67 },
    { x: 13.6, y: 33 },
    { x: 50, y: 16 },
    { x: 86.4, y: 33 },
    { x: 86.4, y: 67 },
  ],
  9: [
    { x: 57, y: 78 },
    { x: 23, y: 76 },
    { x: 13, y: 55.9 },
    { x: 13.6, y: 33 },
    { x: 35.6, y: 18.1 },
    { x: 64.4, y: 18.1 },
    { x: 86.4, y: 33 },
    { x: 87, y: 55.9 },
    { x: 77, y: 76 },
  ],
}

const boardSlots = ['flop-one', 'flop-two', 'flop-three', 'turn', 'river'] as const
const fallbackSeatPosition = { x: 50, y: 50 }

function createSession(skill: BotSkill): SoloSession {
  return new SoloSession({
    seats: huSeats(skill),
    rngSeed: `river-browser-${skill}`,
    stake: STAKE_250_500,
    nowMs: () => Date.now(),
  })
}

function playerMessage(message: string | null): string | null {
  if (message === null) return null
  if (message === 'cannot check when facing a bet') return 'You still have chips to call.'
  if (message.startsWith('raise below minimum of')) {
    return `Minimum raise is ${formatAmount(Number(message.split(' ').at(-1) ?? 0), false)}.`
  }
  if (message === 'It is not your turn.') return 'Wait for your turn.'
  return message
}

export function RiverTable() {
  const [skill, setSkill] = useState<BotSkill>('rookie')
  const [initialSession] = useState(() => createSession('rookie'))
  const sessionRef = useRef<SoloSession>(initialSession)
  const [view, setView] = useState<SoloTableView>(() => cloneView(sessionRef.current.view()))
  const [busy, setBusy] = useState(false)
  const [lastStep, setLastStep] = useState<SessionStep | null>(null)
  const [outcome, setOutcome] = useState<string | null>(null)
  const [raiseTo, setRaiseTo] = useState(0)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [verifyOpen, setVerifyOpen] = useState(false)
  const [twoColour, setTwoColour] = useState(false)
  const [tvMode, setTvMode] = useState(false)
  const [stageScale, setStageScale] = useState(2 / 3)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  const skillRef = useRef<BotSkill>('rookie')
  const callRef = useRef<HTMLButtonElement>(null)
  const allInRef = useRef<HTMLButtonElement>(null)
  const raiseRef = useRef<HTMLInputElement>(null)
  const modalCloseRef = useRef<HTMLButtonElement>(null)
  const seatRefs = useRef(new Map<string, HTMLElement>())

  const clearPlayback = useCallback(() => {
    for (const timer of timers.current) clearTimeout(timer)
    timers.current = []
  }, [])

  const play = useCallback(
    (before: SoloTableView, steps: SessionStep[], after: SoloTableView) => {
      clearPlayback()
      let shown = cloneView(before)
      let cursor = 0
      setBusy(true)
      setView(cloneView(before))
      for (const step of steps) {
        const timer = setTimeout(() => {
          shown = reduceStep(shown, step, after)
          if (step.kind === 'handStarted') setOutcome(null)
          if (step.kind === 'showdown' || step.kind === 'uncontested') setOutcome(shown.message)
          setLastStep(step)
          setView(cloneView(shown))
        }, cursor)
        timers.current.push(timer)
        cursor += dwellFor(step, shown, skillRef.current)
      }
      const finalTimer = setTimeout(() => {
        setView(cloneView(after))
        setBusy(false)
      }, cursor + 20)
      timers.current.push(finalTimer)
    },
    [clearPlayback],
  )

  const startHand = useCallback(() => {
    if (busy) return
    const before = cloneView(sessionRef.current.view())
    const steps = sessionRef.current.start()
    play(before, steps, sessionRef.current.view())
  }, [busy, play])

  const act = useCallback(
    (action: TurnAction) => {
      if (busy || view.currentActorId !== 'you') return
      const before = cloneView(sessionRef.current.view())
      const result = sessionRef.current.act('you', action)
      if (!result.ok) {
        setView(cloneView(sessionRef.current.view()))
        return
      }
      play(before, result.steps, sessionRef.current.view())
    },
    [busy, play, view.currentActorId],
  )

  useEffect(() => clearPlayback, [clearPlayback])

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
    if (!busy && view.currentActorId === 'you') callRef.current?.focus()
  }, [busy, view.currentActorId, view.legal?.raiseTo.min])

  useEffect(() => {
    if (busy || view.phase !== 'between') return
    let started = false
    const interval = setInterval(() => {
      const fresh = sessionRef.current.view()
      setView(cloneView(fresh))
      if (
        !started &&
        fresh.countdownMs <= 0 &&
        fresh.seats.filter((seat) => seat.stack > 0).length > 1
      ) {
        started = true
        const steps = sessionRef.current.start()
        play(fresh, steps, sessionRef.current.view())
      }
    }, 100)
    return () => clearInterval(interval)
  }, [busy, play, view.phase])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.target instanceof HTMLInputElement) return
      if (event.key.toLowerCase() === 'c') {
        if (view.legal?.check.enabled) act({ kind: 'check' })
        else if (view.legal?.call.enabled) act({ kind: 'call' })
      }
      if (
        event.key.toLowerCase() === 'f' &&
        view.legal?.fold.enabled &&
        !view.legal.check.enabled
      ) {
        act({ kind: 'fold' })
      }
      if (event.key.toLowerCase() === 'a' && view.legal?.allIn.enabled) {
        allInRef.current?.focus()
        allInRef.current?.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }))
      }
      if (event.key.toLowerCase() === 'r' && view.legal?.raiseTo.enabled) {
        raiseRef.current?.focus()
      }
      if (/^[1-4]$/.test(event.key) && view.legal?.raiseTo.enabled) {
        const minimum = view.legal.raiseTo.min
        const maximum = view.legal.allIn.amount
        const values = [minimum, Math.round(view.pot / 2), view.pot, maximum]
        setRaiseTo(Math.min(maximum, Math.max(minimum, values[Number(event.key) - 1] ?? minimum)))
      }
      if (event.key.toLowerCase() === 'v' && view.commit !== null) setVerifyOpen(true)
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        const controls = Array.from(
          document.querySelectorAll<HTMLElement>(
            '.river-stage button:not(:disabled), .river-stage input:not(:disabled)',
          ),
        )
        const current = controls.indexOf(document.activeElement as HTMLElement)
        const delta = event.key === 'ArrowRight' ? 1 : -1
        controls[(current + delta + controls.length) % controls.length]?.focus()
      }
      if (event.key === 'Escape') {
        if (verifyOpen) setVerifyOpen(false)
        else if (settingsOpen) setSettingsOpen(false)
        else setSettingsOpen(true)
      }
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'a') return
      allInRef.current?.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }))
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [act, settingsOpen, verifyOpen, view.commit, view.legal, view.pot])

  useEffect(() => {
    const syncFullscreen = () => setTvMode(document.fullscreenElement !== null)
    document.addEventListener('fullscreenchange', syncFullscreen)
    syncFullscreen()
    return () => document.removeEventListener('fullscreenchange', syncFullscreen)
  }, [])

  useEffect(() => {
    if (settingsOpen || verifyOpen) modalCloseRef.current?.focus()
  }, [settingsOpen, verifyOpen])

  const changeSkill = (next: BotSkill) => {
    clearPlayback()
    const session = createSession(next)
    sessionRef.current = session
    skillRef.current = next
    setSkill(next)
    setView(cloneView(session.view()))
    setBusy(false)
    setOutcome(null)
    setSettingsOpen(false)
  }

  const rebuy = () => {
    if (sessionRef.current.rebuy('you')) setView(cloneView(sessionRef.current.view()))
  }

  const enterTvMode = async () => {
    if (document.fullscreenElement === null) {
      await document.documentElement.requestFullscreen().catch(() => undefined)
    } else {
      await document.exitFullscreen().catch(() => undefined)
    }
  }

  const countdown = Math.max(0, Math.ceil(view.countdownMs / 1000))
  const status = playerMessage(view.message) ?? (view.phase === 'between' ? outcome : null)

  return (
    <main className={twoColour ? 'river-app deck-two-colour' : 'river-app'}>
      <div className="stage-fit">
        <section
          className="river-stage three-dimensional"
          aria-label="River poker table"
          style={{ transform: `scale(${stageScale})` }}
        >
          <RiverVenue
            venueId={DEFAULT_VENUE}
            seatIds={orderedSeats(view).map((seat) => seat.id)}
            seatRefs={seatRefs}
          />
          <div className="hud-layer">
            <nav className="menu-cluster" aria-label="Table menu">
              <HoldButton
                disabled={false}
                duration={tvMode ? 1000 : 0}
                className="tv-button"
                ariaLabel={tvMode ? 'Hold to exit TV mode' : 'Enter TV mode'}
                ariaPressed={tvMode}
                onComplete={() => void enterTvMode()}
              >
                TV
              </HoldButton>
              <button type="button" onClick={() => setSettingsOpen(true)} aria-label="Settings">
                SET
              </button>
              <button type="button" onClick={() => changeSkill(skill)} aria-label="New session">
                NEW
              </button>
            </nav>

            <button
              type="button"
              className="verify-pill"
              disabled={view.commit === null}
              onClick={() => setVerifyOpen(true)}
            >
              <span>VERIFY</span>
              <strong>{view.commit?.slice(0, 8) ?? '--------'}</strong>
            </button>

            <div className="pot-readout" role="status" aria-label={`Pot ${view.pot}`}>
              <span>POT</span>
              <strong>{formatAmount(view.pot, false)}</strong>
              <div className="pot-chips" aria-hidden="true">
                <i />
                <i />
                <i />
              </div>
            </div>

            <Board cards={view.board} street={view.street} twoColour={twoColour} />

            <div className={status ? 'status-line populated' : 'status-line'} aria-live="polite">
              {view.phase === 'between' && countdown > 0 ? (
                <span className="countdown">
                  {status === null ? '' : `${status} · `}NEXT HAND · {countdown}
                </span>
              ) : (
                status
              )}
            </div>

            <div className="seat-ring">
              {orderedSeats(view).map((seat, index, seats) => (
                <Seat
                  key={seat.id}
                  seat={seat}
                  index={index}
                  count={seats.length}
                  active={seat.id === view.currentActorId}
                  phase={view.phase}
                  twoColour={twoColour}
                  anchorRef={(element) => {
                    if (element === null) seatRefs.current.delete(seat.id)
                    else seatRefs.current.set(seat.id, element)
                  }}
                />
              ))}
            </div>

            <ActionRail
              view={view}
              busy={busy}
              raiseTo={raiseTo}
              setRaiseTo={setRaiseTo}
              callRef={callRef}
              allInRef={allInRef}
              raiseRef={raiseRef}
              onStart={startHand}
              onRebuy={rebuy}
              onAction={act}
            />

            {busy && lastStep !== null ? (
              <div className="playback-label" aria-live="polite">
                {stepLabel(lastStep)}
              </div>
            ) : null}

            {settingsOpen ? (
              <div className="modal-backdrop" role="presentation">
                <section
                  className="modal"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="settings-title"
                >
                  <button
                    ref={modalCloseRef}
                    className="modal-close"
                    type="button"
                    onClick={() => setSettingsOpen(false)}
                  >
                    CLOSE
                  </button>
                  <p className="eyebrow">TABLE SETTINGS</p>
                  <h2 id="settings-title">Choose your room</h2>
                  <div className="skill-grid">
                    {(['rookie', 'novice', 'og'] as const).map((level) => (
                      <button
                        type="button"
                        className={skill === level ? 'selected' : ''}
                        key={level}
                        onClick={() => changeSkill(level)}
                      >
                        <strong>{level.toUpperCase()}</strong>
                        <span>{skillCopy(level)}</span>
                      </button>
                    ))}
                  </div>
                  <button
                    className="deck-toggle"
                    type="button"
                    onClick={() => setTwoColour((value) => !value)}
                  >
                    DECK · {twoColour ? 'TRADITIONAL TWO-COLOUR' : 'TV FOUR-COLOUR'}
                  </button>
                </section>
              </div>
            ) : null}

            {verifyOpen ? (
              <div className="modal-backdrop" role="presentation">
                <section
                  className="modal verify-modal"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="verify-title"
                >
                  <button
                    ref={modalCloseRef}
                    className="modal-close"
                    type="button"
                    onClick={() => setVerifyOpen(false)}
                  >
                    CLOSE
                  </button>
                  <p className="eyebrow">FAIRNESS COMMIT</p>
                  <h2 id="verify-title">The deck was locked before the deal.</h2>
                  <code>{view.commit}</code>
                  <p>
                    {view.revealed
                      ? 'Hand complete. Reveal verification is available.'
                      : 'The seed remains hidden until showdown.'}
                  </p>
                </section>
              </div>
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

function Board({ cards, street }: { cards: CardValue[]; street: string; twoColour: boolean }) {
  return (
    <section className="board" aria-label={`${street}, ${cards.length} community cards`}>
      <span className="street-label">{street.toUpperCase()}</span>
      <div className="board-cards">
        {boardSlots.map((slot, index) => {
          const card = cards[index]
          return card === undefined ? (
            <div className="card-well" key={slot} />
          ) : (
            <PlayingCard card={card} key={`${card.rank}${card.suit}`} />
          )
        })}
      </div>
    </section>
  )
}

function PlayingCard({ card, hero = false }: { card: CardValue; hero?: boolean }) {
  const symbol = { s: '♠', h: '♥', d: '♦', c: '♣' }[card.suit]
  return (
    <div
      className={`playing-card suit-${card.suit}${hero ? ' hero-card' : ''}`}
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

function Seat({
  seat,
  index,
  count,
  active,
  phase,
  anchorRef,
}: {
  seat: ViewSeat
  index: number
  count: number
  active: boolean
  phase: SoloTableView['phase']
  twoColour: boolean
  anchorRef: (element: HTMLElement | null) => void
}) {
  const position =
    seatPositions[count]?.[index] ?? seatPositions[9]?.[index] ?? fallbackSeatPosition
  const classes = ['seat']
  if (active) classes.push('active')
  if (seat.busted) classes.push('busted')
  else if (seat.folded) classes.push('folded')
  else if (seat.allIn) classes.push('all-in')
  else if (seat.sittingOut && (phase !== 'hand' || !seat.hasHole)) classes.push('sitting-out')
  if (index === 0) classes.push('hero-seat')
  if (count === 2 && index === 1) classes.push('seat-wide')
  const label = seat.busted
    ? 'BUSTED'
    : seat.folded
      ? 'FOLDED'
      : seat.allIn
        ? 'ALL IN'
        : active
          ? 'TO ACT'
          : null
  return (
    <article
      ref={anchorRef}
      className={classes.join(' ')}
      style={{ '--seat-x': `${position.x}%`, '--seat-y': `${position.y}%` } as CSSProperties}
    >
      <div className="seat-cards">
        {seat.hasHole && seat.hole === null ? (
          <>
            <CardBack />
            <CardBack />
          </>
        ) : null}
        {seat.hole?.map((card) => (
          <PlayingCard card={card} hero={!seat.isBot} key={`${card.rank}${card.suit}`} />
        ))}
      </div>
      <div className="avatar" aria-hidden="true">
        {seat.name.slice(0, 1)}
      </div>
      <div className="seat-copy">
        <span>{seat.name}</span>
        <strong>{formatAmount(seat.stack, seat.isBot)}</strong>
        <small>{label ?? (seat.isBot ? 'BOT' : 'YOU')}</small>
      </div>
      <div className="timer-housing" aria-hidden="true" />
      {seat.dealer ? <div className="dealer-button">D</div> : null}
      {seat.betStreet > 0 ? (
        <div className="seat-bet">
          <i />
          <b>{formatAmount(seat.betStreet, seat.isBot)}</b>
        </div>
      ) : null}
    </article>
  )
}

function ActionRail({
  view,
  busy,
  raiseTo,
  setRaiseTo,
  callRef,
  allInRef,
  raiseRef,
  onStart,
  onRebuy,
  onAction,
}: {
  view: SoloTableView
  busy: boolean
  raiseTo: number
  setRaiseTo: (value: number) => void
  callRef: React.RefObject<HTMLButtonElement | null>
  allInRef: React.RefObject<HTMLButtonElement | null>
  raiseRef: React.RefObject<HTMLInputElement | null>
  onStart: () => void
  onRebuy: () => void
  onAction: (action: TurnAction) => void
}) {
  const legal = view.legal
  const hero = view.seats.find((seat) => !seat.isBot)
  if (view.phase !== 'hand') {
    const rebuy = view.phase === 'between' && hero?.busted
    return (
      <div className="action-rail single-action">
        <button type="button" onClick={rebuy ? onRebuy : onStart}>
          {rebuy ? 'REBUY 100,000' : view.phase === 'ready' ? 'DEAL' : 'DEAL NOW'}
        </button>
      </div>
    )
  }
  const disabled = busy || view.currentActorId !== 'you'
  const canRaise = legal?.raiseTo.enabled ?? false
  const maximum = legal?.allIn.amount ?? 0
  const minimum = legal?.raiseTo.min ?? 0
  return (
    <div className="action-rail">
      <div className={canRaise ? 'bet-sizing' : 'bet-sizing hidden'}>
        <output>RAISE TO {formatAmount(raiseTo, false)}</output>
        <input
          ref={raiseRef}
          aria-label="Raise amount"
          type="range"
          min={minimum}
          max={Math.max(minimum, maximum)}
          step={STAKE_250_500.bigBlind}
          value={Math.min(Math.max(raiseTo, minimum), Math.max(minimum, maximum))}
          disabled={!canRaise || disabled}
          onChange={(event) => setRaiseTo(Number(event.target.value))}
        />
        <div className="presets">
          {[
            { id: 'minimum', label: 'MIN', value: minimum },
            { id: 'half-pot', label: '1/2 POT', value: Math.round(view.pot / 2) },
            { id: 'pot', label: 'POT', value: view.pot },
            { id: 'maximum', label: 'MAX', value: maximum },
          ].map(({ id, label, value }) => {
            const clamped = Math.min(maximum, Math.max(minimum, value))
            return (
              <button
                type="button"
                key={id}
                disabled={!canRaise || disabled}
                onClick={() => setRaiseTo(clamped)}
              >
                {label}
              </button>
            )
          })}
        </div>
      </div>
      <div className="action-buttons">
        <HoldButton
          buttonRef={allInRef}
          disabled={!legal?.allIn.enabled || disabled}
          duration={600}
          className="all-in-button"
          onComplete={() => onAction({ kind: 'allIn' })}
        >
          ALL IN {formatAmount(maximum, false)}
        </HoldButton>
        <HoldButton
          disabled={!legal?.fold.enabled || disabled}
          duration={legal?.check.enabled ? 400 : 0}
          className="fold-button"
          onComplete={() => onAction({ kind: 'fold' })}
        >
          FOLD
        </HoldButton>
        <button
          ref={callRef}
          type="button"
          disabled={disabled || (!legal?.check.enabled && !legal?.call.enabled)}
          onClick={() => onAction(legal?.check.enabled ? { kind: 'check' } : { kind: 'call' })}
        >
          {legal?.check.enabled ? 'CHECK' : `CALL ${formatAmount(legal?.call.amount ?? 0, false)}`}
        </button>
        <HoldButton
          className="raise-button"
          disabled={!canRaise || disabled}
          duration={raiseTo >= maximum ? 600 : 0}
          onComplete={() =>
            onAction(raiseTo >= maximum ? { kind: 'allIn' } : { kind: 'raiseTo', to: raiseTo })
          }
        >
          {raiseTo >= maximum ? 'ALL IN' : `RAISE TO ${formatAmount(raiseTo, false)}`}
        </HoldButton>
      </div>
    </div>
  )
}

function HoldButton({
  duration,
  disabled,
  onComplete,
  className,
  ariaLabel,
  ariaPressed,
  buttonRef,
  children,
}: {
  duration: number
  disabled: boolean
  onComplete: () => void
  className: string
  ariaLabel?: string
  ariaPressed?: boolean
  buttonRef?: React.RefObject<HTMLButtonElement | null>
  children: React.ReactNode
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [holding, setHolding] = useState(false)
  const cancel = () => {
    if (timer.current !== null) clearTimeout(timer.current)
    timer.current = null
    setHolding(false)
  }
  const begin = () => {
    if (disabled || timer.current !== null) return
    if (duration === 0) {
      onComplete()
      return
    }
    setHolding(true)
    timer.current = setTimeout(() => {
      timer.current = null
      setHolding(false)
      onComplete()
    }, duration)
  }
  const startPointer = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId)
    begin()
  }
  const startKeyboard = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    begin()
  }
  return (
    <button
      ref={buttonRef}
      type="button"
      className={`${className}${holding ? ' holding' : ''}`}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-pressed={ariaPressed}
      style={{ '--hold-duration': `${duration}ms` } as CSSProperties}
      onPointerDown={startPointer}
      onPointerUp={cancel}
      onPointerCancel={cancel}
      onPointerLeave={cancel}
      onKeyDown={startKeyboard}
      onKeyUp={cancel}
    >
      {children}
    </button>
  )
}

function stepLabel(step: SessionStep): string {
  if (step.kind === 'action')
    return `${step.seatId === 'you' ? 'You' : 'Opponent'} ${step.decision.kind}`
  if (step.kind === 'board') return step.street.toUpperCase()
  if (step.kind === 'showdown') return 'SHOWDOWN'
  if (step.kind === 'uncontested') return 'POT AWARDED'
  if (step.kind === 'handStarted') return `HAND ${step.handNumber}`
  return step.kind.toUpperCase()
}

function skillCopy(skill: BotSkill): string {
  if (skill === 'rookie') return 'Loose, readable, comfortably beatable.'
  if (skill === 'novice') return 'Cautious, credible, makes you earn it.'
  return 'Sharp, aggressive, fair. Never sees your cards.'
}
