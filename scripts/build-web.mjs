import { cp, mkdir, rm, readdir, readFile, writeFile } from 'node:fs/promises'
// Keep the root directory stable so preview file watchers survive rebuilds.
await rm('web/layout-check.html', { force: true })
await mkdir('web/vendor', { recursive: true })
await cp('renderer', 'web', { recursive: true })
await cp('build/icon.png', 'web/app-icon.png')
await cp('shared/domain.mjs', 'web/domain.mjs')
await cp('node_modules/lucide/dist/umd/lucide.js', 'web/vendor/lucide.js')
for (const name of await readdir('renderer/locales')) {
  if (name.endsWith('.json')) {
    const value = JSON.parse(await readFile(`renderer/locales/${name}`, 'utf8'))
    await writeFile(`web/locales/${name.replace(/\.json$/, '.mjs')}`, `export default ${JSON.stringify(value)}\n`)
  }
}
console.log('Web frontend built in web/.')
