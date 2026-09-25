import { spawnSync } from 'node:child_process'
import { readdir } from 'node:fs/promises'
for (const directory of ['electron', 'renderer', 'shared', 'scripts', 'tests']) {
  for (const file of await readdir(directory)) {
    if (!/\.(mjs|cjs)$/.test(file)) continue
    const result = spawnSync(process.execPath, ['--check', `${directory}/${file}`], { stdio: 'inherit' })
    if (result.status) process.exit(result.status)
  }
}
console.log('JavaScript syntax checks passed.')
