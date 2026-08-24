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
| 2026-08-24 | 4K REP calculation | Claude | `cb69582` | **Never landed from DeepSeek.** Logged as in flight and never reconciled while 4M and 4N landed around it. Built to the original brief |
| 2026-08-24 | 4R REP award and feedback | Claude | `cb69582` | Server credits at settle, protocol carries it, client shows a self-dismissing flash |
| 2026-08-24 | 5L venue lighting | Claude | `a133b21` | Reads the measured rig in the browser. Blender Z-up to three.js Y-up, one shared energy scalar |
| 2026-08-24 | 5V venue selection | Claude | `f18cd71` | Venue registry, picker, invite URL carries the venue. Also found the web app serving a 206K stale Rooftop against a 535K build - every skyline change had been invisible in the browser |
| 2026-08-24 | 4L chat and emote panel | Claude | `89a27e8` | Feed, nine-emote rail, speaking indicator, message entry. Shortcut keys proven inert while the chat input has focus, and proven still live outside it |
| 2026-08-24 | 4H economy wiring | DeepSeek | `f885911` | Accepted. Derives eligibility by parsing ledger refs rather than adding a state table, seated gating present, no hardcoded economy numbers. 15 tests |

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

## For DeepSeek to fix in 4P

`challenges.ts` exports `progressFor`, and `rep-progression.ts` already exported
one with a completely different signature. `export * from` both is ambiguous and
**fails the engine build outright** with TS2308 - it took the whole repo down
until the barrel was disambiguated by hand.

Rename the challenges one to `challengeProgressFor` in `challenges.ts` itself,
then `index.ts` can go back to a plain `export *`.

## Contention note

`packages/engine/src/index.ts` is the one file more than one lane edits. DeepSeek
rewrote it for its challenges export and removed Claude's `export * from
'./rep.js'` line in the process, which broke the server build with
"computeRep is not a function". Check that file after any packet that touches it.

## Open

- **The lighting calibration is unverified by eye.** `ENERGY_TO_INTENSITY` in
  `apps/web/src/lib/lighting.ts` is a first guess. The conversion maths is
  tested and the rig reaches the browser, but nobody has looked at the result.
  Tune that one number, never the individual light energies.
- **A visual pass still needs a compositing browser pane.** Two attempts failed
  because the MCP tabs report `visibilityState: hidden` with rAF at zero
  callbacks, regardless of which tab is fronted.

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
