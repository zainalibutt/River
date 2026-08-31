# Lane log

Running record of what all three models have shipped. **Append, never rewrite.**
Claude maintains this. It exists so that a compaction on any side does not cost us
a re-derivation of who did what.

Format: one row per completed packet, newest last.

| Date | Packet | Owner | Commit | Result |
|---|---|---|---|---|
| 2026-08-23 | 1A-2D foundation | mixed | various | Engine, 2D renderer, session orchestrator |
| 2026-08-24 | 3A room protocol | DeepSeek | `450a01f` | Codex reviewed and hardened, four contract gaps fixed |
| 2026-08-24 | 3B transport | Codex | `7a20c7b` | Production live. JWKS auth, ledger, WebSocket, reconnect, idempotency index |
| 2026-08-24 | 5B-P pipeline | DeepSeek | `03af296` | Three-venue kit, budget checker with 15 negative cases |
| 2026-08-24 | 5B-C/A/X characters | DeepSeek, repaired by Claude | `debfd93` | Seven defects fixed. Garment was unweighted and would not deform |
| 2026-08-24 | 5B-V lighting | Claude | `4e46e2f`, `b4331af` | Pipeline had no lights at all. Measured rigs ported, gradient sky, one caster per venue |
| 2026-08-24 | 5B-R renderer | Codex | `e2eb936` | Accepted. The P0 was a measurement artefact, not a defect |
| 2026-08-24 | 4E economy engine | DeepSeek | `aad2f79` | Pure module. Rescue tops up rather than adding flat, streak resets correctly |
| 2026-08-24 | 4F fairness | Codex | `72e52be` | Security defect closed. Per-hand seeds, rejection-sampled shuffle, million-shuffle bias test |
| 2026-08-24 | 4V verify panel | Claude | `4b34ce0` | Client-side WebCrypto recomputation. Also fixed repo-wide CRLF via .gitattributes |
| 2026-08-24 | 4G turn timers | Codex | `97563f6` | Accepted. Budgets 15/20/20/25 from config, timeout is check-else-fold, late client actions coerced |
| 2026-08-24 | 4R preset actions | Claude | `d07c452` | Local half. Arm/commit/invalidate, clears on street change |
| 2026-08-24 | 4J chat and emote transport | Codex | `366f806` | Accepted. Emotes blocked during your own decision window, social never enters room state, shared rate limit |
| 2026-08-24 | 5C rooftop skyline | Claude | `d995f93` | Skyline, mountains, palms. Repaired the camera gate, which was silently passing everything, then used it to find three mis-placed venue elements |

## In flight

| Packet | Owner | Dispatched | Notes |
|---|---|---|---|
| 5E chip and card instancing | Codex | 2026-08-24 | art/pipeline only. Chips are individual objects; 51 in the pot alone |
| 4K REP module | DeepSeek | 2026-08-24 | First packet under `deepseek-laws.md`; it confirmed the laws and quoted law 1 correctly |
| 4M table item catalogue | DeepSeek | 2026-08-24 | Queued behind 4K. Chip sink, never affects poker odds |
| 4H economy wiring | DeepSeek | 2026-08-24 | **Stalled mid-work.** `economy-service.ts` and a migration sit uncommitted and fail typecheck at line 204 plus formatting. Watch for it adding a state table instead of deriving from ledger refs |

| 2026-08-24 | 5D Basement and Suite detail | Codex | `eae4bee` | Accepted. Basement 1,368 to 3,218 tris, Suite 2,614 to 16,904. Gate verified untouched and still firing |
| 2026-08-24 | 5E chip instancing | Codex | `b2b6ae1` | Accepted. GPU instancing with stable per-instance ids. Draw calls 50/42/47 to 34/26/31 |
| 2026-08-24 | 4M table items | DeepSeek | `cdfbcd9` | Accepted. Zero imports, so it cannot touch poker odds by construction |
| 2026-08-24 | 4N REP progression | DeepSeek | `4924d9b` | Accepted. 14 tests, pure, no clock |
| 2026-08-25 | 4S seat presentation | DeepSeek | `7ed6453` | Accepted. 2,048 exhaustive combinations, total function. It ran typecheck first and caught a malformed object in its own draft |
| 2026-08-25 | Migration applied | Codex | n/a | `player_table_items` live on River Production. RLS on, unique equipped-slot index, owner-only SELECT, public INSERT denied |
| 2026-08-25 | 4W table item store and wire | Claude | `edec33e` | Supabase-backed store plus buy and equip client messages. The purchase path had been written against an interface with no implementation |
| 2026-08-25 | 5H leaked venue light | Codex | `9e3c7da` | **Solved the empty venue.** A stray gltf point light at intensity 54,351, leaked from an older character import, washed every room out. Export now excludes punctual lights and the build fails if one appears |
| 2026-08-25 | 4X lobby model | DeepSeek | `4f3e518` | Accepted. 21 tests, stable sort, no mutation, bestTableFor never returns a table the bankroll cannot cover |
| 2026-08-25 | 4Y inventory wire and shop | Claude | `836f2eb`, `39da2f0` | Snapshot carries inventory, socket can buy and equip, shop panel built. Ownership outranks price so an owned item never reads as unaffordable |
| 2026-08-25 | 5L the lid | Claude | `3f7cc16` | `cylinder()` always capped its top, so the parapet sealed a solid 3.9m disc over every venue. This, not the leaked light, is why the rooms looked empty |
| 2026-08-25 | 5M rooftop prop pass | Claude | `788cf44` | Braziers replace clipped white spheres, string lights and palms brought in from spec radii that assume a terrace 1.62x larger than the pipeline builds |
| 2026-08-25 | 4U showdown order | DeepSeek | `99f8e69` | Accepted. Folded seats filtered first, so the hidden-information proof holds |
| 2026-08-25 | 5J migration drift | Codex | `6636030` | Wrote it up and stopped. **Economy grants are absent from production** |
| 2026-08-25 | 5P publish clean venues | Claude | `1142db9` | Republished all three without the leak. Verified zero punctual lights and the extension undeclared |
| 2026-08-25 | 4R bot personalities | DeepSeek | `6f9bc6a` | Accepted. 14 tests, imports only the BotSkill type, deterministic picks, tilt blending clamped |
| 2026-08-25 | 4U hidden information proof | Claude | `5a86cee`, `3a82e4a` | Nine adversarial cases across every transition, plus a vacuity check. Found and fixed a vacuous case of my own |
| 2026-08-25 | 4V resync coverage | Claude | `68a12a0` | Reconnect proven to send a full view, not an event replay |
| 2026-08-25 | 5G download gate and seated LOD | Codex | `8cd93f7` | Accepted. Hard 6144KB gate, weighted LOD. Rooftop 172,440 to 41,125 tris, 12.4MB to 2.98MB |
| 2026-08-25 | 4Q hand history | DeepSeek | `f9aaddd` | Accepted. 13 tests, chip conservation check, every export line preserved |
| 2026-08-25 | 4T table item purchase | Claude | `0352362` | Bought through the ledger with a deterministic ref, slot rule enforced by a partial unique index, equipped modifiers reach the REP award |
| 2026-08-25 | 5T venue tone mapping | Claude | `3608030` | The first screenshot showed a bleached white room. No tone mapping, so everything above 1.0 clipped. ACES filmic added |
| 2026-08-24 | 5F characters in venues | Codex | `69121a6` | Accepted on craft. Linked mesh instancing, shared 1024 atlas, no material copies, gates untouched. **But the download went 185KB to 12MB and nothing measured it** |
| 2026-08-24 | 4P daily challenges | DeepSeek | `fcdd7e3` | Accepted. 14 tests, deterministic set, no clock or randomness. It hit the progressFor collision itself and resolved it the same way |
| 2026-08-24 | 4S challenge tally and strip | Claude | `57ea9ba` | Server tallies metrics per UTC day at settle; client shows ambient progress |
| 2026-08-24 | 4K REP calculation | Claude | `153fe4b` | **Never landed from DeepSeek.** Logged as in flight and never reconciled while 4M and 4N landed around it. Built to the original brief |
| 2026-08-24 | 4R REP award and feedback | Claude | `153fe4b` | Server credits at settle, protocol carries it, client shows a self-dismissing flash |
| 2026-08-24 | 5L venue lighting | Claude | `16f1777` | Reads the measured rig in the browser. Blender Z-up to three.js Y-up, one shared energy scalar |
| 2026-08-24 | 5V venue selection | Claude | `8736325` | Venue registry, picker, invite URL carries the venue. Also found the web app serving a 206K stale Rooftop against a 535K build - every skyline change had been invisible in the browser |
| 2026-08-24 | 4L chat and emote panel | Claude | `0ecb388` | Feed, nine-emote rail, speaking indicator, message entry. Shortcut keys proven inert while the chat input has focus, and proven still live outside it |
| 2026-08-24 | 4H economy wiring | DeepSeek | `f7235b5` | Accepted. Derives eligibility by parsing ledger refs rather than adding a state table, seated gating present, no hardcoded economy numbers. 15 tests |
| 2026-08-26 | Chatter field wiring | DeepSeek | `35866cc` | Landed. The `chatter` field was set on all thirteen personalities and read only for a timing delay; it now drives speak chance per event class and a per-personality cooldown. **Review still owed** |
| 2026-08-26 | 5W venue occlusion | Codex | `08f5d58` | Landed while Claude was in the client lane, touching only its own file. Baked occlusion moved to `FLOAT_COLOR` with the base tint neutralised into the vertex colour and `baseColorFactor` restored from a `riverVertexColourBase` extra after export. **Needs `publish_assets.py` before it reaches the browser** |
| 2026-08-26 | 4Z voice pack | DeepSeek | dispatched | 480 lines, thirteen personalities, twelve events. Brief at `docs/handoff/packet-4Z-voice-pack.md`. Both consumers were already finished and idle |
| 2026-08-26 | Per-seat animation | Claude | `137f56d` | **Eight of nine characters were frozen.** Nine copies of one rig share bone names, so the loader suffixes duplicates and every unsuffixed track bound to whichever rig imported first. Actions were also keyed by clip name alone, so nine per-seat cues collapsed onto one action and eight were no-ops. Retargeted per seat by bone index; 3 moving bones on one rig became 72 across all nine, 33,291 tracks bound |
| 2026-08-26 | 5X clip amplitude | Codex | opened | A full breathe cycle rotates the head **0.099 degrees**, measured in the browser and matching the 0.05-degree source constant exactly. Three clips key nothing at all: their targets are named `upperarm01.R` and the rig carries `upperarm01R`, so `pose_bones.get()` returns None and `continue` runs silently |
| 2026-08-26 | Palette gate | Claude | `8b6f0fa` | The seventh wired-to-nothing module now has a consumer: the web app grades its own shipped venues. Room split from backdrop at 12m, measured (terrace 4.0m, nearest backdrop 34.1m, mountains 127.2m at 83.9% of triangles). Proven to fire and to pass on two builds of the same code. **Held out of the run** until the republish, because the served files still carry white base colours |
| 2026-08-26 | Rooftop reads flat, measured | Claude | open | Terrace `#30383a` and parapet `#2a2f3a` each exceed 12% area with contrast under 1.4, so floor and wall read as one shape. The two-day "the Rooftop looks flat" complaint, finally stated as a number |
| 2026-08-26 | Chatter line selection | Claude | `17d9be5` | **Review of `35866cc` found a real defect.** The roll deciding whether a bot speaks was also choosing its line, and having passed `shouldSpeak` it is uniform over [0, chance) not [0, 1). A silent character returned its first line 100% of the time across five thousand utterances; every other line was unreachable. Rescaling by the chance that accepted it recovers a uniform selector from the same draw. Three tests, checked against the unfixed code first |
| 2026-08-26 | Deploy workflow | Claude | `1f164c1` | Railway is repeatable from the repository now. Deliberately not push-to-deploy: three lanes commit to main hourly and a lane is regularly mid-packet, so it is the Actions button or a `v*` tag, gated on lint, typecheck, the full suite and a production build. CLI invocation checked against Railway's docs rather than guessed. **Needs `RAILWAY_TOKEN` set on the repository** |
| 2026-08-26 | 5Y rooftop contrast | Codex | queued | The palette gate's one remaining failure, and the only thing holding it out of the suite. Floor `#30383a` at luminance 0.0376 against parapet `#2a2f3a` at 0.0283 is a contrast ratio of **1.119** against a 1.4 threshold. Queued behind 5X |
| 2026-08-27 | Camera to the reference | Claude | `4c85c1d` | 3.2m out and 1.5m up against 6.1m and 4.05m. The terrace is 4.0m across, so the old camera stood **outside the parapet looking in**, and from 4.05m you saw into the open tops of the seat cylinders |
| 2026-08-27 | Camera target | Claude | `1e9d47c` | `TABLE_SURFACE_HEIGHT` was 0.55 and nothing in the asset has ever been at 0.55. The felt is at 0.76. It is also the orbit pivot, so the room had been rotating about a point in the air beneath the table |
| 2026-08-27 | HUD off the felt | Claude | `2d1c9a1` | The radial menu drew a 420px disc with no action to take. HUD coverage now 3.7% of the stage with **zero persistent elements intersecting the felt** |
| 2026-08-27 | Seat occupancy | Claude | `a17d8e3` | The venue bakes nine characters in as geometry, so every seat showed a person whatever the room said. Lint caught the wiring half-done - the prop was accepted and never passed on |
| 2026-08-27 | Hold-to-read plates | Claude | `a811d9b` | Nine permanent nameplates replaced with hold-to-show. Also fixed a real leak: a key held when the window loses focus never sends its keyup, so alt-tab left **the card peek up, showing your hand to the room** |
| 2026-08-27 | Repository hygiene | Claude | `f83dc8a`, `86a9a97` | 53 mentions of the reference game cleaned from 14 files, reference material untracked, and `hygiene.test.ts` added to gate it. The gate caught two 'clone' phrasings a name search had missed |
| 2026-08-27 | Secret gate | Claude | working tree | The live Supabase project ref was tracked in an ops note. Gate extended to secrets - and its first pattern, a bare twenty-letter run, matched 'internationalisation'. Rewritten to match context |
| 2026-08-27 | Three retractions | Claude | — | **The chairs were never oversized, the table was never too low, and the lighting ratio was never 88x.** All three were judged from renders and asserted as measurement; Codex caught two by checking the asset and declining the packet |

## The shared-index incident, 2026-08-24

Three agents committing into one working copy collided twice in one hour.

1. Codex's 4J files were staged when Claude committed the Rooftop skyline, so
   one commit carried two packets under an art-only message.
2. While Claude was splitting that commit, DeepSeek committed the entire shared
   index - Claude's art, Codex's 4J, Claude's lane log and its own 4H - as a
   single commit titled "Wire economy grants into the server".

Nothing was lost. History was rebuilt into four honest commits by reconstructing
each packet from committed blobs rather than from the working tree, which was the
only safe route while DeepSeek was still writing to it. The rebuilt tree was
proved byte-identical to the contaminated one before anything was discarded.

**Rules from this:**

- Run `git diff --cached --name-only` before every commit while more than one
  model is live. **The git index is shared state between agents.**
- Never stage with `git add -A` or `git add .` in a multi-agent repo.
- When reconstructing history while another agent is writing, stage from commit
  blobs (`git restore --source=<commit> --staged`), never from the working tree.
- Prove a rebuild with `git diff <old> <new>` before trusting it.

## Resolved: the progressFor collision

`challenges.ts` and `rep-progression.ts` both exported `progressFor`, which made
`export *` ambiguous and failed the engine build with TS2308. DeepSeek hit it
independently and re-exported the challenge one as `challengeProgressFor`, which
is the same resolution Claude had applied by hand. Closed.

## Contention note

`packages/engine/src/index.ts` is the one file more than one lane edits. DeepSeek
rewrote it for its challenges export and removed Claude's `export * from
'./rep.js'` line in the process, which broke the server build with
"computeRep is not a function". Check that file after any packet that touches it.

## Closed — the venue rendered empty because of a leaked light

Codex found it in 5H: every published GLB carried a gltf point light named
`Light` at **intensity 54,351**, leaked from an older character import. The
table, chairs and characters were rendering correctly with correct depth the
whole time; they were simply blown far past white, which reads as missing
geometry.

Geometry, instancing, normals, terrace topology and the seated LOD were all
innocent. The measured light rigs were innocent. My camera values were
innocent, and I was right not to tune them.

The export now excludes punctual lights and the build fails if
`KHR_lights_punctual` appears in an asset, so the sidecar stays the only
lighting authority. Verified clean across all three venues.

## Superseded investigation

The Rooftop geometry is verified correct and correctly placed:

```
river_rooftop_table_felt  x[-1.24..1.24] y[-0.72..0.72] z=0.76
river_rooftop_table_base  z[0.00..0.76]
rooftop_chair_0           y[0.90..1.38] z[0.00..0.96]
char_male.001             y[0.75..1.52] z[0.45..1.28]   seated, correct
rooftop_terrace           x[-4.00..4.00] flat at z=-0.02
```

All hide_render False, all in scene. Materials in the published GLB are right:
felt `[0.039, 0.071, 0.118]`, floor `[0.851, 0.831, 0.776]`.

Yet three Blender renders from three camera positions all show a bare cream
disc with no table, chairs or characters - including one where the table is
mathematically dead centre of frame at 3.74m filling 60 percent of the width.
Zain's browser screenshot shows the same bare disc.

**Two possibilities and I have not separated them:** the render harness is
lying (a fourth instrument failure), or something occludes the scene in both
Blender and three.js. Do not act on the camera values until this is settled -
tuning framing against a render that may not reflect the scene is guessing
twice.

## Open — production economy is not deployed

`private.economy_config` holds only `signup_bankroll`. Missing `rescue_floor`,
`rescue_threshold`, `rescue_daily_cap`, `daily_base`. The streak bonus table and
both 4H views do not exist. **Daily grants and bust rescues fail for every
player.** Codex documented it in `migration-state.md` and correctly refused to
push at a live database; 5K is the reviewed fix.

## Open — the venue is built at 62 percent of its designed scale

The terrace is 4.0m where the spec's decor radii assume 6.48m. Every prop
radius in `14-venue-build-spec.md` is therefore wrong for the pipeline, and
following the spec put lights and palms outside the venue. Props are now placed
against the terrace that exists. Either scale the venue up or amend the spec -
having two sources of truth for radii is how this happened.

## Open

- **Venue download is 12MB per room, 37MB for three.** 5F added 162,738 character
  triangles per venue. Triangles, materials and draw calls were all gated; file
  size was not, so the number a player actually waits for grew unnoticed. The
  build now prints it. A budget and a seated LOD are the next art packet.

## Open

- **The lighting calibration is unverified by eye.** `ENERGY_TO_INTENSITY` in
  `apps/web/src/lib/lighting.ts` is a first guess. The conversion maths is
  tested and the rig reaches the browser, but nobody has looked at the result.
  Tune that one number, never the individual light energies.
- **A visual pass still needs a compositing browser pane.** Two attempts failed
  because the MCP tabs report `visibilityState: hidden` with rAF at zero
  callbacks, regardless of which tab is fronted.

## The recurring defect this session

**Four engine modules were complete and wired to nothing**: REP had no producer,
challenges had no tally, table items had no consumer, and the measured light
rigs shipped to a browser that ignored them. A fifth case was the venue assets
in the web app sitting months behind the pipeline.

Every one looked finished from the commit log and passed its own gates. The seam
between packets is where work quietly dies when several lanes run in parallel.

**Ask "does anything actually call this?" as the first review question, not the
last.**

## A test can be green and prove nothing

The kick case in the leak suite submitted `playerId` where the command wants
`byPlayerId`. The command was rejected, so the case asserted nothing about
kicks - and it passed. **Vitest transpiles without typechecking**, so a
malformed command in a test is invisible to the test run; only
`npm run typecheck` caught it.

Two habits from this: run typecheck before trusting a new suite, and make
adversarial tests assert that the thing they are testing actually happened
before asserting the property holds.

## Typecheck caught me too

The shop test file passed the whole suite with a type error in it. Vitest
transpiles without typechecking, so a malformed object asserts nothing and still
goes green; only `npm run typecheck` found it. This is the same trap flagged to
DeepSeek two packets earlier, and it caught the person who wrote the warning.

Run typecheck before trusting any new suite, including your own.

## Standing review notes

- **A gate that never fires is worse than no gate.** `clear_radius_violations`
  read `bound_box` before the depsgraph updated, so it measured stale data and
  passed everything. It only ever fired in a hand-written test that called
  `view_layer.update()`. Test a gate against a known-bad input **in the real
  build path**, not in a bespoke script.
- **Bounding boxes lie about rings.** An axis-aligned box around a ring has its
  corners at R*sqrt(2), so a 4.1m parapet measures 5.8m and a 45m skyline
  measures 64m. Measure per vertex when the mesh is merged or annular.
- **Build output is not source.** A generated file that lands in a linted
  directory fails the shared gate for every lane, and any fix is clobbered on
  the next build. Exclude it instead.
- **Instrument before observation.** Four false defects this project came from a
  faulty instrument, not faulty code: a hot-reloading tree, an incomplete scene
  reset before a GLB import, a `--factory-startup` launch that hid every add-on,
  and a hidden browser tab that starves rAF and ResizeObserver. Prove the
  instrument can see the thing before believing what it reports.
- **Parse the artefact, do not import it.** Importing a GLB into a dirty scene
  produced a convincing phantom mesh.
- Codex briefs stay lean and point at the design docs. DeepSeek briefs carry full
  detail. Usage is metered differently.
