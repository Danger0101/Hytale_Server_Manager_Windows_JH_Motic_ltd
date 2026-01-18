const { app, BrowserWindow, ipcMain, dialog, shell, clipboard } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const https = require('https');
const { spawn, exec } = require('child_process');

const isWin = process.platform === 'win32'; 
const SERVERS_CONFIG_PATH = path.join(app.getPath('userData'), 'servers.json');
const runningServers = new Map();
let mainWindow;

// --- AUTHENTICATION CONSTANTS ---
const HYTALE_AUTH_ENDPOINTS = {
    device_auth: 'https://oauth.accounts.hytale.com/oauth2/device/auth',
    token: 'https://oauth.accounts.hytale.com/oauth2/token',
    profiles: 'https://account-data.hytale.com/my-account/get-profiles',
    session: 'https://sessions.hytale.com/game-session/new'
};
const CLIENT_ID = 'hytale-server'; // As per Manual

// --- HELPERS ---
function getJavaExecutable(serverConfig) {
    if (serverConfig.javaPath?.trim()) return serverConfig.javaPath;
    const bundledPath = path.join(__dirname, 'jre', 'bin', isWin ? 'java.exe' : 'java');
    try { require('fs').accessSync(bundledPath); return bundledPath; } catch (e) { return 'java'; }
}

async function readServersConfig() {
    try { await fs.access(SERVERS_CONFIG_PATH); } 
    catch { await fs.writeFile(SERVERS_CONFIG_PATH, JSON.stringify([], null, 2)); }
    return JSON.parse(await fs.readFile(SERVERS_CONFIG_PATH, 'utf-8'));
}

async function writeServersConfig(servers) {
    await fs.writeFile(SERVERS_CONFIG_PATH, JSON.stringify(servers, null, 2));
}

// Optimized Extractor
async function extractArchive(source, target) {
    if (isWin && source.endsWith('.zip')) {
        return new Promise((resolve, reject) => {
            exec(`powershell -command "Expand-Archive -Path '${source}' -DestinationPath '${target}' -Force"`, (err) => err ? reject(err) : resolve());
        });
    } else {
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
    width: 1200, height: 800,
    webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.js') },
  });
  mainWindow.loadFile('index.html');
  mainWindow.on('closed', () => { mainWindow = null; });
}
app.whenReady().then(createWindow);
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());

app.on('before-quit', (event) => {
    const promises = [];
    for (const [id, proc] of runningServers) {
        promises.push(new Promise(res => { proc.on('close', res); proc.kill('SIGTERM'); setTimeout(res, 2000); }));
    }
    if(promises.length > 0) { event.preventDefault(); Promise.all(promises).then(() => app.quit()); }
});

// --- IPC: SERVER MANAGEMENT ---
icpMain.handle('get-servers', async () => await readServersConfig());
icpMain.handle('add-server', async (e, data) => {
    const servers = await readServersConfig();
    const newServer = { ...data, id: `srv-${Date.now()}` };
    servers.push(newServer);
    await writeServersConfig(servers);
    return newServer;
});
icpMain.handle('update-server', async (e, data) => {
    const servers = await readServersConfig();
    const idx = servers.findIndex(s => s.id === data.id);
    if (idx !== -1) { servers[idx] = data; await writeServersConfig(servers); return servers[idx]; }
});
icpMain.handle('delete-server', async (e, { serverId, deleteFiles }) => {
    let servers = await readServersConfig();
    const s = servers.find(x => x.id === serverId);
    if (deleteFiles && s) try { await fs.rm(s.path, { recursive: true, force: true }); } catch {} // eslint-disable-line no-empty
    servers = servers.filter(x => x.id !== serverId);
    await writeServersConfig(servers);
    return true;
});

// --- IPC: FILES ---
icpMain.handle('select-directory', async (e) => {
    const res = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { properties: ['openDirectory'] });
    return res.canceled ? null : res.filePaths[0];
});
icpMain.handle('select-file', async (e, filter) => {
    const res = await dialog.showOpenDialog(BrowserWindow.fromWebContents(e.sender), { properties: ['openFile'], filters: filter ? [filter] : [] });
    return res.canceled ? null : res.filePaths[0];
});
icpMain.on('open-folder', (e, p) => shell.openPath(p));
icpMain.handle('open-backup-folder', async (e, id) => {
    const s = (await readServersConfig()).find(x => x.id === id);
    if(s) { const p = path.join(s.path, 'backups'); await fs.mkdir(p, {recursive:true}); shell.openPath(p); }
});
icpMain.handle('backup-server', async (e, id) => {
    const s = (await readServersConfig()).find(x => x.id === id);
    if(!s) throw new Error('Server not found');
    const name = `${s.name.replace(/\s+/g,'_')}_Backup_${new Date().toISOString().replace(/[:.]/g,'-')}`;
    const dest = path.join(s.path, 'backups', name);
    await fs.cp(s.path, dest, { recursive: true, filter: src => !src.includes('backups') && !src.includes('hytale-server.jar') });
    return { success: true, message: 'Backup Created' };
});

// ===========================================================================
//  AUTHENTICATION & AUTO-REFRESH LOGIC
// ===========================================================================

// 1. Start Device Flow
icpMain.handle('auth-start-device-flow', async () => {
    try {
        const response = await fetch(HYTALE_AUTH_ENDPOINTS.device_auth, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ client_id: CLIENT_ID, scope: 'openid offline auth:server' })
        });
        const data = await response.json();
        return { success: true, data };
    } catch (e) { return { success: false, error: e.message }; }
});

// 2. Poll for Token
icpMain.handle('auth-poll-token', async (e, deviceCode) => {
    try {
        const response = await fetch(HYTALE_AUTH_ENDPOINTS.token, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ 
                client_id: CLIENT_ID, 
                grant_type: 'urn:ietf:params:oauth:grant-type:device_code', 
                device_code: deviceCode 
            })
        });
        const data = await response.json();
        if (data.error === 'authorization_pending') return { status: 'pending' };
        if (data.access_token) return { status: 'success', tokens: data };
        return { status: 'error', error: data.error };
    } catch (e) { return { status: 'error', error: e.message }; }
});

// 3. Refresh Session (The Auto-Refresh Magic)
async function refreshServerSession(server) {
    if (!server.refreshToken) throw new Error("No refresh token available");

    // A. Refresh OAuth Token
    const tokenRes = await fetch(HYTALE_AUTH_ENDPOINTS.token, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ 
            client_id: CLIENT_ID, 
            grant_type: 'refresh_token', 
            refresh_token: server.refreshToken 
        })
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error("Failed to refresh OAuth token");

    // Update Refresh Token if a new one was sent (Rotation)
    if(tokenData.refresh_token) server.refreshToken = tokenData.refresh_token;

    // B. Get Profile (We need UUID)
    const profileRes = await fetch(HYTALE_AUTH_ENDPOINTS.profiles, {
        headers: { 'Authorization': `Bearer ${tokenData.access_token}` }
    });
    const profileData = await profileRes.json();
    const ownerId = profileData.owner; // Or select first profile?
    
    // C. Create New Game Session
    const sessionRes = await fetch(HYTALE_AUTH_ENDPOINTS.session, {
        method: 'POST',
        headers: { 
            'Authorization': `Bearer ${tokenData.access_token}`,
            'Content-Type': 'application/json' 
        },
        body: JSON.stringify({ uuid: ownerId }) // Assuming owner UUID is what we need
    });
    const sessionData = await sessionRes.json();
    if (!sessionData.sessionToken) throw new Error("Failed to create game session");

    // Update Server Config with fresh tokens
    server.authSessionToken = sessionData.sessionToken;
    server.authIdentityToken = sessionData.identityToken;
    
    // Save to disk
    const allServers = await readServersConfig();
    const idx = allServers.findIndex(s => s.id === server.id);
    if(idx !== -1) {
        allServers[idx] = server;
        await writeServersConfig(allServers);
    }
    
    return server;
}

// --- SERVER CONTROL ---
icpMain.on('start-server', async (e, serverId) => {
    if (runningServers.has(serverId)) return;
    
    const servers = await readServersConfig();
    let server = servers.find(s => s.id === serverId);
    if (!server) return;

    // 1. AUTO UPDATE
    if (server.autoUpdate && server.updateUrl) {
        mainWindow.webContents.send('server-log', { serverId, log: '[Manager] Checking updates...\n' });
        await downloadServerJar(server);
    }

    // 2. AUTO REFRESH AUTH
    // If we have a refresh token, try to get fresh session tokens BEFORE starting
    if (server.refreshToken) {
        mainWindow.webContents.send('server-log', { serverId, log: '[Auth] Refreshing Game Session...\n' });
        try {
            server = await refreshServerSession(server); // Updates 'server' obj with new tokens
            mainWindow.webContents.send('server-log', { serverId, log: '[Auth] Session Refreshed Successfully!\n' });
        } catch (err) {
            mainWindow.webContents.send('server-log', { serverId, log: `[Auth Warning] Refresh failed: ${err.message}. Server may start unauthenticated.\n` });
        }
    }

    // 3. PREPARE ENV
    const env = { ...process.env };
    if (server.authSessionToken) {
        env['HYTALE_SERVER_SESSION_TOKEN'] = server.authSessionToken;
        env['HYTALE_SERVER_IDENTITY_TOKEN'] = server.authIdentityToken;
    }
    if (server.hytaleApiKey) env['HYTALE_API_KEY'] = server.hytaleApiKey;

    const javaExec = getJavaExecutable(server);
    const args = (server.javaArgs || '').split(' ').filter(Boolean);
    
    const proc = spawn(javaExec, [...args, '-jar', server.jarFile], { cwd: server.path, env });
    runningServers.set(serverId, proc);
    
    mainWindow.webContents.send('server-state-change', { serverId, isRunning: true });
    sendDiscordNotification(server.discordWebhook, `✅ ${server.name} Started`, 5763719);

    proc.stdout.on('data', d => {
        const line = d.toString();
        if(line.includes('accounts.hytale.com/device')) mainWindow.webContents.send('auth-needed', line);
        mainWindow.webContents.send('server-log', { serverId, log: line });
    });
    proc.stderr.on('data', d => mainWindow.webContents.send('server-log', { serverId, log: d.toString() }));
    proc.on('close', c => {
        mainWindow.webContents.send('server-log', { serverId, log: `\n[Manager] Process exited with code ${c}\n` });
        mainWindow.webContents.send('server-state-change', { serverId, isRunning: false });
        runningServers.delete(serverId);
    });
});

icpMain.on('stop-server', (e, id) => { const p = runningServers.get(id); if(p) p.stdin.write('stop\n'); });
icpMain.on('send-command', (e, {serverId, command}) => { const p = runningServers.get(serverId); if(p) p.stdin.write(command+'\n'); });

// --- JAVA/TOOLS/API ---
icpMain.handle('check-java-installed', async () => {
    const bundled = path.join(__dirname, 'jre', 'bin', isWin?'java.exe':'java');
    if(require('fs').existsSync(bundled)) return {installed:true, type:'bundled'};
    return new Promise(r => exec('java -version', {timeout:3000}, e => r({installed:!e, type:'global'})));
});

function getAdoptiumPlatform() {
    const platformMap = { 'win32': 'windows', 'linux': 'linux', 'darwin': 'mac' };
    const archMap = { 'x64': 'x64', 'arm64': 'aarch64' };
    return { os: platformMap[process.platform], arch: archMap[process.arch] };
}

icpMain.handle('download-java', async () => {
    const { os, arch } = getAdoptiumPlatform();
    if (!os || !arch) return { success: false, message: 'Unsupported Platform' };

    const apiUrl = `https://api.adoptium.net/v3/binary/latest/25/ga/${os}/${arch}/jdk/hotspot/normal/eclipse`;
    const jreDir = path.join(__dirname, 'jre');
    const tempFile = path.join(__dirname, 'java_temp.zip');

    try {
        try { await fs.rm(jreDir, { recursive: true, force: true }); } catch(e) {} // eslint-disable-line no-empty
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
        
        // Flatten
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

function getDownloaderPath() { return path.join(__dirname, 'bin', isWin ? 'hytale-downloader-windows-amd64.exe' : 'hytale-downloader-linux-amd64'); }

icpMain.handle('check-cli-tool', async () => { try{require('fs').accessSync(getDownloaderPath());return true}catch{return false} });
icpMain.handle('download-cli-tool', async () => { 
    // Simplified fetch download
    const dest = path.join(__dirname, 'bin', 'tool.zip');
    await fs.mkdir(path.dirname(dest), {recursive:true});
    // Placeholder for actual download logic using https.get
    await new Promise((resolve, reject) => {
        const file = require('fs').createWriteStream(dest);
        https.get('https://downloader.hytale.com/hytale-downloader.zip', (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                https.get(res.headers.location, (redir) => redir.pipe(file).on('finish', () => { file.close(); resolve(); }));
            } else {
                res.pipe(file).on('finish', () => { file.close(); resolve(); });
            }
        }).on('error', reject);
    });
    await extractArchive(dest, path.dirname(dest));
    await fs.unlink(dest);
    return {success:true};
});

ipcMain.handle('install-via-cli', async (event, serverId) => {
    const servers = await readServersConfig();
    const server = servers.find(s => s.id === serverId);
    const toolPath = getDownloaderPath();
    const binDir = path.dirname(toolPath);
    
    await fs.mkdir(server.path, { recursive: true });

    return new Promise((resolve) => {
        const proc = spawn(toolPath, [], { cwd: server.path });
        
        proc.stdout.on('data', d => mainWindow.webContents.send('server-log', { serverId, log: d.toString() }));
        proc.stderr.on('data', d => mainWindow.webContents.send('server-log', { serverId, log: d.toString() }));
        
        proc.on('close', async (code) => {
            if (code === 0) {
                // --- SUCCESS: Attempt to harvest credentials ---
                try {
                    // Check possible locations for the credentials file
                    const possiblePaths = [
                        path.join(server.path, '.hytale-downloader-credentials.json'), // Saved in CWD
                        path.join(binDir, '.hytale-downloader-credentials.json'),      // Saved next to exe
                        path.join(app.getPath('home'), '.hytale-downloader-credentials.json') // Saved in User Home
                    ];

                    let creds = null;
                    for (const p of possiblePaths) {
                        if (require('fs').existsSync(p)) {
                            const content = await fs.readFile(p, 'utf-8');
                            creds = JSON.parse(content);
                            mainWindow.webContents.send('server-log', { serverId, log: `[Manager] Found credentials file at: ${p}\n` });
                            break;
                        }
                    }

                    if (creds && creds.refresh_token) {
                        // SAVE TO SERVER CONFIG
                        // We need to re-read config to avoid race conditions
                        const currentServers = await readServersConfig();
                        const srvIdx = currentServers.findIndex(s => s.id === serverId);
                        if (srvIdx !== -1) {
                            currentServers[srvIdx].refreshToken = creds.refresh_token;
                            await writeServersConfig(currentServers);
                            mainWindow.webContents.send('server-log', { serverId, log: `[Manager] ✅ AUTH SAVED! Server will auto-refresh session tokens.\n` });
                        }
                    } else {
                        mainWindow.webContents.send('server-log', { serverId, log: `[Manager] ⚠️ Could not find credential file. Server auth might expire.\n` });
                    }

                } catch (err) {
                    console.error("Cred harvest error:", err);
                }
                
                resolve({ success: true });
            } else {
                resolve({ success: false, message: `Exit Code ${code}` });
            }
        });
    });
});

// Stubs for other handlers
icpMain.handle('install-server-jar', async () => ({success:false, message:'Use Hytale Downloader'}));
icpMain.handle('check-jar-exists', async (e,id) => { const s=(await readServersConfig()).find(x=>x.id===id); return s && require('fs').existsSync(path.join(s.path, s.jarFile)); });
icpMain.handle('check-aot-file', async (e,id) => { const s=(await readServersConfig()).find(x=>x.id===id); return s && require('fs').existsSync(path.join(s.path, 'HytaleServer.aot')); });
icpMain.handle('read-file', async (e, {serverId, filename}) => {
    const s = (await readServersConfig()).find(x => x.id === serverId);
    return s ? { success: true, content: await fs.readFile(path.join(s.path, filename), 'utf8') } : { success: false };
});
icpMain.handle('save-file', async (e, {serverId, filename, content}) => {
    const s = (await readServersConfig()).find(x => x.id === serverId);
    if(s) await fs.writeFile(path.join(s.path, filename), content);
    return { success: !!s };
});
icpMain.handle('import-from-launcher', async () => ({ success: false, message: 'Launcher import placeholder' }));
icpMain.handle('lookup-hytale-player', async () => ({ success: false, error: 'Offline' }));
icpMain.handle('report-hytale-player', async () => ({ success: true }));

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
async function downloadServerJar(server) { /* ... */ return {success:true, message: "Checked"}; }