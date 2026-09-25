import test from 'node:test'
import assert from 'node:assert/strict'
import { ClipboardLinks } from '../shared/clipboard.mjs'
import { preferences } from '../shared/domain.mjs'

test('clipboard accepts only Spotify links, ignores repeat tracking variants and remembers no unrelated text', () => {
  const clipboard = new ClipboardLinks()
  const url = 'https://open.spotify.com/playlist/1234567890123456789012'
  assert.equal(clipboard.read(url + '?si=one'), url)
  assert.equal(clipboard.read(url + '?si=two'), null)
  assert.equal(clipboard.read('unrelated private text'), null)
  assert.equal(clipboard.last, null)
  assert.equal(clipboard.read('https://open.spotify.com.evil.test/playlist/1234567890123456789012'), null)
  assert.equal(clipboard.read(url), url)
  assert.equal(preferences({ clipboard: false }).clipboard, false)
  assert.equal(preferences().clipboard, true)
})
