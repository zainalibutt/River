# Lane log

Running record of what all three models have shipped. **Append, never rewrite.**
Claude maintains this. It exists so that a compaction on any side does not cost us
a re-derivation of who did what.

Format: one row per completed packet, newest last.

| Date | Packet | Owner | Commit | Result |
|---|---|---|---|---|
| 2026-08-23 | 1A-2D foundation | mixed | various | Engine, 2D renderer, session orchestrator |
| 2026-08-24 | 3A room protocol | DeepSeek | `a727d13` | Codex reviewed and hardened, four contract gaps fixed |
| 2026-08-24 | 3B transport | Codex | `78c95da` | Production live. JWKS auth, ledger, WebSocket, reconnect, idempotency index |
| 2026-08-24 | 5B-P pipeline | DeepSeek | `f22acd3` | Three-venue kit, budget checker with 15 negative cases |
| 2026-08-24 | 5B-C/A/X characters | DeepSeek, repaired by Claude | `1df7bce` | Seven defects fixed. Garment was unweighted and would not deform |
| 2026-08-24 | 5B-V lighting | Claude | `16e2a40`, `0a687ca` | Pipeline had no lights at all. Measured rigs ported, gradient sky, one caster per venue |
| 2026-08-24 | 5B-R renderer | Codex | `529b73d` | Accepted. The P0 was a measurement artefact, not a defect |
| 2026-08-24 | 4E economy engine | DeepSeek | `74c0bd1` | Pure module. Rescue tops up rather than adding flat, streak resets correctly |
| 2026-08-24 | 4F fairness | Codex | `d1fc23f` | Security defect closed. Per-hand seeds, rejection-sampled shuffle, million-shuffle bias test |
| 2026-08-24 | 4V verify panel | Claude | `ca259f3` | Client-side WebCrypto recomputation. Also fixed repo-wide CRLF via .gitattributes |
| 2026-08-24 | 4G turn timers | Codex | `55c8136` | Accepted. Budgets 15/20/20/25 from config, timeout is check-else-fold, late client actions coerced |
| 2026-08-24 | 4R preset actions | Claude | `744dc68` | Local half. Arm/commit/invalidate, clears on street change |
| 2026-08-24 | 4J chat and emote transport | Codex | `25ba2e0` | Accepted. Emotes blocked during your own decision window, social never enters room state, shared rate limit |
| 2026-08-24 | 5C rooftop skyline | Claude | `5c24ab0` | Skyline, mountains, palms. Repaired the camera gate, which was silently passing everything, then used it to find three mis-placed venue elements |

## In flight

| Packet | Owner | Dispatched | Notes |
|---|---|---|---|
| 5E chip and card instancing | Codex | 2026-08-24 | art/pipeline only. Chips are individual objects; 51 in the pot alone |
| 4K REP module | DeepSeek | 2026-08-24 | First packet under `deepseek-laws.md`; it confirmed the laws and quoted law 1 correctly |
| 4M table item catalogue | DeepSeek | 2026-08-24 | Queued behind 4K. Chip sink, never affects poker odds |
| 4H economy wiring | DeepSeek | 2026-08-24 | **Stalled mid-work.** `economy-service.ts` and a migration sit uncommitted and fail typecheck at line 204 plus formatting. Watch for it adding a state table instead of deriving from ledger refs |

| 2026-08-24 | 5D Basement and Suite detail | Codex | `2ac01ec` | Accepted. Basement 1,368 to 3,218 tris, Suite 2,614 to 16,904. Gate verified untouched and still firing |
| 2026-08-24 | 5E chip instancing | Codex | `5b8008c` | Accepted. GPU instancing with stable per-instance ids. Draw calls 50/42/47 to 34/26/31 |
| 2026-08-24 | 4M table items | DeepSeek | `f0ce29f` | Accepted. Zero imports, so it cannot touch poker odds by construction |
| 2026-08-24 | 4N REP progression | DeepSeek | `1bfea54` | Accepted. 14 tests, pure, no clock |
| 2026-08-25 | 4S seat presentation | DeepSeek | `5e05e38` | Accepted. 2,048 exhaustive combinations, total function. It ran typecheck first and caught a malformed object in its own draft |
| 2026-08-25 | Migration applied | Codex | n/a | `player_table_items` live on River Production. RLS on, unique equipped-slot index, owner-only SELECT, public INSERT denied |
| 2026-08-25 | 4W table item store and wire | Claude | `647bae3` | Supabase-backed store plus buy and equip client messages. The purchase path had been written against an interface with no implementation |
| 2026-08-25 | 5H leaked venue light | Codex | `ae41583` | **Solved the empty venue.** A stray gltf point light at intensity 54,351, leaked from an older character import, washed every room out. Export now excludes punctual lights and the build fails if one appears |
| 2026-08-25 | 4X lobby model | DeepSeek | `ebb886e` | Accepted. 21 tests, stable sort, no mutation, bestTableFor never returns a table the bankroll cannot cover |
| 2026-08-25 | 4Y inventory wire and shop | Claude | `d9a3b58`, `f5342a0` | Snapshot carries inventory, socket can buy and equip, shop panel built. Ownership outranks price so an owned item never reads as unaffordable |
| 2026-08-25 | 5L the lid | Claude | `19683bb` | `cylinder()` always capped its top, so the parapet sealed a solid 3.9m disc over every venue. This, not the leaked light, is why the rooms looked empty |
| 2026-08-25 | 5M rooftop prop pass | Claude | `13318ce` | Braziers replace clipped white spheres, string lights and palms brought in from spec radii that assume a terrace 1.62x larger than the pipeline builds |
| 2026-08-25 | 4U showdown order | DeepSeek | `d4eb60f` | Accepted. Folded seats filtered first, so the hidden-information proof holds |
| 2026-08-25 | 5J migration drift | Codex | `1c124cb` | Wrote it up and stopped. **Economy grants are absent from production** |
| 2026-08-25 | 5P publish clean venues | Claude | `28b9acd` | Republished all three without the leak. Verified zero punctual lights and the extension undeclared |
| 2026-08-25 | 4R bot personalities | DeepSeek | `0c07236` | Accepted. 14 tests, imports only the BotSkill type, deterministic picks, tilt blending clamped |
| 2026-08-25 | 4U hidden information proof | Claude | `8128ce9`, `fb9962a` | Nine adversarial cases across every transition, plus a vacuity check. Found and fixed a vacuous case of my own |
| 2026-08-25 | 4V resync coverage | Claude | `99a41e3` | Reconnect proven to send a full view, not an event replay |
| 2026-08-25 | 5G download gate and seated LOD | Codex | `832cc78` | Accepted. Hard 6144KB gate, weighted LOD. Rooftop 172,440 to 41,125 tris, 12.4MB to 2.98MB |
| 2026-08-25 | 4Q hand history | DeepSeek | `fbe0d81` | Accepted. 13 tests, chip conservation check, every export line preserved |
| 2026-08-25 | 4T table item purchase | Claude | `0c15bf7` | Bought through the ledger with a deterministic ref, slot rule enforced by a partial unique index, equipped modifiers reach the REP award |
| 2026-08-25 | 5T venue tone mapping | Claude | `264e08b` | The first screenshot showed a bleached white room. No tone mapping, so everything above 1.0 clipped. ACES filmic added |
| 2026-08-24 | 5F characters in venues | Codex | `9a7d5f6` | Accepted on craft. Linked mesh instancing, shared 1024 atlas, no material copies, gates untouched. **But the download went 185KB to 12MB and nothing measured it** |
| 2026-08-24 | 4P daily challenges | DeepSeek | `8b8e78f` | Accepted. 14 tests, deterministic set, no clock or randomness. It hit the progressFor collision itself and resolved it the same way |
| 2026-08-24 | 4S challenge tally and strip | Claude | `d3f5f3a` | Server tallies metrics per UTC day at settle; client shows ambient progress |
| 2026-08-24 | 4K REP calculation | Claude | `cb69582` | **Never landed from DeepSeek.** Logged as in flight and never reconciled while 4M and 4N landed around it. Built to the original brief |
| 2026-08-24 | 4R REP award and feedback | Claude | `cb69582` | Server credits at settle, protocol carries it, client shows a self-dismissing flash |
| 2026-08-24 | 5L venue lighting | Claude | `a133b21` | Reads the measured rig in the browser. Blender Z-up to three.js Y-up, one shared energy scalar |
| 2026-08-24 | 5V venue selection | Claude | `f18cd71` | Venue registry, picker, invite URL carries the venue. Also found the web app serving a 206K stale Rooftop against a 535K build - every skyline change had been invisible in the browser |
| 2026-08-24 | 4L chat and emote panel | Claude | `89a27e8` | Feed, nine-emote rail, speaking indicator, message entry. Shortcut keys proven inert while the chat input has focus, and proven still live outside it |
| 2026-08-24 | 4H economy wiring | DeepSeek | `f885911` | Accepted. Derives eligibility by parsing ledger refs rather than adding a state table, seated gating present, no hardcoded economy numbers. 15 tests |
| 2026-08-26 | Chatter field wiring | DeepSeek | `177c7cb` | Landed. The `chatter` field was set on all thirteen personalities and read only for a timing delay; it now drives speak chance per event class and a per-personality cooldown. **Review still owed** |
| 2026-08-26 | 5W venue occlusion | Codex | `877c841` | Landed while Claude was in the client lane, touching only its own file. Baked occlusion moved to `FLOAT_COLOR` with the base tint neutralised into the vertex colour and `baseColorFactor` restored from a `riverVertexColourBase` extra after export. **Needs `publish_assets.py` before it reaches the browser** |
| 2026-08-26 | 4Z voice pack | DeepSeek | dispatched | 480 lines, thirteen personalities, twelve events. Brief at `docs/handoff/packet-4Z-voice-pack.md`. Both consumers were already finished and idle |
| 2026-08-26 | Per-seat animation | Claude | `df85bc0` | **Eight of nine characters were frozen.** Nine copies of one rig share bone names, so the loader suffixes duplicates and every unsuffixed track bound to whichever rig imported first. Actions were also keyed by clip name alone, so nine per-seat cues collapsed onto one action and eight were no-ops. Retargeted per seat by bone index; 3 moving bones on one rig became 72 across all nine, 33,291 tracks bound |
| 2026-08-26 | 5X clip amplitude | Codex | opened | A full breathe cycle rotates the head **0.099 degrees**, measured in the browser and matching the 0.05-degree source constant exactly. Three clips key nothing at all: their targets are named `upperarm01.R` and the rig carries `upperarm01R`, so `pose_bones.get()` returns None and `continue` runs silently |

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
