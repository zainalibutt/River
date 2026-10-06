import type { LegalActions } from '@river/engine'
import { describe, expect, it } from 'vitest'
import { canArmPreset, resolvePreset, shouldClearPreset } from './preset.js'

function legal(overrides: Partial<LegalActions> = {}): LegalActions {
  return {
    fold: { enabled: true, amount: 0 },
    check: { enabled: false, amount: 0 },
    call: { enabled: true, amount: 500 },
    raiseTo: { enabled: true, min: 1000 },
    allIn: { enabled: true, amount: 100_000 },
    ...overrides,
  }
}

describe('preset actions', () => {
  it('arms only while waiting on someone else', () => {
    expect(canArmPreset(false, true, true)).toBe(true)
    expect(canArmPreset(true, true, true)).toBe(false)
    expect(canArmPreset(false, false, true)).toBe(false)
    expect(canArmPreset(false, true, false)).toBe(false)
  })

  it('check-fold checks when checking is free', () => {
    const out = resolvePreset('check-fold', legal({ check: { enabled: true, amount: 0 } }))
    expect(out).toEqual({ kind: 'commit', action: { kind: 'check' } })
  })

  it('check-fold folds when facing a bet', () => {
    const out = resolvePreset('check-fold', legal())
    expect(out).toEqual({ kind: 'commit', action: { kind: 'fold' } })
  })

  it('call-any calls the outstanding bet', () => {
    expect(resolvePreset('call-any', legal())).toEqual({
      kind: 'commit',
      action: { kind: 'call' },
    })
  })

  it('call-any checks when the table checked to you', () => {
    const out = resolvePreset(
      'call-any',
      legal({ call: { enabled: false, amount: 0 }, check: { enabled: true, amount: 0 } }),
    )
    expect(out).toEqual({ kind: 'commit', action: { kind: 'check' } })
  })

  it('never turns an impossible preset into a different action', () => {
    const out = resolvePreset(
      'call-any',
      legal({ call: { enabled: false, amount: 0 }, check: { enabled: false, amount: 0 } }),
    )
    expect(out.kind).toBe('invalidated')
  })

  it('invalidates fold when folding is not legal', () => {
    expect(resolvePreset('fold', legal({ fold: { enabled: false, amount: 0 } })).kind).toBe(
      'invalidated',
    )
  })

  it('a preset never resolves to a raise or an all-in', () => {
    for (const preset of ['check-fold', 'call-any', 'fold'] as const) {
      const out = resolvePreset(preset, legal({ check: { enabled: true, amount: 0 } }))
      if (out.kind === 'commit') {
        expect(['check', 'call', 'fold']).toContain(out.action.kind)
      }
    }
  })

  it('clears on a street change so CALL ANY cannot leak across streets', () => {
    expect(shouldClearPreset('preflop', 'flop', true)).toBe(true)
    expect(shouldClearPreset('flop', 'flop', true)).toBe(false)
  })

  it('clears when the hand ends', () => {
    expect(shouldClearPreset('river', 'river', false)).toBe(true)
  })
})
