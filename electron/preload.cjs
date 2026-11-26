const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('polarisDesktop', {
  isElectron: true,
  platform: process.platform,
  showItemInFolder: filePath => ipcRenderer.invoke('polaris:show-in-folder', filePath),
  onDownloadDone: callback => {
    if (typeof callback !== 'function') return () => {}
    const listener = (_event, payload) => callback(payload)
    ipcRenderer.on('polaris:download-done', listener)
    return () => ipcRenderer.removeListener('polaris:download-done', listener)
  },
  onOpenSettings: callback => {
    if (typeof callback !== 'function') return () => {}
    const listener = () => callback()
    ipcRenderer.on('polaris:open-settings', listener)
    return () => ipcRenderer.removeListener('polaris:open-settings', listener)
  },
})
