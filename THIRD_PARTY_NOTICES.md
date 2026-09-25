# Third-party components

The original Free Spotify Downloader application code is MIT licensed, © 2026
Jedi Meister. This is an independent implementation. Third-party components
retain their own authorship and licenses; the application MIT license does not
relicense them. Their notices are distributed in `licenses/` and the runtime.

| Component | License | Source |
| --- | --- | --- |
| Electron | MIT and bundled Chromium notices | https://github.com/electron/electron |
| Lucide | ISC | https://github.com/lucide-icons/lucide |
| spotDL 4.5.2 (separate executable) | MIT | https://github.com/spotDL/spotify-downloader/tree/v4.5.2 |
| yt-dlp | Unlicense (with its own bundled notices) | https://github.com/yt-dlp/yt-dlp |
| ffmpeg-static 5.3.0 | GPL-3.0-or-later | https://github.com/eugeneware/ffmpeg-static |
| FFmpeg binary b6.1.1 | See platform binary's `ffmpeg.LICENSE` and `ffmpeg.README` | https://github.com/eugeneware/ffmpeg-static/releases/tag/b6.1.1 |
| Deno 2.9.6 | MIT and bundled dependency licenses | https://github.com/denoland/deno |
| Python and Python packages | Per-package licenses in `licenses/python/` | Exact versions and source metadata in the generated inventory |

FFmpeg runs as a separate command-line process. The platform package includes
its original license and README, including the build/source references. See
https://ffmpeg.org/legal.html and the binary supplier's corresponding source
information before redistributing modified FFmpeg binaries. Installer builds
preserve these notices; shipping third-party binaries is subject to their terms.

Spotify, YouTube and YouTube Music are third-party services. This project is
not affiliated with them. Spotify supplies metadata; matched audio comes from
other sources. Availability and matching accuracy depend on those services.
