/**
 * Mochi 团子 — blob cat. Purple gradient body, pointy ears, curled tail.
 * Pure SVG; pose classes from PetCharacter animate the groups.
 * viewBox 0 0 120 120, feet on the ground at y≈109.
 */
export default function MochiSvg({ mouthOpen = 1 }: { mouthOpen?: number }): React.JSX.Element {
  const s = Math.max(0.2, Math.min(2.5, mouthOpen))
  return (
    <svg className="pet-svg" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="mochiBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#C4B5FD" />
          <stop offset="100%" stopColor="#8B5CF6" />
        </linearGradient>
      </defs>
      <g className="pet-breath">
        {/* tail */}
        <path className="pet-tail" d="M92 88 C104 84 108 70 100 62 C106 74 100 86 90 90 Z" fill="#7C3AED" />
        {/* ears */}
        <g className="pet-ear-l">
          <path d="M36 42 L30 12 L58 28 Z" fill="#8B5CF6" />
          <path d="M40 34 L36 19 L52 27 Z" fill="#F0ABFC" />
        </g>
        <g className="pet-ear-r">
          <path d="M84 42 L90 12 L62 28 Z" fill="#8B5CF6" />
          <path d="M80 34 L84 19 L68 27 Z" fill="#F0ABFC" />
        </g>
        {/* body blob */}
        <path d="M60 30 C83 30 97 51 97 75 C97 97 81 109 60 109 C39 109 23 97 23 75 C23 51 37 30 60 30 Z" fill="url(#mochiBody)" />
        {/* belly */}
        <ellipse cx="60" cy="90" rx="19" ry="13" fill="#DDD6FE" opacity="0.85" />
        {/* open eyes */}
        <g className="pet-eye-open-g">
          <g className="pet-eye-open">
            <circle cx="46" cy="64" r="5.5" fill="#1F2937" />
            <circle cx="48" cy="62" r="1.8" fill="#FFFFFF" />
          </g>
          <g className="pet-eye-open">
            <circle cx="74" cy="64" r="5.5" fill="#1F2937" />
            <circle cx="76" cy="62" r="1.8" fill="#FFFFFF" />
          </g>
        </g>
        {/* closed eyes (sleep) */}
        <g className="pet-eye-closed">
          <path d="M40 64 Q46 70 52 64" stroke="#1F2937" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          <path d="M68 64 Q74 70 80 64" stroke="#1F2937" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        </g>
        {/* mouth — driven by mouthOpen from audio amplitude */}
        <g transform={`translate(60,76) scale(1,${s}) translate(-60,-76)`}>
          <path d="M54 74 Q57 78 60 74 Q63 78 66 74" stroke="#4C1D95" strokeWidth="2" fill="none" strokeLinecap="round" />
        </g>
        {/* blush */}
        <ellipse cx="37" cy="72" rx="4.5" ry="2.8" fill="#F9A8D4" opacity="0.7" />
        <ellipse cx="83" cy="72" rx="4.5" ry="2.8" fill="#F9A8D4" opacity="0.7" />
        {/* paws */}
        <ellipse className="pet-paw-l" cx="47" cy="106" rx="7" ry="4.5" fill="#6D28D9" />
        <ellipse className="pet-paw-r" cx="73" cy="106" rx="7" ry="4.5" fill="#6D28D9" />
      </g>
    </svg>
  )
}
