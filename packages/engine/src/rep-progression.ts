export interface RepLevel {
  level: number
  title: string
  repRequired: number
}

export interface RepProgress {
  level: number
  title: string
  repIntoLevel: number
  repForNextLevel: number
  fractionThroughLevel: number
  totalRep: number
}

const TITLES: readonly string[] = [
  'Newcomer',
  'Regular',
  'Grinder',
  'Cautious',
  'Solid',
  'Bankroller',
  'Table Captain',
  'House Regular',
  'Sharp Eye',
  'Steady Hand',
  'Railbird',
  'Cold Caller',
  'Bluffer',
  'Trapper',
  'High Roller',
  'Card Sharp',
  'Shot Caller',
  'Big Blind',
  'Late Night',
  'Old Timer',
  'River King',
  'House Shark',
  'Rounder',
  'Lion',
  'Silver Crown',
  'Court Card',
  'All-In Artist',
  'Hall of Fame',
  'Live Legend',
  'Table Legend',
]

function repForLevel(level: number): number {
  return 100 * level * (level + 1)
}

export function levelTable(): readonly RepLevel[] {
  const table: RepLevel[] = []
  let cumulative = 0
  for (let level = 1; level <= TITLES.length; level += 1) {
    table.push({
      level,
      title: TITLES[level - 1] ?? `Level ${level}`,
      repRequired: cumulative,
    })
    cumulative += repForLevel(level)
  }
  return table
}

export function progressFor(totalRep: number): RepProgress {
  const safeTotal = totalRep < 0 ? 0 : totalRep
  const table = levelTable()
  const maxLevel = table[table.length - 1]
  if (maxLevel !== undefined && safeTotal >= maxLevel.repRequired) {
    return {
      level: maxLevel.level,
      title: maxLevel.title,
      repIntoLevel: safeTotal - maxLevel.repRequired,
      repForNextLevel: 0,
      fractionThroughLevel: 1,
      totalRep: safeTotal,
    }
  }
  let current = table[0] ?? { level: 1, title: 'Newcomer', repRequired: 0 }
  let next = table[1] ?? current
  for (let index = 0; index < table.length; index += 1) {
    const level = table[index]
    const following = table[index + 1]
    if (level !== undefined && level.repRequired <= safeTotal) {
      current = level
      next = following ?? level
    }
  }
  const span = next.repRequired - current.repRequired
  const repIntoLevel = safeTotal - current.repRequired
  const repForNext = span > 0 ? span - repIntoLevel : 0
  const fraction = span > 0 ? repIntoLevel / span : 0
  return {
    level: current.level,
    title: current.title,
    repIntoLevel,
    repForNextLevel: repForNext,
    fractionThroughLevel: fraction,
    totalRep: safeTotal,
  }
}

export function levelsGained(before: number, after: number): number {
  const safeBefore = before < 0 ? 0 : before
  const safeAfter = after < 0 ? 0 : after
  if (safeAfter <= safeBefore) return 0
  return levelTable().filter(
    (level) => level.repRequired > safeBefore && level.repRequired <= safeAfter,
  ).length
}
