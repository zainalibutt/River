/**
 * Run a pipeline script under Blender, from npm, on whichever machine this is.
 *
 * Blender is not on PATH on the machine this project is built on - it lives at
 * an absolute path on a second drive - and `${RIVER_BLENDER:-blender}` in an npm
 * script is a bash expansion that npm hands to cmd.exe on Windows, where it is a
 * literal string and the spawn fails with a name nobody recognises. So the
 * default is resolved here instead, in the one runtime this repository already
 * depends on everywhere.
 *
 * --python-exit-code 1 is not optional and is not a parameter: without it
 * Blender exits 0 on an uncaught traceback, and a gate that cannot fail is not
 * a gate.
 *
 * Usage: node art/pipeline/run_blender.mjs <script.py> [args...]
 */
import { spawnSync } from 'node:child_process'

const [script, ...rest] = process.argv.slice(2)
if (script === undefined) {
  console.error('usage: node art/pipeline/run_blender.mjs <script.py> [args...]')
  process.exit(2)
}

const blender = process.env.RIVER_BLENDER ?? 'blender'
const result = spawnSync(
  blender,
  ['--background', '--python-exit-code', '1', '--python', script, ...rest],
  { stdio: 'inherit' },
)

if (result.error !== undefined && result.error !== null) {
  console.error(
    `\nCould not run Blender as ${JSON.stringify(blender)}: ${result.error.message}\n` +
      'Set RIVER_BLENDER to its absolute path, or put it on PATH.',
  )
  process.exit(127)
}
process.exit(result.status ?? 1)
