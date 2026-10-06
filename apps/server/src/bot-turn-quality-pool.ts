import { readFileSync } from 'node:fs'

// Usage: tsx bot-turn-quality-pool.ts <spots.jsonl> [more.jsonl ...]
//
// Pools the offline decision check (bot-turn-quality-run.ts): for each
// candidate, the share of the pot its decisions give up over a spot's first
// two decisions, averaged over the spots with a 95% interval, the first
// decision alone, and each later candidate's difference from the first on the
// same spots. The reference's own figure is how far it is from converged.
interface Line {
  readonly spot: number
  readonly nodes: readonly {
    readonly history: string
    readonly reached: number
    readonly reference: number
    readonly candidates: Readonly<Record<string, number>>
  }[]
}
const lines = process.argv
  .slice(2)
  .flatMap((file) => readFileSync(file, 'utf8').split('\n'))
  .filter((line) => line.trim() !== '')
  .map((line) => JSON.parse(line) as Line)
if (lines.length < 2) throw new Error('need at least two spots')
const names = Object.keys(lines[0]?.nodes[0]?.candidates ?? {})
const total = (line: Line, pick: (node: Line['nodes'][number]) => number) =>
  line.nodes.reduce((sum, node) => sum + node.reached * pick(node), 0)
const first = (line: Line, pick: (node: Line['nodes'][number]) => number) =>
  pick(line.nodes[0] as Line['nodes'][number])
function summary(values: readonly number[]): string {
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length
  const spread = Math.sqrt(
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1),
  )
  const radius = (1.96 * spread) / Math.sqrt(values.length)
  const pct = (v: number) => `${(v * 100).toFixed(2)}%`
  return `${pct(mean)} (${pct(mean - radius)} to ${pct(mean + radius)})`
}
process.stdout.write(`${lines.length} spots; share of the pot given up\n`)
const rows: [string, (node: Line['nodes'][number]) => number][] = [
  ['reference', (node) => node.reference],
  ...names.map((name): [string, (node: Line['nodes'][number]) => number] => [
    name,
    (node) => node.candidates[name] as number,
  ]),
]
for (const [name, pick] of rows) {
  process.stdout.write(
    `${name.padEnd(12)} first two decisions ${summary(lines.map((line) => total(line, pick)))}; first decision ${summary(lines.map((line) => first(line, pick)))}\n`,
  )
}
const [base, ...rest] = names
for (const name of rest) {
  const diff = (line: Line) =>
    total(line, (node) => node.candidates[name] as number) -
    total(line, (node) => node.candidates[base as string] as number)
  process.stdout.write(`${name} minus ${base}, same spots: ${summary(lines.map(diff))}\n`)
}
