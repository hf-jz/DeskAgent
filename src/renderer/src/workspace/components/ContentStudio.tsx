// ── ContentStudio: 办公创作设计界面 (wenxibuddy 液态毛玻璃) ──
// 气泡里说目的 → agent 创建 presentation/brochure/manual/video/homepage spec
// → 卡片/工作区渲染本组件: 素材文件夹 + 风格预设 + 输出目录 → 生成按钮 → run
// → agent 加载 personal-homepage-skill 等技能生成成品 → 打开成品。
import React, { useMemo, useRef, useState } from 'react'
import { t } from '../../lib/i18n'
import { motion, AnimatePresence } from 'framer-motion'
import { FolderOpen, Wand2, Play, Square, ExternalLink, Sparkles, ChevronRight } from 'lucide-react'
import type { WindowSpec, SpecStatus } from '../../../../shared/gen-ui-types'

const G = 'Plus Jakarta Sans, PingFang SC, -apple-system, BlinkMacSystemFont, sans-serif'

// ── Kind 元数据: 图标 / 名称 / 生成 prompt 模板 ({{prop}} 运行时填充) ──
export interface StudioKindMeta {
  icon: string
  label: string
  hint: string
  outputExt: string
  defaultOutput: string
  /** 供 agent 生成的 prompt 模板 — 变量会被 props 填充 */
  prompt: (p: { source: string; title: string; style: string; extra: string; output: string }) => string
}

export const STUDIO_KINDS = (): Record<string, StudioKindMeta> => ({
  presentation: {
    icon: '📽️', label: t('cs.deck'), outputExt: 'deck.html', defaultOutput: '~/Desktop/成品/演示文稿',
    hint: t('cs.deckHint'),
    prompt: ({ source, title, style, extra, output }) =>
      `根据素材文件夹「${source}」中的所有内容，制作一份 16:9 的 HTML 演示文稿（PPT），主题「${title}」。\n` +
      `1. 先 skill_view('personal-homepage-skill') 加载技能，按其 Presentation Mode 工作流执行（16:9 1920×1080 舞台，见 PRESENTATION_WORKFLOW.md）。\n` +
      `2. 遍历素材文件夹，提取全部文档/图片/数据内容做信息架构，不要编造数据。\n` +
      `3. 视觉风格使用 STYLE_PRESETS.md 中的「${style}」预设，中文排版用 CJK 字体栈。\n` +
      (extra ? `4. 章节结构要求：${extra}\n` : '') +
      `5. 生成单文件成品保存为「${output}」（目录不存在则创建），随后在浏览器打开验证渲染。\n` +
      `6. 回复 JSON：{"file":"成品绝对路径","slides":页数,"style":"${style}"}`,
  },
  brochure: {
    icon: '📕', label: t('cs.brochure'), outputExt: 'index.html', defaultOutput: '~/Desktop/成品/产品画册',
    hint: t('cs.brochureHint'),
    prompt: ({ source, title, style, extra, output }) =>
      `根据素材文件夹「${source}」中的所有内容，制作一份 HTML 产品宣传册/画册，主题「${title}」。\n` +
      `1. 先 skill_view('personal-homepage-skill') 加载技能，按其 Homepage Mode 工作流执行（响应式连续滚动页）。\n` +
      `2. 遍历素材文件夹提取产品卖点、参数、图片、案例；信息架构参考 HOMEPAGE_SECTIONS.md。\n` +
      `3. 视觉风格使用 STYLE_PRESETS.md 中的「${style}」预设，中文排版用 CJK 字体栈。\n` +
      (extra ? `4. 页面结构要求：${extra}\n` : '') +
      `5. 生成单文件成品保存为「${output}」（目录不存在则创建），随后在浏览器打开验证渲染。\n` +
      `6. 回复 JSON：{"file":"成品绝对路径","sections":章节数,"style":"${style}"}`,
  },
  manual: {
    icon: '📘', label: t('cs.doc'), outputExt: t('cs.docExt'), defaultOutput: '~/Desktop/成品/产品手册',
    hint: t('cs.docHint'),
    prompt: ({ source, title, style, extra, output }) =>
      `根据素材文件夹「${source}」中的所有内容，编写一份产品手册，主题「${title}」。\n` +
      `1. 先 skill_view('docx') 加载技能，用 python-docx 生成 .docx 文档。\n` +
      `2. 遍历素材文件夹提取产品概述、技术规格、使用说明、FAQ；结构清晰、层级正确（Heading 1/2/3）。\n` +
      (extra ? `3. 章节要求：${extra}\n` : '') +
      `4. 保存为「${output}」（目录不存在则创建，扩展名 .docx）。\n` +
      `5. 回复 JSON：{"file":"成品绝对路径","pages":估计页数}`,
  },
  video: {
    icon: '🎬', label: t('cs.video'), outputExt: 'promo.mp4', defaultOutput: '~/Desktop/成品/宣传动画',
    hint: t('cs.videoHint'),
    prompt: ({ source, title, style, extra, output }) =>
      `根据素材文件夹「${source}」中的所有内容，制作一部宣传动画视频，主题「${title}」。\n` +
      `1. 先 skill_view('hyperframes') 加载技能，按其工作流用 npx hyperframes 生成 MP4（见 hyperframes-core / general-video）。\n` +
      `2. 遍历素材文件夹提取文案与视觉素材；脚本先写旁白/分镜再合成。\n` +
      `3. 视觉风格：${style}${extra ? `；额外要求：${extra}` : ''}。\n` +
      `4. 输出 MP4 到「${output}」（目录不存在则创建）。\n` +
      `5. 回复 JSON：{"file":"成品绝对路径","duration":秒数}`,
  },
  homepage: {
    icon: '🏠', label: t('cs.home'), outputExt: 'index.html', defaultOutput: '~/Desktop/成品/展示主页',
    hint: t('cs.homeHint'),
    prompt: ({ source, title, style, extra, output }) =>
      `根据素材文件夹「${source}」中的所有内容，制作一份展示主页/作品集，主题「${title}」。\n` +
      `1. 先 skill_view('personal-homepage-skill') 加载技能，按其 Homepage Mode 工作流执行。\n` +
      `2. 遍历素材文件夹提取身份信息、项目、技能、成果；信息架构参考 HOMEPAGE_SECTIONS.md。\n` +
      `3. 视觉风格使用 STYLE_PRESETS.md 中的「${style}」预设，中文排版用 CJK 字体栈。\n` +
      (extra ? `4. 结构要求：${extra}\n` : '') +
      `5. 生成单文件成品保存为「${output}」（目录不存在则创建），随后在浏览器打开验证渲染。\n` +
      `6. 回复 JSON：{"file":"成品绝对路径","sections":章节数,"style":"${style}"}`,
  },
})

// ── 风格预设 (personal-homepage-skill STYLE_PRESETS.md) ──
export const STYLE_PRESETS = [
  'Cinematic Scroll Personal Brand', 'Clean Developer Homepage', '3D Tech Portfolio',
  'Motion Gradient Brand', 'Magazine Portfolio', 'Terminal Hacker Homepage',
  'Minimal Premium Resume', 'Cute Pixel Creator', 'AI System Dashboard',
  'Creator Bento Homepage', 'Dark Editorial Portfolio', 'Art Museum Portfolio',
  'Spatial Project Gallery', 'Business Personal Brand', 'Case Study Portfolio',
  'Soft Product Video Hero', 'Orbis NFT Space Landing', 'TOONHUB Figurine Carousel',
] as const

const PRESET_EMOJI: Record<string, string> = {
  'Cinematic Scroll Personal Brand': '🎬', 'Clean Developer Homepage': '💻',
  '3D Tech Portfolio': '🧊', 'Motion Gradient Brand': '🌈', 'Magazine Portfolio': '📰',
  'Terminal Hacker Homepage': '🖥️', 'Minimal Premium Resume': '🤍', 'Cute Pixel Creator': '👾',
  'AI System Dashboard': '🤖', 'Creator Bento Homepage': '🍱', 'Dark Editorial Portfolio': '🖤',
  'Art Museum Portfolio': '🖼️', 'Spatial Project Gallery': '🌌', 'Business Personal Brand': '💼',
  'Case Study Portfolio': '📋', 'Soft Product Video Hero': '🎥', 'Orbis NFT Space Landing': '🪐',
  'TOONHUB Figurine Carousel': '🎠',
}

// ── props 默认值 (未配置时) ──
const KIND_DEFAULT_STYLE: Record<string, string> = {
  presentation: 'Cinematic Scroll Personal Brand', brochure: 'Business Personal Brand',
  manual: 'Minimal Premium Resume', video: 'Motion Gradient Brand', homepage: '3D Tech Portfolio',
}

interface StudioProps {
  spec: WindowSpec
  status?: SpecStatus
}

export default function ContentStudio({ spec, status }: StudioProps) {
  const meta = STUDIO_KINDS()[spec.kind] || STUDIO_KINDS().presentation
  const [source, setSource] = useState<string>(String(spec.props?.source || ''))
  const [title, setTitle] = useState<string>(String(spec.props?.title || spec.title || ''))
  const [style, setStyle] = useState<string>(String(spec.props?.style || KIND_DEFAULT_STYLE[spec.kind] || STYLE_PRESETS[0]))
  const [extra, setExtra] = useState<string>(String(spec.props?.extra || ''))
  const [output, setOutput] = useState<string>(String(spec.props?.output || meta.defaultOutput))
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const running = status?.status === 'running'
  const history: { title: string; content: string; ts: number }[] = Array.isArray(spec.props?.history) ? spec.props.history : []

  // 从历史结果里提取 agent 回复的成品路径 (JSON file 字段)
  const lastArtifact = useMemo(() => {
    const last = [...history].reverse()[0]
    if (!last) return ''
    const m = last.content?.match(/"file"\s*:\s*"([^"]+)"/)
    return m?.[1] || ''
  }, [history])

  const save = (next: Record<string, unknown>) =>
    window.deskAppAPI?.genui?.saveSpec?.({ ...spec, props: { ...spec.props, ...next } })

  const run = () => {
    save({ source, title, style, extra, output })
    window.deskAppAPI?.genui?.runSpec?.(spec.id)
  }
  const stop = () => window.deskAppAPI?.genui?.stopSpec?.(spec.id)

  // 文件夹拖入 → 路径文本 (composer 同款 webkitGetAsEntry 模式)
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    const p = (window.deskAppAPI as any)?.getFilePath?.(file)
    if (p) setSource(String(p))
  }

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      style={{
        width: '100%', height: '100%', boxSizing: 'border-box', fontFamily: G,
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        borderRadius: 20, border: dragging ? '1px dashed rgba(52,211,153,0.7)' : '1px solid rgba(167,243,208,0.28)',
        background: 'linear-gradient(165deg, rgba(255,255,255,0.09) 0%, rgba(255,255,255,0.03) 40%, rgba(255,255,255,0.015) 70%, rgba(8,32,24,0.55) 100%)',
        backdropFilter: 'blur(30px)', WebkitBackdropFilter: 'blur(30px)',
        boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.35), 0 20px 40px rgba(0,0,0,0.45)',
      }}
    >
      {/* Header: kind icon + label + status */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 14px 8px' }}>
        {/* macOS traffic lights — 与 WindowCard 一致的卡片窗口操作 */}
        <div data-ntd onClick={e => e.stopPropagation()} style={{ display: 'flex', gap: 7, marginRight: 2, WebkitAppRegion: 'no-drag' as any }}>
          <span data-ntd onClick={(e) => { e.stopPropagation(); (window.deskAppAPI as any)?.cardCloseAndStop?.() }}
            title={t('wc.closeDel')}
            style={{ width: 11, height: 11, borderRadius: '50%', background: '#ff5f57', cursor: 'pointer', border: '1px solid rgba(0,0,0,0.25)', flexShrink: 0 }} />
          <span data-ntd onClick={(e) => { e.stopPropagation(); (window.deskAppAPI as any)?.cardMinimize?.() }}
            title={t('wc.minimizeRoll')}
            style={{ width: 11, height: 11, borderRadius: '50%', background: '#febc2e', cursor: 'pointer', border: '1px solid rgba(0,0,0,0.25)', flexShrink: 0 }} />
        </div>
        <span style={{ fontSize: 16 }}>{meta.icon}</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#fff', letterSpacing: -0.2 }}>{meta.label}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, fontSize: 10, color: running ? '#34d399' : 'rgba(255,255,255,0.4)' }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: running ? '#34d399' : 'rgba(255,255,255,0.25)', boxShadow: running ? '0 0 8px #34d399' : 'none' }} />
          {running ? t('cs.generating') : status?.status === 'ok' ? t('cs.done') : status?.status === 'error' ? t('cs.failed') : t('cs.ready')}
        </span>
      </div>
      <div style={{ padding: '0 14px 8px', fontSize: 10, color: 'rgba(255,255,255,0.45)', lineHeight: 1.5 }}>{meta.hint}</div>

      {/* Form */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '2px 14px 10px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* 素材文件夹 */}
        <Field label={t('cs.field.assets')} hint={t('cs.field.assetsHint')}>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 6 }}>
            <FolderOpen size={13} style={{ position: 'absolute', left: 9, color: 'rgba(52,211,153,0.8)', pointerEvents: 'none' }} />
            <input ref={inputRef} value={source} onChange={e => setSource(e.target.value)}
              placeholder={t('cs.assetsPlaceholder')}
              data-ntd
              style={inputStyle} />
          </div>
          {dragging && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: 12, background: 'rgba(52,211,153,0.12)', border: '1px dashed #34d399', fontSize: 12, color: '#6ee7b7', pointerEvents: 'none', zIndex: 5 }}>
              <Sparkles size={13} style={{ marginRight: 6 }} /> {t('cs.dropToUse')}
            </div>
          )}
        </Field>

        {/* 标题 */}
        <Field label={t('cs.field.title')}>
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder={t('cs.titlePlaceholder')} data-ntd style={inputStyle} />
        </Field>

        {/* 风格预设 */}
        <Field label={t('cs.field.style')} hint={t('cs.field.styleHint')}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {STYLE_PRESETS.map(s => {
              const active = style === s
              return (
                <button key={s} data-ntd onClick={() => setStyle(s)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4, padding: '4px 9px', borderRadius: 999,
                    fontSize: 10, cursor: 'pointer', fontFamily: G, whiteSpace: 'nowrap',
                    color: active ? '#052e22' : 'rgba(255,255,255,0.65)',
                    background: active ? 'linear-gradient(135deg, #6ee7b7, #34d399)' : 'rgba(255,255,255,0.06)',
                    border: active ? '1px solid rgba(110,231,183,0.6)' : '1px solid rgba(255,255,255,0.12)',
                    boxShadow: active ? '0 0 12px rgba(52,211,153,0.35)' : 'none',
                    transition: 'all 0.15s',
                  }}
                >
                  <span>{PRESET_EMOJI[s] || '✦'}</span>{s.replace(' Personal Brand', '').replace(' Homepage', '')}
                </button>
              )
            })}
          </div>
        </Field>

        {/* 结构要求 */}
        <Field label={t('cs.field.structure')} hint={t('cs.field.structureHint')}>
          <textarea value={extra} onChange={e => setExtra(e.target.value)} rows={2} data-ntd
            placeholder={t('cs.structurePlaceholder')}
            style={{ ...inputStyle, resize: 'none', height: 44 }} />
        </Field>

        {/* 输出 */}
        <Field label={t('cs.field.output')}>
          <input value={output} onChange={e => setOutput(e.target.value)} data-ntd style={inputStyle} />
        </Field>

        {/* 最近成品 */}
        {lastArtifact && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '7px 10px', borderRadius: 10, background: 'rgba(52,211,153,0.10)', border: '1px solid rgba(52,211,153,0.30)' }}>
            <span style={{ fontSize: 12, color: '#34d399' }}>✅</span>
            <span style={{ flex: 1, minWidth: 0, fontSize: 10.5, color: 'rgba(255,255,255,0.75)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{lastArtifact}</span>
            <button data-ntd onClick={() => window.deskAppAPI?.genui?.openPath?.(lastArtifact)}
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 9px', borderRadius: 999, fontSize: 10, cursor: 'pointer', color: '#052e22', background: 'linear-gradient(135deg, #6ee7b7, #34d399)', border: 'none', fontWeight: 700, fontFamily: G }}>
              <ExternalLink size={10} /> {t('cs.openOutput')}
            </button>
          </div>
        )}
      </div>

      {/* Footer: 生成 / 停止 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px 12px' }}>
        <motion.button data-ntd onClick={running ? stop : run} whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.96 }}
          style={{
            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
            padding: '10px 0', borderRadius: 12, cursor: 'pointer', fontFamily: G, fontWeight: 800, fontSize: 12.5,
            color: running ? '#fb923c' : '#052e22',
            background: running ? 'rgba(251,146,60,0.16)' : 'linear-gradient(135deg, #6ee7b7, #34d399)',
            border: running ? '1px solid rgba(251,146,60,0.5)' : '1px solid rgba(110,231,183,0.6)',
            boxShadow: running ? 'none' : '0 0 24px rgba(52,211,153,0.35)',
          }}>
          {running ? <><Square size={13} /> {t('cs.stop')}</> : <><Wand2 size={14} /> {t('cs.generate')}</>}
        </motion.button>
        <button data-ntd onClick={() => window.deskAppAPI?.genui?.focusSpec?.(spec.id)}
          title={t('cs.viewWorkspace')}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', width: 38, height: 38, borderRadius: 12,
            cursor: 'pointer', color: 'rgba(255,255,255,0.6)', background: 'rgba(255,255,255,0.06)',
            border: '1px solid rgba(255,255,255,0.12)', fontFamily: G,
          }}>
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  )
}

// ── 表单片段 ──
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ position: 'relative' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 5 }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: 'rgba(255,255,255,0.85)' }}>{label}</span>
        {hint && <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.35)' }}>{hint}</span>}
      </div>
      {children}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%', boxSizing: 'border-box', padding: '8px 10px 8px 28px',
  background: 'rgba(0,0,0,0.35)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 10,
  color: 'rgba(255,255,255,0.92)', fontSize: 11.5, outline: 'none', fontFamily: G,
  transition: 'border-color 0.15s',
}
