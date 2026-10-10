import { tableSound } from '@/lib/table-sound'

/**
 * River's music: the homepage theme, and the intro's sound into it.
 *
 * The theme is a six-minute noir lounge piece that opens on its guitar riff. The intro does not
 * borrow from it: it is scored like an advert, every sound cut to a motion on screen (the air as
 * the light comes up, the chip's clack, the felt under the sliding card, the flick of the aces,
 * the shimmer of the brass line, the letters setting), and its last gesture, a rush into a low
 * hit as the mark settles on the menu, lands on the theme's first downbeat.
 *
 * The theme plays on the menu alone, fades out on the way to a table and back in on return,
 * pauses with a hidden tab, and has its own mute; the intro's sounds follow the sound effects'
 * mute instead. Nothing sounds before the browser allows it: the intro's gate, or a first press
 * on the menu, unlocks it.
 */

const MUTED_KEY = 'river:music-muted'
/** Where the theme's first downbeat falls, in seconds from its start. */
const THEME_DOWNBEAT_S = 0.16
const THEME_LEVEL = 0.5
const CUE_LEVEL = 0.9
const FADE_IN_S = 1.6
const FADE_OUT_S = 0.6

type Cue = 'intro-film' | 'intro-mark'

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
  private cueGain: GainNode | null = null
  private readonly cues = new Map<Cue, AudioBuffer>()
  private readonly playing = new Set<AudioBufferSourceNode>()
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
      // The intro's sounds sit apart from the music's mute, under the sound effects' instead.
      this.cueGain = context.createGain()
      this.cueGain.gain.value = CUE_LEVEL
      this.cueGain.connect(context.destination)
      for (const cue of ['intro-film', 'intro-mark'] as const) void this.loadCue(context, cue, aac)
      document.addEventListener('visibilitychange', this.onVisibility)
    }
    if (this.context.state === 'suspended') void this.context.resume()
  }

  /** Play one of the intro's scored cues, from `offset` seconds in so it keeps to its picture. */
  playCue(cue: Cue, offset = 0): void {
    const context = this.context
    const buffer = this.cues.get(cue)
    if (context === null || this.cueGain === null || buffer === undefined) return
    if (tableSound.isMuted() || offset >= buffer.duration) return
    const source = context.createBufferSource()
    source.buffer = buffer
    source.connect(this.cueGain)
    source.onended = () => this.playing.delete(source)
    this.playing.add(source)
    source.start(context.currentTime, offset)
  }

  /** The mark will settle on the menu at `atMs` (performance.now() time): the riff lands there. */
  landAt(atMs: number): void {
    const context = this.context
    if (context === null) return
    this.timers.push(
      window.setTimeout(
        () => {
          this.introHeld = false
          if (!this.home || this.theme === null || this.themeGain === null || this.isMuted()) return
          this.theme.currentTime = 0
          this.themeGain.gain.cancelScheduledValues(context.currentTime)
          this.themeGain.gain.setValueAtTime(THEME_LEVEL, context.currentTime)
          void this.theme.play().catch(() => {})
        },
        Math.max(0, atMs - THEME_DOWNBEAT_S * 1000 - performance.now()),
      ),
    )
  }

  /** The intro was skipped: cut its sounds short and bring the theme in softly. */
  skipIntro(): void {
    this.introHeld = false
    for (const timer of this.timers) window.clearTimeout(timer)
    this.timers = []
    for (const source of this.playing) source.stop()
    this.playing.clear()
    if (this.home) this.fadeInTheme()
  }

  /** The intro is showing its gate: the press on it starts the intro, not the theme. */
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

  private async loadCue(context: AudioContext, cue: Cue, aac: boolean): Promise<void> {
    for (const extension of aac ? ['m4a', 'ogg'] : ['ogg', 'm4a']) {
      try {
        const response = await fetch(`/audio/intro/${cue}.${extension}`)
        if (!response.ok) continue
        this.cues.set(cue, await context.decodeAudioData(await response.arrayBuffer()))
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
