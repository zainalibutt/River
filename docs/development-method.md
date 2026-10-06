# Development method

River was developed with extensive use of AI coding assistants across
implementation, analysis and tooling. I retained ownership of the product,
architecture, task decomposition, integration, review and release, and every
visual judgement was mine.

Different assistants were used where their strengths or cost made sense, and a
change from any of them was a proposal that still had to earn its place. This
page describes the process that made that work.

## Bounded tasks

Work went out as briefs with one deliverable each: the goal, the files in scope,
the gate that decides success, and a budget. A brief with an "and" in it was
two briefs. Each workstream ran in its own Git worktree with named files, so two
streams could not edit the same module without it being visible in advance.

Briefs said whether they were asking for a **probe** (answer one question, change
nothing, report) or a **fix** (iterate until the gate passes). Mixing the two
produced careful, well-bounded work on the wrong problem.

## Evidence, not assertions

- **Exit codes, not output.** Typecheck, lint and tests are judged by their exit
  status. Grepping output for errors once reported a clean build while a file had
  not compiled for days.
- **Prove the instrument first.** Before trusting a measurement, show that it can
  see the defect at all. Several false alarms came from a hidden browser tab, a
  stale build or a scene that was never reset, not from the code.
- **Gates that can fail.** Checks such as the asset budgets and the repository
  hygiene gate come with negative tests proving they fire. A gate that never
  fires looks exactly like a pass.
- **Measure what the player sees.** Anything visual starts with a render of the
  defect from a camera that could show it, and the verdict on a visual change is
  mine, made by looking.

## Held-out evaluation

The bots are judged the way a model is: development seeds for tuning, fresh
seeds for the confirmation run, and a pass mark written down before the fresh
cards are dealt. A best-response opponent and an outside benchmark keep "it beat
our test styles" from passing for "it is hard to beat". [Bots](bots.md) shows the
experiments that failed alongside the ones that shipped.

## Recording decisions

Decisions that would be expensive to reverse are written down with their
reasoning in [Decisions](decisions.md). Commit messages explain why the change
that landed is the way it is. Working notes on approaches that failed are kept
privately, so a later task can see "do not retry this" without the public
record turning into a diary.

## Where the process changed

The rules above were mostly written after something went wrong: a defect
declared fixed several times from views that could not show it, a measurement
suite built before the cheapest experiment that would have settled the question,
an expensive brief that spent most of its budget inspecting its own output.
Each one became a standing rule, and the rule was applied to the next task
rather than remembered.
