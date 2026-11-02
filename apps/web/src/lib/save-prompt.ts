/**
 * When to ask a guest to save their progress.
 *
 * A guest is a browser's saved session: clear the storage or open another browser and the
 * chips are gone. The table says so once the guest has played enough to have something to
 * lose - three settled hands - and never before the first. Dismissed, it stays away for a
 * week, remembered in this browser.
 */

export const SAVE_PROMPT_KEY = 'river:save-prompt-dismissed-at'
export const SAVE_PROMPT_HANDS = 3
const QUIET_MS = 7 * 24 * 60 * 60 * 1000

interface PromptStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export function savePromptDue(input: {
  guest: boolean
  handsFinished: number
  storage: PromptStorage | null
  nowMs: number
}): boolean {
  if (!input.guest || input.handsFinished < SAVE_PROMPT_HANDS) return false
  try {
    const dismissed = Number(input.storage?.getItem(SAVE_PROMPT_KEY) ?? '')
    return !(Number.isFinite(dismissed) && dismissed > 0 && input.nowMs - dismissed < QUIET_MS)
  } catch {
    return true
  }
}

export function dismissSavePrompt(storage: PromptStorage | null, nowMs: number): void {
  try {
    storage?.setItem(SAVE_PROMPT_KEY, String(nowMs))
  } catch {
    // A browser that will not store it asks again next visit.
  }
}
