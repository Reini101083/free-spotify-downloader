import { cp, mkdir, rm } from 'node:fs/promises'
// Keep the root directory stable so preview file watchers survive rebuilds.
await rm('web/layout-check.html', { force: true })
await mkdir('web/vendor', { recursive: true })
await cp('renderer', 'web', { recursive: true })
await cp('shared/domain.mjs', 'web/domain.mjs')
await cp('node_modules/lucide/dist/umd/lucide.js', 'web/vendor/lucide.js')
console.log('Web frontend built in web/.')
