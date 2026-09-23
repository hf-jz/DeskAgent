"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTray = createTray;
const electron_1 = require("electron");
const path_1 = require("path");
function createTray(onNewTask, onSettings, petIsVisible, showPet, hidePet) {
    // Tray icon: resources/logo.png ships inside the bundle (files/asarUnpack
    // in electron-builder.yml), so it resolves both in dev and packaged builds.
    // JPG has no alpha channel — never use it as a template image (it renders
    // as a solid square). Show the logo as-is in full color.
    const iconPath = electron_1.app.isPackaged
        ? (0, path_1.join)(process.resourcesPath, 'app.asar.unpacked', 'resources', 'logo.png')
        : (0, path_1.join)(__dirname, '../../resources/logo.png');
    const icon = electron_1.nativeImage.createFromPath(iconPath);
    const tray = new electron_1.Tray(icon.resize({ width: 18, height: 18 }));
    tray.setToolTip('DeskApp');
    const contextMenu = electron_1.Menu.buildFromTemplate([
        { label: 'New Task', click: () => onNewTask() },
        {
            label: 'Show/Hide Pet', click: () => {
                if (petIsVisible()) {
                    hidePet();
                }
                else {
                    showPet();
                }
            },
        },
        { type: 'separator' },
        { label: 'Settings...', click: () => onSettings() },
        { type: 'separator' },
        { label: 'Quit', click: () => { electron_1.app.quit(); } },
    ]);
    tray.on('click', () => {
        if (petIsVisible()) {
            hidePet();
        }
        else {
            showPet();
        }
    });
    tray.on('right-click', () => tray?.popUpContextMenu(contextMenu));
    return tray;
}
//# sourceMappingURL=tray.js.map