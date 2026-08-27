import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * The repository is public and is read as evidence of its author's engineering.
 *
 * It should read as a poker game with a genre reference, not as a request to
 * reproduce somebody else's product. That is a presentation decision Zain made
 * on 2026-08-27, and it is enforced here rather than left to vigilance: a
 * single stray mention in a comment is exactly the thing nobody notices until
 * the person reading it is a recruiter.
 *
 * Working notes that must discuss the reference by name are gitignored, so the
 * check runs over tracked files only. If this fails, the fix is to reword the
 * file or to stop tracking it - never to weaken the pattern.
 */

/** Names and phrasings that should not appear in anything committed. */
const FORBIDDEN: readonly { pattern: RegExp; why: string }[] = [
  { pattern: /prominence/i, why: 'names the reference game' },
  { pattern: /\bclone of\b/i, why: 'frames River as a reproduction' },
  { pattern: /\b(a|the)\s+\w+\s+clone\b/i, why: 'frames River as a reproduction' },
  // A bare twenty-letter run also matches ordinary English - the word
  // "internationalisation" is exactly twenty - so match the context a project
  // ref actually appears in rather than its shape. A gate that fires on prose
  // is worse than no gate, and this one did before it was checked.
  { pattern: /[a-z0-9]{20}\.supabase\.(co|com)/, why: 'a project ref in a URL' },
  { pattern: /project_ref\s*[=:]\s*['"]?[a-z0-9]{20}/, why: 'a project ref in config' },
  { pattern: /eyJhbGciOi[A-Za-z0-9_-]{6,}/, why: 'looks like a signed token' },
  { pattern: /sb_(publishable|secret)_[A-Za-z0-9_-]{12,}/, why: 'looks like a Supabase key' },
]

/** Binary and generated paths where a match would be meaningless. */
const SKIP = /\.(glb|png|jpe?g|webp|mp4|mov|ico|woff2?|ttf|lock)$|^package-lock\.json$/i

function trackedFiles(): string[] {
  const out = execFileSync('git', ['ls-files'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  return out.split('\n').filter((line) => line.length > 0 && !SKIP.test(line))
}

describe('repository hygiene', () => {
  it('tracks no file that names the reference game or calls River a clone', () => {
    const offences: string[] = []
    for (const file of trackedFiles()) {
      // This file necessarily contains the patterns it searches for.
      if (file === 'hygiene.test.ts') continue
      let contents: string
      try {
        contents = readFileSync(file, 'utf8')
      } catch {
        continue
      }
      for (const { pattern, why } of FORBIDDEN) {
        const line = contents.split('\n').findIndex((text) => pattern.test(text))
        if (line >= 0) offences.push(`${file}:${line + 1} ${why}`)
      }
    }
    expect(offences).toEqual([])
  })

  it('can actually see a violation, rather than passing because it looks at nothing', () => {
    // A gate that never fires is worse than no gate, and this project has
    // shipped one of those before - a radius check that read stale data and
    // passed everything.
    const files = trackedFiles()
    expect(files.length).toBeGreaterThan(50)
    expect(files).toContain('README.md')
    expect(FORBIDDEN.some(({ pattern }) => pattern.test('a Prominence Poker clone'))).toBe(true)
    expect(FORBIDDEN.some(({ pattern }) => pattern.test('an ordinary sentence'))).toBe(false)
  })
})
