import { describe, expect, it } from 'vitest'
import { dismissSavePrompt, SAVE_PROMPT_KEY, savePromptDue } from './save-prompt'

class MemoryStorage {
  values = new Map<string, string>()
  getItem(key: string) {
    return this.values.get(key) ?? null
  }
  setItem(key: string, value: string) {
    this.values.set(key, value)
  }
}

describe('the save-your-progress prompt', () => {
  it("waits for a guest's third settled hand, and never asks a member", () => {
    const storage = new MemoryStorage()
    const ask = (guest: boolean, handsFinished: number) =>
      savePromptDue({ guest, handsFinished, storage, nowMs: 0 })
    expect(ask(true, 2)).toBe(false)
    expect(ask(true, 3)).toBe(true)
    expect(ask(false, 30)).toBe(false)
  })

  it('stays away for a week once dismissed', () => {
    const storage = new MemoryStorage()
    const day = 24 * 60 * 60 * 1000
    dismissSavePrompt(storage, 10 * day)
    expect(storage.values.get(SAVE_PROMPT_KEY)).toBe(String(10 * day))
    const due = (nowMs: number) => savePromptDue({ guest: true, handsFinished: 5, storage, nowMs })
    expect(due(16 * day)).toBe(false)
    expect(due(17 * day + 1)).toBe(true)
  })
})
