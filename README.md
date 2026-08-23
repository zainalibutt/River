# River

> Multiplayer Texas Hold'em for friend groups. PC browser + PS5 browser couch play. Born the day its creator got banned from Blackjackist.

**Status:** engine core complete — deck, deterministic shuffle, evaluator, betting and side pots are tested; the solo browser loop is next. Product decisions live in [`docs/spec.md`](docs/spec.md).

## Problem

Existing poker is either grindy mobile casinos engineered to sell chips, or console titles that demand a full session, a headset, and a lobby queue. None of it lets a friend group open one URL — half on PCs, half slumped in front of a telly with a DualSense — and be dealt into the same hand inside fifteen seconds.

River is that game: proper cash-table hold'em in a browser, tuned for the couch first.

## Approach

Server-authoritative Texas Hold'em in TypeScript. A pure engine package owns every rule and is tested like it matters; a Node WebSocket server owns every chip via an append-only ledger; a Next.js + React Three Fiber client renders two ways — 3D venues with seated low-poly bodies, or a plain 2D graphics-saver mode.

- Shuffles are provably fair: hash committed before the deal, revealed after.
- Chips are earned, never bought, never cashed out; cosmetics cost chips so real money touches nothing.
- TV Mode strips the page down to felt and action buttons for PS5 browsers, gamepad as equal citizen.

## Development

| Command              | What it does           |
| -------------------- | ---------------------- |
| `npm run dev`        | Watch mode             |
| `npm test`           | Vitest, single run     |
| `npm run lint`       | Biome check            |
| `npm run format`     | Biome autofix          |
| `npm run typecheck`  | `tsc --noEmit`, strict |

Copy `.env.example` to `.env.local` for local Supabase config (data-layer work only; nothing reads it yet).

Requires Node >= 20. Tests, typechecking and CI run on every push and PR against Node 20 and 22.
