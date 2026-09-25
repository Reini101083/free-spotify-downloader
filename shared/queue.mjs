import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { cleanOutput, preferences, spotifyLink, MAX_OPEN_DOWNLOADS, OPEN_DOWNLOAD_STATUSES, queuedDownloads } from './domain.mjs'

const isOpen = job => OPEN_DOWNLOAD_STATUSES.includes(job.status)
function retainJobs(jobs) {
  let history = 0
  return jobs.filter(job => isOpen(job) || history++ < 100)
}
async function releaseCookies(lease) {
  try { await lease?.release() } catch { /* Cleanup cannot leave the queue locked. */ }
}

export class DownloadQueue extends EventEmitter {
  constructor({ engine, engineArgs = [], ffmpeg, deno, folder, settings, stateDirectory, jobs = [], persist = async () => {}, prepareCookies = async () => null, spawnProcess = spawn }) {
    super()
    Object.assign(this, { engine, engineArgs, ffmpeg, deno, folder, stateDirectory, prepareCookies, settings: preferences(settings), persist, spawnProcess })
    const restoredIds = new Set()
    this.jobs = retainJobs(jobs.flatMap(job => {
      try {
        const link = spotifyLink(job.url)
        if (!/^[a-f0-9-]{36}$/.test(job.id) || restoredIds.has(job.id)) return []
        restoredIds.add(job.id)
        const interrupted = ['queued', 'running'].includes(job.status)
        const status = interrupted ? 'paused' : job.status === 'partial' && !(job.saved || job.existing) ? 'failed' : job.status
        return [{ ...job, url: link.url, type: link.type, tracks: Array.isArray(job.tracks) ? job.tracks : [], settings: preferences(job.settings), logs: Array.isArray(job.logs) ? job.logs.slice(-80) : [], status, message: interrupted ? 'Session restored. Ready to resume.' : status === 'failed' && job.status === 'partial' ? 'No audio files were saved. Retry the failed songs.' : job.message }]
      } catch { return [] }
    }))
    this.active = null
    this.running = false
    this.launching = false
  }
  changed() { this.emit('change') }
  enqueue(value) {
    const link = spotifyLink(value)
    if (this.jobs.filter(isOpen).length >= MAX_OPEN_DOWNLOADS) throw new Error(`Maximum ${MAX_OPEN_DOWNLOADS} open downloads.`)
    if (this.jobs.some(job => job.url === link.url && isOpen(job))) throw new Error('This link is already in your queue.')
    const job = { id: randomUUID(), url: link.url, type: link.type, title: `Spotify ${link.label}`, status: 'queued', message: 'Ready to start', tracks: [], logs: [], saved: 0, settings: { ...this.settings }, createdAt: new Date().toISOString() }
    this.jobs.unshift(job)
    this.jobs = retainJobs(this.jobs)
    this.changed()
    return job
  }
  start() { if (this.running) return; this.running = true; this.changed(); void this.next() }
  resume(id, trackId = null) {
    const job = this.jobs.find(item => item.id === id)
    if (!job || ['queued', 'running'].includes(job.status)) return
    if (!isOpen(job) && this.jobs.filter(isOpen).length >= MAX_OPEN_DOWNLOADS) throw new Error(`Maximum ${MAX_OPEN_DOWNLOADS} open downloads.`)
    if (this.jobs.some(item => item.id !== id && item.url === job.url && isOpen(item))) throw new Error('This link is already being processed.')
    job.retryTrack = /^[a-zA-Z0-9]{22}$/.test(trackId || '') ? trackId : null
    job.status = 'queued'; job.cancelled = false; job.requiresAuth = false; job.message = 'Existing files will be checked when you start.'
    this.changed()
  }
  async next() {
    if (this.active || this.launching || !this.running) return
    const job = queuedDownloads(this.jobs)[0]
    if (!job) { this.running = false; this.changed(); return }
    const launch = { job, cancelled: false }
    this.launching = launch
    const stopped = () => launch.cancelled || !this.running || job.status !== 'running' || !this.jobs.includes(job)
    const advance = () => { this.launching = false; void this.next() }
    job.status = 'running'; job.message = 'Checking existing files…'
    job.folder ||= this.folder
    // Parallelism is operational: apply the current preference to this run,
    // while preserving the playlist's original audio format and destination.
    job.settings.parallelSongs = preferences(this.settings).parallelSongs
    job.saved = 0; job.existing = 0; job.skipped = 0
    delete job.progress
    this.changed()
    try { await this.persist() } catch {
      if (stopped()) { advance(); return }
      job.status = 'failed'; job.message = 'Your queue could not be saved.'
      this.launching = false; this.running = false; this.changed(); return
    }
    if (stopped()) { advance(); return }
    const args = [...this.engineArgs, '--session', path.join(this.stateDirectory, `${job.id}.json`), '--url', job.url, '--folder', job.folder, '--format', job.settings.format, '--bitrate', job.settings.bitrate, '--parallel-songs', String(job.settings.parallelSongs), '--ffmpeg', this.ffmpeg]
    if (this.deno) args.push('--deno', this.deno)
    if (job.retryTrack) args.push('--only-track', job.retryTrack)
    let child, cookieLease
    try {
      cookieLease = await this.prepareCookies()
      if (stopped()) { await releaseCookies(cookieLease); advance(); return }
      if (cookieLease) args.push('--cookie-file', cookieLease.file)
      child = this.spawnProcess(this.engine, args, { shell: false, windowsHide: true, detached: process.platform !== 'win32', env: { ...process.env, PYTHONUNBUFFERED: '1', NO_COLOR: '1' }, stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (error) {
      await releaseCookies(cookieLease)
      if (stopped()) { advance(); return }
      job.status = 'failed'; job.message = 'The download engine could not start.'; job.logs.push(cleanOutput(error.message))
      this.launching = false; this.changed(); void this.next(); return
    }
    this.active = { job, child }; this.launching = false
    let settled = false, summary = null, failure = null, pending = '', completedCount = 0, killTimer
    const line = value => {
      // A stopped worker must never pause or overwrite the next playlist.
      if (settled || job.cancelled) return
      if (value.startsWith('FSD_EVENT ')) {
        try {
          const event = JSON.parse(value.slice(10))
          if (event.type === 'plan' && Array.isArray(event.tracks)) job.tracks = [...(event.reset ? [] : job.tracks), ...event.tracks.map(track => ({ id: track.id, title: cleanOutput(track.title), status: track.status, error: cleanOutput(track.error || ''), file: track.file || null }))]
          if (event.type === 'summary') summary = event
          if (event.type === 'status') job.message = cleanOutput(event.message)
          if (event.type === 'error') {
            failure = cleanOutput(event.message)
            job.logs.push(`${cleanOutput(event.code)}: ${failure}${event.detail ? `\n${cleanOutput(event.detail)}` : ''}`)
          }
          if (event.type === 'auth') { job.requiresAuth = true; job.authUrl = event.url; job.blockReason = event.reason || 'confirmation'; this.running = false }
          if (event.type === 'track') {
            const completed = Number.isInteger(event.completed) && event.completed >= 0 ? event.completed : null
            if (completed !== null) completedCount = Math.max(completedCount, completed)
            job.message = `${completed !== null ? completedCount : event.index}/${event.total} · ${event.title}`
            const processed = completed !== null ? completedCount : (event.index - (event.status === 'running' ? 1 : 0))
            if (Number.isInteger(event.total) && event.total > 0 && Number.isFinite(processed)) job.progress = Math.max(job.progress || 0, Math.min(100, 100 * Math.max(0, processed) / event.total))
            job.logs.push(`${event.index}/${event.total} ${event.title} · ${event.status}${event.error ? `: ${event.error}` : ''}`)
            const trackId = event.id || String(event.index)
            // A legacy checkpoint may contain the same song more than once.
            // Its entries settle separately even though the engine downloads once.
            const indexed = Number.isInteger(event.index) ? job.tracks[event.index - 1] : null
            const previous = indexed?.id === trackId ? indexed : job.tracks.find(track => track.id === trackId)
            const track = { id: trackId, title: cleanOutput(event.title), status: event.status, error: event.error ? cleanOutput(event.error) : '', file: event.file || previous?.file || null }
            if (previous) Object.assign(previous, track)
            else job.tracks.push(track)
            if (['saved', 'existing'].includes(event.status) && typeof event.file === 'string' && event.file) this.emit('library-change', { folder: job.folder })
          }
          for (const key of ['saved','existing','skipped']) if (Number.isInteger(event[key]) && event[key] >= 0) job[key] = Math.max(job[key] || 0, event[key])
        } catch { job.logs.push(cleanOutput(value)) }
      } else if (value.trim()) job.logs.push(cleanOutput(value))
      job.logs = job.logs.slice(-80)
      this.changed()
    }
    child.stdout?.on('data', chunk => { pending += chunk.toString(); const lines = pending.split(/\r?\n/); pending = lines.pop().slice(-128000); lines.forEach(line) })
    child.stderr?.on('data', chunk => { cleanOutput(chunk).split(/\r?\n/).forEach(line) })
    const finish = code => {
      if (settled) return
      if (pending) { const last = pending; pending = ''; line(last) }
      settled = true; clearTimeout(killTimer)
      void releaseCookies(cookieLease)
      if (job.cancelled) { job.status = 'paused'; job.message = 'Paused. Completed songs are kept.' }
      else if (job.requiresAuth) { job.status = 'blocked'; job.message = job.blockReason === 'rate_limit' ? 'YouTube is limiting requests. Wait before trying again.' : 'YouTube needs your confirmation.'; this.running = false }
      else if (code !== 0 || !summary || failure) { job.status = 'failed'; job.message = failure || 'Interrupted. You can resume this download.' }
      else {
        const saved = summary.saved + summary.existing + (job.retryTrack ? job.tracks.filter(track => track.id !== job.retryTrack && ['saved', 'existing'].includes(track.status)).length : 0)
        const remaining = job.tracks.filter(track => ['skipped', 'blocked', 'pending', 'running'].includes(track.status)).length
        job.status = !saved && summary.skipped ? 'failed' : (summary.skipped || remaining) ? 'partial' : 'completed'
        job.message = !saved && summary.skipped ? 'No audio files were saved. Retry the failed songs.' : `${summary.saved} saved · ${summary.existing} existing · ${summary.skipped} not downloaded`
      }
      delete job.progress
      this.jobs = retainJobs(this.jobs)
      // A pause can land after file promotion but before its track event arrives.
      this.emit('library-change', { folder: job.folder })
      this.active = null; this.changed(); void this.next()
    }
    // `error` can precede `close`: wait for the worker's actual termination
    // before launching its successor, including failed-spawn errors.
    child.once('error', error => { if (settled) return; failure = cleanOutput(error.message); job.logs.push(failure) })
    child.once('close', finish)
    this.active.stop = () => {
      this.stopProcess(child)
      killTimer = setTimeout(() => this.stopProcess(child, true), 4000)
      killTimer.unref?.()
    }
  }
  cancel(id) {
    const job = this.jobs.find(item => item.id === id)
    if (!job || job.cancelled || !['queued', 'running'].includes(job.status)) return
    job.cancelled = true
    if (this.launching?.job?.id === id) this.launching.cancelled = true
    if (this.active?.job.id === id) { job.message = 'Pausing…'; this.active.stop() }
    else { job.status = 'paused'; job.message = 'Paused. Ready to resume.' }
    this.changed()
  }
  stopProcess(child, force = false) {
    if (!child.pid) return
    if (process.platform === 'win32') {
      // The engine's stdin watchdog performs checkpoint and worker cleanup.
      // taskkill is only the fallback if graceful shutdown does not finish.
      if (!force && child.stdin && !child.stdin.destroyed) { child.stdin.end(); return }
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => child.kill())
    }
    else { try { process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM') } catch { child.kill(force ? 'SIGKILL' : 'SIGTERM') } }
  }
  stopAll() { this.running = false; for (const job of this.jobs) if (['queued', 'running'].includes(job.status)) this.cancel(job.id) }
  remove(id) { const job = this.jobs.find(item => item.id === id); if (job && job.status !== 'running') { this.jobs = this.jobs.filter(item => item.id !== id); this.changed() } }
}
