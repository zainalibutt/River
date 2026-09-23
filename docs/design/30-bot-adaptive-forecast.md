# Public-history adaptive forecast experiment

This is an offline diagnostic on the frozen v2 opponent-action model. It does not choose poker actions, update model weights during play, access private cards, create a production table, or enable live inference.

The candidate blends the frozen model's legal-action probabilities with the acting opponent's earlier public fold/check/call/raise rates. Facing-a-bet and free-to-check histories stay separate. The evidence is captured before the action being predicted, so the label cannot leak into its own features. A cold actor receives the frozen model's forecast unchanged. As earlier actions accumulate, the blend can put more weight on that actor's observed style; all illegal actions retain zero probability.

`npx tsx apps/server/src/bot-learning-adaptive-run-v2.ts` replays the frozen artifact and selects a prior from 4, 8, 12, 24, 48 or no adaptation using only the original validation hands. It then scores confirmation seeds, an unseen cast, and the authored distribution-shift set without fitting on any of them. The script writes no artifact or production state.

The result is negative. Validation log loss was 0.51649 for the frozen model and 0.54287 even for the least disruptive adaptive prior (48); smaller priors were worse. The selector chose no adaptation. Confirmation, unseen-cast and shift results therefore remain exactly the frozen v2 results. The pressure player's raise-probability Brier score remains 0.76272. The experiment shows that an intuitive online-style overlay can damage ordinary play, even if it appears useful for an extreme opponent. It is not eligible for shadow or live use.

The next experiment should first improve the evidence: varied legally authored policy families and, with player consent, public human-action histories at exact pre-action timing. A later adaptive candidate needs a new untouched distribution-shift confirmation set and validation-selected change detection, not tuning against the four styles already inspected here. Keep skill, style, tilt, and presentation separate; an action forecast is not an expert OG poker policy.
