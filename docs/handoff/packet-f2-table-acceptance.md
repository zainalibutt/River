# F2 — joined-up 3D table acceptance

**Status:** `ACTIVE`, Codex

**Accepted dependency:** F1 / packet 7I. Rooftop is the only venue and the gold
reference. Laundromat, Executive Suite, hair refinement, small garment defects
and bespoke prop breadth remain deferred.

## Scope

Play the current Rooftop table as a real player in Chrome. Close only defects
reproduced in the joined-up path: entry and seating, seat-relative camera,
complete hand controls and presentation, rebuy/recovery/streak feedback,
reconnect and error states, keyboard/controller/reduced-motion, TV readability
and 2D parity. Do not rebuild already-working subsystems from historical packet
descriptions.

## Evidence so far

- The live Rooftop loads through the existing development server in Chrome.
- A 51,750 bankroll now offers and accepts a 51,750 legal buy-in rather than
  hardcoding the unaffordable 100,000 default.
- The opening camera now derives its azimuth from the local player's seat; the
  implementation and all eight seat directions are covered by a focused test.
- Browser WebSocket parsing now forwards every declared server-message kind.
  Daily and rescue claims can be sent, and grant outcomes update the visible
  balance and a transient notice.
- Connected notices clear after 2.6 seconds instead of permanently covering
  later table status.
- Automatic next hands now schedule the same bounded client-seed finalization
  as manually started hands. Chrome reproduced the old second-hand stall at
  `Securing the deck`; its cause was the automatic-deal path broadcasting the
  commitment without scheduling the fallback that defaults missing bot seeds.
- Remote seat plaques now collapse to their small world-space pin while names
  are not deliberately held, removing the large blank rectangles that covered
  the skyline. The local plaque uses the same compact readable width rather
  than a 420px panel.
- Chrome verifies the table-read control as a true Tab toggle during the whole
  live hand, including after the local player has folded or is waiting. The
  first press reveals every angular name/stack plate and the second clears the
  table again instead of advancing browser focus through the menu.
- The pot is now a high-contrast numeric anchor above the felt. The betting HUD
  is an angular four-action instrument rather than a stack of rounded panels;
  its raise value, range controls, presets and lower actions all fit the live
  Chrome viewport without clipping.
- Each occupied seat retains its latest CHECK, CALL, RAISE, ALL IN or FOLD for
  the current street. Chrome exposed the explicit action labels through a live
  preflop sequence, then confirmed that they reset on the flop. Collapsed
  dealer and turn ornaments no longer leave the clipped circular fragments
  previously visible against the skyline.
- Chrome accepted a 100,000 buy-in from a non-default seat, rotated the camera
  behind that seat, completed and recorded a hand, exposed its board, result,
  commit, revealed seed and 14-step street replay, then automatically dealt a
  second hand after the bounded seeding interval.
- Zain's sole server-authorized developer account received one idempotent,
  auditable 10,000,000-chip `admin_grant`; its verified balance is 10,010,000.
- Focused economy, service, transport, socket, buy-in and venue coverage passes
  108 tests. The strengthened 43-test transport file passes after the automatic
  seeding fix; engine, server and web TypeScript checks and `git diff --check`
  exit 0.
- Focused evidence: 34 tests pass across socket, buy-in and venue helpers; the
  web TypeScript check exits 0; Chrome granted the daily 10,000 and left the
  recovery state visible when the bankroll remained below the table minimum.

## Economy decision — resolved

Zain accepted the 50,000 rescue floor. Live Supabase already holds the later
no-lockout migration values: signup bankroll 150,000, rescue floor 50,000,
rescue threshold 1,000 and daily cap 3. The stale 25,000 references in the spec,
Phase 4 contract and canonical test fixtures were reconciled on 2026-08-30.

The daily-first edge remains truthful rather than broken: a player who claims
10,000 is no longer technically broke and cannot rescue while that balance
remains above the 1,000 threshold. A zero-balance player can rescue directly to
one legal minimum seat. This ordering needs explicit UI copy during the
recovery proof.

## Remaining exit evidence

1. Prove zero-balance recovery to a legal seat in Chrome.
2. Exercise rebuy after a genuine table bust; the normal multi-hand path is
   proven.
3. Exercise one reconnect/error recovery and the bounded input/readability
   checks named in F2.
4. Close the remaining composition findings: the local avatar still occupies
   substantial foreground area, and the full HUD still needs its dedicated
   TV/reduced-motion/controller readability inspection.

No F3 work starts until this packet is accepted or its remaining findings are
explicitly deferred.
