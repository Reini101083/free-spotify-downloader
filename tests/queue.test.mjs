import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter, once } from 'node:events'
import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DownloadQueue } from '../shared/queue.mjs'
import { AtomicStore } from '../shared/store.mjs'
import { spotifyLink, MAX_OPEN_DOWNLOADS, queuedDownloads } from '../shared/domain.mjs'
const link = 'https://open.spotify.com/track/1234567890123456789012'
const other = 'https://open.spotify.com/track/abcdefghijklmnopqrstuv'
const flush = () => new Promise(resolve => setImmediate(resolve))
function setup(extra = {}) {
  const children = []
  const queue = new DownloadQueue({ engine: '/engine', ffmpeg: '/ffmpeg', folder: '/music', stateDirectory: '/state', spawnProcess: (_bin, args, options) => { const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.args = args; child.options = options; children.push(child); return child }, ...extra })
  return { queue, children }
}
function output(child, value) { child.stdout.emit('data', Buffer.from('FSD_EVENT ' + JSON.stringify(value) + '\n')) }
test('only canonical Spotify metadata links enter the engine', () => {
  assert.equal(spotifyLink(link + '?si=abc').url, link)
  for (const value of ['https://open.spotify.com.evil.test/track/1234567890123456789012', 'file:///etc/passwd', 'https://user@open.spotify.com/track/1234567890123456789012', link + ';touch /tmp/x']) assert.throws(() => spotifyLink(value))
})
test('crashed running jobs restore paused with their original folder and options', () => {
  const { queue } = setup(); const job = queue.enqueue(link); job.status = 'running'; job.folder = '/original'
  const restored = setup({ jobs: queue.jobs }).queue
  assert.equal(restored.jobs[0].status, 'paused'); assert.equal(restored.jobs[0].folder, '/original')
  restored.resume(job.id); assert.equal(restored.jobs[0].status, 'queued')
})
test('persist completes before starting engine, uses argument arrays and no shell', async () => {
  let saved = false
  const { queue, children } = setup({ persist: async () => { await flush(); saved = true } })
  queue.enqueue(link); queue.start(); assert.equal(children.length, 0); await flush(); await flush()
  assert.equal(saved, true); assert.equal(children.length, 1); assert.equal(children[0].options.shell, false)
  assert.equal(children[0].args[children[0].args.indexOf('--url') + 1], link)
  children[0].emit('close', 1)
})
test('all-existing is completed, not a false failure; split structured lines work', async () => {
  const { queue, children } = setup(); queue.enqueue(link); queue.start(); await flush()
  const payload = 'FSD_EVENT ' + JSON.stringify({ type: 'summary', saved: 0, existing: 3, skipped: 0 }) + '\n'
  children[0].stdout.emit('data', payload.slice(0, 17)); children[0].stdout.emit('data', payload.slice(17)); children[0].emit('close', 0)
  assert.equal(queue.jobs[0].status, 'completed'); assert.equal(queue.jobs[0].existing, 3)
})
test('embedded Windows Python receives a separate script argument even with spaces', async () => {
  const script = 'C:\\Program Files\\Free Spotify Downloader\\engine\\entry.py'
  const { queue, children } = setup({ engineArgs: ['-I', '-B', script] })
  queue.enqueue(link); queue.start(); await flush()
  assert.deepEqual(children[0].args.slice(0, 4), ['-I', '-B', script, '--session'])
  assert.equal(children[0].options.shell, false)
  children[0].emit('close', 1)
})
test('unavailable tracks produce a partial result and next queued job starts', async () => {
  const { queue, children } = setup(); const first = queue.enqueue(link); queue.enqueue(other); queue.start(); await flush()
  output(children[0], { type: 'summary', saved: 2, existing: 0, skipped: 1 }); children[0].emit('close', 0); await flush()
  assert.equal(first.status, 'partial'); assert.equal(first.skipped, 1); assert.equal(children.length, 2)
  children[1].emit('close', 1); assert.equal(queue.jobs[0].status, 'failed')
})
test('zero exit without verified summary never reports success', async () => {
  const { queue, children } = setup(); const job = queue.enqueue(link); queue.start(); await flush(); children[0].emit('close', 0)
  assert.equal(job.status, 'failed')
})
test('metadata errors stay actionable in the queue and preserve provider details', async () => {
  const { queue, children } = setup(); const job = queue.enqueue(link); queue.start(); await flush()
  output(children[0], { type: 'status', message: 'Spotify-Titelliste wird geladen …' })
  assert.equal(job.message, 'Spotify-Titelliste wird geladen …')
  output(children[0], { type: 'error', code: 'SPOTIFY_METADATA', message: 'Playlist nicht erreichbar.', detail: 'HTTP 403' })
  children[0].emit('close', 1)
  assert.equal(job.status, 'failed'); assert.equal(job.message, 'Playlist nicht erreichbar.')
  assert.match(job.logs.join('\n'), /HTTP 403/)
})
test('failed durable write prevents downloading and leaves a recoverable job', async () => {
  const { queue, children } = setup({ persist: async () => { throw new Error('disk full') } }); const job = queue.enqueue(link); queue.start(); await flush()
  assert.equal(children.length, 0); assert.equal(job.status, 'failed'); assert.equal(queue.running, false)
})
test('pausing while persistence is pending never launches a process', async () => {
  let release; const wait = new Promise(resolve => { release = resolve })
  const { queue, children } = setup({ persist: () => wait }); const job = queue.enqueue(link); queue.start(); queue.cancel(job.id); release(); await flush()
  assert.equal(children.length, 0); assert.equal(job.status, 'paused')
})
test('atomic store survives concurrent changes with the final complete snapshot', async () => {
  const folder = await mkdtemp(path.join(os.tmpdir(), 'fsd-test-')); const store = new AtomicStore(path.join(folder, 'workspace.json'))
  await Promise.all(Array.from({ length: 30 }, (_, index) => store.write({ index, jobs: [link] })))
  assert.deepEqual(await store.read(), { index: 29, jobs: [link] })
  assert.equal(JSON.parse(await readFile(store.file, 'utf8')).index, 29)
})

test('manual confirmation pauses the entire queue and releases temporary cookies', async () => {
  let released = false
  const { queue, children } = setup({ prepareCookies: async () => ({ file: '/private/cookies.txt', release: async () => { released = true } }) })
  const job = queue.enqueue(link); queue.enqueue(other); queue.start(); await flush()
  output(children[0], { type: 'auth', url: 'https://www.youtube.com/' }); children[0].emit('close', 0); await flush()
  assert.equal(job.status, 'blocked'); assert.equal(queue.running, false); assert.equal(children.length, 1); assert.equal(released, true)
  queue.resume(job.id); assert.equal(job.requiresAuth, false)
})

test('all missing songs are failed, retained for retry, and do not stop the next playlist', async () => {
  const { queue, children } = setup(); const first = queue.enqueue(link); queue.enqueue(other); queue.start(); await flush()
  output(children[0], { type:'track', id:'1'.repeat(22), index:1, total:1, title:'Missing', status:'skipped', error:'Source unavailable', skipped:1 })
  output(children[0], { type:'summary', saved:0, existing:0, skipped:1 }); children[0].emit('close', 0); await flush()
  assert.equal(first.status,'failed'); assert.equal(first.tracks[0].error,'Source unavailable'); assert.equal(children.length,2)
  children[1].emit('close',1)
  queue.resume(first.id, first.tracks[0].id); queue.start(); await flush()
  assert.equal(children[2].args.at(-1),first.tracks[0].id); assert.ok(children[2].args.includes('--only-track'))
  children[2].emit('close',1)
})
test('individual retry keeps partial status when earlier songs exist', async () => {
  const { queue, children } = setup(); const job=queue.enqueue(link); job.status='partial'; job.tracks=[{id:'1'.repeat(22),status:'saved'},{id:'2'.repeat(22),status:'skipped'}]
  queue.resume(job.id,'2'.repeat(22)); queue.start(); await flush()
  output(children[0],{type:'summary',saved:0,existing:0,skipped:1});children[0].emit('close',0)
  assert.equal(job.status,'partial')
})

test('pausing one running playlist starts the next and ignores late worker authentication events', async () => {
  const {queue,children}=setup();const first=queue.enqueue(link);const second=queue.enqueue(other)
  queue.start();await flush();queue.cancel(first.id)
  output(children[0],{type:'auth',url:'https://www.youtube.com/'})
  children[0].emit('close',1);await flush()
  assert.equal(first.status,'paused');assert.equal(second.status,'running');assert.equal(queue.running,true)
  output(children[0],{type:'auth',url:'https://www.youtube.com/'})
  assert.equal(queue.running,true);assert.equal(queue.active.job.id,second.id)
  children[1].emit('close',1)
})
test('pausing a waiting playlist leaves the active playlist alone', async () => {
  const {queue,children}=setup();const first=queue.enqueue(link);const second=queue.enqueue(other)
  queue.start();await flush();queue.cancel(second.id)
  assert.equal(first.status,'running');assert.equal(second.status,'paused');assert.equal(queue.active.job.id,first.id);assert.equal(queue.running,true)
  output(children[0],{type:'summary',saved:1,existing:0,skipped:0});children[0].emit('close',0);await flush()
  assert.equal(first.status,'completed');assert.equal(second.status,'paused');assert.equal(children.length,1)
})
test('global pause stops every playlist and resume retains FIFO order and the original session',async()=>{
  const {queue,children}=setup();const first=queue.enqueue(link);const second=queue.enqueue(other)
  queue.start();await flush();queue.stopAll();children[0].emit('close',1);await flush()
  assert.equal(first.status,'paused');assert.equal(second.status,'paused');assert.equal(queue.running,false);assert.equal(children.length,1)
  for(const job of queue.jobs.filter(job=>job.status==='paused'))queue.resume(job.id)
  queue.start();await flush();assert.equal(queue.active.job.id,first.id);assert.equal(children.length,2)
  assert.equal(children[1].args[children[1].args.indexOf('--session')+1],children[0].args[children[0].args.indexOf('--session')+1])
  output(children[1],{type:'summary',saved:0,existing:1,skipped:0});children[1].emit('close',0);await flush()
  assert.equal(first.status,'completed');assert.equal(queue.active.job.id,second.id);assert.equal(children.length,3)
  children[2].emit('close',1)
})
test('a final summary without a newline is processed before closing',async()=>{
  const {queue,children}=setup();const job=queue.enqueue(link);queue.start();await flush()
  children[0].stdout.emit('data',Buffer.from('FSD_EVENT '+JSON.stringify({type:'summary',saved:1,existing:0,skipped:0})))
  children[0].emit('close',0);assert.equal(job.status,'completed')
})

const playlist = index => `https://open.spotify.com/playlist/${String(index).padStart(22, '0')}`

test('100 playlists run in FIFO order with exactly one worker, even after repeated start requests', async () => {
  const { queue, children } = setup()
  const jobs = Array.from({ length: MAX_OPEN_DOWNLOADS }, (_, index) => queue.enqueue(playlist(index)))
  assert.equal(jobs.length, 100)
  assert.deepEqual(queuedDownloads(queue.jobs).map(job => job.id), jobs.map(job => job.id))
  assert.throws(() => queue.enqueue(playlist(100)), /Maximum 100 open downloads\./)
  queue.start(); queue.start(); void queue.next()
  for (let index = 0; index < jobs.length; index++) {
    await flush()
    assert.equal(children.length, index + 1)
    assert.equal(queue.active.job.id, jobs[index].id)
    assert.equal(queue.jobs.filter(job => job.status === 'running').length, 1)
    assert.equal(children[index].args[children[index].args.indexOf('--url') + 1], playlist(index))
    queue.start(); void queue.next(); await flush()
    assert.equal(children.length, index + 1)
    output(children[index], { type: 'summary', saved: 1, existing: 0, skipped: 0 })
    children[index].emit('close', 0)
  }
  await flush()
  assert.ok(jobs.every(job => job.status === 'completed'))
  assert.equal(queue.active, null)
  assert.equal(queue.running, false)
  assert.equal(children.length, 100)
})

test('restoring history never discards any of the 100 waiting playlists', () => {
  const { queue } = setup()
  const open = Array.from({ length: 100 }, (_, index) => queue.enqueue(playlist(index)))
  const history = Array.from({ length: 100 }, (_, index) => {
    const historical = setup().queue.enqueue(playlist(index + 100))
    historical.status = 'completed'
    return historical
  })
  const restored = setup({ jobs: [...history, ...queue.jobs] }).queue
  assert.equal(restored.jobs.filter(job => job.status === 'paused').length, 100)
  assert.equal(restored.jobs.filter(job => job.status === 'completed').length, 100)
  for (const job of restored.jobs.filter(job => job.status === 'paused')) restored.resume(job.id)
  assert.deepEqual(queuedDownloads(restored.jobs).map(job => job.id), open.map(job => job.id))
})

test('paused and blocked playlists reserve capacity and retries cannot exceed 100 open downloads', () => {
  const { queue } = setup()
  const historical = queue.enqueue(playlist(100)); historical.status = 'failed'
  const jobs = Array.from({ length: 100 }, (_, index) => queue.enqueue(playlist(index)))
  queue.cancel(jobs[0].id); jobs[1].status = 'blocked'
  assert.throws(() => queue.enqueue(playlist(101)), /Maximum 100 open downloads\./)
  assert.throws(() => queue.resume(historical.id), /Maximum 100 open downloads\./)
  queue.resume(jobs[0].id); queue.resume(jobs[1].id)
  assert.equal(queuedDownloads(queue.jobs).length, 100)
  queue.remove(jobs[2].id); queue.resume(historical.id)
  assert.equal(queuedDownloads(queue.jobs).length, 100)
})

test('a blocked playlist cannot be enqueued again while waiting for confirmation', () => {
  const { queue } = setup(); const job = queue.enqueue(link); job.status = 'blocked'
  assert.throws(() => queue.enqueue(link), /already in your queue/)
})

test('pause and immediate resume cannot revive a stale launch while cookies are being prepared', async () => {
  let releasePreparation, released = 0, preparations = 0
  const waiting = new Promise(resolve => { releasePreparation = resolve })
  const { queue, children } = setup({ prepareCookies: async () => {
    if (++preparations === 1) { await waiting; return { file: '/private/stale.txt', release: async () => { released++ } } }
    return null
  } })
  const first = queue.enqueue(link); const second = queue.enqueue(other)
  queue.start(); await flush(); queue.cancel(first.id); queue.resume(first.id); queue.start()
  releasePreparation(); await flush(); await flush()
  assert.equal(released, 1)
  assert.equal(preparations, 2)
  assert.equal(children.length, 1)
  assert.equal(queue.active.job.id, first.id)
  assert.equal(children[0].args.includes('/private/stale.txt'), false)
  output(children[0], { type: 'summary', saved: 1, existing: 0, skipped: 0 }); children[0].emit('close', 0); await flush()
  assert.equal(queue.active.job.id, second.id); assert.equal(children.length, 2)
  children[1].emit('close', 1)
})

test('a paused launch with a failed pending write stays paused and advances to the next playlist', async () => {
  let rejectWrite, writes = 0
  const waiting = new Promise((_resolve, reject) => { rejectWrite = reject })
  const { queue, children } = setup({ persist: () => ++writes === 1 ? waiting : Promise.resolve() })
  const first = queue.enqueue(link); const second = queue.enqueue(other)
  queue.start(); queue.cancel(first.id); rejectWrite(new Error('pending write failed')); await flush()
  assert.equal(first.status, 'paused'); assert.equal(second.status, 'running'); assert.equal(children.length, 1)
  children[0].emit('close', 1)
})

test('worker errors wait for process close before the next playlist starts', async () => {
  const { queue, children } = setup(); const first = queue.enqueue(link); const second = queue.enqueue(other)
  queue.start(); await flush(); children[0].emit('error', new Error('worker error')); await flush()
  assert.equal(children.length, 1); assert.equal(queue.active.job.id, first.id)
  children[0].emit('close', 1); await flush()
  assert.equal(first.status, 'failed'); assert.equal(second.status, 'running'); assert.equal(children.length, 2)
  children[1].emit('close', 1)
})

test('global pause during session preparation cannot start a worker or fail cookie cleanup', async () => {
  let releasePreparation
  const waiting = new Promise(resolve => { releasePreparation = resolve })
  const { queue, children } = setup({ prepareCookies: async () => {
    await waiting; return { file: '/private/unused.txt', release: async () => { throw new Error('cleanup failed') } }
  } })
  const first = queue.enqueue(link); const second = queue.enqueue(other)
  queue.start(); await flush(); queue.stopAll(); releasePreparation(); await flush()
  assert.equal(first.status, 'paused'); assert.equal(second.status, 'paused'); assert.equal(children.length, 0)
  assert.equal(queue.running, false); assert.equal(queue.launching, false)
})
