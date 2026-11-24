// =========================================================================
// APPLICATION TAB NAVIGATION AND VIEW-SWITCHING CONTROLLER (GLOBAL BIND)
// =========================================================================
window.SwitchAppLayoutView = function(targetViewId) {
    const panels = {
        dashboard: document.getElementById('viewDashboardGrid'),
        netmanager: document.getElementById('viewNetworkManagerPanel'),
        startup: document.getElementById('viewStartupPanel'),
        sharing: document.getElementById('viewSharingPanel'),
        apps: document.getElementById('viewInstalledAppsPanel'),
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
    SetDomText('lblMonScale',       mon.Scale || '--');
    SetDomText('lblMonOrientation', mon.Orientation || '--');

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

    container.innerHTML = list.map(adapter => {
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
    if (!stats) return;

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
            hostElem.innerHTML = `<span style="cursor:pointer; text-decoration:underline dotted;" onclick="TriggerHostRename('${id.HostName}')">${id.HostName}</span>`;
        }
        if (workElem) {
            workElem.innerHTML = `<span style="cursor:pointer; text-decoration:underline dotted;" onclick="TriggerWorkgroupRename('${id.Workgroup}')">${id.Workgroup}</span>`;
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
        SetDomText('lblPsVersion',      infra.PsVersion);
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
        if (planElem) planElem.innerHTML = powerPlanHtml;

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

        // [DYNAMIC CONTROL] Realtime Protection On <-> Off Toggle Pill
        const rtElem = document.getElementById('lblRealtime');
        if (rtElem) {
            const rt = String(net.Realtime || 'Unknown');
            if (IsControlPending('TOGGLE_REALTIME')) {
                rtElem.innerHTML = `<button type="button" class="toggle-pill-btn is-busy" disabled>...</button>`;
            } else if (rt.toLowerCase() === 'on') {
                rtElem.innerHTML = `<button type="button" class="toggle-pill-btn state-on" onclick="TriggerRealtimeToggle('Off')" title="Defender Real-Time Protection is On — Click to turn Off">On</button>`;
            } else if (rt.toLowerCase() === 'off') {
                rtElem.innerHTML = `<button type="button" class="toggle-pill-btn state-off" onclick="TriggerRealtimeToggle('On')" title="Defender Real-Time Protection is Off — Click to turn On">Off</button>`;
            } else {
                rtElem.textContent = rt;
            }
        }

        // [DYNAMIC CONTROL] Network Discovery On <-> Off Toggle Pill
        const discElem = document.getElementById('lblDiscovery');
        if (discElem) {
            const disc = String(net.Discovery || 'Off');
            if (IsControlPending('TOGGLE_DISCOVERY')) {
                discElem.innerHTML = `<button type="button" class="toggle-pill-btn is-busy" disabled>...</button>`;
            } else if (disc.toLowerCase() === 'on') {
                discElem.innerHTML = `<button type="button" class="toggle-pill-btn state-on" onclick="TriggerDiscoveryToggle('Off')" title="Network Discovery is On — Click to turn Off">On</button>`;
            } else {
                discElem.innerHTML = `<button type="button" class="toggle-pill-btn state-off" onclick="TriggerDiscoveryToggle('On')" title="Network Discovery is Off — Click to turn On">Off</button>`;
            }
        }

        // [DYNAMIC CONTROL] File & Printer Sharing On <-> Off Toggle Pill
        const shareElem = document.getElementById('lblSharing');
        if (shareElem) {
            const sh = String(net.Sharing || 'Off');
            if (IsControlPending('TOGGLE_SHARING')) {
                shareElem.innerHTML = `<button type="button" class="toggle-pill-btn is-busy" disabled>...</button>`;
            } else if (sh.toLowerCase() === 'on') {
                shareElem.innerHTML = `<button type="button" class="toggle-pill-btn state-on" onclick="TriggerSharingToggle('Off')" title="File & Printer Sharing (SMB) is On — Click to turn Off">On</button>`;
            } else {
                shareElem.innerHTML = `<button type="button" class="toggle-pill-btn state-off" onclick="TriggerSharingToggle('On')" title="File & Printer Sharing (SMB) is Off — Click to turn On">Off</button>`;
            }
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

    // --- StorageFrame Mapping ---
    const storage = stats.StorageFrame;
    if (storage) {
        const container = document.getElementById('storageVolumeContainer');
        if (container) {
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
// GENERAL CORE GRAPHICS OBJECT SHORTCUTS
// =========================================================================
function SetDomText(elementId, textValue) {
    const element = document.getElementById(elementId);
    if (element) {
        element.innerText = textValue !== undefined && textValue !== null ? textValue : "Loading...";
    }
}

function SetDomStyleWidth(elementId, widthValue) {
    const element = document.getElementById(elementId);
    if (element) {
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

window.TriggerRealtimeToggle = function(targetState) {
    if (targetState === 'Off') {
        if (!confirm("Turn OFF Microsoft Defender Real-Time Protection?\n(Requires Tamper Protection to be disabled in Windows Security.)")) return;
    }
    DispatchDashboardControl('TOGGLE_REALTIME', { targetState }, `Setting Real-Time Protection -> ${targetState}...`, 'lblRealtime');
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

    ApplySystemDevicesFilter();
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

                const ageBadge = dev.driverAgeText
                    ? `<span class="device-age-tag${dev.driverAgeDays > 1095 ? ' age-old' : ''}" title="Driver Date: ${dev.driverDate}">${dev.driverAgeText}</span>`
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

                    const actions = document.createElement('div');
                    actions.className = 'sharing-actions';

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

        const rows = list.slice(0, 260).map(s => {
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

        const rows = list.slice(0, 300).map(x => {
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
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const dd = document.getElementById('navSystemDropdown');
        if (dd && dd.classList.contains('open')) {
            dd.classList.remove('open');
            const trigger = document.getElementById('tabSystemMenu');
            if (trigger) trigger.setAttribute('aria-expanded', 'false');
        }
    }
});

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

        area.innerHTML = `<div class="tp-table-scroll" style="max-height:280px;"><table class="tp-data-table">
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
    { label: '🧩 System Devices & Drivers Tree', cat: 'Tab', run: () => SwitchAppLayoutView('devices') },
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
