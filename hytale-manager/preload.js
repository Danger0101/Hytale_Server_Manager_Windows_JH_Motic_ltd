const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // --- Server Management ---
    getServers: () => ipcRenderer.invoke('get-servers'),
    addServer: (server) => ipcRenderer.invoke('add-server', server),
    updateServer: (server) => ipcRenderer.invoke('update-server', server),
    deleteServer: (data) => ipcRenderer.invoke('delete-server', data),
    
    // NEW: Auth Functions
    authStartDeviceFlow: () => ipcRenderer.invoke('auth-start-device-flow'),
    authPollToken: (code) => ipcRenderer.invoke('auth-poll-token', code),
    
    // --- File System ---
    selectDirectory: () => ipcRenderer.invoke('select-directory'),
    selectFile: (filter) => ipcRenderer.invoke('select-file', filter),
    openFolder: (path) => ipcRenderer.send('open-folder', path),
    openBackupFolder: (id) => ipcRenderer.invoke('open-backup-folder', id),
    backupServer: (id) => ipcRenderer.invoke('backup-server', id),
    
    // --- Config & files ---
    readFile: (data) => ipcRenderer.invoke('read-file', data),
    saveFile: (data) => ipcRenderer.invoke('save-file', data),

    // --- Server Control ---
    startServer: (id) => ipcRenderer.send('start-server', id),
    stopServer: (id) => ipcRenderer.send('stop-server', id),
    sendCommand: (data) => ipcRenderer.send('send-command', data),
    
    // --- Installation & Tools ---
    installServerJar: (id) => ipcRenderer.invoke('install-server-jar', id),
    checkJarExists: (id) => ipcRenderer.invoke('check-jar-exists', id),
    importFromLauncher: (id) => ipcRenderer.invoke('import-from-launcher', id),
    
    // Hytale Downloader CLI
    checkCliTool: () => ipcRenderer.invoke('check-cli-tool'),
    downloadCliTool: () => ipcRenderer.invoke('download-cli-tool'),
    installViaCli: (id) => ipcRenderer.invoke('install-via-cli', id),
    
    // Java Management
    checkJavaInstalled: () => ipcRenderer.invoke('check-java-installed'),
    downloadJava: () => ipcRenderer.invoke('download-java'),

    // --- System & Network ---
    getPublicIp: () => ipcRenderer.invoke('get-public-ip'),
    setupFirewall: (port) => ipcRenderer.invoke('setup-firewall', port),
    checkAotFile: (id) => ipcRenderer.invoke('check-aot-file', id),
    checkHytaleVersion: (id) => ipcRenderer.invoke('check-hytale-version', id),

    // --- Hytale Web API ---
    lookupHytalePlayer: (data) => ipcRenderer.invoke('lookup-hytale-player', data),
    reportPlayer: (id, uuid, reason) => ipcRenderer.invoke('report-hytale-player', {serverId: id, playerId: uuid, reason}),

    // --- Listeners (Main -> Renderer) ---
    onServerLog: (callback) => ipcRenderer.on('server-log', (_event, value) => callback(value)),
    onServerStateChange: (callback) => ipcRenderer.on('server-state-change', (_event, value) => callback(value)),
    onAuthNeeded: (callback) => ipcRenderer.on('auth-needed', (_event, value) => callback(value)),
    onToolDownloadStatus: (callback) => ipcRenderer.on('tool-download-status', (_event, value) => callback(value))
});