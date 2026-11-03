import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { BotChallenges } from './bot-challenges'

describe('heads-up menu challenges', () => {
  it('hides Midas when unavailable and always offers the existing Champion preset as Nyx', () => {
    const markup = renderToStaticMarkup(
      createElement(BotChallenges, { midasAvailable: false, onSelect: () => {} }),
    )
    expect(markup).toContain('aria-label="Champion, Nyx 1v1"')
    expect(markup).not.toContain('Midas')
    expect(markup).not.toContain('Nell')
  })

  it('offers Midas beside Nyx when the server enables it', () => {
    const markup = renderToStaticMarkup(
      createElement(BotChallenges, { midasAvailable: true, onSelect: () => {} }),
    )
    expect(markup).toContain('aria-label="Midas 1v1"')
    expect(markup).toContain('aria-label="Champion, Nyx 1v1"')
  })
})
