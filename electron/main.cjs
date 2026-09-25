const { app, BrowserWindow, ipcMain, dialog, shell, session, clipboard, screen } = require('electron')
const fs = require('node:fs/promises')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { execFile } = require('node:child_process')
const { promisify } = require('node:util')
const runFile = promisify(execFile)
let window, queue, store, engine, engineArgs = [], ffmpeg, deno, youtube, safeToQuit = false
let uiLanguage = 'en', clipboardLinks, clipboardTimer, rendererReady = false
const health = { engine: false, ffmpeg: false, deno: false, checked: false }
let libraryFiles = new Map(), libraryBusy = false, libraryError = '', libraryRevision = 0
let publicLibrary, trustedLibrary
const title = 'Free Spotify Downloader'

async function exists(file) { try { await fs.access(file); return true } catch { return false } }
function state() {
  return { version: app.getVersion(), folder: queue.folder, settings: queue.settings, jobs: queue.jobs, running: queue.running, health, youtubeReady: youtube?.ready() || false, library: { files: publicLibrary ? publicLibrary([...libraryFiles.values()]) : [], loading: libraryBusy, error: libraryError, revision: libraryRevision } }
}
function broadcast() { if (window && !window.isDestroyed()) window.webContents.send('state-update', state()) }
async function persist() {
  await store.write({ folder: queue.folder, settings: queue.settings, jobs: queue.jobs })
}
function guard(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) throw new Error('Invalid request.')
}
function handle(channel, fn) { ipcMain.handle(channel, async (event, ...args) => { guard(event); return fn(...args) }) }
async function createWindow() {
  safeToQuit = false
  rendererReady = false
  const area = screen.getPrimaryDisplay().workAreaSize
  window = new BrowserWindow({ width: Math.min(1280, area.width - 32), height: Math.min(860, area.height - 32), minWidth: 360, minHeight: Math.min(480, area.height - 32), title, icon: path.join(__dirname, '../build/icon.png'), backgroundColor: '#f5f5f7', autoHideMenuBar: true, show: false, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  require('./context-menu.cjs')(window, () => uiLanguage)
  window.on('focus', checkClipboard)
  window.once('ready-to-show', () => window.show())
  window.on('close', event => {
    if ((queue.active || queue.launching) && !safeToQuit) {
      const answer = dialog.showMessageBoxSync(window, { type: 'question', title: 'Download in progress', message: 'Pause downloads and close the app?', detail: 'Your queue will be ready to resume next time.', buttons: ['Keep downloading', 'Pause and close'], defaultId: 0, cancelId: 0 })
      if (answer === 0) { event.preventDefault(); return }
      queue.stopAll(); safeToQuit = true
    }
  })
  await window.loadFile(path.join(__dirname, '../web/index.html'))
}

function checkClipboard() {
  if (!rendererReady || !window || window.isDestroyed() || !window.isFocused() || !queue.settings.clipboard) return
  try {
    const link = clipboardLinks.read(clipboard.readText())
    if (link) window.webContents.send('clipboard-link', link)
  } catch { /* A locked clipboard must not interrupt the app. */ }
}

app.setName(title)
const locked = app.requestSingleInstanceLock()
if (!locked) app.quit()
else {
  app.on('second-instance', () => { if (window) { if (window.isMinimized()) window.restore(); window.focus() } })
  app.whenReady().then(async () => {
    const { DownloadQueue } = await import(pathToFileURL(path.join(__dirname, '../shared/queue.mjs')))
    const domain = await import(pathToFileURL(path.join(__dirname, '../shared/domain.mjs')))
    const { ClipboardLinks } = await import(pathToFileURL(path.join(__dirname, '../shared/clipboard.mjs')))
    clipboardLinks = new ClipboardLinks()
    const resources = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..')
    const engineDirectory = path.join(resources, app.isPackaged ? 'engine' : 'engine-dist')
    engine = path.join(engineDirectory, process.platform === 'win32' ? 'spotdl-engine.exe' : 'spotdl-engine')
    engineArgs = []
    if (process.platform === 'win32' && !await exists(engine) && await exists(path.join(engineDirectory, 'python.exe'))) {
      engine = path.join(engineDirectory, 'python.exe')
      engineArgs.push('-I', '-B', path.join(engineDirectory, 'entry.py'))
    }
    ffmpeg = app.isPackaged ? path.join(resources, 'ffmpeg', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg') : require('ffmpeg-static')
    const denoDirectory = app.isPackaged ? path.join(resources, 'deno') : path.join(resources, 'node_modules', 'deno')
    deno = path.join(denoDirectory, process.platform === 'win32' ? 'deno.exe' : 'deno')
    process.env.PATH = denoDirectory + path.delimiter + (process.env.PATH || '')
    health.engine = await exists(engine) && (!engineArgs.length || await exists(engineArgs[2]))
    health.ffmpeg = !!ffmpeg && await exists(ffmpeg)
    health.deno = await exists(deno)
    ;({ publicLibrary, trustedLibrary } = await import(pathToFileURL(path.join(__dirname, '../shared/library.mjs'))))
    const { AtomicStore } = await import(pathToFileURL(path.join(__dirname, '../shared/store.mjs')))
    store = new AtomicStore(path.join(app.getPath('userData'), 'workspace.json'))
    const saved = await store.read()
    const defaultFolder = path.join(app.getPath('downloads'), title)
    const previousDefault = path.join(app.getPath('music'), title)
    const folder = typeof saved.folder === 'string' && path.isAbsolute(saved.folder) && saved.folder !== previousDefault ? saved.folder : defaultFolder
    await fs.mkdir(folder, { recursive: true }).catch(() => {})
    youtube = require('./youtube.cjs')(() => window, async () => {
      broadcast()
      if (health.checked && !health.error && health.engine && health.ffmpeg && health.deno && queue.jobs.some(job => job.status === 'blocked' && job.blockReason !== 'rate_limit')) {
        for (const job of queue.jobs.filter(job => job.status === 'blocked' && job.blockReason !== 'rate_limit' && !queue.jobs.some(other => other.id !== job.id && other.url === job.url && ['queued', 'running'].includes(other.status)))) queue.resume(job.id)
        queue.start()
      }
    })
    await youtube.cleanup()
    queue = new DownloadQueue({ engine, engineArgs, ffmpeg, deno, folder, settings: saved.settings, jobs: Array.isArray(saved.jobs) ? saved.jobs : [], prepareCookies: () => youtube.prepareCookies(), stateDirectory: path.join(app.getPath('userData'), 'sessions'), persist })
    for (const job of queue.jobs) {
      try {
        const snapshot = JSON.parse(await fs.readFile(path.join(queue.stateDirectory, `${job.id}.json`), 'utf8'))
        if (Array.isArray(snapshot.tracks)) job.tracks = snapshot.tracks.map(track => ({ id: track.id, title: track.title, status: track.status || 'pending', error: track.error || '', file: track.file || null }))
      } catch { /* A new job may not have a checkpoint yet. */ }
      if (job.folder === previousDefault && !job.saved && !job.existing && !job.tracks.some(track => ['saved', 'existing'].includes(track.status))) job.folder = defaultFolder
    }
    queue.on('change', () => { broadcast(); void persist().catch(error => { if (window && !window.isDestroyed()) window.webContents.send('storage-error', error.message) }) })
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    session.defaultSession.setPermissionCheckHandler(() => false)
    handle('state', state)
    handle('library', refreshLibrary)
    handle('pause-all', () => { queue.stopAll(); return state() })
    handle('open-song', async (key, reveal = false) => {
      const file = libraryFiles.get(key)
      if (!file || !await exists(file.path)) throw new Error('This file is no longer available. Refresh your saved songs.')
      if (reveal) shell.showItemInFolder(file.path)
      else { const error = await shell.openPath(file.path); if (error) throw new Error('The audio file could not be opened.') }
    })
    handle('copy-diagnostics', id => {
      const job = queue.jobs.find(item => item.id === id)
      if (!job) return
      const report = [`Free Spotify Downloader ${app.getVersion()}`, `${process.platform} ${process.arch}`, JSON.stringify(health), job.url, job.message, ...job.logs].join('\n').replaceAll(app.getPath('home'), '[user]')
      clipboard.writeText(report); return true
    })
    handle('ui-ready', language => { uiLanguage = typeof language === 'string' ? language : 'en'; rendererReady = true; checkClipboard() })
    handle('ui-language', language => { uiLanguage = typeof language === 'string' ? language : 'en' })
    handle('youtube-open', async language => { const blocked = queue.jobs.find(job => job.status === 'blocked'); await youtube.open(blocked?.authUrl, language); return state() })
    handle('youtube-clear', async () => { if (queue.active || queue.launching) throw new Error('Pause downloads first.'); await youtube.clear(); broadcast(); return state() })
    handle('preferences', async value => { queue.settings = domain.preferences(value); await persist(); broadcast(); checkClipboard(); return state() })
    handle('choose-folder', async () => {
      const result = await dialog.showOpenDialog(window, { title: 'Choose download folder', defaultPath: queue.folder, properties: ['openDirectory', 'createDirectory'] })
      if (!result.canceled && result.filePaths[0]) { queue.folder = result.filePaths[0]; libraryFiles.clear(); libraryRevision++; await persist(); broadcast() }
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
      if (!health.checked || health.error || !health.engine || !health.ffmpeg || !health.deno) throw new Error('Download components are missing. Please install a complete desktop package.')
      await fs.mkdir(queue.folder, { recursive: true }).then(async () => { const probe = await fs.mkdtemp(path.join(queue.folder, '.fsd-write-')); await fs.rmdir(probe) }).catch(() => { throw new Error('The download folder is not writable. Choose another folder in Settings.') })
      queue.start(); return state()
    })
    handle('cancel', id => { queue.cancel(id); return state() })
    handle('resume', (id, trackId) => { queue.resume(id, trackId); return state() })
    handle('remove', id => { queue.remove(id); return state() })
    handle('open-folder', async () => { const error = await shell.openPath(queue.folder); if (error) throw new Error('The folder could not be opened.') })
    handle('external', async value => {
      if (typeof value !== 'string') throw new Error('Invalid link.')
      let url
      if (value === domain.REPOSITORY || value === `${domain.REPOSITORY}/releases`) url = value
      else url = domain.spotifyLink(value).url
      await shell.openExternal(url)
    })
    await createWindow()
    void checkRuntime()
    clipboardTimer = setInterval(checkClipboard, 1000)
    clipboardTimer.unref()
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow() })
  }).catch(error => { dialog.showErrorBox('The app could not start', error.message); app.quit() })
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
  app.on('before-quit', () => { clearInterval(clipboardTimer); queue?.stopAll() })
}

async function checkRuntime() {
  if (!health.engine || !health.ffmpeg || !health.deno) { health.checked = true; broadcast(); return }
  try {
    const { stdout } = await runFile(engine, [...engineArgs, '--diagnostics', ffmpeg, deno], { windowsHide: true, timeout: 60000, maxBuffer: 1024 * 1024 })
    health.versions = JSON.parse(stdout.trim().split(/\r?\n/).at(-1)); health.error = ''
  } catch (error) { health.error = (error.stderr || error.message).slice(-1200) }
  health.checked = true; broadcast()
}

async function refreshLibrary() {
  if (libraryBusy) return state()
  libraryBusy = true; libraryError = ''; broadcast()
  const folder = queue.folder
  try {
    const { stdout } = await runFile(engine, [...engineArgs, '--library', folder], { windowsHide: true, timeout: 60000, maxBuffer: 16 * 1024 * 1024 })
    if (folder === queue.folder) { libraryFiles = trustedLibrary(JSON.parse(stdout), folder); libraryRevision++ }
  } catch { libraryError = 'Saved songs could not be checked. Check the folder and try again.' }
  finally { libraryBusy = false; broadcast() }
  return state()
}
