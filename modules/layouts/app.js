// =========================================================================
// PRESENTATION INTERACTION ENGINE: DOM DATA EXTRACTION INTERCEPT ROUTINES
// =========================================================================

// Outbound Channel: Dispatches text events natively to the PowerShell process thread
function SetViewState(isExpanded) {
    document.getElementById('btnCompact').classList.toggle('active', !isExpanded);
    document.getElementById('btnExpanded').classList.toggle('active', isExpanded);
    
    // Toggle the visible status array across standard target dashboard components
    const elements = document.querySelectorAll('.expanded-content');
    elements.forEach(el => {
        el.classList.toggle('hidden', !isExpanded);
    });

    if (isExpanded) {
        window.chrome.webview.postMessage("Toggle-Diagnostics-On");
    } else {
        window.chrome.webview.postMessage("Toggle-Diagnostics-Off");
    }
}

function RequestStorageScan() {
    document.getElementById('lblStorageText').innerText = "Indexing localized directories...";
    
    // Context Shift: Hide the default Network Matrix layout and show the raw text log window box
    document.getElementById('lblConsoleHeader').innerText = "VOLUMETRIC FILE EXPLORER TRACK";
    document.getElementById('panelNetworkMatrix').classList.add('hidden');
    document.getElementById('panelConsoleOutput').classList.remove('hidden');
    document.getElementById('btnResetConsole').classList.remove('hidden');
    
    window.chrome.webview.postMessage("C-Drive-Clicked");
}

function RestoreNetworkView() {
    // Context Shift: Restores your clean local system network layout back to view state
    document.getElementById('lblConsoleHeader').innerText = "NETWORK SUB-CONSOLE";
    document.getElementById('panelConsoleOutput').classList.add('hidden');
    document.getElementById('btnResetConsole').classList.add('hidden');
    document.getElementById('panelNetworkMatrix').classList.remove('hidden');
}

// Inbound Channel: Landing targets populated directly via ExecuteScriptAsync invocations
function ReceiveSystemTelemetry(jsonDataString) {
    try {
        const data = JSON.parse(jsonDataString);
        
        // 1. Storage Element Update Actions
        if (data.DriveLetter === "C:") {
            document.getElementById('lblStorageText').innerText = `${data.FreeSpace} Free / ${data.TotalSpace}`;
            document.getElementById('barStorage').style.width = data.PercentUsed + "%";
            
            // Generate clean tree array directly inside Console Box frame
            let outputHtml = `<strong>[Volumetric Profile For Local System Partition ${data.DriveLetter} Parsed]:</strong><br/>`;
            for (const [groupName, byteSize] of Object.entries(data.Breakdown)) {
                outputHtml += `+-- Categorized asset allocation [${groupName}]: ${byteSize}<br/>`;
            }
            document.getElementById('panelConsoleOutput').innerHTML = outputHtml;
        }
    } catch (e) {
        console.error("Telemetry structural parse failed:", e);
    }
}
