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
    const checkJavaBtn = document.getElementById('checkJavaBtn');
    const jarBrowseBtn = document.getElementById('jarBrowseBtn');
    const browseBtn = document.getElementById('browseBtn');
    const startButton = document.getElementById('startButton');
    const stopButton = document.getElementById('stopButton');
    const commandInput = document.getElementById('commandInput');
    const consoleDiv = document.getElementById('console');
    const jarStatusArea = document.getElementById('jarStatusArea');
    const quickDownloadBtn = document.getElementById('quickDownloadBtn');

    // Auth Popup Elements
    const deviceAuthModal = document.getElementById('deviceAuthModal');
    const deviceAuthCode = document.getElementById('deviceAuthCode');
    const deviceAuthLink = document.getElementById('deviceAuthLink');
    const closeAuthModal = document.getElementById('closeAuthModal');

    // Hytale Cloud
    const hytaleApiKeyInput = document.getElementById('hytaleApiKeyInput');
    const enablePaymentsCheckbox = document.getElementById('enablePaymentsCheckbox');
    const paymentSettings = document.getElementById('paymentSettings');
    const merchantIdInput = document.getElementById('merchantIdInput');
    const authSessionTokenInput = document.getElementById('authSessionTokenInput');
    const authIdentityTokenInput = document.getElementById('authIdentityTokenInput');

    if (enablePaymentsCheckbox) {
        enablePaymentsCheckbox.addEventListener('change', () => {
            if(paymentSettings) paymentSettings.style.display = enablePaymentsCheckbox.checked ? 'block' : 'none';
        });
    }

    if (closeAuthModal) {
        closeAuthModal.addEventListener('click', () => { deviceAuthModal.style.display = 'none'; });
        deviceAuthCode.addEventListener('click', () => { navigator.clipboard.writeText(deviceAuthCode.textContent); alert("Code copied!"); });
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
                if (path) jarFileInput.value = path.split(/[\/]/).pop();
            } catch (err) { alert("Select File Error: " + err.message); }
        });
    }

    if (checkJavaBtn) {
        checkJavaBtn.addEventListener('click', async () => {
            checkJavaBtn.disabled = true;
            checkJavaBtn.textContent = "Checking...";
            try {
                const result = await window.electronAPI.checkJavaInstalled();
                if (result.installed) {
                    alert(`Java is installed! (${result.type})`);
                    checkJavaBtn.textContent = "✅ Java Installed";
                    checkJavaBtn.style.background = "#4CAF50";
                } else {
                    alert("Java 25 missing. Install manually or use bundled.");
                    checkJavaBtn.textContent = "❌ Java Missing";
                }
            } catch (err) { alert("Check Error: " + err.message); }
            finally { checkJavaBtn.disabled = false; }
        });
    }

    // --- DOWNLOAD & AUTH START ---
    
    async function initiateHytaleDownload(targetId) {
        if (!targetId) return;
        const btn = document.getElementById('installCliBtn'); 
        if(btn) { btn.disabled = true; btn.textContent = "Running..."; }
        
        try {
            hideModal();
            updateServerView(); 
            // Don't show alert, just let the popup handle it if needed
            
            const result = await window.electronAPI.installViaCli(targetId);
            
            if (result.success) {
                alert("Task Complete! Credentials Saved.");
                updateServerView();
                loadServers(); 
            } else {
                alert("Error: " + result.message);
                showModal(servers.find(s => s.id === targetId));
            }
        } catch (err) {
            alert("Error: " + err.message);
        } finally {
            if(btn) { btn.disabled = false; btn.textContent = "☁️ Hytale Downloader"; }
        }
    }

    if (installCliBtn) {
        installCliBtn.addEventListener('click', async () => {
            const targetId = await autoSaveAndGetId();
            if (targetId) initiateHytaleDownload(targetId);
        });
    }

    if (quickDownloadBtn) {
        quickDownloadBtn.addEventListener('click', async () => {
            const targetId = await autoSaveAndGetId();
            if (targetId) initiateHytaleDownload(targetId);
        });
    }

    // --- HELPER LOGIC ---

    async function autoSaveAndGetId() {
        if (serverIdInput.value) return serverIdInput.value;
        if (!serverNameInput.value || !serverPathInput.value) {
            alert("Enter Server Name and Path first.");
            const tab = document.querySelector('.modal-tab-btn[data-tab="tab-general"]');
            if(tab) tab.click();
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
        if(modalTabBtns.length > 0) modalTabBtns[0].click(); // Reset to first tab
        modal.style.display = 'flex';

        // Helper set values
        const setVal = (id, val) => { const el = document.getElementById(id); if(el) el.value = val; };
        const setChk = (id, val) => { const el = document.getElementById(id); if(el) el.checked = val; };

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

            const exists = await window.electronAPI.checkJarExists(server.id);
            if (!exists && jarStatusArea) jarStatusArea.style.display = 'block';

        } else {
            modalTitle.textContent = "Add New Server";
            setVal('serverId', '');
            if(paymentSettings) paymentSettings.style.display = 'none';
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

    // --- IPC & AUTH DETECTION ---
    window.electronAPI.onServerLog(({serverId, log}) => {
        if(serverId === activeServerId) {
            consoleDiv.textContent += log;
            consoleDiv.scrollTop = consoleDiv.scrollHeight;
        }

        // DETECT AUTH PATTERN
        // "Please visit... verify?user_code=ABCD" or "Authorization code: ABCD"
        if (log.includes('oauth2/device/verify')) {
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

            if (code && deviceAuthModal) {
                deviceAuthCode.textContent = code;
                deviceAuthLink.href = url;
                deviceAuthModal.style.display = 'flex';
                // Try to bring to front
                window.focus();
            }
        }
        
        // Manual "auth-needed" event support
        if(log.includes('auth-needed')) { /* handled by regex above usually */ }
    });

    // Handle explicit auth request event
    window.electronAPI.onAuthNeeded((log) => {
        // Redundant fallback, triggers same regex logic via log usually, 
        // but can add specific alert here if regex fails.
    });

    window.electronAPI.onServerStateChange(({ serverId, isRunning }) => {
        if(activeServerId === serverId) updateServerView();
    });

    loadServers();
});