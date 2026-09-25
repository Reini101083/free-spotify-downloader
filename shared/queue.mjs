import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { cleanOutput, preferences, spotifyLink } from './domain.mjs'

export class DownloadQueue extends EventEmitter {
  constructor({ engine, engineArgs = [], ffmpeg, folder, settings, stateDirectory, jobs = [], persist = async () => {}, prepareCookies = async () => null, spawnProcess = spawn }) {
    super()
    Object.assign(this, { engine, engineArgs, ffmpeg, folder, stateDirectory, prepareCookies, settings: preferences(settings), persist, spawnProcess })
    this.jobs = jobs.slice(0, 100).flatMap(job => {
      try {
        const link = spotifyLink(job.url)
        if (!/^[a-f0-9-]{36}$/.test(job.id)) return []
        const interrupted = ['queued', 'running'].includes(job.status)
        return [{ ...job, url: link.url, type: link.type, settings: preferences(job.settings), logs: Array.isArray(job.logs) ? job.logs.slice(-40) : [], status: interrupted ? 'paused' : job.status, message: interrupted ? 'Sitzung wiederhergestellt. Bereit zum Fortsetzen.' : job.message }]
      } catch { return [] }
    })
    this.active = null
    this.running = false
    this.launching = false
  }
  changed() { this.emit('change') }
  enqueue(value) {
    const link = spotifyLink(value)
    if (this.jobs.filter(job => ['queued', 'running', 'paused'].includes(job.status)).length >= 50) throw new Error('Maximal 50 offene Aufträge.')
    if (this.jobs.some(job => job.url === link.url && ['queued', 'running', 'paused'].includes(job.status))) throw new Error('Dieser Link ist bereits in deiner Warteschlange.')
    const job = { id: randomUUID(), url: link.url, type: link.type, title: `Spotify ${link.label}`, status: 'queued', message: 'Bereit zum Starten', logs: [], saved: 0, settings: { ...this.settings }, createdAt: new Date().toISOString() }
    this.jobs.unshift(job)
    this.jobs = this.jobs.filter((item, index) => index < 100 || ['queued', 'running', 'paused'].includes(item.status))
    this.changed()
    return job
  }
  start() { if (this.running) return; this.running = true; this.changed(); void this.next() }
  resume(id) {
    const job = this.jobs.find(item => item.id === id)
    if (!job || ['queued', 'running'].includes(job.status)) return
    if (this.jobs.some(item => item.id !== id && item.url === job.url && ['queued', 'running'].includes(item.status))) throw new Error('Dieser Link wird bereits verarbeitet.')
    job.status = 'queued'; job.cancelled = false; job.requiresAuth = false; job.message = 'Vorhandene Dateien werden beim Start geprüft.'
    this.changed()
  }
  async next() {
    if (this.active || this.launching || !this.running) return
    const job = [...this.jobs].reverse().find(item => item.status === 'queued')
    if (!job) { this.running = false; this.changed(); return }
    this.launching = true
    job.status = 'running'; job.message = 'Vorhandene Dateien werden geprüft …'
    job.folder ||= this.folder
    job.saved = 0; job.existing = 0; job.skipped = 0
    this.changed()
    try { await this.persist() } catch {
      job.status = 'failed'; job.message = 'Warteschlange konnte nicht gespeichert werden.'
      this.launching = false; this.running = false; this.changed(); return
    }
    if (job.cancelled) { this.launching = false; void this.next(); return }
    const args = [...this.engineArgs, '--session', path.join(this.stateDirectory, `${job.id}.json`), '--url', job.url, '--folder', job.folder, '--format', job.settings.format, '--bitrate', job.settings.bitrate, '--ffmpeg', this.ffmpeg]
    let child, cookieLease
    try {
      cookieLease = await this.prepareCookies()
      if (job.cancelled) { await cookieLease?.release(); this.launching = false; void this.next(); return }
      if (cookieLease) args.push('--cookie-file', cookieLease.file)
      child = this.spawnProcess(this.engine, args, { shell: false, windowsHide: true, detached: process.platform !== 'win32', env: { ...process.env, PYTHONUNBUFFERED: '1', NO_COLOR: '1' }, stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (error) {
      await cookieLease?.release()
      job.status = 'failed'; job.message = 'Download-Engine konnte nicht gestartet werden.'; job.logs.push(cleanOutput(error.message))
      this.launching = false; this.changed(); void this.next(); return
    }
    this.active = { job, child }; this.launching = false
    let settled = false, summary = null, failure = null, pending = '', killTimer
    const line = value => {
      if (value.startsWith('FSD_EVENT ')) {
        try {
          const event = JSON.parse(value.slice(10))
          if (event.type === 'summary') summary = event
          if (event.type === 'status') job.message = cleanOutput(event.message)
          if (event.type === 'error') {
            failure = cleanOutput(event.message)
            job.logs.push(`${cleanOutput(event.code)}: ${failure}${event.detail ? `\n${cleanOutput(event.detail)}` : ''}`)
          }
          if (event.type === 'auth') { job.requiresAuth = true; job.authUrl = event.url; this.running = false }
          if (event.type === 'track') {
            job.message = `${event.index}/${event.total} · ${event.title}`
            job.progress = event.total ? 100 * (event.index - (event.status === 'running' ? 1 : 0)) / event.total : 0
            job.logs.push(`${event.index}/${event.total} ${event.title} · ${event.status}${event.error ? `: ${event.error}` : ''}`)
          }
          for (const key of ['saved','existing','skipped']) if (Number.isInteger(event[key]) && event[key] >= 0) job[key] = event[key]
        } catch { job.logs.push(cleanOutput(value)) }
      } else if (value.trim()) job.logs.push(cleanOutput(value))
      job.logs = job.logs.slice(-40)
      this.changed()
    }
    child.stdout?.on('data', chunk => { pending += chunk.toString(); const lines = pending.split(/\r?\n/); pending = lines.pop().slice(-16000); lines.forEach(line) })
    child.stderr?.on('data', chunk => { cleanOutput(chunk).split(/\r?\n/).forEach(line) })
    const finish = code => {
      if (settled) return
      settled = true; clearTimeout(killTimer)
      void cookieLease?.release().catch(() => {})
      if (pending) line(pending)
      if (job.cancelled) { job.status = 'paused'; job.message = 'Pausiert. Fertige Titel bleiben erhalten.' }
      else if (job.requiresAuth) { job.status = 'blocked'; job.message = 'YouTube benötigt eine manuelle Bestätigung.'; this.running = false }
      else if (code !== 0 || !summary || failure) { job.status = 'failed'; job.message = failure || 'Unterbrochen. Du kannst den Auftrag fortsetzen.' }
      else {
        job.status = summary.skipped ? 'partial' : 'completed'
        job.message = `${summary.saved} gespeichert · ${summary.existing} bereits vorhanden · ${summary.skipped} übersprungen`
      }
      delete job.progress
      this.active = null; this.changed(); void this.next()
    }
    child.once('error', error => { job.logs.push(cleanOutput(error.message)); finish(1) })
    child.once('close', finish)
    this.active.stop = () => {
      this.stopProcess(child)
      killTimer = setTimeout(() => this.stopProcess(child, true), 4000)
      killTimer.unref?.()
    }
  }
  cancel(id) {
    const job = this.jobs.find(item => item.id === id)
    if (!job || !['queued', 'running'].includes(job.status)) return
    job.cancelled = true
    if (this.active?.job.id === id) { job.message = 'Wird pausiert …'; this.active.stop() }
    else { job.status = 'paused'; job.message = 'Pausiert. Bereit zum Fortsetzen.' }
    this.changed()
  }
  stopProcess(child, force = false) {
    if (!child.pid) return
    if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => child.kill())
    else { try { process.kill(-child.pid, force ? 'SIGKILL' : 'SIGTERM') } catch { child.kill(force ? 'SIGKILL' : 'SIGTERM') } }
  }
  stopAll() { this.running = false; for (const job of this.jobs) if (['queued', 'running'].includes(job.status)) this.cancel(job.id) }
  remove(id) { const job = this.jobs.find(item => item.id === id); if (job && job.status !== 'running') { this.jobs = this.jobs.filter(item => item.id !== id); this.changed() } }
}
