# Packet 4AA — Who speaks when nine people could

**Owner:** DeepSeek. **Reviewer:** Claude.

Read `docs/handoff/deepseek-laws.md` first.

---

## First, 4Z

The voice pack is accepted. Verified against the shipped module rather than the
summary: 480 lines, `validatePack` returns empty, no line fails `validateLine`,
no coverage gaps across all thirteen, counts exactly 24 / 36 / 48 per chatter
tier, exactly 156 weight-3 lines - one per group - and a maximum of nine words
against a limit of twelve.

**The private `line()` factory was the right call**, and your question about it
was the right question. "Data only, no functions" meant no exported API beyond
`VOICE_PACK`; it did not mean hand-writing 480 ids that `validateLine`
recomputes anyway. A private constructor that calls `lineId` is how that rule is
satisfied, not a way around it.

One thing you could not have known: the picker you wrote those weights for was
broken. The roll deciding whether a bot speaks was also choosing its line, so a
silent character returned its first line one hundred percent of the time and
your weight-3 signature lines were unreachable for the four quietest
characters. Fixed at `17d9be5`. Your pack now measures correctly end to end -
Albie reaches both his `bad_beat` lines at 75/25, Lilah all four of hers at
50/17/17/17.

---

## The gap this packet closes

`bot-chatter.ts` decides whether **one** character speaks. Nothing decides what
happens when **nine** could.

A showdown resolves and every seat at the table gets an event in the same
frame. Each personality independently rolls, and each one that passes speaks
immediately. `cooldownMs` is per-personality and cannot see the other eight, so
a table of constant talkers produces five people talking over each other on the
same tick, and then silence.

That is not a table. It is a crowd.

## Files you may create or modify

- **CREATE** `packages/engine/src/table-speech.ts`
- **CREATE** `packages/engine/src/table-speech.test.ts`
- **MODIFY** `packages/engine/src/index.ts` — add exactly one line,
  `export * from './table-speech.js'`

Nothing else. In particular **do not modify `bot-chatter.ts` or
`voice-lines.ts`** — they are correct and another lane is about to consume
them.

## What to build

A pure function that takes every candidate utterance for one moment and returns
the ones that actually happen, each with a delay.

```ts
export interface SpeechCandidate {
  seat: number
  personalityId: string
  chatter: 'silent' | 'occasional' | 'constant'
  event: VoiceEvent
  priority: number
}

export interface ScheduledUtterance {
  seat: number
  personalityId: string
  event: VoiceEvent
  delayMs: number
}

export function scheduleTableSpeech(
  candidates: readonly SpeechCandidate[],
  lastSpokeAtMs: ReadonlyMap<number, number>,
  nowMs: number,
  options?: TableSpeechOptions,
): ScheduledUtterance[]
```

Rules, all of which must be configurable through `options` with the defaults
named here rather than written into the body as constants:

1. **At most three utterances per moment** (`maxConcurrent`). The rest are
   dropped, not queued - a reaction to a hand that finished eight seconds ago
   is worse than silence.
2. **At least 400ms between consecutive starts** (`spacingMs`), so the first
   speaks at 0, the second at 400, the third at 800.
3. **Highest priority speaks first.** Ties break by seat, so the result is
   stable for the same input.
4. **A seat under its own cooldown is dropped**, using `cooldownMs` from
   `bot-chatter.ts` and the `lastSpokeAtMs` map. Import it; do not restate the
   numbers.
5. **One utterance per seat per moment.** A seat appearing twice in the
   candidate list keeps its highest-priority entry.

## Hard constraints

- **Pure.** No `Date.now()`, no randomness, no I/O. Time arrives as `nowMs` and
  is never read.
- **Deterministic.** The same inputs give the same output, in the same order,
  every time.
- **Do not decide whether a character speaks at all.** That is `shouldSpeak`
  and it takes a roll. This function schedules candidates that have already
  passed that test. Keeping the roll out of here is what makes it a total
  function.
- Import types from `voice-lines.js` and `cooldownMs` from `bot-chatter.js`.
  Do not redefine either.

## Tests

Beyond the obvious per-rule cases, three that matter:

1. **Nine constant talkers on one showdown produce three utterances at 0, 400
   and 800ms** — the case the packet exists for.
2. **The dropped ones are the low-priority ones.** Give nine candidates with
   distinct priorities and assert the three that survive are the top three, not
   the first three in the array.
3. **An empty candidate list returns an empty array**, and a single candidate
   speaks at delay 0 rather than at `spacingMs`.

Write at least one test that fails if the spacing is applied but the ordering
is not — the two rules are easy to satisfy separately and get wrong together.

## Gates

`npm run lint && npm run typecheck && npm test`, all green.

**`npm test`, never `npx vitest`** — the latter tests a stale `dist`.

Run `npm run typecheck` before trusting your own suite. It has caught a
malformed object in a draft on this project three times now, including in a
packet where the author had written the warning.

## Commit and report

Law 1: stage only your three paths by name and run
`git diff --cached --name-only` immediately before committing. Two other lanes
are live in this working copy right now.

Law 7: the commit is authored by Zain alone. No trailer, no attribution, no
emoji.

Law 8: say what you did, what you did not, and anything you are unsure about.
Your 4Z report did that well - the factory question was worth asking and the
answer was yes.

Finish with exactly: `READY FOR CLAUDE`
