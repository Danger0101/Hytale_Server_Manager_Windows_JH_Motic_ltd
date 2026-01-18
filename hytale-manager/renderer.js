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

    // --- BROWSE BUTTONS (FIXED) ---
    
    if (browseBtn) {
        browseBtn.addEventListener('click', async () => {
            console.log("Browse Folder Clicked");
            try {
                const path = await window.electronAPI.selectDirectory();
                console.log("Path selected:", path);
                if (path) serverPathInput.value = path;
            } catch (err) {
                alert("Browse Error: " + err.message);
            }
        });
    }

    if (jarBrowseBtn) {
        jarBrowseBtn.addEventListener('click', async () => {
            console.log("Browse JAR Clicked");
            try {
                const path = await window.electronAPI.selectFile({ name: 'Java JAR', extensions: ['jar'] });
                if (path) jarFileInput.value = path.split(/[\\/]/).pop();
            } catch (err) {
                alert("Select File Error: " + err.message);
            }
        });
    }

    // --- JAVA CHECK ---
    
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
                    if (confirm("Java 25 is MISSING or not in PATH.\n\nDownload and install Adoptium Temurin 25 automatically?")) {
                        checkJavaBtn.textContent = "Downloading...";
                        window.electronAPI.onToolDownloadStatus(s => checkJavaBtn.textContent = s);
                        const res = await window.electronAPI.downloadJava();
                        if (res.success) {
                            alert("Java Installed!");
                            checkJavaBtn.textContent = "✅ Java Installed";
                            checkJavaBtn.style.background = "#4CAF50";
                        } else {
                            alert("Download Failed: " + res.message);
                            checkJavaBtn.textContent = "⚠️ Install Failed";
                        }
                    } else {
                        checkJavaBtn.textContent = "❌ Java Missing";
                    }
                }
            } catch (err) {
                alert("Check Error: " + err.message);
                checkJavaBtn.textContent = "⚠️ Error";
            } finally {
                checkJavaBtn.disabled = false;
            }
        });
    }

    // --- HYTALE DOWNLOADER ---
    
    if (installCliBtn) {
        installCliBtn.addEventListener('click', async () => {
            // Auto Save First
            if (serverIdInput.value === '') {
                if (!serverNameInput.value || !serverPathInput.value) return alert("Enter Name/Path first");
                const newData = {
                    id: '', name: serverNameInput.value, path: serverPathInput.value, jarFile: jarFileInput.value,
                    javaArgs: '', javaPath: '', discordWebhook: '', updateUrl: '', autoUpdate: false, 
                    hytaleApiKey: '', enablePayments: false, merchantId: '', authSessionToken: '', authIdentityToken: ''
                };
                const s = await window.electronAPI.addServer(newData);
                serverIdInput.value = s.id;
                activeServerId = s.id;
                loadServers();
            }
            const targetId = serverIdInput.value;

            installCliBtn.disabled = true;
            installCliBtn.textContent = "Checking Tool...";

            try {
                const hasTool = await window.electronAPI.checkCliTool();
                if (!hasTool) {
                    if (!confirm("Hytale Downloader tool is missing. Download it?")) return;
                    installCliBtn.textContent = "Downloading...";
                    await window.electronAPI.downloadCliTool();
                }

                installCliBtn.textContent = "Running...";
                hideModal();
                updateServerView(); 
                alert("Starting Downloader. Watch the console!");
                
                await window.electronAPI.installViaCli(targetId);
                alert("Task Finished (Check console for details)");
                
            } catch (err) {
                alert("Error: " + err.message);
                showModal(servers.find(s => s.id === targetId));
            } finally {
                installCliBtn.textContent = "☁️ Hytale Downloader";
                installCliBtn.disabled = false;
            }
        });
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

    function showModal(server = null) {
        serverForm.reset();
        // Reset Tabs
        if(modalTabBtns.length > 0) {
            modalTabBtns.forEach(b => b.classList.remove('active'));
            tabContents.forEach(c => c.classList.remove('active'));
            modalTabBtns[0].classList.add('active');
            tabContents[0].classList.add('active');
        }
        
        modal.style.display = 'flex';

        if (server) {
            modalTitle.textContent = "Edit Server";
            serverIdInput.value = server.id;
            serverNameInput.value = server.name;
            serverPathInput.value = server.path;
            jarFileInput.value = server.jarFile;
            // ... set other fields
        } else {
            modalTitle.textContent = "Add New Server";
            serverIdInput.value = "";
        }
    }

    function hideModal() { modal.style.display = 'none'; }

    // --- GENERIC LISTENERS ---
    document.querySelector('.close-button').addEventListener('click', hideModal);
    document.getElementById('addServerBtn').addEventListener('click', () => showModal());
    document.getElementById('initialAddServerBtn').addEventListener('click', () => showModal());
    
    serverForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = {
            id: serverIdInput.value,
            name: serverNameInput.value,
            path: serverPathInput.value,
            jarFile: jarFileInput.value,
            // ... add all fields here ...
        };
        if(data.id) await window.electronAPI.updateServer(data);
        else await window.electronAPI.addServer(data);
        hideModal();
        loadServers();
    });

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
        
        // Use clone replacement to prevent duplicate listeners
        const replaceBtn = (id, fn) => {
            const old = document.getElementById(id);
            const clone = old.cloneNode(true);
            old.parentNode.replaceChild(clone, old);
            clone.addEventListener('click', fn);
        };
        replaceBtn('startButton', () => window.electronAPI.startServer(activeServerId));
        replaceBtn('stopButton', () => window.electronAPI.stopServer(activeServerId));
    }

    // --- IPC Listeners ---
    window.electronAPI.onServerLog(({serverId, log}) => {
        if(serverId === activeServerId) {
            consoleDiv.textContent += log;
            consoleDiv.scrollTop = consoleDiv.scrollHeight;
        }
    });

    loadServers();
});