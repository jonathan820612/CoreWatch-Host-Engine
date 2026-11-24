// =========================================================================
// APPLICATION TAB NAVIGATION AND VIEW-SWITCHING CONTROLLER (GLOBAL BIND)
// =========================================================================
window._activeViewKey = 'dashboard';

window.SwitchAppLayoutView = function(targetViewId) {
    window._activeViewKey = targetViewId || 'dashboard';
    if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(`Active-View:${window._activeViewKey}`);
    }
    const panels = {
        dashboard: document.getElementById('viewDashboardGrid'),
        netmanager: document.getElementById('viewNetworkManagerPanel'),
        startup: document.getElementById('viewStartupPanel'),
        sharing: document.getElementById('viewSharingPanel'),
        apps: document.getElementById('viewInstalledAppsPanel'),
        appstore: document.getElementById('viewAppInstallerPanel'),
        diskmap: document.getElementById('viewDiskMapPanel'),
        devices: document.getElementById('viewSystemDevicesPanel'),
        organizer: document.getElementById('viewFileOrganizerPanel'),
        diagx: document.getElementById('viewUltimaDiagXPanel'),
        tasksports: document.getElementById('viewTasksPortsPanel'),
        wsl: document.getElementById('viewWslManagerPanel'),
        security: document.getElementById('viewSecurityRepairPanel')
    };

    const buttons = {
        dashboard: document.getElementById('tabDashboard'),
        netmanager: document.getElementById('tabNetManager'),
        startup: document.getElementById('tabStartup'),
        sharing: document.getElementById('tabSharing'),
        apps: document.getElementById('tabInstalledApps'),
        appstore: document.getElementById('tabAppStore'),
        diskmap: document.getElementById('tabDiskMap'),
        devices: document.getElementById('tabDevices'),
        organizer: document.getElementById('tabOrganizer'),
        diagx: document.getElementById('tabUltimaDiagX'),
        tasksports: document.getElementById('tabTasksPorts'),
        wsl: document.getElementById('tabWslManager'),
        security: document.getElementById('tabSecurityRepair')
    };

    Object.values(panels).forEach(p => { if (p) p.style.display = 'none'; });
    Object.values(buttons).forEach(b => { if (b) b.classList.remove('active'); });

    // Auto-pause Tasks & Ports live refresh whenever leaving that tab
    if (targetViewId !== 'tasksports' && window._tpLiveWatchTimer) {
        StopTasksPortsLiveWatch();
    }

    // Close System Tools dropdown and update grouped trigger label/active highlight
    const sysDrop = document.getElementById('navSystemDropdown');
    const sysTrigger = document.getElementById('tabSystemMenu');
    const sysLabel = document.getElementById('lblSystemMenuText');
    if (sysDrop) sysDrop.classList.remove('open');
    if (sysTrigger) {
        sysTrigger.classList.remove('active');
        sysTrigger.setAttribute('aria-expanded', 'false');
    }
    const systemMenuLabels = {
        security: '🛡️ Security',
        startup: '🚀 Startup',
        sharing: '📂 Sharing',
        apps: '📦 Apps',
        appstore: '⬇️ App Store',
        diskmap: '🗺️ Disk Map',
        devices: '🧩 Devices',
        organizer: '🗂️ Organizer'
    };
    if (systemMenuLabels[targetViewId]) {
        if (sysTrigger) sysTrigger.classList.add('active');
        if (sysLabel) sysLabel.textContent = systemMenuLabels[targetViewId];
    } else if (sysLabel) {
        sysLabel.textContent = '🧰 System';
    }

    if (targetViewId === 'netmanager') {
        if (panels.netmanager) panels.netmanager.style.display = 'flex';
        if (buttons.netmanager) buttons.netmanager.classList.add('active');
        RequestNetworkAdapters();
    } 
    else if (targetViewId === 'startup') {
        if (panels.startup) panels.startup.style.display = 'flex';
        if (buttons.startup) buttons.startup.classList.add('active');
        RequestStartupApps();
    } 
    else if (targetViewId === 'sharing') {
        if (panels.sharing) panels.sharing.style.display = 'flex';
        if (buttons.sharing) buttons.sharing.classList.add('active');
        RequestSharingCenter();
    }
    else if (targetViewId === 'apps') {
        if (panels.apps) panels.apps.style.display = 'flex';
        if (buttons.apps) buttons.apps.classList.add('active');
        if (!window._installedAppsLoaded) {
            RequestInstalledApps();
        }
    }
    else if (targetViewId === 'appstore') {
        if (panels.appstore) panels.appstore.style.display = 'flex';
        if (buttons.appstore) buttons.appstore.classList.add('active');
        if (!window._appStoreLoaded) {
            RequestAppInstaller();
        }
    }
    else if (targetViewId === 'diskmap') {
        if (panels.diskmap) panels.diskmap.style.display = 'flex';
        if (buttons.diskmap) buttons.diskmap.classList.add('active');
        InitDiskMapTab();
    }
    else if (targetViewId === 'devices') {
        if (panels.devices) panels.devices.style.display = 'flex';
        if (buttons.devices) buttons.devices.classList.add('active');
        if (!window._systemDevicesLoaded) {
            RequestSystemDevices();
        }
    }
    else if (targetViewId === 'organizer') {
        if (panels.organizer) panels.organizer.style.display = 'flex';
        if (buttons.organizer) buttons.organizer.classList.add('active');
        if (!window._fileOrganizerLoaded) {
            RequestFileOrganizer();
        }
    }
    else if (targetViewId === 'diagx') {
        if (panels.diagx) panels.diagx.style.display = 'flex';
        if (buttons.diagx) buttons.diagx.classList.add('active');
        if (!window._ultimaDiagXLoaded) {
            InitUltimaDiagX();
        }
    }
    else if (targetViewId === 'tasksports') {
        if (panels.tasksports) panels.tasksports.style.display = 'flex';
        if (buttons.tasksports) buttons.tasksports.classList.add('active');
        if (!window._tasksPortsLoaded) {
            RequestTasksPorts();
        }
    }
    else if (targetViewId === 'wsl') {
        if (panels.wsl) panels.wsl.style.display = 'flex';
        if (buttons.wsl) buttons.wsl.classList.add('active');
        if (!window._wslManagerLoaded) {
            RequestWslManager();
        }
    }
    else if (targetViewId === 'security') {
        if (panels.security) panels.security.style.display = 'flex';
        if (buttons.security) buttons.security.classList.add('active');
        if (!window._secRepairLoaded) {
            RequestSecurityRepair();
        }
    }
    else {
        if (panels.dashboard) panels.dashboard.style.display = 'grid';
        if (buttons.dashboard) buttons.dashboard.classList.add('active');
    }
};

// =========================================================================
// SIDEBAR DRAWER INTERACTION UTILITY CONTROLLERS
// =========================================================================
window.ToggleNetworkDrawer = function(shouldOpen) {
    const drawer = document.getElementById('sideNetworkDrawer');
    if (!drawer) {
        console.error("[CRITICAL UI] Could not find drawer element handle '#sideNetworkDrawer' in DOM layout.");
        return;
    }
    
    if (shouldOpen) {
        // 1. FORCED IMMEDIATE ACTION: Reveal the panel instantly on click
        drawer.style.transform = "translateX(0)";
        drawer.classList.add('drawer-open');
        
        // 2. Ping the host layer to populate data in the background
        if (window.chrome && window.chrome.webview) {
            window.chrome.webview.postMessage("UI-Ready");
        }
    } else {
        drawer.style.transform = "translateX(100%)";
        drawer.classList.remove('drawer-open');
    }
};


// =========================================================================
// UNIFIED CHROMIUM ENVIRONMENT INBOUND WIRE MESSAGE PARSER
// =========================================================================
window._splashDismissed = false;
function DismissSplashOverlay() {
    if (window._splashDismissed) return;
    window._splashDismissed = true;
    const splash = document.getElementById('appSplashOverlayView');
    if (splash) {
        splash.classList.add('hidden-canvas');
    }
}

document.addEventListener("DOMContentLoaded", () => {
    // Safety fallback so splash never blocks indefinitely if a telemetry probe stalls
    setTimeout(() => DismissSplashOverlay(), 8000);

    if (window.chrome && window.chrome.webview) {
        window.chrome.webview.addEventListener("message", (event) => {
            try {
                const payload = event.data;
                if (!payload) return;

                let stats = null;

                // 1. Identify and process direct object representations
                if (typeof payload === 'object') {
                    stats = payload;
                } 
                // 2. Safely parse string-represented data payloads
                else if (typeof payload === 'string') {
                    const trimmed = payload.trim();
                    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
                        stats = JSON.parse(trimmed);
                    } else {
                        try {
                            // FIXED: Standardize cross-platform binary string decoding signatures smoothly
                            const binaryString = atob(trimmed);
                            const bytes = new Uint8Array(binaryString.length);
                            for (let i = 0; i < binaryString.length; i++) {
                                bytes[i] = binaryString.charCodeAt(i);
                            }
                            const decodedText = new TextDecoder("utf-8").decode(bytes);
                            stats = JSON.parse(decodedText);
                        } catch (base64Err) {
                            console.warn("[PIPELINE] Non-Base64 action message intercepted:", payload);
                            return;
                        }
                    }
                }


                if (!stats) return;

                
const msgType = stats.type || stats.Type;

    if (msgType === "FAST_TELEMETRY") {
        updateFastTelemetryMesh(stats);
    }
    else if (msgType === "REFRESH_STARTUP_APPS") {
        RenderStartupAppRows(stats);
    } 
    else if (msgType === 'SHARING_CENTER') {
        RenderSharingCenter(stats);
    }
    else if (msgType === "REFRESH_ADAPTER_STATE") {
        RenderNetworkAdapterInterfaceRows(stats);
    }
    else if (msgType === "REFRESH_INSTALLED_APPS") {
        RenderInstalledAppsData(stats);
    }
    else if (msgType === "APP_FOLDER_SIZE") {
        HandleCalculatedAppFolderSize(stats);
    }
    else if (msgType === "REFRESH_SYSTEM_DEVICES") {
        RenderSystemDevicesData(stats);
    }
    else if (msgType === "DEVICE_LINK_NOTICE") {
        const st = document.getElementById('devicesStatus');
        if (st && stats.message) {
            st.classList.toggle('sharing-error', !stats.ok);
            st.textContent = stats.message;
        }
        if (stats.message) AppendConsoleLogEntry(`[DEVICES] ${stats.message}`);
    }
    else if (msgType === "REFRESH_APP_INSTALLER") {
        RenderAppInstallerData(stats);
    }
    else if (msgType === "APPSTORE_SEARCH_RESULTS") {
        RenderAppStoreWingetResults(stats);
    }
    else if (msgType === "APPSTORE_NOTICE") {
        HandleAppStoreNotice(stats);
    }
    else if (msgType === "DISKMAP_DRIVES") {
        RenderDiskMapDrives(stats.drives || []);
    }
    else if (msgType === "DISKMAP_SCAN_RESULT") {
        RenderDiskMapScanResult(stats);
    }
    else if (msgType === "DISKMAP_NOTICE") {
        HandleDiskMapNotice(stats);
    }
    else if (msgType === "FILE_ORGANIZER_STATE") {
        RenderFileOrganizerState(stats);
    }
    else if (msgType === "BROWSE_FOLDER_RESULT") {
        HandleBrowseFolderResult(stats);
    }
    else if (msgType === "FILE_ORGANIZER_PREVIEW") {
        RenderFileOrganizerPreview(stats);
    }
    else if (msgType === "FILE_ORGANIZER_RESULT") {
        HandleFileOrganizerResult(stats);
    }
    else if (msgType === "FILE_ORGANIZER_NOTICE" || msgType === "FILE_ORGANIZER_ERROR") {
        HandleFileOrganizerNotice(stats);
    }
    else if (msgType === "BROWSE_LOGFILE_RESULT") {
        HandleDiagBrowseLogFiles(stats);
    }
    else if (msgType === "ULTIMADIAGX_REPORT") {
        RenderUltimaDiagXReport(stats);
    }
    else if (msgType === "ULTIMADIAGX_CODE_TRANSLATION") {
        RenderDiagXCodeTranslation(stats);
    }
    else if (msgType === "ULTIMADIAGX_DISCOVERED_LOGS") {
        RenderDiagXDiscoveredLogs(stats);
    }
    else if (msgType === "ULTIMADIAGX_NOTICE") {
        HandleDiagXNotice(stats);
    }
    else if (msgType === "SPEED_TEST_RESULTS") {
        RenderSpeedTestResults(stats);
    }
    else if (msgType === "DASHBOARD_CONTROL_RESULT") {
        HandleDashboardControlResult(stats);
    }
    else if (msgType === "WSL_MANAGER_STATE") {
        RenderWslManagerState(stats);
    }
    else if (msgType === "WSL_ONLINE_CATALOG") {
        RenderWslOnlineCatalog(stats.onlineCatalog, stats.catalogSource);
    }
    else if (msgType === "WSL_COMMAND_OUTPUT") {
        RenderWslCommandOutput(stats);
    }
    else if (msgType === "WSL_NOTICE") {
        HandleWslNotice(stats);
    }
    else if (msgType === "WSL_BROWSE_IMPORT_RESULT") {
        const inp = document.getElementById('wslImportSource');
        if (inp && stats.path) inp.value = stats.path;
    }
    else if (msgType === "WSL_BROWSE_EXPORT_RESULT") {
        if (stats.distro && stats.path) {
            ExecuteWslExportDistro(stats.distro, stats.path);
        }
    }
    else if (msgType === "TASKS_PORTS_STATE") {
        RenderTasksPortsState(stats);
    }
    else if (msgType === "TASKS_PORTS_NOTICE") {
        HandleTasksPortsNotice(stats);
    }
    else if (msgType === "NET_DIAG_RESULT") {
        RenderNetDiagResult(stats);
    }
    else if (msgType === "NET_DIAG_WIFI_ROUTES") {
        RenderNetDiagWifiAndRoutes(stats);
    }
    else if (msgType === "NET_DIAG_ERROR") {
        HandleNetDiagError(stats);
    }
    else if (msgType === "SECURITY_REPAIR_STATE") {
        RenderSecurityRepairState(stats);
    }
    else if (msgType === "SEC_ENV_HOSTS_PROXY_STATE") {
        RenderSecEnvHostsProxyState(stats);
    }
    else if (msgType === "REPAIR_TOOL_OUTPUT") {
        RenderRepairToolOutput(stats);
    }
    else if (msgType === "SECURITY_REPAIR_NOTICE") {
        HandleSecurityRepairNotice(stats);
    }
    else if (msgType === "SUPPORT_BUNDLE_PATH_RESULT") {
        if (stats.path) ExecuteSupportBundleExport(stats.path);
    }
    else {
        // Dashboard Full Telemetry (1s cadence)
        AppendLiveDiagnosticConsoleLog(stats);
        updateDashboardUiMesh(stats);
        if (stats.IdentityFrame && stats.SystemFrame) {
            DismissSplashOverlay();
        }
    }
            } catch (err) {
                console.error("Failed to unpack metrics package:", err);
            }
        });
        window.chrome.webview.postMessage("UI-Ready");
    }
});

window.RequestSharingCenter = function() {
    document.getElementById('sharingStatus').textContent = 'Loading shared folders...';
    window.chrome?.webview?.postMessage('Request-Shares');
};

function RenderSharingCenter(data) {
    const status = document.getElementById('sharingStatus');
    const list = document.getElementById('sharingList');
    status.textContent = data.error || data.message || `${(data.shares || []).length} shared folders found`;
    status.classList.toggle('sharing-error', !!data.error);
    if (data.shares === null || data.shares === undefined) return;
    list.replaceChildren();
    const formatSize = bytes => bytes === null || bytes === undefined ? 'Unavailable' :
        `${(bytes / 1048576).toLocaleString(undefined, {maximumFractionDigits: 1})} MB`;
    const formatDate = value => value ? new Date(value).toLocaleString() : 'Unavailable';
    for (const share of data.shares) {
        const card = document.createElement('article');
        card.className = 'sharing-card';
        const title = document.createElement('h3');
        title.textContent = `${share.name}${share.special ? ' · Windows system share' : ''}`;
        card.appendChild(title);
        for (const [label, value] of [
            ['Local directory', share.path || 'Unavailable'],
            ['Network path', share.networkPath || 'Unavailable'],
            ['Size', formatSize(share.sizeBytes)],
            ['Folder created', formatDate(share.created)], ['Folder modified', formatDate(share.modified)],
            ['Description', share.description || '—']
        ]) {
            const row = document.createElement('div');
            row.className = 'sharing-detail';
            const key = document.createElement('span');
            key.textContent = label;
            const detail = document.createElement('strong');
            detail.textContent = value;
            row.append(key, detail);
            card.appendChild(row);
        }
        const accessSection = document.createElement('section');
        accessSection.className = 'sharing-permissions';
        const accessTitle = document.createElement('h4');
        accessTitle.textContent = 'Share permissions';
        accessSection.appendChild(accessTitle);
        if (share.accessError) {
            const error = document.createElement('div');
            error.className = 'sharing-error';
            error.textContent = `Permissions unavailable: ${share.accessError}`;
            accessSection.appendChild(error);
        } else if (share.access?.length) {
            for (const entry of share.access) {
                const permissionRow = document.createElement('div');
                permissionRow.className = 'sharing-permission-row';
                const label = document.createElement('span');
                label.textContent = `${entry.account} · ${entry.type} ${entry.right}`;
                permissionRow.appendChild(label);
                if (!share.special) {
                    const removeAccess = document.createElement('button');
                    removeAccess.type = 'button';
                    removeAccess.textContent = 'Remove';
                    removeAccess.setAttribute('aria-label', `Remove ${entry.account} permission from ${share.name}`);
                    removeAccess.addEventListener('click', () => {
                        if (confirm(`Remove ${entry.account}'s ${entry.type.toLowerCase()} entry from ${share.name}?`)) {
                            window.chrome.webview.postMessage(JSON.stringify({command: 'REMOVE_SHARE_ACCESS', name: share.name, account: entry.account}));
                        }
                    });
                    permissionRow.appendChild(removeAccess);
                }
                accessSection.appendChild(permissionRow);
            }
        } else {
            const empty = document.createElement('div');
            empty.textContent = 'No share access entries found.';
            accessSection.appendChild(empty);
        }
        if (!share.special) {
            const form = document.createElement('form');
            form.className = 'sharing-access-form';
            const account = document.createElement('input');
            account.required = true;
            account.placeholder = 'User or group';
            account.setAttribute('aria-label', `User or group for ${share.name}`);
            const right = document.createElement('select');
            right.setAttribute('aria-label', `Access level for ${share.name}`);
            for (const level of ['Read', 'Change', 'Full']) {
                const option = document.createElement('option');
                option.value = level;
                option.textContent = level;
                right.appendChild(option);
            }
            const grant = document.createElement('button');
            grant.type = 'submit';
            grant.textContent = 'Grant / update';
            form.append(account, right, grant);
            form.addEventListener('submit', event => {
                event.preventDefault();
                const target = account.value.trim();
                if (!target) return;
                if (right.value === 'Full' && !confirm(`Give ${target} full control of ${share.name} over the network?`)) return;
                window.chrome.webview.postMessage(JSON.stringify({command: 'GRANT_SHARE_ACCESS', name: share.name, account: target, right: right.value}));
            });
            accessSection.appendChild(form);
        }
        card.appendChild(accessSection);
        if (!share.special) {
            const actions = document.createElement('div');
            actions.className = 'sharing-actions';
            const stop = document.createElement('button');
            stop.textContent = 'Stop sharing';
            stop.addEventListener('click', () => {
                if (confirm(`Stop sharing ${share.name}? The folder and its files will stay on disk.`))
                    window.chrome.webview.postMessage(JSON.stringify({command: 'REMOVE_SHARE', name: share.name}));
            });
            const remove = document.createElement('button');
            remove.textContent = 'Delete folder and share';
            remove.className = 'sharing-danger';
            remove.addEventListener('click', () => {
                const typed = prompt(`Permanently delete ${share.path} and all its contents? Type the share name (${share.name}) to confirm.`);
                if (typed === share.name) window.chrome.webview.postMessage(JSON.stringify({command: 'DELETE_SHARED_FOLDER', name: share.name, confirmName: typed, confirmPath: share.path}));
            });
            actions.append(stop, remove);
            card.appendChild(actions);
        }
        list.appendChild(card);
    }
    if (!data.shares.length) list.textContent = 'No shared folders found.';
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('shareCreateForm')?.addEventListener('submit', event => {
        event.preventDefault();
        const form = event.currentTarget;
        const values = new FormData(form);
        window.chrome.webview.postMessage(JSON.stringify({
            command: 'CREATE_SHARE', name: String(values.get('name')).trim(),
            path: String(values.get('path')).trim(), description: String(values.get('description')).trim()
        }));
    });

    document.getElementById('startupCreateForm')?.addEventListener('submit', event => {
        event.preventDefault();
        const form = event.currentTarget;
        const values = new FormData(form);
        const name = String(values.get('name') || '').trim();
        const commandLine = String(values.get('command') || '').trim();
        const scope = String(values.get('scope') || 'HKCU').trim();
        if (!name || !commandLine) return;

        const status = document.getElementById('startupStatus');
        if (status) status.textContent = `Adding ${name} to startup...`;

        window.chrome?.webview?.postMessage(JSON.stringify({
            command: 'CREATE_STARTUP_APP',
            name: name,
            commandLine: commandLine,
            scope: scope
        }));
        form.reset();
    });
});


window.LaunchExternalToolWindow = function(toolIdentifier) {
    if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(`Launch-Tool:${toolIdentifier}`);
    }
    console.log(`[INFRASTRUCTURE: Forwarded routing query for component: ${toolIdentifier}]`);
};

function SyncToolNavigationHighlights(appStates) {
    const watchdogBtn = document.getElementById('btnToggleWatchdog');
    if (watchdogBtn && appStates.NetworkFrame) {
        if (appStates.NetworkFrame.WatchdogActive === true || appStates.WatchdogLoopRunning === true) {
            watchdogBtn.classList.add('tool-running');
        } else {
            watchdogBtn.classList.remove('tool-running');
        }
    }
}

// =========================================================================
// TELEMETRY VIEW DATA MATRIX PAINTERS
// =========================================================================
function RenderCpuCacheMatrix(cache) {
    const container = document.getElementById('cpuCacheContainer');
    if (!container) return;

    container.replaceChildren();
    ['L1', 'L2', 'L3'].forEach(level => {
        const badge = document.createElement('span');
        badge.className = 'cache-tag';
        const value = cache?.[level] || 'N/A';
        const isX3D = level === 'L3' && cache?.IsX3D === true && value !== 'N/A';
        badge.textContent = `${level}: ${value}${isX3D ? ' (3D V-Cache)' : ''}`;
        badge.classList.toggle('highlight-x3d', isX3D);
        container.appendChild(badge);
    });
}

window._cachedMonitors = [];
window._selectedMonitorId = null;
window._lastMonitorSignature = '';

window.OnMonitorSelectionChange = function() {
    const picker = document.getElementById('selMonitorPicker');
    if (picker) {
        window._selectedMonitorId = picker.value;
    }
    ApplySelectedMonitorMetrics();
};

function RenderMonitorDeck(monitors) {
    const picker = document.getElementById('selMonitorPicker');
    if (!picker) return;

    const list = Array.isArray(monitors) ? monitors : (monitors ? [monitors] : []);
    window._cachedMonitors = list;

    if (list.length === 0) {
        if (window._lastMonitorSignature !== 'EMPTY') {
            picker.innerHTML = '<option value="">No displays detected</option>';
            window._lastMonitorSignature = 'EMPTY';
        }
        ApplySelectedMonitorMetrics();
        return;
    }

    const signature = list.map(m => `${m.Id}|${m.Label}`).join('||');
    if (signature !== window._lastMonitorSignature) {
        window._lastMonitorSignature = signature;
        const previousId = window._selectedMonitorId;
        picker.replaceChildren();

        list.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m.Id;
            opt.textContent = m.Label || m.FriendlyName || m.Id;
            picker.appendChild(opt);
        });

        const match = list.find(m => m.Id === previousId) || list.find(m => m.IsPrimary) || list[0];
        window._selectedMonitorId = match.Id;
        picker.value = match.Id;
    }

    ApplySelectedMonitorMetrics();
}

function ApplySelectedMonitorMetrics() {
    const list = window._cachedMonitors || [];
    const mon = list.find(m => m.Id === window._selectedMonitorId) || list[0];

    if (!mon) {
        ['lblMonResolution', 'lblMonRefresh', 'lblMonConnection', 'lblMonScale',
         'lblMonOrientation', 'lblMonHdr', 'lblMonNightLight', 'lblMonColorProfile']
            .forEach(id => SetDomText(id, '--'));
        return;
    }

    SetDomText('lblMonResolution',  mon.Resolution || '--');

    // [DYNAMIC CONTROL] Safe Driver-Verified Refresh Rate Selector
    const refEl = document.getElementById('lblMonRefresh');
    if (refEl) {
        const rates = Array.isArray(mon.AvailableRefreshRates)
            ? mon.AvailableRefreshRates.map(Number).filter(n => Number.isFinite(n) && n >= 24)
            : [];
        const curHz = Number(mon.RefreshRateHz || parseInt(mon.RefreshRate, 10) || 0);
        const existingSel = refEl.querySelector('select.infra-refresh-select');

        if (rates.length > 1) {
            const sig = `${mon.Id}|${rates.join(',')}`;
            const isBusy = IsControlPending('SET_MONITOR_REFRESH_RATE');
            const isFocused = existingSel && document.activeElement === existingSel;

            if (!isFocused) {
                if (!existingSel || existingSel.dataset.sig !== sig) {
                    const sel = document.createElement('select');
                    sel.className = 'infra-refresh-select';
                    sel.dataset.sig = sig;
                    sel.dataset.device = mon.Id || '';
                    sel.setAttribute('aria-label', 'Select safe monitor refresh rate');
                    sel.title = `Safe Windows driver-verified refresh rates for ${mon.Resolution || 'current resolution'}`;
                    rates.forEach(hz => {
                        const opt = document.createElement('option');
                        opt.value = String(hz);
                        opt.textContent = `${hz} Hz`;
                        if (hz === curHz) opt.selected = true;
                        sel.appendChild(opt);
                    });
                    sel.disabled = isBusy;
                    sel.addEventListener('change', (e) => {
                        TriggerRefreshRateChange(sel.dataset.device, Number(e.target.value), curHz);
                    });
                    refEl.replaceChildren(sel);
                } else {
                    existingSel.disabled = isBusy;
                    if (!isBusy && curHz > 0) {
                        existingSel.value = String(curHz);
                    }
                }
            }
        } else {
            refEl.textContent = mon.RefreshRate || '--';
        }
    }

    SetDomText('lblMonConnection',  mon.ConnectionType || '--');

    // [DYNAMIC CONTROL] Per-Monitor Display Scale Selector (Native Windows CCD API)
    const scaleEl = document.getElementById('lblMonScale');
    if (scaleEl) {
        const scales = Array.isArray(mon.AvailableScales)
            ? mon.AvailableScales.map(Number).filter(n => Number.isFinite(n) && n >= 100)
            : [];
        const curScale = Number(mon.ScalePct || parseInt(mon.Scale, 10) || 100);
        const existingScaleSel = scaleEl.querySelector('select.infra-refresh-select');

        if (scales.length > 1) {
            const sig = `${mon.Id}|scale|${scales.join(',')}`;
            const isBusy = IsControlPending('SET_MONITOR_SCALE');
            const isFocused = existingScaleSel && document.activeElement === existingScaleSel;

            if (!isFocused) {
                if (!existingScaleSel || existingScaleSel.dataset.sig !== sig) {
                    const sel = document.createElement('select');
                    sel.className = 'infra-refresh-select';
                    sel.dataset.sig = sig;
                    sel.dataset.device = mon.Id || '';
                    sel.setAttribute('aria-label', 'Select display scale percentage');
                    sel.title = 'Change Windows DPI scale for this monitor immediately';
                    scales.forEach(pct => {
                        const opt = document.createElement('option');
                        opt.value = String(pct);
                        opt.textContent = `${pct}%`;
                        if (pct === curScale) opt.selected = true;
                        sel.appendChild(opt);
                    });
                    sel.disabled = isBusy;
                    sel.addEventListener('change', (e) => {
                        TriggerScaleChange(sel.dataset.device, Number(e.target.value), curScale);
                    });
                    scaleEl.replaceChildren(sel);
                } else {
                    existingScaleSel.disabled = isBusy;
                    if (!isBusy && curScale >= 100) existingScaleSel.value = String(curScale);
                }
            }
        } else {
            scaleEl.textContent = mon.Scale || '--';
        }
    }

    // [DYNAMIC CONTROL] Safe Monitor Orientation Selector (CDS_TEST pre-validated)
    const oriEl = document.getElementById('lblMonOrientation');
    if (oriEl) {
        const curOri = Number.isFinite(Number(mon.OrientationCode)) ? Number(mon.OrientationCode) : 0;
        const existingOriSel = oriEl.querySelector('select.infra-refresh-select');
        const sig = `${mon.Id}|orient`;
        const isBusy = IsControlPending('SET_MONITOR_ORIENTATION');
        const isFocused = existingOriSel && document.activeElement === existingOriSel;
        const oriOptions = [
            { code: 0, label: 'Landscape' },
            { code: 1, label: 'Portrait' },
            { code: 2, label: 'Landscape (Flip)' },
            { code: 3, label: 'Portrait (Flip)' }
        ];

        if (!isFocused) {
            if (!existingOriSel || existingOriSel.dataset.sig !== sig) {
                const sel = document.createElement('select');
                sel.className = 'infra-refresh-select';
                sel.dataset.sig = sig;
                sel.dataset.device = mon.Id || '';
                sel.setAttribute('aria-label', 'Select display orientation');
                sel.title = 'Rotate display orientation (validated via Windows CDS_TEST)';
                oriOptions.forEach(o => {
                    const opt = document.createElement('option');
                    opt.value = String(o.code);
                    opt.textContent = o.label;
                    if (o.code === curOri) opt.selected = true;
                    sel.appendChild(opt);
                });
                sel.disabled = isBusy;
                sel.addEventListener('change', (e) => {
                    TriggerOrientationChange(sel.dataset.device, Number(e.target.value), curOri);
                });
                oriEl.replaceChildren(sel);
            } else {
                existingOriSel.disabled = isBusy;
                if (!isBusy) existingOriSel.value = String(curOri);
            }
        }
    }

    const hdrEl = document.getElementById('lblMonHdr');
    if (hdrEl) {
        const hdr = mon.HdrStatus || 'Unknown';
        const safeDev = String(mon.Id || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        if (IsControlPending('TOGGLE_HDR')) {
            hdrEl.innerHTML = `<button type="button" class="toggle-pill-btn is-busy" disabled>...</button>`;
        } else if (hdr === 'On') {
            hdrEl.innerHTML = `<button type="button" class="toggle-pill-btn state-on" onclick="TriggerHdrToggle('${safeDev}', 'Off')" title="HDR is On — Click to turn Off">On</button>`;
        } else if (hdr.startsWith('Off')) {
            hdrEl.innerHTML = `<button type="button" class="toggle-pill-btn state-off" onclick="TriggerHdrToggle('${safeDev}', 'On')" title="HDR is Supported (Off) — Click to turn On">Off</button>`;
        } else {
            hdrEl.textContent = hdr;
            hdrEl.style.color = '#718096';
        }
    }

    const nlEl = document.getElementById('lblMonNightLight');
    if (nlEl) {
        const nl = mon.NightLight || 'Off';
        if (IsControlPending('TOGGLE_NIGHT_LIGHT')) {
            nlEl.innerHTML = `<button type="button" class="toggle-pill-btn is-busy" disabled>...</button>`;
        } else if (nl === 'On') {
            nlEl.innerHTML = `<button type="button" class="toggle-pill-btn state-warn" onclick="TriggerNightLightToggle('Off')" title="Night Light is On — Click to turn Off">On</button>`;
        } else {
            nlEl.innerHTML = `<button type="button" class="toggle-pill-btn state-off" onclick="TriggerNightLightToggle('On')" title="Night Light is Off — Click to turn On">Off</button>`;
        }
    }

    // [DYNAMIC CONTROL] Sync Night Light Warmth Slider — enabled ONLY when Night Light is actively On
    const nlRow    = document.getElementById('nightLightSliderRow');
    const nlSlider = document.getElementById('rngNightLightStrength');
    const nlValLbl = document.getElementById('lblNightLightStrength');
    const strengthPending = IsControlPending('SET_NIGHT_LIGHT_STRENGTH');
    // During safe auto-reapply pulse (SET_NIGHT_LIGHT_STRENGTH), keep slider visually active without flickering Off
    const isNlOn   = ((mon.NightLight === 'On') || strengthPending) && !IsControlPending('TOGGLE_NIGHT_LIGHT');
    window._nightLightIsOn = isNlOn;

    const dragLocked = window._nlSliderDragLockUntil && Date.now() < window._nlSliderDragLockUntil;
    if (nlSlider && nlValLbl) {
        nlSlider.disabled = !isNlOn || strengthPending;
        if (nlRow) {
            nlRow.classList.toggle('is-disabled', !isNlOn);
            nlRow.title = isNlOn
                ? 'Adjust Windows Night Light warmth / blue-light reduction (0% = 6500K cool, 100% = 1200K warm)'
                : 'Turn Night Light On to adjust blue-light reduction warmth';
        }
        if (!dragLocked && !strengthPending) {
            const pct = Number.isFinite(Number(mon.NightLightStrength)) ? Number(mon.NightLightStrength) : 32;
            const kelvin = Number.isFinite(Number(mon.NightLightKelvin))
                ? Number(mon.NightLightKelvin)
                : Math.round(6500 - (pct / 100) * (6500 - 1200));
            nlSlider.value = String(pct);
            nlValLbl.textContent = isNlOn ? `${pct}% (${kelvin}K)` : `Off (${kelvin}K)`;
        }
    }

    const cpEl = document.getElementById('lblMonColorProfile');
    if (cpEl) {
        const cp = mon.ColorProfile || 'sRGB (Default)';
        cpEl.textContent = cp;
        cpEl.title = cp;
    }
}

function RenderAdapterStatusDeck(adapterStatuses) {
    const container = document.getElementById('adapterStatusContainer');
    if (!container) return;

    const list = Array.isArray(adapterStatuses) ? adapterStatuses : (adapterStatuses ? [adapterStatuses] : []);
    if (list.length === 0) {
        container.innerHTML = '<span class="driver-text-node">No adapters detected</span>';
        return;
    }

    const html = list.map(adapter => {
        const rawState = (adapter.Status || '').trim();
        const icon = adapter.Type === 'Wi-Fi' ? '📶' : (adapter.Type === 'Ethernet' ? '🌐' : '🔌');
        const safeName = (adapter.Name || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");

        let badgeHtml = '';
        if (rawState === 'On') {
            const titleText = `${adapter.Description || adapter.Name} (Connected) - Click to turn Off`;
            badgeHtml = `<button type="button" class="adapter-status-badge status-on" onclick="ToggleNetworkAdapterState('${safeName}', 'On', event)" title="${titleText}">On</button>`;
        } else if (rawState === 'D/C') {
            const titleText = `${adapter.Description || adapter.Name} (Disconnected / Cable unplugged)`;
            badgeHtml = `<span class="adapter-status-badge status-dc" title="${titleText}">D/C</span>`;
        } else {
            // Off / Disabled
            const titleText = `${adapter.Description || adapter.Name} (Disabled) - Click to turn On`;
            badgeHtml = `<button type="button" class="adapter-status-badge status-off" onclick="ToggleNetworkAdapterState('${safeName}', 'Off', event)" title="${titleText}">Off</button>`;
        }

        return `<span class="adapter-status-item"><span>${icon}</span> <span class="adapter-name">${adapter.Name}:</span> ${badgeHtml}</span>`;
    }).join('');
    SetDomHtml(container, html);
}

// =========================================================================
// [DIAGNOSTIC ADDITION] HELPER TO APPLY THROTTLE, VRAM & TOP PROCESS UI
// =========================================================================
function ApplyHardwareDiagnosticsUi(sys) {
    if (!sys) return;

    // 1. Thermal / Power Throttling Flag Badge
    const thBadge = document.getElementById('badgeThrottleState');
    if (thBadge && sys.ThrottleState) {
        const st = String(sys.ThrottleState);
        thBadge.textContent = `Throttle: ${st}`;
        thBadge.title = sys.ThrottleDetail || 'Thermal and power throttling monitor';
        thBadge.classList.remove('diag-ok', 'diag-warn', 'diag-crit');
        if (st === 'None') {
            thBadge.classList.add('diag-ok');
        } else if (st === 'Power') {
            thBadge.classList.add('diag-warn');
        } else {
            thBadge.classList.add('diag-crit');
        }
    }

    // 2. GPU VRAM Allocation Sub-Bar
    if (sys.GpuVramText !== undefined && sys.GpuVramText !== null) {
        SetDomText('lblGpuVram', sys.GpuVramText);
    }
    if (sys.GpuVramPercent !== undefined && sys.GpuVramPercent !== null) {
        SetDomStyleWidth('barGpuVram', `${sys.GpuVramPercent}%`);
    }

    // 3. Top Resource Consumer Single-Line Callout (caches PID/Name for click-to-inspect/terminate)
    if (sys.TopProcessText) {
        SetDomText('lblTopProcess', sys.TopProcessText);
        window._topProcessMeta = {
            text: sys.TopProcessText,
            detail: sys.TopProcessDetail || '',
            pid: Number(sys.TopProcessPid || 0),
            name: sys.TopProcessName || ''
        };
        const strip = document.getElementById('topProcessStrip');
        if (strip) {
            const detailStr = sys.TopProcessDetail ? `${sys.TopProcessDetail} — ` : '';
            strip.title = `${detailStr}Click to inspect or terminate top process`;
        }
    }
}

function updateFastTelemetryMesh(stats) {
    if (!stats || window._activeViewKey !== 'dashboard') return;

    const sys = stats.SystemFrame;
    if (sys) {
        SetDomText('lblCpuLoad', `${sys.CpuLoad}%`);
        SetDomStyleWidth('barCpuLoad', `${sys.CpuLoad}%`);
        if (sys.CpuClock) SetDomText('lblCpuClock', sys.CpuClock);
        if (sys.CpuTemp !== undefined && sys.CpuTemp !== null) {
            const cpuTempNum = Number(sys.CpuTemp);
            SetDomText('lblCpuTemp', Number.isFinite(cpuTempNum) ? cpuTempNum : sys.CpuTemp);
            const cpuBadge = document.getElementById('badgeCpuTemp');
            if (cpuBadge) {
                cpuBadge.classList.toggle('therm-hot', Number.isFinite(cpuTempNum) && cpuTempNum >= 75);
                cpuBadge.classList.toggle('therm-cool', !Number.isFinite(cpuTempNum) || cpuTempNum < 75);
                if (sys.CpuTempSource) cpuBadge.title = sys.CpuTempSource;
                const needsPawnIo = !Number.isFinite(cpuTempNum) && sys.LhmBundled === true && sys.PawnIoInstalled === false;
                cpuBadge.style.cursor = needsPawnIo ? 'pointer' : '';
                cpuBadge.onclick = needsPawnIo ? TriggerInstallPawnIo : null;
            }
        }

        if (sys.GpuLoad !== undefined && sys.GpuLoad !== null) {
            SetDomText('lblGpuLoad', `${sys.GpuLoad}%`);
            SetDomStyleWidth('barGpuLoad', `${sys.GpuLoad}%`);
        }
        if (sys.GpuPower !== undefined && sys.GpuPower !== null) SetDomText('lblGpuPower', sys.GpuPower);
        if (sys.GpuTemp !== undefined && sys.GpuTemp !== null) {
            const gpuTempNum = Number(sys.GpuTemp);
            SetDomText('lblGpuTemp', Number.isFinite(gpuTempNum) ? gpuTempNum : sys.GpuTemp);
            const gpuBadge = document.getElementById('badgeGpuTemp');
            if (gpuBadge) {
                gpuBadge.classList.toggle('therm-hot', Number.isFinite(gpuTempNum) && gpuTempNum >= 75);
                gpuBadge.classList.toggle('therm-cool', !Number.isFinite(gpuTempNum) || gpuTempNum < 75);
            }
        }

        ApplyHardwareDiagnosticsUi(sys);

        if (sys.RamUsageText) SetDomText('lblRamUsage', sys.RamUsageText);
        if (sys.RamPercent !== undefined) SetDomStyleWidth('barRamUsage', `${sys.RamPercent}%`);
        if (sys.PagefileUsageText) SetDomText('lblPagefileUsage', sys.PagefileUsageText);
        if (sys.PagefilePercent !== undefined) SetDomStyleWidth('barPagefileUsage', `${sys.PagefilePercent}%`);
    }

    const net = stats.NetworkActivity;
    if (net) {
        const rxElem = document.getElementById('lblNetRxValue') || document.getElementById('lblNetRx') || document.querySelector('.rx-numeric-text');
        if (rxElem) rxElem.innerText = net.RxText || "0.00 KB/s";

        const txElem = document.getElementById('lblNetTxValue') || document.getElementById('lblNetTx') || document.querySelector('.tx-numeric-text');
        if (txElem) txElem.innerText = net.TxText || "0.00 KB/s";

        const rxHalfPct = Math.min((net.RxPct || 0) * 0.5, 50);
        const txHalfPct = Math.min((net.TxPct || 0) * 0.5, 50);
        SetDomStyleWidth('barNetRx', `${rxHalfPct}%`);
        SetDomStyleWidth('barNetTx', `${txHalfPct}%`);
    }
}

function updateDashboardUiMesh(stats) {
    if (!stats) return;
    SyncToolNavigationHighlights(stats);

    // --- IdentityFrame Mapping ---
    const id = stats.IdentityFrame;
    if (id) {
        const hostElem = document.getElementById('lblHostName');
        const workElem = document.getElementById('lblWorkgroup');
        
        if (hostElem) {
            SetDomHtml(hostElem, `<span style="cursor:pointer; text-decoration:underline dotted;" onclick="TriggerHostRename('${id.HostName}')">${id.HostName}</span>`);
        }
        if (workElem) {
            SetDomHtml(workElem, `<span style="cursor:pointer; text-decoration:underline dotted;" onclick="TriggerWorkgroupRename('${id.Workgroup}')">${id.Workgroup}</span>`);
        }
        SetDomText('lblCpuModel', id.CpuModel);

        // [DIAGNOSTIC ADDITION] Admin / Elevation Context Pill (Clickable to Relaunch as Admin when Standard User)
        const elevElem = document.getElementById('lblElevation');
        if (elevElem && id.ElevationStatus) {
            elevElem.textContent = id.ElevationStatus;
            elevElem.classList.remove('diag-ok', 'diag-info', 'diag-warn', 'diag-neutral', 'clickable-pill');
            if (id.IsAdmin) {
                elevElem.classList.add('diag-info');
                elevElem.onclick = null;
                elevElem.title = 'Running elevated as Administrator (full WMI/SMART/toggle control access)';
            } else {
                elevElem.classList.add('diag-warn', 'clickable-pill');
                elevElem.onclick = TriggerRelaunchAsAdmin;
                elevElem.title = 'Running as Standard User — Click to relaunch CoreWatch as Administrator';
            }
        }
    }

    // --- InfraFrame Mapping ---
    const infra = stats.InfraFrame;
    if (infra) {
        SetDomText('lblOsEdition',      infra.OsEdition);
        SetDomText('lblWinBuild',       infra.WindowsBuild);
        SetDomText('lblUpdateLevel',    infra.WindowsUpdateLevel);
        SetDomText('lblDirectX',        infra.DirectX);
        SetDomText('lblVirtualization', infra.Virtualization);
        SetDomText('lblSecureBoot',     infra.SecureBoot || '--');
        RenderPowerShellVersionControl(infra);
        RenderJavaVersionControl(infra);
        SetDomText('lblMotherboard',    infra.Motherboard);
        SetDomText('lblBiosVersion',    infra.BiosVersion);
        SetDomText('lblPowerPlan',      infra.PowerPlan);
        SetDomText('lblUptime',         infra.UptimeText);
        SetDomText('lblAudioOutput',    infra.SoundCardIdentity);
        SetDomText('lblAudioInput',     infra.MicrophoneIdentity);
        RenderMonitorDeck(infra.Monitors);
        const plan = stats.SystemFrame?.PowerPlan || infra.PowerPlan || "Unknown";
        const powerPlanHtml = `<span style="cursor:pointer; text-decoration:underline dotted;" onclick="TriggerPowerPlanMenu()">${plan}</span>`;
        const planElem = document.getElementById('lblPowerPlan');
        if (planElem) SetDomHtml(planElem, powerPlanHtml);

        // [DIAGNOSTIC ADDITION] Pending Reboot Flag Pill (Clickable to trigger confirmed reboot when Yes)
        const rebootElem = document.getElementById('lblPendingReboot');
        if (rebootElem && infra.PendingReboot) {
            rebootElem.textContent = infra.PendingReboot;
            rebootElem.classList.remove('diag-ok', 'diag-warn', 'diag-crit', 'diag-neutral', 'clickable-pill');
            if (infra.PendingReboot === 'Yes') {
                rebootElem.classList.add('diag-warn', 'clickable-pill');
                rebootElem.onclick = TriggerPendingRebootRestart;
                rebootElem.title = `${infra.PendingRebootDetail || 'Reboot required'} — Click to restart PC now`;
            } else {
                rebootElem.classList.add('diag-ok');
                rebootElem.onclick = null;
                rebootElem.title = infra.PendingRebootDetail || 'No pending reboot flags detected';
            }
        }

        // [DIAGNOSTIC ADDITION] Last Unexpected Shutdown / BSOD Timestamp
        const crashElem = document.getElementById('lblLastCrash');
        if (crashElem && infra.LastCrashText) {
            crashElem.textContent = infra.LastCrashText;
            crashElem.title = infra.LastCrashDetail || '';
            crashElem.classList.remove('crash-recent', 'crash-older', 'crash-clean');
            if (infra.LastCrashText === 'None Recorded') {
                crashElem.classList.add('crash-clean');
            } else if (infra.HasRecentCrash) {
                crashElem.classList.add('crash-recent');
            } else {
                crashElem.classList.add('crash-older');
            }
        }
    }
    // --- SystemFrame Mapping ---
    const sys = stats.SystemFrame;
    if (sys) {
        RenderCpuCacheMatrix(sys.CacheMatrix);
        SetDomText('lblCpuLoad',        `${sys.CpuLoad}%`);
        SetDomStyleWidth('barCpuLoad',  `${sys.CpuLoad}%`);
        SetDomText('lblCpuClock',       sys.CpuClock);
        SetDomText('lblCpuTemp',        sys.CpuTemp);
        SetDomText('lblPagefileUsage', sys.PagefileUsageText); 
        SetDomStyleWidth('barPagefileUsage', `${sys.PagefilePercent}%`);
        // [DYNAMIC CONTROL] Windows Telemetry Bidirectional On <-> Off Toggle Pill
        const telElem = document.getElementById('lblTelemetry');
        if (telElem) {
            if (IsControlPending('TOGGLE_TELEMETRY')) {
                telElem.innerHTML = `<button type="button" class="toggle-pill-btn is-busy" disabled>...</button>`;
            } else if (sys.TelemetryStatus === "On") {
                telElem.innerHTML = `<button type="button" class="toggle-pill-btn state-on" onclick="TriggerTelemetryToggle('Off')" title="Windows Telemetry (DiagTrack) is On — Click to turn Off">On</button>`;
            } else {
                telElem.innerHTML = `<button type="button" class="toggle-pill-btn state-off" onclick="TriggerTelemetryToggle('On')" title="Windows Telemetry (DiagTrack) is Off — Click to turn On">Off</button>`;
            }
        }

        SetDomText('lblRamUsage', sys.RamUsageText);
        SetDomStyleWidth('barRamUsage', `${sys.RamPercent}%`);
        SetDomText('lblPagefileUsage', sys.PagefileUsageText);
        SetDomStyleWidth('barPagefileUsage', `${sys.PagefilePercent}%`);

        const cpuTempNum = Number(sys.CpuTemp);
        const cpuBadge = document.getElementById('badgeCpuTemp');
        if (cpuBadge) {
            cpuBadge.classList.toggle('therm-hot', Number.isFinite(cpuTempNum) && cpuTempNum >= 75);
            cpuBadge.classList.toggle('therm-cool', !Number.isFinite(cpuTempNum) || cpuTempNum < 75);
            if (sys.CpuTempSource) cpuBadge.title = sys.CpuTempSource;
            const needsPawnIo = !Number.isFinite(cpuTempNum) && sys.LhmBundled === true && sys.PawnIoInstalled === false;
            cpuBadge.style.cursor = needsPawnIo ? 'pointer' : '';
            cpuBadge.onclick = needsPawnIo ? TriggerInstallPawnIo : null;
        }

        SetDomText('lblGpuLoad',        `${sys.GpuLoad}%`);
        SetDomStyleWidth('barGpuLoad',  `${sys.GpuLoad}%`);
        SetDomText('lblGpuModel',       sys.GpuModel);
        SetDomText('lblGpuDriver',      sys.GpuDriverVersion);
        SetDomText('lblGpuPower',       sys.GpuPower);
        SetDomText('lblGpuTemp',        sys.GpuTemp);

        const gpuTempNum = Number(sys.GpuTemp);
        const gpuBadge = document.getElementById('badgeGpuTemp');
        if (gpuBadge) {
            gpuBadge.classList.toggle('therm-hot', Number.isFinite(gpuTempNum) && gpuTempNum >= 75);
            gpuBadge.classList.toggle('therm-cool', !Number.isFinite(gpuTempNum) || gpuTempNum < 75);
        }

        ApplyHardwareDiagnosticsUi(sys);
    }

    // --- NetworkFrame Mapping inside updateDashboardUiMesh ---
    const net = stats.NetworkFrame;
    if (net) {
        SetDomText('lblIntIPv4',        net.IntIPv4);
        SetDomText('lblSubnetMask',     net.SubnetMask);
        SetDomText('lblGateway',        net.Gateway);
        if (net.NetAssignment) SetDomText('lblNetAssignment', net.NetAssignment);

        // [DYNAMIC CONTROL] Network Profile Status Toggle Pill (Public <-> Private)
        const profElem = document.getElementById('lblNetworkStatus');
        if (profElem) {
            const prof = String(net.NetworkStatus || 'Disconnected');
            if (IsControlPending('TOGGLE_NET_PROFILE')) {
                profElem.innerHTML = `<button type="button" class="toggle-pill-btn is-busy" disabled>...</button>`;
            } else if (prof === 'Private') {
                profElem.innerHTML = `<button type="button" class="toggle-pill-btn state-info" onclick="TriggerNetworkProfileToggle('Public')" title="Private network profile — Click to switch to Public">Private</button>`;
            } else if (prof === 'Public') {
                profElem.innerHTML = `<button type="button" class="toggle-pill-btn state-warn" onclick="TriggerNetworkProfileToggle('Private')" title="Public network profile (restricts sharing/discovery) — Click to switch to Private">Public</button>`;
            } else {
                profElem.textContent = prof;
            }
        }

        SetDomText('lblWlanSsid',       net.WlanSsid);
        SetDomText('lblExtIPv4',        net.ExtIPv4);
        SetDomText('lblLinkCap',        net.LinkCap);

        // [DYNAMIC CONTROL] Firewall On <-> Off Toggle Pill + Provider Hint
        const fwElem = document.getElementById('lblFirewall');
        if (fwElem) {
            const fwRaw = String(net.Firewall || 'Unknown');
            const fwMatch = fwRaw.match(/^(On|Off)(?:\s*\((.+)\))?$/i);
            const fwState = fwMatch ? fwMatch[1] : fwRaw;
            const fwProviderFull = fwMatch && fwMatch[2] ? fwMatch[2] : '';
            const fwProviderShort = fwProviderFull === 'Windows Firewall' ? 'WinFW' : fwProviderFull;
            const providerHtml = fwProviderShort ? ` <span class="net-provider-hint" title="${fwProviderFull}">(${fwProviderShort})</span>` : '';

            if (IsControlPending('TOGGLE_FIREWALL')) {
                fwElem.innerHTML = `<button type="button" class="toggle-pill-btn is-busy" disabled>...</button>${providerHtml}`;
            } else if (fwState.toLowerCase() === 'on') {
                fwElem.innerHTML = `<button type="button" class="toggle-pill-btn state-on" onclick="TriggerFirewallToggle('Off')" title="${fwRaw} — Click to turn Firewall Off">On</button>${providerHtml}`;
            } else if (fwState.toLowerCase() === 'off') {
                fwElem.innerHTML = `<button type="button" class="toggle-pill-btn state-off" onclick="TriggerFirewallToggle('On')" title="${fwRaw} — Click to turn Firewall On">Off</button>${providerHtml}`;
            } else {
                fwElem.textContent = fwRaw;
            }
        }

        // [DYNAMIC CONTROL] Microsoft Defender Tamper Protection + Gated Protection Toggles
        const tamperRaw   = String(net.TamperProtection || 'Unknown');
        const tamperLow   = tamperRaw.toLowerCase();
        const isTamperOn  = (tamperLow === 'on');

        const buildTamperPillHtml = () => {
            if (IsControlPending('OPEN_TAMPER_SETTINGS')) {
                return `<button type="button" class="toggle-pill-btn is-busy" disabled>...</button>`;
            }
            if (tamperLow === 'on') {
                return `<button type="button" class="toggle-pill-btn state-on" onclick="TriggerOpenTamperSettings()" title="Tamper Protection is ON (locks Realtime, Behavior, Cloud & IOAV toggles). Click to open Windows Security settings to turn it Off">On ↗</button>`;
            }
            if (tamperLow === 'off') {
                return `<button type="button" class="toggle-pill-btn state-off" onclick="TriggerOpenTamperSettings()" title="Tamper Protection is OFF (Defender toggles unlocked). Click to open Windows Security settings to re-enable it">Off ↗</button>`;
            }
            return `<button type="button" class="toggle-pill-btn state-info" onclick="TriggerOpenTamperSettings()" title="Click to view Tamper Protection in Windows Security">${tamperRaw} ↗</button>`;
        };

        const buildGatedDefenderPillHtml = (rawVal, cmdName, fnName, label) => {
            const st = String(rawVal || 'Unknown');
            const low = st.toLowerCase();
            if (IsControlPending(cmdName)) {
                return `<button type="button" class="toggle-pill-btn is-busy" disabled>...</button>`;
            }
            if (isTamperOn && (low === 'on' || low === 'off')) {
                const safeLbl = label.replace(/'/g, "\\'");
                return `<button type="button" class="toggle-pill-btn state-locked" aria-disabled="true" onclick="NotifyTamperLocked('${safeLbl}')" title="${label} is ${st} — Locked while Tamper Protection is ON. Turn Tamper Protection Off in Windows Security first.">🔒 ${st}</button>`;
            }
            if (low === 'on') {
                return `<button type="button" class="toggle-pill-btn state-on" onclick="${fnName}('Off')" title="${label} is On (Tamper Protection Off) — Click to turn Off">On</button>`;
            }
            if (low === 'off') {
                return `<button type="button" class="toggle-pill-btn state-off" onclick="${fnName}('On')" title="${label} is Off — Click to turn On">Off</button>`;
            }
            return st;
        };

        const tamperHtml   = buildTamperPillHtml();
        const realtimeHtml = buildGatedDefenderPillHtml(net.Realtime,        'TOGGLE_REALTIME',         'TriggerRealtimeToggle', 'Real-Time Protection');
        const behaviorHtml = buildGatedDefenderPillHtml(net.BehaviorMonitor, 'TOGGLE_BEHAVIOR_MONITOR', 'TriggerBehaviorToggle', 'Behavior Monitoring');
        const cloudHtml    = buildGatedDefenderPillHtml(net.CloudProtection, 'TOGGLE_CLOUD_PROTECTION', 'TriggerCloudToggle',    'Cloud-Delivered Protection');
        const ioavHtml     = buildGatedDefenderPillHtml(net.IoavProtection,  'TOGGLE_IOAV_PROTECTION',  'TriggerIoavToggle',     'Download / IOAV Scan');

        ['lblTamperProtection', 'lblSecTamper'].forEach(id => SetDomHtml(id, tamperHtml));
        ['lblRealtime',         'lblSecRealtime'].forEach(id => SetDomHtml(id, realtimeHtml));
        ['lblBehaviorMonitor',  'lblSecBehavior'].forEach(id => SetDomHtml(id, behaviorHtml));
        ['lblCloudProtection',  'lblSecCloud'].forEach(id => SetDomHtml(id, cloudHtml));
        ['lblIoavProtection',   'lblSecIoav'].forEach(id => SetDomHtml(id, ioavHtml));

        const secDefHint = document.getElementById('lblSecDefenderHint');
        if (secDefHint) {
            if (isTamperOn) {
                secDefHint.textContent = '🔒 Tamper Protection is ON — turn it Off via T. Protection ↗ to unlock Defender toggles';
                secDefHint.style.color = '#ecc94b';
            } else if (tamperLow === 'off') {
                secDefHint.textContent = '🔓 Tamper Protection is OFF — Realtime, Behavior, Cloud & IOAV toggles are unlocked';
                secDefHint.style.color = '#68d391';
            } else {
                secDefHint.textContent = 'Defender status synced from Windows Security';
                secDefHint.style.color = '#a0aec0';
            }
        }

        // [DYNAMIC CONTROL] Network Discovery On <-> Off Toggle Pill
        const discElem = document.getElementById('lblDiscovery');
        if (discElem) {
            const disc = String(net.Discovery || 'Off');
            let discHtml = '';
            if (IsControlPending('TOGGLE_DISCOVERY')) {
                discHtml = `<button type="button" class="toggle-pill-btn is-busy" disabled>...</button>`;
            } else if (disc.toLowerCase() === 'on') {
                discHtml = `<button type="button" class="toggle-pill-btn state-on" onclick="TriggerDiscoveryToggle('Off')" title="Network Discovery is On — Click to turn Off">On</button>`;
            } else {
                discHtml = `<button type="button" class="toggle-pill-btn state-off" onclick="TriggerDiscoveryToggle('On')" title="Network Discovery is Off — Click to turn On">Off</button>`;
            }
            SetDomHtml(discElem, discHtml);
        }

        // [DYNAMIC CONTROL] File & Printer Sharing On <-> Off Toggle Pill
        const shareElem = document.getElementById('lblSharing');
        if (shareElem) {
            const sh = String(net.Sharing || 'Off');
            let shareHtml = '';
            if (IsControlPending('TOGGLE_SHARING')) {
                shareHtml = `<button type="button" class="toggle-pill-btn is-busy" disabled>...</button>`;
            } else if (sh.toLowerCase() === 'on') {
                shareHtml = `<button type="button" class="toggle-pill-btn state-on" onclick="TriggerSharingToggle('Off')" title="File & Printer Sharing (SMB) is On — Click to turn Off">On</button>`;
            } else {
                shareHtml = `<button type="button" class="toggle-pill-btn state-off" onclick="TriggerSharingToggle('On')" title="File & Printer Sharing (SMB) is Off — Click to turn On">Off</button>`;
            }
            SetDomHtml(shareElem, shareHtml);
        }

        SetDomText('lblEthernet',       net.lblEthDriver);
        SetDomText('lblWifi',           net.lblWifiDriver);

        // [DIAGNOSTIC ADDITION] Active DNS Servers, DNS Resolution Check & Gateway ARP Pill
        if (net.DnsServers) SetDomText('lblDnsServers', net.DnsServers);
        const dnsElem = document.getElementById('lblDnsStatus');
        if (dnsElem && net.DnsStatusText) {
            dnsElem.textContent = IsControlPending('FLUSH_AND_TEST_DNS') ? 'Probing...' : net.DnsStatusText;
            dnsElem.title = `DNS probe (${net.DnsServers || 'Auto'}) — Click to flush DNS cache & re-test`;
            dnsElem.classList.remove('diag-ok', 'diag-warn', 'diag-crit', 'diag-neutral');
            if (IsControlPending('FLUSH_AND_TEST_DNS')) dnsElem.classList.add('diag-neutral');
            else if (net.DnsStatus === 'OK') dnsElem.classList.add('diag-ok');
            else if (net.DnsStatus === 'FAIL') dnsElem.classList.add('diag-crit');
            else dnsElem.classList.add('diag-neutral');
        }
        const arpElem = document.getElementById('lblArpStatus');
        if (arpElem && net.ArpStatus) {
            arpElem.textContent = IsControlPending('REFRESH_ARP_GATEWAY') ? 'Probing...' : net.ArpStatus;
            arpElem.title = `${net.ArpDetail || `Gateway MAC: ${net.GatewayMac || 'N/A'}`} — Click to refresh Gateway ARP cache`;
            arpElem.classList.remove('diag-ok', 'diag-warn', 'diag-crit', 'diag-neutral');
            const arpLower = String(net.ArpStatus).toLowerCase();
            if (IsControlPending('REFRESH_ARP_GATEWAY')) arpElem.classList.add('diag-neutral');
            else if (arpLower === 'reachable' || arpLower === 'permanent') arpElem.classList.add('diag-ok');
            else if (arpLower === 'stale' || arpLower === 'delay' || arpLower === 'probe') arpElem.classList.add('diag-warn');
            else arpElem.classList.add('diag-crit');
        }

        RenderAdapterStatusDeck(net.AdapterStatuses);
        
        const rxValue = net.RxText || "0.00 KB/s";
        const rxElem = document.getElementById('lblNetRxValue') || document.getElementById('lblNetRx') || document.querySelector('.rx-numeric-text');
        if (rxElem) { rxElem.innerText = rxValue; }
        
        const txValue = net.TxText || "0.00 KB/s";
        const txElem = document.getElementById('lblNetTxValue') || document.getElementById('lblNetTx') || document.querySelector('.tx-numeric-text');
        if (txElem) { txElem.innerText = txValue; }
        
        const rxHalfPct = Math.min((net.RxPct || 0) * 0.5, 50);
        const txHalfPct = Math.min((net.TxPct || 0) * 0.5, 50);
        
        SetDomStyleWidth('barNetRx', `${rxHalfPct}%`);
        SetDomStyleWidth('barNetTx', `${txHalfPct}%`);
    }

    // --- StorageFrame Mapping (Skip DOM rebuild if drive snapshot hasn't changed) ---
    const storage = stats.StorageFrame;
    if (storage && window._activeViewKey === 'dashboard') {
        const container = document.getElementById('storageVolumeContainer');
        if (container) {
            const storageSig = JSON.stringify(storage);
            if (container._lastSig === storageSig) return;
            container._lastSig = storageSig;
            container.innerHTML = '';
            let drives = Array.isArray(storage) ? storage : [storage];
            
            drives.sort((a, b) => {
                if (a.DriveType === "Removable" && b.DriveType !== "Removable") return 1;
                if (a.DriveType !== "Removable" && b.DriveType === "Removable") return -1;
                return 0;
            });
            
            drives.forEach((drive) => {
                const usedPercent = drive.StorageTotalGB > 0 ? Math.min(100, Math.max(0, (drive.StorageUsedGB / drive.StorageTotalGB) * 100)) : 0;
                const isRemovable = drive.DriveType === "Removable";
                const fillColor = isRemovable ? "#9f7aea" : "#3182ce";
                const labelColorClass = isRemovable ? "text-removable" : "text-local";
                const tagIconStyle = isRemovable ? "style='filter: hue-rotate(50deg) saturate(1.5);'" : "";

                // [DIAGNOSTIC ADDITION] SMART Health / Wear & Live I/O Latency Badges
                const health = drive.HealthStatus || "N/A";
                const hasWear = drive.WearPercent !== null && drive.WearPercent !== undefined && Number.isFinite(Number(drive.WearPercent));
                const wearNum = hasWear ? Number(drive.WearPercent) : null;
                let smartClass = "diag-neutral";
                if (health === "Healthy") {
                    if (wearNum !== null && wearNum >= 90) smartClass = "diag-crit";
                    else if (wearNum !== null && wearNum >= 70) smartClass = "diag-warn";
                    else smartClass = "diag-ok";
                } else if (health === "Warning") {
                    smartClass = "diag-warn";
                } else if (health === "Unhealthy") {
                    smartClass = "diag-crit";
                }
                const smartLabel = health === "N/A"
                    ? "SMART N/A"
                    : (hasWear ? `${health} · ${wearNum}% Wear` : health);

                const activePct = Number.isFinite(Number(drive.DiskActivePct)) ? Number(drive.DiskActivePct) : 0;
                const latMs = Number.isFinite(Number(drive.DiskLatencyMs)) ? Number(drive.DiskLatencyMs) : 0;
                const queueLen = Number.isFinite(Number(drive.DiskQueueLen)) ? Number(drive.DiskQueueLen) : 0;
                const ioClass = (activePct >= 90 || latMs >= 35)
                    ? "diag-crit"
                    : ((activePct >= 70 || latMs >= 15) ? "diag-warn" : "diag-neutral");
                const mediaSuffix = drive.MediaType ? ` · ${drive.MediaType}` : "";
                const safeSmartTip = String(drive.SmartSummary || "SMART reliability status").replace(/"/g, '&quot;');
                const ioTip = `Disk Active Time: ${activePct}% | Avg I/O Latency: ${latMs.toFixed(1)} ms | Queue Length: ${queueLen}`;

                const metricRowHtml = `
                    <div class="metric-row storage-tight-row">
                        <div class="metric-metadata">
                            <span class="storage-interactive-row-header" onclick="TriggerVolumeRelabel('${drive.MainDriveLetter}', '${drive.VolumeLabel}')">
                                <span class="storage-tag-icon" ${tagIconStyle}>🏷️</span> 
                                <span class="drive-title ${labelColorClass}">${drive.VolumeLabel} (${drive.MainDriveLetter})</span>
                            </span>
                            <span class="storage-data-numeric-text">
                                ${drive.StorageUsedGB} / ${drive.StorageTotalGB} GB (${Math.round(usedPercent)}%)
                            </span>
                        </div>
                        <div class="track-bg">
                            <div class="track-fill" style="width: ${usedPercent}%; background-color: ${fillColor};"></div>
                        </div>
                        <div class="storage-diag-footer">
                            <div class="driver-tag tight-tag">${drive.DriveType}${mediaSuffix}</div>
                            <div class="storage-diag-badges">
                                <button type="button" class="storage-map-btn" onclick="OpenDriveInDiskMap('${drive.MainDriveLetter}\\')" title="Scan ${drive.MainDriveLetter}\\ visually in Disk Map (WizTree-style)">🗺️ Map</button>
                                <span class="diag-pill ${smartClass}" title="${safeSmartTip}">${smartLabel}</span>
                                <span class="diag-pill ${ioClass}" title="${ioTip}">IO: ${activePct}% · ${latMs.toFixed(1)}ms</span>
                            </div>
                        </div>
                    </div>
                `;
                container.insertAdjacentHTML('beforeend', metricRowHtml);
            });
        }
    }
}
// =========================================================================
// INLINE VIEW NETWORK ADAPTER RENDERING MATRIX & COMMITS
// =========================================================================
window.RequestNetworkAdapters = function() {
    const status = document.getElementById('netManagerStatus');
    if (status) status.textContent = 'Scanning network hardware interfaces...';
    if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage('Request-Adapters');
    }
};

window.FlushDnsCache = function() {
    const status = document.getElementById('netManagerStatus');
    if (status) status.textContent = 'Flushing Windows DNS Resolver Cache...';
    if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(JSON.stringify({ command: 'FLUSH_DNS_CACHE' }));
    }
};

window.RestartNetworkAdapter = function(interfaceAlias) {
    if (confirm(`Restart network adapter [ ${interfaceAlias} ]?\nThis will cycle the link down and up.`)) {
        const status = document.getElementById('netManagerStatus');
        if (status) status.textContent = `Restarting adapter [ ${interfaceAlias} ]...`;
        if (window.chrome && window.chrome.webview) {
            window.chrome.webview.postMessage(JSON.stringify({
                command: 'RESTART_ADAPTER',
                interfaceAlias: interfaceAlias
            }));
        }
    }
};

window.RenameNetworkAdapter = function(oldAlias) {
    const newName = prompt(`Enter new name for network adapter [ ${oldAlias} ]:`, oldAlias);
    if (newName && newName.trim() && newName.trim() !== oldAlias) {
        const status = document.getElementById('netManagerStatus');
        if (status) status.textContent = `Renaming adapter to [ ${newName.trim()} ]...`;
        if (window.chrome && window.chrome.webview) {
            window.chrome.webview.postMessage(JSON.stringify({
                command: 'RENAME_ADAPTER',
                interfaceAlias: oldAlias,
                newAlias: newName.trim(),
                newName: newName.trim()
            }));
        }
    }
};

window.ExecuteAdapterDhcpRelease = function(interfaceAlias) {
    if (confirm(`Revert [ ${interfaceAlias} ] to automatic DHCP addressing?`)) {
        const status = document.getElementById('netManagerStatus');
        if (status) status.textContent = `Reverting [ ${interfaceAlias} ] to DHCP...`;
        if (window.chrome && window.chrome.webview) {
            window.chrome.webview.postMessage(JSON.stringify({
                command: 'TRIGGER_DHCP_REVERSION',
                interfaceAlias: interfaceAlias
            }));
        }
    }
};

window.ExecuteAdapterStaticProvisioning = function(interfaceAlias, form) {
    const ip = form.ipAddress?.value.trim();
    if (!ip) return alert("Error: A valid destination IP allocation is required.");
    const mask = form.subnetMask?.value.trim() || "255.255.255.0";
    const gw = form.gateway?.value.trim() || "";
    const dns = form.dns?.value.trim() || "";

    const status = document.getElementById('netManagerStatus');
    if (status) status.textContent = `Applying static configuration to [ ${interfaceAlias} ]...`;

    const payload = {
        command: "SET_STATIC_IP",
        interfaceAlias: interfaceAlias,
        ipAddress: ip,
        subnetMask: mask,
        gateway: gw,
        dns: dns
    };
    if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(JSON.stringify(payload));
    }
};

function RenderNetworkAdapterInterfaceRows(data) {
    const status = document.getElementById('netManagerStatus');
    const container = document.getElementById('adapterInterfaceContainer');
    if (!container) return;

    let targetArray = data;
    if (data && !Array.isArray(data)) {
        if (status) {
            const count = Array.isArray(data.interfaces) ? data.interfaces.length : (data.interfaces ? 1 : 0);
            status.textContent = data.error || data.message || `${count} network adapters found`;
            status.classList.toggle('sharing-error', !!data.error);
        }
        targetArray = Array.isArray(data.interfaces) ? data.interfaces : (data.interfaces ? [data.interfaces] : []);
    }
    container.replaceChildren();

    if (!targetArray || !Array.isArray(targetArray) || targetArray.length === 0) {
        container.innerHTML = `<div class="driver-text-node">No connected hardware lines returned from engine.</div>`;
        return;
    }

    targetArray.forEach(adapter => {
        const card = document.createElement('article');
        card.className = 'sharing-card';

        const title = document.createElement('h3');
        title.textContent = `${adapter.Alias} · ${adapter.InterfaceDescription || 'Network Adapter'}`;
        card.appendChild(title);

        const rawStatus = (adapter.Status || '').trim().toLowerCase();
        const adminDown = (adapter.AdminStatus || '').trim().toLowerCase() === 'down';
        let statusBadgeHtml = '';
        if (adminDown || rawStatus === 'disabled') {
            statusBadgeHtml = '<span class="sharing-badge badge-danger">Disabled</span>';
        } else if (rawStatus === 'up') {
            statusBadgeHtml = '<span class="sharing-badge badge-success">Connected</span>';
        } else if (rawStatus === 'disconnected' || rawStatus === 'not connected') {
            statusBadgeHtml = '<span class="sharing-badge badge-purple">D/C</span>';
        } else {
            statusBadgeHtml = `<span class="sharing-badge badge-neutral">${adapter.Status || 'Unknown'}</span>`;
        }

        const details = [
            ['Physical Status', statusBadgeHtml, true],
            ['MAC Address', adapter.MacAddress || 'Unavailable'],
            ['Link Speed', adapter.LinkSpeed || 'Unavailable'],
            ['IPv4 Address', adapter.IPAddress || 'Disconnected'],
            ['Subnet Mask', `${adapter.SubnetMask} (/${adapter.PrefixLength})`],
            ['Gateway', adapter.Gateway || 'N/A'],
            ['DNS Servers', adapter.DnsServers || 'DHCP / Automatic'],
            ['Assignment', adapter.Profile || 'DHCP']
        ];

        details.forEach(([label, value, isHtml]) => {
            const row = document.createElement('div');
            row.className = 'sharing-detail';
            const key = document.createElement('span');
            key.textContent = label;
            const detail = document.createElement('strong');
            if (isHtml) {
                detail.innerHTML = value;
            } else {
                detail.textContent = value;
            }
            row.append(key, detail);
            card.appendChild(row);
        });

        const configSection = document.createElement('section');
        configSection.className = 'sharing-permissions';
        const configTitle = document.createElement('h4');
        configTitle.textContent = 'IP Allocation & DNS Configuration';
        configSection.appendChild(configTitle);

        const form = document.createElement('form');
        form.className = 'sharing-access-form';

        const ipInput = document.createElement('input');
        ipInput.name = 'ipAddress';
        ipInput.required = true;
        ipInput.placeholder = 'Static IP (e.g. 192.168.1.100)';
        ipInput.value = adapter.Profile === 'DHCP' ? '' : (adapter.IPAddress !== 'Disconnected' ? adapter.IPAddress : '');

        const maskInput = document.createElement('input');
        maskInput.name = 'subnetMask';
        maskInput.placeholder = 'Subnet Mask';
        maskInput.value = adapter.SubnetMask || '255.255.255.0';

        const gwInput = document.createElement('input');
        gwInput.name = 'gateway';
        gwInput.placeholder = 'Gateway';
        gwInput.value = (adapter.Gateway && adapter.Gateway !== 'N/A') ? adapter.Gateway : '';

        const dnsInput = document.createElement('input');
        dnsInput.name = 'dns';
        dnsInput.placeholder = 'DNS (comma separated)';
        dnsInput.value = (adapter.DnsServers && adapter.DnsServers !== 'DHCP / Automatic') ? adapter.DnsServers : '';

        const submitBtn = document.createElement('button');
        submitBtn.type = 'submit';
        submitBtn.textContent = 'Apply IP / DNS';

        form.append(ipInput, maskInput, gwInput, dnsInput, submitBtn);
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            ExecuteAdapterStaticProvisioning(adapter.Alias, form);
        });
        configSection.appendChild(form);
        card.appendChild(configSection);

        const actions = document.createElement('div');
        actions.className = 'sharing-actions';

        if (adapter.Profile !== 'DHCP') {
            const dhcpBtn = document.createElement('button');
            dhcpBtn.type = 'button';
            dhcpBtn.textContent = 'Revert to DHCP';
            dhcpBtn.addEventListener('click', () => ExecuteAdapterDhcpRelease(adapter.Alias));
            actions.appendChild(dhcpBtn);
        }

        const restartBtn = document.createElement('button');
        restartBtn.type = 'button';
        restartBtn.textContent = 'Restart Adapter';
        restartBtn.addEventListener('click', () => RestartNetworkAdapter(adapter.Alias));
        actions.appendChild(restartBtn);

        const renameBtn = document.createElement('button');
        renameBtn.type = 'button';
        renameBtn.textContent = 'Rename';
        renameBtn.addEventListener('click', () => RenameNetworkAdapter(adapter.Alias));
        actions.appendChild(renameBtn);

        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        const isOff = adminDown || rawStatus === 'disabled';
        if (isOff) {
            toggleBtn.textContent = 'Enable Adapter';
            toggleBtn.style.color = '#48bb78';
            toggleBtn.style.borderColor = '#38a169';
            toggleBtn.addEventListener('click', (e) => ToggleNetworkAdapterState(adapter.Alias, 'Off', e));
        } else {
            toggleBtn.textContent = 'Disable Adapter';
            toggleBtn.className = 'sharing-danger';
            toggleBtn.addEventListener('click', (e) => ToggleNetworkAdapterState(adapter.Alias, 'On', e));
        }
        actions.appendChild(toggleBtn);

        card.appendChild(actions);
        container.appendChild(card);
    });
}

window.ToggleNetworkAdapterState = function(adapterName, currentStatus, event) {
    if (event) {
        event.stopPropagation();
    }
    const isCurrentlyOn = (currentStatus || '').toLowerCase() === 'on';
    const targetState = isCurrentlyOn ? 'Off' : 'On';
    const actionWord = isCurrentlyOn ? 'disable' : 'enable';

    if (isCurrentlyOn && !confirm(`Are you sure you want to disable network adapter [ ${adapterName} ]?`)) {
        return;
    }

    if (event && event.currentTarget) {
        const btn = event.currentTarget;
        btn.textContent = '...';
        btn.disabled = true;
    }

    const payload = {
        command: "TOGGLE_ADAPTER_STATE",
        interfaceAlias: adapterName,
        targetState: targetState
    };

    AppendConsoleLogEntry(`[NETWORK: HARDWARE PROVISIONING] Requesting ${actionWord.toUpperCase()} for adapter [ ${adapterName} ]...`);

    if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(JSON.stringify(payload));
    }
};
// =========================================================================
// STARTUP APPLICATION MANAGER RENDERING
// =========================================================================
window.RequestStartupApps = function() {
    const status = document.getElementById('startupStatus');
    if (status) status.textContent = 'Fetching boot registration entries...';
    if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage('Request-StartupApps');
    }
};

window.ToggleStartupApp = function(name, type, enable) {
    if (confirm(`${enable ? 'Enable' : 'Disable'} [ ${name} ] on system boot?`)) {
        const status = document.getElementById('startupStatus');
        if (status) status.textContent = `Updating boot state for [ ${name} ]...`;
        if (window.chrome && window.chrome.webview) {
            window.chrome.webview.postMessage(JSON.stringify({
                command: "TOGGLE_STARTUP_APP",
                name: name,
                type: type,
                enable: enable
            }));
        }
    }
};

window.OpenStartupFileLocation = function(targetExe) {
    if (!targetExe || targetExe === 'Unavailable') {
        return alert("Error: Executable target path is unavailable.");
    }
    const status = document.getElementById('startupStatus');
    if (status) status.textContent = `Opening file location for [ ${targetExe} ]...`;
    if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(JSON.stringify({
            command: "OPEN_FILE_LOCATION",
            targetExe: targetExe
        }));
    }
};

window.RemoveStartupApp = function(name, loc, type) {
    if (confirm(`Permanently remove [ ${name} ] from system boot registrations?`)) {
        const status = document.getElementById('startupStatus');
        if (status) status.textContent = `Removing [ ${name} ]...`;
        if (window.chrome && window.chrome.webview) {
            window.chrome.webview.postMessage(JSON.stringify({ 
                command: "REMOVE_STARTUP_APP", 
                name: name, 
                location: loc, 
                type: type 
            }));
        }
    }
};

function RenderStartupAppRows(data) {
    const status = document.getElementById('startupStatus');
    const container = document.getElementById('startupAppsContainer');
    if (!container) return;
    
    let targetArray = data;
    if (data && !Array.isArray(data)) {
        const appsList = Array.isArray(data.apps) ? data.apps : (data.apps ? [data.apps] : []);
        if (status) {
            status.textContent = data.error || data.message || `${appsList.length} startup applications found`;
            status.classList.toggle('sharing-error', !!data.error);
        }
        targetArray = appsList;
    }
    container.replaceChildren();

    if (!targetArray || !Array.isArray(targetArray) || targetArray.length === 0) {
        container.innerHTML = `<div class="driver-text-node">No startup applications found in system registry or folders.</div>`;
        return;
    }

    targetArray.forEach(app => {
        const card = document.createElement('article');
        card.className = 'sharing-card';

        const title = document.createElement('h3');
        const pubText = (app.Publisher && app.Publisher !== 'Unavailable') ? app.Publisher : (app.Scope || 'Startup Entry');
        title.textContent = `${app.Name} · ${pubText}`;
        card.appendChild(title);

        const isEnabled = (app.Status || '').toLowerCase() === 'enabled';
        const statusBadgeHtml = isEnabled 
            ? '<span class="sharing-badge badge-success">Enabled</span>' 
            : '<span class="sharing-badge badge-danger">Disabled</span>';
        
        const fileStatusHtml = app.FileExists 
            ? '<span style="color:#48bb78;">Verified on disk</span>' 
            : '<span style="color:#fc8181;">Target missing</span>';

        const details = [
            ['Publisher', app.Publisher || 'Unavailable'],
            ['Product', app.ProductName || 'Unavailable'],
            ['Registration', `${app.Type} · ${app.Scope}`],
            ['Startup Status', statusBadgeHtml, true],
            ['File Status', fileStatusHtml, true],
            ['Location', app.Location || 'Unavailable'],
            ['Command', app.Command || 'Unavailable']
        ];

        details.forEach(([label, value, isHtml]) => {
            const row = document.createElement('div');
            row.className = 'sharing-detail';
            const key = document.createElement('span');
            key.textContent = label;
            const detail = document.createElement('strong');
            if (isHtml) {
                detail.innerHTML = value;
            } else {
                detail.textContent = value;
            }
            row.append(key, detail);
            card.appendChild(row);
        });

        const actions = document.createElement('div');
        actions.className = 'sharing-actions';

        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        if (isEnabled) {
            toggleBtn.textContent = 'Disable on boot';
            toggleBtn.addEventListener('click', () => ToggleStartupApp(app.Name, app.Type, false));
        } else {
            toggleBtn.textContent = 'Enable on boot';
            toggleBtn.style.color = '#48bb78';
            toggleBtn.style.borderColor = '#38a169';
            toggleBtn.addEventListener('click', () => ToggleStartupApp(app.Name, app.Type, true));
        }
        actions.appendChild(toggleBtn);

        const openBtn = document.createElement('button');
        openBtn.type = 'button';
        openBtn.textContent = 'Open file location';
        openBtn.addEventListener('click', () => OpenStartupFileLocation(app.TargetExe || app.Command));
        actions.appendChild(openBtn);

        const removeBtn = document.createElement('button');
        removeBtn.type = 'button';
        removeBtn.className = 'sharing-danger';
        removeBtn.textContent = 'Remove from boot';
        removeBtn.addEventListener('click', () => RemoveStartupApp(app.Name, app.Location, app.Type));
        actions.appendChild(removeBtn);

        card.appendChild(actions);
        container.appendChild(card);
    });
}
// =========================================================================
// GENERAL CORE GRAPHICS OBJECT SHORTCUTS (DIFF-GUARDED TO PREVENT REFLOWS)
// =========================================================================
function SetDomText(elementId, textValue) {
    const element = document.getElementById(elementId);
    if (!element) return;
    const next = textValue !== undefined && textValue !== null ? String(textValue) : "Loading...";
    if (element.textContent !== next) {
        element.textContent = next;
    }
}

function SetDomHtml(elementOrId, htmlValue) {
    const element = (typeof elementOrId === 'string') ? document.getElementById(elementOrId) : elementOrId;
    if (!element) return;
    const next = htmlValue !== undefined && htmlValue !== null ? String(htmlValue) : "";
    if (element._lastHtml !== next) {
        element._lastHtml = next;
        element.innerHTML = next;
    }
}

function SetDomStyleWidth(elementId, widthValue) {
    const element = document.getElementById(elementId);
    if (element && element.style.width !== widthValue) {
        element.style.width = widthValue;
    }
}

function TriggerVolumeRelabel(driveLetter, currentLabel) {
    const newLabel = prompt(`Enter a new system description label for volume partition [ ${driveLetter} ] :`, currentLabel);
    if (newLabel !== null && window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(`Rename-Drive:${driveLetter}|${newLabel}`);
    }
}

const MAX_CONSOLE_LINES = 300;
window._consoleLogLines = [];

function AppendConsoleLogEntry(message) {
    const consoleBox = document.getElementById('console-box') || document.querySelector('.console-box');
    if (!consoleBox || !message) return;

    const now = new Date();
    const stamp = now.toTimeString().slice(0, 8);
    const shouldStickBottom = (consoleBox.scrollHeight - consoleBox.scrollTop - consoleBox.clientHeight) < 32;

    window._consoleLogLines.push(`[${stamp}] ${message}`);
    if (window._consoleLogLines.length > MAX_CONSOLE_LINES) {
        window._consoleLogLines.splice(0, window._consoleLogLines.length - MAX_CONSOLE_LINES);
    }

    consoleBox.textContent = window._consoleLogLines.join('\n');
    if (shouldStickBottom) {
        consoleBox.scrollTop = consoleBox.scrollHeight;
    }
}

function AppendLiveDiagnosticConsoleLog(stats) {
    if (stats && stats.IdentityFrame && stats.SystemFrame) {
        AppendConsoleLogEntry(`[PIPELINE: ${stats.PipelineStatus}] Host: ${stats.IdentityFrame.HostName} | CPU Load: ${stats.SystemFrame.CpuLoad}% | RAM: ${stats.SystemFrame.RamUsageText}`);
    }
}

window.ClearConsoleLogView = function() {
    window._consoleLogLines = [];
    const consoleBox = document.getElementById('console-box') || document.querySelector('.console-box');
    if (consoleBox) {
        consoleBox.textContent = '[SYSTEM: CONSOLE LOG MESH PIPELINE FLUSHED... READY]';
    }
};

window.CopyConsoleLogView = function() {
    const consoleBox = document.getElementById('console-box') || document.querySelector('.console-box');
    const txt = consoleBox ? consoleBox.textContent : '';
    if (!txt) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(txt).catch(() => {});
    }
    AppendConsoleLogEntry('[CLIPBOARD] Copied live console log buffer to clipboard.');
};

window.TriggerPowerPlanMenu = function() {
    const plans = {
        "1": "381b4222-f694-41f0-9685-ff5bb260df2e", // Balanced
        "2": "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c", // High Performance
        "3": "a1841308-3541-4fab-bc81-f71556f20b4a", // Power Saver
        "4": "e9a42b02-d5df-448d-aa00-03f14749eb61"  // Ultimate Performance
    };
    
    let choice = prompt("Select Power Plan:\n1. Balanced\n2. High Performance\n3. Power Saver\n4. Ultimate Performance (Unlocks if hidden)");
    
    if (plans[choice]) {
        window.chrome.webview.postMessage(JSON.stringify({ 
            command: "SET_POWER_PLAN", 
            guid: plans[choice] 
        }));
    }
};

window.TriggerNetworkSpeedAnalysis = function() {
    const btn = document.querySelector('.speed-execute-action-btn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = "RUNNING...";
    }
    
    const latElem = document.getElementById('lblNetLatency');
    const jitElem = document.getElementById('lblNetJitter');
    const lossElem = document.getElementById('lblNetLoss');
    const downElem = document.getElementById('lblNetDownload');
    const upElem = document.getElementById('lblNetUpload');
    if (latElem) latElem.textContent = "...";
    if (jitElem) { jitElem.textContent = "..."; jitElem.classList.remove('speed-warn', 'speed-crit'); }
    if (lossElem) { lossElem.textContent = "..."; lossElem.classList.remove('speed-warn', 'speed-crit'); }
    if (downElem) downElem.textContent = "...";
    if (upElem) upElem.textContent = "...";

    AppendConsoleLogEntry('[SPEED TEST] Initiating Cloudflare speed, jitter & packet loss analysis...');

    if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage("Execute-SpeedTest");
    }

    if (window._speedTestTimeout) clearTimeout(window._speedTestTimeout);
    window._speedTestTimeout = setTimeout(() => {
        if (btn && btn.textContent === "RUNNING...") {
            btn.disabled = false;
            btn.textContent = "Test Mesh";
        }
    }, 30000);
};

function RenderSpeedTestResults(stats) {
    const latElem = document.getElementById('lblNetLatency');
    const jitElem = document.getElementById('lblNetJitter');
    const lossElem = document.getElementById('lblNetLoss');
    const downElem = document.getElementById('lblNetDownload');
    const upElem = document.getElementById('lblNetUpload');

    if (latElem) latElem.textContent = (stats.Latency !== undefined && stats.Latency !== null) ? stats.Latency : '--';
    if (jitElem) {
        jitElem.textContent = (stats.Jitter !== undefined && stats.Jitter !== null) ? stats.Jitter : '--';
        jitElem.classList.remove('speed-warn', 'speed-crit');
        const jitNum = Number(stats.Jitter);
        if (Number.isFinite(jitNum) && jitNum >= 30) jitElem.classList.add('speed-crit');
        else if (Number.isFinite(jitNum) && jitNum >= 15) jitElem.classList.add('speed-warn');
    }
    if (lossElem) {
        lossElem.textContent = (stats.PacketLoss !== undefined && stats.PacketLoss !== null) ? stats.PacketLoss : '--';
        lossElem.classList.remove('speed-warn', 'speed-crit');
        const lossNum = Number(stats.PacketLoss);
        if (Number.isFinite(lossNum) && lossNum >= 10) lossElem.classList.add('speed-crit');
        else if (Number.isFinite(lossNum) && lossNum > 0) lossElem.classList.add('speed-warn');
    }
    if (downElem) downElem.textContent = (stats.Download !== undefined && stats.Download !== null) ? stats.Download : '--';
    if (upElem) upElem.textContent = (stats.Upload !== undefined && stats.Upload !== null) ? stats.Upload : '--';

    const btn = document.querySelector('.speed-execute-action-btn');
    if (btn) {
        btn.disabled = false;
        btn.textContent = "Test Mesh";
    }

    if (window._speedTestTimeout) {
        clearTimeout(window._speedTestTimeout);
        window._speedTestTimeout = null;
    }

    AppendConsoleLogEntry(`[SPEED TEST] Complete: ${stats.Latency} ms latency | ${stats.Jitter ?? '--'} ms jitter | ${stats.PacketLoss ?? '--'}% loss | ${stats.Download} Mbps down | ${stats.Upload} Mbps up`);
}

window.CommitWatchdogTuningProfile = function() {
    const cpuThreshold = document.getElementById('rangeCpuThreshold')?.value || "20";
    const reactionMode = document.querySelector('input[name="radWatchdogMode"]:checked')?.value || "Throttle";
    const whitelistRaw = document.getElementById('txtCustomWhitelist')?.value || "";
    
    const whitelistArray = whitelistRaw.split(',')
        .map(item => item.trim().toLowerCase())
        .filter(item => item.length > 0);

    const configurationPayload = {
        EventAction: "Update-WatchdogRules",
        CpuThresholdPct: parseFloat(cpuThreshold),
        AutoActionTarget: reactionMode,
        UserWhitelist: whitelistArray
    };

    if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(JSON.stringify(configurationPayload));
        AppendConsoleLogEntry(`[WATCHDOG: TUNING MATRIX SYNCHRONIZED] Filter Cap: ${cpuThreshold}% | Mode: ${reactionMode} | Active Rules Applied`);
    }
};

window.TriggerHostRename = function(oldName) {
    const newName = prompt("Enter new Computer Name (Requires Restart):", oldName);
    if (newName && newName !== oldName) {
        window.chrome.webview.postMessage(JSON.stringify({ command: "RENAME_COMPUTER", newName: newName }));
    }
};

window.TriggerWorkgroupRename = function(oldName) {
    const newName = prompt("Enter new Workgroup Name (Requires Restart):", oldName);
    if (newName && newName !== oldName) {
        window.chrome.webview.postMessage(JSON.stringify({ command: "RENAME_WORKGROUP", newName: newName }));
    }
};
// =========================================================================
// NATIVE FRAMELESS CHASSIS WINDOW INTEROP EVENTS (ALL-EDGE OS RESIZE & DRAG)
// =========================================================================
document.addEventListener("DOMContentLoaded", () => {
    const EDGE_THICKNESS = 7;
    const CORNER_THICKNESS = 14;

    // Maps pointer position to native Win32 HT* resize hit-test codes & CSS cursors
    function DetectWindowEdgeHit(x, y) {
        const w = window.innerWidth;
        const h = window.innerHeight;
        const onLeft   = x <= EDGE_THICKNESS;
        const onRight  = x >= (w - EDGE_THICKNESS);
        const onTop    = y <= EDGE_THICKNESS;
        const onBottom = y >= (h - EDGE_THICKNESS);

        const inLeftCorner   = x <= CORNER_THICKNESS;
        const inRightCorner  = x >= (w - CORNER_THICKNESS);
        const inTopCorner    = y <= CORNER_THICKNESS;
        const inBottomCorner = y >= (h - CORNER_THICKNESS);

        if ((onTop && inLeftCorner) || (onLeft && inTopCorner))       return { hit: 13, cursor: 'nw-resize' }; // HTTOPLEFT
        if ((onTop && inRightCorner) || (onRight && inTopCorner))     return { hit: 14, cursor: 'ne-resize' }; // HTTOPRIGHT
        if ((onBottom && inLeftCorner) || (onLeft && inBottomCorner)) return { hit: 16, cursor: 'sw-resize' }; // HTBOTTOMLEFT
        if ((onBottom && inRightCorner) || (onRight && inBottomCorner)) return { hit: 17, cursor: 'se-resize' }; // HTBOTTOMRIGHT
        if (onLeft)   return { hit: 10, cursor: 'w-resize' };  // HTLEFT
        if (onRight)  return { hit: 11, cursor: 'e-resize' };  // HTRIGHT
        if (onTop)    return { hit: 12, cursor: 'n-resize' };  // HTTOP
        if (onBottom) return { hit: 15, cursor: 's-resize' };  // HTBOTTOM
        return null;
    }

    const headerDeck = document.querySelector('.app-header-deck');
    if (headerDeck && window.chrome && window.chrome.webview) {
        headerDeck.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            if (DetectWindowEdgeHit(e.clientX, e.clientY)) return;
            if (e.target.closest('.tab-btn') || e.target.closest('.exit-system-btn') || e.target.closest('.nav-dropdown')) return;
            e.preventDefault();
            window.chrome.webview.postMessage('Window-DragStart');
        });

        headerDeck.addEventListener('dblclick', (e) => {
            if (e.target.closest('.tab-btn') || e.target.closest('.exit-system-btn') || e.target.closest('.nav-dropdown')) return;
            window.chrome.webview.postMessage('Maximize-App');
        });
    }

    window.addEventListener('mousemove', (e) => {
        const edge = DetectWindowEdgeHit(e.clientX, e.clientY);
        document.documentElement.style.cursor = edge ? edge.cursor : '';
        document.body.style.cursor = edge ? edge.cursor : '';
    });

    window.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        const edge = DetectWindowEdgeHit(e.clientX, e.clientY);
        if (edge && window.chrome && window.chrome.webview) {
            e.preventDefault();
            e.stopPropagation();
            window.chrome.webview.postMessage(`Window-ResizeHit:${edge.hit}`);
        }
    }, true);

    window.addEventListener('mouseleave', () => {
        document.documentElement.style.cursor = '';
        document.body.style.cursor = '';
    });
});
// =========================================================================
// [DYNAMIC CONTROL] UNIFIED DASHBOARD TOGGLE & QUICK-ACTION DISPATCHERS
// =========================================================================
window._pendingControls = {};

function IsControlPending(commandKey) {
    const expiry = window._pendingControls[commandKey];
    if (!expiry) return false;
    if (Date.now() > expiry) {
        delete window._pendingControls[commandKey];
        return false;
    }
    return true;
}

function DispatchDashboardControl(command, extraPayload = {}, logNote = '', targetElemId = '') {
    if (!window.chrome || !window.chrome.webview) return;
    window._pendingControls[command] = Date.now() + 7000;
    if (targetElemId) {
        const host = document.getElementById(targetElemId);
        if (host) {
            const btn = host.matches('button') ? host : host.querySelector('button');
            if (btn) {
                btn.disabled = true;
                btn.classList.add('is-busy');
                btn.textContent = '...';
            } else if (host.classList.contains('diag-pill')) {
                host.textContent = 'Probing...';
            }
        }
    }
    if (logNote) AppendConsoleLogEntry(`[CONTROL] ${logNote}`);
    window.chrome.webview.postMessage(JSON.stringify(Object.assign({ command }, extraPayload)));
}

function HandleDashboardControlResult(res) {
    if (!res) return;
    if (res.control) {
        delete window._pendingControls[res.control];
    }
    const prefix = res.ok ? '[CONTROL OK]' : '[CONTROL ERROR]';
    AppendConsoleLogEntry(`${prefix} ${res.message || res.error || 'Action completed.'}`);
    if (!res.ok && (res.message || res.error)) {
        alert(`Action could not be completed:\n\n${res.message || res.error}`);
    }
}

window.TriggerTelemetryToggle = function(targetState) {
    const msg = targetState === 'Off'
        ? "Disable Windows Telemetry services (DiagTrack & dmwappushservice)?"
        : "Re-enable and start Windows Telemetry service (DiagTrack)?";
    if (!confirm(msg)) return;
    DispatchDashboardControl('TOGGLE_TELEMETRY', { targetState }, `Setting Windows Telemetry -> ${targetState}...`, 'lblTelemetry');
};

window.TriggerTelemetryDisable = function() {
    window.TriggerTelemetryToggle('Off');
};

window.TriggerFirewallToggle = function(targetState) {
    if (targetState === 'Off') {
        if (!confirm("Turn OFF Windows Firewall across Domain, Private, and Public profiles?\nOnly disable temporarily for diagnostics.")) return;
    }
    DispatchDashboardControl('TOGGLE_FIREWALL', { targetState }, `Setting Windows Firewall -> ${targetState}...`, 'lblFirewall');
};

window.TriggerOpenTamperSettings = function() {
    DispatchDashboardControl('OPEN_TAMPER_SETTINGS', {}, 'Opening Windows Security -> Virus & threat protection settings (Tamper Protection)...', 'lblTamperProtection');
};

window.NotifyTamperLocked = function(featureName) {
    const openNow = confirm(
        `${featureName} cannot be changed while Windows Defender Tamper Protection is ON.\n\n` +
        `Windows requires Tamper Protection to be toggled manually inside Windows Security.\n\n` +
        `Open Windows Security -> Tamper Protection settings now?`
    );
    if (openNow) {
        window.TriggerOpenTamperSettings();
    }
};

window.TriggerRealtimeToggle = function(targetState) {
    if (targetState === 'Off') {
        if (!confirm("Turn OFF Microsoft Defender Real-Time Protection?\n(Tamper Protection is Off — you can turn this back On anytime.)")) return;
    }
    DispatchDashboardControl('TOGGLE_REALTIME', { targetState }, `Setting Real-Time Protection -> ${targetState}...`, 'lblRealtime');
};

window.TriggerBehaviorToggle = function(targetState) {
    if (targetState === 'Off') {
        if (!confirm("Turn OFF Microsoft Defender Behavior Monitoring?")) return;
    }
    DispatchDashboardControl('TOGGLE_BEHAVIOR_MONITOR', { targetState }, `Setting Behavior Monitoring -> ${targetState}...`, 'lblBehaviorMonitor');
};

window.TriggerCloudToggle = function(targetState) {
    if (targetState === 'Off') {
        if (!confirm("Turn OFF Microsoft Defender Cloud-Delivered Protection (MAPS)?")) return;
    }
    DispatchDashboardControl('TOGGLE_CLOUD_PROTECTION', { targetState }, `Setting Cloud-Delivered Protection -> ${targetState}...`, 'lblCloudProtection');
};

window.TriggerIoavToggle = function(targetState) {
    if (targetState === 'Off') {
        if (!confirm("Turn OFF Microsoft Defender Download / Attachment (IOAV) Scanning?")) return;
    }
    DispatchDashboardControl('TOGGLE_IOAV_PROTECTION', { targetState }, `Setting Download / IOAV Scan -> ${targetState}...`, 'lblIoavProtection');
};

window.TriggerDiscoveryToggle = function(targetState) {
    DispatchDashboardControl('TOGGLE_DISCOVERY', { targetState }, `Setting Network Discovery -> ${targetState}...`, 'lblDiscovery');
};

window.TriggerSharingToggle = function(targetState) {
    DispatchDashboardControl('TOGGLE_SHARING', { targetState }, `Setting File & Printer Sharing -> ${targetState}...`, 'lblSharing');
};

window.TriggerNetworkProfileToggle = function(targetCategory) {
    if (!confirm(`Switch active network profile category to "${targetCategory}"?`)) return;
    DispatchDashboardControl('TOGGLE_NET_PROFILE', { targetState: targetCategory }, `Switching Network Profile -> ${targetCategory}...`, 'lblNetworkStatus');
};

window.TriggerHdrToggle = function(deviceName, targetState) {
    DispatchDashboardControl('TOGGLE_HDR', { deviceName, targetState }, `Setting Display HDR -> ${targetState}...`, 'lblMonHdr');
};

window.TriggerNightLightToggle = function(targetState) {
    // Immediately lock slider during toggle transition to prevent race-condition LUT glitches
    window._nightLightIsOn = false;
    const nlRow = document.getElementById('nightLightSliderRow');
    const nlSlider = document.getElementById('rngNightLightStrength');
    if (nlSlider) nlSlider.disabled = true;
    if (nlRow) nlRow.classList.add('is-disabled');
    DispatchDashboardControl('TOGGLE_NIGHT_LIGHT', { targetState }, `Setting Windows Night Light -> ${targetState}...`, 'lblMonNightLight');
};

window.OnNightLightSliderInput = function(rawVal) {
    if (!window._nightLightIsOn) return;
    const pct = Math.max(0, Math.min(100, Number(rawVal) || 0));
    const kelvin = Math.round(6500 - (pct / 100) * (6500 - 1200));
    window._nlSliderDragLockUntil = Date.now() + 2500;
    SetDomText('lblNightLightStrength', `${pct}% (${kelvin}K)`);
};

window.OnNightLightSliderCommit = function(rawVal) {
    if (!window._nightLightIsOn) return;
    const pct = Math.max(0, Math.min(100, Number(rawVal) || 0));
    const kelvin = Math.round(6500 - (pct / 100) * (6500 - 1200));
    window._nlSliderDragLockUntil = Date.now() + 3000;
    SetDomText('lblNightLightStrength', `${pct}% (${kelvin}K)`);
    DispatchDashboardControl('SET_NIGHT_LIGHT_STRENGTH', { strength: pct }, `Setting Night Light warmth -> ${pct}% (${kelvin}K)...`);
};

window.TriggerRefreshRateChange = function(deviceName, targetHz, previousHz) {
    if (!deviceName || !Number.isFinite(targetHz) || targetHz < 24) return;
    if (previousHz && targetHz === previousHz) return;
    const sel = document.querySelector('#lblMonRefresh select.infra-refresh-select');
    if (sel) sel.disabled = true;
    DispatchDashboardControl('SET_MONITOR_REFRESH_RATE', { deviceName, refreshRate: targetHz }, `Switching display refresh rate -> ${targetHz} Hz...`);
};

window.TriggerIdentifyMonitors = function() {
    if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage('Identify-Monitors');
        AppendConsoleLogEntry('[DISPLAY] Flashing monitor identification numbers across all connected screens...');
    }
};

window.TriggerInstallPawnIo = function() {
    if (!confirm("Install the Microsoft-signed PawnIO kernel driver (required by LibreHardwareMonitor for live Ryzen/Intel CPU temperatures)?\n\nThis will run 'winget install namazso.PawnIO' (or open pawnio.eu).")) {
        return;
    }
    DispatchDashboardControl('INSTALL_PAWNIO', {}, 'Launching PawnIO driver installation...');
};

window.TriggerScaleChange = function(deviceName, targetPct, previousPct) {
    if (!deviceName || !Number.isFinite(targetPct) || targetPct < 100) return;
    if (previousPct && targetPct === previousPct) return;
    const sel = document.querySelector('#lblMonScale select.infra-refresh-select');
    if (sel) sel.disabled = true;
    DispatchDashboardControl('SET_MONITOR_SCALE', { deviceName, scalePct: targetPct }, `Applying Windows display scale -> ${targetPct}%...`);
};

window.TriggerOrientationChange = function(deviceName, targetCode, previousCode) {
    if (!deviceName || !Number.isFinite(targetCode) || targetCode < 0 || targetCode > 3) return;
    if (Number.isFinite(previousCode) && targetCode === previousCode) return;
    const labels = ['Landscape', 'Portrait', 'Landscape (Flipped)', 'Portrait (Flipped)'];
    const label = labels[targetCode] || 'Landscape';
    const sel = document.querySelector('#lblMonOrientation select.infra-refresh-select');
    if (!confirm(`Rotate display (${deviceName}) to ${label}?`)) {
        if (sel && Number.isFinite(previousCode)) sel.value = String(previousCode);
        return;
    }
    if (sel) sel.disabled = true;
    DispatchDashboardControl('SET_MONITOR_ORIENTATION', { deviceName, orientationCode: targetCode }, `Rotating display orientation -> ${label}...`);
};

window.TriggerQuickDnsMenu = function() {
    const choice = prompt(
        "Quick-Switch Active IPv4 DNS Servers:\n" +
        "1. Automatic (DHCP)\n" +
        "2. Cloudflare (1.1.1.1, 1.0.0.1)\n" +
        "3. Google (8.8.8.8, 8.8.4.4)\n" +
        "4. Quad9 (9.9.9.9, 149.112.112.112)\n" +
        "5. Custom IPv4 (comma-separated)",
        "2"
    );
    if (!choice) return;
    const trimmed = choice.trim();
    let servers = null;
    if (trimmed === '1') servers = ['AUTO'];
    else if (trimmed === '2') servers = ['1.1.1.1', '1.0.0.1'];
    else if (trimmed === '3') servers = ['8.8.8.8', '8.8.4.4'];
    else if (trimmed === '4') servers = ['9.9.9.9', '149.112.112.112'];
    else if (trimmed === '5') {
        const custom = prompt("Enter primary (and optional secondary) IPv4 DNS, comma-separated:", "1.1.1.1, 8.8.8.8");
        if (!custom || !custom.trim()) return;
        servers = custom.split(',').map(s => s.trim()).filter(Boolean);
    } else {
        return;
    }
    DispatchDashboardControl('SET_QUICK_DNS', { servers }, `Updating active DNS servers -> ${servers.join(', ')}...`);
};

window.TriggerFlushAndTestDns = function() {
    if (IsControlPending('FLUSH_AND_TEST_DNS')) return;
    DispatchDashboardControl('FLUSH_AND_TEST_DNS', {}, 'Flushing DNS cache & running live resolution probe...', 'lblDnsStatus');
};

window.TriggerRefreshArpGateway = function() {
    if (IsControlPending('REFRESH_ARP_GATEWAY')) return;
    DispatchDashboardControl('REFRESH_ARP_GATEWAY', {}, 'Clearing & re-probing default gateway ARP neighbor entry...', 'lblArpStatus');
};

window.TriggerRelaunchAsAdmin = function() {
    if (!confirm("Relaunch CoreWatch elevated as Administrator?\n(A Windows UAC prompt will appear and this window will restart elevated.)")) return;
    DispatchDashboardControl('RELAUNCH_AS_ADMIN', {}, 'Requesting elevated Administrator relaunch...');
};

window.TriggerPendingRebootRestart = function() {
    if (!confirm("Windows reports a Pending Reboot.\nRestart this computer right now? Unsaved work in open apps will be lost.")) return;
    DispatchDashboardControl('TRIGGER_SYSTEM_REBOOT', {}, 'Initiating system restart...');
};

window.TriggerTopProcessAction = function() {
    const meta = window._topProcessMeta;
    if (!meta || !meta.pid) return;
    const msg =
        `Top Active Process Details:\n` +
        `• Process: ${meta.name} (PID ${meta.pid})\n` +
        `• Footprint: ${meta.text}\n` +
        (meta.detail ? `• Snapshot: ${meta.detail}\n\n` : '\n') +
        `Force-terminate ${meta.name} (PID ${meta.pid})?`;
    if (!confirm(msg)) return;
    DispatchDashboardControl('END_TOP_PROCESS', { pid: meta.pid, name: meta.name }, `Terminating ${meta.name} (PID ${meta.pid})...`);
};

window.CopyDashboardValue = function(elemId, label) {
    const el = document.getElementById(elemId);
    if (!el) return;
    const val = (el.textContent || '').trim();
    if (!val || val === '0.0.0.0' || val === 'Resolving...' || val === 'Loading...') return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(val).catch(() => {});
    }
    el.classList.add('copied-flash');
    setTimeout(() => el.classList.remove('copied-flash'), 700);
    AppendConsoleLogEntry(`[CLIPBOARD] Copied ${label}: ${val}`);
};

// =========================================================================
// VIEW 5: INSTALLED APPLICATIONS MANAGER CONTROLLER
// =========================================================================
window._installedAppsCache = [];
window._installedAppDrives = [];
window._installedAppsFilter = 'user';
window._installedAppsLoaded = false;
window._moveModalTargetApp = null;

window.RequestInstalledApps = function() {
    const status = document.getElementById('installedAppsStatus');
    if (status) {
        status.classList.remove('sharing-error');
        status.textContent = 'Scanning installed applications across Windows registries...';
    }
    if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage('Request-InstalledApps');
    }
};

window.SetInstalledAppsFilter = function(filterKey) {
    window._installedAppsFilter = filterKey;
    document.querySelectorAll('#appsFilterPills .filter-pill').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === filterKey);
    });
    ApplyInstalledAppsFilter();
};

function RenderInstalledAppsData(data) {
    window._installedAppsLoaded = true;
    const status = document.getElementById('installedAppsStatus');

    const appsList = Array.isArray(data.apps) ? data.apps : (data.apps ? [data.apps] : []);
    window._installedAppsCache = appsList;
    window._installedAppDrives = Array.isArray(data.drives) ? data.drives : (data.drives ? [data.drives] : []);

    const sum = data.summary || {};
    SetDomText('sumAppsTotal',   sum.total ?? appsList.length);
    SetDomText('sumAppsUser',    sum.userApps ?? appsList.filter(a => !a.isSystem).length);
    SetDomText('sumAppsMovable', sum.movable ?? appsList.filter(a => a.canMove).length);
    SetDomText('sumAppsMoved',   sum.moved ?? appsList.filter(a => a.isJunction).length);
    SetDomText('sumAppsSystem',  sum.systemApps ?? appsList.filter(a => a.isSystem).length);
    SetDomText('sumAppsSize',    sum.totalGB !== undefined ? `${sum.totalGB} GB` : '--');

    if (status) {
        status.classList.toggle('sharing-error', !!data.error);
        status.textContent = data.error || data.message || `${appsList.length} installed applications indexed.`;
    }
    if (data.message) AppendConsoleLogEntry(`[APPS] ${data.message}`);
    if (data.error) AppendConsoleLogEntry(`[APPS ERROR] ${data.error}`);

    ApplyInstalledAppsFilter();
}

function HandleCalculatedAppFolderSize(data) {
    const status = document.getElementById('installedAppsStatus');
    if (data.error) {
        if (status) {
            status.classList.add('sharing-error');
            status.textContent = data.error;
        }
        return;
    }
    const app = window._installedAppsCache.find(a => a.id === data.id);
    if (app) {
        app.sizeMB = data.sizeMB;
        app.measuredFiles = data.fileCount;
    }
    if (status) {
        status.classList.remove('sharing-error');
        status.textContent = data.message || `Measured ${data.name}: ${data.sizeMB} MB`;
    }
    AppendConsoleLogEntry(`[APPS] ${data.message}`);
    ApplyInstalledAppsFilter();
}

function FormatAppSizeMB(mb) {
    if (mb === null || mb === undefined || Number.isNaN(Number(mb))) return 'Unknown';
    const num = Number(mb);
    if (num >= 1024) return `${(num / 1024).toFixed(2)} GB`;
    return `${num.toFixed(1)} MB`;
}

window.ApplyInstalledAppsFilter = function() {
    const container = document.getElementById('installedAppsContainer');
    if (!container) return;

    const query = (document.getElementById('appsSearchInput')?.value || '').trim().toLowerCase();
    const sortBy = document.getElementById('appsSortSelect')?.value || 'name';
    const filter = window._installedAppsFilter || 'user';

    let list = window._installedAppsCache.filter(app => {
        if (filter === 'user' && app.isSystem) return false;
        if (filter === 'movable' && !app.canMove) return false;
        if (filter === 'moved' && !app.isJunction) return false;
        if (filter === 'system' && !app.isSystem) return false;

        if (query) {
            const haystack = [
                app.name, app.publisher, app.version, app.installLocation,
                app.junctionTarget, app.installDrive, app.scope
            ].filter(Boolean).join(' ').toLowerCase();
            if (!haystack.includes(query)) return false;
        }
        return true;
    });

    list.sort((a, b) => {
        if (sortBy === 'size') return (b.sizeMB || -1) - (a.sizeMB || -1);
        if (sortBy === 'date') return String(b.installDate || '').localeCompare(String(a.installDate || ''));
        if (sortBy === 'publisher') return String(a.publisher || '').localeCompare(String(b.publisher || ''));
        if (sortBy === 'drive') return String(a.installDrive || 'Z').localeCompare(String(b.installDrive || 'Z')) || String(a.name || '').localeCompare(String(b.name || ''));
        return String(a.name || '').localeCompare(String(b.name || ''));
    });

    container.replaceChildren();
    if (!list.length) {
        const empty = document.createElement('div');
        empty.className = 'driver-text-node';
        empty.textContent = 'No installed applications match the current filter.';
        container.appendChild(empty);
        return;
    }

    const fragment = document.createDocumentFragment();
    list.forEach(app => {
        const card = document.createElement('article');
        card.className = 'sharing-card';

        const header = document.createElement('div');
        header.className = 'card-title-row';
        const title = document.createElement('h3');
        title.textContent = app.name;
        header.appendChild(title);

        const badgeDeck = document.createElement('div');
        badgeDeck.className = 'card-badge-group';
        if (app.isSystem) {
            badgeDeck.innerHTML += '<span class="sharing-badge badge-neutral">System</span>';
        } else {
            badgeDeck.innerHTML += '<span class="sharing-badge badge-success">User App</span>';
        }
        if (app.isJunction) {
            badgeDeck.innerHTML += '<span class="sharing-badge badge-purple">Relocated</span>';
        }
        if (app.installDrive) {
            badgeDeck.innerHTML += `<span class="sharing-badge badge-info">${app.installDrive}</span>`;
        }
        header.appendChild(badgeDeck);
        card.appendChild(header);

        const sizeLabel = app.measuredFiles
            ? `${FormatAppSizeMB(app.sizeMB)} (${app.measuredFiles.toLocaleString()} files)`
            : FormatAppSizeMB(app.sizeMB);

        const details = [
            ['Publisher', app.publisher || 'Unknown'],
            ['Version', app.version || 'Unknown'],
            ['Installed', app.installDate || 'Unknown'],
            ['Size', sizeLabel],
            ['Scope / Arch', `${app.scope} · ${app.architecture}`],
            ['Install Folder', app.installLocation || 'Not registered (MSI / system installer)']
        ];
        if (app.isJunction && app.junctionTarget) {
            details.push(['Moved Target', app.junctionTarget]);
        }
        if (app.executablePath) {
            details.push(['Executable', app.executablePath]);
        }

        details.forEach(([label, value]) => {
            const row = document.createElement('div');
            row.className = 'sharing-detail';
            const k = document.createElement('span');
            k.textContent = label;
            const v = document.createElement('strong');
            v.textContent = value;
            v.title = value;
            row.append(k, v);
            card.appendChild(row);
        });

        const actions = document.createElement('div');
        actions.className = 'sharing-actions';

        if (app.installLocation) {
            const openFolderBtn = document.createElement('button');
            openFolderBtn.type = 'button';
            openFolderBtn.textContent = 'Open Folder';
            openFolderBtn.addEventListener('click', () => TriggerInstalledAppAction('OPEN_APP_FOLDER', app));
            actions.appendChild(openFolderBtn);

            const calcSizeBtn = document.createElement('button');
            calcSizeBtn.type = 'button';
            calcSizeBtn.textContent = 'Measure Size';
            calcSizeBtn.addEventListener('click', () => {
                const status = document.getElementById('installedAppsStatus');
                if (status) status.textContent = `Measuring disk footprint for [ ${app.name} ]...`;
                TriggerInstalledAppAction('CALC_APP_SIZE', app);
            });
            actions.appendChild(calcSizeBtn);
        }

        if (app.registryPath) {
            const regBtn = document.createElement('button');
            regBtn.type = 'button';
            regBtn.textContent = 'Registry Key';
            regBtn.addEventListener('click', () => TriggerInstalledAppAction('OPEN_APP_REGISTRY', app));
            actions.appendChild(regBtn);
        }

        if (app.canMove) {
            const moveBtn = document.createElement('button');
            moveBtn.type = 'button';
            moveBtn.className = 'btn-move-app';
            moveBtn.textContent = 'Move Drive / Dir';
            moveBtn.addEventListener('click', () => OpenMoveAppModal(app));
            actions.appendChild(moveBtn);
        }

        if (app.hasModify) {
            const modBtn = document.createElement('button');
            modBtn.type = 'button';
            modBtn.textContent = 'Modify / Repair';
            modBtn.addEventListener('click', () => TriggerInstalledAppAction('MODIFY_APP', app));
            actions.appendChild(modBtn);
        }

        if (app.canUninstall) {
            const uninBtn = document.createElement('button');
            uninBtn.type = 'button';
            uninBtn.className = 'sharing-danger';
            uninBtn.textContent = 'Uninstall';
            uninBtn.addEventListener('click', () => {
                if (confirm(`Launch uninstaller for [ ${app.name} ]?\n\nPublisher: ${app.publisher}\nVersion: ${app.version}`)) {
                    TriggerInstalledAppAction('UNINSTALL_APP', app);
                }
            });
            actions.appendChild(uninBtn);
        }

        card.appendChild(actions);
        fragment.appendChild(card);
    });
    container.appendChild(fragment);
};

function TriggerInstalledAppAction(command, app, extra) {
    const payload = Object.assign({
        command: command,
        id: app.id,
        name: app.name,
        isSystem: !!app.isSystem,
        installLocation: app.junctionTarget || app.installLocation || '',
        registryPath: app.registryPath || '',
        uninstallString: app.uninstallString || '',
        modifyPath: app.modifyPath || ''
    }, extra || {});
    if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(JSON.stringify(payload));
    }
}

window.OpenMoveAppModal = function(app) {
    if (!app || !app.canMove || app.isSystem) return;
    window._moveModalTargetApp = app;

    SetDomText('moveModalAppName', app.name);
    SetDomText('moveModalSourcePath', app.installLocation);

    const driveSelect = document.getElementById('moveModalDriveSelect');
    const targetInput = document.getElementById('moveModalTargetDir');
    if (driveSelect) {
        driveSelect.replaceChildren();
        const drives = window._installedAppDrives || [];
        drives.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d.letter;
            const currentTag = (app.installDrive && d.letter.toUpperCase() === app.installDrive.toUpperCase()) ? ' (Current)' : '';
            opt.textContent = `${d.letter}\\ ${d.label} — ${d.freeGB} GB free / ${d.totalGB} GB${currentTag}`;
            driveSelect.appendChild(opt);
        });
        const altDrive = drives.find(d => !app.installDrive || d.letter.toUpperCase() !== app.installDrive.toUpperCase());
        if (altDrive) driveSelect.value = altDrive.letter;
    }

    if (targetInput && driveSelect && driveSelect.value) {
        targetInput.value = `${driveSelect.value}\\Apps`;
    }
    UpdateMoveModalPreview();

    const modal = document.getElementById('moveAppModal');
    if (modal) modal.style.display = 'flex';
};

window.CloseMoveAppModal = function() {
    window._moveModalTargetApp = null;
    const modal = document.getElementById('moveAppModal');
    if (modal) modal.style.display = 'none';
};

window.OnMoveDriveChanged = function() {
    const driveSelect = document.getElementById('moveModalDriveSelect');
    const targetInput = document.getElementById('moveModalTargetDir');
    if (driveSelect && targetInput && driveSelect.value) {
        targetInput.value = `${driveSelect.value}\\Apps`;
    }
    UpdateMoveModalPreview();
};

function UpdateMoveModalPreview() {
    const app = window._moveModalTargetApp;
    const targetDir = (document.getElementById('moveModalTargetDir')?.value || '').trim().replace(/\\+$/, '');
    if (!app || !app.installLocation || !targetDir) {
        SetDomText('moveModalPreviewPath', '--');
        return;
    }
    const leaf = app.installLocation.split('\\').filter(Boolean).pop() || app.name;
    SetDomText('moveModalPreviewPath', `${targetDir}\\${leaf}`);
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('moveModalTargetDir')?.addEventListener('input', UpdateMoveModalPreview);
    document.getElementById('moveAppForm')?.addEventListener('submit', event => {
        event.preventDefault();
        const app = window._moveModalTargetApp;
        if (!app) return;
        const targetDir = (document.getElementById('moveModalTargetDir')?.value || '').trim();
        if (!targetDir) return;

        const preview = document.getElementById('moveModalPreviewPath')?.textContent || targetDir;
        if (!confirm(`Move [ ${app.name} ]?\n\nFrom: ${app.installLocation}\nTo:   ${preview}\n\nAn NTFS Directory Junction will be created at the original path so shortcuts and updaters continue working.`)) {
            return;
        }

        const status = document.getElementById('installedAppsStatus');
        if (status) {
            status.classList.remove('sharing-error');
            status.textContent = `Moving [ ${app.name} ] to ${preview}... Please wait (running in background).`;
        }
        AppendConsoleLogEntry(`[APPS] Starting move of [ ${app.name} ] -> ${preview}`);

        TriggerInstalledAppAction('MOVE_APP', app, {
            installLocation: app.installLocation,
            targetDirectory: targetDir
        });
        CloseMoveAppModal();
    });
});

// =========================================================================
// VIEW 6: SYSTEM DEVICES & DRIVERS OVERVIEW CONTROLLER
// =========================================================================
window._systemDevicesCache = [];
window._systemDevicesFilter = 'all';
window._systemDevicesLoaded = false;
window._expandedDeviceCategories = new Set(['Display adapters', 'Network adapters', 'Audio inputs and outputs', 'Sound, video and game controllers', 'Disk drives', 'Other / Unknown devices']);
window._expandedDeviceIds = new Set();

window.RequestSystemDevices = function() {
    const status = document.getElementById('devicesStatus');
    if (status) {
        status.classList.remove('sharing-error');
        status.textContent = 'Querying Windows PnP hardware & signed drivers...';
    }
    if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage('Request-SystemDevices');
    }
};

window.TriggerDeviceRescan = function() {
    const status = document.getElementById('devicesStatus');
    if (status) {
        status.classList.remove('sharing-error');
        status.textContent = 'Scanning hardware buses for changes (pnputil /scan-devices)...';
    }
    AppendConsoleLogEntry('[DEVICES] Triggering PnP hardware rescan...');
    if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(JSON.stringify({ command: 'RESCAN_HARDWARE' }));
    }
};

window.OpenNativeDeviceManager = function() {
    if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(JSON.stringify({ command: 'OPEN_NATIVE_DEVMGMT' }));
    }
};

window.SetSystemDevicesFilter = function(filterKey) {
    window._systemDevicesFilter = filterKey;
    document.querySelectorAll('#devicesFilterPills .filter-pill').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.filter === filterKey);
    });
    ApplySystemDevicesFilter();
};

window.ToggleAllDeviceCategories = function(expand) {
    if (expand) {
        window._systemDevicesCache.forEach(d => window._expandedDeviceCategories.add(d.categoryLabel));
    } else {
        window._expandedDeviceCategories.clear();
    }
    ApplySystemDevicesFilter();
};

function RenderSystemDevicesData(data) {
    window._systemDevicesLoaded = true;
    const status = document.getElementById('devicesStatus');
    const devices = Array.isArray(data.devices) ? data.devices : (data.devices ? [data.devices] : []);
    window._systemDevicesCache = devices;

    const sum = data.summary || {};
    SetDomText('sumDevTotal',      sum.total ?? devices.length);
    SetDomText('sumDevOk',         sum.ok ?? devices.filter(d => d.status === 'OK').length);
    SetDomText('sumDevIssues',     sum.issues ?? devices.filter(d => d.status === 'Error').length);
    SetDomText('sumDevDisabled',   sum.disabled ?? devices.filter(d => d.status === 'Disabled').length);
    SetDomText('sumDevThirdParty', sum.thirdParty ?? devices.filter(d => d.isThirdParty).length);

    // Auto-expand any category containing a problem/warning device
    devices.forEach(d => {
        if (d.status !== 'OK') window._expandedDeviceCategories.add(d.categoryLabel);
    });

    if (status) {
        status.classList.toggle('sharing-error', !!data.error);
        status.textContent = data.error || data.message || `${devices.length} present system devices indexed.`;
    }
    if (data.message) AppendConsoleLogEntry(`[DEVICES] ${data.message}`);
    if (data.error) AppendConsoleLogEntry(`[DEVICES ERROR] ${data.error}`);

    RenderDeviceDriverFixCenter(devices);
    ApplySystemDevicesFilter();
}

window.OpenDeviceDriverUrl = function(url, label) {
    if (!url) return;
    const st = document.getElementById('devicesStatus');
    if (st) {
        st.classList.remove('sharing-error');
        st.textContent = `Opening ${label || 'driver support page'}...`;
    }
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'OPEN_DRIVER_URL', url }));
};

function RenderDeviceDriverFixCenter(devices) {
    const box = document.getElementById('devicesFixCenterBox');
    if (!box) return;

    const issueDevs = (devices || []).filter(d => d.status === 'Error');
    if (!issueDevs.length) {
        box.style.display = 'none';
        box.replaceChildren();
        return;
    }

    box.style.display = 'flex';
    box.replaceChildren();

    const header = document.createElement('div');
    header.className = 'device-fix-banner-title';
    header.innerHTML = `<span>⚠️ ${issueDevs.length} Missing / Problematic Driver${issueDevs.length > 1 ? 's' : ''} Detected — Quick Download &amp; Fix Links</span><span style="font-weight:400; color:#cbd5e0;">Click any official portal below</span>`;
    box.appendChild(header);

    issueDevs.forEach(dev => {
        const item = document.createElement('div');
        item.className = 'device-fix-item';

        const head = document.createElement('div');
        head.className = 'device-fix-head';
        const title = document.createElement('strong');
        title.textContent = `${dev.name}${dev.hardwareId ? ` (${dev.hardwareId})` : ''}`;
        const badge = document.createElement('span');
        badge.className = 'sharing-badge badge-danger';
        badge.textContent = dev.problemText || `Code ${dev.problemCode}`;
        head.append(title, badge);
        item.appendChild(head);

        if (dev.fixHint) {
            const hint = document.createElement('div');
            hint.className = 'device-fix-hint';
            hint.textContent = dev.fixHint;
            item.appendChild(hint);
        }

        const linksRow = document.createElement('div');
        linksRow.className = 'device-fix-links';

        if (dev.vendorDownloadUrl) {
            const vBtn = document.createElement('button');
            vBtn.type = 'button';
            vBtn.className = 'device-link-btn primary-vendor';
            vBtn.textContent = `⬇️ ${dev.vendorDownloadName || 'Official Vendor Drivers'} ↗`;
            vBtn.title = dev.vendorDownloadUrl;
            vBtn.addEventListener('click', () => OpenDeviceDriverUrl(dev.vendorDownloadUrl, dev.vendorDownloadName));
            linksRow.appendChild(vBtn);
        }

        if (dev.catalogSearchUrl) {
            const cBtn = document.createElement('button');
            cBtn.type = 'button';
            cBtn.className = 'device-link-btn';
            cBtn.textContent = '🔎 MS Update Catalog ↗';
            cBtn.title = `Search Microsoft Update Catalog for ${dev.hardwareId || dev.name}`;
            cBtn.addEventListener('click', () => OpenDeviceDriverUrl(dev.catalogSearchUrl, 'Microsoft Update Catalog'));
            linksRow.appendChild(cBtn);
        }

        if (dev.webSearchUrl) {
            const wBtn = document.createElement('button');
            wBtn.type = 'button';
            wBtn.className = 'device-link-btn';
            wBtn.textContent = '🌐 Driver Lookup ↗';
            wBtn.addEventListener('click', () => OpenDeviceDriverUrl(dev.webSearchUrl, 'Driver Web Search'));
            linksRow.appendChild(wBtn);
        }

        item.appendChild(linksRow);
        box.appendChild(item);
    });
}

window.ApplySystemDevicesFilter = function() {
    const container = document.getElementById('systemDevicesContainer');
    if (!container) return;

    const query = (document.getElementById('devicesSearchInput')?.value || '').trim().toLowerCase();
    const filter = window._systemDevicesFilter || 'all';

    const filtered = window._systemDevicesCache.filter(dev => {
        if (filter === 'issues' && dev.status !== 'Error') return false;
        if (filter === 'disabled' && dev.status !== 'Disabled') return false;
        if (filter === 'thirdparty' && !dev.isThirdParty) return false;
        if (filter === 'hardware') {
            const hwBus = ['PCI / PCIe', 'USB', 'USB Storage', 'HD Audio', 'Intel Audio', 'Bluetooth', 'SCSI / NVMe / SATA', 'Display Output'];
            if (!hwBus.includes(dev.busType)) return false;
        }
        if (query) {
            const hay = [
                dev.name, dev.categoryLabel, dev.manufacturer, dev.driverProvider,
                dev.driverVersion, dev.infName, dev.service, dev.hardwareId, dev.id, dev.busType
            ].filter(Boolean).join(' ').toLowerCase();
            if (!hay.includes(query)) return false;
        }
        return true;
    });

    container.replaceChildren();
    if (!filtered.length) {
        const empty = document.createElement('div');
        empty.className = 'driver-text-node';
        empty.textContent = 'No system devices match the current filter.';
        container.appendChild(empty);
        return;
    }

    // Group devices by Device Manager category while preserving sort priority
    const groups = new Map();
    filtered.forEach(dev => {
        const key = dev.categoryLabel || 'Other';
        if (!groups.has(key)) {
            groups.set(key, { label: key, icon: dev.categoryIcon || '🔧', devices: [], issueCount: 0, disabledCount: 0 });
        }
        const g = groups.get(key);
        g.devices.push(dev);
        if (dev.status === 'Error') g.issueCount++;
        if (dev.status === 'Disabled') g.disabledCount++;
    });

    const forceExpand = query.length > 0 || filter !== 'all';
    const fragment = document.createDocumentFragment();

    groups.forEach(group => {
        const isOpen = forceExpand || window._expandedDeviceCategories.has(group.label);

        const groupEl = document.createElement('div');
        groupEl.className = 'device-category-group';

        const headerBtn = document.createElement('button');
        headerBtn.type = 'button';
        headerBtn.className = 'device-category-header';
        headerBtn.innerHTML = `
            <span class="device-cat-left">
                <span class="device-chevron">${isOpen ? '▾' : '▸'}</span>
                <span>${group.icon}</span>
                <strong>${group.label}</strong>
                <span class="device-cat-count">(${group.devices.length})</span>
            </span>
            <span class="device-cat-badges">
                ${group.issueCount > 0 ? `<span class="sharing-badge badge-danger">${group.issueCount} Issue${group.issueCount > 1 ? 's' : ''}</span>` : ''}
                ${group.disabledCount > 0 ? `<span class="sharing-badge badge-purple">${group.disabledCount} Disabled</span>` : ''}
            </span>
        `;
        headerBtn.addEventListener('click', () => {
            if (window._expandedDeviceCategories.has(group.label)) {
                window._expandedDeviceCategories.delete(group.label);
            } else {
                window._expandedDeviceCategories.add(group.label);
            }
            ApplySystemDevicesFilter();
        });
        groupEl.appendChild(headerBtn);

        if (isOpen) {
            const listEl = document.createElement('div');
            listEl.className = 'device-category-items';

            group.devices.forEach(dev => {
                const isSelected = window._expandedDeviceIds.has(dev.id);
                const itemWrap = document.createElement('div');
                itemWrap.className = `device-row-wrap${isSelected ? ' expanded' : ''}`;

                const rowBtn = document.createElement('button');
                rowBtn.type = 'button';
                rowBtn.className = 'device-item-row';

                let statusBadge = '<span class="sharing-badge badge-success">OK</span>';
                if (dev.status === 'Error') statusBadge = `<span class="sharing-badge badge-danger">ERR ${dev.problemCode}</span>`;
                else if (dev.status === 'Disabled') statusBadge = '<span class="sharing-badge badge-purple">Disabled</span>';

                let ageTierCls = '';
                if (dev.driverAgeDays >= 0) {
                    if (dev.driverAgeDays > 1460) ageTierCls = ' ver-critical';
                    else if (dev.driverAgeDays > 545) ageTierCls = ' ver-update';
                    else ageTierCls = ' ver-uptodate';
                }
                const ageBadge = dev.driverAgeText
                    ? `<span class="device-age-tag${ageTierCls}" title="Driver Date: ${dev.driverDate} (Green: Current · Purple: Update Recommended · Red: >4yr Outdated)">${dev.driverAgeText}</span>`
                    : '';

                const leftSpan = document.createElement('span');
                leftSpan.className = 'device-row-main';
                leftSpan.innerHTML = `<span class="device-row-caret">${isSelected ? '▾' : '▸'}</span>`;
                const nameStrong = document.createElement('strong');
                nameStrong.className = 'device-row-name';
                nameStrong.textContent = dev.name;
                leftSpan.appendChild(nameStrong);

                const rightSpan = document.createElement('span');
                rightSpan.className = 'device-row-meta';
                rightSpan.innerHTML = `
                    <span class="device-ver-text" title="Driver Version">${dev.driverVersion}</span>
                    ${ageBadge}
                    <span class="device-bus-tag">${dev.busType}</span>
                    ${statusBadge}
                `;

                rowBtn.append(leftSpan, rightSpan);
                rowBtn.addEventListener('click', () => {
                    if (window._expandedDeviceIds.has(dev.id)) {
                        window._expandedDeviceIds.delete(dev.id);
                    } else {
                        window._expandedDeviceIds.add(dev.id);
                    }
                    ApplySystemDevicesFilter();
                });
                itemWrap.appendChild(rowBtn);

                if (isSelected) {
                    const drawer = document.createElement('div');
                    drawer.className = 'device-detail-drawer';

                    const grid = document.createElement('div');
                    grid.className = 'device-detail-grid';

                    const fields = [
                        ['Status', dev.problemText],
                        ['Driver Version', dev.driverVersion],
                        ['Driver Date', dev.driverAgeText ? `${dev.driverDate} (${dev.driverAgeText} old)` : dev.driverDate],
                        ['Driver Provider', dev.driverProvider],
                        ['Manufacturer', dev.manufacturer],
                        ['Digital Signer', dev.isSigned ? `${dev.signer} (Signed)` : dev.signer],
                        ['INF Package', dev.infName || 'None / Built-in'],
                        ['Kernel Service', dev.service || 'None'],
                        ['Bus / Transport', dev.busType],
                        ['Location', dev.locationInfo || 'Not reported'],
                        ['Hardware ID', dev.hardwareId || 'Unavailable'],
                        ['Instance ID', dev.id]
                    ];

                    fields.forEach(([k, v]) => {
                        const cell = document.createElement('div');
                        cell.className = 'device-detail-cell';
                        const lbl = document.createElement('span');
                        lbl.textContent = k;
                        const val = document.createElement('strong');
                        val.textContent = v;
                        val.title = v;
                        cell.append(lbl, val);
                        grid.appendChild(cell);
                    });
                    drawer.appendChild(grid);

                    if (dev.fixHint) {
                        const hintBox = document.createElement('div');
                        hintBox.className = 'device-drawer-hint';
                        hintBox.textContent = `💡 Fix Guidance: ${dev.fixHint}`;
                        drawer.appendChild(hintBox);
                    }

                    const actions = document.createElement('div');
                    actions.className = 'sharing-actions';

                    if (dev.vendorDownloadUrl) {
                        const vendorBtn = document.createElement('button');
                        vendorBtn.type = 'button';
                        vendorBtn.className = 'device-link-btn primary-vendor';
                        vendorBtn.textContent = `⬇️ ${dev.vendorDownloadName || 'Official Vendor Drivers'} ↗`;
                        vendorBtn.title = dev.vendorDownloadUrl;
                        vendorBtn.addEventListener('click', () => OpenDeviceDriverUrl(dev.vendorDownloadUrl, dev.vendorDownloadName));
                        actions.appendChild(vendorBtn);
                    }

                    if (dev.catalogSearchUrl) {
                        const catBtn = document.createElement('button');
                        catBtn.type = 'button';
                        catBtn.className = 'device-link-btn';
                        catBtn.textContent = '🔎 MS Update Catalog ↗';
                        catBtn.title = `Search Microsoft Update Catalog for ${dev.hardwareId || dev.name}`;
                        catBtn.addEventListener('click', () => OpenDeviceDriverUrl(dev.catalogSearchUrl, 'Microsoft Update Catalog'));
                        actions.appendChild(catBtn);
                    }

                    if (dev.status === 'Error' && dev.webSearchUrl) {
                        const webBtn = document.createElement('button');
                        webBtn.type = 'button';
                        webBtn.className = 'device-link-btn';
                        webBtn.textContent = '🌐 Driver Search ↗';
                        webBtn.addEventListener('click', () => OpenDeviceDriverUrl(dev.webSearchUrl, 'Driver Web Search'));
                        actions.appendChild(webBtn);
                    }

                    if (dev.hardwareId) {
                        const copyBtn = document.createElement('button');
                        copyBtn.type = 'button';
                        copyBtn.textContent = 'Copy Hardware ID';
                        copyBtn.addEventListener('click', () => {
                            navigator.clipboard?.writeText(dev.hardwareId);
                            const st = document.getElementById('devicesStatus');
                            if (st) st.textContent = `Copied Hardware ID: ${dev.hardwareId}`;
                        });
                        actions.appendChild(copyBtn);
                    }

                    if (dev.infName) {
                        const infBtn = document.createElement('button');
                        infBtn.type = 'button';
                        infBtn.textContent = `Open INF (${dev.infName})`;
                        infBtn.addEventListener('click', () => TriggerDeviceAction('OPEN_DRIVER_INF', dev));
                        actions.appendChild(infBtn);
                    }

                    if (!dev.isCritical) {
                        const restartBtn = document.createElement('button');
                        restartBtn.type = 'button';
                        restartBtn.textContent = 'Restart Device';
                        restartBtn.addEventListener('click', () => {
                            if (confirm(`Restart device [ ${dev.name} ]?\nThis cycles the device off and back on (requires Administrator).`)) {
                                TriggerDeviceAction('RESTART_DEVICE', dev);
                            }
                        });
                        actions.appendChild(restartBtn);

                        const toggleBtn = document.createElement('button');
                        toggleBtn.type = 'button';
                        const isDisabled = dev.status === 'Disabled';
                        if (isDisabled) {
                            toggleBtn.textContent = 'Enable Device';
                            toggleBtn.style.color = '#48bb78';
                            toggleBtn.style.borderColor = '#38a169';
                            toggleBtn.addEventListener('click', () => TriggerDeviceAction('TOGGLE_DEVICE_STATE', dev, { enable: true }));
                        } else {
                            toggleBtn.textContent = 'Disable Device';
                            toggleBtn.className = 'sharing-danger';
                            toggleBtn.addEventListener('click', () => {
                                if (confirm(`Disable hardware device [ ${dev.name} ]?\n(Requires Administrator privileges)`)) {
                                    TriggerDeviceAction('TOGGLE_DEVICE_STATE', dev, { enable: false });
                                }
                            });
                            actions.appendChild(toggleBtn);
                        }
                        if (isDisabled) actions.appendChild(toggleBtn);
                    } else {
                        const critNote = document.createElement('span');
                        critNote.className = 'device-critical-note';
                        critNote.textContent = 'Core system device (disable/restart protected)';
                        actions.appendChild(critNote);
                    }

                    drawer.appendChild(actions);
                    itemWrap.appendChild(drawer);
                }

                listEl.appendChild(itemWrap);
            });

            groupEl.appendChild(listEl);
        }

        fragment.appendChild(groupEl);
    });

    container.appendChild(fragment);
};

function TriggerDeviceAction(command, dev, extra) {
    const status = document.getElementById('devicesStatus');
    if (status) {
        status.classList.remove('sharing-error');
        status.textContent = `Executing ${command} on [ ${dev.name} ]...`;
    }
    const payload = Object.assign({
        command: command,
        deviceId: dev.id,
        deviceName: dev.name,
        infName: dev.infName || ''
    }, extra || {});
    if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(JSON.stringify(payload));
    }
}

// =========================================================================
// VIEW 7: FILE ORGANIZER CONTROLLER
// =========================================================================
window._fileOrganizerLoaded = false;
window._orgFolders = [];
window._orgDefaultRules = [];
window._orgMediaRules = [];
window._orgExtOverrides = [];
window._orgMode = 'media';

const ORG_STORAGE_KEY = 'corewatch_file_organizer_v1';

function SaveOrganizerConfig() {
    try {
        const customFolders = window._orgFolders.filter(f => f.isCustom).map(f => ({
            id: f.id, label: f.label, icon: f.icon, path: f.path, selected: !!f.selected
        }));
        const selectedIds = window._orgFolders.filter(f => f.selected).map(f => f.path);
        const cfg = {
            mode: window._orgMode,
            customFolders: customFolders,
            selectedPaths: selectedIds,
            mediaRules: window._orgMediaRules,
            extOverrides: window._orgExtOverrides,
            extTemplate: document.getElementById('orgExtTemplateInput')?.value || '{EXT}',
            extFilter: document.getElementById('orgExtFilterInput')?.value || '',
            destMode: document.querySelector('input[name="radOrgDestMode"]:checked')?.value || 'inplace',
            unifiedRoot: document.getElementById('orgUnifiedRootInput')?.value || '',
            recursive: !!document.getElementById('chkOrgRecursive')?.checked,
            duplicateMode: document.getElementById('selOrgDuplicateMode')?.value || 'rename'
        };
        localStorage.setItem(ORG_STORAGE_KEY, JSON.stringify(cfg));
    } catch {}
}

function LoadSavedOrganizerConfig() {
    try {
        const raw = localStorage.getItem(ORG_STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch { return null; }
}

window.RequestFileOrganizer = function() {
    const status = document.getElementById('organizerStatus');
    if (status) {
        status.classList.remove('sharing-error');
        status.textContent = 'Detecting Windows user folders and loading organizer state...';
    }
    if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage('Request-FileOrganizer');
    }
};

window.BrowseOrganizerFolder = function(targetKey) {
    if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(`Browse-Folder:${targetKey}`);
    }
};

function HandleBrowseFolderResult(data) {
    if (!data || !data.path) return;
    if (data.target === 'dest') {
        const inp = document.getElementById('orgUnifiedRootInput');
        if (inp) {
            inp.value = data.path;
            SaveOrganizerConfig();
        }
    } else if (data.target === 'diagfolder') {
        AddDiagXExternalLogPath(data.path);
    } else if (data.target === 'wslinstalldir') {
        const inp = document.getElementById('wslImportInstallDir');
        if (inp) inp.value = data.path;
    } else if (data.target === 'diskmap') {
        const inp = document.getElementById('diskMapTargetPath');
        if (inp) inp.value = data.path;
        TriggerDiskMapScan(data.path);
    } else {
        const inp = document.getElementById('orgCustomFolderInput');
        if (inp) inp.value = data.path;
        AddCustomOrganizerFolder();
    }
}

function RenderFileOrganizerState(data) {
    window._fileOrganizerLoaded = true;
    const saved = LoadSavedOrganizerConfig();

    const userFolders = Array.isArray(data.userFolders) ? data.userFolders : (data.userFolders ? [data.userFolders] : []);
    const defaultRules = Array.isArray(data.defaultRules) ? data.defaultRules : (data.defaultRules ? [data.defaultRules] : []);
    window._orgDefaultRules = defaultRules.map(r => Object.assign({}, r));

    const savedPaths = saved && Array.isArray(saved.selectedPaths) ? new Set(saved.selectedPaths.map(p => p.toLowerCase())) : null;

    const mergedFolders = userFolders.map(f => ({
        id: f.id,
        label: f.label,
        icon: f.icon || '📁',
        path: f.path,
        exists: !!f.exists,
        fileCount: f.fileCount ?? 0,
        selected: savedPaths ? savedPaths.has((f.path || '').toLowerCase()) : !!f.defaultSelected,
        isCustom: false
    }));

    if (saved && Array.isArray(saved.customFolders)) {
        saved.customFolders.forEach(cf => {
            if (cf && cf.path && !mergedFolders.some(x => x.path.toLowerCase() === cf.path.toLowerCase())) {
                mergedFolders.push({
                    id: cf.id || `custom_${Date.now()}_${Math.random()}`,
                    label: cf.label || cf.path.split('\\').filter(Boolean).pop() || cf.path,
                    icon: '📂',
                    path: cf.path,
                    exists: true,
                    fileCount: null,
                    selected: cf.selected !== false,
                    isCustom: true
                });
            }
        });
    }
    window._orgFolders = mergedFolders;

    if (saved && Array.isArray(saved.mediaRules) && saved.mediaRules.length) {
        window._orgMediaRules = saved.mediaRules.map(r => Object.assign({}, r));
    } else {
        window._orgMediaRules = defaultRules.map(r => Object.assign({}, r));
    }

    window._orgExtOverrides = (saved && Array.isArray(saved.extOverrides)) ? saved.extOverrides : [];

    const rootInput = document.getElementById('orgUnifiedRootInput');
    if (rootInput) {
        rootInput.value = (saved && saved.unifiedRoot) ? saved.unifiedRoot : (data.defaultRoot || '');
    }
    if (saved) {
        const extTpl = document.getElementById('orgExtTemplateInput');
        if (extTpl && saved.extTemplate) extTpl.value = saved.extTemplate;
        const extFlt = document.getElementById('orgExtFilterInput');
        if (extFlt && saved.extFilter !== undefined) extFlt.value = saved.extFilter;
        const recChk = document.getElementById('chkOrgRecursive');
        if (recChk) recChk.checked = !!saved.recursive;
        const dupSel = document.getElementById('selOrgDuplicateMode');
        if (dupSel && saved.duplicateMode) dupSel.value = saved.duplicateMode;
        const destRad = document.querySelector(`input[name="radOrgDestMode"][value="${saved.destMode || 'inplace'}"]`);
        if (destRad) destRad.checked = true;
        SetOrganizerMode(saved.mode === 'extension' ? 'extension' : 'media', true);
    } else {
        SetOrganizerMode('media', true);
    }

    OnOrganizerDestModeChange();
    RenderOrganizerFolders();
    RenderOrganizerMediaRules();
    RenderOrganizerExtOverrides();
    UpdateOrganizerUndoButton(!!data.undoAvailable, data.undoCount || 0);

    const status = document.getElementById('organizerStatus');
    if (status) {
        status.classList.toggle('sharing-error', !!data.error);
        status.textContent = data.error || 'Ready — choose folders and rules, then click Preview Plan (Dry Run).';
    }
}

function UpdateOrganizerUndoButton(available, count) {
    const btn = document.getElementById('btnOrgUndo');
    if (!btn) return;
    btn.disabled = !available;
    btn.textContent = available ? `Undo Last Run (${count})` : 'Undo Last Run';
}

function RenderOrganizerFolders() {
    const grid = document.getElementById('organizerFoldersGrid');
    if (!grid) return;
    grid.replaceChildren();

    window._orgFolders.forEach((folder, idx) => {
        const item = document.createElement('div');
        item.className = `organizer-folder-chip${folder.selected ? ' selected' : ''}${!folder.exists ? ' missing' : ''}`;

        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.checked = !!folder.selected;
        chk.disabled = !folder.exists;
        chk.addEventListener('change', () => {
            folder.selected = chk.checked;
            item.classList.toggle('selected', folder.selected);
            SaveOrganizerConfig();
        });

        const info = document.createElement('div');
        info.className = 'org-folder-info';
        const titleRow = document.createElement('div');
        titleRow.className = 'org-folder-title';
        const countBadge = folder.fileCount !== null && folder.fileCount !== undefined
            ? `<span class="sharing-badge badge-info">${folder.fileCount} files</span>`
            : '<span class="sharing-badge badge-neutral">Custom</span>';
        titleRow.innerHTML = `<span>${folder.icon}</span> <strong>${folder.label}</strong> ${countBadge}`;

        const pathRow = document.createElement('div');
        pathRow.className = 'org-folder-path';
        pathRow.textContent = folder.path;
        pathRow.title = folder.path;

        info.append(titleRow, pathRow);
        info.addEventListener('click', () => {
            if (!folder.exists) return;
            chk.checked = !chk.checked;
            folder.selected = chk.checked;
            item.classList.toggle('selected', folder.selected);
            SaveOrganizerConfig();
        });

        const btnGroup = document.createElement('div');
        btnGroup.className = 'org-folder-btns';
        if (folder.exists) {
            const openBtn = document.createElement('button');
            openBtn.type = 'button';
            openBtn.className = 'org-mini-btn';
            openBtn.title = 'Open folder in Explorer';
            openBtn.textContent = '↗';
            openBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                window.chrome?.webview?.postMessage(JSON.stringify({ command: 'OPEN_ORGANIZER_FOLDER', path: folder.path }));
            });
            btnGroup.appendChild(openBtn);
        }
        if (folder.isCustom) {
            const rmBtn = document.createElement('button');
            rmBtn.type = 'button';
            rmBtn.className = 'org-mini-btn danger';
            rmBtn.title = 'Remove custom folder';
            rmBtn.textContent = '✕';
            rmBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                window._orgFolders.splice(idx, 1);
                SaveOrganizerConfig();
                RenderOrganizerFolders();
            });
            btnGroup.appendChild(rmBtn);
        }

        item.append(chk, info, btnGroup);
        grid.appendChild(item);
    });
}

window.ToggleAllOrganizerFolders = function(selectAll) {
    window._orgFolders.forEach(f => {
        if (f.exists) f.selected = selectAll;
    });
    SaveOrganizerConfig();
    RenderOrganizerFolders();
};

window.AddCustomOrganizerFolder = function() {
    const inp = document.getElementById('orgCustomFolderInput');
    if (!inp) return;
    const raw = inp.value.trim().replace(/\\+$/, '');
    if (!raw) return;

    if (window._orgFolders.some(f => f.path.toLowerCase() === raw.toLowerCase())) {
        const status = document.getElementById('organizerStatus');
        if (status) status.textContent = `Folder is already in the list: ${raw}`;
        inp.value = '';
        return;
    }

    const leaf = raw.split('\\').filter(Boolean).pop() || raw;
    window._orgFolders.push({
        id: `custom_${Date.now()}`,
        label: leaf,
        icon: '📂',
        path: raw,
        exists: true,
        fileCount: null,
        selected: true,
        isCustom: true
    });
    inp.value = '';
    SaveOrganizerConfig();
    RenderOrganizerFolders();
};

window.OnOrganizerDestModeChange = function() {
    const mode = document.querySelector('input[name="radOrgDestMode"]:checked')?.value || 'inplace';
    const row = document.getElementById('orgUnifiedRootRow');
    if (row) row.style.display = mode === 'unified' ? 'flex' : 'none';
    SaveOrganizerConfig();
};

window.SetOrganizerMode = function(mode, skipSave) {
    window._orgMode = mode === 'extension' ? 'extension' : 'media';
    document.getElementById('btnModeMedia')?.classList.toggle('active', window._orgMode === 'media');
    document.getElementById('btnModeExt')?.classList.toggle('active', window._orgMode === 'extension');

    const mediaPanel = document.getElementById('orgMediaRulesPanel');
    const extPanel = document.getElementById('orgExtensionRulesPanel');
    if (mediaPanel) mediaPanel.style.display = window._orgMode === 'media' ? 'block' : 'none';
    if (extPanel) extPanel.style.display = window._orgMode === 'extension' ? 'block' : 'none';
    if (!skipSave) SaveOrganizerConfig();
};

function RenderOrganizerMediaRules() {
    const list = document.getElementById('orgMediaRulesList');
    if (!list) return;
    list.replaceChildren();

    window._orgMediaRules.forEach((rule, idx) => {
        const row = document.createElement('div');
        row.className = `organizer-rule-row${rule.enabled ? '' : ' disabled'}`;

        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.checked = !!rule.enabled;
        chk.addEventListener('change', () => {
            rule.enabled = chk.checked;
            row.classList.toggle('disabled', !rule.enabled);
            SaveOrganizerConfig();
        });

        const labelEl = document.createElement('span');
        labelEl.className = 'org-rule-label';
        labelEl.textContent = rule.label || rule.folderName;

        const folderInp = document.createElement('input');
        folderInp.type = 'text';
        folderInp.className = 'org-rule-input';
        folderInp.value = rule.folderName || '';
        folderInp.placeholder = 'Target folder name';
        folderInp.addEventListener('input', () => {
            rule.folderName = folderInp.value;
            SaveOrganizerConfig();
        });

        const extInp = document.createElement('input');
        extInp.type = 'text';
        extInp.className = 'org-rule-input';
        extInp.value = rule.extensions || '';
        extInp.placeholder = '.ext1, .ext2';
        extInp.addEventListener('input', () => {
            rule.extensions = extInp.value;
            SaveOrganizerConfig();
        });

        const delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'org-mini-btn danger';
        delBtn.title = 'Remove rule';
        delBtn.textContent = '✕';
        delBtn.addEventListener('click', () => {
            window._orgMediaRules.splice(idx, 1);
            SaveOrganizerConfig();
            RenderOrganizerMediaRules();
        });

        row.append(chk, labelEl, folderInp, extInp, delBtn);
        list.appendChild(row);
    });
}

window.AddCustomMediaRule = function() {
    const labelInp = document.getElementById('orgNewRuleLabel');
    const folderInp = document.getElementById('orgNewRuleFolder');
    const extsInp = document.getElementById('orgNewRuleExts');
    const label = (labelInp?.value || '').trim();
    const folder = (folderInp?.value || '').trim() || label;
    const exts = (extsInp?.value || '').trim();
    if (!folder || !exts) {
        return alert('Enter a target folder name and at least one file extension (e.g. .stl, .obj).');
    }

    window._orgMediaRules.push({
        id: `custom_rule_${Date.now()}`,
        label: label || folder,
        folderName: folder,
        enabled: true,
        extensions: exts
    });
    if (labelInp) labelInp.value = '';
    if (folderInp) folderInp.value = '';
    if (extsInp) extsInp.value = '';
    SaveOrganizerConfig();
    RenderOrganizerMediaRules();
};

function RenderOrganizerExtOverrides() {
    const list = document.getElementById('orgExtOverridesList');
    if (!list) return;
    list.replaceChildren();

    if (!window._orgExtOverrides.length) {
        const hint = document.createElement('div');
        hint.className = 'driver-text-node';
        hint.textContent = 'No custom extension overrides — all extensions will use the Folder Name Pattern above (e.g. .pdf → PDF).';
        list.appendChild(hint);
        return;
    }

    window._orgExtOverrides.forEach((ov, idx) => {
        const chip = document.createElement('div');
        chip.className = 'org-override-chip';
        chip.innerHTML = `<code>${ov.extension}</code> <span>→</span> <strong>${ov.folderName}</strong>`;
        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'org-mini-btn danger';
        del.textContent = '✕';
        del.addEventListener('click', () => {
            window._orgExtOverrides.splice(idx, 1);
            SaveOrganizerConfig();
            RenderOrganizerExtOverrides();
        });
        chip.appendChild(del);
        list.appendChild(chip);
    });
}

window.AddExtensionOverride = function() {
    const extInp = document.getElementById('orgNewOverrideExt');
    const folderInp = document.getElementById('orgNewOverrideFolder');
    let ext = (extInp?.value || '').trim().toLowerCase();
    const folder = (folderInp?.value || '').trim();
    if (!ext || !folder) return alert('Enter both a file extension (e.g. .pdf) and a target folder name.');
    if (!ext.startsWith('.')) ext = `.${ext}`;

    const existing = window._orgExtOverrides.find(o => o.extension === ext);
    if (existing) existing.folderName = folder;
    else window._orgExtOverrides.push({ extension: ext, folderName: folder });

    if (extInp) extInp.value = '';
    if (folderInp) folderInp.value = '';
    SaveOrganizerConfig();
    RenderOrganizerExtOverrides();
};

window.ResetOrganizerDefaults = function() {
    if (!confirm('Reset File Organizer folders, media rules, and folder names back to defaults?')) return;
    try { localStorage.removeItem(ORG_STORAGE_KEY); } catch {}
    window._fileOrganizerLoaded = false;
    RequestFileOrganizer();
};

function CollectOrganizerPayload(command) {
    const selectedFolders = window._orgFolders.filter(f => f.selected && f.exists).map(f => f.path);
    const destMode = document.querySelector('input[name="radOrgDestMode"]:checked')?.value || 'inplace';
    return {
        command: command,
        folders: selectedFolders,
        mode: window._orgMode,
        destMode: destMode,
        unifiedRoot: document.getElementById('orgUnifiedRootInput')?.value.trim() || '',
        includeSubfolders: !!document.getElementById('chkOrgRecursive')?.checked,
        duplicateMode: document.getElementById('selOrgDuplicateMode')?.value || 'rename',
        mediaRules: window._orgMediaRules,
        extFolderTemplate: document.getElementById('orgExtTemplateInput')?.value.trim() || '{EXT}',
        extFilter: document.getElementById('orgExtFilterInput')?.value.trim() || '',
        extOverrides: window._orgExtOverrides
    };
}

window.TriggerOrganizePreview = function() {
    SaveOrganizerConfig();
    const payload = CollectOrganizerPayload('PREVIEW_ORGANIZE');
    if (!payload.folders.length) {
        return alert('Please select at least one folder to organize.');
    }
    const status = document.getElementById('organizerStatus');
    if (status) {
        status.classList.remove('sharing-error');
        status.textContent = `Scanning ${payload.folders.length} folder(s) for dry-run preview...`;
    }
    window.chrome?.webview?.postMessage(JSON.stringify(payload));
};

window.TriggerOrganizeExecute = function() {
    SaveOrganizerConfig();
    const payload = CollectOrganizerPayload('EXECUTE_ORGANIZE');
    if (!payload.folders.length) {
        return alert('Please select at least one folder to organize.');
    }
    const destDesc = payload.destMode === 'unified'
        ? `Unified Root: ${payload.unifiedRoot}`
        : 'Subfolders inside each selected folder';
    if (!confirm(`Organize files across ${payload.folders.length} folder(s)?\n\nMode: ${payload.mode === 'media' ? 'By Media Type' : 'By File Extension'}\nDestination: ${destDesc}\n\n(You can use Undo Last Run afterward if needed.)`)) {
        return;
    }
    const status = document.getElementById('organizerStatus');
    if (status) {
        status.classList.remove('sharing-error');
        status.textContent = 'Organizing files... Please wait.';
    }
    AppendConsoleLogEntry(`[ORGANIZER] Running organization (${payload.mode}) across ${payload.folders.length} folder(s)...`);
    window.chrome?.webview?.postMessage(JSON.stringify(payload));
};

window.TriggerUndoOrganize = function() {
    if (!confirm('Undo the last File Organizer run and move files back to their original folders?')) return;
    const status = document.getElementById('organizerStatus');
    if (status) {
        status.classList.remove('sharing-error');
        status.textContent = 'Restoring files from last run...';
    }
    AppendConsoleLogEntry('[ORGANIZER] Undoing last file organization run...');
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'UNDO_ORGANIZE' }));
};

function FormatBytesCompact(bytes) {
    const n = Number(bytes || 0);
    if (n >= 1073741824) return `${(n / 1073741824).toFixed(2)} GB`;
    if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
    if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${n} B`;
}

function RenderFileOrganizerPreview(data) {
    const status = document.getElementById('organizerStatus');
    const summaryEl = document.getElementById('organizerPreviewSummary');
    const breakdownEl = document.getElementById('organizerBreakdownStrip');
    const listEl = document.getElementById('organizerPreviewContainer');

    if (status) {
        status.classList.toggle('sharing-error', !!data.error);
        status.textContent = data.error || data.message || 'Preview ready.';
    }
    if (summaryEl) summaryEl.style.display = 'flex';
    SetDomText('sumOrgMatched', data.matchedCount ?? 0);
    SetDomText('sumOrgSize', `${data.totalMB ?? 0} MB`);
    const breakdown = Array.isArray(data.targetBreakdown) ? data.targetBreakdown : (data.targetBreakdown ? [data.targetBreakdown] : []);
    SetDomText('sumOrgTargets', breakdown.length);
    SetDomText('sumOrgSkipped', data.skippedCount ?? 0);

    if (breakdownEl) {
        breakdownEl.replaceChildren();
        if (breakdown.length) {
            breakdownEl.style.display = 'flex';
            breakdown.forEach(b => {
                const pill = document.createElement('span');
                pill.className = 'org-breakdown-pill';
                pill.textContent = `${b.destDir} (${b.count})`;
                pill.title = b.destDir;
                breakdownEl.appendChild(pill);
            });
        } else {
            breakdownEl.style.display = 'none';
        }
    }

    if (!listEl) return;
    listEl.replaceChildren();

    const items = Array.isArray(data.items) ? data.items : (data.items ? [data.items] : []);
    if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'driver-text-node';
        empty.textContent = 'No files matched your active rules (everything is already organized or no matching extensions found).';
        listEl.appendChild(empty);
        return;
    }

    const frag = document.createDocumentFragment();
    items.forEach(item => {
        const row = document.createElement('div');
        row.className = 'org-preview-row';

        const top = document.createElement('div');
        top.className = 'org-preview-top';
        const fileEl = document.createElement('strong');
        fileEl.textContent = item.fileName;
        const metaEl = document.createElement('span');
        metaEl.className = 'org-preview-meta';
        metaEl.innerHTML = `<span class="sharing-badge badge-info">${item.ruleLabel}</span> <span class="org-size-text">${FormatBytesCompact(item.sizeBytes)}</span>${item.renamed ? ' <span class="sharing-badge badge-purple">Renamed</span>' : ''}`;
        top.append(fileEl, metaEl);

        const movePath = document.createElement('div');
        movePath.className = 'org-preview-paths';
        movePath.textContent = `${item.sourceDir}  →  ${item.destPath}`;
        movePath.title = `${item.sourcePath} -> ${item.destPath}`;

        row.append(top, movePath);
        frag.appendChild(row);
    });

    if (data.truncated) {
        const note = document.createElement('div');
        note.className = 'driver-text-node';
        note.style.padding = '6px';
        note.textContent = `Showing first ${items.length} of ${data.matchedCount} matched files.`;
        frag.appendChild(note);
    }

    listEl.appendChild(frag);
}

function HandleFileOrganizerResult(data) {
    const status = document.getElementById('organizerStatus');
    if (status) {
        status.classList.toggle('sharing-error', !!data.error);
        status.textContent = data.error || data.message || 'Organization complete.';
    }
    if (data.message) AppendConsoleLogEntry(`[ORGANIZER] ${data.message}`);
    if (data.error) AppendConsoleLogEntry(`[ORGANIZER ERROR] ${data.error}`);

    UpdateOrganizerUndoButton(!!data.undoAvailable, data.undoCount || 0);

    // Refresh live folder file counts if returned
    if (Array.isArray(data.userFolders)) {
        data.userFolders.forEach(fresh => {
            const match = window._orgFolders.find(f => f.path.toLowerCase() === (fresh.path || '').toLowerCase());
            if (match) match.fileCount = fresh.fileCount;
        });
        RenderOrganizerFolders();
    }

    const listEl = document.getElementById('organizerPreviewContainer');
    const summaryEl = document.getElementById('organizerPreviewSummary');
    const breakdownEl = document.getElementById('organizerBreakdownStrip');
    if (summaryEl) summaryEl.style.display = 'none';
    if (breakdownEl) breakdownEl.style.display = 'none';
    if (listEl) {
        listEl.replaceChildren();
        const card = document.createElement('div');
        card.className = 'org-result-banner';
        card.textContent = data.message || 'Completed.';
        listEl.appendChild(card);

        const errs = Array.isArray(data.errors) ? data.errors : [];
        if (errs.length) {
            const errBox = document.createElement('div');
            errBox.className = 'sharing-error';
            errBox.style.fontSize = '11px';
            errBox.style.marginTop = '6px';
            errBox.textContent = 'Errors: ' + errs.join(' | ');
            listEl.appendChild(errBox);
        }
    }
}

function HandleFileOrganizerNotice(data) {
    const status = document.getElementById('organizerStatus');
    if (status) {
        status.classList.toggle('sharing-error', !!data.error);
        status.textContent = data.error || data.message || '';
    }
    if (data.error) AppendConsoleLogEntry(`[ORGANIZER ERROR] ${data.error}`);
}

// =========================================================================
// VIEW 8: ULTIMADIAGX - THE ULTIMATE DIAGNOSTIC LOGGING TOOL CONTROLLER
// =========================================================================
window._ultimaDiagXLoaded = false;
window._diagXReport = null;
window._diagXEventsCache = [];
window._diagXSeverityFilter = 'all';
window._diagXSubsystemFilter = 'all';
window._diagXExternalLogs = [];
window._diagXLiveTimer = null;
window._diagXLastTopEpoch = 0;

const DIAGX_STORAGE_KEY = 'corewatch_ultimadiagx_extlogs_v1';

function LoadDiagXExternalLogs() {
    try {
        const raw = localStorage.getItem(DIAGX_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
}

function SaveDiagXExternalLogs() {
    try {
        localStorage.setItem(DIAGX_STORAGE_KEY, JSON.stringify(window._diagXExternalLogs));
    } catch {}
}

window.InitUltimaDiagX = function() {
    window._diagXExternalLogs = LoadDiagXExternalLogs();
    RenderDiagXExternalLogChips();
    RunUltimaDiagXScan();
};

window.RunUltimaDiagXScan = function(isLivePoll) {
    const hoursBack = parseInt(document.getElementById('selDiagHoursBack')?.value || '24', 10);
    const includeWarnings = !!document.getElementById('chkDiagIncludeWarnings')?.checked;
    const status = document.getElementById('diagXStatus');
    if (status && !isLivePoll) {
        status.classList.remove('sharing-error');
        status.textContent = `Scanning native Windows event channels + ${window._diagXExternalLogs.length} external log source(s) (last ${hoursBack}h)...`;
    }
    window.chrome?.webview?.postMessage(JSON.stringify({
        command: 'RUN_DIAGNOSTIC',
        hoursBack: hoursBack,
        includeWarnings: includeWarnings,
        externalLogs: window._diagXExternalLogs
    }));
};

window.ToggleDiagXLiveWatch = function() {
    const btn = document.getElementById('btnDiagLiveWatch');
    if (window._diagXLiveTimer) {
        clearInterval(window._diagXLiveTimer);
        window._diagXLiveTimer = null;
        if (btn) {
            btn.textContent = 'Live Watch: OFF';
            btn.classList.remove('diagx-live-active');
        }
        AppendConsoleLogEntry('[ULTIMADIAGX] Live Watch paused.');
    } else {
        window._diagXLiveTimer = setInterval(() => {
            RunUltimaDiagXScan(true);
        }, 12000);
        if (btn) {
            btn.textContent = 'Live Watch: ON (12s)';
            btn.classList.add('diagx-live-active');
        }
        AppendConsoleLogEntry('[ULTIMADIAGX] Live Watch active — polling diagnostic channels every 12s.');
        RunUltimaDiagXScan(true);
    }
};

window.ExportDiagXReport = function() {
    const hoursBack = parseInt(document.getElementById('selDiagHoursBack')?.value || '24', 10);
    const includeWarnings = !!document.getElementById('chkDiagIncludeWarnings')?.checked;
    const status = document.getElementById('diagXStatus');
    if (status) status.textContent = 'Generating consolidated UltimaDiagX Markdown report on Desktop...';
    window.chrome?.webview?.postMessage(JSON.stringify({
        command: 'EXPORT_DIAG_REPORT',
        hoursBack: hoursBack,
        includeWarnings: includeWarnings,
        externalLogs: window._diagXExternalLogs
    }));
};

window.OpenNativeEventViewer = function() {
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'OPEN_EVENT_VIEWER' }));
};

window.OpenNativeReliabilityMonitor = function() {
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'OPEN_RELIABILITY_MONITOR' }));
};

window.BrowseDiagLogFile = function() {
    window.chrome?.webview?.postMessage('Browse-LogFile');
};

window.DiscoverCommonDiagLogs = function() {
    const box = document.getElementById('diagXDiscoveredLogsBox');
    if (box) {
        box.style.display = 'block';
        box.textContent = 'Scanning PC for common Windows & third-party log files...';
    }
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'DISCOVER_APP_LOGS' }));
};

function HandleDiagBrowseLogFiles(data) {
    const paths = Array.isArray(data?.paths) ? data.paths : (data?.paths ? [data.paths] : []);
    let added = 0;
    paths.forEach(p => {
        if (AddDiagXExternalLogPath(p, true)) added++;
    });
    if (added > 0) {
        SaveDiagXExternalLogs();
        RenderDiagXExternalLogChips();
        RunUltimaDiagXScan();
    }
}

window.AddDiagXExternalLogFromInput = function() {
    const inp = document.getElementById('diagXExternalLogInput');
    if (!inp) return;
    const val = inp.value.trim();
    if (!val) return;
    if (AddDiagXExternalLogPath(val)) {
        inp.value = '';
    }
};

function AddDiagXExternalLogPath(pathStr, skipRefresh) {
    const cleaned = (pathStr || '').trim().replace(/^"|"$/g, '');
    if (!cleaned) return false;
    if (window._diagXExternalLogs.some(p => p.toLowerCase() === cleaned.toLowerCase())) {
        return false;
    }
    window._diagXExternalLogs.push(cleaned);
    if (!skipRefresh) {
        SaveDiagXExternalLogs();
        RenderDiagXExternalLogChips();
        RunUltimaDiagXScan();
    }
    return true;
}

function RenderDiagXExternalLogChips() {
    const container = document.getElementById('diagXExternalLogChips');
    if (!container) return;
    container.replaceChildren();

    if (!window._diagXExternalLogs.length) {
        const empty = document.createElement('div');
        empty.className = 'driver-text-node';
        empty.textContent = 'No external program logs attached yet. Click Auto-Discover Logs or Browse File/Folder to merge app logs.';
        container.appendChild(empty);
        return;
    }

    const scannedMap = new Map();
    const extSources = window._diagXReport?.externalSources || [];
    (Array.isArray(extSources) ? extSources : [extSources]).forEach(s => {
        if (s && s.path) scannedMap.set(s.path.toLowerCase(), s);
    });

    window._diagXExternalLogs.forEach((p, idx) => {
        const chip = document.createElement('div');
        chip.className = 'org-override-chip';
        const info = scannedMap.get(p.toLowerCase());
        const badgeHtml = info
            ? (info.status === 'Missing'
                ? '<span class="sharing-badge badge-danger">Missing</span>'
                : `<span class="sharing-badge badge-info">${info.matched} hits</span>`)
            : '';
        const shortName = p.split('\\').filter(Boolean).slice(-2).join('\\') || p;
        chip.innerHTML = `<strong title="${p}">${shortName}</strong> ${badgeHtml}`;

        const del = document.createElement('button');
        del.type = 'button';
        del.className = 'org-mini-btn danger';
        del.textContent = '✕';
        del.addEventListener('click', () => {
            window._diagXExternalLogs.splice(idx, 1);
            SaveDiagXExternalLogs();
            RenderDiagXExternalLogChips();
            RunUltimaDiagXScan();
        });
        chip.appendChild(del);
        container.appendChild(chip);
    });
}

function RenderDiagXDiscoveredLogs(data) {
    const box = document.getElementById('diagXDiscoveredLogsBox');
    if (!box) return;
    box.style.display = 'block';
    box.replaceChildren();

    const logs = Array.isArray(data.logs) ? data.logs : (data.logs ? [data.logs] : []);
    if (!logs.length) {
        box.textContent = 'No standard external log files were detected in default paths.';
        return;
    }

    const title = document.createElement('div');
    title.className = 'organizer-sub-heading';
    title.textContent = `Discovered System & Program Logs (${logs.length}) — click to attach:`;
    box.appendChild(title);

    const wrap = document.createElement('div');
    wrap.className = 'organizer-overrides-list';
    logs.forEach(item => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'filter-pill';
        btn.textContent = `+ ${item.label}`;
        btn.title = item.path;
        btn.addEventListener('click', () => {
            AddDiagXExternalLogPath(item.path);
            btn.disabled = true;
            btn.textContent = `✓ ${item.label}`;
        });
        wrap.appendChild(btn);
    });
    box.appendChild(wrap);
}

function RenderUltimaDiagXReport(data) {
    window._ultimaDiagXLoaded = true;
    const status = document.getElementById('diagXStatus');

    if (data.error) {
        if (status) {
            status.classList.add('sharing-error');
            status.textContent = `Diagnostic scan error: ${data.error}`;
        }
        return;
    }

    window._diagXReport = data;
    const events = Array.isArray(data.events) ? data.events : (data.events ? [data.events] : []);

    // Detect brand new critical/error events during Live Watch
    if (window._diagXLastTopEpoch > 0 && events.length > 0) {
        const newAlerts = events.filter(e => e.epochMs > window._diagXLastTopEpoch && (e.severity === 'Critical' || e.severity === 'Error') && !e.isBenign);
        newAlerts.forEach(ev => {
            ev._isLiveNew = true;
            AppendConsoleLogEntry(`[ULTIMADIAGX LIVE ALERT] [${ev.severity}] ${ev.provider} (ID ${ev.eventId}): ${ev.translation || ev.message}`);
        });
    }
    if (events.length > 0) {
        window._diagXLastTopEpoch = Math.max(window._diagXLastTopEpoch, events[0].epochMs || 0);
    }

    window._diagXEventsCache = events;

    // Score & Grade Banner
    SetDomText('lblDiagScore', data.healthScore ?? '--');
    SetDomText('lblDiagGrade', data.healthGrade || 'UNKNOWN');
    SetDomText('lblDiagSynopsisText', data.executiveSummary || '');
    SetDomText('lblDiagReliability', data.reliabilityIndex !== null && data.reliabilityIndex !== undefined ? `Windows Reliability Index: ${data.reliabilityIndex} / 10` : 'Reliability Index: N/A');
    SetDomText('diagXLastScanStamp', `Last scan: ${data.generatedAt || 'now'}`);

    const scoreBox = document.getElementById('diagXScoreBox');
    if (scoreBox) {
        scoreBox.className = 'diagx-score-box';
        const g = (data.healthGrade || '').toLowerCase();
        if (g === 'healthy') scoreBox.classList.add('grade-healthy');
        else if (g === 'advisory') scoreBox.classList.add('grade-advisory');
        else if (g === 'degraded') scoreBox.classList.add('grade-degraded');
        else scoreBox.classList.add('grade-critical');
    }

    const c = data.counts || {};
    SetDomText('sumDiagTotal',    c.total ?? events.length);
    SetDomText('sumDiagCritical', c.critical ?? 0);
    SetDomText('sumDiagErrors',   c.errors ?? 0);
    SetDomText('sumDiagWarnings', c.warnings ?? 0);
    SetDomText('sumDiagExternal', c.external ?? 0);
    SetDomText('sumDiagWer',      data.werRecent7d ?? 0);

    // Subsystem Health Matrix (clickable to filter timeline!)
    const subGrid = document.getElementById('diagXSubsystemsGrid');
    if (subGrid) {
        subGrid.replaceChildren();
        const subs = Array.isArray(data.subsystems) ? data.subsystems : [];
        subs.forEach(s => {
            const tile = document.createElement('button');
            tile.type = 'button';
            const stClass = s.status === 'CRITICAL' ? 'sub-crit' : (s.status === 'WARN' ? 'sub-warn' : 'sub-ok');
            tile.className = `diagx-sub-tile ${stClass}${window._diagXSubsystemFilter === s.name ? ' active' : ''}`;
            tile.innerHTML = `
                <div class="diagx-sub-top">
                    <span>${s.icon} ${s.name}</span>
                    <span class="sharing-badge ${s.status === 'CRITICAL' ? 'badge-danger' : (s.status === 'WARN' ? 'badge-purple' : 'badge-success')}">${s.status}</span>
                </div>
                <div class="diagx-sub-counts">Crit: <strong>${s.critical}</strong> · Err: <strong>${s.errors}</strong> · Warn: <strong>${s.warnings}</strong></div>
            `;
            tile.addEventListener('click', () => {
                window._diagXSubsystemFilter = (window._diagXSubsystemFilter === s.name) ? 'all' : s.name;
                RenderUltimaDiagXReportSubHighlight();
                ApplyDiagXEventFilter();
            });
            subGrid.appendChild(tile);
        });
    }

    // Detected Findings & Actionable Recommendations
    const findSec = document.getElementById('diagXFindingsSection');
    const findList = document.getElementById('diagXFindingsList');
    const findings = Array.isArray(data.findings) ? data.findings : (data.findings ? [data.findings] : []);
    if (findSec && findList) {
        findList.replaceChildren();
        if (findings.length) {
            findSec.style.display = 'block';
            findings.forEach(f => {
                const card = document.createElement('div');
                card.className = `diagx-finding-card ${f.severity === 'CRITICAL' ? 'find-crit' : 'find-warn'}`;
                card.innerHTML = `
                    <div class="diagx-finding-head">
                        <strong>${f.title}</strong>
                        <span class="sharing-badge ${f.severity === 'CRITICAL' ? 'badge-danger' : 'badge-purple'}">${f.severity} · ${f.count}x</span>
                    </div>
                    <div class="diagx-finding-desc">${f.explanation}</div>
                    <div class="diagx-finding-fix">💡 <strong>Action:</strong> ${f.recommendation}</div>
                `;
                findList.appendChild(card);
            });
        } else {
            findSec.style.display = 'none';
        }
    }

    // Crash Dumps
    const dumpList = document.getElementById('diagXDumpsList');
    if (dumpList) {
        dumpList.replaceChildren();
        const dumps = Array.isArray(data.crashDumps) ? data.crashDumps : (data.crashDumps ? [data.crashDumps] : []);
        if (!dumps.length) {
            dumpList.innerHTML = '<div class="driver-text-node" style="color:#48bb78;">✓ No BSOD minidumps or app crash dumps found.</div>';
        } else {
            dumps.forEach(d => {
                const row = document.createElement('div');
                row.className = 'diagx-mini-row';
                const left = document.createElement('div');
                left.innerHTML = `<strong>${d.name}</strong> <span class="sharing-badge badge-danger">${d.sizeMB} MB</span><div class="org-folder-path">${d.kind} · ${d.timestamp}</div>`;
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'org-mini-btn';
                btn.textContent = 'Locate';
                btn.addEventListener('click', () => {
                    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'OPEN_DUMP_LOCATION', path: d.path }));
                });
                row.append(left, btn);
                dumpList.appendChild(row);
            });
        }
    }

    // Top Recurring Fault Signatures
    const recList = document.getElementById('diagXRecurringList');
    if (recList) {
        recList.replaceChildren();
        const recs = Array.isArray(data.topRecurring) ? data.topRecurring : (data.topRecurring ? [data.topRecurring] : []);
        if (!recs.length) {
            recList.innerHTML = '<div class="driver-text-node" style="color:#48bb78;">✓ No recurring fault patterns detected.</div>';
        } else {
            recs.forEach(r => {
                const row = document.createElement('div');
                row.className = 'diagx-mini-row';
                row.innerHTML = `
                    <div style="min-width:0; flex:1;">
                        <strong>${r.provider}</strong> <span class="sharing-badge badge-info">ID ${r.eventId}</span> <span class="sharing-badge ${r.severity === 'Critical' ? 'badge-danger' : 'badge-purple'}">${r.count}x</span>
                        <div class="org-folder-path" title="${r.summary}">${r.summary}</div>
                    </div>
                `;
                recList.appendChild(row);
            });
        }
    }

    RenderDiagXExternalLogChips();

    if (status) {
        status.classList.remove('sharing-error');
        status.textContent = `Scan complete: ${c.total ?? events.length} events across ${c.channels ?? 0} Windows channels (Health: ${data.healthScore}/100 ${data.healthGrade}).`;
    }

    ApplyDiagXEventFilter();
}

function RenderUltimaDiagXReportSubHighlight() {
    document.querySelectorAll('#diagXSubsystemsGrid .diagx-sub-tile').forEach(btn => {
        const label = btn.querySelector('.diagx-sub-top span')?.textContent || '';
        const isActive = window._diagXSubsystemFilter !== 'all' && label.includes(window._diagXSubsystemFilter);
        btn.classList.toggle('active', isActive);
    });
}

window.SetDiagXSeverityFilter = function(sev) {
    window._diagXSeverityFilter = sev;
    document.querySelectorAll('#diagXSeverityPills .filter-pill').forEach(b => {
        b.classList.toggle('active', b.dataset.sev === sev);
    });
    ApplyDiagXEventFilter();
};

window.ApplyDiagXEventFilter = function() {
    const container = document.getElementById('diagXEventsContainer');
    if (!container) return;

    const query = (document.getElementById('diagXSearchInput')?.value || '').trim().toLowerCase();
    const hideBenign = !!document.getElementById('chkDiagHideBenign')?.checked;
    const sevFilter = window._diagXSeverityFilter || 'all';
    const subFilter = window._diagXSubsystemFilter || 'all';

    const filtered = window._diagXEventsCache.filter(ev => {
        if (hideBenign && ev.isBenign) return false;
        if (subFilter !== 'all' && ev.subsystem !== subFilter) return false;
        if (sevFilter === 'Critical' && ev.severity !== 'Critical') return false;
        if (sevFilter === 'Error' && ev.severity !== 'Error') return false;
        if (sevFilter === 'Warning' && ev.severity !== 'Warning') return false;
        if (sevFilter === 'External' && ev.sourceType !== 'External') return false;
        if (sevFilter === 'Translated' && !ev.translation && !(ev.extractedCodes && ev.extractedCodes.length)) return false;

        if (query) {
            const hay = [
                ev.message, ev.provider, ev.channel, ev.subsystem,
                String(ev.eventId || ''), ev.translation, ev.recommendedFix
            ].filter(Boolean).join(' ').toLowerCase();
            if (!hay.includes(query)) return false;
        }
        return true;
    });

    const subTag = subFilter !== 'all' ? ` · Subsystem: ${subFilter}` : '';
    SetDomText('diagXEventCountLabel', `Showing ${filtered.length} of ${window._diagXEventsCache.length} events${subTag}`);

    container.replaceChildren();
    if (!filtered.length) {
        const empty = document.createElement('div');
        empty.className = 'driver-text-node';
        empty.textContent = 'No diagnostic events match the current filters.';
        container.appendChild(empty);
        return;
    }

    const frag = document.createDocumentFragment();
    filtered.forEach(ev => {
        const card = document.createElement('article');
        const sevClass = ev.severity === 'Critical' ? 'ev-crit' : (ev.severity === 'Error' ? 'ev-err' : 'ev-warn');
        card.className = `diagx-event-card ${sevClass}${ev._isLiveNew ? ' ev-live-new' : ''}`;

        const head = document.createElement('div');
        head.className = 'diagx-event-head';
        const sevBadgeClass = ev.severity === 'Critical' || ev.severity === 'Error' ? 'badge-danger' : 'badge-purple';
        const idBadge = ev.eventId > 0
            ? `<button type="button" class="diagx-code-btn" onclick="QuickTranslateCode('${ev.eventId}')" title="Translate Event ID ${ev.eventId}">ID ${ev.eventId}</button>`
            : '<span class="sharing-badge badge-info">EXT LOG</span>';
        const newTag = ev._isLiveNew ? '<span class="sharing-badge badge-success">NEW</span>' : '';
        const benignTag = ev.isBenign ? '<span class="sharing-badge badge-neutral">Benign</span>' : '';

        head.innerHTML = `
            <span class="diagx-ev-left">
                <span class="sharing-badge ${sevBadgeClass}">${ev.severity}</span>
                ${newTag}
                <strong>${ev.provider}</strong>
                ${idBadge}
                <span class="diagx-ev-channel">${ev.channel}</span>
                ${benignTag}
            </span>
            <span class="diagx-ev-time">${ev.timestamp}</span>
        `;
        card.appendChild(head);

        const msgEl = document.createElement('div');
        msgEl.className = 'diagx-ev-msg';
        msgEl.textContent = ev.message;
        card.appendChild(msgEl);

        if (ev.translation) {
            const trEl = document.createElement('div');
            trEl.className = 'diagx-ev-translation';
            trEl.innerHTML = `<strong>Translation:</strong> `;
            trEl.appendChild(document.createTextNode(ev.translation));
            card.appendChild(trEl);
        }
        if (ev.recommendedFix) {
            const fixEl = document.createElement('div');
            fixEl.className = 'diagx-ev-fix';
            fixEl.innerHTML = `💡 <strong>Suggested Fix:</strong> `;
            fixEl.appendChild(document.createTextNode(ev.recommendedFix));
            card.appendChild(fixEl);
        }

        const codes = Array.isArray(ev.extractedCodes) ? ev.extractedCodes : [];
        if (codes.length) {
            const codeRow = document.createElement('div');
            codeRow.className = 'diagx-code-pills';
            codes.forEach(c => {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.className = 'diagx-code-btn';
                btn.textContent = `${c.code} · ${c.name}`;
                btn.addEventListener('click', () => QuickTranslateCode(c.code));
                codeRow.appendChild(btn);
            });
            card.appendChild(codeRow);
        }

        frag.appendChild(card);
    });
    container.appendChild(frag);
};

window.QuickTranslateCode = function(codeStr) {
    const inp = document.getElementById('diagXCodeInput');
    if (inp) inp.value = String(codeStr);
    TriggerCodeTranslation(String(codeStr));
    document.getElementById('diagXTranslateForm')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
};

function TriggerCodeTranslation(codeStr) {
    const trimmed = (codeStr || '').trim();
    if (!trimmed) return;
    const box = document.getElementById('diagXTranslationResult');
    if (box) {
        box.style.display = 'block';
        box.textContent = `Translating code '${trimmed}' against Windows error tables...`;
    }
    window.chrome?.webview?.postMessage(JSON.stringify({
        command: 'TRANSLATE_CODE',
        code: trimmed
    }));
}

function RenderDiagXCodeTranslation(data) {
    const box = document.getElementById('diagXTranslationResult');
    if (!box) return;
    box.style.display = 'block';
    const t = data?.translation;
    if (!t) {
        box.textContent = data?.error || 'Could not translate code.';
        return;
    }

    box.innerHTML = `
        <div class="diagx-trans-head">
            <span><strong>${t.code}</strong> — <span style="color:#90cdf4;">${t.name}</span></span>
            <span class="sharing-badge badge-info">${t.category}</span>
        </div>
        <div class="diagx-trans-body">${t.explanation}</div>
        <div class="diagx-ev-fix" style="margin-top:4px;">💡 <strong>Recommendation:</strong> ${t.fix}</div>
        <div class="diagx-trans-src">Source: ${t.source}${t.decimal ? ` · Decimal: ${t.decimal}` : ''}</div>
    `;
}

function HandleDiagXNotice(data) {
    const status = document.getElementById('diagXStatus');
    if (status) {
        status.classList.toggle('sharing-error', !!data.error);
        status.textContent = data.error || data.message || '';
    }
    if (data.message) AppendConsoleLogEntry(`[ULTIMADIAGX] ${data.message}`);
    if (data.error) AppendConsoleLogEntry(`[ULTIMADIAGX ERROR] ${data.error}`);
}

// =========================================================================
// VIEW 9: WSL — WINDOWS SUBSYSTEM FOR LINUX DEPLOYMENT & MANAGEMENT
// =========================================================================
window._wslManagerLoaded = false;
window._wslStateCache = null;

function SetWslStatus(text, isError = false) {
    const el = document.getElementById('wslStatus');
    if (!el) return;
    el.classList.toggle('sharing-error', !!isError);
    el.textContent = text;
}

window.RequestWslManager = function() {
    SetWslStatus('Inspecting WSL engine, installed distributions, VHDX sizes, and .wslconfig...');
    window.chrome?.webview?.postMessage('Request-WslManager');
};

window.RequestWslOnlineCatalog = function() {
    SetWslStatus('Fetching online WSL distribution catalog...');
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'WSL_LOAD_ONLINE_CATALOG' }));
};

function RenderWslManagerState(data) {
    window._wslManagerLoaded = true;
    window._wslStateCache = data;

    if (!data) return;

    const statusMsg = data.actionMessage || data.statusMessage || 'WSL state loaded.';
    SetWslStatus(statusMsg, !!data.error);
    if (data.actionMessage) {
        AppendConsoleLogEntry(`[WSL] ${data.actionMessage}`);
    }

    const eng = data.engine || {};
    SetDomText('lblWslVersion', eng.wslVersion || (data.installed ? 'Installed' : 'Not Installed'));
    SetDomText('lblWslKernel', eng.kernelVersion || '--');
    SetDomText('lblWslgVersion', eng.wslgVersion || '--');
    SetDomText('lblWslVmmem', eng.vmmemMemory || 'Idle (0 MB)');
    SetDomText('lblWslDistroCount', `${eng.totalDistros ?? 0} (${eng.runningCount ?? 0} running)`);
    SetDomText('lblWslTotalDisk', eng.totalDiskUsage || '0 MB');
    SetDomText('lblWslDefaultDistro', `Default: ${eng.defaultDistro || 'None'}`);

    const defVerBtn = document.getElementById('btnWslDefaultVer');
    if (defVerBtn) {
        const ver = Number(eng.defaultVersion || 2);
        defVerBtn.textContent = `WSL ${ver}`;
        defVerBtn.dataset.ver = String(ver);
        defVerBtn.classList.remove('state-info', 'state-purple');
        defVerBtn.classList.add(ver === 2 ? 'state-info' : 'state-purple');
    }

    // Setup / Readiness Banner when WSL is not installed
    const setupBanner = document.getElementById('wslSetupBanner');
    if (setupBanner) {
        setupBanner.style.display = data.installed ? 'none' : 'block';
        const pre = data.prerequisites || {};
        SetDomText('lblWslPrereqVirt', pre.virtualization || '--');
        SetDomText('lblWslPrereqWsl', pre.wslFeature || '--');
        SetDomText('lblWslPrereqVmp', pre.vmPlatform || '--');
    }

    // Installed Distributions Cards
    const distros = Array.isArray(data.distributions) ? data.distributions : (data.distributions ? [data.distributions] : []);
    RenderWslDistroCards(distros);
    PopulateWslCmdDistroPicker(distros);

    // Online Catalog (if included in payload)
    if (Array.isArray(data.onlineCatalog) && data.onlineCatalog.length > 0) {
        RenderWslOnlineCatalog(data.onlineCatalog, data.catalogSource);
    }

    // Global .wslconfig Editor Fields
    if (data.wslConfig) {
        PopulateWslConfigForm(data.wslConfig);
    }
}

function RenderWslDistroCards(distros) {
    const container = document.getElementById('wslDistroList');
    if (!container) return;
    container.replaceChildren();

    if (!distros.length) {
        const empty = document.createElement('div');
        empty.className = 'driver-text-node';
        empty.textContent = 'No Linux distributions registered yet. Deploy one from the catalog below or import a custom .tar / .vhdx archive.';
        container.appendChild(empty);
        return;
    }

    distros.forEach(d => {
        const isRunning = d.state === 'Running';
        const card = document.createElement('article');
        card.className = `wsl-distro-card ${isRunning ? 'is-running' : 'is-stopped'}`;

        const safeName = String(d.name || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const stateBadge = isRunning
            ? '<span class="sharing-badge badge-success">Running</span>'
            : `<span class="sharing-badge badge-neutral">${d.state || 'Stopped'}</span>`;
        const verBadge = `<span class="sharing-badge badge-info">WSL ${d.version || 2}</span>`;
        const defBadge = d.isDefault ? '<span class="sharing-badge badge-purple">★ Default</span>' : '';

        const nextVer = Number(d.version || 2) === 2 ? 1 : 2;
        const stopBtn = isRunning
            ? `<button type="button" onclick="TriggerWslTerminateDistro('${safeName}')">Stop</button>`
            : '';
        const setDefBtn = !d.isDefault
            ? `<button type="button" onclick="TriggerWslSetDefaultDistro('${safeName}')">Set Default</button>`
            : '';
        const compactBtn = Number(d.version || 2) === 2
            ? `<button type="button" onclick="TriggerWslCompactVhdx('${safeName}')" title="Shut down WSL and reclaim unused sparse VHDX disk space">Compact VHDX</button>`
            : '';

        card.innerHTML = `
            <div class="wsl-distro-head">
                <span class="wsl-distro-title">🐧 ${d.name}</span>
                <span class="card-badge-group">${defBadge}${verBadge}${stateBadge}</span>
            </div>
            <div class="wsl-distro-meta">
                <div>VHDX Disk: <strong>${d.vhdxSize || 'N/A'}</strong></div>
                <div>IPv4: <strong>${d.ipAddress || (isRunning ? 'NAT/Mirrored' : 'Stopped')}</strong></div>
                <div>Default UID: <strong>${d.defaultUid ?? 1000}</strong></div>
                <div>Engine: <strong>WSL ${d.version || 2}</strong></div>
            </div>
            ${d.basePath ? `<div class="wsl-distro-path" title="${d.basePath}">Path: ${d.basePath}</div>` : ''}
            <div class="wsl-distro-actions">
                <button type="button" onclick="TriggerWslLaunchDistro('${safeName}')">Launch Shell</button>
                <button type="button" onclick="TriggerWslExploreDistro('${safeName}')">Explore Files</button>
                ${stopBtn}
                ${setDefBtn}
                <button type="button" onclick="TriggerWslConvertVersion('${safeName}', ${nextVer})">To WSL ${nextVer}</button>
                <button type="button" onclick="TriggerWslExportDistro('${safeName}')">Export .tar</button>
                ${compactBtn}
                <button type="button" class="wsl-btn-danger" onclick="TriggerWslUnregisterDistro('${safeName}')">Unregister</button>
            </div>
        `;
        container.appendChild(card);
    });
}

function RenderWslOnlineCatalog(items, source) {
    const sel = document.getElementById('selWslDeployDistro');
    const hint = document.getElementById('lblWslCatalogHint');
    if (!sel) return;
    const list = Array.isArray(items) ? items : [];
    if (!list.length) return;

    sel.replaceChildren();
    list.forEach(item => {
        const opt = document.createElement('option');
        opt.value = item.id;
        opt.textContent = `${item.id} — ${item.friendlyName || item.id}`;
        sel.appendChild(opt);
    });

    if (hint) {
        const srcText = source === 'live' ? `Live Microsoft WSL catalog (${list.length} distros)` : `Built-in catalog (${list.length} popular distros)`;
        hint.textContent = `${srcText} · Opens an interactive terminal for first-boot UNIX user setup.`;
    }
}

function PopulateWslCmdDistroPicker(distros) {
    const sel = document.getElementById('selWslCmdDistro');
    if (!sel) return;
    const prev = sel.value;
    sel.replaceChildren();

    const defOpt = document.createElement('option');
    defOpt.value = '__default__';
    defOpt.textContent = 'Default Distro';
    sel.appendChild(defOpt);

    distros.forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.name;
        opt.textContent = `${d.name} (${d.state})`;
        sel.appendChild(opt);
    });

    if (Array.from(sel.options).some(o => o.value === prev)) {
        sel.value = prev;
    }
}

function PopulateWslConfigForm(cfg) {
    SetDomText('lblWslConfigPath', cfg.path || '%USERPROFILE%\\.wslconfig');
    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v ?? ''; };
    const setChk = (id, v) => { const el = document.getElementById(id); if (el) el.checked = !!v; };

    setVal('wslCfgMemory', cfg.memory || '');
    setVal('wslCfgProcessors', cfg.processors || '');
    setVal('wslCfgSwap', cfg.swap || '');
    setVal('wslCfgNetMode', cfg.networkingMode === 'mirrored' ? 'mirrored' : 'nat');
    setVal('wslCfgMemReclaim', ['gradual', 'dropcache'].includes(cfg.autoMemoryReclaim) ? cfg.autoMemoryReclaim : 'disabled');

    setChk('wslCfgDnsTunneling', cfg.dnsTunneling);
    setChk('wslCfgFirewall', cfg.firewall);
    setChk('wslCfgAutoProxy', cfg.autoProxy);
    setChk('wslCfgGuiApps', cfg.guiApplications);
    setChk('wslCfgNestedVirt', cfg.nestedVirtualization);
    setChk('wslCfgSparseVhd', cfg.sparseVhd);
}

window.TriggerWslInstallEngine = function() {
    if (!confirm("Launch elevated WSL Engine installer (`wsl --install --no-distribution`)?\nA UAC prompt and terminal window will open to install/configure WSL.")) return;
    SetWslStatus('Launching elevated WSL engine installer...');
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'WSL_INSTALL_ENGINE' }));
};

window.TriggerWslUpdateEngine = function() {
    SetWslStatus('Launching elevated WSL kernel update (`wsl --update`)...');
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'WSL_UPDATE_ENGINE' }));
};

window.TriggerWslShutdownAll = function() {
    if (!confirm("Shut down all running WSL distributions and stop the WSL2 lightweight VM (`wsl --shutdown`)?")) return;
    SetWslStatus('Shutting down all WSL instances...');
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'WSL_SHUTDOWN_ALL' }));
};

window.TriggerWslDefaultVersionToggle = function() {
    const btn = document.getElementById('btnWslDefaultVer');
    const current = Number(btn?.dataset?.ver || 2);
    const next = current === 2 ? 1 : 2;
    SetWslStatus(`Setting default WSL version to WSL ${next}...`);
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'WSL_SET_DEFAULT_VERSION', version: next }));
};

window.TriggerWslDeployDistro = function() {
    const sel = document.getElementById('selWslDeployDistro');
    const distroId = sel?.value?.trim();
    if (!distroId) return;
    QuickDeployWslDistro(distroId);
};

window.QuickDeployWslDistro = function(distroId) {
    if (!confirm(`Deploy Linux distribution '${distroId}' via 'wsl --install -d ${distroId}'?\nAn interactive terminal will open to complete download and first-boot UNIX account creation.`)) return;
    SetWslStatus(`Launching deployment terminal for '${distroId}'...`);
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'WSL_DEPLOY_DISTRO', distroId }));
};

window.TriggerWslLaunchDistro = function(name) {
    SetWslStatus(`Opening Linux terminal for '${name}'...`);
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'WSL_LAUNCH_DISTRO', name }));
};

window.TriggerWslExploreDistro = function(name) {
    SetWslStatus(`Opening \\\\wsl.localhost\\${name} in File Explorer...`);
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'WSL_EXPLORE_DISTRO', name }));
};

window.TriggerWslTerminateDistro = function(name) {
    SetWslStatus(`Terminating distribution '${name}'...`);
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'WSL_TERMINATE_DISTRO', name }));
};

window.TriggerWslSetDefaultDistro = function(name) {
    SetWslStatus(`Setting '${name}' as default WSL distribution...`);
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'WSL_SET_DEFAULT_DISTRO', name }));
};

window.TriggerWslConvertVersion = function(name, version) {
    if (!confirm(`Convert '${name}' to WSL ${version}?\nThis may take several minutes for large distributions.`)) return;
    SetWslStatus(`Converting '${name}' to WSL ${version} (please wait)...`);
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'WSL_CONVERT_VERSION', name, version }));
};

window.TriggerWslExportDistro = function(name) {
    window.chrome?.webview?.postMessage(`Browse-WslExportFile:${name}`);
};

function ExecuteWslExportDistro(name, targetPath) {
    SetWslStatus(`Exporting '${name}' to ${targetPath} (this may take a moment)...`);
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'WSL_EXPORT_DISTRO', name, targetPath }));
}

window.TriggerWslCompactVhdx = function(name) {
    if (!confirm(`Compact ext4.vhdx virtual disk for '${name}'?\nAll running WSL distros will be shut down briefly to release the VHDX lock (requires Administrator privileges).`)) return;
    SetWslStatus(`Compacting VHDX virtual disk for '${name}'...`);
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'WSL_COMPACT_VHDX', name }));
};

window.TriggerWslUnregisterDistro = function(name) {
    if (!confirm(`WARNING: Permanently unregister and DELETE WSL distribution '${name}' and all files inside its Linux filesystem?\nExport a .tar backup first if you need to keep data.`)) return;
    const typed = prompt(`Type the distribution name "${name}" to confirm permanent deletion:`);
    if (typed !== name) return;
    SetWslStatus(`Unregistering '${name}'...`);
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'WSL_UNREGISTER_DISTRO', name }));
};

window.BrowseWslImportFile = function() {
    window.chrome?.webview?.postMessage('Browse-WslImportFile');
};

window.SaveWslConfig = function(restartWsl) {
    const config = {
        memory: document.getElementById('wslCfgMemory')?.value.trim() || '',
        processors: document.getElementById('wslCfgProcessors')?.value.trim() || '',
        swap: document.getElementById('wslCfgSwap')?.value.trim() || '',
        networkingMode: document.getElementById('wslCfgNetMode')?.value || 'nat',
        autoMemoryReclaim: document.getElementById('wslCfgMemReclaim')?.value || 'disabled',
        dnsTunneling: !!document.getElementById('wslCfgDnsTunneling')?.checked,
        firewall: !!document.getElementById('wslCfgFirewall')?.checked,
        autoProxy: !!document.getElementById('wslCfgAutoProxy')?.checked,
        guiApplications: !!document.getElementById('wslCfgGuiApps')?.checked,
        nestedVirtualization: !!document.getElementById('wslCfgNestedVirt')?.checked,
        sparseVhd: !!document.getElementById('wslCfgSparseVhd')?.checked
    };
    SetWslStatus(restartWsl ? 'Saving .wslconfig and shutting down WSL...' : 'Saving .wslconfig...');
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'WSL_SAVE_CONFIG', config, restartWsl: !!restartWsl }));
};

window.TriggerWslOpenConfigFile = function() {
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'WSL_OPEN_CONFIG_FILE' }));
};

window.RunWslPresetCommand = function(cmdText) {
    const inp = document.getElementById('wslCmdInput');
    if (inp) inp.value = cmdText;
    ExecuteWslQuickCommand();
};

function ExecuteWslQuickCommand() {
    const distro = document.getElementById('selWslCmdDistro')?.value || '__default__';
    const cmd = document.getElementById('wslCmdInput')?.value.trim();
    if (!cmd) return;
    const out = document.getElementById('wslCmdOutput');
    if (out) out.textContent = `$ ${cmd}\nRunning inside ${distro === '__default__' ? 'Default Distro' : distro}...`;
    SetDomText('lblWslCmdMeta', 'Running...');
    window.chrome?.webview?.postMessage(JSON.stringify({
        command: 'WSL_RUN_COMMAND',
        distro,
        linuxCommand: cmd
    }));
}

function RenderWslCommandOutput(data) {
    const out = document.getElementById('wslCmdOutput');
    if (out) {
        out.textContent = `[${data.distro || 'WSL'}] $ ${data.command || ''}\n\n${data.output || ''}`;
    }
    SetDomText('lblWslCmdMeta', `Exit ${data.exitCode ?? '?'} · ${data.elapsedMs ?? 0} ms`);
}

function HandleWslNotice(data) {
    const msg = data.error || data.message || '';
    SetWslStatus(msg, !!data.error || data.ok === false);
    if (data.message) AppendConsoleLogEntry(`[WSL] ${data.message}`);
    if (data.error) AppendConsoleLogEntry(`[WSL ERROR] ${data.error}`);
}

document.addEventListener('DOMContentLoaded', () => {
    const importForm = document.getElementById('wslImportForm');
    if (importForm) {
        importForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const name = document.getElementById('wslImportName')?.value.trim();
            const sourcePath = document.getElementById('wslImportSource')?.value.trim();
            const installDir = document.getElementById('wslImportInstallDir')?.value.trim();
            const version = Number(document.getElementById('wslImportVersion')?.value || 2);
            if (!name || !sourcePath || !installDir) return;
            SetWslStatus(`Importing '${name}' into ${installDir} (please wait)...`);
            window.chrome?.webview?.postMessage(JSON.stringify({
                command: 'WSL_IMPORT_DISTRO',
                name,
                sourcePath,
                installDir,
                version
            }));
        });
    }

    const cmdForm = document.getElementById('wslCmdForm');
    if (cmdForm) {
        cmdForm.addEventListener('submit', (e) => {
            e.preventDefault();
            ExecuteWslQuickCommand();
        });
    }
});

// =========================================================================
// VIEW 10: TASKS, WINDOWS SERVICES & OPEN PORTS / SOCKETS CONTROLLER
// =========================================================================
window._tasksPortsLoaded = false;
window._tasksPortsData = null;
window._tpActiveSubView = 'processes';
window._tpServiceFilter = 'all';
window._tpSocketFilter = 'listen';

function SetTpStatus(msg, isError = false) {
    const el = document.getElementById('tpStatus');
    if (!el) return;
    el.classList.toggle('sharing-error', !!isError);
    el.textContent = msg;
}

window.RequestTasksPorts = function() {
    SetTpStatus('Sampling live CPU% deltas, Windows Services, and active TCP/UDP sockets...');
    window.chrome?.webview?.postMessage('Request-TasksPorts');
};

window._tpLiveWatchTimer = null;

function StopTasksPortsLiveWatch() {
    if (window._tpLiveWatchTimer) {
        clearInterval(window._tpLiveWatchTimer);
        window._tpLiveWatchTimer = null;
    }
    const btn = document.getElementById('btnTpLiveRefresh');
    if (btn) {
        btn.textContent = 'Live: OFF';
        btn.classList.remove('btn-accent-action');
    }
}

window.ToggleTasksPortsLiveWatch = function() {
    if (window._tpLiveWatchTimer) {
        StopTasksPortsLiveWatch();
        SetTpStatus('Live 3s auto-refresh paused.');
    } else {
        const btn = document.getElementById('btnTpLiveRefresh');
        if (btn) {
            btn.textContent = 'Live: ON (3s)';
            btn.classList.add('btn-accent-action');
        }
        RequestTasksPorts();
        window._tpLiveWatchTimer = setInterval(() => {
            const panel = document.getElementById('viewTasksPortsPanel');
            if (!panel || panel.style.display === 'none') {
                StopTasksPortsLiveWatch();
                return;
            }
            window.chrome?.webview?.postMessage('Request-TasksPorts');
        }, 3000);
    }
};

window.SetTasksPortsSubView = function(viewKey) {
    window._tpActiveSubView = viewKey;
    document.querySelectorAll('#tpSubViewPills .filter-pill').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.view === viewKey);
    });
    const sortSel = document.getElementById('selTpSort');
    if (sortSel) sortSel.style.display = (viewKey === 'processes') ? 'inline-block' : 'none';
    RenderTasksPortsSubFilterPills();
    RenderCurrentTasksPortsView();
};

function RenderTasksPortsSubFilterPills() {
    const bar = document.getElementById('tpSubFilterPills');
    if (!bar) return;
    const view = window._tpActiveSubView;

    if (view === 'services') {
        bar.style.display = 'flex';
        const cur = window._tpServiceFilter;
        const opts = [
            ['all', 'All Services'],
            ['faulty', '⚠️ Stopped Auto'],
            ['running', 'Running'],
            ['stopped', 'Stopped'],
            ['disabled', 'Disabled']
        ];
        bar.innerHTML = opts.map(([k, lbl]) =>
            `<button type="button" class="filter-pill ${cur === k ? 'active' : ''}" onclick="SetTpServiceFilter('${k}')">${lbl}</button>`
        ).join('');
    } else if (view === 'sockets') {
        bar.style.display = 'flex';
        const cur = window._tpSocketFilter;
        const opts = [
            ['listen', 'Listening Ports'],
            ['established', 'Established TCP'],
            ['udp', 'UDP Endpoints'],
            ['all', 'All Sockets']
        ];
        bar.innerHTML = opts.map(([k, lbl]) =>
            `<button type="button" class="filter-pill ${cur === k ? 'active' : ''}" onclick="SetTpSocketFilter('${k}')">${lbl}</button>`
        ).join('');
    } else {
        bar.style.display = 'none';
        bar.innerHTML = '';
    }
}

window.SetTpServiceFilter = function(key) {
    window._tpServiceFilter = key;
    RenderTasksPortsSubFilterPills();
    RenderCurrentTasksPortsView();
};

window.SetTpSocketFilter = function(key) {
    window._tpSocketFilter = key;
    RenderTasksPortsSubFilterPills();
    RenderCurrentTasksPortsView();
};

function RenderTasksPortsState(data) {
    window._tasksPortsLoaded = true;
    window._tasksPortsData = data;
    if (!data) return;

    const sum = data.summary || {};
    SetDomText('lblTpTimestamp', `Snapshot: ${data.timestamp || '--'}`);
    SetDomText('sumTpProcs', sum.totalProcesses ?? '--');
    SetDomText('sumTpHandles', (sum.totalHandles ?? 0).toLocaleString());
    SetDomText('sumTpSvcRun', `${sum.runningSvcs ?? 0} / ${sum.totalServices ?? 0}`);
    SetDomText('sumTpSvcFault', sum.stoppedAutoSvc ?? 0);
    SetDomText('sumTpListen', sum.listeningPorts ?? 0);
    SetDomText('sumTpEstab', sum.establishedTcp ?? 0);

    const statusMsg = data.actionMessage
        || `Loaded ${sum.totalProcesses ?? 0} processes, ${sum.totalServices ?? 0} services (${sum.stoppedAutoSvc ?? 0} stopped auto), and ${sum.totalSockets ?? 0} TCP/UDP sockets.`;
    SetTpStatus(statusMsg, false);
    if (data.actionMessage) AppendConsoleLogEntry(`[TASKS/PORTS] ${data.actionMessage}`);

    RenderTasksPortsSubFilterPills();
    RenderCurrentTasksPortsView();
}

function EscapeHtmlTp(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

window.RenderCurrentTasksPortsView = function() {
    const container = document.getElementById('tpTableContainer');
    const data = window._tasksPortsData;
    if (!container || !data) return;

    const q = (document.getElementById('tpSearchInput')?.value || '').trim().toLowerCase();
    const view = window._tpActiveSubView;

    if (view === 'processes') {
        const sortBy = document.getElementById('selTpSort')?.value || 'ram';
        let list = Array.isArray(data.processes) ? [...data.processes] : [];
        if (q) {
            list = list.filter(p =>
                String(p.name).toLowerCase().includes(q) ||
                String(p.pid).includes(q) ||
                String(p.path || '').toLowerCase().includes(q)
            );
        }
        list.sort((a, b) => {
            if (sortBy === 'cpu') return (b.cpuPct - a.cpuPct) || (b.ramBytes - a.ramBytes);
            if (sortBy === 'handles') return (b.handles - a.handles) || (b.ramBytes - a.ramBytes);
            if (sortBy === 'name') return String(a.name).localeCompare(String(b.name));
            return (b.ramBytes - a.ramBytes) || (b.cpuPct - a.cpuPct);
        });

        if (!list.length) {
            container.innerHTML = '<div class="driver-text-node" style="padding:12px;">No active processes match your filter.</div>';
            return;
        }

        const rows = list.map(p => {
            const safePath = String(p.path || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            const safeName = String(p.name || '').replace(/'/g, "\\'");
            const cpuCls = p.cpuPct >= 25 ? 'hot-val' : (p.cpuPct >= 10 ? 'warn-val' : '');
            const ramCls = p.ramBytes >= 1073741824 ? 'warn-val' : '';
            const hndCls = p.handles >= 5000 ? 'warn-val' : '';
            const locBtn = p.path ? `<button type="button" onclick="TriggerTpOpenLocation('${safePath}')" title="Open file location in Explorer">Folder</button>` : '';
            return `<tr>
                <td><span class="tp-cell-primary">${EscapeHtmlTp(p.name)}.exe</span>${p.path ? `<span class="tp-cell-sub" title="${EscapeHtmlTp(p.path)}">${EscapeHtmlTp(p.path)}</span>` : ''}</td>
                <td class="tp-cell-num">${p.pid}</td>
                <td class="tp-cell-num ${cpuCls}">${Number(p.cpuPct || 0).toFixed(1)}%</td>
                <td class="tp-cell-num ${ramCls}">${EscapeHtmlTp(p.ramText)}</td>
                <td class="tp-cell-num ${hndCls}">${(p.handles ?? 0).toLocaleString()}</td>
                <td class="tp-cell-num">${p.threads ?? 0}</td>
                <td><div class="tp-row-actions">${locBtn}<button type="button" class="wsl-btn-danger" onclick="TriggerTpKillProcess(${p.pid}, '${safeName}')">End</button></div></td>
            </tr>`;
        }).join('');

        container.innerHTML = `<table class="tp-data-table">
            <thead><tr><th>Process / Path</th><th style="text-align:right">PID</th><th style="text-align:right">CPU</th><th style="text-align:right">RAM</th><th style="text-align:right">Handles</th><th style="text-align:right">Threads</th><th>Actions</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>`;
        return;
    }

    if (view === 'services') {
        const flt = window._tpServiceFilter;
        let list = Array.isArray(data.services) ? [...data.services] : [];
        if (flt === 'faulty') list = list.filter(s => s.isAutoStopped);
        else if (flt === 'running') list = list.filter(s => s.state === 'Running');
        else if (flt === 'stopped') list = list.filter(s => s.state !== 'Running');
        else if (flt === 'disabled') list = list.filter(s => s.startMode === 'Disabled');

        if (q) {
            list = list.filter(s =>
                String(s.name).toLowerCase().includes(q) ||
                String(s.displayName).toLowerCase().includes(q) ||
                String(s.account || '').toLowerCase().includes(q) ||
                String(s.pid || '').includes(q)
            );
        }

        if (!list.length) {
            container.innerHTML = '<div class="driver-text-node" style="padding:12px;">No Windows services match the selected filter.</div>';
            return;
        }

        const rows = list.map(s => {
            const safeSvc = String(s.name || '').replace(/'/g, "\\'");
            const isRun = s.state === 'Running';
            const badgeCls = isRun ? 'badge-success' : (s.isAutoStopped ? 'badge-danger' : 'badge-neutral');
            const rowCls = s.isAutoStopped ? 'tp-row-fault' : '';
            const curMode = s.startMode === 'Auto' ? 'Automatic' : (s.startMode === 'Disabled' ? 'Disabled' : 'Manual');
            const ctrlBtns = isRun
                ? `<button type="button" onclick="TriggerTpServiceAction('${safeSvc}', 'restart')">Restart</button><button type="button" class="wsl-btn-danger" onclick="TriggerTpServiceAction('${safeSvc}', 'stop')">Stop</button>`
                : `<button type="button" onclick="TriggerTpServiceAction('${safeSvc}', 'start')">Start</button>`;

            return `<tr class="${rowCls}">
                <td><span class="tp-cell-primary">${EscapeHtmlTp(s.displayName)}</span><span class="tp-cell-sub">${EscapeHtmlTp(s.name)}${s.account ? ` · ${EscapeHtmlTp(s.account)}` : ''}</span></td>
                <td><span class="sharing-badge ${badgeCls}">${EscapeHtmlTp(s.state)}${s.isAutoStopped ? ' (!)' : ''}</span></td>
                <td>
                    <select onchange="TriggerTpServiceStartup('${safeSvc}', this.value)" title="Change service startup type">
                        <option value="Automatic" ${curMode === 'Automatic' ? 'selected' : ''}>Auto</option>
                        <option value="Manual" ${curMode === 'Manual' ? 'selected' : ''}>Manual</option>
                        <option value="Disabled" ${curMode === 'Disabled' ? 'selected' : ''}>Disabled</option>
                    </select>
                </td>
                <td class="tp-cell-num">${s.pid > 0 ? s.pid : '--'}</td>
                <td><div class="tp-row-actions">${ctrlBtns}</div></td>
            </tr>`;
        }).join('');

        SetTpStatus(`Showing ${list.length} of ${(data.services || []).length} Windows services.`);
        container.innerHTML = `<table class="tp-data-table">
            <thead><tr><th>Service / Account</th><th>State</th><th>Startup</th><th style="text-align:right">PID</th><th>Control</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>`;
        return;
    }

    if (view === 'sockets') {
        const flt = window._tpSocketFilter;
        let list = Array.isArray(data.sockets) ? [...data.sockets] : [];
        if (flt === 'listen') list = list.filter(x => x.protocol === 'TCP' && x.state === 'Listen');
        else if (flt === 'established') list = list.filter(x => x.protocol === 'TCP' && x.state === 'Established');
        else if (flt === 'udp') list = list.filter(x => x.protocol === 'UDP');

        if (q) {
            list = list.filter(x =>
                String(x.localPort).includes(q) ||
                String(x.remotePort).includes(q) ||
                String(x.localAddress).toLowerCase().includes(q) ||
                String(x.remoteAddress).toLowerCase().includes(q) ||
                String(x.processName).toLowerCase().includes(q) ||
                String(x.pid).includes(q)
            );
        }

        if (!list.length) {
            container.innerHTML = '<div class="driver-text-node" style="padding:12px;">No TCP/UDP sockets match your filter.</div>';
            return;
        }

        const rows = list.map(x => {
            const localEp = `${x.localAddress}:${x.localPort}`;
            const remoteEp = x.protocol === 'UDP' ? '*:*' : `${x.remoteAddress}:${x.remotePort}`;
            const stCls = x.state === 'Listen' ? 'badge-info' : (x.state === 'Established' ? 'badge-success' : 'badge-neutral');
            const safePath = String(x.processPath || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            const safeProc = String(x.processName || '').replace(/'/g, "\\'");
            const safeEp = localEp.replace(/'/g, "\\'");
            const locBtn = x.processPath ? `<button type="button" onclick="TriggerTpOpenLocation('${safePath}')">Folder</button>` : '';
            const killBtn = x.pid > 4 ? `<button type="button" class="wsl-btn-danger" onclick="TriggerTpKillProcess(${x.pid}, '${safeProc}')">Kill PID</button>` : '';

            return `<tr>
                <td><span class="sharing-badge ${x.protocol === 'UDP' ? 'badge-purple' : 'badge-info'}">${x.protocol}</span></td>
                <td><span class="tp-port-badge">${x.localPort}</span> <span style="color:#a0aec0;">${EscapeHtmlTp(x.localAddress)}</span></td>
                <td style="color:#a0aec0;">${EscapeHtmlTp(remoteEp)}</td>
                <td><span class="sharing-badge ${stCls}">${EscapeHtmlTp(x.state)}</span></td>
                <td><span class="tp-cell-primary">${EscapeHtmlTp(x.processName)}</span> <span style="color:#718096;">(${x.pid})</span>${x.processPath ? `<span class="tp-cell-sub" title="${EscapeHtmlTp(x.processPath)}">${EscapeHtmlTp(x.processPath)}</span>` : ''}</td>
                <td><div class="tp-row-actions"><button type="button" onclick="CopyRawText('${safeEp}', 'Endpoint')">Copy</button>${locBtn}${killBtn}</div></td>
            </tr>`;
        }).join('');

        container.innerHTML = `<table class="tp-data-table">
            <thead><tr><th>Proto</th><th>Local Port / Addr</th><th>Remote Endpoint</th><th>State</th><th>Owning Process (PID)</th><th>Actions</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>`;
    }
};

window.TriggerTpKillProcess = function(pid, name) {
    if (!confirm(`Force-terminate process '${name}' (PID ${pid})?`)) return;
    SetTpStatus(`Terminating ${name} (PID ${pid})...`);
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'TP_KILL_PROCESS', pid }));
};

window.TriggerTpOpenLocation = function(path) {
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'TP_OPEN_PROCESS_LOCATION', path }));
};

window.TriggerTpServiceAction = function(serviceName, action) {
    if (action === 'stop' && !confirm(`Stop Windows service '${serviceName}'?`)) return;
    SetTpStatus(`Running '${action}' on service '${serviceName}'...`);
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'TP_SERVICE_ACTION', serviceName, action }));
};

window.TriggerTpServiceStartup = function(serviceName, startupType) {
    SetTpStatus(`Changing '${serviceName}' startup type to ${startupType}...`);
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'TP_SERVICE_STARTUP', serviceName, startupType }));
};

window.CopyRawText = function(text, label) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).catch(() => {});
    }
    AppendConsoleLogEntry(`[CLIPBOARD] Copied ${label}: ${text}`);
    SetTpStatus(`Copied ${label}: ${text}`);
};

function HandleTasksPortsNotice(data) {
    const msg = data.error || data.message || '';
    SetTpStatus(msg, !!data.error || data.ok === false);
    if (data.message) AppendConsoleLogEntry(`[TASKS/PORTS] ${data.message}`);
    if (data.error) AppendConsoleLogEntry(`[TASKS/PORTS ERROR] ${data.error}`);
}

// =========================================================================
// SCALABLE TOP-BAR SYSTEM TOOLS DROPDOWN CONTROLLER
// =========================================================================
window.ToggleSystemToolsMenu = function(e) {
    if (e) e.stopPropagation();
    const dd = document.getElementById('navSystemDropdown');
    const trigger = document.getElementById('tabSystemMenu');
    if (!dd) return;
    const isOpen = dd.classList.toggle('open');
    if (trigger) trigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
};

window.SelectSystemMenuView = function(viewKey) {
    SwitchAppLayoutView(viewKey);
};

document.addEventListener('click', (e) => {
    const dd = document.getElementById('navSystemDropdown');
    if (dd && dd.classList.contains('open') && !dd.contains(e.target)) {
        dd.classList.remove('open');
        const trigger = document.getElementById('tabSystemMenu');
        if (trigger) trigger.setAttribute('aria-expanded', 'false');
    }
    const javaDd = document.getElementById('javaDropdownWrap');
    if (javaDd && javaDd.classList.contains('open') && !javaDd.contains(e.target)) {
        javaDd.classList.remove('open');
        const jTrig = document.getElementById('btnJavaVersionToggle');
        if (jTrig) jTrig.setAttribute('aria-expanded', 'false');
    }
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const dd = document.getElementById('navSystemDropdown');
        if (dd && dd.classList.contains('open')) {
            dd.classList.remove('open');
            const trigger = document.getElementById('tabSystemMenu');
            if (trigger) trigger.setAttribute('aria-expanded', 'false');
        }
        const javaDd = document.getElementById('javaDropdownWrap');
        if (javaDd && javaDd.classList.contains('open')) {
            javaDd.classList.remove('open');
            const jTrig = document.getElementById('btnJavaVersionToggle');
            if (jTrig) jTrig.setAttribute('aria-expanded', 'false');
        }
    }
});

// =========================================================================
// POWERSHELL INTERACTIVE VERSION / UPDATE TOGGLE & JAVA SWITCHER
// Universal 3-Tier Colors: Green=Up-to-Date, Purple=1-5 Missed, Red=>5 Missed
// =========================================================================
function RenderPowerShellVersionControl(infra) {
    const el = document.getElementById('lblPsVersion');
    if (!el || !infra) return;

    const ver    = String(infra.PsVersion || '--');
    const latest = String(infra.PsLatestVersion || '');
    const missed = Number(infra.PsMissedUpdates || 0);
    const tier   = String(infra.PsVersionTier || 'uptodate');
    const detail = String(infra.PsUpdateDetail || 'Click to check for PowerShell updates').replace(/"/g, '&quot;');

    const isBusy = IsControlPending('CHECK_PS_UPDATE') || IsControlPending('INSTALL_PS_UPDATE');
    if (isBusy) {
        SetDomHtml(el, `<button type="button" class="toggle-pill-btn is-busy" disabled>Checking...</button>`);
        return;
    }

    let cls = 'ver-uptodate';
    let label = `${ver} ✓`;
    if (tier === 'critical' || missed > 5) {
        cls = 'ver-critical';
        label = latest ? `${ver} ⚠ ${latest} (+${missed})` : `${ver} ⚠ Outdated`;
    } else if (tier === 'update' || missed > 0) {
        cls = 'ver-update';
        label = latest ? `${ver} ⬆ ${latest}` : `${ver} ⬆ Update`;
    }

    const safeLatest = latest.replace(/'/g, "\\'");
    const safeVer = ver.replace(/'/g, "\\'");
    SetDomHtml(el, `<button type="button" class="toggle-pill-btn ${cls}" onclick="TriggerPowerShellUpdateToggle('${safeVer}', '${safeLatest}', ${missed})" title="${detail}">${label}</button>`);
}

window.TriggerPowerShellUpdateToggle = function(curVer, latestVer, missed) {
    if (missed > 0) {
        const action = confirm(
            `PowerShell update available: ${curVer} → ${latestVer || 'Latest'} (${missed} release${missed > 1 ? 's' : ''} behind).\n\n` +
            `Click OK to install the PowerShell 7 update via WinGet now.\n` +
            `(Click Cancel to re-check GitHub releases without installing.)`
        );
        if (action) {
            DispatchDashboardControl('INSTALL_PS_UPDATE', {}, `Launching PowerShell 7 updater (${curVer} -> ${latestVer || 'Latest'})...`, 'lblPsVersion');
        } else {
            DispatchDashboardControl('CHECK_PS_UPDATE', {}, 'Checking GitHub for latest PowerShell release...', 'lblPsVersion');
        }
    } else {
        DispatchDashboardControl('CHECK_PS_UPDATE', {}, 'Checking GitHub for PowerShell updates...', 'lblPsVersion');
    }
};

window._javaVersionsCache = [];
window._javaPrimaryPath = '';

function RenderJavaVersionControl(infra) {
    const lbl = document.getElementById('lblJavaVersion');
    const trigger = document.getElementById('btnJavaVersionToggle');
    const menu = document.getElementById('javaVersionMenu');
    if (!lbl || !trigger || !menu) return;

    const versions = Array.isArray(infra.JavaVersions) ? infra.JavaVersions : (infra.JavaVersions ? [infra.JavaVersions] : []);
    window._javaVersionsCache = versions;
    window._javaPrimaryPath = infra.JavaPrimaryPath || '';

    const primaryText = infra.JavaPrimaryText || (versions.length ? versions[0].label : 'Not Installed');
    const isBusy = IsControlPending('SET_PRIMARY_JAVA');
    const countHint = versions.length > 1 ? ` (+${versions.length - 1})` : '';
    const jTier = String(infra.JavaVersionTier || 'none');

    const nextText = isBusy ? 'Switching...' : `${primaryText}${countHint}`;
    if (lbl.textContent !== nextText) lbl.textContent = nextText;
    trigger.classList.toggle('is-missing', versions.length === 0);
    trigger.classList.toggle('ver-uptodate', jTier === 'uptodate');
    trigger.classList.toggle('ver-update', jTier === 'update');
    trigger.classList.toggle('ver-critical', jTier === 'critical');
    trigger.title = versions.length > 0
        ? `Primary Java: ${primaryText} (${window._javaPrimaryPath || 'PATH'}) — Click to view ${versions.length} installed runtime(s) or switch primary`
        : 'No Java runtime detected — Click to install Eclipse Temurin 25+';

    // Only rebuild dropdown DOM when menu isn't currently hovered/active OR content changed
    const sig = JSON.stringify(versions.map(v => `${v.path}|${v.isPrimary}`));
    if (menu.dataset.sig === sig) return;
    menu.dataset.sig = sig;
    menu.replaceChildren();

    const hdr = document.createElement('div');
    hdr.className = 'java-menu-header';
    hdr.innerHTML = `<span>Installed Java Runtimes</span><span>${versions.length} found</span>`;
    menu.appendChild(hdr);

    if (!versions.length) {
        const empty = document.createElement('div');
        empty.className = 'driver-text-node';
        empty.style.padding = '4px 4px 6px';
        empty.textContent = 'No JDK/JRE found in Program Files or JAVA_HOME.';
        menu.appendChild(empty);
    } else {
        versions.forEach(v => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = `java-menu-item${v.isPrimary ? ' is-primary' : ''}`;
            btn.setAttribute('role', 'menuitem');
            const badge = v.isPrimary
                ? '<span class="sharing-badge badge-success">Primary</span>'
                : '<span class="sharing-badge badge-info">Set Primary</span>';
            btn.innerHTML = `
                <div class="java-mi-top">
                    <span>☕ ${EscapeHtmlTp(v.label || v.version)}</span>
                    ${badge}
                </div>
                <div class="java-mi-path" title="${EscapeHtmlTp(v.path)}">${EscapeHtmlTp(v.path)}</div>
            `;
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                if (v.isPrimary) {
                    const wrap = document.getElementById('javaDropdownWrap');
                    if (wrap) wrap.classList.remove('open');
                    return;
                }
                TriggerSwitchPrimaryJava(v.path, v.label || v.version);
            });
            menu.appendChild(btn);
        });
    }

    const instBtn = document.createElement('button');
    instBtn.type = 'button';
    instBtn.className = 'java-menu-footer-btn';
    instBtn.textContent = '⬇️ Install Eclipse Temurin 25+ in App Installer';
    instBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        JumpToInstallJava();
    });
    menu.appendChild(instBtn);
}

window.ToggleJavaVersionDropdown = function(e) {
    if (e) e.stopPropagation();
    const wrap = document.getElementById('javaDropdownWrap');
    const trigger = document.getElementById('btnJavaVersionToggle');
    if (!wrap) return;
    const isOpen = wrap.classList.toggle('open');
    if (trigger) trigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
};

window.TriggerSwitchPrimaryJava = function(javaHome, label) {
    const wrap = document.getElementById('javaDropdownWrap');
    if (wrap) wrap.classList.remove('open');
    if (!confirm(`Set primary system Java (JAVA_HOME & System PATH) to:\n\n${label}\n${javaHome}\n\nNew terminals and apps will immediately use this Java version.`)) {
        return;
    }
    DispatchDashboardControl('SET_PRIMARY_JAVA', { javaHome, label }, `Switching primary Java -> ${label}...`, 'lblJavaVersion');
};

window.JumpToInstallJava = function() {
    const wrap = document.getElementById('javaDropdownWrap');
    if (wrap) wrap.classList.remove('open');
    SwitchAppLayoutView('appstore');
    const inp = document.getElementById('appStoreSearchInput');
    if (inp) {
        inp.value = 'Temurin';
        ApplyAppInstallerFilter();
    }
};

// =========================================================================
// ACTIVE NETWORK TROUBLESHOOTING TOOLKIT & WI-FI / ROUTING CONTROLLER
// =========================================================================
window._netActiveSubView = 'adapters';
window._netWifiRoutesLoaded = false;

window.SetNetworkSubView = function(subKey) {
    window._netActiveSubView = subKey;
    document.querySelectorAll('#netSubViewPills .filter-pill').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.netview === subKey);
    });
    const panes = {
        adapters: document.getElementById('netSubAdapters'),
        diagnostics: document.getElementById('netSubDiagnostics'),
        wifiroutes: document.getElementById('netSubWifiRoutes')
    };
    Object.entries(panes).forEach(([k, el]) => {
        if (el) el.style.display = (k === subKey) ? 'flex' : 'none';
    });

    if (subKey === 'adapters') {
        RequestNetworkAdapters();
    } else if (subKey === 'wifiroutes' && !window._netWifiRoutesLoaded) {
        RequestNetDiagWifiAndRoutes();
    }
};

window.RefreshActiveNetworkSubView = function() {
    if (window._netActiveSubView === 'wifiroutes') {
        RequestNetDiagWifiAndRoutes();
    } else if (window._netActiveSubView === 'diagnostics') {
        RunNetDiagPing();
    } else {
        RequestNetworkAdapters();
    }
};

function SetNetDiagBusy(titleText, metaText) {
    SetDomText('lblNetDiagResultTitle', titleText);
    SetDomText('lblNetDiagResultMeta', metaText);
    const area = document.getElementById('netDiagVisualArea');
    if (area) area.innerHTML = `<div class="driver-text-node">${EscapeHtmlTp(metaText)}</div>`;
    const status = document.getElementById('netManagerStatus');
    if (status) {
        status.classList.remove('sharing-error');
        status.textContent = metaText;
    }
}

window.SetNetDiagTarget = function(val) {
    const inp = document.getElementById('netDiagTargetInput');
    if (inp) inp.value = val;
};

window.SetNetDiagTargetGateway = function() {
    const gw = (document.getElementById('lblGateway')?.textContent || '').trim();
    if (gw && gw !== '0.0.0.0' && gw !== 'N/A') {
        SetNetDiagTarget(gw);
    } else {
        SetNetDiagTarget('192.168.1.1');
    }
};

window.RunNetDiagPing = function() {
    const target = (document.getElementById('netDiagTargetInput')?.value || '').trim();
    if (!target) return;
    SetNetDiagBusy(`📶 ICMP Ping -> ${target}`, `Sending 6 ICMP probes to ${target}...`);
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'NET_DIAG_PING', target, count: 6 }));
};

window.RunNetDiagTraceroute = function() {
    const target = (document.getElementById('netDiagTargetInput')?.value || '').trim();
    if (!target) return;
    SetNetDiagBusy(`🧭 Traceroute -> ${target}`, `Tracing route to ${target} (up to 20 hops)...`);
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'NET_DIAG_TRACEROUTE', target, maxHops: 20 }));
};

window.RunNetDiagPortTest = function() {
    const target = (document.getElementById('netDiagTargetInput')?.value || '').trim();
    const ports = (document.getElementById('netDiagPortsInput')?.value || '443').trim();
    if (!target) return;
    SetNetDiagBusy(`🔌 TCP Port Test -> ${target}`, `Probing TCP ports [${ports}] on ${target}...`);
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'NET_DIAG_PORT_TEST', target, ports }));
};

window.RunNetDiagDnsLookup = function() {
    const target = (document.getElementById('netDiagTargetInput')?.value || '').trim();
    const recordType = document.getElementById('selNetDiagDnsType')?.value || 'A';
    const server = (document.getElementById('netDiagDnsServer')?.value || '').trim();
    if (!target) return;
    SetNetDiagBusy(`🔎 DNS ${recordType} Lookup -> ${target}`, `Querying ${recordType} records for ${target}...`);
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'NET_DIAG_DNS_LOOKUP', target, recordType, server }));
};

window.RequestNetDiagWifiAndRoutes = function() {
    const status = document.getElementById('netManagerStatus');
    if (status) {
        status.classList.remove('sharing-error');
        status.textContent = 'Querying Wi-Fi radio telemetry, IPv4 routing table, and ARP neighbors...';
    }
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'NET_DIAG_WIFI_AND_ROUTES' }));
};

function RenderNetDiagResult(data) {
    const area = document.getElementById('netDiagVisualArea');
    const status = document.getElementById('netManagerStatus');
    if (!area || !data) return;

    if (data.tool === 'ping') {
        SetDomText('lblNetDiagResultTitle', `📶 ICMP Ping — ${data.target} (${data.resolvedIp})`);
        SetDomText('lblNetDiagResultMeta', `Avg: ${data.avgMs >= 0 ? data.avgMs + ' ms' : 'N/A'} · Jitter: ${data.jitterMs} ms · Loss: ${data.lossPct}%`);
        if (status) status.textContent = `Ping ${data.target}: ${data.received}/${data.sent} received, ${data.lossPct}% loss, avg ${data.avgMs} ms`;

        const samples = Array.isArray(data.samples) ? data.samples : [];
        const maxRtt = Math.max(20, ...samples.map(s => (s.rttMs > 0 ? s.rttMs : 0)));
        const barsHtml = samples.map(s => {
            const isOk = s.status === 'OK' && s.rttMs >= 0;
            const hPct = isOk ? Math.max(12, Math.round((s.rttMs / maxRtt) * 100)) : 100;
            const cls = !isOk ? 'bar-bad' : (s.rttMs >= 80 ? 'bar-bad' : (s.rttMs >= 35 ? 'bar-warn' : 'bar-good'));
            const lbl = isOk ? `${s.rttMs}ms` : 'ERR';
            return `<div class="net-ping-bar-wrap" title="Seq #${s.seq}: ${isOk ? s.rttMs + ' ms (TTL ' + s.ttl + ')' : s.status}">
                <div class="net-ping-bar ${cls}" style="height: ${hPct}%;"></div>
                <span class="net-ping-bar-lbl">${lbl}</span>
            </div>`;
        }).join('');

        area.innerHTML = `
            <div class="tab-summary-strip" style="margin-bottom: 8px;">
                <span class="summary-chip">Min: <strong>${data.minMs >= 0 ? data.minMs + ' ms' : '--'}</strong></span>
                <span class="summary-chip chip-accent">Avg: <strong>${data.avgMs >= 0 ? data.avgMs + ' ms' : '--'}</strong></span>
                <span class="summary-chip">Max: <strong>${data.maxMs >= 0 ? data.maxMs + ' ms' : '--'}</strong></span>
                <span class="summary-chip">Jitter: <strong>${data.jitterMs} ms</strong></span>
                <span class="summary-chip ${data.lossPct > 0 ? 'chip-warn' : 'chip-ok'}">Loss: <strong>${data.lossPct}%</strong></span>
            </div>
            <div class="net-ping-sparkline">${barsHtml}</div>
        `;
        return;
    }

    if (data.tool === 'traceroute') {
        const hops = Array.isArray(data.hops) ? data.hops : [];
        SetDomText('lblNetDiagResultTitle', `🧭 Traceroute — ${data.target} (${data.resolvedIp})`);
        SetDomText('lblNetDiagResultMeta', `${hops.length} hops · ${data.reached ? 'Target Reached' : 'Stopped at Max Hops'}`);
        if (status) status.textContent = `Traceroute to ${data.target} completed in ${hops.length} hops.`;

        const rows = hops.map(h => {
            const isTo = h.status === 'Timeout' || h.rttMs < 0;
            const rttCls = isTo ? 'hot-val' : (h.rttMs >= 80 ? 'warn-val' : '');
            return `<tr>
                <td class="tp-cell-num">${h.hop}</td>
                <td class="tp-cell-primary">${EscapeHtmlTp(h.ip)}</td>
                <td style="color:#a0aec0;">${EscapeHtmlTp(h.hostname || '--')}</td>
                <td class="tp-cell-num ${rttCls}">${isTo ? '*' : h.rttMs + ' ms'}</td>
                <td><span class="sharing-badge ${isTo ? 'badge-danger' : 'badge-success'}">${EscapeHtmlTp(h.status)}</span></td>
            </tr>`;
        }).join('');

        area.innerHTML = `<div class="tp-table-scroll"><table class="tp-data-table">
            <thead><tr><th style="text-align:right">Hop</th><th>Hop IP</th><th>Reverse Hostname</th><th style="text-align:right">RTT</th><th>Status</th></tr></thead>
            <tbody>${rows}</tbody>
        </table></div>`;
        return;
    }

    if (data.tool === 'port') {
        const list = Array.isArray(data.results) ? data.results : [];
        const openCnt = list.filter(r => r.open).length;
        SetDomText('lblNetDiagResultTitle', `🔌 TCP Port Reachability — ${data.target} (${data.resolvedIp})`);
        SetDomText('lblNetDiagResultMeta', `${openCnt}/${list.length} open`);
        if (status) status.textContent = `TCP Port test on ${data.target}: ${openCnt} of ${list.length} ports open.`;

        const rows = list.map(r => `<tr>
            <td><span class="tp-port-badge">${r.port}</span></td>
            <td>${EscapeHtmlTp(r.serviceHint)}</td>
            <td><span class="sharing-badge ${r.open ? 'badge-success' : 'badge-danger'}">${r.open ? 'OPEN' : 'CLOSED'}</span></td>
            <td class="tp-cell-num">${r.rttMs} ms</td>
            <td style="color:#a0aec0;">${EscapeHtmlTp(r.detail)}</td>
        </tr>`).join('');

        area.innerHTML = `<table class="tp-data-table">
            <thead><tr><th>Port</th><th>Service</th><th>State</th><th style="text-align:right">Time</th><th>Detail</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>`;
        return;
    }

    if (data.tool === 'dns') {
        const recs = Array.isArray(data.records) ? data.records : [];
        SetDomText('lblNetDiagResultTitle', `🔎 DNS ${data.recordType} — ${data.target}`);
        SetDomText('lblNetDiagResultMeta', `${recs.length} record(s) · ${data.elapsedMs} ms · Server: ${data.server}`);
        if (status) status.textContent = `DNS ${data.recordType} lookup for ${data.target} returned ${recs.length} record(s) in ${data.elapsedMs} ms.`;

        if (!recs.length) {
            area.innerHTML = '<div class="driver-text-node">No DNS records returned.</div>';
            return;
        }
        const rows = recs.map(r => `<tr>
            <td class="tp-cell-primary">${EscapeHtmlTp(r.name)}</td>
            <td><span class="sharing-badge badge-info">${EscapeHtmlTp(r.type)}</span></td>
            <td class="tp-cell-num">${r.ttl}s</td>
            <td style="user-select:text; word-break:break-all;">${EscapeHtmlTp(r.value)}</td>
        </tr>`).join('');

        area.innerHTML = `<table class="tp-data-table">
            <thead><tr><th>Name</th><th>Type</th><th style="text-align:right">TTL</th><th>Value</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>`;
    }
}

function RenderNetDiagWifiAndRoutes(data) {
    window._netWifiRoutesLoaded = true;
    const status = document.getElementById('netManagerStatus');
    SetDomText('lblNetWifiStamp', `Updated: ${data.timestamp || '--'}`);

    const w = data.wifi || {};
    const wifiBox = document.getElementById('netWifiTelemetryBox');
    if (wifiBox) {
        const sig = Number(w.signalPct || 0);
        const sigCls = !w.connected ? '' : (sig >= 75 ? 'sig-good' : (sig >= 50 ? 'sig-warn' : 'sig-bad'));
        const items = [
            ['SSID', w.ssid || 'Disconnected', ''],
            ['Signal / RSSI', w.connected ? `${sig}% (${w.rssiDbm})` : 'N/A', sigCls],
            ['Band & Channel', w.connected ? `${w.band} · Ch ${w.channel}` : '--', ''],
            ['Radio Standard', w.radioType || '--', ''],
            ['Link Rates (RX/TX)', w.connected ? `${w.rxRateMbps} / ${w.txRateMbps}` : '--', ''],
            ['Security / Cipher', w.connected ? `${w.authentication} (${w.cipher})` : '--', ''],
            ['AP BSSID', w.bssid || '--', ''],
            ['Interface', w.interfaceName || 'N/A', '']
        ];
        wifiBox.innerHTML = items.map(([k, v, cls]) =>
            `<div class="net-wifi-stat"><span>${k}</span><strong class="${cls}" title="${EscapeHtmlTp(v)}">${EscapeHtmlTp(v)}</strong></div>`
        ).join('') + (w.note ? `<div class="driver-text-node" style="grid-column:1/-1; color:#ecc94b;">⚠️ ${EscapeHtmlTp(w.note)}</div>` : '');
    }

    const routes = Array.isArray(data.routes) ? data.routes : [];
    SetDomText('lblNetRoutesCount', `${routes.length} routes`);
    const routesBox = document.getElementById('netRoutesContainer');
    if (routesBox) {
        if (!routes.length) {
            routesBox.innerHTML = '<div class="driver-text-node" style="padding:8px;">No IPv4 routes returned.</div>';
        } else {
            routesBox.innerHTML = `<table class="tp-data-table">
                <thead><tr><th>Destination</th><th>Next Hop</th><th>Interface</th><th style="text-align:right">Metric</th></tr></thead>
                <tbody>${routes.map(r => `<tr>
                    <td class="tp-cell-primary">${EscapeHtmlTp(r.destination)}</td>
                    <td style="color:#90cdf4;">${EscapeHtmlTp(r.nextHop)}</td>
                    <td style="color:#a0aec0;">${EscapeHtmlTp(r.interface)}</td>
                    <td class="tp-cell-num">${r.totalMetric}</td>
                </tr>`).join('')}</tbody>
            </table>`;
        }
    }

    const arp = Array.isArray(data.arp) ? data.arp : [];
    SetDomText('lblNetArpCount', `${arp.length} entries`);
    const arpBox = document.getElementById('netArpContainer');
    if (arpBox) {
        if (!arp.length) {
            arpBox.innerHTML = '<div class="driver-text-node" style="padding:8px;">No active ARP neighbors found.</div>';
        } else {
            arpBox.innerHTML = `<table class="tp-data-table">
                <thead><tr><th>IPv4</th><th>MAC Address</th><th>State</th><th>Interface</th></tr></thead>
                <tbody>${arp.map(a => `<tr>
                    <td class="tp-cell-primary">${EscapeHtmlTp(a.ip)}</td>
                    <td style="color:#90cdf4; user-select:text;">${EscapeHtmlTp(a.mac)}</td>
                    <td><span class="sharing-badge ${a.state === 'Reachable' ? 'badge-success' : 'badge-neutral'}">${EscapeHtmlTp(a.state)}</span></td>
                    <td style="color:#a0aec0;">${EscapeHtmlTp(a.interface)}</td>
                </tr>`).join('')}</tbody>
            </table>`;
        }
    }

    if (status) {
        status.classList.remove('sharing-error');
        status.textContent = `Loaded Wi-Fi radio telemetry, ${routes.length} IPv4 routes, and ${arp.length} ARP neighbors.`;
    }
}

function HandleNetDiagError(data) {
    const errMsg = data?.error || 'Network diagnostic command failed.';
    const status = document.getElementById('netManagerStatus');
    if (status) {
        status.classList.add('sharing-error');
        status.textContent = errMsg;
    }
    SetDomText('lblNetDiagResultMeta', 'Error');
    const area = document.getElementById('netDiagVisualArea');
    if (area) area.innerHTML = `<div class="sharing-status sharing-error">${EscapeHtmlTp(errMsg)}</div>`;
    AppendConsoleLogEntry(`[NET DIAG ERROR] ${errMsg}`);
}

// =========================================================================
// VIEW 11: SECURITY POSTURE, WINDOWS REPAIR TOOLKIT & SUPPORT BUNDLE
// =========================================================================
window._secRepairLoaded = false;
window._secRepairData = null;

function SetSecStatus(msg, isError = false) {
    const el = document.getElementById('secStatus');
    if (!el) return;
    el.classList.toggle('sharing-error', !!isError);
    el.textContent = msg;
}

window.RequestSecurityRepair = function() {
    SetSecStatus('Auditing BitLocker, TPM 2.0, HVCI, RDP, Local Admins, Scheduled Tasks & Battery...');
    window.chrome?.webview?.postMessage('Request-SecurityRepair');
};

window._secEnvHostsLoaded = false;

window.SetSecuritySubView = function(key) {
    document.querySelectorAll('#secSubViewPills .filter-pill').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.secview === key);
    });
    const p1 = document.getElementById('secSubPosture');
    const p2 = document.getElementById('secSubEnvHosts');
    const p3 = document.getElementById('secSubRepair');
    if (p1) p1.style.display = (key === 'posture') ? 'flex' : 'none';
    if (p2) p2.style.display = (key === 'envhosts') ? 'flex' : 'none';
    if (p3) p3.style.display = (key === 'repair') ? 'flex' : 'none';

    if ((key === 'envhosts' || key === 'repair') && !window._secEnvHostsLoaded) {
        RequestSecEnvHostsProxy();
    }
};

window.RequestSecEnvHostsProxy = function() {
    SetSecStatus('Inspecting Hosts file, WinINET/WinHTTP Proxy, PATH entries, Recent KBs, and Temp bloat...');
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'SEC_LOAD_ENV_HOSTS_PROXY' }));
};

function RenderTempBloatWidget(tempBloat) {
    const box = document.getElementById('secTempBloatContainer');
    if (!box || !tempBloat) return;
    const items = Array.isArray(tempBloat.items) ? tempBloat.items : [];
    if (!items.length) {
        box.innerHTML = '<div class="driver-text-node">No temp bloat data returned.</div>';
        return;
    }
    box.innerHTML = `<table class="tp-data-table">
        <thead><tr><th>Location</th><th style="text-align:right">Size</th></tr></thead>
        <tbody>${items.map(i => `<tr>
            <td><span class="tp-cell-primary">${EscapeHtmlTp(i.label)}</span><span class="tp-cell-sub">${EscapeHtmlTp(i.path)}</span></td>
            <td class="tp-cell-num ${i.bytes >= 536870912 ? 'warn-val' : ''}">${EscapeHtmlTp(i.sizeText)}</td>
        </tr>`).join('')}</tbody>
    </table><div class="wsl-hint-line" style="margin-top:5px;">Total Scanned Footprint: <strong style="color:#90cdf4;">${EscapeHtmlTp(tempBloat.totalText)}</strong> · Clean Temp safely removes unlocked files in %TEMP% &amp; Windows\\Temp.</div>`;
}

function RenderSecEnvHostsProxyState(data) {
    window._secEnvHostsLoaded = true;
    if (!data) return;

    // 1. Proxy card & click-toggle pill
    const px = data.proxy || {};
    const pxCtrl = document.getElementById('lblSecProxyControl');
    if (pxCtrl) {
        pxCtrl.innerHTML = px.enabled
            ? `<button type="button" class="toggle-pill-btn state-warn" onclick="TriggerSecProxyToggle('Off')" title="User System Proxy is Enabled — Click to Disable">Proxy: ON</button>`
            : `<button type="button" class="toggle-pill-btn state-off" onclick="TriggerSecProxyToggle('On')" title="User System Proxy is Disabled — Click to Enable">Proxy: OFF</button>`;
    }
    const pxBox = document.getElementById('secProxySummary');
    if (pxBox) {
        pxBox.innerHTML = [
            ['WinINET Proxy State', px.enabled ? 'Enabled' : 'Disabled', px.enabled ? 'sig-warn' : 'sig-good'],
            ['WinINET Proxy Server', px.server || 'None', ''],
            ['Auto-Config (PAC URL)', px.pacUrl || 'None', ''],
            ['WinHTTP System Proxy', px.winHttp || 'Direct access', '']
        ].map(([k, v, cls]) => `<div class="net-wifi-stat"><span>${k}</span><strong class="${cls}" title="${EscapeHtmlTp(v)}">${EscapeHtmlTp(v)}</strong></div>`).join('');
    }

    // 2. Hosts file entries
    const hosts = Array.isArray(data.hosts) ? data.hosts : [];
    const hostsBox = document.getElementById('secHostsContainer');
    if (hostsBox) {
        if (!hosts.length) {
            hostsBox.innerHTML = '<div class="driver-text-node" style="padding:8px;">No active custom overrides in hosts file (clean default).</div>';
        } else {
            hostsBox.innerHTML = `<table class="tp-data-table">
                <thead><tr><th style="text-align:right">Line</th><th>IP Address</th><th>Hostname(s)</th></tr></thead>
                <tbody>${hosts.map(h => `<tr>
                    <td class="tp-cell-num">${h.line}</td>
                    <td class="tp-cell-primary" style="color:#90cdf4;">${EscapeHtmlTp(h.ip)}</td>
                    <td style="user-select:text;">${EscapeHtmlTp(h.host)}</td>
                </tr>`).join('')}</tbody>
            </table>`;
        }
    }

    // 3. Recent KBs / Hotfixes
    const kbs = Array.isArray(data.hotfixes) ? data.hotfixes : [];
    SetDomText('lblSecKbCount', `${kbs.length} KBs`);
    const kbBox = document.getElementById('secHotfixContainer');
    if (kbBox) {
        if (!kbs.length) {
            kbBox.innerHTML = '<div class="driver-text-node" style="padding:8px;">No hotfix records returned.</div>';
        } else {
            kbBox.innerHTML = `<table class="tp-data-table">
                <thead><tr><th>KB ID</th><th>Type</th><th>Installed</th></tr></thead>
                <tbody>${kbs.map(k => `<tr>
                    <td class="tp-cell-primary" style="color:#90cdf4;">${EscapeHtmlTp(k.kb)}</td>
                    <td style="color:#a0aec0;">${EscapeHtmlTp(k.description)}</td>
                    <td class="tp-cell-num">${EscapeHtmlTp(k.installedOn)}</td>
                </tr>`).join('')}</tbody>
            </table>`;
        }
    }

    // 4. PATH Environment Audit
    const pa = data.pathAudit || {};
    const paItems = Array.isArray(pa.items) ? pa.items : [];
    SetDomText('lblSecPathSummary', `${pa.total ?? 0} entries · ${pa.missing ?? 0} missing · ${pa.dups ?? 0} duplicates`);
    const pathBox = document.getElementById('secPathContainer');
    if (pathBox) {
        if (!paItems.length) {
            pathBox.innerHTML = '<div class="driver-text-node" style="padding:8px;">No PATH entries found.</div>';
        } else {
            pathBox.innerHTML = `<table class="tp-data-table">
                <thead><tr><th>Scope</th><th>Directory Entry</th><th>Status</th></tr></thead>
                <tbody>${paItems.map(item => {
                    const statusBadge = !item.exists
                        ? '<span class="sharing-badge badge-danger">Missing</span>'
                        : (item.isDup ? '<span class="sharing-badge badge-purple">Duplicate</span>' : '<span class="sharing-badge badge-success">OK</span>');
                    return `<tr class="${!item.exists ? 'tp-row-fault' : ''}">
                        <td><span class="sharing-badge badge-neutral">${EscapeHtmlTp(item.scope)}</span></td>
                        <td style="user-select:text; word-break:break-all;">${EscapeHtmlTp(item.entry)}</td>
                        <td>${statusBadge}</td>
                    </tr>`;
                }).join('')}</tbody>
            </table>`;
        }
    }

    // 5. Temp Bloat widget
    if (data.tempBloat) RenderTempBloatWidget(data.tempBloat);

    const msg = data.actionMessage || `Audited ${hosts.length} hosts override(s), ${kbs.length} recent KB(s), ${pa.missing ?? 0} dead PATH folder(s), and ${data.tempBloat?.totalText || '0 MB'} temp bloat.`;
    SetSecStatus(msg, false);
    if (data.actionMessage) AppendConsoleLogEntry(`[ENV/PROXY] ${data.actionMessage}`);
}

window.TriggerSecProxyToggle = function(targetState) {
    SetSecStatus(`Setting Windows User System Proxy -> ${targetState}...`);
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'SEC_TOGGLE_PROXY', targetState }));
};

window.TriggerSecOpenHostsFile = function() {
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'SEC_OPEN_HOSTS_FILE' }));
};

function RenderSecurityRepairState(data) {
    window._secRepairLoaded = true;
    window._secRepairData = data;
    if (!data) return;

    const p = data.posture || {};
    const bl = Array.isArray(data.bitlocker) ? data.bitlocker : [];
    const admins = Array.isArray(data.localAdmins) ? data.localAdmins : [];
    const tasks = Array.isArray(data.tasks) ? data.tasks : [];

    SetDomText('lblSecSecureBoot', p.secureBoot || '--');
    SetDomText('lblSecTpm', p.tpmPresent ? `${p.tpmVersion}${p.tpmReady ? ' (Ready)' : ''}` : (p.tpmVersion || 'Not Present'));
    SetDomText('lblSecHvci', p.hvciStatus || 'Off');
    SetDomText('lblSecRdpPort', p.rdpPort || 3389);
    SetDomText('lblSecAdminCount', admins.length);
    SetDomText('lblSecTaskCount', tasks.length);

    const rdpWrap = document.getElementById('lblSecRdpControl');
    if (rdpWrap) {
        if (p.rdpEnabled) {
            rdpWrap.innerHTML = `<button type="button" class="toggle-pill-btn state-warn" onclick="TriggerSecRdpToggle('Off')" title="RDP is Enabled on port ${p.rdpPort || 3389} (NLA: ${p.rdpNla ? 'On' : 'Off'}) — Click to Disable">On</button>`;
        } else {
            rdpWrap.innerHTML = `<button type="button" class="toggle-pill-btn state-off" onclick="TriggerSecRdpToggle('On')" title="RDP is Disabled — Click to Enable">Off</button>`;
        }
    }

    // BitLocker Volumes
    const blBox = document.getElementById('secBitlockerContainer');
    if (blBox) {
        if (!bl.length) {
            blBox.innerHTML = `<div class="driver-text-node">${EscapeHtmlTp(p.blAccessNote || 'No BitLocker volumes returned.')}</div>`;
        } else {
            blBox.innerHTML = `<table class="tp-data-table">
                <thead><tr><th>Drive</th><th>Protection</th><th>Encrypted</th><th>Method</th></tr></thead>
                <tbody>${bl.map(v => `<tr>
                    <td class="tp-cell-primary">${EscapeHtmlTp(v.mountPoint)}</td>
                    <td><span class="sharing-badge ${v.protectionStatus === 'On' ? 'badge-success' : 'badge-danger'}">${EscapeHtmlTp(v.protectionStatus)}</span></td>
                    <td class="tp-cell-num">${v.encryptionPct}%</td>
                    <td style="color:#a0aec0;">${EscapeHtmlTp(v.method)}</td>
                </tr>`).join('')}</tbody>
            </table>`;
        }
    }

    // Local Admins
    const admBox = document.getElementById('secLocalAdminsContainer');
    if (admBox) {
        if (!admins.length) {
            admBox.innerHTML = '<div class="driver-text-node">Unable to enumerate Local Administrators group.</div>';
        } else {
            admBox.innerHTML = `<table class="tp-data-table">
                <thead><tr><th>Account</th><th>Type</th><th>Source</th></tr></thead>
                <tbody>${admins.map(a => `<tr>
                    <td class="tp-cell-primary">${EscapeHtmlTp(a.name)}</td>
                    <td style="color:#a0aec0;">${EscapeHtmlTp(a.class)}</td>
                    <td><span class="sharing-badge badge-info">${EscapeHtmlTp(a.source)}</span></td>
                </tr>`).join('')}</tbody>
            </table>`;
        }
    }

    // Battery Summary
    const batBox = document.getElementById('secBatterySummary');
    if (batBox && data.battery) {
        const b = data.battery;
        if (!b.present) {
            batBox.innerHTML = '<div class="net-wifi-stat"><span>Power Source</span><strong>AC Desktop / No Battery Detected</strong></div>';
        } else {
            const hCls = b.healthPct !== null ? (b.healthPct >= 80 ? 'sig-good' : (b.healthPct >= 60 ? 'sig-warn' : 'sig-bad')) : '';
            batBox.innerHTML = [
                ['Status', `${b.status}${b.chargePct !== null ? ` (${b.chargePct}%)` : ''}`, ''],
                ['Battery Health', b.healthPct !== null ? `${b.healthPct}% (Wear: ${b.wearPct}%)` : 'N/A', hCls],
                ['Full / Design', (b.fullChargeMWh && b.designMWh) ? `${b.fullChargeMWh} / ${b.designMWh} mWh` : 'N/A', ''],
                ['Cycle Count', b.cycleCount !== null ? String(b.cycleCount) : 'N/A', '']
            ].map(([k, v, cls]) => `<div class="net-wifi-stat"><span>${k}</span><strong class="${cls}">${EscapeHtmlTp(v)}</strong></div>`).join('');
        }
    }

    RenderSecScheduledTasks();
    const msg = data.actionMessage || `Security audit complete (${data.timestamp || '--'}): ${bl.length} BitLocker volume(s), ${admins.length} local admin(s), ${tasks.length} 3rd-party task(s).`;
    SetSecStatus(msg, false);
    if (data.actionMessage) AppendConsoleLogEntry(`[SECURITY] ${data.actionMessage}`);
}

window.RenderSecScheduledTasks = function() {
    const box = document.getElementById('secTasksContainer');
    const data = window._secRepairData;
    if (!box || !data) return;

    const q = (document.getElementById('secTaskSearchInput')?.value || '').trim().toLowerCase();
    let list = Array.isArray(data.tasks) ? [...data.tasks] : [];
    if (q) {
        list = list.filter(t =>
            String(t.name).toLowerCase().includes(q) ||
            String(t.path).toLowerCase().includes(q) ||
            String(t.author).toLowerCase().includes(q) ||
            String(t.action).toLowerCase().includes(q)
        );
    }

    if (!list.length) {
        box.innerHTML = '<div class="driver-text-node" style="padding:8px;">No non-Microsoft scheduled tasks match your filter.</div>';
        return;
    }

    box.innerHTML = `<table class="tp-data-table">
        <thead><tr><th>Task / Action</th><th>State</th><th>Author</th><th>Control</th></tr></thead>
        <tbody>${list.map(t => {
            const safeName = String(t.name || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            const safePath = String(t.path || '\\').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            const isDis = t.state === 'Disabled';
            const badgeCls = t.state === 'Running' ? 'badge-success' : (isDis ? 'badge-neutral' : 'badge-info');
            const toggleBtn = isDis
                ? `<button type="button" onclick="TriggerSecTaskToggle('${safePath}', '${safeName}', 'Enable')">Enable</button>`
                : `<button type="button" class="wsl-btn-danger" onclick="TriggerSecTaskToggle('${safePath}', '${safeName}', 'Disable')">Disable</button>`;
            return `<tr>
                <td><span class="tp-cell-primary">${EscapeHtmlTp(t.name)}</span><span class="tp-cell-sub" title="${EscapeHtmlTp(t.action || t.path)}">${EscapeHtmlTp(t.action || t.path)}</span></td>
                <td><span class="sharing-badge ${badgeCls}">${EscapeHtmlTp(t.state)}</span></td>
                <td style="color:#a0aec0;">${EscapeHtmlTp(t.author)}</td>
                <td><div class="tp-row-actions">${toggleBtn}</div></td>
            </tr>`;
        }).join('')}</tbody>
    </table>`;
};

window.TriggerSecRdpToggle = function(targetState) {
    if (!confirm(`${targetState === 'On' ? 'Enable' : 'Disable'} Windows Remote Desktop (RDP) and update Remote Desktop firewall rules?`)) return;
    SetSecStatus(`Setting Remote Desktop (RDP) -> ${targetState}...`);
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'SEC_TOGGLE_RDP', targetState }));
};

window.TriggerSecTaskToggle = function(taskPath, taskName, targetState) {
    SetSecStatus(`${targetState === 'Enable' ? 'Enabling' : 'Disabling'} scheduled task '${taskName}'...`);
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'SEC_TOGGLE_TASK', taskPath, taskName, targetState }));
};

window.RunRepairTool = function(command, label, needsConfirm = false) {
    if (needsConfirm && !confirm(`Run "${label}"?\nThis action modifies system repair/cache components or launches an elevated repair terminal.`)) return;
    SetSecuritySubView('repair');
    SetDomText('lblRepairOutputTitle', `📟 ${label}`);
    SetDomText('lblRepairOutputMeta', 'Running...');
    const out = document.getElementById('repairToolOutput');
    if (out) out.textContent = `Executing ${label}...`;
    SetSecStatus(`Running ${label}...`);
    window.chrome?.webview?.postMessage(JSON.stringify({ command }));
};

function RenderRepairToolOutput(data) {
    SetDomText('lblRepairOutputTitle', `📟 ${data.tool || 'Repair Toolkit'}`);
    SetDomText('lblRepairOutputMeta', `Exit ${data.exitCode ?? 0}${data.elapsedMs ? ` · ${data.elapsedMs} ms` : ''}`);
    const out = document.getElementById('repairToolOutput');
    if (out) out.textContent = data.output || '(Completed with no output)';
    if (data.tempBloat) RenderTempBloatWidget(data.tempBloat);
    SetSecStatus(`${data.tool || 'Repair action'} completed.`, !data.ok);
    AppendConsoleLogEntry(`[REPAIR] ${data.tool}: Exit ${data.exitCode ?? 0}`);
}

window.TriggerExportSupportBundle = function() {
    window.chrome?.webview?.postMessage('Browse-SupportBundleZip');
};

function ExecuteSupportBundleExport(targetPath) {
    SetSecStatus(`Packaging IT Support Bundle ZIP to ${targetPath}...`);
    AppendConsoleLogEntry(`[SUPPORT BUNDLE] Exporting snapshot to ${targetPath}...`);
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'EXPORT_SUPPORT_BUNDLE', targetPath }));
}

function HandleSecurityRepairNotice(data) {
    const msg = data.error || data.message || '';
    SetSecStatus(msg, !!data.error || data.ok === false);
    if (data.message) AppendConsoleLogEntry(`[SECURITY/REPAIR] ${data.message}`);
    if (data.error) AppendConsoleLogEntry(`[SECURITY/REPAIR ERROR] ${data.error}`);
}

// =========================================================================
// CTRL+K QUICK COMMAND PALETTE CONTROLLER
// =========================================================================
window._cmdPaletteSelectedIdx = 0;
window._cmdPaletteFiltered = [];

const COREWATCH_PALETTE_ITEMS = [
    { label: '📟 Dashboard — System Overview', cat: 'Tab', run: () => SwitchAppLayoutView('dashboard') },
    { label: '📡 Network — Adapters, Diagnostics & Routing', cat: 'Tab', run: () => SwitchAppLayoutView('netmanager') },
    { label: '🧪 Network — Active Diagnostics (Ping / Trace / Ports / DNS)', cat: 'Tool', run: () => { SwitchAppLayoutView('netmanager'); SetNetworkSubView('diagnostics'); } },
    { label: '📶 Network — Wi-Fi RSSI, Routing Table & ARP', cat: 'Tool', run: () => { SwitchAppLayoutView('netmanager'); SetNetworkSubView('wifiroutes'); } },
    { label: '🧭 Tasks & Ports — Live Processes, Services & Sockets', cat: 'Tab', run: () => SwitchAppLayoutView('tasksports') },
    { label: '🔌 Open Listening Ports & Sockets', cat: 'Tool', run: () => { SwitchAppLayoutView('tasksports'); SetTasksPortsSubView('sockets'); } },
    { label: '🛠️ Windows Services (Stopped Auto Fault Check)', cat: 'Tool', run: () => { SwitchAppLayoutView('tasksports'); SetTasksPortsSubView('services'); SetTpServiceFilter('faulty'); } },
    { label: '🩺 UltimaDiagX — Event Logs & BSOD Translator', cat: 'Tab', run: () => SwitchAppLayoutView('diagx') },
    { label: '🐧 WSL — Windows Subsystem for Linux Manager', cat: 'Tab', run: () => SwitchAppLayoutView('wsl') },
    { label: '🛡️ Security & Compliance Posture (BitLocker, TPM, RDP)', cat: 'Tab', run: () => { SwitchAppLayoutView('security'); SetSecuritySubView('posture'); } },
    { label: '🧬 Env, Hosts File, System Proxy & Recent KBs Audit', cat: 'Tool', run: () => { SwitchAppLayoutView('security'); SetSecuritySubView('envhosts'); } },
    { label: '🧰 Windows Repair Toolkit (DISM, SFC, WU/Winsock, Temp Clean)', cat: 'Tool', run: () => { SwitchAppLayoutView('security'); SetSecuritySubView('repair'); } },
    { label: '🧹 Clean Safe Temp Files (%TEMP% & Windows\\Temp)', cat: 'Action', run: () => { SwitchAppLayoutView('security'); SetSecuritySubView('repair'); RunRepairTool('REPAIR_CLEAN_TEMP', 'Safe Temp Cleanup', true); } },
    { label: '📦 Export 1-Click IT Support Bundle (.zip)', cat: 'Action', run: () => TriggerExportSupportBundle() },
    { label: '🚀 Startup Apps Manager', cat: 'Tab', run: () => SwitchAppLayoutView('startup') },
    { label: '📂 SMB Sharing Center', cat: 'Tab', run: () => SwitchAppLayoutView('sharing') },
    { label: '📦 Installed Applications Manager', cat: 'Tab', run: () => SwitchAppLayoutView('apps') },
    { label: '⬇️ App Downloader & Package Installer (Steam, VS Code, Python, Rust, C++)', cat: 'Tab', run: () => SwitchAppLayoutView('appstore') },
    { label: '🗺️ Disk Map — Visual Storage Explorer & Treemap (WizTree-style)', cat: 'Tab', run: () => SwitchAppLayoutView('diskmap') },
    { label: '🧩 System Devices & Drivers Tree (with Official Driver Links)', cat: 'Tab', run: () => SwitchAppLayoutView('devices') },
    { label: '🗂️ File Organizer', cat: 'Tab', run: () => SwitchAppLayoutView('organizer') },
    { label: '🌐 Flush DNS Cache & Probe Resolution', cat: 'Action', run: () => TriggerFlushAndTestDns() },
    { label: '🚀 Run Speed / Jitter / Packet Loss Test', cat: 'Action', run: () => { SwitchAppLayoutView('dashboard'); TriggerNetworkSpeedAnalysis(); } }
];

window.OpenCommandPalette = function() {
    const ov = document.getElementById('cmdPaletteOverlay');
    const inp = document.getElementById('cmdPaletteInput');
    if (!ov || !inp) return;
    ov.style.display = 'flex';
    inp.value = '';
    window._cmdPaletteSelectedIdx = 0;
    RenderCommandPaletteItems();
    setTimeout(() => inp.focus(), 10);
};

window.CloseCommandPalette = function() {
    const ov = document.getElementById('cmdPaletteOverlay');
    if (ov) ov.style.display = 'none';
};

window.RenderCommandPaletteItems = function() {
    const listEl = document.getElementById('cmdPaletteList');
    const q = (document.getElementById('cmdPaletteInput')?.value || '').trim().toLowerCase();
    if (!listEl) return;

    const matches = COREWATCH_PALETTE_ITEMS.filter(item =>
        !q || item.label.toLowerCase().includes(q) || item.cat.toLowerCase().includes(q)
    );
    window._cmdPaletteFiltered = matches;
    if (window._cmdPaletteSelectedIdx >= matches.length) window._cmdPaletteSelectedIdx = 0;

    if (!matches.length) {
        listEl.innerHTML = '<div class="driver-text-node" style="padding:8px;">No matching tabs or actions.</div>';
        return;
    }

    listEl.innerHTML = matches.map((item, idx) =>
        `<button type="button" class="cmdk-item ${idx === window._cmdPaletteSelectedIdx ? 'selected' : ''}" onclick="ExecuteCommandPaletteIndex(${idx})">
            <span>${EscapeHtmlTp(item.label)}</span>
            <span class="cmdk-item-cat">${item.cat}</span>
        </button>`
    ).join('');
};

window.ExecuteCommandPaletteIndex = function(idx) {
    const item = window._cmdPaletteFiltered[idx];
    CloseCommandPalette();
    if (item && typeof item.run === 'function') item.run();
};

document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        const ov = document.getElementById('cmdPaletteOverlay');
        if (ov && ov.style.display !== 'none') CloseCommandPalette();
        else OpenCommandPalette();
        return;
    }
    const ov = document.getElementById('cmdPaletteOverlay');
    if (!ov || ov.style.display === 'none') return;

    if (e.key === 'Escape') {
        e.preventDefault();
        CloseCommandPalette();
    } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (window._cmdPaletteFiltered.length) {
            window._cmdPaletteSelectedIdx = (window._cmdPaletteSelectedIdx + 1) % window._cmdPaletteFiltered.length;
            RenderCommandPaletteItems();
        }
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (window._cmdPaletteFiltered.length) {
            window._cmdPaletteSelectedIdx = (window._cmdPaletteSelectedIdx - 1 + window._cmdPaletteFiltered.length) % window._cmdPaletteFiltered.length;
            RenderCommandPaletteItems();
        }
    } else if (e.key === 'Enter') {
        e.preventDefault();
        ExecuteCommandPaletteIndex(window._cmdPaletteSelectedIdx);
    }
});

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('diagXTranslateForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const code = document.getElementById('diagXCodeInput')?.value || '';
        TriggerCodeTranslation(code);
    });
});

// =========================================================================
// VIEW 12: APP DOWNLOADER & PACKAGE INSTALLER CONTROLLER
// =========================================================================
window._appStoreLoaded = false;
window._appStoreApps = [];
window._appStoreCategory = 'all';
window._appStoreSelectedIds = new Set();
window._appStoreWingetAvailable = true;

window.RequestAppInstaller = function() {
    const st = document.getElementById('appStoreStatus');
    if (st) {
        st.classList.remove('sharing-error');
        st.textContent = 'Scanning installed packages and syncing CoreWatch App Catalog...';
    }
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'APPSTORE_LOAD' }));
};

function RenderAppInstallerData(data) {
    window._appStoreLoaded = true;
    window._appStoreWingetAvailable = !!data.wingetAvailable;
    const apps = Array.isArray(data.apps) ? data.apps : (data.apps ? [data.apps] : []);
    window._appStoreApps = apps;

    const sum = data.summary || {};
    SetDomText('sumStoreTotal',     sum.total ?? apps.length);
    SetDomText('sumStoreInstalled', sum.installed ?? apps.filter(a => a.installed).length);
    SetDomText('sumStoreOutdated',  sum.outdated ?? apps.filter(a => a.versionTier === 'update' || a.versionTier === 'critical').length);
    SetDomText('sumStoreAvailable', sum.available ?? apps.filter(a => !a.installed).length);
    SetDomText('lblStoreWingetVer', data.wingetAvailable ? (data.wingetVersion || 'Ready') : 'Not Installed');

    const st = document.getElementById('appStoreStatus');
    if (st) {
        st.classList.toggle('sharing-error', !!data.error);
        if (data.error) {
            st.textContent = data.error;
        } else if (!data.wingetAvailable) {
            st.textContent = 'WinGet was not detected — you can still open Official Download pages for any app below.';
        } else {
            st.textContent = `${apps.length} curated apps ready (${sum.installed ?? 0} detected installed). Check multiple apps to batch-install or click Install on any card.`;
        }
    }

    UpdateAppStoreBatchButton();
    ApplyAppInstallerFilter();
}

window.SetAppStoreCategory = function(catKey) {
    window._appStoreCategory = catKey;
    document.querySelectorAll('#appStoreCategoryPills .filter-pill').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.cat === catKey);
    });
    ApplyAppInstallerFilter();
};

function UpdateAppStoreBatchButton() {
    const count = window._appStoreSelectedIds.size;
    SetDomText('sumStoreSelected', count);
    const btn = document.getElementById('btnAppStoreBatchInstall');
    if (btn) {
        btn.textContent = `⬇️ Install Selected (${count})`;
        btn.disabled = (count === 0);
    }
}

window.ToggleAppStoreSelect = function(pkgId, checked) {
    if (checked) window._appStoreSelectedIds.add(pkgId);
    else window._appStoreSelectedIds.delete(pkgId);
    UpdateAppStoreBatchButton();
    ApplyAppInstallerFilter();
};

window.SelectEssentialAppsPack = function() {
    window._appStoreApps.forEach(a => {
        if (a.essential && !a.installed) {
            window._appStoreSelectedIds.add(a.id);
        }
    });
    UpdateAppStoreBatchButton();
    ApplyAppInstallerFilter();
    const st = document.getElementById('appStoreStatus');
    if (st) st.textContent = `Selected ${window._appStoreSelectedIds.size} missing essential runtime(s) & tool(s). Click 'Install Selected' to deploy.`;
};

window.ClearAppStoreSelection = function() {
    window._appStoreSelectedIds.clear();
    UpdateAppStoreBatchButton();
    ApplyAppInstallerFilter();
};

window.ApplyAppInstallerFilter = function() {
    const container = document.getElementById('appStoreContainer');
    if (!container) return;

    const q = (document.getElementById('appStoreSearchInput')?.value || '').trim().toLowerCase();
    const sortBy = document.getElementById('appStoreSortSelect')?.value || 'name_asc';
    const cat = window._appStoreCategory || 'all';

    const list = window._appStoreApps.filter(app => {
        if (cat === 'requested' && !app.requested) return false;
        else if (cat === 'installed' && !app.installed) return false;
        else if (cat === 'not_installed' && app.installed) return false;
        else if (cat !== 'all' && cat !== 'requested' && cat !== 'installed' && cat !== 'not_installed' && app.category !== cat) return false;

        if (q) {
            const hay = `${app.name} ${app.id} ${app.category} ${app.desc}`.toLowerCase();
            if (!hay.includes(q)) return false;
        }
        return true;
    });

    list.sort((a, b) => {
        const cmpName = String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
        if (sortBy === 'name_desc') return -cmpName;
        if (sortBy === 'category') return String(a.category || '').localeCompare(String(b.category || '')) || cmpName;
        if (sortBy === 'requested') return (Number(!!b.requested) - Number(!!a.requested)) || cmpName;
        if (sortBy === 'installed') return (Number(!!b.installed) - Number(!!a.installed)) || cmpName;
        if (sortBy === 'available') return (Number(!!a.installed) - Number(!!b.installed)) || cmpName;
        return cmpName; // Default: Name A-Z
    });

    container.replaceChildren();
    if (!list.length) {
        container.innerHTML = '<div class="driver-text-node" style="padding:10px;">No apps match the current filter. Try the WinGet Search box above to install any Windows package.</div>';
        return;
    }

    const frag = document.createDocumentFragment();
    list.forEach(app => {
        const isSel = window._appStoreSelectedIds.has(app.id);
        const card = document.createElement('article');
        card.className = `appstore-card${isSel ? ' is-selected' : ''}${app.installed ? ' is-installed' : ''}`;

        const head = document.createElement('div');
        head.className = 'appstore-card-head';

        const titleLabel = document.createElement('label');
        titleLabel.className = 'appstore-card-title-wrap';
        const chk = document.createElement('input');
        chk.type = 'checkbox';
        chk.checked = isSel;
        chk.addEventListener('change', () => ToggleAppStoreSelect(app.id, chk.checked));
        const titleSpan = document.createElement('span');
        titleSpan.className = 'appstore-card-title';
        titleSpan.textContent = app.name;
        titleSpan.title = app.name;
        titleLabel.append(chk, titleSpan);

        const badges = document.createElement('div');
        badges.className = 'card-badge-group';
        if (app.installed) {
            const tier = app.versionTier || 'uptodate';
            const verTxt = app.version && app.version !== 'Detected' ? app.version : 'Installed';
            if (tier === 'critical') {
                const tip = `Severely outdated (${verTxt} -> ${app.availableVersion || 'newer'}, >5 updates behind)`;
                badges.innerHTML += `<span class="sharing-badge ver-critical" title="${EscapeHtmlTp(tip)}">⚠ Outdated ${EscapeHtmlTp(app.availableVersion || '')}</span>`;
            } else if (tier === 'update') {
                const tip = `Update available: ${verTxt} -> ${app.availableVersion || 'newer'}`;
                badges.innerHTML += `<span class="sharing-badge ver-update" title="${EscapeHtmlTp(tip)}">⬆ ${EscapeHtmlTp(app.availableVersion || 'Update')}</span>`;
            } else {
                badges.innerHTML += `<span class="sharing-badge ver-uptodate" title="Up to date (${EscapeHtmlTp(verTxt)})">✓ Up to Date</span>`;
            }
        } else {
            badges.innerHTML += '<span class="sharing-badge badge-info">Available</span>';
        }
        if (app.requested) {
            badges.innerHTML += '<span class="sharing-badge badge-purple" title="Core Requested App">★</span>';
        }
        head.append(titleLabel, badges);
        card.appendChild(head);

        const desc = document.createElement('div');
        desc.className = 'appstore-card-desc';
        desc.textContent = app.desc;
        card.appendChild(desc);

        const meta = document.createElement('div');
        meta.className = 'appstore-card-meta';
        meta.innerHTML = `<span class="appstore-card-id" title="Package ID: ${EscapeHtmlTp(app.id)}">${EscapeHtmlTp(app.id)}</span><span>${EscapeHtmlTp(app.category)}</span>`;
        card.appendChild(meta);

        const actions = document.createElement('div');
        actions.className = 'appstore-card-actions';

        const mainBtn = document.createElement('button');
        mainBtn.type = 'button';
        if (app.installed && app.customType !== 'pawnio') {
            mainBtn.className = 'btn-store-upgrade';
            mainBtn.textContent = '⬆️ Upgrade';
            mainBtn.title = `Upgrade ${app.name} via WinGet`;
            mainBtn.addEventListener('click', () => TriggerInstallOneApp(app.id, app.name, 'upgrade'));
        } else {
            mainBtn.className = 'btn-store-install';
            mainBtn.textContent = app.installed ? '↻ Reinstall' : '⬇️ Install';
            mainBtn.title = `Download & install ${app.name}`;
            mainBtn.addEventListener('click', () => TriggerInstallOneApp(app.id, app.name, 'install'));
        }
        actions.appendChild(mainBtn);

        if (app.url) {
            const siteBtn = document.createElement('button');
            siteBtn.type = 'button';
            siteBtn.textContent = '🌐 Official Site ↗';
            siteBtn.title = app.url;
            siteBtn.addEventListener('click', () => OpenAppOfficialUrl(app.url, app.name));
            actions.appendChild(siteBtn);
        }

        card.appendChild(actions);
        frag.appendChild(card);
    });

    container.appendChild(frag);
};

window.TriggerInstallOneApp = function(pkgId, appName, mode = 'install') {
    const verb = mode === 'upgrade' ? 'Upgrade' : 'Download & Install';
    if (!confirm(`${verb} [ ${appName} ] (${pkgId})?\n\nAn elevated installer progress window will launch.`)) return;
    const st = document.getElementById('appStoreStatus');
    if (st) {
        st.classList.remove('sharing-error');
        st.textContent = `Launching ${verb.toLowerCase()} terminal for ${appName}...`;
    }
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'APPSTORE_INSTALL_ONE', id: pkgId, mode }));
};

window.TriggerInstallSelectedApps = function() {
    const ids = Array.from(window._appStoreSelectedIds);
    if (!ids.length) return;
    if (!confirm(`Batch-install ${ids.length} selected app(s)?\n\n${ids.join('\n')}\n\nAn elevated installer window will install them sequentially.`)) return;
    const st = document.getElementById('appStoreStatus');
    if (st) {
        st.classList.remove('sharing-error');
        st.textContent = `Launching batch installer for ${ids.length} package(s)...`;
    }
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'APPSTORE_INSTALL_BATCH', ids }));
};

window.TriggerUpgradeAllApps = function() {
    if (!confirm("Launch elevated 'winget upgrade --all' to update all installed WinGet packages?")) return;
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'APPSTORE_UPGRADE_ALL' }));
};

window.OpenAppOfficialUrl = function(url, name) {
    const st = document.getElementById('appStoreStatus');
    if (st) st.textContent = `Opening official download page for ${name}...`;
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'APPSTORE_OPEN_URL', url }));
};

window.TriggerWingetLiveSearch = function(e) {
    if (e) e.preventDefault();
    const q = (document.getElementById('appStoreWingetQuery')?.value || '').trim();
    if (q.length < 2) return;
    const st = document.getElementById('appStoreStatus');
    if (st) {
        st.classList.remove('sharing-error');
        st.textContent = `Searching WinGet repository for '${q}'...`;
    }
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'APPSTORE_SEARCH_WINGET', query: q }));
};

function RenderAppStoreWingetResults(data) {
    const box = document.getElementById('appStoreWingetResults');
    const st = document.getElementById('appStoreStatus');
    if (st && data.message) {
        st.classList.toggle('sharing-error', !data.ok);
        st.textContent = data.message;
    }
    if (!box) return;

    const results = Array.isArray(data.results) ? data.results : [];
    if (!results.length) {
        box.style.display = 'block';
        box.innerHTML = `<div style="display:flex; justify-content:space-between; align-items:center;"><span class="driver-text-node">No WinGet packages found matching '${EscapeHtmlTp(data.query || '')}'.</span><button type="button" class="console-clear-btn" onclick="document.getElementById('appStoreWingetResults').style.display='none'">Close</button></div>`;
        return;
    }

    box.style.display = 'block';
    const rows = results.map(r => {
        const safeId = String(r.id || '').replace(/'/g, "\\'");
        const safeName = String(r.name || '').replace(/'/g, "\\'");
        return `<tr>
            <td class="tp-cell-primary">${EscapeHtmlTp(r.name)}</td>
            <td style="color:#90cdf4; user-select:text;">${EscapeHtmlTp(r.id)}</td>
            <td style="color:#a0aec0;">${EscapeHtmlTp(r.version)}</td>
            <td><div class="tp-row-actions"><button type="button" class="btn-accent-action" onclick="TriggerInstallOneApp('${safeId}', '${safeName}', 'install')">⬇️ Install</button></div></td>
        </tr>`;
    }).join('');

    box.innerHTML = `
        <div class="organizer-section-header" style="margin-bottom:6px;">
            <h3>🔎 Live WinGet Search: "${EscapeHtmlTp(data.query || '')}" (${results.length})</h3>
            <button type="button" class="console-clear-btn" onclick="document.getElementById('appStoreWingetResults').style.display='none'">Close Results</button>
        </div>
        <table class="tp-data-table">
            <thead><tr><th>Package Name</th><th>WinGet ID</th><th>Version</th><th>Action</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>
    `;
}

function HandleAppStoreNotice(data) {
    const st = document.getElementById('appStoreStatus');
    const msg = data.error || data.message || '';
    if (st) {
        st.classList.toggle('sharing-error', !!data.error || data.ok === false);
        st.textContent = msg;
    }
    if (data.message) AppendConsoleLogEntry(`[APP STORE] ${data.message}`);
    if (data.error) AppendConsoleLogEntry(`[APP STORE ERROR] ${data.error}`);
}

// =========================================================================
// VIEW 13: DISK MAP — WIZTREE-STYLE VISUAL STORAGE EXPLORER & TREEMAP
// =========================================================================
window._dmInitialized = false;
window._dmScanning = false;
window._dmDrives = [];
window._dmScanData = null;
window._dmNavStack = [];       // Stack of DiskEntryDto folder nodes for instant zoom/back
window._dmViewMode = 'tree';   // 'tree' | 'files' | 'exts'
window._dmHighlightExt = '';   // Optional exact extension filter/highlight (e.g. '.pak')
window._dmSelectedItem = null; // Currently selected file/folder
window._dmRects = [];          // Hit-testable treemap rectangles rendered on canvas
window._dmHoveredRect = null;
window._dmResizeObs = null;

function FormatDiskBytes(bytes) {
    const n = Number(bytes || 0);
    if (n >= 1099511627776) return `${(n / 1099511627776).toFixed(2)} TB`;
    if (n >= 1073741824) return `${(n / 1073741824).toFixed(2)} GB`;
    if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
    if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${n} B`;
}

// Deterministic, distinct color palette grouped by exact file extension category
function GetDiskExtColor(ext, isDir) {
    if (isDir) return '#2b4c7e';
    const e = String(ext || '').toLowerCase();
    if (['.mp4', '.mkv', '.mov', '.avi', '.webm', '.wmv', '.m4v', '.ts'].includes(e)) return '#e53e3e'; // Video (Crimson)
    if (['.vhdx', '.vhd', '.iso', '.img', '.vmdk', '.vdi', '.wim', '.esd'].includes(e)) return '#dd6b20'; // Virtual Disks / ISOs (Orange)
    if (['.pak', '.vpk', '.cas', '.bsa', '.ba2', '.uasset', '.ucas', '.rpf', '.forge', '.wad'].includes(e)) return '#d69e2e'; // Game Assets (Gold)
    if (['.zip', '.7z', '.rar', '.tar', '.gz', '.xz', '.bz2', '.cab', '.zst'].includes(e)) return '#805ad5'; // Archives (Purple)
    if (['.exe', '.dll', '.msi', '.msix', '.sys', '.so', '.bin', '.ocx'].includes(e)) return '#3182ce'; // Binaries & Libraries (Blue)
    if (['.psd', '.blend', '.fbx', '.obj', '.png', '.jpg', '.jpeg', '.webp', '.tif', '.tiff', '.exr', '.raw', '.cr2'].includes(e)) return '#319795'; // Creative / 3D / Images (Teal)
    if (['.wav', '.flac', '.mp3', '.ogg', '.aac', '.m4a', '.aiff', '.opus'].includes(e)) return '#d53f8c'; // Audio (Magenta)
    if (['.dmp', '.log', '.etl', '.tmp', '.bak', '.old', '.cache'].includes(e)) return '#e53e78'; // Logs / Crash Dumps (Rose)
    if (['.pdb', '.lib', '.obj', '.a', '.rlib', '.jar', '.whl', '.nupkg', '.db', '.sqlite', '.mdf'].includes(e)) return '#38a169'; // Dev / Symbols / Databases (Green)
    // Deterministic HSL fallback for every unique extension so distinct types stay distinguishable
    let hash = 0;
    for (let i = 0; i < e.length; i++) hash = ((hash << 5) - hash) + e.charCodeAt(i);
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue}, 48%, 42%)`;
}

window.OpenDriveInDiskMap = function(drivePath) {
    SwitchAppLayoutView('diskmap');
    const inp = document.getElementById('diskMapTargetPath');
    if (inp) inp.value = drivePath;
    TriggerDiskMapScan(drivePath);
};

function InitDiskMapTab() {
    if (!window._dmInitialized) {
        window._dmInitialized = true;
        SetupDiskMapCanvasEvents();
        RequestDiskMapDrives();
    } else if (window._dmScanData) {
        setTimeout(() => DrawDiskMapTreemap(), 30);
    }
}

window.RequestDiskMapDrives = function() {
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'DISKMAP_LIST_DRIVES' }));
};

function RenderDiskMapDrives(drives) {
    window._dmDrives = Array.isArray(drives) ? drives : [];
    const strip = document.getElementById('diskMapDriveStrip');
    if (!strip) return;
    strip.replaceChildren();

    const activePath = (document.getElementById('diskMapTargetPath')?.value || '').trim().toLowerCase();
    window._dmDrives.forEach(d => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `diskmap-drive-pill${activePath.startsWith(d.path.toLowerCase()) ? ' active' : ''}`;
        const fillColor = d.usedPct >= 90 ? '#f56565' : (d.usedPct >= 75 ? '#ecc94b' : '#4299e1');
        btn.innerHTML = `
            <strong>${EscapeHtmlTp(d.letter)}</strong>
            <span style="color:#a0aec0;">${EscapeHtmlTp(d.label)}</span>
            <span class="diskmap-drive-mini-bar"><span class="diskmap-drive-mini-fill" style="width:${d.usedPct}%; background:${fillColor}; display:block;"></span></span>
            <span style="font-size:10px; color:#cbd5e0;">${d.usedGB}/${d.totalGB} GB</span>
        `;
        btn.title = `Scan ${d.path} (${d.format}) — ${d.freeGB} GB free`;
        btn.addEventListener('click', () => {
            const inp = document.getElementById('diskMapTargetPath');
            if (inp) inp.value = d.path;
            TriggerDiskMapScan(d.path);
        });
        strip.appendChild(btn);
    });
}

window.TriggerDiskMapScanFromInput = function() {
    const target = (document.getElementById('diskMapTargetPath')?.value || 'C:\\').trim();
    if (!target) return;
    TriggerDiskMapScan(target);
};

window.TriggerDiskMapScan = function(targetPath) {
    if (window._dmScanning) return;
    window._dmScanning = true;
    const scanBtn = document.getElementById('btnDiskMapScanNow');
    if (scanBtn) { scanBtn.disabled = true; scanBtn.textContent = 'Scanning...'; }

    const st = document.getElementById('diskMapStatus');
    if (st) {
        st.classList.remove('sharing-error');
        st.textContent = `Scanning ${targetPath} with multithreaded Win32 FastDiskScanner...`;
    }
    AppendConsoleLogEntry(`[DISK MAP] Starting visual scan of ${targetPath}...`);
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'DISKMAP_SCAN', path: targetPath }));
};

function RenderDiskMapScanResult(data) {
    window._dmScanning = false;
    const scanBtn = document.getElementById('btnDiskMapScanNow');
    if (scanBtn) { scanBtn.disabled = false; scanBtn.textContent = '⚡ Scan Now'; }

    if (Array.isArray(data.drives)) RenderDiskMapDrives(data.drives);
    window._dmScanData = data;
    window._dmNavStack = data.tree ? [data.tree] : [];
    window._dmHighlightExt = '';
    window._dmSelectedItem = null;
    UpdateDiskMapSelectedBar();

    const inp = document.getElementById('diskMapTargetPath');
    if (inp && data.rootPath) inp.value = data.rootPath;

    const elapsedSec = Math.max(0.01, (data.elapsedMs || 1) / 1000);
    const filesPerSec = Math.round((data.totalFiles || 0) / elapsedSec);
    const topDir = (data.tree && Array.isArray(data.tree.children))
        ? data.tree.children.find(c => c.isDir)
        : null;
    const topFile = (Array.isArray(data.largestFiles) && data.largestFiles.length) ? data.largestFiles[0] : null;

    SetDomText('sumDmSize',    FormatDiskBytes(data.totalBytes));
    SetDomText('sumDmFiles',   (data.totalFiles || 0).toLocaleString());
    SetDomText('sumDmDirs',    (data.totalDirs || 0).toLocaleString());
    SetDomText('sumDmSpeed',   `${elapsedSec.toFixed(2)}s (${filesPerSec.toLocaleString()}/s)`);
    SetDomText('sumDmTopDir',  topDir ? `${topDir.name} (${FormatDiskBytes(topDir.size)})` : '--');
    SetDomText('sumDmTopFile', topFile ? `${topFile.name} (${FormatDiskBytes(topFile.size)})` : '--');

    const st = document.getElementById('diskMapStatus');
    if (st) {
        st.classList.remove('sharing-error');
        const deniedNote = data.accessDenied > 0 ? ` · ${data.accessDenied} protected system folder(s) skipped` : '';
        st.textContent = `Mapped ${data.rootPath} — ${FormatDiskBytes(data.totalBytes)} across ${(data.totalFiles || 0).toLocaleString()} files in ${elapsedSec.toFixed(2)}s${deniedNote}.`;
    }
    AppendConsoleLogEntry(`[DISK MAP] Mapped ${data.rootPath}: ${FormatDiskBytes(data.totalBytes)} (${(data.totalFiles || 0).toLocaleString()} files in ${elapsedSec.toFixed(2)}s)`);

    RenderDiskMapBreadcrumbs();
    RenderDiskMapCurrentView();
    setTimeout(() => DrawDiskMapTreemap(), 20);
}

window.SetDiskMapViewMode = function(mode) {
    window._dmViewMode = mode;
    document.querySelectorAll('#diskMapModePills .filter-pill').forEach(b => {
        b.classList.toggle('active', b.dataset.dmmode === mode);
    });
    RenderDiskMapCurrentView();
};

function GetDiskMapCurrentNode() {
    if (!window._dmNavStack.length) return null;
    return window._dmNavStack[window._dmNavStack.length - 1];
}

function RenderDiskMapBreadcrumbs() {
    const box = document.getElementById('diskMapBreadcrumbs');
    const upBtn = document.getElementById('btnDmUp');
    const rootBtn = document.getElementById('btnDmRoot');
    if (!box) return;

    const stack = window._dmNavStack;
    if (upBtn) upBtn.disabled = stack.length <= 1;
    if (rootBtn) rootBtn.disabled = stack.length <= 1;

    box.replaceChildren();
    if (!stack.length) {
        box.textContent = 'Select a drive above and click Scan Now';
        return;
    }

    stack.forEach((node, idx) => {
        if (idx > 0) {
            const sep = document.createElement('span');
            sep.textContent = '▸';
            sep.style.color = '#4a5568';
            box.appendChild(sep);
        }
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'diskmap-crumb-btn';
        btn.textContent = `${node.name} (${FormatDiskBytes(node.size)})`;
        btn.addEventListener('click', () => {
            window._dmNavStack = window._dmNavStack.slice(0, idx + 1);
            RenderDiskMapBreadcrumbs();
            RenderDiskMapCurrentView();
            DrawDiskMapTreemap();
        });
        box.appendChild(btn);
    });

    const extBadge = document.getElementById('diskMapExtFilterBadge');
    if (extBadge) {
        if (window._dmHighlightExt) {
            extBadge.style.display = 'inline-flex';
            extBadge.innerHTML = `<button type="button" class="toggle-pill-btn ver-update" onclick="ClearDiskMapExtFilter()" title="Click to clear extension filter">Filter: ${EscapeHtmlTp(window._dmHighlightExt)} ✕</button>`;
        } else {
            extBadge.style.display = 'none';
            extBadge.innerHTML = '';
        }
    }
}

window.ClearDiskMapExtFilter = function() {
    window._dmHighlightExt = '';
    RenderDiskMapBreadcrumbs();
    RenderDiskMapCurrentView();
    DrawDiskMapTreemap();
};

window.DiskMapNavigateUp = function() {
    if (window._dmNavStack.length <= 1) return;
    window._dmNavStack.pop();
    window._dmSelectedItem = null;
    UpdateDiskMapSelectedBar();
    RenderDiskMapBreadcrumbs();
    RenderDiskMapCurrentView();
    DrawDiskMapTreemap();
};

window.DiskMapNavigateRoot = function() {
    if (window._dmNavStack.length <= 1) return;
    window._dmNavStack = [window._dmNavStack[0]];
    window._dmSelectedItem = null;
    UpdateDiskMapSelectedBar();
    RenderDiskMapBreadcrumbs();
    RenderDiskMapCurrentView();
    DrawDiskMapTreemap();
};

window.DiskMapZoomIntoNode = function(node) {
    if (!node || !node.isDir) return;
    if (Array.isArray(node.children) && node.children.length > 0) {
        window._dmNavStack.push(node);
        window._dmSelectedItem = null;
        UpdateDiskMapSelectedBar();
        RenderDiskMapBreadcrumbs();
        RenderDiskMapCurrentView();
        DrawDiskMapTreemap();
    } else if (node.path) {
        // Folder is deeper than cached 4-level tree — run an instant deep sub-scan of that exact subfolder!
        TriggerDiskMapScan(node.path);
    }
};

window.RenderDiskMapCurrentView = function() {
    const pane = document.getElementById('diskMapDataPane');
    const data = window._dmScanData;
    if (!pane || !data) return;

    const q = (document.getElementById('diskMapFilterInput')?.value || '').trim().toLowerCase();
    const extFlt = (window._dmHighlightExt || '').toLowerCase();

    if (window._dmViewMode === 'tree') {
        const cur = GetDiskMapCurrentNode();
        const children = (cur && Array.isArray(cur.children)) ? cur.children : [];
        const parentTotal = Math.max(1, cur ? cur.size : data.totalBytes || 1);

        let list = children.filter(c => {
            if (extFlt && !c.isDir && String(c.ext || '').toLowerCase() !== extFlt) return false;
            if (q) {
                const hay = `${c.name} ${c.path} ${c.ext || ''}`.toLowerCase();
                if (!hay.includes(q)) return false;
            }
            return true;
        });

        if (!list.length) {
            pane.innerHTML = '<div class="driver-text-node" style="padding:10px;">No entries match the current filter in this folder.</div>';
            return;
        }

        const rows = list.map((c, idx) => {
            const pct = Math.min(100, (c.size / parentTotal) * 100);
            const color = GetDiskExtColor(c.ext, c.isDir);
            const icon = c.isDir ? '📁' : '📄';
            const selCls = (window._dmSelectedItem && window._dmSelectedItem.path === c.path) ? ' diskmap-row-selected' : '';
            const safePath = String(c.path || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            const zoomBtn = c.isDir ? `<button type="button" onclick="event.stopPropagation(); DiskMapZoomByIndex(${idx})">Zoom</button>` : '';
            return `<tr class="diskmap-row-clickable${selCls}" onclick="DiskMapSelectFromTree(${idx})" ondblclick="DiskMapDoubleClickTree(${idx})">
                <td><span class="tp-cell-primary">${icon} ${EscapeHtmlTp(c.name)}</span><span class="tp-cell-sub" title="${EscapeHtmlTp(c.path)}">${c.isDir ? `${(c.files || 0).toLocaleString()} files · ${(c.dirs || 0).toLocaleString()} folders` : `${EscapeHtmlTp(c.ext || 'file')}${c.modified ? ' · ' + c.modified : ''}`}</span></td>
                <td class="tp-cell-num" style="font-weight:700; color:#edf2f7;">${FormatDiskBytes(c.size)}</td>
                <td style="white-space:nowrap;"><span class="diskmap-pct-bar"><span class="diskmap-pct-fill" style="width:${pct.toFixed(1)}%; background:${color}; display:block;"></span></span><span style="color:#a0aec0; font-size:10px;">${pct.toFixed(1)}%</span></td>
                <td><div class="tp-row-actions">${zoomBtn}<button type="button" onclick="event.stopPropagation(); DiskMapOpenInExplorer('${safePath}')">Explorer</button><button type="button" class="wsl-btn-danger" onclick="event.stopPropagation(); DiskMapRecyclePath('${safePath}')">Recycle</button></div></td>
            </tr>`;
        }).join('');

        window._dmRenderedTreeList = list;
        pane.innerHTML = `<table class="tp-data-table">
            <thead><tr><th>Name / Details</th><th style="text-align:right">Size</th><th>% of Folder</th><th>Actions</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>`;
        return;
    }

    if (window._dmViewMode === 'files') {
        let list = Array.isArray(data.largestFiles) ? [...data.largestFiles] : [];
        const totalBytes = Math.max(1, data.totalBytes || 1);
        list = list.filter(f => {
            if (extFlt && String(f.ext || '').toLowerCase() !== extFlt) return false;
            if (q) {
                const hay = `${f.name} ${f.path} ${f.ext || ''}`.toLowerCase();
                if (!hay.includes(q)) return false;
            }
            return true;
        });

        if (!list.length) {
            pane.innerHTML = '<div class="driver-text-node" style="padding:10px;">No large files match your current filter.</div>';
            return;
        }

        const rows = list.map(f => {
            const pct = (f.size / totalBytes) * 100;
            const color = GetDiskExtColor(f.ext, false);
            const safePath = String(f.path || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            return `<tr>
                <td><span class="tp-cell-primary"><span class="diskmap-ext-dot" style="background:${color};"></span>${EscapeHtmlTp(f.name)}</span><span class="tp-cell-sub" title="${EscapeHtmlTp(f.path)}">${EscapeHtmlTp(f.dir || f.path)}</span></td>
                <td><span class="sharing-badge badge-neutral" style="border-color:${color}; color:#edf2f7;">${EscapeHtmlTp(f.ext || '')}</span></td>
                <td class="tp-cell-num" style="font-weight:700; color:#edf2f7;">${FormatDiskBytes(f.size)}</td>
                <td class="tp-cell-num" style="color:#a0aec0;">${pct.toFixed(2)}%</td>
                <td style="color:#a0aec0; white-space:nowrap;">${EscapeHtmlTp(f.modified || '--')}</td>
                <td><div class="tp-row-actions"><button type="button" onclick="DiskMapOpenInExplorer('${safePath}')">Explorer</button><button type="button" onclick="CopyRawText('${safePath}', 'Path')">Copy</button><button type="button" class="wsl-btn-danger" onclick="DiskMapRecyclePath('${safePath}')">Recycle</button></div></td>
            </tr>`;
        }).join('');

        pane.innerHTML = `<table class="tp-data-table">
            <thead><tr><th>Exact File / Folder Path</th><th>Ext</th><th style="text-align:right">Size</th><th style="text-align:right">% Scan</th><th>Modified</th><th>Actions</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>`;
        return;
    }

    if (window._dmViewMode === 'exts') {
        let list = Array.isArray(data.extensions) ? [...data.extensions] : [];
        const totalBytes = Math.max(1, data.totalBytes || 1);
        if (q) list = list.filter(e => String(e.ext || '').toLowerCase().includes(q) || String(e.topFile || '').toLowerCase().includes(q));

        if (!list.length) {
            pane.innerHTML = '<div class="driver-text-node" style="padding:10px;">No file extensions match your filter.</div>';
            return;
        }

        const rows = list.map(e => {
            const pct = Math.min(100, (e.size / totalBytes) * 100);
            const color = GetDiskExtColor(e.ext, false);
            const safeExt = String(e.ext || '').replace(/'/g, "\\'");
            const isAct = (extFlt === String(e.ext || '').toLowerCase());
            return `<tr class="diskmap-row-clickable${isAct ? ' diskmap-row-selected' : ''}" onclick="ToggleDiskMapExtFilter('${safeExt}')" title="Click to highlight ${EscapeHtmlTp(e.ext)} files in Treemap & Largest Files">
                <td><span class="tp-cell-primary"><span class="diskmap-ext-dot" style="background:${color};"></span>${EscapeHtmlTp(e.ext)}</span></td>
                <td class="tp-cell-num" style="font-weight:700; color:#edf2f7;">${FormatDiskBytes(e.size)}</td>
                <td style="white-space:nowrap;"><span class="diskmap-pct-bar"><span class="diskmap-pct-fill" style="width:${pct.toFixed(1)}%; background:${color}; display:block;"></span></span><span style="color:#a0aec0; font-size:10px;">${pct.toFixed(1)}%</span></td>
                <td class="tp-cell-num">${(e.count || 0).toLocaleString()}</td>
                <td><span class="tp-cell-sub" style="max-width:340px;" title="${EscapeHtmlTp(e.topFile || '')}">${EscapeHtmlTp(e.topFile || '--')} (${FormatDiskBytes(e.topFileSize || 0)})</span></td>
            </tr>`;
        }).join('');

        pane.innerHTML = `<table class="tp-data-table">
            <thead><tr><th>Exact Extension</th><th style="text-align:right">Total Size</th><th>% Scan</th><th style="text-align:right">Files</th><th>Largest File of Type</th></tr></thead>
            <tbody>${rows}</tbody>
        </table>`;
    }
};

window.ToggleDiskMapExtFilter = function(ext) {
    window._dmHighlightExt = (window._dmHighlightExt.toLowerCase() === String(ext).toLowerCase()) ? '' : ext;
    RenderDiskMapBreadcrumbs();
    RenderDiskMapCurrentView();
    DrawDiskMapTreemap();
};

window.DiskMapSelectFromTree = function(idx) {
    const item = (window._dmRenderedTreeList || [])[idx];
    if (!item) return;
    window._dmSelectedItem = item;
    UpdateDiskMapSelectedBar();
    RenderDiskMapCurrentView();
    DrawDiskMapTreemap();
};

window.DiskMapDoubleClickTree = function(idx) {
    const item = (window._dmRenderedTreeList || [])[idx];
    if (!item) return;
    if (item.isDir) DiskMapZoomIntoNode(item);
    else DiskMapOpenInExplorer(item.path);
};

window.DiskMapZoomByIndex = function(idx) {
    const item = (window._dmRenderedTreeList || [])[idx];
    if (item && item.isDir) DiskMapZoomIntoNode(item);
};

function UpdateDiskMapSelectedBar() {
    const bar = document.getElementById('diskMapSelectionActions');
    const lbl = document.getElementById('lblDiskMapSelected');
    const zBtn = document.getElementById('btnDmSelZoom');
    const item = window._dmSelectedItem;
    if (!bar || !lbl) return;
    if (!item) {
        bar.style.display = 'none';
        return;
    }
    bar.style.display = 'inline-flex';
    lbl.textContent = `${item.name} (${FormatDiskBytes(item.size)})`;
    lbl.title = item.path || '';
    if (zBtn) zBtn.style.display = item.isDir ? 'inline-block' : 'none';
}

window.DiskMapActSelected = function(action) {
    const item = window._dmSelectedItem;
    if (!item) return;
    if (action === 'zoom' && item.isDir) DiskMapZoomIntoNode(item);
    else if (action === 'explorer') DiskMapOpenInExplorer(item.path);
    else if (action === 'copy') CopyRawText(item.path, 'Path');
    else if (action === 'recycle') DiskMapRecyclePath(item.path);
};

window.DiskMapOpenInExplorer = function(path) {
    if (!path) return;
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'DISKMAP_OPEN_EXPLORER', path }));
};

window.DiskMapRecyclePath = function(path) {
    if (!path) return;
    if (!confirm(`Move to Windows Recycle Bin?\n\n${path}\n\n(Protected OS system folders are automatically blocked.)`)) return;
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'DISKMAP_RECYCLE', path }));
};

function HandleDiskMapNotice(data) {
    const st = document.getElementById('diskMapStatus');
    const msg = data.error || data.message || '';
    if (st) {
        st.classList.toggle('sharing-error', !data.ok || !!data.error);
        st.textContent = msg;
    }
    if (data.message) AppendConsoleLogEntry(`[DISK MAP] ${data.message}`);
    if (data.error) AppendConsoleLogEntry(`[DISK MAP ERROR] ${data.error}`);
    if (data.recycled && window._dmScanData && window._dmScanData.rootPath) {
        // Trigger clean rescan after recycling so sizes stay accurate
        setTimeout(() => TriggerDiskMapScan(window._dmScanData.rootPath), 400);
    }
}

// =========================================================================
// SQUARIFIED TREEMAP LAYOUT & HIDPI CANVAS RENDERER (WIZTREE-STYLE)
// =========================================================================
function ComputeSquarifiedLayout(items, x, y, w, h) {
    const out = [];
    const valid = items.filter(it => it.size > 0);
    if (!valid.length || w <= 2 || h <= 2) return out;

    const total = valid.reduce((s, it) => s + it.size, 0);
    if (total <= 0) return out;

    let rx = x, ry = y, rw = w, rh = h;
    let remaining = valid.map(it => ({ item: it, area: (it.size / total) * (w * h) }));

    const worstAspect = (row, sideLen) => {
        if (!row.length || sideLen <= 0) return Infinity;
        const sumA = row.reduce((s, r) => s + r.area, 0);
        let maxA = 0, minA = Infinity;
        for (const r of row) {
            if (r.area > maxA) maxA = r.area;
            if (r.area < minA) minA = r.area;
        }
        if (minA <= 0) return Infinity;
        const s2 = sideLen * sideLen;
        return Math.max((s2 * maxA) / (sumA * sumA), (sumA * sumA) / (s2 * minA));
    };

    let idx = 0;
    while (idx < remaining.length && rw > 1 && rh > 1) {
        const horiz = rw >= rh;
        const side = horiz ? rh : rw;
        const row = [remaining[idx++]];
        let best = worstAspect(row, side);

        while (idx < remaining.length) {
            const candidate = [...row, remaining[idx]];
            const score = worstAspect(candidate, side);
            if (score <= best) {
                row.push(remaining[idx++]);
                best = score;
            } else {
                break;
            }
        }

        const rowArea = row.reduce((s, r) => s + r.area, 0);
        const stripThick = side > 0 ? (rowArea / side) : 0;

        let offset = 0;
        for (const r of row) {
            const len = stripThick > 0 ? (r.area / stripThick) : 0;
            if (horiz) {
                out.push({ item: r.item, x: rx, y: ry + offset, w: stripThick, h: len });
            } else {
                out.push({ item: r.item, x: rx + offset, y: ry, w: len, h: stripThick });
            }
            offset += len;
        }

        if (horiz) { rx += stripThick; rw -= stripThick; }
        else { ry += stripThick; rh -= stripThick; }
    }
    return out;
}

function DrawDiskMapTreemap() {
    const wrap = document.getElementById('diskMapCanvasWrap');
    const canvas = document.getElementById('diskMapCanvas');
    const cur = GetDiskMapCurrentNode();
    if (!wrap || !canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const cssW = Math.max(100, wrap.clientWidth);
    const cssH = Math.max(100, wrap.clientHeight);
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
        canvas.width = Math.round(cssW * dpr);
        canvas.height = Math.round(cssH * dpr);
    }

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#10151e';
    ctx.fillRect(0, 0, cssW, cssH);

    window._dmRects = [];
    if (!cur || !Array.isArray(cur.children) || !cur.children.length) {
        ctx.fillStyle = '#718096';
        ctx.font = '12px Consolas, monospace';
        ctx.fillText('Run a scan above to render the interactive file & folder treemap.', 16, 28);
        return;
    }

    const extFlt = (window._dmHighlightExt || '').toLowerCase();
    const topRects = ComputeSquarifiedLayout(cur.children, 2, 2, cssW - 4, cssH - 4);
    const hitRects = [];

    for (const r of topRects) {
        if (r.w < 2 || r.h < 2) continue;
        const item = r.item;
        const isSel = window._dmSelectedItem && window._dmSelectedItem.path === item.path;

        if (item.isDir && Array.isArray(item.children) && item.children.length > 0 && r.w >= 46 && r.h >= 34) {
            // Draw folder outer frame + compact folder header + nested children mosaic (WizTree style!)
            const headerH = 15;
            ctx.fillStyle = '#1b2638';
            ctx.fillRect(r.x, r.y, r.w, r.h);

            // Header bar
            ctx.fillStyle = isSel ? '#3182ce' : '#25354d';
            ctx.fillRect(r.x, r.y, r.w, headerH);
            ctx.save();
            ctx.beginPath();
            ctx.rect(r.x + 3, r.y, Math.max(0, r.w - 6), headerH);
            ctx.clip();
            ctx.fillStyle = '#edf2f7';
            ctx.font = 'bold 10px Consolas, monospace';
            ctx.fillText(`${item.name} (${FormatDiskBytes(item.size)})`, r.x + 4, r.y + 11);
            ctx.restore();

            // Register folder header as directly clickable/hoverable
            hitRects.push({ item, parentNode: cur, x: r.x, y: r.y, w: r.w, h: headerH });

            const innerRects = ComputeSquarifiedLayout(item.children, r.x + 2, r.y + headerH + 1, r.w - 4, r.h - headerH - 3);
            for (const ir of innerRects) {
                if (ir.w < 1.5 || ir.h < 1.5) continue;
                const child = ir.item;
                const matchExt = !extFlt || (!child.isDir && String(child.ext || '').toLowerCase() === extFlt);
                const cSel = window._dmSelectedItem && window._dmSelectedItem.path === child.path;

                ctx.save();
                ctx.globalAlpha = matchExt ? 0.92 : 0.22;
                ctx.fillStyle = GetDiskExtColor(child.ext, child.isDir);
                ctx.fillRect(ir.x, ir.y, ir.w, ir.h);
                ctx.restore();

                ctx.strokeStyle = cSel ? '#ffffff' : '#0f141d';
                ctx.lineWidth = cSel ? 2 : 1;
                ctx.strokeRect(ir.x + 0.5, ir.y + 0.5, Math.max(0, ir.w - 1), Math.max(0, ir.h - 1));

                if (ir.w >= 48 && ir.h >= 16) {
                    ctx.save();
                    ctx.beginPath();
                    ctx.rect(ir.x + 2, ir.y + 1, Math.max(0, ir.w - 4), Math.max(0, ir.h - 2));
                    ctx.clip();
                    ctx.fillStyle = matchExt ? '#f7fafc' : '#a0aec0';
                    ctx.font = '9.5px Consolas, monospace';
                    ctx.fillText(child.name, ir.x + 3, ir.y + 11);
                    if (ir.h >= 27) {
                        ctx.fillStyle = 'rgba(237, 242, 247, 0.8)';
                        ctx.fillText(FormatDiskBytes(child.size), ir.x + 3, ir.y + 22);
                    }
                    ctx.restore();
                }
                hitRects.push({ item: child, parentNode: item, x: ir.x, y: ir.y, w: ir.w, h: ir.h });
            }

            ctx.strokeStyle = isSel ? '#63b3ed' : '#3a4c66';
            ctx.lineWidth = isSel ? 2 : 1;
            ctx.strokeRect(r.x + 0.5, r.y + 0.5, Math.max(0, r.w - 1), Math.max(0, r.h - 1));
        } else {
            const matchExt = !extFlt || (!item.isDir && String(item.ext || '').toLowerCase() === extFlt);
            ctx.save();
            ctx.globalAlpha = matchExt ? 0.92 : 0.22;
            ctx.fillStyle = GetDiskExtColor(item.ext, item.isDir);
            ctx.fillRect(r.x, r.y, r.w, r.h);
            ctx.restore();

            ctx.strokeStyle = isSel ? '#ffffff' : '#0f141d';
            ctx.lineWidth = isSel ? 2 : 1;
            ctx.strokeRect(r.x + 0.5, r.y + 0.5, Math.max(0, r.w - 1), Math.max(0, r.h - 1));

            if (r.w >= 44 && r.h >= 16) {
                ctx.save();
                ctx.beginPath();
                ctx.rect(r.x + 3, r.y + 2, Math.max(0, r.w - 6), Math.max(0, r.h - 4));
                ctx.clip();
                ctx.fillStyle = '#f7fafc';
                ctx.font = item.isDir ? 'bold 10px Consolas, monospace' : '10px Consolas, monospace';
                ctx.fillText(item.name, r.x + 4, r.y + 12);
                if (r.h >= 28) {
                    ctx.fillStyle = 'rgba(237, 242, 247, 0.85)';
                    ctx.fillText(FormatDiskBytes(item.size), r.x + 4, r.y + 24);
                }
                ctx.restore();
            }
            hitRects.push({ item, parentNode: cur, x: r.x, y: r.y, w: r.w, h: r.h });
        }
    }

    // Highlight currently hovered rectangle cleanly
    if (window._dmHoveredRect) {
        const hr = window._dmHoveredRect;
        ctx.strokeStyle = '#90cdf4';
        ctx.lineWidth = 2;
        ctx.strokeRect(hr.x + 1, hr.y + 1, Math.max(0, hr.w - 2), Math.max(0, hr.h - 2));
    }

    window._dmRects = hitRects;
}

function FindDiskMapRectAt(mx, my) {
    const rects = window._dmRects || [];
    for (let i = rects.length - 1; i >= 0; i--) {
        const r = rects[i];
        if (mx >= r.x && mx <= r.x + r.w && my >= r.y && my <= r.y + r.h) return r;
    }
    return null;
}

function SetupDiskMapCanvasEvents() {
    const wrap = document.getElementById('diskMapCanvasWrap');
    const canvas = document.getElementById('diskMapCanvas');
    const tip = document.getElementById('diskMapTooltip');
    if (!wrap || !canvas) return;

    canvas.addEventListener('mousemove', (e) => {
        const bounds = canvas.getBoundingClientRect();
        const mx = e.clientX - bounds.left;
        const my = e.clientY - bounds.top;
        const hit = FindDiskMapRectAt(mx, my);

        if (hit !== window._dmHoveredRect) {
            window._dmHoveredRect = hit;
            DrawDiskMapTreemap();
        }

        if (!tip) return;
        if (!hit) {
            tip.style.display = 'none';
            return;
        }
        const it = hit.item;
        const cur = GetDiskMapCurrentNode();
        const pct = cur && cur.size > 0 ? ((it.size / cur.size) * 100).toFixed(2) : '0.00';
        tip.style.display = 'block';
        tip.innerHTML = `
            <div style="font-weight:700; color:#90cdf4;">${it.isDir ? '📁' : '📄'} ${EscapeHtmlTp(it.name)}</div>
            <div style="color:#edf2f7;">Size: <strong>${FormatDiskBytes(it.size)}</strong> (${pct}% of current view)</div>
            ${it.isDir ? `<div style="color:#a0aec0;">${(it.files || 0).toLocaleString()} files · ${(it.dirs || 0).toLocaleString()} folders · Double-click to zoom</div>` : `<div style="color:#a0aec0;">Type: ${EscapeHtmlTp(it.ext || 'file')}${it.modified ? ' · Modified: ' + it.modified : ''}</div>`}
            <div style="color:#718096; font-size:9.5px; word-break:break-all; margin-top:2px;">${EscapeHtmlTp(it.path)}</div>
        `;
        const tx = Math.min(wrap.clientWidth - tip.offsetWidth - 8, mx + 14);
        const ty = Math.min(wrap.clientHeight - tip.offsetHeight - 8, my + 14);
        tip.style.left = `${Math.max(6, tx)}px`;
        tip.style.top = `${Math.max(6, ty)}px`;
    });

    canvas.addEventListener('mouseleave', () => {
        window._dmHoveredRect = null;
        if (tip) tip.style.display = 'none';
        DrawDiskMapTreemap();
    });

    canvas.addEventListener('click', (e) => {
        const bounds = canvas.getBoundingClientRect();
        const hit = FindDiskMapRectAt(e.clientX - bounds.left, e.clientY - bounds.top);
        if (!hit) return;
        window._dmSelectedItem = hit.item;
        UpdateDiskMapSelectedBar();
        DrawDiskMapTreemap();
    });

    canvas.addEventListener('dblclick', (e) => {
        const bounds = canvas.getBoundingClientRect();
        const hit = FindDiskMapRectAt(e.clientX - bounds.left, e.clientY - bounds.top);
        if (!hit) return;
        if (hit.item.isDir) {
            DiskMapZoomIntoNode(hit.item);
        } else {
            DiskMapOpenInExplorer(hit.item.path);
        }
    });

    if (typeof ResizeObserver !== 'undefined') {
        window._dmResizeObs = new ResizeObserver(() => {
            if (window._activeViewKey === 'diskmap' && window._dmScanData) {
                DrawDiskMapTreemap();
            }
        });
        window._dmResizeObs.observe(wrap);
    }
}
