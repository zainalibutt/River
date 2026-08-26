export type AudioBus = 'music' | 'effects' | 'voice'

export interface AudioClip {
  id: string
  file: string
  description: string
  seconds: number
  bytes: number
  bus: AudioBus
}

export interface MusicTrack {
  id: string
  file: string | null
  title: string | null
  performer: string | null
  /** Required the moment a file is present. See below. */
  licence: string | null
  attribution: string | null
  loop: boolean
  bus: AudioBus
}

export interface AudioManifest {
  rate: number
  effects: AudioClip[]
  music: MusicTrack[]
  voice: AudioClip[]
}

export const BUSES: readonly AudioBus[] = ['music', 'effects', 'voice']

export const DEFAULT_LEVELS: Readonly<Record<AudioBus, number>> = {
  music: 0.35,
  effects: 0.75,
  voice: 0.9,
}

/**
 * A track that ships without a licence is a licence problem, not a bug.
 *
 * A public-domain composition is not a public-domain recording, and a
 * repository that serves an unattributed file is publishing somebody's master.
 * The build gate checks this too; this is the same rule on the client, so a
 * track added by hand cannot slip past by never being rebuilt.
 */
export function playableTracks(manifest: AudioManifest): MusicTrack[] {
  return manifest.music.filter(
    (track) =>
      track.file !== null &&
      track.title !== null &&
      track.licence !== null &&
      track.attribution !== null,
  )
}

/** Tracks with a file but missing paperwork. Never played, always reported. */
export function unlicensedTracks(manifest: AudioManifest): MusicTrack[] {
  return manifest.music.filter(
    (track) =>
      track.file !== null &&
      (track.title === null || track.licence === null || track.attribution === null),
  )
}

export function clipById(manifest: AudioManifest, id: string): AudioClip | undefined {
  return [...manifest.effects, ...manifest.voice].find((clip) => clip.id === id)
}

/** Total bytes a player waits for before the table has sound. */
export function downloadBytes(manifest: AudioManifest): number {
  return manifest.effects.reduce((total, clip) => total + clip.bytes, 0)
}

export interface MixerLevels {
  master: number
  music: number
  effects: number
  voice: number
  muted: boolean
}

export const DEFAULT_MIXER: MixerLevels = {
  master: 1,
  ...DEFAULT_LEVELS,
  muted: false,
}

/**
 * What a bus is actually worth once master and mute are applied.
 *
 * Kept separate from the Web Audio graph so it can be tested without a browser,
 * and so a mute is one boolean rather than nine gain nodes to remember to set.
 */
export function gainFor(levels: MixerLevels, bus: AudioBus): number {
  if (levels.muted) return 0
  const master = clamp(levels.master)
  return clamp(levels[bus]) * master
}

export function withBus(levels: MixerLevels, bus: AudioBus, value: number): MixerLevels {
  return { ...levels, [bus]: clamp(value) }
}

export function toggleMuted(levels: MixerLevels): MixerLevels {
  return { ...levels, muted: !levels.muted }
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(1, Math.max(0, value))
}

/**
 * The sound a table event makes.
 *
 * Deliberately the same shape as the animation cues, because a chip toss and a
 * chip sound are one event and should not be able to disagree about whether it
 * happened.
 */
const CLIP_FOR_CLIP: Readonly<Record<string, string>> = {
  CHIP_toss: 'chip_push',
  DEAL_toss: 'card_deal',
  FOLD_muck: 'card_slide',
  PEEK_card: 'card_flip',
  ALLIN_standup: 'chip_push',
  REACT_win: 'pot_push',
}

export function soundForGesture(clip: string): string | null {
  return CLIP_FOR_CLIP[clip] ?? null
}

export async function loadAudioManifest(
  fetcher: typeof fetch = fetch,
  url = '/audio/manifest.json',
): Promise<AudioManifest | null> {
  try {
    const response = await fetcher(url)
    if (!response.ok) return null
    return (await response.json()) as AudioManifest
  } catch {
    // A table with no sound is playable. A table that will not load is not.
    return null
  }
}
