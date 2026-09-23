import { useState, useEffect, useRef } from 'react'
import { t } from '../lib/i18n'
import openaiLogo from '../assets/providers/openai.svg'
import anthropicLogo from '../assets/providers/anthropic.svg'
import deepseekLogo from '../assets/providers/deepseek.svg'
import moonshotLogo from '../assets/providers/moonshot.webp'
import googleLogo from '../assets/providers/google.svg'

// ── Conversational onboarding card ──
// The pet speaks from inside the bubble: greet → detect → result → inline
// config → verifying → alive. No standalone wizard window, ever.
// Spec: docs/onboarding-design.md
//
// Dual-model brain (Planner/Worker):
//   slot ① 规划器 (planner) — frontier model, decomposes complex goals
//   slot ② 执行器 (worker)  — cheap model, executes concrete tasks
// Same provider → one key, two model tiers. Cross-provider (e.g. kimi-k3 +
// deepseek-v4-pro) → two keys, configured in the two slots.

type Phase =
  | 'greeting'        // pet's first words
  | 'detecting'       // "让我看看这台电脑……"
  | 'ready'           // already configured — zero friction
  | 'found-external'  // no key, but an external agent exists
  | 'none'            // nothing found — key needed
  | 'config'          // inline planner/worker form
  | 'alive'           // connected!

interface ProviderPreset {
  id: string
  name: string
  baseURL: string
  models: string[]
  defaultModel: string
  plannerModel: string
  workerModel: string
}

interface OnboardingState {
  needsSetup: boolean
  existing: { provider?: string; baseURL?: string; model?: string; apiKey?: string }
  providers: ProviderPreset[]
  dismissedAt: number | null
  externalAgents: { id: string; name: string; status: string }[]
}

interface SlotCfg {
  providerId: string
  apiKey: string
  baseURL: string
  model: string
  verified: boolean
}

// Official brand marks (src/renderer/src/assets/providers/)
const PROVIDER_LOGOS: Record<string, string> = {
  openai: openaiLogo,
  anthropic: anthropicLogo,
  deepseek: deepseekLogo,
  moonshot: moonshotLogo,
  google: googleLogo,
}

const S = {
  card: {
    background: 'linear-gradient(135deg, rgba(124,58,237,0.14), rgba(6,182,212,0.09))',
    border: '1px solid var(--accent-line)',
    borderRadius: '12px',
    padding: '12px 14px',
    margin: '8px 10px 4px',
    flexShrink: 0,
    fontSize: '12px',
    color: 'var(--ink)',
  } as React.CSSProperties,
  speech: { fontSize: '12px', lineHeight: 1.6, color: 'var(--ink)' } as React.CSSProperties,
  speechDim: { fontSize: '11px', lineHeight: 1.5, color: 'var(--ink-muted)' } as React.CSSProperties,
  primaryBtn: {
    background: 'linear-gradient(135deg, var(--accent), var(--accent-2))',
    border: 'none', borderRadius: '8px', padding: '6px 14px',
    color: 'var(--ink)', fontSize: '11px', fontWeight: 600, cursor: 'pointer',
  } as React.CSSProperties,
  ghostBtn: {
    background: 'none', border: 'none', padding: '4px 6px',
    color: 'var(--ink-faint)', fontSize: '10px', cursor: 'pointer',
  } as React.CSSProperties,
  slotTab: (active: boolean, done: boolean) => ({
    flex: 1, padding: '5px 8px', borderRadius: '7px', cursor: 'pointer',
    fontSize: '10px', fontWeight: 600, textAlign: 'center' as const,
    background: active ? 'var(--accent-line)' : 'var(--bg-card)',
    border: active ? '1px solid var(--accent-line)' : '1px solid var(--bg-hover)',
    color: done ? 'var(--ok-text)' : active ? 'var(--ink)' : 'var(--ink-muted)',
    transition: 'all 0.15s',
  }),
  providerBtn: (active: boolean) => ({
    display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: '3px',
    padding: '8px 4px', borderRadius: '8px', cursor: 'pointer', minWidth: '56px',
    background: active ? 'var(--accent-line)' : 'var(--bg-card)',
    border: active ? '1px solid var(--accent-line)' : '1px solid var(--bg-hover)',
    transition: 'all 0.15s',
  }),
  logoChip: {
    width: '24px', height: '24px', borderRadius: '6px',
    background: 'rgba(255,255,255,0.96)', display: 'flex',
    alignItems: 'center', justifyContent: 'center',
  } as React.CSSProperties,
  input: {
    width: '100%', boxSizing: 'border-box' as const, outline: 'none',
    background: 'rgba(0,0,0,0.3)', border: '1px solid var(--solid)',
    borderRadius: '8px', padding: '7px 10px', color: 'var(--ink)', fontSize: '11px',
    fontFamily: 'SF Mono, Monaco, monospace',
  } as React.CSSProperties,
  modelSelect: {
    width: '100%', boxSizing: 'border-box' as const, outline: 'none',
    background: 'rgba(0,0,0,0.3)', border: '1px solid var(--solid)',
    borderRadius: '8px', padding: '5px 8px', color: 'var(--ink)', fontSize: '10px',
    marginTop: '6px', appearance: 'none' as const, cursor: 'pointer',
  } as React.CSSProperties,
  error: {
    marginTop: '6px', padding: '5px 8px', borderRadius: '6px',
    background: 'var(--danger-soft)', color: 'var(--danger-text)', fontSize: '10px',
  } as React.CSSProperties,
  summary: {
    marginTop: '8px', padding: '6px 9px', borderRadius: '7px',
    background: 'rgba(110,231,183,0.08)', border: '1px solid rgba(110,231,183,0.2)',
    fontSize: '10px', lineHeight: 1.6, color: 'var(--ink-secondary)',
  } as React.CSSProperties,
}

export function OnboardingCard(props: {
  onComplete: () => void   // key saved & verified
  onDismiss: () => void    // "稍后再说"
  onCollapsed: () => void  // ready branch acknowledged (card goes away)
}): React.JSX.Element {
  const [phase, setPhase] = useState<Phase>('greeting')
  const [state, setState] = useState<OnboardingState | null>(null)
  const [slot, setSlot] = useState<'planner' | 'worker'>('planner')
  const [planner, setPlanner] = useState<SlotCfg>({ providerId: 'moonshot', apiKey: '', baseURL: '', model: '', verified: false })
  const [workerMode, setWorkerMode] = useState<'same' | 'custom'>('same')
  const [worker, setWorker] = useState<SlotCfg>({ providerId: 'deepseek', apiKey: '', baseURL: '', model: '', verified: false })
  const [testing, setTesting] = useState(false)
  const [error, setError] = useState('')
  const autoSubmitTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const aliveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // greeting → detecting → result branch
  useEffect(() => {
    let cancelled = false
    // Guarded transition: never stomp a branch that already resolved faster
    // than the greeting beat (IPC answers in ~10ms, well under 1.5s).
    const greetTimer = setTimeout(() => {
      if (!cancelled) setPhase(p => (p === 'greeting' ? 'detecting' : p))
    }, 1500)
    window.deskAppAPI.getOnboardingState().then((s) => {
      if (cancelled || !s) return
      setState(s)
      // Small extra beat so "detecting" doesn't flash by unreadably fast
      setTimeout(() => {
        if (cancelled) return
        clearTimeout(greetTimer)
        if (!s.needsSetup) {
          setPhase('ready')
          aliveTimer.current = setTimeout(() => props.onCollapsed(), 2200)
        } else if (s.externalAgents.length > 0) {
          setPhase('found-external')
        } else {
          setPhase('none')
        }
      }, 900)
    }).catch(() => { if (!cancelled) setPhase('none') })
    return () => {
      cancelled = true
      clearTimeout(greetTimer)
      if (aliveTimer.current) clearTimeout(aliveTimer.current)
      if (autoSubmitTimer.current) clearTimeout(autoSubmitTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const providers = state?.providers ?? []
  const presetOf = (id: string): ProviderPreset | undefined => providers.find(p => p.id === id)
  const plannerPreset = presetOf(planner.providerId)

  // Worker derivation: same key → planner provider's workerModel tier
  const workerPreset = workerMode === 'same' ? plannerPreset : presetOf(worker.providerId)
  const workerModel = workerMode === 'same'
    ? (plannerPreset?.workerModel || plannerPreset?.defaultModel || '')
    : (worker.model || workerPreset?.workerModel || '')

  const pickProvider = (which: 'planner' | 'worker', id: string): void => {
    setError('')
    const p = presetOf(id)
    if (which === 'planner') {
      setPlanner({ providerId: id, apiKey: '', baseURL: p?.baseURL ?? '', model: p?.plannerModel ?? '', verified: false })
      // Same-key worker tracks the planner's provider automatically
      if (workerMode === 'same') setWorker(w => ({ ...w, verified: false }))
    } else {
      setWorkerMode(id === planner.providerId ? 'same' : 'custom')
      setWorker({ providerId: id, apiKey: '', baseURL: p?.baseURL ?? '', model: p?.workerModel ?? '', verified: false })
    }
  }

  const activeCfg = slot === 'planner' ? planner : worker
  const setActiveCfg = slot === 'planner' ? setPlanner : setWorker

  const testSlot = async (which: 'planner' | 'worker'): Promise<void> => {
    const cfg = which === 'planner' ? planner : worker
    const preset = presetOf(cfg.providerId)
    const key = cfg.apiKey.trim()
    if (!key) { setError(t('onboard.err.pasteKey')); return }
    setTesting(true)
    setError('')
    try {
      const result = await window.deskAppAPI.testLLMConnection({
        provider: cfg.providerId,
        baseURL: cfg.baseURL || preset?.baseURL || '',
        apiKey: cfg.apiKey,
        model: cfg.model || (which === 'planner' ? preset?.plannerModel : preset?.workerModel) || '',
      })
      if (result.success) {
        const model = cfg.model || (which === 'planner' ? preset?.plannerModel : preset?.workerModel) || ''
        const baseURL = cfg.baseURL || preset?.baseURL || ''
        if (which === 'planner') {
          setPlanner(p => ({ ...p, verified: true, model, baseURL }))
          setSlot('worker')  // advance: commander done, now the soldiers
        } else {
          setWorker(w => ({ ...w, verified: true, model, baseURL }))
        }
      } else {
        setError(result.message || t('onboard.err.connect'))
      }
    } catch (e: any) {
      setError(e?.message || t('onboard.err.fail'))
    } finally {
      setTesting(false)
    }
  }

  // Auto-submit shortly after a paste — the spec's "粘贴后自动 testConnection".
  const handlePaste = (): void => {
    if (autoSubmitTimer.current) clearTimeout(autoSubmitTimer.current)
    autoSubmitTimer.current = setTimeout(() => { void testSlot(slot) }, 400)
  }

  const workerReady = workerMode === 'same' ? planner.verified : worker.verified
  const canFinish = planner.verified && workerReady && !testing

  const finish = async (): Promise<void> => {
    if (!canFinish) return
    const pPreset = plannerPreset
    const plannerCfg = {
      provider: planner.providerId,
      baseURL: planner.baseURL || pPreset?.baseURL || '',
      apiKey: planner.apiKey.trim(),
      model: planner.model || pPreset?.plannerModel || '',
    }
    const workerCfg = workerMode === 'same'
      ? { ...plannerCfg, model: pPreset?.workerModel || plannerCfg.model }
      : {
          provider: worker.providerId,
          baseURL: worker.baseURL || workerPreset?.baseURL || '',
          apiKey: worker.apiKey.trim(),
          model: worker.model || workerPreset?.workerModel || '',
        }
    try {
      const res = await window.deskAppAPI.saveBrainConfig(plannerCfg, workerCfg)
      if (!res.ok) { setError((res.errors ?? []).join('；') || t('onboard.err.save')); return }
      setPhase('alive')
      aliveTimer.current = setTimeout(() => props.onComplete(), 2600)
    } catch (e: any) {
      setError(e?.message || t('onboard.err.save'))
    }
  }

  // ── Per-phase speech ──
  const dismissLink = (
    <div style={{ textAlign: 'right', marginTop: '6px' }}>
      <button style={S.ghostBtn} onClick={props.onDismiss}>{t('onboard.later')}</button>
    </div>
  )

  if (phase === 'greeting') {
    return (
      <div style={S.card}>
        <div style={S.speech}>{t('onboard.speech.hello')}</div>
      </div>
    )
  }

  if (phase === 'detecting') {
    return (
      <div style={S.card}>
        <div style={S.speech}>{t('onboard.speech.detecting')} <span style={{ opacity: 0.5 }}>🔍</span></div>
      </div>
    )
  }

  if (phase === 'ready') {
    return (
      <div style={S.card}>
        <div style={S.speech}>{t('onboard.speech.ready')}</div>
      </div>
    )
  }

  if (phase === 'found-external') {
    const names = state?.externalAgents.map(a => a.name).join('、') ?? ''
    return (
      <div style={S.card}>
        <div style={S.speech}>
          {t('onboard.found', { names: '' })}<b style={{ color: 'var(--accent-text)' }}>{names}</b>{t('onboard.foundTail')}
          {t('onboard.orConfigure')}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '10px' }}>
          <button style={S.primaryBtn} onClick={() => setPhase('config')}>{t('onboard.configureNow')}</button>
          {dismissLink}
        </div>
      </div>
    )
  }

  if (phase === 'none') {
    return (
      <div style={S.card}>
        <div style={S.speech}>{t('onboard.speech.key')}</div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '10px' }}>
          <button style={S.primaryBtn} onClick={() => setPhase('config')}>{t('onboard.configureNow')}</button>
          {dismissLink}
        </div>
      </div>
    )
  }

  if (phase === 'alive') {
    return (
      <div style={S.card}>
        <div style={S.speech}>{t('onboard.speech.connected')}</div>
      </div>
    )
  }

  // phase === 'config' — dual-slot planner/worker form
  const providerGrid = (which: 'planner' | 'worker', activeId: string) => (
    <div style={{ display: 'flex', gap: '5px', flexWrap: 'wrap', marginBottom: '8px' }}>
      {providers.map(p => (
        <div key={p.id} style={S.providerBtn(activeId === p.id)} onClick={() => pickProvider(which, p.id)}>
          {PROVIDER_LOGOS[p.id] ? (
            <span style={S.logoChip}>
              <img src={PROVIDER_LOGOS[p.id]} alt={p.name} style={{ width: '17px', height: '17px', objectFit: 'contain' }} />
            </span>
          ) : (
            <span style={{ fontSize: '14px', color: activeId === p.id ? 'var(--accent-text)' : 'var(--ink-muted)', lineHeight: '24px' }}>⚙</span>
          )}
          <span style={{ fontSize: '9px', color: activeId === p.id ? 'var(--ink)' : 'var(--ink-muted)', fontWeight: 500 }}>
            {p.name}
          </span>
        </div>
      ))}
    </div>
  )

  return (
    <div style={S.card}>
      <div style={{ ...S.speech, marginBottom: '8px' }}>{t('onboard.speech.brain')}</div>

      {/* Slot tabs */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '8px' }}>
        <div style={S.slotTab(slot === 'planner', planner.verified)} onClick={() => setSlot('planner')}>
          {t('onboard.planner')}{planner.verified ? ' ✓' : ''}
        </div>
        <div style={S.slotTab(slot === 'worker', workerReady && workerMode === 'custom')} onClick={() => setSlot('worker')}>
          {t('onboard.worker')}{workerMode === 'same' ? t('onboard.sameKey') : worker.verified ? ' ✓' : ''}
        </div>
      </div>

      {slot === 'planner' ? (
        <>
          <div style={{ ...S.speechDim, marginBottom: '6px' }}>{t('onboard.plannerDesc')}</div>
          {providerGrid('planner', planner.providerId)}
          <input
            type="password"
            style={S.input}
            placeholder={t('onboard.pasteKey', { name: plannerPreset?.name ?? '' })}
            value={planner.apiKey}
            onChange={e => { setPlanner(p => ({ ...p, apiKey: e.target.value, verified: false })); setError('') }}
            onPaste={handlePaste}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void testSlot('planner') } }}
            autoFocus
          />
          {(plannerPreset?.models.length ?? 0) > 0 && (
            <select
              style={S.modelSelect}
              value={planner.model || plannerPreset?.plannerModel}
              onChange={e => { setPlanner(p => ({ ...p, model: e.target.value, verified: false })); setError('') }}
            >
              {plannerPreset?.models.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
          )}
          {planner.verified && (
            <div style={{ fontSize: 11, color: 'var(--ok)', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8 }}>
              {t('onboard.connected', { model: planner.model || plannerPreset?.plannerModel })}
            </div>
          )}
        </>
      ) : (
        <>
          <div style={{ ...S.speechDim, marginBottom: '6px' }}>{t('onboard.workerDesc')}</div>
          {providerGrid('worker', workerMode === 'same' ? planner.providerId : worker.providerId)}
          {workerMode === 'same' ? (
            <div style={S.summary}>
              {t('onboard.sameKeyAuto', { model: '' })}<b style={{ color: 'var(--ok-text)' }}>{plannerPreset?.workerModel}</b>
              {plannerPreset?.id !== 'custom' && t('onboard.sameFamily')}
              <br />{t('onboard.mixTip')}
            </div>
          ) : (
            <>
              <input
                type="password"
                style={S.input}
                placeholder={t('onboard.workerKey', { name: workerPreset?.name ?? '' })}
                value={worker.apiKey}
                onChange={e => { setWorker(w => ({ ...w, apiKey: e.target.value, verified: false })); setError('') }}
                onPaste={handlePaste}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void testSlot('worker') } }}
                autoFocus
              />
              {(workerPreset?.models.length ?? 0) > 0 && (
                <select
                  style={S.modelSelect}
                  value={worker.model || workerPreset?.workerModel}
                  onChange={e => { setWorker(w => ({ ...w, model: e.target.value, verified: false })); setError('') }}
                >
                  {workerPreset!.models.map(m => <option key={m} value={m}>{t('onboard.workerModel', { m })}</option>)}
                </select>
              )}
              {worker.verified && (
                <div style={{ ...S.speechDim, marginTop: '5px', color: 'var(--ok-text)' }}>
                  ✓ {worker.model || workerPreset?.workerModel} {t('onboard.connected2')}
                </div>
              )}
            </>
          )}
        </>
      )}

      {error && <div style={S.error}>{error}</div>}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '8px' }}>
        {slot === 'planner' ? (
          <button style={{ ...S.primaryBtn, opacity: planner.apiKey.trim() && !testing ? 1 : 0.5 }} onClick={() => void testSlot('planner')} disabled={!planner.apiKey.trim() || testing}>
            {testing ? t('onboard.testing') : t('onboard.connect')}
          </button>
        ) : (
          <button style={{ ...S.primaryBtn, opacity: canFinish ? 1 : 0.5 }} onClick={() => void finish()} disabled={!canFinish}>
            {t('onboard.finish')}
          </button>
        )}
        {dismissLink}
      </div>
    </div>
  )
}
