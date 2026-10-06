import { describe, expect, it } from 'vitest'
import {
  type AudioManifest,
  BUSES,
  clipById,
  DEFAULT_MIXER,
  downloadBytes,
  gainFor,
  loadAudioManifest,
  type MusicTrack,
  playableTracks,
  soundForGesture,
  toggleMuted,
  unlicensedTracks,
  withBus,
} from './audio'

const track = (overrides: Partial<MusicTrack> = {}): MusicTrack => ({
  id: 'lobby_theme',
  file: null,
  title: null,
  performer: null,
  licence: null,
  attribution: null,
  loop: true,
  bus: 'music',
  ...overrides,
})

const manifest = (overrides: Partial<AudioManifest> = {}): AudioManifest => ({
  rate: 22050,
  effects: [
    {
      id: 'chip_push',
      file: 'audio/chip_push.wav',
      description: 'A bet going in',
      seconds: 0.5,
      bytes: 22_000,
      bus: 'effects',
    },
  ],
  music: [track()],
  voice: [],
  ...overrides,
})

describe('licensing', () => {
  it('will not play a track that has a file but no paperwork', () => {
    // A public-domain composition is not a public-domain recording.
    const risky = manifest({ music: [track({ file: 'audio/nocturne.mp3', title: 'Nocturne' })] })
    expect(playableTracks(risky)).toEqual([])
    expect(unlicensedTracks(risky).length).toBe(1)
  })

  it('plays a track once it is fully attributed', () => {
    const clean = manifest({
      music: [
        track({
          file: 'audio/nocturne.mp3',
          title: 'Nocturne in E flat',
          performer: 'Some Performer',
          licence: 'CC0',
          attribution: 'Musopen',
        }),
      ],
    })
    expect(playableTracks(clean).length).toBe(1)
    expect(unlicensedTracks(clean)).toEqual([])
  })

  it('treats the empty slot as neither playable nor a problem', () => {
    // v1 ships with the slot open, waiting on an original composition.
    expect(playableTracks(manifest())).toEqual([])
    expect(unlicensedTracks(manifest())).toEqual([])
  })
})

describe('the mixer', () => {
  it('mutes every bus with one boolean', () => {
    const muted = toggleMuted(DEFAULT_MIXER)
    for (const bus of BUSES) expect(gainFor(muted, bus)).toBe(0)
  })

  it('scales a bus by master', () => {
    const half = { ...DEFAULT_MIXER, master: 0.5 }
    expect(gainFor(half, 'effects')).toBeCloseTo(DEFAULT_MIXER.effects * 0.5, 9)
  })

  it('keeps music under effects by default, so the table stays audible', () => {
    expect(gainFor(DEFAULT_MIXER, 'music')).toBeLessThan(gainFor(DEFAULT_MIXER, 'effects'))
  })

  it('clamps a level that came from a slider that went too far', () => {
    expect(gainFor(withBus(DEFAULT_MIXER, 'voice', 4), 'voice')).toBe(1)
    expect(gainFor(withBus(DEFAULT_MIXER, 'voice', -2), 'voice')).toBe(0)
    expect(gainFor({ ...DEFAULT_MIXER, master: Number.NaN }, 'voice')).toBe(0)
  })

  it('unmutes back to where it was', () => {
    expect(toggleMuted(toggleMuted(DEFAULT_MIXER))).toEqual(DEFAULT_MIXER)
  })
})

describe('gestures and sounds', () => {
  it('gives a chip toss a chip sound', () => {
    expect(soundForGesture('CHIP_toss')).toBe('chip_push')
    expect(soundForGesture('REACT_win')).toBe('pot_push')
  })

  it('stays silent for a gesture with no sound of its own', () => {
    // Breathing has no sound. Reaching for the nearest clip is how a table
    // ends up clattering every time somebody blinks.
    expect(soundForGesture('IDLE_breathe')).toBeNull()
    expect(soundForGesture('NOT_a_clip')).toBeNull()
  })
})

describe('the manifest', () => {
  it('finds a clip by id and reports the download', () => {
    expect(clipById(manifest(), 'chip_push')?.seconds).toBe(0.5)
    expect(clipById(manifest(), 'nothing')).toBeUndefined()
    expect(downloadBytes(manifest())).toBe(22_000)
  })

  it('leaves the table playable when the manifest cannot be fetched', async () => {
    // A table with no sound is playable. A table that will not load is not.
    expect(await loadAudioManifest(async () => new Response('', { status: 404 }))).toBeNull()
    expect(
      await loadAudioManifest(async () => {
        throw new Error('offline')
      }),
    ).toBeNull()
  })

  it('reads a manifest the pipeline actually wrote', async () => {
    const served = manifest()
    const loaded = await loadAudioManifest(
      async () => new Response(JSON.stringify(served), { status: 200 }),
    )
    expect(loaded?.effects[0]?.id).toBe('chip_push')
  })
})
