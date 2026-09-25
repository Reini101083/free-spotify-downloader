const { app, BrowserWindow, ipcMain, dialog, shell, session } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
let window, queue, store, engine, ffmpeg, youtube, safeToQuit = false
const health = { engine: false, ffmpeg: false }
const title = 'Free Spotify Downloader'

async function exists(file) { try { await fs.access(file); return true } catch { return false } }
function state() {
  return { version: app.getVersion(), folder: queue.folder, settings: queue.settings, jobs: queue.jobs, running: queue.running, health, youtubeReady: youtube?.ready() || false }
}
function broadcast() { if (window && !window.isDestroyed()) window.webContents.send('state-update', state()) }
async function persist() {
  await store.write({ folder: queue.folder, settings: queue.settings, jobs: queue.jobs })
}
function guard(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Unzulässiger Aufruf.')
}
function handle(channel, fn) { ipcMain.handle(channel, async (event, ...args) => { guard(event); return fn(...args) }) }
async function createWindow() {
  safeToQuit = false
  window = new BrowserWindow({ width: 1350, height: 920, minWidth: 740, minHeight: 620, title, icon: path.join(__dirname, '../build/icon.png'), backgroundColor: '#0e1119', autoHideMenuBar: true, show: false, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  window.once('ready-to-show', () => window.show())
  window.on('close', event => {
    if ((queue.active || queue.launching) && !safeToQuit) {
      const answer = dialog.showMessageBoxSync(window, { type: 'question', title: 'Download läuft', message: 'Download pausieren und App schließen?', detail: 'Du kannst die Warteschlange beim nächsten Start fortsetzen.', buttons: ['Weiter laden', 'Pausieren und schließen'], defaultId: 0, cancelId: 0 })
      if (answer === 0) { event.preventDefault(); return }
      queue.stopAll(); safeToQuit = true
    }
  })
  await window.loadFile(path.join(__dirname, '../web/index.html'))
}

app.setName(title)
const locked = app.requestSingleInstanceLock()
if (!locked) app.quit()
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus() } })
  app.whenReady().then(async () => {
    const { DownloadQueue } = await import(pathToFileURL(path.join(__dirname, '../shared/queue.mjs')))
    const domain = await import(pathToFileURL(path.join(__dirname, '../shared/domain.mjs')))
    const resources = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..')
    const engineDirectory = path.join(resources, app.isPackaged ? 'engine' : 'engine-dist')
    engine = path.join(engineDirectory, process.platform === 'win32' ? 'spotdl-engine.exe' : 'spotdl-engine')
    const engineArgs = []
    if (process.platform === 'win32' && !await exists(engine) && await exists(path.join(engineDirectory, 'python.exe'))) {
      engine = path.join(engineDirectory, 'python.exe')
      engineArgs.push('-I', '-B', path.join(engineDirectory, 'entry.py'))
    }
    ffmpeg = app.isPackaged ? path.join(resources, 'ffmpeg', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg') : require('ffmpeg-static')
    const denoDirectory = app.isPackaged ? path.join(resources, 'deno') : path.join(resources, 'node_modules', 'deno')
    process.env.PATH = denoDirectory + path.delimiter + (process.env.PATH || '')
    health.engine = await exists(engine) && (!engineArgs.length || await exists(engineArgs[2]))
    health.ffmpeg = !!ffmpeg && await exists(ffmpeg)
    const { AtomicStore } = await import(pathToFileURL(path.join(__dirname, '../shared/store.mjs')))
    store = new AtomicStore(path.join(app.getPath('userData'), 'workspace.json'))
    const saved = await store.read()
    const defaultFolder = path.join(app.getPath('music'), title)
    const folder = typeof saved.folder === 'string' && path.isAbsolute(saved.folder) ? saved.folder : defaultFolder
    await fs.mkdir(folder, { recursive: true }).catch(() => {})
    youtube = require('./youtube.cjs')(() => window, broadcast)
    await youtube.cleanup()
    queue = new DownloadQueue({ engine, engineArgs, ffmpeg, folder, settings: saved.settings, jobs: Array.isArray(saved.jobs) ? saved.jobs : [], prepareCookies: () => youtube.prepareCookies(), stateDirectory: path.join(app.getPath('userData'), 'sessions'), persist })
    queue.on('change', () => { broadcast(); void persist().catch(error => { if (window && !window.isDestroyed()) window.webContents.send('storage-error', error.message) }) })
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    session.defaultSession.setPermissionCheckHandler(() => false)
    handle('state', state)
    handle('youtube-open', async language => { const blocked = queue.jobs.find(job => job.status === 'blocked'); await youtube.open(blocked?.authUrl, language); return state() })
    handle('youtube-clear', async () => { if (queue.active || queue.launching) throw new Error('Bitte pausiere zuerst die Downloads.'); await youtube.clear(); broadcast(); return state() })
    handle('preferences', async value => { queue.settings = domain.preferences(value); await persist(); broadcast(); return state() })
    handle('choose-folder', async () => {
      const result = await dialog.showOpenDialog(window, { title: 'Musikordner wählen', defaultPath: queue.folder, properties: ['openDirectory', 'createDirectory'] })
      if (!result.canceled && result.filePaths[0]) { queue.folder = result.filePaths[0]; await persist(); broadcast() }
      return state()
    })
    handle('enqueue', async url => {
      const job = queue.enqueue(url)
      // Metadata enrichment is optional and never delays queue creation.
      fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(job.url)}`, { signal: AbortSignal.timeout(12000) }).then(response => response.ok ? response.json() : null).then(metadata => {
        if (metadata && typeof metadata.title === 'string') { job.title = metadata.title.slice(0,300); queue.changed() }
      }).catch(() => {})
      return state()
    })
    handle('start', async () => {
      if (!health.engine || !health.ffmpeg) throw new Error('Die Download-Komponenten fehlen. Bitte installiere ein vollständiges Desktop-Paket.')
      await fs.access(queue.folder, require('node:fs').constants.W_OK).catch(() => { throw new Error('Der Speicherordner ist nicht beschreibbar. Bitte wähle einen anderen Ordner.') })
      queue.start(); return state()
    })
    handle('cancel', id => { queue.cancel(id); return state() })
    handle('resume', id => { queue.resume(id); return state() })
    handle('remove', id => { queue.remove(id); return state() })
    handle('open-folder', async () => { const error = await shell.openPath(queue.folder); if (error) throw new Error('Der Ordner konnte nicht geöffnet werden.') })
    handle('external', async value => {
      if (typeof value !== 'string') throw new Error('Ungültiger Link.')
      let url
      if (value === domain.REPOSITORY || value === `${domain.REPOSITORY}/releases`) url = value
      else url = domain.spotifyLink(value).url
      await shell.openExternal(url)
    })
    await createWindow()
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow() })
  }).catch(error => { dialog.showErrorBox('App konnte nicht gestartet werden', error.message); app.quit() })
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
  app.on('before-quit', () => queue?.stopAll())
}
