import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import path from 'node:path'
import { PACKAGES, packageFile, packageUrl, REPOSITORY } from '../renderer/releases.mjs'

const { version } = JSON.parse(await readFile('package.json', 'utf8'))
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Release requires a stable semantic version')
if (!/^[a-f0-9]{40}$/.test(process.env.GITHUB_SHA || '')) throw new Error('Missing exact source commit')
const tag = `v${version}`
if (process.env.GITHUB_REF?.startsWith('refs/tags/') && process.env.GITHUB_REF !== `refs/tags/${tag}`) throw new Error('Tag and package version differ')
const directory = path.resolve(process.argv[2] || 'artifacts')
const expected = [...PACKAGES.map(item => packageFile(item, version)), ...['arm64', 'x64'].map(arch => `Free-Spotify-Downloader-${version}-mac-${arch}.zip`)]
const files = await readdir(directory)
if (expected.some(name => !files.includes(name))) throw new Error(`Missing release packages: ${expected.filter(name => !files.includes(name)).join(', ')}`)
const checksums = []
for (const name of expected) {
  const file = path.join(directory, name)
  if ((await stat(file)).size < 1_000_000) throw new Error(`Package is unexpectedly small: ${name}`)
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  checksums.push(`${hash.digest('hex')}  ${name}`)
}
await writeFile(path.join(directory, 'SHA256SUMS.txt'), checksums.join('\n') + '\n')
const notes = `# Free Spotify Downloader ${tag}\n\nVon **Jedi Meister** · Eigener Anwendungscode unter **MIT**\n\n## Deine Version auswählen / Choose your download\n\n| System | Download |\n| --- | --- |\n${PACKAGES.map(item => `| ${item.label} | [${item.extension} herunterladen](${packageUrl(item, version)}) |`).join('\n')}\n\n**Windows:** Installer für die normale Installation; Portable startet ohne Installation.\n\n**Mac:** Unter  → Über diesen Mac steht „Chip“ (Apple Silicon) oder „Prozessor: Intel“.\n\n**Linux:** AppImage für viele Distributionen; .deb für Debian und Ubuntu, jeweils x86_64.\n\nDie zusätzlichen Mac-ZIP-Dateien und SHA256-Prüfsummen findest du unter Assets. Kein separates Python oder FFmpeg erforderlich.\n\n## Neu in 0.1.2\n\n- Rechtsklick-Menü mit Einfügen, Kopieren und Ausschneiden.\n- Automatische Übernahme kopierter Spotify-Links; in den Einstellungen abschaltbar.\n- Sichtbare Playlist-Fehlermeldungen und ein Wiederholungsversuch bei vorübergehenden Spotify-Verbindungsfehlern.\n- Kürzere Dateinamen für Windows und direkte Downloads in der Projektbeschreibung.\n\n## Starten\n\n1. Passendes Paket herunterladen und die Desktop-App öffnen.\n2. Spotify-Link kopieren und zur App wechseln oder Rechtsklick → Einfügen verwenden. Musikordner auswählen.\n3. Download starten. Unterbrochene Aufträge lassen sich fortsetzen.\n\nDie Website ist eine Vorschau; Audiodownloads laufen in der Desktop-App. Die Pakete sind nicht digital signiert. Automatisierte Tests und ein lokaler Audiodatei-Test der gebündelten Engine sind bestanden; Live-Downloads und die vollständige Desktop-Oberfläche wurden nicht auf allen Geräten getestet.\n\n[Alle Versionen](${REPOSITORY}/releases) · [Anleitung](${REPOSITORY}#readme)\n\nSource: ${process.env.GITHUB_SHA}\n`
await writeFile('release-notes.md', notes)
// Never replace already published binaries under an existing version.
const existing = spawnSync('gh', ['release', 'view', tag, '--json', 'isDraft,url'], { encoding: 'utf8' })
if (existing.status === 0) {
  const release = JSON.parse(existing.stdout)
  if (release.isDraft) throw new Error('An existing draft needs review before publication')
  console.log(`Published version already exists; unchanged: ${release.url}`)
} else {
  execFileSync('gh', ['release', 'create', tag, ...expected.map(name => path.join(directory, name)), path.join(directory, 'SHA256SUMS.txt'), '--target', process.env.GITHUB_SHA, '--title', `Free Spotify Downloader ${tag}`, '--notes-file', 'release-notes.md', '--latest'], { stdio: 'inherit' })
}
