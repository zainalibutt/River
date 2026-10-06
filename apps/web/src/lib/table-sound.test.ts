import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

describe('interface sound loading', () => {
  let at = 0
  let loaded: () => void
  const start = vi.fn()

  beforeEach(() => {
    vi.resetModules()
    at = 0
    start.mockClear()
    vi.spyOn(performance, 'now').mockImplementation(() => at)
    class AudioContext {
      state = 'running'
      currentTime = 1
      destination = {}
      createGain = () => ({ gain: { value: 1 }, connect: vi.fn() })
      createBufferSource = () => ({
        buffer: null,
        playbackRate: { value: 1 },
        connect: vi.fn(),
        start,
      })
      decodeAudioData = async () => ({})
      resume = vi.fn()
    }
    vi.stubGlobal('window', {
      AudioContext,
      localStorage: { getItem: () => null, setItem: vi.fn() },
    })
    const ready = new Promise<void>((resolve) => {
      loaded = resolve
    })
    vi.stubGlobal('fetch', async () => {
      await ready
      return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) }
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  async function finishLoading() {
    loaded()
    for (let turn = 0; turn < 8; turn++) await Promise.resolve()
  }

  test('plays the first click when its buffer arrives within the feedback window', async () => {
    const { tableSound } = await import('./table-sound.js')
    tableSound.unlock()
    tableSound.play('ui_click')
    expect(start).not.toHaveBeenCalled()
    at = 60
    await finishLoading()
    expect(start).toHaveBeenCalledTimes(1)
  })

  test('drops a late first click instead of surprising the player', async () => {
    const { tableSound } = await import('./table-sound.js')
    tableSound.unlock()
    tableSound.play('ui_click')
    at = 121
    await finishLoading()
    expect(start).not.toHaveBeenCalled()
    tableSound.play('ui_click')
    expect(start).toHaveBeenCalledTimes(1)
  })

  test('muting cancels a pending click even if sound is switched back on', async () => {
    const { tableSound } = await import('./table-sound.js')
    tableSound.unlock()
    tableSound.play('ui_click')
    tableSound.setMuted(true)
    tableSound.setMuted(false)
    await finishLoading()
    expect(start).not.toHaveBeenCalled()
  })

  test('never queues hover or gameplay sounds', async () => {
    const { tableSound } = await import('./table-sound.js')
    tableSound.unlock()
    tableSound.play('ui_hover')
    tableSound.play('chip_push')
    await finishLoading()
    expect(start).not.toHaveBeenCalled()
  })

  test('never queues a click before a user gesture has unlocked audio', async () => {
    const { tableSound } = await import('./table-sound.js')
    tableSound.play('ui_click')
    tableSound.unlock()
    await finishLoading()
    expect(start).not.toHaveBeenCalled()
  })
})
