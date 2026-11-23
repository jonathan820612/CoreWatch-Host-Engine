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
        diagx: document.getElementById('viewUltimaDiagXPanel')
    };

    const buttons = {
        dashboard: document.getElementById('tabDashboard'),
        netmanager: document.getElementById('tabNetManager'),
        startup: document.getElementById('tabStartup'),
        sharing: document.getElementById('tabSharing'),
        apps: document.getElementById('tabInstalledApps'),
        devices: document.getElementById('tabDevices'),
        organizer: document.getElementById('tabOrganizer'),
        diagx: document.getElementById('tabUltimaDiagX')
    };

    Object.values(panels).forEach(p => { if (p) p.style.display = 'none'; });
    Object.values(buttons).forEach(b => { if (b) b.classList.remove('active'); });

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
    SetDomText('lblMonRefresh',     mon.RefreshRate || '--');
    SetDomText('lblMonConnection',  mon.ConnectionType || '--');
    SetDomText('lblMonScale',       mon.Scale || '--');
    SetDomText('lblMonOrientation', mon.Orientation || '--');

    const hdrEl = document.getElementById('lblMonHdr');
    if (hdrEl) {
        const hdr = mon.HdrStatus || 'Unknown';
        hdrEl.textContent = hdr;
        hdrEl.style.color = hdr === 'On' ? '#48bb78' : (hdr.startsWith('Off') ? '#a0aec0' : '#718096');
    }

    const nlEl = document.getElementById('lblMonNightLight');
    if (nlEl) {
        const nl = mon.NightLight || 'Off';
        nlEl.textContent = nl;
        nlEl.style.color = nl === 'On' ? '#ecc94b' : '#a0aec0';
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

    // 3. Top Resource Consumer Single-Line Callout
    if (sys.TopProcessText) {
        SetDomText('lblTopProcess', sys.TopProcessText);
        const strip = document.getElementById('topProcessStrip');
        if (strip && sys.TopProcessDetail) {
            strip.title = sys.TopProcessDetail;
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

        // [DIAGNOSTIC ADDITION] Admin / Elevation Context Pill
        const elevElem = document.getElementById('lblElevation');
        if (elevElem && id.ElevationStatus) {
            elevElem.textContent = id.ElevationStatus;
            elevElem.classList.remove('diag-ok', 'diag-info', 'diag-warn', 'diag-neutral');
            if (id.IsAdmin) {
                elevElem.classList.add('diag-info');
                elevElem.title = 'Running elevated as Administrator (full WMI/SMART/registry access)';
            } else {
                elevElem.classList.add('diag-warn');
                elevElem.title = 'Running as Standard User — some SMART, Event Log, or system control queries may require Administrator privileges';
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

        // [DIAGNOSTIC ADDITION] Pending Reboot Flag Pill
        const rebootElem = document.getElementById('lblPendingReboot');
        if (rebootElem && infra.PendingReboot) {
            rebootElem.textContent = infra.PendingReboot;
            rebootElem.title = infra.PendingRebootDetail || '';
            rebootElem.classList.remove('diag-ok', 'diag-warn', 'diag-crit', 'diag-neutral');
            rebootElem.classList.add(infra.PendingReboot === 'Yes' ? 'diag-warn' : 'diag-ok');
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
        const telElem = document.getElementById('lblTelemetry');
        if (telElem) {
            if (sys.TelemetryStatus === "On") {
                telElem.innerHTML = `<span style="color:#48bb78; cursor:pointer; text-decoration:underline dotted;" onclick="TriggerTelemetryDisable()" title="Click to Disable Windows Telemetry Services">On (Disable)</span>`;
            } else {
                telElem.innerHTML = `<span style="color:#f56565;">Off</span>`;
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
        SetDomText('lblNetworkStatus',  net.NetworkStatus);
        SetDomText('lblWlanSsid',       net.WlanSsid);
        SetDomText('lblExtIPv4',        net.ExtIPv4);
        SetDomText('lblLinkCap',        net.LinkCap);
        SetDomText('lblFirewall',       net.Firewall);
        SetDomText('lblRealtime',       net.Realtime);
        SetDomText('lblDiscovery',      net.Discovery);
        SetDomText('lblSharing',        net.Sharing);
        SetDomText('lblEthernet',       net.lblEthDriver);
        SetDomText('lblWifi',           net.lblWifiDriver);

        // [DIAGNOSTIC ADDITION] Active DNS Servers, DNS Resolution Check & Gateway ARP Pill
        if (net.DnsServers) SetDomText('lblDnsServers', net.DnsServers);
        const dnsElem = document.getElementById('lblDnsStatus');
        if (dnsElem && net.DnsStatusText) {
            dnsElem.textContent = net.DnsStatusText;
            dnsElem.title = `DNS resolution probe via configured resolvers (${net.DnsServers || 'Auto'})`;
            dnsElem.classList.remove('diag-ok', 'diag-warn', 'diag-crit', 'diag-neutral');
            if (net.DnsStatus === 'OK') dnsElem.classList.add('diag-ok');
            else if (net.DnsStatus === 'FAIL') dnsElem.classList.add('diag-crit');
            else dnsElem.classList.add('diag-neutral');
        }
        const arpElem = document.getElementById('lblArpStatus');
        if (arpElem && net.ArpStatus) {
            arpElem.textContent = net.ArpStatus;
            arpElem.title = net.ArpDetail || `Gateway MAC: ${net.GatewayMac || 'N/A'}`;
            arpElem.classList.remove('diag-ok', 'diag-warn', 'diag-crit', 'diag-neutral');
            const arpLower = String(net.ArpStatus).toLowerCase();
            if (arpLower === 'reachable' || arpLower === 'permanent') arpElem.classList.add('diag-ok');
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
            if (e.target.closest('.tab-btn') || e.target.closest('.exit-system-btn')) return;
            e.preventDefault();
            window.chrome.webview.postMessage('Window-DragStart');
        });

        headerDeck.addEventListener('dblclick', (e) => {
            if (e.target.closest('.tab-btn') || e.target.closest('.exit-system-btn')) return;
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
window.TriggerTelemetryDisable = function() {
    if (confirm("Disable Windows Telemetry services (DiagTrack & dmwappushservice)?\nThis will stop and disable the services immediately.")) {
        window.chrome.webview.postMessage(JSON.stringify({ command: "DISABLE_TELEMETRY" }));
    }
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

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('diagXTranslateForm')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const code = document.getElementById('diagXCodeInput')?.value || '';
        TriggerCodeTranslation(code);
    });
});
