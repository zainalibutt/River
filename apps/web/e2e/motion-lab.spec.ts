import { expect, type Page, test } from '@playwright/test'

/**
 * The showdown's promises, held against the motion lab's recorded hands.
 *
 * The lab replays real rooms through the real table with no server, account or database,
 * so these run anywhere the web app does. Each scene is watched from its start, sampling
 * the page every 40ms of real time at twice speed, and the samples are checked for the
 * things a player must never see early: the result in a stack, a pot or a prompt before
 * the award, a showdown caption before the board is out, or a caption on top of what it
 * is about.
 */

interface Sample {
  at: number
  boardFaces: number
  caption: string | null
  captionBox: Box | null
  captionBacks: number
  potBox: Box | null
  heroStack: string
  dock: string
  showing: number
  awarding: boolean
}

interface Box {
  x: number
  y: number
  width: number
  height: number
}

async function watch(page: Page, scene: string, seconds: number): Promise<Sample[]> {
  await page.goto(`/dev/motion?scene=${scene}&speed=2`)
  await page.locator('.motion-lab').waitFor()
  return page.evaluate(async (forMs) => {
    const box = (element: Element | null) => {
      if (element === null) return null
      const rect = element.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    }
    const text = (selector: string) =>
      (document.querySelector(selector)?.textContent ?? '').replace(/\s+/g, ' ').trim()
    const samples: unknown[] = []
    const started = performance.now()
    await new Promise<void>((done) => {
      const sample = () => {
        const stage = document.querySelector('.showdown-stage')
        samples.push({
          at: performance.now() - started,
          boardFaces: document.querySelectorAll('.t2d-card-board .playing-card').length,
          caption: stage === null ? null : text('.showdown-card'),
          captionBox: box(document.querySelector('.showdown-card')),
          captionBacks: document.querySelectorAll('.showdown-card .card-back').length,
          potBox: box(document.querySelector('.t2d-pot .t2d-pile-amount')),
          heroStack: text('.cluster-chips'),
          dock: text('.phone-dock'),
          showing: document.querySelectorAll('.t2d-placard.showing, .table-cluster.showing').length,
          awarding: stage?.classList.contains('awarding') === true,
        })
        if (performance.now() - started < forMs) setTimeout(sample, 40)
        else done()
      }
      sample()
    })
    return samples
  }, seconds * 1000) as Promise<Sample[]>
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
}

test.describe('the showdown, told from the felt', () => {
  test('keeps an all-in run-out from giving the result away', async ({ page }) => {
    const samples = await watch(page, 'allin-preflop', 11)
    const firstCaption = samples.findIndex((sample) => sample.caption !== null)
    const firstAward = samples.findIndex((sample) => sample.awarding)
    expect(firstCaption).toBeGreaterThan(-1)
    expect(firstAward).toBeGreaterThan(firstCaption)
    // The caption waits for the whole board, and a tabled hand is never told from its back.
    expect(samples[firstCaption]?.boardFaces).toBe(5)
    expect(samples.every((sample) => sample.captionBacks === 0)).toBe(true)
    // Your stack holds at what was left behind until the pot is paid.
    const beforeAward = samples.slice(0, firstAward)
    const allInAt = beforeAward.findIndex((sample) => sample.heroStack === '0')
    expect(allInAt).toBeGreaterThan(-1)
    expect(beforeAward.slice(allInAt).every((sample) => sample.heroStack === '0')).toBe(true)
    // The streets of the run-out land one at a time, not together.
    const flop = samples.findIndex((sample) => sample.boardFaces >= 3)
    const turn = samples.findIndex((sample) => sample.boardFaces >= 4)
    const river = samples.findIndex((sample) => sample.boardFaces >= 5)
    expect(samples[turn]?.at ?? 0).toBeGreaterThan((samples[flop]?.at ?? 0) + 300)
    expect(samples[river]?.at ?? 0).toBeGreaterThan((samples[turn]?.at ?? 0) + 300)
  })

  test('throws losing hands away and lights the hand being told', async ({ page }) => {
    const samples = await watch(page, 'checked-down', 17)
    expect(samples.some((sample) => sample.caption?.includes('MUCKS') === true)).toBe(true)
    const telling = samples.filter(
      (sample) =>
        sample.caption !== null && !sample.awarding && /two pair|pair|high/i.test(sample.caption),
    )
    expect(telling.length).toBeGreaterThan(0)
    expect(telling.every((sample) => sample.showing > 0)).toBe(true)
    // The caption never sits on the pot it is about to pay.
    for (const sample of samples) {
      if (sample.captionBox !== null && sample.potBox !== null) {
        expect(overlaps(sample.captionBox, sample.potBox)).toBe(false)
      }
    }
  })
})

test.describe('the showdown on a phone', () => {
  test.use({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true })

  test('offers a rebuy only once the side pot has been paid', async ({ page }) => {
    const samples = await watch(page, 'allin-flop-side-pot', 15)
    const firstAward = samples.findIndex((sample) => sample.awarding)
    expect(firstAward).toBeGreaterThan(-1)
    const early = samples.slice(0, firstAward)
    expect(early.some((sample) => /OUT OF CHIPS|REBUY/.test(sample.dock))).toBe(false)
    expect(samples.slice(firstAward).some((sample) => /OUT OF CHIPS|REBUY/.test(sample.dock))).toBe(
      true,
    )
  })
})
