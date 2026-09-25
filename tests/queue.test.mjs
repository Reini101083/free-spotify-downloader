import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter, once } from 'node:events'
import { mkdtemp, readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DownloadQueue } from '../shared/queue.mjs'
import { AtomicStore } from '../shared/store.mjs'
import { spotifyLink } from '../shared/domain.mjs'
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
