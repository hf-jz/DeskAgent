import { useState } from 'react'
import { t, useLang } from '../lib/i18n'
import AgentsTab from './AgentsTab'
import UpdateBanner from './UpdateBanner'
import AppearanceTab from './AppearanceTab'
import LLMTab from './LLMTab'
import ShortcutsTab from './ShortcutsTab'
import ScreenTab from './ScreenTab'
import SkillsTab from './SkillsTab'
import ActivityTab from './ActivityTab'
import SessionsTab from './SessionsTab'
import SecurityTab from './SecurityTab'
import MemoryTab from './MemoryTab'
import CronTab from './CronTab'
import GeneralTab from './GeneralTab'
import HabitPanel from '../habit/HabitPanel'

type TabId = 'general' | 'skills' | 'activity' | 'sessions' | 'agents' | 'habit' | 'appearance' | 'llm' | 'security' | 'memory' | 'cron' | 'screen' | 'shortcuts'

const TABS = (): { id: TabId; label: string }[] => [
  { id: 'general', label: t('settings.tab.general') },
  { id: 'skills', label: t('settings.tab.skills') },
  { id: 'activity', label: t('settings.tab.activity') },
  { id: 'sessions', label: t('settings.tab.sessions') },
  { id: 'agents', label: t('settings.tab.agents') },
  { id: 'habit', label: t('settings.tab.habits') },
  { id: 'appearance', label: t('settings.tab.appearance') },
  { id: 'llm', label: t('settings.tab.llm') },
  { id: 'security', label: t('settings.tab.security') },
  { id: 'memory', label: t('settings.tab.memory') },
  { id: 'cron', label: t('settings.tab.cron') },
  { id: 'screen', label: t('settings.tab.screen') },
  { id: 'shortcuts', label: t('settings.tab.shortcuts') },
]

export default function SettingsApp(): React.JSX.Element {
  const { t } = useLang()  // 订阅语言变化：切换后整个设置窗口即时刷新
  const [activeTab, setActiveTab] = useState<TabId>('general')

  return (
    <div style={{ display: 'flex', height: '100vh', background: '#000000', color: 'var(--ink-secondary, rgba(255,255,255,0.68))' }}>
      <div style={{
        width: '148px', flexShrink: 0, display: 'flex', flexDirection: 'column',
        padding: '20px 0', gap: '2px',
        background: 'var(--bg-panel, rgba(12,16,28,0.35))',
        borderRight: '1px solid var(--line, rgba(255,255,255,0.07))',
      }}>
        <div style={{
          padding: '0 16px 16px',
          fontSize: '13px',
          fontWeight: 700,
          color: 'var(--ink)',
          letterSpacing: '0.5px'
        }}>
          DeskApp Settings
        </div>
        {TABS().map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              background: activeTab === tab.id ? 'var(--solid)' : 'transparent',
              border: 'none',
              color: activeTab === tab.id ? 'var(--ink)' : 'var(--ink-secondary)',
              padding: '8px 16px',
              fontSize: '13px',
              textAlign: 'left',
              cursor: 'pointer',
              fontFamily: 'inherit',
              borderRadius: '0 6px 6px 0',
              margin: '0 8px 2px 0',
              transition: 'all 0.15s ease'
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* HabitPanel 自带滚动区——嵌入时外层取消 padding/scroll，避免双层滚动条 */}
      <div style={activeTab === 'habit' ? {
        flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden',
      } : {
        flex: 1,
        padding: '24px 32px',
        overflowY: 'auto'
      }}>
        {/* D1 #44: update banner — pinned above tab content */}
        <UpdateBanner />
        {activeTab === 'skills' && <SkillsTab />}
        {activeTab === 'activity' && <ActivityTab />}
        {activeTab === 'sessions' && <SessionsTab onSelect={(sid) => window.deskAppAPI.openSession(sid)} />}
        {activeTab === 'agents' && <AgentsTab />}
        {activeTab === 'habit' && <HabitPanel />}
        {activeTab === 'appearance' && <AppearanceTab />}
        {activeTab === 'llm' && <LLMTab />}
        {activeTab === 'security' && <SecurityTab />}
        {activeTab === 'memory' && <MemoryTab />}
        {activeTab === 'cron' && <CronTab />}
        {activeTab === 'screen' && <ScreenTab />}
        {activeTab === 'shortcuts' && <ShortcutsTab />}
        {activeTab === 'general' && <GeneralTab />}
      </div>
    </div>
  )
}
