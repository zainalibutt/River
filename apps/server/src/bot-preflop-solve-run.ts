import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { bestResponseCertificate, comboBestResponseValues } from './bot-preflop-solve-br.js'
import { PreflopTrainer } from './bot-preflop-solve-cfr.js'
import { loadOrGenerateEquity } from './bot-preflop-solve-equity.js'
import { gridDump, makePack } from './bot-preflop-solve-output.js'
import {
  DEFAULT_HAND_REALISATION,
  isHandRealisation,
  parseRealisation,
} from './bot-preflop-solve-realisation.js'
import { DEFAULT_REALISATION, preflopTree } from './bot-preflop-solve-tree.js'

function numberArg(args: readonly string[], flag: string, fallback: number): number {
  const i = args.indexOf(flag)
  const value = i < 0 ? fallback : Number(args[i + 1])
  if (!Number.isFinite(value) || value <= 0) throw new Error(`invalid ${flag}`)
  return value
}
function localPath(path: string): string {
  const absolute = resolve(path)
  const rel = relative(process.cwd(), absolute)
  if (rel.startsWith('..') || isAbsolute(rel))
    throw new Error('output must stay inside the worktree')
  return absolute
}
function stringArg(args: readonly string[], flag: string): string | undefined {
  const i = args.indexOf(flag)
  if (i < 0) return undefined
  if (!args[i + 1] || args[i + 1]?.startsWith('--')) throw new Error(`missing ${flag}`)
  return args[i + 1]
}
/** One depth per bounded invocation; equity is generated once and reused across both packs. */
export function runPreflop(args = process.argv.slice(2)): void {
  const budgetStarted = performance.now()
  const depth = numberArg(args, '--depth', 100)
  const samples = numberArg(args, '--samples', 8192)
  const seed = numberArg(args, '--seed', 0x51a7c0de)
  const maxIterations = numberArg(args, '--iterations', 10000)
  const maxSeconds = Math.min(480, numberArg(args, '--seconds', 240))
  const target = numberArg(args, '--target', 0.0075)
  const configPath = stringArg(args, '--realisation')
  const treeVersion = stringArg(args, '--tree') ?? 'v3'
  if (treeVersion !== 'v2' && treeVersion !== 'v3') throw new Error('invalid --tree')
  const flat = args.includes('--flat')
  if (flat && configPath) throw new Error('--flat and --realisation are mutually exclusive')
  if (!flat && (args.includes('--ip') || args.includes('--oop')))
    throw new Error('--ip/--oop require --flat')
  const factors = parseRealisation(
    configPath
      ? JSON.parse(readFileSync(localPath(configPath), 'utf8'))
      : flat
        ? {
            ip: numberArg(args, '--ip', DEFAULT_REALISATION.ip),
            oop: numberArg(args, '--oop', DEFAULT_REALISATION.oop),
          }
        : DEFAULT_HAND_REALISATION,
  )
  const outputDir = localPath(
    stringArg(args, '--output-dir') ??
      (isHandRealisation(factors)
        ? `apps/server/preflop/${treeVersion}`
        : 'out/preflop-solve/flat'),
  )
  const legacyDir = localPath('apps/server/preflop/v1')
  const legacyRelative = relative(legacyDir, outputDir)
  if (legacyRelative === '' || (!legacyRelative.startsWith('..') && !isAbsolute(legacyRelative)))
    throw new Error('v1 packs are preserved; choose a different output directory')
  const table = loadOrGenerateEquity(
    localPath(`out/preflop-solve/equity-v1-${samples}.json`),
    samples,
    seed,
    Math.min(480, maxSeconds),
  )
  const started = performance.now()
  const tree = preflopTree(depth, treeVersion)
  const trainer = new PreflopTrainer(tree, table, factors)
  const checkpoints: {
    iterations: number
    seconds: number
    exploitabilityBb: number
  }[] = []
  let certificate = bestResponseCertificate(tree, table, trainer.average(), factors)
  while (
    trainer.iterations < maxIterations &&
    (performance.now() - budgetStarted) / 1000 < maxSeconds
  ) {
    trainer.step(Math.min(100, maxIterations - trainer.iterations))
    certificate = bestResponseCertificate(tree, table, trainer.average(), factors)
    const checkpoint = {
      iterations: trainer.iterations,
      seconds: (performance.now() - started) / 1000,
      exploitabilityBb: certificate.exploitabilityBb,
    }
    checkpoints.push(checkpoint)
    process.stdout.write(`${JSON.stringify(checkpoint)}\n`)
    if (certificate.exploitabilityBb <= target) break
  }
  const strategy = trainer.average()
  const comboBestResponse = comboBestResponseValues(tree, table, strategy, factors)
  if (
    comboBestResponse.some(
      (v, p) => Math.abs(v - (certificate.bestResponseValueBb[p] as number)) > 1e-8,
    )
  )
    throw new Error('combo/class BR disagreement')
  const seconds = (performance.now() - started) / 1000
  const pack = makePack({
    depth,
    tree,
    table,
    factors,
    strategy,
    iterations: trainer.iterations,
    seconds,
    certificate,
    comboBestResponse,
    target,
    checkpoints,
    treeVersion,
  })
  const path = localPath(resolve(outputDir, `${depth}bb.json`))
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(pack, null, 2)}\n`)
  writeFileSync(
    localPath(resolve(outputDir, `${depth}bb.txt`)),
    gridDump(depth, tree, strategy, pack.version),
  )
  process.stdout.write(
    `${JSON.stringify({ depth, iterations: trainer.iterations, seconds, certificate, headlines: pack.headlines, output: path, targetMet: pack.metadata.solver.targetMet })}\n`,
  )
  if (!pack.metadata.solver.targetMet) process.exitCode = 2
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  runPreflop()
