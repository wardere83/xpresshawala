import { useEffect, useRef, useState } from 'react'
import { ArrowUpRight, HeartHandshake, Languages, Pause, Play, Sprout } from 'lucide-react'
import { brand } from '../config/brand'
import { PageFooter, PageHeader } from './PageShell'
import { usePageTitle } from './usePageTitle'

const media = `${import.meta.env.BASE_URL}media/`
const FILM_SRC = `${media}community-literacy.mp4`
const FILM_POSTER = `${media}community-literacy-poster.webp`
const enquiry = `mailto:${brand.support.email}?subject=Financial%20Literacy%20enquiry`

const THEMES = [
  'Real money skills',
  'Upward mobility',
  'Community wealth',
  'Cultural brilliance',
  'Youth leadership',
  'Generational knowledge',
  'Shared prosperity',
]

const PRINCIPLES = [
  {
    Icon: Languages,
    title: 'Culturally congruent',
    body: 'Learning in the languages, examples and traditions people already live with, led by voices they recognise and trust.',
  },
  {
    Icon: Sprout,
    title: 'Strengths-based',
    body: 'We start from the skill already in the room, from savings circles to family enterprise, and build toward new tools.',
  },
  {
    Icon: HeartHandshake,
    title: 'Community-led',
    body: 'Communities set the priorities. We bring resources, tools and a commitment that lasts longer than a single programme.',
  },
]

const SKILLS = [
  { title: 'Earning and budgeting', body: 'Making a plan for every dollar, shilling and real.' },
  { title: 'Saving and credit', body: 'Building a cushion, a record and a stronger position.' },
  { title: 'Sending money safely', body: 'Understanding fees, exchange rates and delivery before a transfer leaves.' },
  { title: 'Digital confidence', body: 'Using financial technology securely and recognising fraud early.' },
  { title: 'Enterprise', body: 'Turning an idea, a craft or a side business into steady income.' },
  { title: 'Ownership', body: 'Investing for the long term so that progress lasts across generations.' },
]

const PLACES = [
  { name: 'Washington state', body: 'Home. Where XpressTend is headquartered and where our commitment begins.' },
  { name: 'Nairobi', body: 'A city of young builders, mobile-money pioneers and relentless ambition.' },
  { name: 'São Paulo', body: 'Creative, entrepreneurial neighbourhoods with the drive to match.' },
  { name: 'And beyond', body: 'Wherever families stay connected across borders, there are great minds to invest in.' },
]

/**
 * The banner film.
 *
 * It plays public/media/community-literacy.mp4 when that file exists and shows
 * the still banner otherwise, so footage can be added without touching this
 * component. Muted, looped and inline, with a pause control because it moves
 * for longer than five seconds.
 */
function useBannerFilm() {
  const [available, setAvailable] = useState(false)

  useEffect(() => {
    let cancelled = false
    // HEAD first: pointing <video> at a missing file logs a console error.
    fetch(FILM_SRC, { method: 'HEAD' })
      .then((res) => {
        const type = res.headers.get('content-type') ?? ''
        if (!cancelled && res.ok && type.startsWith('video/')) setAvailable(true)
      })
      .catch(() => {
        /* No film published yet; the still banner stands in. */
      })
    return () => {
      cancelled = true
    }
  }, [])

  return available
}

function Banner() {
  const hasFilm = useBannerFilm()
  const video = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [reduceMotion] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )

  return (
    <section className="relative isolate overflow-hidden bg-xt-navy text-white" aria-labelledby="philanthropy-title">
      {hasFilm ? (
        <video
          ref={video}
          className="absolute inset-0 -z-20 h-full w-full object-cover"
          poster={FILM_POSTER}
          autoPlay={!reduceMotion}
          muted
          loop
          playsInline
          preload="metadata"
          aria-label="Community members of different ages and backgrounds learning about money together in a classroom and around their neighbourhood."
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
        >
          <source src={FILM_SRC} type="video/mp4" />
        </video>
      ) : (
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-20 bg-[radial-gradient(90%_70%_at_85%_10%,rgba(75,209,211,0.34),transparent_60%),radial-gradient(70%_60%_at_5%_100%,rgba(131,166,176,0.3),transparent_65%)]"
        />
      )}
      {/* Scrim so the words stay legible whatever the frame underneath does. */}
      <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-r from-xt-navy via-xt-navy/80 to-xt-navy/30" />

      <div className="mx-auto max-w-5xl px-5 py-20 sm:px-8 sm:py-28 lg:py-36">
        <p className="text-xs font-semibold uppercase tracking-widest text-xt-turquoise">Philanthropy</p>
        <h1 id="philanthropy-title" className="mt-5 max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl lg:text-6xl">
          XpressTend Financial Literacy
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-white/90 sm:text-xl">
          Real money skills. Lasting upward mobility. Built alongside the communities we call home.
        </p>
        <ul className="mt-9 flex max-w-3xl flex-wrap gap-2.5" aria-label="What this work stands for">
          {THEMES.map((theme) => (
            <li key={theme} className="rounded-full border border-white/25 bg-white/10 px-4 py-1.5 text-sm font-medium backdrop-blur-sm">
              {theme}
            </li>
          ))}
        </ul>
      </div>

      {hasFilm ? (
        <button
          type="button"
          className="absolute bottom-5 right-5 grid h-11 w-11 place-items-center rounded-full border border-white/40 bg-xt-navy/60 text-white backdrop-blur-sm hover:bg-xt-navy focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-xt-turquoise"
          onClick={() => {
            if (playing) video.current?.pause()
            else void video.current?.play().catch(() => {})
          }}
          aria-label={playing ? 'Pause the film' : 'Play the film'}
        >
          {playing
            ? <Pause size={18} fill="currentColor" aria-hidden="true" />
            : <Play size={18} fill="currentColor" aria-hidden="true" />}
        </button>
      ) : null}
    </section>
  )
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold uppercase tracking-widest text-brand-700">{children}</p>
}

export function Philanthropy() {
  usePageTitle('XpressTend Financial Literacy')

  return (
    <div lang="en" dir="ltr" className="min-h-dvh bg-white text-ink-900">
      <PageHeader />
      <main id="company-content" tabIndex={-1} className="focus:outline-none">
        <Banner />

        <section className="mx-auto grid max-w-5xl gap-8 px-5 py-16 sm:px-8 sm:py-20 lg:grid-cols-[1fr_1.15fr] lg:gap-14" aria-labelledby="mission-heading">
          <div>
            <Eyebrow>Why we do this</Eyebrow>
            <h2 id="mission-heading" className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
              Let’s also make financial literacy cool.
            </h2>
          </div>
          <div className="space-y-5 text-base leading-relaxed text-ink-700 sm:text-lg">
            <p>
              We build real money skills and lasting upward mobility in underserved communities
              across Washington state, Nairobi, São Paulo, and beyond.
            </p>
            <p>
              Money knowledge travels the way culture does: through family, language, humour and
              trust. XpressTend Financial Literacy meets people there, in the classroom and in the
              neighbourhoods around it, with learning that feels like it already belongs to them.
            </p>
          </div>
        </section>

        <section className="bg-canvas" aria-labelledby="value-heading">
          <div className="mx-auto max-w-5xl px-5 py-16 sm:px-8 sm:py-20">
            <Eyebrow>The value we add</Eyebrow>
            <h2 id="value-heading" className="mt-5 max-w-4xl text-3xl font-semibold leading-tight tracking-tight sm:text-4xl lg:text-5xl">
              We add value to the community by investing in the great minds of today and tomorrow.
            </h2>
            <p className="mt-6 max-w-2xl text-base leading-relaxed text-ink-700 sm:text-lg">
              Young people, parents, elders and entrepreneurs already carry the ideas that move a
              community forward. Our role is to invest in that talent, and to stay long enough to
              see it compound.
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-5 py-16 sm:px-8 sm:py-20" aria-labelledby="approach-heading">
          <Eyebrow>Our approach</Eyebrow>
          <h2 id="approach-heading" className="mt-4 max-w-3xl text-3xl font-semibold tracking-tight sm:text-4xl">
            Culturally congruent, strengths-based strategies.
          </h2>
          <p className="mt-6 max-w-3xl text-base leading-relaxed text-ink-700 sm:text-lg">
            Every community we work with already holds deep financial knowledge: families who
            budget across two currencies, savings circles built on trust, and entrepreneurs who
            started with very little. We support through culturally congruent, strengths-based
            strategies that begin with those strengths and build on them.
          </p>
          <div className="mt-10 grid gap-5 md:grid-cols-3">
            {PRINCIPLES.map(({ Icon, title, body }) => (
              <article key={title} className="rounded-2xl border border-ink-200 p-6">
                <Icon size={27} strokeWidth={1.4} aria-hidden="true" className="text-brand-700" />
                <h3 className="mt-5 text-lg font-semibold text-ink-900">{title}</h3>
                <p className="mt-2 text-[15px] leading-7 text-ink-700">{body}</p>
              </article>
            ))}
          </div>
          <div className="mt-10 rounded-2xl bg-xt-navy p-7 text-white sm:p-10">
            <p className="max-w-3xl text-2xl font-semibold leading-snug tracking-tight sm:text-3xl">
              We don’t utilize philanthropic efforts that are deficit-based.
            </p>
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-white/85">
              Deficit-based efforts begin with what a community is said to lack. We begin with what
              it already knows, already does well and already aspires to.
            </p>
          </div>
        </section>

        <section className="border-y border-ink-200/70" aria-labelledby="skills-heading">
          <div className="mx-auto max-w-5xl px-5 py-16 sm:px-8 sm:py-20">
            <Eyebrow>What we teach</Eyebrow>
            <h2 id="skills-heading" className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
              Real money skills, for real life.
            </h2>
            <dl className="mt-10 grid gap-x-10 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
              {SKILLS.map((skill) => (
                <div key={skill.title} className="border-t-2 border-xt-turquoise pt-4">
                  <dt className="text-base font-semibold text-ink-900">{skill.title}</dt>
                  <dd className="mt-2 text-[15px] leading-7 text-ink-700">{skill.body}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-5 py-16 sm:px-8 sm:py-20" aria-labelledby="places-heading">
          <Eyebrow>Where we show up</Eyebrow>
          <h2 id="places-heading" className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
            Local roots, across the globe.
          </h2>
          <ul className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {PLACES.map((place) => (
              <li key={place.name} className="rounded-2xl bg-canvas p-6">
                <h3 className="text-lg font-semibold text-ink-900">{place.name}</h3>
                <p className="mt-2 text-[15px] leading-7 text-ink-700">{place.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="bg-xt-navy text-white" aria-labelledby="join-heading">
          <div className="mx-auto max-w-5xl px-5 py-16 sm:px-8 sm:py-20">
            <h2 id="join-heading" className="max-w-2xl text-3xl font-semibold tracking-tight sm:text-4xl">
              Invest in great minds with us.
            </h2>
            <p className="mt-5 max-w-2xl text-base leading-relaxed text-white/85 sm:text-lg">
              Schools, community organisations and local leaders: tell us what your community
              wants to learn, and how XpressTend Financial Literacy can support it.
            </p>
            <a
              className="mt-8 inline-flex items-center gap-2 rounded-full bg-xt-turquoise px-6 py-3 text-sm font-semibold text-xt-navy hover:bg-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
              href={enquiry}
            >
              Contact XpressTend Financial Literacy <ArrowUpRight size={17} aria-hidden="true" />
            </a>
          </div>
        </section>
      </main>
      <PageFooter />
    </div>
  )
}
