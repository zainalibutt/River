# River — specification v0.1

Multiplayer Texas Hold'em for friend groups. the reference x Blackjackist inspired. Working name: **River**. This document is the public decision record.

## Pillars

1. Couch-first social poker: PC browser + PS5 browser, one URL, DualSense equal citizen.
2. Fast rounds, zero friction between hands (Blackjackist pace).
3. Trustable by construction: server-authoritative, provably-fair shuffles, auditable chip ledger.
4. Design showcase: betting feel, motion design, lobbies, music, 10-foot TV legibility ≈ half the project weight.
5. No real money ever. Chips unpurchasable, uncashoutable. Cosmetics-only revenue shape.

## Platform & console UX

- Web-first stack; PS5 compatibility = the site running well in the PS5 browser with gamepad + TV UI.
- **TV Mode**: on-screen button → fullscreen where granted, hides all chrome, felt + actions only; unlock = hold 1s. Feature-detect fullscreen; immersive layout fallback. OS buttons uncapturable by design.
- PWA shipped regardless (iOS/Android/desktop install, cached shell). PS5 home pinning unsupported; documented workaround: send URL via PlayStation Messages app, open from console.
- Desktop wrapper (Tauri, Steam-style): wanted as late-v1 goal, non-blocking.
- Phone touch: bonus input, low priority. Phone-as-second-screen: parked/noted.
- Future rungs: Xbox Creator Program (individual-accessible real console); native PS5 = v2 with evidence.
- **Hardware spike before renderer commitment:** real PS5 browser test — viewport quirks, Gamepad API/DualSense mapping, WebGL memory ceiling, audio policies.

## Game core

- Variant: Texas Hold'em only, deep. 2 hole cards + 5 community, best 5-card hand wins.
- Format: **cash tables**. Standard buy-in, leave/cash out anytime, rebuy on bust while seated.
- Table size: **9-max** default (heads-up and 6-max supported). Seat-fill/deal moments animated.
- Speed knobs (config-driven, tunable without redeploy): action timer (default 15s), auto check-fold on timeout, auto-muck losing hands at showdown, 3s next-deal countdown, instant rebuy button.
- Bots: optional fill, three skills — **Rookie / Novice / OG**.

## Economy (server-authoritative, append-only ledger, config-driven)

- Signup bankroll: **100,000**.
- Stakes ladder: entry **250/500** (min buy-in 50,000 = 100 BB, default buy-in 100,000 = 200 BB, max 200,000 = 400 BB), higher tiers gated by buy-in. *(Aug 2026: chip scale ×10 — 25/50 → 250/500, economy figures scaled to match — cosmetic denomination change, ratios unchanged.)*
- Bust rescue (amended Aug 2026): when broke, instant top-up to **25,000** chips, capped claims/day (config-driven), so nobody sits out friends-night at zero. Supersedes the claim-5,000-per-24h rule.
- Daily login: flat grant + growing streak, day 7 largest (~100k). Percentage compounding rejected.
- Chip sink: cosmetics purchasable *with chips* (legal — chips unbuyable).

## Presentation

- **3D main**, 2D graphics-saver mode. Same engine, two renderers (React Three Fiber / DOM).
- **Player bodies v1, basic**: low-poly seated characters, rigs via Mixamo-style pipeline; idle breathe/sway, card peek, chip toss, win/lose react, plus **stand-up on all-in** (signature moment, the reference-style). No facial work.
- Camera: fixed cinematic angles + dramatic auto-zoom on all-ins/showdowns.
- Launch venues (3): **Rooftop bar**, **Underground basement**, **High-end suite**. Varied mood/lighting per the reference tradition.
- Art production: agent-driven procedural Blender (bpy) + AI textures + asset packs where quality demands. Art spike after engine core: table + chips + cards + one seated rig rendered before any React exists.
- Cosmetics v1: basic set proving the system (felts / card backs / chip sets); full wearables (rings, hats, outfits) arrive with richer character models later.
- Music/audio: licensed ambient loops at launch + selective original pieces later.

## Trust & fairness

- Provably-fair shuffle: hash commit pre-deal, seed reveal post-hand, subtle verify badge/button per hand. Build fully v1.
- Session hand-history replay: parked.
- Anti-cheat by information hiding: clients never receive opponents' hole cards.

## Social & accounts

- Private invite-code tables first; public matchmaking later.
- Chat: typed general chat in side panel + emote wheel (quips/emoticons, gamepad-friendly). Voice = Discord, never us.
- Auth (Supabase, decided Aug 2026): every visitor gets an **anonymous session** on load — guest-play default with zero friction. Upgrading to a permanent account links an email magic link (OAuth later) and keeps bankroll/streaks/cosmetics intact: same player row, no migration.
- Game server trusts nothing client-side: verifies Supabase JWTs against the project JWKS on WebSocket connect; `service_role` key never leaves the server; Postgres RLS locks player rows; chip-ledger writes are server-only and append-only.

## Tech

- TypeScript everywhere. Monorepo: `packages/engine` (pure logic, heavily tested) · `apps/server` (Node WebSocket authoritative) · `apps/web` (Next.js + R3F).
- Hosting: Railway Hobby (already paid) runs server + web (single origin, simplest WebSockets). Supabase free tier for persistence.
- Domain: free Railway subdomain at launch (`*.up.railway.app`, HTTPS included); custom domain (Porkbun / Cloudflare Registrar, at-cost) parked as post-launch polish. Vercel not needed.
- Definition of done: **both** — friends playing weekly AND polished playable + trailer for zain.org.uk.

## Milestone spine

1. Engine package: deck, evaluator, betting/side-pot machine — unit-tested hard, CLI demo.
2. Single-player vs bots, 2D DOM view.
3. WebSocket multiplayer: two tabs, one hand, reconnect mid-hand.
4. Provably-fair shuffle + verify UI.
5. Art spike → 3D venue #1, seated bodies, TV Mode.
6. Venues #2/#3, cosmetics v1, economy live (ledger + streaks + rescue).
7. Polish: load tests with bot clients, sound/music, trailer, wrapper, launch.
