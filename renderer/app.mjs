import { translate, translatePage, getLanguage, setLanguage } from './i18n.mjs'
import { preferences, spotifyLink } from './domain.mjs'
import { initializeDownloads } from './downloads.mjs'
const $ = selector => document.querySelector(selector)
const bridge = window.desktop
let previewSequence = 0
let pendingClipboardLink = null
let filter = 'all', selectedId = null, toastTimer, state = { jobs: [], settings: preferences(), running: false, folder: '', health: {} }
const statuses = { queued: 'Bereit', running: 'Läuft', completed: 'Gespeichert', failed: 'Fehlgeschlagen', cancelled: 'Abgebrochen', partial: 'Teilweise', preview: 'Vorschau', paused: 'Pausiert', blocked: 'Bestätigung nötig' }
const icons = () => window.lucide?.createIcons({ attrs: { 'aria-hidden': 'true', 'stroke-width': 1.7 } })
const element = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node }
function toast(message) { $('#toast').textContent = translate(message); $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true }, 4500) }
async function action(callback) { try { return await callback() } catch (error) { toast(error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')); return null } }
function update(value) { if (value) state = value; render() }

function render() {
  const jobs = state.jobs.filter(job => filter === 'all' || filter === 'active' && ['queued', 'running', 'paused'].includes(job.status) || filter === 'completed' && ['completed','partial'].includes(job.status))
  $('#queue-count').textContent = String(state.jobs.length)
  $('.counter-label').textContent = state.jobs.length === 1 ? 'Auftrag' : 'Aufträge'
  $('#empty-state').hidden = jobs.length > 0
  $('#empty-state h3').textContent = state.jobs.length ? 'Hier ist es noch ruhig.' : 'Platz für deine Musik.'
  $('#empty-state p').textContent = state.jobs.length ? 'In diesem Filter sind gerade keine Aufträge.' : 'Füge oben einen Spotify-Link ein. Deine Auswahl erscheint hier.'
  const list = $('#queue-list')
  const focusedId = document.activeElement?.closest('[data-job]')?.dataset.job
  const focusedAction = document.activeElement?.dataset.action
  list.replaceChildren()
  for (const job of jobs) {
    const item = element('li', `job ${selectedId === job.id ? 'is-selected' : ''}`); item.dataset.job = job.id
    const select = element('button', 'job-select'); select.dataset.action = 'select'; select.setAttribute('aria-pressed', String(selectedId === job.id)); select.setAttribute('aria-controls', 'details')
    const symbol = element('span', 'job-symbol'); const icon = element('i'); icon.dataset.lucide = job.type === 'track' ? 'music-2' : 'list-music'; symbol.append(icon)
    const text = element('span', 'job-text'); text.append(element('strong', '', job.title), element('span', '', `${spotifyLink(job.url).label} · ${job.settings.format.toUpperCase()}${job.settings.bitrate === 'auto' ? '' : ` · ${job.settings.bitrate.replace('k','')} kbps`}`))
    select.append(symbol, text); select.addEventListener('click', () => selectJob(job.id)); item.append(select)
    const badge = element('span', `job-status status-${job.status}`, statuses[job.status]); item.append(badge)
    const running = ['queued','running'].includes(job.status)
    const button = element('button', 'icon-button'); button.dataset.action = running ? 'cancel' : 'remove'; button.setAttribute('aria-label', running ? `${job.title} pausieren` : `${job.title} entfernen`)
    const controlIcon = element('i'); controlIcon.dataset.lucide = running ? 'pause' : 'trash-2'; button.append(controlIcon)
    button.addEventListener('click', () => action(async () => { if (bridge) update(await bridge[running ? 'cancel' : 'remove'](job.id)); else { state.jobs = state.jobs.filter(item => item.id !== job.id); render() } }))
    if (bridge && !running && job.status !== 'preview') {
      const retry = element('button', 'icon-button'); retry.dataset.action = 'resume'
      retry.setAttribute('aria-label', `${job.title} fortsetzen`); retry.title = translate('Fortsetzen')
      const retryIcon = element('i'); retryIcon.dataset.lucide = 'rotate-cw'; retry.append(retryIcon)
      retry.addEventListener('click', () => action(async () => { update(await bridge.resume(job.id)); update(await bridge.start()) }))
      item.append(retry)
    }
    item.append(button)
    if (['running', 'failed', 'blocked'].includes(job.status)) { const message = element('span', 'job-message', job.message); item.append(message); if (Number.isFinite(job.progress)) { const progress = element('progress', 'job-progress'); progress.max = 100; progress.value = job.progress; progress.setAttribute('aria-label', 'Fortschritt des aktuellen Titels'); item.append(progress) } }
    list.append(item)
  }
  if (focusedId && focusedAction) [...list.querySelectorAll('[data-job]')].find(node => node.dataset.job === focusedId)?.querySelector(`[data-action="${focusedAction}"]`)?.focus({ preventScroll: true })
  $('#auth-banner').hidden = !bridge || !state.jobs.some(job => job.status === 'blocked')
  $('#youtube-clear').disabled = !bridge || state.running
  $('#youtube-state').textContent = state.youtubeReady ? 'Die YouTube-Sitzung ist für Downloads in dieser App-Sitzung freigegeben.' : 'Bei einer CAPTCHA kannst du YouTube in einem eigenen App-Fenster öffnen und die Bestätigung selbst lösen.'
  $('#recovery-banner').hidden = !bridge || !state.jobs.some(job => job.status === 'paused')
  const queued = state.jobs.filter(job => job.status === 'queued').length
  $('#start-button').disabled = !!bridge && (!queued || state.running || !state.health.engine || !state.health.ffmpeg)
  $('#start-button span').textContent = bridge ? 'Starten' : 'App herunterladen'
  $('#queue-status').textContent = state.running ? 'Deine Auswahl wird verarbeitet' : queued ? `${queued} ${queued === 1 ? 'Auftrag wartet' : 'Aufträge warten'}` : 'Bereit für deine Musik'
  const saved = state.jobs.reduce((sum, job) => sum + (job.saved || 0), 0)
  $('#saved-count').textContent = saved ? `${saved} ${saved === 1 ? 'Datei gespeichert' : 'Dateien gespeichert'}` : 'Noch keine Dateien gespeichert'
  $('#format').value = state.settings.format; $('#bitrate').value = state.settings.bitrate
  $('#clipboard-enabled').checked = state.settings.clipboard
  $('#clipboard-enabled').disabled = !bridge
  $('#bitrate').disabled = ['flac','wav'].includes(state.settings.format)
  $('#format-visual').textContent = state.settings.format.toUpperCase()
  $('#quality-visual').textContent = $('#bitrate').disabled ? 'Quellqualität bleibt entscheidend' : state.settings.bitrate === 'auto' ? 'Automatische Bitrate' : `${state.settings.bitrate.replace('k','')} kbps`
  $('#folder-label').textContent = state.folder || 'In der Desktop-App wählen'; $('#folder-label').title = state.folder
  $('#settings-folder').textContent = state.folder || 'Der Speicherordner lässt sich in der Desktop-App festlegen.'
  if (bridge) $('#engine-state').textContent = state.health.engine && state.health.ffmpeg ? 'Download-Engine und Audiokonverter sind bereit.' : 'Download-Komponenten fehlen. Bitte installiere ein vollständiges Desktop-Paket.'
  const job = state.jobs.find(item => item.id === selectedId)
  if (job) { $('#detail-title').textContent = job.title; $('#detail-message').textContent = job.message || 'Vorschau ausgewählt.'; $('#job-log').textContent = job.logs?.join('\n') || 'Noch keine Meldungen.' }
  else { $('#details').hidden = true; $('#embed-container').replaceChildren(); selectedId = null }
  icons()
  translatePage()
}
function selectJob(id) {
  selectedId = id
  $('#embed-container').replaceChildren(); $('#preview-button').disabled = false
  $('#details').hidden = false
  $('#log-details').open = state.jobs.some(job => job.id === id && ['failed', 'partial'].includes(job.status))
  render()
}

function acceptClipboard(link) {
  $('#spotify-url').value = link
  $('#spotify-url').removeAttribute('aria-invalid')
  $('#input-error').hidden = true
  pendingClipboardLink = null
  $('#clipboard-prompt').hidden = true
  toast('Spotify-Link automatisch eingefügt. Bereit zum Hinzufügen.')
}
$('#clipboard-accept').addEventListener('click', () => { if (pendingClipboardLink) acceptClipboard(pendingClipboardLink) })
$('#spotify-url').addEventListener('input', () => {
  if ($('#spotify-url').value.trim() === pendingClipboardLink) { pendingClipboardLink = null; $('#clipboard-prompt').hidden = true }
})

$('#import-form').addEventListener('submit', event => {
  event.preventDefault(); $('#input-error').hidden = true; $('#spotify-url').removeAttribute('aria-invalid')
  void action(async () => {
    let link
    try { link = spotifyLink($('#spotify-url').value) } catch (error) { $('#input-error').textContent = error.message; $('#input-error').hidden = false; $('#spotify-url').setAttribute('aria-invalid','true'); $('#spotify-url').focus(); return }
    if (bridge) { const value = await bridge.enqueue(link.url); update(value); selectJob(value.jobs[0].id) }
    else {
      const existing = state.jobs.find(job => job.url === link.url)
      const job = existing || { id: `preview-${Date.now()}-${++previewSequence}`, url: link.url, type: link.type, title: `Spotify ${link.label}`, settings: { ...state.settings }, status: 'preview', message: 'Web-Vorschau. Audiodownloads sind in der Desktop-App verfügbar.', logs: [] }
      if (!existing) state.jobs.unshift(job)
      selectJob(job.id)
    }
    $('#spotify-url').value = ''; toast(bridge ? 'Zur Warteschlange hinzugefügt.' : 'Link zur Vorschau hinzugefügt.')
  })
})
for (const button of document.querySelectorAll('[data-youtube]')) button.addEventListener('click', () => action(async () => { if (!bridge) { toast('YouTube-Bestätigung ist in der Desktop-App verfügbar.'); return } update(await bridge.youtubeOpen(getLanguage())) }))
$('#youtube-clear').addEventListener('click', () => action(async () => update(await bridge.youtubeClear())))
$('#auth-resume').addEventListener('click', () => action(async () => { for (const job of state.jobs.filter(item => item.status === 'blocked')) update(await bridge.resume(job.id)); update(await bridge.start()) }))
$('#language').value = getLanguage()
$('#language').addEventListener('change', () => { setLanguage($('#language').value); if (bridge) void action(() => bridge.language(getLanguage())); render() })
$('#resume-all').addEventListener('click', () => action(async () => { for (const job of state.jobs.filter(item => item.status === 'paused')) update(await bridge.resume(job.id)); update(await bridge.start()) }))
$('#start-button').addEventListener('click', () => {
  if (bridge) void action(async () => update(await bridge.start()))
  else { $('#desktop-card').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'center' }); $('#desktop-card').focus({ preventScroll: true }) }
})
for (const control of [$('#format'), $('#bitrate'), $('#clipboard-enabled')]) control.addEventListener('change', () => action(async () => {
  const value = preferences({ format: $('#format').value, bitrate: $('#bitrate').value, clipboard: $('#clipboard-enabled').checked })
  if (!value.clipboard) { pendingClipboardLink = null; $('#clipboard-prompt').hidden = true }
  if (bridge) update(await bridge.savePreferences(value))
  else { state.settings = value; try { localStorage.setItem('fsd-preferences-v1', JSON.stringify(value)) } catch { /* storage may be disabled */ } render() }
}))
const chooseFolder = () => action(async () => { if (bridge) update(await bridge.chooseFolder()); else toast('Den Speicherort wählst du in der Desktop-App.') })
$('#folder-button').addEventListener('click', chooseFolder); $('#settings-choose-folder').addEventListener('click', chooseFolder)
for (const button of document.querySelectorAll('[data-filter]')) button.addEventListener('click', () => { filter = button.dataset.filter; for (const item of document.querySelectorAll('[data-filter]')) { item.classList.toggle('selected', item === button); item.setAttribute('aria-pressed', String(item === button)) } render() })
for (const button of document.querySelectorAll('[data-settings]')) button.addEventListener('click', () => $('#settings-dialog').showModal())
$('#close-settings').addEventListener('click', () => $('#settings-dialog').close())
$('#close-details').addEventListener('click', () => { selectedId = null; render() })
$('#preview-button').addEventListener('click', () => { const job = state.jobs.find(item => item.id === selectedId); if (!job) return; const frame = document.createElement('iframe'); frame.src = spotifyLink(job.url).embed; frame.title = 'Spotify-Vorschau'; frame.allow = 'encrypted-media; fullscreen; picture-in-picture'; frame.referrerPolicy = 'no-referrer'; frame.loading = 'lazy'; $('#embed-container').replaceChildren(frame); $('#preview-button').disabled = true })
$('#spotify-button').addEventListener('click', () => action(async () => { const job = state.jobs.find(item => item.id === selectedId); if (!job) return; if (bridge) await bridge.external(job.url); else window.open(job.url, '_blank', 'noopener,noreferrer') }))
$('#open-folder-button').addEventListener('click', () => action(() => bridge.openFolder()))
for (const link of document.querySelectorAll('a.external')) if (bridge) link.addEventListener('click', event => { event.preventDefault(); void action(() => bridge.external(link.href)) })
if (bridge) {
  $('#top-download').hidden = true
  $('#mode').textContent = 'Desktop-App'; $('#add-button span').textContent = 'Hinzufügen'
  $('#mode-hint').textContent = 'Spotify liefert Titelinformationen. Audio stammt aus passenden Quellen; speichere nur Inhalte mit Erlaubnis.'
  $('#desktop-card').hidden = true; $('#open-folder-button').hidden = false
  bridge.subscribe(update)
  bridge.onStorageError(() => toast('Warteschlange konnte nicht gespeichert werden.'))
  await action(async () => { update(await bridge.state()); $('#version').textContent = `v${state.version}` })
  bridge.onClipboardLink(link => {
    try { link = spotifyLink(link).url } catch { return }
    if (!state.settings.clipboard || $('#spotify-url').value.trim() === link) return
    if (!$('#spotify-url').value.trim()) acceptClipboard(link)
    else { pendingClipboardLink = link; $('#clipboard-prompt').hidden = false }
  })
  await action(() => bridge.ready(getLanguage()))
} else {
  initializeDownloads()
  try { state.settings = preferences(JSON.parse(localStorage.getItem('fsd-preferences-v1') || '{}')) } catch { /* use defaults */ }
  $('#log-details').hidden = true
}
render()
