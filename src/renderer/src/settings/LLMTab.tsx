import { useState, useEffect } from 'react'
import { t } from '../lib/i18n'

type BrainMode = 'auto' | 'worker' | 'planner'

function BRAIN_MODE_META(): Record<BrainMode, { name: string; desc: string }> {
  return {
    auto: { name: t('llm.brain.auto'), desc: t('llm.brain.autoDesc') },
    worker: { name: t('llm.brain.worker'), desc: t('llm.brain.workerDesc') },
    planner: { name: t('llm.brain.planner'), desc: t('llm.brain.plannerDesc') },
  }
}

interface ProviderInfo { id: string; name: string; baseURL: string; models: string[]; defaultModel: string }

interface SlotState {
  provider: string
  model: string
  baseURL: string
  apiKey: string
  testing: boolean
  testResult: string
  saved: boolean
}

/** Full brain config editor — provider dropdown → model dropdown → key → test → save. */
function BrainConfigEditor(): React.JSX.Element {
  const [providers, setProviders] = useState<ProviderInfo[]>([])
  const [loaded, setLoaded] = useState(false)

  const mkSlot = (): SlotState => ({ provider: '', model: '', baseURL: '', apiKey: '', testing: false, testResult: '', saved: false })
  const [planner, setPlanner] = useState<SlotState>(mkSlot)
  const [worker, setWorker] = useState<SlotState>(mkSlot)
  const [brainLoading, setBrainLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      window.deskAppAPI.getOnboardingState(),
      window.deskAppAPI.getBrainConfig(),
    ]).then(([os, bc]) => {
      setProviders(os.providers as any as ProviderInfo[])
      const pSlot = mkSlot(); pSlot.provider = bc.planner.provider || ''; pSlot.model = bc.planner.model || ''; pSlot.baseURL = bc.planner.baseURL || ''
      const wSlot = mkSlot(); wSlot.provider = bc.worker.provider || ''; wSlot.model = bc.worker.model || ''; wSlot.baseURL = bc.worker.baseURL || ''
      setPlanner(pSlot)
      setWorker(wSlot)
      setBrainLoading(false)
      setLoaded(true)
    }).catch(() => { setLoaded(true); setBrainLoading(false) })
  }, [])

  const providersById = new Map(providers.map(p => [p.id, p]))
  const modelsFor = (pid: string): string[] => providersById.get(pid)?.models ?? []

  const updateSlot = (which: 'planner' | 'worker', patch: Partial<SlotState>): void => {
    const setter = which === 'planner' ? setPlanner : setWorker
    setter(prev => {
      const next = { ...prev, ...patch, saved: false, testResult: '' }
      if (patch.provider && patch.provider !== prev.provider) {
        const p = providersById.get(patch.provider)
        if (p) { next.baseURL = p.baseURL; next.model = p.defaultModel }
      }
      return next
    })
  }

  const testSlot = async (which: 'planner' | 'worker'): Promise<void> => {
    const slot = which === 'planner' ? planner : worker
    if (!slot.apiKey || !slot.baseURL) return
    const setter = which === 'planner' ? setPlanner : setWorker
    setter(prev => ({ ...prev, testing: true, testResult: '' }))
    try {
      const res = await window.deskAppAPI.testLLMConnection({ provider: slot.provider, baseURL: slot.baseURL, apiKey: slot.apiKey, model: slot.model } as any)
      setter(prev => ({ ...prev, testing: false, testResult: res.success ? t('llm.connectOk') : `✗ ${res.message}` }))
    } catch (e: any) {
      setter(prev => ({ ...prev, testing: false, testResult: `✗ ${e?.message || e}` }))
    }
  }

  const saveAll = async (): Promise<void> => {
    const bp: any = { provider: planner.provider, baseURL: planner.baseURL, apiKey: planner.apiKey, model: planner.model }
    const bw: any = { provider: worker.provider, baseURL: worker.baseURL, apiKey: worker.apiKey, model: worker.model }
    // Invalid values are refused by setup-wizard.validateSlot instead of being
    // written into hermes config.yaml (a bad model/URL only breaks later).
    const res = await window.deskAppAPI.saveBrainConfig(bp, bw)
    if (!res.ok) {
      const msg = `✗ ${(res.errors ?? []).join('；')}`
      setPlanner(prev => ({ ...prev, saved: false, testResult: msg }))
      setWorker(prev => ({ ...prev, saved: false, testResult: msg }))
      return
    }
    await window.deskAppAPI.updateModels(planner.model, worker.model)
    setPlanner(prev => ({ ...prev, saved: true })); setTimeout(() => setPlanner(prev => ({ ...prev, saved: false })), 2000)
    setWorker(prev => ({ ...prev, saved: true })); setTimeout(() => setWorker(prev => ({ ...prev, saved: false })), 2000)
  }

  const selectStyle: React.CSSProperties = {
    background: 'var(--line)', border: '1px solid var(--solid)',
    borderRadius: '6px', padding: '5px 8px', fontSize: '12px', color: 'var(--ink)', outline: 'none',
    fontFamily: 'inherit', cursor: 'pointer',
  }
  const inputStyle: React.CSSProperties = {
    background: 'var(--line)', border: '1px solid var(--solid)',
    borderRadius: '6px', padding: '5px 8px', fontSize: '12px', color: 'var(--ink)', outline: 'none',
    fontFamily: 'monospace', flex: 1,
  }
  const btnStyle = (active: boolean): React.CSSProperties => ({
    background: active ? 'var(--ok)' : 'linear-gradient(135deg, var(--accent), var(--accent-2))',
    border: 'none', borderRadius: '6px', padding: '5px 12px', color: 'var(--ink)',
    fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
    transition: 'background 0.3s',
  })

  if (!loaded) return <div style={{ padding: '16px', color: 'var(--ink-faint)' }}>...</div>

  const renderSlot = (which: 'planner' | 'worker', slot: SlotState, label: string, color: string): React.JSX.Element => (
    <div style={{ marginBottom: '8px' }}>
      <span style={{ fontSize: '12px', fontWeight: 600, color, display: 'block', marginBottom: '6px' }}>{label}</span>
      <div style={{ display: 'flex', gap: '6px', marginBottom: '5px', alignItems: 'center' }}>
        <span style={{ fontSize: '10px', color: 'var(--ink-faint)', width: '28px', flexShrink: 0 }}>厂商</span>
        <select style={{ ...selectStyle, flex: 1 }} value={slot.provider}
          onChange={e => updateSlot(which, { provider: e.target.value })}>
          <option value="">{t('llm.selectVendor')}</option>
          {providers.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <div style={{ display: 'flex', gap: '6px', marginBottom: '5px', alignItems: 'center' }}>
        <span style={{ fontSize: '10px', color: 'var(--ink-faint)', width: '28px', flexShrink: 0 }}>模型</span>
        <select style={{ ...selectStyle, flex: 1 }} value={slot.model}
          onChange={e => updateSlot(which, { model: e.target.value })}>
          {modelsFor(slot.provider).map(m => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
      <div style={{ display: 'flex', gap: '6px', marginBottom: '5px', alignItems: 'center' }}>
        <span style={{ fontSize: '10px', color: 'var(--ink-faint)', width: '28px', flexShrink: 0 }}>URL</span>
        <input style={inputStyle} value={slot.baseURL}
          onChange={e => updateSlot(which, { baseURL: e.target.value })}
          placeholder="https://api.example.com/v1" />
      </div>
      <div style={{ display: 'flex', gap: '6px', marginBottom: '5px', alignItems: 'center' }}>
        <span style={{ fontSize: '10px', color: 'var(--ink-faint)', width: '28px', flexShrink: 0 }}>Key</span>
        <input style={inputStyle} type="password" value={slot.apiKey}
          onChange={e => updateSlot(which, { apiKey: e.target.value })}
          placeholder="sk-..." />
      </div>
      <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
        <button onClick={() => testSlot(which)} disabled={slot.testing} style={btnStyle(false)}>
          {slot.testing ? '⏳' : t('llm.verify')}
        </button>
        {slot.testResult && (
          <span style={{ fontSize: '11px', color: slot.testResult.startsWith('✓') ? 'var(--ok)' : 'var(--danger)' }}>
            {slot.testResult}
          </span>
        )}
      </div>
    </div>
  )

  return (
    <div style={{
      background: 'var(--bg-elev)', borderRadius: '10px',
      border: '1px solid var(--bg-hover)',
      padding: '16px', marginBottom: '12px'
    }}>
      <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
        🔧 Brain Configuration
      </label>
      <p style={{ fontSize: '10px', color: 'var(--ink-faint)', marginTop: 0, marginBottom: '12px' }}>
        Configure provider, model, and API key for each brain slot. 保存按钮同时写入 ~/.hermes/config.yaml 和环境变量。
      </p>

      {brainLoading
        ? <div style={{ color: 'var(--ink-faint)', padding: '8px' }}>读取当前配置...</div>
        : <>
            {renderSlot('planner', planner, t('llm.plannerSlot'), 'var(--accent-text)')}
            <div style={{ borderTop: '1px solid var(--line)', margin: '8px 0' }} />
            {renderSlot('worker', worker, t('llm.workerSlot'), 'var(--accent-2)')}
            <button onClick={saveAll} style={{ ...btnStyle(planner.saved), marginTop: '8px', width: '100%' }}>
              {planner.saved ? t('llm.saved') : t('llm.save')}
            </button>
          </>
      }
    </div>
  )
}

export default function LLMTab(): React.JSX.Element {
  const [brainMode, setBrainMode] = useState<BrainMode>('auto')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    window.deskAppAPI.getSettings().then((s) => {
      setBrainMode(s.brainMode || 'auto')
      setLoading(false)
    })
  }, [])

  const updateBrainMode = (mode: BrainMode): void => {
    setBrainMode(mode)
    window.deskAppAPI.updateSettings({ brainMode: mode })
  }

  if (loading) {
    return <div style={{ color: 'var(--ink-muted)', padding: '20px' }}>Loading...</div>
  }

  return (
    <div>
      <h2 style={{ fontSize: '18px', fontWeight: 700, marginBottom: '6px' }}>{t('settings.tab.llm')}</h2>
      <p style={{ fontSize: '12px', color: 'var(--ink-muted)', marginBottom: '20px' }}>
        Configure model provider, brain mode, and usage budget.
      </p>

      {/* Default brain mode */}
      <div style={{
        background: 'var(--bg-elev)', borderRadius: '10px',
        border: '1px solid var(--bg-hover)',
        padding: '16px', marginBottom: '12px'
      }}>
        <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '4px' }}>
          🧠 Default Brain Mode
        </label>
        <p style={{ fontSize: '10px', color: 'var(--ink-faint)', marginTop: 0, marginBottom: '10px' }}>
          New bubbles start in this mode; the pill in each bubble's header overrides it per conversation.
        </p>
        <div style={{ display: 'flex', gap: '8px' }}>
          {(Object.keys(BRAIN_MODE_META()) as BrainMode[]).map((mode) => (
            <button key={mode} onClick={() => updateBrainMode(mode)} style={{
              background: brainMode === mode ? 'linear-gradient(135deg, var(--accent), var(--accent-2))' : 'var(--line)',
              border: brainMode === mode ? 'none' : '1px solid var(--solid)',
              borderRadius: '8px', padding: '10px 8px', color: 'var(--ink)', fontSize: '12px', fontWeight: 600,
              cursor: 'pointer', fontFamily: 'inherit', flex: 1, textAlign: 'center',
            }}>
              <div>{BRAIN_MODE_META()[mode].name}</div>
              <div style={{ fontSize: '9px', fontWeight: 400, opacity: 0.7, marginTop: 3 }}>{BRAIN_MODE_META()[mode].desc}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Brain Configuration (planner/worker provider+model+key) */}
      <BrainConfigEditor />

      {/* Budget */}
      <div style={{
        background: 'var(--bg-elev)', borderRadius: '10px',
        border: '1px solid var(--bg-hover)',
        padding: '16px', marginBottom: '12px'
      }}>
        <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '10px' }}>
          💰 Budget (¥/day, 0=unlimited)
        </label>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <input
            type="number" min="0" step="0.5" defaultValue="0"
            style={{
              width: '80px', background: 'var(--line)',
              border: '1px solid var(--solid)', borderRadius: '6px',
              padding: '6px 10px', fontSize: '13px', color: 'var(--ink)', outline: 'none',
            }}
            onChange={(e) => {
              const v = parseFloat(e.target.value) || 0
              window.deskAppAPI.updateSettings?.({ budgetDaily: v })
            }}
          />
          <span style={{ fontSize: '11px', color: 'var(--ink-muted)' }}>Daily limit. Exceeded → agent pauses until next day.</span>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginTop: '8px' }}>
          <input
            type="number" min="0" step="1" defaultValue="0"
            style={{
              width: '80px', background: 'var(--line)',
              border: '1px solid var(--solid)', borderRadius: '6px',
              padding: '6px 10px', fontSize: '13px', color: 'var(--ink)', outline: 'none',
            }}
            onChange={(e) => {
              const v = parseFloat(e.target.value) || 0
              window.deskAppAPI.updateSettings?.({ budgetMonthly: v })
            }}
          />
          <span style={{ fontSize: '11px', color: 'var(--ink-muted)' }}>Monthly limit (¥/month).</span>
        </div>
      </div>
    </div>
  )
}
