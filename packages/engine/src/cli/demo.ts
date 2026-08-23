import { createInterface } from 'node:readline/promises'
import { BettingHand } from '../betting.js'
import type { Card } from '../cards.js'
import { cardsToString, makeDeck } from '../cards.js'
import { STAKE_250_500 } from '../config.js'
import { compareRanks, describeHand, evaluateBest } from '../evaluator.js'
import { commitSeed, randomSeed, verifyCommit } from '../fair.js'
import { mulberry32, seedFromString } from '../rng.js'
import { deal, shuffle } from '../shuffle.js'
import { at } from '../util.js'

const blinds = { small: STAKE_250_500.smallBlind, big: STAKE_250_500.bigBlind }
const HUMAN = 'you'
const ROOKIE = 'rookie'
const BOARD_SIZE = { preflop: 0, flop: 3, turn: 4, river: 5 } as const

function holeStrength(hole: Card[]): number {
  const values = hole.map((card) => '23456789TJQKA'.indexOf(card.rank) + 2).sort((a, b) => b - a)
  const high = at(values, 0)
  const low = at(values, 1)
  const suited = hole[0]?.suit === hole[1]?.suit
  return high * 2 + low + (suited ? 1 : 0)
}

function rookieSeat(betting: BettingHand) {
  const seat = betting.players.find((p) => p.id === ROOKIE)
  if (seat === undefined) throw new Error('rookie seat missing')
  return seat
}

function rookieRaise(betting: BettingHand, pot: number): string {
  const seat = rookieSeat(betting)
  const maxTo = seat.stack + seat.betThisStreet
  const to = Math.min(betting.minRaiseTo() + pot, maxTo)
  if (to <= betting.currentBet || to < betting.minRaiseTo()) return 'allin'
  if (to === maxTo && to > betting.currentBet) return 'allin'
  return `raise ${to}`
}

function rookieDecision(betting: BettingHand, hole: Card[], board: Card[], pot: number): string {
  const cost = betting.betToCall(ROOKIE)
  if (board.length === 0) {
    const strength = holeStrength(hole)
    if (strength >= 28) return rookieRaise(betting, pot)
    if (cost > blinds.big * 2 && strength < 22) return 'fold'
    return cost > 0 ? 'call' : 'check'
  }
  const rank = evaluateBest([...hole, ...board])
  if (rank.category >= 5 && cost === 0) return rookieRaise(betting, pot)
  if (rank.category >= 2) return cost > 0 ? 'call' : 'check'
  if (cost > 0 && cost < pot / 3) return 'call'
  return 'fold'
}

function applyAction(betting: BettingHand, id: string, action: string): void {
  const [verb, arg] = action.split(' ')
  switch (verb) {
    case 'fold':
      betting.fold(id)
      break
    case 'check':
      betting.check(id)
      break
    case 'call':
      betting.call(id)
      break
    case 'raise':
      betting.raiseTo(id, Number(arg))
      break
    case 'allin':
      betting.allIn(id)
      break
    default:
      throw new Error(`unknown action: ${action}`)
  }
}

async function main(): Promise<void> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  let humanStack = STAKE_250_500.defaultBuyIn
  let rookieStack = STAKE_250_500.defaultBuyIn
  let dealerIndex = 0
  let handNumber = 0

  console.log(`=== River CLI demo · heads-up vs Rookie · ${blinds.small}/${blinds.big} ===`)
  console.log('Commands: fold, check, call, raise <to>, allin, quit')

  while (true) {
    handNumber++
    const seed = randomSeed()
    const commit = commitSeed(seed)
    console.log(
      `\n--- Hand ${handNumber} — ${dealerIndex === 0 ? 'you are the button (SB)' : 'Rookie is the button (SB)'} ---`,
    )
    console.log(`fair deal committed: ${commit.slice(0, 24)}…`)

    const rng = mulberry32(seedFromString(seed))
    let deck = shuffle(makeDeck(), rng)
    const dealOut = (count: number): Card[] => {
      const result = deal(deck, count)
      deck = result.rest
      return result.hand
    }
    const myHole = dealOut(2)
    const rookieHole = dealOut(2)
    const board: Card[] = []

    const betting = new BettingHand({
      seats: [
        { id: HUMAN, stack: humanStack },
        { id: ROOKIE, stack: rookieStack },
      ],
      dealerIndex,
      smallBlind: blinds.small,
      bigBlind: blinds.big,
    })

    let previousStreet = betting.street
    while (!betting.finished) {
      if (betting.street !== previousStreet) {
        while (board.length < BOARD_SIZE[betting.street]) board.push(at(dealOut(1), 0))
        previousStreet = betting.street
        if (board.length > 0) {
          const label = betting.street.toUpperCase()
          console.log(`\n${label}: ${cardsToString(board)}`)
        }
      }
      const actorId = betting.toActId
      if (actorId === undefined) continue
      const actor = at(
        betting.players.filter((p) => p.id === actorId),
        0,
      )
      const pot = betting.pot()
      const cost = betting.betToCall(actor.id)

      if (actor.id === ROOKIE) {
        const decision = rookieDecision(betting, rookieHole, board, pot)
        applyAction(betting, ROOKIE, decision)
        console.log(
          `  [pot ${pot}] Rookie: ${decision === 'call' && cost === 0 ? 'check' : decision}`,
        )
        continue
      }

      console.log(
        `\n[pot ${pot}] You: ${cardsToString(myHole)} — board: ${board.length > 0 ? cardsToString(board) : '—'}, stacks: you ${humanStack} / Rookie ${rookieStack}`,
      )
      const hint =
        cost === 0
          ? `check, raise to ≥ ${betting.minRaiseTo()}, or allin:`
          : `call ${cost}, raise to ≥ ${betting.minRaiseTo()}, fold, or allin:`
      const answer = (await rl.question(`> ${hint} `)).trim().toLowerCase()
      if (answer === 'quit' || answer === 'q') {
        console.log('Quit. Thanks for playing!')
        rl.close()
        return
      }
      try {
        if (answer === '') applyAction(betting, HUMAN, cost === 0 ? 'check' : 'fold')
        else applyAction(betting, HUMAN, answer)
      } catch (error) {
        if (error instanceof Error) console.log(`  (${error.message}) — try again`)
      }
    }

    const winnerId = betting.uncontestedWinnerId
    if (winnerId !== undefined) {
      console.log(
        `\n${winnerId === HUMAN ? 'You' : 'Rookie'} win the pot (${betting.pot()}${winnerId === HUMAN ? ')' : ') — you folded'}`,
      )
    }
    if (betting.street === 'river') {
      const myRank = evaluateBest([...myHole, ...board])
      const rookieRank = evaluateBest([...rookieHole, ...board])
      const ranking = compareRanks(myRank, rookieRank)
      console.log(`\nBoard: ${cardsToString(board)}`)
      console.log(`Your hand: ${cardsToString(myHole)} (${describeHand(myRank)})`)
      console.log(`Rookie: ${cardsToString(rookieHole)} (${describeHand(rookieRank)})`)
      console.log(
        ranking > 0 ? 'You win the hand.' : ranking < 0 ? 'Rookie wins the hand.' : 'Split pot.',
      )
    }

    for (const pot of betting.sidePots()) {
      const eligible = pot.eligibleIds
      if (eligible.length === 1) {
        betting.award(at(eligible, 0), pot.amount)
        continue
      }
      const contenders = eligible.map((id) => ({
        id,
        rank:
          id === HUMAN
            ? evaluateBest([...myHole, ...board])
            : evaluateBest([...rookieHole, ...board]),
      }))
      let best = at(contenders, 0)
      const winners: string[] = []
      for (const contender of contenders) {
        const cmp = compareRanks(contender.rank, best.rank)
        if (cmp > 0) {
          best = contender
          winners.length = 0
          winners.push(contender.id)
        } else if (cmp === 0) {
          winners.push(contender.id)
        }
      }
      if (winners.length === 0) winners.push(best.id)
      const each = Math.floor(pot.amount / winners.length)
      const remainder = pot.amount % winners.length
      winners.forEach((id, i) => {
        betting.award(id, each + (i === 0 ? remainder : 0))
      })
    }

    humanStack = betting.players.find((p) => p.id === HUMAN)?.stack ?? humanStack
    rookieStack = betting.players.find((p) => p.id === ROOKIE)?.stack ?? rookieStack
    console.log(`\nStacks — you: ${humanStack}, Rookie: ${rookieStack}`)
    console.log(
      `fair deal verified: ${verifyCommit(commit, seed) ? '✓ seed matches' : '✗ commit broken'}`,
    )
    if (humanStack <= 0) {
      console.log('You busted — rebuying both to the table maximum.')
      humanStack = STAKE_250_500.maxBuyIn
      rookieStack = STAKE_250_500.maxBuyIn
    } else if (rookieStack <= 0) {
      console.log('Rookie busted — rebuying Rookie to the table maximum.')
      rookieStack = STAKE_250_500.maxBuyIn
    }
    dealerIndex = dealerIndex === 0 ? 1 : 0
  }
}

void main()
