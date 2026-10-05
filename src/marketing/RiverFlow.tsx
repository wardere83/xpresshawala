import { useEffect, useId, useRef, useState } from 'react'
import './river.css'

const leftBank = 'M103 -12 C41 34 60 72 86 101 C114 133 108 153 77 185 C52 211 47 235 51 254'
const rightBank = 'M164 -12 C99 35 108 66 136 96 C172 135 170 162 133 201 C114 221 110 239 115 254'
const river = `${leftBank} L115 254 C110 239 114 221 133 201 C170 162 172 135 136 96 C108 66 99 35 164 -12 Z`

/** A decorative river: the banks stay still while the current passes between them. */
export function RiverFlow() {
  const id = useId().replace(/:/g, '')
  const ref = useRef<SVGSVGElement>(null)
  const [active, setActive] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    let visible = false
    const update = () => setActive(visible && document.visibilityState === 'visible')
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      update()
    })
    observer.observe(element)
    document.addEventListener('visibilitychange', update)
    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', update)
    }
  }, [])

  return (
    <svg ref={ref} className="xt-river" viewBox="0 0 240 240" data-active={active}
      aria-hidden="true" focusable="false">
      <defs>
        <clipPath id={`${id}-circle`}><circle cx="120" cy="120" r="106" /></clipPath>
        <clipPath id={`${id}-water`}><path d={river} /></clipPath>
        <radialGradient id={`${id}-land`} cx="48%" cy="40%" r="70%">
          <stop stopColor="#173d46" /><stop offset="1" stopColor="#0b252f" />
        </radialGradient>
        <linearGradient id={`${id}-depth`} x1="80" y1="0" x2="150" y2="240" gradientUnits="userSpaceOnUse">
          <stop stopColor="#20565f" /><stop offset="0.48" stopColor="#2d7880" /><stop offset="1" stopColor="#164d57" />
        </linearGradient>
      </defs>
      <circle className="xt-river-outer-ring" cx="120" cy="120" r="113" />
      <g clipPath={`url(#${id}-circle)`}>
        <circle cx="120" cy="120" r="106" fill={`url(#${id}-land)`} />
        <g className="xt-river-contours">
          <path d="M70 -10 C16 40 34 81 58 112 C82 142 76 156 48 188 C28 211 24 235 27 255" />
          <path d="M84 -10 C26 37 44 78 69 108 C95 138 91 155 61 187 C37 211 34 235 38 255" />
          <path d="M183 -10 C127 35 130 62 155 92 C195 137 191 170 153 210 C140 225 134 240 137 255" />
          <path d="M197 -10 C143 36 143 61 169 90 C211 136 207 174 170 214 C158 229 154 241 155 255" />
        </g>
        <path d={river} fill={`url(#${id}-depth)`} />
        <g clipPath={`url(#${id}-water)`}>
          <g className="xt-river-currents">
            <path className="xt-river-motion xt-river-current" pathLength="100" d="M112 -12 C53 36 70 73 97 101 C128 134 122 155 92 187 C68 214 63 237 68 255" />
            <path className="xt-river-motion xt-river-current" pathLength="100" d="M124 -12 C65 36 81 70 107 100 C139 134 133 159 102 191 C80 214 74 237 78 255" />
            <path className="xt-river-motion xt-river-current" pathLength="100" d="M139 -12 C80 36 91 69 119 98 C150 134 146 160 116 196 C95 216 90 237 94 255" />
            <path className="xt-river-motion xt-river-current" pathLength="100" d="M152 -12 C91 36 101 67 129 96 C164 134 159 161 128 199 C108 220 100 238 105 255" />
          </g>
          <g className="xt-river-ripples">
            <path className="xt-river-motion xt-river-ripple" d="M67 63 Q93 77 123 59 M81 77 Q103 89 134 74" />
            <path className="xt-river-motion xt-river-ripple" d="M105 135 Q135 147 164 134 M105 147 Q131 159 159 146" />
            <path className="xt-river-motion xt-river-ripple" d="M58 211 Q82 222 118 208 M55 222 Q79 232 115 220" />
          </g>
        </g>
        <g className="xt-river-banks"><path d={leftBank} /><path d={rightBank} /></g>
      </g>
      <circle className="xt-river-rim" cx="120" cy="120" r="106" />
    </svg>
  )
}
