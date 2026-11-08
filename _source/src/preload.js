/* The only desktop abilities the page gets. It has no direct access to Node or the disk. */
'use strict';
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('podiumNative', {
  pickOpen: () => ipcRenderer.invoke('file:pick-open'),
  pickSave: suggested => ipcRenderer.invoke('file:pick-save', suggested),
  readFile: file => ipcRenderer.invoke('file:read', file),
  writeFile: (file, bytes) => ipcRenderer.invoke('file:write', file, bytes),
  pathForFile: file => webUtils.getPathForFile(file),
  onOpenFile: callback => { ipcRenderer.on('open-file', (_e, file) => callback(file)); },
  ready: () => ipcRenderer.send('renderer-ready'),
  pickPdf: suggested => ipcRenderer.invoke('pdf:pick', suggested),
  printPdf: () => ipcRenderer.invoke('pdf:print'),
  prepareShow: () => ipcRenderer.invoke('show:prepare'),
});
