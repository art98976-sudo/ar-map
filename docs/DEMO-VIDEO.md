# AR demo video (item 10)

The desktop QR panel shows a short muted looping recording of the AR view beside the QR code.
Put the files in `public/media/` with these names (paths are set in `DEMO_VIDEO`, `src/ui/components/phone-handoff.js`):

| File | What |
|---|---|
| `demo-ar.mp4` | The recording: H.264 MP4, about 10-15 s, 720p or less, no sound track, under 3 MB. **Not here yet.** |
| `demo-ar-poster.svg` | Shown before it plays and while it loads. A placeholder; replace with a still from the recording (a `.jpg` is fine: change `poster` in `DEMO_VIDEO`). |
| `demo-ar.en-GB.vtt` | Captions describing what is shown. Placeholder timings: match them to the recording. |

Until `demo-ar.mp4` exists, the video slot hides itself after the first failed load, and the QR
panel looks as before. The file is only fetched on screens 900 px or wider, when the panel is on
screen, and it never autoplays for people who prefer reduced motion.
