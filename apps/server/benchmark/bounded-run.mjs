import { spawn, spawnSync } from 'node:child_process'

const [command, ...args] = process.argv.slice(2)
if (!command) throw new Error('usage: node bounded-run.mjs <command> [args...]')
const child = spawn(command, args, {
  windowsHide: true,
  stdio: 'inherit',
  env: {
    ...process.env,
    OMP_NUM_THREADS: '1',
    OPENBLAS_NUM_THREADS: '1',
    UV_THREADPOOL_SIZE: '1',
    RIVER_VALUE_THREADS: '1',
    RAYON_NUM_THREADS: '1',
  },
})
const timeout = setTimeout(() => {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true })
  } else child.kill('SIGKILL')
  process.exitCode = 124
}, 540_000)
child.on('error', (error) => {
  clearTimeout(timeout)
  process.stderr.write(`${error.message}\n`)
  process.exitCode = 1
})
child.on('exit', (code) => {
  clearTimeout(timeout)
  process.exitCode = process.exitCode === 124 ? 124 : (code ?? 1)
})
