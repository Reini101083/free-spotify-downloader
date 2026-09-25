import test from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { fileURLToPath } from 'node:url'
import { DownloadQueue } from '../shared/queue.mjs'
function ready(queue,id){return new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{queue.off('change',check);reject(new Error('Native worker did not become ready'))},10000);function check(){if(queue.active?.job.id===id&&queue.active.job.message==='Native queue fixture ready'){clearTimeout(timeout);queue.off('change',check);resolve()}}queue.on('change',check);check()})}
test('native process pause advances only the selected playlist on this operating system',{timeout:20000},async t=>{
  const queue=new DownloadQueue({engine:process.execPath,engineArgs:[fileURLToPath(new URL('./fixtures/queue-worker.mjs',import.meta.url))],ffmpeg:'unused',folder:'unused',stateDirectory:'unused'})
  t.after(async()=>{const child=queue.active?.child;const closed=child?once(child,'close'):null;queue.stopAll();if(closed)await closed})
  const first=queue.enqueue('https://open.spotify.com/playlist/1234567890123456789012')
  const second=queue.enqueue('https://open.spotify.com/playlist/abcdefghijklmnopqrstuv')
  queue.start();await ready(queue,first.id)
  const firstChild=queue.active.child;const closed=once(firstChild,'close');queue.cancel(first.id);await closed;await ready(queue,second.id)
  if(process.platform==='win32')assert.equal(firstChild.exitCode,0,'Windows pause must use graceful stdin shutdown before taskkill fallback')
  assert.equal(first.status,'paused');assert.equal(second.status,'running');assert.equal(queue.running,true);assert.notEqual(queue.active.child.pid,firstChild.pid)
})
