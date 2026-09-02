# River — specification v0.1

Multiplayer Texas Hold'em for friend groups: console-style social poker with a casual-casino economy. Working name: **River**. This document is the public decision record.

## Pillars

1. Couch-first social poker: **desktop browser is the v1 target; PS5 browser is a standing compatibility commitment**, one URL, DualSense an equal citizen by design. See Platform & console UX for what "commitment without validation" binds us to.
2. Fast rounds, zero friction between hands (Blackjackist pace).
3. Trustable by construction: server-authoritative, provably-fair shuffles, auditable chip ledger.
4. Design showcase: betting feel, motion design, lobbies, music, 10-foot TV legibility ≈ half the project weight.
5. No real money ever. Chips unpurchasable, uncashoutable. Cosmetics-only revenue shape.

## Platform & console UX

### Platform retarget (Q9, decided Aug 2026)

No PS5 is available to test on, so the planned hardware spike cannot run. Rather than delay 3D indefinitely or pretend to evidence we do not have, **v1 targets the desktop browser** and PS5 compatibility becomes a *designed-for, not-yet-verified* commitment.

**PS5 compatibility is not dropped. It remains a first-class goal of this project.** What changes is only when it is proven. Until a console is in the room, every one of the following stays binding, because retrofitting them later costs far more than honouring them now:

- **Conservative asset budgets.** 3D work targets a ceiling deliberately below what desktop GPUs allow, sized so a PS5 browser has a realistic chance of holding it. Budgets are recorded in `docs/design/10-art-direction.md` and are not raised because a desktop machine can cope.
- **Gamepad parity from day one.** Every action reachable and confirmable with a controller alone. No pointer-only affordance ever ships.
- **TV Mode and 10-foot legibility** stay first-class, not deferred polish.
- **Fullscreen, audio-autoplay and browser-suspension paths** are feature-detected with graceful fallbacks, never assumed.
- **A renderer fallback path.** The 2D DOM renderer remains permanent and complete, so a device that cannot hold the 3D scene still gets a full game.

The hardware spike (Packet 5A) is **deferred, not cancelled**. It runs the moment console access exists, and its findings amend the budgets rather than being designed around. Until then, desktop profiling stands in as the measurement, with headroom deliberately left unused.

- Web-first stack; PS5 compatibility = the site running well in the PS5 browser with gamepad + TV UI.
- **TV Mode**: on-screen button → fullscreen where granted, hides all chrome, felt + actions only; unlock = hold 1s. Feature-detect fullscreen; immersive layout fallback. OS buttons uncapturable by design.
- PWA shipped regardless (iOS/Android/desktop install, cached shell). PS5 home pinning unsupported; documented workaround: send URL via PlayStation Messages app, open from console.
- Desktop wrapper (Tauri, Steam-style): wanted as late-v1 goal, non-blocking.
- Phone touch: bonus input, low priority. Phone-as-second-screen: parked/noted.
- Future rungs: Xbox Creator Program (individual-accessible real console); native PS5 = v2 with evidence.
- **Hardware spike, deferred (Q9):** the real PS5 browser test — viewport quirks, Gamepad API/DualSense mapping, WebGL memory ceiling, audio policies — remains the eventual validation gate. It no longer blocks 3D production because no console is available; the conservative budget above substitutes until it can run.

## Game core

- Variant: Texas Hold'em only, deep. 2 hole cards + 5 community, best 5-card hand wins.
- Format: **cash tables**. Standard buy-in, leave/cash out anytime, rebuy on bust while seated.
- Table size: **9-max** default (heads-up and 6-max supported). Seat-fill/deal moments animated.
- Speed knobs (config-driven, tunable without redeploy): **per-street action budgets — 15s preflop, 20s flop, 20s turn, 25s river** (matching the reference's published windows), auto check-fold on timeout, configurable auto-muck, 3s next-deal countdown, instant rebuy button.
- **Two pacing modes:** *cinematic* (full authored cadence) and *fast* (all animations retained, dead air removed). Fast never removes an animation, only the gaps between them.
- **Preset actions:** players may select an action before their turn. The preset UI is private; the avatar gesture that accompanies it is public. This is deliberate poker body language, not a leak (Aug 2026).
- **Muck selection:** show neither, one, or both cards, offered at showdown and to river folders. Auto-muck is a persisted setting.
- Bots: optional fill, three skills — **Rookie / Novice / OG**.

## Economy (server-authoritative, append-only ledger, config-driven)

- Signup bankroll: **100,000**.
- Stakes ladder: entry **250/500** (min buy-in 50,000 = 100 BB, default buy-in 100,000 = 200 BB, max 200,000 = 400 BB), higher tiers gated by buy-in. *(Aug 2026: chip scale ×10 — 25/50 → 250/500, economy figures scaled to match — cosmetic denomination change, ratios unchanged.)*
- Bust rescue (amended Aug 2026): when broke, instant top-up to **50,000** chips — one legal 100 BB entry buy-in — capped claims/day (config-driven), so nobody sits out friends-night at zero. Supersedes the claim-5,000-per-24h rule and the unusable 25,000 floor.
- Daily login: flat grant + growing streak, day 7 largest (~100k). Percentage compounding rejected.
- Chip sink: cosmetics purchasable *with chips* (legal — chips unbuyable).

## Presentation

- **3D main**, 2D graphics-saver mode. Same engine, two renderers (React Three Fiber / DOM).
- **Player bodies v1**: low-poly complete seated silhouettes, including thighs, shins and shoes wherever the permitted orbit camera can expose them; rigs via the procedural Blender pipeline; idle breathe/sway, card peek, chip toss, win/lose react, plus **stand-up on all-in** (signature moment, the reference-style). Faces carry one authored resting expression plus a bounded runtime set for blink, soft smile, frustration, brow response and mouth movement that survives hero and gameplay-distance proofs. Continuous procedural facial simulation and speech lip-sync remain out of scope.
- **Camera: third-person, seat-relative orbit under player control** (Aug 2026, revised). Right stick or mouse-drag rotates around the table from your seat. No zoom, no first-person, no top-down — the reference's model cloned exactly. Qualifying all-ins and winners temporarily take the camera for a short authored shot and then **restore the player's previous orbit**. Ordinary actions never move the camera.
- **Launch venues (3)** (Aug 2026, settled at three after briefly expanding to five): **The Rooftop**, **Laundromat**, **Executive Suite**. The reference's full venue set — Biker Bar and Casino included — remains **general law for the look**: its staging, lighting language, dealer conventions and venue-identity approach govern River's art direction. River simply ships three rooms rather than five. Biker Bar and Casino are parked as post-launch venues, not cancelled. Venues change environment art, lighting, background life, ambient SFX, music, dealer presentation and theme identity — **never poker rules**. Dealer presentation differs by venue: a dedicated croupier NPC in casino-style rooms, rotating player-dealer elsewhere.
- Art production: agent-driven procedural Blender (bpy) + AI textures + asset packs where quality demands. After the engine core, establish the visual direction and test the asset pipeline with table, chips, cards, and one seated rig. This is a feasibility proof, not a renderer commitment. Production 3D work previously waited on the real-PS5 hardware gate; per Q9 it now proceeds against the conservative self-imposed budget, with the console test deferred to whenever hardware exists.
- Cosmetics v1: basic set proving the system (felts / card backs / chip sets); full wearables (rings, hats, outfits) arrive with richer character models later.
- Music/audio: licensed ambient loops at launch + selective original pieces later.

## Trust & fairness

- Provably-fair shuffle: hash commit pre-deal, seed reveal post-hand, subtle verify badge/button per hand. Build fully v1.
- Session hand-history replay: parked.
- Anti-cheat by information hiding: clients never receive opponents' hole cards.

## Social & accounts

- Private invite-code tables first; public matchmaking later.
- **Four separate social systems** (Aug 2026): **emotes** (3D avatar animations, throttled, interruptible by poker-critical animation), **avatar reaction VO** (short automatic vocalisations), **player voice chat** (Discord, never us), and **full typed text chat** in a side panel. Text chat is a deliberate River divergence — the reference has emotes and voice but no typed chat.
- **REP progression**, layered over the table and kept entirely separate from bankroll and from any ranked rating. Earned from play, challenges, table items and events. A displayed percentage such as `120%` is an **earning-rate modifier**, not level progress, and derives from an inspectable breakdown.
- **Table items**: props beside each seat with three roles — visual identity, ambient interaction animation, and a REP boost. Purchasable with chips, which serves the chip sink. They never affect poker odds.
- Auth (Supabase, decided Aug 2026): every visitor gets an **anonymous session** on load — guest-play default with zero friction. Upgrading to a permanent account links an email magic link (OAuth later) and keeps bankroll/streaks/cosmetics intact: same player row, no migration.
- Game server trusts nothing client-side: verifies Supabase JWTs against the project JWKS on WebSocket connect; `service_role` key never leaves the server; Postgres RLS locks player rows; chip-ledger writes are server-only and append-only.

## Tech

- TypeScript everywhere. Monorepo: `packages/engine` (pure logic, heavily tested) · `apps/server` (Node WebSocket authoritative) · `apps/web` (Next.js + R3F).
- Hosting: Railway Hobby (already paid) runs server + web (single origin, simplest WebSockets). Supabase free tier for persistence.
- Domain: free Railway subdomain at launch (`*.up.railway.app`, HTTPS included); custom domain (Porkbun / Cloudflare Registrar, at-cost) parked as post-launch polish. Vercel not needed.
- Definition of done: **both** — friends playing weekly AND polished playable + trailer for zain.org.uk.
- **Ordering, decided Aug 2026: multiplayer leads.** Phases 3 and 4 reach playable before art is pushed to trailer standard. The trailer then shows a real game being played rather than a rendered still. Art work continues only where it is cheap or where it unblocks something.
- **The 2D renderer is rebuilt to the current contract** (Aug 2026). The design rewrite made the HUD radial and the camera a seat-relative orbit; the 2D mode shipped in Phase 2 has a button rail and no orbit. Both renderers share one interaction model — that is what makes the graphics-saver promise honest rather than a second, lesser game.

## Milestone spine

1. Engine package: deck, evaluator, betting/side-pot machine — unit-tested hard, CLI demo.
2. Single-player vs bots, 2D DOM view.
3. WebSocket multiplayer: two tabs, one hand, reconnect mid-hand.
4. Provably-fair shuffle + verify UI.
5. Art spike → 3D venue #1, seated bodies, TV Mode.
6. Venues #2/#3, cosmetics v1, economy live (ledger + streaks + rescue).
7. Polish: load tests with bot clients, sound/music, trailer, wrapper, launch.
