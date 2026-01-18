const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // --- Server Management ---
  getServers: () => ipcRenderer.invoke('get-servers'),
  addServer: (serverData) => ipcRenderer.invoke('add-server', serverData),
  updateServer: (serverData) => ipcRenderer.invoke('update-server', serverData),
  deleteServer: (data) => ipcRenderer.invoke('delete-server', data),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  openFolder: (path) => ipcRenderer.send('open-folder', path),
  openBackupFolder: (serverId) => ipcRenderer.invoke('open-backup-folder', serverId),
  backupServer: (serverId) => ipcRenderer.invoke('backup-server', serverId),
  installServerJar: (serverId) => ipcRenderer.invoke('install-server-jar', serverId),
  checkJarExists: (serverId) => ipcRenderer.invoke('check-jar-exists', serverId),
  importFromLauncher: (serverId) => ipcRenderer.invoke('import-from-launcher', serverId),
  lookupHytalePlayer: (data) => ipcRenderer.invoke('lookup-hytale-player', data),
  reportPlayer: (serverId, playerId, reason) => ipcRenderer.invoke('report-hytale-player', { serverId, playerId, reason }),
  checkHytaleVersion: (serverId) => ipcRenderer.invoke('check-hytale-version', serverId),
  installViaCli: (serverId) => ipcRenderer.invoke('install-via-cli', serverId),

  // --- TOOL AUTO-SETUP (NEW) ---
  checkCliTool: () => ipcRenderer.invoke('check-cli-tool'),
  downloadCliTool: () => ipcRenderer.invoke('download-cli-tool'),
  selectFile: (filter) => ipcRenderer.invoke('select-file', filter), // New file browser
  checkJavaInstalled: () => ipcRenderer.invoke('check-java-installed'),
  downloadJava: () => ipcRenderer.invoke('download-java'),
  
  // --- NETWORK & PERFORMANCE AUTOMATION ---
  setupFirewall: (port) => ipcRenderer.invoke('setup-firewall', port),
  getPublicIp: () => ipcRenderer.invoke('get-public-ip'),
  checkAotFile: (serverId) => ipcRenderer.invoke('check-aot-file', serverId),
  

  // File Editing
  readFile: (data) => ipcRenderer.invoke('read-file', data),
  saveFile: (data) => ipcRenderer.invoke('save-file', data),


  // --- Server Interaction ---
  startServer: (serverId) => ipcRenderer.send('start-server', serverId),
  stopServer: (serverId) => ipcRenderer.send('stop-server', serverId),
  sendCommand: (data) => ipcRenderer.send('send-command', data),

  // --- Listeners from Main ---
  onServerLog: (callback) => ipcRenderer.on('server-log', (_event, value) => callback(value)),
  onServerStateChange: (callback) => ipcRenderer.on('server-state-change', (_event, value) => callback(value)),
  onToolDownloadStatus: (callback) => ipcRenderer.on('tool-download-status', (_event, value) => callback(value)),