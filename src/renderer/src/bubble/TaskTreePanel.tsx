import { useState } from 'react'
import { t } from '../lib/i18n'
import type { TaskPhase, TaskCondition } from '../../../shared/task-state'

export interface TreeNode {
  id: string
  title: string
  task: string
  deps: string[]
  /** shared vocabulary — see src/shared/task-state.ts */
  status: TaskPhase
  conditions?: TaskCondition[]
  elapsedMs?: number
  result?: string
  error?: string
}

export interface TaskTree {
  goal: string
  nodes: TreeNode[]
}

const STATUS_ICON: Record<TaskPhase, string> = {
  pending: '⏳',
  running: '🔄',
  suspended: '⏸',
  done: '✅',
  failed: '❌',
  terminating: '🧹',
}

function depthOf(n: TreeNode, byId: Map<string, TreeNode>, memo: Map<string, number>): number {
  const cached = memo.get(n.id)
  if (cached !== undefined) return cached
  const d = n.deps.length === 0 ? 0 : 1 + Math.max(...n.deps.map(dep => {
    const parent = byId.get(dep)
    return parent ? depthOf(parent, byId, memo) : 0
  }))
  memo.set(n.id, d)
  return d
}

/** Task-tree visualization — the DeskApp differentiator (方案 B). */
export function TaskTreePanel({ tree }: { tree: TaskTree }): React.JSX.Element {
  const [expanded, setExpanded] = useState<string | null>(null)
  const byId = new Map(tree.nodes.map(n => [n.id, n]))
  const memo = new Map<string, number>()
  const done = tree.nodes.filter(n => n.status === 'done').length
  const failed = tree.nodes.filter(n => n.status === 'failed').length
  const running = tree.nodes.some(n => n.status === 'running')

  return (
    <div style={{
      marginBottom: 10, borderRadius: 10, overflow: 'hidden',
      background: 'linear-gradient(135deg, rgba(124,58,237,0.10), rgba(6,182,212,0.06))',
      border: '1px solid var(--accent-line)',
    }}>
      <div style={{
        padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8,
        borderBottom: '1px solid var(--line)',
      }}>
        <span style={{ fontSize: 12 }}>🌳</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--accent-text)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {tree.goal}
        </span>
        <span style={{ fontSize: 10, color: 'var(--ink-muted)', fontFamily: 'SF Mono, Monaco, monospace' }}>
          {done}/{tree.nodes.length}{failed > 0 ? ` · ${t('tree.failed', { n: failed })}` : ''}{running ? ` · ${t('tree.running')}` : ''}
        </span>
      </div>
      <div style={{ padding: '6px 12px 8px' }}>
        {tree.nodes.map(n => {
          const depth = depthOf(n, byId, memo)
          const isOpen = expanded === n.id
          return (
            <div key={n.id}>
              <div
                onClick={() => setExpanded(isOpen ? null : n.id)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '3px 0',
                  paddingLeft: depth * 16, cursor: 'pointer', fontSize: 11,
                }}
              >
                <span style={{ fontSize: 10 }}>{STATUS_ICON[n.status]}</span>
                <span style={{
                  color: n.status === 'failed' ? 'var(--danger-text)' : n.status === 'done' ? 'var(--ink-secondary)' : 'var(--ink-muted)',
                  flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {depth > 0 && <span style={{ color: 'var(--ink-faint)', marginRight: 4 }}>└</span>}
                  {n.title}
                </span>
                {n.elapsedMs !== undefined && (
                  <span style={{ fontSize: 9, color: 'var(--ink-faint)', fontFamily: 'SF Mono, Monaco, monospace' }}>
                    {Math.round(n.elapsedMs / 1000)}s
                  </span>
                )}
              </div>
              {isOpen && (
                <div style={{
                  marginLeft: depth * 16 + 16, marginBottom: 4, padding: '6px 8px',
                  background: 'rgba(0,0,0,0.25)', borderRadius: 6,
                  fontSize: 10, color: 'var(--ink-muted)', lineHeight: 1.5,
                  maxHeight: 120, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                }}>
                  {n.status === 'failed'
                    ? `❌ ${n.error || t('tree.execFail')}`
                    : n.result
                      ? n.result.slice(0, 800)
                      : n.task}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
