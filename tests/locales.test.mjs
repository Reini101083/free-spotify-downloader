import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { STRINGS } from '../renderer/strings.mjs'
const catalog = name => readFile(new URL(`../renderer/locales/${name}.json`,import.meta.url),'utf8').then(JSON.parse)
test('every selectable language has a complete bundled catalog with intact placeholders', async () => {
  const languages=await catalog('languages');assert.ok(languages.length>=79);assert.equal(new Set(languages.map(item=>item.code)).size,languages.length)
  for(const {code} of languages){const values=await catalog(code);assert.deepEqual(Object.keys(values).sort(),[...STRINGS].sort(),code);for(const text of STRINGS){assert.ok(values[text]?.trim(),`${code}: ${text}`);assert.deepEqual((values[text].match(/\{\w+\}/g)||[]).sort(),(text.match(/\{\w+\}/g)||[]).sort(),`${code}: ${text}`)}}
})
