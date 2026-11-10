import { type Card, makeDeck } from '@river/engine'

export interface VerifyClientSeed {
  playerId: string
  seat: number
  seed: string
  defaulted: boolean
}

export type VerifyStatus = 'idle' | 'live' | 'match' | 'mismatch'

export interface VerifyResult {
  status: VerifyStatus
  recomputedCommit: string | null
  deckEntropy: string | null
  /** How many of the cards this table showed were checked against the recomputed deck. */
  cardsChecked: number
}

/** The cards a finished hand put in front of this player: the board and every hole shown. */
export interface DealtCards {
  board: readonly Card[]
  seats: readonly { seat: number; hole: readonly Card[] | null; dealer: boolean }[]
}

/** Every seat's fallback seed, committed as the hand started and revealed with the server seed. */
export interface FallbackSeeds {
  commit: string
  seeds: readonly { seat: number; seed: string }[]
}

const SEED_PATTERN = /^[0-9a-f]{64}$/i

export function isVerifySeed(value: string): boolean {
  return SEED_PATTERN.test(value)
}

function hexToBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2)
  for (let index = 0; index < bytes.length; index++) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as BufferSource)
  return bytesToHex(new Uint8Array(digest))
}

/**
 * Recompute SHA-256 over the seed BYTES, not the hex string. The server hashes
 * the decoded bytes, so hashing the text would never match and the panel would
 * cry mismatch on a perfectly honest hand.
 */
export async function recomputeCommit(serverSeed: string): Promise<string | null> {
  if (!isVerifySeed(serverSeed)) return null
  return sha256(hexToBytes(serverSeed))
}

/**
 * Deck entropy is SHA-256 over the server seed followed by every client seed in
 * SEAT ORDER. Seat order is public and fixed before the deal, which is what
 * stops the ordering itself from being a lever.
 */
export async function recomputeDeckEntropy(
  serverSeed: string,
  clientSeeds: readonly VerifyClientSeed[],
): Promise<string | null> {
  if (!isVerifySeed(serverSeed)) return null
  if (!clientSeeds.every((entry) => isVerifySeed(entry.seed))) return null
  const ordered = [...clientSeeds].sort((left, right) => left.seat - right.seat)
  return sha256(concat([hexToBytes(serverSeed), ...ordered.map((entry) => hexToBytes(entry.seed))]))
}

function uint32be(value: number): Uint8Array {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint32(0, value)
  return bytes
}

/** The commitment to the fallback seeds: each seat as four big-endian bytes and its seed, in seat order. */
export async function recomputeFallbackCommit(
  seeds: readonly { seat: number; seed: string }[],
): Promise<string | null> {
  if (!seeds.every((entry) => isVerifySeed(entry.seed))) return null
  const ordered = [...seeds].sort((left, right) => left.seat - right.seat)
  return sha256(concat(ordered.flatMap((entry) => [uint32be(entry.seat), hexToBytes(entry.seed)])))
}

/**
 * The deck the seeds make, shuffled exactly as the server shuffles it: a
 * Fisher-Yates pass driven by SHA-256 over the entropy and a counter, with
 * rejection sampling so no card is likelier anywhere than another.
 */
export async function recomputeDeck(
  serverSeed: string,
  clientSeeds: readonly VerifyClientSeed[],
): Promise<Card[] | null> {
  const entropy = await recomputeDeckEntropy(serverSeed, clientSeeds)
  if (entropy === null) return null
  const key = hexToBytes(entropy)
  let block: Uint8Array = new Uint8Array(0)
  let offset = 0
  let counter = 0
  const takeByte = async (): Promise<number> => {
    if (offset >= block.length) {
      block = hexToBytes(await sha256(concat([key, uint32be(counter)])))
      offset = 0
      counter++
    }
    const value = block[offset] ?? 0
    offset++
    return value
  }
  const uniformIndex = async (upperExclusive: number): Promise<number> => {
    let bytes = 1
    let range = 256
    while (range < upperExclusive) {
      bytes++
      range *= 256
    }
    const limit = Math.floor(range / upperExclusive) * upperExclusive
    while (true) {
      let value = 0
      for (let index = 0; index < bytes; index++) value = value * 256 + (await takeByte())
      if (value < limit) return value % upperExclusive
    }
  }
  const deck = makeDeck()
  for (let index = deck.length - 1; index > 0; index--) {
    const swap = await uniformIndex(index + 1)
    const current = deck[index] as Card
    deck[index] = deck[swap] as Card
    deck[swap] = current
  }
  return deck
}

function sameCard(left: Card | undefined, right: Card | undefined): boolean {
  return (
    left !== undefined &&
    right !== undefined &&
    left.rank === right.rank &&
    left.suit === right.suit
  )
}

/**
 * Check every card the table showed against where the recomputed deck put it:
 * two to each player dealt in, one at a time from the seat the deal starts at,
 * then the board. How many were checked, or null when one is out of place.
 */
function checkDealt(
  deck: readonly Card[],
  clientSeeds: readonly VerifyClientSeed[],
  dealt: DealtCards,
): number | null {
  const active = [...clientSeeds].sort((left, right) => left.seat - right.seat)
  const count = active.length
  if (count < 2) return null
  const dealerSeat = dealt.seats.find((seat) => seat.dealer)?.seat
  const found = active.findIndex((entry) => entry.seat === dealerSeat)
  const dealer = found === -1 ? 0 : found
  const first = count === 2 ? dealer : (dealer + 1) % count
  let checked = 0
  for (let k = 0; k < count; k++) {
    const entry = active[(first + k) % count]
    const hole = dealt.seats.find((seat) => seat.seat === entry?.seat)?.hole
    if (hole === null || hole === undefined || hole.length === 0) continue
    if (hole.length !== 2) return null
    if (!sameCard(deck[k], hole[0]) || !sameCard(deck[count + k], hole[1])) return null
    checked += 2
  }
  for (const [index, card] of dealt.board.entries()) {
    if (!sameCard(deck[2 * count + index], card)) return null
    checked++
  }
  return checked
}

/**
 * Verify a hand once its server seed is revealed: the seed hashes to the commit
 * published before the deal, every seed the server filled in for a player is
 * the fallback it committed to before any player seed arrived, and the deck
 * the seeds make deals every card the table showed. A seed matching its commit
 * proves nothing about the cards unless the cards are checked too.
 */
export async function verifyHand(
  commit: string | null,
  serverSeed: string | null,
  clientSeeds: readonly VerifyClientSeed[] | null,
  dealt?: DealtCards,
  fallbacks?: FallbackSeeds | null,
): Promise<VerifyResult> {
  const nothing = { recomputedCommit: null, deckEntropy: null, cardsChecked: 0 }
  if (commit === null) return { status: 'idle', ...nothing }
  if (serverSeed === null) return { status: 'live', ...nothing }

  const recomputedCommit = await recomputeCommit(serverSeed)
  if (recomputedCommit === null) return { status: 'mismatch', ...nothing }
  const seeds = clientSeeds ?? []
  const deckEntropy = await recomputeDeckEntropy(serverSeed, seeds)
  const mismatch = { status: 'mismatch' as const, recomputedCommit, deckEntropy, cardsChecked: 0 }
  if (recomputedCommit.toLowerCase() !== commit.toLowerCase()) return mismatch
  if (fallbacks !== undefined && fallbacks !== null) {
    if ((await recomputeFallbackCommit(fallbacks.seeds)) !== fallbacks.commit.toLowerCase()) {
      return mismatch
    }
    for (const entry of seeds) {
      if (!entry.defaulted) continue
      const committed = fallbacks.seeds.find((fallback) => fallback.seat === entry.seat)
      if (committed === undefined || committed.seed.toLowerCase() !== entry.seed.toLowerCase()) {
        return mismatch
      }
    }
  }
  let cardsChecked = 0
  if (dealt !== undefined) {
    const deck = await recomputeDeck(serverSeed, seeds)
    const checked = deck === null ? null : checkDealt(deck, seeds, dealt)
    if (checked === null) return mismatch
    cardsChecked = checked
  }
  return { status: 'match', recomputedCommit, deckEntropy, cardsChecked }
}

/** What a table showed one player during one hand, before its seed was revealed. */
export interface HandEvidence {
  handNumber: number
  commit: string | null
  fallbackCommit: string | null
  /** The seed this browser sent for the hand, if it sent one. */
  ownSeed: string | null
  ownHole: readonly Card[]
  board: readonly Card[]
}

/** The parts of a table view the evidence is read from. */
export interface EvidenceView {
  handNumber: number
  commit: string | null
  fallbackCommit?: string | null
  revealedSeed: string | null
  clientSeeds: readonly VerifyClientSeed[] | null
  board: readonly Card[]
  seats: readonly { playerId: string | null; hole: readonly Card[] | null }[]
  selfId: string
}

/**
 * Fold one view into what this hand has shown so far. Only views from before
 * the reveal count: the commitments as first seen, this player's own cards,
 * and the board as it grew.
 */
export function observeHand(
  previous: HandEvidence | null,
  view: EvidenceView,
  ownSeed: string | null,
): HandEvidence {
  const evidence: HandEvidence =
    previous !== null && previous.handNumber === view.handNumber
      ? { ...previous }
      : {
          handNumber: view.handNumber,
          commit: null,
          fallbackCommit: null,
          ownSeed: null,
          ownHole: [],
          board: [],
        }
  if (ownSeed !== null && evidence.ownSeed === null) evidence.ownSeed = ownSeed
  if (view.revealedSeed !== null) return evidence
  if (evidence.commit === null && view.commit !== null) evidence.commit = view.commit
  if (evidence.fallbackCommit === null && view.fallbackCommit != null) {
    evidence.fallbackCommit = view.fallbackCommit
  }
  const hole = view.seats.find((seat) => seat.playerId === view.selfId)?.hole
  if (evidence.ownHole.length === 0 && hole !== null && hole !== undefined && hole.length === 2) {
    evidence.ownHole = [...hole]
  }
  if (view.board.length > evidence.board.length) evidence.board = [...view.board]
  return evidence
}

/**
 * Whether the revealing view tells the same story the hand showed: the same
 * commitments, this player's own cards and seed, and a board that only grew.
 * A view that swapped them all at the reveal would otherwise check out.
 */
export function evidenceAgrees(evidence: HandEvidence, view: EvidenceView): boolean {
  if (evidence.handNumber !== view.handNumber) return true
  if (evidence.commit !== null && evidence.commit !== view.commit) return false
  if (
    evidence.fallbackCommit !== null &&
    evidence.fallbackCommit !== (view.fallbackCommit ?? null)
  ) {
    return false
  }
  const hole = view.seats.find((seat) => seat.playerId === view.selfId)?.hole ?? []
  if (evidence.ownHole.length === 2) {
    if (
      hole.length !== 2 ||
      !evidence.ownHole.every((card, index) => sameCard(hole[index], card))
    ) {
      return false
    }
  }
  if (!evidence.board.every((card, index) => sameCard(view.board[index], card))) return false
  if (evidence.ownSeed !== null && view.clientSeeds !== null) {
    const mine = view.clientSeeds.find((entry) => entry.playerId === view.selfId)
    if (
      mine !== undefined &&
      !mine.defaulted &&
      mine.seed.toLowerCase() !== evidence.ownSeed.toLowerCase()
    ) {
      return false
    }
  }
  return true
}
