# VSHORT music presets

Drop royalty-free MP3 files here with filenames matching the `data-track` ids
used in `public/vshorts.html`:

| Preset id | Filename expected | Mood |
| --- | --- | --- |
| `viral-energy` | `viral-energy.mp3` | Upbeat / trending |
| `dark-ambient` | `dark-ambient.mp3` | Cinematic / moody |
| `lofi-chill` | `lofi-chill.mp3` | Relaxed / educational |
| `hype-drop` | `hype-drop.mp3` | EDM / high energy |
| `acoustic-feel` | `acoustic-feel.mp3` | Warm / storytelling |

`m4a` and `wav` are also accepted. The HyperFrames renderer looks up
`<preset-id>.mp3`, then `.m4a`, then `.wav`.

When a selected preset file is missing, the backend generates a simple local
fallback beat so development exports still finish. For production, add real
licensed music files.

## License

Only drop tracks here whose license permits redistribution and commercial use
(for example Pixabay, YouTube Audio Library "No attribution required" tier, or
Free Music Archive CC0/CC-BY). Commit a `LICENSES.md` alongside the audio files
that records the provenance and license of every track.

These files are excluded from git via `server/assets/music/.gitignore` until
licensing is recorded.
