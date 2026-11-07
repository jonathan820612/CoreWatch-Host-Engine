// =========================================================================
// APPLICATION TAB NAVIGATION AND VIEW-SWITCHING CONTROLLER (GLOBAL BIND)
// =========================================================================
window.SwitchAppLayoutView = function(targetViewId) {
    const dashboardGrid = document.getElementById('viewDashboardGrid');
    const networkPanel = document.getElementById('viewNetworkManagerPanel');
    const tabBtnDash = document.getElementById('tabDashboard');
    const tabBtnNet = document.getElementById('tabNetManager');

    if (targetViewId === 'netmanager') {
        // Toggle view containers instantly via inline style vectors
        if (dashboardGrid) dashboardGrid.style.display = 'none';
        if (networkPanel) networkPanel.style.display = 'block';
        
        // Synchronize active highlights on top toolbar button slots
        if (tabBtnNet) tabBtnNet.classList.add('active');
        if (tabBtnDash) tabBtnDash.classList.remove('active');
        
        // Request immediate hardware adapter reads from host engine layout
        if (window.chrome && window.chrome.webview) {
            window.chrome.webview.postMessage("UI-Ready");
        }
    } else {
        // Fall back cleanly to the main systems telemetry dashboard mesh
        if (networkPanel) networkPanel.style.display = 'none';
        if (dashboardGrid) dashboardGrid.style.display = 'grid';
        
        if (tabBtnDash) tabBtnDash.classList.add('active');
        if (tabBtnNet) tabBtnNet.classList.remove('active');
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

                
                AppendLiveDiagnosticConsoleLog(stats);
                updateDashboardUiMesh(stats);
                

                const msgType = stats.type || stats.Type;
                const msgInterfaces = stats.interfaces || stats.Interfaces;
                
                if (msgType === "REFRESH_ADAPTER_STATE" && msgInterfaces) {
                    RenderNetworkAdapterInterfaceRows(msgInterfaces);
                }
            } catch (err) {
                console.error("Failed to unpack metrics package:", err);
            }
        });
        window.chrome.webview.postMessage("UI-Ready");
    }
});

/**
 * Requests the application host infrastructure to spin up an isolated tool process
 */
window.LaunchExternalToolWindow = function(toolIdentifier) {
    if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(`Launch-Tool:${toolIdentifier}`);
    }
    console.log(`[INFRASTRUCTURE: Forwarded routing query for component: ${toolIdentifier}]`);
};

/**
 * Automatically evaluates states to sync navigation interface lighting styles
 */
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
function updateDashboardUiMesh(stats) {
    if (!stats) return;
    SyncToolNavigationHighlights(stats);

    // --- IdentityFrame Mapping ---
    const id = stats.IdentityFrame;
    if (id) {
        SetDomText('lblHostName',       id.HostName);
        SetDomText('lblWorkgroup',      id.Workgroup);
        SetDomText('lblCpuModel',       id.CpuModel);
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
    }
    // --- SystemFrame Mapping ---
    const sys = stats.SystemFrame;
    if (sys) {
        SetDomText('lblCpuLoad',        `${sys.CpuLoad}%`);
        SetDomStyleWidth('barCpuLoad',  `${sys.CpuLoad}%`);
        SetDomText('lblCpuClock',       sys.CpuClock);
        SetDomText('lblCpuTemp',        sys.CpuTemp);

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
        SetDomText('lblEthernet',       net.lblEthDriver);
        SetDomText('lblWifi',           net.lblWifiDriver);
        
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
function RenderNetworkAdapterInterfaceRows(interfaces) {
    // FIX: Updated to match your exact HTML panel element target ID block
    const container = document.getElementById("adapterInterfaceContainer");
    if (!container) return;

    // Guard clause to handle wrapper objects and extract the true array safely
    let targetArray = interfaces;
    if (interfaces && !Array.isArray(interfaces) && Array.isArray(interfaces.interfaces)) {
        targetArray = interfaces.interfaces;
    }

    container.innerHTML = "";

    if (!targetArray || !Array.isArray(targetArray) || targetArray.length === 0) {
        container.innerHTML = `<div class="driver-text-node">No connected hardware lines returned from engine.</div>`;
        return;
    }

    targetArray.forEach((adapter, index) => {
        const isDhcp = adapter.Profile === "DHCP";
        
        const rowTemplateHtml = `
            <div class="metric-row storage-tight-row" style="background-color: #1a202c; border: 1px solid #323c4b; padding: 12px; margin-bottom: 8px; border-left: 4px solid ${isDhcp ? '#319795' : '#b794f4'}; box-sizing: border-box;">
                <div class="metric-metadata">
                    <span class="storage-interactive-row-header">
                        <span class="storage-tag-icon">📡</span>
                        <span class="drive-title text-local">${adapter.Alias}</span>
                    </span>
                    <div class="cache-badge-deck">
                        <span class="hardware-stat-tag text-assignment">${adapter.Profile}</span>
                    </div>
                </div>
                
                <div style="font-size: 11px; font-family: monospace; color: #cbd5e0; margin-top: 6px; line-height: 1.4;">
                    IP Address: <strong>${adapter.IPAddress}</strong><br>
                    Subnet Mask: ${adapter.SubnetMask} (/${adapter.PrefixLength})<br>
                    Gateway    : ${adapter.Gateway}
                </div>

                <div class="hardware-metric-footer-row" style="border-top: 1px dashed #2d3748; padding-top: 8px; margin-top: 8px; display: flex; flex-direction: column; gap: 6px; align-items: stretch; justify-content: flex-start;">
                    <div style="display: flex; gap: 6px; align-items: center; width: 100%;">
                        <input type="text" id="drawer_ip_${index}" placeholder="Static IP" value="${isDhcp ? '' : adapter.IPAddress}" style="background-color: #2d3748; border: 1px solid #4a5568; color: #fff; font-family: 'Consolas', monospace; font-size: 11px; padding: 3px 6px; flex-grow: 1; min-width: 0; box-sizing: border-box; height: 23px;">
                        <button class="network-adapters-action-btn" onclick="ExecuteDrawerStaticProvisioning('${adapter.Alias}', ${index})" style="margin-left: 0 !important; height: 23px; padding: 2px 8px;">Set Static</button>
                    </div>
                    ${!isDhcp ? `<button class="network-adapters-action-btn" onclick="ExecuteDrawerDhcpRelease('${adapter.Alias}')" style="background-color: rgba(49, 151, 149, 0.1); border-color: #319795; color: #319795; width: 100%; text-align: center; height: 23px; padding: 2px 8px;">Revert to DHCP Auto</button>` : ''}
                </div>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', rowTemplateHtml);
    });
}
window.ExecuteDrawerStaticProvisioning = function(interfaceAlias, index) {
    const targetIp = document.getElementById(`drawer_ip_${index}`)?.value.trim();
    if (!targetIp) return alert("Error: A valid destination IP allocation layout is required.");

    const payload = { command: "SET_STATIC_IP", interfaceAlias: interfaceAlias, ipAddress: targetIp };
    if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(JSON.stringify(payload));
    }
};

window.ExecuteDrawerDhcpRelease = function(interfaceAlias) {
    const payload = { command: "TRIGGER_DHCP_REVERSION", interfaceAlias: interfaceAlias };
    if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(JSON.stringify(payload));
    }
};

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

window.TriggerNetworkSpeedAnalysis = function() {
    const btn = document.querySelector('.speed-execute-action-btn');
    if (btn) {
        btn.disabled = true;
        const originalText = btn.textContent;
        btn.textContent = "RUNNING...";
        
        if (window.chrome && window.chrome.webview) {
            window.chrome.webview.postMessage("Execute-SpeedTest");
        }
        
        setTimeout(() => {
            btn.disabled = false;
            btn.textContent = originalText;
        }, 15000);
    }
};

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
