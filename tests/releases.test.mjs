import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PACKAGES, RELEASE_VERSION, packageFile, packageUrl, detectSystem, releaseVersions } from '../renderer/releases.mjs'
const release = version => ({ tag_name: `v${version}`, assets: PACKAGES.map(item => ({ name: packageFile(item, version), browser_download_url: packageUrl(item, version), size: 200_000_000, state: 'uploaded' })) })
test('release filenames match native Windows, Mac and Linux build output', () => {
  assert.equal(RELEASE_VERSION, JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version)
  assert.equal(packageFile(PACKAGES.find(item => item.id === 'linux-deb'), '0.1.1'), 'Free-Spotify-Downloader-0.1.1-linux-amd64.deb')
  assert.equal(packageFile(PACKAGES.find(item => item.id === 'mac-arm'), '0.1.1'), 'Free-Spotify-Downloader-0.1.1-mac-arm64.dmg')
  assert.throws(() => packageUrl(PACKAGES[0], '../../other'))
})
test('only public, complete releases with matching trusted asset URLs enter the selector', () => {
  const incomplete = release('0.1.0'); incomplete.assets.pop()
  const untrusted = release('0.2.0'); untrusted.assets[0].browser_download_url = 'https://example.com/app.exe'
  assert.deepEqual(releaseVersions([release('0.1.1'), release('0.1.10'), incomplete, untrusted, { ...release('2.0.0'), draft: true }, { ...release('3.0.0'), prerelease: true }]), ['0.1.10', '0.1.1'])
})
test('OS recommendation distinguishes desktop systems from mobile devices', () => {
  assert.equal(detectSystem('Windows', ''), 'windows')
  assert.equal(detectSystem('MacIntel', ''), 'mac')
  assert.equal(detectSystem('Linux x86_64', ''), 'linux')
  assert.equal(detectSystem('Linux', 'Android'), null)
  assert.equal(detectSystem('', ''), null)
})
