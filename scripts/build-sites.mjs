import { cp, rm } from 'node:fs/promises'
await rm('dist', { recursive: true, force: true })
await cp('web', 'dist', { recursive: true })
// The confirmation toolbar belongs to the desktop window only.
for (const file of ['youtube.html','youtube.css','youtube.mjs']) await rm(`dist/${file}`, { force: true })
console.log('Sites static output built in dist/.')
