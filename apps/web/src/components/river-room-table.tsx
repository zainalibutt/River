'use client'

import {
  type Card,
  type Cosmetic,
  cosmeticCatalogue,
  DEFAULT_STAKE,
  type HandRecord,
  itemCatalogue,
  type ShowdownReel,
  type Street,
  seatMood,
  seatPin,
  showdownReel,
  type TableSummary,
  type TurnAction,
  turnClock,
} from '@river/engine'
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
import { RiverHandHistory } from '@/components/river-hand-history'
import { RiverLobby } from '@/components/river-lobby'
import { RiverVenue } from '@/components/river-venue'
import { type AnimationCue, cuesForEvents } from '@/lib/animation'
import {
  createRiverAuthClient,
  ensureRiverSession,
  loadBrowserAuthConfig,
  upgradeRiverSession,
} from '@/lib/auth'
import { readoutFor } from '@/lib/hand-readout'
import { formatAmount } from '@/lib/presentation'
import {
  canArmPreset,
  PRESET_KINDS,
  PRESET_LABELS,
  type PresetKind,
  resolvePreset,
  shouldClearPreset,
} from '@/lib/preset'
import { type RepFlash, repFlashFor, shouldShowRate } from '@/lib/rep-feedback'
import {
  actionLabel,
  equippedRatePercent,
  isActionable,
  type OwnedEntry,
  shopRows,
} from '@/lib/shop'
import {
  appendSocialEvent,
  applySpeaking,
  CHAT_MAX_LENGTH,
  canSendEmote,
  EMOTE_LABELS,
  EMOTE_ORDER,
  normaliseChat,
  type SocialFeedEntry,
} from '@/lib/social'
import { defaultRiverSocketUrl, RiverSocket, type RiverSocketState } from '@/lib/socket'
import { initialRoomTarget, LAST_TABLE_KEY, type RememberedTable } from '@/lib/table-target'
import { DEFAULT_VENUE, VENUE_ORDER, type VenueId, venueOf, worldSeats } from '@/lib/venue'
import { type VerifyResult, verifyHand } from '@/lib/verify'

const boardSlots = ['flop-one', 'flop-two', 'flop-three', 'turn', 'river'] as const
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

function joinUrl(roomId: string, inviteCode: string, venueId: VenueId): string {
  if (typeof window === 'undefined') return ''
  const url = new URL(window.location.href)
  url.search = new URLSearchParams({ room: roomId, code: inviteCode, venue: venueId }).toString()
  return url.toString()
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

export function RiverRoomTable() {
  const [{ roomId, inviteCode, expired, venueId: initialVenue }] = useState(initialRoomTarget)
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
  const [upgradeEmail, setUpgradeEmail] = useState('')
  const [kick, setKick] = useState<KickState>(null)
  const [peek, setPeek] = useState(false)
  const [platesHeld, setPlatesHeld] = useState(false)
  const [reel, setReel] = useState<ShowdownReel | null>(null)
  const [reelAtMs, setReelAtMs] = useState(0)
  const [selectedSeat, setSelectedSeat] = useState<number | null>(null)
  const [raiseTo, setRaiseTo] = useState(0)
  const [dialBand, setDialBand] = useState(0)
  const [stageScale, setStageScale] = useState(2 / 3)
  // River is a 3D game. The DOM table is a fallback for a machine that cannot
  // run the venue, not the thing being built, so it is no longer the default.
  const [graphicsMode, setGraphicsMode] = useState<'two' | 'three'>('three')
  const [preset, setPreset] = useState<PresetKind | null>(null)
  const presetFiredFor = useRef<string | null>(null)
  const [presetNotice, setPresetNotice] = useState<string | null>(null)
  const viewRef = useRef<RoomView>(emptyView())
  const [feed, setFeed] = useState<readonly SocialFeedEntry[]>([])
  const [speaking, setSpeaking] = useState<ReadonlySet<string>>(() => new Set())
  const [chatDraft, setChatDraft] = useState('')
  const [socialOpen, setSocialOpen] = useState(false)
  const [repFlash, setRepFlash] = useState<RepFlash | null>(null)
  const [balance, setBalance] = useState(0)
  const [ownedItems, setOwnedItems] = useState<readonly OwnedEntry[]>([])
  const [shopOpen, setShopOpen] = useState(false)
  const [shopTab, setShopTab] = useState<'items' | 'wear'>('items')
  const [ownedCosmetics, setOwnedCosmetics] = useState<
    readonly { cosmeticId: string; slot: string; equipped: boolean }[]
  >([])
  const [cues, setCues] = useState<readonly AnimationCue[]>([])
  const [hands, setHands] = useState<readonly HandRecord[]>([])
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
          if (message.kind === 'tables') {
            setTables(message.tables)
            return
          }
          if (message.kind === 'social') {
            const event = message.event
            setSpeaking((current) => applySpeaking(current, event))
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
          if (message.kind !== 'snapshot') return
          setView(message.view)
          setBotSeats(message.botSeats)
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
          const nextCues = cuesForEvents(message.events, (playerId) => {
            const seat = message.view.seats.find((entry) => entry.playerId === playerId)
            return seat?.seat ?? -1
          })
          if (nextCues.length > 0) setCues(nextCues)
          const settled = message.events.flatMap((event) =>
            event.kind === 'handRecorded' ? [event.record] : [],
          )
          if (settled.length > 0) {
            // Newest first, so the panel reads the way a player thinks about
            // the night: the hand that just happened is the one at the top.
            const newest = settled[settled.length - 1]
            setHands((previous) => [...settled.reverse(), ...previous].slice(0, 24))
            // A hand used to end by simply being over. The reel is the beats of
            // a showdown - who shows, what they had, who takes it - and it has
            // been sitting in the engine with nothing calling it.
            if (newest !== undefined) {
              const built = showdownReel({ record: newest })
              setReel(built.beats.length > 0 ? built : null)
              setReelAtMs(0)
            }
          }
          const flash = repFlashFor(message.events, message.view.selfId)
          if (flash !== null) setRepFlash(flash)
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
        socket.enter(roomId, nameRef.current, inviteCode, initialVenue)
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
    // initialVenue is read once when a new table is opened. It comes from
    // useState's initialiser and never changes, but naming it keeps the rule
    // honest rather than silencing it.
  }, [inviteCode, roomId, initialVenue])

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
        current.phase === 'hand' &&
        current.seats.some((seat) => seat.playerId === current.selfId && !seat.folded)
      if (event.key === 'Tab' && inHand) {
        event.preventDefault()
        setPlatesHeld(true)
      }
      if (event.key.toLowerCase() === 'c') {
        if (view.legal?.check.enabled) command({ kind: 'act', action: { kind: 'check' } })
        else if (view.legal?.call.enabled) command({ kind: 'act', action: { kind: 'call' } })
      }
      if (event.key.toLowerCase() === 'r' && view.legal?.raiseTo.enabled) setDialBand(1)
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

  useEffect(() => {
    if (reel === null) return
    // Walk the beats on their own timings. The engine produced a plan; this is
    // the only place that turns it into elapsed time, so nothing in the engine
    // ever had to read a clock.
    const started = Date.now()
    const tick = window.setInterval(() => {
      const elapsed = Date.now() - started
      if (elapsed >= reel.totalMs) {
        setReel(null)
        setReelAtMs(0)
        return
      }
      setReelAtMs(elapsed)
    }, 80)
    return () => window.clearInterval(tick)
  }, [reel])

  const showdownBeat = useMemo(() => {
    if (reel === null) return null
    // The last beat whose moment has arrived and whose hold has not expired.
    for (let index = reel.beats.length - 1; index >= 0; index -= 1) {
      const beat = reel.beats[index]
      if (beat === undefined) continue
      if (reelAtMs >= beat.atMs && reelAtMs < beat.atMs + beat.holdMs) return beat
    }
    return null
  }, [reel, reelAtMs])

  const seats = useMemo(() => orderedSeats(view), [view])

  const seatIds = useMemo(() => seats.map((seat) => seat.playerId ?? `seat-${seat.seat}`), [seats])

  /**
   * Where each player's chips sit in the world.
   *
   * The ring comes from worldSeats rather than being worked out again here.
   * The plaques drifted a metre from the chairs they labelled once already,
   * because two places each had their own idea of where a seat was.
   */
  const seatChips = useMemo(() => {
    const ring = worldSeats(seatIds, venueOf(venueId).seatRing)
    return seats.flatMap((seat, index) => {
      const place = ring[index]
      if (seat.playerId === null || seat.stack <= 0 || place === undefined) return []
      return [{ seat: seat.seat, amount: seat.stack, x: place.x, z: place.z }]
    })
  }, [seats, seatIds, venueId])

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
  const urgency =
    localTurn &&
    turnRemaining !== null &&
    view.turnBudgetMs !== null &&
    turnRemaining <= view.turnBudgetMs / 2
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

  /**
   * Put the table in the address bar, and remember it.
   *
   * Without this a reload has no idea where you were sitting, mints a new room
   * and leaves your buy-in at a table you can no longer reach. Waits for the
   * invite code, because a URL carrying the room without the code rejoins a
   * table you are then refused entry to.
   *
   * replaceState rather than pushState: the back button should leave River,
   * not walk backwards through your own reloads.
   */
  useEffect(() => {
    if (typeof window === 'undefined' || view.inviteCode.length === 0) return
    try {
      const url = new URL(window.location.href)
      url.search = new URLSearchParams({
        room: roomId,
        code: view.inviteCode,
        venue: venueId,
      }).toString()
      window.history.replaceState(null, '', url.toString())
      window.localStorage.setItem(
        LAST_TABLE_KEY,
        JSON.stringify({
          roomId,
          inviteCode: view.inviteCode,
          venueId,
          atMs: Date.now(),
        } satisfies RememberedTable),
      )
    } catch {
      // Storage can be unavailable and history can be blocked. Neither is worth
      // interrupting a hand over - it costs a rejoin, not a game.
    }
  }, [roomId, venueId, view.inviteCode])

  const share = async () => {
    const url = joinUrl(roomId, view.inviteCode, venueId)
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
              cues={cues}
              venueId={venueId}
              occupiedSeats={seats
                .filter((seat) => seat.playerId !== null)
                .map((seat) => seat.seat)}
              seatChips={seatChips}
              seatIds={seatIds}
              seatRefs={seatRefs}
            />
          ) : null}
          <div className="hud-layer">
            {graphicsMode === 'two' ? (
              <div className="dom-table-fallback" aria-hidden="true" />
            ) : null}
            <nav className="hud-corner hud-corner-left" aria-label="Table menu">
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
            </nav>
            {historyOpen ? (
              <RiverHandHistory
                hands={hands}
                selfId={view.selfId}
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
            {view.handNumber === 0 ? (
              <fieldset className="venue-picker" aria-label="Choose a venue">
                {VENUE_ORDER.map((id) => (
                  <button
                    key={id}
                    type="button"
                    className={id === venueId ? 'chosen' : ''}
                    aria-pressed={id === venueId}
                    title={venueOf(id).tagline}
                    disabled={id === venueId}
                    onClick={() => {
                      // Opens a new table in that room rather than restyling
                      // this one. A venue is a property of the table, so
                      // changing it locally would only have changed what this
                      // player sees.
                      const url = new URL(window.location.href)
                      url.search = new URLSearchParams({ venue: id }).toString()
                      window.location.assign(url.toString())
                    }}
                  >
                    {venueOf(id).name}
                  </button>
                ))}
              </fieldset>
            ) : null}
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
                className={`shop-toggle${shopOpen ? ' open' : ''}`}
                aria-expanded={shopOpen}
                onClick={() => {
                  setShopOpen((open) => !open)
                  setSocialOpen(false)
                }}
              >
                ITEMS
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
              >
                CHAT
              </button>
            </div>
            <div className="pot-readout" role="status" aria-label={`Pot ${view.pot}`}>
              <span>POT</span>
              <strong>{formatAmount(view.pot, false)}</strong>
            </div>
            <Board cards={view.board} street={view.street} />
            {showdownBeat === null ? null : (
              <div className="showdown-card" role="status" aria-live="polite">
                {showdownBeat.kind === 'name' ? (
                  <>
                    <span className="showdown-who">
                      {view.seats.find((entry) => entry.seat === showdownBeat.seat)?.name ??
                        `Seat ${showdownBeat.seat + 1}`}
                    </span>
                    <strong className="showdown-hand">{showdownBeat.hand}</strong>
                  </>
                ) : null}
                {showdownBeat.kind === 'award' ? (
                  <>
                    <span className="showdown-who">
                      {view.seats.find((entry) => entry.seat === showdownBeat.seat)?.name ??
                        `Seat ${showdownBeat.seat + 1}`}
                    </span>
                    <strong className="showdown-win">
                      WINS {formatAmount(showdownBeat.amount, true)}
                    </strong>
                  </>
                ) : null}
              </div>
            )}
            <HeroHand view={view} peek={peek} />
            <div className="status-line populated" aria-live="polite">
              {kick === null
                ? (notice ?? view.message ?? waitingCopy(view, seatedCount, botSeats, isHost))
                : kickCopy(kick.reason)}
            </div>
            <div className={`seat-ring${platesHeld ? ' plates-held' : ''}`}>
              {seats.map((seat, index) => (
                <RoomSeat
                  key={seat.seat}
                  seat={seat}
                  index={index}
                  active={seat.playerId === view.currentActor?.playerId}
                  local={seat.playerId === view.selfId}
                  timer={seat.playerId === view.currentActor?.playerId ? turnRemaining : null}
                  timerTotal={view.turnBudgetMs ?? 1}
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
            {socialOpen ? (
              <aside className="social-panel" aria-label="Table chat and emotes">
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
                      <span className="social-text">{entry.text}</span>
                    </li>
                  ))}
                </ol>

                <fieldset className="emote-rail" aria-label="Emotes">
                  {EMOTE_ORDER.map((emote) => (
                    <button
                      key={emote}
                      type="button"
                      disabled={!canSendEmote(localTurn, connection === 'connected')}
                      title={
                        localTurn ? 'Emotes are unavailable during your turn' : EMOTE_LABELS[emote]
                      }
                      onClick={() => socketRef.current?.social({ kind: 'emote', emote })}
                    >
                      {EMOTE_LABELS[emote]}
                    </button>
                  ))}
                </fieldset>

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
            {presetArmable ? (
              <fieldset className="preset-rail" aria-label="Preset actions">
                {PRESET_KINDS.map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    className={`preset-chip${preset === kind ? ' armed' : ''}`}
                    aria-pressed={preset === kind}
                    onClick={() => setPreset((current) => (current === kind ? null : kind))}
                  >
                    {PRESET_LABELS[kind]}
                  </button>
                ))}
              </fieldset>
            ) : null}
            {presetNotice === null ? null : (
              <div className="preset-notice" role="status">
                {presetNotice}
              </div>
            )}
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
              canDeal={isHost && seatedCount + botSeats >= 2 && view.handNumber === 0}
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
  if (seatedCount === 0) return 'Take an open seat to join the table.'
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

/**
 * Your own hand, in one place.
 *
 * These used to hang off the hero's seat marker at left: -278px, and the seat
 * marker is positioned from the seat's projected 3D position - so orbiting the
 * camera swung your own cards across the screen and sometimes off the edge of
 * it. The two things a player looks at most, their hole cards and what those
 * cards currently make, were the two things that would not hold still.
 *
 * docs/design/22-shot-composition.md measured this off the reference and asked
 * for it explicitly: a bottom-left block carrying the hole cards, and hero
 * cards DOM-only rather than tracked in world space. Everyone else keeps card
 * backs at their seat, because whose cards those are is exactly the
 * information a world-space position carries.
 */
function HeroHand({ view, peek }: { view: RoomView; peek: boolean }) {
  const hero = view.seats.find((seat) => seat.playerId === view.selfId)
  if (hero === undefined || !hero.hasHole) return null
  const readout = readoutFor(hero.hole ?? [], view.board)
  return (
    <section className="hero-hand" aria-label="Your hand">
      <div className="hero-hand-cards">
        {hero.hole === null ? (
          <>
            <CardBack />
            <CardBack />
          </>
        ) : (
          hero.hole.map((card) => (
            <PlayingCard key={`${card.rank}${card.suit}`} card={card} peek={peek} />
          ))
        )}
      </div>
      {readout === null ? null : <p className="hero-hand-readout">{readout.full}</p>}
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

/** What a glyph pin draws, and what a screen reader hears instead. */
const GLYPH_MARK: Record<'check' | 'fold' | 'away' | 'sittingOut', string> = {
  check: '✓',
  fold: '✕',
  away: '⏸',
  sittingOut: '—',
}

const GLYPH_LABEL: Record<'check' | 'fold' | 'away' | 'sittingOut', string> = {
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
  onSit,
  onSelect,
  anchorRef,
}: {
  seat: RoomSeatView
  index: number
  active: boolean
  local: boolean
  timer: number | null
  timerTotal: number
  onSit: () => void
  onSelect: () => void
  anchorRef: (element: HTMLElement | null) => void
}) {
  const position = seatPositions[index] ?? seatPositions[0]
  // One rule decides what floats over this seat. The engine owns it so the
  // world-space pins and this DOM layer cannot drift apart.
  const pin = seatPin({
    mood: seatMood({
      occupied: seat.playerId !== null,
      stack: seat.stack,
      hasHole: seat.hasHole,
      folded: seat.folded,
      allIn: seat.allIn,
      busted: seat.busted,
      sittingOut: seat.sittingOut,
      disconnected: seat.disconnected,
      isActor: active,
      wonLastHand: false,
      handLive: seat.hasHole || seat.betStreet > 0,
    }),
    committed: seat.betStreet,
    isActing: active,
    clock: timer === null ? null : turnClock(timer, 0, Math.max(1, timerTotal)),
  })
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
      {/* Nobody's cards float over their head.

          Eighteen card backs hovered above the table - two per seat, on every
          seat, for the whole hand, including seats that had folded. The
          reference has none: hole cards lie flat on the felt in front of the
          player, and the only cards that ever float are the ones revealed at a
          showdown, which is what makes that moment read as a reveal.

          Whether somebody is still in the hand is said by their pin, which is
          the size of a fingertip and already carries the fold, check, away and
          sitting-out states. Eighteen billboards said the same thing eighteen
          times and said it loudest for the players it no longer applied to.

          The hero's own hand is the fixed bottom-left block, not here. */}
      <div className="avatar" aria-hidden="true">
        {seat.name?.slice(0, 1) ?? '?'}
      </div>
      <div className="seat-copy">
        <span>{seat.name}</span>
        <strong>{formatAmount(seat.stack, !local)}</strong>
        <small>{label}</small>
      </div>
      {seat.dealer ? <div className="dealer-button">D</div> : null}
      {/* Exactly one marker floats over a seat, never two.

          The clock and the bet used to render independently, so the acting
          player showed a timer ring and a chip stack at once - the reference
          never stacks them, and seatPin makes the precedence a rule rather
          than two conditionals that happen not to overlap most of the time. */}
      {pin.kind === 'clock' && !local ? (
        <div
          className={`remote-timer${pin.urgent ? ' urgent' : ''}`}
          style={{ '--timer-progress': `${pin.fraction ?? 0}` } as CSSProperties}
        >
          TURN
        </div>
      ) : null}
      {pin.kind === 'amount' && pin.amount !== null ? (
        <div className="seat-bet">
          <i />
          <b>{formatAmount(pin.amount, !local)}</b>
        </div>
      ) : null}
      {pin.kind === 'glyph' && pin.glyph !== null ? (
        <div className={`seat-glyph ${pin.glyph}`} role="img" aria-label={GLYPH_LABEL[pin.glyph]}>
          {GLYPH_MARK[pin.glyph]}
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
