const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('youtubeConfirmation', {
  layout: height => ipcRenderer.send('youtube-layout', height),
  confirm: () => ipcRenderer.invoke('youtube-confirm'),
  close: () => ipcRenderer.invoke('youtube-close'),
  origin: callback => ipcRenderer.on('youtube-origin', (_event, origin) => callback(origin)),
  failure: callback => ipcRenderer.on('youtube-load-error', callback),
})
