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
        } else {
            modalTitle.textContent = 'Add a New Server';
            serverIdInput.value = '';
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

    serverForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const serverData = {
            id: serverIdInput.value,
            name: serverNameInput.value,
            path: serverPathInput.value,
            jarFile: jarFileInput.value,
            javaArgs: javaArgsInput.value,
            javaPath: javaPathInput.value
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
        }
    });

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