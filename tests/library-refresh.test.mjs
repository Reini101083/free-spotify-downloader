import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { LibraryRefresh } from '../shared/library-refresh.mjs'
import { DownloadQueue } from '../shared/queue.mjs'

const flush = () => new Promise(resolve => setImmediate(resolve))
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
async function until(promise) {
  let timeout
  try { return await Promise.race([promise, new Promise((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('Automatic refresh did not arrive')), 1000) })]) }
  finally { clearTimeout(timeout) }
}

test('saved and existing songs refresh automatically during a playlist, while running and skipped tracks do not', async t => {
  for (const status of ['saved', 'existing']) {
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter()
    const queue = new DownloadQueue({ engine: '/engine', ffmpeg: '/ffmpeg', folder: '/downloads', stateDirectory: '/state', spawnProcess: () => child })
    const updated = deferred(); let scans = 0, files = []
    const refresh = new LibraryRefresh({ folder: () => queue.folder, delay: 1,
      scan: async () => { scans++; return ['Complete song.mp3'] },
      onResult: result => { files = result; updated.resolve() },
    })
    t.after(() => { refresh.dispose(); queue.stopAll(); child.emit('close', 1) })
    queue.on('library-change', ({ folder }) => { if (folder === queue.folder) refresh.request() })
    const job = queue.enqueue('https://open.spotify.com/playlist/1234567890123456789012')
    queue.start(); await flush()
    const output = event => child.stdout.emit('data', 'FSD_EVENT ' + JSON.stringify(event) + '\n')
    output({ type: 'track', id: '1'.repeat(22), index: 1, total: 3, completed: 0, status: 'running', title: 'Song' })
    output({ type: 'track', id: '2'.repeat(22), index: 2, total: 3, completed: 1, status: 'skipped', title: 'Missing', file: '/downloads/stale.mp3', skipped: 1 })
    assert.equal(scans, 0)
    assert.equal(refresh.timer, null)
    output({ type: 'track', id: '1'.repeat(22), index: 1, total: 3, completed: 2, status, title: 'Song', file: '/downloads/Complete song.mp3', [status]: 1 })
    await until(updated.promise)
    assert.deepEqual(files, ['Complete song.mp3'])
    assert.equal(scans, 1)
    assert.equal(job.status, 'running')
    assert.equal(queue.running, true)
  }
})

test('changes during a scan coalesce into one serial follow-up and retain the final song', async t => {
  const first = deferred(); let scans = 0, active = 0, maximumActive = 0
  const results = []
  const refresh = new LibraryRefresh({ folder: () => '/downloads',
    scan: async () => {
      const number = ++scans; maximumActive = Math.max(maximumActive, ++active)
      try { return number === 1 ? await first.promise : ['Song one.mp3', 'Song two.mp3'] }
      finally { active-- }
    },
    onResult: files => results.push(files),
  })
  t.after(() => refresh.dispose())
  const done = refresh.refresh(); await flush()
  refresh.request(); refresh.request(); refresh.request()
  assert.equal(refresh.refresh(), done)
  first.resolve(['Song one.mp3'])
  await done
  assert.equal(scans, 2)
  assert.equal(maximumActive, 1)
  assert.deepEqual(results.at(-1), ['Song one.mp3', 'Song two.mp3'])
  assert.equal(refresh.dirty, false)
})

test('changing the folder discards old scan results and errors and scans the new folder', async t => {
  for (const failOldScan of [false, true]) {
    const old = deferred(); let folder = '/old'
    const results = [], errors = [], scans = []
    const refresh = new LibraryRefresh({ folder: () => folder,
      scan: async value => { scans.push(value); return value === '/old' ? old.promise : ['New folder song.mp3'] },
      onResult: (files, directory) => results.push({ files, directory }), onError: error => errors.push(error),
    })
    t.after(() => refresh.dispose())
    const done = refresh.refresh(); await flush()
    folder = '/new'; refresh.request()
    if (failOldScan) old.reject(new Error('Old folder disappeared')); else old.resolve(['Old song.mp3'])
    await done
    assert.deepEqual(scans, ['/old', '/new'])
    assert.deepEqual(results, [{ files: ['New folder song.mp3'], directory: '/new' }])
    assert.deepEqual(errors, [])
  }
})

test('a final refresh is requested on pause even if file promotion preceded its track event', async t => {
  const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter()
  const queue = new DownloadQueue({ engine: '/engine', ffmpeg: '/ffmpeg', folder: '/downloads', stateDirectory: '/state', spawnProcess: () => child })
  const updated = deferred(); let scans = 0
  const refresh = new LibraryRefresh({ folder: () => queue.folder, delay: 1,
    scan: async () => { scans++; return ['Already promoted.mp3'] }, onResult: files => updated.resolve(files),
  })
  t.after(() => refresh.dispose())
  queue.on('library-change', () => refresh.request())
  const job = queue.enqueue('https://open.spotify.com/playlist/1234567890123456789012')
  queue.start(); await flush(); queue.cancel(job.id); child.emit('close', 130)
  assert.deepEqual(await until(updated.promise), ['Already promoted.mp3'])
  assert.equal(scans, 1); assert.equal(job.status, 'paused')
})
