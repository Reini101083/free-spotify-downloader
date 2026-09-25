# Free Spotify Downloader

An independent desktop music workspace by **Jedi Meister**, licensed under **MIT**.

Deutsch / English · Windows · macOS · Linux

## Download — wähle dein Betriebssystem

[**Aktuelle Version mit Download-Auswahl öffnen**](https://github.com/Reini101083/free-spotify-downloader/releases/latest)

| Betriebssystem | Paket |
| --- | --- |
| Windows · Intel / AMD 64-Bit | Installer `.exe` oder Portable `.exe` |
| Mac · Apple Silicon | `.dmg` für M-Chips |
| Mac · Intel | `.dmg` für Intel-Prozessoren |
| Linux · x86_64 | `.AppImage` oder `.deb` für Debian / Ubuntu |

Die passende Datei steht direkt in der Tabelle der Release-Seite. Kein GitHub-Konto
zum Download erforderlich. [Ältere Versionen](https://github.com/Reini101083/free-spotify-downloader/releases)
bleiben separat auswählbar. **Source code (zip)** ist der Quellcode, kein Installer.

Die Website zeigt eine Vorschau und die App-Downloads. Musikdownloads startest du
in der installierten Desktop-App. Python, FFmpeg und Deno sind enthalten.

## What it does

- Paste a Spotify track, album or playlist link into a responsive desktop interface.
- Queue multiple downloads and select MP3, M4A, FLAC, Opus or WAV.
- Save queue state atomically. After an interruption, select **Fortsetzen / Resume**.
- Check completed files by Spotify track ID, audio header and stored SHA-256 digest.
  Existing valid files are skipped. Deleted or changed files are downloaded again.
- Commit each completed track separately. Incomplete files stay in a staging folder;
  resume retries that track. This is track-level recovery, not byte-range resuming.
- Skip an unavailable track and continue the playlist. Each attempt is bounded to
  10 minutes. Skipped tracks remain visible in the log and are retried on resume.
- Stop the queue on a detected YouTube CAPTCHA/sign-in/rate-limit request. Open the
  dedicated **YouTube confirmation** window and complete the site interaction yourself.
  Choose **Use this session**, then **Try again** in the main window.
- Choose German or English at the top. Settings remain clearly accessible at the bottom.

Spotify is used for metadata. A separate spotDL engine finds matching audio on
YouTube/YouTube Music. This is not a direct Spotify-stream exporter. Source
availability, song matching, bitrate and version are not guaranteed. FLAC/WAV
output cannot restore detail missing from a lossy source. Use content you own
or have permission to download.

The YouTube window is sandboxed and isolated from the main app. It has no Node
access or app bridge. No CAPTCHA is solved automatically. Session cookies stay
in memory until the app exits. After your explicit in-app confirmation, only
YouTube-domain cookies are exported temporarily to the local engine, with
restricted file permissions; they are removed when the job finishes and stale
exports are removed on startup. You can clear the session in Settings. Google
may reject embedded sign-in, and confirmation may still not unblock downloads.

## Build and run

Requires Node.js 24 and Python 3.12 on the target operating system.

```sh
npm ci
python -m venv .venv
# Activate .venv using the command appropriate for your shell.
python -m pip install -r engine/requirements.txt
npm run licenses
npm run build:engine
npm run build:web
npm start
```

FFmpeg, Deno and the engine are packaged with the desktop app. No separate Python
installation is needed to use a built installer.

```sh
npm run check
npm test
npm run test:engine
npm run package
```

Output is in `release/`. Build on each target OS; macOS packages require macOS.
Windows produces an installer and a portable `.exe`, macOS `.dmg`/`.zip`, Linux
`.AppImage`/`.deb`. The GitHub Actions workflow builds all platforms and attaches
artifacts to the run. A new package version on `main` (or a matching version tag) publishes a GitHub
Release after all four platform builds succeed. Published versions are never
overwritten; increment `package.json` and its lockfile for each new release. Packages are unsigned until publisher signing certificates are configured.

For a Windows x64 portable build from Linux, `python scripts/build_windows_portable.py`
bundles official embedded CPython 3.13.15, hash-locked Windows wheels, Windows
FFmpeg and Windows Deno. It does not require Wine. This produces a portable
`.exe`; the native Windows CI job additionally creates the installer. Cross-built
packages still need a runtime test on Windows before a production release.

## Browser and Sites

```sh
npm run build:web
npm run dev
```

The browser version is explicitly a preview: link validation, selection, formats,
language and Spotify embeds work. Actual downloads and the YouTube confirmation
window need the desktop app. No simulated downloads or fake progress are shown.
Run `npm run build:site` to produce `dist/` for Sites hosting, configured in
`.openai/hosting.json`.

## Local data

Electron's per-user application data directory contains `workspace.json` and
`sessions/<job-id>.json`. Completed files remain in the chosen music directory.
Jobs retain their original destination and output settings when resumed. New
settings apply to new jobs. Session files keep the original playlist snapshot,
so resuming does not silently switch to a changed playlist. Queue removal does
not delete downloaded music.

## License

MIT permits use, modification, distribution and commercial use of our original
code. Keep the MIT license and copyright notice with copies. Third-party
components keep their own licenses; see `THIRD_PARTY_NOTICES.md`. The build
collects their notices in `licenses/` and includes them in the installers.

## Verification

Offline tests cover restoring interrupted jobs, serialized atomic writes,
duplicate prevention, valid-file reuse, missing-source continuation, CAPTCHA
pausing and cleanup of temporary session files. These tests do not claim live
YouTube or Spotify availability. Provider behavior can change independently.
