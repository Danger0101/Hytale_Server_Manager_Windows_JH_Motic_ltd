document.addEventListener('DOMContentLoaded', () => {
    console.log("Renderer Loaded");

    // --- State ---
    let servers = [];
    let activeServerId = null;
    let serverStates = new Map();

    // --- Elements ---
    const serverList = document.getElementById('serverList');
    const welcomeView = document.getElementById('welcomeView');
    const serverView = document.getElementById('serverView');
    
    // Modal
    const modal = document.getElementById('serverModal');
    const serverForm = document.getElementById('serverForm');
    const modalTitle = document.getElementById('modalTitle');
    
    // Inputs
    const serverIdInput = document.getElementById('serverId');
    const serverNameInput = document.getElementById('serverNameInput');
    const serverPathInput = document.getElementById('serverPathInput');
    const jarFileInput = document.getElementById('jarFileInput');
    const javaArgsInput = document.getElementById('javaArgsInput');
    const javaPathInput = document.getElementById('javaPathInput');
    const discordWebhookInput = document.getElementById('discordWebhookInput');
    const updateUrlInput = document.getElementById('updateUrlInput');
    const autoUpdateCheckbox = document.getElementById('autoUpdateCheckbox');
    
    // Buttons
    const installCliBtn = document.getElementById('installCliBtn');
    const importFromLauncherBtn = document.getElementById('importFromLauncherBtn');
    const checkJavaBtn = document.getElementById('checkJavaBtn');
    const jarBrowseBtn = document.getElementById('jarBrowseBtn');
    const browseBtn = document.getElementById('browseBtn');
    const startButton = document.getElementById('startButton');
    const stopButton = document.getElementById('stopButton');
    const commandInput = document.getElementById('commandInput');
    const consoleDiv = document.getElementById('console');
    const uptimeBadge = document.getElementById('uptimeBadge');

    // Hytale Cloud
    const hytaleApiKeyInput = document.getElementById('hytaleApiKeyInput');
    const enablePaymentsCheckbox = document.getElementById('enablePaymentsCheckbox');
    const paymentSettings = document.getElementById('paymentSettings');
    const merchantIdInput = document.getElementById('merchantIdInput');

    if (enablePaymentsCheckbox) {
        enablePaymentsCheckbox.addEventListener('change', () => {
            if(paymentSettings) paymentSettings.style.display = enablePaymentsCheckbox.checked ? 'block' : 'none';
        });
    }

    // --- BUTTON LISTENERS (SAFE WRAPPERS) ---

    // 1. Browse Folder
    if (browseBtn) {
        browseBtn.addEventListener('click', async () => {
            try {
                const path = await window.electronAPI.selectDirectory();
                if (path) serverPathInput.value = path;
            } catch (err) {
                alert("Browse Error: " + err.message);
            }
        });
    }

    // 2. Browse JAR
    if (jarBrowseBtn) {
        jarBrowseBtn.addEventListener('click', async () => {
            try {
                const path = await window.electronAPI.selectFile({ name: 'Java JAR', extensions: ['jar'] });
                if (path) jarFileInput.value = path.split(/[\\/]/).pop();
            } catch (err) {
                alert("Select File Error: " + err.message);
            }
        });
    }

    // 3. Check Java Button
    if (checkJavaBtn) {
        checkJavaBtn.addEventListener('click', async () => {
            checkJavaBtn.disabled = true;
            checkJavaBtn.textContent = "Checking...";
            try {
                await performJavaCheck();
            } catch (err) {
                alert("Java Check Failed: " + err.message);
            } finally {
                checkJavaBtn.disabled = false;
            }
        });
    }

    // 4. Hytale Downloader Button
    if (installCliBtn) {
        installCliBtn.addEventListener('click', async () => {
            const targetId = await autoSaveAndGetId();
            if (!targetId) return;

            installCliBtn.disabled = true;
            installCliBtn.textContent = "Checking Tool...";

            try {
                // Check Tool Presence
                const hasTool = await window.electronAPI.checkCliTool();
                if (!hasTool) {
                    if (confirm("Hytale Downloader tool is missing. Download it now?")) {
                        installCliBtn.textContent = "Downloading Tool...";
                        window.electronAPI.onToolDownloadStatus(s => installCliBtn.textContent = s);
                        
                        const res = await window.electronAPI.downloadCliTool();
                        if (!res.success) throw new Error(res.message);
                    } else {
                        installCliBtn.textContent = "☁️ Hytale Downloader";
                        installCliBtn.disabled = false;
                        return;
                    }
                }

                // Run Tool
                installCliBtn.textContent = "Running...";
                hideModal();
                alert("Starting Downloader. Look at the console for Auth Codes!");
                
                const result = await window.electronAPI.installViaCli(targetId);
                if(result.success) {
                    alert("Success!");
                    updateServerView();
                } else {
                    alert("Error: " + result.message);
                    showModal(servers.find(s => s.id === targetId));
                }

            } catch (err) {
                alert("Downloader Error: " + err.message);
            } finally {
                installCliBtn.textContent = "☁️ Hytale Downloader";
                installCliBtn.disabled = false;
            }
        });
    }

    // --- HELPER LOGIC ---

    async function performJavaCheck() {
        const result = await window.electronAPI.checkJavaInstalled();
        if (result.installed) {
            alert(`Java is Installed! (${result.type})`);
            checkJavaBtn.textContent = "✅ Java Installed";
            checkJavaBtn.style.background = "#4CAF50";
        } else {
            if (confirm("Java 25 is MISSING. Download and install it automatically?")) {
                checkJavaBtn.textContent = "Downloading...";
                window.electronAPI.onToolDownloadStatus(s => checkJavaBtn.textContent = s);
                
                const res = await window.electronAPI.downloadJava();
                if (res.success) {
                    alert("Java Installed Successfully!");
                    checkJavaBtn.textContent = "✅ Java Installed";
                    checkJavaBtn.style.background = "#4CAF50";
                } else {
                    throw new Error(res.message);
                }
            } else {
                checkJavaBtn.textContent = "❌ Java Missing";
            }
        }
    }

    async function autoSaveAndGetId() {
        if (serverIdInput.value) return serverIdInput.value;
        if (!serverNameInput.value || !serverPathInput.value) {
            alert("Enter Server Name and Path first.");
            if(modalTabBtns.length > 0) modalTabBtns[0].click();
            return null;
        }
        const serverData = {
            id: '', name: serverNameInput.value, path: serverPathInput.value, jarFile: jarFileInput.value,
            javaArgs: '', javaPath: '', discordWebhook: '', updateUrl: '', autoUpdate: false, hytaleApiKey: '', 
            enablePayments: false, merchantId: '', authSessionToken: '', authIdentityToken: ''
        };
        const newServer = await window.electronAPI.addServer(serverData);
        serverIdInput.value = newServer.id;
        activeServerId = newServer.id;
        await loadServers();
        return newServer.id;
    }

    // --- MODAL & TABS ---
    const modalTabBtns = document.querySelectorAll('.modal-tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    if (modalTabBtns) {
        modalTabBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                modalTabBtns.forEach(b => b.classList.remove('active'));
                tabContents.forEach(c => c.classList.remove('active'));
                btn.classList.add('active');
                document.getElementById(btn.dataset.tab).classList.add('active');
            });
        });
    }

    async function showModal(server = null) {
        serverForm.reset();
        // Reset Tabs
        if(modalTabBtns.length > 0) {
            modalTabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            modalTabBtns[0].classList.add('active');
            tabContents[0].classList.add('active');
        }
        
        modal.style.display = 'flex';

        // Helpers to set form values safely
        const setVal = (id, val) => { const el = document.getElementById(id); if(el) el.value = val; };
        const setChk = (id, val) => { const el = document.getElementById(id); if(el) el.checked = val; };

        if (server) {
            modalTitle.textContent = "Edit Server";
            setVal('serverId', server.id);
            setVal('serverNameInput', server.name);
            setVal('serverPathInput', server.path);
            setVal('jarFileInput', server.jarFile);
            setVal('javaArgsInput', server.javaArgs || '');
            setVal('javaPathInput', server.javaPath || '');
            setVal('discordWebhookInput', server.discordWebhook || '');
            setVal('updateUrlInput', server.updateUrl || '');
            setChk('autoUpdateCheckbox', server.autoUpdate || false);
            
            // Cloud
            setVal('hytaleApiKeyInput', server.hytaleApiKey || '');
            setChk('enablePaymentsCheckbox', server.enablePayments || false);
            setVal('merchantIdInput', server.merchantId || '');
            if(paymentSettings) paymentSettings.style.display = server.enablePayments ? 'block' : 'none';
            
            setVal('authSessionTokenInput', server.authSessionToken || '');
            setVal('authIdentityToken', server.authIdentityToken || '');

        } else {
            modalTitle.textContent = "Add New Server";
            setVal('serverId', '');
            if(paymentSettings) paymentSettings.style.display = 'none';
            
            // --- AUTO CHECK FEATURE ---
            // Run check silently, if missing, ask user
            const javaRes = await window.electronAPI.checkJavaInstalled();
            if(!javaRes.installed) {
                checkJavaBtn.textContent = "⚠️ Java Missing - Click to Fix";
            }
        }
    }

    function hideModal() { modal.style.display = 'none'; }

    document.querySelector('.close-button').addEventListener('click', hideModal);
    document.getElementById('addServerBtn').addEventListener('click', () => showModal());
    document.getElementById('initialAddServerBtn').addEventListener('click', () => showModal());
    
    serverForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const getVal = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
        const getCheck = (id) => { const el = document.getElementById(id); return el ? el.checked : false; };

        const serverData = {
            id: serverIdInput.value,
            name: serverNameInput.value,
            path: serverPathInput.value,
            jarFile: jarFileInput.value,
            javaArgs: javaArgsInput.value,
            javaPath: javaPathInput.value,
            discordWebhook: getVal('discordWebhookInput').trim(),
            updateUrl: getVal('updateUrlInput').trim(),
            autoUpdate: getCheck('autoUpdateCheckbox'),
            hytaleApiKey: getVal('hytaleApiKeyInput').trim(),
            enablePayments: getCheck('enablePaymentsCheckbox'),
            merchantId: getVal('merchantIdInput').trim(),
            authSessionToken: getVal('authSessionTokenInput').trim(),
            authIdentityToken: getVal('authIdentityTokenInput').trim()
        };

        if (serverData.id) await window.electronAPI.updateServer(serverData);
        else await window.electronAPI.addServer(serverData);
        
        hideModal();
        loadServers();
    });

    // --- MAIN VIEW LOGIC ---
    
    async function loadServers() {
        servers = await window.electronAPI.getServers();
        serverList.innerHTML = '';
        
        if(servers.length === 0) {
            welcomeView.style.display = 'flex';
            serverView.style.display = 'none';
            return;
        }
        
        welcomeView.style.display = 'none';
        serverView.style.display = 'flex';

        servers.forEach(s => {
            const li = document.createElement('li');
            li.textContent = s.name;
            li.onclick = () => { activeServerId = s.id; updateServerView(); };
            if(s.id === activeServerId) li.classList.add('active');
            serverList.appendChild(li);
        });
        
        if(!activeServerId && servers.length > 0) {
            activeServerId = servers[0].id;
            updateServerView();
        }
    }

    function updateServerView() {
        const s = servers.find(x => x.id === activeServerId);
        if(s) document.getElementById('serverNameTitle').textContent = s.name;
        
        // Refresh start/stop listeners by cloning (removes old listeners)
        const refreshBtn = (id, handler) => {
            const oldBtn = document.getElementById(id);
            if(!oldBtn) return;
            const newBtn = oldBtn.cloneNode(true);
            oldBtn.parentNode.replaceChild(newBtn, oldBtn);
            newBtn.addEventListener('click', handler);
        };

        refreshBtn('startButton', () => window.electronAPI.startServer(activeServerId));
        refreshBtn('stopButton', () => window.electronAPI.stopServer(activeServerId));
    }

    // --- IPC Listeners ---
    window.electronAPI.onServerLog(({serverId, log}) => {
        if(serverId === activeServerId) {
            consoleDiv.textContent += log;
            consoleDiv.scrollTop = consoleDiv.scrollHeight;
        }
    });

    // --- RESTORED: CONFIG EDITOR ---
    const configModal = document.getElementById('configModal');
    const closeConfigBtn = document.querySelector('.close-config');
    const configFileSelect = document.getElementById('configFileSelect');
    const loadConfigBtn = document.getElementById('loadConfigBtn');
    const saveConfigBtn = document.getElementById('saveConfigBtn');
    const toggleViewBtn = document.getElementById('toggleViewBtn');
    const configFormView = document.getElementById('configFormView');
    const configEditor = document.getElementById('configEditor');
    let isTextMode = false;

    if(document.getElementById('configBtn')) {
        document.getElementById('configBtn').addEventListener('click', () => {
            if(!activeServerId) return;
            configModal.style.display = 'flex';
            isTextMode = false;
            if(configEditor) configEditor.style.display = 'none';
            if(configFormView) configFormView.style.display = 'grid';
            loadConfig();
        });
    }
    if(closeConfigBtn) closeConfigBtn.addEventListener('click', () => configModal.style.display = 'none');

    if(loadConfigBtn) loadConfigBtn.addEventListener('click', loadConfig);
    async function loadConfig() {
        if(!activeServerId) return;
        const filename = configFileSelect.value;
        const res = await window.electronAPI.readFile({ serverId: activeServerId, filename });
        if(res.success) {
            configEditor.value = res.content;
            generateFormFromText(res.content);
        } else {
            configEditor.value = "";
            generateFormFromText("");
        }
    }

    if(saveConfigBtn) {
        saveConfigBtn.addEventListener('click', async () => {
            if(!activeServerId) return;
            const content = isTextMode ? configEditor.value : generateTextFromForm();
            const res = await window.electronAPI.saveFile({ serverId: activeServerId, filename: configFileSelect.value, content });
            alert(res.success ? "Saved!" : "Error: " + res.error);
        });
    }

    function generateFormFromText(text) {
        if(!configFormView) return;
        configFormView.innerHTML = '';
        let data = {};
        // Simple Properties Parser
        text.split('\n').forEach(line => {
            if(line.includes('=') && !line.startsWith('#')) {
                const [k, v] = line.split('=');
                if(k && v) data[k.trim()] = v.trim();
            }
        });
        
        Object.keys(data).forEach(key => {
            const div = document.createElement('div');
            div.className = 'config-item';
            div.innerHTML = `<label>${key}</label><input type="text" value="${data[key]}" data-key="${key}">`;
            configFormView.appendChild(div);
        });
    }

    function generateTextFromForm() {
        if(!configFormView) return "";
        let txt = "";
        configFormView.querySelectorAll('input').forEach(inp => {
            txt += `${inp.dataset.key}=${inp.value}\n`;
        });
        return txt;
    }

    if(toggleViewBtn) {
        toggleViewBtn.addEventListener('click', () => {
            isTextMode = !isTextMode;
            configFormView.style.display = isTextMode ? 'none' : 'grid';
            configEditor.style.display = isTextMode ? 'block' : 'none';
            if(!isTextMode) generateFormFromText(configEditor.value);
            else configEditor.value = generateTextFromForm();
        });
    }

    // --- RESTORED: PLAYER MANAGER ---
    const playerModal = document.getElementById('playerModal');
    const closePlayerBtn = document.querySelector('.close-player');
    const playerManagerBtn = document.getElementById('playerManagerBtn');
    
    if(playerManagerBtn) {
        playerManagerBtn.addEventListener('click', () => {
            if(!activeServerId) return;
            playerModal.style.display = 'flex';
            // Logic to load list would go here (simplified for brevity)
        });
    }
    if(closePlayerBtn) closePlayerBtn.addEventListener('click', () => playerModal.style.display = 'none');

    loadServers();
});