# Architecture

River is an npm workspace with three packages:

| Package | Role |
| --- | --- |
| `packages/engine` | The rules of poker and everything else that can be pure: betting, side pots, hand evaluation, showdown order, hand history, the economy's arithmetic and the rule-based bots. No I/O, so the server and the client share it and tests run it directly. |
| `apps/server` | The authoritative game server: rooms, the WebSocket protocol, the ledger, the economy and the bots. |
| `apps/web` | The Next.js client: the club menu, the 2D table, the optional 3D venues and the phone layout. |

## One process, two doors

[`apps/server/src/main.ts`](../apps/server/src/main.ts) starts a single Node
HTTP server. It serves the Next.js app and upgrades `/ws` connections to a
WebSocket endpoint (`ws`, with a 16 KB message cap). Hosting both in one process
keeps a table's state, its sockets and its HTTP routes (short table links,
public profiles and the API) in one place, with no cache between them.

## The server decides

Clients send intentions: sit, bet, fold, send a seed. The server checks each
one against the room's state and the engine's legal actions, applies it, and
sends each player a view built for them alone.

- [`room.ts`](../apps/server/src/room.ts) owns a table's lifecycle: seating,
  seed commitment and collection, dealing, betting rounds with per-street turn
  budgets, showdown and settlement. It is a state machine that emits events,
  which keeps it testable without sockets.
- [`transport.ts`](../apps/server/src/transport.ts) turns those events into
  per-player messages, handles reconnects (a dropped player keeps their seat for
  a grace period) and routes requests between rooms.
- [`protocol.ts`](../apps/server/src/protocol.ts) defines the messages.

## Money

Chips cannot be bought or cashed out, but they still have to add up.
[`ledger.ts`](../apps/server/src/ledger.ts) writes every change to an
append-only Postgres ledger. Each entry carries a reference built from the
room and request, so a retried write cannot pay twice. Seatings are tracked
next to the ledger, so the server always knows which buy-ins are still open. If
a server crashes, its replacement waits for the old process's shutdown window
to pass, then pays back any seat that was left open.

## Identity and storage

Supabase provides Postgres and Auth. The server verifies each player's JWT
against the project's published keys (`jose`) and talks to Postgres through
its REST interface with a server-only key. Row-level security limits what the
browser can read directly. The schema lives in
[`supabase/migrations`](../supabase/migrations).

## Bots

Bots sit in ordinary seats and use the same action path as people: a policy
proposes a move and the server validates it like any other. The rule-based
policies are pure functions in the engine. The river solver runs in a worker
thread, so a long solve never blocks the room's event loop. [Bots](bots.md)
covers how they are built and measured.

## Client

The web app uses the Next.js App Router with React 19. The default table is a
2D layout drawn with the DOM and scaled from a 1920x1080 base canvas, with a
dedicated portrait layout for phones. The 3D venues use three.js through React
Three Fiber and load glTF assets that the [art pipeline](art-pipeline.md) builds.
Animation state, such as a seat's arrival or an all-in, is computed by pure
modules with their own tests and read by the scene every frame.

## Delivery

GitHub Actions runs lint, typecheck and the unit suite on every push and pull
request, on Node 22 and 24. Production runs on Railway. A deploy is started on
purpose (a manual run or a version tag), runs the full gate set including a
production build, and then hands the build to Railway, so work in progress on
`main` never reaches a live table by accident.
