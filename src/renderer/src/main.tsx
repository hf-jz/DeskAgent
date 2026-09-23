import React from 'react'
import ReactDOM from 'react-dom/client'
import PetApp from './pet/PetApp'
import SettingsApp from './settings/SettingsApp'
import BubbleApp from './bubble/BubbleApp'
import FileExplorer from './file-explorer/FileExplorer'
import WorkspaceApp from './workspace/WorkspaceApp'
import DockApp from './workspace/DockApp'
import CardApp from './card/CardApp'
import DetailApp from './detail/DetailApp'
import CreateApp from './create/CreateApp'
import PetCustomizerApp from './pet-customizer/PetCustomizerApp'
import SchedulerApp from './scheduler/SchedulerApp'
import Img2ThreeJsApp from './img2threejs/Img2ThreeJsApp'
import { ErrorBoundary } from './components/ErrorBoundary'
import { applyTheme, getTheme, setTheme } from './lib/theme'
import { setLang } from './lib/i18n'
import './assets/theme.css'

const params = new URLSearchParams(window.location.search)
const page = params.get('page') || 'pet'
// PROBE: page console is not forwarded — use the IPC log channel instead.
window.deskAppAPI?.genui?.log?.(`[page] booted page=${page}`)

// Set data-page on root for CSS targeting
const root = document.getElementById('root')
if (root) root.setAttribute('data-page', page)
document.body.dataset.page = page
document.documentElement.dataset.page = page

// P0-10: theme — the pre-paint inline script already applied localStorage;
// here we sync the authoritative value from main-process settings and react
// to live changes from the settings window. Same channel drives i18n language.
applyTheme(getTheme())
window.deskAppAPI?.getSettings?.().then((s) => {
  if (s?.theme) { setTheme(s.theme); applyTheme(s.theme) }
  if (s?.language) setLang(s.language)
}).catch(() => { /* settings unavailable */ })
window.deskAppAPI?.onSettingsChanged?.((s) => {
  if (s?.theme) { setTheme(s.theme); applyTheme(s.theme) }
  if (s?.language) setLang(s.language)
})

ReactDOM.createRoot(root!).render(
  <React.StrictMode>
    <ErrorBoundary>
      {page === 'settings' ? <SettingsApp /> :
       page === 'bubble' ? <BubbleApp /> :
       page === 'fexplorer' ? <FileExplorer /> :
       page === 'workspace' ? <WorkspaceApp /> :
       page === 'dock' ? <DockApp /> :
       page === 'card' ? <CardApp /> :
       page === 'detail' ? <DetailApp /> :
       page === 'create' ? <CreateApp /> :
       page === 'pet-customizer' ? <PetCustomizerApp /> :
       page === 'scheduler' ? <SchedulerApp /> :
       page === 'img2threejs' ? <Img2ThreeJsApp /> :
       <PetApp />}
    </ErrorBoundary>
  </React.StrictMode>
)
