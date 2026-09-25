import { t, translatePage, getLanguage, setLanguage, LANGUAGES, languageName } from './i18n.mjs'
import { preferences, spotifyLink } from './domain.mjs'
import { initializeDownloads } from './downloads.mjs'
const $ = selector => document.querySelector(selector)
const bridge = window.desktop
let view = 'queue', selectedId = null, detailId = null, pendingClipboardLink = null, limit = 50, toastTimer, embedId = null, previousRunning = false, refreshTimer, previewSequence = 0
let state = { jobs: [], settings: preferences(), running: false, folder: '', health: {}, library: { files: [], loading: false, error: '', revision: 0 } }
const statuses = { queued:'Ready', running:'Downloading', completed:'Saved', failed:'Failed', partial:'Some songs missing', paused:'Paused', blocked:'Confirmation needed', preview:'Preview' }
const node = (tag, className, text) => { const result = document.createElement(tag); if (className) result.className = className; if (text !== undefined) result.textContent = text; return result }
const icon = name => { const result = node('i'); result.dataset.lucide = name; return result }
const icons = () => window.lucide?.createIcons({ attrs: { 'aria-hidden': 'true', 'stroke-width': 1.8 } })
const number = value => new Intl.NumberFormat(getLanguage()).format(value)
function toast(message) { $('#toast').textContent = t(message); $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('#toast').hidden = true }, 5000) }
async function action(callback) { try { return await callback() } catch (error) { toast(error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')); return null } }
function update(value) {
  if (!value) return
  const finished = previousRunning && !value.running
  state = value; previousRunning = value.running
  render()
  if (finished && bridge) { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => void action(async () => update(await bridge.library())), 400) }
}
function button(label, symbol, callback) {
  const result = node('button', 'button icon'); result.type = 'button'; result.title = t(label); result.setAttribute('aria-label', t(label)); result.append(icon(symbol)); result.addEventListener('click', () => void action(callback)); return result
}
function missingSongs() { return state.jobs.flatMap(job => (job.tracks || []).filter(track => ['skipped','blocked'].includes(track.status)).map(track => ({ ...track, job }))) }
function updateView(next) { view = next; limit = 50; $('#song-search').value = ''; render(); if (view === 'saved' && bridge) void action(async () => update(await bridge.library())) }
function markSelected() {
  for (const row of document.querySelectorAll('.job-row')) {
    const selected=row.dataset.job===selectedId
    row.classList.toggle('preview-selected',selected)
    row.querySelector('.row-title')?.setAttribute('aria-pressed',String(selected))
  }
}
function setSelected(job, { load = state.settings.preview } = {}) {
  if (!job) return
  selectedId = job.id
  if (embedId !== job.id) { $('#embed-container').replaceChildren(); embedId = null }
  markSelected(); renderPreview()
  if (load) loadPreview()
}
function renderPreview() {
  const job = state.jobs.find(job => job.id === selectedId)
  $('#preview-button').disabled = !job
  $('#preview-placeholder').hidden = !!embedId
  $('#preview-job-title').textContent = job?.title || t('Start a download to load its Spotify preview here.')
  $('#preview-job-title').removeAttribute('data-i18n')
  $('#spotify-link').hidden = !job
  if (job) $('#spotify-link').href = job.url
}
function loadPreview({ force = false } = {}) {
  const job = state.jobs.find(job => job.id === selectedId)
  if (!job || (!force && embedId === job.id)) return
  const frame = document.createElement('iframe'); frame.src = spotifyLink(job.url).embed; frame.title = t('Spotify preview'); frame.allow = 'encrypted-media; fullscreen; picture-in-picture'; frame.referrerPolicy = 'no-referrer'
  $('#embed-container').replaceChildren(frame); embedId = job.id; renderPreview()
}
function validInput() { try { return spotifyLink($('#spotify-url').value) } catch { return null } }
async function addLink() {
  const link = validInput()
  if (!link) { $('#input-error').textContent = t('Please paste a valid Spotify link.'); $('#input-error').hidden = false; $('#spotify-url').setAttribute('aria-invalid','true'); $('#spotify-url').focus(); return null }
  let job
  if (bridge) { update(await bridge.enqueue(link.url)); job = state.jobs.find(job => job.url === link.url && ['queued','running'].includes(job.status)) }
  else { job = state.jobs.find(job => job.url === link.url); if (!job) { job = { id: `preview-${++previewSequence}`, url: link.url, type: link.type, title: `Spotify ${t(link.label)}`, status:'preview', settings:{...state.settings}, tracks:[], logs:[], saved:0 }; state.jobs.unshift(job) } }
  $('#spotify-url').value = ''; $('#input-error').hidden = true; $('#spotify-url').removeAttribute('aria-invalid'); updateView('queue'); setSelected(job); toast('Added to your queue.'); return job
}
async function start() {
  if (!bridge) { $('#desktop-card').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block:'center' }); $('#desktop-card').focus({preventScroll:true}); return }
  if (state.running) { update(await bridge.pauseAll()); return }
  if (validInput()) await addLink()
  const first = [...state.jobs].reverse().find(job => job.status === 'queued')
  if (first) setSelected(first)
  update(await bridge.start())
}
async function retry(job, trackId = null) { setSelected(job); update(await bridge.resume(job.id, trackId)); update(await bridge.start()) }
function rowShell(title, symbol, failed = false) {
  const item = node('li', 'song-row'); const art = node('span', 'row-symbol' + (failed ? ' failed' : '')); art.append(icon(symbol)); const copy = node('div','row-copy'); copy.append(node('strong','', title)); const controls = node('div','row-actions'); item.append(art,copy,controls); return {item,copy,controls}
}
function renderJobs(list) {
  for (const job of state.jobs.slice(0,limit)) {
    const {item,copy,controls} = rowShell(job.title, job.type === 'track' ? 'music-2' : 'list-music', job.status === 'failed')
    item.className = 'job-row'; item.dataset.job = job.id
    const select = node('button','row-title'); select.append(copy.firstChild); copy.prepend(select); select.setAttribute('aria-pressed',String(selectedId===job.id)); select.addEventListener('click', () => setSelected(job,{load:true})); item.classList.toggle('preview-selected',selectedId===job.id); item.addEventListener('click',event=>{if(!event.target.closest('button,a,input,select'))setSelected(job,{load:true})})
    copy.append(node('span','subtle', `${t(spotifyLink(job.url).label)} · ${job.settings.format.toUpperCase()}`), node('span',`row-status ${job.status}`, t(statuses[job.status] || 'Ready')))
    if (bridge && ['queued','running'].includes(job.status)) {
      const pause=button(job.cancelled?'Pausing…':'Pause downloads','pause',async()=>update(await bridge.cancel(job.id)))
      pause.disabled=!!job.cancelled; pause.setAttribute('aria-label',`${t(job.cancelled?'Pausing…':'Pause downloads')}: ${job.title}`); pause.title=pause.getAttribute('aria-label'); controls.append(pause)
    } else if (bridge) controls.append(button(job.status==='paused'?'Resume':'Retry',job.status==='paused'?'play':'rotate-ccw', () => retry(job)))
    controls.append(button('Details','more-horizontal', () => { detailId = job.id; renderDetails(); $('#details-dialog').showModal() }))
    if (job.status !== 'running') controls.append(button('Remove','x', async () => { if (bridge) update(await bridge.remove(job.id)); else { state.jobs = state.jobs.filter(item => item.id !== job.id); render() } }))
    if (job.message) item.append(node('p','row-message'+(job.status === 'failed' ? ' error' : ''), translateMessage(job.message)))
    if (job.status === 'running') { const progress = node('progress'); progress.max = 100; if (Number.isFinite(job.progress)) progress.value = job.progress; progress.setAttribute('aria-label', t('Download progress')); item.append(progress) }
    list.append(item)
  }
}
function translateMessage(message) {
  const counts = /^(\d+) saved · (\d+) existing · (\d+) not downloaded$/.exec(message)
  return counts ? t('{saved} saved · {existing} existing · {skipped} not downloaded',{saved:counts[1],existing:counts[2],skipped:counts[3]}) : t(message)
}
function renderSaved(list) {
  const query = $('#song-search').value.toLocaleLowerCase(getLanguage())
  const files = state.library.files.filter(file => (file.title+' '+file.name).toLocaleLowerCase(getLanguage()).includes(query))
  for (const file of files.slice(0,limit)) {
    const {item,copy,controls} = rowShell(file.title,'music-2')
    const duration = `${Math.floor(file.duration/60)}:${String(file.duration%60).padStart(2,'0')}`
    copy.append(node('span','subtle',`${file.format} · ${duration} · ${(file.size/1024/1024).toFixed(1)} MB`))
    controls.append(button('Play','play', () => bridge.openSong(file.key,false)), button('Show in folder','folder-open', () => bridge.openSong(file.key,true))); list.append(item)
  }
  return files.length
}
function errorSummary(value) {
  if (!value?.trim()) return t('No details were returned by the audio provider.')
  if (/No results found|No matching audio source/i.test(value)) return t('No matching audio source')
  if (/captcha|sign in to confirm|not a bot/i.test(value)) return t('YouTube needs your confirmation.')
  if (/429|too many requests/i.test(value)) return t('YouTube is limiting requests. Wait before trying again.')
  return t(value).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'').replace(/\s+/g,' ').slice(0,350)
}
function renderFailed(list) {
  const songs = missingSongs()
  for (const track of songs.slice(0,limit)) {
    const {item,copy,controls} = rowShell(track.title,'rotate-ccw', true)
    copy.append(node('span','subtle',errorSummary(track.error)))
    controls.append(button('Retry this song','rotate-ccw', () => retry(track.job,track.id)), button('Details','more-horizontal', () => { detailId=track.job.id; renderDetails(); $('#details-dialog').showModal() }))
    list.append(item)
  }
  return songs.length
}
function renderDetails() {
  const job = state.jobs.find(job => job.id === detailId)
  if (!job) return
  $('#detail-title').textContent = job.title
  $('#detail-message').textContent = translateMessage(job.message || 'Existing files are checked before downloading again.')
  $('#job-log').textContent = job.logs?.join('\n') || t('No messages yet.')
  $('#detail-counts').replaceChildren(...['saved','not downloaded'].map((key,index) => node('span','',t('{count} '+key,{count:number(index ? (job.tracks || []).filter(track=>['skipped','blocked'].includes(track.status)).length : (job.tracks || []).filter(track=>['saved','existing'].includes(track.status)).length)}))))
  $('#copy-diagnostics').hidden = !bridge
}
function render() {
  $('#mode').removeAttribute('data-i18n'); $('#mode').textContent=t(bridge?'Desktop app':'Web preview')
  const missing = missingSongs().length
  $('#nav-queue-count').textContent = number(state.jobs.length); $('#nav-saved-count').textContent = state.library.revision ? number(state.library.files.length) : '—'; $('#nav-failed-count').textContent = number(missing)
  for (const control of document.querySelectorAll('[data-view]')) { control.classList.toggle('selected',control.dataset.view===view); control.setAttribute('aria-pressed',String(control.dataset.view===view)) }
  const titles = {queue:'Download queue',saved:'Your saved songs',failed:'Songs to try again'}
  $('#collection-title').removeAttribute('data-i18n'); $('#collection-title').textContent = t(titles[view])
  $('#collection-subtitle').textContent = view==='queue' ? state.running ? t('Working on your music') : t('{count} downloads',{count:number(state.jobs.length)}) : view==='saved' ? t('Only complete, verified audio files appear here.') : t('Downloads continue when a song fails. You can retry these songs individually or together.')
  $('#start-button').hidden = view!=='queue'; $('#refresh-library').hidden = view!=='saved'; $('#retry-failed').hidden = view!=='failed'
  $('#start-button span').removeAttribute('data-i18n'); $('#start-button span').textContent = t(!bridge ? 'Download app' : state.running ? 'Pause downloads' : 'Start downloads') + (bridge && state.running ? ' · '+t('All downloads') : '')
  $('#start-button').disabled = !!bridge && !state.running && ((!state.jobs.some(job=>job.status==='queued') && !validInput()) || !state.health.engine || !state.health.ffmpeg || !state.health.deno || !!state.health.error || !state.health.checked)
  $('#refresh-library').disabled = !bridge || state.library.loading; $('#retry-failed').disabled = !bridge || !missing || state.running; $('#song-search').hidden = view!=='saved'
  const list = $('#collection-list'); const focused = document.activeElement?.closest('[data-job]')?.dataset.job; const focusedLabel = document.activeElement?.getAttribute('aria-label'); list.replaceChildren()
  let count = view==='queue' ? state.jobs.length : view==='saved' ? renderSaved(list) : renderFailed(list)
  if (view==='queue') renderJobs(list)
  if (focused && focusedLabel) [...list.querySelectorAll('[data-job]')].find(item=>item.dataset.job===focused)?.querySelectorAll('button').forEach(button=>{if(button.getAttribute('aria-label')===focusedLabel)button.focus({preventScroll:true})})
  $('#empty-state').hidden = count>0
  const emptyTitle = view==='queue' ? 'Your queue is empty' : view==='saved' ? state.library.loading ? 'Checking your files…' : $('#song-search').value ? 'No songs match your search' : 'No songs saved yet' : 'Everything is up to date'
  const emptyDescription = view==='queue' ? 'Copy a Spotify link or paste it here to get started.' : view==='saved' ? $('#song-search').value ? 'Change your search and try again.' : 'Completed audio files will appear here. Temporary files never count as saved songs.' : 'Songs that could not be downloaded will appear here with a reason.'
  $('#empty-title').textContent = t(emptyTitle); $('#empty-description').textContent = t(state.library.error && view==='saved' ? state.library.error : emptyDescription)
  $('#show-more').hidden = count<=limit
  $('#collection-footer').textContent = view==='saved' ? t('{count} songs',{count:number(count)}) : t('Existing files are checked before downloading again.')
  $('#open-folder').disabled = !bridge
  const blocked = state.jobs.find(job=>job.status==='blocked'); $('#auth-banner').hidden = !bridge || !blocked
  if (blocked) { const rate=blocked.blockReason==='rate_limit'; $('#auth-title').textContent=t(rate?'YouTube is limiting requests. Wait before trying again.':'YouTube needs your confirmation.'); $('#auth-text').textContent=t(rate?'Try again later':'Downloads are paused. Complete the check in the YouTube window, then choose “Use session and resume”.'); $('#auth-open').hidden=rate }
  $('#recovery-banner').hidden = !bridge || state.running || !state.jobs.some(job=>job.status==='paused')
  $('#format').value=state.settings.format; $('#bitrate').value=state.settings.bitrate; $('#bitrate').disabled=['flac','wav'].includes(state.settings.format)
  $('#clipboard-enabled').checked=state.settings.clipboard; $('#clipboard-enabled').disabled=!bridge; $('#preview-enabled').checked=state.settings.preview
  $('#output-short').textContent=state.settings.format.toUpperCase()+(state.settings.bitrate==='auto'||$('#bitrate').disabled?'':` · ${state.settings.bitrate.slice(0,-1)} kbps`)
  $('#folder-short').textContent=state.folder?.split(/[\\/]/).at(-1)||t('Download folder'); $('#folder-shortcut').title=state.folder||t('Choose folder'); $('#settings-folder').textContent=state.folder||t('This website is a preview. Audio downloads run in the desktop app.')
  $('#youtube-state').textContent=t(state.youtubeReady?'Session ready':'You can complete a requested YouTube check in the app. Confirmation does not guarantee access.'); $('#youtube-clear').disabled=!bridge||state.running
  $('#engine-state').textContent=t(!bridge?'This website is a preview. Audio downloads run in the desktop app.':!state.health.checked?'Checking components…':state.health.engine&&state.health.ffmpeg&&state.health.deno&&!state.health.error?'Ready for downloads':'A download component needs attention.')
  $('#runtime-log').textContent=state.health.error||JSON.stringify(state.health.versions||{},null,2); $('#runtime-details').hidden=!bridge
  $('#current-language').textContent=getLanguage().toUpperCase(); $('#language-button').title=languageName(getLanguage())
  if (!state.jobs.some(job=>job.id===selectedId)) { selectedId=null;embedId=null;$('#embed-container').replaceChildren() }
  renderPreview(); if ($('#details-dialog').open) renderDetails(); translatePage(); icons()
}
function acceptClipboard(link) { $('#spotify-url').value=link;$('#input-error').hidden=true;$('#spotify-url').removeAttribute('aria-invalid');pendingClipboardLink=null;$('#clipboard-prompt').hidden=true;toast('Spotify link pasted. Ready to add.');render() }
function applyTheme(value) {
  const mode=['system','light','dark'].includes(value)?value:'system'
  const dark=mode==='dark'||mode==='system'&&matchMedia('(prefers-color-scheme: dark)').matches
  document.documentElement.dataset.theme=dark?'dark':'light'
  $('#theme').value=mode
  $('#theme-toggle').setAttribute('aria-checked',String(dark))
  try{localStorage.setItem('fsd-theme',mode)}catch{}
}
let theme='system';try{theme=localStorage.getItem('fsd-theme')||theme}catch{};applyTheme(theme)
matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>applyTheme($('#theme').value))
$('#theme').addEventListener('change',()=>applyTheme($('#theme').value))
$('#theme-toggle').addEventListener('click',()=>applyTheme(document.documentElement.dataset.theme==='dark'?'light':'dark'))
function renderLanguages() {
  const search=$('#language-search').value.toLocaleLowerCase();const list=$('#language-list');list.replaceChildren()
  for(const language of LANGUAGES){const native=languageName(language.code);if(!`${native} ${language.name} ${language.code}`.toLocaleLowerCase().includes(search))continue;const item=node('button','language-option'+(getLanguage()===language.code?' selected':''));const copy=node('span');copy.append(node('strong','',native),node('small','',language.name));item.append(copy);item.lang=language.code;if(getLanguage()===language.code)item.append(icon('check'));item.addEventListener('click',()=>void action(async()=>{await setLanguage(language.code);if(bridge)await bridge.language(language.code);$('#language-dialog').close();render()}));list.append(item)}icons()
}
$('#language-button').addEventListener('click',()=>{$('#language-search').value='';renderLanguages();$('#language-dialog').showModal();$('#language-search').focus()})
$('#language-search').addEventListener('input',renderLanguages)
for(const control of document.querySelectorAll('[data-close]'))control.addEventListener('click',()=>document.getElementById(control.dataset.close).close())
for(const control of document.querySelectorAll('[data-settings]'))control.addEventListener('click',()=>$('#settings-dialog').showModal())
for(const control of document.querySelectorAll('[data-view]'))control.addEventListener('click',()=>updateView(control.dataset.view))
$('#import-form').addEventListener('submit',event=>{event.preventDefault();void action(addLink)})
$('#spotify-url').addEventListener('input',()=>{$('#input-error').hidden=true;if($('#spotify-url').value.trim()===pendingClipboardLink){pendingClipboardLink=null;$('#clipboard-prompt').hidden=true}render()})
$('#clipboard-accept').addEventListener('click',()=>{if(pendingClipboardLink)acceptClipboard(pendingClipboardLink)})
$('#start-button').addEventListener('click',()=>void action(start))
$('#preview-button').addEventListener('click',()=>loadPreview({force:true}))
$('#refresh-library').addEventListener('click',()=>void action(async()=>update(await bridge.library())))
$('#song-search').addEventListener('input',()=>{limit=50;render()})
$('#show-more').addEventListener('click',()=>{limit+=50;render()})
$('#retry-failed').addEventListener('click',()=>void action(async()=>{for(const job of [...new Set(missingSongs().map(track=>track.job))])update(await bridge.resume(job.id));await start()}))
$('#resume-all').addEventListener('click',()=>void action(async()=>{for(const job of state.jobs.filter(job=>job.status==='paused'))update(await bridge.resume(job.id));await start()}))
$('#auth-resume').addEventListener('click',()=>void action(async()=>{for(const job of state.jobs.filter(job=>job.status==='blocked'))update(await bridge.resume(job.id));await start()}))
for(const button of document.querySelectorAll('[data-youtube]'))button.addEventListener('click',()=>void action(async()=>{if(bridge)update(await bridge.youtubeOpen(getLanguage()));else toast('This website is a preview. Audio downloads run in the desktop app.')}))
$('#youtube-clear').addEventListener('click',()=>void action(async()=>{update(await bridge.youtubeClear());toast('Cookie session cleared.')}))
const chooseFolder=()=>action(async()=>{if(bridge){update(await bridge.chooseFolder());if(view==='saved')update(await bridge.library())}else toast('This website is a preview. Audio downloads run in the desktop app.')})
$('#choose-folder').addEventListener('click',chooseFolder);$('#folder-shortcut').addEventListener('click',chooseFolder)
$('#open-folder').addEventListener('click',()=>void action(()=>bridge.openFolder()))
$('#copy-diagnostics').addEventListener('click',()=>void action(async()=>{await bridge.copyDiagnostics(detailId);toast('Diagnostics copied.')}))
for(const control of [$('#format'),$('#bitrate'),$('#clipboard-enabled'),$('#preview-enabled')])control.addEventListener('change',()=>void action(async()=>{const settings=preferences({format:$('#format').value,bitrate:$('#bitrate').value,clipboard:$('#clipboard-enabled').checked,preview:$('#preview-enabled').checked});if(!settings.clipboard){pendingClipboardLink=null;$('#clipboard-prompt').hidden=true}if(bridge)update(await bridge.savePreferences(settings));else{state.settings=settings;render()}}))
for(const link of document.querySelectorAll('a.external'))if(bridge)link.addEventListener('click',event=>{event.preventDefault();void action(()=>bridge.external(link.href))})
document.addEventListener('language-changed',render)
if(bridge){$('#mode').removeAttribute('data-i18n');$('#mode').textContent=t('Desktop app');$('#desktop-card').hidden=true;$('#top-download').hidden=true;$('#preview-mode-note').hidden=true;bridge.subscribe(update);bridge.onStorageError(()=>toast('Your queue could not be saved.'));await action(async()=>{update(await bridge.state());$('#version').textContent=`v${state.version}`});bridge.onClipboardLink(link=>{try{link=spotifyLink(link).url}catch{return}if(!state.settings.clipboard||$('#spotify-url').value.trim()===link)return;if(!$('#spotify-url').value.trim())acceptClipboard(link);else{pendingClipboardLink=link;$('#clipboard-prompt').hidden=false}});await action(()=>bridge.ready(getLanguage()));void action(async()=>update(await bridge.library()))}
else initializeDownloads()
render()
