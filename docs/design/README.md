# River — design contract

Implementation-ready visual and interaction contract for River's permanent 2D DOM renderer (the graphics-saver mode), and the rules that keep it coherent with the later 3D venue renderer.

This directory is the design equivalent of `docs/spec.md`: it is canonical. Where an implementation detail and this contract disagree, fix the disagreement rather than silently choosing one. Where this contract and `docs/spec.md` disagree, the spec wins on product behaviour and this contract is corrected.

## Status

| Field | Value |
|---|---|
| Packet | 2B |
| Author | Claude (Opus tier) |
| Reviewers | Zain and Codex |
| Engine baseline | `9717339` — 81 tests, typecheck and lint green |
| Implements against | `SoloTableView`, `SessionStep`, `LegalActions`, `ViewSeat` from `packages/engine/src/session.ts` |
| Fixtures covered | all five exported from `packages/engine/src/scenarios.ts` |
| Consumer | Packet 2C (Codex) |

## Documents

| File | Contents |
|---|---|
| [`01-thesis.md`](01-thesis.md) | What River inherits from the reference and Blackjackist, what it refuses, and the one idea the whole look hangs on |
| [`02-tokens.md`](02-tokens.md) | Colour, typography, spacing, radii, borders, elevation, materials, focus. Concrete values, ready to become CSS custom properties |
| [`03-layout.md`](03-layout.md) | 1920x1080 base canvas, TV safe area, uniform scaling rule, minimum viewport, exact seat coordinates for 9-max, 6-max and heads-up |
| [`04-anatomy.md`](04-anatomy.md) | Seat, cards, pot, dealer button, action rail, bet sizing, timer housing, status line, menu. Dimensions in base-canvas pixels |
| [`05-states.md`](05-states.md) | Every renderable state derived from the real view contract and the five fixtures, as state tables with acceptance criteria |
| [`06-interaction.md`](06-interaction.md) | Focus order, DualSense and keyboard maps, hold-to-confirm, destructive action rules |
| [`07-motion.md`](07-motion.md) | Motion grammar with durations and easings, step-log playback pacing, reduced-motion equivalents |
| [`08-handoff-2c.md`](08-handoff-2c.md) | Binding constraints for Codex in 2C, plus the nine contract gaps found during fixture validation and how to handle each |

## How to use this in 2C

1. Tokens in `02-tokens.md` become one CSS custom property file. No component carries a raw hex value.
2. Layout in `03-layout.md` is authored once at 1920x1080 and scaled uniformly. Do not write per-breakpoint table layouts.
3. Every state in `05-states.md` must have a rendered result before 2C exits. The state tables are the acceptance checklist.
4. Motion values in `07-motion.md` are defaults, and belong in configuration, not in component bodies.
5. Constraints in `08-handoff-2c.md` are binding. Where 2C needs to depart from them, document the implementation constraint and route the decision back rather than reinterpreting the contract.

## Approved taste decisions

Zain approved four-colour cards, hybrid money formatting, considered bot pacing, and a warm editorial serif. The traditional two-colour deck remains an accessibility/preference setting. The supported laptop floor is 1280x720, and automatic all-in run-outs landed in `9717339`.
