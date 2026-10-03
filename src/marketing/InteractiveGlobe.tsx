import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { geoGraticule10, geoInterpolate, geoOrthographic, geoPath } from 'd3-geo'
import { Pause, Play } from 'lucide-react'
import { useI18n, type Lang } from '../i18n'
import land from './globeLand.json'
import './globe.css'

const UI: Record<Lang, { title: string; instructions: string; hint: string; pause: string; resume: string }> = {
  en: {
    title: 'Interactive globe',
    instructions: 'Drag to explore the globe, or use the left and right arrow keys to rotate. Press Space to pause or resume. Connections illustrate cross-border payments, not current service availability.',
    hint: 'Drag to explore',
    pause: 'Pause globe',
    resume: 'Resume globe',
  },
  so: {
    title: 'Duni aad dhaqaajin karto',
    instructions: 'Jiid si aad dunida u sahamiso, ama isticmaal fallaaraha bidix iyo midig si aad u rogto. Riix Space si aad u hakiso ama u sii waddo. Xiriirradu waxay tusaale u yihiin lacag-bixinta xuduudaha ka gudubta; ma muujinayaan helitaanka adeegga hadda.',
    hint: 'Jiid si aad u sahamiso',
    pause: 'Haki dunida',
    resume: 'Sii wad dunida',
  },
  es: {
    title: 'Globo interactivo',
    instructions: 'Arrastre para explorar el globo o use las flechas izquierda y derecha para girarlo. Pulse Espacio para pausar o reanudar. Las conexiones ilustran pagos transfronterizos, no la disponibilidad actual del servicio.',
    hint: 'Arrastre para explorar',
    pause: 'Pausar el globo',
    resume: 'Reanudar el globo',
  },
  'pt-BR': {
    title: 'Globo interativo',
    instructions: 'Arraste para explorar o globo ou use as setas esquerda e direita para girar. Pressione Espaço para pausar ou retomar. As conexões ilustram pagamentos internacionais, não a disponibilidade atual do serviço.',
    hint: 'Arraste para explorar',
    pause: 'Pausar o globo',
    resume: 'Retomar o globo',
  },
  ar: {
    title: 'كرة أرضية تفاعلية',
    instructions: 'اسحب لاستكشاف الكرة الأرضية، أو استخدم سهمي اليسار واليمين لتدويرها. اضغط مفتاح المسافة للإيقاف المؤقت أو الاستئناف. توضح الروابط فكرة المدفوعات عبر الحدود ولا تشير إلى توفر الخدمة حالياً.',
    hint: 'اسحب للاستكشاف',
    pause: 'إيقاف الكرة الأرضية مؤقتاً',
    resume: 'استئناف حركة الكرة الأرضية',
  },
}

type Coordinate = [number, number]
type View = { longitude: number; latitude: number; phase: number }
type ProjectedPoint = { x: number; y: number; visible: boolean; depth: number }

const CENTER = 260
const RADIUS = 190
const radians = Math.PI / 180
const graticule = geoGraticule10()

// These geographic connections are illustrative. They are not a list of
// XpressTend payout corridors, existing partners, or live transactions.
const connections: { from: Coordinate; to: Coordinate }[] = [
  { from: [-74.01, 40.71], to: [-17.45, 14.69] },
  { from: [-74.01, 40.71], to: [-46.63, -23.55] },
  { from: [-46.63, -23.55], to: [-17.45, 14.69] },
  { from: [-17.45, 14.69], to: [36.82, -1.29] },
  { from: [2.35, 48.86], to: [72.88, 19.08] },
  { from: [36.82, -1.29], to: [72.88, 19.08] },
  { from: [72.88, 19.08], to: [103.82, 1.35] },
  { from: [103.82, 1.35], to: [151.21, -33.87] },
  { from: [-122.33, 47.61], to: [139.69, 35.68] },
].map((route) => ({ from: route.from as Coordinate, to: route.to as Coordinate }))

const routes = connections.map(({ from, to }) => ({
  from,
  to,
  interpolate: geoInterpolate(from, to),
}))
const nodes = [...new Map(connections.flatMap(({ from, to }) => [from, to]).map((point) => [point.join(','), point])).values()]

function wrapLongitude(longitude: number) {
  return ((longitude + 180) % 360 + 360) % 360 - 180
}

function projectPoint(point: Coordinate, view: View, height = 0): ProjectedPoint {
  const longitude = (point[0] - view.longitude) * radians
  const latitude = point[1] * radians
  const tilt = view.latitude * radians
  const x = Math.cos(latitude) * Math.sin(longitude)
  const y = Math.cos(tilt) * Math.sin(latitude) - Math.sin(tilt) * Math.cos(latitude) * Math.cos(longitude)
  const depth = Math.sin(tilt) * Math.sin(latitude) + Math.cos(tilt) * Math.cos(latitude) * Math.cos(longitude)
  const radius = RADIUS * (1 + height)
  const projectedX = x * radius
  const projectedY = y * radius
  return {
    x: CENTER + projectedX,
    y: CENTER - projectedY,
    depth,
    // Raised arcs may remain visible beyond the limb even on the far side.
    // Everything projected behind the sphere itself is fully occluded.
    visible: depth >= 0 || projectedX * projectedX + projectedY * projectedY > RADIUS * RADIUS,
  }
}

function pointOnRoute(route: typeof routes[number], position: number, view: View) {
  return projectPoint(route.interpolate(position), view, 0.19 * Math.sin(Math.PI * position))
}

function routePath(route: typeof routes[number], view: View) {
  let path = ''
  let segmentOpen = false
  for (let step = 0; step <= 64; step += 1) {
    const point = pointOnRoute(route, step / 64, view)
    if (!point.visible) {
      segmentOpen = false
      continue
    }
    path += `${segmentOpen ? 'L' : 'M'}${point.x.toFixed(2)},${point.y.toFixed(2)}`
    segmentOpen = true
  }
  return path
}

/**
 * Orthographic globe with geographic clipping and an explicitly illustrative
 * payment network. Land is Natural Earth's public-domain 110m vector dataset:
 * https://www.naturalearthdata.com/about/terms-of-use/
 * https://github.com/nvkelso/natural-earth-vector/blob/master/geojson/ne_110m_land.geojson
 * Coordinates are bundled locally and rounded to three decimal places.
 */
export function InteractiveGlobe() {
  const { lang } = useI18n()
  const copy = UI[lang]
  const uniqueId = useId().replace(/:/g, '')
  const ids = {
    ocean: `globe-ocean-${uniqueId}`,
    land: `globe-land-${uniqueId}`,
    shade: `globe-shade-${uniqueId}`,
    glow: `globe-glow-${uniqueId}`,
    instructions: `globe-instructions-${uniqueId}`,
  }
  const root = useRef<HTMLElement>(null)
  const [view, setView] = useState<View>({ longitude: -28, latitude: 17, phase: 0 })
  const [reducedMotion, setReducedMotion] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [paused, setPaused] = useState(reducedMotion)
  const [inView, setInView] = useState(true)
  const [visible, setVisible] = useState(() => typeof document === 'undefined' || document.visibilityState !== 'hidden')
  const [dragging, setDragging] = useState(false)
  const drag = useRef<{ pointerId: number; x: number; y: number; longitude: number; latitude: number } | null>(null)
  const canAnimate = !paused && inView && visible && !dragging

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => {
      setReducedMotion(preference.matches)
      if (preference.matches) setPaused(true)
    }
    preference.addEventListener('change', onChange)
    return () => preference.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    const onVisibility = () => setVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', onVisibility)
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.05 })
    if (root.current) observer.observe(root.current)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      observer.disconnect()
    }
  }, [])

  useEffect(() => {
    if (!canAnimate) return
    let frame = 0
    let lastPaint = 0
    const animate = (now: number) => {
      if (!lastPaint) lastPaint = now
      const elapsed = now - lastPaint
      // Geographic reprojection at 30fps keeps the globe smooth without
      // needlessly rendering 5,000 coastline vertices at screen refresh rate.
      if (elapsed >= 1000 / 30) {
        const seconds = Math.min(elapsed, 80) / 1000
        setView((current) => ({
          ...current,
          longitude: wrapLongitude(current.longitude + seconds * 3.6),
          phase: (current.phase + seconds / 4.8) % 1,
        }))
        lastPaint = now
      }
      frame = window.requestAnimationFrame(animate)
    }
    frame = window.requestAnimationFrame(animate)
    return () => window.cancelAnimationFrame(frame)
  }, [canAnimate])

  const geography = useMemo(() => {
    const projection = geoOrthographic()
      .translate([CENTER, CENTER])
      .scale(RADIUS)
      .rotate([-view.longitude, -view.latitude])
      .clipAngle(90)
      .precision(0.6)
    const path = geoPath(projection)
    return { land: path(land as GeoJSON.MultiPolygon) ?? '', grid: path(graticule) ?? '' }
  }, [view.longitude, view.latitude])
  const projectedRoutes = routes.map((route, index) => ({
    path: routePath(route, view),
    particle: pointOnRoute(route, (view.phase + index * 0.137) % 1, view),
  }))
  const projectedNodes = nodes.map((point) => projectPoint(point, view))

  function rotateWithKeyboard(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault()
      const change = event.key === 'ArrowRight' ? 12 : -12
      setView((current) => ({ ...current, longitude: wrapLongitude(current.longitude + change) }))
    } else if (event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault()
      setPaused((current) => !current)
    }
  }

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0) return
    drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, longitude: view.longitude, latitude: view.latitude }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.currentTarget.focus({ preventScroll: true })
    setDragging(true)
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current
    if (!current || current.pointerId !== event.pointerId) return
    const deltaX = event.clientX - current.x
    const deltaY = event.clientY - current.y
    if (event.pointerType === 'touch' && Math.abs(deltaY) > Math.abs(deltaX)) return
    setView((previous) => ({
      ...previous,
      longitude: wrapLongitude(current.longitude - deltaX * 0.3),
      latitude: event.pointerType === 'touch' ? previous.latitude : Math.max(-45, Math.min(55, current.latitude + deltaY * 0.2)),
    }))
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId) return
    drag.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    setDragging(false)
  }

  const animationState = paused ? (reducedMotion ? 'reduced-motion' : 'paused') : !visible ? 'hidden' : !inView ? 'offscreen' : dragging ? 'dragging' : 'playing'

  return (
    <figure
      ref={root}
      className="corporate-globe xt-globe"
      data-longitude={view.longitude.toFixed(2)}
      data-paused={paused}
      data-animation-state={animationState}
    >
      <div
        className="xt-globe-surface"
        role="group"
        aria-label={copy.title}
        aria-describedby={ids.instructions}
        tabIndex={0}
        onKeyDown={rotateWithKeyboard}
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onLostPointerCapture={endDrag}
      >
        <svg viewBox="0 0 520 520" fill="none" aria-hidden="true" focusable="false">
          <defs>
            <radialGradient id={ids.ocean} cx="35%" cy="29%" r="75%">
              <stop stopColor="#1b5865" />
              <stop offset="0.56" stopColor="#0c3442" />
              <stop offset="1" stopColor="#061b26" />
            </radialGradient>
            <linearGradient id={ids.land} x1="110" y1="80" x2="390" y2="420" gradientUnits="userSpaceOnUse">
              <stop stopColor="#7adadd" />
              <stop offset="0.52" stopColor="#42a7b2" />
              <stop offset="1" stopColor="#1e6072" />
            </linearGradient>
            <radialGradient id={ids.shade} cx="31%" cy="27%" r="76%">
              <stop offset="0.3" stopColor="#071d29" stopOpacity="0" />
              <stop offset="0.76" stopColor="#051721" stopOpacity="0.12" />
              <stop offset="1" stopColor="#04131c" stopOpacity="0.84" />
            </radialGradient>
            <filter id={ids.glow} x="-60%" y="-60%" width="220%" height="220%">
              <feGaussianBlur stdDeviation="3" />
            </filter>
          </defs>
          <circle className="xt-globe-atmosphere" cx={CENTER} cy={CENTER} r={RADIUS + 15} />
          <circle cx={CENTER} cy={CENTER} r={RADIUS + 4} stroke="#64d9dd" strokeOpacity="0.18" />
          <circle cx={CENTER} cy={CENTER} r={RADIUS} fill={`url(#${ids.ocean})`} />
          <path className="xt-globe-grid" d={geography.grid} />
          <path className="xt-globe-land" d={geography.land} fill={`url(#${ids.land})`} />
          <circle cx={CENTER} cy={CENTER} r={RADIUS} fill={`url(#${ids.shade})`} />
          <circle cx={CENTER} cy={CENTER} r={RADIUS} stroke="#86e8eb" strokeOpacity="0.37" />
          <g className="xt-globe-connections">
            {projectedRoutes.map(({ path }, index) => (
              <g key={index}>
                <path d={path} className="xt-globe-arc-glow" filter={`url(#${ids.glow})`} />
                <path d={path} className="xt-globe-arc" />
              </g>
            ))}
          </g>
          <g className="xt-globe-nodes">
            {projectedNodes.map((point, index) => point.depth > 0.015 && (
              <g key={index} opacity={Math.min(1, point.depth * 5)}>
                <circle cx={point.x} cy={point.y} r="6.5" stroke="#91ffff" strokeOpacity="0.4" />
                <circle cx={point.x} cy={point.y} r="2.6" fill="#dcffff" />
              </g>
            ))}
          </g>
          <g className="xt-globe-particles">
            {projectedRoutes.map(({ particle }, index) => particle.visible && (
              <g key={index}>
                <circle cx={particle.x} cy={particle.y} r="5" fill="#7cfcff" opacity="0.65" filter={`url(#${ids.glow})`} />
                <circle className="xt-globe-particle" cx={particle.x} cy={particle.y} r="2" fill="#f0ffff" />
              </g>
            ))}
          </g>
        </svg>
      </div>
      <div className="xt-globe-controls">
        <button type="button" className="xt-globe-toggle" onClick={() => setPaused((current) => !current)} aria-pressed={paused} aria-label={paused ? copy.resume : copy.pause}>
          {paused ? <Play size={13} fill="currentColor" aria-hidden="true" /> : <Pause size={13} aria-hidden="true" />}
        </button>
      </div>
      <p className="xt-globe-hint">{copy.hint}</p>
      <p className="sr-only" id={ids.instructions}>{copy.instructions}</p>
    </figure>
  )
}
