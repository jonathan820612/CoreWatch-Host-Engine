// File: modules/layouts/app.js - PART 1 (Lines 1 - 200)

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
                    // Check if it appears to be raw JSON instead of Base64
                    if (payload.trim().startsWith('{') || payload.trim().startsWith('[')) {
                        stats = JSON.parse(payload);
                    } else {
                        // Safe extraction path for Base64 telemetry streams
                        try {
                            const decodedJson = decodeURIComponent(escape(atob(payload)));
                            stats = JSON.parse(decodedJson);
                        } catch (base64Err) {
                            console.warn("[PIPELINE] String received is not Base64; checking for raw route execution:", payload);
                            return; // Halts processing for discrete non-JSON actions
                        }
                    }
                }

                // Route data down to core visual meshes if layout parameters exist
                if (stats && (stats.IdentityFrame || stats.SystemFrame || stats.StorageFrame || stats.NetworkFrame)) {
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

/**
 * Requests the application host infrastructure to spin up an isolated window for a specific utility module
 */
window.LaunchExternalToolWindow = function(toolIdentifier) {
    if (window.chrome && window.chrome.webview) {
        // Dispatches single string action routing event payloads downstream
        window.chrome.webview.postMessage(`Launch-Tool:${toolIdentifier}`);
    }
    
    // Fallback confirmation console string log output tracer
    console.log(`[INFRASTRUCTURE: Window allocation request submitted for component module: ${toolIdentifier}]`);
};

/**
 * Automatically evaluates the state object returned from your telemetry loop updates 
 * to highlight top button elements if background worker processes are running.
 */
function SyncToolNavigationHighlights(appStates) {
    const watchdogBtn = document.getElementById('btnToggleWatchdog');
    
    if (watchdogBtn && appStates.NetworkFrame) {
        // Evaluate incoming state flags passed from your background Watchdog pipeline loop
        if (appStates.NetworkFrame.WatchdogActive === true || appStates.WatchdogLoopRunning === true) {
            watchdogBtn.classList.add('tool-running');
        } else {
            watchdogBtn.classList.remove('tool-running');
        }
    }
}

window.chrome.webview.addEventListener("message", (event) => {
    try {
        const payload = event.data;
        if (!payload) return;
        
        const decodedJson = decodeURIComponent(escape(atob(payload)));
        let dataMesh = JSON.parse(decodedJson);
        
        if (dataMesh.NetworkFrame) {
            dataMesh = typeof dataMesh.NetworkFrame === 'string' ? JSON.parse(dataMesh.NetworkFrame) : dataMesh.NetworkFrame;
        }
        
        if (dataMesh.type === "REFRESH_ADAPTER_STATE") {
            // CRITICAL PIPELINE PROTECTION: Only attempt to render if this window context actually owns the rendering mesh
            if (typeof RenderNetworkAdapterInterfaceRows === "function") {
                RenderNetworkAdapterInterfaceRows(dataMesh.interfaces);
            } else {
                console.log("[PIPELINE] Network data frame intercepted safely inside non-target window layout.");
            }
        }
    } catch(err) {
        console.error("Failed to process network adapter update frame:", err);
    }
});

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
        // Top Card Elements (System Identity)
        SetDomText('lblOsEdition',      infra.OsEdition);
        SetDomText('lblWinBuild',       infra.WindowsBuild);
        SetDomText('lblUpdateLevel',    infra.WindowsUpdateLevel);
        SetDomText('lblDirectX',        infra.DirectX);
        SetDomText('lblVirtualization', infra.Virtualization);
        SetDomText('lblPsVersion',      infra.PsVersion);

        // Middle Card Elements (Infrastructure)
        SetDomText('lblMotherboard',    infra.Motherboard);
        SetDomText('lblBiosVersion',    infra.BiosVersion);
        SetDomText('lblPowerPlan',      infra.PowerPlan);
        SetDomText('lblUptime',         infra.UptimeText);

        // Audio Sub-Section Nodes
        SetDomText('lblAudioOutput',    infra.SoundCardIdentity);
        SetDomText('lblAudioInput',     infra.MicrophoneIdentity);
    }

    // --- SystemFrame Mapping ---
    const sys = stats.SystemFrame;
    if (sys) {
        // Core Processor Nodes
        SetDomText('lblCpuLoad',        `${sys.CpuLoad}%`);
        SetDomStyleWidth('barCpuLoad',  `${sys.CpuLoad}%`);
        SetDomText('lblCpuClock',       sys.CpuClock);
        SetDomText('lblCpuTemp',        sys.CpuTemp);

        // Update CPU Temperature Badge Threshold Color Scheme
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
// File: modules/layouts/app.js - PART 2 (Lines 201 - 400)

        // Graphics Accelerator Nodes
        SetDomText('lblGpuLoad',        `${sys.GpuLoad}%`);
        SetDomStyleWidth('barGpuLoad',  `${sys.GpuLoad}%`);
        SetDomText('lblGpuModel',       sys.GpuModel);
        SetDomText('lblGpuDriver',      sys.GpuDriverVersion);
        SetDomText('lblGpuPower',       sys.GpuPower);
        SetDomText('lblGpuTemp',        sys.GpuTemp);

        // Update GPU Temperature Badge Threshold Color Scheme
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

        // System Memory Rails (Physical RAM)
        SetDomText('lblRamUsage',       sys.RamUsageText);
        SetDomStyleWidth('barRamUsage', `${sys.RamPercent}%`);

        // Windows Virtual Memory Rails (Pagefile Commitments)
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
        
        // Dynamic Fallback Scanner for Receive (Rx) Text Node
        const rxValue = net.RxText || "0.00 KB/s";
        const rxElem = document.getElementById('lblNetRxValue') || document.getElementById('lblNetRx') || document.querySelector('.rx-numeric-text');
        if (rxElem) { rxElem.innerText = rxValue; }
        
        // Dynamic Fallback Scanner for Transmit (Tx) Text Node
        const txValue = net.TxText || "0.00 KB/s";
        const txElem = document.getElementById('lblNetTxValue') || document.getElementById('lblNetTx') || document.querySelector('.tx-numeric-text');
        if (txElem) { txElem.innerText = txValue; }
        
        // Maps tracking bars accurately within their exact 50% section blocks
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
            
            // SORT ENGINE: Moves "Removable" nodes to the bottom
            drives.sort((a, b) => {
                if (a.DriveType === "Removable" && b.DriveType !== "Removable") return 1;
                if (a.DriveType !== "Removable" && b.DriveType === "Removable") return -1;
                return 0;
            });
            
            drives.forEach((drive) => {
                const usedPercent = (drive.StorageUsedGB / drive.StorageTotalGB) * 100;
                const isRemovable = drive.DriveType === "Removable";
                
                // Unified Theme Colors
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

function AppendLiveDiagnosticConsoleLog(stats) {
    const consoleBox = document.getElementById('console-box') || document.querySelector('.console-box');
    if (consoleBox && stats.IdentityFrame && stats.SystemFrame) {
        consoleBox.textContent = `[PIPELINE: ${stats.PipelineStatus}] Host: ${stats.IdentityFrame.HostName} | CPU Load: ${stats.SystemFrame.CpuLoad}% | RAM: ${stats.SystemFrame.RamUsageText}`;
    }
}
// File: modules/layouts/app.js - PART 3 (Lines 401 - End)

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
