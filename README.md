# Free Spotify Downloader for Windows, macOS and Linux

**Free Spotify Downloader** is a free, open-source desktop app for managing audio downloads from public Spotify playlist, album and track links. Save matching audio as **MP3, M4A, FLAC, Opus or WAV**, organize up to **100 queued downloads**, and resume interrupted playlists without downloading verified files again.

**How it works:** Spotify provides song and playlist metadata. The local spotDL engine finds matching audio on YouTube or YouTube Music; it does **not** extract Spotify's audio stream or bypass DRM. Source availability, recording versions and audio quality can differ. Download only content you own or have permission to save.

Published by **Jedi Meister** · [MIT-licensed app code](LICENSE) · **82 interface languages**

[**Download the desktop app**](https://github.com/Reini101083/free-spotify-downloader/releases/latest) · [Features](#features) · [Installation](#download) · [Quick start](#using-the-app) · [FAQ](#frequently-asked-questions) · [Build from source](#build-and-run)

## Features

- **Spotify playlist, album and track links:** paste a public Spotify link into a desktop interface; no command-line setup is needed for the packaged app.
- **Windows, Mac and Linux downloads:** Windows installer and portable EXE, macOS Apple Silicon and Intel builds, and Linux AppImage and DEB packages.
- **Five audio formats:** MP3, M4A, FLAC, Opus and WAV, with selectable bitrate where supported.
- **Batch playlist queue:** keep up to 100 playlists, albums or tracks open; process one queue entry at a time and start the next automatically.
- **Optional parallel song downloads:** choose 1, 2 or 3 songs at once within the active playlist. The default is 1; more workers can trigger provider limits.
- **Pause, resume and duplicate prevention:** verify existing files before downloading again, retain song-level checkpoints, and retry unavailable songs separately.
- **Clean filenames and a live saved-song library:** completed files use names such as `Artist - Title.mp3`; Spotify IDs stay in metadata. The saved-song list and counter update automatically.
- **A responsive, multilingual interface:** light/dark/system appearance, 82 bundled languages, right-click paste, optional clipboard detection and automatic Spotify previews without autoplay.

## Download

[**Choose your operating system on the latest release page**](https://github.com/Reini101083/free-spotify-downloader/releases/latest)

| Operating system | Download version 0.2.6 |
| --- | --- |
| Windows · Intel / AMD 64-bit | [Windows installer (.exe)](https://github.com/Reini101083/free-spotify-downloader/releases/download/v0.2.6/Free-Spotify-Downloader-0.2.6-windows-x64-setup.exe) · [Windows portable (.exe)](https://github.com/Reini101083/free-spotify-downloader/releases/download/v0.2.6/Free-Spotify-Downloader-0.2.6-windows-x64-portable.exe) |
| Mac · Apple Silicon | [macOS Apple Silicon (.dmg)](https://github.com/Reini101083/free-spotify-downloader/releases/download/v0.2.6/Free-Spotify-Downloader-0.2.6-mac-arm64.dmg) |
| Mac · Intel | [macOS Intel (.dmg)](https://github.com/Reini101083/free-spotify-downloader/releases/download/v0.2.6/Free-Spotify-Downloader-0.2.6-mac-x64.dmg) |
| Linux · x86_64 | [Linux AppImage](https://github.com/Reini101083/free-spotify-downloader/releases/download/v0.2.6/Free-Spotify-Downloader-0.2.6-linux-x86_64.AppImage) · [Debian / Ubuntu (.deb)](https://github.com/Reini101083/free-spotify-downloader/releases/download/v0.2.6/Free-Spotify-Downloader-0.2.6-linux-amd64.deb) |

No GitHub account is required to download a public release. [Older versions and release notes](https://github.com/Reini101083/free-spotify-downloader/releases) remain available separately. **Source code (zip)** contains source code, not an installer. Each release includes SHA-256 checksums. Python, FFmpeg and Deno are bundled, so packaged-app users do not need to install them separately.

On a Mac, open **Apple menu → About This Mac** to identify Apple Silicon or Intel. Linux AppImage and DEB packages are for x86_64; DEB targets Debian and Ubuntu.

### Windows installation

1. Download the installer or portable executable from this repository's release page.
2. These packages are **unsigned**. If Windows displays **Windows protected your PC**, and you trust the downloaded release, click **More info**, then **Run anyway**.
3. Complete the installer. Approve a Windows permission prompt if the selected installation requires it.
4. The app runs with normal user permissions. Administrator rights are **not required for everyday use**. If installation specifically fails with a permission error, right-click the installer, select **Run as administrator**, and confirm the Windows prompt. For a download-folder permission error, first choose a writable folder in Settings.

The default folder is **Downloads/Free Spotify Downloader**. You can select a different folder or an external drive.

## Using the app

### Download a Spotify playlist as MP3

These steps save available matching audio from YouTube sources, not the Spotify stream. You can use the same workflow for a public album or an individual track.

1. Copy a Spotify track, album or playlist link and switch to the app, or use **right-click → Paste**.
2. In **Settings**, choose **MP3** or another supported audio format and your output folder, then select **Start downloads**. The Spotify preview loads automatically when enabled; audio does not autoplay.
3. Open **Saved songs** to see verified audio files in the selected folder. Use Play or Show in folder directly from the list.
4. Open **Not downloaded** for the reason a song failed. Retry one song or all failed songs. Ordinary song failures do not stop the playlist.

The clipboard feature fills only an empty field while the app is in the foreground. It preserves existing input and never starts downloads automatically. Disable it in Settings. Unrelated clipboard text is not stored or sent.

The responsive interface supports small windows, light/dark/system appearance and keyboard navigation. Language selection is at the top; Settings stays accessible at the bottom on desktop and in the top bar in narrow windows.

### Batch downloads: queue up to 100 playlists

Add up to **100 open playlists, albums or tracks**. The app processes **exactly one queue entry at a time**, in the order you added them. Songs within that entry can use the parallel setting below. The next entry starts automatically after the current worker finishes. The visible list follows the same order: active download, **Up next**, then **Waiting** with queue positions. Completed history does not use an open queue slot; paused and confirmation-blocked entries do.

The circular control pauses only its playlist and lets the next queued playlist run. **Pause downloads · All downloads** pauses the whole queue; **Resume · All downloads** resumes it. Restored sessions remain paused until you resume. Ordinary failures continue to the next entry, while a detected provider verification request stops automatic advancement until you act.

### Parallel song downloads

In **Settings → Simultaneous songs**, choose **1, 2 or 3**. The default is **1**. Only one playlist runs at a time; this setting controls songs inside it. Changes take effect when the next playlist starts or when you pause and resume the current playlist. Existing audio format and destination are preserved.

Parallel modes stagger new song requests by at least five seconds. More workers may improve throughput but do not guarantee faster downloads or prevent provider limits. When a CAPTCHA or rate limit is detected, new song scheduling stops and active provider processes are stopped; completed files remain saved and unfinished songs remain retryable. A rate limit may require waiting and may offer no CAPTCHA. See the [yt-dlp guidance](https://github.com/yt-dlp/yt-dlp/wiki/Extractors#common-youtube-errors).

### Saved MP3 files, duplicate prevention and download recovery

Finished audio files use readable names such as **Artist - Title.mp3** and go directly into the selected download folder. Spotify track IDs are stored in audio metadata and the internal recovery index, not in public filenames. Distinct tracks with the same filename receive a numbered suffix such as **(2)**; existing files are preserved. Resuming an older job verifies and renames its legacy ID-suffixed files without downloading them again. Working files stay in the app's internal data directory. The Saved songs list and its counter refresh automatically as verified songs finish, including while the next playlist runs. Temporary files and invalid audio do not appear as saved songs. A playlist with zero successful files is marked **Failed**, never completed or partially saved.

Queue state and per-song checkpoints are saved atomically. After a crash or pause, Resume checks the audio header and stored SHA-256 digest before reusing a file. Missing or modified files are downloaded again. This resumes at song boundaries, not at an arbitrary byte position. Each audio attempt has a ten-minute limit.

Resumed jobs keep their original destination, format and audio quality. Changes to those settings apply to new jobs; song parallelism applies at the next launch or resume. The former default Music folder is migrated to Downloads for new work; custom locations remain selected. Removing a queue entry does not delete saved audio.

### YouTube confirmation and failures

Provider error details remain available under **Details → Download log**. **Copy diagnostics** copies the selected job's report for troubleshooting. Review it before sharing; it contains source links and song titles.

A detected YouTube human-verification request pauses the queue and shows an **Open YouTube** action. Complete the check yourself in the app's isolated YouTube window, then choose **Use session and resume**. Closing the window keeps downloads paused. Rate limits are shown separately and require waiting before retrying.

No CAPTCHA is solved automatically. The remote YouTube page has no Node access or app bridge. Only after explicit confirmation are this window's YouTube cookies temporarily shared with the local download engine. Cookies from your usual browser are never imported. Temporary exports are removed after use and on startup; the isolated session ends when the app exits. Clear it at any time in Settings while downloads are paused. Google may reject embedded sign-in, and a completed check does not guarantee access.

Optional YouTube sign-in may reduce CAPTCHA checks but is not guaranteed to do so. Using an account with the download provider may lead to temporary or permanent suspension. Avoid a main account; separate accounts are also at risk. This warning appears in every bundled language before session approval.

### Interface languages

This release bundles **82 complete interface catalogs**, available offline. English is the source language and German has been editorially reviewed. Other catalogs are machine translated and may contain mistakes. Native operating-system dialogs and provider diagnostics can use the system language or English.

The target of 160 languages is not yet reached. Incomplete catalogs are excluded from the selector. Translations are generated during development; using the app does not send song titles, links or other user data to a translation service. See the [supported language list](renderer/locales/languages.json) for the exact catalogs, including Romanian, German, English, Turkish and Serbian (Latin).

## Frequently asked questions

### Does this download audio directly from Spotify?

No. Spotify links identify the tracks and playlists. The app uses spotDL to search for matching audio on YouTube and YouTube Music, then processes available sources locally. It is not a Spotify audio-stream extractor, and it does not remove DRM. A match may be a different recording, edit or performance.

### Do I need Spotify Premium?

Spotify Premium is not used by this app. Its metadata workflow uses public Spotify links, not Premium playback access. Private or unavailable playlists may fail to load, and public links do not guarantee that matching audio is available from the provider.

### Which audio formats and bitrates are supported?

Output formats are **MP3, M4A, FLAC, Opus and WAV**. Where the format supports bitrate selection, choose Automatic, 128, 192, 256 or 320 kbps. A higher bitrate does not improve the source recording, and converting lossy audio to FLAC or WAV does not make the source lossless.

### Can I resume a playlist after a crash or avoid duplicate songs?

Yes. Resume checks saved files and continues at song boundaries. Verified files with the same Spotify track identity and output format can be reused across playlists. Different Spotify IDs or recording versions are not automatically treated as the same song. Filenames alone are not proof that a download is complete.

### Where are downloaded MP3 files saved?

The default location is **Downloads/Free Spotify Downloader**. Finished files go directly into the selected folder; temporary working files stay in app data. You can choose another writable folder or an external drive in Settings. Resumed playlists keep their original location.

### What happens when a song is unavailable or YouTube requests a CAPTCHA?

Ordinary song failures are recorded under **Not downloaded**, and the playlist continues. A detected CAPTCHA or provider rate limit stops automatic downloading so the app does not keep sending requests. Manual confirmation is available in the app when YouTube offers it; rate limits may require waiting. See [YouTube confirmation and failures](#youtube-confirmation-and-failures).

### Can I download songs from the website or use an iPhone app?

The website is a preview, not a browser-based audio downloader. The available desktop packages run on Windows, macOS and Linux. There is no native iOS or Android app in this release.

### Is Free Spotify Downloader affiliated with Spotify or YouTube?

No. This is an independent project published by Jedi Meister, not an official Spotify, YouTube or Google application. The MIT license covers the original application code; it does not grant rights to third-party music or other content.

## Support and bug reports

[Report an issue on GitHub](https://github.com/Reini101083/free-spotify-downloader/issues) with your app version, operating system, what you expected and what happened. For download failures, open **Details → Download log** and use **Copy diagnostics**. Review the report before posting: source links and song titles may be included. Never post passwords, cookies or session files.

## Build and run

### Build the desktop app from source

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

Each native build runs the bundled engine, starts its bundled Deno and FFmpeg, verifies packaged EJS resources, downloads an audio fixture through the real spotDL/yt-dlp provider from a loopback HTTP server, rejects an HTML error page, **encodes a real MP3 through spotDL**, promotes it into a destination folder and verifies it in the saved-file library. This is an offline component test, not proof of live YouTube availability. Browser checks cover the shared interface; the full native GUI is not automatically exercised on every operating system.

## License

The [MIT license](LICENSE) permits use, modification, distribution and commercial use of the original app code. Keep its license and copyright notice with copies. Third-party components retain their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md). Their notices are included in the packages.
