import path from 'node:path'

export function publicLibrary(files) {
  return files.map(({ path: _path, ...item }) => item)
}
export function trustedLibrary(files, directory) {
  return new Map(files.filter(file => typeof file.key === 'string' && /^[a-f0-9]{64}$/.test(file.key) && typeof file.path === 'string' && path.dirname(path.resolve(file.path)) === path.resolve(directory) && /\.(mp3|m4a|flac|opus|wav)$/i.test(file.path)).map(file => [file.key, file]))
}
