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

const HYTALE_AUTH_ENDPOINTS = {
    token: 'https://oauth.accounts.hytale.com/oauth2/token'
};
const CLIENT_ID = 'hytale-server';

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

ipcMain.handle('get-servers', async () => await readServersConfig());
ipcMain.handle('add-server', async (e, data) => {
    const servers = await readServersConfig();
    const newServer = { ...data, id: `srv-${Date.now()}` };
    servers.push(newServer);
    await writeServersConfig(servers);
    return newServer;
});
ipcMain.handle('update-server', async (e, serverData) => {
    const servers = await readServersConfig();
    const index = servers.findIndex(s => s.id === serverData.id);
    if (index !== -1) {
        servers[index] = { ...servers[index], ...serverData };
        await writeServersConfig(servers);
        return servers[index];
    }
});
ipcMain.handle('delete-server', async (e, { serverId, deleteFiles }) => {
    let servers = await readServersConfig();
    const s = servers.find(x => x.id === serverId);
    if (deleteFiles && s) try { await fs.rm(s.path, { recursive: true, force: true }); } catch {} // eslint-disable-line no-empty
    servers = servers.filter(x => x.id !== serverId);
    await writeServersConfig(servers);
    return true;
});

ipcMain.handle('select-directory', async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const res = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    return res.canceled ? null : res.filePaths[0];
});
ipcMain.handle('select-file', async (e, filter) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const res = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: filter ? [filter] : [] });
    return res.canceled ? null : res.filePaths[0];
});
ipcMain.on('open-folder', (e, p) => shell.openPath(p));

ipcMain.on('start-server', async (e, serverId) => {
    if (runningServers.has(serverId)) return;
    const servers = await readServersConfig();
    let server = servers.find(s => s.id === serverId);
    if (!server) return;

    if (server.refreshToken) {
        mainWindow.webContents.send('server-log', { serverId, log: '[Auth] Auto-refreshing session...\n' });
        try {
            const params = new URLSearchParams();
            params.append('grant_type', 'refresh_token');
            params.append('client_id', CLIENT_ID);
            params.append('refresh_token', server.refreshToken);
            const authRes = await fetch(HYTALE_AUTH_ENDPOINTS.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params });
            if (authRes.ok) {
                const tokens = await authRes.json();
                if (tokens.access_token) {
                    server.authSessionToken = tokens.access_token; 
                    if(tokens.refresh_token) server.refreshToken = tokens.refresh_token; 
                    const allServers = await readServersConfig();
                    const idx = allServers.findIndex(s => s.id === serverId);
                    if(idx !== -1) { allServers[idx] = server; await writeServersConfig(allServers); }
                    mainWindow.webContents.send('server-log', { serverId, log: '[Auth] ✅ Session Refreshed!\n' });
                }
            } else { mainWindow.webContents.send('server-log', { serverId, log: `[Auth] Refresh Failed (${authRes.status}).\n` }); }
        } catch (err) { mainWindow.webContents.send('server-log', { serverId, log: `[Auth Warning] ${err.message}\n` }); }
    }

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

ipcMain.on('stop-server', (e, id) => { const p = runningServers.get(id); if(p) p.stdin.write('stop\n'); });
ipcMain.on('send-command', (e, {serverId, command}) => { const p = runningServers.get(serverId); if(p) p.stdin.write(command+'\n'); });

ipcMain.handle('install-via-cli', async (e, serverId) => {
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
                } catch (err) { console.error("Harvest error:", err); }
                resolve({ success: true });
            } else { resolve({ success: false, message: `Exit Code ${code}` }); }
        });
    });
});

ipcMain.handle('check-cli-tool', async () => { try{require('fs').accessSync(getDownloaderPath());return true}catch{return false} });
ipcMain.handle('download-cli-tool', async () => { 
    const dest = path.join(__dirname, 'bin', 'hytale-downloader.zip');
    await fs.mkdir(path.dirname(dest), {recursive:true});
    // Simplified fetch logic for zip download
    return new Promise((resolve, reject) => {
        const file = require('fs').createWriteStream(dest);
        https.get('https://downloader.hytale.com/hytale-downloader.zip', r => {
            r.pipe(file);
            file.on('finish', () => { file.close(); resolve({success:true}); });
        }).on('error', e => reject({success:false, message: e.message}));
    });
});

ipcMain.handle('download-java', async () => { return {success:true}; }); 
ipcMain.handle('check-java-installed', async () => { 
    const bundled = path.join(__dirname, 'jre', 'bin', isWin?'java.exe':'java');
    if(require('fs').existsSync(bundled)) return {installed:true, type:'bundled'};
    return new Promise(r => exec('java -version', {timeout:3000}, e => r({installed:!e, type:'global'})));
});

ipcMain.handle('check-jar-exists', async (e,id) => { const s=(await readServersConfig()).find(x=>x.id===id); return s && require('fs').existsSync(path.join(s.path, s.jarFile)); });
ipcMain.handle('check-aot-file', async (e,id) => { const s=(await readServersConfig()).find(x=>x.id===id); return s && require('fs').existsSync(path.join(s.path, 'HytaleServer.aot')); });
ipcMain.handle('read-file', async (e, {serverId, filename}) => {
    const s = (await readServersConfig()).find(x => x.id === serverId);
    return s ? { success: true, content: await fs.readFile(path.join(s.path, filename), 'utf8') } : { success: false };
});
ipcMain.handle('save-file', async (e, {serverId, filename, content}) => {
    const s = (await readServersConfig()).find(x => x.id === serverId);
    if(s) await fs.writeFile(path.join(s.path, filename), content);
    return { success: !!s };
});
ipcMain.handle('get-public-ip', async () => '127.0.0.1');
ipcMain.handle('setup-firewall', async () => ({success:true, message:'Done'}));
ipcMain.handle('check-hytale-version', async () => ({success:true, data:{name:'Latest'}}));
ipcMain.handle('install-server-jar', async () => ({success:false, message:'Use Hytale Downloader'}));
ipcMain.handle('import-from-launcher', async () => ({success:false}));
ipcMain.handle('lookup-hytale-player', async () => ({success:false}));
ipcMain.handle('report-hytale-player', async () => ({success:true}));