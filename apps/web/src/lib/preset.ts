import type { LegalActions, TurnAction } from '@river/engine'

/**
 * Preset actions are the most distinctive mechanic in the reference: you commit to
 * an action before your turn arrives, and your avatar telegraphs it publicly
 * while the choice itself stays private in your HUD.
 *
 * This module owns only the local half - which presets are offerable, and what a
 * preset resolves to when the turn actually arrives. The public avatar gesture
 * needs a protocol event and is deliberately not here yet.
 */
export type PresetKind = 'check-fold' | 'call-any' | 'fold'

export const PRESET_KINDS: readonly PresetKind[] = ['check-fold', 'call-any', 'fold']

export const PRESET_LABELS: Record<PresetKind, string> = {
  'check-fold': 'CHECK / FOLD',
  'call-any': 'CALL ANY',
  fold: 'FOLD',
}

export type PresetOutcome =
  | { kind: 'commit'; action: TurnAction }
  | { kind: 'invalidated'; reason: string }

/**
 * Presets are armed while waiting on other players. Once it is your turn the RAM
 * is the surface, so offering a preset then would be two controls for one job.
 */
export function canArmPreset(isLocalTurn: boolean, seated: boolean, handLive: boolean): boolean {
  return seated && handLive && !isLocalTurn
}

/**
 * Resolve an armed preset against the legal actions at the moment the turn opens.
 *
 * A preset that no longer means what the player intended must never silently
 * become something else - it invalidates and the normal RAM opens instead.
 */
export function resolvePreset(preset: PresetKind, legal: LegalActions): PresetOutcome {
  switch (preset) {
    case 'check-fold':
      if (legal.check.enabled) return { kind: 'commit', action: { kind: 'check' } }
      if (legal.fold.enabled) return { kind: 'commit', action: { kind: 'fold' } }
      return { kind: 'invalidated', reason: 'neither check nor fold is legal' }

    case 'call-any':
      if (legal.call.enabled) return { kind: 'commit', action: { kind: 'call' } }
      // Nothing to call means the table checked to you, which is what the player
      // asked for in substance: stay in the hand at no cost.
      if (legal.check.enabled) return { kind: 'commit', action: { kind: 'check' } }
      return { kind: 'invalidated', reason: 'nothing to call and check is not legal' }

    case 'fold':
      if (legal.fold.enabled) return { kind: 'commit', action: { kind: 'fold' } }
      return { kind: 'invalidated', reason: 'fold is not legal' }

    default:
      return { kind: 'invalidated', reason: 'unknown preset' }
  }
}

/**
 * A preset is armed for one decision, not for the hand.
 *
 * Clearing on a street change is a deliberate choice: CALL ANY armed pre-flop
 * silently calling an all-in shove on the river is a money-losing surprise, and
 * the reference treats presets as per-decision.
 */
export function shouldClearPreset(
  previousStreet: string | null,
  nextStreet: string | null,
  handLive: boolean,
): boolean {
  if (!handLive) return true
  return previousStreet !== nextStreet
}
