'use client'

import {
  type Card,
  type Cosmetic,
  cosmeticCatalogue,
  DEFAULT_STAKE,
  itemCatalogue,
  SHOWDOWN_TENSION_MS,
  type TableSummary,
  type TurnAction,
} from '@river/engine'
import type { RoomEvent, RoomSeatView, RoomView } from '@river/server'
import type { ClientRoomCommand, ServerMessage } from '@river/server/wire'
import type { SupabaseClient } from '@supabase/supabase-js'
import dynamic from 'next/dynamic'
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
import { BETTING_ICON as MENU_ICON } from '@/components/betting-icons'
import { PhoneTable } from '@/components/phone-table'
import { RiverHandHistory } from '@/components/river-hand-history'
import { RiverLobby } from '@/components/river-lobby'
import { RiverSettings, usePreferences } from '@/components/river-settings'
import { RiverSoundControl } from '@/components/river-sound-control'
import type { HoleSeat } from '@/components/river-venue-scene'
import { Table2D, type TablePresentation } from '@/components/table-2d/table-2d'
import {
  ActionPin,
  CardBack,
  PlayingCard,
  type SeatActionFlag,
  TurnWatch,
} from '@/components/table-pieces'
import { type AnimationCue, CUE_HISTORY, cuesForEvents, endsHand, peekCue } from '@/lib/animation'
import {
  createRiverAuthClient,
  ensureRiverSession,
  loadBrowserAuthConfig,
  upgradeRiverSession,
} from '@/lib/auth'
import { sizingPresets } from '@/lib/betting'
import { affordableBuyIn } from '@/lib/buy-in'
import { type ChipMoment, chipMomentFor } from '@/lib/chip-flow'
import { readoutFor } from '@/lib/hand-readout'
import { type SessionHand, withSettledHands } from '@/lib/history'
import { phoneViewport } from '@/lib/phone-layout'
import { censorProfanity as maskProfanity } from '@/lib/preferences'
import { formatAmount } from '@/lib/presentation'
import {
  canArmPreset,
  PRESET_LABELS,
  type PresetKind,
  resolvePreset,
  shouldClearPreset,
} from '@/lib/preset'
import { type RepFlash, repFlashFor, shouldShowRate } from '@/lib/rep-feedback'
import {
  type PendingSeatRequest,
  requeueSeatRequest,
  type SeatRequest,
  seatRequestOpen,
  toggleSeatRequest,
} from '@/lib/seat-request'
import {
  actionLabel,
  equippedRatePercent,
  isActionable,
  type OwnedEntry,
  shopRows,
} from '@/lib/shop'
import { beforeAwards, cardsTurned, type ShowdownPlan, showdownPlanFor } from '@/lib/showdown-plan'
import {
  appendSocialEvent,
  applySpeaking,
  bubbleFor,
  CHAT_MAX_LENGTH,
  normaliseChat,
  type SeatBubble,
  type SocialFeedEntry,
  withBubble,
} from '@/lib/social'
import {
  defaultRiverSocketUrl,
  RiverSocket,
  type RiverSocketState,
  type SocketLike,
} from '@/lib/socket'
import { LANDSCAPE } from '@/lib/table-2d-geometry'
import { tableSound } from '@/lib/table-sound'
import {
  initialRoomTarget,
  LAST_TABLE_KEY,
  rememberTable,
  shortTableLink,
} from '@/lib/table-target'
import { useInterfaceSound } from '@/lib/use-interface-sound'
import {
  DEFAULT_VENUE,
  supports3DPlayerCount,
  type VenueId,
  venueOf,
  worldSeats,
} from '@/lib/venue'
import { type VerifyResult, verifyHand } from '@/lib/verify'

const boardSlots = ['flop-one', 'flop-two', 'flop-three', 'turn', 'river'] as const

/**
 * Bots carry an id the server gives nothing else - see botPlayerId there. The table uses it
 * to leave a bot's looks at its cards to the server, which decides when a bot looks.
 */
function isBotPlayerId(playerId: string | null): boolean {
  return playerId?.startsWith('bot:') ?? false
}

/** Mirrors the server: a second press inside most of a look is the same look. */
const LOOK_INTERVAL_MS = 1_200

/** How many chip moments the running list keeps. The scene only reads the newest few. */
const CHIP_HISTORY = 16

/**
 * Whether the 3D room can be switched on. Off in every public build: the 2D table is the
 * game for now, and a developer turns the room on with NEXT_PUBLIC_RIVER_3D=on.
 */
const THREE_D_SWITCH = process.env.NEXT_PUBLIC_RIVER_3D === 'on'

/**
 * The 3D room, reachable only through the switch. The variable is fixed when the app is
 * built, so without it this is null and the room's code - three.js, the scene, the venue
 * files it preloads - is never fetched, rather than fetched and left unused.
 */
const RiverVenue = THREE_D_SWITCH
  ? dynamic(() => import('@/components/river-venue').then((module) => module.RiverVenue), {
      ssr: false,
    })
  : null

/** How soon a dropped table tries again, and the longest it waits between tries. */
/** How long somebody else's quick look holds their cards up: the length of a look. */
const GLANCE_MS = 1_400
/** How long a sit that did not land waits before the table tries to seat you again. */
const AUTO_SIT_RETRY_MS = 2_500
const RECONNECT_FIRST_MS = 900
const RECONNECT_CEILING_MS = 10_000
/** How long the table takes to come up from black when it first appears. */
const TABLE_FADE_MS = 500
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

/**
 * Back to the club, forgetting the table. A remembered table exists so a reload
 * finds the seat that holds your buy-in; once the stack is back in the bankroll
 * it would only put Play straight back at the table you just left.
 */
function returnToClub(): void {
  try {
    window.localStorage.removeItem(LAST_TABLE_KEY)
  } catch {
    // Storage can be unavailable. Remembering the table costs a rejoin, not chips.
  }
  window.location.assign('/')
}

function emptyView(selfId = 'pending', venueId: VenueId = DEFAULT_VENUE): RoomView {
  return {
    venueId,
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
    turnDeadlineMs: null,
    turnBudgetMs: null,
    commit: null,
    revealedSeed: null,
    clientSeeds: null,
    message: null,
    revealed: false,
    selfId,
    challenges: [],
    hostPlayerId: '',
    inviteCode: '',
  }
}

function verifyStatusLabel(status: VerifyResult['status']): string {
  switch (status) {
    case 'match':
      return 'Fairness verified, commit matches the revealed seed'
    case 'mismatch':
      return 'Fairness check failed, commit does not match'
    case 'live':
      return 'Fairness commit published, seed still hidden'
    default:
      return 'Fairness commit not yet published'
  }
}

function verifyHeadline(status: VerifyResult['status']): string {
  switch (status) {
    case 'match':
      return 'This hand checks out.'
    case 'mismatch':
      return 'This hand does not check out.'
    case 'live':
      return 'The deck was locked before the deal.'
    default:
      return 'No hand committed yet.'
  }
}

function verifyCopy(status: VerifyResult['status']): string {
  switch (status) {
    case 'match':
      return 'Recomputed in your browser: the revealed seed hashes to the commit published before the deal. Nobody could have chosen this deck after seeing a card.'
    case 'mismatch':
      return 'The revealed seed does not hash to the published commit. Do not keep playing at this table.'
    case 'live':
      return 'The commit is published and the server seed stays hidden until the hand settles. Your own seed is mixed in, so the deck is not the server’s alone.'
    default:
      return 'A commit appears when the next hand begins.'
  }
}

/**
 * What the player is holding, under the board.
 *
 * It reads from the view's own seat rather than being pushed by the server,
 * so it can never say something the player is not entitled to see - the hole
 * cards are only in the view at all when they are theirs.
 */
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

function flagForAction(action: TurnAction): SeatActionFlag {
  switch (action.kind) {
    case 'check':
      return { label: 'CHECK', tone: 'quiet' }
    case 'call':
      return { label: 'CALL', tone: 'commit' }
    case 'raiseTo':
      return { label: 'RAISE', tone: 'commit' }
    case 'allIn':
      return { label: 'ALL IN', tone: 'danger' }
    case 'fold':
      return { label: 'FOLD', tone: 'danger' }
  }
}

function actionFlagsAfter(
  current: ReadonlyMap<string, SeatActionFlag>,
  events: readonly RoomEvent[],
): ReadonlyMap<string, SeatActionFlag> {
  let next: Map<string, SeatActionFlag> | null = null
  const writable = () => {
    next ??= new Map(current)
    return next
  }
  for (const event of events) {
    if (event.kind === 'handStarted' || event.kind === 'street' || event.kind === 'between') {
      next = new Map()
      continue
    }
    if (event.kind === 'awaiting') {
      writable().delete(event.playerId)
      continue
    }
    if (event.kind === 'acted' || event.kind === 'timedOut' || event.kind === 'awayPlayed') {
      writable().set(event.playerId, flagForAction(event.action))
    }
  }
  return next ?? current
}

function browserFairnessSeed(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function useTurnRemaining(deadline: number | null): number | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (deadline === null) return
    const update = () => setNow(Date.now())
    update()
    const interval = window.setInterval(update, 100)
    return () => window.clearInterval(interval)
  }, [deadline])
  return deadline === null ? null : Math.max(0, deadline - now)
}

/** A scripted table: a socket that replays recorded hands, and no account behind it. */
export interface TableLab {
  createSocket: (url: string) => SocketLike
}

export function RiverRoomTable({ lab }: { lab?: TableLab } = {}) {
  const [
    {
      roomId,
      inviteCode,
      expired,
      venueId: initialVenue,
      botSeats: requestedBotSeats,
      botPreset: requestedBotPreset,
    },
  ] = useState(initialRoomTarget)
  const [view, setView] = useState<RoomView>(() => emptyView('pending', initialVenue))
  // How many seats fill with bots on the deal. Not part of the room view,
  // because it is the server's arrangement rather than the table's state.
  const [botSeats, setBotSeats] = useState(0)
  // The table owns the venue, not this browser. The link's venue only decides
  // which room a new table opens in; once a snapshot arrives the server is the
  // authority, so two players can never be sitting in different rooms.
  const venueId = view.venueId
  const [connection, setConnection] = useState<ConnectionState>('connecting')
  const [notice, setNotice] = useState<string | null>(null)
  const [joinCode, setJoinCode] = useState(inviteCode ?? '')
  const [upgradeState, setUpgradeState] = useState<UpgradeState>(expired ? 'expired' : 'idle')
  // Whether the server knows this player by an account rather than as a guest.
  const [signedIn, setSignedIn] = useState(false)
  const [upgradeEmail, setUpgradeEmail] = useState('')
  const [kick, setKick] = useState<KickState>(null)
  // A stand, rebuy or leave waiting for the gap between hands, or sent and
  // waiting for the server. The socket handler is bound once per table, so it
  // reads the ref to tell which reply answers it.
  const [seatRequest, setSeatRequest] = useState<PendingSeatRequest | null>(null)
  const seatRequestRef = useRef<PendingSeatRequest | null>(null)
  const [peek, setPeek] = useState(false)
  const [platesHeld, setPlatesHeld] = useState(false)
  const [seatActions, setSeatActions] = useState<ReadonlyMap<string, SeatActionFlag>>(
    () => new Map(),
  )
  // The showdown being told, one hand at a time, and how far into it the table is.
  const [showdown, setShowdown] = useState<ShowdownPlan | null>(null)
  const [showdownAtMs, setShowdownAtMs] = useState(-1)
  const showdownSetAt = useRef<number | null>(null)
  // How far the felt has got through the hand, and what waits for the showdown to be told.
  const [presentation, setPresentation] = useState<TablePresentation>({
    boardShown: 0,
    showdownStartsAt: null,
  })
  const afterShowdown = useRef<(() => void)[]>([])
  // Seats whose player is holding their cards up - yours, and everybody else's.
  const [heldPeeks, setHeldPeeks] = useState<readonly number[]>([])
  const [selectedSeat, setSelectedSeat] = useState<number | null>(null)
  const [raiseTo, setRaiseTo] = useState(0)
  const [stageScale, setStageScale] = useState(2 / 3)
  const [viewport, setViewport] = useState({ width: 1920, height: 1080 })
  // The 2D table is River v1. The 3D room is heavy and not ready to show, so it stays behind
  // a developer switch, and without the switch its code and assets never load at all. With the
  // switch on, it still only takes tables its ring can seat.
  const [graphicsMode, setGraphicsMode] = useState<'two' | 'three'>('two')
  const [heroDealt, setHeroDealt] = useState(true)
  const supportsThree = supports3DPlayerCount(view.seats.length)
  const activeGraphicsMode = THREE_D_SWITCH && supportsThree ? graphicsMode : 'two'
  const [preset, setPreset] = useState<PresetKind | null>(null)
  const presetFiredFor = useRef<string | null>(null)
  const [presetNotice, setPresetNotice] = useState<string | null>(null)
  const viewRef = useRef<RoomView>(emptyView())
  const [feed, setFeed] = useState<readonly SocialFeedEntry[]>([])
  // The same settings the menu keeps, changeable here without leaving the table.
  const [preferences, setPreferences] = usePreferences()
  const [settingsOpen, setSettingsOpen] = useState(false)
  // The socket handler is bound once per table, so it reads the profanity
  // setting through a ref: a setting changed at the table applies to the next
  // line said, and changing it never reconnects the table.
  const censorRef = useRef(preferences.censorProfanity)
  useEffect(() => {
    censorRef.current = preferences.censorProfanity
  }, [preferences.censorProfanity])
  // Every amount at the table is in chips, or in this table's big blinds for a
  // player who has asked for that. The view names its stake rather than
  // carrying its blinds, and every table plays the one stake the engine
  // defines, which is where the raise step already reads its big blind.
  const bigBlind = preferences.amountsInBigBlinds ? DEFAULT_STAKE.bigBlind : null
  const [speaking, setSpeaking] = useState<ReadonlySet<string>>(() => new Set())
  const [chatDraft, setChatDraft] = useState('')
  const [socialOpen, setSocialOpen] = useState(false)
  // Lines said at the table, up for a moment at the speaker's seat, and how many arrived while
  // the log was shut. The socket handler is bound once, so it reads whether the log is open
  // through a ref.
  const [bubbles, setBubbles] = useState<readonly SeatBubble[]>([])
  const bubbleSerial = useRef(0)
  const [unread, setUnread] = useState(0)
  const socialOpenRef = useRef(false)
  useEffect(() => {
    socialOpenRef.current = socialOpen
    if (socialOpen) setUnread(0)
  }, [socialOpen])
  useEffect(() => {
    if (bubbles.length === 0) return
    const soonest = Math.min(...bubbles.map((bubble) => bubble.until))
    const timer = window.setTimeout(
      () => setBubbles((current) => current.filter((bubble) => bubble.until > Date.now())),
      Math.max(0, soonest - Date.now()) + 20,
    )
    return () => window.clearTimeout(timer)
  }, [bubbles])
  const [repFlash, setRepFlash] = useState<RepFlash | null>(null)
  const [balance, setBalance] = useState(0)
  const [ownedItems, setOwnedItems] = useState<readonly OwnedEntry[]>([])
  const [shopOpen, setShopOpen] = useState(false)
  const [shopTab, setShopTab] = useState<'items' | 'wear'>('items')
  const [ownedCosmetics, setOwnedCosmetics] = useState<
    readonly { cosmeticId: string; slot: string; equipped: boolean }[]
  >([])
  const [cues, setCues] = useState<readonly AnimationCue[]>([])
  // Chips on the move, worked out from each message against the one before it. The view the
  // last moment was measured from is kept here rather than read from state, because two
  // messages can arrive before a render and the second must be measured from the first.
  const [chipMoments, setChipMoments] = useState<readonly ChipMoment[]>([])
  const chipView = useRef<RoomView | null>(null)
  const chipSerial = useRef(0)
  // Who folded this hand. The view forgets the moment the hand is over - every seat reads
  // as not folded between hands - and a folded hand must not turn face up at the showdown.
  const foldedThisHand = useRef<{ hand: number; seats: Set<number> }>({
    hand: 0,
    seats: new Set(),
  })
  const cueSerial = useRef(0)
  // A running list rather than the latest batch - see AnimationCue.serial for what the
  // latest batch used to lose.
  const pushCues = useCallback((next: readonly AnimationCue[]) => {
    if (next.length === 0) return
    const stamped = next.map((cue) => {
      cueSerial.current += 1
      return { ...cue, serial: cueSerial.current }
    })
    setCues((current) => [...current, ...stamped].slice(-CUE_HISTORY))
  }, [])
  // Anyone standing for an all-in sits back down when a hand finishes, and the scene needs
  // to be told each time rather than once.
  const [handsFinished, setHandsFinished] = useState(0)
  const [hands, setHands] = useState<readonly SessionHand[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [tables, setTables] = useState<readonly TableSummary[]>([])
  const [lobbyOpen, setLobbyOpen] = useState(false)
  // The table code shows on demand rather than all the time: INVITE copies the
  // link, then holds the code up briefly for reading out to someone in the room.
  const [inviteShown, setInviteShown] = useState(false)
  const [verifyOpen, setVerifyOpen] = useState(false)
  const [verify, setVerify] = useState<VerifyResult>({
    status: 'idle',
    recomputedCommit: null,
    deckEntropy: null,
  })
  // The table comes up from black when this screen first appears, and at no
  // other time. The veil belongs to the screen rather than to the connection,
  // so a table that drops and reconnects carries on without fading again, and
  // it is removed once it has run so nothing later can start it over. It is
  // also removed at once for a player who has asked for less motion, where it
  // never shows at all.
  const [arriving, setArriving] = useState(true)
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setArriving(false)
      return
    }
    // The fade can end before the page is interactive, when there is nobody
    // listening for the end of it.
    const timer = window.setTimeout(() => setArriving(false), TABLE_FADE_MS * 2)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    let cancelled = false
    void verifyHand(view.commit, view.revealedSeed, view.clientSeeds).then((result) => {
      if (!cancelled) setVerify(result)
    })
    return () => {
      cancelled = true
    }
  }, [view.commit, view.revealedSeed, view.clientSeeds])
  const socketRef = useRef<RiverSocket | null>(null)
  const authRef = useRef<SupabaseClient | null>(null)
  const kickRef = useRef<KickState>(null)
  const nameRef = useRef('Guest')
  const seatRefs = useRef(new Map<string, HTMLElement>())
  const reconnectRef = useRef<number | null>(null)
  const inviteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (inviteTimerRef.current !== null) clearTimeout(inviteTimerRef.current)
    },
    [],
  )

  useEffect(() => {
    if (notice === null || connection !== 'connected') return
    const currentNotice = notice
    const timer = window.setTimeout(
      () => setNotice((current) => (current === currentNotice ? null : current)),
      2600,
    )
    return () => window.clearTimeout(timer)
  }, [connection, notice])

  const command = useCallback((next: ClientRoomCommand) => {
    try {
      socketRef.current?.command(next)
    } catch {
      setNotice('Reconnecting…')
    }
  }, [])

  // Send the waiting seat change if the room will take it. The socket handler
  // calls this as soon as a snapshot opens the gap, because waiting for a render
  // cost a slow machine two of the gap's three seconds and the next hand had
  // started by the time the request landed. The ref keeps it to one send.
  const flushSeatRequest = useCallback((phase: RoomView['phase']) => {
    const waiting = seatRequestRef.current
    if (waiting === null || waiting.requestId !== null || !seatRequestOpen(waiting.request, phase))
      return
    try {
      const requestId = socketRef.current?.command(waiting.request) ?? null
      const sent = requestId === null ? null : { ...waiting, requestId }
      seatRequestRef.current = sent
      setSeatRequest(sent)
    } catch {
      seatRequestRef.current = null
      setNotice('Reconnecting…')
      setSeatRequest(null)
    }
  }, [])

  useEffect(() => {
    let disposed = false
    let unsubscribeMessage: (() => void) | null = null
    let unsubscribeState: (() => void) | null = null
    // One retry pending at a time, backing off while the server stays away. A lost socket
    // and a failed attempt can both ask for one, and two would open two sockets.
    let retryMs = RECONNECT_FIRST_MS
    const reconnect = (afterMs: number) => {
      if (reconnectRef.current !== null) window.clearTimeout(reconnectRef.current)
      reconnectRef.current = window.setTimeout(() => {
        reconnectRef.current = null
        void connect()
      }, afterMs)
    }
    const connect = async (): Promise<void> => {
      setConnection((previous) => (previous === 'connected' ? 'reconnecting' : 'connecting'))
      try {
        // The motion lab replays recorded hands over a socket of its own and signs nobody in,
        // so it never creates a guest.
        let accessToken = 'motion-lab'
        if (lab === undefined) {
          const config = await loadBrowserAuthConfig()
          if (disposed) return
          const auth = createRiverAuthClient(config)
          authRef.current = auth
          const session = await ensureRiverSession(auth)
          if (disposed) return
          accessToken = session.access_token
        }
        const url = defaultRiverSocketUrl(window.location)
        const socket = new RiverSocket(
          lab === undefined ? { url } : { url, createSocket: lab.createSocket },
        )
        socketRef.current = socket
        // Whatever moved while the socket was down moved without us; the first view after a
        // reconnect says where things are and moves nothing.
        chipView.current = null
        unsubscribeMessage = socket.subscribe((message: ServerMessage) => {
          if (message.kind === 'authenticated') {
            setSignedIn(!message.anonymous)
            return
          }
          if (message.kind === 'error') {
            const refused = seatRequestRef.current
            if (
              refused !== null &&
              message.requestId !== null &&
              refused.requestId === message.requestId
            ) {
              // Usually refused because the next hand began before it landed. It
              // waits for another gap, and says nothing unless it gives up.
              const retry = requeueSeatRequest(refused)
              seatRequestRef.current = retry
              setSeatRequest(retry)
              if (retry !== null) return
            }
            setNotice(message.message)
            return
          }
          if (message.kind === 'tables') {
            setTables(message.tables)
            return
          }
          if (message.kind === 'social') {
            const event = message.event
            // Somebody else looking at their cards. Your own look already played when you
            // pressed, without waiting for the round trip.
            if (event.kind === 'peeked' && event.playerId !== viewRef.current.selfId) {
              const looking = viewRef.current.seats.find(
                (entry) => entry.playerId === event.playerId,
              )
              if (looking !== undefined) {
                if (event.holding !== false) pushCues([peekCue(looking.seat)])
                // A look with no hold in it - a bot's, which the server sends with
                // nothing to press - is a glance: the cards come up for as long as a
                // look takes and go down on their own. The felt only drew held looks,
                // so every bot read its cards where nobody could see it.
                const glancing = glanceTimers.current.get(looking.seat)
                if (glancing !== undefined) {
                  window.clearTimeout(glancing)
                  glanceTimers.current.delete(looking.seat)
                }
                if (event.holding !== false) {
                  setHeldPeeks((held) =>
                    held.includes(looking.seat) ? held : [...held, looking.seat],
                  )
                }
                if (event.holding === undefined) {
                  const seat = looking.seat
                  glanceTimers.current.set(
                    seat,
                    window.setTimeout(() => {
                      glanceTimers.current.delete(seat)
                      setHeldPeeks((held) => held.filter((entry) => entry !== seat))
                    }, GLANCE_MS),
                  )
                }
                if (event.holding === false) {
                  setHeldPeeks((held) => held.filter((seat) => seat !== looking.seat))
                }
              }
            }
            setSpeaking((current) => applySpeaking(current, event))
            bubbleSerial.current += 1
            const bubble = bubbleFor(
              event,
              (playerId) =>
                viewRef.current.seats.find((entry) => entry.playerId === playerId)?.seat ?? null,
              bubbleSerial.current,
              Date.now(),
            )
            if (bubble !== null) {
              // The bubble over the seat follows the same profanity setting as the chat log.
              const shown =
                censorRef.current && bubble.kind === 'chat'
                  ? { ...bubble, text: maskProfanity(bubble.text) }
                  : bubble
              setBubbles((current) => withBubble(current, shown, Date.now()))
              if (!socialOpenRef.current && event.playerId !== viewRef.current.selfId) {
                setUnread((count) => count + 1)
              }
            }
            setFeed((current) =>
              appendSocialEvent(current, event, {
                selfId: viewRef.current.selfId,
                nameFor: (playerId) =>
                  viewRef.current.seats.find((seat) => seat.playerId === playerId)?.name ??
                  'Player',
              }),
            )
            return
          }
          if (message.kind === 'grant') {
            if (message.outcome.kind === 'granted') {
              setBalance(message.outcome.balance)
              setNotice(
                `${message.outcome.delta.toLocaleString()} chips added. Balance ${message.outcome.balance.toLocaleString()}.`,
              )
            } else {
              const copy =
                message.outcome.reason === 'already-claimed'
                  ? 'Daily chips already claimed.'
                  : message.outcome.reason === 'capped'
                    ? 'Rescue limit reached for today.'
                    : 'Rescue is for a bankroll short of one buy-in, away from a seat.'
              setNotice(copy)
            }
            return
          }
          if (message.kind !== 'snapshot') return
          chipSerial.current += 1
          const moment = chipMomentFor(
            chipView.current,
            message.view,
            message.events,
            chipSerial.current,
          )
          chipView.current = message.view
          // A showdown is told one hand at a time, and the pot waits for the last of them.
          const plan = showdownPlanFor(
            message.view,
            message.events,
            foldedThisHand.current.hand === message.view.handNumber
              ? foldedThisHand.current.seats
              : new Set(),
          )
          const timed =
            plan === null ? moment : { ...moment, awardDelaySeconds: plan.show.awardAtMs / 1000 }
          setChipMoments((current) => [...current, timed].slice(-CHIP_HISTORY))
          if (plan !== null) {
            // Not yet: the showdown is told once the felt has finished the board, which an
            // all-in run-out can take several seconds to do. Below zero means waiting.
            showdownSetAt.current = performance.now()
            setShowdown(plan)
            setShowdownAtMs(-1)
          }
          if (message.events.some((event) => event.kind === 'handStarted')) {
            setHeldPeeks([])
            // A showdown still being told when the next hand is dealt is over: what it held
            // back is told now, not left waiting for an ending that will never come.
            if (plan === null && afterShowdown.current.length > 0) {
              const waiting = afterShowdown.current
              afterShowdown.current = []
              for (const apply of waiting) apply()
              setShowdown(null)
              setShowdownAtMs(-1)
            }
          }
          if (foldedThisHand.current.hand !== message.view.handNumber) {
            foldedThisHand.current = { hand: message.view.handNumber, seats: new Set() }
          }
          if (message.view.phase === 'hand') {
            for (const seat of message.view.seats) {
              if (seat.folded) foldedThisHand.current.seats.add(seat.seat)
            }
          }
          setView(message.view)
          const answered = seatRequestRef.current
          if (
            answered !== null &&
            answered.requestId !== null &&
            answered.requestId === message.requestId
          ) {
            seatRequestRef.current = null
            setSeatRequest(null)
            if (answered.request.kind === 'leave') returnToClub()
          }
          flushSeatRequest(message.view.phase)
          setBotSeats(message.botSeats)
          setSeatActions((current) => actionFlagsAfter(current, message.events))
          // A check moves no chips, so nothing on the felt makes a sound for it.
          if (
            message.events.some(
              (event) =>
                (event.kind === 'acted' ||
                  event.kind === 'timedOut' ||
                  event.kind === 'awayPlayed') &&
                event.action.kind === 'check',
            )
          ) {
            tableSound.play('check_tap')
          }
          if (
            message.events.some((event) => event.kind === 'seedCommitted') &&
            message.view.seats.some(
              (seat) => seat.playerId === message.view.selfId && seat.stack > 0,
            )
          ) {
            try {
              socket.command({ kind: 'submitSeed', seed: browserFairnessSeed() })
            } catch {
              setNotice('Reconnecting…')
            }
          }
          const ownKick = message.events.find(
            (event) => event.kind === 'kicked' && event.playerId === message.view.selfId,
          )
          if (ownKick?.kind === 'kicked') {
            const nextKick = { reason: ownKick.reason } as const
            kickRef.current = nextKick
            setKick(nextKick)
            if (ownKick.reason === 'duplicate-session') socket.close()
          }
          setBalance(message.balance)
          setOwnedItems(message.ownedItems)
          setOwnedCosmetics(message.ownedCosmetics)
          const nextCues = cuesForEvents(
            message.events,
            (playerId) => {
              const seat = message.view.seats.find((entry) => entry.playerId === playerId)
              return seat?.seat ?? -1
            },
            // Who looks at their cards when a hand starts: every person dealt in. The bots
            // look when the server says they do, some on the deal and some only when the
            // action reaches them.
            {
              seatsInHand: message.view.seats
                .filter((seat) => seat.hasHole && !isBotPlayerId(seat.playerId))
                .map((seat) => seat.seat),
            },
          )
          pushCues(nextCues)
          if (endsHand(message.events)) setHandsFinished((finished) => finished + 1)
          const settled = message.events.flatMap((event) =>
            event.kind === 'handRecorded' ? [event.record] : [],
          )
          // The record and the REP both know who won. After a showdown they wait for it to be
          // told, or the panel and the flash would give the ending away during the run-out.
          const afterTheHand = (apply: () => void) => {
            if (plan === null) apply()
            else afterShowdown.current.push(apply)
          }
          if (settled.length > 0) {
            // Newest first, so the panel reads the way a player thinks about
            // the night: the hand that just happened is the one at the top.
            afterTheHand(() => setHands((previous) => withSettledHands(previous, settled)))
          }
          const flash = repFlashFor(message.events, message.view.selfId)
          if (flash !== null) afterTheHand(() => setRepFlash(flash))
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
            retryMs = RECONNECT_FIRST_MS
            setConnection('connected')
            setNotice(null)
            return
          }
          if (state !== 'closed' || disposed || kickRef.current?.reason === 'duplicate-session')
            return
          setConnection('reconnecting')
          setNotice('Reconnecting…')
          reconnect(RECONNECT_FIRST_MS)
        })
        await socket.connect(accessToken)
        if (disposed) return
        socket.enter(
          roomId,
          nameRef.current,
          inviteCode,
          initialVenue,
          requestedBotSeats,
          requestedBotPreset,
        )
      } catch {
        if (!disposed && kickRef.current?.reason !== 'duplicate-session') {
          setConnection('offline')
          setNotice('River is reconnecting. Your table remains visible.')
          // A failure before there is a socket to lose - fetching the auth config or the
          // session, which is what fails while the server restarts - used to end here, for
          // good: only a socket's close retried, and there was no socket. The notice said
          // reconnecting and nothing ever did.
          retryMs = Math.min(RECONNECT_CEILING_MS, retryMs * 2)
          reconnect(retryMs)
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
    // initialVenue is read once when a new table is opened. It comes from
    // useState's initialiser and never changes, but naming it keeps the rule
    // honest rather than silencing it. pushCues is stable for the same reason.
  }, [
    inviteCode,
    roomId,
    initialVenue,
    requestedBotSeats,
    requestedBotPreset,
    flushSeatRequest,
    pushCues,
    lab,
  ])

  useEffect(() => {
    const resize = () => {
      setStageScale(Math.min(window.innerWidth / 1920, window.innerHeight / 1080))
      setViewport({ width: window.innerWidth, height: window.innerHeight })
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  useEffect(() => {
    const minimum = view.legal?.raiseTo.min ?? 0
    setRaiseTo(minimum)
  }, [view.legal?.raiseTo.min])

  useEffect(() => {
    seatRequestRef.current = seatRequest
  }, [seatRequest])

  // A request made while the gap is already open has no snapshot coming to send
  // it, so it goes after the render that recorded it.
  useEffect(() => {
    if (seatRequest !== null) flushSeatRequest(view.phase)
  }, [seatRequest, view.phase, flushSeatRequest])

  // Pressing your cards, or holding Space, is a look at them - on screen and at the table.
  // It used to turn the cards over in the corner and nothing else: your character sat
  // perfectly still while you read your hand, and nobody else saw you do it.
  const lastLook = useRef(0)
  const heroHolding = useRef(false)
  useEffect(() => {
    const current = viewRef.current
    const hero = current.seats.find((seat) => seat.playerId === current.selfId)
    if (!peek) {
      if (!heroHolding.current) return
      heroHolding.current = false
      if (hero !== undefined) setHeldPeeks((held) => held.filter((seat) => seat !== hero.seat))
      try {
        socketRef.current?.social({ kind: 'peek', holding: false })
      } catch {
        // Offline: there is nobody to tell.
      }
      return
    }
    if (current.phase !== 'hand' || hero === undefined || !hero.hasHole || hero.folded) return
    const now = Date.now()
    if (now - lastLook.current < LOOK_INTERVAL_MS) return
    lastLook.current = now
    heroHolding.current = true
    tableSound.play('card_peek')
    pushCues([peekCue(hero.seat)])
    setHeldPeeks((held) => (held.includes(hero.seat) ? held : [...held, hero.seat]))
    try {
      socketRef.current?.social({ kind: 'peek', holding: true })
    } catch {
      // Offline: the look still plays here, and there is nobody to tell.
    }
  }, [peek, pushCues])

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
        return
      if (event.code === 'Space') setPeek(true)
      // Hold to read the table: names, stacks and state, on demand.
      //
      // The reference uses Tab and so does this now. It was Shift, because Tab
      // is focus navigation in a browser and taking it costs keyboard users
      // their way around - but at a table that lands you on a row of buttons
      // rather than telling you who you are playing against, which is what Tab
      // is for in every game that has this.
      //
      // The cost is paid where it is smallest. Tab is only intercepted while
      // you are seated in a live hand; anywhere else - choosing a seat, the
      // lobby, the shop, chat - it navigates exactly as it should, and Shift
      // still works everywhere for anyone who wants it.
      if (event.key === 'Shift') setPlatesHeld(true)
      // Read through the ref rather than closing over derived state. This
      // listener is rebound only when `command` or the legal actions change, so
      // a captured boolean would answer for whichever render last rebound it -
      // and "am I seated in a live hand" changes on neither of those.
      const current = viewRef.current
      const inHand =
        current.phase === 'hand' && current.seats.some((seat) => seat.playerId === current.selfId)
      if (event.key === 'Tab' && inHand) {
        event.preventDefault()
        setPlatesHeld(true)
      }
      if (event.key.toLowerCase() === 'c') {
        if (view.legal?.check.enabled) command({ kind: 'act', action: { kind: 'check' } })
        else if (view.legal?.call.enabled) command({ kind: 'act', action: { kind: 'call' } })
      }
    }
    const up = (event: KeyboardEvent) => {
      if (event.code === 'Space') setPeek(false)
      if (event.key === 'Shift' || event.key === 'Tab') setPlatesHeld(false)
    }
    // A key held when the window loses focus never sends its keyup, so the
    // plates would stay up for good after an alt-tab.
    const drop = () => {
      setPeek(false)
      setPlatesHeld(false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', drop)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', drop)
    }
  }, [command, view.legal])

  // The showdown is told from the moment the felt has finished the board - an all-in
  // run-out included - and not from the message that ended the hand. The engine produced the
  // schedule; this is the only place that turns it into elapsed time. Without the 2D felt
  // (the developer's 3D room) it is told from the message, as before.
  const showdownStartsAt =
    activeGraphicsMode === 'two' ? presentation.showdownStartsAt : showdownSetAt.current
  useEffect(() => {
    if (showdown === null || showdownStartsAt === null) return
    const finish = () => {
      setShowdown(null)
      setShowdownAtMs(-1)
      const waiting = afterShowdown.current
      afterShowdown.current = []
      for (const apply of waiting) apply()
    }
    const tick = window.setInterval(() => {
      const elapsed = performance.now() - showdownStartsAt
      if (elapsed >= showdown.show.totalMs) {
        finish()
        return
      }
      setShowdownAtMs(elapsed < 0 ? -1 : elapsed)
    }, 50)
    return () => window.clearInterval(tick)
  }, [showdown, showdownStartsAt])

  // What the felt, your hand, the phone and the action menu show: until the showdown reaches its
  // award, the stacks as they were before the pot was paid, so a grown stack or a seat marked out
  // does not tell the table who won while the board is still being turned.
  const paid = showdown === null || showdownAtMs >= showdown.show.awardAtMs
  const shownView = useMemo(
    () => (paid || showdown === null ? view : beforeAwards(view, showdown, { stacks: true })),
    [paid, showdown, view],
  )
  const feltView = useMemo(
    () => (paid || showdown === null ? view : beforeAwards(view, showdown, { stacks: false })),
    [paid, showdown, view],
  )

  const seats = useMemo(() => orderedSeats(view), [view])

  const _seatIds = useMemo(() => seats.map((seat) => seat.playerId ?? `seat-${seat.seat}`), [seats])

  /**
   * Where each player's chips sit in the world.
   *
   * The ring comes from worldSeats rather than being worked out again here.
   * The plaques drifted a metre from the chairs they labelled once already,
   * because two places each had their own idea of where a seat was.
   */
  // The world is laid out by seat number, never by the rotated order the 2D
  // ring uses to put the local player at the bottom. Rotated ids put every
  // chip stack and marker in front of somebody else's chair once the local
  // player sat anywhere but seat zero.
  const sceneSeatIds = useMemo(
    () => view.seats.map((seat) => seat.playerId ?? `seat-${seat.seat}`),
    [view.seats],
  )
  const seatChips = useMemo(() => {
    const ring = worldSeats(sceneSeatIds, venueOf(venueId).seatRing)
    return view.seats.flatMap((seat) => {
      const place = ring[seat.seat]
      if (seat.playerId === null || place === undefined) return []
      return [{ seat: seat.seat, amount: seat.stack, x: place.x, z: place.z }]
    })
  }, [view.seats, sceneSeatIds, venueId])

  // What each seat's two cards are doing. The view says whether a seat has cards, never
  // what they are - the server does not send another player's cards - until a showdown,
  // when it sends the hands that went to one. During a hand a folded seat's cards go to the
  // muck; at the end of one, the shown hands turn over and every other hand is mucked.
  const holeSeats = useMemo((): readonly HoleSeat[] => {
    const folded = foldedThisHand.current
    const out = (seat: number) => folded.hand === view.handNumber && folded.seats.has(seat)
    const stepFor = (seat: number) => showdown?.show.steps.find((step) => step.seat === seat)
    return view.seats.flatMap((seat) => {
      if (!seat.hasHole) return []
      if (view.phase === 'hand') {
        return [
          {
            seat: seat.seat,
            mucked: seat.folded || out(seat.seat),
            shown: null,
            revealDelay: 0,
            secondRevealDelay: 0,
          },
        ]
      }
      const shown = view.revealed && !out(seat.seat) && seat.hole !== null ? seat.hole : null
      return [
        {
          seat: seat.seat,
          mucked: shown === null,
          shown,
          revealDelay: (stepFor(seat.seat)?.revealAtMs ?? 0) / 1000,
          secondRevealDelay: (stepFor(seat.seat)?.secondCardAtMs ?? 0) / 1000,
        },
      ]
    })
  }, [view, showdown])

  const selfSeat = view.seats.find((seat) => seat.playerId === view.selfId) ?? null
  const seatedCount = view.seats.filter((seat) => seat.playerId !== null && seat.stack > 0).length
  const isHost = view.hostPlayerId === view.selfId
  useEffect(() => {
    viewRef.current = view
  }, [view])

  useEffect(() => {
    if (repFlash === null) return
    const timer = window.setTimeout(() => setRepFlash(null), 4200)
    return () => window.clearTimeout(timer)
  }, [repFlash])

  const localTurn = view.currentActor?.playerId === view.selfId

  useInterfaceSound()
  useEffect(() => {
    if (localTurn) tableSound.play('turn_alert')
  }, [localTurn])

  const handLive = view.phase === 'hand'
  const seatedHere = view.seats.some((seat) => seat.playerId === view.selfId && !seat.folded)
  const presetArmable = canArmPreset(localTurn, seatedHere, handLive)

  // A preset is armed for one decision. Clearing on a street change stops CALL
  // ANY armed pre-flop from silently calling a river shove.
  const streetKey = handLive ? `${view.handNumber}:${view.street}` : null
  const lastStreetKey = useRef<string | null>(null)
  useEffect(() => {
    if (shouldClearPreset(lastStreetKey.current, streetKey, handLive)) {
      setPreset(null)
      presetFiredFor.current = null
    }
    lastStreetKey.current = streetKey
  }, [streetKey, handLive])

  // When the turn opens, an armed preset commits immediately if it still means
  // what the player chose. If it does not, it is discarded rather than quietly
  // becoming a different action, and the normal RAM opens.
  useEffect(() => {
    if (preset === null || !localTurn || view.legal === null) return
    const turnKey = `${view.handNumber}:${view.street}:${view.selfId}`
    if (presetFiredFor.current === turnKey) return
    presetFiredFor.current = turnKey
    const outcome = resolvePreset(preset, view.legal)
    setPreset(null)
    if (outcome.kind === 'commit') {
      command({ kind: 'act', action: outcome.action })
    } else {
      setPresetNotice('Preset no longer applies.')
    }
  }, [preset, localTurn, view.legal, view.handNumber, view.street, view.selfId, command])

  useEffect(() => {
    if (presetNotice === null) return
    const timer = window.setTimeout(() => setPresetNotice(null), 2600)
    return () => window.clearTimeout(timer)
  }, [presetNotice])
  const turnRemaining = useTurnRemaining(view.turnDeadlineMs)
  const _urgency =
    localTurn &&
    turnRemaining !== null &&
    view.turnBudgetMs !== null &&
    turnRemaining <= view.turnBudgetMs / 2
  const selected =
    selectedSeat === null ? null : view.seats.find((seat) => seat.seat === selectedSeat)
  const selectedPlayerId = selected?.playerId ?? null
  const entryBuyIn = affordableBuyIn(balance, DEFAULT_STAKE.minBuyIn, DEFAULT_STAKE.defaultBuyIn)
  /*
   * The table seats you.
   *
   * Choosing a seat was a step with one answer: the table draws whichever seat
   * you are in at its foot, so every choice looked the same once it was made.
   * Arriving takes the first open seat at the standard buy-in instead, and the
   * only thing a player has to decide is whether to play the hand.
   *
   * Standing up is a decision, so it is remembered: a player who stands is not
   * sat back down. A sit that does not land - a race for the last seat, a
   * balance the server reads differently - is retried rather than leaving
   * somebody watching a table they cannot join, since nothing else can sit them.
   */
  const glanceTimers = useRef(new Map<number, number>())
  useEffect(() => {
    const timers = glanceTimers.current
    return () => {
      for (const timer of timers.values()) window.clearTimeout(timer)
      timers.clear()
    }
  }, [])
  const stoodUp = useRef(false)
  const lastSitAt = useRef(0)
  useEffect(() => {
    const asked = seatRequest?.request.kind
    if (asked === 'stand' || asked === 'leave') stoodUp.current = true
  }, [seatRequest])
  useEffect(() => {
    if (stoodUp.current || connection !== 'connected' || kick !== null) return
    if (selfSeat !== null || entryBuyIn === null) return
    // A seat is taken between hands. The server refuses one mid-hand - a hand
    // that has begun is dealt to the players it was dealt to - so arriving in
    // the middle of one waits for it to finish rather than asking every seat
    // of every snapshot and being told no each time.
    if (view.phase !== 'open') return
    const open = view.seats.find((seat) => seat.playerId === null)
    if (open === undefined) return
    const now = Date.now()
    if (now - lastSitAt.current < AUTO_SIT_RETRY_MS) return
    lastSitAt.current = now
    command({ kind: 'sit', seat: open.seat, buyIn: entryBuyIn })
  }, [command, connection, entryBuyIn, kick, selfSeat, view.phase, view.seats])
  // Waiting means held for the gap between hands. A request made between hands
  // is sent on the next effect, so it reads as already on its way.
  const pendingSeat =
    seatRequest === null
      ? null
      : {
          kind: seatRequest.request.kind,
          waiting:
            seatRequest.requestId === null && !seatRequestOpen(seatRequest.request, view.phase),
        }
  const leaveState =
    pendingSeat?.kind !== 'leave' ? 'idle' : pendingSeat.waiting ? 'waiting' : 'sent'

  const submitJoinCode = (event: FormEvent) => {
    event.preventDefault()
    if (joinCode.trim().length === 0) return
    try {
      socketRef.current?.enter(roomId, nameRef.current, joinCode.trim())
    } catch {
      setNotice('Reconnecting…')
    }
  }

  /**
   * Remember the table, and keep the address bar to /table.
   *
   * Without this a reload has no idea where you were sitting, mints a new room
   * and leaves your buy-in at a table you can no longer reach. Waits for the
   * invite code, because a table remembered without its code rejoins a table
   * you are then refused entry to.
   */
  // A replayed table is nowhere to come back to.
  useEffect(() => {
    if (typeof window === 'undefined' || view.inviteCode.length === 0 || lab !== undefined) return
    rememberTable({ roomId, inviteCode: view.inviteCode, venueId })
  }, [roomId, venueId, view.inviteCode, lab])

  const share = async () => {
    const url = shortTableLink(view.inviteCode, window.location.origin)
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

  if (phoneViewport(viewport.width, viewport.height)) {
    return (
      <main className="river-app phone-app river-controls-2d">
        <PhoneTable
          view={feltView}
          heroStack={shownView.seats.find((seat) => seat.playerId === view.selfId)?.stack ?? null}
          viewport={viewport}
          table={{
            chipMoments,
            showdown,
            seatActions,
            turnRemaining,
            turnKey: `${view.handNumber}:${view.street}:${view.currentActor?.playerId ?? ''}:${view.turnDeadlineMs ?? ''}`,
            onSelect: setSelectedSeat,
            onHeroDealt: setHeroDealt,
            onPresentation: setPresentation,
            bubbles,
            heldPeeks,
            bigBlind,
          }}
          peek={peek}
          onPeek={setPeek}
          localTurn={localTurn}
          connected={connection === 'connected'}
          status={
            kick === null
              ? (notice ?? view.message ?? waitingCopy(view, seatedCount, botSeats, isHost))
              : kickCopy(kick.reason)
          }
          waitingActions={
            <ActionMenu
              view={shownView}
              localTurn={false}
              raiseTo={raiseTo}
              onRaiseTo={setRaiseTo}
              onAction={(action) => command({ kind: 'act', action })}
              onDeal={() => command({ kind: 'startHand' })}
              rebuyAmount={entryBuyIn}
              onRebuy={(amount) =>
                setSeatRequest((current) => toggleSeatRequest(current, { kind: 'rebuy', amount }))
              }
              onStand={() =>
                setSeatRequest((current) => toggleSeatRequest(current, { kind: 'stand' }))
              }
              pendingSeat={pendingSeat}
              balance={balance}
              claimsEnabled={connection === 'connected'}
              onClaimDaily={() => socketRef.current?.claimDaily()}
              onClaimRescue={() => socketRef.current?.claimRescue()}
              canDeal={isHost && seatedCount + botSeats >= 2 && view.handNumber === 0}
              seated={selfSeat !== null}
              kicked={kick !== null}
              preset={preset}
              onPreset={setPreset}
              presetArmable={false}
              remainingMs={turnRemaining}
              budgetMs={view.turnBudgetMs}
              turnKey={`${view.handNumber}:${view.street}:${view.currentActor?.playerId ?? ''}:${view.turnDeadlineMs ?? ''}`}
              onRejoin={() => {
                kickRef.current = null
                setKick(null)
                socketRef.current?.enter(roomId, nameRef.current, joinCode || undefined)
              }}
              bigBlind={bigBlind}
            />
          }
          raiseTo={raiseTo}
          onRaiseTo={setRaiseTo}
          onAction={(action) => command({ kind: 'act', action })}
          preset={preset}
          onPreset={setPreset}
          presetArmable={presetArmable}
          onLeave={() => {
            if (selfSeat === null) returnToClub()
            else setSeatRequest((current) => toggleSeatRequest(current, { kind: 'leave' }))
          }}
          leaveLabel={
            leaveState === 'idle' ? 'Leave' : leaveState === 'waiting' ? 'After hand' : 'Leaving'
          }
          leaveDisabled={leaveState === 'sent'}
          preferences={preferences}
          onPreferences={setPreferences}
          hands={hands}
          feed={feed}
          unread={unread}
          onChatOpen={setSocialOpen}
          chatDraft={chatDraft}
          onChatDraft={setChatDraft}
          onSendChat={() => {
            const text = normaliseChat(chatDraft)
            setChatDraft('')
            if (text !== null) socketRef.current?.social({ kind: 'chat', text })
          }}
          onInvite={share}
          verifyContent={
            <>
              <h3>{verifyHeadline(verify.status)}</h3>
              <dl className="verify-rows">
                <dt>COMMIT</dt>
                <dd>
                  <code>{view.commit ?? '--'}</code>
                </dd>
                {view.revealedSeed === null ? null : (
                  <>
                    <dt>SERVER SEED</dt>
                    <dd>
                      <code>{view.revealedSeed}</code>
                    </dd>
                    <dt>RECOMPUTED</dt>
                    <dd>
                      <code>{verify.recomputedCommit ?? '--'}</code>
                    </dd>
                  </>
                )}
              </dl>
              <p className="verify-copy" role="status">
                {verifyCopy(verify.status)}
              </p>
            </>
          }
          onAccount={() => setUpgradeState('editing')}
          showdownStage={
            showdown === null || showdownAtMs < 0 ? null : (
              <ShowdownStage
                plan={showdown}
                atMs={showdownAtMs}
                seats={view.seats}
                bigBlind={bigBlind}
              />
            )
          }
          accountContent={(close) => (
            <UpgradePanel
              state={upgradeState}
              email={upgradeEmail}
              onEmail={setUpgradeEmail}
              onSubmit={sendUpgrade}
              onRetry={() => setUpgradeState('editing')}
              onClose={() => {
                setUpgradeState('idle')
                close()
              }}
            />
          )}
        />
        {arriving ? (
          <div
            className="table-fade"
            aria-hidden="true"
            style={{ '--table-fade': `${TABLE_FADE_MS}ms` } as CSSProperties}
            onAnimationEnd={() => setArriving(false)}
          />
        ) : null}
      </main>
    )
  }

  return (
    <main className={`river-app${activeGraphicsMode === 'two' ? ' river-controls-2d' : ''}`}>
      <div className="stage-fit">
        <section
          className="river-stage three-dimensional"
          aria-label="River poker table"
          style={{ transform: `scale(${stageScale})` }}
        >
          {activeGraphicsMode === 'three' && RiverVenue !== null ? (
            <RiverVenue
              cues={cues}
              venueId={venueId}
              occupiedSeats={seats
                .filter((seat) => seat.playerId !== null)
                .map((seat) => seat.seat)}
              holeSeats={holeSeats}
              handNumber={view.handNumber}
              heldPeeks={heldPeeks}
              chipMoments={chipMoments}
              board={view.board}
              seatChips={seatChips}
              seatIds={sceneSeatIds}
              seatRefs={seatRefs}
              room={roomId}
              heroSeat={selfSeat?.seat ?? null}
              handSerial={handsFinished}
              sittableSeats={
                selfSeat !== null || entryBuyIn === null
                  ? []
                  : view.seats.filter((seat) => seat.playerId === null).map((seat) => seat.seat)
              }
              onSit={(seat) => {
                if (entryBuyIn !== null) command({ kind: 'sit', seat, buyIn: entryBuyIn })
              }}
            />
          ) : (
            <Table2D
              view={feltView}
              geometry={LANDSCAPE}
              chipMoments={chipMoments}
              showdown={showdown}
              seatActions={seatActions}
              turnRemaining={turnRemaining}
              turnKey={`${view.handNumber}:${view.street}:${view.currentActor?.playerId ?? ''}:${view.turnDeadlineMs ?? ''}`}
              onSelect={setSelectedSeat}
              onHeroDealt={setHeroDealt}
              onPresentation={setPresentation}
              bubbles={bubbles}
              heldPeeks={heldPeeks}
              platesHeld={platesHeld}
              bigBlind={bigBlind}
            />
          )}
          <div className={`hud-layer${platesHeld ? ' plates-held' : ''}`}>
            <nav className="hud-corner hud-corner-left" aria-label="Table menu">
              {/* Leaving hands the stack back and goes to the club. Held, because
                  it gives up the seat. During a hand it goes at once: the server
                  folds whatever is still held, and an all-in hand plays out. */}
              <HoldAction
                duration={600}
                className={`leave-table${leaveState === 'idle' ? '' : ' armed'}`}
                disabled={leaveState === 'sent'}
                onComplete={() => {
                  if (selfSeat === null) returnToClub()
                  else setSeatRequest((current) => toggleSeatRequest(current, { kind: 'leave' }))
                }}
              >
                {leaveState === 'idle'
                  ? 'LEAVE TABLE'
                  : leaveState === 'waiting'
                    ? 'LEAVING AFTER HAND'
                    : 'LEAVING'}
              </HoldAction>
              {THREE_D_SWITCH ? (
                <button
                  type="button"
                  disabled={!supportsThree}
                  title={
                    supportsThree
                      ? undefined
                      : 'The nine-player table is 2D until its 3D chairs are ready.'
                  }
                  onClick={() => setGraphicsMode((mode) => (mode === 'two' ? 'three' : 'two'))}
                >
                  {activeGraphicsMode === 'two' ? '2D' : '3D'}
                </button>
              ) : null}
              <span className={`network-mark ${connection}`}>
                {connection === 'connected' ? 'LIVE' : 'LINK'}
              </span>
              <button
                type="button"
                className={`verify-pill verify-pill-room verify-${verify.status}`}
                disabled={view.commit === null}
                aria-label={verifyStatusLabel(verify.status)}
                title={verifyStatusLabel(verify.status)}
                onClick={() => setVerifyOpen(true)}
              >
                {/* The eight-character commit read as loose hexadecimal to
                    anyone not already convinced. The full figure lives in the
                    modal this button opens; up here a lamp says which state
                    the hand is in and the label says where to ask. */}
                <span>VERIFY</span>
                <i className="verify-dot" aria-hidden="true" />
              </button>
              <RiverSoundControl variant="icon" />
              {/* The menu's settings, over the table rather than instead of it:
                  the hand plays on behind the panel. */}
              <button
                type="button"
                className={`settings-toggle${settingsOpen ? ' open' : ''}`}
                aria-haspopup="dialog"
                aria-expanded={settingsOpen}
                onClick={() => setSettingsOpen((open) => !open)}
              >
                SETTINGS
              </button>
            </nav>
            {historyOpen ? (
              <RiverHandHistory
                hands={hands}
                selfId={view.selfId}
                bigBlind={bigBlind}
                onClose={() => setHistoryOpen(false)}
              />
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
                    className="modal-close"
                    type="button"
                    onClick={() => setVerifyOpen(false)}
                  >
                    CLOSE
                  </button>
                  <p className="eyebrow">FAIRNESS</p>
                  <h2 id="verify-title">{verifyHeadline(verify.status)}</h2>

                  <dl className="verify-rows">
                    <dt>COMMIT</dt>
                    <dd>
                      <code>{view.commit ?? '--'}</code>
                    </dd>
                    {view.revealedSeed === null ? null : (
                      <>
                        <dt>REVEALED SERVER SEED</dt>
                        <dd>
                          <code>{view.revealedSeed}</code>
                        </dd>
                        <dt>RECOMPUTED</dt>
                        <dd>
                          <code>{verify.recomputedCommit ?? '--'}</code>
                        </dd>
                        <dt>DECK ENTROPY</dt>
                        <dd>
                          <code>{verify.deckEntropy ?? '--'}</code>
                        </dd>
                      </>
                    )}
                  </dl>

                  {view.clientSeeds === null ? null : (
                    <ul className="verify-seeds">
                      {[...view.clientSeeds]
                        .sort((left, right) => left.seat - right.seat)
                        .map((entry) => (
                          <li key={entry.playerId}>
                            <span>SEAT {entry.seat + 1}</span>
                            <code>{entry.seed.slice(0, 16)}</code>
                            {entry.defaulted ? <em>SERVER DEFAULT</em> : null}
                          </li>
                        ))}
                    </ul>
                  )}

                  <p role="status" className={`verify-verdict verify-${verify.status}`}>
                    {verifyCopy(verify.status)}
                  </p>
                </section>
              </div>
            ) : null}
            {settingsOpen ? (
              <div className="modal-backdrop" role="presentation">
                <section
                  className="modal settings-modal"
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby="settings-title"
                >
                  <button
                    className="modal-close"
                    type="button"
                    onClick={() => setSettingsOpen(false)}
                  >
                    CLOSE
                  </button>
                  <p className="eyebrow">THIS BROWSER</p>
                  <h2 id="settings-title">Settings</h2>
                  <RiverSettings preferences={preferences} onChange={setPreferences} />
                </section>
              </div>
            ) : null}
            {/* The venue picker lived here, shown before the first hand. It is
                gone for the same reason the stepper on the private table screen
                is gone: only the Rooftop is being finished, so two of the three
                buttons opened a room nobody is dressing or reviewing. Deferred
                rather than deleted - the venues, their lighting rigs and their
                stills are all still built, and `?venue=` still routes - so this
                comes back as three buttons the moment there is a second room
                worth choosing. */}
            {repFlash === null ? null : (
              <output className="rep-flash" key={repFlash.id}>
                <strong>+{repFlash.totalRep.toLocaleString()} REP</strong>
                {shouldShowRate(repFlash.earningRatePercent) ? (
                  <span className="rep-rate">{repFlash.earningRatePercent}% EARNING</span>
                ) : null}
                {repFlash.levelUp > 0 ? (
                  <span className="rep-level">
                    LEVEL UP{repFlash.levelUp > 1 ? ` x${repFlash.levelUp}` : ''}
                  </span>
                ) : null}
              </output>
            )}
            {view.challenges.length === 0 ? null : (
              <section
                /* Between hands, not during one.

                   Challenge progress is not play information. The reference
                   shows nothing like it while a hand is live: the in-hand
                   layer is an icon row, a bottom-left block, small world pins
                   and a transient betting dial, and everything else waits.
                   This sat top-right through every hand saying 0/25. */
                className={`challenge-strip${socialOpen || shopOpen || view.phase === 'hand' ? ' behind' : ''}`}
                aria-label="Today's challenges"
                aria-hidden={socialOpen || shopOpen || view.phase === 'hand'}
              >
                {view.challenges.map((entry) => (
                  <div
                    key={entry.challenge.id}
                    className={`challenge${entry.complete ? ' complete' : ''}`}
                  >
                    <span className="challenge-title">{entry.challenge.title}</span>
                    <span className="challenge-count">
                      {Math.min(entry.current, entry.challenge.target)}/{entry.challenge.target}
                    </span>
                    <div
                      className="challenge-bar"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={entry.challenge.target}
                      aria-valuenow={Math.min(entry.current, entry.challenge.target)}
                      aria-label={entry.challenge.title}
                    >
                      <i style={{ width: `${Math.round(entry.fractionComplete * 100)}%` }} />
                    </div>
                  </div>
                ))}
              </section>
            )}
            {lobbyOpen ? (
              <div className="lobby-backdrop" role="presentation">
                <RiverLobby
                  tables={tables}
                  connected={connection === 'connected'}
                  onRefresh={() => socketRef.current?.listTables()}
                  onJoin={(nextRoomId, nextVenue) => {
                    const url = new URL(window.location.href)
                    url.search = new URLSearchParams({
                      room: nextRoomId,
                      venue: nextVenue,
                    }).toString()
                    window.location.assign(url.toString())
                  }}
                />
                <button type="button" className="lobby-close" onClick={() => setLobbyOpen(false)}>
                  CLOSE
                </button>
              </div>
            ) : null}
            {shopOpen ? (
              <aside className="shop-panel" aria-label="Table items">
                <header className="shop-head">
                  <span>TABLE ITEMS</span>
                  <strong>{balance.toLocaleString()} CHIPS</strong>
                  <em>{equippedRatePercent(itemCatalogue(), ownedItems)}% REP</em>
                </header>
                <nav className="shop-tabs" aria-label="Shop sections">
                  <button
                    type="button"
                    className={shopTab === 'items' ? 'chosen' : ''}
                    aria-pressed={shopTab === 'items'}
                    onClick={() => setShopTab('items')}
                  >
                    TABLE ITEMS
                  </button>
                  <button
                    type="button"
                    className={shopTab === 'wear' ? 'chosen' : ''}
                    aria-pressed={shopTab === 'wear'}
                    onClick={() => setShopTab('wear')}
                  >
                    WARDROBE
                  </button>
                </nav>
                {shopTab === 'wear' ? (
                  <ol className="shop-list">
                    {cosmeticCatalogue().map((cosmetic: Cosmetic) => {
                      const owned = ownedCosmetics.find((entry) => entry.cosmeticId === cosmetic.id)
                      const state = owned
                        ? owned.equipped
                          ? 'equipped'
                          : 'owned'
                        : balance >= cosmetic.priceChips
                          ? 'buyable'
                          : 'unaffordable'
                      return (
                        <li key={cosmetic.id} className={`shop-row ${state}`}>
                          <span className="shop-name">{cosmetic.name}</span>
                          <span className="shop-slot">{cosmetic.slot}</span>
                          <span className="shop-rep">{cosmetic.rarity}</span>
                          <span className="shop-price">
                            {state === 'unaffordable'
                              ? `NEED ${(cosmetic.priceChips - balance).toLocaleString()}`
                              : cosmetic.priceChips.toLocaleString()}
                          </span>
                          <button
                            type="button"
                            disabled={!isActionable(state) || connection !== 'connected'}
                            onClick={() =>
                              state === 'buyable'
                                ? socketRef.current?.buyCosmetic(cosmetic.id)
                                : socketRef.current?.wearCosmetic(cosmetic.id)
                            }
                          >
                            {state === 'owned' ? 'WEAR' : actionLabel(state)}
                          </button>
                        </li>
                      )
                    })}
                  </ol>
                ) : (
                  <ol className="shop-list">
                    {shopRows(itemCatalogue(), ownedItems, balance).map((row) => (
                      <li key={row.item.id} className={`shop-row ${row.state}`}>
                        <span className="shop-name">{row.item.name}</span>
                        <span className="shop-slot">{row.item.slot}</span>
                        <span className="shop-rep">+{Math.round(row.item.repModifier * 100)}%</span>
                        <span className="shop-price">
                          {row.state === 'unaffordable'
                            ? `NEED ${row.shortfall.toLocaleString()}`
                            : row.item.priceChips.toLocaleString()}
                        </span>
                        <button
                          type="button"
                          disabled={!isActionable(row.state) || connection !== 'connected'}
                          onClick={() =>
                            row.state === 'buyable'
                              ? socketRef.current?.buyTableItem(row.item.id)
                              : socketRef.current?.equipTableItem(row.item.id)
                          }
                        >
                          {actionLabel(row.state)}
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
              </aside>
            ) : null}
            {/* One corner, one container.

                These three were each positioned absolutely at top 54, right 96,
                with no layout relationship to one another, so they stacked: the
                hand-history pill sat entirely inside the invite strip and the
                chat button sat on top of both. Every one of them was correct in
                isolation and they were added at different times, which is how a
                corner ends up with three things nailed to the same nail.

                The left side never had the problem because it is one positioned
                element with flex children. This is that. */}
            <div className="hud-corner hud-corner-right">
              <button
                type="button"
                className={`lobby-toggle-button${lobbyOpen ? ' open' : ''}`}
                aria-expanded={lobbyOpen}
                onClick={() => {
                  setLobbyOpen((open) => !open)
                  socketRef.current?.listTables()
                }}
              >
                TABLES
              </button>
              <button
                type="button"
                className="verify-pill history-pill"
                aria-label={`Hand history, ${hands.length} hands recorded`}
                onClick={() => setHistoryOpen(true)}
              >
                <span>HANDS</span>
                <strong>{hands.length}</strong>
              </button>
              {/* One control where a three-part strip stood. The code is not
                  play information - it is needed at the moment of inviting
                  somebody, so pressing INVITE copies the link and holds the
                  code up long enough to read it out loud. */}
              <button
                type="button"
                className={`invite-chip${inviteShown && view.inviteCode.length > 0 ? ' showing-code' : ''}`}
                disabled={view.inviteCode.length === 0}
                title={
                  view.inviteCode.length === 0
                    ? 'No invite code yet'
                    : `Table code ${view.inviteCode} - click to copy the invite link`
                }
                onClick={() => {
                  void share()
                  setInviteShown(true)
                  if (inviteTimerRef.current !== null) clearTimeout(inviteTimerRef.current)
                  inviteTimerRef.current = setTimeout(() => setInviteShown(false), 6000)
                }}
              >
                {inviteShown && view.inviteCode.length > 0 ? view.inviteCode : 'INVITE'}
              </button>
              <button
                type="button"
                className={`social-toggle${socialOpen ? ' open' : ''}`}
                aria-expanded={socialOpen}
                onClick={() => {
                  setSocialOpen((open) => !open)
                  setShopOpen(false)
                }}
                aria-label={unread > 0 ? `Chat, ${unread} unread` : 'Chat'}
              >
                CHAT
                {unread > 0 && !socialOpen ? <i className="unread-dot" aria-hidden="true" /> : null}
              </button>
            </div>
            {/* Who you are sits in the corner rather than in the menu row: it is
                not part of playing the hand, and a guest should be able to see
                that their chips are not saved without a menu telling them. */}
            <div className="hud-identity">
              <span className="hud-identity-name">
                {signedIn || upgradeState === 'complete' ? 'SIGNED IN' : 'GUEST'}
              </span>
              {signedIn || upgradeState === 'complete' ? null : (
                <button
                  type="button"
                  className="hud-login"
                  onClick={() =>
                    setUpgradeState((state) => (state === 'editing' ? 'idle' : 'editing'))
                  }
                >
                  LOG IN
                </button>
              )}
            </div>
            {showdown === null || showdownAtMs < 0 ? null : (
              <ShowdownStage
                plan={showdown}
                atMs={showdownAtMs}
                seats={view.seats}
                bigBlind={bigBlind}
              />
            )}
            <TableCluster
              view={shownView}
              peek={peek}
              onPeek={setPeek}
              compact={activeGraphicsMode === 'two'}
              // Your turn shows your hand whatever the deal is doing: until the server holds
              // the clock for the dealer, a turn can open before your cards have landed, and
              // nobody should act on a hand they cannot see.
              dealt={activeGraphicsMode !== 'two' || heroDealt || localTurn}
              boardShown={activeGraphicsMode === 'two' ? presentation.boardShown : null}
              bigBlind={bigBlind}
            />
            {/* `populated` is what paints the glass, so it has to follow the
                text rather than be hardcoded. It was always on, and during a
                live hand the copy resolves to an empty string, which left a lit
                bar sitting on the felt with nothing in it. */}
            {(() => {
              const status =
                kick === null
                  ? (notice ?? view.message ?? waitingCopy(view, seatedCount, botSeats, isHost))
                  : kickCopy(kick.reason)
              return (
                <div className={`status-line${status ? ' populated' : ''}`} aria-live="polite">
                  {status}
                </div>
              )
            })()}
            {/* The 2D table draws its own placards; the ring of pins is the 3D room's. */}
            <div
              hidden={activeGraphicsMode === 'two'}
              className={`seat-ring${platesHeld ? ' plates-held' : ''}${activeGraphicsMode === 'three' ? ' projected' : ''}`}
            >
              {seats.map((seat, index) => (
                <RoomSeat
                  key={seat.seat}
                  seat={seat}
                  index={index}
                  active={seat.playerId === view.currentActor?.playerId}
                  local={seat.playerId === view.selfId}
                  timer={seat.playerId === view.currentActor?.playerId ? turnRemaining : null}
                  timerTotal={view.turnBudgetMs ?? 1}
                  turnKey={`${view.handNumber}:${view.street}:${view.currentActor?.playerId ?? ''}:${view.turnDeadlineMs ?? ''}`}
                  actionFlag={
                    seat.playerId === null ? null : (seatActions.get(seat.playerId) ?? null)
                  }
                  shownCards={(() => {
                    const shown =
                      holeSeats.find((hole) => hole.seat === seat.seat && hole.shown !== null)
                        ?.shown ?? null
                    if (shown === null || showdown === null) return shown
                    const turned = cardsTurned(showdown, seat.seat, showdownAtMs)
                    return turned === 0 ? null : shown.slice(0, turned)
                  })()}
                  onSelect={() => setSelectedSeat(seat.seat)}
                  projected={activeGraphicsMode === 'three'}
                  bigBlind={bigBlind}
                  anchorRef={(element) => {
                    const key = seat.playerId ?? `seat-${seat.seat}`
                    if (element === null) seatRefs.current.delete(key)
                    else seatRefs.current.set(key, element)
                  }}
                />
              ))}
            </div>
            {selectedPlayerId !== null && isHost && selectedPlayerId !== view.selfId ? (
              // Selecting a player offers this and nothing ever took it back, so it
              // stayed over the dealer for the rest of the session. It fades on its
              // own now, and waits while the pointer is on it or it is being held.
              <HoldAction
                key={selectedPlayerId}
                className="kick-control"
                duration={600}
                onAnimationEnd={() => setSelectedSeat(null)}
                onComplete={() =>
                  command({ kind: 'kick', targetPlayerId: selectedPlayerId, reason: 'host' })
                }
              >
                HOLD TO REMOVE {selected?.name}
              </HoldAction>
            ) : null}
            {connection !== 'connected' ? <div className="network-bar">Reconnecting…</div> : null}
            {socialOpen ? (
              <aside className="social-panel" aria-label="Table chat">
                <ol className="social-feed" aria-live="polite" aria-relevant="additions">
                  {feed.map((entry) => (
                    <li key={entry.id} className={`social-line ${entry.kind}`}>
                      <span className={`social-name${entry.self ? ' self' : ''}`}>
                        {entry.name}
                        {speaking.has(entry.playerId) ? (
                          <em className="speaking-mark">
                            <span className="visually-hidden">speaking</span>
                            <span aria-hidden="true">&bull;</span>
                          </em>
                        ) : null}
                      </span>
                      <span className="social-text">
                        {preferences.censorProfanity ? maskProfanity(entry.text) : entry.text}
                      </span>
                    </li>
                  ))}
                </ol>

                <form
                  className="chat-entry"
                  onSubmit={(event) => {
                    event.preventDefault()
                    const text = normaliseChat(chatDraft)
                    setChatDraft('')
                    if (text === null) return
                    socketRef.current?.social({ kind: 'chat', text })
                  }}
                >
                  <label className="visually-hidden" htmlFor="chat-input">
                    Message the table
                  </label>
                  <input
                    id="chat-input"
                    value={chatDraft}
                    maxLength={CHAT_MAX_LENGTH}
                    autoComplete="off"
                    placeholder="Say something"
                    onChange={(event) => setChatDraft(event.target.value)}
                  />
                  <button type="submit" disabled={connection !== 'connected'}>
                    SEND
                  </button>
                </form>
              </aside>
            ) : null}
            {presetNotice === null ? null : (
              <div className="preset-notice" role="status">
                {presetNotice}
              </div>
            )}
            <ActionMenu
              view={shownView}
              localTurn={localTurn}
              raiseTo={raiseTo}
              onRaiseTo={setRaiseTo}
              onAction={(action) => command({ kind: 'act', action })}
              onDeal={() => command({ kind: 'startHand' })}
              rebuyAmount={entryBuyIn}
              onRebuy={(amount) =>
                setSeatRequest((current) => toggleSeatRequest(current, { kind: 'rebuy', amount }))
              }
              onStand={() =>
                setSeatRequest((current) => toggleSeatRequest(current, { kind: 'stand' }))
              }
              pendingSeat={pendingSeat}
              balance={balance}
              claimsEnabled={connection === 'connected'}
              onClaimDaily={() => socketRef.current?.claimDaily()}
              onClaimRescue={() => socketRef.current?.claimRescue()}
              canDeal={isHost && seatedCount + botSeats >= 2 && view.handNumber === 0}
              seated={selfSeat !== null}
              kicked={kick !== null}
              preset={preset}
              onPreset={setPreset}
              presetArmable={presetArmable}
              remainingMs={turnRemaining}
              budgetMs={view.turnBudgetMs}
              turnKey={`${view.handNumber}:${view.street}:${view.currentActor?.playerId ?? ''}:${view.turnDeadlineMs ?? ''}`}
              onRejoin={() => {
                kickRef.current = null
                setKick(null)
                socketRef.current?.enter(roomId, nameRef.current, joinCode || undefined)
              }}
              bigBlind={bigBlind}
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
        <div className="viewport-rotate">
          <span className="rotate-glyph" aria-hidden="true" />
          <strong>Turn your screen sideways.</strong>
          <span>The table is laid out across the screen.</span>
        </div>
        <div className="viewport-small">
          <strong>Turn your phone upright.</strong>
          <span>The phone table is laid out upright, with your controls at the bottom.</span>
        </div>
      </div>
      {arriving ? (
        <div
          className="table-fade"
          aria-hidden="true"
          style={{ '--table-fade': `${TABLE_FADE_MS}ms` } as CSSProperties}
          onAnimationEnd={() => setArriving(false)}
        />
      ) : null}
    </main>
  )
}

/**
 * Two different questions, and they were being answered by one number.
 *
 * Whether you need to sit down is about the seats taken now. Whether the table
 * can deal is about the seats taken once bots arrive, and bots arrive on the
 * deal rather than as people do. Answering the second with the first told
 * somebody sitting alone at a bot table to wait for a player who was never
 * coming, and hid the button that would have brought nine.
 */
function waitingCopy(
  view: RoomView,
  seatedCount: number,
  botSeats: number,
  isHost: boolean,
): string | null {
  if (view.phase === 'seeding') return 'Securing the deck…'
  if (view.phase !== 'open') return null
  if (seatedCount === 0) return 'Taking your seat…'
  if (seatedCount + botSeats < 2) return 'Waiting for one more player.'
  return isHost
    ? 'Table is ready. DEAL when your group is seated.'
    : 'Waiting for the host to deal.'
}

function kickCopy(reason: Exclude<KickState, null>['reason']): string {
  if (reason === 'host') return 'The host removed you from the table.'
  if (reason === 'idle') return 'You were removed for inactivity.'
  return 'This table is open in another window.'
}

/**
 * Everything about your own position, in one cluster at the lower left.
 *
 * Your two cards, your chips, the board and the pot used to be spread across
 * the screen: the board and pot sat in the middle of the table over the felt,
 * and the hand sat on its own in the corner. They now read top to bottom as one
 * column, the way the reference groups them, and nothing sits over the table.
 *
 * Your cards stay face down until you press and hold them, or hold Space,
 * because in the room nobody reads their cards by leaving them face up. A folded
 * hand shows its faces greyed under a cross.
 */
function TableCluster({
  view,
  peek,
  onPeek,
  compact,
  dealt,
  boardShown,
  bigBlind,
}: {
  view: RoomView
  peek: boolean
  onPeek: (held: boolean) => void
  /** The 2D table carries the board and the pot on its felt, so the cluster keeps your hand. */
  compact: boolean
  /** Whether your cards have landed; the cluster shows them as they arrive, not before. */
  dealt: boolean
  /** Board cards the felt has turned face up, or null to read the whole board (3D). */
  boardShown: number | null
  /** Amounts in this many chips to the big blind, or in chips when null. */
  bigBlind: number | null
}) {
  const hero = view.seats.find((seat) => seat.playerId === view.selfId)
  const holding = hero?.hasHole && hero.hole !== null && dealt
  const showFaces = holding && (peek || hero?.folded === true)
  // Named against the board the felt has turned over, never the board the server has dealt:
  // the view runs ahead of the felt, and a pair named early is the river given away.
  const visibleBoard = boardShown === null ? view.board : view.board.slice(0, boardShown)
  const readout = holding && showFaces ? readoutFor(hero?.hole ?? [], visibleBoard) : null
  return (
    <section
      className={`table-cluster${compact ? ' compact' : ''}`}
      aria-label={compact ? 'Your hand and chips' : 'Your hand, chips, board and pot'}
    >
      {hero?.hasHole && dealt ? (
        <button
          type="button"
          className={`hero-cards${peek ? ' peeking' : ''}${hero.folded ? ' folded' : ''}`}
          aria-label={peek ? 'Your cards' : 'Press and hold to look at your cards'}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture(event.pointerId)
            onPeek(true)
          }}
          onPointerUp={() => onPeek(false)}
          onPointerCancel={() => onPeek(false)}
          onLostPointerCapture={() => onPeek(false)}
        >
          {showFaces && hero.hole !== null
            ? hero.hole.map((card) => <PlayingCard key={`${card.rank}${card.suit}`} card={card} />)
            : [<CardBack key="first" />, <CardBack key="second" />]}
          {hero.folded ? <span className="fold-stamp" aria-hidden="true" /> : null}
        </button>
      ) : null}
      {hero === undefined ? null : (
        <p className="cluster-chips">
          <i aria-hidden="true" />
          {formatAmount(hero.stack, true, bigBlind)}
        </p>
      )}
      {compact || view.board.length === 0 ? null : (
        <section
          className="cluster-board"
          aria-label={`${view.street}, ${view.board.length} community cards`}
        >
          {view.board.map((card, index) => (
            // The flop arrives as three cards in one message; each lands a beat
            // after the last so it reads as dealt rather than appearing at once.
            <div
              className="cluster-board-card"
              key={boardSlots[index] ?? `${card.rank}${card.suit}`}
              style={{ animationDelay: index < 3 ? `${index * 280}ms` : '0ms' }}
            >
              <PlayingCard card={card} />
            </div>
          ))}
        </section>
      )}
      {compact ? null : (
        <p
          className="cluster-pot"
          role="status"
          aria-label={`Pot ${formatAmount(view.pot, false, bigBlind)}`}
        >
          <i aria-hidden="true" />
          {formatAmount(view.pot, true, bigBlind)}
        </p>
      )}
      {readout === null ? null : <p className="cluster-readout">{readout.full}</p>}
    </section>
  )
}

/** What a glyph pin draws, and what a screen reader hears instead. */
const _GLYPH_MARK: Record<'check' | 'fold' | 'away' | 'sittingOut', string> = {
  check: '✓',
  fold: '✕',
  away: '⏸',
  sittingOut: '—',
}

const _GLYPH_LABEL: Record<'check' | 'fold' | 'away' | 'sittingOut', string> = {
  check: 'Checked',
  fold: 'Folded',
  away: 'Away',
  sittingOut: 'Sitting out',
}

function RoomSeat({
  seat,
  index,
  active,
  local,
  timer,
  timerTotal,
  turnKey,
  actionFlag,
  shownCards,
  onSelect,
  anchorRef,
  projected,
  bigBlind,
}: {
  seat: RoomSeatView
  index: number
  active: boolean
  local: boolean
  timer: number | null
  timerTotal: number
  /** Changes once per turn, so the watch restarts only when a new turn does. */
  turnKey: string
  actionFlag: SeatActionFlag | null
  /** The hand this player showed at a showdown, face up over their head. */
  shownCards: readonly Card[] | null
  onSelect: () => void
  anchorRef: (element: HTMLElement | null) => void
  /** 3D projects this seat's position every frame, so React must not also set it. */
  projected: boolean
  bigBlind: number | null
}) {
  const position = seatPositions[index] ?? seatPositions[0]
  const style = projected
    ? undefined
    : ({
        '--seat-x': `${position.x}%`,
        '--seat-y': `${position.y}%`,
        '--chair-x': `${position.x}%`,
        '--chair-y': `${position.y}%`,
      } as CSSProperties)
  if (seat.playerId === null) {
    // An empty seat, and nothing over it. The table seats you when you arrive, so
    // a plate reading SIT was an instruction for something that already happened -
    // and the place markers still anchor here for whatever else points at a seat.
    return <article ref={anchorRef} className="seat open-seat" style={style} />
  }
  // One marker over a player, never two. The acting player shows the watch,
  // anyone who has acted this street shows what they did until the next card,
  // and a player all in from an earlier street keeps saying so. Your own seat
  // shows none of them: the action menu is yours, and a pin over your own head
  // would sit on top of it.
  let marker: React.ReactNode = null
  if (!local && shownCards !== null) {
    // A showdown. The cards on the felt are a few dozen pixels from the gameplay camera and
    // a flat card is fewer, so the hand a player shows is also held up where it can be read.
    marker = <ShownHand cards={shownCards} />
  } else if (!local && active && timer !== null) {
    marker = <TurnWatch key={turnKey} remainingMs={timer} budgetMs={timerTotal} />
  } else if (!local && actionFlag !== null) {
    marker = <ActionPin flag={actionFlag} amount={seat.betStreet} bigBlind={bigBlind} />
  } else if (!local && seat.allIn) {
    marker = <ActionPin flag={{ label: 'ALL IN', tone: 'danger' }} amount={null} />
  }
  const note = seat.disconnected
    ? 'Reconnecting'
    : seat.sittingOut
      ? 'Sitting out'
      : seat.folded
        ? 'Folded'
        : null
  return (
    <article
      ref={anchorRef}
      className={`seat-anchor${active ? ' active' : ''}${local ? ' hero-seat' : ''}${seat.folded ? ' folded' : ''}${seat.disconnected ? ' reconnecting' : ''}`}
      style={style}
    >
      <button
        className="seat-select"
        type="button"
        onClick={onSelect}
        aria-label={`Inspect ${seat.name}`}
      />
      {marker}
      {seat.dealer ? (
        <span className="seat-dealer" role="img" aria-label="Dealer">
          D
        </span>
      ) : null}
      {/* Title and level are designed slots holding placeholders. The engine
          already models both; the table protocol does not carry them yet. */}
      <div className="seat-plate">
        <span className="seat-plate-name">{seat.name}</span>
        <span className="seat-plate-level">
          LEVEL <b>—</b>
        </span>
        <span className="seat-plate-title">—</span>
        <span className="seat-plate-chips">
          <i aria-hidden="true" />
          {formatAmount(seat.stack, !local, bigBlind)}
        </span>
        {note === null ? null : <span className="seat-plate-note">{note}</span>}
      </div>
    </article>
  )
}

/**
 * The showdown, told one hand at a time.
 *
 * It used to be a caption: a name and a hand flashed up while the pot had already moved.
 * Now the table goes quiet and the word goes up over the pot; each hand is turned over in
 * the order a dealer calls for them, one card and then the other, and named; before the
 * last hand - the one that decides it - the table holds its breath; and only then does the
 * pot go to the winner. The schedule is the engine's, so the server holds the next deal
 * for exactly as long as this takes.
 */
function ShowdownStage({
  plan,
  atMs,
  seats,
  bigBlind,
}: {
  plan: ShowdownPlan
  atMs: number
  seats: readonly RoomSeatView[]
  bigBlind: number | null
}) {
  const nameOf = (seat: number) =>
    seats.find((entry) => entry.seat === seat)?.name ?? `Seat ${seat + 1}`
  const first = plan.show.steps[0]
  const deciding = plan.show.steps.find((step) => step.deciding)
  // A run-out turned every hand face up before the board; there is no held breath left.
  const tension =
    !plan.tabled &&
    deciding !== undefined &&
    atMs < deciding.revealAtMs &&
    atMs >= deciding.revealAtMs - SHOWDOWN_TENSION_MS
  const awarding = atMs >= plan.show.awardAtMs
  let current: (typeof plan.show.steps)[number] | undefined
  for (const step of plan.show.steps) if (atMs >= step.revealAtMs) current = step
  let body: React.ReactNode = null
  if (first === undefined || atMs < first.revealAtMs) {
    body = (
      <>
        <span className="showdown-kicker">SHOWDOWN</span>
        <strong className="showdown-win">{formatAmount(plan.pot, true, bigBlind)}</strong>
      </>
    )
  } else if (awarding) {
    body = plan.awards.map((award) => (
      <span className="showdown-award" key={award.seat}>
        <span className="showdown-who">{nameOf(award.seat)}</span>
        <strong className="showdown-win">WINS {formatAmount(award.amount, true, bigBlind)}</strong>
      </span>
    ))
  } else if (tension && deciding !== undefined) {
    body = (
      <>
        <span className="showdown-who">{nameOf(deciding.seat)}</span>
        <span className="showdown-cards">
          <CardBack key="first" />
          <CardBack key="second" />
        </span>
      </>
    )
  } else if (current !== undefined) {
    const step = current
    const cards = plan.cards.get(step.seat) ?? []
    body = (
      <>
        <span className="showdown-who">{nameOf(step.seat)}</span>
        <span className="showdown-cards">
          {cards.map((card, index) =>
            plan.tabled || atMs >= (index === 0 ? step.revealAtMs : step.secondCardAtMs) ? (
              <PlayingCard key={`face-${card.rank}${card.suit}`} card={card} />
            ) : (
              <CardBack key={`back-${card.rank}${card.suit}`} />
            ),
          )}
        </span>
        {atMs >= step.nameAtMs ? (
          <strong className="showdown-hand">{plan.names.get(step.seat)}</strong>
        ) : null}
      </>
    )
  }
  return (
    <div
      className={`showdown-stage${tension ? ' tension' : ''}${awarding ? ' awarding' : ''}`}
      role="status"
      aria-live="polite"
    >
      <div className="showdown-vignette" aria-hidden="true" />
      <div className="showdown-card">{body}</div>
    </div>
  )
}

function ShownHand({ cards }: { cards: readonly Card[] }) {
  return (
    <div
      className="seat-pin shown-hand"
      role="img"
      aria-label={`Showed ${cards.map((card) => `${card.rank}${card.suit}`).join(' ')}`}
    >
      {cards.map((card) => (
        <PlayingCard key={`${card.rank}${card.suit}`} card={card} />
      ))}
    </div>
  )
}

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
function ActionMenu({
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
  const legal = localTurn ? view.legal : null

  // A raise layer left open, or a slot left lit, must not survive into the
  // next decision.
  useEffect(() => {
    if (turnKey.length === 0) return
    setRaising(false)
    setLit(null)
  }, [turnKey])

  useEffect(() => {
    if (legal === null) return
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)
        return
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
          RETURN TO TABLE
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
      <div className="action-base" data-lit={lit ?? undefined}>
        <span className="action-seams" />
      </div>
      <span className="action-slot call" {...slotEvents('call')}>
        <HoldAction
          className={`action-button${checking ? ' check' : ''}`}
          duration={0}
          disabled={!(checking || legal.call.enabled)}
          ariaLabel={labels.call}
          onComplete={() => onAction(checking ? { kind: 'check' } : { kind: 'call' })}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {checking ? MENU_ICON.check : MENU_ICON.call}
          </svg>
        </HoldAction>
      </span>
      <span className="action-slot raise" {...slotEvents('raise')}>
        {legal.raiseTo.enabled ? (
          <button
            type="button"
            className="action-button"
            aria-label={labels.raise}
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
          onComplete={() => onAction({ kind: 'fold' })}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            {MENU_ICON.fold}
          </svg>
        </HoldAction>
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

function HoldAction({
  duration,
  disabled = false,
  className,
  style,
  ariaLabel,
  onComplete,
  onAnimationEnd,
  children,
}: {
  duration: number
  disabled?: boolean
  className: string
  style?: CSSProperties
  ariaLabel?: string
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
      aria-label={ariaLabel}
      style={{ ...style, '--hold-duration': `${duration}ms` } as CSSProperties}
      onPointerDown={begin}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onAnimationEnd={onAnimationEnd}
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
