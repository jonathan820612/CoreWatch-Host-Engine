// =========================================================================
// APPLICATION TAB NAVIGATION AND VIEW-SWITCHING CONTROLLER (GLOBAL BIND)
// =========================================================================
window.SwitchAppLayoutView = function(targetViewId) {
    const panels = {
        dashboard: document.getElementById('viewDashboardGrid'),
        netmanager: document.getElementById('viewNetworkManagerPanel'),
        startup: document.getElementById('viewStartupPanel'),
        sharing: document.getElementById('viewSharingPanel')
    };

    const buttons = {
        dashboard: document.getElementById('tabDashboard'),
        netmanager: document.getElementById('tabNetManager'),
        startup: document.getElementById('tabStartup'),
        sharing: document.getElementById('tabSharing')
    };

    Object.values(panels).forEach(p => { if (p) p.style.display = 'none'; });
    Object.values(buttons).forEach(b => { if (b) b.classList.remove('active'); });

    if (targetViewId === 'netmanager') {
        if (panels.netmanager) panels.netmanager.style.display = 'block';
        if (buttons.netmanager) buttons.netmanager.classList.add('active');
        RequestNetworkAdapters();
    } 
    else if (targetViewId === 'startup') {
        if (panels.startup) panels.startup.style.display = 'block';
        if (buttons.startup) buttons.startup.classList.add('active');
        RequestStartupApps();
    } 
    else if (targetViewId === 'sharing') {
        panels.sharing.style.display = 'block';
        buttons.sharing.classList.add('active');
        RequestSharingCenter();
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
document.addEventListener("DOMContentLoaded", () => {
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

    if (msgType === "REFRESH_STARTUP_APPS") {
        RenderStartupAppRows(stats);
    } 
    else if (msgType === 'SHARING_CENTER') {
        RenderSharingCenter(stats);
    }
    else if (msgType === "REFRESH_ADAPTER_STATE") {
        RenderNetworkAdapterInterfaceRows(stats);
    } 
    else if (msgType === "SPEED_TEST_RESULTS") {
        RenderSpeedTestResults(stats);
    }
    else {
        // Dashboard Telemetry
        AppendLiveDiagnosticConsoleLog(stats);
        updateDashboardUiMesh(stats);
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
        const plan = stats.SystemFrame?.PowerPlan || "Unknown";
        const powerPlanHtml = `<span style="cursor:pointer; text-decoration:underline dotted;" onclick="TriggerPowerPlanMenu()">${plan}</span>`;
        const planElem = document.getElementById('lblPowerPlan');
        if (planElem) planElem.innerHTML = powerPlanHtml;
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

        SetDomText('lblRamUsage',       sys.RamUsageText);
        const cpuBadge = document.getElementById('badgeCpuTemp');
        if (cpuBadge) {
            if (sys.CpuTemp >= 75) {
                cpuBadge.classList.add('therm-hot');
                cpuBadge.classList.remove('therm-cool');
            } else {
                cpuBadge.classList.add('therm-cool');
                cpuBadge.classList.remove('therm-hot');
            }
        }

        SetDomText('lblGpuLoad',        `${sys.GpuLoad}%`);
        SetDomStyleWidth('barGpuLoad',  `${sys.GpuLoad}%`);
        SetDomText('lblGpuModel',       sys.GpuModel);
        SetDomText('lblGpuDriver',      sys.GpuDriverVersion);
        SetDomText('lblGpuPower',       sys.GpuPower);
        SetDomText('lblGpuTemp',        sys.GpuTemp);

        const gpuBadge = document.getElementById('badgeGpuTemp');
        if (gpuBadge) {
            if (sys.GpuTemp >= 75) {
                gpuBadge.classList.add('therm-hot');
                gpuBadge.classList.remove('therm-cool');
            } else {
                gpuBadge.classList.add('therm-cool');
                gpuBadge.classList.remove('therm-hot');
            }
        }

        SetDomText('lblRamUsage',       sys.RamUsageText);
        SetDomStyleWidth('barRamUsage', `${sys.RamPercent}%`);
        SetDomText('lblPagefileUsage',       sys.PagefileUsageText);
        SetDomStyleWidth('barPagefileUsage', `${sys.PagefilePercent}%`);
    }

    // --- NetworkFrame Mapping inside updateDashboardUiMesh ---
    const net = stats.NetworkFrame;
    if (net) {
        SetDomText('lblIntIPv4',        net.IntIPv4);
        SetDomText('lblSubnetMask',     net.SubnetMask);
        SetDomText('lblGateway',        net.Gateway);
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
                const usedPercent = (drive.StorageUsedGB / drive.StorageTotalGB) * 100;
                const isRemovable = drive.DriveType === "Removable";
                const fillColor = isRemovable ? "#9f7aea" : "#3182ce";
                const labelColorClass = isRemovable ? "text-removable" : "text-local";
                const tagIconStyle = isRemovable ? "style='filter: hue-rotate(50deg) saturate(1.5);'" : "";

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
                        <div class="driver-tag tight-tag">${drive.DriveType} Storage Node</div>
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

    const consoleBox = document.getElementById('console-box') || document.querySelector('.console-box');
    if (consoleBox) {
        consoleBox.textContent = `[NETWORK: HARDWARE PROVISIONING] Requesting ${actionWord.toUpperCase()} for adapter [ ${adapterName} ]...`;
    }

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

function AppendLiveDiagnosticConsoleLog(stats) {
    const consoleBox = document.getElementById('console-box') || document.querySelector('.console-box');
    if (consoleBox && stats.IdentityFrame && stats.SystemFrame) {
        consoleBox.textContent = `[PIPELINE: ${stats.PipelineStatus}] Host: ${stats.IdentityFrame.HostName} | CPU Load: ${stats.SystemFrame.CpuLoad}% | RAM: ${stats.SystemFrame.RamUsageText}`;
    }
}

window.ClearConsoleLogView = function() {
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
    const downElem = document.getElementById('lblNetDownload');
    const upElem = document.getElementById('lblNetUpload');
    if (latElem) latElem.textContent = "...";
    if (downElem) downElem.textContent = "...";
    if (upElem) upElem.textContent = "...";

    const consoleBox = document.getElementById('console-box') || document.querySelector('.console-box');
    if (consoleBox) {
        consoleBox.textContent = '[SPEED TEST] Initiating Cloudflare speed analysis mesh...';
    }

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
    const downElem = document.getElementById('lblNetDownload');
    const upElem = document.getElementById('lblNetUpload');

    if (latElem) latElem.textContent = (stats.Latency !== undefined && stats.Latency !== null) ? stats.Latency : '--';
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

    const consoleBox = document.getElementById('console-box') || document.querySelector('.console-box');
    if (consoleBox) {
        consoleBox.textContent = `[SPEED TEST] Complete: ${stats.Latency} ms latency | ${stats.Download} Mbps down | ${stats.Upload} Mbps up`;
    }
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
        
        const consoleBox = document.getElementById('console-box');
        if (consoleBox) {
            consoleBox.textContent = `[WATCHDOG: TUNING MATRIX SYNCHRONIZED] Filter Cap: ${cpuThreshold}% | Mode: ${reactionMode} | Active Rules Applied`;
        }
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
// NATIVE FRAMELESS CHASSIS WINDOW INTEROP EVENTS
// =========================================================================
document.addEventListener("DOMContentLoaded", () => {
    const headerDeck = document.querySelector('.app-header-deck');
    if (headerDeck && window.chrome && window.chrome.webview) {
        let isDragging = false;
        let startX = 0, startY = 0;

        headerDeck.addEventListener('mousedown', (e) => {
            if (e.target.closest('.tab-btn') || e.target.closest('.exit-system-btn')) return;
            isDragging = true;
            startX = e.clientX;
            startY = e.clientY;
        });

        window.addEventListener('mousemove', (e) => {
            if (!isDragging) return;
            window.chrome.webview.postMessage(`Window-Drag:${startX}|${startY}`);
        });

        window.addEventListener('mouseup', () => { isDragging = false; });
    }

    let isResizing = false;
    const gripThickness = 12;

    window.addEventListener('mousedown', (e) => {
        if (window.innerWidth - e.clientX < gripThickness && window.innerHeight - e.clientY < gripThickness) {
            isResizing = true;
            e.preventDefault();
        }
    });

    window.addEventListener('mousemove', (e) => {
        if (window.innerWidth - e.clientX < gripThickness && window.innerHeight - e.clientY < gripThickness) {
            document.body.style.cursor = 'se-resize';
        } else if (!isResizing) {
            document.body.style.cursor = 'default';
        }

        if (!isResizing || !(window.chrome && window.chrome.webview)) return;
        window.chrome.webview.postMessage(`Window-Resize:${e.screenX - window.screenX}|${e.screenY - window.screenY}`);
    });

    window.addEventListener('mouseup', () => {
        isResizing = false;
        document.body.style.cursor = 'default';
    });
});
window.TriggerTelemetryDisable = function() {
    if (confirm("Disable Windows Telemetry services (DiagTrack & dmwappushservice)?\nThis will stop and disable the services immediately.")) {
        window.chrome.webview.postMessage(JSON.stringify({ command: "DISABLE_TELEMETRY" }));
    }
};
