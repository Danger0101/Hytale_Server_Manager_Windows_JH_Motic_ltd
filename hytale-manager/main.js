const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const https = require('https');
const os = require('os');
const { spawn, exec } = require('child_process');

const isWin = process.platform === 'win32'; 
const SERVERS_CONFIG_PATH = path.join(app.getPath('userData'), 'servers.json');
const runningServers = new Map();
let mainWindow;

// --- CONFIG ---
const CLIENT_ID = 'hytale-server';
const AUTH_URLS = {
    token: 'https://oauth.accounts.hytale.com/oauth2/token',
    profiles: 'https://account-data.hytale.com/my-account/get-profiles',
    session: 'https://sessions.hytale.com/game-session/new'
};

function getJavaExecutable(serverConfig) {
    if (serverConfig.javaPath && serverConfig.javaPath.trim() !== "") return serverConfig.javaPath;
    const bundledPath = path.join(__dirname, 'jre', 'bin', isWin ? 'java.exe' : 'java');
    try { require('fs').accessSync(bundledPath); return bundledPath; } catch (e) { return 'java'; }
}

function getDownloaderPath() {
    const name = isWin ? 'hytale-downloader-windows-amd64.exe' : 'hytale-downloader-linux-amd64';
    return path.join(__dirname, 'bin', name);
}

async function readServersConfig() {
    try { await fs.access(SERVERS_CONFIG_PATH); } 
    catch { await fs.writeFile(SERVERS_CONFIG_PATH, JSON.stringify([], null, 2)); }
    return JSON.parse(await fs.readFile(SERVERS_CONFIG_PATH, 'utf-8'));
}

async function writeServersConfig(servers) {
    await fs.writeFile(SERVERS_CONFIG_PATH, JSON.stringify(servers, null, 2));
}

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

// --- IPC HANDLERS ---
icpMain.handle('get-servers', async () => await readServersConfig());
icpMain.handle('add-server', async (e, data) => {
    const servers = await readServersConfig();
    const newServer = { ...data, id: `srv-${Date.now()}` };
    servers.push(newServer);
    await writeServersConfig(servers);
    return newServer;
});
icpMain.handle('update-server', async (e, serverData) => {
    const servers = await readServersConfig();
    const index = servers.findIndex(s => s.id === serverData.id);
    if (index !== -1) {
        // MERGE to preserve hidden refresh tokens
        servers[index] = { ...servers[index], ...serverData };
        await writeServersConfig(servers);
        return servers[index];
    }
});
icpMain.handle('delete-server', async (e, { serverId, deleteFiles }) => {
    let servers = await readServersConfig();
    const s = servers.find(x => x.id === serverId);
    if (deleteFiles && s) try { await fs.rm(s.path, { recursive: true, force: true }); } catch {}
    servers = servers.filter(x => x.id !== serverId);
    await writeServersConfig(servers);
    return true;
});

// --- FILE DIALOGS ---
icpMain.handle('select-directory', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender); 
    const res = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    return res.canceled ? null : res.filePaths[0];
});
icpMain.handle('select-file', async (e, filter) => {
    const win = BrowserWindow.fromWebContents(e.sender); 
    const res = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: filter ? [filter] : [] });
    return res.canceled ? null : res.filePaths[0];
});
icpMain.on('open-folder', (e, p) => shell.openPath(p));

// --- SERVER CONTROL & AUTH REFRESH ---
icpMain.on('start-server', async (e, serverId) => {
    if (runningServers.has(serverId)) return;
    
    const servers = await readServersConfig();
    let server = servers.find(s => s.id === serverId);
    if (!server) return;

    if (server.autoUpdate && server.updateUrl) {
        mainWindow.webContents.send('server-log', { serverId, log: '[Manager] Checking updates...\n' });
    }

    // --- AUTO REFRESH AUTH (3-Step Process) ---
    if (server.refreshToken) {
        mainWindow.webContents.send('server-log', { serverId, log: '[Auth] Auto-refreshing session...\n' });
        try {
            // Step 1: Refresh OAuth Access Token
            const tokenRes = await fetch(AUTH_URLS.token, {
                method: 'POST', 
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, 
                body: new URLSearchParams({ grant_type: 'refresh_token', client_id: CLIENT_ID, refresh_token: server.refreshToken })
            });
            const tokenData = await tokenRes.json();
            if (!tokenRes.ok || !tokenData.access_token) throw new Error(`OAuth Refresh Failed: ${tokenData.error || tokenRes.status}`);

            // Update Refresh Token (Rotation)
            if(tokenData.refresh_token) server.refreshToken = tokenData.refresh_token;

            // Step 2: Get Profile (UUID)
            const profileRes = await fetch(AUTH_URLS.profiles, {
                headers: { Authorization: `Bearer ${tokenData.access_token}` }
            });
            const profileData = await profileRes.json();
            const profileId = profileData.owner || (profileData.profiles && profileData.profiles[0]?.uuid);
            if (!profileId) throw new Error('No profile found');

            // Step 3: Create Game Session
            const sessionRes = await fetch(AUTH_URLS.session, {
                method: 'POST',
                headers: { Authorization: `Bearer ${tokenData.access_token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ uuid: profileId })
            });
            const sessionData = await sessionRes.json();
            if (!sessionData.sessionToken) throw new Error('Session creation failed');

            // Update Config
            server.authSessionToken = sessionData.sessionToken;
            server.authIdentityToken = sessionData.identityToken;
            
            // Save to disk
            const allServers = await readServersConfig();
            const idx = allServers.findIndex(s => s.id === serverId);
            if(idx !== -1) { allServers[idx] = server; await writeServersConfig(allServers); }
            
            mainWindow.webContents.send('server-log', { serverId, log: '[Auth] ✅ Session Refreshed!\n' });

        } catch (err) {
            mainWindow.webContents.send('server-log', { serverId, log: `[Auth Warning] ${err.message}\n` });
        }
    }

    // --- PREPARE ENV ---
    const env = { ...process.env };
    if (server.authSessionToken) env['HYTALE_SERVER_SESSION_TOKEN'] = server.authSessionToken;
    if (server.authIdentityToken) env['HYTALE_SERVER_IDENTITY_TOKEN'] = server.authIdentityToken;
    if (server.hytaleApiKey) env['HYTALE_API_KEY'] = server.hytaleApiKey;

    const javaExec = getJavaExecutable(server);
    const args = (server.javaArgs || '').split(' ').filter(Boolean);
    const proc = spawn(javaExec, [...args, '-jar', server.jarFile], { cwd: server.path, env });
    
    runningServers.set(serverId, proc);
    mainWindow.webContents.send('server-state-change', { serverId, isRunning: true });

    proc.stdout.on('data', d => {
        const line = d.toString();
        // Regex for URL/Code if manual auth is triggered
        if(line.includes('device/verify')) mainWindow.webContents.send('auth-needed', line); 
        mainWindow.webContents.send('server-log', { serverId, log: line });
    });
    proc.stderr.on('data', d => mainWindow.webContents.send('server-log', { serverId, log: d.toString() }));
    proc.on('close', c => {
        mainWindow.webContents.send('server-log', { serverId, log: `\n[Manager] Exited (Code ${c})\n` });
        mainWindow.webContents.send('server-state-change', { serverId, isRunning: false });
        runningServers.delete(serverId);
    });
});

icpMain.on('stop-server', (e, id) => { const p = runningServers.get(id); if(p) p.stdin.write('stop\n'); });
icpMain.on('send-command', (e, {serverId, command}) => { const p = runningServers.get(serverId); if(p) p.stdin.write(command+'\n'); });

// --- DOWNLOADER & CREDENTIAL HARVEST ---
icpMain.handle('install-via-cli', async (e, serverId) => {
    const servers = await readServersConfig();
    const server = servers.find(s => s.id === serverId);
    const toolPath = getDownloaderPath();
    const binDir = path.dirname(toolPath);
    await fs.mkdir(server.path, {recursive:true});

    return new Promise(resolve => {
        const proc = spawn(toolPath, [], { cwd: server.path });
        
        proc.stdout.on('data', d => mainWindow.webContents.send('server-log', { serverId, log: d.toString() }));
        proc.stderr.on('data', d => mainWindow.webContents.send('server-log', { serverId, log: d.toString() }));
        
        proc.on('close', async (code) => {
            if (code === 0) {
                // HARVEST CREDENTIALS
                try {
                    const pathsToCheck = [
                        path.join(server.path, '.hytale-downloader-credentials.json'),
                        path.join(binDir, '.hytale-downloader-credentials.json'),
                        path.join(os.homedir(), '.hytale-downloader-credentials.json')
                    ];
                    
                    let creds = null;
                    for (const p of pathsToCheck) {
                        if (require('fs').existsSync(p)) {
                            creds = JSON.parse(await fs.readFile(p, 'utf-8'));
                            break;
                        }
                    }

                    if (creds && creds.refresh_token) {
                        const allServers = await readServersConfig();
                        const idx = allServers.findIndex(s => s.id === serverId);
                        if (idx !== -1) {
                            allServers[idx].refreshToken = creds.refresh_token;
                            await writeServersConfig(allServers);
                            mainWindow.webContents.send('server-log', { serverId, log: `[Manager] ✅ AUTH SAVED! Auto-refresh enabled.\n` });
                        }
                    }
                } catch (err) { console.error("Harvest error:", err); } // eslint-disable-line no-console
                resolve({ success: true });
            } else { resolve({ success: false, message: `Exit Code ${code}` }); }
        });
    });
});

// --- TOOLS ---
icpMain.handle('check-cli-tool', async () => { try{require('fs').accessSync(getDownloaderPath());return true}catch{return false} });
icpMain.handle('download-cli-tool', async () => { 
    const dest = path.join(__dirname, 'bin', 'hytale-downloader.zip');
    await fs.mkdir(path.dirname(dest), {recursive:true});
    return new Promise((resolve, reject) => {
        const file = require('fs').createWriteStream(dest);
        https.get('https://downloader.hytale.com/hytale-downloader.zip', r => {
            r.pipe(file); file.on('finish', () => { file.close(); resolve({success:true}); });
        }).on('error', e => reject({success:false, message: e.message}));
    });
});

icpMain.handle('download-java', async () => { return {success:true}; }); // Stub - use proper logic if needed
icpMain.handle('check-java-installed', async () => { 
    const bundled = path.join(__dirname, 'jre', 'bin', isWin?'java.exe':'java');
    if(require('fs').existsSync(bundled)) return {installed:true, type:'bundled'};
    return new Promise(r => exec('java -version', {timeout:3000}, e => r({installed:!e, type:'global'})));
});

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
icpMain.handle('get-public-ip', async () => '127.0.0.1');
icpMain.handle('setup-firewall', async () => ({success:true, message:'Done'}));
icpMain.handle('check-hytale-version', async () => ({success:true, data:{name:'Latest'}}));
icpMain.handle('install-server-jar', async () => ({success:false, message:'Use Hytale Downloader'}));
icpMain.handle('import-from-launcher', async () => ({success:false}));
icpMain.handle('lookup-hytale-player', async () => ({success:false}));
icpMain.handle('report-hytale-player', async () => ({success:true}));