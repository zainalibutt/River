import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
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
  { pattern: /\bclone of\b/i, why: 'frames River as a reproduction' },
  { pattern: /\b(a|the)\s+\w+\s+clone\b/i, why: 'frames River as a reproduction' },
  { pattern: /\bcloning\b/i, why: 'frames River as a reproduction' },
  // A bare twenty-letter run also matches ordinary English - the word
  // "internationalisation" is exactly twenty - so match the context a project
  // ref actually appears in rather than its shape. A gate that fires on prose
  // is worse than no gate, and this one did before it was checked.
  { pattern: /[a-z0-9]{20}\.supabase\.(co|com)/, why: 'a project ref in a URL' },
  { pattern: /project_ref\s*[=:]\s*['"]?[a-z0-9]{20}/, why: 'a project ref in config' },
  { pattern: /eyJhbGciOi[A-Za-z0-9_-]{6,}/, why: 'looks like a signed token' },
  { pattern: /sb_(publishable|secret)_[A-Za-z0-9_-]{12,}/, why: 'looks like a Supabase key' },
  // A home directory names the machine and the person on it, and it only ever
  // arrives by pasting a working command into a document.
  { pattern: /\b[A-Za-z]:[\\/]+Users[\\/]/, why: 'a local machine path' },
]

/**
 * Identifiers refused wherever they appear, by the SHA-256 of the token, so the
 * gate can recognise them without naming them. The live Supabase project ref is
 * twenty lowercase letters and digits, which the patterns above only catch in a
 * URL or a config line; a note once named it in plain prose.
 */
/**
 * Words refused wherever they appear, by the SHA-256 of the lower-cased word, so the
 * gate can refuse the reference game's name without the repository containing it.
 */
const FORBIDDEN_WORDS: ReadonlySet<string> = new Set([
  'b359740f5759d2b3903047559ad49c83b9ea104d78f4902e20b0ed28fe1bb56a',
])

/** The first word in `text` whose lower-cased SHA-256 is in `hashes`, if any. */
function forbiddenWord(text: string, hashes: ReadonlySet<string>): string | null {
  for (const word of text.match(/[A-Za-z]{4,}/g) ?? []) {
    if (hashes.has(createHash('sha256').update(word.toLowerCase()).digest('hex'))) return word
  }
  return null
}

const FORBIDDEN_TOKENS: ReadonlySet<string> = new Set([
  'a0993f2c4ffa7e80c376ca642ac07b376d8824df0f3f3eb5228a7d7600fe4fee',
])

/** The first twenty-character token in `text` whose hash is in `hashes`, if any. */
function forbiddenToken(text: string, hashes: ReadonlySet<string>): string | null {
  for (const token of text.match(/\b[a-z0-9]{20}\b/g) ?? []) {
    if (hashes.has(createHash('sha256').update(token).digest('hex'))) return token
  }
  return null
}

/** Binary and generated paths where a match would be meaningless. */
const SKIP = /\.(blend|glb|png|jpe?g|webp|mp4|mov|ico|woff2?|ttf|lock)$|^package-lock\.json$/i

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
      if (forbiddenToken(contents, FORBIDDEN_TOKENS) !== null) {
        offences.push(`${file} names a refused identifier`)
      }
      if (forbiddenWord(contents, FORBIDDEN_WORDS) !== null) {
        offences.push(`${file} names the reference game`)
      }
    }
    expect(offences).toEqual([])
    // Reading every tracked file takes several seconds on Windows, longer under load.
  }, 120_000)

  it('can actually see a violation, rather than passing because it looks at nothing', () => {
    // A gate that never fires is worse than no gate, and this project has
    // shipped one of those before - a radius check that read stale data and
    // passed everything.
    const files = trackedFiles()
    expect(files.length).toBeGreaterThan(50)
    expect(files).toContain('README.md')
    expect(FORBIDDEN.some(({ pattern }) => pattern.test('a poker clone'))).toBe(true)
    expect(FORBIDDEN_WORDS.size).toBeGreaterThan(0)
    const word = new Set([createHash('sha256').update('zyzzogeton').digest('hex')])
    expect(forbiddenWord('a note naming Zyzzogeton here', word)).toBe('Zyzzogeton')
    expect(forbiddenWord('an ordinary sentence', word)).toBeNull()
    expect(FORBIDDEN.some(({ pattern }) => pattern.test('the game this one is cloning'))).toBe(true)
    expect(FORBIDDEN.some(({ pattern }) => pattern.test('C:\\Users\\someone\\River'))).toBe(true)
    expect(FORBIDDEN.some(({ pattern }) => pattern.test('C:/Users/someone/River'))).toBe(true)
    expect(FORBIDDEN.some(({ pattern }) => pattern.test('an ordinary sentence'))).toBe(false)
    expect(FORBIDDEN.some(({ pattern }) => pattern.test('users of the C: drive'))).toBe(false)
    const planted = new Set([createHash('sha256').update('abcdefghij0123456789').digest('hex')])
    expect(forbiddenToken('a note about abcdefghij0123456789 here', planted)).toBe(
      'abcdefghij0123456789',
    )
    expect(forbiddenToken('internationalisation, in ordinary prose', planted)).toBeNull()
  })
})
