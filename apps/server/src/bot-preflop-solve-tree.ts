/** Offline heads-up preflop tree. Amounts are total contributions in big blinds. */
export type Seat = 0 | 1
export interface PreflopAction {
  readonly label: string
  readonly kind: 'fold' | 'check' | 'call' | 'limp' | 'raise' | 'jam'
  readonly to: number
}
export type PreflopNode =
  | {
      readonly kind: 'decision'
      readonly id: string
      readonly player: Seat
      readonly paid: readonly [number, number]
      readonly lastRaise: number
      readonly actions: readonly PreflopAction[]
      readonly children: readonly PreflopNode[]
    }
  | {
      readonly kind: 'fold' | 'flop' | 'all-in'
      readonly paid: readonly [number, number]
      readonly folder?: Seat
    }

export interface Realisation {
  readonly ip: number
  readonly oop: number
}

/** A deliberately simple tunable model, not fitted postflop skill estimates. */
export const DEFAULT_REALISATION: Realisation = { ip: 1.05, oop: 0.95 }

export function validateRealisation(factors: Realisation): void {
  if (![factors.ip, factors.oop].every((v) => Number.isFinite(v) && v > 0)) {
    throw new Error('realisation factors must be finite and positive')
  }
}

/** The requested finite action abstraction, including every jam's call/fold response. */
export function preflopTree(depth: number): PreflopNode {
  if (!Number.isFinite(depth) || depth < 1) throw new Error('effective depth must be at least 1 bb')
  const terminal = (paid: readonly [number, number]): PreflopNode => ({
    kind: paid[0] === depth ? 'all-in' : 'flop',
    paid,
  })
  type Stage = 'button' | 'limped' | 'opened' | 'limp-raised' | 'three-bet' | 'four-bet' | 'jam'
  const build = (
    stage: Stage,
    player: Seat,
    paid: readonly [number, number],
    lastRaise: number,
    id: string,
  ): PreflopNode => {
    const other: Seat = player === 0 ? 1 : 0
    const facing = paid[other] > paid[player]
    const actions: PreflopAction[] = []
    const children: PreflopNode[] = []
    const add = (action: PreflopAction, child: PreflopNode) => {
      actions.push(action)
      children.push(child)
    }
    if (facing) {
      add({ label: 'fold', kind: 'fold', to: paid[player] }, { kind: 'fold', folder: player, paid })
      const called: [number, number] = [...paid]
      called[player] = paid[other]
      const limp = stage === 'button'
      add(
        { label: limp ? 'limp' : 'call', kind: limp ? 'limp' : 'call', to: paid[other] },
        limp && paid[other] < depth
          ? build('limped', 1, called, lastRaise, `${id}/limp`)
          : terminal(called),
      )
    } else {
      add({ label: 'check', kind: 'check', to: paid[player] }, terminal(paid))
    }
    if (paid[other] < depth) {
      const sized =
        stage === 'button'
          ? 2.5
          : stage === 'limped'
            ? 4
            : stage === 'opened'
              ? 9
              : stage === 'three-bet'
                ? 22
                : undefined
      const targets = new Set<number>()
      if (sized !== undefined)
        targets.add(Math.min(depth, Math.max(sized, paid[other] + lastRaise)))
      targets.add(depth)
      for (const to of targets) {
        if (to <= paid[other]) continue
        const jam = to === depth
        const label = jam ? 'jam' : `raise-${to}`
        const next: [number, number] = [...paid]
        next[player] = to
        const nextStage: Stage = jam
          ? 'jam'
          : stage === 'button'
            ? 'opened'
            : stage === 'limped'
              ? 'limp-raised'
              : stage === 'opened'
                ? 'three-bet'
                : 'four-bet'
        add(
          { label, kind: jam ? 'jam' : 'raise', to },
          build(nextStage, other, next, to - paid[other], `${id}/${label}`),
        )
      }
    }
    return { kind: 'decision', id, player, paid, lastRaise, actions, children }
  }
  if (depth === 1) {
    // BB is already all-in; no limp/check/flop branch can exist.
    return {
      kind: 'decision',
      id: 'button',
      player: 0,
      paid: [0.5, 1],
      lastRaise: 1,
      actions: [
        { label: 'fold', kind: 'fold', to: 0.5 },
        { label: 'call', kind: 'call', to: 1 },
      ],
      children: [
        { kind: 'fold', folder: 0, paid: [0.5, 1] },
        { kind: 'all-in', paid: [1, 1] },
      ],
    }
  }
  // The live BB is a full 1 bb opening bet. A full raise must be to at least 2 bb.
  return build('button', 0, [0.5, 1], 1, 'button')
}

/** Net winnings from the hand's start, including the posted blind. */
export function terminalUtility(
  node: Exclude<PreflopNode, { kind: 'decision' }>,
  player: Seat,
  equity: number,
  factors: Realisation,
): number {
  if (node.kind === 'fold') {
    return node.folder === player ? -node.paid[player] : node.paid[player === 0 ? 1 : 0]
  }
  const factor = node.kind === 'all-in' ? 1 : player === 0 ? factors.ip : factors.oop
  return (node.paid[0] + node.paid[1]) * equity * factor - node.paid[player]
}

export function decisionNodes(tree: PreflopNode): Extract<PreflopNode, { kind: 'decision' }>[] {
  return tree.kind === 'decision' ? [tree, ...tree.children.flatMap(decisionNodes)] : []
}
