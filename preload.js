const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('setup', { init: () => ipcRenderer.invoke('setup:init'), save: (c) => ipcRenderer.invoke('setup:save', c), pick: () => ipcRenderer.invoke('setup:pick') });
