export const REPOSITORY = 'https://github.com/Reini101083/free-spotify-downloader'
export const RELEASE_VERSION = '0.2.3'
export const PACKAGES = [
  { id: 'windows-setup', os: 'windows', label: 'Windows installer', suffix: 'windows-x64-setup.exe', extension: '.exe', primary: true },
  { id: 'windows-portable', os: 'windows', label: 'Windows portable', suffix: 'windows-x64-portable.exe', extension: '.exe' },
  { id: 'mac-arm', os: 'mac', label: 'Mac · Apple Silicon', suffix: 'mac-arm64.dmg', extension: '.dmg' },
  { id: 'mac-intel', os: 'mac', label: 'Mac · Intel', suffix: 'mac-x64.dmg', extension: '.dmg' },
  { id: 'linux-appimage', os: 'linux', label: 'Linux · AppImage', suffix: 'linux-x86_64.AppImage', extension: '.AppImage', primary: true },
  { id: 'linux-deb', os: 'linux', label: 'Linux · Debian / Ubuntu', suffix: 'linux-amd64.deb', extension: '.deb' },
]
export function packageFile(item, version = RELEASE_VERSION) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid release version')
  return `Free-Spotify-Downloader-${version}-${item.suffix}`
}
export function packageUrl(item, version = RELEASE_VERSION) {
  return `${REPOSITORY}/releases/download/v${version}/${packageFile(item, version)}`
}
export function detectSystem(platform = '', userAgent = '') {
  if (/Android|iPhone|iPad|iPod/i.test(userAgent)) return null
  const source = `${platform} ${userAgent}`
  if (/Win/i.test(source)) return 'windows'
  if (/Mac/i.test(source)) return 'mac'
  if (/Linux/i.test(source)) return 'linux'
  return null
}
export function releaseVersions(releases) {
  if (!Array.isArray(releases)) return []
  return releases.flatMap(release => {
    const version = /^v(\d+\.\d+\.\d+)$/.exec(release.tag_name || '')?.[1]
    if (!version || release.draft || release.prerelease || !Array.isArray(release.assets)) return []
    const available = new Set(release.assets.filter(asset => asset.state === 'uploaded' && asset.size > 0 && asset.browser_download_url === `${REPOSITORY}/releases/download/v${version}/${asset.name}`).map(asset => asset.name))
    return PACKAGES.every(item => available.has(packageFile(item, version))) ? [version] : []
  }).sort((a, b) => { const aa = a.split('.').map(Number), bb = b.split('.').map(Number); return bb[0] - aa[0] || bb[1] - aa[1] || bb[2] - aa[2] })
}
