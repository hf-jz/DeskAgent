import { Tray, Menu, nativeImage, app } from 'electron'
import { translate, type Lang } from '../shared/locales'
import { loadSettings } from './settings-store'
const L = (): Lang => loadSettings().language === 'en' ? 'en' : 'zh'
import { join } from 'path'

export function createTray(
  onNewTask: () => void,
  onSettings: () => void,
  petIsVisible: () => boolean,
  showPet: () => void,
  hidePet: () => void,
): Tray {
  // Tray icon: resources/logo.png ships inside the bundle (files/asarUnpack
  // in electron-builder.yml), so it resolves both in dev and packaged builds.
  // JPG has no alpha channel — never use it as a template image (it renders
  // as a solid square). Show the logo as-is in full color.
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'app.asar.unpacked', 'resources', 'logo.png')
    : join(__dirname, '../../resources/logo.png')
  const icon = nativeImage.createFromPath(iconPath)
  const tray = new Tray(icon.resize({ width: 18, height: 18 }))
  tray.setToolTip('DeskApp')

  // 菜单每次右键重建 —— 界面语言切换（Settings > General）后立即跟随，
  // 且暂停/恢复观察状态总是最新
  const buildMenu = (): Electron.Menu => Menu.buildFromTemplate([
    { label: translate(L(), 'tray.newTask'), click: () => onNewTask() },
    {
      label: translate(L(), 'tray.showHide'), click: () => {
        if (petIsVisible()) {
          hidePet()
        } else {
          showPet()
        }
      },
    },
    { type: 'separator' },
    {
      // 习惯工程：暂停/恢复观察。label 动态反映当前状态（B10 持久化后重启仍准确）。
      label: translate(L(), 'tray.pause'),
      click: (menuItem) => {
        try {
          const hs = require('./habit/habit-service')
          const paused = hs.getServiceState().privacyPaused
          hs.setPrivacyPause(!paused)
          menuItem.label = !paused ? translate(L(), 'tray.resume') : translate(L(), 'tray.pause')
        } catch { /* habit engine unavailable */ }
      },
    },
    { label: translate(L(), 'tray.habitPanel'), click: () => onSettings() },
    { label: translate(L(), 'tray.scheduler'), click: () => {
      try { require('./scheduler-window').openSchedulerWindow() } catch { /* scheduler window unavailable */ }
    } },
    { type: 'separator' },
    { label: translate(L(), 'tray.settings'), click: () => onSettings() },
    { type: 'separator' },
    { label: translate(L(), 'tray.quit'), click: () => { app.quit() } },
  ])

  tray.on('click', () => {
    if (petIsVisible()) {
      hidePet()
    } else {
      showPet()
    }
  })
  tray.on('right-click', () => tray?.popUpContextMenu(buildMenu()))

  return tray
}
