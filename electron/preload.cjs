const { contextBridge, ipcRenderer } = require('electron')
contextBridge.exposeInMainWorld('desktop', {
  youtubeOpen: language => ipcRenderer.invoke('youtube-open', language),
  youtubeClear: () => ipcRenderer.invoke('youtube-clear'),
  state: () => ipcRenderer.invoke('state'),
  chooseFolder: () => ipcRenderer.invoke('choose-folder'),
  savePreferences: value => ipcRenderer.invoke('preferences', value),
  enqueue: url => ipcRenderer.invoke('enqueue', url),
  start: () => ipcRenderer.invoke('start'),
  cancel: id => ipcRenderer.invoke('cancel', id),
  resume: id => ipcRenderer.invoke('resume', id),
  onStorageError: callback => ipcRenderer.on('storage-error', (_event, message) => callback(message)),
  remove: id => ipcRenderer.invoke('remove', id),
  openFolder: () => ipcRenderer.invoke('open-folder'),
  external: url => ipcRenderer.invoke('external', url),
  subscribe: callback => {
    const listener = (_event, value) => callback(value)
    ipcRenderer.on('state-update', listener)
    return () => ipcRenderer.removeListener('state-update', listener)
  },
})
