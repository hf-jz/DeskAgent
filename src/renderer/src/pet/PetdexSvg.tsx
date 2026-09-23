// 极简圆润 SVG，与 mochi/bobo 同款风格。petdex 仓库目前只有 ideas.json 规划，
// 无现成资产——按点子现画。
export type PetdexSpecies = 'nukey' | 'boba' | 'boxcat' | 'punchy' | 'scoop'

const PALETTE: Record<PetdexSpecies, { body: string; dark: string; accent: string }> = {
  nukey:  { body: '#f4a261', dark: '#d98a3f', accent: '#2a9d8f' },
  boba:   { body: '#e9c46a', dark: '#d4a84e', accent: '#b56576' },
  boxcat: { body: '#a8dadc', dark: '#8bc4c9', accent: '#e76f51' },
  punchy: { body: '#f7b2bd', dark: '#e58e9d', accent: '#264653' },
  scoop:  { body: '#c9b6e4', dark: '#ab93d6', accent: '#6d597a' },
}

export default function PetdexSvg({ which }: { which: PetdexSpecies }): React.JSX.Element {
  const c = PALETTE[which]
  return (
    <svg viewBox="0 0 120 120" width="100%" height="100%">
      {which === 'nukey' && (
        <>
          <rect x="18" y="26" width="84" height="70" rx="14" fill={c.body} />
          <rect x="28" y="36" width="40" height="50" rx="6" fill="#fdf6e3" />
          <circle cx="76" cy="50" r="5" fill={c.dark} />
          <rect x="70" y="58" width="12" height="6" rx="3" fill={c.dark} />
          <path d="M66 12 q3 -6 6 0 q3 -6 6 0" stroke={c.accent} strokeWidth="4" fill="none" strokeLinecap="round" />
          <path d="M50 12 q3 -6 6 0 q3 -6 6 0" stroke={c.accent} strokeWidth="4" fill="none" strokeLinecap="round" />
        </>
      )}
      {which === 'boba' && (
        <>
          <path d="M38 42 h44 l-6 52 a8 8 0 0 1 -8 7 h-16 a8 8 0 0 1 -8 -7 z" fill={c.body} />
          <path d="M60 16 q26 -10 30 18" stroke={c.accent} strokeWidth="5" fill="none" strokeLinecap="round" />
          <circle cx="50" cy="66" r="6" fill={c.dark} />
          <circle cx="70" cy="66" r="6" fill={c.dark} />
          <path d="M52 78 q8 7 16 0" stroke={c.dark} strokeWidth="3" fill="none" strokeLinecap="round" />
          <circle cx="60" cy="96" r="4" fill={c.accent} />
        </>
      )}
      {which === 'boxcat' && (
        <>
          <rect x="22" y="62" width="76" height="38" rx="8" fill={c.body} />
          <rect x="22" y="62" width="76" height="12" rx="6" fill={c.dark} />
          <path d="M34 62 q-6 -20 12 -24 l4 24 z" fill={c.accent} />
          <path d="M86 62 q6 -20 -12 -24 l-4 24 z" fill={c.accent} />
          <circle cx="50" cy="84" r="4" fill="#3a3a3a" />
          <circle cx="70" cy="84" r="4" fill="#3a3a3a" />
          <path d="M54 94 q6 6 12 0" stroke="#3a3a3a" strokeWidth="3" fill="none" strokeLinecap="round" />
        </>
      )}
      {which === 'punchy' && (
        <>
          <circle cx="60" cy="58" r="34" fill={c.body} />
          <circle cx="48" cy="52" r="4" fill="#3a3a3a" />
          <circle cx="72" cy="52" r="4" fill="#3a3a3a" />
          <path d="M50 68 q10 9 20 0" stroke="#3a3a3a" strokeWidth="3" fill="none" strokeLinecap="round" />
          <circle cx="94" cy="34" r="12" fill={c.accent} />
          <rect x="88" y="40" width="12" height="16" rx="6" fill={c.accent} />
        </>
      )}
      {which === 'scoop' && (
        <>
          <path d="M34 70 q4 -30 26 -32 q22 2 26 32 z" fill={c.body} />
          <circle cx="52" cy="62" r="4" fill="#3a3a3a" />
          <circle cx="68" cy="62" r="4" fill="#3a3a3a" />
          <path d="M54 72 q6 6 12 0" stroke="#3a3a3a" strokeWidth="3" fill="none" strokeLinecap="round" />
          <rect x="46" y="14" width="28" height="10" rx="5" fill={c.dark} />
          <rect x="52" y="6" width="16" height="12" rx="4" fill={c.accent} />
        </>
      )}
    </svg>
  )
}
