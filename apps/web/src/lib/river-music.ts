/**
 * River's music: the homepage theme, and the intro's come-up into it.
 *
 * The theme is a six-minute noir lounge piece that opens on its guitar riff, so the intro is
 * built to arrive on that riff. Under the film plays a dark bed cut from the theme's own
 * opening (slowed an octave down, filtered, given room), and a swell of the riff played
 * backwards rushes in over it; the swell ends where the theme begins, and the theme's first
 * downbeat lands on the moment the mark settles on the menu. Same key and the same guitar
 * throughout, so the come-up and the riff are one gesture rather than two cues.
 *
 * The theme plays on the menu alone, fades out on the way to a table and back in on return,
 * pauses with a hidden tab, and has its own mute beside the sound effects'. Nothing sounds
 * before the browser allows it: the intro's gate, or a first press on the menu, unlocks it.
 */

const MUTED_KEY = 'river:music-muted'
/** Where the theme's first downbeat falls, in seconds from its start. */
const THEME_DOWNBEAT_S = 0.16
const THEME_LEVEL = 0.5
const BED_LEVEL = 0.75
const SWELL_LEVEL = 0.85
const FADE_IN_S = 1.6
const FADE_OUT_S = 0.6

type Clip = 'intro-bed' | 'intro-swell'

function readMuted(): boolean {
  try {
    return window.localStorage.getItem(MUTED_KEY) === '1'
  } catch {
    return false
  }
}

class RiverMusic {
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private themeGain: GainNode | null = null
  private theme: HTMLAudioElement | null = null
  private readonly clips = new Map<Clip, AudioBuffer>()
  private bed: { source: AudioBufferSourceNode; gain: GainNode } | null = null
  private muted: boolean | null = null
  private readonly listeners = new Set<(muted: boolean) => void>()
  /** The menu is on screen, so the theme belongs. */
  private home = false
  /** The intro is running and will bring the theme in itself. */
  private introHeld = false
  private pausedForHidden = false
  private timers: number[] = []

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
    if (this.master !== null && this.context !== null) {
      this.master.gain.setTargetAtTime(muted ? 0 : 1, this.context.currentTime, 0.12)
    }
    if (!muted && this.home && !this.introHeld) this.fadeInTheme()
    for (const listener of this.listeners) listener(muted)
  }

  subscribe(listener: (muted: boolean) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Start audio on a person's press or key: the browser allows nothing sooner. */
  unlock(): void {
    if (typeof window === 'undefined') return
    if (this.context === null) {
      const Context = window.AudioContext
      if (Context === undefined) return
      const context = new Context()
      this.context = context
      this.master = context.createGain()
      this.master.gain.value = this.isMuted() ? 0 : 1
      this.master.connect(context.destination)
      const theme = new Audio()
      const aac = theme.canPlayType('audio/mp4; codecs="mp4a.40.2"') !== ''
      theme.src = aac ? '/audio/theme/home-theme.m4a' : '/audio/theme/home-theme.ogg'
      theme.loop = true
      theme.preload = 'auto'
      this.theme = theme
      this.themeGain = context.createGain()
      this.themeGain.gain.value = 0
      context.createMediaElementSource(theme).connect(this.themeGain)
      this.themeGain.connect(this.master)
      for (const clip of ['intro-bed', 'intro-swell'] as const)
        void this.loadClip(context, clip, aac)
      document.addEventListener('visibilitychange', this.onVisibility)
    }
    if (this.context.state === 'suspended') void this.context.resume()
  }

  /** The intro has begun: the dark bed comes up under it, and the theme waits for its cue. */
  beginComeUp(): void {
    this.introHeld = true
    const context = this.context
    const buffer = this.clips.get('intro-bed')
    if (context === null || this.master === null) return
    if (buffer === undefined) {
      // Still loading on the press that started everything: keep trying for a few seconds.
      let tries = 0
      const retry = () => {
        tries += 1
        if (!this.introHeld || this.bed !== null) return
        if (this.clips.has('intro-bed')) this.startBed()
        else if (tries < 12) this.timers.push(window.setTimeout(retry, 250))
      }
      this.timers.push(window.setTimeout(retry, 250))
      return
    }
    this.startBed()
  }

  /**
   * The mark will settle on the menu at `atMs` (performance.now() time): run the swell into
   * it and put the theme's first downbeat exactly there.
   */
  landAt(atMs: number): void {
    const context = this.context
    if (context === null || this.master === null) return
    const toContext = (ms: number) =>
      context.currentTime + Math.max(0, ms - performance.now()) / 1000
    const themeStartMs = atMs - THEME_DOWNBEAT_S * 1000
    const swell = this.clips.get('intro-swell')
    if (swell !== undefined) {
      const source = context.createBufferSource()
      source.buffer = swell
      const gain = context.createGain()
      gain.gain.value = SWELL_LEVEL
      source.connect(gain)
      gain.connect(this.master)
      source.start(toContext(themeStartMs - swell.duration * 1000))
    }
    if (this.bed !== null) {
      const from = toContext(themeStartMs - (swell?.duration ?? 1) * 1000)
      this.bed.gain.gain.setValueAtTime(BED_LEVEL, from)
      this.bed.gain.gain.linearRampToValueAtTime(0, toContext(themeStartMs))
      this.bed.source.stop(toContext(themeStartMs) + 0.1)
      this.bed = null
    }
    this.timers.push(
      window.setTimeout(
        () => {
          this.introHeld = false
          if (!this.home || this.theme === null || this.themeGain === null) return
          this.theme.currentTime = 0
          this.themeGain.gain.cancelScheduledValues(context.currentTime)
          this.themeGain.gain.setValueAtTime(THEME_LEVEL, context.currentTime)
          void this.theme.play().catch(() => {})
        },
        Math.max(0, themeStartMs - performance.now()),
      ),
    )
  }

  /** The intro was skipped: let the bed go and bring the theme in softly. */
  skipIntro(): void {
    this.introHeld = false
    for (const timer of this.timers) window.clearTimeout(timer)
    this.timers = []
    if (this.bed !== null && this.context !== null) {
      this.bed.gain.gain.setTargetAtTime(0, this.context.currentTime, 0.1)
      this.bed.source.stop(this.context.currentTime + 0.6)
      this.bed = null
    }
    if (this.home) this.fadeInTheme()
  }

  /** The intro is showing its gate: the press on it starts the come-up, not the theme. */
  holdForIntro(): void {
    this.introHeld = true
  }

  /** The menu is on screen: play the theme, or wait for the press that lets it play. */
  enterHome(): void {
    this.home = true
    if (this.introHeld) return
    if (this.context !== null && this.context.state === 'running') {
      this.fadeInTheme()
      return
    }
    const start = () => {
      window.removeEventListener('pointerdown', start, true)
      window.removeEventListener('keydown', start, true)
      if (!this.home || this.introHeld) return
      this.unlock()
      this.fadeInTheme()
    }
    window.addEventListener('pointerdown', start, true)
    window.addEventListener('keydown', start, true)
  }

  /** The menu has gone (a table, a profile): the theme fades and waits where it was. */
  leaveHome(): void {
    this.home = false
    const context = this.context
    const theme = this.theme
    if (context === null || theme === null || this.themeGain === null) return
    this.themeGain.gain.setTargetAtTime(0, context.currentTime, FADE_OUT_S / 3)
    this.timers.push(
      window.setTimeout(() => {
        if (!this.home) theme.pause()
      }, FADE_OUT_S * 1000),
    )
  }

  private fadeInTheme(): void {
    const context = this.context
    const theme = this.theme
    if (context === null || theme === null || this.themeGain === null || this.isMuted()) return
    if (!theme.paused && this.themeGain.gain.value > 0) return
    this.themeGain.gain.cancelScheduledValues(context.currentTime)
    this.themeGain.gain.setValueAtTime(0, context.currentTime)
    this.themeGain.gain.linearRampToValueAtTime(THEME_LEVEL, context.currentTime + FADE_IN_S)
    void theme.play().catch(() => {})
  }

  private startBed(): void {
    const context = this.context
    const buffer = this.clips.get('intro-bed')
    if (context === null || this.master === null || buffer === undefined || this.bed !== null)
      return
    const source = context.createBufferSource()
    source.buffer = buffer
    source.loop = true
    const gain = context.createGain()
    gain.gain.setValueAtTime(0, context.currentTime)
    gain.gain.linearRampToValueAtTime(BED_LEVEL, context.currentTime + 1.2)
    source.connect(gain)
    gain.connect(this.master)
    source.start()
    this.bed = { source, gain }
  }

  private async loadClip(context: AudioContext, clip: Clip, aac: boolean): Promise<void> {
    for (const extension of aac ? ['m4a', 'ogg'] : ['ogg', 'm4a']) {
      try {
        const response = await fetch(`/audio/theme/${clip}.${extension}`)
        if (!response.ok) continue
        this.clips.set(clip, await context.decodeAudioData(await response.arrayBuffer()))
        return
      } catch {
        // This format would not decode here: try the other.
      }
    }
  }

  private readonly onVisibility = (): void => {
    const theme = this.theme
    if (theme === null) return
    if (document.visibilityState === 'hidden') {
      if (!theme.paused) {
        theme.pause()
        this.pausedForHidden = true
      }
    } else if (this.pausedForHidden) {
      this.pausedForHidden = false
      if (this.home && !this.isMuted()) void theme.play().catch(() => {})
    }
  }
}

export const riverMusic = new RiverMusic()
