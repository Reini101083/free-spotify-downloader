export const FORMATS = ['mp3', 'm4a', 'flac', 'opus', 'wav']
export const BITRATES = ['auto', '128k', '192k', '256k', '320k']
export const PUBLISHER = 'Jedi Meister'
export const APP_NAME = 'Free Spotify Downloader'
export const REPOSITORY = 'https://github.com/Reini101083/free-spotify-downloader'

export function spotifyLink(value) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Bitte füge einen gültigen Spotify-Link ein.')
  let url
  try { url = new URL(value.trim()) } catch { throw new Error('Bitte füge einen vollständigen Spotify-Link ein.') }
  const match = url.pathname.match(/^\/(?:intl-[a-z]{2}(?:-[a-z]{2})?\/)?(track|album|playlist)\/([a-zA-Z0-9]{22})\/?$/i)
  if (url.protocol !== 'https:' || url.hostname !== 'open.spotify.com' || url.username || url.password || url.port || !match) throw new Error('Erlaubt sind Spotify-Links zu Titeln, Alben und Playlists.')
  const type = match[1].toLowerCase(), id = match[2]
  return { type, id, url: `https://open.spotify.com/${type}/${id}`, embed: `https://open.spotify.com/embed/${type}/${id}?theme=0`, label: { track: 'Titel', album: 'Album', playlist: 'Playlist' }[type] }
}

export function preferences(value = {}) {
  return { format: FORMATS.includes(value.format) ? value.format : 'mp3', bitrate: BITRATES.includes(value.bitrate) ? value.bitrate : '192k' }
}

export function cleanOutput(value) {
  return String(value).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').trim().slice(-1500)
}
