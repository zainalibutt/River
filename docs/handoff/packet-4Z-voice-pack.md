# Packet 4Z — Voice line pack

**Owner:** DeepSeek. **Reviewer:** Claude.

Read `docs/handoff/deepseek-laws.md` first. It is binding and it overrides any
habit you would otherwise apply.

---

## Why this packet exists

Two finished modules are waiting on data that does not exist.

`packages/engine/src/voice-lines.ts` has the schema, the validator, the id
function and the weighted picker. `packages/engine/src/bot-chatter.ts` has
speak chance per chatter level, per-personality cooldowns, and `nextUtterance`.
Both are tested. Both are correct. Neither does anything, because there are no
lines for them to pick from.

This is the seventh instance of the same pattern on this project: a module that
passed its own gates and was wired to nothing. Writing the pack turns two
finished modules into a working feature.

## Files you may create or modify

- **CREATE** `packages/engine/src/voice-pack.ts`
- **CREATE** `packages/engine/src/voice-pack.test.ts`
- **MODIFY** `packages/engine/src/index.ts` — add exactly one line,
  `export * from './voice-pack.js'`, in the same style as the lines around it.

Nothing else, for any reason. Law 3.

## What to build

`voice-pack.ts` exports one symbol:

```ts
export const VOICE_PACK: readonly VoiceLine[]
```

Data only. No functions, no classes, no lookup helpers — `voice-lines.ts`
already has the picker and `bot-chatter.ts` already has the scheduler.

**Coverage is total.** Thirteen personalities times twelve events is 156 groups,
and none of them may be empty.

**Line count is set by the personality's `chatter` field:**

| chatter | lines per event | personalities | total |
|---|---|---|---|
| `silent` | 2 | albie, doyle, gordo, jules | 96 |
| `occasional` | 3 | clem, edna, irving, kazimir | 144 |
| `constant` | 4 | bernadette, frank, hyacinth, lilah, mickey | 240 |

**480 lines.** Write all of them. Do not sample, do not stub, do not leave a
`TODO` for the rest.

## Hard rules, all enforced by the validator

- **`id` must equal `lineId(personalityId, event, index)`**, with `index`
  contiguous from `0` within each personality-and-event group. Import `lineId`
  and call it. Do not hand-write ids — `validateLine` recomputes the id from the
  other fields and rejects any mismatch.
- **`weight` is an integer of 1 or more.** Use 1 to 3. Higher is heard more
  often. Give each group exactly one signature line at weight 3 and leave the
  rest at 1.
- **`text` has a schema limit of 180 characters. Your working limit is twelve
  words.** These are spoken aloud at a table between hands, not read off a page.
- **`expression`** is one of `sigh`, `laugh`, `scoff`, `groan`, `cheer`, `tut`,
  `breath`, or `null`. A line may carry an expression with empty text — the
  validator allows it, and it is the right answer for a silent character who
  should mostly just exhale.

## Voice

| id | name | skill | aggression | tightness | bluffRate | tiltResistance | chatter |
|---|---|---|---|---|---|---|---|
| albie | Albie | rookie | 0.20 | 0.50 | 0.10 | 0.20 | silent |
| bernadette | Bernadette | rookie | 0.35 | 0.40 | 0.20 | 0.30 | constant |
| clem | Clem | rookie | 0.15 | 0.60 | 0.05 | 0.25 | occasional |
| doyle | Doyle | rookie | 0.25 | 0.45 | 0.15 | 0.40 | silent |
| edna | Edna | novice | 0.50 | 0.30 | 0.30 | 0.50 | occasional |
| frank | Frank | novice | 0.40 | 0.50 | 0.25 | 0.45 | constant |
| gordo | Gordo | novice | 0.60 | 0.25 | 0.35 | 0.35 | silent |
| hyacinth | Hyacinth | novice | 0.45 | 0.40 | 0.30 | 0.55 | constant |
| irving | Irving | novice | 0.35 | 0.55 | 0.20 | 0.60 | occasional |
| jules | Jules | og | 0.65 | 0.20 | 0.40 | 0.70 | silent |
| kazimir | Kazimir | og | 0.55 | 0.35 | 0.30 | 0.75 | occasional |
| lilah | Lilah | og | 0.70 | 0.15 | 0.45 | 0.65 | constant |
| mickey | Mickey | og | 0.60 | 0.30 | 0.35 | 0.80 | constant |

**Write to the traits, not to the name.** The numbers are the character:

- High `aggression` with low `tightness` pushes and says so. Lilah at 0.70 and
  0.15 is the loudest player at the table.
- High `tiltResistance` does not rattle after a bad beat. Mickey at 0.80 shrugs
  it off; Albie at 0.20 comes apart.
- High `bluffRate` talks differently on `bluff_caught` — caught doing the thing
  they do — than a low-bluff player who tried it once.
- `rookie`, `novice` and `og` are three different amounts of table experience.
  An og has seen this before. A rookie has not.

**Setting:** three venues — a rooftop bar, a laundromat, and an executive suite.
Working-class through to moneyed. Needling the table is in character.

**Keep it broadcast-safe.** No profanity, no slurs, no sexual content, nothing
referencing real people. The repository is public and this project is read as a
portfolio piece. **This bound is not yours to relax**, and it is not a gate you
may weaken to make a line land better.

**Do not make all thirteen wisecrackers.** Albie is a silent rookie with the
lowest tilt resistance on the board — most of his lines should be a `sigh`, a
`breath`, or four flat words. Restraint is characterisation.

## Tests

`voice-pack.test.ts` must assert all six:

1. `validatePack(VOICE_PACK)` returns `[]`.
2. Every line individually returns `[]` from `validateLine`.
3. `coverage(VOICE_PACK, personalityPool())` reports `missing: []` for all
   thirteen. Import the real pool from `bot-personality.js`; do not restate the
   roster in the test.
4. `pickLine` returns a non-null line for all 156 groups at rolls `0`, `0.5` and
   `0.999`.
5. **The weighted picker actually discriminates.** For at least one known group,
   assert that roll `0` and roll `0.999` return different ids.
6. No two lines within one personality share the same `text`, ignoring empty
   text.

**Assertion 5 is the one that matters.** Law 6: the other five would all pass
against a pack where every line is identical. Assertion 6 catches copy-paste
across characters, which is the likely failure mode when writing 480 of
anything.

## Gates

```
npm run lint && npm run typecheck && npm test
```

All three, in that order, all green before you commit.

**`npm test`, never `npx vitest`.** `npm test` runs `pretest`, which rebuilds
the engine. Running vitest directly tests a stale `dist` and will report success
against code you did not write.

Run `npm run typecheck` before you trust your own suite. Vitest transpiles
without typechecking, so a malformed object in a test file asserts nothing and
still goes green. That trap has now caught three separate packets on this
project, including the person who wrote the warning.

## Commit and report

Law 1: stage only your three paths by name. Run
`git diff --cached --name-only` immediately before committing and confirm it
lists nothing else. Another model has uncommitted work in `art/pipeline/` right
now — if it appears in that list, unstage it.

Law 7: the commit is authored by Zain alone. No trailer, no attribution, no
emoji.

Law 8: report what you did, what you did not do, and anything you are unsure
about. Then finish with exactly:

`READY FOR CLAUDE`
