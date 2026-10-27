import { prepareExpanded } from './bot-turn-residual-expanded.js'

const args = process.argv.slice(2)
const positional: string[] = []
let teacherModel: string | undefined
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--teacher-model') {
    if (teacherModel !== undefined || !args[i + 1] || args[i + 1]?.startsWith('--'))
      throw new Error('provide --teacher-model <stem> once')
    teacherModel = args[++i]
  } else positional.push(args[i] as string)
}
const [c1Cache, out, bucket, ...c2] = positional
if (!c1Cache || !out || !bucket || !c2.length)
  throw new Error(
    'usage: <part-1-cache> <new-cache> <historical-bucket-stem> <c2-source> ... [--teacher-model <stem>]',
  )
prepareExpanded(c1Cache, out, c2, bucket, teacherModel)
