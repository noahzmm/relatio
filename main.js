const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const os = require('os');

const projectsDir = () => path.join(app.getPath('userData'), 'projects');
const ID_RE = /^[a-z0-9-]{4,64}$/i;

function projectFile(id) {
  if (!ID_RE.test(String(id))) throw new Error('Ungültige Projekt-ID');
  return path.join(projectsDir(), `${id}.json`);
}

async function ensureDir() {
  await fs.mkdir(projectsDir(), { recursive: true });
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 880,
    minWidth: 1000,
    minHeight: 660,
    title: 'Relatio',
    backgroundColor: '#F1F2F4',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#F1F2F4', symbolColor: '#1C1C1E', height: 38 },
    show: false,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.removeMenu();
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  // Externe Links nie im App-Fenster öffnen
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  if (process.argv.includes('--devtools')) mainWindow.webContents.openDevTools({ mode: 'detach' });
}

// ---------- Projekte ----------
ipcMain.handle('projects:list', async () => {
  await ensureDir();
  const files = (await fs.readdir(projectsDir())).filter((f) => f.endsWith('.json'));
  const out = [];
  for (const f of files) {
    try {
      const p = JSON.parse(await fs.readFile(path.join(projectsDir(), f), 'utf8'));
      if (p && typeof p === 'object' && ID_RE.test(String(p.id))) out.push(p);
    } catch {
      /* defekte Datei überspringen */
    }
  }
  return out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
});

ipcMain.handle('projects:load', async (_e, id) => {
  return JSON.parse(await fs.readFile(projectFile(id), 'utf8'));
});

// Schreibvorgänge nacheinander ausführen: zwei gleichzeitige Speicherungen desselben Projekts
// würden sich sonst die .tmp-Datei teilen. Beim Beenden wird auf die Warteschlange gewartet.
let writeQueue = Promise.resolve();
ipcMain.handle('projects:save', (_e, project) => {
  const file = projectFile(project && project.id);
  const data = JSON.stringify(project, null, 2);
  const job = writeQueue.then(async () => {
    await ensureDir();
    const tmp = `${file}.tmp`;
    await fs.writeFile(tmp, data, 'utf8');
    await fs.rename(tmp, file);
    return true;
  });
  writeQueue = job.catch(() => {});
  return job;
});

ipcMain.handle('projects:delete', async (_e, id) => {
  const file = projectFile(id);
  try {
    await shell.trashItem(file); // in den Papierkorb, nicht endgültig
  } catch {
    await fs.unlink(file);
  }
  return true;
});

ipcMain.handle('projects:exportFile', async (_e, project) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Projekt speichern unter',
    defaultPath: `${safeName(project.name)}.relatio`,
    filters: [{ name: 'Relatio-Projekt', extensions: ['relatio'] }],
  });
  if (canceled || !filePath) return null;
  await fs.writeFile(filePath, JSON.stringify(project, null, 2), 'utf8');
  return filePath;
});

ipcMain.handle('projects:importFile', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Projekt importieren',
    filters: [{ name: 'Relatio-Projekt', extensions: ['relatio', 'json'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths[0]) return null;
  return JSON.parse(await fs.readFile(filePaths[0], 'utf8'));
});

ipcMain.handle('app:openProjectsFolder', async () => {
  await ensureDir();
  return shell.openPath(projectsDir());
});

ipcMain.handle('app:userName', () => {
  try {
    return os.userInfo().username;
  } catch {
    return '';
  }
});

ipcMain.handle('app:openPath', (_e, p) => shell.openPath(String(p)));

// ---------- PDF-Export ----------
function safeName(name) {
  return (String(name || 'Diagramm').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Diagramm').slice(0, 80);
}

ipcMain.handle('file:saveText', async (_e, { name, content, filter }) => {
  const ext = path.extname(String(name)) || '.txt';
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Speichern unter',
    defaultPath: safeName(path.basename(String(name), ext)) + ext,
    filters: filter ? [{ name: String(filter.name), extensions: filter.extensions.map(String) }] : [],
  });
  if (canceled || !filePath) return null;
  await fs.writeFile(filePath, String(content), 'utf8');
  return filePath;
});

ipcMain.handle('pdf:export', async (_e, payload) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Als PDF exportieren',
    defaultPath: `${safeName(payload.title)}.pdf`,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  });
  if (canceled || !filePath) return null;
  const data = await renderPdf(payload);
  await fs.writeFile(filePath, data);
  return filePath;
});

async function renderPdf(payload) {
  const win = new BrowserWindow({
    show: false,
    width: 1200,
    height: 900,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  try {
    await win.loadFile(path.join(__dirname, 'renderer', 'export.html'));
    const size = await win.webContents.executeJavaScript(`window.renderExport(${JSON.stringify(payload)})`);
    return await win.webContents.printToPDF({
      printBackground: true,
      pageSize: { width: size.width / 96, height: size.height / 96 },
      margins: { top: 0, bottom: 0, left: 0, right: 0 },
      preferCSSPageSize: true,
    });
  } finally {
    win.destroy();
  }
}

module.exports = { renderPdf };

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', async () => {
  if (process.platform === 'darwin') return;
  // die letzte Speicherung (wird beim Schließen des Fensters ausgelöst) noch abschließen
  await new Promise((r) => setTimeout(r, 150));
  await writeQueue;
  app.quit();
});
