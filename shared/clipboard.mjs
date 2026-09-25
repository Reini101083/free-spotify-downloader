import { spotifyLink } from './domain.mjs'

// Remember only a validated Spotify URL, never unrelated clipboard contents.
export class ClipboardLinks {
  last = null
  read(value) {
    let link
    try { link = spotifyLink(value) } catch { this.last = null; return null }
    if (link.url === this.last) return null
    this.last = link.url
    return link.url
  }
}
