const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const { spawn } = require('child_process');

// --- Add this helper function at the very top of main.js ---
function getJavaExecutable(serverConfig) {
    // 1. If user manually typed a path in settings, use that
    if (serverConfig.javaPath && serverConfig.javaPath.trim() !== "") {
        return serverConfig.javaPath;
    }

    // 2. Otherwise, look for the 'jre' folder inside the app
    const bundledPath = path.join(__dirname, 'jre', 'bin', 'java.exe');
    
    // Check if it exists
    try {
        // We use 'require' here to check file existence synchronously
        require('fs').accessSync(bundledPath);
        console.log('[Manager] Using bundled Java at:', bundledPath);
        return bundledPath;
    } catch (e) {
        // 3. Fallback: If bundled Java is missing, try global 'java'
        console.log('[Manager] Bundled Java not found. Falling back to global "java" command.');
        return 'java'; 
    }
}

const SERVERS_CONFIG_PATH = path.join(app.getPath('userData'), 'servers.json');
const runningServers = new Map();
let mainWindow;

async function readServersConfig() {
    try {
        await fs.access(SERVERS_CONFIG_PATH);
    } catch (error) {
        // If file doesn't exist, create it with an empty array
        await fs.writeFile(SERVERS_CONFIG_PATH, JSON.stringify([], null, 2));
    }
    const fileContent = await fs.readFile(SERVERS_CONFIG_PATH, 'utf-8');
    return JSON.parse(fileContent);
}

async function writeServersConfig(servers) {
    await fs.writeFile(SERVERS_CONFIG_PATH, JSON.stringify(servers, null, 2));
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  mainWindow.loadFile('index.html');
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());

app.on('before-quit', (event) => {
    const promises = [];
    for (const [serverId, serverProcess] of runningServers.entries()) {
        console.log(`Stopping server ${serverId} before quit...`);
        promises.push(new Promise(resolve => {
            serverProcess.on('close', resolve);
            serverProcess.stdin.write('stop\n');
            // Add a timeout to forcefully kill if it doesn't close
            setTimeout(() => {
                serverProcess.kill('SIGTERM');
                resolve();
            }, 3000);
        }));
    }
    if(promises.length > 0) {
        event.preventDefault();
        Promise.all(promises).then(() => {
            app.quit();
        });
    }
});

// --- Server Management IPC ---

ipcMain.handle('get-servers', async () => {
    return await readServersConfig();
});

ipcMain.handle('add-server', async (event, serverData) => {
    const servers = await readServersConfig();
    const newServer = { ...serverData, id: `srv-${Date.now()}` };
    servers.push(newServer);
    await writeServersConfig(servers);
    return newServer;
});

ipcMain.handle('update-server', async (event, serverData) => {
    const servers = await readServersConfig();
    const index = servers.findIndex(s => s.id === serverData.id);
    if (index !== -1) {
        servers[index] = serverData;
        await writeServersConfig(servers);
        return servers[index];
    }
});

ipcMain.handle('delete-server', async (event, serverId) => {
    let servers = await readServersConfig();
    servers = servers.filter(s => s.id !== serverId);
    await writeServersConfig(servers);
    return true;
});

ipcMain.handle('select-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory']
    });
    return result.filePaths[0];
});

ipcMain.on('open-folder', (event, folderPath) => {
    shell.openPath(folderPath);
});

// --- Backup Logic ---
ipcMain.handle('backup-server', async (event, serverId) => {
    const servers = await readServersConfig();
    const server = servers.find(s => s.id === serverId);
    if (!server) return { success: false, message: 'Server not found' };

    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const backupName = `${server.name.replace(/\s+/g, '_')}_Backup_${timestamp}`;
        // Create a 'backups' folder inside the server folder
        const backupDir = path.join(server.path, 'backups', backupName);
        
        // We exclude the 'backups' folder itself from the copy to prevent infinite recursion
        // A simple way is to just copy the 'world' folder if Hytale uses that standard
        // For robustness, let's backup the whole folder but skip 'backups'
        // (Note: Node.js fs.cp is recursive by default)
        
        await fs.cp(server.path, backupDir, { 
            recursive: true, 
            filter: (src) => !src.includes('backups') && !src.includes('hytale-server.jar') // Skip large jar and backups
        });

        return { success: true, message: `Backup created at: ${backupDir}` };
    } catch (error) {
        return { success: false, message: error.message };
    }
});


// --- Server Interaction IPC ---

// --- Update the start-server handler ---
ipcMain.on('start-server', async (event, serverId) => {
    if (runningServers.has(serverId)) {
        mainWindow.webContents.send('server-log', { serverId, log: '[Manager] Server is already running.\n' });
        return;
    }

    const servers = await readServersConfig();
    const serverConfig = servers.find(s => s.id === serverId);

    if (!serverConfig) {
        mainWindow.webContents.send('server-log', { serverId, log: `[Manager] Error: Server config not found for ID ${serverId}.\n` });
        return;
    }
    
    const args = (serverConfig.javaArgs || '').split(' ').filter(Boolean);
    
    // USE THE NEW FUNCTION HERE
    const javaExec = getJavaExecutable(serverConfig);

    const serverProcess = spawn(javaExec, [...args, '-jar', serverConfig.jarFile], { cwd: serverConfig.path });
    
    runningServers.set(serverId, serverProcess);
    mainWindow.webContents.send('server-state-change', { serverId, isRunning: true });

    // 1. Send START Notification (Green Color: 5763719)
    sendDiscordNotification(serverConfig.discordWebhook, `🟢 Server "${serverConfig.name}" is Starting...`, 5763719);

    serverProcess.stdout.on('data', (data) => {
        const logLine = data.toString();
        
        // Send to GUI Console
        mainWindow.webContents.send('server-log', { serverId, log: logLine });

        // --- NEW: DETECT PLAYER ACTIVITY ---
        // Regex to find names. Note: Adjust these patterns if Hytale logs differ!
        // Standard Minecraft pattern: "PlayerName joined the game"
        const joinMatch = logLine.match(/(\w+) joined the game/); 
        const leaveMatch = logLine.match(/(\w+) left the game/);

        if (joinMatch) {
            const playerName = joinMatch[1];
            updatePlayerHistory(serverConfig, playerName, 'join');
            // Discord Alert
            sendDiscordNotification(serverConfig.discordWebhook, `👤 ${playerName} joined the server!`, 3447003);
        }
        if (leaveMatch) {
            updatePlayerHistory(serverConfig, leaveMatch[1], 'leave');
        }
    });
    serverProcess.stderr.on('data', (data) => mainWindow.webContents.send('server-log', { serverId, log: `[STDERR] ${data.toString()}` }));

    serverProcess.on('close', (code) => {
        let msg = `[Manager] Server stopped. Exit code: ${code}.\n`;
        
        // ROBUSTNESS CHECK: Code 0 is normal. Anything else is usually a crash.
        if (code !== 0 && code !== null) {
            msg += `[ALERT] Server crashed or stopped unexpectedly! Check logs above.\n`;
            // Optional: You could trigger an auto-restart here if you wanted.
        }
        
        mainWindow.webContents.send('server-log', { serverId, log: msg });
        mainWindow.webContents.send('server-state-change', { serverId, isRunning: false });
        runningServers.delete(serverId);
        
        // 3. Send STOP Notification (Red Color: 15548997)
        sendDiscordNotification(serverConfig.discordWebhook, `🔴 Server "${serverConfig.name}" has stopped.`, 15548997);
    });

    serverProcess.on('error', (err) => {
        mainWindow.webContents.send('server-log', { serverId, log: `[Manager] Error: ${err.message}. Is Java installed and the server path/jar correct?\n` });
        mainWindow.webContents.send('server-state-change', { serverId, isRunning: false });
        runningServers.delete(serverId);
    });
});

ipcMain.on('stop-server', (event, serverId) => {
    const serverProcess = runningServers.get(serverId);
    if (!serverProcess) {
        mainWindow.webContents.send('server-log', { serverId, log: '[Manager] Server is not running.\n' });
        return;
    }
    mainWindow.webContents.send('server-log', { serverId, log: '[Manager] Sending stop command...\n' });
    serverProcess.stdin.write('stop\n');
});

ipcMain.on('send-command', (event, { serverId, command }) => {
    const serverProcess = runningServers.get(serverId);
    if (serverProcess && serverProcess.stdin.writable) {
        serverProcess.stdin.write(command + '\n');
    } else {
        mainWindow.webContents.send('server-log', { serverId, log: '[Manager] Cannot send command: Server not running.\n' });
    }
});

// --- Config Editor Logic ---

ipcMain.handle('read-file', async (event, { serverId, filename }) => {
    const servers = await readServersConfig();
    const server = servers.find(s => s.id === serverId);
    if (!server) throw new Error("Server not found");

    const filePath = path.join(server.path, filename);
    try {
        const content = await fs.readFile(filePath, 'utf-8');
        return { success: true, content };
    } catch (err) {
        // If file doesn't exist, return empty string or specific error
        return { success: false, error: err.message };
    }
});

ipcMain.handle('save-file', async (event, { serverId, filename, content }) => {
    const servers = await readServersConfig();
    const server = servers.find(s => s.id === serverId);
    if (!server) throw new Error("Server not found");

    const filePath = path.join(server.path, filename);
    try {
        await fs.writeFile(filePath, content, 'utf-8');
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});

// --- Discord Helper ---
async function sendDiscordNotification(webhookUrl, message, color = 5814783) {
    if (!webhookUrl || !webhookUrl.startsWith('http')) return;
    
    try {
        await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                embeds: [{
                    description: `**${message}**`,
                    color: color, // Decimal color code
                    footer: { text: "Hytale Server Manager" },
                    timestamp: new Date().toISOString()
                }]
            })
        });
    } catch (err) {
        console.error("Failed to send Discord webhook:", err.message);
    }
}

// --- Player History Logic ---
async function updatePlayerHistory(server, playerName, action) {
    const historyFile = path.join(server.path, 'player-history.json');
    let history = [];

    // 1. Try to read existing history
    try {
        const content = await fs.readFile(historyFile, 'utf-8');
        history = JSON.parse(content);
    } catch (e) {
        // File doesn't exist yet, which is fine
        history = [];
    }

    // 2. Find if player exists
    const index = history.findIndex(p => p.name === playerName);
    const now = new Date().toISOString();

    if (index !== -1) {
        // Update existing player
        history[index].lastSeen = now;
        history[index].lastAction = action; // 'join' or 'leave'
    } else {
        // Add new player
        history.push({
            name: playerName,
            firstSeen: now,
            lastSeen: now,
            lastAction: action
        });
    }

    // 3. Save back to file
    await fs.writeFile(historyFile, JSON.stringify(history, null, 2));
}