# Brand film and app showcase

`closer.mp4` is the 26-second XpressTend brand film (H.264/AAC, 1920×1080).
`closer-poster.webp` is its opening card and `closer.en.vtt` supplies captions.
The three `app-*.webp` images are captured from the real application's local
explore mode. See `scripts/brand-film/README.md` for regeneration instructions.
The film loads only when played and has no automatic playback.

# Sign-up panel video

Drop an MP4 here named `join-family.mp4` and the sign-up page will play it in
place of the still image, with no code change required.

Requirements:

- **H.264 MP4**, which every current browser plays.
- **No audio track.** It autoplays, and browsers only permit that when muted;
  a page that starts making noise during sign-up loses people.
- **Portrait or square**, roughly 4:5. The panel crops with `object-cover`, so
  a landscape clip will lose its sides.
- **Keep it under about 3 MB.** It loads on the sign-up path, where any delay
  costs conversions.

`src/assets/brand/join-family.jpg` stays in place as the poster frame, shown
while the video buffers and to anyone whose browser blocks autoplay.

# Philanthropy banner film

Drop an MP4 here named `community-literacy.mp4`, with its opening frame as
`community-literacy-poster.webp`, and the XpressTend Financial Literacy page
will play it behind the banner, with no code change required. Until then the
page shows a still banner.

Requirements:

- **H.264 MP4, landscape 16:9**, 1920×1080. The banner crops with
  `object-cover`, so keep faces away from the edges.
- **No audio track.** It autoplays muted and loops.
- **Keep it under about 6 MB**, roughly 15 to 25 seconds.
- **Licensed footage of real people**, with releases that cover commercial use.
