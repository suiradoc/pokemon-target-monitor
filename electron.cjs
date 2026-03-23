/**
 * Pokemon Target Monitor — Electron main process.
 * Starts the Express server + monitor, then opens the dashboard in a window.
 */

const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

// Load .env before anything else
require('dotenv').config({ path: path.join(__dirname, '.env') });

const PORT = process.env.PORT || 3000;
let mainWindow = null;

async function startBackend() {
  // Dynamic import for ESM modules
  const { startServer } = await import('./src/web-server.js');
  const { startMonitor } = await import('./src/monitor.js');
  startServer(PORT);
  startMonitor();
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: 'Pokemon Target Monitor',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Remove the menu bar entirely
  Menu.setApplicationMenu(null);

  // Wait a moment for the server to start, then load
  const loadDashboard = () => {
    mainWindow.loadURL(`http://localhost:${PORT}`).catch(() => {
      // Server not ready yet, retry
      setTimeout(loadDashboard, 500);
    });
  };
  setTimeout(loadDashboard, 1000);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  await startBackend();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  app.quit();
});
