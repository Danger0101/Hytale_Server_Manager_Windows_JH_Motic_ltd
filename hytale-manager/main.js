const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs/promises');
const https = require('https');
const { spawn, exec } = require('child_process');

const isWin = process.platform === 'win32'; // Define isWin globally

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

ipcMain.handle('delete-server', async (event, { serverId, deleteFiles }) => {
    let servers = await readServersConfig();
    const server = servers.find(s => s.id === serverId);

    if (deleteFiles && server) {
        try {
            // Stop the server if it's running before deleting files
            const serverProcess = runningServers.get(serverId);
            if (serverProcess) {
                await new Promise(resolve => {
                    serverProcess.on('close', resolve);
                    serverProcess.kill('SIGTERM'); // Force stop
                });
                runningServers.delete(serverId);
            }
            // Delete the directory
            await fs.rm(server.path, { recursive: true, force: true });
        } catch (err) {
            console.error(`Failed to delete server files for ${serverId}:`, err);
            // We can still proceed to remove it from the config,
            // but we should let the user know something went wrong.
            dialog.showErrorBox('Deletion Error', `Could not delete all server files at:\n${server.path}\n\nPlease remove them manually.\n\nError: ${err.message}`);
        }
    }

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

ipcMain.handle('open-backup-folder', async (event, serverId) => {
    const servers = await readServersConfig();
    const server = servers.find(s => s.id === serverId);
    if (!server) return;

    const backupPath = path.join(server.path, 'backups');
    // Create it if it doesn't exist so the folder opens empty instead of erroring
    try {
        await fs.access(backupPath);
    } catch {
        await fs.mkdir(backupPath, { recursive: true });
    }
    shell.openPath(backupPath);
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

    // --- FIX: Implement Auto-Update Logic ---
    if (serverConfig.autoUpdate && serverConfig.updateUrl) {
        mainWindow.webContents.send('server-log', { serverId, log: '[Manager] Auto-Update enabled. Checking for updates...\n' });
        const downloadResult = await downloadServerJar(serverConfig, mainWindow);
        mainWindow.webContents.send('server-log', { serverId, log: `[Manager] ${downloadResult.message}\n` });
        if (!downloadResult.success) {
            mainWindow.webContents.send('server-log', { serverId, log: '[Manager] Auto-Update failed. Starting server with existing file. Please check the Update URL.\n' });
        }
    }
    // ----------------------------------------
    
    const args = (serverConfig.javaArgs || '').split(' ').filter(Boolean);
    
    // USE THE NEW FUNCTION HERE
    const javaExec = getJavaExecutable(serverConfig);

    // 1. Prepare Environment Variables
    // We clone the current process environment so we don't lose system paths
    const serverEnv = { ...process.env };

    // --- UPDATED AUTHENTICATION LOGIC ---
    // Support for Method C: Token Passthrough (from Server Provider Guide)
    if (serverConfig.authSessionToken && serverConfig.authIdentityToken) {
        console.log(`[Manager] Injecting OAuth Tokens for Server ${serverId}`);
        serverEnv['HYTALE_SERVER_SESSION_TOKEN'] = serverConfig.authSessionToken;
        serverEnv['HYTALE_SERVER_IDENTITY_TOKEN'] = serverConfig.authIdentityToken;
    }

    // Keep your existing API Key logic (for the separate Web API features)
    if (serverConfig.hytaleApiKey) {
        console.log(`[Manager] Injecting API Key for Server ${serverId}`);
        serverEnv['HYTALE_API_KEY'] = serverConfig.hytaleApiKey;
    }

    // Inject Payment Settings
    if (serverConfig.enablePayments) {
        serverEnv['HYTALE_PAYMENTS_ENABLED'] = 'true';
        if (serverConfig.merchantId) {
            serverEnv['HYTALE_MERCHANT_ID'] = serverConfig.merchantId;
        }
    }

    // 2. Launch the Server with the new Environment
    const serverProcess = spawn(javaExec, [...args, '-jar', serverConfig.jarFile], { 
        cwd: serverConfig.path,
        env: serverEnv // <--- IMPORTANT: Pass the environment here
    });
    
    runningServers.set(serverId, serverProcess);
    mainWindow.webContents.send('server-state-change', { serverId, isRunning: true });

    // 1. Send START Notification (Green Color: 5763719)
    
    sendDiscordNotification(serverConfig.discordWebhook, `✅ Server "${serverConfig.name}" is Starting...`, 5763719);

    serverProcess.stdout.on('data', (data) => {
        const logLine = data.toString();
        
        // DETECT AUTH REQUEST
        // Log usually looks like: "Please visit https://accounts.hytale.com/device and enter code: ABCD-1234"
        if (logLine.includes('accounts.hytale.com/device')) {
            // Send a special event to the frontend to open a popup
            mainWindow.webContents.send('auth-needed', logLine);
        }
        
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
            
            sendDiscordNotification(serverConfig.discordWebhook, `➡️ ${playerName} joined the server!`, 3447003);
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
        
        sendDiscordNotification(serverConfig.discordWebhook, `🛑 Server "${serverConfig.name}" has stopped.`, 15548997);
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

// --- INSTALLER / UPDATER LOGIC ---
async function downloadServerJar(server, mainWindow) {
    if (!server) return { success: false, message: 'Server configuration not found.' };
    if (!server.updateUrl) return { success: false, message: 'No Download URL is set in server settings.' };

    const jarPath = path.join(server.path, server.jarFile);
    const backupPath = `${jarPath}.bak`;

    // 1. BACKUP: If a jar already exists, rename it to .bak
    if (require('fs').existsSync(jarPath)) {
        try {
            await fs.rename(jarPath, backupPath);
             if (mainWindow) {
                mainWindow.webContents.send('server-log', { serverId: server.id, log: `[Manager] Backed up existing ${server.jarFile} to ${server.jarFile}.bak.\n` });
            }
        } catch (e) {
            return { success: false, message: `Backup failed (file might be in use): ${e.message}` };
        }
    }

    // 2. DOWNLOAD: Fetch the new file
    return new Promise((resolve) => {
        const file = require('fs').createWriteStream(jarPath);
        const request = https.get(server.updateUrl, (response) => {
            if (response.statusCode !== 200) {
                if (require('fs').existsSync(backupPath)) {
                    fs.rename(backupPath, jarPath); // Restore backup
                }
                resolve({ success: false, message: `Download failed (HTTP ${response.statusCode}). Please check the Update URL.` });
                return;
            }

            response.pipe(file);

            file.on('finish', () => {
                file.close();
                if (require('fs').existsSync(backupPath)) {
                    fs.unlink(backupPath, ()=>{}); // Clean up backup file silently
                }
                resolve({ success: true, message: 'Download Complete! Server is updated.' });
            });
        });

        request.on('error', (err) => {
            if (require('fs').existsSync(backupPath)) {
                fs.rename(backupPath, jarPath); // Restore backup
            }
            resolve({ success: false, message: `Network Error during download: ${err.message}` });
        });
    });
}

ipcMain.handle('install-server-jar', async (event, serverId) => {
    const servers = await readServersConfig();
    const server = servers.find(s => s.id === serverId);
    return await downloadServerJar(server, mainWindow);
});

// --- CHECK IF INSTALLED ---
ipcMain.handle('check-jar-exists', async (event, serverId) => {
    const servers = await readServersConfig();
    const server = servers.find(s => s.id === serverId);
    if (!server) return false;
    
    const jarPath = path.join(server.path, server.jarFile);
    return require('fs').existsSync(jarPath);
});

// --- REAL HYTALE INSTALLER LOGIC ---
ipcMain.handle('import-from-launcher', async (event, serverId) => {
    const servers = await readServersConfig();
    const server = servers.find(s => s.id === serverId);
    if (!server) return { success: false, message: 'Server not found.' };

    // 1. Try to Auto-Detect Hytale Install Path (Windows)
    // Common Path: %appdata%\Hytale\install\release\package\game\latest
    const appData = process.env.APPDATA;
    const hytalePaths = [
        path.join(appData, 'Hytale', 'install', 'release', 'package', 'game', 'latest'),
        path.join(appData, 'Hytale', 'Game'), // Alternative path
        'C:\\Hytale\\Game' // Custom install
    ];

    let sourceDir = null;

    // Check which path actually exists
    for (const p of hytalePaths) {
        // We look for 'hytale-server.jar' OR 'Server' folder
        if (require('fs').existsSync(path.join(p, 'hytale-server.jar')) || 
            require('fs').existsSync(path.join(p, 'Server'))) {
            sourceDir = p;
            break;
        }
    }

    if (!sourceDir) {
        return { success: false, message: 'Could not find Hytale installation. Please copy files manually.' };
    }

    // 2. Perform the Copy
    try {
        const destDir = server.path;

        // Copy JAR
        // Note: Sometimes the jar is inside a 'Server' subfolder, sometimes it's in root.
        // We'll check both based on the search results.
        let sourceJar = path.join(sourceDir, 'hytale-server.jar');
        if (!require('fs').existsSync(sourceJar)) {
            sourceJar = path.join(sourceDir, 'Server', 'hytale-server.jar');
        }

        if (require('fs').existsSync(sourceJar)) {
            await fs.copyFile(sourceJar, path.join(destDir, 'hytale-server.jar'));
        } else {
            return { success: false, message: 'Found Hytale folder, but server jar is missing!' };
        }

        // Copy Assets.zip (Crucial for Hytale servers)
        const sourceAssets = path.join(sourceDir, 'Assets.zip');
        if (require('fs').existsSync(sourceAssets)) {
            await fs.copyFile(sourceAssets, path.join(destDir, 'Assets.zip'));
        }

        return { success: true, message: 'Import Successful! Server files copied.' };

    } catch (error) {
        return { success: false, message: 'Import Error: ' + error.message };
    }
});

// --- NEW: HYTALE DOWNLOADER CLI INTEGRATION ---

// 1. Updated Helper: Chooses correct binary based on OS
function getDownloaderPath() {
    // Matches the files you listed: 
    const filename = isWin ? 'hytale-downloader-windows-amd64.exe' : 'hytale-downloader-linux-amd64';
    return path.join(__dirname, 'bin', filename);
}

// --- JAVA AUTO-SETUP (NEW) ---

// Map Node.js platform/arch to Adoptium API values
function getAdoptiumPlatform() {
    const platformMap = { 'win32': 'windows', 'linux': 'linux', 'darwin': 'mac' };
    const archMap = { 'x64': 'x64', 'arm64': 'aarch64' };
    
    return {
        os: platformMap[process.platform],
        arch: archMap[process.arch]
    };
}

// 2. Helper: Archive Extraction (Supports ZIP and TAR.GZ)
async function extractArchive(filePath, destDir) {
    const isZip = filePath.endsWith('.zip');
    
    if (process.platform === 'win32') {
        // Windows: PowerShell for Zip
        if (isZip) {
            return new Promise((resolve, reject) => {
                const cmd = `powershell -command "Expand-Archive -Path '${filePath}' -DestinationPath '${destDir}' -Force"`;
                exec(cmd, (err) => err ? reject(err) : resolve());
            });
        } 
        // Note: Windows doesn't natively handle tar.gz easily without 3rd party tools in older versions, 
        // but Adoptium sends .zip for Windows, so we are safe.
    } else {
        // Linux/Mac
        const cmd = isZip ? `unzip -o "${filePath}" -d "${destDir}"` : `tar -xzf "${filePath}" -C "${destDir}"`;
        return new Promise((resolve, reject) => {
            exec(cmd, (err) => err ? reject(err) : resolve());
        });
    }
}

ipcMain.handle('install-via-cli', async (event, serverId) => {
    const servers = await readServersConfig();
    const server = servers.find(s => s.id === serverId);
    if (!server) return { success: false, message: 'Server not found.' };

    const toolPath = getDownloaderPath();
    
    // Check if tool exists
    try {
        require('fs').accessSync(toolPath);
        
        // Ensure Linux binary is executable
        if (process.platform !== 'win32') {
             try { require('fs').chmodSync(toolPath, '755'); } catch(e) {}
        }
    } catch (e) {
        return { success: false, message: `Downloader Tool not found at: ${toolPath}. Please ensure the binary is in the 'bin' folder.` };
    }

    const cwd = server.path;
    try { await fs.mkdir(cwd, { recursive: true }); } catch (e) {}

    return new Promise((resolve) => {
        mainWindow.webContents.send('server-log', { serverId, log: `[Manager] Launching Hytale Downloader CLI (${path.basename(toolPath)})...
` });

        // Spawn the tool
        const downloader = spawn(toolPath, [], { cwd });

        // Handle Output
        downloader.stdout.on('data', (data) => {
            const line = data.toString();
            mainWindow.webContents.send('server-log', { serverId, log: line });

            if (line.includes('accounts.hytale.com/device')) {
                mainWindow.webContents.send('auth-needed', line);
            }
        });

        downloader.stderr.on('data', (data) => {
            mainWindow.webContents.send('server-log', { serverId, log: `[CLI Error] ${data.toString()}` });
        });

        downloader.on('close', async (code) => {
            if (code === 0) {
                // SUCCESS! Now check if files are zipped.
                const jarExists = require('fs').existsSync(path.join(cwd, 'hytale-server.jar'));
                
                if (!jarExists) {
                    // Look for zips
                    try {
                        const files = await fs.readdir(cwd);
                        const zipFile = files.find(f => f.endsWith('.zip') && !f.includes('Assets')); // Ignore Assets.zip, look for game zip
                        
                        if (zipFile) {
                            mainWindow.webContents.send('server-log', { serverId, log: `[Manager] Found ${zipFile}. Extracting...\n` });
                            try {
                                await extractZip(path.join(cwd, zipFile), cwd);
                                mainWindow.webContents.send('server-log', { serverId, log: `[Manager] Extraction complete.\n` });
                                resolve({ success: true, message: 'Download & Extraction finished successfully.' });
                                return;
                            } catch (err) {
                                mainWindow.webContents.send('server-log', { serverId, log: `[Manager] Extraction failed: ${err.message}\n` });
                                resolve({ success: false, message: 'Download finished, but unzip failed.' });
                                return;
                            }
                        }
                    } catch (e) {}
                }

                resolve({ success: true, message: 'Hytale Downloader finished successfully.' });
            } else {
                resolve({ success: false, message: `Downloader failed with exit code ${code}. Check logs.` });
            }
        });
        
        downloader.on('error', (err) => {
             resolve({ success: false, message: `Failed to start downloader: ${err.message}` });
        });
    });
});
// --- HYTALE OFFICIAL API INTEGRATION ---

// Helper for Hytale API Calls
async function hytaleApiRequest(endpoint, apiKey, params = {}) {
    // Fictional Hytale API Base URL based on your doc
    const BASE_URL = 'https://api.hytale.com/v1'; 
    
    const url = new URL(`${BASE_URL}/${endpoint}`);
    Object.keys(params).forEach(key => url.searchParams.append(key, params[key]));

    try {
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'User-Agent': 'HytaleServerManager/1.0'
            }
        });

        if (!response.ok) {
            return { success: false, error: `API Error ${response.status}: ${response.statusText}` };
        }
        
        const data = await response.json();
        return { success: true, data };
    } catch (e) {
        return { success: false, error: e.message };
    }
}

// 1. UUID Lookup Handler
ipcMain.handle('lookup-hytale-player', async (event, { serverId, playerName }) => {
    const servers = await readServersConfig();
    const server = servers.find(s => s.id === serverId);
    
    if (!server || !server.hytaleApiKey) {
        return { success: false, error: 'Missing Server API Key' };
    }

    // Call the "UUID <-> Name Lookup" endpoint
    const result = await hytaleApiRequest('profiles/lookup', server.hytaleApiKey, { name: playerName });
    
    if (result.success) {
        // Assuming API returns { id: "...", name: "..." }
        return { success: true, profile: result.data };
    }
    return result;
});

// 2. Version Check Handler
ipcMain.handle('check-hytale-version', async (event, serverId) => {
    // This endpoint might be public, but using API Key ensures better rate limits
    const servers = await readServersConfig();
    const server = servers.find(s => s.id === serverId);
    const apiKey = server ? server.hytaleApiKey : null; // Optional?

    return await hytaleApiRequest('version/latest', apiKey);
});

// Add this near your other Hytale API handlers
ipcMain.handle('report-hytale-player', async (event, { serverId, playerId, reason }) => {
    const servers = await readServersConfig();
    const server = servers.find(s => s.id === serverId);
    
    if (!server || !server.hytaleApiKey) {
        return { success: false, error: 'Server API Key is required to submit reports.' };
    }

    // Call the Hytale "Report" endpoint
    // Note: 'playerId' should be the UUID, not the name
    return await hytaleApiRequest('reports/submit', server.hytaleApiKey, { 
        targetId: playerId,
        reason: reason,
        timestamp: new Date().toISOString()
    });
});


// --- TOOL AUTO-SETUP (NEW) ---

const CLI_TOOL_URL = 'https://downloader.hytale.com/hytale-downloader.zip';

// 1. Check if the tool exists
ipcMain.handle('check-cli-tool', async () => {
    const toolPath = getDownloaderPath();
    try {
        require('fs').accessSync(toolPath);
        return true;
    } catch {
        return false;
    }
});

// 2. Download and Install the Tool
ipcMain.handle('download-cli-tool', async (event) => {
    const binDir = path.join(__dirname, 'bin');
    const zipPath = path.join(binDir, 'hytale-downloader.zip');

    // Ensure bin exists
    try { await fs.mkdir(binDir, { recursive: true }); } catch (e) {}

    // A. Download the ZIP
    mainWindow.webContents.send('tool-download-status', 'Downloading tool from hytale.com...');
    
    try {
        await new Promise((resolve, reject) => {
            const file = require('fs').createWriteStream(zipPath);
            https.get(CLI_TOOL_URL, (response) => {
                if (response.statusCode !== 200) {
                    reject(new Error(`Download failed: HTTP ${response.statusCode}`));
                    return;
                }
                response.pipe(file);
                file.on('finish', () => {
                    file.close();
                    resolve();
                });
            }).on('error', (err) => {
                fs.unlink(zipPath, () => {});
                reject(err);
            });
        });

        // B. Extract it
        mainWindow.webContents.send('tool-download-status', 'Extracting tool...');
        await extractArchive(zipPath, binDir);

        // C. Cleanup
        await fs.unlink(zipPath);

        // D. Verify
        const toolPath = getDownloaderPath();
        if (require('fs').existsSync(toolPath)) {
            // Linux permission fix
            if (process.platform !== 'win32') {
                try { require('fs').chmodSync(toolPath, '755'); } catch(e) {}
            }
            return { success: true };
        } else {
            return { success: false, message: 'Extraction finished but binary not found.' };
        }

    } catch (error) {
        return { success: false, message: error.message };
    }
});

// Helper to open file dialog for specific files (JARs)
ipcMain.handle('select-file', async (event, filter) => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: filter ? [filter] : []
    });
    return result.filePaths[0];
});

// --- JAVA AUTO-SETUP (NEW) ---

ipcMain.handle('check-java-installed', async () => {
    // 1. Check Bundled
    const bundledPath = path.join(__dirname, 'jre', 'bin', isWin ? 'java.exe' : 'java');
    if (require('fs').existsSync(bundledPath)) return { installed: true, type: 'bundled' };

    // 2. Check Global (Optional: strict users might prefer we only use bundled)
    return new Promise((resolve) => {
        exec('java -version', (err) => {
            if (!err) resolve({ installed: true, type: 'global' });
            else resolve({ installed: false });
        });
    });
});

ipcMain.handle('download-java', async () => {
    const { os, arch } = getAdoptiumPlatform();
    if (!os || !arch) return { success: false, message: 'Unsupported Platform' };

    // Adoptium API Endpoint for Latest Java 25 (GA)
    // Ref: https://api.adoptium.net/q/swagger-ui/#/Binary/getBinary
    const apiUrl = `https://api.adoptium.net/v3/binary/latest/25/ga/${os}/${arch}/jdk/hotspot/normal/eclipse`;

    const jreDir = path.join(__dirname, 'jre');
    const tempFile = path.join(__dirname, os === 'windows' ? 'java_temp.zip' : 'java_temp.tar.gz');

    try {
        // 1. Prepare Folders
        try { await fs.rm(jreDir, { recursive: true, force: true }); } catch(e) {}
        await fs.mkdir(jreDir, { recursive: true });

        // 2. Download
        mainWindow.webContents.send('tool-download-status', 'Fetching Java 25 from Adoptium...');
        await new Promise((resolve, reject) => {
            const file = require('fs').createWriteStream(tempFile);
            https.get(apiUrl, (res) => {
                if (res.statusCode === 302 || res.statusCode === 307) {
                    // Handle Redirects (Adoptium API redirects to Github/Cloudflare)
                    https.get(res.headers.location, (redirectRes) => {
                        if (redirectRes.statusCode !== 200) { reject(new Error('Download failed')); return; }
                        redirectRes.pipe(file);
                        file.on('finish', () => { file.close(); resolve(); });
                    }).on('error', reject);
                } else if (res.statusCode !== 200) {
                    reject(new Error(`API Error: ${res.statusCode}`));
                } else {
                    res.pipe(file);
                    file.on('finish', () => { file.close(); resolve(); });
                }
            }).on('error', reject);
        });

        // 3. Extract
        mainWindow.webContents.send('tool-download-status', 'Extracting Java...');
        await extractArchive(tempFile, jreDir);

        // 4. Flatten Directory
        // The zip usually contains a root folder like "jdk-25.0.1+8". We want the contents of that DIRECTLY in 'jre'.
        const files = await fs.readdir(jreDir);
        if (files.length === 1 && (await fs.stat(path.join(jreDir, files[0]))).isDirectory()) {
            const nestedDir = path.join(jreDir, files[0]);
            const children = await fs.readdir(nestedDir);
            
            for (const child of children) {
                await fs.rename(path.join(nestedDir, child), path.join(jreDir, child));
            }
            await fs.rm(nestedDir, { recursive: true });
        }

        // 5. Cleanup
        await fs.unlink(tempFile);
        
        // 6. Permission Fix (Linux/Mac)
        if (!isWin) { // Use the global isWin
            const javaBin = path.join(jreDir, 'bin', 'java');
            try { await fs.chmod(javaBin, 0o755); } catch(e) {}
        }

        return { success: true };

    } catch (e) {
        return { success: false, message: e.message };
    }
});

// --- Discord Helper ---
async function sendDiscordNotification(webhookUrl, message, color) {
    if (!webhookUrl || webhookUrl.trim() === "") return;

    const payload = {
        embeds: [{
            description: message,
            color: color, // Decimal color code (e.g., Green: 5763719, Red: 15548997)
            timestamp: new Date().toISOString()
        }]
    };

    const url = new URL(webhookUrl);
    const options = {
        hostname: url.hostname,
        path: url.pathname,
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        }
    };

    const req = https.request(options, (res) => {
        // We generally don't care about the response for notifications
        // unless you want to log errors
    });

    req.on('error', (e) => {
        console.error(`[Discord] Notification failed: ${e.message}`);
    });

    req.write(JSON.stringify(payload));
    req.end();
}

// --- NETWORK & PERFORMANCE AUTOMATION ---

// 1. One-Click Firewall Setup (Windows Only)
ipcMain.handle('setup-firewall', async (event, port = 5520) => {
    if (process.platform !== 'win32') {
        return { success: false, message: 'Automated firewall setup is currently Windows-only. On Linux, use: sudo ufw allow 5520/udp' };
    }

    // PowerShell command to add the rule. 
    // We use "Start-Process -Verb RunAs" to trigger the UAC Admin Prompt automatically.
    const ruleName = `Hytale Server (UDP ${port})`;
    const psCommand = `New-NetFirewallRule -DisplayName '${ruleName}' -Direction Inbound -Protocol UDP -LocalPort ${port} -Action Allow`;
    const fullCommand = `powershell -Command "Start-Process powershell -Verb RunAs -ArgumentList \\"-NoProfile -ExecutionPolicy Bypass -Command ${psCommand}\\""`;

    return new Promise((resolve) => {
        exec(fullCommand, (error) => {
            if (error) {
                resolve({ success: false, message: `Failed to trigger firewall setup: ${error.message}` });
            } else {
                // We can't easily know if they clicked "Yes" on UAC, but if the command launched, it's a good sign.
                resolve({ success: true, message: 'Windows Firewall prompt launched! Click "Yes" to allow the port.' });
            }
        });
    });
});

// 2. Public IP Fetcher
ipcMain.handle('get-public-ip', async () => {
    return new Promise((resolve) => {
        https.get('https://api.ipify.org?format=json', (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    const json = JSON.parse(data);
                    resolve(json.ip);
                } catch {
                    resolve('Unknown');
                }
            });
        }).on('error', () => resolve('Error'));
    });
});

// 3. AOT Cache Detection
ipcMain.handle('check-aot-file', async (event, serverId) => {
    const servers = await readServersConfig();
    const server = servers.find(s => s.id === serverId);
    if (!server) return false;
    
    // The manual says the file is named "HytaleServer.aot"
    const aotPath = path.join(server.path, 'HytaleServer.aot');
    return require('fs').existsSync(aotPath);
});