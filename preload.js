const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  list: () => ipcRenderer.invoke('projects:list'),
  load: (id) => ipcRenderer.invoke('projects:load', id),
  save: (project) => ipcRenderer.invoke('projects:save', project),
  remove: (id) => ipcRenderer.invoke('projects:delete', id),
  exportFile: (project) => ipcRenderer.invoke('projects:exportFile', project),
  importFile: () => ipcRenderer.invoke('projects:importFile'),
  exportPdf: (payload) => ipcRenderer.invoke('pdf:export', payload),
  openProjectsFolder: () => ipcRenderer.invoke('app:openProjectsFolder'),
  openPath: (p) => ipcRenderer.invoke('app:openPath', p),
  userName: () => ipcRenderer.invoke('app:userName'),
});
