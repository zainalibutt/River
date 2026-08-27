# Operating laws — Claude

Binding. These override any habit or default I would otherwise apply.

Every one of them exists because of a specific failure on this project, named
underneath it. They are all mine, and all from 27–28 August 2026. The other
models have law files for the same reason; this is the one I was missing.

---

## 1. Look at it, in Chrome

**Use the Chrome extension (`mcp__claude-in-chrome__*`) for every browser task.
Never use the in-app Browser pane.** The pane does not composite frames unless
it is displayed, so screenshots time out and `getBoundingClientRect` on the
stage returns zero — it silently produces wrong measurements, not obvious
errors.

**If the extension is not connected, stop and ask for help.** Do not fall back
to the pane. Do not carry on measuring around the gap.

*Why:* I spent an entire session unable to see the game. I tried a screenshot on
the pane, it failed, and I wrote "I cannot see the render" into my working
assumptions and repeated it in a dozen replies. The extension was connected the
whole time. Every "verified by measurement rather than by eye" caveat I gave was
self-inflicted, and several faults — a mask edge on every face, stray geometry
in frame — would have been obvious in one screenshot.

## 2. Verify by exit code, never by reading output

```
npm run typecheck > /tmp/tc.log 2>&1; echo $?
```

**Never pipe a command through `grep`, `head` or `tail` to decide whether it
passed.** A pipe replaces the exit status with the last command's, and tools
colour their output, so a literal match can be impossible.

*Why:* `npm run typecheck 2>&1 | grep -E "error TS"` reported clean for several
commits while `socket.test.ts` had not compiled since the developer role landed.
tsc writes `error`, then an ANSI escape, then ` TS2345:` — the string "error TS"
never appears. Piping through `tail` then reported tail's exit code as zero. The
first automated deploy caught what I had been calling green.

## 3. Prove the code you are about to change is the code that runs

Before editing: find the call site. After editing: **measure that the output
changed.** Identical numbers mean the edit did not take, and that is a finding,
not a coincidence.

*Why:* three times in one session.
- Shadow masses painted into the mirrored half of the atlas, because `set_pixel`
  flips rows and the helper I wrote did not. The face rebuilt byte-identical.
- A garment offset changed to clear every vertex in its weld cluster rather than
  their average — arithmetic that does nothing, because the weld distance is
  0.5mm and almost every cluster is a single vertex.
- A face painted correctly in `build_characters.py` and overwritten one build
  step later by a second atlas painter in `build_assets.py`.

## 4. When a fix does not show, look for the second source of truth

If a visual fault survives a correct-looking fix, **stop fixing and go
looking**. Something else owns that value too.

*Why:* this repository has produced five, each costing more than the fix did.
Two colour conversions (sRGB written as linear). Two camera tables (6.1m against
3.2m). Two atlas painters (a painted face against a flat one). Two skin tones
(a thirty-point step where the face met the head). Two orientation formulas
(chairs 180 degrees from the people in them).

## 5. Do not attribute your own breakage to another lane

Before blaming another model's commit: is the log stale, did I restart
something, and does the file on disk actually match what the error describes?

*Why:* I reported a `ReferenceError` and every route 404ing as faults in Fable's
commit. The error was a stale log line from mid-edit and the 404s were my own
engine rebuild restarting the dev server into a bad state. Its commit was clean
and stayed exactly in its lane.

## 6. The suite is green when you have seen it green

Never push on an unverified suite. If it is red, establish **whose** it is
before acting. In a shared working copy, scope runs to your own lane — a full
run against another model's half-written file is a false red.

*Why:* I pushed while the suite showed one failure, then found it was another
lane mid-write. It happened to be harmless. I did not check first.

## 7. Push before you deploy

*Why:* I triggered the deploy workflow twice against a commit that was still
local, and read the resulting failure as a new fault both times.

## 8. Delegation is spending

A brief is a purchase order. Before writing one:

- **One deliverable per packet.** If the brief contains an "and", split it.
- **State a hard ceiling** — "if you pass N tool calls, stop and report" — and
  mean it.
- **Verify the environment yourself and say what you checked**, with the
  command. Never assert a server is up because it was earlier.
- **Hand over the measurement code.** Do not commission a harness that already
  exists in this session's history.
- Name every readable file. Exploration is the most expensive thing an agent
  can do and the least likely to be needed.

*Why:* packet 6A cost about fifteen pounds. It carried three jobs in one packet,
had no ceiling, asserted a dev server was running when it was not — so the agent
spent turns diagnosing my mistake — and asked it to build a DOM sweep I had
already written three times that evening. 118 tool calls. The work it returned
was good and worth roughly an hour; the difference was my brief.

## 9. Measure before claiming, and report the number

"Looks better" is not a result. Before and after, with units. If something could
not be verified, say which part and why, in the same breath as the claim.

*Why:* every real fault this session was found by a number — 82 of 2,112
vertices inside the body, a thirty-point colour step, 18 floating cards, an
82,832 to 23,522 triangle drop, chairs at +Y against characters at -Y. None was
found by looking at code and reasoning about it.
