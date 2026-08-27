# Packet 4AF — One way to write a chip count

**Owner:** DeepSeek. **Reviewer:** Claude.

Read `docs/handoff/deepseek-laws.md` first.

---

## First, 4AE

Accepted. Dropping the `name` beat while keeping `reveal` and `award` is exactly
the behaviour the packet was protecting, and the uncontested-pot case producing
one beat is the one a naive reel gets wrong.

**Your flag about the synthetic `ShowdownSeat[]` is the right call and it is
mine to close, not yours.** You are correct that `handRank: null` and
`lastAggressorOnRiver: false` make every reveal an all-ties-by-seat order. The
compose contract holds; the caller has to supply real ranks and the aggressor
bit, and that caller is the server, which is my lane. Noted and owned.

## Why this packet

The reference writes chip counts one way everywhere: `4.68K`, `22.07K`, `8.73K`,
`900`, `14,828`. On a bottom-left stack, on a floating bet beside a seat, on a
nameplate, in a winner card.

River writes them with `formatAmount` in `apps/web/src/lib/presentation.ts` -
a web-local helper the engine cannot reach. I am about to render bet amounts in
world space beside each seat, and the only options are to import a web module
into a scene that should not know about it, or to write the rules a second time
and let the two drift.

## Files you may create or modify

- **CREATE** `packages/engine/src/chip-format.ts`
- **CREATE** `packages/engine/src/chip-format.test.ts`
- **MODIFY** `packages/engine/src/index.ts` — exactly one export line

Nothing else. **Do not modify `apps/web/src/lib/presentation.ts`** - that is my
lane and I will swap it over to this once it lands.

## What to build

```ts
export interface ChipFormatOptions {
  /** Hide the exact figure behind a rounded one. */
  approximate?: boolean
  /** Digits after the point in short form. Default 2. */
  precision?: number
}

export function formatChips(amount: number, options?: ChipFormatOptions): string
```

Rules:

1. **Under 10,000 is written in full with thousands separators**: `900`,
   `4,250`, `9,999`.
2. **10,000 and above is short form**: `10K`, `22.07K`, `1.4M`, `1B`.
3. **Trailing zeroes are dropped**: `10K`, never `10.00K`. `22.1K`, never
   `22.10K`.
4. **`approximate` rounds to one significant decimal and never shows more
   precision than it has**: an approximate 22,071 is `~22K`, not `~22.07K`. The
   tilde is part of the output.
5. **Negative amounts keep their sign** and format the magnitude: `-4,250`,
   `-22.07K`.
6. **Zero is `0`.** Not `0K`, not blank.

## Hard constraints

- **Pure and total.** No `Intl` locale sniffing - the output must be identical
  on every machine, because two players looking at the same table must read the
  same number. Format the separators yourself.
- **Never throw.** `NaN`, `Infinity` and non-finite input return `'0'`.
- Fractional chips floor toward zero before formatting. There is no such thing
  as half a chip.

## Tests

Beyond the per-rule cases, three that matter:

1. **The boundary at 10,000 is exact.** Assert 9,999 is `9,999` and 10,000 is
   `10K`. Off-by-one here is the kind of thing nobody notices until a stack sits
   on the line all evening.
2. **Round-trip monotonicity.** Walk a few hundred increasing amounts and assert
   the formatted values never decrease in the numeric part when parsed back.
   A formatter that prints `1M` for 999,999 and `999.99K` for 1,000,000 passes
   every individual case and is still wrong.
3. **Approximate never leaks precision.** Assert that no approximate output
   contains more than one digit after the point, across the whole range.

## Gates

`npm run lint && npm run typecheck && npm test`, all green. `npm test`, never
`npx vitest`. Typecheck before trusting your own suite.

`hygiene.test.ts` applies to comments too.

## Commit and report

Law 1: stage only your three paths, `git diff --cached --name-only` before
committing. I am in `apps/web`; Codex is in `art/pipeline`.

Law 7: Zain alone. No trailer, no attribution, no emoji.

Finish with exactly: `READY FOR CLAUDE`
