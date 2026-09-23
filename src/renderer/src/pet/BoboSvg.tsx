/**
 * Bobo 豆豆 — shiba puppy. Warm amber body, cream muzzle, floppy ears,
 * curled tail, signature cream eyebrow dots.
 * Pure SVG; pose classes from PetCharacter animate the groups.
 * viewBox 0 0 120 120, feet on the ground at y≈109.
 */
export default function BoboSvg({ mouthOpen = 1 }: { mouthOpen?: number }): React.JSX.Element {
  const s = Math.max(0.2, Math.min(2.5, mouthOpen))
  return (
    <svg className="pet-svg" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="boboBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FDE68A" />
          <stop offset="100%" stopColor="#F59E0B" />
        </linearGradient>
      </defs>
      <g className="pet-breath">
        {/* curled tail */}
        <path className="pet-tail" d="M94 84 C106 82 110 68 101 61 C103 72 99 82 90 87 Z" fill="#FBBF24" />
        {/* floppy ears */}
        <g className="pet-ear-l">
          <path d="M30 22 C19 28 16 47 24 56 C31 63 41 57 41 44 C41 31 38 17 30 22 Z" fill="#B45309" />
        </g>
        <g className="pet-ear-r">
          <path d="M90 22 C101 28 104 47 96 56 C89 63 79 57 79 44 C79 31 82 17 90 22 Z" fill="#B45309" />
        </g>
        {/* body */}
        <path d="M60 32 C82 32 96 52 96 75 C96 97 80 109 60 109 C40 109 24 97 24 75 C24 52 38 32 60 32 Z" fill="url(#boboBody)" />
        {/* belly */}
        <ellipse cx="60" cy="92" rx="17" ry="12" fill="#FEF3C7" opacity="0.9" />
        {/* muzzle */}
        <ellipse cx="60" cy="77" rx="20" ry="14" fill="#FEF3C7" />
        {/* shiba eyebrow dots */}
        <circle cx="45" cy="50" r="3" fill="#FEF3C7" />
        <circle cx="75" cy="50" r="3" fill="#FEF3C7" />
        {/* open eyes */}
        <g className="pet-eye-open-g">
          <g className="pet-eye-open">
            <circle cx="45" cy="61" r="5" fill="#292524" />
            <circle cx="47" cy="59" r="1.6" fill="#FFFFFF" />
          </g>
          <g className="pet-eye-open">
            <circle cx="75" cy="61" r="5" fill="#292524" />
            <circle cx="77" cy="59" r="1.6" fill="#FFFFFF" />
          </g>
        </g>
        {/* closed eyes (sleep) */}
        <g className="pet-eye-closed">
          <path d="M39 61 Q45 67 51 61" stroke="#292524" strokeWidth="2.5" fill="none" strokeLinecap="round" />
          <path d="M69 61 Q75 67 81 61" stroke="#292524" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        </g>
        {/* nose */}
        <path d="M55 69 Q60 65 65 69 Q65 75 60 75 Q55 75 55 69 Z" fill="#292524" />
        {/* mouth — driven by mouthOpen from audio amplitude */}
        <g transform={`translate(60,83) scale(1,${s}) translate(-60,-83)`}>
          <path d="M52 80 Q60 87 68 80" stroke="#292524" strokeWidth="2" fill="none" strokeLinecap="round" />
        </g>
        {/* blush */}
        <ellipse cx="35" cy="70" rx="4.5" ry="2.8" fill="#FDA4AF" opacity="0.7" />
        <ellipse cx="85" cy="70" rx="4.5" ry="2.8" fill="#FDA4AF" opacity="0.7" />
        {/* paws */}
        <ellipse className="pet-paw-l" cx="46" cy="106" rx="7" ry="4.5" fill="#D97706" />
        <ellipse className="pet-paw-r" cx="74" cy="106" rx="7" ry="4.5" fill="#D97706" />
      </g>
    </svg>
  )
}
