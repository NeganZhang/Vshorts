# VSHORT music presets

Drop royalty-free MP3 files here with filenames matching the `data-track` ids
used in `public/vshorts.html`:

| Preset id         | Filename expected      | Mood                   |
|-------------------|------------------------|------------------------|
| `viral-energy`    | `viral-energy.mp3`     | Upbeat / trending      |
| `dark-ambient`    | `dark-ambient.mp3`     | Cinematic / moody      |
| `lofi-chill`      | `lofi-chill.mp3`       | Relaxed / educational  |
| `hype-drop`       | `hype-drop.mp3`        | EDM / high energy      |
| `acoustic-feel`   | `acoustic-feel.mp3`    | Warm / storytelling    |

`m4a` and `wav` are also accepted — `server/python/run_cutclaw.py` looks up
`<preset-id>.mp3` first but will accept the other extensions too.

When no preset is chosen (or the file is missing), the CutClaw wrapper
extracts the source video's own audio track and uses that as the BGM so the
pipeline never stalls.

## License

Only drop tracks here whose license permits redistribution + commercial use
(e.g. Pixabay, YouTube Audio Library — "No attribution required" tier,
Free Music Archive CC0/CC-BY). Commit a `LICENSES.md` alongside the audio
files that records the provenance + license of every track.

These files are excluded from git via `server/assets/music/.gitignore` until
licensing is recorded — see that file.
