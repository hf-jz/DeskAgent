import { useState } from 'react'
import type { FeedPayload } from '../../../shared/ipc-channels'
import { t, useLang } from '../lib/i18n'

/**
 * 投喂清单面板 — 分析对象的可视化编辑区。
 * 罗列当前分析的文件/文件夹；支持：删（✕ 移出清单，磁盘不动）、
 * 拆（🗂 文件夹拆一层子项）、加（拖拽到面板/窗口任意处）、
 * 重新分析（🔄 用当前清单再跑一轮）。
 */
interface Props {
  payload: FeedPayload
  onRemove: (path: string) => void
  onExpand: (path: string) => void
  onAddPaths: (paths: string[]) => void
  onReanalyze: () => void
}

const fmtSize = (n: number): string => n > 1048576 ? `${(n / 1048576).toFixed(1)}MB` : n > 1024 ? `${Math.max(1, Math.round(n / 1024))}KB` : `${n}B`

export default function FeedTray({ payload, onRemove, onExpand, onAddPaths, onReanalyze }: Props) {
  const { t: _t } = useLang()
  const [collapsed, setCollapsed] = useState(false)
  const items = payload.items

  return (
    <div style={{
      borderBottom: '1px solid var(--line)',
      background: 'var(--bg-soft, rgba(127,127,127,0.06))',
      fontSize: 11, flexShrink: 0,
      WebkitAppRegion: 'no-drag' as any,
    } as React.CSSProperties}>
      {/* 头部 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 12px' }}>
        <span
          onClick={() => setCollapsed(c => !c)}
          style={{ cursor: 'pointer', fontWeight: 600, color: 'var(--ink-secondary)' }}
        >
          {collapsed ? '▶' : '▼'} {t('feed.tray.title', { n: items.length })}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: 'var(--ink-faint)' }}>{t('feed.tray.dropHint')}</span>
        <button
          onClick={onReanalyze}
          disabled={items.length === 0}
          style={{
            padding: '2px 10px', borderRadius: 6, fontSize: 10, cursor: 'pointer',
            background: 'var(--accent-soft, rgba(99,102,241,0.15))',
            border: '1px solid var(--accent-line, rgba(99,102,241,0.4))',
            color: 'var(--accent-text, #818cf8)',
          }}
        >
          🔄 {t('feed.tray.reanalyze')}
        </button>
      </div>

      {/* 条目列表 — 自身也是拖放区 */}
      {!collapsed && (
        <div
          style={{ maxHeight: 180, overflowY: 'auto', padding: '0 10px 6px', display: 'flex', flexDirection: 'column', gap: 3 }}
          onDragOver={e => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault(); e.stopPropagation()
            const paths: string[] = []
            for (const f of Array.from(e.dataTransfer.files)) {
              const p = window.deskAppAPI.getFilePath(f)
              if (p) paths.push(p)
            }
            if (paths.length > 0) onAddPaths(paths)
          }}
        >
          {items.map(it => (
            <div key={it.path} style={{
              display: 'flex', alignItems: 'center', gap: 6, padding: '3px 8px',
              borderRadius: 6, border: '1px solid var(--line)',
              background: 'var(--bg, rgba(28,28,30,0.6))',
            }}>
              <span>{it.kind === 'folder' ? '📁' : '📄'}</span>
              <span
                title={it.path}
                style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, color: 'var(--ink-secondary)' }}
              >
                {it.name}
              </span>
              <span style={{ color: 'var(--ink-faint)', flexShrink: 0 }}>{it.kind === 'folder' ? t('common.folder') : fmtSize(it.size)}</span>
              {it.kind === 'folder' && (
                <span
                  onClick={() => onExpand(it.path)}
                  title={t('feed.tray.expand')}
                  style={{ cursor: 'pointer', color: 'var(--ink-muted)', flexShrink: 0 }}
                >
                  🗂
                </span>
              )}
              <span
                onClick={() => onRemove(it.path)}
                title={t('feed.tray.remove')}
                style={{ cursor: 'pointer', color: 'var(--ink-muted)', flexShrink: 0 }}
              >
                ✕
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
