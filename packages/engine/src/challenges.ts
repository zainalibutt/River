export type ChallengeMetric =
  | 'handsPlayed'
  | 'handsWon'
  | 'showdownsReached'
  | 'potsScooped'
  | 'foldsPreflop'
  | 'allInsSurvived'

export interface Challenge {
  id: string
  title: string
  metric: ChallengeMetric
  target: number
  repReward: number
}

export interface ChallengeProgress {
  challenge: Challenge
  current: number
  complete: boolean
  fractionComplete: number
}

export type MetricTally = Partial<Record<ChallengeMetric, number>>

const POOL: readonly Challenge[] = [
  {
    id: 'showdown-intro',
    title: 'See Showdowns',
    metric: 'showdownsReached',
    target: 5,
    repReward: 1500,
  },
  {
    id: 'showdown-ten',
    title: 'Showdowner',
    metric: 'showdownsReached',
    target: 10,
    repReward: 3000,
  },
  {
    id: 'showdown-twenty-five',
    title: 'Showdown Streak',
    metric: 'showdownsReached',
    target: 25,
    repReward: 8000,
  },
  {
    id: 'pots-threshold',
    title: 'Pot Collector',
    metric: 'potsScooped',
    target: 4,
    repReward: 2500,
  },
  { id: 'pots-eights', title: 'Eight Pots', metric: 'potsScooped', target: 8, repReward: 5000 },
  {
    id: 'pots-fifteen',
    title: 'Fifteen Pots',
    metric: 'potsScooped',
    target: 15,
    repReward: 10000,
  },
  { id: 'hands-volume', title: 'Volume Grind', metric: 'handsPlayed', target: 20, repReward: 2000 },
  { id: 'hands-time', title: 'Table Time', metric: 'handsPlayed', target: 50, repReward: 6000 },
  { id: 'hands-marathon', title: 'Marathon', metric: 'handsPlayed', target: 100, repReward: 15000 },
  {
    id: 'wins-momentum',
    title: 'Winning Momentum',
    metric: 'handsWon',
    target: 5,
    repReward: 3000,
  },
  { id: 'wins-session', title: 'Session Winner', metric: 'handsWon', target: 12, repReward: 7000 },
  { id: 'wins-natural', title: 'Run Good', metric: 'handsWon', target: 25, repReward: 14000 },
  { id: 'folds-patience', title: 'Patience', metric: 'foldsPreflop', target: 8, repReward: 2500 },
  { id: 'folds-control', title: 'Selective', metric: 'foldsPreflop', target: 20, repReward: 6000 },
  {
    id: 'allins-survive',
    title: 'All-In Survivor',
    metric: 'allInsSurvived',
    target: 3,
    repReward: 9000,
  },
  {
    id: 'allins-steady',
    title: 'Steady Nerves',
    metric: 'allInsSurvived',
    target: 8,
    repReward: 18000,
  },
]

export function challengePool(): readonly Challenge[] {
  return POOL
}

export function dailySet(daySeed: number, count = 3): readonly Challenge[] {
  if (count <= 0) return []
  const seed = daySeed >>> 0
  const used = new Set<number>()
  const selected: Challenge[] = []
  let position = 0
  while (selected.length < count && used.size < POOL.length) {
    const index = hashMix(seed, position) % POOL.length
    position += 1
    if (used.has(index)) continue
    used.add(index)
    const challenge = POOL[index]
    if (challenge !== undefined) selected.push(challenge)
  }
  return selected
}

function hashMix(seed: number, index: number): number {
  let value = (((seed + index * 0x9e3779b9) ^ (seed >>> 16)) >>> 0) + 0x85ebca6b
  value = Math.imul(value ^ (value >>> 13), 0xc2b2ae35)
  value = value ^ (value >>> 16)
  return value >>> 0
}

export function progressFor(challenge: Challenge, tally: MetricTally): ChallengeProgress {
  const raw = tally[challenge.metric] ?? 0
  const current = raw < 0 ? 0 : raw
  const clamped = Math.min(current, challenge.target)
  return {
    challenge,
    current,
    complete: current >= challenge.target,
    fractionComplete: challenge.target > 0 ? clamped / challenge.target : 0,
  }
}

export function completedRepReward(challenges: readonly Challenge[], tally: MetricTally): number {
  const seen = new Set<string>()
  let total = 0
  for (const challenge of challenges) {
    if (seen.has(challenge.id)) continue
    seen.add(challenge.id)
    const progress = progressFor(challenge, tally)
    if (progress.complete) total += challenge.repReward
  }
  return total
}
