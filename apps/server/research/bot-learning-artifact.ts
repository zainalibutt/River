import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export function writeLearningArtifact(value: unknown, filename: string): string {
  if (!/^opponent-action-v[123]\.experimental\.json$/.test(filename)) {
    throw new Error('unsupported learning artifact name')
  }
  const source = dirname(fileURLToPath(import.meta.url))
  const output = resolve(source, '../models', filename)
  const biome = resolve(source, '../../../node_modules/@biomejs/biome/bin/biome')
  const content = execFileSync(process.execPath, [biome, 'format', `--stdin-file-path=${output}`], {
    input: `${JSON.stringify(value, null, 2)}\n`,
    encoding: 'utf8',
  })
  mkdirSync(dirname(output), { recursive: true })
  if (existsSync(output)) {
    if (JSON.stringify(JSON.parse(readFileSync(output, 'utf8'))) !== JSON.stringify(value)) {
      throw new Error('existing opponent-action artifact differs; inspect before replacing it')
    }
  } else {
    writeFileSync(output, content, { flag: 'wx' })
  }
  return output
}
