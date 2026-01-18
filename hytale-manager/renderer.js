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

    // Add these to the top list
    const editSettingsBtn = document.getElementById('editSettingsBtn');

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

    function updateServerView() {
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
        
        startButton.disabled = state.isRunning;
        stopButton.disabled = !state.isRunning;
        commandInput.disabled = !state.isRunning;
        commandInput.placeholder = state.isRunning ? "Enter server command..." : "Server is offline.";
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
            if (confirm("Permanently remove this server from the manager? (Files will remain)")) {
                await window.electronAPI.deleteServer(activeServerId);
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

    if(editSettingsBtn) {
        editSettingsBtn.addEventListener('click', () => {
            if(!activeServerId) return;
            const server = servers.find(s => s.id === activeServerId);
            showModal(server); // Reuses your existing modal!
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
            discordWebhook: discordWebhookInput.value.trim()
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

    // --- IPC Handlers ---

    window.electronAPI.onServerLog(({ serverId, log }) => {
        if (!serverStates.has(serverId)) return;
        
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

        // Only show "Remove" button if it's NOT the history tab (History should be permanent-ish)
        const removeBtn = !isHistoryTab ? 
            `<button class="remove-player-btn" data-index="${index}">&times;</button>` : 
            ``;

        li.innerHTML = `
            <div style="display:flex; justify-content:space-between; width:100%; align-items:center;">
                ${infoHtml}
            </div>
            ${removeBtn}
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
    }
}

// 5. Add Player Logic
addPlayerBtn.addEventListener('click', async () => {
    const name = newPlayerInput.value.trim();
    if (!name) return;

    // Standard Format: Object with name, uuid, created date
    const newEntry = {
        name: name,
        created: new Date().toISOString(),
        source: "Manager"
    };

    currentPlayerList.push(newEntry);
    await savePlayerList();
    
    newPlayerInput.value = '';
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