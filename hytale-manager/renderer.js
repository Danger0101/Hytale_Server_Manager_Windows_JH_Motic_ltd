document.addEventListener('DOMContentLoaded', () => {
    console.log("Renderer Loaded");
    let servers = [], activeServerId = null;

    const serverList = document.getElementById('serverList');
    const welcomeView = document.getElementById('welcomeView');
    const serverView = document.getElementById('serverView');
    const modal = document.getElementById('serverModal');
    const serverForm = document.getElementById('serverForm');
    const serverIdInput = document.getElementById('serverId');
    const serverNameInput = document.getElementById('serverNameInput');
    const serverPathInput = document.getElementById('serverPathInput');
    const jarFileInput = document.getElementById('jarFileInput');
    const javaArgsInput = document.getElementById('javaArgsInput');
    const javaPathInput = document.getElementById('javaPathInput');
    const discordWebhookInput = document.getElementById('discordWebhookInput');
    const updateUrlInput = document.getElementById('updateUrlInput');
    const autoUpdateCheckbox = document.getElementById('autoUpdateCheckbox');
    
    const installCliBtn = document.getElementById('installCliBtn');
    const checkJavaBtn = document.getElementById('checkJavaBtn');
    const jarBrowseBtn = document.getElementById('jarBrowseBtn');
    const browseBtn = document.getElementById('browseBtn');
    const quickDownloadBtn = document.getElementById('quickDownloadBtn');
    const consoleDiv = document.getElementById('console');
    const jarStatusArea = document.getElementById('jarStatusArea');

    const deviceAuthModal = document.getElementById('deviceAuthModal');
    const deviceAuthCode = document.getElementById('deviceAuthCode');
    const deviceAuthLink = document.getElementById('deviceAuthLink');
    const closeAuthModal = document.getElementById('closeAuthModal');

    const hytaleApiKeyInput = document.getElementById('hytaleApiKeyInput');
    const enablePaymentsCheckbox = document.getElementById('enablePaymentsCheckbox');
    const paymentSettings = document.getElementById('paymentSettings');
    const merchantIdInput = document.getElementById('merchantIdInput');
    const authSessionTokenInput = document.getElementById('authSessionTokenInput');
    const authIdentityTokenInput = document.getElementById('authIdentityTokenInput');

    if (enablePaymentsCheckbox) enablePaymentsCheckbox.addEventListener('change', () => {
        if(paymentSettings) paymentSettings.style.display = enablePaymentsCheckbox.checked ? 'block' : 'none';
    });

    if (closeAuthModal) {
        closeAuthModal.addEventListener('click', () => { deviceAuthModal.style.display = 'none'; });
        deviceAuthCode.addEventListener('click', () => { navigator.clipboard.writeText(deviceAuthCode.textContent); alert("Code copied!"); });
    }

    if (browseBtn) browseBtn.addEventListener('click', async () => {
        try { const p = await window.electronAPI.selectDirectory(); if(p) serverPathInput.value = p; } 
        catch(e) { alert(e.message); }
    });

    if (jarBrowseBtn) jarBrowseBtn.addEventListener('click', async () => {
        try { const p = await window.electronAPI.selectFile({name:'Jar', extensions:['jar']}); if(p) jarFileInput.value = p.split(/[\\/]/).pop(); } 
        catch(e) { alert(e.message); }
    });

    if (checkJavaBtn) checkJavaBtn.addEventListener('click', async () => {
        checkJavaBtn.disabled = true; checkJavaBtn.textContent = "Checking...";
        try {
            const res = await window.electronAPI.checkJavaInstalled();
            if (res.installed) { alert("Java Installed!"); checkJavaBtn.textContent = "✅ Java Ready"; }
            else { alert("Java Missing."); checkJavaBtn.textContent = "❌ Missing"; }
        } catch(e) { alert(e.message); } finally { checkJavaBtn.disabled = false; }
    });

    async function initiateHytaleDownload(targetId) {
        if (!targetId) return;
        const btn = document.getElementById('installCliBtn'); 
        if(btn) { btn.disabled = true; btn.textContent = "Running..."; }
        try {
            hideModal();
            updateServerView(); 
            const result = await window.electronAPI.installViaCli(targetId);
            if (result.success) { alert("Complete! Auth tokens saved."); loadServers(); }
            else { alert("Error: " + result.message); showModal(servers.find(s => s.id === targetId)); }
        } catch (err) { alert(err.message); } 
        finally { if(btn) { btn.disabled = false; btn.textContent = "☁️ Hytale Downloader"; } }
    }

    if (installCliBtn) installCliBtn.addEventListener('click', async () => {
        const targetId = await autoSaveAndGetId();
        if (targetId) initiateHytaleDownload(targetId);
    });

    if (quickDownloadBtn) quickDownloadBtn.addEventListener('click', async () => {
        const targetId = await autoSaveAndGetId();
        if (targetId) initiateHytaleDownload(targetId);
    });

    async function autoSaveAndGetId() {
        if (serverIdInput.value) return serverIdInput.value;
        if (!serverNameInput.value || !serverPathInput.value) { alert("Enter Name/Path"); return null; }
        const data = {
            id: '', name: serverNameInput.value, path: serverPathInput.value, jarFile: jarFileInput.value,
            javaArgs: '', javaPath: '', discordWebhook: '', updateUrl: '', autoUpdate: false, hytaleApiKey: '', 
            enablePayments: false, merchantId: '', authSessionToken: '', authIdentityToken: ''
        };
        const newServer = await window.electronAPI.addServer(data);
        serverIdInput.value = newServer.id;
        activeServerId = newServer.id;
        await loadServers();
        return newServer.id;
    }

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
        if(modalTabBtns.length > 0) modalTabBtns[0].click();
        modal.style.display = 'flex';
        const setVal = (id, v) => { const e = document.getElementById(id); if(e) e.value = v; };
        const setChk = (id, v) => { const e = document.getElementById(id); if(e) e.checked = v; };
        if(jarStatusArea) jarStatusArea.style.display = 'none';

        if (server) {
            document.getElementById('modalTitle').textContent = "Edit Server";
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
            document.getElementById('modalTitle').textContent = "Add New Server";
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
        const data = {
            id: serverIdInput.value, name: serverNameInput.value, path: serverPathInput.value, jarFile: jarFileInput.value,
            javaArgs: javaArgsInput.value, javaPath: javaPathInput.value, discordWebhook: getVal('discordWebhookInput'),
            updateUrl: getVal('updateUrlInput'), autoUpdate: getCheck('autoUpdateCheckbox'), hytaleApiKey: getVal('hytaleApiKeyInput'),
            enablePayments: getCheck('enablePaymentsCheckbox'), merchantId: getVal('merchantIdInput'),
            authSessionToken: getVal('authSessionTokenInput'), authIdentityToken: getVal('authIdentityTokenInput')
        };
        if (data.id) await window.electronAPI.updateServer(data); else await window.electronAPI.addServer(data);
        hideModal(); loadServers();
    });

    async function loadServers() {
        servers = await window.electronAPI.getServers();
        serverList.innerHTML = '';
        if(servers.length === 0) { welcomeView.style.display = 'flex'; serverView.style.display = 'none'; return; }
        welcomeView.style.display = 'none'; serverView.style.display = 'flex';
        servers.forEach(s => {
            const li = document.createElement('li');
            li.textContent = s.name;
            li.onclick = () => { activeServerId = s.id; updateServerView(); };
            if(s.id === activeServerId) li.classList.add('active');
            serverList.appendChild(li);
        });
        if(!activeServerId && servers.length > 0) { activeServerId = servers[0].id; updateServerView(); }
    }

    function updateServerView() {
        const s = servers.find(x => x.id === activeServerId);
        if(s) document.getElementById('serverNameTitle').textContent = s.name;
        const refreshBtn = (id, fn) => {
            const old = document.getElementById(id); if(!old) return;
            const clone = old.cloneNode(true); old.parentNode.replaceChild(clone, old); clone.addEventListener('click', fn);
        };
        refreshBtn('startButton', () => window.electronAPI.startServer(activeServerId));
        refreshBtn('stopButton', () => window.electronAPI.stopServer(activeServerId));
    }

    window.electronAPI.onServerLog(({serverId, log}) => {
        if(serverId === activeServerId) { consoleDiv.textContent += log; consoleDiv.scrollTop = consoleDiv.scrollHeight; }
        if (log.includes('oauth2/device/verify')) {
            const urlMatch = log.match(/(https:\/\/.*user_code=([a-zA-Z0-9]+))/);
            const codeMatch = log.match(/Authorization code:\s*([a-zA-Z0-9]+)/);
            let code = null, url = "https://oauth.accounts.hytale.com/oauth2/device/verify"; 
            if (urlMatch) { url = urlMatch[1]; code = urlMatch[2]; } else if (codeMatch) { code = codeMatch[1]; }
            if (code && deviceAuthModal) {
                deviceAuthCode.textContent = code; deviceAuthLink.href = url; deviceAuthModal.style.display = 'flex';
            }
        }
    });

    window.electronAPI.onServerStateChange(({ serverId, isRunning }) => { if(activeServerId === serverId) updateServerView(); });
    loadServers();
});