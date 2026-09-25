const { BrowserWindow, WebContentsView, session, ipcMain, app } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const { randomUUID } = require('node:crypto')

// A dedicated, in-memory session: no cookies from the user's normal browser.
// Remote content never receives a preload script, Node, or the app IPC bridge.
module.exports = function youtubeAccess(parent, onReady) {
  const isolated = session.fromPartition('youtube-manual')
  let window, view, approved = false
  const exportsDirectory = path.join(app.getPath('userData'), 'temporary-cookies')
  isolated.setPermissionRequestHandler((_contents, _permission, done) => done(false))
  isolated.setPermissionCheckHandler(() => false)
  isolated.on('will-download', event => event.preventDefault())
  function allowed(value) {
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && ['www.youtube.com','youtube.com','music.youtube.com','accounts.google.com','consent.youtube.com','consent.google.com','www.google.com'].includes(url.hostname) } catch { return false }
  }
  function guard(event) {
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Invalid confirmation window')
  }
  ipcMain.handle('youtube-confirm', async event => {
    guard(event)
    approved = true
    window.close()
    onReady()
  })
  ipcMain.handle('youtube-close', event => { guard(event); window.close() })
  return {
    ready: () => approved,
    async cleanup() { await fs.rm(exportsDirectory, { recursive: true, force: true }) },
    async open(value = 'https://www.youtube.com/', language = 'de') {
      if (window && !window.isDestroyed()) { window.focus(); return }
      window = new BrowserWindow({ parent: parent(), width: 1050, height: 820, minWidth: 650, minHeight: 500, title: 'YouTube · Free Spotify Downloader', autoHideMenuBar: true, backgroundColor: '#151a17', webPreferences: { preload: path.join(__dirname, 'youtube-preload.cjs'), sandbox: true, nodeIntegration: false, contextIsolation: true } })
      view = new WebContentsView({ webPreferences: { session: isolated, sandbox: true, nodeIntegration: false, contextIsolation: true, webSecurity: true } })
      window.contentView.addChildView(view)
      const fit = () => { const [width, height] = window.getContentSize(); view.setBounds({ x: 0, y: 108, width, height: Math.max(0, height - 108) }) }
      fit(); window.on('resize', fit)
      window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
      window.webContents.on('will-navigate', event => event.preventDefault())
      for (const eventName of ['will-navigate','will-redirect']) view.webContents.on(eventName, (event, destination) => { if (!allowed(destination)) event.preventDefault() })
      view.webContents.setWindowOpenHandler(({ url }) => { if (allowed(url)) void view.webContents.loadURL(url).catch(() => {}); return { action: 'deny' } })
      view.webContents.on('did-navigate', (_event, url) => { if (window && !window.isDestroyed()) window.webContents.send('youtube-origin', new URL(url).origin) })
      view.webContents.on('did-fail-load', (_event, code) => { if (code !== -3 && window && !window.isDestroyed()) window.webContents.send('youtube-load-error') })
      window.on('closed', () => { view?.webContents.close(); window = null; view = null })
      await window.loadFile(path.join(__dirname, '../web/youtube.html'), { query: { language: language === 'en' ? 'en' : 'de' } })
      await view.webContents.loadURL(allowed(value) ? value : 'https://www.youtube.com/').catch(() => {})
    },
    async prepareCookies() {
      if (!approved) return null
      const cookies = (await isolated.cookies.get({})).filter(cookie => /(^|\.)youtube\.com$/.test(cookie.domain.replace(/^\./, '')))
      if (!cookies.length) return null
      await fs.mkdir(exportsDirectory, { recursive: true, mode: 0o700 })
      const file = path.join(exportsDirectory, `${randomUUID()}.txt`)
      const rows = cookies.map(cookie => [cookie.httpOnly ? `#HttpOnly_${cookie.domain}` : cookie.domain, cookie.domain.startsWith('.') ? 'TRUE' : 'FALSE', cookie.path || '/', cookie.secure ? 'TRUE' : 'FALSE', cookie.session ? '0' : String(Math.floor(cookie.expirationDate || 0)), cookie.name, cookie.value].map(value => String(value).replace(/[\t\r\n]/g, '')).join('\t'))
      await fs.writeFile(file, '# Netscape HTTP Cookie File\n' + rows.join('\n') + '\n', { mode: 0o600 })
      return { file, release: () => fs.rm(file, { force: true }) }
    },
    async clear() { approved = false; if (window) window.close(); await isolated.clearStorageData(); await fs.rm(exportsDirectory, { recursive: true, force: true }) },
  }
}
