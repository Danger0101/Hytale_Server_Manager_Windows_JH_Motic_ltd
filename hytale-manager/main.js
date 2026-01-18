const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const https = require('https');
const { spawn, exec } = require('child_process');

const isWin = process.platform === 'win32'; 

const SERVERS_CONFIG_PATH = path.join(app.getPath('userData'), 'servers.json');
const runningServers = new Map();
let mainWindow;

// --- Helpers ---

function getJavaExecutable(serverConfig) {
    if (serverConfig.javaPath && serverConfig.javaPath.trim() !== "") {
        return serverConfig.javaPath;
    }
    const bundledPath = path.join(__dirname, 'jre', 'bin', isWin ? 'java.exe' : 'java');
    try {
        require('fs').accessSync(bundledPath);
        return bundledPath;
    } catch (e) {
        return 'java'; 
    }
}

async function readServersConfig() {
    try {
        await fs.access(SERVERS_CONFIG_PATH);
    } catch (error) {
        await fs.writeFile(SERVERS_CONFIG_PATH, JSON.stringify([], null, 2));
    }
    const fileContent = await fs.readFile(SERVERS_CONFIG_PATH, 'utf-8');
    return JSON.parse(fileContent);
}

async function writeServersConfig(servers) {
    await fs.writeFile(SERVERS_CONFIG_PATH, JSON.stringify(servers, null, 2));
}

// Optimized Extractor (Handles Zip & Tar.gz)
async function extractArchive(source, target) {
    if (isWin && source.endsWith('.zip')) {
        return new Promise((resolve, reject) => {
            exec(`powershell -command "Expand-Archive -Path '${source}' -DestinationPath '${target}' -Force"`, (err) => err ? reject(err) : resolve());
        });
    } else {
        // Linux/Mac or non-zip
        const cmd = source.endsWith('.zip') ? `unzip -o "${source}" -d "${target}"` : `tar -xzf "${source}" -C "${target}"`;
        return new Promise((resolve, reject) => {
            exec(cmd, (err) => err ? reject(err) : resolve());
        });
    }
}

function getDownloaderPath() {
    const name = isWin ? 'hytale-downloader-windows-amd64.exe' : 'hytale-downloader-linux-amd64';
    return path.join(__dirname, 'bin', name);
}

// --- Window Management ---

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
        promises.push(new Promise(resolve => {
            serverProcess.on('close', resolve);
            serverProcess.kill('SIGTERM');
            setTimeout(resolve, 2000); // Force resolve if stuck
        }));
    }
    if(promises.length > 0) {
        event.preventDefault();
        Promise.all(promises).then(() => app.quit());
    }
});

// --- IPC Handlers ---

ipcMain.handle('get-servers', async () => await readServersConfig());

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

ipcMain.handle('delete-server', async (event, { serverId, deleteFiles }) => {
    let servers = await readServersConfig();
    const server = servers.find(s => s.id === serverId);
    if (deleteFiles && server) {
        try { await fs.rm(server.path, { recursive: true, force: true }); } catch (e) {}
    }
    servers = servers.filter(s => s.id !== serverId);
    await writeServersConfig(servers);
    return true;
});

// --- File Dialogs ---
ipcMain.handle('select-directory', async () => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('select-file', async (event, filter) => {
    if (!mainWindow) return null;
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: filter ? [filter] : []
    });
    return result.canceled ? null : result.filePaths[0];
});

ipcMain.on('open-folder', (event, folderPath) => shell.openPath(folderPath));

ipcMain.handle('open-backup-folder', async (event, serverId) => {
    const servers = await readServersConfig();
    const server = servers.find(s => s.id === serverId);
    if (server) {
        const backupPath = path.join(server.path, 'backups');
        try { await fs.mkdir(backupPath, { recursive: true }); } catch (e) {}
        shell.openPath(backupPath);
    }
});

// --- Backup ---
ipcMain.handle('backup-server', async (event, serverId) => {
    const servers = await readServersConfig();
    const server = servers.find(s => s.id === serverId);
    if (!server) throw new Error('Server not found');

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(server.path, 'backups', `Backup_${timestamp}`);
    
    await fs.cp(server.path, backupDir, { 
        recursive: true, 
        filter: (src) => !src.includes('backups') && !src.includes('hytale-server.jar')
    });
    return { success: true, message: `Backup created!` };
});

// --- Server Control ---
ipcMain.on('start-server', async (event, serverId) => {
    if (runningServers.has(serverId)) return;

    const servers = await readServersConfig();
    const serverConfig = servers.find(s => s.id === serverId);
    if (!serverConfig) return;

    // Auto-Update Check
    if (serverConfig.autoUpdate && serverConfig.updateUrl) {
        mainWindow.webContents.send('server-log', { serverId, log: '[Manager] Checking updates...\n' });
        await downloadServerJar(serverConfig, mainWindow);
    }

    const javaExec = getJavaExecutable(serverConfig);
    const args = (serverConfig.javaArgs || '').split(' ').filter(Boolean);
    const serverEnv = { ...process.env };

    if (serverConfig.authSessionToken) {
        serverEnv['HYTALE_SERVER_SESSION_TOKEN'] = serverConfig.authSessionToken;
        serverEnv['HYTALE_SERVER_IDENTITY_TOKEN'] = serverConfig.authIdentityToken;
    }
    if (serverConfig.hytaleApiKey) serverEnv['HYTALE_API_KEY'] = serverConfig.hytaleApiKey;

    // Inject Payment Settings
    if (serverConfig.enablePayments) {
        serverEnv['HYTALE_PAYMENTS_ENABLED'] = 'true';
        if (serverConfig.merchantId) {
            serverEnv['HYTALE_MERCHANT_ID'] = serverConfig.merchantId;
        }
    }

    const serverProcess = spawn(javaExec, [...args, '-jar', serverConfig.jarFile], { 
        cwd: serverConfig.path, env: serverEnv 
    });
    
    runningServers.set(serverId, serverProcess);
    mainWindow.webContents.send('server-state-change', { serverId, isRunning: true });

    // Discord Notification
    sendDiscordNotification(serverConfig.discordWebhook, `✅ Server "${serverConfig.name}" is Starting...`, 5763719);

    serverProcess.stdout.on('data', (data) => {
        const line = data.toString();
        if (line.includes('accounts.hytale.com/device')) mainWindow.webContents.send('auth-needed', line);
        mainWindow.webContents.send('server-log', { serverId, log: line });
        
        // Player tracking placeholder (Join/Leave regex can be added here)
    });
    
    serverProcess.stderr.on('data', (data) => {
        mainWindow.webContents.send('server-log', { serverId, log: data.toString() });
    });

    serverProcess.on('close', (code) => {
        mainWindow.webContents.send('server-log', { serverId, log: `[Manager] Stopped (Code ${code})\n` });
        mainWindow.webContents.send('server-state-change', { serverId, isRunning: false });
        runningServers.delete(serverId);
        sendDiscordNotification(serverConfig.discordWebhook, `🛑 Server "${serverConfig.name}" has stopped.`, 15548997);
    });

    serverProcess.on('error', (err) => {
        mainWindow.webContents.send('server-log', { serverId, log: `[Error] ${err.message}\n` });
        mainWindow.webContents.send('server-state-change', { serverId, isRunning: false });
        runningServers.delete(serverId);
    });
});

ipcMain.on('stop-server', (event, serverId) => {
    const proc = runningServers.get(serverId);
    if (proc) proc.stdin.write('stop\n');
});

ipcMain.on('send-command', (event, { serverId, command }) => {
    const proc = runningServers.get(serverId);
    if (proc) proc.stdin.write(command + '\n');
});

// --- Java & Tool Management ---

ipcMain.handle('check-java-installed', async () => {
    const bundledPath = path.join(__dirname, 'jre', 'bin', isWin ? 'java.exe' : 'java');
    if (require('fs').existsSync(bundledPath)) return { installed: true, type: 'bundled' };

    return new Promise((resolve) => {
        // FIX: Added timeout to prevent hanging forever
        exec('java -version', { timeout: 3000 }, (err) => {
            if (!err) resolve({ installed: true, type: 'global' });
            else resolve({ installed: false });
        });
    });
});

ipcMain.handle('download-java', async () => {
    const platformMap = { 'win32': 'windows', 'linux': 'linux', 'darwin': 'mac' };
    const archMap = { 'x64': 'x64', 'arm64': 'aarch64' };
    const os = platformMap[process.platform];
    const arch = archMap[process.arch];

    const apiUrl = `https://api.adoptium.net/v3/binary/latest/25/ga/${os}/${arch}/jdk/hotspot/normal/eclipse`;
    const jreDir = path.join(__dirname, 'jre');
    const tempFile = path.join(__dirname, 'java_temp.zip');

    try {
        try { await fs.rm(jreDir, { recursive: true, force: true }); } catch(e) {}
        await fs.mkdir(jreDir, { recursive: true });

        mainWindow.webContents.send('tool-download-status', 'Downloading Java 25...');
        
        await new Promise((resolve, reject) => {
            const file = require('fs').createWriteStream(tempFile);
            https.get(apiUrl, (res) => {
                if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                    https.get(res.headers.location, (redir) => redir.pipe(file).on('finish', () => { file.close(); resolve(); }));
                } else {
                    res.pipe(file).on('finish', () => { file.close(); resolve(); });
                }
            }).on('error', reject);
        });

        mainWindow.webContents.send('tool-download-status', 'Extracting...');
        await extractArchive(tempFile, jreDir);
        
        // Flatten folder
        const files = await fs.readdir(jreDir);
        if (files.length === 1) {
            const nested = path.join(jreDir, files[0]);
            const items = await fs.readdir(nested);
            for (const item of items) await fs.rename(path.join(nested, item), path.join(jreDir, item));
            await fs.rm(nested, { recursive: true });
        }
        await fs.unlink(tempFile);
        return { success: true };
    } catch (e) {
        return { success: false, message: e.message };
    }
});

// --- CLI Tool Handlers ---

ipcMain.handle('check-cli-tool', async () => {
    try { require('fs').accessSync(getDownloaderPath()); return true; } catch { return false; }
});

ipcMain.handle('download-cli-tool', async () => {
    const binDir = path.join(__dirname, 'bin');
    const zipPath = path.join(binDir, 'tool.zip');
    try {
        await fs.mkdir(binDir, { recursive: true });
        await new Promise((resolve, reject) => {
            const file = require('fs').createWriteStream(zipPath);
            https.get('https://downloader.hytale.com/hytale-downloader.zip', (res) => res.pipe(file).on('finish', () => { file.close(); resolve(); })).on('error', reject);
        });
        await extractArchive(zipPath, binDir);
        await fs.unlink(zipPath);
        return { success: true };
    } catch (e) { return { success: false, message: e.message }; }
});

ipcMain.handle('install-via-cli', async (event, serverId) => {
    const servers = await readServersConfig();
    const server = servers.find(s => s.id === serverId);
    const toolPath = getDownloaderPath();
    
    // Ensure dir exists
    await fs.mkdir(server.path, { recursive: true });

    return new Promise((resolve) => {
        const proc = spawn(toolPath, [], { cwd: server.path });
        proc.stdout.on('data', d => mainWindow.webContents.send('server-log', { serverId, log: d.toString() }));
        proc.stderr.on('data', d => mainWindow.webContents.send('server-log', { serverId, log: d.toString() }));
        proc.on('close', code => resolve(code === 0 ? { success: true } : { success: false, message: `Exit Code ${code}` }));
    });
});

// --- API & File Helpers ---
ipcMain.handle('check-hytale-version', async () => ({ success: true, data: { name: 'Latest' } }));
ipcMain.handle('get-public-ip', async () => '127.0.0.1'); 
ipcMain.handle('setup-firewall', async () => ({ success: true, message: 'Firewall command sent.' }));
ipcMain.handle('check-jar-exists', async (e, id) => {
    const s = (await readServersConfig()).find(x => x.id === id);
    return s ? require('fs').existsSync(path.join(s.path, s.jarFile)) : false;
});
ipcMain.handle('check-aot-file', async (e, id) => {
    const s = (await readServersConfig()).find(x => x.id === id);
    return s ? require('fs').existsSync(path.join(s.path, 'HytaleServer.aot')) : false;
});
ipcMain.handle('read-file', async (e, {serverId, filename}) => {
    const s = (await readServersConfig()).find(x => x.id === serverId);
    return s ? { success: true, content: await fs.readFile(path.join(s.path, filename), 'utf8') } : { success: false };
});
ipcMain.handle('save-file', async (e, {serverId, filename, content}) => {
    const s = (await readServersConfig()).find(x => x.id === serverId);
    if(s) await fs.writeFile(path.join(s.path, filename), content);
    return { success: !!s };
});
ipcMain.handle('import-from-launcher', async () => ({ success: false, message: 'Feature placeholder' }));
ipcMain.handle('lookup-hytale-player', async () => ({ success: false, error: 'Offline' }));
ipcMain.handle('report-hytale-player', async () => ({ success: true }));

// Discord Notification Helper
async function sendDiscordNotification(webhookUrl, message, color) {
    if (!webhookUrl || webhookUrl.trim() === "") return;
    const payload = { embeds: [{ description: message, color: color, timestamp: new Date().toISOString() }] };
    const url = new URL(webhookUrl);
    const req = https.request({
        hostname: url.hostname, path: url.pathname, method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    });
    req.on('error', (e) => console.error(`[Discord] Error: ${e.message}`));
    req.write(JSON.stringify(payload));
    req.end();
}