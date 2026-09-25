import { PACKAGES, RELEASE_VERSION, REPOSITORY, packageFile, packageUrl, detectSystem, releaseVersions } from './releases.mjs'
import { t } from './i18n.mjs'

export function initializeDownloads() {
  const system = document.querySelector('#download-system')
  const version = document.querySelector('#download-version')
  const packages = document.querySelector('#download-package')
  const button = document.querySelector('#download-app')
  const help = document.querySelector('#download-help')
  const filename = document.querySelector('#download-file')
  system.value = detectSystem(navigator.userAgentData?.platform || navigator.platform, navigator.userAgent) || 'windows'
  let versionChanged = false
  const update = () => {
    button.querySelector('span').removeAttribute('data-i18n')
    const item = PACKAGES.find(item => item.id === packages.value && item.os === system.value)
    help.textContent = system.value === 'mac' ? t('Apple menu → About This Mac: look for Apple Silicon or Intel.') : system.value === 'windows' ? t('Installer: standard installation. Portable: run without installing. Both are for 64-bit Intel / AMD.') : t('AppImage works on many Linux distributions. DEB is for Debian and Ubuntu. Both are x86_64.')
    button.setAttribute('aria-disabled', String(!item))
    if (item) {
      button.href = packageUrl(item, version.value)
      button.querySelector('span').textContent = t('Download app')
      filename.textContent = packageFile(item, version.value)
    } else {
      button.removeAttribute('href')
      button.querySelector('span').textContent = t('Choose your Mac chip')
      filename.textContent = t('Choose Apple Silicon or Intel.')
    }
  }
  const selectSystem = () => {
    packages.replaceChildren()
    if (system.value === 'mac') packages.append(new Option(t('Choose your Mac chip'), ''))
    for (const item of PACKAGES.filter(item => item.os === system.value)) packages.append(new Option(t(item.label), item.id))
    update()
  }
  document.addEventListener('language-changed', () => { const value = packages.value; selectSystem(); packages.value = value; update() })
  system.addEventListener('change', selectSystem)
  packages.addEventListener('change', update)
  version.addEventListener('change', () => { versionChanged = true; update() })
  button.addEventListener('click', event => { if (button.getAttribute('aria-disabled') === 'true') event.preventDefault() })
  selectSystem()
  // Published fallback links still work if GitHub's public API is rate-limited.
  void fetch('https://api.github.com/repos/Reini101083/free-spotify-downloader/releases?per_page=30', {
    credentials: 'omit', referrerPolicy: 'no-referrer', signal: AbortSignal.timeout(7000), headers: { Accept: 'application/vnd.github+json' },
  }).then(response => response.ok ? response.json() : []).then(releases => {
    const available = releaseVersions(releases)
    if (!available.length) return
    const selected = version.value
    version.replaceChildren(...available.map(value => new Option(`v${value}`, value)))
    version.value = versionChanged && available.includes(selected) ? selected : available[0] || RELEASE_VERSION
    update()
  }).catch(() => {})
}
