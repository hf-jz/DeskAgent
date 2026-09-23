import { useState, useEffect, useMemo } from 'react'
import { t } from '../lib/i18n'

interface SkillEntry { name: string; version: string; category: string; tags: string[]; description: string; active: boolean; activeFor: string[]; installedAt?: string }
interface FullSkill { name: string; version: string; author: string; category: string; tags: string[]; trigger: string; description: string; instructions: string; adapters: any; active: boolean; activeFor: string[]; installedAt?: string; source?: string }
interface Category { id: string; icon: string; label: string; subcategories: { id: string; label: string }[] }
interface CommunitySkill { name: string; version: string; category: string; tags: string[]; description: string; author: string; stars: number; repo: string; raw_url: string; compatible_agents: string[]; installed: boolean; hasUpdate: boolean; localVersion?: string }

const AGENTS = ['hermes', 'claude-code', 'cursor', 'openclaw'] as const
type AgentId = typeof AGENTS[number]

function agentColor(a: AgentId): string {
  const colors: Record<string, string> = { hermes: 'var(--accent)', 'claude-code': '#d97757', cursor: '#3b82f6', openclaw: '#10b981' }
  return colors[a] || 'var(--ink-muted)'
}
function agentLabel(a: AgentId): string {
  const labels: Record<string, string> = { hermes: 'Hermes', 'claude-code': 'Claude', cursor: 'Cursor', openclaw: 'OpenClaw' }
  return labels[a] || a
}
function agentExample(s: FullSkill, a: AgentId): string {
  const n = s.name
  switch (a) {
    case 'hermes': return `# 在终端中触发\n$ hermes "${s.description}"\n\n# SKILL.md 触发词:\n# trigger: ${s.trigger || n}`
    case 'claude-code': return `# CLAUDE.md 添加:\n## ${n}\n> ${s.description}\n# 触发: ${s.trigger || s.description}`
    case 'cursor': return `# .cursorrules 添加:\n# 技能: ${n} — ${s.description}\n# 触发: ${s.trigger || '手动'}`
    case 'openclaw': return `# OpenClaw 配置:\n# ${n} — ${s.description}`
  }
}

// ── Color palette ──
const C = {
  bg: 'var(--bg-elev)', cardBg: 'var(--bg-card)', border: 'var(--line)',
  text: 'var(--ink)', subtitle: 'var(--ink-muted)', dim: 'var(--ink-faint)',
  accent: 'var(--accent-text)', accentBg: 'var(--accent-soft)', green: 'var(--ok)', greenBg: 'rgba(52,199,89,0.2)',
  overlay: 'rgba(0,0,0,0.5)', orange: 'var(--warn)', orangeBg: 'var(--warn-soft)',
}

// ── Skill card grid styles ──
const Sc = {
  grid: { flex: 1, overflowY: 'auto' as const, padding: '12px 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '10px', alignContent: 'start' } as React.CSSProperties,
  card: { background: C.cardBg, borderRadius: '12px', border: `1px solid ${C.border}`, padding: '14px', cursor: 'pointer', transition: 'all .2s', position: 'relative' as const, display: 'flex', flexDirection: 'column' as const } as React.CSSProperties,
  cardName: { fontSize: '12px', fontWeight: 600, color: C.text, lineHeight: 1.3 } as React.CSSProperties,
  cardVer: { fontSize: '9px', color: C.dim } as React.CSSProperties,
  cardDesc: { fontSize: '10px', color: C.subtitle, marginTop: '6px', lineHeight: 1.4, flex: 1 } as React.CSSProperties,
  cardTags: { display: 'flex', gap: '4px', marginTop: '8px', flexWrap: 'wrap' as const },
  tag: { fontSize: '8px', padding: '2px 6px', borderRadius: '4px', background: C.accentBg, color: C.accent } as React.CSSProperties,
  cardAgents: { display: 'flex', gap: '4px', marginTop: '8px' } as React.CSSProperties,
  agentDot: (a: AgentId, active: boolean): React.CSSProperties => ({ width: '8px', height: '8px', borderRadius: '50%', background: active ? agentColor(a) : 'var(--solid)' }),
  badge: (active: boolean): React.CSSProperties => ({ position: 'absolute' as const, top: '10px', right: '10px', width: '6px', height: '6px', borderRadius: '50%', background: active ? C.green : 'transparent', border: active ? 'none' : `1px solid ${C.border}` }),
  empty: { gridColumn: '1/-1', textAlign: 'center' as const, color: C.dim, fontSize: '12px', padding: '40px 0' },
  skeleton: { background: C.cardBg, borderRadius: '12px', border: `1px solid ${C.border}`, padding: '14px', height: '130px' } as React.CSSProperties,
  skelBar: (w: number): React.CSSProperties => ({ height: '10px', width: `${w}px`, background: 'var(--line)', borderRadius: '4px', marginBottom: '8px', animation: 'pulse 1.5s ease-in-out infinite' }),
}

// ── Detail panel styles ──
const Ps = {
  overlay: { position: 'fixed' as const, inset: 0, zIndex: 200, display: 'flex', justifyContent: 'flex-end' } as React.CSSProperties,
  backdrop: { position: 'absolute' as const, inset: 0, background: C.overlay } as React.CSSProperties,
  panel: { position: 'relative' as const, width: '420px', maxWidth: '90vw', height: '100%', background: '#252527', display: 'flex', flexDirection: 'column' as const, boxShadow: '-4px 0 32px rgba(0,0,0,0.4)', animation: 'slideIn .25s cubic-bezier(.4,0,.2,1)' } as React.CSSProperties,
  closeBtn: { position: 'absolute' as const, top: '14px', right: '14px', width: '28px', height: '28px', borderRadius: '8px', border: 'none', background: 'var(--line)', color: C.subtitle, cursor: 'pointer', fontSize: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center' } as React.CSSProperties,
  header: { padding: '18px 20px 12px', borderBottom: `1px solid ${C.border}`, flexShrink: 0 } as React.CSSProperties,
  body: { flex: 1, overflowY: 'auto' as const, padding: '16px 20px' } as React.CSSProperties,
  agentRow: { display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '8px' } as React.CSSProperties,
  agentChip: (a: AgentId): React.CSSProperties => ({ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '9px', padding: '2px 8px', borderRadius: '12px', background: `${agentColor(a)}22`, color: agentColor(a), fontWeight: 600 }),
  name: { fontSize: '16px', fontWeight: 700, color: C.text } as React.CSSProperties,
  meta: { fontSize: '10px', color: C.dim, marginTop: '3px' } as React.CSSProperties,
  sectionTitle: { fontSize: '10px', fontWeight: 600, color: C.subtitle, marginTop: '14px', marginBottom: '6px' } as React.CSSProperties,
  description: { fontSize: '12px', color: C.text, lineHeight: 1.5 } as React.CSSProperties,
  tags: { display: 'flex', gap: '4px', flexWrap: 'wrap' as const },
  trigger: { fontSize: '11px', color: C.accent, padding: '4px 8px', background: C.accentBg, borderRadius: '6px', display: 'inline-block', marginTop: '4px' } as React.CSSProperties,
  instructions: { fontSize: '10px', color: C.subtitle, lineHeight: 1.5, whiteSpace: 'pre-wrap' as const, padding: '8px 10px', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', fontFamily: 'SF Mono, Monaco, monospace', maxHeight: '200px', overflowY: 'auto' as const } as React.CSSProperties,
  codeTabs: { display: 'flex', borderBottom: `1px solid ${C.border}` } as React.CSSProperties,
  codeTab: (active: boolean): React.CSSProperties => ({ padding: '6px 12px', fontSize: '10px', cursor: 'pointer', border: 'none', background: 'transparent', color: active ? C.accent : C.dim, borderBottom: active ? `2px solid ${C.accent}` : '2px solid transparent', fontWeight: active ? 600 : 400 }),
  codeBlock: { fontSize: '10px', color: C.subtitle, lineHeight: 1.5, whiteSpace: 'pre-wrap' as const, padding: '10px 12px', background: 'rgba(0,0,0,0.3)', borderRadius: '0 0 8px 8px', fontFamily: 'SF Mono, Monaco, monospace', maxHeight: '200px', overflowY: 'auto' as const } as React.CSSProperties,
  copyBtn: { position: 'absolute' as const, top: '8px', right: '8px', padding: '3px 8px', fontSize: '9px', borderRadius: '4px', border: `1px solid ${C.border}`, background: 'var(--line)', color: C.dim, cursor: 'pointer' } as React.CSSProperties,
  actions: { display: 'flex', gap: '8px', padding: '12px 20px', borderTop: `1px solid ${C.border}`, flexShrink: 0 } as React.CSSProperties,
  actionBtn: (primary: boolean): React.CSSProperties => ({ flex: 1, padding: '8px 0', fontSize: '11px', fontWeight: 600, borderRadius: '8px', cursor: 'pointer', border: primary ? 'none' : `1px solid ${C.border}`, background: primary ? 'linear-gradient(135deg,var(--accent),var(--accent-2))' : 'var(--line)', color: primary ? 'var(--ink)' : C.subtitle, textAlign: 'center' as const }),
}

// ── Skill Detail Panel ──
function SkillPanel({ name, onClose, onToggle, community }: { name: string; onClose: () => void; onToggle: () => void; community?: CommunitySkill }) {
  const [skill, setSkill] = useState<FullSkill | null>(null)
  const [loading, setLoading] = useState(true)
  const [codeTab, setCodeTab] = useState<AgentId>('hermes')
  const [copied, setCopied] = useState(false)
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    if (community) {
      setLoading(false)
      return
    }
    (window as any).deskAppAPI.skillsGet(name).then((data: any) => {
      setSkill(data)
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [name])

  const copyCode = () => {
    if (!skill && !community) return
    navigator.clipboard.writeText(
      community
        ? `# From ${community.repo}\n# ${community.description}`
        : agentExample(skill!, codeTab)
    )
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const install = async () => {
    if (!community) return
    setInstalling(true)
    try {
      await (window as any).deskAppAPI.skillsInstallRemote(community.raw_url, community.name, community.category)
      onClose()
    } catch (e) { console.error(e) }
    setInstalling(false)
  }

  if (loading) return <div style={Ps.overlay}><div style={Ps.backdrop} onClick={onClose} /><div style={Ps.panel}><div style={{ padding: '30px', color: C.dim, fontSize: '12px' }}>Loading...</div></div></div>
  if (!skill && !community) return <div style={Ps.overlay}><div style={Ps.backdrop} onClick={onClose} /><div style={Ps.panel}><div style={{ padding: '30px', color: C.dim, fontSize: '12px' }}>Failed to load</div></div></div>

  const displayName = community ? community.name : skill!.name
  const displayDesc = community ? community.description : skill!.description
  const displayTags = community ? community.tags : skill!.tags
  const displayVersion = community ? community.version : skill!.version
  const displayAuthor = community ? community.author : skill!.author
  const displayCategory = community ? community.category : skill!.category
  const displayTrigger = community ? '' : skill!.trigger
  const displayInstructions = community ? '' : skill!.instructions
  const compatibleAgents = community ? community.compatible_agents : skill!.activeFor
  const isInstalled = community ? community.installed : true

  return <div style={Ps.overlay}><div style={Ps.backdrop} onClick={onClose} /><div style={Ps.panel}>
    <button style={Ps.closeBtn} onClick={onClose}>✕</button>
    <div style={Ps.header}>
      {community && <div style={{ fontSize: '10px', color: C.orange, marginBottom: '4px' }}>🌟 Community Skill · ⭐{community.stars.toLocaleString()} stars</div>}
      <div style={Ps.agentRow}>{(compatibleAgents || []).slice(0, 4).map((a: string) => <span key={a} style={Ps.agentChip(a as AgentId)}><span style={{ width: '6px', height: '6px', borderRadius: '50%', background: agentColor(a as AgentId), display: 'inline-block' }} />{agentLabel(a as AgentId)}</span>)}</div>
      <div style={Ps.name}>{displayName}</div><div style={Ps.meta}>v{displayVersion} · {displayAuthor} · {displayCategory}{community ? ` · ${community.repo}` : ''}</div>
      {community?.hasUpdate && <div style={{ ...Ps.meta, color: C.orange, marginTop: '2px' }}>⚠ Update available: v{community.localVersion} → v{community.version}</div>}
    </div>
    <div style={Ps.body}>
      {displayDesc && <><div style={Ps.sectionTitle}>{t('skills.desc')}</div><div style={Ps.description}>{displayDesc}</div></>}
      {displayTrigger && <><div style={Ps.sectionTitle}>{t('skills.trigger')}</div><span style={Ps.trigger}>{displayTrigger}</span></>}
      {displayTags.length > 0 && <><div style={Ps.sectionTitle}>{t('skills.tags')}</div><div style={Ps.tags}>{displayTags.map((t: string, i: number) => <span key={i} style={Sc.tag}>{t}</span>)}</div></>}
      {displayInstructions && <><div style={{ ...Ps.sectionTitle, marginTop: '16px' }}>{t('skills.invoke')}</div><div style={{ position: 'relative' }}><div style={Ps.codeTabs}>{AGENTS.map(a => <button key={a} style={Ps.codeTab(codeTab === a)} onClick={() => setCodeTab(a)}>{agentLabel(a)}</button>)}</div><div style={{ position: 'relative' }}><button style={Ps.copyBtn} onClick={copyCode}>{copied ? '✓ 已复制' : '📋 复制'}</button><div style={Ps.codeBlock}>{agentExample(skill!, codeTab)}</div></div></div></>}
      {displayInstructions && <><div style={Ps.sectionTitle}>{t('skills.full')}</div><div style={Ps.instructions}>{displayInstructions.length > 2000 ? displayInstructions.substring(0, 2000) + '\n\n... (truncated)' : displayInstructions}</div></>}
    </div>
    <div style={Ps.actions}>
      {community && !isInstalled ? <button style={Ps.actionBtn(true)} onClick={install} disabled={installing}>{installing ? 'Installing...' : '⬇ Install from GitHub'}</button> :
        community && isInstalled ? <button style={Ps.actionBtn(true)} onClick={install} disabled={installing}>{installing ? 'Updating...' : '🔄 Update'}</button> :
          <button style={Ps.actionBtn(true)} onClick={onToggle}>{skill?.active ? `● Active — ${t('skills.deactivate')}` : `○ Inactive — ${t('skills.activate')}`}</button>}
      <button style={Ps.actionBtn(false)} onClick={() => { (window as any).deskAppAPI.skillsSyncHermes() }}>🔄 Sync</button>
      <button style={Ps.actionBtn(false)} onClick={onClose}>{t('skills.close')}</button>
    </div>
  </div></div>
}

// ── Installed tab ──
function InstalledTab({ skills, loading, onSelect }: { skills: SkillEntry[]; loading: boolean; onSelect: (name: string) => void }) {
  const [searchQuery, setSearchQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'active' | 'inactive'>('all')

  const filteredList = useMemo(() => {
    let result = skills
    if (filter === 'active') result = result.filter(s => s.active)
    if (filter === 'inactive') result = result.filter(s => !s.active)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(s => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q) || s.tags.some(t => t.toLowerCase().includes(q)))
    }
    return result.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
  }, [skills, filter, searchQuery])

  return <>
    <div style={{ padding: '12px 20px 0', display: 'flex', gap: '8px', alignItems: 'center' }}>
      <input style={{ flex: 1, background: 'var(--line)', border: `1px solid ${C.border}`, borderRadius: '8px', padding: '7px 10px', fontSize: '12px', color: C.text, outline: 'none' }} placeholder="Search..." value={searchQuery} onChange={e => setSearchQuery((e.target as HTMLInputElement).value)} />
      {(['all', 'active', 'inactive'] as const).map(opt => (
        <div key={opt} style={{
          padding: '5px 10px', fontSize: '10px', borderRadius: '6px', cursor: 'pointer', whiteSpace: 'nowrap',
          border: `1px solid ${filter === opt ? 'var(--accent-line)' : C.border}`,
          background: filter === opt ? C.accentBg : 'transparent',
          color: filter === opt ? C.accent : C.subtitle,
        }} onClick={() => setFilter(opt)}>
          {opt === 'all' ? 'All' : opt === 'active' ? 'Active' : 'Inactive'}
        </div>
      ))}
    </div>
    <div style={Sc.grid}>
      {loading ? Array.from({ length: 8 }).map((_, i) => (
        <div key={i} style={Sc.skeleton}>
          <div style={Sc.skelBar(80)} /><div style={Sc.skelBar(140)} /><div style={Sc.skelBar(100)} />
          <div style={{ display: 'flex', gap: '4px', marginTop: '8px' }}><div style={Sc.skelBar(50)} /><div style={Sc.skelBar(40)} /></div>
        </div>
      )) :
        filteredList.length === 0 ? <div style={Sc.empty}>No skills match.</div> :
          filteredList.map((skill, i) => (
            <div key={skill.name} style={{ ...Sc.card, animation: `cardIn .3s ease-out ${i * .03}s both` }} onClick={() => onSelect(skill.name)}
              onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = 'var(--accent-soft)'; el.style.borderColor = 'var(--accent-line)'; el.style.transform = 'translateY(-2px)' }}
              onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = C.cardBg; el.style.borderColor = C.border; el.style.transform = '' }}>
              <div style={Sc.badge(skill.active)} />
              <div><span style={Sc.cardName}>{skill.name}</span><span style={Sc.cardVer}> v{skill.version}</span></div>
              {skill.description && <div style={Sc.cardDesc}>{skill.description}</div>}
              {skill.tags.length > 0 && <div style={Sc.cardTags}>{skill.tags.slice(0, 5).map((tag, i) => <span key={i} style={Sc.tag}>{tag}</span>)}</div>}
              <div style={Sc.cardAgents}>{AGENTS.map(a => <div key={a} style={Sc.agentDot(a, skill.activeFor.includes(a))} title={agentLabel(a)} />)}</div>
            </div>
          ))}
    </div>
  </>
}

// ── Discover tab ──
function DiscoverTab({ localSkills, onSelect }: { localSkills: SkillEntry[]; onSelect: (name: string, community?: CommunitySkill) => void }) {
  const [categories, setCategories] = useState<Category[]>([])
  const [parentCategory, setParentCategory] = useState<string | null>(null)
  const [subCategory, setSubCategory] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [communitySkills, setCommunitySkills] = useState<CommunitySkill[]>([])
  const [refreshing, setRefreshing] = useState(false)
  const [showCommunity, setShowCommunity] = useState(false)

  useEffect(() => {
    (window as any).deskAppAPI.skillsCategories().then((data: any) => {
      setCategories(data?.categories || [])
    })
  }, [])

  const parentCat = categories.find(c => c.id === parentCategory)

  const discoveredSkills = useMemo(() => {
    let result = localSkills
    if (parentCategory && subCategory && subCategory !== 'all') result = result.filter(s => s.category === `${parentCategory}/${subCategory}`)
    else if (parentCategory) result = result.filter(s => s.category.startsWith(parentCategory + '/'))
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(s => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q) || s.tags.some(t => t.toLowerCase().includes(q)))
    }
    return result.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
  }, [localSkills, parentCategory, subCategory, searchQuery])

  const communityFiltered = useMemo(() => {
    let result = communitySkills
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(s => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q) || s.tags.some(t => t.toLowerCase().includes(q)))
    }
    return result
  }, [communitySkills, searchQuery])

  const doRefresh = async () => {
    setRefreshing(true)
    try {
      const r = await (window as any).deskAppAPI.skillsRefreshCommunity()
      if (r.ok) { setCommunitySkills(r.skills); setShowCommunity(true) }
    } catch (e) { console.error(e) }
    setRefreshing(false)
  }

  const doGitHubSearch = async () => {
    setRefreshing(true)
    try {
      const r = await (window as any).deskAppAPI.skillsSearchGitHub()
      if (r.ok && r.skills?.length > 0) {
        const newSkills = r.skills.map((s: any) => ({
          name: s.name, version: '0.1.0', author: 'GitHub', category: 'community/discovered',
          tags: [], description: s.description || '', stars: s.stars || 0, repo: s.repo,
          raw_url: `https://raw.githubusercontent.com/${s.repo}/main/SKILL.md`,
          compatible_agents: ['claude-code'], installed: false, hasUpdate: false,
        }))
        setCommunitySkills([...communitySkills, ...newSkills])
        setShowCommunity(true)
      }
    } catch (e) { console.error(e) }
    setRefreshing(false)
  }

  return <>
    <div style={{ padding: '12px 20px 0' }}>
      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
        <button onClick={doRefresh} disabled={refreshing} style={{ padding: '6px 14px', fontSize: '11px', borderRadius: '6px', cursor: 'pointer', border: `1px solid ${C.accent}44`, background: C.accentBg, color: C.accent, fontWeight: 600 }}>
          {refreshing ? '🔄 Refreshing...' : '🌐 Refresh from Community'}
        </button>
        <button onClick={doGitHubSearch} disabled={refreshing} style={{ padding: '6px 10px', fontSize: '10px', borderRadius: '6px', cursor: 'pointer', border: `1px solid ${C.border}`, background: 'transparent', color: C.subtitle }}>
          🔍 Search GitHub
        </button>
        {communitySkills.length > 0 && <span style={{ fontSize: '10px', color: C.dim }}>{communitySkills.length} community skills loaded</span>}
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: '10px', color: C.dim }}>Browse:</span>
        <div onClick={() => setShowCommunity(!showCommunity)} style={{ padding: '4px 10px', fontSize: '10px', borderRadius: '6px', cursor: 'pointer', border: `1px solid ${showCommunity ? 'var(--warn)' : C.border}`, background: showCommunity ? C.orangeBg : 'transparent', color: showCommunity ? C.orange : C.subtitle }}>
          {showCommunity ? '🌟 Community' : '📂 Local'}
        </div>
      </div>

      {!showCommunity ? <>
        {/* Local categories */}
        {!parentCategory ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {categories.map(cat => {
            const count = localSkills.filter(s => s.category.startsWith(cat.id + '/')).length
            return (
              <div key={cat.id} onClick={() => setParentCategory(cat.id)} style={{ padding: '8px 14px', borderRadius: '10px', border: `1px solid ${C.border}`, background: C.cardBg, cursor: 'pointer', transition: 'all .15s', minWidth: '140px' }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent-line)' }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = C.border }}>
                <div style={{ fontSize: '14px', marginBottom: '2px' }}>{cat.icon}</div>
                <div style={{ fontSize: '11px', fontWeight: 600, color: C.text }}>{cat.label}</div>
                <div style={{ fontSize: '9px', color: C.dim, marginTop: '2px' }}>{count} skills</div>
              </div>
            )
          })}
        </div> : <>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
            <span style={{ fontSize: '11px', color: C.accent, cursor: 'pointer' }} onClick={() => { setParentCategory(null); setSubCategory(null) }}>← All</span>
            <span style={{ fontSize: '11px', color: C.dim }}>/</span><span style={{ fontSize: '12px', fontWeight: 600, color: C.text }}>{parentCat?.icon} {parentCat?.label}</span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {parentCat?.subcategories.map(sub => {
              const count = localSkills.filter(s => s.category === `${parentCategory}/${sub.id}`).length
              return (
                <div key={sub.id} onClick={() => setSubCategory(subCategory === sub.id ? null : sub.id)} style={{
                  padding: '6px 12px', borderRadius: '8px', border: `1px solid ${subCategory === sub.id ? 'var(--accent-line)' : C.border}`,
                  background: subCategory === sub.id ? C.accentBg : C.cardBg, cursor: 'pointer', fontSize: '11px',
                  color: subCategory === sub.id ? C.accent : C.subtitle,
                }}>{sub.label} ({count})</div>
              )
            })}
          </div>
        </>}
        <div style={{ marginTop: '10px' }}><input style={{ width: '100%', background: 'var(--line)', border: `1px solid ${C.border}`, borderRadius: '8px', padding: '7px 10px', fontSize: '12px', color: C.text, outline: 'none' }} placeholder="Search discoverable skills..." value={searchQuery} onChange={e => setSearchQuery((e.target as HTMLInputElement).value)} /></div>
      </> : <>
        <div style={{ marginTop: '10px' }}><input style={{ width: '100%', background: 'var(--line)', border: `1px solid ${C.border}`, borderRadius: '8px', padding: '7px 10px', fontSize: '12px', color: C.text, outline: 'none' }} placeholder="Search community skills..." value={searchQuery} onChange={e => setSearchQuery((e.target as HTMLInputElement).value)} /></div>
      </>}
    </div>

    <div style={Sc.grid}>
      {!showCommunity ? <>
        {discoveredSkills.length === 0 ? <div style={Sc.empty}>{parentCategory ? 'No skills in this category yet.' : 'Select a category to browse.'}</div> :
          discoveredSkills.map((skill, i) => (
            <div key={skill.name} style={{ ...Sc.card, animation: `cardIn .3s ease-out ${i * .03}s both` }} onClick={() => onSelect(skill.name)}
              onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = 'var(--accent-soft)'; el.style.borderColor = 'var(--accent-line)'; el.style.transform = 'translateY(-2px)' }}
              onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = C.cardBg; el.style.borderColor = C.border; el.style.transform = '' }}>
              <div><span style={Sc.cardName}>{skill.name}</span><span style={Sc.cardVer}> v{skill.version}</span></div>
              {skill.description && <div style={Sc.cardDesc}>{skill.description}</div>}
              {skill.tags.length > 0 && <div style={Sc.cardTags}>{skill.tags.slice(0, 5).map((tag, i) => <span key={i} style={Sc.tag}>{tag}</span>)}</div>}
              <div style={{ ...Sc.cardAgents, justifyContent: 'space-between' }}>
                <div style={Sc.cardAgents}>{AGENTS.map(a => <div key={a} style={Sc.agentDot(a, skill.activeFor.includes(a))} title={agentLabel(a)} />)}</div>
              </div>
            </div>
          ))}
      </> : <>
        {/* Community skills */}
        {communityFiltered.length === 0 ? <div style={Sc.empty}>{refreshing ? 'Searching GitHub...' : 'No community skills found. Click Refresh to search.'}</div> :
          communityFiltered.map((skill, i) => (
            <div key={skill.name} style={{ ...Sc.card, animation: `cardIn .3s ease-out ${i * .03}s both`, borderColor: skill.hasUpdate ? `${C.orange}44` : skill.installed ? `${C.green}22` : C.border }} onClick={() => onSelect(skill.name, skill)}
              onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.background = 'var(--accent-soft)'; el.style.borderColor = 'var(--accent-line)'; el.style.transform = 'translateY(-2px)' }}
              onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.background = C.cardBg; el.style.borderColor = skill.hasUpdate ? `${C.orange}44` : skill.installed ? `${C.green}22` : C.border; el.style.transform = '' }}>
              {skill.hasUpdate ? <div style={{ position: 'absolute', top: '10px', right: '10px', fontSize: '9px', color: C.orange, fontWeight: 600 }}>⚠ Update</div> :
                skill.installed ? <div style={{ position: 'absolute', top: '10px', right: '10px', fontSize: '9px', color: C.green, fontWeight: 600 }}>✓ Installed</div> : null}
              <div><span style={Sc.cardName}>{skill.name}</span><span style={Sc.cardVer}> v{skill.version}</span></div>
              <div style={{ fontSize: '10px', color: C.dim, marginTop: '2px' }}>by {skill.author} · ⭐{skill.stars.toLocaleString()}</div>
              {skill.description && <div style={Sc.cardDesc}>{skill.description}</div>}
              {skill.tags.length > 0 && <div style={Sc.cardTags}>{skill.tags.slice(0, 5).map((tag, i) => <span key={i} style={Sc.tag}>{tag}</span>)}</div>}
              <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'flex-end' }}>
                {!skill.installed ? <span style={{ fontSize: '9px', color: C.accent, fontWeight: 600 }}>+ Install</span> :
                  skill.hasUpdate ? <span style={{ fontSize: '9px', color: C.orange, fontWeight: 600 }}>v{skill.localVersion} → v{skill.version}</span> : null}
              </div>
            </div>
          ))}
      </>}
    </div>
  </>
}

// ── Main SkillsTab ──
export default function SkillsTab(): React.JSX.Element {
  const [skills, setSkills] = useState<SkillEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'installed' | 'discover'>('installed')
  const [selected, setSelected] = useState<string | null>(null)
  const [selectedCommunity, setSelectedCommunity] = useState<CommunitySkill | undefined>(undefined)

  useEffect(() => {
    (window as any).deskAppAPI.skillsList().then((data: SkillEntry[]) => {
      setSkills(Array.isArray(data) ? data : [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const toggleSkill = () => {
    if (!selected) return
    const skill = skills.find(s => s.name === selected)
    if (!skill) return
    const newActive = !skill.active
    // #25: capability-declaring skills ask for one-time consent before enabling
    if (newActive && skill.capabilities?.length) {
      const ok = window.confirm(
        t('skills.enableConfirm', { name: skill.name, caps: skill.capabilities.map(c => `· ${c}`).join('\n') }))
      if (!ok) return
    }
    ;(window as any).deskAppAPI.skillsSetActive(selected, newActive, 'hermes')
    setSkills(prev => prev.map(s => s.name === selected ? { ...s, active: newActive, activeFor: newActive ? ['hermes'] : [] } : s))
  }

  const syncHermes = () => { (window as any).deskAppAPI.skillsSyncHermes() }
  const syncClaude = () => { (window as any).deskAppAPI.skillsSyncClaude?.() || console.log('Sync Claude not available') }
  const syncCursor = () => { (window as any).deskAppAPI.skillsSyncCursor?.() || console.log('Sync Cursor not available') }
  const syncCodex = () => { (window as any).deskAppAPI.skillsSyncCodex?.() }
  const syncOpenClaw = () => { (window as any).deskAppAPI.skillsSyncOpenClaw?.() }

  const handleSelect = (name: string, community?: CommunitySkill) => {
    setSelected(name)
    setSelectedCommunity(community)
  }

  return <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
    <style>{`@keyframes pulse{0%,100%{opacity:.3}50%{opacity:.6}}@keyframes slideIn{from{transform:translateX(100%)}to{transform:translateX(0)}}@keyframes cardIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}`}</style>
    <div style={{ padding: '14px 20px 0', borderBottom: `1px solid ${C.border}`, flexShrink: 0 }}>
      <div style={{ fontSize: '15px', fontWeight: 600, color: C.text, marginBottom: '4px' }}>Skill Hub</div>
      <div style={{ display: 'flex', gap: '0', marginBottom: '0' }}>
        {(['installed', 'discover'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)} style={{ padding: '8px 16px', fontSize: '12px', cursor: 'pointer', border: 'none', background: 'transparent', color: tab === t ? C.accent : C.subtitle, borderBottom: tab === t ? `2px solid ${C.accent}` : '2px solid transparent', fontWeight: tab === t ? 600 : 400 }}>
            {t === 'installed' ? `📦 Installed (${skills.length})` : '🔍 Discover'}
          </button>
        ))}
      </div>
    </div>
    {tab === 'installed' ? <InstalledTab skills={skills} loading={loading} onSelect={name => handleSelect(name)} /> :
      <DiscoverTab localSkills={skills} onSelect={handleSelect} />}
    {!loading && <div style={{ padding: '0 20px 12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
      <span style={{ fontSize: '9px', color: C.dim }}>{skills.filter(s => s.active).length} active</span>
      <div style={{ display: 'flex', gap: '6px' }}>
        <button style={{ padding: '4px 10px', fontSize: '10px', borderRadius: '5px', cursor: 'pointer', border: `1px solid ${C.border}`, background: 'transparent', color: C.subtitle }} onClick={syncHermes}>🔄 Hermes</button>
        <button style={{ padding: '4px 10px', fontSize: '10px', borderRadius: '5px', cursor: 'pointer', border: `1px solid ${C.border}`, background: 'transparent', color: C.subtitle }} onClick={syncClaude}>🤖 Claude</button>
        <button style={{ padding: '4px 10px', fontSize: '10px', borderRadius: '5px', cursor: 'pointer', border: `1px solid ${C.border}`, background: 'transparent', color: C.subtitle }} onClick={syncCursor}>📝 Cursor</button>
        <button style={{ padding: '4px 10px', fontSize: '10px', borderRadius: '5px', cursor: 'pointer', border: `1px solid ${C.border}`, background: 'transparent', color: C.subtitle }} onClick={syncCodex}>⚡ Codex</button>
        <button style={{ padding: '4px 10px', fontSize: '10px', borderRadius: '5px', cursor: 'pointer', border: `1px solid ${C.border}`, background: 'transparent', color: C.subtitle }} onClick={syncOpenClaw}>🅾 OpenClaw</button>
      </div>
    </div>}
    {selected && <SkillPanel name={selected} onClose={() => { setSelected(null); setSelectedCommunity(undefined) }} onToggle={toggleSkill} community={selectedCommunity} />}
  </div>
}
