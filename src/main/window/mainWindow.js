const path = require('path');
const { BrowserWindow, screen } = require('electron');

function createWindow() {
  const isPackaged = require('electron').app.isPackaged;
  const devIcon = path.join(__dirname, '../../public/1.png');
  const prodIcon = path.join(process.resourcesPath || '', 'icon.png');
  const iconPath = isPackaged ? prodIcon : devIcon;

  const { width: sw, height: sh } = screen.getPrimaryDisplay().workAreaSize;
  const minW = Math.round(sw / 2);
  const minH = Math.round(sh / 2);

  const mainWindow = new BrowserWindow({
    width: 1300,
    height: 800,
    minWidth: minW,
    minHeight: minH,
    webPreferences: {
      // __dirname is src/main/window; preload is at src/preload/index.js
      preload: path.join(__dirname, '../../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    autoHideMenuBar: true,
    icon: iconPath,
  });

  try { mainWindow.removeMenu(); } catch {}

  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
    // mainWindow.webContents.openDevTools();
  } else {
    // In production, use our custom protocol registered in bootstrap.js
    mainWindow.loadURL('app://localhost/index.html');
  }
  return mainWindow;
}

module.exports = { createWindow };
