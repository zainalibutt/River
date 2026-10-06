import type { BotTablePreset } from '@river/engine'

/** What the "Start a table" panel was asked for. */
export type TableChoice = { bots: 'off' } | { bots: 'fill'; preset: BotTablePreset }

/**
 * Where "Start a table" goes.
 *
 * A bot table does not say how many bots it wants: the server draws the number
 * and the chairs from the new table's room id, so a reconnect finds the same
 * table. Only a table for people says, and what it says is none.
 */
export function startTableHref(choice: TableChoice): string {
  const params = new URLSearchParams({ new: '1' })
  if (choice.bots === 'off') params.set('bots', 'off')
  else params.set('strength', choice.preset)
  return `/table?${params.toString()}`
}
