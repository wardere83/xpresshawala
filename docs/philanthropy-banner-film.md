# Philanthropy banner film

Drop an MP4 into `public/media/` named `community-literacy.mp4`, with its
opening frame as `community-literacy-poster.webp`, and the XpressTend Financial Literacy page
will play it behind the banner, with no code change required. Until then the
page shows a still banner.

Requirements:

- **H.264 MP4, landscape 16:9**, 1920×1080. On phones the whole frame plays
  above the words. On large screens it fills the banner behind them: roughly
  the left 60% sits under a dark scrim so the words stay legible, and
  `object-cover` trims the frame edges to fit. Frame people in the right-hand
  third and keep faces clear of the edges.
- **No audio track.** It autoplays muted and loops.
- **Keep it under about 6 MB**, roughly 15 to 25 seconds.
- **Licensed footage of real people**, with releases that cover commercial use.
