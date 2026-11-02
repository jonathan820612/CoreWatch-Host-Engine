// File: modules/layouts/app.js

document.addEventListener("DOMContentLoaded", () => {
    if (window.chrome && window.chrome.webview) {
        window.chrome.webview.addEventListener("message", (event) => {
            try {
                const base64Data = event.data;
                if (!base64Data) return;

                const decodedJson = decodeURIComponent(escape(atob(base64Data)));
                const stats = JSON.parse(decodedJson);
                
                AppendLiveDiagnosticConsoleLog(stats);
                updateDashboardUiMesh(stats);
            } catch (err) {
                console.error("Failed to unpack metrics package:", err);
            }
        });
        window.chrome.webview.postMessage("UI-Ready");
    }
});

function updateDashboardUiMesh(stats) {
    if (!stats) return;

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

       // --- NetworkFrame Mapping ---
    const net = stats.NetworkFrame;
    if (net) {
        SetDomText('lblIntIPv4',        net.IntIPv4);
        SetDomText('lblSubnetMask',     net.SubnetMask);
        SetDomText('lblGateway',        net.Gateway);
        SetDomText('lblNetworkStatus',  net.NetworkStatus);
        SetDomText('lblWlanSsid',       net.WlanSsid);
        SetDomText('lblExtIPv4',        net.ExtIPv4);
        SetDomText('lblLinkCap',        net.LinkCap);
        SetDomText('lblInterfaceName',  net.InterfaceName);
    }

    // --- StorageFrame Mapping ---
    const storage = stats.StorageFrame;
    if (storage) {
        const container = document.getElementById('storageVolumeContainer');
        if (container) {
            container.innerHTML = '';
            
            // Fixed loop variable reference map
            const drives = Array.isArray(storage) ? storage : [storage];
            
            drives.forEach((drive) => {
                const usedPercent = (drive.StorageUsedGB / drive.StorageTotalGB) * 100;
                const metricRowHtml = `
                    <div class="metric-row storage-tight-row">
                        <div class="metric-metadata">
                            <span class="clickable-label" onclick="TriggerVolumeRelabel('${drive.MainDriveLetter}', '${drive.VolumeLabel}')">
                                🏷️ ${drive.VolumeLabel} (${drive.MainDriveLetter})
                            </span>
                            <span class="storage-data-numeric-text">
                                ${drive.StorageUsedGB} / ${drive.StorageTotalGB} GB (${Math.round(usedPercent)}%)
                            </span>
                        </div>
                        <div class="track-bg">
                            <div class="track-fill" style="width: ${usedPercent}%;"></div>
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
    const consoleBox = document.querySelector('.console-box') || document.getElementById('console-box');
    if (consoleBox && stats.IdentityFrame && stats.SystemFrame) {
        consoleBox.innerText = `[PIPELINE: ${stats.PipelineStatus}] Host: ${stats.IdentityFrame.HostName} | CPU Load: ${stats.SystemFrame.CpuLoad}% | RAM: ${stats.SystemFrame.RamUsageText}`;
    }
}

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

/**
 * INTERACTIVE BI-DIRECTIONAL HARDWARE DISPATCH ROUTINE
 */
function TriggerVolumeRelabel(driveLetter, currentLabel) {
    const newLabel = prompt(`Enter a new system description label for volume partition [ ${driveLetter} ] :`, currentLabel);
    if (newLabel !== null && window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(`Rename-Drive:${driveLetter}|${newLabel}`);
    }
}
