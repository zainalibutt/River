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

## In flight

| Packet | Owner | Dispatched | Notes |
|---|---|---|---|
| 4H economy wiring | DeepSeek | 2026-08-24 | **Stalled mid-work.** `economy-service.ts` and a migration sit uncommitted and fail typecheck at line 204 plus formatting. Watch for it adding a state table instead of deriving from ledger refs |
| 4J chat and emote transport | Codex | 2026-08-24 | Re-dispatched after 4G. Closes the last Phase 4 item |

## Standing review notes

- **Instrument before observation.** Four false defects this project came from a
  faulty instrument, not faulty code: a hot-reloading tree, an incomplete scene
  reset before a GLB import, a `--factory-startup` launch that hid every add-on,
  and a hidden browser tab that starves rAF and ResizeObserver. Prove the
  instrument can see the thing before believing what it reports.
- **Parse the artefact, do not import it.** Importing a GLB into a dirty scene
  produced a convincing phantom mesh.
- Codex briefs stay lean and point at the design docs. DeepSeek briefs carry full
  detail. Usage is metered differently.
