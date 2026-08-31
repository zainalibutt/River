# 15 — Acceptance review, Packet 5B-R

R3F venue renderer, committed at `e2eb936`. Reviewed by Claude 2026-08-24 against `docs/design/06-interaction.md`, `10-art-direction.md` and `14-venue-build-spec.md`.

Codex shipped this without a visual pass — its browser tooling was unavailable and it said so honestly. This is that pass, run against a live dev server at 1280x720.

**Verdict: RESOLVED 2026-08-24. The P0 was a false finding. Re-reviewed against a clean, quiescent server and the root cause is now known — see the resolution below.**

---

## RESOLUTION 2026-08-24 — the canvas is fine; the instrument was hidden

Re-ran the pass on a dedicated dev server on port 55900, with nothing else
writing to the tree. The canvas still measured 200x100 with a 300x150
drawing buffer, stable across repeated reads, fully hydrated, six seconds
after mount. It looked exactly like a confirmed defect for the second time.

It is not. The browser tab was backgrounded:

```
document.hidden        true
visibilityState        hidden
requestAnimationFrame  0 callbacks in 2 seconds
ResizeObserver         0 callbacks on a real 10px -> 50px size change
```

R3F sizes its canvas from a ResizeObserver on the wrapper div. In a hidden
tab the rendering lifecycle is suspended, so the observer never delivers and
rAF never runs. **The canvas cannot size itself under observation conditions
that suspend the very callback that sizes it.** A manually dispatched resize
event recovered the buffer to 1280x720 immediately, which confirms the
observer path is correct and simply starved.

The container chain was correct throughout: `.river-venue` 1280x720 at
z-index 0, `.hud-layer` 1280x720 at z-index 1, wrapper div sized, WebGL
context alive and not lost.

A `resize={{ scroll: false, debounce: 0, offsetSize: true }}` prop was
trialled on `<Canvas>` and changed nothing, because it could not — then
reverted. **No code change was warranted and none was kept.**

### The rule this establishes

Before trusting a visual measurement, prove the instrument can observe the
thing being measured. For anything driven by ResizeObserver, rAF or IntersectionObserver,
assert `document.visibilityState === 'visible'` and that rAF actually ticks,
as the first step of the pass rather than the last. This is the fourth
instrument-induced false defect in this project; the previous three were a
hot-reloading tree, an incomplete scene reset before a GLB import, and a
`--factory-startup` launch that hid every add-on.

**A visual pass of this app requires the browser pane to be displayed.**
That is a hard precondition, not a preference.

---

## Superseded correction 2026-08-24 — the P0 below is unsafe and probably wrong

The measurements in this document were taken against a dev server **while Codex was actively editing the same components**. Next.js hot-reloaded underneath the measurements. Three consecutive reads of the same page returned three different DOM states: a 200x100 canvas, then no canvas and no `.river-venue` at all, then a lost page.

Zain then supplied a screenshot of the running app in his own browser showing **the canvas filling the viewport and rendering the table asset correctly**. That is the authoritative observation and it contradicts the finding below.

**The P0 is withdrawn.** It is retained here rather than deleted because the failure is worth recording: reviewing a running application while another agent is writing to it produces measurements of a moving target, and those measurements can look exactly like a defect. A visual pass needs a quiescent tree.

Re-review when `apps/web` is not being written to. The genuine findings from this session are in the "Passing" and "P2" sections, which were read from stable DOM structure rather than layout geometry.

---

## P0 (WITHDRAWN) — the WebGL canvas is 200x100 in the top-left corner

### Evidence

Measured live in the running app:

```
canvas          rect [200, 100]   attrs width=null height=null
                inline style      "display: block;"
canvas parent   rect [1280, 720]  inline "width: 100%; height: 100%;"
.river-venue    rect [1280, 720]  declared 1920x1080, z-index 0
.hud-layer      rect [1280, 720]  declared 1920x1080, z-index 1
viewport        1280 x 720
```

The canvas carries **no width or height** — neither attributes nor CSS — so it falls back to the HTML default of 300x150 intrinsic, presenting as a 200x100 CSS box at (0, 0).

Its container chain is correct. The wrapper div is 1280x720, `.river-venue` is `position: absolute; inset: 0` at z-index 0, and `.hud-layer` sits above it at z-index 1. **The architecture is right and the canvas simply never got sized.**

### Why it matters

The venue is effectively invisible. Everything else in this packet — the orbit camera, instanced chips, the single shadow caster, seat-plate projection — is rendering into a postage stamp behind the HUD. The packet cannot be accepted on the strength of its code when its output does not appear.

This is also precisely the class of defect a visual pass exists to catch, and precisely why it survived: the implementation reads correctly, the tests pass, the build succeeds, and the console shows no error.

### Located at

`apps/web/src/components/river-venue-scene.tsx:145`

```tsx
<Canvas
  className="river-venue"
  camera={{ fov: rooftopCamera.fov, position: [0, rooftopCamera.height, -rooftopCamera.radius] }}
  dpr={[1, 1.5]}
  gl={{ antialias: true, powerPreference: 'high-performance' }}
  shadows
>
```

R3F's `<Canvas>` renders a wrapper div that takes the `className` and sizes the inner canvas from its own resize observer. The component is mounted through `next/dynamic` with `ssr: false`, so it hydrates after the stage-scaling effect runs — a mount-time measurement of zero that never recovers is the most likely mechanism.

### Expected correction

Give the canvas explicit dimensions rather than relying on the observer:

```tsx
<Canvas
  className="river-venue"
  style={{ width: '100%', height: '100%' }}
  resize={{ scroll: false, debounce: { scroll: 0, resize: 0 } }}
  ...
>
```

or, defensively, in `globals.css`:

```css
.river-venue > canvas { width: 100% !important; height: 100% !important; }
```

### Acceptance check

Load the app at 1280x720 and evaluate:

```js
const c = document.querySelector('canvas').getBoundingClientRect()
c.width >= 1270 && c.height >= 710
```

Must be true. Re-run at 1920x1080 and after a viewport resize.

---

## P2 — two three.js deprecation warnings

From the dev server console on first render:

```
THREE.Clock: This module has been deprecated. Please use THREE.Timer instead.
THREE.WebGLShadowMap: PCFSoftShadowMap has been deprecated. Using PCFShadowMap instead.
```

The second has a real consequence: **soft shadows were requested and are silently being downgraded to hard PCF.** The art direction specifies one soft realtime caster, so the shadow quality on the felt will not match the lookdev until this is addressed.

Neither blocks acceptance. Both should be resolved before the venue work is judged on look.

---

## Passing

Verified from the live accessibility tree and DOM measurements:

- **The HUD stays in the DOM, unchanged.** Menu cluster, verify pill, pot readout, board region, seat plates and action rail all present as 2C shipped them.
- **Layer order is correct.** `.river-venue` at z-index 0, `.hud-layer` at z-index 1, both inside `.river-stage`.
- **Hybrid amount formatting works.** Hero seat renders `100,000` exact, opponent renders `100K` abbreviated — Zain's Decision 2 implemented correctly.
- **Verify pill handles its null state.** Renders `--------` before a commit exists, at reduced emphasis, per `04-anatomy.md`.
- **Pot does not collapse.** Reads `0` in the ready phase rather than disappearing, per the reserved-dimensions rule.
- **Minimum viewport guard present.** The `River needs a wider table` message exists in the DOM.
- **Board region reserved.** `preflop, 0 community cards` announced with the region held.
- Server builds clean, page returns 200, no runtime errors.

## Not verified

Everything requiring pixels: orbit camera behaviour, instanced chips, shadow casting, seat-plate world projection, venue appearance. All are blocked behind the P0 — there is nothing large enough to look at until the canvas is sized.

Re-review once the canvas fills its container.
