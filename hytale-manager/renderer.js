document.addEventListener('DOMContentLoaded', () => {
    console.log("Renderer Loaded");

    // --- State & Elements ---
    let servers = [];
    let activeServerId = null;
    let serverStates = new Map();

    const serverList = document.getElementById('serverList');
    const welcomeView = document.getElementById('welcomeView');
    const serverView = document.getElementById('serverView');
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
    
    // Buttons & Status
    const installCliBtn = document.getElementById('installCliBtn');
    const checkJavaBtn = document.getElementById('checkJavaBtn');
    const jarBrowseBtn = document.getElementById('jarBrowseBtn');
    const browseBtn = document.getElementById('browseBtn');
    const startButton = document.getElementById('startButton');
    const stopButton = document.getElementById('stopButton');
    const commandInput = document.getElementById('commandInput');
    const consoleDiv = document.getElementById('console');
    const jarStatusArea = document.getElementById('jarStatusArea');
    const quickDownloadBtn = document.getElementById('quickDownloadBtn');

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

    // --- BUTTON LISTENERS ---

    if (browseBtn) {
        browseBtn.addEventListener('click', async () => {
            try {
                const path = await window.electronAPI.selectDirectory();
                if (path) serverPathInput.value = path;
            } catch (err) { alert("Browse Error: " + err.message); }
        });
    }

    if (jarBrowseBtn) {
        jarBrowseBtn.addEventListener('click', async () => {
            try {
                const path = await window.electronAPI.selectFile({ name: 'Java JAR', extensions: ['jar'] });
                if (path) jarFileInput.value = path.split(/[\\/]/).pop();
            } catch (err) { alert("Select File Error: " + err.message); }
        });
    }

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

    // --- SHARED DOWNLOAD LOGIC ---
    async function initiateHytaleDownload(targetId) {
        if (!targetId) return;
        
        // Find buttons to lock
        const btn = document.getElementById('installCliBtn'); 
        if(btn) { btn.disabled = true; btn.textContent = "Checking Tool..."; }
        
        try {
            // 1. Check Tool
            const hasTool = await window.electronAPI.checkCliTool();
            if (!hasTool) {
                if (!confirm("Hytale Downloader tool is missing. Download it now?")) {
                    throw new Error("Tool download cancelled.");
                }
                if(btn) btn.textContent = "Downloading Tool...";
                window.electronAPI.onToolDownloadStatus(s => { if(btn) btn.textContent = s; });
                
                const res = await window.electronAPI.downloadCliTool();
                if (!res.success) throw new Error(res.message);
            }

            // 2. Run Tool
            if(btn) btn.textContent = "Running...";
            hideModal();
            updateServerView(); 
            alert("Starting Downloader.\n\nCheck the console for Authentication Codes!");
            
            const result = await window.electronAPI.installViaCli(targetId);
            
            if (result.success) {
                alert("Installation Complete!");
                updateServerView();
                // If we re-open the modal, update status
                loadServers(); 
            } else {
                alert("Error: " + result.message);
                showModal(servers.find(s => s.id === targetId));
            }

        } catch (err) {
            alert("Download Error: " + err.message);
        } finally {
            if(btn) { btn.disabled = false; btn.textContent = "☁️ Hytale Downloader"; }
        }
    }

    // Main Install Button
    if (installCliBtn) {
        installCliBtn.addEventListener('click', async () => {
            const targetId = await autoSaveAndGetId();
            if (targetId) initiateHytaleDownload(targetId);
        });
    }

    // Quick Download Button (In General Tab)
    if (quickDownloadBtn) {
        quickDownloadBtn.addEventListener('click', async () => {
            const targetId = await autoSaveAndGetId();
            if (targetId) initiateHytaleDownload(targetId);
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
            // Switch to General tab
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
        if(modalTabBtns.length > 0) {
            modalTabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            modalTabBtns[0].classList.add('active');
            tabContents[0].classList.add('active');
        }
        modal.style.display = 'flex';

        // Helper set values
        const setVal = (id, val) => { const el = document.getElementById(id); if(el) el.value = val; };
        const setChk = (id, val) => { const el = document.getElementById(id); if(el) el.checked = val; };

        // Reset Status Area
        if(jarStatusArea) jarStatusArea.style.display = 'none';

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
            
            setVal('hytaleApiKeyInput', server.hytaleApiKey || '');
            setChk('enablePaymentsCheckbox', server.enablePayments || false);
            setVal('merchantIdInput', server.merchantId || '');
            if(paymentSettings) paymentSettings.style.display = server.enablePayments ? 'block' : 'none';
            setVal('authSessionTokenInput', server.authSessionToken || '');
            setVal('authIdentityTokenInput', server.authIdentityToken || '');

            // --- CHECK FILE STATUS ---
            const exists = await window.electronAPI.checkJarExists(server.id);
            if (!exists && jarStatusArea) {
                jarStatusArea.style.display = 'block'; // Show "Missing" alert
            }

        } else {
            modalTitle.textContent = "Add New Server";
            setVal('serverId', '');
            if(paymentSettings) paymentSettings.style.display = 'none';
            
            // Auto-check Java for new setup
            const javaRes = await window.electronAPI.checkJavaInstalled();
            if(!javaRes.installed) checkJavaBtn.textContent = "⚠️ Java Missing - Click to Fix";
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
            authIdentityToken: getVal('authIdentityTokenInput').trim(),
            refreshToken: getVal('refreshTokenInput').trim() // Added refreshToken
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
    
    // Auth Modal Elements
    const deviceAuthModal = document.getElementById('deviceAuthModal');
    const deviceAuthCode = document.getElementById('deviceAuthCode');
    const deviceAuthLink = document.getElementById('deviceAuthLink');
    const closeAuthModal = document.getElementById('closeAuthModal');

    if (closeAuthModal) {
        closeAuthModal.addEventListener('click', () => {
            deviceAuthModal.style.display = 'none';
        });
        deviceAuthCode.addEventListener('click', () => {
            navigator.clipboard.writeText(deviceAuthCode.textContent);
            alert("Code copied!");
        });
    }

    window.electronAPI.onServerLog(({serverId, log}) => {
        // 1. Show log in console
        if (serverId === activeServerId) {
            consoleDiv.textContent += log;
            consoleDiv.scrollTop = consoleDiv.scrollHeight;
        }

        // 2. DETECT AUTH PATTERN
        // Look for: "Please visit the following URL... verify?user_code=ABCD"
        if (log.includes('oauth2/device/verify')) {
            // Try to extract the User Code
            // Pattern: user_code=XXXX or "Authorization code: XXXX"
            const urlMatch = log.match(/(https:\/\/.*user_code=([a-zA-Z0-9]+))/);
            const codeMatch = log.match(/Authorization code:\s*([a-zA-Z0-9]+)/);
            
            let code = null;
            let url = "https://oauth.accounts.hytale.com/oauth2/device/verify";

            if (urlMatch) {
                url = urlMatch[1];
                code = urlMatch[2];
            } else if (codeMatch) {
                code = codeMatch[1];
            }

            // Show Popup if we found a code
            if (code && deviceAuthModal) {
                deviceAuthCode.textContent = code;
                deviceAuthLink.href = url;
                deviceAuthModal.style.display = 'flex';
                // Bring app to front logic handled by Main if possible, 
                // otherwise the user sees the popup.
            }
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
        });
    }
    if(closePlayerBtn) closePlayerBtn.addEventListener('click', () => playerModal.style.display = 'none');
    loadServers();
});