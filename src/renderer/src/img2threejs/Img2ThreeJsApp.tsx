import { useCallback, useState } from 'react'
import type { ForgeStepState } from '../../../shared/img2threejs-parser'

/**
 * Img2ThreeJsApp — forge pipeline console.
 *
 * Full img2threejs journey in one window: init a project from a reference
 * image → watch the 9-gate state machine (step/pass/loop) → mark steps done
 * → browse generated artifacts (spec/TS/viewer HTML) → preview the final
 * HTML and open it in the browser. The forge Python is spawned by the main
 * process; this window only renders parsed LOCAL_STATE.
 */

interface Artifact { name: string; path: string; kind: string }

const KIND_ICON: Record<string, string> = {
  spec: '📋', code: '🧊', image: '🖼️', model: '🎮', state: '⚙️', file: '📄',
}

const KIND_LABEL: Record<string, string> = {
  spec: 'Spec', code: '代码/HTML', image: '渲染图', model: '3D 模型', state: '状态', file: '文件',
}

const btnStyle = (primary = false): React.CSSProperties => ({
  background: primary ? 'linear-gradient(135deg, var(--accent), var(--accent-2))' : 'var(--line)',
  border: primary ? 'none' : '1px solid var(--solid)',
  borderRadius: '8px', padding: '8px 14px', color: primary ? '#fff' : 'var(--ink)',
  fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
})

export default function Img2ThreeJsApp(): React.JSX.Element {
  const [projectName, setProjectName] = useState('')
  const [reference, setReference] = useState('')
  const [profile, setProfile] = useState('generic')
  const [projectDir, setProjectDir] = useState<string | null>(null)
  const [state, setState] = useState<ForgeStepState | null>(null)
  const [artifacts, setArtifacts] = useState<Artifact[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewPath, setPreviewPath] = useState<string | null>(null)

  const refreshArtifacts = useCallback((dir: string) => {
    window.deskAppAPI.img2ThreeJsArtifacts(dir).then(setArtifacts).catch(() => {})
  }, [])

  const refreshState = useCallback(async (dir: string) => {
    const s = await window.deskAppAPI.img2ThreeJsStatus(dir)
    setState(s)
    refreshArtifacts(dir)
    return s
  }, [refreshArtifacts])

  const init = useCallback(async () => {
    if (!reference.trim() || !projectName.trim()) { setError('需要参考图路径和项目名'); return }
    setBusy(true)
    setError(null)
    try {
      const res = await window.deskAppAPI.img2ThreeJsInit(reference.trim(), projectName.trim(), profile)
      setProjectDir(res.projectDir)
      setState(res.state)
      refreshArtifacts(res.projectDir)
    } catch (e) {
      setError(`初始化失败：${(e as Error).message || e}`)
    }
    setBusy(false)
  }, [reference, projectName, profile, refreshArtifacts])

  const markNext = useCallback(async () => {
    if (!projectDir || !state?.currentStep) return
    setBusy(true)
    setError(null)
    try {
      const next = await window.deskAppAPI.img2ThreeJsMark(projectDir, state.currentStep)
      setState(next)
      refreshArtifacts(projectDir)
    } catch (e) {
      setError(`标记失败：${(e as Error).message || e}`)
    }
    setBusy(false)
  }, [projectDir, state, refreshArtifacts])

  const openArtifact = useCallback(async (path: string, kind: string) => {
    if (kind === 'code' && /\.html?$/.test(path)) {
      // in-window preview for HTML artifacts
      setPreviewPath(path === previewPath ? null : path)
    } else {
      await window.deskAppAPI.img2ThreeJsOpenArtifact(path)
    }
  }, [previewPath])

  const loopPct = state && state.loopMax > 0 ? Math.min(100, Math.round((state.loopPass / state.loopMax) * 100)) : 0
  const totalPct = state && state.totalMax > 0 ? Math.min(100, Math.round((state.total / state.totalMax) * 100)) : 0

  return (
    <div style={{ padding: '20px 24px', height: '100vh', display: 'flex', flexDirection: 'column', boxSizing: 'border-box', gap: '12px', overflow: 'hidden' }}>
      <h2 style={{ fontSize: '18px', fontWeight: 700, margin: 0 }}>img2threejs 流水线控制台</h2>
      <p style={{ fontSize: '12px', color: 'var(--ink-muted)', margin: 0 }}>
        参考图 → 9 道质量门禁 → 程序化 Three.js 代码 + 可交互 HTML 成品（forge: ~/web/img2threejs）
      </p>

      {error && (
        <p style={{ fontSize: '12px', color: '#EF4444', margin: 0, padding: '8px 12px', background: 'var(--bg-elev)', borderRadius: '8px' }}>{error}</p>
      )}

      {/* init row */}
      <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', background: 'var(--bg-elev)', border: '1px solid var(--bg-hover)', borderRadius: '10px', padding: '12px' }}>
        <input
          value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="项目名（如 my-helmet）"
          style={{ flex: 1, minWidth: 140, ...inputStyle }}
        />
        <input
          value={reference} onChange={(e) => setReference(e.target.value)} placeholder="参考图路径（/path/to/photo.png）"
          style={{ flex: 2, minWidth: 220, ...inputStyle }}
        />
        <select value={profile} onChange={(e) => setProfile(e.target.value)} style={{ ...inputStyle, width: 110 }}>
          <option value="generic">generic</option>
          <option value="character">character</option>
          <option value="cs2">cs2</option>
        </select>
        <button style={btnStyle(true)} onClick={init} disabled={busy}>🚀 初始化</button>
      </div>

      <div style={{ display: 'flex', gap: '12px', flex: 1, minHeight: 0 }}>
        {/* left: state machine */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto' }}>
          {state ? (
            <>
              <div style={{ background: 'var(--bg-elev)', borderRadius: '10px', border: '1px solid var(--bg-hover)', padding: '14px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <span style={{ fontSize: '13px', fontWeight: 700 }}>
                    {state.status === 'stopped' ? '⏹ 已停止' : state.status === 'active' ? '▶ 运行中' : '❓ ' + state.status}
                  </span>
                  <span style={{ fontSize: '11px', color: 'var(--ink-faint)' }}>{projectDir}</span>
                </div>
                <div style={{ fontSize: '22px', fontWeight: 800, color: 'var(--accent-text, var(--accent))', marginBottom: '4px' }}>
                  {state.currentStep || '—'}
                </div>
                <div style={{ fontSize: '11px', color: 'var(--ink-muted)', marginBottom: '10px' }}>
                  pass: {state.currentPass ?? 'intake'} · 本轮修正 {state.loopPass}/{state.loopMax}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                  <div style={{ flex: 1, height: 6, borderRadius: 3, background: 'var(--line)', overflow: 'hidden' }}>
                    <div style={{ width: `${totalPct}%`, height: '100%', background: 'var(--accent)', transition: 'width .3s' }} />
                  </div>
                  <span style={{ fontSize: '11px', color: 'var(--ink-faint)' }}>{state.total}/{state.totalMax}</span>
                </div>
                {state.stopReason && <div style={{ fontSize: '12px', color: '#F59E0B', marginBottom: '6px' }}>⏹ {state.stopReason}</div>}
                {state.nextCommand && (
                  <div style={{ fontSize: '11px', color: 'var(--ink-muted)', background: 'var(--line)', borderRadius: '6px', padding: '8px', wordBreak: 'break-all' }}>
                    <b>下一步：</b>{state.nextCommand}
                  </div>
                )}
                <div style={{ display: 'flex', gap: '8px', marginTop: '12px' }}>
                  <button style={btnStyle(false)} onClick={() => projectDir && refreshState(projectDir)} disabled={busy}>🔄 刷新状态</button>
                  <button style={btnStyle(true)} onClick={markNext} disabled={busy || !state.currentStep || state.status === 'stopped'}>
                    ✅ 标记「{state.currentStep || '—'}」完成并下一步
                  </button>
                </div>
              </div>

              <div style={{ background: 'var(--bg-elev)', borderRadius: '10px', border: '1px solid var(--bg-hover)', padding: '14px' }}>
                <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '8px' }}>
                  待办步骤（{state.pending.length}）
                </label>
                <ol style={{ margin: 0, paddingLeft: '20px', fontSize: '12px', color: 'var(--ink-muted)', display: 'grid', gap: '4px', maxHeight: 260, overflowY: 'auto' }}>
                  {state.pending.map((p) => <li key={p} style={{ wordBreak: 'break-all' }}>{p}</li>)}
                </ol>
              </div>
            </>
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-faint)', fontSize: '13px' }}>
              输入参考图路径和项目名，点击「初始化」启动流水线
            </div>
          )}
        </div>

        {/* right: artifacts + preview */}
        <div style={{ width: 340, display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto' }}>
          <div style={{ background: 'var(--bg-elev)', borderRadius: '10px', border: '1px solid var(--bg-hover)', padding: '14px' }}>
            <label style={{ fontSize: '13px', fontWeight: 600, display: 'block', marginBottom: '8px' }}>
              产物（{artifacts.length}）
            </label>
            <div style={{ display: 'grid', gap: '4px', maxHeight: 220, overflowY: 'auto' }}>
              {artifacts.map((a) => (
                <button
                  key={a.path}
                  onClick={() => openArtifact(a.path, a.kind)}
                  title={a.path}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 8px',
                    background: 'var(--line)', border: '1px solid var(--solid)', borderRadius: '6px',
                    cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', color: 'var(--ink)',
                  }}
                >
                  <span>{KIND_ICON[a.kind] ?? '📄'}</span>
                  <span style={{ flex: 1, fontSize: '11px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.name}</span>
                  <span style={{ fontSize: '9px', color: 'var(--ink-faint)' }}>{KIND_LABEL[a.kind] ?? a.kind}</span>
                </button>
              ))}
              {artifacts.length === 0 && <div style={{ fontSize: '11px', color: 'var(--ink-faint)' }}>暂无产物</div>}
            </div>
          </div>

          {previewPath && (
            <div style={{ flex: 1, minHeight: 200, background: 'var(--bg-elev)', borderRadius: '10px', border: '1px solid var(--bg-hover)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', fontSize: '11px', color: 'var(--ink-muted)' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{previewPath.split('/').pop()}</span>
                <button
                  onClick={() => window.deskAppAPI.img2ThreeJsOpenArtifact(previewPath)}
                  style={{ ...btnStyle(false), padding: '4px 10px', fontSize: '11px' }}
                >
                  浏览器打开
                </button>
              </div>
              <iframe src={`file://${previewPath}`} style={{ flex: 1, border: 'none', background: '#fff' }} title="预览" />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  padding: '8px 10px', background: 'var(--line)', border: '1px solid var(--solid)',
  borderRadius: '8px', color: 'var(--ink)', fontSize: '12px', fontFamily: 'inherit', boxSizing: 'border-box',
}
