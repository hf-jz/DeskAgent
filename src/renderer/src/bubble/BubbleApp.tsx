import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { t } from '../lib/i18n'
import { ReasoningTimeline } from './ThinkingPanel'
import { buildReasoningEvents, MarkdownContent } from './ReasoningTimeline'
import { reasoningSegments } from './lib/reasoningSegments'
import { AgentDashboard as AgentPanel, type SessionStatus } from './AgentPanel'
import { ConversationNavigator, useConversationOutline } from './ConversationNavigator'
import { OnboardingCard } from './OnboardingCard'
import { TaskTreePanel, type TaskTree } from './TaskTreePanel'
import InboxPanel from './InboxPanel'
import { TurnGroup } from './TurnGroup'
import ApprovalCard, { type PermissionReq, type PermissionOutcome } from './ApprovalCard'
import QuestionCard, { type QuestionReq } from './QuestionCard'
import AttachmentTray from './AttachmentTray'
import FeedTray from './FeedTray'
import type { FeedPayload } from '../../../shared/ipc-channels'
import { useAttachments } from './hooks/useAttachments'
import { useSpeechInput } from './hooks/useSpeechInput'
import { UserMessage } from '../components/Message'
import { useSession } from './hooks/useSession'
import { useIpcStream } from './hooks/useIpcStream'
import { calcTurnCost, isOverBudget, isNearBudget, isContextWarning, contextBarPercent, isDangerousCommand, analyzeRisks, suggestAgent, formatCost, formatTokens } from './hooks/useTokenBudget'
import { RiskConfirmDialog, type RiskItem, type ApprovalDecision } from './RiskConfirmDialog'
import { MessageInteractionProvider, MessageActions } from '../components/Message'
import '../components/Message/MessageActions.css'
import type { BrainMode } from '../../../shared/ipc-channels'

/** Brain mode selector metadata — per-bubble pill next to the agent pill. */
const BRAIN_MODES = (): { id: BrainMode; icon: string; label: string; desc: string }[] => [
  { id: 'auto', icon: '🔀', label: t('bubble.brain.auto'), desc: t('bubble.brain.autoDesc') },
  { id: 'worker', icon: '⚡', label: t('bubble.brain.worker'), desc: t('bubble.brain.workerDesc') },
  { id: 'planner', icon: '🧠', label: t('bubble.brain.planner'), desc: t('bubble.brain.plannerDesc') },
]

type MsgKind = 'user' | 'assistant' | 'reasoning' | 'reasoning_end' | 'tool_call' | 'tool_result'

interface ChatMsg {
  id: string
  kind: MsgKind
  content: string
  name?: string
  args?: string
  elapsedSec?: number
  model?: string
  via?: string
}

// ── Styles ──
const S = {
  wrapper: {
    width: '100%', height: '100%', display: 'flex', flexDirection: 'column' as const,
    background: 'var(--bg-glass)',
    backdropFilter: 'blur(40px) saturate(160%)',
    WebkitBackdropFilter: 'blur(40px) saturate(160%)',
    borderRadius: 'var(--radius-xl, 22px)', overflow: 'hidden' as const,
    fontFamily: '-apple-system, BlinkMacSystemFont, "SF Pro Text", sans-serif',
    boxShadow: '0 16px 48px rgba(0,0,0,0.55), 0 0 0 1px var(--bg-hover)',
  } as React.CSSProperties,
  header: {
    height: 34, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '0 12px', WebkitAppRegion: 'drag' as any, flexShrink: 0,
    borderBottom: '1px solid var(--bg-card)',
  } as React.CSSProperties,
  headerTitle: { fontSize: 11, fontWeight: 500 } as React.CSSProperties,
  messages: { flex: 1, overflowY: 'auto' as const, padding: '8px 12px 4px' } as React.CSSProperties,
  inputBar: {
    padding: '8px 10px', borderTop: '1px solid var(--line)',
    display: 'flex', alignItems: 'flex-end', gap: 8, flexShrink: 0,
    WebkitAppRegion: 'no-drag' as any,
  } as React.CSSProperties,
  textarea: {
    flex: 1, resize: 'none' as const, outline: 'none',
    background: 'var(--bg-card)', border: '1px solid var(--bg-hover)',
    borderRadius: 10, padding: '8px 12px', color: 'var(--ink)', fontSize: 12,
    fontFamily: 'inherit', lineHeight: 1.4, maxHeight: 100, minHeight: 34,
    transition: 'border-color 200ms ease',
  } as React.CSSProperties,
  sendBtn: (active: boolean) => ({
    width: 34, height: 34, borderRadius: 10, border: 'none',
    background: active ? 'linear-gradient(135deg, var(--accent), var(--accent-2))' : 'var(--bg-hover)',
    color: 'var(--ink)', cursor: active ? 'pointer' : 'default', flexShrink: 0,
    fontSize: 14, transition: 'transform 100ms ease-out, opacity 200ms ease',
    opacity: active ? 1 : 0.4,
  } as React.CSSProperties),
  msgRow: (role: 'user' | 'assistant') => ({
    display: 'flex', justifyContent: role === 'user' ? 'flex-end' : 'flex-start',
    marginBottom: 8,
  } as React.CSSProperties),
  bubble: (role: 'user' | 'assistant') => ({
    maxWidth: '82%', padding: '8px 12px',
    borderRadius: role === 'user' ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
    background: role === 'user' ? 'linear-gradient(135deg, var(--accent), var(--accent-2))' : 'var(--line)',
    color: 'var(--ink)', fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const, userSelect: 'text' as const,
  } as React.CSSProperties),
  empty: {
    display: 'flex', flexDirection: 'column' as const, alignItems: 'center',
    justifyContent: 'center', paddingTop: 20, color: 'var(--line-strong)', fontSize: 12,
  } as React.CSSProperties,
  copyBtn: {
    background: 'none', border: 'none', cursor: 'pointer',
    fontSize: 11, color: 'var(--ink-faint)', padding: '2px 4px',
    transition: 'color 150ms', lineHeight: 1,
  } as React.CSSProperties,
  copyFeedback: {
    fontSize: 10, color: 'var(--ok)', lineHeight: 1,
  } as React.CSSProperties,
  chip: {
    background: 'var(--bg-card)', border: '1px solid var(--bg-hover)', color: 'var(--ink-secondary)',
    borderRadius: 5, padding: '2px 7px', fontSize: 10, cursor: 'pointer', fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  } as React.CSSProperties,
}

// ── Main Component ──
export default function BubbleApp(): React.JSX.Element {
  // Session persistence (extracted hook)
  const { messages, setMessages, sessionLoaded, showWelcome, setShowWelcome, sidRef, exportSession, importSession } = useSession()

  // Local state
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [queued, setQueued] = useState(false)
  const [error, setError] = useState('')
  const [tokenUsage, setTokenUsage] = useState<{ total: number; prompt: number; completion: number; context?: number } | null>(null)
  // Persisted daily cumulative cost (localStorage, auto-resets each day) —
  // previously memory-only, so the budget lock was defeated by an app restart.
  const [cumulativeCost, setCumulativeCost] = useState<number>(() => {
    try {
      const raw = localStorage.getItem('deskapp-daily-cost')
      if (raw) {
        const { date, cost } = JSON.parse(raw)
        if (date === new Date().toISOString().slice(0, 10) && typeof cost === 'number') return cost
      }
    } catch { /* ignore */ }
    return 0
  })
  const [budget, setBudget] = useState<{ daily: number; monthly: number }>({ daily: 0, monthly: 0 })
  const [bubbleAlpha, setBubbleAlpha] = useState(0.88)
  const [activeAgent, setActiveAgent] = useState<string>('hermes')
  const [agentList, setAgentList] = useState<{ id: string; name: string }[]>([])
  const [agentOpen, setAgentOpen] = useState(false)
  // Brain mode is PER-BUBBLE (not global like the agent pill): bubble A can
  // pin the cheap worker while bubble B runs the frontier planner. Persisted
  // per session id; falls back to the Settings default for brand-new bubbles.
  const [brainMode, setBrainMode] = useState<BrainMode>('auto')
  const [brainModeOpen, setBrainModeOpen] = useState(false)
  // P1-B3 #23: provider info shown in brain dropdown footer
  const [providerInfo, setProviderInfo] = useState<{ provider: string; workerModel: string; plannerModel: string } | null>(null)
  const [verifyState, setVerifyState] = useState<'idle' | 'checking' | string>('idle')
  const [brainToast, setBrainToast] = useState('')
  const brainToastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [dynamicTemplates, setDynamicTemplates] = useState<{ icon: string; label: string; text: string }[]>([])
  const [agentFlash, setAgentFlash] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  // Window currently pulled out for editing — banner + task-text injection so
  // the agent patches that exact spec instead of creating a new one.
  const [editSpec, setEditSpec] = useState<{ id: string; title: string } | null>(null)
  // ── Feed（投喂）清单：可编辑的分析对象（删/拆/拖入加/重新分析）──
  const [feedPayload, setFeedPayload] = useState<FeedPayload | null>(null)
  const feedPayloadRef = useRef<FeedPayload | null>(null)
  useEffect(() => { feedPayloadRef.current = feedPayload }, [feedPayload])
  useEffect(() => window.deskAppAPI?.onEditSpec?.((info) => setEditSpec(info)) ?? (() => {}), [])
  // Conversational onboarding: card pinned between header and messages.
  // llmConfigured defaults true to avoid a flash of the gate on normal launches;
  // the mount probe below corrects it.
  const [onboardingVisible, setOnboardingVisible] = useState(false)
  // #23: settings can re-open this card
  useEffect(() => window.deskAppAPI.onOnboardingShow?.(() => setOnboardingVisible(true)) || (() => {}), [])
  const [llmConfigured, setLlmConfigured] = useState(true)

  // Risk confirmation dialog state
  const [riskDialogOpen, setRiskDialogOpen] = useState(false)
  const [riskDialogRisks, setRiskDialogRisks] = useState<RiskItem[]>([])
  const pendingRiskTextRef = useRef<string>('')
  const skipRiskCheckRef = useRef(false)

  // Onboarding probe: show the card on first run (needsSetup && never dismissed).
  // Dismissed users keep the pet silent but remain gated at send time.
  useEffect(() => {
    window.deskAppAPI.getOnboardingState().then((s) => {
      if (!s) return
      if (s.needsSetup) {
        setLlmConfigured(false)
        if (!s.dismissedAt) setOnboardingVisible(true)
      }
    }).catch(() => {})
  }, [])

  const inputRef = useRef<HTMLTextAreaElement>(null)
  // The bubble is opened by a pet click — focus the input immediately, or the
  // window has no editable focus: keystrokes arrive but macOS never opens an
  // input context, so typing (Chinese IME especially) silently does nothing
  // until the user clicks the box. Focus on mount only — re-focusing later
  // aborts an in-progress composition.
  useEffect(() => { inputRef.current?.focus() }, [])
  const { items: attachments, add: addAttachments, remove: removeAttachment, clear: clearAttachments } = useAttachments()
  const bottomRef = useRef<HTMLDivElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const turnStartRef = useRef<number | null>(null)
  const abortRef = useRef(false)
  // Guard: prevent Enter/Escape interception while an IME composition is active.
  // Without this, pressing Enter to confirm a Chinese pinyin candidate (or
  // Escape to dismiss the candidate window) would trigger send or clear-input,
  // destroying the in-progress composition and making IME input unusable.
  const isComposingRef = useRef(false)
  // Model that ran the most recent turn (from done-meta) — drives header
  // cost pricing and per-message model badges.
  const [turnModel, setTurnModel] = useState<string | undefined>(undefined)
  // Turn timing for the hermes-TUI-style status line in the Board.
  const [lastTurnMs, setLastTurnMs] = useState(0)
  const [totalTurnMs, setTotalTurnMs] = useState(0)
  // Task-tree orchestration state (方案 B) — snapshot streamed from main.
  const [taskTree, setTaskTree] = useState<TaskTree | null>(null)
  useEffect(() => window.deskAppAPI.onTreeUpdate((t) => {
    // Empty-nodes tree = orchestrator cleared the placeholder (fallback path).
    const tree = t as TaskTree
    setTaskTree(tree?.nodes?.length ? tree : null)
  }), [])
  // Completed trees stay frozen onto their turn (keyed by the turn's user
  // message id) so the panel doesn't vanish when the next message starts.
  const [frozenTrees, setFrozenTrees] = useState<Record<string, TaskTree>>({})

  // IPC streaming (extracted hook) — returns the canonical live turn (P0-8)
  // and the stream-gate state (P0-7) for event-driven rendering.
  const { liveTurn, gateState } = useIpcStream({
    setMessages, setStreaming, setError, setTokenUsage,
    onCumulativeCost: (cost) => setCumulativeCost(prev => {
      const next = prev + cost
      try {
        localStorage.setItem('deskapp-daily-cost', JSON.stringify({
          date: new Date().toISOString().slice(0, 10), cost: next,
        }))
      } catch { /* ignore */ }
      return next
    }),
    onTurnMeta: (meta) => {
      setTurnModel(meta.model)
      if (meta.elapsedMs > 0) {
        setLastTurnMs(meta.elapsedMs)
        setTotalTurnMs(prev => prev + meta.elapsedMs)
      }
    },
    onTurnStart: (model) => setTurnModel(model),
    onQueued: (queued) => setQueued(queued),
    turnStartRef,
  })

  // Live 1s ticker while a reply streams — the status line's ⏲ field counts
  // up during the turn (hermes TUI style) instead of staying blank until done.
  const [liveTick, setLiveTick] = useState(0)
  useEffect(() => {
    if (!streaming) return
    const t = setInterval(() => setLiveTick(n => n + 1), 1000)
    return () => clearInterval(t)
  }, [streaming])

  // Hermes-TUI-style status line data for the Board.
  const sessionStatus: SessionStatus = useMemo(() => ({
    model: turnModel,
    usedTokens: tokenUsage?.context || tokenUsage?.prompt || 0,
    // While streaming show the live ticking turn clock; after done the
    // settled per-turn value from done-meta.
    lastTurnMs: streaming && turnStartRef.current ? Date.now() - turnStartRef.current : lastTurnMs,
    totalTurnMs,
    sessionStartTs: messages.length
      ? (parseInt(messages[0].id.split('-')[1], 10) || Date.now())
      : Date.now(),
  }), [turnModel, tokenUsage, lastTurnMs, totalTurnMs, messages, streaming, liveTick])

  // Load settings
  useEffect(() => {
    window.deskAppAPI.getSettings().then((s) => {
      if (s) {
        setBudget({ daily: s.budgetDaily || 0, monthly: s.budgetMonthly || 0 })
        setBubbleAlpha(0.75 + ((s.opacity || 85) - 30) / 70 * 0.23)
      }
    }).catch(() => {})
    const unsubSettings = window.deskAppAPI.onSettingsChanged((s) => {
      setBubbleAlpha(0.75 + ((s.opacity || 85) - 30) / 70 * 0.23)
      setBudget({ daily: s.budgetDaily || 0, monthly: s.budgetMonthly || 0 })
    })
    return () => unsubSettings()
  }, [])

  // Brain mode init: per-session override wins; otherwise the Settings
  // default (Appearance tab) applies to bubbles that never chose a mode.
  useEffect(() => {
    const saved = localStorage.getItem(`deskapp-brain-mode-${sidRef.current}`)
    if (saved === 'auto' || saved === 'worker' || saved === 'planner') {
      setBrainMode(saved)
      return
    }
    window.deskAppAPI.getSettings().then((s) => {
      if (s?.brainMode === 'worker' || s?.brainMode === 'planner') setBrainMode(s.brainMode)
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Brain mode switch — persists per session; planner mode warns about cost.
  const switchBrainMode = (mode: BrainMode): void => {
    setBrainMode(mode)
    setBrainModeOpen(false)
    try { localStorage.setItem(`deskapp-brain-mode-${sidRef.current}`, mode) } catch { /* ignore */ }
    if (brainToastTimer.current) clearTimeout(brainToastTimer.current)
    if (mode === 'planner') {
      setBrainToast(t('bubble.brainToast.planner'))
      brainToastTimer.current = setTimeout(() => setBrainToast(''), 3000)
    } else {
      setBrainToast('')
    }
  }

  // Dynamic templates from skills
  useEffect(() => {
    window.deskAppAPI.skillsList().then((list) => {
      if (list) {
        const active = list.filter((s) => s.active).slice(0, 3)
        setDynamicTemplates(active.map((s) => ({
          icon: '⚡',
          label: s.name.replace(/-/g, ' '),
          text: s.trigger ? s.trigger.split('|')[0] : s.description?.substring(0, 30) || s.name,
        })))
      }
    }).catch(() => {})
  }, [])

  // Agent list
  useEffect(() => {
    window.deskAppAPI.getAgentState().then((s) => {
      if (s) {
        setActiveAgent(s.activeAgentId || 'hermes')
        setAgentList((s.agents || []).filter((a) => a.status === 'running' || a.status === 'installed').map((a) => ({ id: a.id, name: a.name })))
      }
    }).catch(() => {})
  }, [])

  // Scroll to bottom on new messages — only when the user is already near the
  // bottom (stick-to-bottom); never yank the view away while reading history.
  const stickToBottomRef = useRef(true)
  useEffect(() => {
    if (stickToBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: streaming ? 'auto' : 'smooth' })
    }
  }, [messages, streaming])
  const handleMessagesScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
  }, [])

  // D3 #41A: voice input — final text appends; interim replaces the live draft tail
  const speechDraftRef = useRef('')
  const speech = useSpeechInput(useCallback((text: string, isFinal: boolean) => {
    if (!text) return
    setInput(prev => {
      const base = prev.endsWith(speechDraftRef.current)
        ? prev.slice(0, prev.length - speechDraftRef.current.length)
        : prev
      speechDraftRef.current = isFinal ? '' : text
      return base + (base && !base.endsWith(' ') && !isFinal ? '' : '') + text
    })
    if (isFinal) speechDraftRef.current = ''
    autoResize()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []))

  // Auto-resize textarea
  const autoResize = useCallback(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.max(34, Math.min(el.scrollHeight, 100)) + 'px'
  }, [])

  // Turn grouping
  const turns = useMemo(() => {
    const groups: { history: ChatMsg[]; assistant: ChatMsg | null; user: ChatMsg | null }[] = []
    let i = 0
    while (i < messages.length) {
      const m = messages[i]
      if (m.kind === 'user') {
        groups.push({ history: [], assistant: null, user: m })
        i++
        const hist: ChatMsg[] = []
        let lastA: ChatMsg | null = null
        while (i < messages.length && messages[i].kind !== 'user') {
          const m2 = messages[i]
          if (m2.kind === 'assistant') {
            if (lastA) { groups.push({ history: [...hist], assistant: lastA, user: null }); hist.length = 0 }
            lastA = m2
          } else {
            hist.push(m2)
          }
          i++
        }
        if (hist.length > 0 || lastA) {
          groups.push({ history: hist, assistant: lastA, user: null })
        }
      } else {
        i++
      }
    }
    return groups
  }, [messages])

  // Agent switch
  const switchAgent = (id: string) => {
    setActiveAgent(id)
    setAgentOpen(false)
    setAgentFlash(true)
    setTimeout(() => setAgentFlash(false), 600)
    window.deskAppAPI.setActiveAgent(id)
  }

  // Abort
  const doAbort = useCallback(() => {
    abortRef.current = true
    setStreaming(false)
    setError('Task cancelled.')
    window.deskAppAPI.abortTask()
  }, [])

  // Edit user message in-place (UserMessage save callback)
  const handleEditSave = useCallback((messageId: string, newContent: string) => {
    setMessages((prev) =>
      prev.map((m) => (m.id === messageId ? { ...m, content: newContent } : m)),
    )
  }, [setMessages])

  // Send handler — accepts an explicit text override so retry doesn't race setInput
  const handleSend = useCallback(async (overrideText?: string) => {
    let text = (overrideText ?? input).trim()
    const readyAtts = overrideText === undefined ? attachments.filter(a => !a.rejected) : []
    if (!text && readyAtts.length === 0) return
    // Mid-reply send = interrupt the running turn (■ semantics) then run fresh.
    if (streaming) doAbort()

    // #11: import attachments into the workspace vfs and append a manifest —
    // the agent reads them with its normal file tools (no base64 in prompt).
    if (readyAtts.length > 0) {
      const lines: string[] = []
      for (const a of readyAtts) {
        try {
          const dest = await window.deskAppAPI.vfsImport(window.deskAppAPI.getFilePath(a.file))
          lines.push(`- ${a.name} → ${dest.split('/').pop()}`)
          // #48: PDFs also get an extracted-text twin the agent can read directly
          if (a.name.toLowerCase().endsWith('.pdf')) {
            const txt = await window.deskAppAPI.extractPdf?.(dest)
            if (txt) lines.push(`- ${txt.split('/').pop()}${t('bubble.feed.pdfTwin')}`)
          }
        } catch { lines.push(`- ${a.name} ${t('bubble.feed.importFail')}`) }
      }
      text = (text || t('bubble.att.pleaseView')) + `\n\n${t('bubble.att.imported')}\n${lines.join('\n')}`
    }

    // Gate: no LLM key configured yet — the pet answers itself and re-opens
    // the inline onboarding card instead of firing a doomed task.
    if (!llmConfigured) {
      setMessages(prev => [
        ...prev,
        { id: 'u-' + Date.now(), kind: 'user', content: text },
        { id: 'a-' + Date.now(), kind: 'assistant', content: t('bubble.noBrain') },
      ])
      setInput('')
      setOnboardingVisible(true)
      return
    }

    // Budget check
    if (isOverBudget(cumulativeCost, budget.daily)) {
      setError(`Daily budget limit reached (¥${budget.daily}). Reset at midnight.`)
      return
    }

    // Dangerous operation — show risk confirmation dialog
    if (!skipRiskCheckRef.current) {
      const risks = analyzeRisks(text)
      if (risks.length > 0) {
        // P0-4A: session grants — this risk-category combination was already
        // trusted earlier in the session → skip the dialog entirely.
        const categories = risks.map(r => r.category)
        const granted = await window.deskAppAPI.checkInputGrant(categories).catch(() => false)
        if (!granted) {
          pendingRiskTextRef.current = text
          setRiskDialogRisks(risks)
          setRiskDialogOpen(true)
          return
        }
      }
    }
    skipRiskCheckRef.current = false

    // Agent routing
    const suggested = suggestAgent(text, activeAgent, agentList)
    if (suggested) {
      setActiveAgent(suggested)
      window.deskAppAPI.setActiveAgent(suggested)
    }

    // File explorer commands
    if (/(?:打开|open|explore|browse|查看|view)\s*(?:文件|file|文件夹|folder|工作区|workspace)/i.test(text)) {
      window.deskAppAPI.openFileExplorer()
      setInput('')
      return
    }

    setMessages(prev => [...prev, { id: 'u-' + Date.now(), kind: 'user', content: text }])
    setInput('')
    clearAttachments()
    setError('')
    setTaskTree(prevTree => {
      if (prevTree) {
        const lastUser = [...messages].reverse().find(m => m.kind === 'user')
        if (lastUser) setFrozenTrees(prev => ({ ...prev, [lastUser.id]: prevTree }))
      }
      return null
    })
    setStreaming(true)
    // Start the turn clock at SEND time (not first chunk) — the status
    // line's ⏲ ticks from here; the reasoning fold reuses the same ref.
    turnStartRef.current = Date.now()
    setTimeout(() => {
      if (inputRef.current) { inputRef.current.style.height = 'auto'; inputRef.current.focus() }
    }, 0)
    await window.deskAppAPI.executeTask(editSpec
      ? `${text}\n\n${t('bubble.editTarget', { id: editSpec.id, title: editSpec.title })}`
      : text, { modelMode: brainMode })
  }, [input, streaming, cumulativeCost, budget.daily, activeAgent, agentList, llmConfigured, brainMode, setMessages, attachments, clearAttachments, editSpec])

  // ── Feed（投喂）分析：复用附件导入管道（vfsImport + PDF 文本孪生）──
  // waitLoaded 竞态守卫：全新会话 sessionLoaded 恒 false，轮询 2s 超时兜底
  const runFeedAnalysis = useCallback(async (payload: FeedPayload) => {
    let text = t('bubble.feed.analyze') + '\n\n' + t('bubble.feed.list') + '\n'
    const imported: string[] = []
    for (const it of payload.items) {
      if (it.kind === 'file') {
        try {
          const dest = await window.deskAppAPI.vfsImport(it.path)
          imported.push(`- ${it.name} → ${dest || it.path}`)
        } catch { imported.push(`- ${it.name} ${t('bubble.feed.importFail')}`) }
      } else {
        imported.push(`- ${it.name}/ ${t('bubble.feed.folderNote')}`)
      }
    }
    text += imported.join('\n') + '\n\n' + t('bubble.feed.dimensions')
    const waitLoaded = (ms = 2000) => new Promise<void>((resolve) => {
      if (sessionLoaded.current) { resolve(); return }
      const t0 = Date.now()
      const iv = setInterval(() => {
        if (sessionLoaded.current || Date.now() - t0 > ms) { clearInterval(iv); resolve() }
      }, 100)
    })
    await waitLoaded()
    setMessages(prev => [...prev, { id: 'feed-' + Date.now(), kind: 'user', content: text }])
    await window.deskAppAPI.executeTask(text, { modelMode: 'auto' }).catch(() => {})
  }, [sessionLoaded, setMessages])

  const handleReanalyzeFeed = useCallback(() => {
    if (!feedPayloadRef.current) return
    runFeedAnalysis(feedPayloadRef.current)
  }, [runFeedAnalysis])

  const handleAddFeedPaths = useCallback(async (paths: string[]) => {
    const base = feedPayloadRef.current
    if (!base) return
    try {
      const merged = await window.deskAppAPI.buildFeed([...base.items.map(i => i.path), ...paths])
      const seen = new Set(base.items.map(i => i.path))
      const added = merged.items.filter(i => !seen.has(i.path))
      setFeedPayload({ ...merged, items: [...base.items, ...added] })
    } catch { /* buildFeed 失败则忽略追加 */ }
  }, [])

  useEffect(() => window.deskAppAPI.onFeedAnalyze?.((payload) => {
    setFeedPayload(payload)
    runFeedAnalysis(payload)
  }) ?? undefined, [runFeedAnalysis])

  // Risk confirmation handlers — 必须放在 handleSend 之后：
  // 依赖数组 [handleSend] 在渲染期求值，提前声明会撞 TDZ
  // （"Cannot access before initialization" → ErrorBoundary 白屏）
  const handleRiskDecide = useCallback((decision: ApprovalDecision) => {
    setRiskDialogOpen(false)
    if (decision === 'deny') {
      pendingRiskTextRef.current = ''
      return
    }
    // P0-4A: always-grants persist for the session (in-memory, main process)
    if (decision === 'always_tool' || decision === 'always_command') {
      window.deskAppAPI.addInputGrant(riskDialogRisks.map(r => r.category)).catch(() => {})
    }
    skipRiskCheckRef.current = true
    handleSend(pendingRiskTextRef.current!)
  }, [handleSend, riskDialogRisks])

  // ── Phase 6: execution-gate approval cards ──
  const [approvals, setApprovals] = useState<PermissionReq[]>([])
  // #33: ask_user question cards
  const [questions, setQuestions] = useState<QuestionReq[]>([])
  useEffect(() => {
    const unReq = window.deskAppAPI.onQuestionRequired?.((req) =>
      setQuestions(prev => prev.some(q => q.id === req.id) ? prev : [...prev, req]))
    const unRes = window.deskAppAPI.onQuestionResolved?.((info) =>
      setQuestions(prev => prev.filter(q => q.id !== info.id)))
    return () => { unReq?.(); unRes?.() }
  }, [])

  const handleQuestionAnswer = useCallback((id: string, answer: string) => {
    setQuestions(prev => prev.filter(q => q.id !== id))
    window.deskAppAPI.respondQuestion(id, answer).catch(() => {})
  }, [])

  // #35: task-tree plan confirmation
  const [pendingPlan, setPendingPlan] = useState<any>(null)
  useEffect(() => window.deskAppAPI.onPlanProposed?.((info) => setPendingPlan(info.tree)), [])
  const decidePlan = useCallback((ok: boolean) => {
    setPendingPlan(null)
    window.deskAppAPI.confirmPlan(ok).catch(() => {})
  }, [])
  useEffect(() => {
    const unReq = window.deskAppAPI.onPermissionRequired?.((req) =>
      setApprovals(prev => prev.some(a => a.id === req.id) ? prev : [...prev, req]))
    const unRes = window.deskAppAPI.onPermissionResolved?.(({ id }) =>
      setApprovals(prev => prev.filter(a => a.id !== id)))
    return () => { unReq?.(); unRes?.() }
  }, [])

  const handleApprovalDecide = useCallback((id: string, outcome: PermissionOutcome) => {
    const req = approvals.find(a => a.id === id)
    // Optimistic removal; main also pushes permission:resolved
    setApprovals(prev => prev.filter(a => a.id !== id))
    // #12: map card decisions onto bridge outcomes + grants mirror
    if (outcome === 'always_tool') {
      window.deskAppAPI.respondPermission(id, 'session').catch(() => {})
      window.deskAppAPI.addGrant('always_tool', 'terminal').catch(() => {})
    } else if (outcome === 'always_command') {
      window.deskAppAPI.respondPermission(id, 'session').catch(() => {})
      if (req) window.deskAppAPI.addGrant('always_command', 'terminal', req.command).catch(() => {})
    } else if (outcome === 'turn') {
      window.deskAppAPI.respondPermission(id, 'turn', req?.command).catch(() => {})
    } else {
      window.deskAppAPI.respondPermission(id, outcome).catch(() => {})
    }
  }, [approvals])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Never intercept keys while an IME composition is in progress
    // (e.g. Chinese pinyin, Japanese kana). The OS-level input method
    // owns these events — Enter confirms a candidate, Escape dismisses
    // the candidate window.
    if (isComposingRef.current || (e.nativeEvent as KeyboardEvent).isComposing) return
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey) { e.preventDefault(); handleSend() }
    if (e.key === 'Escape') { setInput(''); setError('') }
  }, [handleSend])

  // ResizeObserver — only expand, never shrink
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    let lastH = 0
    const ro = new ResizeObserver(() => {
      if (!el) return
      const h = el.scrollHeight + 20
      if (h > lastH + 30) {
        lastH = h
        window.deskAppAPI.resizeBubble(h)
      }
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const hasContent = messages.length > 0 || streaming
  const outline = useConversationOutline(messages.filter(m => m.kind === 'user').map(m => ({ id: m.id, role: 'user', content: m.content })))

  const costColor = tokenUsage && budget.daily > 0 && isNearBudget(cumulativeCost, budget.daily) ? 'var(--warn)' : 'var(--solid)'

  // Send button stays in "working" (stop) state while a turn is streaming OR
  // queued behind it — only a fully finished reply brings back the ↑ arrow.
  // liveTurn.streaming is the canonical turn state from the agent:event
  // stream; task:done and agent:event travel on separate IPC channels so
  // streaming alone can flip false mid-turn on interleaving.
  const busy = streaming || queued || (liveTurn !== null && liveTurn.streaming === true)

  // Drop anywhere in the bubble: a FOLDER → its absolute path inserted at the
  // cursor; files → attachments. Shared by the root + the textarea so a folder
  // dropped outside the input doesn't fall into the attachment rejection path.
  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation()
    // feed 模式：投喂清单激活时，拖入的任何文件/文件夹都加入清单（可反复追加）
    if (feedPayloadRef.current) {
      const paths: string[] = []
      for (const f of Array.from(e.dataTransfer.files)) {
        const p = window.deskAppAPI.getFilePath(f)
        if (p) paths.push(p)
      }
      if (paths.length > 0) handleAddFeedPaths(paths)
      return
    }
    const entry = e.dataTransfer.items?.[0]?.webkitGetAsEntry?.()
    const file = e.dataTransfer.files?.[0]
    if (entry?.isDirectory && file) {
      const p = window.deskAppAPI.getFilePath(file)
      if (p) {
        const ta = inputRef.current
        const start = ta?.selectionStart ?? (input.length)
        const end = ta?.selectionEnd ?? start
        const before = input.slice(0, start)
        const after = input.slice(end)
        const insert = (before && !before.endsWith(' ') ? ' ' : '') + p + ' '
        setInput(before + insert + after)
        requestAnimationFrame(() => {
          ta?.focus()
          const pos = start + insert.length
          ta?.setSelectionRange(pos, pos)
        })
        return
      }
    }
    if (e.dataTransfer.files.length) addAttachments(e.dataTransfer.files)
  }, [input, addAttachments, handleAddFeedPaths])

  // ── Render ──
  return (
    <MessageInteractionProvider>
      {riskDialogOpen && (
        <RiskConfirmDialog
          risks={riskDialogRisks}
          inputPreview={pendingRiskTextRef.current}
          onDecide={handleRiskDecide}
        />
      )}
      <div ref={containerRef} style={{ ...S.wrapper, background: `rgba(28,28,30,${bubbleAlpha})`, position: 'relative' as const }}
        onDragOver={e => e.preventDefault()}
        onDrop={handleDrop}>
      <ConversationNavigator items={outline} exportSession={exportSession} />
      {brainToast && (
        <div style={{
          position: 'absolute', top: '38px', left: '50%', transform: 'translateX(-50%)', zIndex: 60,
          background: 'rgba(60,40,100,0.92)', border: '1px solid var(--accent-line)', color: 'var(--accent-text)',
          padding: '4px 12px', borderRadius: '8px', fontSize: '11px', pointerEvents: 'none',
          boxShadow: '0 4px 16px rgba(0,0,0,0.4)', whiteSpace: 'nowrap',
        }}>
          {brainToast}
        </div>
      )}
      <div style={S.header}>
        <div style={{ display: 'flex', gap: 6, WebkitAppRegion: 'no-drag' as any }}>
          <span onClick={() => window.deskAppAPI.closeBubble()} style={{ width: 12, height: 12, borderRadius: '50%', background: '#FF5F57', cursor: 'pointer' }} />
          <span onClick={() => window.deskAppAPI.minimizeBubble()} style={{ width: 12, height: 12, borderRadius: '50%', background: '#FFBD2E', cursor: 'pointer' }} />
          <span onClick={() => window.deskAppAPI.maximizeBubble()} style={{ width: 12, height: 12, borderRadius: '50%', background: '#28C840', cursor: 'pointer' }} />
        </div>
        <span style={{ ...S.headerTitle, color: 'var(--ink-faint)' }}>DeskApp</span>
        {/* Pills grouped so they stay adjacent — the header's space-between
            would otherwise spread them apart when tokenUsage is absent. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', WebkitAppRegion: 'no-drag' as any }}>
        {agentList.length > 0 && (
          <div style={{ position: 'relative', WebkitAppRegion: 'no-drag' as any }}>
            <div onClick={() => { setAgentOpen(!agentOpen); if (!agentOpen) setBrainModeOpen(false) }} style={{
              fontSize: '10px', color: agentFlash ? 'var(--accent-text)' : 'var(--ink-muted)', cursor: 'pointer',
              padding: '2px 8px', borderRadius: '4px', background: agentFlash ? 'var(--accent-soft)' : 'var(--line)',
              display: 'flex', alignItems: 'center', gap: '4px', transition: 'all 0.15s',
            }}>
              {activeAgent === 'hermes' ? '🅷' : activeAgent === 'claude-code' ? '🅲' : '●'} {agentList.find(a => a.id === activeAgent)?.name || activeAgent}
              <span style={{ fontSize: '8px' }}>▾</span>
            </div>
            {agentOpen && (
              <div style={{
                position: 'absolute', top: '100%', left: 0, zIndex: 50,
                background: 'var(--bg-elev)', border: '1px solid var(--solid)',
                borderRadius: '8px', padding: '4px', minWidth: '120px', marginTop: '4px',
              }}>
                {agentList.map(a => (
                  <div key={a.id} onClick={() => switchAgent(a.id)} style={{
                    padding: '6px 10px', fontSize: '11px', color: activeAgent === a.id ? 'var(--accent-text)' : 'var(--ink-secondary)',
                    cursor: 'pointer', borderRadius: '4px', background: activeAgent === a.id ? 'var(--accent-soft)' : 'transparent',
                  }}>{a.name}</div>
                ))}
              </div>
            )}
          </div>
        )}
        {/* Brain mode pill — per-bubble: 混合(auto) / 执行器(worker) / 规划器(planner) */}
        <div style={{ position: 'relative', WebkitAppRegion: 'no-drag' as any }}>
          <div onClick={() => { setBrainModeOpen(!brainModeOpen); if (!brainModeOpen) { setAgentOpen(false); if (!providerInfo) window.deskAppAPI.getProviderInfo?.().then(setProviderInfo).catch(() => {}) } }} style={{
            fontSize: '10px', color: brainMode === 'planner' ? 'var(--accent-text)' : 'var(--ink-muted)', cursor: 'pointer',
            padding: '2px 8px', borderRadius: '4px',
            background: brainMode === 'planner' ? 'var(--accent-soft)' : 'var(--line)',
            display: 'flex', alignItems: 'center', gap: '4px', transition: 'all 0.15s',
          }}>
            {BRAIN_MODES().find(m => m.id === brainMode)?.icon} {BRAIN_MODES().find(m => m.id === brainMode)?.label}
            <span style={{ fontSize: '8px' }}>▾</span>
          </div>
          {brainModeOpen && (
            <div style={{
              position: 'absolute', top: '100%', right: 0, zIndex: 50,
              background: 'var(--bg-elev)', border: '1px solid var(--solid)',
              borderRadius: '8px', padding: '4px', minWidth: '210px', marginTop: '4px',
            }}>
              {BRAIN_MODES().map(m => (
                <div key={m.id} onClick={() => switchBrainMode(m.id)} style={{
                  padding: '6px 10px', fontSize: '11px', color: brainMode === m.id ? 'var(--accent-text)' : 'var(--ink-secondary)',
                  cursor: 'pointer', borderRadius: '4px', background: brainMode === m.id ? 'var(--accent-soft)' : 'transparent',
                }}>
                  <div>{m.icon} {m.label}</div>
                  <div style={{ fontSize: '9px', color: 'var(--ink-faint)', marginTop: '1px' }}>{m.desc}</div>
                </div>
              ))}
              {/* #23: provider:model + verify */}
              {providerInfo && (
                <div style={{ borderTop: '1px solid var(--bg-hover)', marginTop: '4px', padding: '6px 10px', fontSize: '9px', color: 'var(--ink-muted)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {providerInfo.provider} · {brainMode === 'planner' ? providerInfo.plannerModel : providerInfo.workerModel}
                  </span>
                  {verifyState === 'idle' && (
                    <span onClick={() => {
                      setVerifyState('checking')
                      window.deskAppAPI.verifyProvider?.()
                        .then(r => setVerifyState(r.ok ? `✓ ${r.latencyMs}ms` : `✗ ${r.error || 'failed'}`))
                        .catch(() => setVerifyState('✗ error'))
                    }} style={{ cursor: 'pointer', color: 'var(--info)' }}>{t('bubble.verify')}</span>
                  )}
                  {verifyState === 'checking' && <span>…</span>}
                  {verifyState !== 'idle' && verifyState !== 'checking' && (
                    <span style={{ color: verifyState.startsWith('✓') ? 'var(--ok-text)' : 'var(--danger-text)' }}>{verifyState}</span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
        {/* Inbox bell (P0-5) */}
        <InboxPanel />
        {/* #15: artifacts entry — opens the workspace FileExplorer */}
        <div onClick={() => window.deskAppAPI.openFileExplorer()} title={t('bubble.workspaceArtifacts')} style={{
          fontSize: '11px', cursor: 'pointer', padding: '2px 6px', borderRadius: '4px',
          background: 'var(--line)', color: 'var(--ink-muted)',
        }}>📂</div>
        </div>
        {tokenUsage && (
          <span style={{ fontSize: '9px', color: 'var(--ink-faint)', marginLeft: 'auto', fontFamily: 'SF Mono, Monaco, monospace' }}>
            {formatTokens(tokenUsage.total)} tokens
            {tokenUsage.total > 0 && (
              <span style={{ marginLeft: '4px', color: 'var(--line-strong)' }}>
                ~{formatCost(calcTurnCost(tokenUsage, turnModel))}
              </span>
            )}
            {cumulativeCost > 0 && (
              <span style={{ marginLeft: '6px', color: costColor }}>
                ∑{formatCost(cumulativeCost)}
              </span>
            )}
            {tokenUsage.total > 1000 && (
              <span style={{ marginLeft: '6px', display: 'inline-flex', alignItems: 'center', gap: '3px' }}>
                <span style={{ width: '30px', height: '2px', background: 'var(--line)', borderRadius: '1px', display: 'inline-block' }}>
                  <span style={{
                    display: 'block', width: `${contextBarPercent(tokenUsage.total)}%`, height: '100%',
                    background: isContextWarning(tokenUsage.total) ? 'var(--warn)' : 'var(--accent-line)', borderRadius: '1px',
                  }} />
                </span>
              </span>
            )}
          </span>
        )}
      </div>

      <div style={S.messages} onScroll={handleMessagesScroll}>
        {onboardingVisible && (
          <OnboardingCard
            onComplete={() => { setLlmConfigured(true); setOnboardingVisible(false) }}
            onDismiss={() => {
              window.deskAppAPI.dismissOnboarding().catch(() => {})
              setOnboardingVisible(false)
            }}
            onCollapsed={() => setOnboardingVisible(false)}
          />
        )}
        {tokenUsage && isContextWarning(tokenUsage.total) && (
          <div style={{
            padding: '6px 12px', marginBottom: 8,
            background: 'var(--warn-soft)', border: '1px solid var(--warn)',
            borderRadius: '8px', fontSize: '10px', color: 'var(--warn-text)',
          }}>
            ⚠️ {Math.round(tokenUsage.total / 1000)}K tokens used. Consider starting a new conversation.
            <button onClick={() => { setMessages([]); sessionLoaded.current = false }} style={{
              marginLeft: '8px', background: 'var(--warn-soft)', border: '1px solid var(--warn)',
              borderRadius: '4px', padding: '2px 8px', color: 'var(--warn-text)', fontSize: '10px', cursor: 'pointer',
            }}>Start Fresh</button>
          </div>
        )}
        {showWelcome && !onboardingVisible && (
          <div style={{
            background: 'linear-gradient(135deg, var(--accent-soft), var(--accent-2-soft))',
            border: '1px solid var(--accent-line)', borderRadius: '10px',
            padding: '10px 14px', marginBottom: '8px', fontSize: '11px',
            display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
          }}>
            <div>
              <div style={{ fontWeight: 600, color: 'var(--accent-text)', marginBottom: '4px' }}>{t('welcome.title')}</div>
              <div style={{ color: 'var(--ink-secondary)', lineHeight: 1.5 }}>
                {t('welcome.hint')}
              </div>
            </div>
            <button onClick={() => setShowWelcome(false)} style={{
              background: 'none', border: 'none', color: 'var(--ink-faint)', cursor: 'pointer', fontSize: '12px',
            }}>✕</button>
          </div>
        )}

        {/* Empty state with templates (#37: greeting + task-rise stagger) */}
        {!hasContent && (
          <div style={{ padding: '8px 4px' }}>
            <style>{`@keyframes task-rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.task-rise{animation:none!important}}`}</style>
            <div style={{ textAlign: 'center', fontSize: '18px', marginBottom: '4px' }}>🤖</div>
            <div style={{ textAlign: 'center', fontSize: '13px', fontWeight: 600, color: 'var(--ink)', marginBottom: '6px' }}>
              {(() => { const h = new Date().getHours(); return h < 6 ? t('bubble.greeting.night') : h < 12 ? t('bubble.greeting.morning') : h < 18 ? t('bubble.greeting.afternoon') : t('bubble.greeting.evening') })()}{t('bubble.whatCanIDo')}
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', justifyContent: 'center' }}>
              {([
                { icon: '🪟', label: t('bubble.card.createWindow'), text: '', create: true },
                ...dynamicTemplates,
                { icon: '💻', label: t('bubble.card.code'), text: t('bubble.card.codeText') },
                { icon: '📂', label: t('bubble.card.organize'), text: t('bubble.card.organizeText') },
                { icon: '🔍', label: t('bubble.card.search'), text: t('bubble.card.searchText') },
              ] as { icon: string; label: string; text: string; create?: boolean }[]).slice(0, 7).map((t, i) => (
                <div key={t.label} className="task-rise"
                  onClick={() => { if (t.create) window.deskAppAPI.genui.openCard(); else { setInput(t.text); inputRef.current?.focus() } }}
                  style={{ animation: 'task-rise 0.3s ease both', animationDelay: `${i * 120}ms`,
                    background: 'var(--bg-card)', border: '1px solid var(--bg-hover)',
                    borderRadius: '10px', padding: '10px 14px', cursor: 'pointer',
                    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
                    minWidth: '100px', transition: 'all 0.15s',
                  }}
                  onMouseEnter={e => { const t = e.currentTarget as HTMLElement; t.style.background = 'var(--accent-soft)'; t.style.borderColor = 'var(--accent-line)' }}
                  onMouseLeave={e => { const t = e.currentTarget as HTMLElement; t.style.background = 'var(--bg-card)'; t.style.borderColor = 'var(--bg-hover)' }}
                >
                  <span style={{ fontSize: '20px' }}>{t.icon}</span>
                  <span style={{ fontSize: '10px', color: 'var(--ink-secondary)', fontWeight: 500 }}>{t.label}</span>
                </div>
              ))}
            </div>
            {messages.length > 0 && (
              <div style={{ textAlign: 'center', marginTop: '12px', display: 'flex', gap: '8px', justifyContent: 'center' }}>
                <button onClick={exportSession} style={{
                  background: 'var(--bg-card)', border: '1px solid var(--solid)',
                  borderRadius: '6px', padding: '4px 10px', color: 'var(--ink-faint)', fontSize: '10px', cursor: 'pointer',
                }}>📥 Export</button>
                <label style={{
                  background: 'var(--bg-card)', border: '1px solid var(--solid)',
                  borderRadius: '6px', padding: '4px 10px', color: 'var(--ink-faint)', fontSize: '10px', cursor: 'pointer',
                }}>
                  📤 Import
                  <input type="file" accept=".json" style={{ display: 'none' }} onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) importSession(file)
                  }} />
                </label>
              </div>
            )}
          </div>
        )}

        {/* Turn-based message rendering */}
        {turns.map((turn, ti) => {
          const isLastTurn = ti === turns.length - 1
          const isAgentTurn = !turn.user && (turn.history.length > 0 || turn.assistant != null)
          const isLiveAgent = isLastTurn && streaming && isAgentTurn
          const isWaiting = isLastTurn && streaming && turn.user !== null

          const rcs = turn.history.filter(h => h.kind === 'reasoning').map(h => ({ id: h.id, content: h.content }))
          const tcs = turn.history.filter(h => h.kind === 'tool_call').map(h => ({ id: h.id, name: h.name || '', args: h.args || '' }))
          const trs = turn.history.filter(h => h.kind === 'tool_result').map(h => ({ id: h.id, name: h.name || '', content: h.content }))
          // Real thinking-block boundaries when the bridge provided them
          // (empty for older turns → buildReasoningEvents keeps its regex path).
          const segments = reasoningSegments(turn.history)
          const events = buildReasoningEvents(rcs, tcs, trs, turn.assistant?.content, isLiveAgent, segments)
          // Live tree on the streaming turn; frozen tree on its original turn.
          const turnTree = (isLastTurn ? taskTree : null) || (turn.user ? frozenTrees[turn.user.id] : null)

          return (
            <div key={ti}>
              {turn.user && (
                <div id={`msg-${turn.user.id}`} style={S.msgRow('user')}>
                  <UserMessage
                    content={turn.user.content}
                    messageId={turn.user.id}
                    onSave={handleEditSave}
                  >
                    {/* width cap lives on .user-message (85%); the bubble fills it */}
                    <div style={{ ...S.bubble('user'), maxWidth: '100%' }}>
                      <MarkdownContent text={turn.user.content} />
                    </div>
                  </UserMessage>
                  {!streaming && isLastTurn && (
                    <span onClick={() => handleSend(turn.user!.content)}
                      style={{ fontSize: '10px', color: 'var(--ink-faint)', cursor: 'pointer', padding: '2px 4px', alignSelf: 'center' }}
                      title="Retry this message">↻</span>
                  )}
                </div>
              )}
              {(events.length > 0 || isLiveAgent || isWaiting || turnTree) && (
                <div style={{ marginBottom: 12 }}>
                  {turnTree ? (
                    // Task-tree turn: the tree IS the reasoning — render it in
                    // place of the (empty) thinking fold card, anchored to its turn.
                    <TaskTreePanel tree={turnTree} />
                  ) : isLiveAgent && liveTurn ? (
                    // P0-8: event-driven live turn — tool pairing and risk
                    // badges come from tool.started/finished events, not regex.
                    <TurnGroup turn={liveTurn} />
                  ) : (
                    <ReasoningTimeline events={events} streaming={isLiveAgent || isWaiting}
                      elapsedSec={!streaming && isAgentTurn ? turn.assistant?.elapsedSec : undefined} />
                  )}
                  <AgentPanel events={events} assistantContent={turn.assistant?.content} status={sessionStatus} />
                  {/* P0-7: streamGate — the live-streaming answer renders
                      BELOW the board (AgentPanel), matching the final layout:
                      thinking → board → reply. No jump at turn end. */}
                  {isLiveAgent && liveTurn && !turnTree && gateState === 'streaming' && liveTurn.answer.trim() && (
                    <div style={S.msgRow('assistant')}>
                      <div>
                        <div style={S.bubble('assistant')}><MarkdownContent text={liveTurn.answer.trimStart()} /></div>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {turn.assistant && !(isLastTurn && streaming) && (
                <div style={S.msgRow('assistant')}>
                  <div>
                    <div style={S.bubble('assistant')}><MarkdownContent text={turn.assistant.content.trimStart()} /></div>
                    <MessageActions
                      messageId={turn.assistant.id}
                      content={turn.assistant.content}
                      onRegenerate={() => {
                        const userMsg = turn.user
                        if (userMsg) handleSend(userMsg.content)
                      }}
                      onDelete={() => {
                        setMessages(prev => prev.filter(m => m.id !== turn.assistant!.id))
                      }}
                    />
                    {turn.assistant.model && (
                      <div style={{ fontSize: '9px', color: 'var(--ink-faint)', marginTop: '3px', fontFamily: 'SF Mono, Monaco, monospace' }}>
                        {turn.assistant.model.startsWith('kimi') ? '🧠' : '⚡'} {turn.assistant.model}{turn.assistant.via ? ` · ${turn.assistant.via}` : ''}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}

        {/* Error display with retry */}
        {error && (
          <div style={{ padding: '6px 12px', marginBottom: 8, background: 'var(--danger-soft)', borderRadius: 8, color: 'var(--danger-text)', fontSize: 11 }}>
            {error}
            {!streaming && (
              <span style={{ marginLeft: '8px', fontSize: '10px', color: 'var(--ink-faint)', cursor: 'pointer' }}
                onClick={() => {
                  setError('')
                  const lastUser = [...messages].reverse().find(m => m.kind === 'user')
                  if (lastUser) { setInput(lastUser.content); inputRef.current?.focus() }
                }}>(retry ↻)</span>
            )}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Phase 6: execution-gate approval cards — inline above the input bar
          so the ResizeObserver grows the bubble to fit them */}
      {approvals.map(req => (
        <ApprovalCard key={req.id} req={req} onDecide={handleApprovalDecide} />
      ))}
      {/* #33: ask_user question cards */}
      {questions.map(req => (
        <QuestionCard key={req.id} req={req} onAnswer={handleQuestionAnswer} />
      ))}

      {/* #35: task-tree plan confirmation */}
      {pendingPlan && (
        <div style={{
          margin: '8px 0', padding: '12px 14px', borderRadius: 12,
          background: 'var(--accent-soft)', border: '1px solid var(--accent-line)',
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-text)', marginBottom: 6 }}>
            {t('bubble.plan.confirm', { n: pendingPlan.nodes.length })}
          </div>
          {pendingPlan.nodes.map((n: any) => (
            <div key={n.id} style={{ fontSize: 11, color: 'var(--ink-secondary)', padding: '2px 0' }}>
              {n.kind === 'explore' ? '🔍' : '▸'} {n.title}{n.deps.length ? t('bubble.plan.deps', { deps: n.deps.join(',') }) : ''}
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            <button onClick={() => decidePlan(true)} style={{
              flex: 1, padding: '6px 0', fontSize: 12, borderRadius: 8, cursor: 'pointer',
              background: 'var(--ok-soft)', border: '1px solid var(--ok)', color: 'var(--ok)',
            }}>{t('bubble.plan.run')}</button>
            <button onClick={() => decidePlan(false)} style={{
              flex: 1, padding: '6px 0', fontSize: 12, borderRadius: 8, cursor: 'pointer',
              background: 'var(--danger-soft)', border: '1px solid var(--danger)', color: 'var(--danger)',
            }}>{t('bubble.plan.cancel')}</button>
          </div>
        </div>
      )}

      {/* #11: attachment chips above the input bar */}
      <AttachmentTray items={attachments} onRemove={removeAttachment} />
              {feedPayload && (
                <FeedTray
                  payload={feedPayload}
                  onRemove={(path) => setFeedPayload(prev => prev ? { ...prev, items: prev.items.filter(i => i.path !== path) } : prev)}
                  onExpand={async (path) => {
                    try {
                      const r2 = await window.deskAppAPI.expandFolder(path)
                      if (r2?.ok) setFeedPayload(prev => prev ? { ...prev, items: [...prev.items, ...r2.items] } : prev)
                    } catch { /* expand 失败忽略 */ }
                  }}
                  onAddPaths={handleAddFeedPaths}
                  onReanalyze={handleReanalyzeFeed}
                />
              )}

      {/* Edit-target banner: a window card is pulled out — config commands patch it */}
      {editSpec && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0,
          padding: '5px 12px', background: 'var(--accent-soft)',
          borderBottom: '1px solid var(--accent-line)', fontSize: 10, color: 'var(--accent-text)',
          WebkitAppRegion: 'no-drag' as any,
        } as React.CSSProperties}>
          {t('bubble.editing', { title: editSpec.title })}
          <span style={{ color: 'var(--ink-muted)' }}>{t('bubble.editingHint')}</span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
            {['周期=0 */30 * * * *', '主题=', '推送='].map((txt) => (
              <button key={txt} onClick={() => { setInput(txt); inputRef.current?.focus() }} style={S.chip}>{txt}</button>
            ))}
          <button onClick={() => window.deskAppAPI?.genui?.runSpec(editSpec.id)} style={S.chip}>{t('bubble.run')}</button>
          <button onClick={() => window.deskAppAPI?.genui?.stopSpec(editSpec.id)} style={S.chip}>{t('bubble.pause')}</button>
          </span>
        </div>
      )}

      {/* Queued notice — a previous turn is still running on this window's bridge */}
      {queued && (
        <div style={{
          margin: '0 12px 8px', padding: '8px 12px', borderRadius: 10,
          background: 'var(--warn-bg, rgba(251,191,36,0.12))',
          border: '1px solid rgba(251,191,36,0.35)',
          color: '#fbbf24', fontSize: 11.5, lineHeight: 1.5,
        }}>
          {t('bubble.queued')}
        </div>
      )}

      {/* Input bar */}
      <div style={S.inputBar}>
        <textarea ref={inputRef} value={input}
          onChange={e => { setInput(e.target.value); autoResize() }}
          onKeyDown={handleKeyDown}
          onPaste={e => { if (e.clipboardData.files.length) { e.preventDefault(); addAttachments(e.clipboardData.files) } }}
          onDragOver={e => { e.preventDefault(); e.stopPropagation() }}
          onDrop={handleDrop}
          onCompositionStart={() => { isComposingRef.current = true }}
          onCompositionEnd={() => { isComposingRef.current = false }}
          placeholder="Type a message..." rows={1} style={S.textarea}
          onFocus={e => { e.target.style.borderColor = 'var(--accent-line)'; e.target.style.background = 'var(--line)' }}
          onBlur={e => { e.target.style.borderColor = 'var(--bg-hover)'; e.target.style.background = 'var(--bg-card)' }} />
        {/* D3 #41A: voice input — idle/listening(pulse+level)/transcribing */}
        <button onClick={speech.toggle} disabled={!speech.supported}
          title={speech.supported ? (speech.state === 'listening' ? t('bubble.voice.stop') : t('bubble.voice.start')) : t('bubble.voice.unsupported')}
          style={{
            ...S.sendBtn(speech.state !== 'idle'),
            background: speech.state === 'listening' ? 'var(--danger)' : speech.state === 'transcribing' ? 'var(--warn)' : 'var(--line)',
            opacity: speech.supported ? 1 : 0.35,
            animation: speech.state === 'listening' ? 'pulse 1.2s ease-in-out infinite' : 'none',
            transform: speech.state === 'listening' ? `scale(${1 + speech.level * 0.25})` : 'scale(1)',
          }}>
          🎤
        </button>
        <button onClick={busy ? doAbort : () => handleSend()} disabled={!busy && !input.trim()}
          style={S.sendBtn(!!input.trim() || busy)}
          onMouseDown={e => { if (input.trim() || busy) (e.currentTarget as HTMLElement).style.transform = 'scale(0.9)' }}
          onMouseUp={e => { (e.currentTarget as HTMLElement).style.transform = 'scale(1)' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = 'scale(1)' }}>
          {busy ? '■' : '↑'}
        </button>
      </div>

      {/* Resize handle */}
      <div style={{
        position: 'absolute', bottom: 0, right: 0,
        width: 16, height: 16, cursor: 'nwse-resize',
        WebkitAppRegion: 'se-resize' as any, zIndex: 5,
      }} />
    </div>
    </MessageInteractionProvider>
  )
}
