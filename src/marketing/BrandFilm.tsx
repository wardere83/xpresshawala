import { useEffect, useRef, useState } from 'react'
import { Pause, Play } from 'lucide-react'
import { useBrandCopy } from './brandCopy'

const media = `${import.meta.env.BASE_URL}media/`

/**
 * The brand film.
 *
 * An ambient loop rather than something to be watched once: muted, looping,
 * inline, and without native audio controls. A custom play/pause button lets
 * visitors stop the loop while keeping playback muted.
 *
 * `preload="metadata"` rather than `none`, because it has to start by itself;
 * and rather than `auto`, so a phone on cellular does not fetch the whole file
 * before the page is even scrolled to it.
 */
export function BrandFilm() {
  const copy = useBrandCopy()
  const video = useRef<HTMLVideoElement>(null)
  const intentionallyPaused = useRef(false)
  const [failed, setFailed] = useState(false)
  /*
   * Someone who has asked their system not to animate things should not be
   * handed a looping video. They get the poster and a play button instead, so
   * the film is still available, just not imposed. Checked at runtime rather
   * than in CSS because it decides whether to autoplay, not how to style.
   */
  const [reduceMotion, setReduceMotion] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    const q = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = (e: MediaQueryListEvent) => {
      setReduceMotion(e.matches)
      if (e.matches) video.current?.pause()
      else if (!intentionallyPaused.current) void video.current?.play().catch(() => {})
    }
    q.addEventListener('change', onChange)
    return () => q.removeEventListener('change', onChange)
  }, [])

  const play = async () => {
    if (!video.current) return
    intentionallyPaused.current = false
    try {
      await video.current.play()
      setPlaying(true)
    } catch {
      // Autoplay refused. The poster and the button stay, so it is still
      // reachable on a tap.
      setPlaying(false)
    }
  }

  return (
    <section className="brand-film" id="brand-film" aria-labelledby="film-title">
      <div className="brand-section-heading">
        <h2 id="film-title">{copy.filmTitle}</h2>
        <span className="brand-eyebrow">{copy.filmLabel}</span>
      </div>
      <div className="brand-cinema">
        <video
          ref={video}
          /* No controls, ever: a control bar is a volume slider. */
          playsInline
          muted
          loop
          autoPlay={!reduceMotion}
          preload="metadata"
          poster={`${media}closer-poster.webp`}
          aria-label={copy.play}
          aria-describedby="film-description"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onError={() => setFailed(true)}
        >
          <source src={`${media}closer.mp4`} type="video/mp4" onError={() => setFailed(true)} />
          {/* No captions track: with no audio there is nothing to caption, and
              with no controls there would be no way to switch them on. The
              content of the film is described for screen readers below. */}
        </video>
        {/* The film loops by default; visitors can pause it at any time. */}
        {!failed && (
          <button
            type="button"
            className="brand-film-play"
            onClick={() => {
              if (playing) {
                intentionallyPaused.current = true
                video.current?.pause()
              }
              else void play()
            }}
            aria-label={playing ? copy.pause : copy.play}
          >
            {playing
              ? <Pause size={26} fill="currentColor" aria-hidden="true" />
              : <Play size={26} fill="currentColor" aria-hidden="true" />}
          </button>
        )}
        {failed && (
          <a className="brand-film-fallback" href={`${media}closer.mp4`}>
            {copy.watch} ↗
          </a>
        )}
      </div>
      <p className="sr-only" id="film-description">
        {copy.filmDescription}
      </p>
    </section>
  )
}
