import { useState, useEffect } from 'react'
import { t } from '../lib/i18n'
import PetCharacter from '../pet/PetCharacter'

type SizePreset = 'S' | 'M' | 'L'
type PetStyle = 'mochi' | 'bobo' | 'strands' | 'rings' | 'nukey' | 'boba' | 'boxcat' | 'punchy' | 'scoop'
type Theme = 'light' | 'dark' | 'auto'

function THEME_META(): Record<Theme, { name: string; desc: string }> {
  return {
    dark: { name: t('appearance.theme.dark'), desc: t('appearance.theme.darkDesc') },
    light: { name: t('appearance.theme.light'), desc: t('appearance.theme.lightDesc') },
    auto: { name: t('appearance.theme.auto'), desc: t('appearance.theme.autoDesc') },
  }
}

const SETTINGS_KEY = 'deskapp-pet-settings'
const SIZE_LABELS: Record<SizePreset, string> = { S: '80×80', M: '120×120', L: '180×180' }

function STYLE_META(): Record<PetStyle, { name: string; desc: string }> {
  return {
    mochi: { name: t('appearance.pet.mochi'), desc: t('appearance.pet.mochiDesc') },
    bobo: { name: t('appearance.pet.bobo'), desc: t('appearance.pet.boboDesc') },
    strands: { name: t('appearance.pet.strands'), desc: t('appearance.pet.strandsDesc') },
    rings: { name: t('appearance.pet.rings'), desc: t('appearance.pet.ringsDesc') },
    nukey: { name: t('appearance.pet.nukey'), desc: t('appearance.pet.nukeyDesc') },
    boba: { name: t('appearance.pet.boba'), desc: t('appearance.pet.bobaDesc') },
    boxcat: { name: t('appearance.pet.boxcat'), desc: t('appearance.pet.boxcatDesc') },
    punchy: { name: t('appearance.pet.punchy'), desc: t('appearance.pet.punchyDesc') },
    scoop: { name: t('appearance.pet.scoop'), desc: t('appearance.pet.scoopDesc') },
  }
}

function writeLocalSettings(s: { petStyle: PetStyle; opacity: number }): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)) } catch { /* ignore */ }
}

/** Static gradient orb preview for the WebGL styles (no WebGL in settings window) */
function OrbPreview({ variant }: { variant: 'strands' | 'rings' }): React.JSX.Element {
  return (
    <div style={{
      width: '100%', height: '100%', borderRadius: '50%',
      background: variant === 'strands'
        ? 'radial-gradient(circle at 40% 40%, var(--accent-text) 0%, var(--accent) 30%, var(--accent-2) 70%, #0891B2 100%)'
        : 'conic-gradient(from 0deg, var(--accent), var(--accent-2), var(--accent))',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{
        position: 'absolute', top: '12%', left: '20%',
        width: '30%', height: '20%', borderRadius: '50%',
        background: 'var(--ink-faint)', transform: 'rotate(-20deg)',
      }} />
    </div>
  )
}

export default function AppearanceTab(): React.JSX.Element {
  const [petStyle, setPetStyle] = useState<PetStyle>('strands')
  const [size, setSize] = useState<SizePreset>('M')
  const [opacity, setOpacity] = useState(85)
  const [theme, setThemeState] = useState<Theme>('dark')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    window.deskAppAPI.getSettings().then((s) => {
      setPetStyle(s.petStyle || 'strands')
      setOpacity(s.opacity || 85)
      setSize(s.size)
      setThemeState(s.theme || 'dark')
      setLoading(false)
    })
  }, [])

  const updateTheme = (t: Theme): void => {
    setThemeState(t)
    window.deskAppAPI.updateSettings({ theme: t })
  }

  const updateStyle = (style: PetStyle): void => {
    setPetStyle(style)
    writeLocalSettings({ petStyle: style, opacity })
    window.deskAppAPI.updateSettings({ petStyle: style })
  }

  const updateSize = (newSize: SizePreset): void => {
    setSize(newSize)
    window.deskAppAPI.updateSettings({ size: newSize })
  }

  const updateOpacity = (value: number): void => {
    setOpacity(value)
    writeLocalSettings({ petStyle, opacity: value })
    window.deskAppAPI.updateSettings({ opacity: value })
  }

  if (loading) {
    return <div style={{ color: 'var(--ink-muted)', padding: '20px' }}>Loading...</div>
  }

  return (
    <div>
      <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '6px' }}>{t('settings.tab.appearance')}</h2>
      <p style={{ fontSize: '12px', color: 'var(--ink-muted)', marginBottom: '20px' }}>
        Customize your desk pet. Changes apply instantly.
      </p>

      <div style={{
        background: 'var(--bg-elev)', borderRadius: '10px',
        border: '1px solid var(--bg-hover)',
        padding: '16px', marginBottom: '12px'
      }}>
        <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '10px' }}>
          Desktop Pet
        </label>
        <div style={{ display: 'flex', gap: '8px' }}>
          {(Object.keys(STYLE_META()) as PetStyle[]).map((style) => (
            <button key={style} onClick={() => updateStyle(style)} style={{
              background: petStyle === style ? 'linear-gradient(135deg, var(--accent), var(--accent-2))' : 'var(--line)',
              border: petStyle === style ? 'none' : '1px solid var(--solid)',
              borderRadius: '8px', padding: '10px 8px', color: 'var(--ink)', fontSize: '12px', fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit', flex: 1, textAlign: 'center', position: 'relative',
            }}>
              <div style={{ width: 52, height: 52, margin: '0 auto 6px', position: 'relative' }}>
                {style === 'mochi' || style === 'bobo' || style === 'nukey' || style === 'boba' || style === 'boxcat' || style === 'punchy' || style === 'scoop' ? (
                  <PetCharacter species={style} pose="idle" mood="idle" />
                ) : (
                  <OrbPreview variant={style} />
                )}
              </div>
              <div>{STYLE_META()[style].name}</div>
              <div style={{ fontSize: '10px', fontWeight: 400, opacity: 0.7, marginTop: 2 }}>{STYLE_META()[style].desc}</div>
            </button>
          ))}
        </div>
      </div>

      <div style={{
        background: 'var(--bg-elev)', borderRadius: '10px',
        border: '1px solid var(--bg-hover)',
        padding: '16px', marginBottom: '12px'
      }}>
        <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '10px' }}>
          Size
        </label>
        <div style={{ display: 'flex', gap: '8px' }}>
          {(['S', 'M', 'L'] as SizePreset[]).map((s) => (
            <button key={s} onClick={() => updateSize(s)} style={{
              background: size === s ? 'linear-gradient(135deg, var(--accent), var(--accent-2))' : 'var(--line)',
              border: size === s ? 'none' : '1px solid var(--solid)',
              borderRadius: '8px', padding: '8px 20px', color: 'var(--ink)', fontSize: '12px', fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit', flex: 1, textAlign: 'center'
            }}>
              {s} ({SIZE_LABELS[s]})
            </button>
          ))}
        </div>
      </div>

      <div style={{
        background: 'var(--bg-elev)', borderRadius: '10px',
        border: '1px solid var(--bg-hover)',
        padding: '16px', marginBottom: '12px'
      }}>
        <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '10px' }}>
          Opacity: {opacity}%
        </label>
        <input
          type="range" min="30" max="100" value={opacity}
          onChange={(e) => updateOpacity(Number(e.target.value))}
          style={{ width: '100%', accentColor: 'var(--accent)' }}
        />
      </div>

      <div style={{
        background: 'var(--bg-elev)', borderRadius: '10px',
        border: '1px solid var(--bg-hover)',
        padding: '16px', marginBottom: '12px'
      }}>
        <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
          🎨 Theme
        </label>
        <p style={{ fontSize: '10px', color: 'var(--ink-faint)', marginTop: 0, marginBottom: '10px' }}>
          {t('appearance.themeNote')}
        </p>
        <div style={{ display: 'flex', gap: '8px' }}>
          {(Object.keys(THEME_META()) as Theme[]).map((t) => (
            <button key={t} onClick={() => updateTheme(t)} style={{
              background: theme === t ? 'linear-gradient(135deg, var(--accent), var(--accent-2))' : 'var(--line)',
              border: theme === t ? 'none' : '1px solid var(--solid)',
              borderRadius: '8px', padding: '10px 8px', color: 'var(--ink)', fontSize: '12px', fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit', flex: 1, textAlign: 'center',
            }}>
              <div>{THEME_META()[t].name}</div>
              <div style={{ fontSize: '9px', fontWeight: 400, opacity: 0.7, marginTop: 3 }}>{THEME_META()[t].desc}</div>
            </button>
          ))}
        </div>
      </div>

      <div style={{ textAlign: 'center', padding: '8px', color: 'var(--solid)', fontSize: '10px' }}>
        DeskApp v0.1.0 · 19 skills · macOS/Linux/Windows · 5 agents
      </div>
    </div>
  )
}
