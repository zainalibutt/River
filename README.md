# River

> Multiplayer Texas Hold'em for friend groups. PC browser + PS5 browser couch play. Born the day its creator got banned from Blackjackist.

**Status:** playable end to end. Three 3D venues with seated, animated characters; server-authoritative multiplayer over WebSockets; an append-only chip ledger; provably fair shuffles; an economy with daily grants, cosmetics and table items; a lobby and private tables. 901 tests across 78 files, green on Node 22 and 24. Product decisions live in [`docs/spec.md`](docs/spec.md).

## Problem

Existing poker is either grindy mobile casinos engineered to sell chips, or console titles that demand a full session, a headset, and a lobby queue. None of it lets a friend group open one URL — half on PCs, half slumped in front of a telly with a DualSense — and be dealt into the same hand inside fifteen seconds.

River is that game: proper cash-table hold'em in a browser, tuned for the couch first.

## Approach

Server-authoritative Texas Hold'em in TypeScript. A pure engine package owns every rule and is tested like it matters; a Node WebSocket server owns every chip via an append-only ledger; a Next.js + React Three Fiber client renders two ways — 3D venues with seated low-poly bodies, or a plain 2D graphics-saver mode.

- Shuffles are provably fair: hash committed before the deal, revealed after.
- Chips are earned, never bought, never cashed out; cosmetics cost chips so real money touches nothing.
- TV Mode strips the page down to felt and action buttons for PS5 browsers, gamepad as equal citizen.

## The record

The development record is a deliverable here, not a by-product.

- [`docs/DECISIONS.md`](docs/DECISIONS.md) - decisions that shaped River and the reasoning that produced them, including the ones that were reversed.
- [`docs/PROGRESS.md`](docs/PROGRESS.md) and [`docs/progress/`](docs/progress/) - what shipped, with renders at every meaningful art change.
- [`docs/design/`](docs/design/) - 23 design contracts. Each names the commit it was written against.
- [`docs/EFFORT.md`](docs/EFFORT.md) - what it cost, measured rather than estimated.
- [`PUBLISHING.md`](PUBLISHING.md) - what may go into a public repository, and what enforces it.

Faults are recorded beside the wins, retractions included. A claim that could not be verified says so in the same breath.

## Development

| Command              | What it does           |
| -------------------- | ---------------------- |
| `npm run dev`        | Watch mode             |
| `npm test`           | Vitest, single run     |
| `npm run lint`       | Biome check            |
| `npm run format`     | Biome autofix          |
| `npm run typecheck`  | `tsc --noEmit`, strict |

Copy `.env.example` to `.env.local` for Supabase config. The server reads it for auth and the chip ledger; the web app reads it for sign-in. The engine package needs none of it and its tests run without any.

Requires Node >= 22. Tests, typechecking and CI run on every push and PR against Node 22 and 24.
