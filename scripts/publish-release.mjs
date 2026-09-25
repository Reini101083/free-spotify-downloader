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
const downloadTable = releaseVersion => `| System | Download |\n| --- | --- |\n${PACKAGES.map(item => `| ${item.label} | [Download ${item.extension}](${packageUrl(item, releaseVersion)}) |`).join('\n')}`
const installation = `**Windows:** Choose Installer for standard installation or Portable to run without installing. Packages are unsigned. If you trust this release and SmartScreen appears, click **More info → Run anyway**. Normal app use does not require administrator rights. If the installer specifically requires elevated permission, right-click it, choose **Run as administrator**, then confirm the Windows prompt.\n\n**Mac:** Apple menu → About This Mac identifies Apple Silicon or Intel.\n\n**Linux:** AppImage works on many distributions; DEB targets Debian and Ubuntu. Both are x86_64.\n\nAdditional Mac ZIP packages and SHA-256 checksums are under Assets. No separate Python, FFmpeg or Deno installation is needed.`
const notes = `# Free Spotify Downloader ${tag}\n\nBy **Jedi Meister** · Original app code under **MIT**\n\n## Choose your download\n\n${downloadTable(version)}\n\n${installation}\n\n## What's new in 0.2.1\n\n- Added complete French and Spanish interface catalogs: 79 offline languages in total. The requested 160-language target is not yet reached.\n- Corrected native editing-menu fallback: German for German, English for other languages.\n- Strengthened every native build gate: the packaged engine downloads a real audio fixture through spotDL/yt-dlp over loopback HTTP, rejects a downloaded HTML error page, converts to MP3 through spotDL, promotes the file and checks the saved-file library.\n- Retains the responsive interface, verified Saved songs, per-song retry, internal staging and Downloads destination introduced in 0.2.0.\n\n## Start\n\n1. Install and open the desktop app.\n2. Copy a Spotify link, switch to the app, or right-click → Paste.\n3. Select Start downloads. Completed files appear under Saved songs; unavailable songs remain retryable.\n\nThe website is a preview; audio downloads run in the desktop app. All four native builds run a local HTTP download, MP3 conversion, promotion and library-verification test using the packaged engine and bundled tools. These checks do not prove live YouTube availability or full native GUI behavior on every device. Provider restrictions can still prevent downloads.\n\n[All versions](${REPOSITORY}/releases) · [Guide](${REPOSITORY}#readme)\n\nSource: ${process.env.GITHUB_SHA}\n`
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
