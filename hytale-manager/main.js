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

    serverProcess.stdout.on('data', (data) => mainWindow.webContents.send('server-log', { serverId, log: data.toString() }));
    serverProcess.stderr.on('data', (data) => mainWindow.webContents.send('server-log', { serverId, log: `[STDERR] ${data.toString()}` }));

    serverProcess.on('close', (code) => {
        mainWindow.webContents.send('server-log', { serverId, log: `[Manager] Server stopped. Exit code: ${code}.\n` });
        mainWindow.webContents.send('server-state-change', { serverId, isRunning: false });
        runningServers.delete(serverId);
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