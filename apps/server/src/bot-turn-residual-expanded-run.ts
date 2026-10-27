import { prepareExpanded } from './bot-turn-residual-expanded.js'

const [c1Cache, out, bucket, ...c2] = process.argv.slice(2)
if (!c1Cache || !out || !bucket || !c2.length)
  throw new Error('usage: <part-1-cache> <new-cache> <historical-bucket-stem> <c2-source> ...')
prepareExpanded(c1Cache, out, c2, bucket)
