/**
 * The table's sound: fourteen short effects, played on the moments the table already draws.
 *
 * The effects were synthesised and gated weeks ago and nothing ever played them. They load
 * on the first press or key, because a browser will not start audio before a person has
 * touched the page, and they are small enough - about 160KB together - to fetch in one go.
 * A player's choice to mute is kept in this browser; losing it costs a click, not a hand.
 */

export type SoundEffect =
  | 'card_deal'
  | 'card_flip'
  | 'card_slide'
  | 'chip_place'
  | 'chip_push'
  | 'chip_stack'
  | 'pot_push'
  | 'turn_alert'
  | 'ui_click'
  | 'ui_hover'
  | 'wheel_tick'
  | 'card_peek'
  | 'chip_bet'
  | 'check_tap'

const EFFECTS: readonly SoundEffect[] = [
  'card_deal',
  'card_flip',
  'card_slide',
  'chip_place',
  'chip_push',
  'chip_stack',
  'pot_push',
  'turn_alert',
  'ui_click',
  'ui_hover',
  'wheel_tick',
  'card_peek',
  'chip_bet',
  'check_tap',
]

/** How loud each effect sits against the others, before the master level. */
const LEVEL: Record<SoundEffect, number> = {
  card_deal: 0.5,
  card_flip: 0.55,
  card_slide: 0.45,
  chip_place: 0.7,
  chip_push: 0.65,
  chip_stack: 0.5,
  pot_push: 0.75,
  turn_alert: 0.6,
  ui_click: 0.3,
  // A touch over a click: it was a fifth of one, and nobody could hear it.
  ui_hover: 0.4,
  wheel_tick: 0.4,
  card_peek: 0.4,
  chip_bet: 0.75,
  check_tap: 0.6,
}

/** The same effect twice within this many milliseconds plays once: a flop is not a crackle. */
const REPEAT_GAP_MS = 40

/**
 * Effects allowed to come faster than that.
 *
 * A pointer crossing the action menu passes over three buttons in a few hundred
 * milliseconds and should sound like it did; the wheel puts out a notch every
 * few pixels. Both are quiet enough that a run of them is texture rather than noise.
 */
const GAP_MS: Partial<Record<SoundEffect, number>> = {
  ui_hover: 16,
  wheel_tick: 18,
}

const MUTED_KEY = 'river:sound-muted'

function readMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTED_KEY) === '1'
  } catch {
    return false
  }
}

class TableSound {
  private context: AudioContext | null = null
  private readonly buffers = new Map<SoundEffect, AudioBuffer>()
  private master: GainNode | null = null
  private muted: boolean | null = null
  private readonly lastPlayed = new Map<SoundEffect, number>()
  private readonly listeners = new Set<(muted: boolean) => void>()

  isMuted(): boolean {
    if (this.muted === null) this.muted = typeof window === 'undefined' ? false : readMuted()
    return this.muted
  }

  setMuted(muted: boolean): void {
    this.muted = muted
    try {
      window.localStorage.setItem(MUTED_KEY, muted ? '1' : '0')
    } catch {
      // Storage unavailable: the choice holds for this visit.
    }
    if (this.master !== null) this.master.gain.value = muted ? 0 : 1
    for (const listener of this.listeners) listener(muted)
  }

  subscribe(listener: (muted: boolean) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Start audio on a person's first press or key; the browser allows nothing sooner. */
  unlock(): void {
    if (typeof window === 'undefined') return
    if (this.context === null) {
      const Context = window.AudioContext
      if (Context === undefined) return
      this.context = new Context()
      this.master = this.context.createGain()
      this.master.gain.value = this.isMuted() ? 0 : 1
      this.master.connect(this.context.destination)
      void this.load(this.context)
    }
    if (this.context.state === 'suspended') void this.context.resume()
  }

  private async load(context: AudioContext): Promise<void> {
    await Promise.all(
      EFFECTS.map(async (effect) => {
        try {
          const response = await fetch(`/audio/${effect}.wav`)
          if (!response.ok) return
          this.buffers.set(effect, await context.decodeAudioData(await response.arrayBuffer()))
        } catch {
          // A missing effect is silence, not an error the table should show.
        }
      }),
    )
  }

  /** Play an effect, a touch varied in pitch so a run of the same one does not machine-gun. */
  play(effect: SoundEffect, volume = 1): void {
    const context = this.context
    const buffer = this.buffers.get(effect)
    if (context === null || this.master === null || buffer === undefined || this.isMuted()) return
    const at = context.currentTime * 1000
    const last = this.lastPlayed.get(effect) ?? Number.NEGATIVE_INFINITY
    if (at - last < (GAP_MS[effect] ?? REPEAT_GAP_MS)) return
    this.lastPlayed.set(effect, at)
    const source = context.createBufferSource()
    source.buffer = buffer
    source.playbackRate.value = 0.96 + Math.random() * 0.08
    const gain = context.createGain()
    gain.gain.value = LEVEL[effect] * Math.max(0, Math.min(1, volume))
    source.connect(gain)
    gain.connect(this.master)
    source.start()
  }
}

export const tableSound = new TableSound()
