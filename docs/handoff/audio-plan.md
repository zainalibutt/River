# Audio — deferred, with the plan intact

Paused on 2026-08-26 to finish the visuals. Everything below is decided, and
some of it is already built. This file exists so picking it back up is reading
rather than rediscovering.

## Why it stopped

The nine generated effects sound cheap. That judgement is correct and the
reason is structural, not a tuning problem: **synthesised one-shots sound
synthetic.** A chip click built from filtered noise and a decaying sine has no
room in it, no material, no variation between strikes. Real foley sounds
expensive because it is a recording of an actual object in an actual space, and
no amount of envelope shaping produces that.

The synthesis approach was the wrong call for effects. It was the right call
for licensing and reproducibility, and those turned out not to be the binding
constraint.

## What is already built and still good

- `art/pipeline/audio.py` — the generator. Keep the mixing, layering and
  manifest code; replace the synthesis functions with file loading.
- `art/pipeline/check_audio.py` — **nine gates, every one self-tested.** These
  are format and loudness checks and apply to recorded audio exactly as they
  apply to generated audio. It caught three real defects on its first run.
- `art/pipeline/publish_audio.py` — copies into `apps/web/public/audio`.
- `apps/web/src/lib/audio.ts` — bus mixer, licence enforcement, gesture-to-sound
  map. Thirteen tests.
- `packages/engine/src/voice-lines.ts` — the voice line schema, from DeepSeek 5G.

## What to do when this resumes

### Effects: use recordings, not synthesis

There is **no foley or sound-effect model on OpenRouter.** Its audio catalogue
is speech in, speech out, plus music generation. Checked 2026-08-26.

The sources that give a premium feel for nothing:

- **Sonniss GDC bundles** — tens of gigabytes of professionally recorded foley,
  released free and royalty-free every year, usable commercially. This is the
  single best source for chips, cards and room tone.
- **freesound.org filtered to CC0** — smaller and more variable, good for
  filling specific gaps.
- **ElevenLabs Sound Effects** or **Stability Audio** if generation is still
  wanted. Both are outside OpenRouter and both cost more than a bundle that is
  free.

Keep the manifest and the gates. Swap the generator for a loader that reads
`art/source/audio/`, resamples to 22050 mono, applies the same fade and
normalisation, and writes the same output. The check script does not change at
all.

### Music: public domain now, original later

`Lyria 3 Clip Preview` on OpenRouter is $0.04 per 30-second clip, which is
cheap enough to be tempting. **Rejected for v1**: the licensing position of
AI-generated music is unsettled, and this repository is a portfolio piece where
every asset needs a clean provenance.

Public-domain performances from Musopen fill the slot. The manifest already
carries `licence` and `attribution` per track, and both the build gate and the
client refuse to play a file that lacks them, so an original composition
replaces one by editing JSON.

### Voice: the schema exists, the lines do not

Kokoro 82M on OpenRouter, $0.62 per million characters, open weights, 54 preset
voices. Thirteen characters is roughly fifteen thousand characters of speech -
about a penny for the whole cast.

Non-verbal expressions - sighs, groans, celebration - are the weak spot for
every TTS model. Gemini 3.1 Flash TTS carries inline audio tags aimed at
exactly this and is the one to try first.

Write the lines against `voice-lines.ts` so they arrive keyed to personality and
event. Prose would have to be parsed afterwards, and a parser for somebody
else's creative writing is a bug farm.
