# Free Spotify Downloader

A desktop music workspace by **Jedi Meister**. Original application code licensed under **MIT**.

Windows · macOS · Linux · 77 bundled interface languages

## Download

[**Choose your operating system on the latest release page**](https://github.com/Reini101083/free-spotify-downloader/releases/latest)

| Operating system | Download version 0.2.0 |
| --- | --- |
| Windows · Intel / AMD 64-bit | [Installer](https://github.com/Reini101083/free-spotify-downloader/releases/download/v0.2.0/Free-Spotify-Downloader-0.2.0-windows-x64-setup.exe) · [Portable](https://github.com/Reini101083/free-spotify-downloader/releases/download/v0.2.0/Free-Spotify-Downloader-0.2.0-windows-x64-portable.exe) |
| Mac · Apple Silicon | [DMG](https://github.com/Reini101083/free-spotify-downloader/releases/download/v0.2.0/Free-Spotify-Downloader-0.2.0-mac-arm64.dmg) |
| Mac · Intel | [DMG](https://github.com/Reini101083/free-spotify-downloader/releases/download/v0.2.0/Free-Spotify-Downloader-0.2.0-mac-x64.dmg) |
| Linux · x86_64 | [AppImage](https://github.com/Reini101083/free-spotify-downloader/releases/download/v0.2.0/Free-Spotify-Downloader-0.2.0-linux-x86_64.AppImage) · [DEB](https://github.com/Reini101083/free-spotify-downloader/releases/download/v0.2.0/Free-Spotify-Downloader-0.2.0-linux-amd64.deb) |

No GitHub account is required. [Older versions](https://github.com/Reini101083/free-spotify-downloader/releases) remain available separately. **Source code (zip)** contains source code, not an installer. Each release includes SHA-256 checksums. Python, FFmpeg and Deno are included.

On a Mac, open **Apple menu → About This Mac** to identify Apple Silicon or Intel. Linux AppImage and DEB packages are for x86_64; DEB targets Debian and Ubuntu.

### Windows installation

1. Download the installer or portable executable from this repository's release page.
2. These packages are **unsigned**. If Windows displays **Windows protected your PC**, and you trust the downloaded release, click **More info**, then **Run anyway**.
3. Complete the installer. Approve a Windows permission prompt if the selected installation requires it.
4. The app runs with normal user permissions. Administrator rights are **not required for everyday use**. If installation specifically fails with a permission error, right-click the installer, select **Run as administrator**, and confirm the Windows prompt. For a download-folder permission error, first choose a writable folder in Settings.

The default folder is **Downloads/Free Spotify Downloader**. You can select a different folder or an external drive.

## Using the app

1. Copy a Spotify track, album or playlist link and switch to the app, or use **right-click → Paste**.
2. Choose an audio format and output folder in **Settings**, then select **Start downloads**. The Spotify preview loads automatically; audio does not autoplay.
3. Open **Saved songs** to see verified audio files in the selected folder. Use Play or Show in folder directly from the list.
4. Open **Not downloaded** for the reason a song failed. Retry one song or all failed songs. Ordinary song failures do not stop the playlist.

The clipboard feature fills only an empty field while the app is in the foreground. It preserves existing input and never starts downloads automatically. Disable it in Settings. Unrelated clipboard text is not stored or sent.

The responsive interface supports small windows, light/dark/system appearance and keyboard navigation. Language selection is at the top; Settings stays accessible at the bottom on desktop and in the top bar in narrow windows.

### Saved files and recovery

Finished audio files go directly into the selected download folder. Working files stay in the app's internal data directory. Temporary files and invalid audio do not appear as saved songs. A playlist with zero successful files is marked **Failed**, never completed or partially saved.

Queue state and per-song checkpoints are saved atomically. After a crash or pause, Resume checks the audio header and stored SHA-256 digest before reusing a file. Missing or modified files are downloaded again. This resumes at song boundaries, not at an arbitrary byte position. Each audio attempt has a ten-minute limit.

Resumed jobs keep their original destination and format. New settings apply to new jobs. The former default Music folder is migrated to Downloads for new work; custom locations remain selected. Removing a queue entry does not delete saved audio.

### YouTube confirmation and failures

Provider error details remain available under **Details → Download log**. **Copy diagnostics** copies the selected job's report for troubleshooting. Review it before sharing; it contains source links and song titles.

A detected YouTube human-verification request pauses the queue and shows an **Open YouTube** action. Complete the check yourself in the app's isolated YouTube window, then choose **Use session and resume**. Closing the window keeps downloads paused. Rate limits are shown separately and require waiting before retrying.

No CAPTCHA is solved automatically. The remote YouTube page has no Node access or app bridge. Only after explicit confirmation are this window's YouTube cookies temporarily shared with the local download engine. Cookies from your usual browser are never imported. Temporary exports are removed after use and on startup; the isolated session ends when the app exits. Clear it at any time in Settings while downloads are paused. Google may reject embedded sign-in, and a completed check does not guarantee access.

Spotify supplies metadata. The spotDL engine matches audio from YouTube/YouTube Music; this app does not export Spotify's audio stream. Availability, matching and source quality vary. A higher bitrate or FLAC/WAV conversion cannot restore quality absent from the source. Download content you own or have permission to save.

### Languages

This release bundles **77 complete interface catalogs**, available offline. English is the source language and German has been editorially reviewed. Other catalogs are machine translated and may contain mistakes. Native operating-system dialogs and provider diagnostics can use the system language or English.

The requested target of 160 languages is not yet reached. Incomplete catalogs are excluded from the selector. Translations are generated during development; using the app does not send song titles, links or other user data to a translation service. See `renderer/locales/languages.json` for the exact list.

## Build and run

Use **Node.js 24** and **Python 3.12** on the target operating system.

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

```sh
npm run check
npm test
npm run test:engine
python scripts/smoke_engine.py
npm run package
```

Build output is in `release/`. GitHub Actions uses Node.js 24 and native runners for Windows x64, Linux x64, macOS Intel and macOS Apple Silicon. A new version on `main` publishes a release only after all four builds succeed. Published binaries are never overwritten. Update `package.json`, `package-lock.json`, `renderer/releases.mjs`, the HTML version and README links together for a new release.

The optional `scripts/build_windows_portable.py` builds a Windows portable bundle from Linux using hash-locked Windows dependencies. Native CI packages remain the release path and are checked on Windows.

## Website

The website is a preview with an operating-system and version selector. Actual audio downloads and YouTube confirmation require the desktop app. The preview does not simulate successful downloads.

```sh
npm run build:web
npm run dev
npm run build:site
```

`build:site` produces `dist/` for the Sites configuration in `.openai/hosting.json`.

## Local data

Electron's per-user app-data directory contains `workspace.json`, `sessions/<job-id>.json`, and internal `sessions/staging/` working directories. Completed files remain in the selected download folder. The original playlist snapshot is retained for consistent recovery.

## Verification

Tests cover interrupted jobs, durable writes, duplicate prevention, valid-file reuse, continuation after missing sources, retained error details, individual retry, CAPTCHA pausing, flat output files, library validation and complete language catalogs.

Each native build runs the bundled engine, starts its bundled Deno and FFmpeg, verifies packaged EJS resources, **encodes a real MP3**, promotes it into a destination folder and verifies it in the saved-file library. This is an offline component test, not proof of live YouTube availability. Browser checks cover the shared interface; the full native GUI is not automatically exercised on every operating system.

## License

MIT permits use, modification, distribution and commercial use of the original app code. Keep its license and copyright notice with copies. Third-party components retain their own licenses; see `THIRD_PARTY_NOTICES.md`. Their notices are included in the packages.
