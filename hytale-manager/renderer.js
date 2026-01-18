document.addEventListener('DOMContentLoaded', () => {
    // --- Global State ---
    let servers = [];
    let activeServerId = null;
    let serverStates = new Map(); // serverId -> { isRunning: boolean, console: string }

    // --- DOM Elements ---
    const serverList = document.getElementById('serverList');
    const welcomeView = document.getElementById('welcomeView');
    const serverView = document.getElementById('serverView');
    const initialAddServerBtn = document.getElementById('initialAddServerBtn');
    
    // Server View Elements
    const startButton = document.getElementById('startButton');
    const stopButton = document.getElementById('stopButton');
    const commandInput = document.getElementById('commandInput');
    const consoleDiv = document.getElementById('console');
    const serverNameTitle = document.getElementById('serverNameTitle');
    const backupButton = document.getElementById('backupButton');
    const deleteButton = document.getElementById('deleteButton'); 

    // Modal Elements
    const modal = document.getElementById('serverModal');
    const addServerBtn = document.getElementById('addServerBtn');
    const closeModalBtn = document.querySelector('.close-button');
    const serverForm = document.getElementById('serverForm');
    const modalTitle = document.getElementById('modalTitle');
    const serverIdInput = document.getElementById('serverId');
    const serverNameInput = document.getElementById('serverNameInput');
    const serverPathInput = document.getElementById('serverPathInput');
    const jarFileInput = document.getElementById('jarFileInput');
    const javaArgsInput = document.getElementById('javaArgsInput');
    const javaPathInput = document.getElementById('javaPathInput');
    const browseBtn = document.getElementById('browseBtn');
    const discordWebhookInput = document.getElementById('discordWebhookInput');
    const uptimeBadge = document.getElementById('uptimeBadge');

    // Hytale Cloud Settings Elements
    const hytaleApiKeyInput = document.getElementById('hytaleApiKeyInput');
    const enablePaymentsCheckbox = document.getElementById('enablePaymentsCheckbox');
    const paymentSettings = document.getElementById('paymentSettings');
    const merchantIdInput = document.getElementById('merchantIdInput');

    // Toggle Visibility for Payment Settings
    if (enablePaymentsCheckbox) {
        enablePaymentsCheckbox.addEventListener('change', () => {
            paymentSettings.style.display = enablePaymentsCheckbox.checked ? 'block' : 'none';
        });
    }

    // Add these to the top list
    const editSettingsBtn = document.getElementById('editSettingsBtn');
    const installBtn = document.getElementById('installBtn');
    const updateUrlInput = document.getElementById('updateUrlInput');
    const autoUpdateCheckbox = document.getElementById('autoUpdateCheckbox');

    // Add to Elements
    const importFromLauncherBtn = document.getElementById('importFromLauncherBtn');

    // --- Global Timer Variable ---
    let uptimeInterval = null;
    let serverStartTime = null;



    // --- UI Update Functions ---

    function renderServerList() {
        serverList.innerHTML = '';
        if (servers.length === 0) {
            welcomeView.style.display = 'flex';
            serverView.style.display = 'none';
            return;
        }
        
        welcomeView.style.display = 'none';

        servers.forEach(server => {
            const li = document.createElement('li');
            li.textContent = server.name;
            li.dataset.serverId = server.id;
            if (server.id === activeServerId) {
                li.classList.add('active');
            }
            
            li.addEventListener('dblclick', () => {
                window.electronAPI.openFolder(server.path);
            });
            li.title = "Double-click to open server folder";

            serverList.appendChild(li);
        });
    }

    async function updateServerView() {
        if (!activeServerId) {
            serverView.style.display = 'none';
            return;
        }
        serverView.style.display = 'flex';

        const server = servers.find(s => s.id === activeServerId);
        const state = serverStates.get(activeServerId) || { isRunning: false, console: '' };
        
        serverNameTitle.textContent = server.name;
        consoleDiv.textContent = state.console;
        consoleDiv.scrollTop = consoleDiv.scrollHeight;
        
        stopButton.disabled = !state.isRunning;
        commandInput.disabled = !state.isRunning;
        commandInput.placeholder = state.isRunning ? "Enter server command..." : "Server is offline.";

        // CHECK INSTALL STATUS
        const isInstalled = await window.electronAPI.checkJarExists(activeServerId);
        
        if (installBtn) {
            if (!isInstalled) {
                installBtn.textContent = "⬇ Install Server";
                installBtn.style.backgroundColor = "#e67e22"; // Orange
                installBtn.title = "Server JAR is missing. Click to download.";
                startButton.disabled = true; // Cannot start if not installed
                startButton.textContent = "Install First";
            } else {
                installBtn.textContent = "↻ Update Server";
                installBtn.style.backgroundColor = "#2980b9"; // Blue
                startButton.textContent = "Start Server";
                // Start button disabled state handles itself based on isRunning
                startButton.disabled = state.isRunning;
            }
        }
    }

    async function switchActiveServer(serverId) {
        if (activeServerId === serverId) return;
        activeServerId = serverId;
        
        // Clear old timer
        stopUptimeTimer(); 
        
        // If the new server is already running, we might not know its start time exactly 
        // without more complex backend logic, but we can just show "Running" or 
        // reset the timer to 00:00:00 for now to keep it simple.
        const state = serverStates.get(serverId);
        if(state && state.isRunning) {
             serverStartTime = Date.now(); // Reset counter for viewing session
             startUptimeTimer();
        }

        renderServerList();
        updateServerView();
    }

    // --- Modal Logic ---

    function showModal(server = null) {
        serverForm.reset();
        if (server) {
            modalTitle.textContent = 'Edit Server';
            serverIdInput.value = server.id;
            serverNameInput.value = server.name;
            serverPathInput.value = server.path;
            jarFileInput.value = server.jarFile;
            javaArgsInput.value = server.javaArgs || '';
            javaPathInput.value = server.javaPath || '';
            discordWebhookInput.value = server.discordWebhook || '';
            updateUrlInput.value = server.updateUrl || '';
            autoUpdateCheckbox.checked = server.autoUpdate || false;

            // Load Hytale Cloud Settings
            hytaleApiKeyInput.value = server.hytaleApiKey || '';
            enablePaymentsCheckbox.checked = server.enablePayments || false;
            merchantIdInput.value = server.merchantId || '';
            // Trigger visual state
            paymentSettings.style.display = server.enablePayments ? 'block' : 'none';
        } else {
            modalTitle.textContent = 'Add a New Server';
            serverIdInput.value = '';
            discordWebhookInput.value = '';
        }
        modal.style.display = 'flex';
    }

    function hideModal() {
        modal.style.display = 'none';
    }

    // --- Event Listeners ---

    serverList.addEventListener('click', (e) => {
        if (e.target.tagName === 'LI') {
            switchActiveServer(e.target.dataset.serverId);
        }
    });

    addServerBtn.addEventListener('click', () => showModal());
    initialAddServerBtn.addEventListener('click', () => showModal());
    closeModalBtn.addEventListener('click', hideModal);
    window.addEventListener('click', (e) => {
        if (e.target === modal) hideModal();
    });

    if(browseBtn) {
        browseBtn.addEventListener('click', async () => {
            const path = await window.electronAPI.selectDirectory();
            if (path) serverPathInput.value = path;
        });
    }

    if(deleteButton) {
        deleteButton.addEventListener('click', async () => {
            if (!activeServerId) return;

            if (confirm("Permanently remove this server from the manager?")) {
                const deleteFiles = confirm("Also delete all server files from the disk? This cannot be undone.");
                await window.electronAPI.deleteServer({ serverId: activeServerId, deleteFiles });
                activeServerId = null;
                loadServers();
            }
        });
    }

    if(backupButton) {
        backupButton.addEventListener('click', async () => {
            if (!activeServerId) return;
            
            backupButton.disabled = true;
            backupButton.textContent = "Backing up...";
            
            const result = await window.electronAPI.backupServer(activeServerId);
            
            alert(result.message);
            
            backupButton.disabled = false;
            backupButton.textContent = "Backup World";
        });
    }

    const openBackupsBtn = document.getElementById('openBackupsBtn');
    if (openBackupsBtn) {
        openBackupsBtn.addEventListener('click', () => {
            if (!activeServerId) return;
            window.electronAPI.openBackupFolder(activeServerId);
        });
    }

    if(editSettingsBtn) {
        editSettingsBtn.addEventListener('click', () => {
            if(!activeServerId) return;
            const server = servers.find(s => s.id === activeServerId);
            showModal(server); // Reuses your existing modal!
        });
    }

// Add Listener
if (importFromLauncherBtn) {
    importFromLauncherBtn.addEventListener('click', async () => {
        // We need a temporary or active ID. If creating new, we might not have ID yet.
        // For simplicity, this button works best on "Edit Server" (Active ID).
        if (!activeServerId && serverIdInput.value === "") {
            alert("Please save the server first, then Edit it to import files.");
            return;
        }

        // Use the ID from the form or active
        const targetId = activeServerId || serverIdInput.value;

        importFromLauncherBtn.disabled = true;
        importFromLauncherBtn.textContent = "Searching & Copying...";

        const result = await window.electronAPI.importFromLauncher(targetId);

        alert(result.message);

        importFromLauncherBtn.disabled = false;
        importFromLauncherBtn.textContent = "📥 Import from Hytale Launcher";
    });
}

// --- CONFIG EDITOR LOGIC (Hybrid) ---

// Elements
const configModal = document.getElementById('configModal');
const closeConfigBtn = document.querySelector('.close-config');
const configFileSelect = document.getElementById('configFileSelect');
const loadConfigBtn = document.getElementById('loadConfigBtn');
const saveConfigBtn = document.getElementById('saveConfigBtn');
const toggleViewBtn = document.getElementById('toggleViewBtn');

// Views
const configFormView = document.getElementById('configFormView');
const configEditor = document.getElementById('configEditor');

// State
let isTextMode = false;
let currentFileType = 'properties'; // 'properties' or 'json'

// 1. Open/Close Logic
if(document.getElementById('configBtn')) {
    document.getElementById('configBtn').addEventListener('click', () => {
        if(!activeServerId) return;
        configModal.style.display = 'flex';
        // Reset to GUI mode by default
        isTextMode = false;
        updateViewMode(); 
        loadConfig();
    });
}

if(closeConfigBtn) {
    closeConfigBtn.addEventListener('click', () => configModal.style.display = 'none');
}

// 2. Toggle View Logic
if(toggleViewBtn) {
    toggleViewBtn.addEventListener('click', () => {
        // Sync data before switching
        if (isTextMode) {
            // Text -> Form (Try to parse)
            try {
                generateFormFromText(configEditor.value);
                isTextMode = false;
            } catch (e) {
                alert("Cannot switch to GUI: Syntax Error in text.\n" + e.message);
                return;
            }
        } else {
            // Form -> Text
            configEditor.value = generateTextFromForm();
            isTextMode = true;
        }
        updateViewMode();
    });
}

function updateViewMode() {
    if (isTextMode) {
        configFormView.style.display = 'none';
        configEditor.style.display = 'block';
        toggleViewBtn.textContent = "Switch to GUI Mode";
    } else {
        configFormView.style.display = 'grid';
        configEditor.style.display = 'none';
        toggleViewBtn.textContent = "Switch to Text Mode";
    }
}

// 3. Load & Save Logic
if(loadConfigBtn) loadConfigBtn.addEventListener('click', loadConfig);

async function loadConfig() {
    if(!activeServerId) return;
    const filename = configFileSelect.value;
    
    // Detect type based on extension
    currentFileType = filename.endsWith('.json') ? 'json' : 'properties';

    const result = await window.electronAPI.readFile({ serverId: activeServerId, filename });
    
    if(result.success) {
        configEditor.value = result.content; // Always load into text area first
        generateFormFromText(result.content); // Then try to generate GUI
    } else {
        configEditor.value = "";
        generateFormFromText(""); 
    }
}

if(saveConfigBtn) {
    saveConfigBtn.addEventListener('click', async () => {
        if(!activeServerId) return;
        
        // Ensure we save the latest data depending on which view is open
        const contentToSave = isTextMode ? configEditor.value : generateTextFromForm();
        
        const result = await window.electronAPI.saveFile({ 
            serverId: activeServerId, 
            filename: configFileSelect.value, 
            content: contentToSave 
        });
        
        if(result.success) alert("File Saved!");
        else alert("Error: " + result.error);
    });
}

// --- 4. The "Smart Parser" (GUI Generator) ---

function generateFormFromText(text) {
    configFormView.innerHTML = ''; // Clear existing
    
    if(!text || text.trim() === "") {
        configFormView.innerHTML = '<p style="color:#888; padding:20px;">File is empty.</p>';
        return;
    }

    let data = {};

    // PARSE: Handle JSON vs Properties
    if (currentFileType === 'json') {
        try {
            data = JSON.parse(text);
        } catch(e) {
            configFormView.innerHTML = '<p style="color:red; padding:20px;">Invalid JSON. Please fix in Text Mode.</p>';
            return;
        }
    } else {
        // Properties Parser (key=value)
        text.split('\n').forEach(line => {
            line = line.trim();
            if(line && !line.startsWith('#')) { // Ignore comments
                const parts = line.split('=');
                if(parts.length >= 2) {
                    const key = parts[0].trim();
                    const val = parts.slice(1).join('=').trim(); // Rejoin in case value has =
                    data[key] = val;
                }
            }
        });
    }

    // BUILD: Create Inputs
    for (const [key, value] of Object.entries(data)) {
        // Skip complex objects/arrays in GUI mode for now
        if (typeof value === 'object' && value !== null) continue;

        const item = document.createElement('div');
        item.className = 'config-item';
        
        const label = document.createElement('label');
        label.textContent = key.replace(/_/g, ' ').toUpperCase(); // Make "server_port" look like "SERVER PORT"
        
        const input = document.createElement('input');
        input.type = 'text';
        input.value = value;
        input.dataset.key = key; // Store original key name
        
        // Heuristics for input types
        if(value === 'true' || value === 'false' || value === true || value === false) {
            // Maybe make this a checkbox later, for now text is fine
        }
        
        item.appendChild(label);
        item.appendChild(input);
        configFormView.appendChild(item);
    }
}

function generateTextFromForm() {
    // If we are in text mode, trust the text editor
    if(isTextMode) return configEditor.value;

    // Otherwise, rebuild string from inputs
    const inputs = configFormView.querySelectorAll('input');
    
    if (currentFileType === 'json') {
        let obj = {};
        inputs.forEach(input => {
            let val = input.value;
            // Restore numbers/booleans types if possible
            if(val === 'true') val = true;
            if(val === 'false') val = false;
            if(!isNaN(val) && val !== '') val = Number(val);
            
            obj[input.dataset.key] = val;
        });
        return JSON.stringify(obj, null, 2);
    } 
    else {
        // Properties Builder
        let text = "";
        inputs.forEach(input => {
            text += `${input.dataset.key}=${input.value}\n`;
        });
        return text;
    }
}
    serverForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const serverData = {
            id: serverIdInput.value,
            name: serverNameInput.value,
            path: serverPathInput.value,
            jarFile: jarFileInput.value,
            javaArgs: javaArgsInput.value,
            javaPath: javaPathInput.value,
            discordWebhook: discordWebhookInput.value.trim(),
            updateUrl: updateUrlInput.value.trim(),
            autoUpdate: autoUpdateCheckbox.checked,
            hytaleApiKey: hytaleApiKeyInput.value.trim(),
            enablePayments: enablePaymentsCheckbox.checked,
            merchantId: merchantIdInput.value.trim()
        };

        if (serverData.id) { // Update existing
            await window.electronAPI.updateServer(serverData);
        } else { // Add new
            await window.electronAPI.addServer(serverData);
        }
        
        hideModal();
        await loadServers();
    });

    startButton.addEventListener('click', () => {
        if (activeServerId) {
            window.electronAPI.startServer(activeServerId);
        }
    });

    stopButton.addEventListener('click', () => {
        if (activeServerId) {
            window.electronAPI.stopServer(activeServerId);
        }
    });

    commandInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && activeServerId) {
            const command = commandInput.value.trim();
            if (command) {
                window.electronAPI.sendCommand({ serverId: activeServerId, command });
                commandInput.value = '';
            }
        }
    });

    function addLog(log) {
        if (!activeServerId || !serverStates.has(activeServerId)) return;
        const state = serverStates.get(activeServerId);
        state.console += log;
        if (state.console.length > 20000) {
            state.console = state.console.substring(state.console.length - 15000);
        }
        consoleDiv.textContent = state.console;
        consoleDiv.scrollTop = consoleDiv.scrollHeight;
    }

    if (installBtn) {
        installBtn.addEventListener('click', async () => {
            if (!activeServerId) return;
    
            // UI Feedback
            const originalText = installBtn.textContent;
            installBtn.disabled = true;
            installBtn.textContent = "Checking...";

            const versionData = await window.electronAPI.checkHytaleVersion(activeServerId);
            if (versionData.success) {
                if (!confirm(`The latest version is "${versionData.data.name}". Do you want to download it?`)) {
                    installBtn.disabled = false;
                    installBtn.textContent = originalText;
                    return;
                }
            } else {
                // If version check fails, ask to proceed anyway
                if (!confirm(`Could not verify the latest version. Proceed with download anyway?`)) {
                    installBtn.disabled = false;
                    installBtn.textContent = originalText;
                    return;
                }
            }
            
            installBtn.textContent = "Downloading...";
            
            // Log
            addLog('[Manager] Starting download...\n');
    
            // Run Install
            const result = await window.electronAPI.installServerJar(activeServerId);
            
            alert(result.message);
            addLog(`[Manager] ${result.message}\n`);
    
            // Reset UI
            installBtn.disabled = false;
            installBtn.textContent = originalText;
            updateServerView(); // Refresh button state (Install -> Update)
        });
    }

    // --- IPC Handlers ---

    window.electronAPI.onServerLog(({ serverId, log }) => {
        if (!serverStates.has(serverId)) return;
        
        // Check if it's the Auth Message (Simple check)
        if (log.includes('accounts.hytale.com/device')) {
            // Extract URL and Code roughly
            alert("ACTION REQUIRED:\n\nThe server needs you to log in.\n\nCheck the console for the Link and Code!");
        }
        
        const state = serverStates.get(serverId);
        state.console += log;
        
        if (state.console.length > 20000) {
            state.console = state.console.substring(state.console.length - 15000);
        }

        if (serverId === activeServerId) {
            consoleDiv.textContent = state.console;
            consoleDiv.scrollTop = consoleDiv.scrollHeight;
        }
    });

    window.electronAPI.onServerStateChange(({ serverId, isRunning }) => {
        if (!serverStates.has(serverId)) return;
        
        serverStates.get(serverId).isRunning = isRunning;
        if (serverId === activeServerId) {
            updateServerView();
            
            // Handle Uptime Timer
            if (isRunning) {
                serverStartTime = Date.now(); // Roughly when we got the signal
                startUptimeTimer();
            } else {
                stopUptimeTimer();
            }
        }
    });

// 4. Timer Functions
function startUptimeTimer() {
    if (uptimeInterval) clearInterval(uptimeInterval);
    uptimeBadge.style.display = 'block';
    
    uptimeInterval = setInterval(() => {
        if (!serverStartTime) return;
        
        const diff = Date.now() - serverStartTime;
        
        // Convert to HH:MM:SS
        const seconds = Math.floor((diff / 1000) % 60).toString().padStart(2, '0');
        const minutes = Math.floor((diff / (1000 * 60)) % 60).toString().padStart(2, '0');
        const hours = Math.floor(diff / (1000 * 60 * 60)).toString().padStart(2, '0');
        
        uptimeBadge.textContent = `Online: ${hours}:${minutes}:${seconds}`;
        uptimeBadge.style.color = '#4CAF50'; // Green text
    }, 1000);
}

function stopUptimeTimer() {
    if (uptimeInterval) clearInterval(uptimeInterval);
    uptimeBadge.style.display = 'none';
}

// --- PLAYER MANAGER LOGIC ---

// Elements
const playerManagerBtn = document.getElementById('playerManagerBtn');
const playerModal = document.getElementById('playerModal');
const closePlayerBtn = document.querySelector('.close-player');
const playerList = document.getElementById('playerList');
const newPlayerInput = document.getElementById('newPlayerInput');
const addPlayerBtn = document.getElementById('addPlayerBtn');
const tabButtons = document.querySelectorAll('.tab-btn');

// State
let currentListFile = 'whitelist.json';
let currentPlayerList = []; // Holds the current array of data

// 1. Open Modal
if(playerManagerBtn) {
    playerManagerBtn.addEventListener('click', () => {
        if(!activeServerId) return;
        playerModal.style.display = 'flex';
        loadPlayerList(currentListFile);
    });
}

if(closePlayerBtn) {
    closePlayerBtn.addEventListener('click', () => playerModal.style.display = 'none');
}

// 2. Tab Switching
tabButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
        // UI Update
        tabButtons.forEach(b => b.classList.remove('active'));
        e.target.classList.add('active');
        
        // Logic Update
        currentListFile = e.target.dataset.file;
        loadPlayerList(currentListFile);
    });
});

// 3. Load List Function
async function loadPlayerList(filename) {
    playerList.innerHTML = '<li style="padding:20px; text-align:center; color:#888;">Loading...</li>';
    newPlayerInput.value = '';
    
    const result = await window.electronAPI.readFile({ serverId: activeServerId, filename });
    
    if (result.success) {
        try {
            // Hytale/MC lists are usually JSON arrays: [{"name":"Player"}, ...] or just ["Player", ...]
            // We'll support both formats for robustness
            const json = JSON.parse(result.content);
            currentPlayerList = Array.isArray(json) ? json : [];
        } catch (e) {
            currentPlayerList = []; // File exists but is corrupt/empty
        }
    } else {
        currentPlayerList = []; // File doesn't exist yet (new server)
    }

    renderPlayerList();
}

// 4. Render List
function renderPlayerList() {
    playerList.innerHTML = '';
    
    if (currentPlayerList.length === 0) {
        playerList.innerHTML = '<li style="padding:20px; text-align:center; color:#666;">List is empty.</li>';
        return;
    }

    // Check if we are viewing the History tab (which has timestamps)
    const isHistoryTab = currentListFile === 'player-history.json';

    currentPlayerList.forEach((entry, index) => {
        // Handle different formats (Simple String vs Object)
        const name = typeof entry === 'string' ? entry : entry.name;
        const uuid = entry.uuid; // Get UUID from our stored object
        
        const li = document.createElement('li');
        li.className = 'player-item';
        
        let infoHtml = `<span style="color: white; font-weight: bold;">${name}</span>`;

        // If this is the History tab, show the Last Seen date
        if (isHistoryTab && entry.lastSeen) {
            const date = new Date(entry.lastSeen).toLocaleString();
            const statusColor = entry.lastAction === 'join' ? '#4CAF50' : '#888';
            infoHtml += `
                <div style="font-size: 0.8em; color: #aaa; text-align: right;">
                    <span style="color: ${statusColor}; margin-right: 10px;">● ${entry.lastAction === 'join' ? 'Online' : 'Offline'}</span>
                    Last Seen: ${date}
                </div>
            `;
        }

        // Only show "Remove" and "Report" buttons if it's NOT the history tab
        const removeBtn = !isHistoryTab ? 
            `<button class="remove-player-btn" data-index="${index}">&times;</button>` : 
            ``;
        const reportBtn = !isHistoryTab ? 
            `<button class="report-player-btn" data-name="${name}" data-uuid="${uuid}" style="background: #d9534f; color: white; border: none; margin-right: 5px;">Report</button>` :
            ``;

        li.innerHTML = `
            <div style="display:flex; justify-content:space-between; width:100%; align-items:center;">
                ${infoHtml}
                <div>
                    ${reportBtn} 
                    ${removeBtn}
                </div>
            </div>
        `;
        
        playerList.appendChild(li);
    });

    // Re-attach listeners
    if (!isHistoryTab) {
        document.querySelectorAll('.remove-player-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                removePlayer(e.target.dataset.index);
            });
        });

        document.querySelectorAll('.report-player-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const name = e.target.dataset.name;
                const uuid = e.target.dataset.uuid;
                const reason = prompt(`Report ${name} to Hytale Admin?\n\nEnter a reason for the report:`);
                
                if (reason) {
                    if (!uuid || uuid === "offline-uuid") {
                        alert(`Cannot report "${name}": Player UUID is not available. This can happen if the player was added in offline mode.`);
                        return;
                    }
                    const result = await window.electronAPI.reportPlayer(activeServerId, uuid, reason);
                    const message = result.error || (result.success ? "Report submitted successfully!" : "Failed to submit report.");
                    alert(message);
                }
            });
        });
    }
}

// 5. Add Player Logic
addPlayerBtn.addEventListener('click', async () => {
    const nameInput = newPlayerInput.value.trim();
    if (!nameInput) return;

    // UI Feedback
    addPlayerBtn.disabled = true;
    addPlayerBtn.textContent = "Verifying...";

    let playerProfile = { name: nameInput, id: null }; // Default to offline if lookup fails

    // 1. Try to fetch UUID from Hytale API
    // We need to know if we have an API key first
    const servers = await window.electronAPI.getServers(); // Or cache this
    const server = servers.find(s => s.id === activeServerId);

    if (server && server.hytaleApiKey) {
        const result = await window.electronAPI.lookupHytalePlayer({ 
            serverId: activeServerId, 
            playerName: nameInput 
        });

        if (result.success) {
            playerProfile = result.profile; // Uses the official Name and UUID
            console.log("Verified Hytale Profile:", playerProfile);
        } else {
            // Optional: Warn user if verification failed
            if(!confirm(`Could not verify "${nameInput}" with Hytale API. \nError: ${result.error}\n\nAdd anyway (Offline Mode)?`)) {
                addPlayerBtn.disabled = false;
                addPlayerBtn.textContent = "Add";
                return;
            }
        }
    }

    // 2. Add to List
    const newEntry = {
        name: playerProfile.name,
        uuid: playerProfile.id || "offline-uuid", // Hytale servers require UUIDs
        created: new Date().toISOString(),
        source: "Manager"
    };

    currentPlayerList.push(newEntry);
    await savePlayerList();
    
    // Reset UI
    newPlayerInput.value = '';
    addPlayerBtn.disabled = false;
    addPlayerBtn.textContent = "Add";
    renderPlayerList();
});

// 6. Remove Player Logic
async function removePlayer(index) {
    currentPlayerList.splice(index, 1);
    await savePlayerList();
    renderPlayerList();
}

// 7. Save to File
async function savePlayerList() {
    // Pretty print JSON (null, 2)
    const content = JSON.stringify(currentPlayerList, null, 2);
    await window.electronAPI.saveFile({ 
        serverId: activeServerId, 
        filename: currentListFile, 
        content 
    });
}

    // --- Initialization ---

    async function loadServers() {
        servers = await window.electronAPI.getServers();
        servers.forEach(server => {
            if (!serverStates.has(server.id)) {
                serverStates.set(server.id, { isRunning: false, console: '' });
            }
        });
        
        if (servers.length > 0 && (!activeServerId || !servers.find(s => s.id === activeServerId))) {
            activeServerId = servers[0].id;
        } else if (servers.length === 0) {
            activeServerId = null;
        }

        renderServerList();
        updateServerView();
    }

    loadServers();
});