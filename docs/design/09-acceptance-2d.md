# 09 — Packet 2D acceptance and polish

## Review basis

Claude was routed Packet 2D three times, including after a desktop-app restart. Its transport stalled at `Sending…`; the only completed attempt ran read-only commands and was cancelled without producing an artifact. To preserve the 21:50 UK orchestration window, Codex performed this fallback acceptance pass. It is not represented as an independent Claude approval.

Evidence used: the approved files in this directory, code review of `apps/web`, 84 green tests, clean typecheck/lint/production build, and complete 1280x720 browser hands through action, showdown, outcome, and automatic next hand with no console warnings or errors. The 1920x1080 composition is the same authored canvas at scale 1; its geometry is not a separate layout.

## P0 — blockers

None found. Legal actions are engine-derived, opponent cards remain hidden until allowed, the minimum viewport is enforced, and complete hands settle correctly.

## P1 — required corrections

### Accepted: maximum raise now preserves all-in confirmation

- Evidence: the dedicated all-in control used a 600ms hold, but the ordinary raise button dispatched `allIn` immediately when the slider reached maximum.
- Why it matters: the same irreversible action had two safety contracts depending on how it was reached.
- Correction: the raise control becomes the same hold primitive at maximum and remains immediate for ordinary raises.
- Acceptance: a click on `ALL IN` after choosing `MAX` does nothing; holding it for 600ms acts.

### Accepted: exiting TV mode now requires a hold

- Evidence: the TV button toggled fullscreen with one click in both directions, while `06-interaction.md` requires a 1000ms hold to exit.
- Why it matters: an accidental couch input should not drop presentation mode mid-hand.
- Correction: fullscreen state is synchronized from `fullscreenchange`; entry is immediate and exit uses the visible hold treatment for 1000ms.
- Acceptance: entering fullscreen takes one activation; leaving it requires a continuous one-second hold.

### Accepted: keyboard/focus semantics cover the contract's primary path

- Evidence: Check/Call, contextual Fold, and Escape worked, but Raise focus, presets, Verify, arrow traversal, and held All-in shortcuts were absent. Dialogs also opened without deliberately moving focus.
- Why it matters: the permanent 2D mode is TV/controller-first and must not depend on a pointer.
- Correction: add `R`, `1`–`4`, `V`, left/right focus traversal, held `A`, topmost Escape behavior, and focus the dialog close control on open.
- Acceptance: the complete primary action path and both dialogs are operable without a pointer; shortcut keys remain inert while the range input has focus except for its native arrow behavior.

## P2 — optional polish, not a Phase 2 blocker

- Pot-award motion is intentionally restrained. A later visual pass may add grouped chip travel from the step payload, but must not infer the amount from the already-zero final pot.
- Real DualSense browser behavior remains the Phase 5A hardware gate. This packet provides equivalent focus and hold semantics; it does not claim PS5 validation.
- The two-colour deck setting is retained for familiarity, while Zain's four-colour decision remains the default.

## Passing categories

- Visual thesis, colour, editorial display face, amount hierarchy, couch-distance contrast, and 1280x720 fit.
- Engine projection and hidden-information boundary.
- Loading, route-error, viewport refusal, reduced-motion, invalid-action copy, and between-hand recovery paths.
- Considered bot pacing and automatic all-in run-out.
- Stable table/action geometry with no observed layout shift during a complete hand.

## Exit

The listed P1 corrections must pass repository gates and one final browser smoke test. Claude visual sign-off remains desirable when its transport recovers, but no unresolved product or poker decision blocks the implementation.

