// Coalesce completed songs without dropping changes that arrive during a scan.
export class LibraryRefresh {
  constructor({ folder, scan, onStart = () => {}, onResult = () => {}, onError = () => {}, onFinish = () => {}, delay = 300 }) {
    Object.assign(this, { folder, scan, onStart, onResult, onError, onFinish, delay })
    this.timer = null
    this.running = null
    this.dirty = false
    this.disposed = false
  }
  request() {
    if (this.disposed) return
    this.dirty = true
    if (this.running || this.timer) return
    this.timer = setTimeout(() => { this.timer = null; void this.refresh() }, this.delay)
    this.timer.unref?.()
  }
  refresh() {
    if (this.disposed) return Promise.resolve()
    this.dirty = true
    clearTimeout(this.timer); this.timer = null
    if (this.running) return this.running
    this.running = Promise.resolve().then(async () => {
      this.onStart()
      try {
        while (this.dirty && !this.disposed) {
          this.dirty = false
          const folder = this.folder()
          try {
            const result = await this.scan(folder)
            if (!this.disposed && folder === this.folder()) this.onResult(result, folder)
          } catch (error) {
            if (!this.disposed && folder === this.folder()) this.onError(error, folder)
          }
        }
      } finally {
        this.running = null
        this.onFinish()
        if (this.dirty && !this.disposed) this.request()
      }
    })
    return this.running
  }
  dispose() {
    this.disposed = true
    this.dirty = false
    clearTimeout(this.timer); this.timer = null
  }
}
