// Create-skill registry (phase-2): skill → templates/exporters.
// `path` values are RELATIVE TO THE USER'S HOME (the templates live in the
// user's own skill repos, not in this app) — resolve them with
// join(homedir(), path) in the main process. See src/main/ipc-handlers.ts.
// ponytail: one hardcoded entry; AutoCLI import appends here later.
export interface CreateTemplate { id: string; label: string; path: string }
export interface CreateElement { kind: string; label: string; snippet: string }
export interface CreateSkill {
  id: string
  name: string
  types: string[]
  templates: CreateTemplate[]
  exportTypes: string[]
  elements?: CreateElement[]
}

export const CREATE_SKILLS: CreateSkill[] = [
  {
    id: 'personal-homepage-skill',
    name: 'Personal Homepage Skill',
    types: ['presentation', 'document'],
    templates: [
      { id: 'presentation-html', label: '16:9 展示 (presentation-html)', path: 'web/personal-homepage-skill/templates/presentation-html/presentation.html' },
      { id: 'single-html', label: '单页 (single-html)', path: 'web/personal-homepage-skill/templates/single-html/personal-homepage.html' },
      { id: 'react-deck', label: 'React 动效版 (react-bits TextType)', path: '' },
    ],
    exportTypes: ['html', 'pdf'],
    // Component elements (react-bits 风格 HTML snippets — editable in the deck).
    elements: [
      { kind: 'cards', label: '卡片网格', snippet: '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px"><div style="border:1px solid rgba(255,255,255,.14);border-radius:10px;padding:16px;background:rgba(255,255,255,.06)"><h3 style="margin:0 0 8px;color:#34d399;font-size:18px">特性一</h3><div style="color:rgba(255,255,255,.65);font-size:13px">描述文字，可直接编辑</div></div><div style="border:1px solid rgba(255,255,255,.14);border-radius:10px;padding:16px;background:rgba(255,255,255,.06)"><h3 style="margin:0 0 8px;color:#34d399;font-size:18px">特性二</h3><div style="color:rgba(255,255,255,.65);font-size:13px">描述文字，可直接编辑</div></div><div style="border:1px solid rgba(255,255,255,.14);border-radius:10px;padding:16px;background:rgba(255,255,255,.06)"><h3 style="margin:0 0 8px;color:#34d399;font-size:18px">特性三</h3><div style="color:rgba(255,255,255,.65);font-size:13px">描述文字，可直接编辑</div></div></div>' },
      { kind: 'stats', label: '统计条', snippet: '<div style="display:flex;gap:16px"><div style="flex:1;text-align:center;border:1px solid rgba(255,255,255,.14);border-radius:10px;padding:18px"><div style="font-size:34px;font-weight:800;color:#34d399">99%</div><div style="color:rgba(255,255,255,.6);font-size:12px">满意度</div></div><div style="flex:1;text-align:center;border:1px solid rgba(255,255,255,.14);border-radius:10px;padding:18px"><div style="font-size:34px;font-weight:800;color:#34d399">10K+</div><div style="color:rgba(255,255,255,.6);font-size:12px">用户</div></div><div style="flex:1;text-align:center;border:1px solid rgba(255,255,255,.14);border-radius:10px;padding:18px"><div style="font-size:34px;font-weight:800;color:#34d399">24/7</div><div style="color:rgba(255,255,255,.6);font-size:12px">在线</div></div></div>' },
      { kind: 'badges', label: '标签条', snippet: '<div style="display:flex;gap:8px;flex-wrap:wrap"><span style="border:1px solid rgba(52,211,153,.4);color:#34d399;border-radius:999px;padding:4px 12px;font-size:12px">标签一</span><span style="border:1px solid rgba(52,211,153,.4);color:#34d399;border-radius:999px;padding:4px 12px;font-size:12px">标签二</span><span style="border:1px solid rgba(52,211,153,.4);color:#34d399;border-radius:999px;padding:4px 12px;font-size:12px">标签三</span><span style="border:1px solid rgba(52,211,153,.4);color:#34d399;border-radius:999px;padding:4px 12px;font-size:12px">标签四</span></div>' },
    ],
  },
]

export function templateById(id?: string): CreateTemplate | undefined {
  return CREATE_SKILLS.flatMap(s => s.templates).find(t => t.id === id)
}
