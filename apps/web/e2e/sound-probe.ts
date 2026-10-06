import type { Page } from '@playwright/test'

export async function installSoundProbe(page: Page) {
  await page.route('**/audio/*.wav', (route) =>
    route.fulfill({
      body: new URL(route.request().url()).pathname.split('/').at(-1)?.replace('.wav', '') ?? '',
    }),
  )
  await page.addInitScript(() => {
    const probe = window as typeof window & { playedEffects: string[]; decodedEffects: number }
    probe.playedEffects = []
    probe.decodedEffects = 0
    class AudioProbe {
      state = 'running'
      destination = {}
      get currentTime() {
        return performance.now() / 1000
      }
      createGain = () => ({ gain: { value: 1 }, connect: () => {} })
      createBufferSource = () => {
        const source = {
          buffer: null as { effect: string } | null,
          playbackRate: { value: 1 },
          connect: () => {},
          start: () => {
            if (source.buffer !== null) probe.playedEffects.push(source.buffer.effect)
          },
        }
        return source
      }
      decodeAudioData = async (bytes: ArrayBuffer) => {
        probe.decodedEffects++
        return { effect: new TextDecoder().decode(bytes) }
      }
      resume = async () => {}
    }
    Object.defineProperty(window, 'AudioContext', { value: AudioProbe, configurable: true })
  })
  return {
    decoded: () =>
      page.evaluate(() => (window as typeof window & { decodedEffects: number }).decodedEffects),
    count: (effect: string) =>
      page.evaluate(
        (name) =>
          (window as typeof window & { playedEffects: string[] }).playedEffects.filter(
            (played) => played === name,
          ).length,
        effect,
      ),
  }
}
