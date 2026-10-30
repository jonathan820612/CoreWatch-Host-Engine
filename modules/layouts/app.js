// NATIVE METRICS MESSAGE INTERCEPTOR: Unpacks the native thread payload safely
if (window.chrome && window.chrome.webview) {
    window.chrome.webview.addEventListener('message', event => {
        if (event.data && typeof event.data === 'object' && !Array.isArray(event.data)) {
            UpdateLiveTelemetry(JSON.stringify(event.data));
        }
    });
}

function DismissAppSplashScreen() {
    const splashNode = document.getElementById('appSplashOverlayView');
    if (splashNode) {
        splashNode.classList.add('hidden-canvas');
        setTimeout(() => splashNode.remove(), 450);
    }
}

function TriggerSystemExit() {
    window.chrome.webview.postMessage("Exit-App");
}

function RequestStorageScan() {
    WriteLogString("Volumetric Scan Dispatched: Querying local filesystem node clusters targeting C:...");
    window.chrome.webview.postMessage("Request-Storage-Refresh");
}

function ReceiveStorageBase64(base64StringData) {
    try {
        const rawJsonText = decodeURIComponent(escape(window.atob(base64StringData)));
        RefreshStorageGrid(rawJsonText);
    } catch (err) {
        console.error("Base64 interaction data pipeline decode failure:", err);
    }
}

function PromptDriveRelabel(driveLetter, currentName) {
    const newLabel = prompt(`Enter new descriptive label for storage partition [${driveLetter}]:`, currentName);
    if (newLabel !== null) {
        WriteLogString(`Storage Action: Requesting partition relabel for ${driveLetter} -> "${newLabel}"`);
        window.chrome.webview.postMessage(`Update-Drive-Label:${driveLetter}|${newLabel}`);
    }
}

document.addEventListener("DOMContentLoaded", () => {
    setTimeout(() => {
        if (window.chrome && window.chrome.webview) {
            window.chrome.webview.postMessage("Request-Storage-Refresh");
        }
        DismissAppSplashScreen();
    }, 500);
});

function RefreshStorageGrid(jsonDataString) {
    try {
        const drives = JSON.parse(jsonDataString);
        const container = document.getElementById('storageVolumeContainer');
        if (!container) return;
        
        container.innerHTML = "";
        if (drives.length === 0) {
            container.innerHTML = `<div class="hint-text">No active storage block allocations mounted.</div>`;
            return;
        }
        
        drives.forEach(drive => {
            const driveBlock = document.createElement('div');
            driveBlock.className = "dynamic-storage-row";
            
            driveBlock.innerHTML = `
                <div class="storage-flex-row">
                    <span class="clickable-label" onclick="PromptDriveRelabel('${drive.DriveLetter}', '${drive.VolumeName}')" title="Click to rename drive partition">
                        ${drive.TypeLabel} (<strong>${drive.DriveLetter}</strong>) [${drive.VolumeName}]
                    </span>
                    <span class="storage-data-numeric-text">${drive.FreeSpace} Free / ${drive.TotalSpace}</span>
                </div>
                <div class="track-bg">
                    <div class="track-fill" style="width: ${drive.PercentUsed}%;"></div>
                </div>
            `;
            container.appendChild(driveBlock);
        });
        
        WriteLogString(`Storage Grid Updated: Enqueueing configuration profiles for ${drives.length} active volumes.`);
    } catch (e) {
        console.error("Failed to map dynamic storage data array:", e);
    }
}

function WriteLogString(textMessage) {
    const consoleBox = document.getElementById('panelConsoleOutput');
    if (!consoleBox) return;
    const timestamp = new Date().toLocaleTimeString();
    consoleBox.innerHTML += `<br/>[${timestamp}] ${textMessage}`;
    consoleBox.scrollTop = consoleBox.scrollHeight;
}

function ClearConsoleLogView() {
    document.getElementById('panelConsoleOutput').innerHTML = "[Console logs flushed by user operator context]";
}

function UpdateLiveTelemetry(jsonString) {
    try {
        const data = JSON.parse(jsonString);
        
        document.getElementById('lblCpuLoad').innerText = (data.CpuLoad || 0) + "%";
        document.getElementById('barCpuLoad').style.width = (data.CpuLoad || 0) + "%";
        
        document.getElementById('lblGpuLoad').innerText = (data.GpuLoad || 0) + "%";
        document.getElementById('barGpuLoad').style.width = (data.GpuLoad || 0) + "%";
        
        document.getElementById('lblRamUsage').innerText = data.RamUsageText || "Detecting RAM...";
        document.getElementById('barRamUsage').style.width = (data.RamPercent || 0) + "%";
        
        if(document.getElementById('lblHostName'))       document.getElementById('lblHostName').innerText = data.HostName || "HOST";
        if(document.getElementById('lblWorkgroup'))      document.getElementById('lblWorkgroup').innerText = data.Workgroup || "WORKGROUP";
        if(document.getElementById('lblOsEdition'))     document.getElementById('lblOsEdition').innerText = data.OsEdition || "Windows OS";
        if(document.getElementById('lblCpuModel'))      document.getElementById('lblCpuModel').innerText = data.CpuModel || "Processor Core";
        if(document.getElementById('lblGpuModel'))      document.getElementById('lblGpuModel').innerText = data.GpuModel || "Display Adapter";
        if(document.getElementById('lblPowerPlan'))     document.getElementById('lblPowerPlan').innerText = data.PowerPlan || "Balanced Plan";
        if(document.getElementById('lblVirtualization')) document.getElementById('lblVirtualization').innerText = data.Virtualization || "Off";
        if(document.getElementById('lblPsVersion'))      document.getElementById('lblPsVersion').innerText = data.PsVersion || "7.x";
        if(document.getElementById('lblSecureBoot'))     document.getElementById('lblSecureBoot').innerText = data.SecureBoot || "Off";
        if(document.getElementById('lblMotherboard'))    document.getElementById('lblMotherboard').innerText = data.BiosVersion || "Loading BIOS...";
        if(document.getElementById('lblChassisType'))    document.getElementById('lblChassisType').innerText = data.ChassisType || "Custom PC";
        if(document.getElementById('lblUptime'))         document.getElementById('lblUptime').innerText = data.UptimeText || "0d 0h 00m";

        if(document.getElementById('lblWinBuild'))     document.getElementById('lblWinBuild').innerText = data.WindowsBuild || "Unknown";
        if(document.getElementById('lblUpdateLevel')) document.getElementById('lblUpdateLevel').innerText = data.WindowsUpdateLevel || "Unknown";
        if(document.getElementById('lblDirectX'))     document.getElementById('lblDirectX').innerText = data.DirectXVersion || "Unknown";
        if(document.getElementById('lblCpuDriver'))   document.getElementById('lblCpuDriver').innerText = data.CpuDriverVersion || "Unknown";
        if(document.getElementById('lblGpuDriver'))   document.getElementById('lblGpuDriver').innerText = data.GpuDriverVersion || "Unknown";
        if(document.getElementById('lblNetDriver'))   document.getElementById('lblNetDriver').innerText = data.NetworkDriverVersion || "Unknown";

        if(document.getElementById('lblNetIp'))        document.getElementById('lblNetIp').innerText = data.PrivateIp || "0.0.0.0";
        if(document.getElementById('lblNetMask'))      document.getElementById('lblNetMask').innerText = data.SubnetMask || "0.0.0.0";
        if(document.getElementById('lblNetGateway'))   document.getElementById('lblNetGateway').innerText = data.Gateway || "0.0.0.0";
        if(document.getElementById('lblPublicIp'))     document.getElementById('lblPublicIp').innerText = data.PublicIp || "Resolving...";
        if(document.getElementById('lblNetProfile'))   document.getElementById('lblNetProfile').innerText = data.NetProfile || "Private";
        if(document.getElementById('lblNetDiscovery')) document.getElementById('lblNetDiscovery').innerText = data.NetDiscovery || "Off";
        if(document.getElementById('lblWlanSsid'))     document.getElementById('lblWlanSsid').innerText = data.WifiState || "Disconnected";
        if(document.getElementById('lblLinkSpeed'))     document.getElementById('lblLinkSpeed').innerText = data.LinkSpeed || "1 Gbps";

    } catch (e) {
        console.error("Async runtime data injection error:", e);
    }
}
