import { mkdir, open, rename, readFile } from 'node:fs/promises'
import path from 'node:path'

export class AtomicStore {
  constructor(file) { this.file = file; this.pending = Promise.resolve() }
  async read() { try { return JSON.parse(await readFile(this.file, 'utf8')) } catch (error) { if (error.code === 'ENOENT') return {}; throw error } }
  write(value) {
    const contents = JSON.stringify(value)
    this.pending = this.pending.catch(() => {}).then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true })
      const temporary = `${this.file}.tmp`
      const handle = await open(temporary, 'w', 0o600)
      try { await handle.writeFile(contents); await handle.sync() } finally { await handle.close() }
      await rename(temporary, this.file)
    })
    return this.pending
  }
}
