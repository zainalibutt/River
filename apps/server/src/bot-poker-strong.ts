import { type BotPolicy, strongPreflopRulePolicy } from '@river/engine'
import { pokerGuardDecision } from './bot-poker-guard.js'

export const pokerStrongCandidatePolicy: BotPolicy = {
  id: 'poker-strong-candidate',
  version: 1,
  decide(context) {
    const baseline = strongPreflopRulePolicy.decide(context)
    const decision =
      context.profile.skill === 'og'
        ? pokerGuardDecision(context.observation, baseline.decision)
        : baseline.decision
    return { ...baseline, policyId: this.id, policyVersion: this.version, decision }
  },
}
