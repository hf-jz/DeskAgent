"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path_1 = require("path");
const fs_1 = require("fs");
// Prevent EPIPE crashes when stdout/stderr are closed (e.g. restart.sh &)
process.stdout.on('error', (err) => { if (err.code === 'EPIPE') { } });
process.stderr.on('error', (err) => { if (err.code === 'EPIPE') { } });
// Global crash guards — a resident desktop app must never die silently.
// crashpad dumps land in userData/Crashes for post-mortem diagnosis.
electron_1.crashReporter.start({ uploadToServer: false, compress: true });
process.on('uncaughtException', (err) => {
    try {
        console.error('[DeskApp] uncaughtException:', err);
    }
    catch { /* EPIPE safe */ }
});
process.on('unhandledRejection', (reason) => {
    try {
        console.error('[DeskApp] unhandledRejection:', reason);
    }
    catch { /* EPIPE safe */ }
});
const pet_window_1 = require("./pet-window");
const hit_window_1 = require("./hit-window");
const drag_handler_1 = require("./drag-handler");
const manager_1 = require("./agents/manager");
const settings_window_1 = require("./settings-window");
const settings_store_1 = require("./settings-store");
const vfs_1 = require("./vfs");
const session_store_1 = require("./session-store");
const agent_stats_1 = require("./agent-stats");
const task_bubble_1 = require("./task-bubble");
const file_explorer_1 = require("./file-explorer");
const desktop_agent_1 = require("./agents/desktop-agent");
const detect_hermes_1 = require("./agents/detect-hermes");
const setup_wizard_1 = require("./setup-wizard");
const ipc_handlers_1 = require("./ipc-handlers");
// tray.ts is require()-loaded to avoid Electron API at module scope
const { createTray: makeTray } = require('./tray');
const builtin_skills_1 = require("./builtin-skills");
const edge_auto_hide_1 = require("./edge-auto-hide");
const isMac = process.platform === 'darwin';
let petWindow = null;
let hitWindow = null;
let dragHandler = null;
let tray = null;
let isQuitting = false;
let agentManager;
const activeAborts = new Map();
let currentSettings;
const gotTheLock = electron_1.app.requestSingleInstanceLock();
if (!gotTheLock) {
    electron_1.app.quit();
}
else {
    electron_1.app.on('second-instance', () => {
        (0, hit_window_1.showPetWindows)(petWindow?.win, hitWindow?.win);
    });
    electron_1.app.whenReady().then(async () => {
        currentSettings = (0, settings_store_1.loadSettings)();
        if ((0, setup_wizard_1.needsSetup)()) {
            const preloadPath = (0, path_1.join)(__dirname, '../preload/index.js');
            (0, setup_wizard_1.createSetupWindow)(preloadPath, () => initApp());
            return;
        }
        initApp();
    });
    electron_1.app.on('before-quit', () => {
        isQuitting = true;
        (0, edge_auto_hide_1.clearEdgeTimers)();
        desktop_agent_1.bridgeManager.shutdownAll();
        detect_hermes_1.hermesGatewayExecutor.shutdown();
    });
    electron_1.app.on('will-quit', () => {
        const lockFile = (0, path_1.join)(electron_1.app.getPath('userData'), 'SingletonLock');
        if ((0, fs_1.existsSync)(lockFile))
            try {
                (0, fs_1.unlinkSync)(lockFile);
            }
            catch { /* ok */ }
    });
    electron_1.app.on('window-all-closed', () => { if (isQuitting)
        electron_1.app.quit(); });
}
function initApp() {
    agentManager = new manager_1.AgentManager(() => { });
    // Initialize infrastructure
    (0, vfs_1.initVfs)(electron_1.app.getPath('userData'));
    (0, session_store_1.initSessionStore)(electron_1.app.getPath('userData'));
    (0, agent_stats_1.initAgentStats)(electron_1.app.getPath('userData'));
    createWindows();
    initTray();
    registerIPC();
    registerShortcuts();
    // Init edge auto-hide
    (0, edge_auto_hide_1.initEdgeAutoHide)(() => petWindow?.win, () => hitWindow);
    // Scan agents
    agentManager.scanAll().then((state) => {
        console.log('[DeskApp] Agent scan:', state.agents.map(a => a.id + ':' + a.status).join(', '));
    });
    // Warm bridge + gateway
    desktop_agent_1.bridgeManager.prewarm();
    detect_hermes_1.hermesGatewayExecutor.prewarm().catch(() => { });
    // Install built-in skills
    (0, builtin_skills_1.installBuiltinSkills)();
}
function createWindows() {
    const size = (0, settings_store_1.getSizePixels)(currentSettings.size);
    const preloadPath = (0, path_1.join)(__dirname, '../preload/index.js');
    petWindow = (0, pet_window_1.createPetWindow)({
        preloadPath,
        loadFilePath: (0, path_1.join)(__dirname, '../renderer/index.html'),
        width: size.width, height: size.height,
        isMac, isLinux: false, isWin: false,
    });
    const display = electron_1.screen.getPrimaryDisplay();
    const { x, y } = display.workArea;
    petWindow.win.setPosition(Math.round(x + (display.workArea.width - size.width) / 2), Math.round(y + (display.workArea.height - size.height) / 2));
    hitWindow = (0, hit_window_1.createHitWindow)({
        preloadPath,
        hitHtmlPath: (0, path_1.join)(__dirname, '../renderer/hit.html'),
        petWindow: petWindow.win,
        isMac, isLinux: false, isWin: false,
    });
    dragHandler = (0, drag_handler_1.createDragHandler)({
        petWindow: petWindow.win,
        hitWindow: hitWindow.win,
        screen: electron_1.screen,
        onDragEnd: (bounds) => (0, edge_auto_hide_1.checkEdgeSnap)(bounds),
    });
}
function doNewTask() {
    if (!petWindow?.win)
        return;
    // Auto-show if hidden at edge
    if ((0, edge_auto_hide_1.getEdgeState)() !== 'visible')
        (0, edge_auto_hide_1.showFromEdge)();
    const win = (0, task_bubble_1.createNewBubble)((0, path_1.join)(__dirname, '../preload/index.js'), petWindow.win.getBounds());
    const wcId = win.webContents.id;
    win.once('closed', () => {
        activeAborts.get(wcId)?.abort();
        activeAborts.delete(wcId);
        desktop_agent_1.bridgeManager.dispose(String(wcId));
    });
    if (hitWindow?.win && !hitWindow.win.isDestroyed()) {
        hitWindow.win.moveTop();
    }
}
function applyPetSize(size) {
    if (!petWindow?.win)
        return;
    const px = (0, settings_store_1.getSizePixels)(size);
    const diameter = Math.min(px.width, px.height);
    petWindow.win.setSize(diameter, diameter);
    if (isMac) {
        petWindow.win.setShape(circleShape(diameter));
    }
    if (hitWindow?.win && !hitWindow.win.isDestroyed()) {
        hitWindow.win.setSize(diameter, diameter);
        hitWindow.win.setPosition(petWindow.win.getBounds().x, petWindow.win.getBounds().y);
    }
}
function circleShape(diameter) {
    const r = diameter / 2;
    const rects = [];
    for (let y = 0; y < diameter; y++) {
        const dy = y - r + 0.5;
        if (Math.abs(dy) >= r)
            continue;
        const chordHalf = Math.sqrt(r * r - dy * dy);
        rects.push({ x: Math.floor(r - chordHalf), y, width: Math.ceil(chordHalf * 2), height: 1 });
    }
    return rects;
}
function registerIPC() {
    const ctx = {
        petWindow, hitWindow, agentManager,
        getSettings: () => currentSettings,
        saveSettings: (s) => { currentSettings = s; (0, settings_store_1.saveSettings)(s); },
        applyPetSize,
        openSettingsWindow: settings_window_1.openSettingsWindow,
        showPetWindows: (pet, hit) => (0, hit_window_1.showPetWindows)(pet, hit),
        doNewTask,
        edgeToggle: edge_auto_hide_1.toggleEdgeHide,
        isQuitting: () => isQuitting,
        setQuitting: (v) => { isQuitting = v; },
        activeAborts,
        getEdgeState: edge_auto_hide_1.getEdgeState,
        showFromEdge: edge_auto_hide_1.showFromEdge,
    };
    (0, ipc_handlers_1.registerAllHandlers)(ctx);
}
function registerShortcuts() {
    electron_1.globalShortcut.register('CommandOrControl+Shift+M', () => doNewTask());
    electron_1.globalShortcut.register('CommandOrControl+Shift+E', () => (0, file_explorer_1.openFileExplorer)((0, path_1.join)(__dirname, '../preload/index.js')));
    electron_1.globalShortcut.register('CommandOrControl+Shift+,', () => (0, settings_window_1.openSettingsWindow)());
    electron_1.globalShortcut.register('CommandOrControl+Shift+H', () => (0, edge_auto_hide_1.toggleEdgeHide)());
}
function initTray() {
    tray = makeTray(doNewTask, settings_window_1.openSettingsWindow, () => petWindow?.win?.isVisible() ?? false, () => (0, hit_window_1.showPetWindows)(petWindow?.win, hitWindow?.win), () => (0, hit_window_1.hidePetWindows)(petWindow?.win, hitWindow?.win));
}
//# sourceMappingURL=index.js.map