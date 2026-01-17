const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // --- Server Management ---
  getServers: () => ipcRenderer.invoke('get-servers'),
  addServer: (serverData) => ipcRenderer.invoke('add-server', serverData),
  updateServer: (serverData) => ipcRenderer.invoke('update-server', serverData),
  deleteServer: (serverId) => ipcRenderer.invoke('delete-server', serverId),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  openFolder: (path) => ipcRenderer.send('open-folder', path),


  // --- Server Interaction ---
  startServer: (serverId) => ipcRenderer.send('start-server', serverId),
  stopServer: (serverId) => ipcRenderer.send('stop-server', serverId),
  sendCommand: (serverId, command) => ipcRenderer.send('send-command', serverId, command),

  // --- Listeners from Main ---
  onServerLog: (callback) => ipcRenderer.on('server-log', (_event, value) => callback(value)),
  onServerStateChange: (callback) => ipcRenderer.on('server-state-change', (_event, value) => callback(value)),
});