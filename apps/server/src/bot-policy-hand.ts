import type { BotObservationV1, BotPolicy } from '@river/engine'

export interface HandAwareBotPolicy extends BotPolicy {
  /** Notify the policy only after this hand has settled, including folds and all-ins. */
  releaseHand(roomId: string, handNumber: number): void
}

export function releasePolicyHand(policy: BotPolicy, roomId: string, handNumber: number): void {
  const scoped = policy as Partial<HandAwareBotPolicy>
  scoped.releaseHand?.(roomId, handNumber)
}

/** Carry solves are pinned until settlement; independent rooms can overlap safely. */
export class HandSolveCache<T> extends Map<string, T> {
  private readonly owners = new Map<string, Pick<BotObservationV1, 'roomId' | 'handNumber'>>()

  constructor(
    private readonly handScoped: boolean,
    private readonly limit: number,
  ) {
    super()
  }

  observe(observation: BotObservationV1): void {
    // Also handles live callers without a settlement callback. Never infer that
    // switching rooms means the previous room's hand has finished.
    for (const owner of this.owners.values()) {
      if (owner.roomId === observation.roomId && owner.handNumber !== observation.handNumber) {
        this.releaseHand(owner.roomId, owner.handNumber)
      }
    }
  }

  key(observation: BotObservationV1, spotKey: string): string {
    return this.handScoped
      ? `${JSON.stringify([observation.roomId, observation.handNumber])}|${spotKey}`
      : spotKey
  }

  put(observation: BotObservationV1, key: string, value: T): void {
    this.set(key, value)
    if (this.handScoped) {
      this.owners.set(key, { roomId: observation.roomId, handNumber: observation.handNumber })
    } else if (this.size > this.limit) {
      this.delete(this.keys().next().value as string)
    }
  }

  releaseHand(roomId: string, handNumber: number): void {
    for (const [key, owner] of this.owners) {
      if (owner.roomId === roomId && owner.handNumber === handNumber) {
        this.delete(key)
        this.owners.delete(key)
      }
    }
  }
}
