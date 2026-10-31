// File: modules/layouts/app.js

// Global shortcut link to our direct native PowerShell Class object bridge
let nativeEngine = null;

// Initialize the Direct Bridge Interface connection on application boot
document.addEventListener("DOMContentLoaded", async () => {
    if (window.chrome && window.chrome.webview) {
        // Bind the native PowerShell class object cleanly to our JavaScript variable
        nativeEngine = window.chrome.webview.hostObjects.hardware;
        
        // 1. Instantly pull and paint all of our static properties (Runs once)
        await RenderStaticSystemProperties();

        // 2. Start our dynamic real-time data pulling loop (Ticks every 1000ms)
        setInterval(PollRealTimeHardwareMetrics, 1000);
    }
    
    // Smoothly clear out your splash screen layer
    DismissAppSplashScreen();
});

/**
 * PHASE 1: ROBUST STATIC PROPERTY RENDERING
 * Reads unchanging environmental strings directly from the class object fields.
 */
/**
 * PHASE 1: ROBUST STATIC PROPERTY RENDERING
 * Reads unchanging environmental strings directly from the class object fields.
 */
async function RenderStaticSystemProperties() {
    try {
        if (!nativeEngine) return;

        // FIXED: Added () to execute property retrieval over the secure host bridge channel
        SetDomText('lblHostName',       await nativeEngine.HostName());
        SetDomText('lblWorkgroup',      await nativeEngine.Workgroup());
        SetDomText('lblOsEdition',      await nativeEngine.OsEdition());
        SetDomText('lblCpuModel',       await nativeEngine.CpuModel());
        SetDomText('lblBiosVersion',    await nativeEngine.BiosVersion());
        SetDomText('lblPsVersion',      await nativeEngine.PsVersion());
        SetDomText('lblCpuDriver',      await nativeEngine.CpuDriverVersion());
        SetDomText('lblVirtualization',  await nativeEngine.Virtualization());
        SetDomText('lblSecureBoot',     await nativeEngine.SecureBoot());
        SetDomText('lblChassisType',    await nativeEngine.ChassisType());
        SetDomText('lblWinBuild',       await nativeEngine.WindowsBuild());
        SetDomText('lblUpdateLevel',    await nativeEngine.WindowsUpdateLevel());

    } catch (err) {
        console.error("Direct Bridge mapping initialization failure:", err);
    }
}

/**
 * PHASE 2: HIGH-FREQUENCY REAL-TIME METRICS POLLING
 * Reaches across the bridge, executes our PowerShell method, and paints the canvas.
 */
async function PollRealTimeHardwareMetrics() {
    try {
        if (!nativeEngine) return;

        // Execute the internal PowerShell Class Method natively on-demand!
        // WebView2 automatically unpacks the [hashtable] return payload into a clean JS Object.
        const stats = await nativeEngine.GetRealTimeMetrics();

        // 1. Process and Paint Core Processing Unit (CPU) Metrics
        SetDomText('lblCpuLoad', `${stats.CpuLoad}%`);
        SetDomStyleWidth('barCpuLoad', `${stats.CpuLoad}%`);

        // 2. Process and Paint Graphical Processing Unit (GPU) Metrics
        SetDomText('lblGpuLoad', `${stats.GpuLoad}%`);
        SetDomStyleWidth('barGpuLoad', `${stats.GpuLoad}%`);
        SetDomText('lblGpuModel', stats.GpuModel || "Display Adapter");
        SetDomText('lblGpuDriver', stats.GpuDriverVersion || "Unknown");

        // 3. Process and Paint Random Access Memory (RAM) Metrics
        SetDomText('lblRamUsage', stats.RamUsageText);
        SetDomStyleWidth('barRamUsage', `${stats.RamPercent}%`);

        // 4. Update Engine Operational System Lifespans
        SetDomText('lblUptime', stats.UptimeText);

    } catch (err) {
        console.error("Asynchronous hardware pipeline pull dropped cycle:", err);
    }
}

/**
 * EXTRA ACTION UTILITIES: Send messages back to native WinForms host
 */
function TriggerSystemExit() {
    if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage("Exit-App");
    }
}

function DismissAppSplashScreen() {
    const splashNode = document.getElementById('appSplashOverlayView');
    if (splashNode) {
        splashNode.classList.add('hidden-canvas');
        setTimeout(() => splashNode.remove(), 450);
    }
}

/**
 * ROBUST HELPERS: Keeps JavaScript from throwing "null element" crash errors
 */
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