// =========================================================================
// APPLICATION TAB NAVIGATION AND VIEW-SWITCHING CONTROLLER (GLOBAL BIND)
// =========================================================================
window._activeViewKey = 'dashboard';

window.SwitchAppLayoutView = function(targetViewId) {
    const requested = targetViewId || 'dashboard';
    if (requested !== 'dashboard' && typeof IsModuleEnabled === 'function' && !IsModuleEnabled(requested)) {
        if (typeof AppendConsoleLogEntry === 'function') {
            AppendConsoleLogEntry(`[MODULES] '${requested}' is disabled or not installed. Open ⚙️ Settings → Modules & Tabs to enable it.`);
        }
        targetViewId = 'dashboard';
    }
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
        github: document.getElementById('viewGitHubPanel'),
        jira: document.getElementById('viewJiraPanel'),
        security: document.getElementById('viewSecurityRepairPanel'),
        profiles: document.getElementById('viewProfilesPanel'),
        alerts: document.getElementById('viewSmartAlertsPanel'),
        updates: document.getElementById('viewUpdateCenterPanel'),
        snapshots: document.getElementById('viewSnapshotsPanel'),
        battery: document.getElementById('viewBatteryPanel'),
        backupsync: document.getElementById('viewBackupSyncPanel'),
        docker: document.getElementById('viewDockerPanel'),
        sshcerts: document.getElementById('viewSshCertsPanel'),
        homelab: document.getElementById('viewHomelabPanel')
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
        github: document.getElementById('tabGitHubManager'),
        jira: document.getElementById('tabJiraManager'),
        security: document.getElementById('tabSecurityRepair'),
        profiles: document.getElementById('tabProfiles'),
        alerts: document.getElementById('tabSmartAlerts'),
        updates: document.getElementById('tabUpdateCenter'),
        snapshots: document.getElementById('tabSnapshots'),
        battery: document.getElementById('tabBatteryPeripherals'),
        backupsync: document.getElementById('tabBackupSync'),
        docker: document.getElementById('tabDockerServices'),
        sshcerts: document.getElementById('tabSshCerts'),
        homelab: document.getElementById('tabHomelab')
    };

    Object.values(panels).forEach(p => { if (p) p.style.display = 'none'; });
    Object.values(buttons).forEach(b => { if (b) b.classList.remove('active'); });

    // Auto-pause Tasks & Ports live refresh whenever leaving that tab
    if (targetViewId !== 'tasksports' && window._tpLiveWatchTimer) {
        StopTasksPortsLiveWatch();
    }
    if (targetViewId !== 'homelab' && window._homelabTimer) {
        clearInterval(window._homelabTimer);
        window._homelabTimer = null;
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
        profiles: '⚡ Profiles',
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

    // Close Ops & Guard dropdown and update grouped trigger label/active highlight
    const opsDrop = document.getElementById('navOpsDropdown');
    const opsTrigger = document.getElementById('tabOpsMenu');
    const opsLabel = document.getElementById('lblOpsMenuText');
    if (opsDrop) opsDrop.classList.remove('open');
    if (opsTrigger) {
        opsTrigger.classList.remove('active');
        opsTrigger.setAttribute('aria-expanded', 'false');
    }
    const opsMenuLabels = {
        alerts: '🔔 Alerts',
        updates: '🔄 Updates',
        snapshots: '📸 Snapshots',
        backupsync: '💾 Backup',
        battery: '🔋 Battery',
        security: '🛡️ Security'
    };
    if (opsMenuLabels[targetViewId]) {
        if (opsTrigger) opsTrigger.classList.add('active');
        if (opsLabel) opsLabel.textContent = opsMenuLabels[targetViewId];
    } else if (opsLabel) {
        opsLabel.textContent = '🛡️ Ops & Guard';
    }

    // Close Dev & Work dropdown and update grouped trigger label/active highlight
    const devDrop = document.getElementById('navDevDropdown');
    const devTrigger = document.getElementById('tabDevMenu');
    const devLabel = document.getElementById('lblDevMenuText');
    if (devDrop) devDrop.classList.remove('open');
    if (devTrigger) {
        devTrigger.classList.remove('active');
        devTrigger.setAttribute('aria-expanded', 'false');
    }
    const devMenuLabels = {
        github: '🐙 GitHub',
        jira: '📋 Jira',
        wsl: '🐧 WSL',
        docker: '🐳 Docker',
        sshcerts: '🔐 SSH/Certs',
        homelab: '🌐 Homelab'
    };
    if (devMenuLabels[targetViewId]) {
        if (devTrigger) devTrigger.classList.add('active');
        if (devLabel) devLabel.textContent = devMenuLabels[targetViewId];
    } else if (devLabel) {
        devLabel.textContent = '💻 Dev & Work';
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
    else if (targetViewId === 'profiles') {
        if (panels.profiles) panels.profiles.style.display = 'flex';
        if (buttons.profiles) buttons.profiles.classList.add('active');
        RequestProfilesState();
    }
    else if (targetViewId === 'github') {
        if (panels.github) panels.github.style.display = 'flex';
        if (buttons.github) buttons.github.classList.add('active');
        if (!window._ghManagerLoaded) {
            RequestGitHubManagerState();
        }
    }
    else if (targetViewId === 'jira') {
        if (panels.jira) panels.jira.style.display = 'flex';
        if (buttons.jira) buttons.jira.classList.add('active');
        if (!window._jiraManagerLoaded) {
            RequestJiraManagerState();
        }
    }
    else if (targetViewId === 'alerts') {
        if (panels.alerts) panels.alerts.style.display = 'flex';
        if (buttons.alerts) buttons.alerts.classList.add('active');
        RequestSmartAlertsState();
    }
    else if (targetViewId === 'updates') {
        if (panels.updates) panels.updates.style.display = 'flex';
        if (buttons.updates) buttons.updates.classList.add('active');
        if (!window._updatesLoaded) RequestUpdateCenterState(false);
    }
    else if (targetViewId === 'snapshots') {
        if (panels.snapshots) panels.snapshots.style.display = 'flex';
        if (buttons.snapshots) buttons.snapshots.classList.add('active');
        RequestSnapshotsState();
    }
    else if (targetViewId === 'battery') {
        if (panels.battery) panels.battery.style.display = 'flex';
        if (buttons.battery) buttons.battery.classList.add('active');
        RequestBatteryState();
    }
    else if (targetViewId === 'backupsync') {
        if (panels.backupsync) panels.backupsync.style.display = 'flex';
        if (buttons.backupsync) buttons.backupsync.classList.add('active');
        RequestBackupSyncState();
    }
    else if (targetViewId === 'docker') {
        if (panels.docker) panels.docker.style.display = 'flex';
        if (buttons.docker) buttons.docker.classList.add('active');
        RequestDockerState();
    }
    else if (targetViewId === 'sshcerts') {
        if (panels.sshcerts) panels.sshcerts.style.display = 'flex';
        if (buttons.sshcerts) buttons.sshcerts.classList.add('active');
        RequestSshCertsState();
    }
    else if (targetViewId === 'homelab') {
        if (panels.homelab) panels.homelab.style.display = 'flex';
        if (buttons.homelab) buttons.homelab.classList.add('active');
        RequestHomelabState(false);
        OnHomelabAutoRefreshChange();
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
    else if (msgType === "UI_SETTINGS_STATE") {
        ApplyHostUiSettingsState(stats);
    }
    else if (msgType === "UI_WINDOW_STATE") {
        SyncWindowPinAndOpacityUi(stats.alwaysOnTop, stats.opacity, stats.windowLockMode);
    }
    else if (msgType === "APP_SETTINGS_STATE") {
        ApplyAppSettingsState(stats);
    }
    else if (msgType === "APP_UPDATE_STATUS") {
        HandleAppUpdateStatus(stats);
    }
    else if (msgType === "BROWSE_FILE_RESULT") {
        HandleBrowseFileResult(stats);
    }
    else if (msgType === "OPEN_SETTINGS_MODAL") {
        OpenSettingsModal();
    }
    else if (msgType === "PROFILES_STATE") {
        RenderProfilesState(stats);
    }
    else if (msgType === "PROFILES_CAPTURED_SNAPSHOT") {
        OpenProfileEditorFromSnapshot(stats.snapshot);
    }
    else if (msgType === "PROFILES_NOTICE") {
        HandleProfilesNotice(stats);
    }
    else if (msgType === "GITHUB_MANAGER_STATE") {
        RenderGitHubManagerState(stats);
    }
    else if (msgType === "GITHUB_RELEASES_STATE") {
        RenderGitHubReleasesState(stats);
    }
    else if (msgType === "GITHUB_GENERATED_NOTES") {
        ApplyGitHubGeneratedNotes(stats);
    }
    else if (msgType === "GITHUB_NOTICE") {
        HandleGitHubNotice(stats);
    }
    else if (msgType === "JIRA_MANAGER_STATE") {
        RenderJiraManagerState(stats);
    }
    else if (msgType === "JIRA_ISSUE_DETAIL") {
        RenderJiraIssueDetail(stats);
    }
    else if (msgType === "JIRA_NOTICE") {
        HandleJiraNotice(stats);
    }
    else if (msgType === "THEME_BG_IMAGE_SELECTED") {
        HandleThemeBgImageSelected(stats);
    }
    else if (msgType === "THEME_IMPORTED") {
        HandleThemeImported(stats);
    }
    else if (msgType === "THEME_NOTICE") {
        HandleThemeNotice(stats);
    }
    else if (msgType === "SMART_ALERTS_STATE") {
        RenderSmartAlertsState(stats);
    }
    else if (msgType === "UPDATE_CENTER_STATE") {
        RenderUpdateCenterState(stats);
    }
    else if (msgType === "UPDATE_CENTER_NOTICE") {
        SetUpdateCenterStatus(stats.error || stats.message || '', !stats.ok || !!stats.error);
    }
    else if (msgType === "SNAPSHOTS_STATE") {
        RenderSnapshotsState(stats);
    }
    else if (msgType === "SNAPSHOTS_DIFF_RESULT") {
        RenderSnapshotsDiffResult(stats);
    }
    else if (msgType === "SNAPSHOTS_NOTICE") {
        SetSnapshotsStatus(stats.error || stats.message || '', !stats.ok || !!stats.error);
    }
    else if (msgType === "BATTERY_PERIPHERALS_STATE") {
        RenderBatteryPeripheralsState(stats);
    }
    else if (msgType === "BATTERY_NOTICE") {
        SetBatteryStatus(stats.error || stats.message || '', !stats.ok || !!stats.error);
    }
    else if (msgType === "BACKUP_SYNC_STATE") {
        RenderBackupSyncState(stats);
    }
    else if (msgType === "BACKUP_RUN_OUTPUT") {
        RenderBackupRunOutput(stats);
    }
    else if (msgType === "BACKUP_NOTICE") {
        SetBackupStatus(stats.error || stats.message || '', !stats.ok || !!stats.error);
    }
    else if (msgType === "DOCKER_SERVICES_STATE") {
        RenderDockerState(stats);
    }
    else if (msgType === "DOCKER_LOGS_RESULT") {
        RenderDockerLogs(stats);
    }
    else if (msgType === "DOCKER_NOTICE") {
        SetDockerStatus(stats.error || stats.message || '', !stats.ok || !!stats.error);
    }
    else if (msgType === "SSH_CERTS_STATE") {
        RenderSshCertsState(stats);
    }
    else if (msgType === "SSH_CERTS_NOTICE") {
        SetSshCertsStatus(stats.error || stats.message || '', !stats.ok || !!stats.error);
    }
    else if (msgType === "HOMELAB_STATE") {
        RenderHomelabState(stats);
    }
    else if (msgType === "HOMELAB_NODE_POLLED") {
        RenderHomelabSingleNodePolled(stats);
    }
    else if (msgType === "HOMELAB_NOTICE") {
        SetHomelabStatus(stats.error || stats.message || '', !stats.ok || !!stats.error);
    }
    else if (msgType === "TELEMETRY_PAUSE_STATE") {
        HandleTelemetryPauseState(stats);
    }
    else if (msgType === "DISKPART_STATE") {
        RenderDiskPartitionerState(stats);
    }
    else if (msgType === "DISKPART_NOTICE") {
        SetDiskPartStatus(stats.error || stats.message || '', !stats.ok || !!stats.error);
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

function FormatCoreWatchTempDisplay(rawTemp) {
    const num = Number(rawTemp);
    const unit = (window._cwAppSettings && window._cwAppSettings.telemetry && window._cwAppSettings.telemetry.temperatureUnit === 'F') ? 'F' : 'C';
    if (!Number.isFinite(num)) return { text: rawTemp, unitText: `°${unit}`, rawC: NaN };
    const shown = unit === 'F' ? Math.round((num * 9 / 5) + 32) : Math.round(num);
    return { text: String(shown), unitText: `°${unit}`, rawC: num };
}

function updateFastTelemetryMesh(stats) {
    const dockEl = document.getElementById('sideTelemetryDock');
    const isSideDockOpen = !!(dockEl && dockEl.style.display !== 'none');
    if (!stats || (window._activeViewKey !== 'dashboard' && !isSideDockOpen)) return;

    const sys = stats.SystemFrame;
    if (sys) {
        SetDomText('lblCpuLoad', `${sys.CpuLoad}%`);
        SetDomStyleWidth('barCpuLoad', `${sys.CpuLoad}%`);
        if (sys.CpuClock) SetDomText('lblCpuClock', sys.CpuClock);
        if (sys.CpuTemp !== undefined && sys.CpuTemp !== null) {
            window._cwLastRawCpuTemp = sys.CpuTemp;
            const ct = FormatCoreWatchTempDisplay(sys.CpuTemp);
            SetDomText('lblCpuTemp', ct.text);
            SetDomText('lblCpuTempUnit', ct.unitText);
            const cpuBadge = document.getElementById('badgeCpuTemp');
            if (cpuBadge) {
                cpuBadge.classList.toggle('therm-hot', Number.isFinite(ct.rawC) && ct.rawC >= 75);
                cpuBadge.classList.toggle('therm-cool', !Number.isFinite(ct.rawC) || ct.rawC < 75);
                if (sys.CpuTempSource) cpuBadge.title = sys.CpuTempSource;
                const needsPawnIo = !Number.isFinite(ct.rawC) && sys.LhmBundled === true && sys.PawnIoInstalled === false;
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
            window._cwLastRawGpuTemp = sys.GpuTemp;
            const gt = FormatCoreWatchTempDisplay(sys.GpuTemp);
            SetDomText('lblGpuTemp', gt.text);
            SetDomText('lblGpuTempUnit', gt.unitText);
            const gpuBadge = document.getElementById('badgeGpuTemp');
            if (gpuBadge) {
                gpuBadge.classList.toggle('therm-hot', Number.isFinite(gt.rawC) && gt.rawC >= 75);
                gpuBadge.classList.toggle('therm-cool', !Number.isFinite(gt.rawC) || gt.rawC < 75);
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
        window._cwLastRawCpuTemp = sys.CpuTemp;
        const ctFull = FormatCoreWatchTempDisplay(sys.CpuTemp);
        SetDomText('lblCpuTemp',        ctFull.text);
        SetDomText('lblCpuTempUnit',    ctFull.unitText);
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

        const cpuBadge = document.getElementById('badgeCpuTemp');
        if (cpuBadge) {
            cpuBadge.classList.toggle('therm-hot', Number.isFinite(ctFull.rawC) && ctFull.rawC >= 75);
            cpuBadge.classList.toggle('therm-cool', !Number.isFinite(ctFull.rawC) || ctFull.rawC < 75);
            if (sys.CpuTempSource) cpuBadge.title = sys.CpuTempSource;
            const needsPawnIo = !Number.isFinite(ctFull.rawC) && sys.LhmBundled === true && sys.PawnIoInstalled === false;
            cpuBadge.style.cursor = needsPawnIo ? 'pointer' : '';
            cpuBadge.onclick = needsPawnIo ? TriggerInstallPawnIo : null;
        }

        SetDomText('lblGpuLoad',        `${sys.GpuLoad}%`);
        SetDomStyleWidth('barGpuLoad',  `${sys.GpuLoad}%`);
        SetDomText('lblGpuModel',       sys.GpuModel);
        SetDomText('lblGpuDriver',      sys.GpuDriverVersion);
        SetDomText('lblGpuPower',       sys.GpuPower);
        window._cwLastRawGpuTemp = sys.GpuTemp;
        const gtFull = FormatCoreWatchTempDisplay(sys.GpuTemp);
        SetDomText('lblGpuTemp',        gtFull.text);
        SetDomText('lblGpuTempUnit',    gtFull.unitText);

        const gpuBadge = document.getElementById('badgeGpuTemp');
        if (gpuBadge) {
            gpuBadge.classList.toggle('therm-hot', Number.isFinite(gtFull.rawC) && gtFull.rawC >= 75);
            gpuBadge.classList.toggle('therm-cool', !Number.isFinite(gtFull.rawC) || gtFull.rawC < 75);
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
        const lockMode = window._cwWindowLockMode || 'none';
        if (lockMode === 'all') return null;

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

        let hitObj = null;
        if ((onTop && inLeftCorner) || (onLeft && inTopCorner))         hitObj = { hit: 13, cursor: 'nw-resize' }; // HTTOPLEFT
        else if ((onTop && inRightCorner) || (onRight && inTopCorner))  hitObj = { hit: 14, cursor: 'ne-resize' }; // HTTOPRIGHT
        else if ((onBottom && inLeftCorner) || (onLeft && inBottomCorner)) hitObj = { hit: 16, cursor: 'sw-resize' }; // HTBOTTOMLEFT
        else if ((onBottom && inRightCorner) || (onRight && inBottomCorner)) hitObj = { hit: 17, cursor: 'se-resize' }; // HTBOTTOMRIGHT
        else if (onLeft)   hitObj = { hit: 10, cursor: 'w-resize' };  // HTLEFT
        else if (onRight)  hitObj = { hit: 11, cursor: 'e-resize' };  // HTRIGHT
        else if (onTop)    hitObj = { hit: 12, cursor: 'n-resize' };  // HTTOP
        else if (onBottom) hitObj = { hit: 15, cursor: 's-resize' };  // HTBOTTOM

        // When Position is locked, only allow Right (11), Bottom (15), and Bottom-Right (17)
        // so width/height can resize without shifting the top-left (X, Y) window position.
        if (hitObj && lockMode === 'position' && ![11, 15, 17].includes(hitObj.hit)) {
            return null;
        }
        return hitObj;
    }

    const headerDeck = document.querySelector('.app-header-deck');
    if (headerDeck && window.chrome && window.chrome.webview) {
        headerDeck.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            if ((window._cwWindowLockMode || 'none') !== 'none') return;
            if (DetectWindowEdgeHit(e.clientX, e.clientY)) return;
            if (e.target.closest('.tab-btn') || e.target.closest('.exit-system-btn') || e.target.closest('.nav-dropdown')) return;
            e.preventDefault();
            window.chrome.webview.postMessage('Window-DragStart');
        });

        headerDeck.addEventListener('dblclick', (e) => {
            if ((window._cwWindowLockMode || 'none') !== 'none') return;
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

function ConfirmDestructiveAction(message) {
    if (window._cwAppSettings && window._cwAppSettings.general && window._cwAppSettings.general.confirmDestructiveActions === false) {
        return true;
    }
    return confirm(message);
}

window.TriggerOrientationChange = function(deviceName, targetCode, previousCode) {
    if (!deviceName || !Number.isFinite(targetCode) || targetCode < 0 || targetCode > 3) return;
    if (Number.isFinite(previousCode) && targetCode === previousCode) return;
    const labels = ['Landscape', 'Portrait', 'Landscape (Flipped)', 'Portrait (Flipped)'];
    const label = labels[targetCode] || 'Landscape';
    const sel = document.querySelector('#lblMonOrientation select.infra-refresh-select');
    if (!ConfirmDestructiveAction(`Rotate display (${deviceName}) to ${label}?`)) {
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
    if (!ConfirmDestructiveAction(msg)) return;
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
    header.innerHTML = `<span>⚠️ ${issueDevs.length} Missing / Problematic Driver${issueDevs.length > 1 ? 's' : ''} Detected — Quick Download &amp; Fix Links</span><span style="font-weight:400; color:var(--cw-text-secondary);">Click any official portal below</span>`;
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
    } else if (data.target === 'settings_projects') {
        const inp = document.getElementById('inpSetProjectsRoot');
        if (inp) inp.value = data.path;
    } else if (data.target === 'settings_exports') {
        const inp = document.getElementById('inpSetExportsRoot');
        if (inp) inp.value = data.path;
    } else if (data.target === 'settings_wsl') {
        const inp = document.getElementById('inpSetWslRoot');
        if (inp) inp.value = data.path;
    } else if (data.target === 'settings_organizer') {
        const inp = document.getElementById('inpSetOrgDestRoot');
        if (inp) inp.value = data.path;
    } else if (data.target === 'github_clone_dest') {
        const inp = document.getElementById('inpGhCloneDest');
        if (inp) inp.value = data.path;
    } else if (data.target === 'github_projects_root') {
        const inp = document.getElementById('inpGhProjectsRoot');
        if (inp) inp.value = data.path;
        ScanGitHubProjectsRoot();
    } else if (data.target === 'backup_source') {
        const inp = document.getElementById('inpBkpSource');
        if (inp) inp.value = data.path;
    } else if (data.target === 'backup_dest') {
        const inp = document.getElementById('inpBkpDest');
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
window._diagXDismissed = { findings: {}, signatures: {}, events: {} };

const DIAGX_STORAGE_KEY = 'corewatch_ultimadiagx_extlogs_v1';
const DIAGX_DISMISSED_STORAGE_KEY = 'corewatch_diagx_dismissed_v1';

function NormalizeDiagXDismissed(raw) {
    const out = { findings: {}, signatures: {}, events: {} };
    if (!raw || typeof raw !== 'object') return out;
    ['findings', 'signatures', 'events'].forEach(bucket => {
        const src = raw[bucket];
        if (src && typeof src === 'object' && !Array.isArray(src)) {
            Object.entries(src).forEach(([k, v]) => {
                if (v && typeof v === 'object') {
                    out[bucket][String(k)] = {
                        label: String(v.label || k),
                        dismissedAt: Number(v.dismissedAt || 0),
                        kind: String(v.kind || bucket.slice(0, -1))
                    };
                }
            });
        }
    });
    return out;
}

function LoadLocalDiagXDismissed() {
    try {
        const raw = localStorage.getItem(DIAGX_DISMISSED_STORAGE_KEY);
        if (raw) return NormalizeDiagXDismissed(JSON.parse(raw));
    } catch {}
    return { findings: {}, signatures: {}, events: {} };
}

function PersistDiagXDismissed(pushToHost = true) {
    try {
        localStorage.setItem(DIAGX_DISMISSED_STORAGE_KEY, JSON.stringify(window._diagXDismissed));
    } catch {}
    if (pushToHost && window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(JSON.stringify({
            command: 'SAVE_DIAGX_DISMISSED',
            dismissed: window._diagXDismissed
        }));
    }
}

function GetDiagXEventKey(ev) {
    return `${ev.channel || ''}|${ev.provider || ''}|${ev.eventId ?? 0}|${ev.epochMs ?? 0}`;
}

function GetDiagXSignatureKey(provider, eventId) {
    return `${provider || ''}|${eventId ?? 0}`;
}

function DoesEventMatchDiagXFinding(ev, findingId) {
    const id = Number(ev.eventId || 0);
    const prov = String(ev.provider || '');
    switch (findingId) {
        case 'kp41':        return id === 41 && /Kernel-Power/i.test(prov);
        case 'whea':        return ev.subsystem === 'Hardware / WHEA' && !ev.isBenign;
        case 'disk':        return ev.subsystem === 'Storage & Disk' && [7, 11, 51, 55, 98, 129, 153].includes(id);
        case 'gpu_tdr':     return ev.subsystem === 'Graphics / GPU' && [4101, 14].includes(id);
        case 'app_crashes': return [1000, 1002, 1026].includes(id) && ev.channel === 'Application';
        case 'svc_fails':   return /Service Control Manager/i.test(prov) && [7000, 7001, 7009, 7023, 7031, 7034].includes(id);
        case 'net_drops':   return ev.subsystem === 'Network & DNS' && ['Critical', 'Error', 'Warning'].includes(ev.severity);
        case 'ext_errors':  return ev.sourceType === 'External' && ['Critical', 'Error'].includes(ev.severity);
        default:            return false;
    }
}

function IsDiagXEventDismissed(ev) {
    const d = window._diagXDismissed || { findings: {}, signatures: {}, events: {} };
    const evKey = GetDiagXEventKey(ev);
    if (d.events && d.events[evKey]) return true;

    const ep = Number(ev.epochMs || 0);
    const sigKey = GetDiagXSignatureKey(ev.provider, ev.eventId);
    if (d.signatures && d.signatures[sigKey]) {
        const at = Number(d.signatures[sigKey].dismissedAt || 0);
        if (ep <= at) return true;
    }
    if (d.findings) {
        for (const [fId, fRec] of Object.entries(d.findings)) {
            if (fRec && DoesEventMatchDiagXFinding(ev, fId)) {
                if (ep <= Number(fRec.dismissedAt || 0)) return true;
            }
        }
    }
    return false;
}

function IsDiagXFindingDismissed(f) {
    const d = window._diagXDismissed || { findings: {} };
    const rec = d.findings && f.id ? d.findings[f.id] : null;
    if (!rec) return false;
    const latest = Number(f.latestEpochMs || 0);
    if (latest > 0 && latest > Number(rec.dismissedAt || 0)) {
        return false; // Brand-new occurrence after dismissal -> auto re-surface!
    }
    return true;
}

window.DismissDiagXFinding = function(findingId, title) {
    if (!findingId) return;
    const rawEvents = Array.isArray(window._diagXReport?.events) ? window._diagXReport.events : [];
    const matching = rawEvents.filter(ev => DoesEventMatchDiagXFinding(ev, findingId));
    const maxEp = matching.reduce((m, e) => Math.max(m, Number(e.epochMs || 0)), 0);
    const fObj = (window._diagXReport?.findings || []).find(x => x.id === findingId);
    const cutoff = Math.max(Date.now(), maxEp, Number(fObj?.latestEpochMs || 0));

    window._diagXDismissed.findings[findingId] = {
        label: title || findingId,
        dismissedAt: cutoff,
        kind: 'finding'
    };
    PersistDiagXDismissed(true);
    AppendConsoleLogEntry(`[ULTIMADIAGX] Marked finding solved: ${title || findingId}`);
    RecalculateAndRenderDiagX();
};

window.DismissDiagXSignature = function(provider, eventId) {
    const sigKey = GetDiagXSignatureKey(provider, eventId);
    const rawEvents = Array.isArray(window._diagXReport?.events) ? window._diagXReport.events : [];
    const maxEp = rawEvents
        .filter(ev => GetDiagXSignatureKey(ev.provider, ev.eventId) === sigKey)
        .reduce((m, e) => Math.max(m, Number(e.epochMs || 0)), 0);
    const cutoff = Math.max(Date.now(), maxEp);

    window._diagXDismissed.signatures[sigKey] = {
        label: `${provider} (ID ${eventId})`,
        dismissedAt: cutoff,
        kind: 'signature'
    };
    PersistDiagXDismissed(true);
    AppendConsoleLogEntry(`[ULTIMADIAGX] Dismissed recurring signature: ${provider} (ID ${eventId})`);
    RecalculateAndRenderDiagX();
};

window.DismissDiagXEventByKey = function(evKey, label) {
    if (!evKey) return;
    window._diagXDismissed.events[evKey] = {
        label: label || evKey,
        dismissedAt: Date.now(),
        kind: 'event'
    };
    PersistDiagXDismissed(true);
    AppendConsoleLogEntry(`[ULTIMADIAGX] Dismissed event: ${label || evKey}`);
    RecalculateAndRenderDiagX();
};

window.RestoreDiagXDismissedItem = function(bucket, key) {
    if (window._diagXDismissed[bucket] && window._diagXDismissed[bucket][key]) {
        const lbl = window._diagXDismissed[bucket][key].label || key;
        delete window._diagXDismissed[bucket][key];
        PersistDiagXDismissed(true);
        AppendConsoleLogEntry(`[ULTIMADIAGX] Restored dismissed item: ${lbl}`);
        RecalculateAndRenderDiagX();
    }
};

window.RestoreAllDiagXDismissed = function() {
    window._diagXDismissed = { findings: {}, signatures: {}, events: {} };
    PersistDiagXDismissed(true);
    const sec = document.getElementById('diagXDismissedSection');
    if (sec) sec.style.display = 'none';
    AppendConsoleLogEntry('[ULTIMADIAGX] Restored all solved/dismissed issues.');
    RecalculateAndRenderDiagX();
};

window.ToggleDiagXDismissedDrawer = function() {
    const sec = document.getElementById('diagXDismissedSection');
    const btn = document.getElementById('btnDiagDismissedToggle');
    if (!sec) return;
    const isOpen = sec.style.display !== 'none';
    sec.style.display = isOpen ? 'none' : 'block';
    if (btn) btn.classList.toggle('active', !isOpen);
};

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
    if (!Object.keys(window._diagXDismissed.findings).length &&
        !Object.keys(window._diagXDismissed.signatures).length &&
        !Object.keys(window._diagXDismissed.events).length) {
        window._diagXDismissed = LoadLocalDiagXDismissed();
    }
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

    // Detect brand new critical/error events during Live Watch (ignoring already-dismissed ones)
    if (window._diagXLastTopEpoch > 0 && events.length > 0) {
        const newAlerts = events.filter(e =>
            e.epochMs > window._diagXLastTopEpoch &&
            (e.severity === 'Critical' || e.severity === 'Error') &&
            !e.isBenign &&
            !IsDiagXEventDismissed(e)
        );
        newAlerts.forEach(ev => {
            ev._isLiveNew = true;
            AppendConsoleLogEntry(`[ULTIMADIAGX LIVE ALERT] [${ev.severity}] ${ev.provider} (ID ${ev.eventId}): ${ev.translation || ev.message}`);
        });
    }
    if (events.length > 0) {
        window._diagXLastTopEpoch = Math.max(window._diagXLastTopEpoch, events[0].epochMs || 0);
    }

    RecalculateAndRenderDiagX();
}

function RecalculateAndRenderDiagX() {
    const data = window._diagXReport;
    if (!data) return;

    const status = document.getElementById('diagXStatus');
    const allEvents = Array.isArray(data.events) ? data.events : (data.events ? [data.events] : []);
    const activeEvents = allEvents.filter(ev => !IsDiagXEventDismissed(ev));
    const excludedEventCount = allEvents.length - activeEvents.length;

    window._diagXEventsCache = activeEvents;

    // Count total active dismissal rules
    const dObj = window._diagXDismissed || { findings: {}, signatures: {}, events: {} };
    const dismissedEntries = [
        ...Object.entries(dObj.findings || {}).map(([key, v]) => ({ bucket: 'findings', key, ...v })),
        ...Object.entries(dObj.signatures || {}).map(([key, v]) => ({ bucket: 'signatures', key, ...v })),
        ...Object.entries(dObj.events || {}).map(([key, v]) => ({ bucket: 'events', key, ...v }))
    ].sort((a, b) => (b.dismissedAt || 0) - (a.dismissedAt || 0));

    const hasDismissals = dismissedEntries.length > 0;

    // Live actionable counts from unresolved events
    const critCount = activeEvents.filter(e => e.severity === 'Critical' && !e.isBenign).length;
    const errCount  = activeEvents.filter(e => e.severity === 'Error' && !e.isBenign).length;
    const warnCount = activeEvents.filter(e => e.severity === 'Warning' && !e.isBenign).length;
    const extCount  = activeEvents.filter(e => e.sourceType === 'External').length;
    const wheaCount = activeEvents.filter(e => e.subsystem === 'Hardware / WHEA' && !e.isBenign).length;
    const diskCount = activeEvents.filter(e => e.subsystem === 'Storage & Disk' && [7, 11, 51, 55, 98, 129, 153].includes(Number(e.eventId))).length;

    // Exact Composite Stability Score Formula (mirrors UltimaDiagX.ps1)
    const critPen = Math.min(45, critCount * 15);
    const errPen  = Math.min(30, errCount * 2);
    const warnPen = Math.min(12, Math.floor(warnCount / 4));
    const wheaPen = wheaCount > 0 ? 12 : 0;
    const diskPen = diskCount > 0 ? 12 : 0;

    const relIdx = (data.reliabilityIndex !== null && data.reliabilityIndex !== undefined && Number.isFinite(Number(data.reliabilityIndex)))
        ? Number(data.reliabilityIndex)
        : null;
    const rawRelPen = (relIdx !== null && relIdx < 7.0) ? Math.round((7.0 - relIdx) * 4) : 0;
    // If the user explicitly marked active faults solved and 0 Critical/Error events remain, waive stale historical Reliability Index lag
    const relWaived = hasDismissals && rawRelPen > 0 && critCount === 0 && errCount === 0;
    const relPen = relWaived ? 0 : rawRelPen;

    const score = Math.max(5, Math.min(100, 100 - critPen - errPen - warnPen - wheaPen - diskPen - relPen));
    const grade = (score >= 85 && critCount === 0) ? 'HEALTHY' : (score >= 65 ? 'ADVISORY' : (score >= 40 ? 'DEGRADED' : 'CRITICAL'));

    // Score & Grade Banner
    SetDomText('lblDiagScore', score);
    SetDomText('lblDiagGrade', grade);
    SetDomText('lblDiagReliability', relIdx !== null ? `Windows Reliability Index: ${relIdx} / 10` : 'Reliability Index: N/A');
    SetDomText('diagXLastScanStamp', `Last scan: ${data.generatedAt || 'now'}`);

    const rawScore = Number.isFinite(Number(data.healthScore)) ? Number(data.healthScore) : score;
    const deltaPts = score - rawScore;
    const breakdownParts = [
        `Base 100`,
        critPen ? `Crit -${critPen}` : null,
        errPen  ? `Err -${errPen}` : null,
        warnPen ? `Warn -${warnPen}` : null,
        wheaPen ? `WHEA -${wheaPen}` : null,
        diskPen ? `Disk -${diskPen}` : null,
        relPen  ? `RelIdx -${relPen}` : (relWaived ? `RelIdx 0 (waived)` : null)
    ].filter(Boolean).join(' · ');
    const deltaSuffix = (hasDismissals && deltaPts > 0) ? `  (+${deltaPts} pts recovered from ${excludedEventCount} solved event${excludedEventCount === 1 ? '' : 's'})` : '';
    SetDomText('lblDiagScoreBreakdown', `Formula: ${breakdownParts} = ${score}/100${deltaSuffix}`);

    // Dynamic Executive Synopsis
    let synopsis = data.executiveSummary || '';
    if (hasDismissals && excludedEventCount > 0) {
        if (critCount === 0 && errCount === 0) {
            synopsis = `System stability is now ${grade} (${score}/100) with all active Critical/Error faults resolved (${excludedEventCount} solved event${excludedEventCount === 1 ? '' : 's'} excluded; new occurrences will auto-alert).`;
        } else {
            synopsis = `Adjusted stability: ${grade} (${score}/100) — ${critCount} critical, ${errCount} error, and ${warnCount} warning event(s) remain active (${excludedEventCount} solved event${excludedEventCount === 1 ? '' : 's'} excluded).`;
        }
    }
    SetDomText('lblDiagSynopsisText', synopsis);

    const scoreBox = document.getElementById('diagXScoreBox');
    if (scoreBox) {
        scoreBox.className = 'diagx-score-box';
        const g = grade.toLowerCase();
        if (g === 'healthy') scoreBox.classList.add('grade-healthy');
        else if (g === 'advisory') scoreBox.classList.add('grade-advisory');
        else if (g === 'degraded') scoreBox.classList.add('grade-degraded');
        else scoreBox.classList.add('grade-critical');
    }

    const c = data.counts || {};
    SetDomText('sumDiagTotal',    activeEvents.length);
    SetDomText('sumDiagCritical', critCount);
    SetDomText('sumDiagErrors',   errCount);
    SetDomText('sumDiagWarnings', warnCount);
    SetDomText('sumDiagExternal', extCount);
    SetDomText('sumDiagWer',      data.werRecent7d ?? 0);

    // Solved / Dismissed Toggle Chip & Drawer
    const disToggle = document.getElementById('btnDiagDismissedToggle');
    const disSec = document.getElementById('diagXDismissedSection');
    const disList = document.getElementById('diagXDismissedList');
    if (disToggle) {
        disToggle.style.display = hasDismissals ? 'inline-flex' : 'none';
        SetDomText('sumDiagDismissed', `${dismissedEntries.length}${excludedEventCount > 0 ? ` (${excludedEventCount} ev)` : ''}`);
    }
    if (!hasDismissals && disSec) {
        disSec.style.display = 'none';
        if (disToggle) disToggle.classList.remove('active');
    }
    if (disList) {
        disList.replaceChildren();
        dismissedEntries.forEach(item => {
            const row = document.createElement('div');
            row.className = 'diagx-mini-row';
            const when = item.dismissedAt ? new Date(item.dismissedAt).toLocaleString() : 'Unknown';
            const kindLabel = item.bucket === 'findings' ? 'Finding' : (item.bucket === 'signatures' ? 'Signature' : 'Event');
            const left = document.createElement('div');
            left.style.minWidth = '0';
            left.style.flex = '1';
            left.innerHTML = `<span class="sharing-badge badge-success">${kindLabel}</span> <strong>${EscapeHtmlTp(item.label)}</strong><div class="org-folder-path">Solved on ${EscapeHtmlTp(when)} · Auto re-alerts if a newer event occurs</div>`;

            const restoreBtn = document.createElement('button');
            restoreBtn.type = 'button';
            restoreBtn.className = 'org-mini-btn';
            restoreBtn.textContent = 'Restore';
            restoreBtn.addEventListener('click', () => RestoreDiagXDismissedItem(item.bucket, item.key));
            row.append(left, restoreBtn);
            disList.appendChild(row);
        });
    }

    // Recompute Subsystem Health Matrix from activeEvents (preserving icons/order from backend)
    const subGrid = document.getElementById('diagXSubsystemsGrid');
    if (subGrid) {
        subGrid.replaceChildren();
        const subs = Array.isArray(data.subsystems) ? data.subsystems : [];
        subs.forEach(baseSub => {
            const matching = activeEvents.filter(e => e.subsystem === baseSub.name && !e.isBenign);
            const sCrit = matching.filter(e => e.severity === 'Critical').length;
            const sErr  = matching.filter(e => e.severity === 'Error').length;
            const sWarn = matching.filter(e => e.severity === 'Warning').length;
            const sStatus = (sCrit > 0) ? 'CRITICAL' : ((sErr > 0 || sWarn >= 5) ? 'WARN' : 'OK');

            const tile = document.createElement('button');
            tile.type = 'button';
            const stClass = sStatus === 'CRITICAL' ? 'sub-crit' : (sStatus === 'WARN' ? 'sub-warn' : 'sub-ok');
            tile.className = `diagx-sub-tile ${stClass}${window._diagXSubsystemFilter === baseSub.name ? ' active' : ''}`;
            tile.innerHTML = `
                <div class="diagx-sub-top">
                    <span>${baseSub.icon} ${EscapeHtmlTp(baseSub.name)}</span>
                    <span class="sharing-badge ${sStatus === 'CRITICAL' ? 'badge-danger' : (sStatus === 'WARN' ? 'badge-purple' : 'badge-success')}">${sStatus}</span>
                </div>
                <div class="diagx-sub-counts">Crit: <strong>${sCrit}</strong> · Err: <strong>${sErr}</strong> · Warn: <strong>${sWarn}</strong></div>
            `;
            tile.addEventListener('click', () => {
                window._diagXSubsystemFilter = (window._diagXSubsystemFilter === baseSub.name) ? 'all' : baseSub.name;
                RenderUltimaDiagXReportSubHighlight();
                ApplyDiagXEventFilter();
            });
            subGrid.appendChild(tile);
        });
    }

    // Detected Findings & Actionable Recommendations (with ✓ Mark Solved)
    const findSec = document.getElementById('diagXFindingsSection');
    const findList = document.getElementById('diagXFindingsList');
    const rawFindings = Array.isArray(data.findings) ? data.findings : (data.findings ? [data.findings] : []);
    const activeFindings = rawFindings.filter(f => {
        if (IsDiagXFindingDismissed(f)) return false;
        if (f.id && f.id !== 'kernel_dumps') {
            const rem = activeEvents.filter(ev => DoesEventMatchDiagXFinding(ev, f.id));
            if (rem.length === 0) return false;
            f._activeCount = rem.length;
        } else {
            f._activeCount = f.count;
        }
        return true;
    });

    if (findSec && findList) {
        findList.replaceChildren();
        if (activeFindings.length) {
            findSec.style.display = 'block';
            activeFindings.forEach(f => {
                const card = document.createElement('div');
                card.className = `diagx-finding-card ${f.severity === 'CRITICAL' ? 'find-crit' : 'find-warn'}`;

                const head = document.createElement('div');
                head.className = 'diagx-finding-head';
                const titleEl = document.createElement('strong');
                titleEl.textContent = f.title;

                const rightBox = document.createElement('div');
                rightBox.className = 'diagx-finding-actions';
                const badge = document.createElement('span');
                badge.className = `sharing-badge ${f.severity === 'CRITICAL' ? 'badge-danger' : 'badge-purple'}`;
                badge.textContent = `${f.severity} · ${f._activeCount ?? f.count}x`;
                rightBox.appendChild(badge);

                if (f.id) {
                    const solveBtn = document.createElement('button');
                    solveBtn.type = 'button';
                    solveBtn.className = 'diagx-dismiss-btn';
                    solveBtn.textContent = '✓ Mark Solved';
                    solveBtn.title = 'Dismiss this issue and recalculate Stability Score (auto re-alerts if a new occurrence happens)';
                    solveBtn.addEventListener('click', () => DismissDiagXFinding(f.id, f.title));
                    rightBox.appendChild(solveBtn);
                }

                head.append(titleEl, rightBox);
                card.appendChild(head);

                const desc = document.createElement('div');
                desc.className = 'diagx-finding-desc';
                desc.textContent = f.explanation;
                card.appendChild(desc);

                const fix = document.createElement('div');
                fix.className = 'diagx-finding-fix';
                fix.innerHTML = `💡 <strong>Action:</strong> `;
                fix.appendChild(document.createTextNode(f.recommendation || ''));
                card.appendChild(fix);

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
                left.innerHTML = `<strong>${EscapeHtmlTp(d.name)}</strong> <span class="sharing-badge badge-danger">${d.sizeMB} MB</span><div class="org-folder-path">${EscapeHtmlTp(d.kind)} · ${EscapeHtmlTp(d.timestamp)}</div>`;
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

    // Top Recurring Fault Signatures (live recomputed from activeEvents, with ✓ Dismiss)
    const recList = document.getElementById('diagXRecurringList');
    if (recList) {
        recList.replaceChildren();
        const sigMap = new Map();
        activeEvents.forEach(ev => {
            if (ev.isBenign || !(ev.eventId > 0)) return;
            const k = GetDiagXSignatureKey(ev.provider, ev.eventId);
            if (!sigMap.has(k)) {
                sigMap.set(k, {
                    provider: ev.provider,
                    eventId: ev.eventId,
                    severity: ev.severity,
                    count: 0,
                    summary: ev.translation || ev.message || ''
                });
            }
            const rec = sigMap.get(k);
            rec.count++;
            if (ev.severity === 'Critical') rec.severity = 'Critical';
        });
        const recs = Array.from(sigMap.values()).sort((a, b) => b.count - a.count).slice(0, 6);

        if (!recs.length) {
            recList.innerHTML = '<div class="driver-text-node" style="color:#48bb78;">✓ No unresolved recurring fault patterns.</div>';
        } else {
            recs.forEach(r => {
                const row = document.createElement('div');
                row.className = 'diagx-mini-row';

                const left = document.createElement('div');
                left.style.minWidth = '0';
                left.style.flex = '1';
                left.innerHTML = `
                    <strong>${EscapeHtmlTp(r.provider)}</strong> <span class="sharing-badge badge-info">ID ${r.eventId}</span> <span class="sharing-badge ${r.severity === 'Critical' ? 'badge-danger' : 'badge-purple'}">${r.count}x</span>
                    <div class="org-folder-path" title="${EscapeHtmlTp(r.summary)}">${EscapeHtmlTp(r.summary)}</div>
                `;

                const dismissBtn = document.createElement('button');
                dismissBtn.type = 'button';
                dismissBtn.className = 'diagx-dismiss-btn mini';
                dismissBtn.textContent = '✓ Dismiss';
                dismissBtn.title = `Mark ${r.provider} (ID ${r.eventId}) solved and exclude from score`;
                dismissBtn.addEventListener('click', () => DismissDiagXSignature(r.provider, r.eventId));

                row.append(left, dismissBtn);
                recList.appendChild(row);
            });
        }
    }

    RenderDiagXExternalLogChips();

    if (status) {
        status.classList.remove('sharing-error');
        const disNote = excludedEventCount > 0 ? ` · ${excludedEventCount} solved excluded` : '';
        status.textContent = `Scan complete: ${activeEvents.length} active events across ${c.channels ?? 0} Windows channels (Health: ${score}/100 ${grade}${disNote}).`;
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
                <strong>${EscapeHtmlTp(ev.provider)}</strong>
                ${idBadge}
                <span class="diagx-ev-channel">${EscapeHtmlTp(ev.channel)}</span>
                ${benignTag}
            </span>
        `;
        const rightEv = document.createElement('span');
        rightEv.className = 'diagx-ev-right';
        const timeSpan = document.createElement('span');
        timeSpan.className = 'diagx-ev-time';
        timeSpan.textContent = ev.timestamp;
        const evDisBtn = document.createElement('button');
        evDisBtn.type = 'button';
        evDisBtn.className = 'diagx-dismiss-btn mini';
        evDisBtn.textContent = '✓';
        evDisBtn.title = 'Dismiss this event as solved (excludes from Stability Score)';
        const evKey = GetDiagXEventKey(ev);
        const evLbl = `${ev.provider} (ID ${ev.eventId || 'EXT'}) · ${ev.timestamp}`;
        evDisBtn.addEventListener('click', () => DismissDiagXEventByKey(evKey, evLbl));
        rightEv.append(timeSpan, evDisBtn);
        head.appendChild(rightEv);
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
            <span><strong>${t.code}</strong> — <span style="color:var(--cw-accent-soft);">${t.name}</span></span>
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
                <td><span class="tp-port-badge">${x.localPort}</span> <span style="color:var(--cw-text-muted);">${EscapeHtmlTp(x.localAddress)}</span></td>
                <td style="color:var(--cw-text-muted);">${EscapeHtmlTp(remoteEp)}</td>
                <td><span class="sharing-badge ${stCls}">${EscapeHtmlTp(x.state)}</span></td>
                <td><span class="tp-cell-primary">${EscapeHtmlTp(x.processName)}</span> <span style="color:var(--cw-text-muted);">(${x.pid})</span>${x.processPath ? `<span class="tp-cell-sub" title="${EscapeHtmlTp(x.processPath)}">${EscapeHtmlTp(x.processPath)}</span>` : ''}</td>
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
    if (!ConfirmDestructiveAction(`Force-terminate process '${name}' (PID ${pid})?`)) return;
    SetTpStatus(`Terminating ${name} (PID ${pid})...`);
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'TP_KILL_PROCESS', pid }));
};

window.TriggerTpOpenLocation = function(path) {
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'TP_OPEN_PROCESS_LOCATION', path }));
};

window.TriggerTpServiceAction = function(serviceName, action) {
    if (action === 'stop' && !ConfirmDestructiveAction(`Stop Windows service '${serviceName}'?`)) return;
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
    const devDrop = document.getElementById('navDevDropdown');
    const opsDrop = document.getElementById('navOpsDropdown');
    const modeDrop = document.getElementById('navModePillDropdown');
    if (devDrop) devDrop.classList.remove('open');
    if (opsDrop) opsDrop.classList.remove('open');
    if (modeDrop) modeDrop.classList.remove('open');
    if (!dd) return;
    const isOpen = dd.classList.toggle('open');
    if (trigger) trigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    if (isOpen) ClampNavDropdownMenu(document.getElementById('navSystemMenu'));
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

    const ver     = String(infra.PsVersion || '--');
    const latest  = String(infra.PsLatestVersion || '');
    const missed  = Number(infra.PsMissedUpdates || 0);
    const tier    = String(infra.PsVersionTier || 'uptodate');
    const hasMsi  = (infra.PsLatestHasMsi !== false);
    const channel = String(infra.PsInstallChannel || 'msi');
    const detail  = String(infra.PsUpdateDetail || 'Click to check for PowerShell updates').replace(/"/g, '&quot;');

    const isBusy = IsControlPending('CHECK_PS_UPDATE') || IsControlPending('INSTALL_PS_UPDATE');
    if (isBusy) {
        SetDomHtml(el, `<button type="button" class="toggle-pill-btn is-busy" disabled>Checking...</button>`);
        return;
    }

    let cls = 'ver-uptodate';
    const chanBadge = channel === 'msix' ? ' (MSIX)' : '';
    let label = `${ver}${chanBadge} ✓`;
    if (tier === 'critical' || missed > 5) {
        cls = 'ver-critical';
        label = latest ? `${ver}${chanBadge} ⚠ ${latest} (+${missed})` : `${ver}${chanBadge} ⚠ Outdated`;
    } else if (tier === 'update' || missed > 0) {
        cls = 'ver-update';
        label = latest ? `${ver}${chanBadge} ⬆ ${latest}` : `${ver}${chanBadge} ⬆ Update`;
    }

    const safeLatest = latest.replace(/'/g, "\\'");
    const safeVer = ver.replace(/'/g, "\\'");
    const safeChan = channel.replace(/'/g, "\\'");
    SetDomHtml(el, `<button type="button" class="toggle-pill-btn ${cls}" onclick="TriggerPowerShellUpdateToggle('${safeVer}', '${safeLatest}', ${missed}, ${hasMsi ? 'true' : 'false'}, '${safeChan}')" title="${detail}">${label}</button>`);
}

window.TriggerPowerShellUpdateToggle = function(curVer, latestVer, missed, hasMsi = true, channel = 'msi') {
    if (missed > 0 || channel === 'none') {
        let methodNote = '';
        if (channel === 'none') {
            methodNote = `PowerShell Core 7 is not currently installed.\n\nClick OK to install PowerShell ${latestVer || '7'} (MSIX) via WinGet.\n\nNote: The MSIX version installs inside C:\\Program Files\\WindowsApps where Windows restricts direct browsing or manual edits to the install folder.`;
        } else if (channel === 'msix') {
            methodNote = `You are using the MSIX / Microsoft Store edition (WindowsApps).\n\nClick OK to upgrade to PowerShell ${latestVer || 'Latest'} via WinGet.\n\nNote: Windows restricts direct access/editing of the WindowsApps install folder.`;
        } else {
            methodNote = `Click OK to download & install the official PowerShell ${latestVer} .msi directly into C:\\Program Files\\PowerShell\\7 (full folder access; CoreWatch will briefly restart to unlock pwsh.exe).`;
        }
        const action = confirm(
            `PowerShell update available: ${curVer} → ${latestVer || 'Latest'}${missed > 0 ? ` (${missed} release${missed > 1 ? 's' : ''} behind)` : ''}.\n\n` +
            `${methodNote}\n\n` +
            `(Click Cancel to re-check GitHub releases without installing.)`
        );
        if (action) {
            DispatchDashboardControl('INSTALL_PS_UPDATE', {}, `Launching PowerShell 7 ${channel === 'msi' ? 'MSI' : 'MSIX/WinGet'} updater (${curVer} -> ${latestVer || 'Latest'})...`, 'lblPsVersion');
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
                <td style="color:var(--cw-text-muted);">${EscapeHtmlTp(h.hostname || '--')}</td>
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
            <td style="color:var(--cw-text-muted);">${EscapeHtmlTp(r.detail)}</td>
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
                    <td style="color:var(--cw-accent-soft);">${EscapeHtmlTp(r.nextHop)}</td>
                    <td style="color:var(--cw-text-muted);">${EscapeHtmlTp(r.interface)}</td>
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
                    <td style="color:var(--cw-accent-soft); user-select:text;">${EscapeHtmlTp(a.mac)}</td>
                    <td><span class="sharing-badge ${a.state === 'Reachable' ? 'badge-success' : 'badge-neutral'}">${EscapeHtmlTp(a.state)}</span></td>
                    <td style="color:var(--cw-text-muted);">${EscapeHtmlTp(a.interface)}</td>
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
    </table><div class="wsl-hint-line" style="margin-top:5px;">Total Scanned Footprint: <strong style="color:var(--cw-accent-soft);">${EscapeHtmlTp(tempBloat.totalText)}</strong> · Clean Temp safely removes unlocked files in %TEMP% &amp; Windows\\Temp.</div>`;
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
                    <td class="tp-cell-primary" style="color:var(--cw-accent-soft);">${EscapeHtmlTp(h.ip)}</td>
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
                    <td class="tp-cell-primary" style="color:var(--cw-accent-soft);">${EscapeHtmlTp(k.kb)}</td>
                    <td style="color:var(--cw-text-muted);">${EscapeHtmlTp(k.description)}</td>
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
                    <td style="color:var(--cw-text-muted);">${EscapeHtmlTp(v.method)}</td>
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
                    <td style="color:var(--cw-text-muted);">${EscapeHtmlTp(a.class)}</td>
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
                <td style="color:var(--cw-text-muted);">${EscapeHtmlTp(t.author)}</td>
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
    { label: '⚙️ Application Settings — Startup, Directories, Telemetry & Modules', cat: 'Settings', run: () => OpenSettingsModal() },
    { label: '⚡ System Profiles & Modes (Work, Gaming, Streaming, Night & Custom)', cat: 'Tab', moduleId: 'profiles', run: () => SwitchAppLayoutView('profiles') },
    { label: '🎮 Switch Mode → Gaming', cat: 'Mode', moduleId: 'profiles', run: () => TriggerApplyProfile('gaming') },
    { label: '💼 Switch Mode → Work / Focus (DnD On)', cat: 'Mode', moduleId: 'profiles', run: () => TriggerApplyProfile('work') },
    { label: '🎙️ Switch Mode → Presentation / Streaming (DnD + Keep Awake)', cat: 'Mode', moduleId: 'profiles', run: () => TriggerApplyProfile('presentation') },
    { label: '🌙 Switch Mode → Night / Quiet (Night Light + DnD)', cat: 'Mode', moduleId: 'profiles', run: () => TriggerApplyProfile('night') },
    { label: '🖥️ Switch Mode → Normal / Default', cat: 'Mode', moduleId: 'profiles', run: () => TriggerApplyProfile('normal') },
    { label: '✏️ Customize Dashboard Layout (Grid / Side Dock / Hide)', cat: 'UI', run: () => { SwitchAppLayoutView('dashboard'); OpenLayoutCustomizer(); } },
    { label: '🎨 Theme & Appearance Studio (Live Custom Colors & Background Image)', cat: 'UI', run: () => OpenThemeStudio() },
    { label: '💿 Disk Partitioner (Floating Disk Setup — Pauses Telemetry)', cat: 'Storage', run: () => OpenDiskPartitioner() },
    { label: '◫ Toggle Side Pop-Out Telemetry Dock', cat: 'UI', run: () => ToggleSideTelemetryDock() },
    { label: '📌 Toggle Always on Top (Pin Window)', cat: 'Window', run: () => ToggleWindowAlwaysOnTop() },
    { label: '🔒 Cycle Window Lock (Unlocked → Position → Position & Size)', cat: 'Window', run: () => CycleWindowLockMode() },
    { label: '🐙 GitHub Manager — Local Projects, Clone & Releases', cat: 'Tab', moduleId: 'github', run: () => SwitchAppLayoutView('github') },
    { label: '📋 Jira Manager — Work Tasks, Transitions & Comments', cat: 'Tab', moduleId: 'jira', run: () => SwitchAppLayoutView('jira') },
    { label: '🐳 Docker & Local Dev Services — Containers, Logs & Prune', cat: 'Tab', moduleId: 'docker', run: () => SwitchAppLayoutView('docker') },
    { label: '🧹 Prune Unused Docker Containers & Images', cat: 'Action', moduleId: 'docker', run: () => { SwitchAppLayoutView('docker'); TriggerDockerPrune(); } },
    { label: '🔐 SSH Host Launcher & Windows Certificate Inspector', cat: 'Tab', moduleId: 'sshcerts', run: () => SwitchAppLayoutView('sshcerts') },
    { label: '🌐 Multi-PC / Homelab Monitor — Remote SSH/WinRM/HTTP Nodes', cat: 'Tab', moduleId: 'homelab', run: () => SwitchAppLayoutView('homelab') },
    { label: '🔄 Poll All Homelab Nodes Now', cat: 'Action', moduleId: 'homelab', run: () => { SwitchAppLayoutView('homelab'); TriggerPollHomelabAll(); } },
    { label: '🔔 Smart Alerts & Watchdog Rules (Toast Alerts)', cat: 'Tab', moduleId: 'alerts', run: () => SwitchAppLayoutView('alerts') },
    { label: '🧪 Send Test Smart Alert Toast Notification', cat: 'Action', moduleId: 'alerts', run: () => { SwitchAppLayoutView('alerts'); TriggerTestAlertToast(); } },
    { label: '🔄 Unified Update Center (WinGet, Windows Update, PowerShell)', cat: 'Tab', moduleId: 'updates', run: () => SwitchAppLayoutView('updates') },
    { label: '🔄 Scan All Updates Now', cat: 'Action', moduleId: 'updates', run: () => { SwitchAppLayoutView('updates'); RequestUpdateCenterState(false); } },
    { label: '📸 System Snapshots & "What Changed?" Diff', cat: 'Tab', moduleId: 'snapshots', run: () => SwitchAppLayoutView('snapshots') },
    { label: '💾 Backup & Folder Sync Manager (Robocopy)', cat: 'Tab', moduleId: 'backupsync', run: () => SwitchAppLayoutView('backupsync') },
    { label: '🔋 Battery Health & Wireless Bluetooth Peripherals', cat: 'Tab', moduleId: 'battery', run: () => SwitchAppLayoutView('battery') },
    { label: '📡 Network — Adapters, Diagnostics & Routing', cat: 'Tab', moduleId: 'netmanager', run: () => SwitchAppLayoutView('netmanager') },
    { label: '🧪 Network — Active Diagnostics (Ping / Trace / Ports / DNS)', cat: 'Tool', moduleId: 'netmanager', run: () => { SwitchAppLayoutView('netmanager'); SetNetworkSubView('diagnostics'); } },
    { label: '📶 Network — Wi-Fi RSSI, Routing Table & ARP', cat: 'Tool', moduleId: 'netmanager', run: () => { SwitchAppLayoutView('netmanager'); SetNetworkSubView('wifiroutes'); } },
    { label: '🧭 Tasks & Ports — Live Processes, Services & Sockets', cat: 'Tab', moduleId: 'tasksports', run: () => SwitchAppLayoutView('tasksports') },
    { label: '🔌 Open Listening Ports & Sockets', cat: 'Tool', moduleId: 'tasksports', run: () => { SwitchAppLayoutView('tasksports'); SetTasksPortsSubView('sockets'); } },
    { label: '🛠️ Windows Services (Stopped Auto Fault Check)', cat: 'Tool', moduleId: 'tasksports', run: () => { SwitchAppLayoutView('tasksports'); SetTasksPortsSubView('services'); SetTpServiceFilter('faulty'); } },
    { label: '🩺 UltimaDiagX — Event Logs & BSOD Translator', cat: 'Tab', moduleId: 'diagx', run: () => SwitchAppLayoutView('diagx') },
    { label: '🐧 WSL — Windows Subsystem for Linux Manager', cat: 'Tab', moduleId: 'wsl', run: () => SwitchAppLayoutView('wsl') },
    { label: '🛡️ Security & Compliance Posture (BitLocker, TPM, RDP)', cat: 'Tab', moduleId: 'security', run: () => { SwitchAppLayoutView('security'); SetSecuritySubView('posture'); } },
    { label: '🧬 Env, Hosts File, System Proxy & Recent KBs Audit', cat: 'Tool', moduleId: 'security', run: () => { SwitchAppLayoutView('security'); SetSecuritySubView('envhosts'); } },
    { label: '🧰 Windows Repair Toolkit (DISM, SFC, WU/Winsock, Temp Clean)', cat: 'Tool', moduleId: 'security', run: () => { SwitchAppLayoutView('security'); SetSecuritySubView('repair'); } },
    { label: '🧹 Clean Safe Temp Files (%TEMP% & Windows\\Temp)', cat: 'Action', moduleId: 'security', run: () => { SwitchAppLayoutView('security'); SetSecuritySubView('repair'); RunRepairTool('REPAIR_CLEAN_TEMP', 'Safe Temp Cleanup', true); } },
    { label: '📦 Export 1-Click IT Support Bundle (.zip)', cat: 'Action', moduleId: 'security', run: () => TriggerExportSupportBundle() },
    { label: '🚀 Startup Apps Manager', cat: 'Tab', moduleId: 'startup', run: () => SwitchAppLayoutView('startup') },
    { label: '📂 SMB Sharing Center', cat: 'Tab', moduleId: 'sharing', run: () => SwitchAppLayoutView('sharing') },
    { label: '📦 Installed Applications Manager', cat: 'Tab', moduleId: 'apps', run: () => SwitchAppLayoutView('apps') },
    { label: '⬇️ App Downloader & Package Installer (Steam, VS Code, Python, Rust, C++)', cat: 'Tab', moduleId: 'appstore', run: () => SwitchAppLayoutView('appstore') },
    { label: '🗺️ Disk Map — Visual Storage Explorer & Treemap (WizTree-style)', cat: 'Tab', moduleId: 'diskmap', run: () => SwitchAppLayoutView('diskmap') },
    { label: '🧩 System Devices & Drivers Tree (with Official Driver Links)', cat: 'Tab', moduleId: 'devices', run: () => SwitchAppLayoutView('devices') },
    { label: '🗂️ File Organizer', cat: 'Tab', moduleId: 'organizer', run: () => SwitchAppLayoutView('organizer') },
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
        (!item.moduleId || IsModuleEnabled(item.moduleId)) &&
        (!q || item.label.toLowerCase().includes(q) || item.cat.toLowerCase().includes(q))
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
    SetDomText('sumStoreTotal',      sum.total ?? apps.length);
    SetDomText('sumStoreInstalled',  sum.installed ?? apps.filter(a => a.installed).length);
    SetDomText('sumStoreLaunchable', sum.launchable ?? apps.filter(a => a.canLaunch).length);
    SetDomText('sumStoreOutdated',   sum.outdated ?? apps.filter(a => a.versionTier === 'update' || a.versionTier === 'critical').length);
    SetDomText('sumStoreAvailable',  sum.available ?? apps.filter(a => !a.installed).length);
    SetDomText('lblStoreWingetVer',  data.wingetAvailable ? (data.wingetVersion || 'Ready') : 'Not Installed');

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
        else if (cat === 'launchable' && !app.canLaunch) return false;
        else if (cat === 'not_installed' && app.installed) return false;
        else if (cat !== 'all' && cat !== 'requested' && cat !== 'installed' && cat !== 'launchable' && cat !== 'not_installed' && app.category !== cat) return false;

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

        if (app.installed && app.canLaunch) {
            const launchBtn = document.createElement('button');
            launchBtn.type = 'button';
            launchBtn.className = 'btn-store-launch';
            launchBtn.textContent = '▶ Launch';
            launchBtn.title = `Launch ${app.name}`;
            launchBtn.addEventListener('click', () => TriggerLaunchInstalledApp(app.id, app.name));
            actions.appendChild(launchBtn);
        }

        const mainBtn = document.createElement('button');
        mainBtn.type = 'button';
        if (app.installed && app.customType !== 'pawnio' && app.customType !== 'github_msi') {
            mainBtn.className = 'btn-store-upgrade';
            mainBtn.textContent = '⬆️ Upgrade';
            mainBtn.title = `Upgrade ${app.name} via WinGet`;
            mainBtn.addEventListener('click', () => TriggerInstallOneApp(app.id, app.name, 'upgrade'));
        } else {
            mainBtn.className = 'btn-store-install';
            mainBtn.textContent = app.installed ? (app.customType === 'github_msi' ? '⬆️ Update' : '↻ Reinstall') : '⬇️ Install';
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

window.TriggerLaunchInstalledApp = function(pkgId, appName) {
    const st = document.getElementById('appStoreStatus');
    if (st) {
        st.classList.remove('sharing-error');
        st.textContent = `Launching ${appName}...`;
    }
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'APPSTORE_LAUNCH_APP', id: pkgId }));
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
            <td style="color:var(--cw-accent-soft); user-select:text;">${EscapeHtmlTp(r.id)}</td>
            <td style="color:var(--cw-text-muted);">${EscapeHtmlTp(r.version)}</td>
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
            <span style="color:var(--cw-text-muted);">${EscapeHtmlTp(d.label)}</span>
            <span class="diskmap-drive-mini-bar"><span class="diskmap-drive-mini-fill" style="width:${d.usedPct}%; background:${fillColor}; display:block;"></span></span>
            <span style="font-size:10px; color:var(--cw-text-secondary);">${d.usedGB}/${d.totalGB} GB</span>
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
                <td class="tp-cell-num" style="font-weight:700; color:var(--cw-text-primary);">${FormatDiskBytes(c.size)}</td>
                <td style="white-space:nowrap;"><span class="diskmap-pct-bar"><span class="diskmap-pct-fill" style="width:${pct.toFixed(1)}%; background:${color}; display:block;"></span></span><span style="color:var(--cw-text-muted); font-size:10px;">${pct.toFixed(1)}%</span></td>
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
                <td><span class="sharing-badge badge-neutral" style="border-color:${color}; color:var(--cw-text-primary);">${EscapeHtmlTp(f.ext || '')}</span></td>
                <td class="tp-cell-num" style="font-weight:700; color:var(--cw-text-primary);">${FormatDiskBytes(f.size)}</td>
                <td class="tp-cell-num" style="color:var(--cw-text-muted);">${pct.toFixed(2)}%</td>
                <td style="color:var(--cw-text-muted); white-space:nowrap;">${EscapeHtmlTp(f.modified || '--')}</td>
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
                <td class="tp-cell-num" style="font-weight:700; color:var(--cw-text-primary);">${FormatDiskBytes(e.size)}</td>
                <td style="white-space:nowrap;"><span class="diskmap-pct-bar"><span class="diskmap-pct-fill" style="width:${pct.toFixed(1)}%; background:${color}; display:block;"></span></span><span style="color:var(--cw-text-muted); font-size:10px;">${pct.toFixed(1)}%</span></td>
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
    if (!ConfirmDestructiveAction(`Move to Windows Recycle Bin?\n\n${path}\n\n(Protected OS system folders are automatically blocked.)`)) return;
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
            <div style="font-weight:700; color:var(--cw-accent-soft);">${it.isDir ? '📁' : '📄'} ${EscapeHtmlTp(it.name)}</div>
            <div style="color:var(--cw-text-primary);">Size: <strong>${FormatDiskBytes(it.size)}</strong> (${pct}% of current view)</div>
            ${it.isDir ? `<div style="color:var(--cw-text-muted);">${(it.files || 0).toLocaleString()} files · ${(it.dirs || 0).toLocaleString()} folders · Double-click to zoom</div>` : `<div style="color:var(--cw-text-muted);">Type: ${EscapeHtmlTp(it.ext || 'file')}${it.modified ? ' · Modified: ' + it.modified : ''}</div>`}
            <div style="color:var(--cw-text-muted); font-size:9.5px; word-break:break-all; margin-top:2px;">${EscapeHtmlTp(it.path)}</div>
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

// =========================================================================
// [PHASE 1 & 2] DASHBOARD LAYOUT CUSTOMIZER + WINDOW CONTROLS ENGINE
// Supports Show/Hide Frames, Per-Section Visibility, Drag-and-Drop Reorder,
// Half/Full Width Toggle, Collapse, 1-Click Presets, Always-on-Top & Opacity
// =========================================================================
const CW_LAYOUT_STORAGE_KEY = 'corewatch_dashboard_layout_v1';

const CW_CARD_CATALOG = [
    { id: 'hardware', label: '⚡ Hardware Metrics', defaultWide: false },
    { id: 'identity', label: '👤 System Identity', defaultWide: false },
    { id: 'storage',  label: '💾 Storage', defaultWide: false },
    { id: 'infra',    label: '🛠️ System Infrastructure', defaultWide: false },
    { id: 'network',  label: '📡 Network Profile System', defaultWide: true },
    { id: 'console',  label: '📑 Log Profile Console', defaultWide: true }
];

const CW_METRIC_GROUPS = [
    {
        cardId: 'hardware',
        title: '⚡ Hardware Metrics',
        metrics: [
            { key: 'hw-cpu',      label: 'CPU Load, Clock, Temp & Throttling' },
            { key: 'hw-gpu',      label: 'GPU Utilization, Power & Temp' },
            { key: 'hw-vram',     label: 'GPU VRAM Allocation Sub-Bar' },
            { key: 'hw-ram',      label: 'RAM Allocation & Cache Matrix' },
            { key: 'hw-pagefile', label: 'Pagefile Commitment' },
            { key: 'hw-topproc',  label: 'Top Active Process Callout' }
        ]
    },
    {
        cardId: 'identity',
        title: '👤 System Identity',
        metrics: [
            { key: 'id-host',      label: 'Host & Domain / Workgroup' },
            { key: 'id-os',        label: 'OS Edition, Build & Update' },
            { key: 'id-runtime',   label: 'DirectX, Virtualization, Secure Boot & PS' },
            { key: 'id-java',      label: 'Java Runtime Picker' },
            { key: 'id-telemetry', label: 'Windows Telemetry Toggle' },
            { key: 'id-stability', label: 'Privilege, Pending Reboot & Last Crash' }
        ]
    },
    {
        cardId: 'infra',
        title: '🛠️ System Infrastructure',
        metrics: [
            { key: 'infra-board',   label: 'Motherboard & BIOS Version' },
            { key: 'infra-power',   label: 'Power Plan & System Uptime' },
            { key: 'infra-audio',   label: 'Audio Output & Input Devices' },
            { key: 'infra-display', label: 'Display Picker, HDR, Night Light & Warmth' }
        ]
    },
    {
        cardId: 'network',
        title: '📡 Network Profile System',
        metrics: [
            { key: 'net-defender',  label: 'Defender Tamper / Behavior / Cloud / IOAV' },
            { key: 'net-dnsarp',    label: 'DNS Servers, DNS Check & ARP Gateway' },
            { key: 'net-drivers',   label: 'Ethernet/Wi-Fi Drivers & Adapter Toggles' },
            { key: 'net-speedtest', label: 'Speedtest, Jitter & Packet Loss Bar' },
            { key: 'net-bandwidth', label: 'Live RX/TX Bandwidth Activity Bar' }
        ]
    }
];

const CW_LAYOUT_PRESETS = {
    full: {
        preset: 'full',
        order: ['hardware', 'identity', 'storage', 'infra', 'network', 'console'],
        hiddenCards: [],
        dockedCards: [],
        wideCards: ['network', 'console'],
        collapsedCards: [],
        hiddenMetrics: []
    },
    hardware: {
        preset: 'hardware',
        order: ['hardware', 'storage', 'infra', 'identity', 'network', 'console'],
        hiddenCards: ['identity', 'network', 'console'],
        dockedCards: [],
        wideCards: ['hardware'],
        collapsedCards: [],
        hiddenMetrics: []
    },
    netops: {
        preset: 'netops',
        order: ['network', 'hardware', 'storage', 'console', 'identity', 'infra'],
        hiddenCards: ['identity', 'infra'],
        dockedCards: [],
        wideCards: ['network', 'console'],
        collapsedCards: [],
        hiddenMetrics: ['hw-pagefile']
    },
    compact: {
        preset: 'compact',
        order: ['hardware', 'storage', 'network', 'identity', 'infra', 'console'],
        hiddenCards: ['identity', 'infra', 'console'],
        dockedCards: [],
        wideCards: ['network'],
        collapsedCards: [],
        hiddenMetrics: ['hw-pagefile', 'net-defender', 'net-speedtest']
    }
};

window._cwLayoutState = JSON.parse(JSON.stringify(CW_LAYOUT_PRESETS.full));
window._cwWindowAlwaysOnTop = false;
window._cwWindowOpacity = 1.0;
window._cwDragCardId = null;

function NormalizeLayoutState(raw) {
    const def = CW_LAYOUT_PRESETS.full;
    if (!raw || typeof raw !== 'object') return JSON.parse(JSON.stringify(def));
    const allIds = CW_CARD_CATALOG.map(c => c.id);
    const rawOrder = Array.isArray(raw.order) ? raw.order.filter(id => allIds.includes(id)) : [];
    const order = [...rawOrder, ...allIds.filter(id => !rawOrder.includes(id))];
    const hiddenCards = Array.isArray(raw.hiddenCards) ? raw.hiddenCards.filter(id => allIds.includes(id)) : [];
    const dockedCards = Array.isArray(raw.dockedCards)
        ? raw.dockedCards.filter(id => allIds.includes(id) && !hiddenCards.includes(id))
        : [];
    return {
        preset: typeof raw.preset === 'string' ? raw.preset : 'custom',
        order,
        hiddenCards,
        dockedCards,
        wideCards: Array.isArray(raw.wideCards) ? raw.wideCards.filter(id => allIds.includes(id)) : [...def.wideCards],
        collapsedCards: Array.isArray(raw.collapsedCards) ? raw.collapsedCards.filter(id => allIds.includes(id)) : [],
        hiddenMetrics: Array.isArray(raw.hiddenMetrics) ? raw.hiddenMetrics.map(String) : []
    };
}

function LoadLocalLayoutFallback() {
    try {
        const str = localStorage.getItem(CW_LAYOUT_STORAGE_KEY);
        if (str) return NormalizeLayoutState(JSON.parse(str));
    } catch {}
    return NormalizeLayoutState(CW_LAYOUT_PRESETS.full);
}

function PersistLayoutState(pushToHost = true) {
    try {
        localStorage.setItem(CW_LAYOUT_STORAGE_KEY, JSON.stringify(window._cwLayoutState));
    } catch {}
    if (pushToHost && window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(JSON.stringify({
            command: 'SAVE_UI_LAYOUT',
            layout: window._cwLayoutState
        }));
    }
}

function FindDashboardCardElement(cardId) {
    return document.querySelector(`.dashboard-card[data-card-id="${cardId}"]`);
}

function InjectCardEditHeaders() {
    const grid = document.getElementById('viewDashboardGrid');
    if (!grid) return;

    document.querySelectorAll('.dashboard-card[data-card-id]').forEach(card => {
        const cardId = card.dataset.cardId;
        if (card.dataset.editWired === '1') return;
        card.dataset.editWired = '1';

        let headerHost = card.querySelector(':scope > .console-header-row');
        if (!headerHost) {
            const h2 = card.querySelector(':scope > h2');
            if (h2) {
                headerHost = document.createElement('div');
                headerHost.className = 'card-header-bar';
                card.insertBefore(headerHost, h2);
                headerHost.appendChild(h2);
            }
        }

        if (headerHost) {
            const ctrls = document.createElement('div');
            ctrls.className = 'card-edit-controls';
            ctrls.innerHTML = `
                <span class="card-drag-grip" title="Drag card to reorder">⠿</span>
                <button type="button" class="card-ctrl-btn ctrl-width" onclick="ToggleDashboardCardWidth('${cardId}')" title="Toggle Half / Full Width">◧</button>
                <button type="button" class="card-ctrl-btn ctrl-dock" onclick="ToggleDashboardCardDock('${cardId}')" title="Move frame to Side Pop-Out Telemetry Dock">◫</button>
                <button type="button" class="card-ctrl-btn ctrl-collapse" onclick="ToggleDashboardCardCollapse('${cardId}')" title="Collapse / Expand card">▾</button>
                <button type="button" class="card-ctrl-btn ctrl-hide" onclick="SetDashboardCardPlacement('${cardId}', 'hide')" title="Hide this frame">✕</button>
            `;
            headerHost.appendChild(ctrls);
        }

        // Native HTML5 Drag-and-Drop Reordering (active only when grid has .layout-edit-mode)
        card.addEventListener('dragstart', (e) => {
            if (!grid.classList.contains('layout-edit-mode') || card.classList.contains('card-docked')) { e.preventDefault(); return; }
            window._cwDragCardId = cardId;
            card.classList.add('is-dragging');
            try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', cardId); } catch {}
        });
        card.addEventListener('dragend', () => {
            window._cwDragCardId = null;
            grid.querySelectorAll('.dashboard-card').forEach(c => c.classList.remove('is-dragging', 'drag-over'));
        });
        card.addEventListener('dragover', (e) => {
            if (!window._cwDragCardId || window._cwDragCardId === cardId || card.classList.contains('card-docked')) return;
            e.preventDefault();
            card.classList.add('drag-over');
        });
        card.addEventListener('dragleave', () => {
            card.classList.remove('drag-over');
        });
        card.addEventListener('drop', (e) => {
            e.preventDefault();
            card.classList.remove('drag-over');
            const srcId = window._cwDragCardId;
            if (!srcId || srcId === cardId) return;
            ReorderDashboardCards(srcId, cardId);
        });
    });
}

function SyncSideDockUiChrome() {
    const st = window._cwLayoutState;
    const dockCount = (st.dockedCards || []).filter(id => !st.hiddenCards.includes(id)).length;
    const dock = document.getElementById('sideTelemetryDock');
    const toggleBtn = document.getElementById('btnSideDockToggle');
    const pullTab = document.getElementById('sideDockPullTab');

    if (dockCount === 0 && dock && dock.style.display !== 'none') {
        CloseSideTelemetryDock();
    }

    const isOpen = !!(dock && dock.style.display !== 'none');
    if (toggleBtn) {
        toggleBtn.style.display = dockCount > 0 ? 'inline-flex' : 'none';
        toggleBtn.classList.toggle('active', isOpen);
        SetDomText('lblSideDockCount', dockCount);
    }
    if (pullTab) {
        pullTab.style.display = (dockCount > 0 && !isOpen) ? 'flex' : 'none';
        pullTab.innerHTML = `<span>◫</span><span style="font-size:9px;font-weight:700;">${dockCount}</span>`;
    }
}

function ApplyDashboardLayout(persist = false) {
    const grid = document.getElementById('viewDashboardGrid');
    const dockHost = document.getElementById('sideDockCardsHost');
    if (!grid) return;

    InjectCardEditHeaders();
    const st = window._cwLayoutState;
    const isEdit = grid.classList.contains('layout-edit-mode');

    // 1. Place and order DOM cards cleanly into Main Grid vs Live Side Telemetry Dock
    st.order.forEach(cardId => {
        const card = FindDashboardCardElement(cardId);
        if (!card) return;

        const isHidden    = st.hiddenCards.includes(cardId);
        const isDocked    = !isHidden && (st.dockedCards || []).includes(cardId) && !!dockHost;
        const isWide      = st.wideCards.includes(cardId);
        const isCollapsed = st.collapsedCards.includes(cardId);

        if (isDocked) {
            dockHost.appendChild(card);
            card.classList.remove('card-hidden', 'card-wide', 'card-half');
            card.classList.add('card-docked');
            card.classList.toggle('card-collapsed', isCollapsed);
            card.draggable = false;
        } else {
            grid.appendChild(card);
            card.classList.remove('card-docked');
            card.classList.toggle('card-hidden', isHidden);
            card.classList.toggle('card-wide', isWide);
            card.classList.toggle('card-half', !isWide);
            card.classList.toggle('card-collapsed', isCollapsed);
            card.draggable = isEdit;
        }

        const wBtn = card.querySelector('.ctrl-width');
        if (wBtn) {
            wBtn.textContent = isWide ? '▬' : '◧';
            wBtn.title = isWide ? 'Full Width — Click for Half Width' : 'Half Width — Click for Full Width';
        }
        const dBtn = card.querySelector('.ctrl-dock');
        if (dBtn) {
            dBtn.classList.toggle('is-docked', isDocked);
            dBtn.textContent = isDocked ? '↩ Grid' : '◫';
            dBtn.title = isDocked ? 'Return frame to Main Dashboard Grid' : 'Move frame to Side Pop-Out Telemetry Dock';
        }
        const cBtn = card.querySelector('.ctrl-collapse');
        if (cBtn) {
            cBtn.textContent = isCollapsed ? '▸' : '▾';
            cBtn.title = isCollapsed ? 'Expand frame' : 'Collapse frame';
        }
    });

    // 2. Apply per-section metric visibility across both Grid and Side Dock
    document.querySelectorAll('#viewDashboardGrid [data-metric-key], #sideDockCardsHost [data-metric-key]').forEach(el => {
        const key = el.dataset.metricKey;
        el.classList.toggle('metric-hidden', st.hiddenMetrics.includes(key));
    });

    SyncSideDockUiChrome();
    RenderLayoutCustomizerDrawer();
    if (persist) PersistLayoutState(true);
}

function ReorderDashboardCards(srcId, targetId) {
    const order = [...window._cwLayoutState.order];
    const fromIdx = order.indexOf(srcId);
    const toIdx   = order.indexOf(targetId);
    if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return;
    order.splice(fromIdx, 1);
    order.splice(toIdx, 0, srcId);
    window._cwLayoutState.order = order;
    window._cwLayoutState.preset = 'custom';
    ApplyDashboardLayout(true);
}

window.MoveDashboardCardStep = function(cardId, delta) {
    const order = [...window._cwLayoutState.order];
    const idx = order.indexOf(cardId);
    const next = idx + delta;
    if (idx < 0 || next < 0 || next >= order.length) return;
    [order[idx], order[next]] = [order[next], order[idx]];
    window._cwLayoutState.order = order;
    window._cwLayoutState.preset = 'custom';
    ApplyDashboardLayout(true);
};

window.SetDashboardCardPlacement = function(cardId, mode) {
    const hidden = new Set(window._cwLayoutState.hiddenCards);
    const docked = new Set(window._cwLayoutState.dockedCards || []);

    if (mode === 'hide') {
        // Keep at least 1 card active across Grid + Side Dock so the app never looks blank
        if (CW_CARD_CATALOG.length - hidden.size <= 1 && !hidden.has(cardId)) return;
        hidden.add(cardId);
        docked.delete(cardId);
    } else if (mode === 'dock') {
        hidden.delete(cardId);
        docked.add(cardId);
    } else {
        hidden.delete(cardId);
        docked.delete(cardId);
    }

    window._cwLayoutState.hiddenCards = Array.from(hidden);
    window._cwLayoutState.dockedCards = Array.from(docked);
    window._cwLayoutState.preset = 'custom';
    ApplyDashboardLayout(true);

    // If user docked directly from the card header while customizer is closed, pop open the Side Dock
    if (mode === 'dock') {
        const custDrawer = document.getElementById('layoutCustomizerDrawer');
        if (!custDrawer || custDrawer.style.display === 'none') {
            OpenSideTelemetryDock();
        }
    }
};

window.SetDashboardCardVisible = function(cardId, visible) {
    SetDashboardCardPlacement(cardId, visible ? 'grid' : 'hide');
};

window.ToggleDashboardCardDock = function(cardId) {
    const isDocked = (window._cwLayoutState.dockedCards || []).includes(cardId);
    SetDashboardCardPlacement(cardId, isDocked ? 'grid' : 'dock');
};

window.OpenSideTelemetryDock = function() {
    const dockCount = (window._cwLayoutState.dockedCards || []).filter(id => !window._cwLayoutState.hiddenCards.includes(id)).length;
    if (dockCount === 0) {
        OpenLayoutCustomizer();
        return;
    }
    const cust = document.getElementById('layoutCustomizerDrawer');
    if (cust && cust.style.display !== 'none') CloseLayoutCustomizer();

    const dock = document.getElementById('sideTelemetryDock');
    if (dock) dock.style.display = 'flex';
    SyncSideDockUiChrome();
    window.chrome?.webview?.postMessage('Side-Dock:open');
};

window.CloseSideTelemetryDock = function() {
    const dock = document.getElementById('sideTelemetryDock');
    if (dock) dock.style.display = 'none';
    SyncSideDockUiChrome();
    window.chrome?.webview?.postMessage('Side-Dock:closed');
};

window.ToggleSideTelemetryDock = function() {
    const dock = document.getElementById('sideTelemetryDock');
    if (dock && dock.style.display !== 'none') CloseSideTelemetryDock();
    else OpenSideTelemetryDock();
};

window.ToggleDashboardCardWidth = function(cardId) {
    const wide = new Set(window._cwLayoutState.wideCards);
    if (wide.has(cardId)) wide.delete(cardId);
    else wide.add(cardId);
    window._cwLayoutState.wideCards = Array.from(wide);
    window._cwLayoutState.preset = 'custom';
    ApplyDashboardLayout(true);
};

window.ToggleDashboardCardCollapse = function(cardId) {
    const col = new Set(window._cwLayoutState.collapsedCards);
    if (col.has(cardId)) col.delete(cardId);
    else col.add(cardId);
    window._cwLayoutState.collapsedCards = Array.from(col);
    ApplyDashboardLayout(true);
};

window.SetDashboardMetricVisible = function(metricKey, visible) {
    const hidden = new Set(window._cwLayoutState.hiddenMetrics);
    if (visible) hidden.delete(metricKey);
    else hidden.add(metricKey);
    window._cwLayoutState.hiddenMetrics = Array.from(hidden);
    window._cwLayoutState.preset = 'custom';
    ApplyDashboardLayout(true);
};

window.ApplyDashboardPreset = function(presetKey) {
    const p = CW_LAYOUT_PRESETS[presetKey];
    if (!p) return;
    window._cwLayoutState = JSON.parse(JSON.stringify(p));
    ApplyDashboardLayout(true);
    AppendConsoleLogEntry(`[LAYOUT] Applied dashboard preset: ${presetKey}`);
};

window.ResetDashboardLayoutToDefault = function() {
    ApplyDashboardPreset('full');
};

function RenderLayoutCustomizerDrawer() {
    const drawer = document.getElementById('layoutCustomizerDrawer');
    if (!drawer || drawer.style.display === 'none') return;

    const st = window._cwLayoutState;

    // Highlight active preset pill
    drawer.querySelectorAll('.layout-preset-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.preset === st.preset);
    });

    // Render ordered card list with 3-way placement (Grid | Dock | Hide)
    const cardList = document.getElementById('layoutCardsChecklist');
    if (cardList) {
        cardList.innerHTML = st.order.map((cardId, idx) => {
            const meta = CW_CARD_CATALOG.find(c => c.id === cardId) || { id: cardId, label: cardId };
            const isHidden = st.hiddenCards.includes(cardId);
            const isDocked = !isHidden && (st.dockedCards || []).includes(cardId);
            const mode     = isHidden ? 'hide' : (isDocked ? 'dock' : 'grid');
            const isWide   = st.wideCards.includes(cardId);
            const rowCls   = isHidden ? 'is-hidden-card' : (isDocked ? 'is-docked-card' : '');
            return `<div class="layout-card-row ${rowCls}">
                <div class="layout-card-row-left" title="${meta.label}">
                    <span>${meta.label}</span>
                </div>
                <div class="layout-card-row-actions">
                    <div class="layout-place-group" role="group" aria-label="Placement for ${meta.label}">
                        <button type="button" class="layout-place-btn ${mode === 'grid' ? 'active-grid' : ''}" onclick="SetDashboardCardPlacement('${cardId}', 'grid')" title="Show on Main Dashboard Grid">Grid</button>
                        <button type="button" class="layout-place-btn ${mode === 'dock' ? 'active-dock' : ''}" onclick="SetDashboardCardPlacement('${cardId}', 'dock')" title="Move live frame to Side Pop-Out Telemetry Dock">Dock</button>
                        <button type="button" class="layout-place-btn ${mode === 'hide' ? 'active-hide' : ''}" onclick="SetDashboardCardPlacement('${cardId}', 'hide')" title="Completely hide frame">Hide</button>
                    </div>
                    <button type="button" class="card-ctrl-btn" ${idx === 0 ? 'disabled' : ''} onclick="MoveDashboardCardStep('${cardId}', -1)" title="Move up">▲</button>
                    <button type="button" class="card-ctrl-btn" ${idx === st.order.length - 1 ? 'disabled' : ''} onclick="MoveDashboardCardStep('${cardId}', 1)" title="Move down">▼</button>
                    <button type="button" class="card-ctrl-btn" ${mode !== 'grid' ? 'disabled' : ''} onclick="ToggleDashboardCardWidth('${cardId}')" title="Toggle Half / Full Width">${isWide ? 'Wide' : 'Half'}</button>
                </div>
            </div>`;
        }).join('');
    }

    // Render per-section metric toggles (preserving open <details> state)
    const metList = document.getElementById('layoutMetricsChecklist');
    if (metList) {
        const openCards = new Set(Array.from(metList.querySelectorAll('details[open]')).map(d => d.dataset.card));
        metList.innerHTML = CW_METRIC_GROUPS.map(g => {
            const openAttr = openCards.has(g.cardId) ? 'open' : '';
            const checks = g.metrics.map(m => {
                const checked = !st.hiddenMetrics.includes(m.key) ? 'checked' : '';
                return `<label><input type="checkbox" ${checked} onchange="SetDashboardMetricVisible('${m.key}', this.checked)"> ${m.label}</label>`;
            }).join('');
            return `<details class="layout-metric-group-box" data-card="${g.cardId}" ${openAttr}>
                <summary>${g.title}</summary>
                <div class="layout-metric-checks">${checks}</div>
            </details>`;
        }).join('');
    }
}

window.OpenLayoutCustomizer = function() {
    SwitchAppLayoutView('dashboard');
    const sideDock = document.getElementById('sideTelemetryDock');
    if (sideDock && sideDock.style.display !== 'none') CloseSideTelemetryDock();

    const drawer = document.getElementById('layoutCustomizerDrawer');
    const grid   = document.getElementById('viewDashboardGrid');
    const btn    = document.getElementById('btnCustomizeLayout');
    if (drawer) drawer.style.display = 'flex';
    if (grid)   grid.classList.add('layout-edit-mode');
    if (btn)    btn.classList.add('active');
    ApplyDashboardLayout(false);
};

window.CloseLayoutCustomizer = function() {
    const drawer = document.getElementById('layoutCustomizerDrawer');
    const grid   = document.getElementById('viewDashboardGrid');
    const btn    = document.getElementById('btnCustomizeLayout');
    if (drawer) drawer.style.display = 'none';
    if (grid)   grid.classList.remove('layout-edit-mode');
    if (btn)    btn.classList.remove('active');
    ApplyDashboardLayout(false);
};

window.ToggleLayoutCustomizer = function() {
    const drawer = document.getElementById('layoutCustomizerDrawer');
    if (drawer && drawer.style.display !== 'none') CloseLayoutCustomizer();
    else OpenLayoutCustomizer();
};

window._cwWindowLockMode = 'none';

function SyncWindowLockModeUi(lockMode) {
    if (lockMode === 'none' || lockMode === 'position' || lockMode === 'all') {
        window._cwWindowLockMode = lockMode;
    }
    const mode = window._cwWindowLockMode || 'none';
    const btn = document.getElementById('btnLockWindow');
    if (btn) {
        btn.classList.toggle('lock-pos', mode === 'position');
        btn.classList.toggle('lock-all', mode === 'all');
        if (mode === 'position') {
            btn.textContent = '🔒';
            btn.title = 'Position Locked (Resize still allowed) — Click to lock position & size';
        } else if (mode === 'all') {
            btn.textContent = '🔐';
            btn.title = 'Position & Size Locked — Click to unlock window';
        } else {
            btn.textContent = '🔓';
            btn.title = 'Window Unlocked — Click to lock window position';
        }
    }
    if (mode === 'all') {
        document.documentElement.style.cursor = '';
        document.body.style.cursor = '';
    }
}

window.CycleWindowLockMode = function() {
    const cur = window._cwWindowLockMode || 'none';
    const next = cur === 'none' ? 'position' : (cur === 'position' ? 'all' : 'none');
    SyncWindowLockModeUi(next);
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'SET_WINDOW_LOCK_MODE', mode: next }));
    const label = next === 'position' ? 'Position Locked' : (next === 'all' ? 'Position & Size Locked' : 'Unlocked');
    AppendConsoleLogEntry(`[WINDOW] Lock state: ${label}`);
};

// Window Always-on-Top & Opacity Controls (Phase 1)
function SyncWindowPinAndOpacityUi(alwaysOnTop, opacity, windowLockMode) {
    if (alwaysOnTop !== undefined && alwaysOnTop !== null) {
        window._cwWindowAlwaysOnTop = !!alwaysOnTop;
    }
    if (opacity !== undefined && opacity !== null && Number.isFinite(Number(opacity))) {
        window._cwWindowOpacity = Math.max(0.7, Math.min(1.0, Number(opacity)));
    }
    if (windowLockMode !== undefined && windowLockMode !== null) {
        SyncWindowLockModeUi(windowLockMode);
    }
    const pinBtn = document.getElementById('btnPinOnTop');
    if (pinBtn) {
        pinBtn.classList.toggle('active', window._cwWindowAlwaysOnTop);
        pinBtn.title = window._cwWindowAlwaysOnTop ? 'Pinned Always on Top — Click to Unpin' : 'Toggle Always on Top (Pin Window)';
    }
    const chk = document.getElementById('chkWindowAlwaysOnTop');
    if (chk) chk.checked = window._cwWindowAlwaysOnTop;

    const pct = Math.round(window._cwWindowOpacity * 100);
    const rng = document.getElementById('rngWindowOpacity');
    if (rng) rng.value = String(pct);
    SetDomText('lblWindowOpacity', `${pct}%`);
}

window.SetWindowAlwaysOnTop = function(enabled) {
    SyncWindowPinAndOpacityUi(!!enabled, undefined);
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'SET_ALWAYS_ON_TOP', enabled: !!enabled }));
    AppendConsoleLogEntry(`[WINDOW] Always on Top: ${enabled ? 'ON' : 'OFF'}`);
};

window.ToggleWindowAlwaysOnTop = function() {
    SetWindowAlwaysOnTop(!window._cwWindowAlwaysOnTop);
};

window.OnWindowOpacityInput = function(rawPct) {
    const pct = Math.max(70, Math.min(100, Number(rawPct) || 100));
    SetDomText('lblWindowOpacity', `${pct}%`);
};

window.OnWindowOpacityCommit = function(rawPct) {
    const pct = Math.max(70, Math.min(100, Number(rawPct) || 100));
    const op = Number((pct / 100).toFixed(2));
    SyncWindowPinAndOpacityUi(undefined, op);
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'SET_WINDOW_OPACITY', opacity: op }));
};

function ApplyHostUiSettingsState(data) {
    if (!data) return;
    SyncWindowPinAndOpacityUi(data.alwaysOnTop, data.opacity, data.windowLockMode);
    if (data.layout && typeof data.layout === 'object') {
        window._cwLayoutState = NormalizeLayoutState(data.layout);
        try { localStorage.setItem(CW_LAYOUT_STORAGE_KEY, JSON.stringify(window._cwLayoutState)); } catch {}
    } else {
        window._cwLayoutState = LoadLocalLayoutFallback();
    }
    if (data.diagxDismissed && typeof data.diagxDismissed === 'object') {
        window._diagXDismissed = NormalizeDiagXDismissed(data.diagxDismissed);
        try { localStorage.setItem(DIAGX_DISMISSED_STORAGE_KEY, JSON.stringify(window._diagXDismissed)); } catch {}
        if (window._diagXReport) RecalculateAndRenderDiagX();
    } else {
        window._diagXDismissed = LoadLocalDiagXDismissed();
    }
    if (data.theme && typeof data.theme === 'object') {
        ApplyThemeState(data.theme, false);
    } else {
        ApplyThemeState(LoadLocalThemeFallback(), false);
    }
    ApplyDashboardLayout(false);
}

document.addEventListener('DOMContentLoaded', () => {
    window._cwLayoutState = LoadLocalLayoutFallback();
    window._diagXDismissed = LoadLocalDiagXDismissed();
    ApplyThemeState(LoadLocalThemeFallback(), false);
    InitThemeStudioDrag();
    InitDiskPartitionerDrag();
    ApplyDashboardLayout(false);
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const dpPop = document.getElementById('diskPartitionerPopup');
        if (dpPop && dpPop.style.display !== 'none') {
            CloseDiskPartitioner();
            return;
        }
        const themePop = document.getElementById('themeStudioPopup');
        if (themePop && themePop.style.display !== 'none') {
            CloseThemeStudio();
            return;
        }
        const jiraModal = document.getElementById('jiraCreateIssueModal');
        if (jiraModal && jiraModal.style.display !== 'none') {
            CloseJiraCreateIssueModal();
            return;
        }
        const profModal = document.getElementById('profileEditorModal');
        if (profModal && profModal.style.display !== 'none') {
            CloseProfileEditorModal();
            return;
        }
        const setModal = document.getElementById('coreWatchSettingsModal');
        if (setModal && setModal.style.display !== 'none') {
            CloseSettingsModal();
            return;
        }
        const drawer = document.getElementById('layoutCustomizerDrawer');
        if (drawer && drawer.style.display !== 'none') {
            CloseLayoutCustomizer();
        }
        const sideDock = document.getElementById('sideTelemetryDock');
        if (sideDock && sideDock.style.display !== 'none') {
            CloseSideTelemetryDock();
        }
    }
});

// =========================================================================
// UNIFIED APPLICATION SETTINGS & MODULAR TAB REGISTRY CONTROLLER
// =========================================================================
window._cwAppSettings = null;
window._cwModulesState = null;
window._cwVersionInfo = null;
window._cwAutoStartInfo = null;
window._cwUpdateReleaseUrl = '';
window._cwAutoUpdateCheckedOnce = false;
window._cwDraftDisabledModules = new Set();

function IsModuleEnabled(moduleId) {
    if (!moduleId || moduleId === 'dashboard') return true;
    const ms = window._cwModulesState;
    if (!ms || !Array.isArray(ms.modules) || ms.modules.length === 0) return true;
    const rec = ms.modules.find(m => m.id === moduleId);
    return rec ? !!rec.enabled : true;
}

function ApplyModularTabsVisibility() {
    const ms = window._cwModulesState;
    if (!ms || !Array.isArray(ms.modules) || ms.modules.length === 0) return;

    let anySystemEnabled = false;
    let anyDevEnabled = false;
    let anyOpsEnabled = false;
    ms.modules.forEach(m => {
        const btn = m.tabButtonId ? document.getElementById(m.tabButtonId) : null;
        if (btn) {
            btn.style.display = m.enabled ? '' : 'none';
        }
        if (m.navSlot === 'system' && m.enabled) anySystemEnabled = true;
        if (m.navSlot === 'dev' && m.enabled) anyDevEnabled = true;
        if (m.navSlot === 'ops' && m.enabled) anyOpsEnabled = true;
    });

    const sysDrop = document.getElementById('navSystemDropdown');
    if (sysDrop) sysDrop.style.display = anySystemEnabled ? '' : 'none';

    const devDrop = document.getElementById('navDevDropdown');
    if (devDrop) devDrop.style.display = anyDevEnabled ? '' : 'none';

    const opsDrop = document.getElementById('navOpsDropdown');
    if (opsDrop) opsDrop.style.display = anyOpsEnabled ? '' : 'none';

    const bellBtn = document.getElementById('btnHeaderAlertsBell');
    if (bellBtn) bellBtn.style.display = IsModuleEnabled('alerts') ? '' : 'none';

    const modeDrop = document.getElementById('navModePillDropdown');
    if (modeDrop) {
        modeDrop.style.display = IsModuleEnabled('profiles') ? '' : 'none';
    }

    // If the currently active tab was disabled, gracefully return to Dashboard
    if (window._activeViewKey && window._activeViewKey !== 'dashboard' && !IsModuleEnabled(window._activeViewKey)) {
        SwitchAppLayoutView('dashboard');
    }
}

function SetSettingsStatusBanner(msg, isErr = false) {
    const el = document.getElementById('lblSettingsSaveStatus');
    if (!el) return;
    el.textContent = msg || '';
    el.classList.toggle('is-err', !!isErr);
}

function RenderSettingsModulesChecklist() {
    const host = document.getElementById('settingsModulesList');
    const summaryEl = document.getElementById('lblSetModulesSummary');
    const ms = window._cwModulesState;
    if (!host) return;

    if (!ms || !Array.isArray(ms.modules) || ms.modules.length === 0) {
        host.innerHTML = '<div class="driver-text-node">Module catalog unavailable.</div>';
        return;
    }

    const total = ms.modules.length;
    const installedCount = ms.modules.filter(m => m.installed).length;
    const enabledCount = ms.modules.filter(m => m.installed && !window._cwDraftDisabledModules.has(m.id)).length;
    if (summaryEl) {
        summaryEl.textContent = `${enabledCount} Active · ${installedCount} / ${total} Installed (${window._cwVersionInfo?.installMode || ms.installMode || 'Full'})`;
    }

    const groups = new Map();
    ms.modules.forEach(m => {
        const g = m.group || 'Modules';
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push(m);
    });

    let html = '';
    groups.forEach((items, groupName) => {
        html += `<div class="cw-mod-group"><div class="cw-mod-group-title">${EscapeHtmlTp(groupName)}</div>`;
        items.forEach(m => {
            const isInstalled = !!m.installed;
            const isEnabled = isInstalled && !window._cwDraftDisabledModules.has(m.id);
            const rowCls = isInstalled ? '' : 'is-uninstalled';
            const pill = !isInstalled
                ? '<span class="cw-mod-pill is-missing">Not Installed</span>'
                : (isEnabled ? '<span class="cw-mod-pill is-on">Enabled</span>' : '<span class="cw-mod-pill is-off">Hidden</span>');
            html += `<label class="cw-mod-row ${rowCls}">
                <span class="cw-mod-row-left">
                    <input type="checkbox" data-mod-id="${EscapeHtmlTp(m.id)}" ${isEnabled ? 'checked' : ''} ${isInstalled ? '' : 'disabled'} onchange="OnSettingsModuleToggle('${EscapeHtmlTp(m.id)}', this.checked)">
                    <span>
                        <div class="cw-mod-name">${m.icon || '🧩'} ${EscapeHtmlTp(m.name)}</div>
                        <div class="cw-mod-desc">${EscapeHtmlTp(m.description || '')}</div>
                    </span>
                </span>
                ${pill}
            </label>`;
        });
        html += '</div>';
    });
    host.innerHTML = html;
}

window.OnSettingsModuleToggle = function(modId, checked) {
    if (!modId) return;
    if (checked) window._cwDraftDisabledModules.delete(modId);
    else window._cwDraftDisabledModules.add(modId);
    RenderSettingsModulesChecklist();
};

window.EnableAllInstalledModules = function() {
    window._cwDraftDisabledModules.clear();
    RenderSettingsModulesChecklist();
    SetSettingsStatusBanner('All installed modules enabled (click Save Settings to apply).');
};

function PopulateSettingsModalInputs() {
    const s = window._cwAppSettings;
    if (!s) return;

    const gen = s.general || {};
    const tel = s.telemetry || {};
    const dir = s.directories || {};
    const mod = s.modules || {};

    const setChk = (id, val) => { const el = document.getElementById(id); if (el) el.checked = !!val; };
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.value = val || ''; };

    setChk('chkSetStartWithWindows', gen.startWithWindows);
    setChk('chkSetStartMinimized', gen.startMinimized);
    setChk('chkSetMinToTrayOnClose', gen.minimizeToTrayOnClose);
    setChk('chkSetConfirmDestructive', gen.confirmDestructiveActions !== false);
    setChk('chkSetAutoCheckUpdates', gen.autoCheckCoreWatchUpdates !== false);

    if (window._cwAutoStartInfo && window._cwAutoStartInfo.detail) {
        SetDomText('lblSetAutoStartDetail', window._cwAutoStartInfo.detail);
    }

    setVal('inpSetProjectsRoot', dir.projectsRoot);
    setVal('inpSetExportsRoot', dir.exportsRoot);
    setVal('inpSetWslRoot', dir.wslInstallRoot);
    setVal('inpSetOrgDestRoot', dir.organizerDestRoot);
    setVal('inpSetEditorPath', dir.editorPath);

    const polVal = tel.pollingProfile || 'balanced';
    document.querySelectorAll('input[name="setPollingProfile"]').forEach(r => { r.checked = (r.value === polVal); });

    const unitVal = tel.temperatureUnit || 'C';
    document.querySelectorAll('input[name="setTempUnit"]').forEach(r => { r.checked = (r.value === unitVal); });

    window._cwDraftDisabledModules = new Set(Array.isArray(mod.disabled) ? mod.disabled : []);
    RenderSettingsModulesChecklist();

    const vi = window._cwVersionInfo;
    if (vi) {
        SetDomText('lblSettingsAppVersion', `${vi.tag || '--'} (${vi.buildLabel || ''})`);
        SetDomText('lblSettingsInstallMode', vi.installMode || '--');
        SetDomText('lblSettingsBuiltUtc', vi.builtUtc || 'Local Source');
        SetDomText('lblSettingsAppDataDir', vi.appDataDir || '--');
    }
}

function ApplyAppSettingsState(data) {
    if (!data) return;
    if (data.settings) window._cwAppSettings = data.settings;
    if (data.modulesState) window._cwModulesState = data.modulesState;
    if (data.versionInfo) window._cwVersionInfo = data.versionInfo;
    if (data.autoStart) window._cwAutoStartInfo = data.autoStart;

    ApplyModularTabsVisibility();

    // Re-format live temperature badges immediately when switching °C <-> °F
    if (window._cwLastRawCpuTemp !== undefined) {
        const ct = FormatCoreWatchTempDisplay(window._cwLastRawCpuTemp);
        SetDomText('lblCpuTemp', ct.text);
        SetDomText('lblCpuTempUnit', ct.unitText);
    }
    if (window._cwLastRawGpuTemp !== undefined) {
        const gt = FormatCoreWatchTempDisplay(window._cwLastRawGpuTemp);
        SetDomText('lblGpuTemp', gt.text);
        SetDomText('lblGpuTempUnit', gt.unitText);
    }

    // Pre-seed WSL default install directory if field is currently empty
    const wslInp = document.getElementById('wslImportInstallDir');
    const defWsl = window._cwAppSettings?.directories?.wslInstallRoot;
    if (wslInp && !wslInp.value.trim() && defWsl) {
        wslInp.value = defWsl;
    }

    // Update EXIT button tooltip based on minimize-to-tray behavior
    const exitBtn = document.querySelector('.exit-system-btn');
    if (exitBtn) {
        exitBtn.title = window._cwAppSettings?.general?.minimizeToTrayOnClose
            ? 'Minimize CoreWatch to System Tray (Right-click tray → Terminate Engine to quit)'
            : 'Terminate CoreWatch Engine';
    }

    const modal = document.getElementById('coreWatchSettingsModal');
    if (modal && modal.style.display !== 'none') {
        PopulateSettingsModalInputs();
    }

    if (data.notice) {
        SetSettingsStatusBanner(data.notice, !!data.noticeError);
        AppendConsoleLogEntry(`[SETTINGS] ${data.notice}`);
    }

    // One-time silent update check on startup if enabled
    if (!window._cwAutoUpdateCheckedOnce && window._cwAppSettings?.general?.autoCheckCoreWatchUpdates) {
        window._cwAutoUpdateCheckedOnce = true;
        setTimeout(() => {
            window.chrome?.webview?.postMessage(JSON.stringify({ command: 'CHECK_APP_UPDATE' }));
        }, 4500);
    }
}

window.SelectSettingsPane = function(paneKey) {
    const map = {
        general: 'settingsPaneGeneral',
        directories: 'settingsPaneDirectories',
        telemetry: 'settingsPaneTelemetry',
        modules: 'settingsPaneModules'
    };
    document.querySelectorAll('#coreWatchSettingsModal .cw-set-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.pane === paneKey);
    });
    Object.entries(map).forEach(([k, elId]) => {
        const el = document.getElementById(elId);
        if (el) el.classList.toggle('active', k === paneKey);
    });
};

window.OpenSettingsModal = function(initialPane = 'general') {
    const cust = document.getElementById('layoutCustomizerDrawer');
    if (cust && cust.style.display !== 'none') CloseLayoutCustomizer();
    const dock = document.getElementById('sideTelemetryDock');
    if (dock && dock.style.display !== 'none') CloseSideTelemetryDock();

    const modal = document.getElementById('coreWatchSettingsModal');
    const btn = document.getElementById('btnOpenSettings');
    if (modal) modal.style.display = 'flex';
    if (btn) btn.classList.add('active');
    SetSettingsStatusBanner('');
    SelectSettingsPane(initialPane);
    PopulateSettingsModalInputs();
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'GET_APP_SETTINGS' }));
};

window.CloseSettingsModal = function() {
    const modal = document.getElementById('coreWatchSettingsModal');
    const btn = document.getElementById('btnOpenSettings');
    if (modal) modal.style.display = 'none';
    if (btn) btn.classList.remove('active');
};

window.ToggleSettingsModal = function() {
    const modal = document.getElementById('coreWatchSettingsModal');
    if (modal && modal.style.display !== 'none') CloseSettingsModal();
    else OpenSettingsModal();
};

window.SaveCoreWatchSettingsFromModal = function() {
    const polRadio = document.querySelector('input[name="setPollingProfile"]:checked');
    const unitRadio = document.querySelector('input[name="setTempUnit"]:checked');

    const payload = {
        schemaVersion: 1,
        general: {
            startWithWindows: !!document.getElementById('chkSetStartWithWindows')?.checked,
            startMinimized: !!document.getElementById('chkSetStartMinimized')?.checked,
            minimizeToTrayOnClose: !!document.getElementById('chkSetMinToTrayOnClose')?.checked,
            confirmDestructiveActions: !!document.getElementById('chkSetConfirmDestructive')?.checked,
            autoCheckCoreWatchUpdates: !!document.getElementById('chkSetAutoCheckUpdates')?.checked
        },
        telemetry: {
            pollingProfile: polRadio ? polRadio.value : 'balanced',
            temperatureUnit: unitRadio ? unitRadio.value : 'C'
        },
        directories: {
            projectsRoot: (document.getElementById('inpSetProjectsRoot')?.value || '').trim(),
            exportsRoot: (document.getElementById('inpSetExportsRoot')?.value || '').trim(),
            wslInstallRoot: (document.getElementById('inpSetWslRoot')?.value || '').trim(),
            organizerDestRoot: (document.getElementById('inpSetOrgDestRoot')?.value || '').trim(),
            editorPath: (document.getElementById('inpSetEditorPath')?.value || '').trim()
        },
        modules: {
            disabled: Array.from(window._cwDraftDisabledModules || [])
        }
    };

    SetSettingsStatusBanner('Saving...');
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'SAVE_APP_SETTINGS', settings: payload }));
};

window.BrowseSettingsFolder = function(targetKey) {
    window.chrome?.webview?.postMessage(`Browse-Folder:${targetKey}`);
};

window.BrowseSettingsEditorFile = function() {
    window.chrome?.webview?.postMessage('Browse-File:settings_editor');
};

window.AutoDetectSettingsEditor = function() {
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'DETECT_DEFAULT_EDITOR' }));
};

window.OpenSettingsDirectoryInput = function(inputId) {
    const val = (document.getElementById(inputId)?.value || '').trim();
    if (!val) return;
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'OPEN_DIRECTORY_PATH', path: val }));
};

window.OpenCoreWatchAppDataFolder = function() {
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'OPEN_APPDATA_FOLDER' }));
};

window.TriggerCoreWatchUpdateCheck = function() {
    const btn = document.getElementById('btnSettingsCheckUpdate');
    const box = document.getElementById('lblSettingsUpdateStatus');
    if (btn) btn.disabled = true;
    if (box) {
        box.style.display = 'block';
        box.className = 'cw-update-status';
        box.textContent = 'Checking GitHub Releases...';
    }
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'CHECK_APP_UPDATE' }));
};

function HandleAppUpdateStatus(data) {
    const btn = document.getElementById('btnSettingsCheckUpdate');
    const relBtn = document.getElementById('btnSettingsOpenRelease');
    const box = document.getElementById('lblSettingsUpdateStatus');
    if (btn) btn.disabled = false;
    if (!data) return;

    window._cwUpdateReleaseUrl = data.url || '';
    if (relBtn) relBtn.style.display = (data.url && data.updateAvailable) ? 'inline-block' : 'none';
    if (box) {
        box.style.display = 'block';
        box.className = 'cw-update-status' + (!data.ok ? ' is-err' : (data.updateAvailable ? ' is-new' : ''));
        box.textContent = data.message || 'Update check completed.';
    }
    if (data.updateAvailable && data.message) {
        AppendConsoleLogEntry(`[UPDATE] ${data.message} (Open ⚙️ Settings to view release)`);
    }
}

window.OpenCoreWatchUpdateReleaseUrl = function() {
    const url = window._cwUpdateReleaseUrl || 'https://github.com/jonathan820612/CoreWatch-Host-Engine/releases';
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'OPEN_EXTERNAL_URL', url }));
};

function HandleBrowseFileResult(data) {
    if (!data) return;
    if (data.target === 'settings_editor' && data.path) {
        const inp = document.getElementById('inpSetEditorPath');
        if (inp) inp.value = data.path;
    } else if (data.target === 'github_release_assets') {
        const list = Array.isArray(data.paths) ? data.paths : (data.path ? [data.path] : []);
        window._ghPendingReleaseAssets = list;
        const lbl = document.getElementById('lblGhRelAttachedAssets');
        if (lbl) lbl.textContent = list.length ? `${list.length} file(s): ${list.map(p => p.split(/[\\/]/).pop()).join(', ')}` : 'No files attached';
    } else if (data.target === 'github_upload_asset' && data.path && window._ghPendingUploadTarget) {
        const t = window._ghPendingUploadTarget;
        window._ghPendingUploadTarget = null;
        SetGhStatus(`Uploading ${data.path.split(/[\\/]/).pop()} to release...`);
        window.chrome?.webview?.postMessage(JSON.stringify({
            command: 'GH_UPLOAD_RELEASE_ASSET',
            repoSlug: t.repoSlug,
            uploadUrl: t.uploadUrl,
            filePath: data.path
        }));
    }
    if (data.notice) {
        SetSettingsStatusBanner(data.notice, !data.path);
    }
}

window.ExportCoreWatchSettings = function() {
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'EXPORT_APP_SETTINGS' }));
};

window.ImportCoreWatchSettings = function() {
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'IMPORT_APP_SETTINGS' }));
};

window.ResetCoreWatchSettings = function() {
    if (!confirm('Reset all CoreWatch application settings (Startup, Directories, Telemetry & Modules) back to defaults?')) return;
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'RESET_APP_SETTINGS' }));
};

// =========================================================================
// SYSTEM PROFILES & MODES UI CONTROLLER (HEADER PILL, VIEW & EDITOR MODAL)
// =========================================================================
window._cwProfilesState = null;

window.RequestProfilesState = function() {
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'PROFILES_LOAD' }));
};

window.ToggleHeaderModeMenu = function(e) {
    if (e) e.stopPropagation();
    const drop = document.getElementById('navModePillDropdown');
    const trig = document.getElementById('btnHeaderModePill');
    const sysDrop = document.getElementById('navSystemDropdown');
    if (sysDrop) sysDrop.classList.remove('open');
    if (!drop) return;
    const willOpen = !drop.classList.contains('open');
    drop.classList.toggle('open', willOpen);
    if (trig) trig.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    if (willOpen && !window._cwProfilesState) {
        RequestProfilesState();
    }
};

document.addEventListener('click', (e) => {
    const drop = document.getElementById('navModePillDropdown');
    if (drop && drop.classList.contains('open') && !drop.contains(e.target)) {
        drop.classList.remove('open');
        const trig = document.getElementById('btnHeaderModePill');
        if (trig) trig.setAttribute('aria-expanded', 'false');
    }
});

function CloseHeaderModeMenu() {
    const drop = document.getElementById('navModePillDropdown');
    const trig = document.getElementById('btnHeaderModePill');
    if (drop) drop.classList.remove('open');
    if (trig) trig.setAttribute('aria-expanded', 'false');
}

function FormatDndLabel(mode) {
    switch (String(mode || 'off').toLowerCase()) {
        case 'priority': return 'Priority Only';
        case 'alarms':   return 'Alarms Only';
        case 'off':      return 'Off';
        default:         return 'Unchanged';
    }
}

function FormatPowerPlanLabel(key) {
    switch (String(key || '').toLowerCase()) {
        case 'balanced':         return 'Balanced';
        case 'high_performance': return 'High Perf';
        case 'power_saver':      return 'Power Saver';
        case 'ultimate':         return 'Ultimate Perf';
        default:                 return '';
    }
}

function RenderHeaderModePill(state) {
    const lbl = document.getElementById('lblHeaderModeText');
    const pill = document.getElementById('btnHeaderModePill');
    const menu = document.getElementById('navModePillMenu');
    if (!state || !Array.isArray(state.profiles)) return;

    const active = state.profiles.find(p => p.id === state.activeProfileId) || state.profiles[0];
    if (lbl && active) {
        const shortName = String(active.name || 'Normal').split('/')[0].trim();
        lbl.textContent = `${active.icon || '⚡'} ${shortName}`;
    }
    if (pill) {
        pill.classList.toggle('is-awake', !!state.keepAwakeActive);
        pill.title = active
            ? `Active Mode: ${active.name}${state.keepAwakeActive ? ' · Keep Awake ON' : ''} (Click to switch)`
            : 'Switch Active System Profile / Mode';
    }
    if (menu) {
        let html = state.profiles.map(p => {
            const isAct = p.id === state.activeProfileId;
            return `<button type="button" class="nav-mode-menu-item ${isAct ? 'is-active' : ''}" role="menuitem" onclick="SelectHeaderModeProfile('${EscapeHtmlTp(p.id)}')">
                <span>${p.icon || '⚡'} ${EscapeHtmlTp(p.name)}</span>
                <span>${isAct ? '✓' : ''}</span>
            </button>`;
        }).join('');
        html += '<div class="nav-mode-menu-divider"></div>';
        if (state.hasBaseline) {
            html += `<button type="button" class="nav-mode-menu-item nav-mode-menu-revert" role="menuitem" onclick="CloseHeaderModeMenu(); TriggerRevertProfileBaseline()"><span>↩ Revert to Previous State</span><span></span></button>`;
        }
        html += `<button type="button" class="nav-mode-menu-item nav-mode-menu-footer" role="menuitem" onclick="CloseHeaderModeMenu(); SwitchAppLayoutView('profiles')"><span>⚡ Manage &amp; Edit Profiles...</span><span>↗</span></button>`;
        menu.innerHTML = html;
    }
}

window.SelectHeaderModeProfile = function(profileId) {
    CloseHeaderModeMenu();
    TriggerApplyProfile(profileId);
};

function RenderProfilesState(data) {
    if (!data) return;
    window._cwProfilesState = data;
    RenderHeaderModePill(data);

    const profiles = Array.isArray(data.profiles) ? data.profiles : [];
    const active = profiles.find(p => p.id === data.activeProfileId) || profiles[0];
    const live = data.liveState || {};

    SetDomText('sumProfActive', active ? `${active.icon || '⚡'} ${active.name}` : 'Normal');
    SetDomText('sumProfPower', live.powerPlanName || '--');
    SetDomText('sumProfDnd', FormatDndLabel(live.dndMode));
    SetDomText('sumProfAwake', data.keepAwakeActive ? 'On (Awake)' : 'Off');
    SetDomText('sumProfNightLight', live.nightLight === 'on' ? `On (${live.nightLightStrength ?? 50}%)` : 'Off');
    SetDomText('sumProfMonitors', Array.isArray(live.monitors) ? `${live.monitors.length} Connected` : '--');

    const revBtn = document.getElementById('btnProfilesRevertTop');
    if (revBtn) revBtn.style.display = data.hasBaseline ? 'inline-block' : 'none';

    const st = document.getElementById('profilesStatus');
    if (st && data.notice) {
        st.classList.toggle('sharing-error', !!data.noticeError);
        st.textContent = data.notice;
    }
    if (data.notice) {
        AppendConsoleLogEntry(`[PROFILES] ${data.notice}`);
    }

    const grid = document.getElementById('profilesCardsGrid');
    if (!grid) return;

    grid.innerHTML = profiles.map(p => {
        const isAct = p.id === data.activeProfileId;
        const s = p.settings || {};
        const chips = [];
        if (s.powerPlan && s.powerPlan !== 'unchanged') chips.push(`<span class="prof-chip">⚡ ${FormatPowerPlanLabel(s.powerPlan)}</span>`);
        if (s.dndMode && s.dndMode !== 'unchanged') chips.push(`<span class="prof-chip chip-dnd">🔕 DnD: ${FormatDndLabel(s.dndMode)}</span>`);
        if (s.keepAwake && s.keepAwake !== 'unchanged') chips.push(`<span class="prof-chip chip-awake">☀️ Keep Awake: ${s.keepAwake === 'on' ? 'On' : 'Off'}</span>`);
        if (s.nightLight && s.nightLight !== 'unchanged') {
            const nlStr = (s.nightLight === 'on' && Number(s.nightLightStrength) >= 0) ? ` (${s.nightLightStrength}%)` : '';
            chips.push(`<span class="prof-chip">🌙 Night Light: ${s.nightLight === 'on' ? 'On' : 'Off'}${nlStr}</span>`);
        }
        (Array.isArray(s.displays) ? s.displays : []).forEach(d => {
            const bits = [];
            if (d.hdr && d.hdr !== 'unchanged') bits.push(`HDR ${d.hdr.toUpperCase()}`);
            if (d.refreshMode === 'max') bits.push('Max Hz');
            else if (d.refreshMode === 'exact' && d.refreshHz > 0) bits.push(`${d.refreshHz}Hz`);
            if (d.scalePct >= 100) bits.push(`${d.scalePct}%`);
            if (bits.length) {
                const tLabel = d.target === 'primary' ? 'Primary' : (d.target === 'all' ? 'All Displays' : (d.friendlyName || d.target));
                chips.push(`<span class="prof-chip chip-disp">🖥️ ${EscapeHtmlTp(tLabel)}: ${bits.join(', ')}</span>`);
            }
        });
        if (!chips.length) chips.push('<span class="prof-chip">No overrides configured</span>');

        const badge = p.isBuiltIn
            ? '<span class="sharing-badge badge-info">Preset</span>'
            : '<span class="sharing-badge badge-purple">Custom</span>';

        const extraBtn = p.isBuiltIn
            ? `<button type="button" onclick="TriggerResetBuiltInPreset('${EscapeHtmlTp(p.id)}')" title="Restore factory defaults for this preset">↺ Reset</button>`
            : `<button type="button" class="btn-prof-danger" onclick="TriggerDeleteCustomProfile('${EscapeHtmlTp(p.id)}', '${EscapeHtmlTp(p.name)}')" title="Delete custom profile">🗑️ Delete</button>`;

        return `<article class="profile-mode-card ${isAct ? 'is-active' : ''}" style="border-left-color: ${EscapeHtmlTp(p.accent || '#4299e1')};">
            <div class="profile-card-head">
                <span class="profile-card-title"><span>${p.icon || '⚡'}</span><span>${EscapeHtmlTp(p.name)}</span></span>
                <div class="card-badge-group">${isAct ? '<span class="sharing-badge ver-uptodate">✓ Active</span>' : ''}${badge}</div>
            </div>
            <div class="profile-card-desc">${EscapeHtmlTp(p.description || 'Custom system mode profile.')}</div>
            <div class="profile-card-chips">${chips.join('')}</div>
            <div class="profile-card-actions">
                <button type="button" class="btn-prof-activate ${isAct ? 'is-current' : ''}" onclick="TriggerApplyProfile('${EscapeHtmlTp(p.id)}')">${isAct ? '↻ Re-Apply' : '▶ Activate'}</button>
                <button type="button" onclick="OpenProfileEditorModal('${EscapeHtmlTp(p.id)}')">✏️ Edit</button>
                <button type="button" onclick="TriggerCloneProfile('${EscapeHtmlTp(p.id)}')">📋 Clone</button>
                ${extraBtn}
            </div>
        </article>`;
    }).join('');
}

function HandleProfilesNotice(data) {
    const st = document.getElementById('profilesStatus');
    const msg = data?.error || data?.message || '';
    if (st && msg) {
        st.classList.toggle('sharing-error', !data.ok || !!data.error);
        st.textContent = msg;
    }
    if (msg) AppendConsoleLogEntry(`[PROFILES] ${msg}`);
}

window.TriggerApplyProfile = function(profileId) {
    if (!profileId) return;
    const st = document.getElementById('profilesStatus');
    if (st) {
        st.classList.remove('sharing-error');
        st.textContent = `Applying profile '${profileId}'...`;
    }
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'PROFILES_APPLY', profileId }));
};

window.TriggerRevertProfileBaseline = function() {
    const st = document.getElementById('profilesStatus');
    if (st) {
        st.classList.remove('sharing-error');
        st.textContent = 'Reverting to pre-profile baseline snapshot...';
    }
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'PROFILES_REVERT' }));
};

window.TriggerCaptureCurrentProfile = function() {
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'PROFILES_CAPTURE_CURRENT' }));
};

window.TriggerExportProfiles = function() {
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'PROFILES_EXPORT' }));
};

window.TriggerImportProfiles = function() {
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'PROFILES_IMPORT' }));
};

window.TriggerResetBuiltInPreset = function(profileId) {
    if (!confirm('Reset this built-in preset back to its factory defaults?')) return;
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'PROFILES_RESET_PRESET', profileId }));
};

window.TriggerDeleteCustomProfile = function(profileId, name) {
    if (!ConfirmDestructiveAction(`Delete custom profile '${name}'?`)) return;
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'PROFILES_DELETE', profileId }));
};

window.TriggerCloneProfile = function(profileId) {
    const list = window._cwProfilesState?.profiles || [];
    const src = list.find(p => p.id === profileId);
    if (!src) return;
    const clone = JSON.parse(JSON.stringify(src));
    clone.id = '';
    clone.isBuiltIn = false;
    clone.name = `${src.name} (Copy)`;
    OpenProfileEditorModalWithData(clone);
};

window.SetProfileEditorIcon = function(ico) {
    const el = document.getElementById('inpProfIcon');
    if (el) el.value = ico;
};

window.SyncProfileEditorNightLightRow = function() {
    const nlSel = document.getElementById('selProfNightLight');
    const row   = document.getElementById('profNightLightStrengthRow');
    const chk   = document.getElementById('chkProfNlStrength');
    const rng   = document.getElementById('rngProfNlStrength');
    const show  = nlSel && nlSel.value === 'on';
    if (row) row.style.display = show ? 'flex' : 'none';
    if (rng && chk) rng.disabled = !chk.checked;
};

window.AddProfileDisplayRuleRow = function(rule = null) {
    const host = document.getElementById('profDisplayRulesList');
    if (!host) return;
    const emptyHint = host.querySelector('.prof-empty-disp-hint');
    if (emptyHint) emptyHint.remove();

    const mons = window._cwProfilesState?.liveState?.monitors || [];
    const r = rule || { target: 'primary', friendlyName: 'Primary Monitor', hdr: 'unchanged', refreshMode: 'unchanged', refreshHz: 0, scalePct: 0 };

    const targetOpts = [
        `<option value="primary" data-friendly="Primary Monitor" ${r.target === 'primary' ? 'selected' : ''}>Primary Monitor</option>`,
        `<option value="all" data-friendly="All Monitors" ${r.target === 'all' ? 'selected' : ''}>All Connected Monitors</option>`
    ];
    let matchedTarget = (r.target === 'primary' || r.target === 'all');
    mons.forEach(m => {
        const sel = r.target === m.deviceName;
        if (sel) matchedTarget = true;
        targetOpts.push(`<option value="${EscapeHtmlTp(m.deviceName)}" data-friendly="${EscapeHtmlTp(m.friendlyName)}" ${sel ? 'selected' : ''}>Display ${m.displayNumber} — ${EscapeHtmlTp(m.friendlyName)}${m.isPrimary ? ' (Primary)' : ''}</option>`);
    });
    if (!matchedTarget && r.target) {
        targetOpts.push(`<option value="${EscapeHtmlTp(r.target)}" data-friendly="${EscapeHtmlTp(r.friendlyName || r.target)}" selected>${EscapeHtmlTp(r.friendlyName || r.target)} (Disconnected)</option>`);
    }

    const hzValues = new Set([60, 75, 100, 120, 144, 165, 180, 240]);
    mons.forEach(m => (m.availableRefreshRates || []).forEach(h => hzValues.add(Number(h))));
    if (r.refreshHz > 0) hzValues.add(Number(r.refreshHz));
    const sortedHz = Array.from(hzValues).filter(n => n >= 24).sort((a, b) => a - b);

    const hzSelectedVal = r.refreshMode === 'max' ? 'max' : (r.refreshMode === 'exact' && r.refreshHz > 0 ? String(r.refreshHz) : 'unchanged');
    const hzOpts = [
        `<option value="unchanged" ${hzSelectedVal === 'unchanged' ? 'selected' : ''}>Hz: Unchanged</option>`,
        `<option value="max" ${hzSelectedVal === 'max' ? 'selected' : ''}>Hz: Max Available</option>`,
        ...sortedHz.map(hz => `<option value="${hz}" ${hzSelectedVal === String(hz) ? 'selected' : ''}>${hz} Hz</option>`)
    ];

    const scales = [100, 125, 150, 175, 200, 225, 250];
    const scaleOpts = [
        `<option value="0" ${!r.scalePct ? 'selected' : ''}>Scale: Unchanged</option>`,
        ...scales.map(sc => `<option value="${sc}" ${Number(r.scalePct) === sc ? 'selected' : ''}>${sc}%</option>`)
    ];

    const row = document.createElement('div');
    row.className = 'prof-disp-rule-row';
    row.innerHTML = `
        <select class="prof-select prof-rule-target" aria-label="Target Monitor">${targetOpts.join('')}</select>
        <select class="prof-select prof-rule-hdr" aria-label="HDR Override">
            <option value="unchanged" ${r.hdr === 'unchanged' ? 'selected' : ''}>HDR: Unchanged</option>
            <option value="on" ${r.hdr === 'on' ? 'selected' : ''}>HDR: On</option>
            <option value="off" ${r.hdr === 'off' ? 'selected' : ''}>HDR: Off</option>
        </select>
        <select class="prof-select prof-rule-hz" aria-label="Refresh Rate Override">${hzOpts.join('')}</select>
        <select class="prof-select prof-rule-scale" aria-label="Scale Override">${scaleOpts.join('')}</select>
        <button type="button" class="console-clear-btn wsl-btn-danger" onclick="this.parentElement.remove()" title="Remove display rule">✕</button>
    `;
    host.appendChild(row);
};

function OpenProfileEditorModalWithData(prof) {
    const modal = document.getElementById('profileEditorModal');
    if (!modal) return;
    const isNew = !prof || !prof.id;
    const p = prof || {
        id: '', name: '', icon: '⚡', accent: '#4299e1', description: '', isBuiltIn: false,
        settings: { powerPlan: 'unchanged', dndMode: 'unchanged', keepAwake: 'unchanged', nightLight: 'unchanged', nightLightStrength: -1, displays: [] }
    };
    const s = p.settings || {};

    SetDomText('profileEditorTitle', isNew ? '➕ CREATE CUSTOM SYSTEM PROFILE' : `✏️ EDIT PROFILE — ${p.name}`);
    document.getElementById('inpProfId').value        = p.id || '';
    document.getElementById('inpProfIsBuiltIn').value = p.isBuiltIn ? '1' : '0';
    document.getElementById('inpProfName').value      = p.name || '';
    document.getElementById('inpProfIcon').value      = p.icon || '⚡';
    document.getElementById('inpProfAccent').value    = p.accent || '#4299e1';
    document.getElementById('inpProfDesc').value      = p.description || '';

    document.getElementById('selProfPowerPlan').value  = s.powerPlan || 'unchanged';
    document.getElementById('selProfDnd').value        = s.dndMode || 'unchanged';
    document.getElementById('selProfKeepAwake').value  = s.keepAwake || 'unchanged';
    document.getElementById('selProfNightLight').value = s.nightLight || 'unchanged';

    const hasStr = Number(s.nightLightStrength) >= 0;
    const strVal = hasStr ? Number(s.nightLightStrength) : 50;
    document.getElementById('chkProfNlStrength').checked = hasStr;
    document.getElementById('rngProfNlStrength').value   = String(strVal);
    SetDomText('lblProfNlStrength', `${strVal}%`);
    SyncProfileEditorNightLightRow();

    const host = document.getElementById('profDisplayRulesList');
    if (host) {
        host.replaceChildren();
        const rules = Array.isArray(s.displays) ? s.displays : [];
        if (rules.length === 0) {
            host.innerHTML = '<div class="driver-text-node prof-empty-disp-hint">No per-monitor overrides configured (all displays remain untouched). Click "+ Add Display Rule" to customize HDR, Hz, or Scale.</div>';
        } else {
            rules.forEach(r => AddProfileDisplayRuleRow(r));
        }
    }

    modal.style.display = 'flex';
    setTimeout(() => document.getElementById('inpProfName')?.focus(), 10);
}

window.OpenProfileEditorModal = function(profileId) {
    if (!profileId) {
        OpenProfileEditorModalWithData(null);
        return;
    }
    const list = window._cwProfilesState?.profiles || [];
    const found = list.find(p => p.id === profileId) || null;
    OpenProfileEditorModalWithData(found);
};

function OpenProfileEditorFromSnapshot(snap) {
    if (!snap) return;
    const displays = (Array.isArray(snap.monitors) ? snap.monitors : []).map(m => ({
        target: m.deviceName,
        friendlyName: m.friendlyName,
        hdr: m.hdrSupported ? (m.hdrOn ? 'on' : 'off') : 'unchanged',
        refreshMode: m.refreshRateHz > 0 ? 'exact' : 'unchanged',
        refreshHz: m.refreshRateHz || 0,
        scalePct: m.scalePct || 0
    }));
    OpenProfileEditorModalWithData({
        id: '',
        name: 'Captured PC Snapshot',
        icon: '📸',
        accent: '#38b2ac',
        description: `Captured live state (${snap.powerPlanName || 'Balanced'}, DnD: ${FormatDndLabel(snap.dndMode)}, ${displays.length} monitor(s))`,
        isBuiltIn: false,
        settings: {
            powerPlan: snap.powerPlanKey || 'balanced',
            dndMode: snap.dndMode || 'off',
            keepAwake: snap.keepAwake ? 'on' : 'off',
            nightLight: snap.nightLight || 'off',
            nightLightStrength: snap.nightLight === 'on' ? (snap.nightLightStrength ?? 50) : -1,
            displays
        }
    });
}

window.CloseProfileEditorModal = function() {
    const modal = document.getElementById('profileEditorModal');
    if (modal) modal.style.display = 'none';
};

window.SaveProfileFromEditorModal = function() {
    const name = (document.getElementById('inpProfName')?.value || '').trim();
    if (!name) {
        alert('Please enter a name for this profile.');
        return;
    }
    const nlVal = document.getElementById('selProfNightLight')?.value || 'unchanged';
    const useStr = nlVal === 'on' && !!document.getElementById('chkProfNlStrength')?.checked;
    const nlStr = useStr ? Number(document.getElementById('rngProfNlStrength')?.value || 50) : -1;

    const displays = [];
    document.querySelectorAll('#profDisplayRulesList .prof-disp-rule-row').forEach(row => {
        const tgtSel = row.querySelector('.prof-rule-target');
        const target = tgtSel?.value || '';
        if (!target) return;
        const friendlyName = tgtSel.selectedOptions?.[0]?.dataset?.friendly || target;
        const hdr = row.querySelector('.prof-rule-hdr')?.value || 'unchanged';
        const hzRaw = row.querySelector('.prof-rule-hz')?.value || 'unchanged';
        let refreshMode = 'unchanged';
        let refreshHz = 0;
        if (hzRaw === 'max') refreshMode = 'max';
        else if (hzRaw !== 'unchanged' && Number(hzRaw) >= 24) {
            refreshMode = 'exact';
            refreshHz = Number(hzRaw);
        }
        const scalePct = Number(row.querySelector('.prof-rule-scale')?.value || 0);
        displays.push({ target, friendlyName, hdr, refreshMode, refreshHz, scalePct });
    });

    const profile = {
        id: (document.getElementById('inpProfId')?.value || '').trim(),
        name,
        icon: (document.getElementById('inpProfIcon')?.value || '⚡').trim() || '⚡',
        accent: document.getElementById('inpProfAccent')?.value || '#4299e1',
        description: (document.getElementById('inpProfDesc')?.value || '').trim(),
        isBuiltIn: document.getElementById('inpProfIsBuiltIn')?.value === '1',
        settings: {
            powerPlan: document.getElementById('selProfPowerPlan')?.value || 'unchanged',
            dndMode: document.getElementById('selProfDnd')?.value || 'unchanged',
            keepAwake: document.getElementById('selProfKeepAwake')?.value || 'unchanged',
            nightLight: nlVal,
            nightLightStrength: nlStr,
            displays
        }
    };

    CloseProfileEditorModal();
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'PROFILES_SAVE', profile }));
};

// =========================================================================
// DEV & WORK GROUPED DROPDOWN CONTROLLER
// =========================================================================
window.ToggleDevWorkMenu = function(e) {
    if (e) e.stopPropagation();
    const drop = document.getElementById('navDevDropdown');
    const trig = document.getElementById('tabDevMenu');
    const sysDrop = document.getElementById('navSystemDropdown');
    const opsDrop = document.getElementById('navOpsDropdown');
    const modeDrop = document.getElementById('navModePillDropdown');
    if (sysDrop) sysDrop.classList.remove('open');
    if (opsDrop) opsDrop.classList.remove('open');
    if (modeDrop) modeDrop.classList.remove('open');
    if (!drop) return;
    const willOpen = !drop.classList.contains('open');
    drop.classList.toggle('open', willOpen);
    if (trig) trig.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    if (willOpen) ClampNavDropdownMenu(document.getElementById('navDevMenu'));
};

window.SelectDevWorkMenuView = function(viewKey) {
    const drop = document.getElementById('navDevDropdown');
    const trig = document.getElementById('tabDevMenu');
    if (drop) drop.classList.remove('open');
    if (trig) trig.setAttribute('aria-expanded', 'false');
    SwitchAppLayoutView(viewKey);
};

document.addEventListener('click', (e) => {
    const drop = document.getElementById('navDevDropdown');
    if (drop && drop.classList.contains('open') && !drop.contains(e.target)) {
        drop.classList.remove('open');
        const trig = document.getElementById('tabDevMenu');
        if (trig) trig.setAttribute('aria-expanded', 'false');
    }
});

window.OpenExternalHttpsUrl = function(url) {
    if (!url) return;
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'OPEN_EXTERNAL_URL', url }));
};

// =========================================================================
// GITHUB MANAGER UI CONTROLLER (LOCAL PROJECTS, CLONE & RELEASE MANAGEMENT)
// =========================================================================
window._ghManagerLoaded = false;
window._ghState = null;
window._ghSubView = 'local';
window._ghPendingReleaseAssets = [];
window._ghPendingUploadTarget = null;

function SetGhStatus(msg, isErr = false) {
    const st = document.getElementById('ghStatus');
    if (st && msg) {
        st.classList.toggle('sharing-error', !!isErr);
        st.textContent = msg;
    }
    if (msg) AppendConsoleLogEntry(`[GITHUB] ${msg}`);
}

window.RequestGitHubManagerState = function(projectsRootOverride = '') {
    SetGhStatus('Loading local Git workspaces and GitHub repositories...');
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'GH_LOAD', projectsRoot: projectsRootOverride || '' }));
};

window.ScanGitHubProjectsRoot = function() {
    const rootVal = (document.getElementById('inpGhProjectsRoot')?.value || '').trim();
    RequestGitHubManagerState(rootVal);
};

window.ToggleGitHubPatBar = function() {
    const bar = document.getElementById('ghPatAuthBar');
    if (bar) bar.style.display = (bar.style.display === 'none' || !bar.style.display) ? 'flex' : 'none';
};

window.SaveGitHubPatToken = function() {
    const inp = document.getElementById('inpGhPatToken');
    const tok = (inp?.value || '').trim();
    if (!tok) { SetGhStatus('Enter a GitHub Personal Access Token first.', true); return; }
    if (inp) inp.value = '';
    SetGhStatus('Verifying GitHub token...');
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'GH_SAVE_PAT', token: tok }));
};

window.ClearGitHubPatToken = function() {
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'GH_CLEAR_PAT' }));
};

window.SetGitHubSubView = function(subKey) {
    window._ghSubView = subKey;
    document.querySelectorAll('#ghSubViewPills .filter-pill').forEach(b => b.classList.toggle('active', b.dataset.sub === subKey));
    const map = { local: 'ghPaneLocal', repos: 'ghPaneRepos', releases: 'ghPaneReleases' };
    Object.entries(map).forEach(([k, id]) => {
        const el = document.getElementById(id);
        if (el) el.classList.toggle('active', k === subKey);
    });
    if (subKey === 'releases') {
        PopulateGitHubReleaseRepoSelector();
    }
};

window.BrowseGitHubFolder = function(targetKey) {
    window.chrome?.webview?.postMessage(`Browse-Folder:${targetKey}`);
};

function RenderGitHubManagerState(data) {
    if (!data) return;
    window._ghManagerLoaded = true;
    const prevRemote = window._ghState?.remoteRepos || [];
    if ((!data.remoteRepos || !data.remoteRepos.length) && prevRemote.length && data.auth?.authenticated) {
        data.remoteRepos = prevRemote;
    }
    window._ghState = data;

    const auth = data.auth || {};
    const authEl = document.getElementById('lblGhAuthBadge');
    if (authEl) {
        authEl.innerHTML = auth.authenticated
            ? `Auth: <strong style="color:#68d391;">@${EscapeHtmlTp(auth.username)} (${EscapeHtmlTp(auth.source)})</strong>`
            : `Auth: <strong style="color:#f6ad55;">Not Signed In</strong>`;
    }

    const rootInp = document.getElementById('inpGhProjectsRoot');
    if (rootInp && data.projectsRoot) rootInp.value = data.projectsRoot;
    const cloneDest = document.getElementById('inpGhCloneDest');
    if (cloneDest && !cloneDest.value.trim() && data.projectsRoot) cloneDest.value = data.projectsRoot;

    SetDomText('sumGhLocalCount', Array.isArray(data.localRepos) ? data.localRepos.length : 0);
    SetDomText('sumGhRemoteCount', Array.isArray(data.remoteRepos) ? data.remoteRepos.length : 0);

    if (data.notice) {
        SetGhStatus(data.notice, !!data.noticeError);
    } else {
        const locCnt = (data.localRepos || []).length;
        const remCnt = (data.remoteRepos || []).length;
        SetGhStatus(`Found ${locCnt} local Git repo(s) in ${data.projectsRoot || 'workspace'}${auth.authenticated ? ` · ${remCnt} GitHub repo(s) loaded for @${auth.username}` : ' · Sign in via gh CLI or PAT to browse/manage GitHub repos & releases'}.`);
    }

    RenderGitHubLocalRepos();
    RenderGitHubRemoteRepos();
    PopulateGitHubReleaseRepoSelector();
}

window.RenderGitHubLocalRepos = function() {
    const grid = document.getElementById('ghLocalReposGrid');
    if (!grid) return;
    const list = window._ghState?.localRepos || [];
    const q = (document.getElementById('inpGhLocalFilter')?.value || '').trim().toLowerCase();
    const filtered = list.filter(r => !q || `${r.name} ${r.branch} ${r.repoSlug} ${r.lastCommit}`.toLowerCase().includes(q));

    if (!filtered.length) {
        grid.innerHTML = '<div class="driver-text-node" style="padding:10px;">No local Git repositories found in this folder. Use "Browse..." above or clone one under "My Repos &amp; Clone".</div>';
        return;
    }

    grid.innerHTML = filtered.map(r => {
        const safePath = String(r.path || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const safeSlug = String(r.repoSlug || '').replace(/'/g, "\\'");
        const dirtyBadge = r.dirtyCount > 0
            ? `<span class="sharing-badge ver-update">${r.dirtyCount} modified</span>`
            : '<span class="sharing-badge ver-uptodate">Clean</span>';
        const syncBadges = (r.ahead > 0 ? `<span class="sharing-badge badge-info">↑${r.ahead}</span>` : '') +
                           (r.behind > 0 ? `<span class="sharing-badge badge-purple">↓${r.behind}</span>` : '');
        const relBtn = r.repoSlug ? `<button type="button" onclick="JumpToGitHubReleases('${safeSlug}')">🚀 Releases</button>` : '';
        const pubBtn = r.hasPublishScript ? `<button type="button" onclick="TriggerGhRepoAction('GH_RUN_LOCAL_PUBLISH', '${safePath}')" title="Run build\\Publish-Release.ps1">⚡ Publish Script</button>` : '';

        return `<article class="dev-repo-card">
            <div class="dev-repo-head">
                <span class="dev-repo-name" title="${EscapeHtmlTp(r.path)}">📁 ${EscapeHtmlTp(r.name)}</span>
                <div class="card-badge-group"><span class="sharing-badge badge-info">🌿 ${EscapeHtmlTp(r.branch)}</span>${dirtyBadge}${syncBadges}</div>
            </div>
            <div class="dev-repo-meta" title="${EscapeHtmlTp(r.lastCommit || '')}">${EscapeHtmlTp(r.lastCommit || 'No commits yet')}${r.lastDate ? ` · ${EscapeHtmlTp(r.lastDate)}` : ''}</div>
            <div class="dev-repo-meta" style="color:var(--cw-accent-soft);">${EscapeHtmlTp(r.repoSlug || r.path)}</div>
            <div class="dev-repo-actions">
                <button type="button" class="btn-vscode" onclick="TriggerGhRepoAction('GH_OPEN_VSCODE', '${safePath}')">💻 VS Code</button>
                <button type="button" onclick="TriggerGhRepoAction('GH_OPEN_TERMINAL', '${safePath}')">🐚 Terminal</button>
                <button type="button" onclick="TriggerGhRepoAction('GH_OPEN_EXPLORER', '${safePath}')">📂 Folder</button>
                <button type="button" onclick="TriggerGhRepoAction('GH_GIT_PULL', '${safePath}')">⬇️ Pull</button>
                ${relBtn}
                ${pubBtn}
            </div>
        </article>`;
    }).join('');
};

window.RenderGitHubRemoteRepos = function() {
    const grid = document.getElementById('ghRemoteReposGrid');
    if (!grid) return;
    const auth = window._ghState?.auth || {};
    if (!auth.authenticated) {
        grid.innerHTML = '<div class="driver-text-node" style="padding:10px;">Sign in via GitHub CLI (<code>gh auth login</code>) or click <strong>🔑 Token</strong> above to list &amp; clone your personal GitHub repositories. (You can still clone any public Git URL above!)</div>';
        return;
    }
    const list = window._ghState?.remoteRepos || [];
    const q = (document.getElementById('inpGhRemoteFilter')?.value || '').trim().toLowerCase();
    const vis = document.getElementById('selGhRemoteVis')?.value || 'all';

    const filtered = list.filter(r => {
        if (vis === 'public' && r.private) return false;
        if (vis === 'private' && !r.private) return false;
        if (vis === 'not_cloned' && r.localPath) return false;
        if (q && !`${r.fullName} ${r.description} ${r.language}`.toLowerCase().includes(q)) return false;
        return true;
    });

    if (!filtered.length) {
        grid.innerHTML = '<div class="driver-text-node" style="padding:10px;">No GitHub repositories match the current filter.</div>';
        return;
    }

    grid.innerHTML = filtered.map(r => {
        const safeUrl = String(r.cloneUrl || '').replace(/'/g, "\\'");
        const safeLocal = String(r.localPath || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const safeSlug = String(r.fullName || '').replace(/'/g, "\\'");
        const safeHtml = String(r.htmlUrl || '').replace(/'/g, "\\'");
        const visBadge = r.private ? '<span class="sharing-badge badge-purple">Private</span>' : '<span class="sharing-badge badge-info">Public</span>';
        const clonedBadge = r.localPath ? '<span class="sharing-badge ver-uptodate">Cloned</span>' : '';
        const primaryBtn = r.localPath
            ? `<button type="button" class="btn-vscode" onclick="TriggerGhRepoAction('GH_OPEN_VSCODE', '${safeLocal}')">💻 Open in VS Code</button>`
            : `<button type="button" class="btn-vscode" onclick="TriggerGitHubCloneOwnRepo('${safeUrl}', '${EscapeHtmlTp(r.name)}')">⬇️ Clone to Projects</button>`;

        return `<article class="dev-repo-card">
            <div class="dev-repo-head">
                <span class="dev-repo-name" title="${EscapeHtmlTp(r.fullName)}">🐙 ${EscapeHtmlTp(r.fullName)}</span>
                <div class="card-badge-group">${clonedBadge}${visBadge}</div>
            </div>
            <div class="profile-card-desc">${EscapeHtmlTp(r.description || 'No description')}</div>
            <div class="dev-repo-meta">${r.language ? EscapeHtmlTp(r.language) + ' · ' : ''}★ ${r.stars || 0} · Updated ${EscapeHtmlTp(r.updatedAt || '--')}</div>
            <div class="dev-repo-actions">
                ${primaryBtn}
                <button type="button" onclick="JumpToGitHubReleases('${safeSlug}')">🚀 Releases</button>
                <button type="button" onclick="OpenExternalHttpsUrl('${safeHtml}')">🌐 GitHub ↗</button>
            </div>
        </article>`;
    }).join('');
};

window.TriggerGhRepoAction = function(command, path) {
    SetGhStatus(`Running ${command.replace('GH_', '').replace(/_/g, ' ').toLowerCase()} on ${path}...`);
    window.chrome?.webview?.postMessage(JSON.stringify({ command, path }));
};

window.TriggerGitHubCloneOwnRepo = function(cloneUrl, repoName) {
    const dest = (document.getElementById('inpGhCloneDest')?.value || window._ghState?.projectsRoot || '').trim();
    const openInEditor = !!document.getElementById('chkGhCloneOpenVsCode')?.checked;
    SetGhStatus(`Cloning ${repoName} into ${dest || 'Projects Root'}...`);
    window.chrome?.webview?.postMessage(JSON.stringify({
        command: 'GH_CLONE_REPO',
        url: cloneUrl,
        destination: dest,
        openInEditor
    }));
};

window.TriggerGitHubCloneCustomUrl = function() {
    const url = (document.getElementById('inpGhCloneUrl')?.value || '').trim();
    const destination = (document.getElementById('inpGhCloneDest')?.value || window._ghState?.projectsRoot || '').trim();
    const branch = (document.getElementById('inpGhCloneBranch')?.value || '').trim();
    const shallow = !!document.getElementById('chkGhCloneShallow')?.checked;
    const openInEditor = !!document.getElementById('chkGhCloneOpenVsCode')?.checked;
    if (!url) { SetGhStatus('Enter a Git repository URL to clone.', true); return; }
    SetGhStatus(`Cloning ${url} into ${destination || 'Projects Root'}...`);
    window.chrome?.webview?.postMessage(JSON.stringify({
        command: 'GH_CLONE_REPO',
        url,
        destination,
        branch,
        shallow,
        openInEditor
    }));
};

function PopulateGitHubReleaseRepoSelector(selectSlug = '') {
    const sel = document.getElementById('selGhReleaseRepo');
    if (!sel) return;
    const prev = selectSlug || sel.value;
    const slugs = new Set();
    (window._ghState?.localRepos || []).forEach(r => { if (r.repoSlug) slugs.add(r.repoSlug); });
    (window._ghState?.remoteRepos || []).forEach(r => { if (r.fullName) slugs.add(r.fullName); });
    const sorted = Array.from(slugs).sort((a, b) => a.localeCompare(b));
    if (!sorted.length) {
        sel.innerHTML = '<option value="">No GitHub repositories detected</option>';
        return;
    }
    sel.innerHTML = sorted.map(s => `<option value="${EscapeHtmlTp(s)}" ${s === prev ? 'selected' : ''}>${EscapeHtmlTp(s)}</option>`).join('');
    if (selectSlug && sorted.includes(selectSlug)) sel.value = selectSlug;
}

window.JumpToGitHubReleases = function(repoSlug) {
    SetGitHubSubView('releases');
    PopulateGitHubReleaseRepoSelector(repoSlug);
    TriggerLoadGitHubReleases();
};

window.TriggerLoadGitHubReleases = function() {
    const slug = document.getElementById('selGhReleaseRepo')?.value || '';
    if (!slug) { SetGhStatus('Select a GitHub repository first.', true); return; }
    SetGhStatus(`Loading releases for ${slug}...`);
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'GH_LOAD_RELEASES', repoSlug: slug }));
};

window.ToggleGitHubCreateReleaseForm = function() {
    const card = document.getElementById('ghCreateReleaseCard');
    if (card) card.style.display = (card.style.display === 'none' || !card.style.display) ? 'flex' : 'none';
};

window.BrowseGitHubReleaseAssets = function() {
    window.chrome?.webview?.postMessage('Browse-File:github_release_assets');
};

window.TriggerGenerateGitHubReleaseNotes = function() {
    const repoSlug = document.getElementById('selGhReleaseRepo')?.value || '';
    const tagName = (document.getElementById('inpGhRelTag')?.value || '').trim();
    const targetBranch = (document.getElementById('inpGhRelBranch')?.value || 'main').trim();
    if (!repoSlug || !tagName) { SetGhStatus('Select a repository and enter a Tag Name before auto-generating notes.', true); return; }
    SetGhStatus(`Generating release notes for ${tagName}...`);
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'GH_GENERATE_RELEASE_NOTES', repoSlug, tagName, targetBranch }));
};

function ApplyGitHubGeneratedNotes(data) {
    if (!data) return;
    const titleInp = document.getElementById('inpGhRelTitle');
    const bodyInp = document.getElementById('inpGhRelBody');
    if (titleInp && !titleInp.value.trim() && data.title) titleInp.value = data.title;
    if (bodyInp && data.body) bodyInp.value = data.body;
    SetGhStatus('Generated release notes from GitHub commits.');
}

window.TriggerCreateGitHubRelease = function() {
    const repoSlug = document.getElementById('selGhReleaseRepo')?.value || '';
    const tagName = (document.getElementById('inpGhRelTag')?.value || '').trim();
    const targetBranch = (document.getElementById('inpGhRelBranch')?.value || 'main').trim();
    const title = (document.getElementById('inpGhRelTitle')?.value || tagName).trim();
    const body = (document.getElementById('inpGhRelBody')?.value || '').trim();
    const draft = !!document.getElementById('chkGhRelDraft')?.checked;
    const prerelease = !!document.getElementById('chkGhRelPre')?.checked;
    const assetPaths = Array.isArray(window._ghPendingReleaseAssets) ? window._ghPendingReleaseAssets : [];
    if (!repoSlug || !tagName) { SetGhStatus('Repository and Tag Name are required.', true); return; }
    SetGhStatus(`Creating GitHub release ${tagName} on ${repoSlug}...`);
    window.chrome?.webview?.postMessage(JSON.stringify({
        command: 'GH_CREATE_RELEASE',
        repoSlug, tagName, targetBranch, title, body, draft, prerelease, assetPaths
    }));
};

window.TriggerUploadExistingReleaseAsset = function(repoSlug, uploadUrl) {
    window._ghPendingUploadTarget = { repoSlug, uploadUrl };
    window.chrome?.webview?.postMessage('Browse-File:github_upload_asset');
};

window.TriggerDeleteGitHubRelease = function(repoSlug, releaseId, tagName) {
    if (!ConfirmDestructiveAction(`Delete GitHub release '${tagName}' from ${repoSlug}?`)) return;
    SetGhStatus(`Deleting release ${tagName}...`);
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'GH_DELETE_RELEASE', repoSlug, releaseId }));
};

function RenderGitHubReleasesState(data) {
    if (!data) return;
    if (data.message) SetGhStatus(data.message, !data.ok);
    const card = document.getElementById('ghCreateReleaseCard');
    if (card && data.message && data.message.startsWith('Created release')) {
        card.style.display = 'none';
        window._ghPendingReleaseAssets = [];
        SetDomText('lblGhRelAttachedAssets', 'No files attached');
    }

    const host = document.getElementById('ghReleasesList');
    if (!host) return;
    const rels = Array.isArray(data.releases) ? data.releases : [];
    if (!rels.length) {
        host.innerHTML = `<div class="driver-text-node" style="padding:10px;">No GitHub releases found for ${EscapeHtmlTp(data.repoSlug || '')}. Click "➕ New Release" above to publish one.</div>`;
        return;
    }

    const safeSlug = String(data.repoSlug || '').replace(/'/g, "\\'");
    host.innerHTML = rels.map(r => {
        const badges = (r.draft ? '<span class="sharing-badge badge-purple">Draft</span>' : '') +
                       (r.prerelease ? '<span class="sharing-badge ver-update">Pre-release</span>' : (!r.draft ? '<span class="sharing-badge ver-uptodate">Published</span>' : ''));
        const assetsHtml = (r.assets || []).length
            ? `<div class="profile-card-chips">${r.assets.map(a => `<span class="prof-chip chip-disp" title="${a.downloads} downloads">📦 ${EscapeHtmlTp(a.name)} (${FormatDiskBytes(a.sizeBytes)} · ${a.downloads} dl)</span>`).join('')}</div>`
            : '<div class="cw-settings-sub">No attached assets</div>';
        const safeUrl = String(r.htmlUrl || '').replace(/'/g, "\\'");
        const safeUp  = String(r.uploadUrl || '').replace(/'/g, "\\'");
        const safeTag = String(r.tagName || '').replace(/'/g, "\\'");
        return `<article class="gh-release-card">
            <div class="dev-repo-head">
                <span class="dev-repo-name">🏷️ ${EscapeHtmlTp(r.tagName)} — ${EscapeHtmlTp(r.name)}</span>
                <div class="card-badge-group">${badges}<span class="cw-settings-sub">${EscapeHtmlTp(r.createdAt || '')}</span></div>
            </div>
            ${r.body ? `<div class="gh-release-body">${EscapeHtmlTp(r.body)}</div>` : ''}
            ${assetsHtml}
            <div class="dev-repo-actions">
                <button type="button" onclick="OpenExternalHttpsUrl('${safeUrl}')">🌐 Open on GitHub ↗</button>
                <button type="button" onclick="TriggerUploadExistingReleaseAsset('${safeSlug}', '${safeUp}')">📤 Upload Asset</button>
                <button type="button" class="wsl-btn-danger" onclick="TriggerDeleteGitHubRelease('${safeSlug}', ${r.id}, '${safeTag}')">🗑️ Delete</button>
            </div>
        </article>`;
    }).join('');
}

function HandleGitHubNotice(data) {
    const msg = data?.error || data?.message || '';
    if (msg) SetGhStatus(msg, !data.ok || !!data.error);
}

// =========================================================================
// JIRA MANAGER UI CONTROLLER (TASKS, TRANSITIONS, COMMENTS & WORKLOGS)
// =========================================================================
window._jiraManagerLoaded = false;
window._jiraState = null;
window._jiraActivePreset = 'assigned';
window._jiraSelectedKey = '';

function SetJiraStatus(msg, isErr = false) {
    const st = document.getElementById('jiraStatus');
    if (st && msg) {
        st.classList.toggle('sharing-error', !!isErr);
        st.textContent = msg;
    }
    if (msg) AppendConsoleLogEntry(`[JIRA] ${msg}`);
}

window.ToggleJiraAuthPanel = function() {
    const p = document.getElementById('jiraAuthPanel');
    if (p) p.style.display = (p.style.display === 'none' || !p.style.display) ? 'flex' : 'none';
};

window.SyncJiraAuthModeUi = function() {
    const mode = document.getElementById('selJiraAuthMode')?.value || 'cloud_basic';
    const wrap = document.getElementById('jiraEmailFieldWrap');
    if (wrap) wrap.style.display = (mode === 'datacenter_pat') ? 'none' : 'flex';
};

window.RequestJiraManagerState = function() {
    const preset = window._jiraActivePreset || 'assigned';
    const projectKey = document.getElementById('selJiraProjectFilter')?.value || '';
    const customJql = (document.getElementById('inpJiraCustomJql')?.value || '').trim();
    SetJiraStatus('Syncing Jira tasks...');
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'JIRA_LOAD', preset, projectKey, customJql }));
};

window.SetJiraPreset = function(preset) {
    window._jiraActivePreset = preset;
    document.querySelectorAll('#jiraPresetPills .filter-pill').forEach(b => b.classList.toggle('active', b.dataset.preset === preset));
    const jqlRow = document.getElementById('jiraCustomJqlRow');
    if (jqlRow) jqlRow.style.display = (preset === 'custom') ? 'flex' : 'none';
    if (preset !== 'custom') RequestJiraManagerState();
};

window.TriggerJiraSignIn = function() {
    const authMode = document.getElementById('selJiraAuthMode')?.value || 'cloud_basic';
    const siteUrl = (document.getElementById('inpJiraSiteUrl')?.value || '').trim();
    const email = (document.getElementById('inpJiraEmail')?.value || '').trim();
    const tokenInp = document.getElementById('inpJiraToken');
    const token = (tokenInp?.value || '').trim();
    if (!siteUrl) { SetJiraStatus('Enter your Jira Site URL (e.g. https://yourorg.atlassian.net).', true); return; }
    if (tokenInp) tokenInp.value = '';
    SetJiraStatus(`Connecting to ${siteUrl}...`);
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'JIRA_SIGN_IN', authMode, siteUrl, email, token }));
};

window.TriggerJiraSignOut = function() {
    if (!confirm('Sign out of Jira and delete the locally encrypted API token?')) return;
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'JIRA_SIGN_OUT' }));
};

function RenderJiraManagerState(data) {
    if (!data) return;
    window._jiraManagerLoaded = true;
    window._jiraState = data;

    const cfg = data.config || {};
    const authPanel = document.getElementById('jiraAuthPanel');
    const modeSel = document.getElementById('selJiraAuthMode');
    if (modeSel && cfg.authMode) modeSel.value = cfg.authMode;
    SyncJiraAuthModeUi();
    const siteInp = document.getElementById('inpJiraSiteUrl');
    if (siteInp && cfg.siteUrl) siteInp.value = cfg.siteUrl;
    const emailInp = document.getElementById('inpJiraEmail');
    if (emailInp && cfg.email) emailInp.value = cfg.email;

    const badge = document.getElementById('lblJiraUserBadge');
    const newBtn = document.getElementById('btnJiraNewIssue');
    if (data.authenticated && data.user) {
        if (badge) badge.innerHTML = `Account: <strong style="color:#68d391;">${EscapeHtmlTp(data.user.displayName)}</strong>`;
        if (newBtn) newBtn.disabled = false;
        if (authPanel) authPanel.style.display = 'none';
    } else {
        if (badge) badge.innerHTML = `Account: <strong style="color:#f6ad55;">Not Signed In</strong>`;
        if (newBtn) newBtn.disabled = true;
        if (authPanel) authPanel.style.display = 'flex';
    }

    const sum = data.summary || {};
    SetDomText('sumJiraTotal', sum.total ?? 0);
    SetDomText('sumJiraTodo', sum.todo ?? 0);
    SetDomText('sumJiraProg', sum.inProgress ?? 0);
    SetDomText('sumJiraDone', sum.done ?? 0);

    // Populate project dropdowns
    const projs = Array.isArray(data.projects) ? data.projects : [];
    const projFlt = document.getElementById('selJiraProjectFilter');
    if (projFlt) {
        const curP = data.activeProject || '';
        projFlt.innerHTML = `<option value="">All Projects</option>` +
            projs.map(p => `<option value="${EscapeHtmlTp(p.key)}" ${p.key === curP ? 'selected' : ''}>${EscapeHtmlTp(p.key)} — ${EscapeHtmlTp(p.name)}</option>`).join('');
    }
    const newProjSel = document.getElementById('selJiraNewProject');
    if (newProjSel) {
        newProjSel.innerHTML = projs.map(p => `<option value="${EscapeHtmlTp(p.key)}">${EscapeHtmlTp(p.key)} — ${EscapeHtmlTp(p.name)}</option>`).join('');
    }

    if (data.notice) SetJiraStatus(data.notice, !!data.noticeError);
    RenderJiraIssuesList();
}

window.RenderJiraIssuesList = function() {
    const host = document.getElementById('jiraIssuesList');
    if (!host) return;
    if (!window._jiraState?.authenticated) {
        host.innerHTML = '<div class="driver-text-node" style="padding:12px;">Sign in above to load your Jira tasks.</div>';
        return;
    }
    const q = (document.getElementById('inpJiraSearch')?.value || '').trim().toLowerCase();
    const issues = (window._jiraState.issues || []).filter(i =>
        !q || `${i.key} ${i.summary} ${i.status} ${i.priority} ${i.issueType} ${i.assignee}`.toLowerCase().includes(q)
    );
    if (!issues.length) {
        host.innerHTML = '<div class="driver-text-node" style="padding:12px;">No Jira issues match the active filter.</div>';
        return;
    }

    host.innerHTML = issues.map(i => {
        const isSel = i.key === window._jiraSelectedKey;
        const stCls = i.statusCategory === 'done' ? 'ver-uptodate' : (i.statusCategory === 'indeterminate' ? 'badge-info' : 'badge-neutral');
        return `<div class="jira-issue-row ${isSel ? 'is-selected' : ''}" onclick="SelectJiraIssue('${EscapeHtmlTp(i.key)}')">
            <div class="dev-repo-head">
                <span class="jira-issue-key">${EscapeHtmlTp(i.key)} · ${EscapeHtmlTp(i.issueType)}</span>
                <div class="card-badge-group">
                    <span class="sharing-badge ${stCls}">${EscapeHtmlTp(i.status)}</span>
                    <span class="sharing-badge badge-purple">${EscapeHtmlTp(i.priority)}</span>
                </div>
            </div>
            <div class="jira-issue-summary">${EscapeHtmlTp(i.summary)}</div>
            <div class="dev-repo-meta">${EscapeHtmlTp(i.assignee)} · Updated ${EscapeHtmlTp(i.updated || '--')}</div>
        </div>`;
    }).join('');
};

window.SelectJiraIssue = function(issueKey) {
    window._jiraSelectedKey = issueKey;
    RenderJiraIssuesList();
    const detail = document.getElementById('jiraDetailPane');
    if (detail) detail.innerHTML = `<div class="driver-text-node" style="padding:14px;">Loading ${EscapeHtmlTp(issueKey)}...</div>`;
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'JIRA_GET_ISSUE_DETAIL', issueKey }));
};

function RenderJiraIssueDetail(data) {
    if (!data || !data.issue) return;
    if (data.notice) SetJiraStatus(data.notice, false);
    if (data.refreshList) RequestJiraManagerState();

    const detail = document.getElementById('jiraDetailPane');
    if (!detail) return;
    const iss = data.issue;
    const safeKey = String(iss.key || '').replace(/'/g, "\\'");
    const safeUrl = String(iss.browseUrl || '').replace(/'/g, "\\'");
    const slug = String(iss.summary || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 42);
    const branchName = `${String(iss.issueType || 'task').toLowerCase() === 'bug' ? 'fix' : 'feature'}/${iss.key}-${slug || 'task'}`;
    const safeBranch = branchName.replace(/'/g, "\\'");

    const transBtns = (data.transitions || []).map(t => {
        const sName = String(t.name || '').replace(/'/g, "\\'");
        return `<button type="button" class="console-clear-btn" onclick="TriggerJiraTransition('${safeKey}', '${EscapeHtmlTp(t.id)}', '${sName}')">→ ${EscapeHtmlTp(t.name)}</button>`;
    }).join('');

    const commentsHtml = (data.comments || []).length
        ? data.comments.map(c => `<div class="jira-comment-item"><div class="jira-comment-meta"><strong>${EscapeHtmlTp(c.author)}</strong> · ${EscapeHtmlTp(c.created)}</div><div>${EscapeHtmlTp(c.body)}</div></div>`).join('')
        : '<div class="cw-settings-sub">No comments yet.</div>';

    detail.innerHTML = `<div class="jira-detail-wrap">
        <div class="dev-repo-head">
            <span class="jira-issue-key" style="font-size:13px;">${EscapeHtmlTp(iss.key)} · ${EscapeHtmlTp(iss.issueType)}</span>
            <div class="card-badge-group">
                <span class="sharing-badge badge-info">${EscapeHtmlTp(iss.status)}</span>
                <span class="sharing-badge badge-purple">${EscapeHtmlTp(iss.priority)}</span>
            </div>
        </div>
        <div style="font-size:14px; font-weight:700; color:var(--cw-text-primary);">${EscapeHtmlTp(iss.summary)}</div>
        <div class="dev-repo-meta">Assignee: ${EscapeHtmlTp(iss.assignee)} · Reporter: ${EscapeHtmlTp(iss.reporter || '--')} · Logged: ${EscapeHtmlTp(data.timeSpent || 'None')}</div>

        <div class="jira-transitions-bar">
            <span class="cw-settings-sub" style="margin-right:4px;">Move to:</span>
            ${transBtns || '<span class="cw-settings-sub">No transitions available</span>'}
        </div>

        <div class="dev-repo-actions" style="border-top:none; padding-top:0;">
            <button type="button" class="btn-vscode" onclick="TriggerJiraAssignToMe('${safeKey}')">👤 Assign to Me</button>
            <button type="button" onclick="CopyRawText('${safeBranch}', 'Git branch')">🌿 Copy Branch</button>
            <button type="button" onclick="OpenExternalHttpsUrl('${safeUrl}')">🌐 Open in Jira ↗</button>
        </div>

        <div>
            <div class="cw-set-sec-title" style="margin-bottom:5px;">Description</div>
            <div class="jira-desc-box">${EscapeHtmlTp(data.description || 'No description provided.')}</div>
        </div>

        <div class="cw-set-card">
            <div class="cw-set-sec-title">⏱️ Log Work Time</div>
            <div class="dev-auth-row">
                <input type="text" id="inpJiraLogTime" class="prof-input" style="max-width:120px;" placeholder="e.g. 30m, 1h 30m">
                <input type="text" id="inpJiraLogNote" class="prof-input" placeholder="Work note (optional)">
                <button type="button" class="console-clear-btn btn-accent-action" onclick="TriggerJiraLogWork('${safeKey}')">Log Time</button>
            </div>
        </div>

        <div class="cw-set-card">
            <div class="cw-set-sec-title">💬 Comments (${(data.comments || []).length})</div>
            <div>${commentsHtml}</div>
            <textarea id="inpJiraNewComment" class="prof-input" rows="2" placeholder="Write a comment..."></textarea>
            <div style="display:flex; justify-content:flex-end;">
                <button type="button" class="console-clear-btn btn-accent-action" onclick="TriggerJiraAddComment('${safeKey}')">Post Comment</button>
            </div>
        </div>
    </div>`;
}

window.TriggerJiraTransition = function(issueKey, transitionId, transitionName) {
    SetJiraStatus(`Transitioning ${issueKey} → ${transitionName}...`);
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'JIRA_TRANSITION_ISSUE', issueKey, transitionId, transitionName }));
};

window.TriggerJiraAssignToMe = function(issueKey) {
    SetJiraStatus(`Assigning ${issueKey} to you...`);
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'JIRA_ASSIGN_TO_ME', issueKey }));
};

window.TriggerJiraAddComment = function(issueKey) {
    const body = (document.getElementById('inpJiraNewComment')?.value || '').trim();
    if (!body) { SetJiraStatus('Enter a comment first.', true); return; }
    SetJiraStatus(`Posting comment to ${issueKey}...`);
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'JIRA_ADD_COMMENT', issueKey, body }));
};

window.TriggerJiraLogWork = function(issueKey) {
    const timeSpent = (document.getElementById('inpJiraLogTime')?.value || '').trim();
    const comment = (document.getElementById('inpJiraLogNote')?.value || '').trim();
    if (!timeSpent) { SetJiraStatus('Enter a time duration (e.g. 30m or 1h 30m).', true); return; }
    SetJiraStatus(`Logging ${timeSpent} on ${issueKey}...`);
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'JIRA_LOG_WORK', issueKey, timeSpent, comment }));
};

window.OpenJiraCreateIssueModal = function() {
    const m = document.getElementById('jiraCreateIssueModal');
    if (m) m.style.display = 'flex';
    setTimeout(() => document.getElementById('inpJiraNewSummary')?.focus(), 10);
};

window.CloseJiraCreateIssueModal = function() {
    const m = document.getElementById('jiraCreateIssueModal');
    if (m) m.style.display = 'none';
};

window.TriggerCreateJiraIssue = function() {
    const projectKey = document.getElementById('selJiraNewProject')?.value || '';
    const issueType = document.getElementById('selJiraNewType')?.value || 'Task';
    const summary = (document.getElementById('inpJiraNewSummary')?.value || '').trim();
    const description = (document.getElementById('inpJiraNewDesc')?.value || '').trim();
    const assignToMe = !!document.getElementById('chkJiraNewAssignMe')?.checked;
    if (!projectKey || !summary) { SetJiraStatus('Project and Summary are required.', true); return; }
    CloseJiraCreateIssueModal();
    document.getElementById('inpJiraNewSummary').value = '';
    document.getElementById('inpJiraNewDesc').value = '';
    SetJiraStatus(`Creating Jira ${issueType} in ${projectKey}...`);
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'JIRA_CREATE_ISSUE', projectKey, issueType, summary, description, assignToMe }));
};

function HandleJiraNotice(data) {
    const msg = data?.error || data?.message || '';
    if (msg) SetJiraStatus(msg, !data.ok || !!data.error);
}

// =========================================================================
// RESPONSIVE DROPDOWN VIEWPORT EDGE CLAMPING
// =========================================================================
function ClampNavDropdownMenu(menuEl) {
    if (!menuEl) return;
    menuEl.style.left = '';
    menuEl.style.right = '';
    const rect = menuEl.getBoundingClientRect();
    const vw = window.innerWidth || document.documentElement.clientWidth || 1080;
    if (rect.right > vw - 8) {
        menuEl.style.left = 'auto';
        menuEl.style.right = '0';
    }
    const rectAfter = menuEl.getBoundingClientRect();
    if (rectAfter.left < 8) {
        menuEl.style.left = '0';
        menuEl.style.right = 'auto';
    }
}

// =========================================================================
// LIVE DRAGGABLE THEME & APPEARANCE STUDIO CONTROLLER
//   - Non-blocking movable popup so live changes are visible immediately
//   - Customizes all non-functional UI chrome, surfaces, accents & typography
//   - Preserves coded diagnostic/status/thermal/RX-TX colors
//   - Local host wallpaper with Cover/Stretch/Center/Contain/Tile, Transparency,
//     Fade style/strength, Blur & Card Surface Opacity
// =========================================================================
const CW_THEME_STORAGE_KEY = 'cw_custom_theme_v1';

const CW_THEME_DEFAULTS = {
    presetId: 'classic',
    bgApp: '#1a202c',
    bgSurface: '#212936',
    bgInset: '#141923',
    bgControl: '#2d3748',
    border: '#323c4b',
    borderStrong: '#4a5568',
    accent: '#3182ce',
    accentLight: '#4299e1',
    accentSoft: '#63b3ed',
    textPrimary: '#f7fafc',
    textSecondary: '#cbd5e0',
    textMuted: '#a0aec0',
    surfaceOpacity: 100,
    cardBlur: 0,
    bgImageFile: '',
    bgImageName: '',
    bgImageUrl: '',
    bgFit: 'cover',
    bgOpacity: 45,
    bgBlur: 0,
    bgFadeMode: 'vignette',
    bgFadeStrength: 35
};

const CW_THEME_PRESETS = [
    {
        id: 'classic', name: 'CoreWatch Classic',
        dots: ['#1a202c', '#212936', '#3182ce'],
        colors: {
            bgApp: '#1a202c', bgSurface: '#212936', bgInset: '#141923', bgControl: '#2d3748',
            border: '#323c4b', borderStrong: '#4a5568',
            accent: '#3182ce', accentLight: '#4299e1', accentSoft: '#63b3ed',
            textPrimary: '#f7fafc', textSecondary: '#cbd5e0', textMuted: '#a0aec0'
        }
    },
    {
        id: 'midnight', name: 'Midnight OLED',
        dots: ['#06080d', '#0f141e', '#38bdf8'],
        colors: {
            bgApp: '#06080d', bgSurface: '#0f141e', bgInset: '#090c13', bgControl: '#192233',
            border: '#1e293b', borderStrong: '#334155',
            accent: '#0284c7', accentLight: '#38bdf8', accentSoft: '#7dd3fc',
            textPrimary: '#f8fafc', textSecondary: '#cbd5e1', textMuted: '#94a3b8'
        }
    },
    {
        id: 'cyberpunk', name: 'Cyberpunk Neon',
        dots: ['#0d0a1a', '#17122b', '#d946ef'],
        colors: {
            bgApp: '#0d0a1a', bgSurface: '#17122b', bgInset: '#100c20', bgControl: '#261d42',
            border: '#322459', borderStrong: '#523b8a',
            accent: '#c026d3', accentLight: '#e879f9', accentSoft: '#22d3ee',
            textPrimary: '#fdf4ff', textSecondary: '#e9d5ff', textMuted: '#a78bfa'
        }
    },
    {
        id: 'emerald', name: 'Emerald Matrix',
        dots: ['#0a1310', '#12211b', '#10b981'],
        colors: {
            bgApp: '#0a1310', bgSurface: '#12211b', bgInset: '#0c1713', bgControl: '#1b3129',
            border: '#214035', borderStrong: '#2f5e4d',
            accent: '#059669', accentLight: '#10b981', accentSoft: '#34d399',
            textPrimary: '#ecfdf5', textSecondary: '#bbf7d0', textMuted: '#86efac'
        }
    },
    {
        id: 'amber', name: 'Amber Forge',
        dots: ['#16120f', '#221b16', '#d97706'],
        colors: {
            bgApp: '#16120f', bgSurface: '#221b16', bgInset: '#1a1410', bgControl: '#332820',
            border: '#44352a', borderStrong: '#634d3d',
            accent: '#d97706', accentLight: '#f59e0b', accentSoft: '#fbbf24',
            textPrimary: '#fffbeb', textSecondary: '#fde68a', textMuted: '#c2a685'
        }
    },
    {
        id: 'nord', name: 'Nord Frost',
        dots: ['#2e3440', '#3b4252', '#88c0d0'],
        colors: {
            bgApp: '#2e3440', bgSurface: '#3b4252', bgInset: '#272c36', bgControl: '#434c5e',
            border: '#4c566a', borderStrong: '#616e88',
            accent: '#5e81ac', accentLight: '#81a1c1', accentSoft: '#88c0d0',
            textPrimary: '#eceff4', textSecondary: '#e5e9f0', textMuted: '#aeb9cc'
        }
    },
    {
        id: 'crimson', name: 'Crimson Ops',
        dots: ['#141014', '#211820', '#e11d48'],
        colors: {
            bgApp: '#141014', bgSurface: '#211820', bgInset: '#181218', bgControl: '#332331',
            border: '#442d40', borderStrong: '#66405f',
            accent: '#be123c', accentLight: '#f43f5e', accentSoft: '#fda4af',
            textPrimary: '#fff1f2', textSecondary: '#fecdd3', textMuted: '#bca0a8'
        }
    },
    {
        id: 'synthwave', name: 'Synthwave Sunset',
        dots: ['#110b1f', '#f97316', '#fb7185'],
        colors: {
            bgApp: '#110b1f', bgSurface: '#1b1230', bgInset: '#140d24', bgControl: '#2b1c47',
            border: '#3e2763', borderStrong: '#653d99',
            accent: '#ea580c', accentLight: '#fb7185', accentSoft: '#fbbf24',
            textPrimary: '#fff7ed', textSecondary: '#fed7aa', textMuted: '#c4b5fd'
        }
    },
    {
        id: 'aurora', name: 'Aurora Borealis',
        dots: ['#07121b', '#06b6d4', '#c084fc'],
        colors: {
            bgApp: '#07121b', bgSurface: '#0f202e', bgInset: '#0a1722', bgControl: '#183247',
            border: '#1f445e', borderStrong: '#2e6487',
            accent: '#0891b2', accentLight: '#2dd4bf', accentSoft: '#c084fc',
            textPrimary: '#ecfeff', textSecondary: '#bae6fd', textMuted: '#88b4cc'
        }
    },
    {
        id: 'daylight', name: 'Daylight Slate',
        dots: ['#e2e8f0', '#ffffff', '#2563eb'],
        colors: {
            bgApp: '#e2e8f0', bgSurface: '#ffffff', bgInset: '#f1f5f9', bgControl: '#e2e8f0',
            border: '#cbd5e1', borderStrong: '#94a3b8',
            accent: '#2563eb', accentLight: '#1d4ed8', accentSoft: '#0284c7',
            textPrimary: '#0f172a', textSecondary: '#334155', textMuted: '#64748b'
        }
    }
];

const CW_THEME_COLOR_FIELDS = [
    { key: 'bgApp',         inp: 'clrBgApp',         hex: 'hexBgApp' },
    { key: 'bgSurface',     inp: 'clrBgSurface',     hex: 'hexBgSurface' },
    { key: 'bgInset',       inp: 'clrBgInset',       hex: 'hexBgInset' },
    { key: 'bgControl',     inp: 'clrBgControl',     hex: 'hexBgControl' },
    { key: 'border',        inp: 'clrBorder',        hex: 'hexBorder' },
    { key: 'borderStrong',  inp: 'clrBorderStrong',  hex: 'hexBorderStrong' },
    { key: 'accent',        inp: 'clrAccent',        hex: 'hexAccent' },
    { key: 'accentLight',   inp: 'clrAccentLight',   hex: 'hexAccentLight' },
    { key: 'accentSoft',    inp: 'clrAccentSoft',    hex: 'hexAccentSoft' },
    { key: 'textPrimary',   inp: 'clrTextPrimary',   hex: 'hexTextPrimary' },
    { key: 'textSecondary', inp: 'clrTextSecondary', hex: 'hexTextSecondary' },
    { key: 'textMuted',     inp: 'clrTextMuted',     hex: 'hexTextMuted' }
];

window._cwThemeState = { ...CW_THEME_DEFAULTS };
window._cwThemeSaveTimer = null;

function NormalizeHexColor(val, fallback) {
    const s = String(val || '').trim();
    if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
    if (/^#[0-9a-fA-F]{3}$/.test(s)) {
        return ('#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]).toLowerCase();
    }
    return fallback;
}

function HexToRgbParts(hex) {
    const h = NormalizeHexColor(hex, '#1a202c').slice(1);
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function HexToRgbTuple(hex) {
    const [r, g, b] = HexToRgbParts(hex);
    return `${r}, ${g}, ${b}`;
}

function AdjustHexBrightness(hex, delta) {
    const [r, g, b] = HexToRgbParts(hex);
    const clamp = (n) => Math.max(0, Math.min(255, Math.round(n)));
    const toHex = (n) => clamp(n).toString(16).padStart(2, '0');
    return `#${toHex(r + delta)}${toHex(g + delta)}${toHex(b + delta)}`;
}

function PickOnAccentColor(hex) {
    const [r, g, b] = HexToRgbParts(hex);
    const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return lum > 0.62 ? '#0f172a' : '#ffffff';
}

function BuildThemeFadeOverlay(mode, strengthPct, bgAppRgb) {
    const alpha = Math.max(0, Math.min(0.95, Number(strengthPct || 0) / 100));
    if (mode === 'none' || alpha <= 0.005) return 'none';
    if (mode === 'uniform') return `rgba(${bgAppRgb}, ${alpha.toFixed(2)})`;
    if (mode === 'vignette') {
        const inner = (alpha * 0.25).toFixed(2);
        return `radial-gradient(ellipse at center, rgba(${bgAppRgb}, ${inner}) 28%, rgba(${bgAppRgb}, ${alpha.toFixed(2)}) 100%)`;
    }
    if (mode === 'top') {
        return `linear-gradient(to bottom, rgba(${bgAppRgb}, ${alpha.toFixed(2)}) 0%, rgba(${bgAppRgb}, ${(alpha * 0.2).toFixed(2)}) 55%, rgba(${bgAppRgb}, 0) 100%)`;
    }
    if (mode === 'bottom') {
        return `linear-gradient(to top, rgba(${bgAppRgb}, ${alpha.toFixed(2)}) 0%, rgba(${bgAppRgb}, ${(alpha * 0.2).toFixed(2)}) 55%, rgba(${bgAppRgb}, 0) 100%)`;
    }
    return 'none';
}

function NormalizeThemeState(raw) {
    const src = (raw && typeof raw === 'object') ? raw : {};
    const out = { ...CW_THEME_DEFAULTS };
    if (typeof src.presetId === 'string') out.presetId = src.presetId;
    CW_THEME_COLOR_FIELDS.forEach(f => {
        out[f.key] = NormalizeHexColor(src[f.key], CW_THEME_DEFAULTS[f.key]);
    });
    const clampNum = (v, min, max, def) => {
        const n = Number(v);
        return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.round(n))) : def;
    };
    out.surfaceOpacity = clampNum(src.surfaceOpacity, 35, 100, CW_THEME_DEFAULTS.surfaceOpacity);
    out.cardBlur       = clampNum(src.cardBlur, 0, 16, CW_THEME_DEFAULTS.cardBlur);
    out.bgOpacity      = clampNum(src.bgOpacity, 0, 100, CW_THEME_DEFAULTS.bgOpacity);
    out.bgBlur         = clampNum(src.bgBlur, 0, 24, CW_THEME_DEFAULTS.bgBlur);
    out.bgFadeStrength = clampNum(src.bgFadeStrength, 0, 95, CW_THEME_DEFAULTS.bgFadeStrength);

    const validFits = ['cover', 'stretch', 'center', 'contain', 'tile'];
    out.bgFit = validFits.includes(src.bgFit) ? src.bgFit : CW_THEME_DEFAULTS.bgFit;

    const validFades = ['none', 'uniform', 'vignette', 'top', 'bottom'];
    out.bgFadeMode = validFades.includes(src.bgFadeMode) ? src.bgFadeMode : CW_THEME_DEFAULTS.bgFadeMode;

    out.bgImageFile = typeof src.bgImageFile === 'string' ? src.bgImageFile : '';
    out.bgImageName = typeof src.bgImageName === 'string' ? src.bgImageName : '';
    out.bgImageUrl  = typeof src.bgImageUrl  === 'string' ? src.bgImageUrl  : '';
    if (!out.bgImageUrl && out.bgImageFile) {
        out.bgImageUrl = `https://corewatch-local.assets/${encodeURIComponent(out.bgImageFile)}`;
    }
    return out;
}

function LoadLocalThemeFallback() {
    try {
        const raw = localStorage.getItem(CW_THEME_STORAGE_KEY);
        if (raw) return NormalizeThemeState(JSON.parse(raw));
    } catch {}
    return { ...CW_THEME_DEFAULTS };
}

function PersistThemeStateDebounced(theme) {
    try { localStorage.setItem(CW_THEME_STORAGE_KEY, JSON.stringify(theme)); } catch {}
    SetDomText('lblThemeSaveState', 'Saving...');
    if (window._cwThemeSaveTimer) clearTimeout(window._cwThemeSaveTimer);
    window._cwThemeSaveTimer = setTimeout(() => {
        window.chrome?.webview?.postMessage(JSON.stringify({ command: 'SAVE_UI_THEME', theme }));
        SetDomText('lblThemeSaveState', 'Saved ✓');
    }, 220);
}

function ApplyThemeState(rawTheme, persist = false) {
    const t = NormalizeThemeState(rawTheme);
    window._cwThemeState = t;

    const root = document.documentElement.style;
    const bgAppRgb     = HexToRgbTuple(t.bgApp);
    const bgSurfaceRgb = HexToRgbTuple(t.bgSurface);
    const bgInsetRgb   = HexToRgbTuple(t.bgInset);
    const accentRgb    = HexToRgbTuple(t.accent);

    const [ctrlR, ctrlG, ctrlB] = HexToRgbParts(t.bgControl);
    const ctrlLum = (0.299 * ctrlR + 0.587 * ctrlG + 0.114 * ctrlB) / 255;
    const ctrlHover = AdjustHexBrightness(t.bgControl, ctrlLum > 0.65 ? -16 : 16);

    const surfAlpha  = (t.surfaceOpacity / 100).toFixed(2);
    const insetAlpha = Math.max(0.30, Math.min(1, (t.surfaceOpacity / 100) * 0.96)).toFixed(2);

    root.setProperty('--cw-bg-app', t.bgApp);
    root.setProperty('--cw-bg-app-rgb', bgAppRgb);
    root.setProperty('--cw-bg-surface', t.bgSurface);
    root.setProperty('--cw-bg-surface-rgb', bgSurfaceRgb);
    root.setProperty('--cw-bg-inset', t.bgInset);
    root.setProperty('--cw-bg-inset-rgb', bgInsetRgb);
    root.setProperty('--cw-bg-control', t.bgControl);
    root.setProperty('--cw-bg-control-hover', ctrlHover);
    root.setProperty('--cw-border', t.border);
    root.setProperty('--cw-border-strong', t.borderStrong);
    root.setProperty('--cw-accent', t.accent);
    root.setProperty('--cw-accent-rgb', accentRgb);
    root.setProperty('--cw-accent-light', t.accentLight);
    root.setProperty('--cw-accent-soft', t.accentSoft);
    root.setProperty('--cw-on-accent', PickOnAccentColor(t.accent));
    root.setProperty('--cw-text-primary', t.textPrimary);
    root.setProperty('--cw-text-secondary', t.textSecondary);
    root.setProperty('--cw-text-muted', t.textMuted);
    root.setProperty('--cw-surface-alpha', surfAlpha);
    root.setProperty('--cw-inset-alpha', insetAlpha);
    root.setProperty('--cw-card-blur', `${t.cardBlur}px`);

    // Local Wallpaper & Fit / Transparency / Fade / Blur
    const hasImg = !!t.bgImageUrl;
    root.setProperty('--cw-bg-image', hasImg ? `url("${t.bgImageUrl.replace(/"/g, '\\"')}")` : 'none');

    let bgSize = 'cover', bgPos = 'center center', bgRep = 'no-repeat';
    if (t.bgFit === 'stretch')      { bgSize = '100% 100%'; bgPos = 'center center'; bgRep = 'no-repeat'; }
    else if (t.bgFit === 'center')  { bgSize = 'auto';      bgPos = 'center center'; bgRep = 'no-repeat'; }
    else if (t.bgFit === 'contain') { bgSize = 'contain';   bgPos = 'center center'; bgRep = 'no-repeat'; }
    else if (t.bgFit === 'tile')    { bgSize = 'auto';      bgPos = 'top left';      bgRep = 'repeat'; }

    root.setProperty('--cw-bg-size', bgSize);
    root.setProperty('--cw-bg-position', bgPos);
    root.setProperty('--cw-bg-repeat', bgRep);
    root.setProperty('--cw-bg-opacity', hasImg ? (t.bgOpacity / 100).toFixed(2) : '0');
    root.setProperty('--cw-bg-blur', `${t.bgBlur}px`);
    root.setProperty('--cw-bg-scale', t.bgBlur > 0 ? '1.04' : '1');
    root.setProperty('--cw-bg-fade-overlay', hasImg ? BuildThemeFadeOverlay(t.bgFadeMode, t.bgFadeStrength, bgAppRgb) : 'none');

    SyncThemeStudioControls();
    if (persist) PersistThemeStateDebounced(t);
}

function RenderThemePresetButtons() {
    const grid = document.getElementById('themePresetsGrid');
    if (!grid) return;
    const activeId = window._cwThemeState?.presetId || '';
    grid.innerHTML = CW_THEME_PRESETS.map(p => {
        const dots = p.dots.map(c => `<span class="cw-preset-dot" style="background:${c};"></span>`).join('');
        return `<button type="button" class="cw-preset-btn ${p.id === activeId ? 'active' : ''}" onclick="ApplyThemePreset('${p.id}')">
            <span>${EscapeHtmlTp(p.name)}</span>
            <span class="cw-preset-dots">${dots}</span>
        </button>`;
    }).join('');
}

function SyncThemeStudioControls() {
    const t = window._cwThemeState || CW_THEME_DEFAULTS;
    CW_THEME_COLOR_FIELDS.forEach(f => {
        const inp = document.getElementById(f.inp);
        if (inp && inp.value.toLowerCase() !== t[f.key]) inp.value = t[f.key];
        SetDomText(f.hex, t[f.key]);
    });

    const setRng = (id, val) => { const el = document.getElementById(id); if (el) el.value = String(val); };
    setRng('rngThemeSurfaceOpacity', t.surfaceOpacity);
    setRng('rngThemeSurfaceOpacityMirror', t.surfaceOpacity);
    setRng('rngThemeCardBlur', t.cardBlur);
    setRng('rngThemeBgOpacity', t.bgOpacity);
    setRng('rngThemeBgBlur', t.bgBlur);
    setRng('rngThemeBgFadeStrength', t.bgFadeStrength);

    SetDomText('lblThemeSurfaceOpacity', `${t.surfaceOpacity}%`);
    SetDomText('lblThemeSurfaceOpacityMirror', `${t.surfaceOpacity}%`);
    SetDomText('lblThemeCardBlur', `${t.cardBlur} px`);
    SetDomText('lblThemeBgOpacity', `${t.bgOpacity}%`);
    SetDomText('lblThemeBgBlur', `${t.bgBlur} px`);
    SetDomText('lblThemeBgFadeStrength', `${t.bgFadeStrength}%`);

    const fadeSel = document.getElementById('selThemeBgFadeMode');
    if (fadeSel) fadeSel.value = t.bgFadeMode;

    document.querySelectorAll('#themeBgFitPills .filter-pill').forEach(b => {
        b.classList.toggle('active', b.dataset.fit === t.bgFit);
    });

    const clearBtn = document.getElementById('btnClearThemeBg');
    if (clearBtn) clearBtn.disabled = !t.bgImageUrl;
    SetDomText('lblThemeBgName', t.bgImageUrl
        ? `🖼️ Active: ${t.bgImageName || t.bgImageFile}`
        : 'No background image selected (using solid App Background color)');

    RenderThemePresetButtons();
}

window.OpenThemeStudio = function() {
    const pop = document.getElementById('themeStudioPopup');
    const btn = document.getElementById('btnOpenThemeStudio');
    if (!pop) return;
    pop.style.display = 'flex';
    pop.classList.remove('is-collapsed');
    SetDomText('btnThemeStudioCollapse', '▾');
    if (btn) btn.classList.add('active');
    SyncThemeStudioControls();
    ClampThemeStudioIntoViewport();
};

window.CloseThemeStudio = function() {
    const pop = document.getElementById('themeStudioPopup');
    const btn = document.getElementById('btnOpenThemeStudio');
    if (pop) pop.style.display = 'none';
    if (btn) btn.classList.remove('active');
};

window.ToggleThemeStudio = function() {
    const pop = document.getElementById('themeStudioPopup');
    if (pop && pop.style.display !== 'none') CloseThemeStudio();
    else OpenThemeStudio();
};

window.ToggleThemeStudioCollapse = function() {
    const pop = document.getElementById('themeStudioPopup');
    if (!pop) return;
    const isCol = pop.classList.toggle('is-collapsed');
    SetDomText('btnThemeStudioCollapse', isCol ? '▴' : '▾');
};

window.SwitchThemeStudioPane = function(paneKey) {
    document.querySelectorAll('#themeStudioSubtabs .cw-theme-subtab').forEach(b => {
        b.classList.toggle('active', b.dataset.pane === paneKey);
    });
    const pCol = document.getElementById('themePaneColors');
    const pBg  = document.getElementById('themePaneBackground');
    if (pCol) pCol.classList.toggle('active', paneKey === 'colors');
    if (pBg)  pBg.classList.toggle('active', paneKey === 'background');
};

window.ApplyThemePreset = function(presetId) {
    const found = CW_THEME_PRESETS.find(p => p.id === presetId);
    if (!found) return;
    const next = { ...window._cwThemeState, ...found.colors, presetId: found.id };
    ApplyThemeState(next, true);
};

window.OnThemeColorInput = function(fieldKey, hexVal) {
    const next = { ...window._cwThemeState, [fieldKey]: hexVal, presetId: 'custom' };
    ApplyThemeState(next, true);
};

window.OnThemeSliderInput = function(fieldKey, numVal) {
    const next = { ...window._cwThemeState, [fieldKey]: numVal };
    ApplyThemeState(next, true);
};

window.OnThemeSelectInput = function(fieldKey, val) {
    const next = { ...window._cwThemeState, [fieldKey]: val };
    ApplyThemeState(next, true);
};

window.SetThemeBgFit = function(fitMode) {
    const next = { ...window._cwThemeState, bgFit: fitMode };
    ApplyThemeState(next, true);
};

window.BrowseThemeBackgroundImage = function() {
    window.chrome?.webview?.postMessage('Browse-File:theme_bg_image');
};

window.ClearThemeBackgroundImage = function() {
    const next = { ...window._cwThemeState, bgImageFile: '', bgImageName: '', bgImageUrl: '' };
    ApplyThemeState(next, true);
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'CLEAR_THEME_BG_IMAGE' }));
};

function HandleThemeBgImageSelected(data) {
    if (!data) return;
    if (!data.ok) {
        SetDomText('lblThemeSaveState', data.error || 'Image load failed');
        return;
    }
    const cur = window._cwThemeState || CW_THEME_DEFAULTS;
    const next = {
        ...cur,
        bgImageFile: data.file || '',
        bgImageName: data.name || data.file || 'Custom Wallpaper',
        bgImageUrl:  data.url  || '',
        // Auto-reveal wallpaper behind cards if cards were 100% solid opaque
        surfaceOpacity: cur.surfaceOpacity >= 98 ? 84 : cur.surfaceOpacity,
        bgOpacity: cur.bgOpacity <= 5 ? 45 : cur.bgOpacity
    };
    ApplyThemeState(next, true);
    AppendConsoleLogEntry(`[THEME] Loaded local background picture: ${next.bgImageName}`);
}

window.ResetThemeToDefaults = function() {
    if (!ConfirmDestructiveAction('Reset all theme colors and clear custom background picture back to CoreWatch Classic defaults?')) return;
    ApplyThemeState({ ...CW_THEME_DEFAULTS }, true);
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'CLEAR_THEME_BG_IMAGE' }));
    SetDomText('lblThemeSaveState', 'Reset to Classic ✓');
};

window.ExportThemePreset = function() {
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'THEME_EXPORT', theme: window._cwThemeState }));
};

window.ImportThemePreset = function() {
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'THEME_IMPORT' }));
};

function HandleThemeImported(data) {
    if (!data || !data.ok || !data.theme) {
        SetDomText('lblThemeSaveState', data?.message || 'Import failed');
        return;
    }
    // Preserve currently loaded local wallpaper if imported JSON didn't include one
    const merged = {
        ...window._cwThemeState,
        ...data.theme,
        bgImageFile: window._cwThemeState.bgImageFile,
        bgImageName: window._cwThemeState.bgImageName,
        bgImageUrl:  window._cwThemeState.bgImageUrl
    };
    ApplyThemeState(merged, true);
    SetDomText('lblThemeSaveState', 'Imported ✓');
    if (data.message) AppendConsoleLogEntry(`[THEME] ${data.message}`);
}

function HandleThemeNotice(data) {
    if (data?.message) {
        SetDomText('lblThemeSaveState', data.ok ? 'Exported ✓' : 'Error');
        AppendConsoleLogEntry(`[THEME] ${data.message}`);
    }
}

function ClampThemeStudioIntoViewport() {
    const pop = document.getElementById('themeStudioPopup');
    if (!pop || pop.style.display === 'none') return;
    if (!pop.style.left) return;
    const rect = pop.getBoundingClientRect();
    const maxL = Math.max(8, window.innerWidth - rect.width - 8);
    const maxT = Math.max(8, window.innerHeight - 44);
    const curL = parseFloat(pop.style.left) || rect.left;
    const curT = parseFloat(pop.style.top) || rect.top;
    pop.style.left = `${Math.max(8, Math.min(maxL, curL))}px`;
    pop.style.top  = `${Math.max(8, Math.min(maxT, curT))}px`;
}

function InitThemeStudioDrag() {
    const pop = document.getElementById('themeStudioPopup');
    const hdr = document.getElementById('themeStudioHeader');
    if (!pop || !hdr || hdr._dragBound) return;
    hdr._dragBound = true;

    let dragging = false;
    let startX = 0, startY = 0, origL = 0, origT = 0;

    hdr.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (e.target.closest('button')) return;
        e.preventDefault();
        e.stopPropagation();
        const rect = pop.getBoundingClientRect();
        pop.style.right = 'auto';
        pop.style.left  = `${rect.left}px`;
        pop.style.top   = `${rect.top}px`;
        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        origL = rect.left;
        origT = rect.top;
    });

    window.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const rect = pop.getBoundingClientRect();
        const maxL = Math.max(8, window.innerWidth - rect.width - 8);
        const maxT = Math.max(8, window.innerHeight - 44);
        const nextL = Math.max(8, Math.min(maxL, origL + (e.clientX - startX)));
        const nextT = Math.max(8, Math.min(maxT, origT + (e.clientY - startY)));
        pop.style.left = `${nextL}px`;
        pop.style.top  = `${nextT}px`;
    });

    window.addEventListener('mouseup', () => { dragging = false; });
    window.addEventListener('resize', () => { ClampThemeStudioIntoViewport(); });
}

// =========================================================================
// OPS & GUARD DROPDOWN CONTROLLER
// =========================================================================
window.ToggleOpsGuardMenu = function(e) {
    if (e) e.stopPropagation();
    const drop = document.getElementById('navOpsDropdown');
    const trig = document.getElementById('tabOpsMenu');
    ['navSystemDropdown', 'navDevDropdown', 'navModePillDropdown'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.remove('open');
    });
    if (!drop) return;
    const willOpen = !drop.classList.contains('open');
    drop.classList.toggle('open', willOpen);
    if (trig) trig.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    if (willOpen && typeof ClampNavDropdownMenu === 'function') {
        ClampNavDropdownMenu(document.getElementById('navOpsMenu'));
    }
};

window.SelectOpsGuardMenuView = function(viewKey) {
    const drop = document.getElementById('navOpsDropdown');
    const trig = document.getElementById('tabOpsMenu');
    if (drop) drop.classList.remove('open');
    if (trig) trig.setAttribute('aria-expanded', 'false');
    SwitchAppLayoutView(viewKey);
};

document.addEventListener('click', (e) => {
    const drop = document.getElementById('navOpsDropdown');
    if (drop && drop.classList.contains('open') && !drop.contains(e.target)) {
        drop.classList.remove('open');
        const trig = document.getElementById('tabOpsMenu');
        if (trig) trig.setAttribute('aria-expanded', 'false');
    }
});

// =========================================================================
// 1. SMART ALERTS & WATCHDOG CONTROLLER
// =========================================================================
window._alertsState = null;

function SetAlertsStatus(msg, isErr = false) {
    const el = document.getElementById('alertsStatus');
    if (el && msg) { el.classList.toggle('sharing-error', !!isErr); el.textContent = msg; }
    if (msg) AppendConsoleLogEntry(`[ALERTS] ${msg}`);
}

window.RequestSmartAlertsState = function() {
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'ALERTS_LOAD' }));
};

window.TriggerToggleAlertsMute = function() {
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'ALERTS_TOGGLE_MUTE', muted: !(window._alertsState?.muted) }));
};

window.TriggerTestAlertToast = function() {
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'ALERTS_TEST_TOAST' }));
};

window.TriggerAckAllAlerts = function() {
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'ALERTS_ACK_ALL' }));
};

window.TriggerClearAlertHistory = function() {
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'ALERTS_CLEAR_HISTORY' }));
};

window.TriggerResetDefaultAlerts = function() {
    if (!ConfirmDestructiveAction('Reset Smart Alerts back to the 6 default watchdog rules?')) return;
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'ALERTS_RESET_DEFAULTS' }));
};

window.TriggerToggleAlertRule = function(ruleId, enabled) {
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'ALERTS_TOGGLE_RULE', ruleId, enabled }));
};

window.TriggerDeleteAlertRule = function(ruleId) {
    if (!ConfirmDestructiveAction('Delete this watchdog rule?')) return;
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'ALERTS_DELETE_RULE', ruleId }));
};

window.ToggleAlertRuleEditor = function(show, editRuleId = null) {
    const card = document.getElementById('alertRuleEditorCard');
    if (!card) return;
    if (!show) {
        card.style.display = 'none';
        return;
    }
    const existing = editRuleId ? (window._alertsState?.rules || []).find(r => r.id === editRuleId) : null;
    SetDomText('lblAlertEditorTitle', existing ? `✏️ Edit Watchdog Rule — ${existing.name}` : '➕ Add Watchdog Rule');
    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    setVal('inpAlertId', existing ? existing.id : '');
    setVal('inpAlertName', existing ? existing.name : '');
    setVal('selAlertMetric', existing ? existing.metric : 'cpu_temp');
    setVal('selAlertOperator', existing ? existing.operator : 'gt');
    setVal('inpAlertThreshold', existing ? existing.threshold : 85);
    setVal('inpAlertDuration', existing ? existing.durationSec : 30);
    setVal('inpAlertCooldown', existing ? existing.cooldownMin : 5);
    setVal('selAlertSeverity', existing ? (existing.severity || 'warning') : 'warning');
    setVal('selAlertAction', existing ? (existing.action || 'toast') : 'toast');
    setVal('inpAlertTarget', existing ? (existing.target || '') : '');
    card.style.display = 'flex';
    document.getElementById('inpAlertName')?.focus();
};

window.SyncAlertEditorMetricDefaults = function() {
    const m = document.getElementById('selAlertMetric')?.value || 'cpu_temp';
    const opEl = document.getElementById('selAlertOperator');
    const thEl = document.getElementById('inpAlertThreshold');
    const tgtEl = document.getElementById('inpAlertTarget');
    if (m === 'drive_free_pct') {
        if (opEl) opEl.value = 'lt';
        if (thEl && !document.getElementById('inpAlertId')?.value) thEl.value = 10;
        if (tgtEl && !tgtEl.value) tgtEl.placeholder = 'ANY or C: or D:';
    } else if (m === 'internet_status' || m === 'service_stopped') {
        if (opEl) opEl.value = 'eq';
        if (thEl && !document.getElementById('inpAlertId')?.value) thEl.value = m === 'internet_status' ? 0 : 1;
        if (tgtEl) tgtEl.placeholder = m === 'service_stopped' ? 'Dhcp,Dnscache,EventLog' : '(unused)';
    } else {
        if (opEl) opEl.value = 'gt';
        if (tgtEl) tgtEl.placeholder = '(unused)';
    }
};

window.TriggerSaveAlertRule = function() {
    const id = (document.getElementById('inpAlertId')?.value || '').trim();
    const name = (document.getElementById('inpAlertName')?.value || '').trim();
    const metric = document.getElementById('selAlertMetric')?.value || 'cpu_temp';
    const operator = document.getElementById('selAlertOperator')?.value || (metric === 'drive_free_pct' ? 'lt' : 'gt');
    const threshold = Number(document.getElementById('inpAlertThreshold')?.value ?? 85);
    const durationSec = Number(document.getElementById('inpAlertDuration')?.value ?? 30);
    const cooldownMin = Number(document.getElementById('inpAlertCooldown')?.value ?? 5);
    const severity = document.getElementById('selAlertSeverity')?.value || 'warning';
    const action = document.getElementById('selAlertAction')?.value || 'toast';
    const target = (document.getElementById('inpAlertTarget')?.value || '').trim();
    const prevRule = id ? (window._alertsState?.rules || []).find(r => r.id === id) : null;
    window.chrome?.webview?.postMessage(JSON.stringify({
        command: 'ALERTS_SAVE_RULE',
        rule: {
            id: id || undefined,
            name: name || `Watch ${metric}`,
            metric,
            operator,
            threshold,
            durationSec,
            cooldownMin,
            severity,
            action,
            target,
            enabled: prevRule ? !!prevRule.enabled : true
        }
    }));
    ToggleAlertRuleEditor(false);
};

function RenderSmartAlertsState(data) {
    if (!data) return;
    window._alertsState = data;
    SetDomText('sumAlertsEnabled', data.enabledCount ?? 0);
    SetDomText('sumAlertsUnacked', data.unackedCount ?? 0);
    SetDomText('sumAlertsState', data.muted ? 'Muted' : 'Active');

    const muteBtn = document.getElementById('btnAlertsMuteToggle');
    if (muteBtn) muteBtn.textContent = data.muted ? '🔊 Unmute' : '🔇 Mute';

    const bell = document.getElementById('btnHeaderAlertsBell');
    const bellCnt = document.getElementById('lblHeaderAlertsCount');
    const unacked = Number(data.unackedCount || 0);
    if (bell) bell.classList.toggle('has-alerts', unacked > 0);
    if (bellCnt) {
        bellCnt.textContent = String(unacked);
        bellCnt.style.display = unacked > 0 ? 'inline-block' : 'none';
    }
    if (data.notice) SetAlertsStatus(data.notice, !!data.noticeError);

    const rulesHost = document.getElementById('alertsRulesList');
    if (rulesHost) {
        const rules = Array.isArray(data.rules) ? data.rules : [];
        rulesHost.innerHTML = rules.length ? rules.map(r => {
            const safeId = String(r.id || '').replace(/'/g, "\\'");
            const opStr = r.operator === 'lt' ? '≤' : (r.operator === 'eq' ? '=' : '≥');
            const sevCls = r.severity === 'critical' ? 'badge-danger' : (r.severity === 'warning' ? 'ver-update' : 'badge-info');
            return `<div class="new-tab-row-item" style="${r.enabled ? '' : 'opacity:0.65;'}">
                <div>
                    <span class="sharing-badge ${sevCls}">${EscapeHtmlTp(r.severity || 'warning')}</span>
                    <strong>${EscapeHtmlTp(r.name)}</strong>
                    <div class="dev-repo-meta">${EscapeHtmlTp(r.metric)} ${opStr} ${r.threshold}${r.target ? ' · ' + EscapeHtmlTp(r.target) : ''} · ${r.durationSec}s hold · ${r.cooldownMin}m cooldown · ${EscapeHtmlTp(r.action)}</div>
                </div>
                <div style="display:flex; gap:5px; align-items:center; flex-shrink:0;">
                    <label class="org-checkbox-label"><input type="checkbox" ${r.enabled ? 'checked' : ''} onchange="TriggerToggleAlertRule('${safeId}', this.checked)"><span>On</span></label>
                    <button type="button" class="console-clear-btn" onclick="ToggleAlertRuleEditor(true, '${safeId}')" title="Edit rule thresholds and action">✏️</button>
                    ${r.isBuiltIn ? '' : `<button type="button" class="console-clear-btn wsl-btn-danger" onclick="TriggerDeleteAlertRule('${safeId}')" title="Delete custom rule">✕</button>`}
                </div>
            </div>`;
        }).join('') : '<div class="driver-text-node">No watchdog rules configured. Click "➕ New Rule" above.</div>';
    }

    const histHost = document.getElementById('alertsHistoryList');
    if (histHost) {
        const hist = Array.isArray(data.history) ? data.history : [];
        histHost.innerHTML = hist.length ? hist.map(h => {
            const sevCls = h.severity === 'critical' ? 'badge-danger' : (h.severity === 'warning' ? 'ver-update' : 'badge-info');
            return `<div class="new-tab-row-item">
                <div>
                    <span class="sharing-badge ${sevCls}">${EscapeHtmlTp(h.severity || 'info')}</span>
                    <strong>${EscapeHtmlTp(h.ruleName)}</strong>
                    <div class="dev-repo-meta">${EscapeHtmlTp(h.message)}</div>
                </div>
                <span class="cw-settings-sub">${EscapeHtmlTp(h.timestamp || '')}</span>
            </div>`;
        }).join('') : '<div class="driver-text-node">No alerts triggered yet. Click "🧪 Test Toast" to verify notifications.</div>';
    }
}

// =========================================================================
// 2. UNIFIED UPDATE CENTER CONTROLLER
// =========================================================================
window._updatesLoaded = false;
window._updatesState = null;

function SetUpdateCenterStatus(msg, isErr = false) {
    const el = document.getElementById('updateCenterStatus');
    if (el && msg) { el.classList.toggle('sharing-error', !!isErr); el.textContent = msg; }
    if (msg) AppendConsoleLogEntry(`[UPDATES] ${msg}`);
}

window.RequestUpdateCenterState = function(onlineWu = false) {
    SetUpdateCenterStatus(onlineWu ? 'Running deep online Windows Update + WinGet + Runtime scan...' : 'Scanning WinGet, Windows Updates, PowerShell & CoreWatch...');
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'UPDATES_LOAD', onlineWindowsUpdate: !!onlineWu, forcePsCheck: !!onlineWu }));
};

window.TriggerToggleUpdatePin = function(packageId) {
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'UPDATES_TOGGLE_PIN', packageId }));
};

window.ToggleSelectAllUpdates = function(checked) {
    document.querySelectorAll('#updWinGetList input.upd-pkg-chk:not(:disabled)').forEach(c => { c.checked = !!checked; });
};

window.TriggerUpgradeSelectedWinGet = function() {
    const ids = Array.from(document.querySelectorAll('#updWinGetList input.upd-pkg-chk:checked')).map(c => c.value);
    if (!ids.length) { SetUpdateCenterStatus('Select at least one WinGet package to upgrade.', true); return; }
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'UPDATES_RUN_WINGET_BATCH', packageIds: ids }));
};

window.TriggerOpenWindowsUpdateSettings = function() {
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'UPDATES_OPEN_WINUPDATE' }));
};

window.RenderUpdateWinGetList = function() {
    const wgHost = document.getElementById('updWinGetList');
    const data = window._updatesState;
    if (!wgHost || !data) return;
    const q = (document.getElementById('inpUpdSearch')?.value || '').trim().toLowerCase();
    const hidePinned = !!document.getElementById('chkUpdHidePinned')?.checked;
    const allItems = data.winget?.items || [];
    const items = allItems.filter(it => {
        if (hidePinned && it.pinned) return false;
        if (!q) return true;
        return `${it.name || ''} ${it.id || ''} ${it.installed || ''} ${it.available || ''}`.toLowerCase().includes(q);
    });
    wgHost.innerHTML = items.length ? items.map(it => {
        const safeId = String(it.id || '').replace(/'/g, "\\'");
        return `<div class="new-tab-row-item" style="${it.pinned ? 'opacity:0.6;' : ''}">
            <label class="org-checkbox-label" style="flex:1 1 auto;">
                <input type="checkbox" class="upd-pkg-chk" value="${EscapeHtmlTp(it.id)}" ${it.pinned ? 'disabled' : 'checked'}>
                <span><strong>${EscapeHtmlTp(it.name)}</strong> <span class="dev-repo-meta">(${EscapeHtmlTp(it.id)}) · ${EscapeHtmlTp(it.installed)} → <strong>${EscapeHtmlTp(it.available)}</strong></span></span>
            </label>
            <button type="button" class="console-clear-btn" onclick="TriggerToggleUpdatePin('${safeId}')" title="Pin/Ignore this package from batch upgrades">${it.pinned ? '📌 Unpin' : '📌 Pin'}</button>
        </div>`;
    }).join('') : `<div class="driver-text-node">${allItems.length ? 'No packages match your current filter.' : EscapeHtmlTp(data.winget?.error || 'All WinGet packages are up to date!')}</div>`;
};

function RenderUpdateCenterState(data) {
    if (!data) return;
    window._updatesLoaded = true;
    window._updatesState = data;
    const sum = data.summary || {};
    SetDomText('sumUpdWinget', sum.wingetPending ?? 0);
    SetDomText('sumUpdPinned', sum.wingetPinned ?? 0);
    SetDomText('sumUpdWin', sum.windowsCount ?? 0);
    SetDomText('sumUpdPs', sum.psMissed > 0 ? `${sum.psMissed} behind` : 'Up to date');
    SetDomText('sumUpdCw', sum.cwHasUpdate ? 'Update Avail' : 'Up to date');
    SetUpdateCenterStatus(data.notice || `Unified scan completed at ${data.scannedAt || '--'}.`, !!data.noticeError);

    RenderUpdateWinGetList();

    const wuHost = document.getElementById('updWindowsList');
    if (wuHost) {
        const items = data.windowsUpdates?.items || [];
        wuHost.innerHTML = items.length ? items.map(u => `<div class="new-tab-row-item">
            <div><strong>${EscapeHtmlTp(u.title)}</strong><div class="dev-repo-meta">${EscapeHtmlTp(u.kb || 'OS Update')} · ${u.sizeMB} MB${u.rebootReq ? ' · Reboot Req' : ''}</div></div>
            <span class="sharing-badge ${u.isMandatory ? 'ver-update' : 'badge-info'}">${EscapeHtmlTp(u.category || 'Update')}</span>
        </div>`).join('') : '<div class="driver-text-node">No pending cached Windows Updates found. Click "🌐 Deep Online Scan" to check Microsoft Update servers.</div>';
    }

    const rtHost = document.getElementById('updRuntimeCard');
    if (rtHost) {
        const ps = data.powershell || {};
        const cw = data.corewatch || {};
        const devRts = Array.isArray(data.devRuntimes) ? data.devRuntimes : [];
        const safeUrl = String(cw.releaseUrl || '').replace(/'/g, "\\'");
        const safePsVer = String(ps.current || '').replace(/'/g, "\\'");
        const safePsLat = String(ps.latest || '').replace(/'/g, "\\'");
        const safePsChan = String(ps.channel || 'msi').replace(/'/g, "\\'");
        const psBtnHtml = ps.missed > 0
            ? `<button type="button" class="console-clear-btn btn-accent-action" onclick="TriggerPowerShellUpdateToggle('${safePsVer}','${safePsLat}',${Number(ps.missed||0)},true,'${safePsChan}')">⬆️ Update PS</button>`
            : '<span class="sharing-badge ver-uptodate">Current</span>';
        const devChips = devRts.length
            ? `<div class="runtime-chip-grid">${devRts.map(r => `<span class="runtime-chip" title="${EscapeHtmlTp(r.path || '')}">${EscapeHtmlTp(r.name)}: <strong>${EscapeHtmlTp(r.version)}</strong></span>`).join('')}</div>`
            : '';
        rtHost.innerHTML = `
            <div class="new-tab-row-item">
                <div><strong>PowerShell ${EscapeHtmlTp(ps.current || '--')} (${EscapeHtmlTp(ps.channel || 'msi')})</strong><div class="dev-repo-meta">${EscapeHtmlTp(ps.detail || '')}</div></div>
                ${psBtnHtml}
            </div>
            <div class="new-tab-row-item">
                <div><strong>CoreWatch v${EscapeHtmlTp(cw.currentVersion || '--')}</strong><div class="dev-repo-meta">${EscapeHtmlTp(cw.message || '')}</div></div>
                ${cw.hasUpdate && safeUrl ? `<button type="button" class="console-clear-btn btn-accent-action" onclick="OpenExternalHttpsUrl('${safeUrl}')">Download ↗</button>` : '<span class="sharing-badge ver-uptodate">Current</span>'}
            </div>
            ${devChips}`;
    }
}

// =========================================================================
// 3. SYSTEM SNAPSHOTS & DIFF CONTROLLER
// =========================================================================
window._snapLastDiff = null;
window._snapDiffFilterKind = 'all';

function SetSnapshotsStatus(msg, isErr = false) {
    const el = document.getElementById('snapshotsStatus');
    if (el && msg) { el.classList.toggle('sharing-error', !!isErr); el.textContent = msg; }
    if (msg) AppendConsoleLogEntry(`[SNAPSHOTS] ${msg}`);
}

window.RequestSnapshotsState = function() {
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'SNAP_LOAD' }));
};

window.TriggerCreateSnapshot = function() {
    const name = (document.getElementById('inpSnapName')?.value || '').trim();
    const notes = (document.getElementById('inpSnapNotes')?.value || '').trim();
    const createRestorePoint = !!document.getElementById('chkSnapRestorePoint')?.checked;
    SetSnapshotsStatus('Capturing system snapshot (apps, startup, services, drivers, hosts, network)...');
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'SNAP_CREATE', name, notes, createRestorePoint }));
    const inp = document.getElementById('inpSnapName');
    if (inp) inp.value = '';
    const nInp = document.getElementById('inpSnapNotes');
    if (nInp) nInp.value = '';
};

window.TriggerCompareSnapshots = function() {
    const beforeId = document.getElementById('selSnapBefore')?.value || '';
    const afterId  = document.getElementById('selSnapAfter')?.value || 'LIVE';
    if (!beforeId) { SetSnapshotsStatus('Capture at least one snapshot first to compare.', true); return; }
    SetSnapshotsStatus('Computing Before vs. After system diff...');
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'SNAP_DIFF', beforeId, afterId }));
};

window.TriggerExportSnapshotDiff = function() {
    if (!window._snapLastDiff) return;
    window.chrome?.webview?.postMessage(JSON.stringify({
        command: 'SNAP_EXPORT_DIFF',
        beforeLabel: window._snapLastDiff.beforeLabel || 'Before',
        afterLabel: window._snapLastDiff.afterLabel || 'After',
        categories: window._snapLastDiff.categories || []
    }));
};

window.SetSnapDiffFilterKind = function(kind) {
    window._snapDiffFilterKind = kind || 'all';
    document.querySelectorAll('#snapDiffKindPills .filter-pill').forEach(b => b.classList.toggle('active', b.dataset.kind === window._snapDiffFilterKind));
    RenderCurrentSnapDiff();
};

window.TriggerDeleteSnapshot = function(snapshotId) {
    if (!ConfirmDestructiveAction('Delete this saved system snapshot?')) return;
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'SNAP_DELETE', snapshotId }));
};

window.TriggerOpenWindowsRestoreUi = function() {
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'SNAP_OPEN_RESTORE_UI' }));
};

function RenderSnapshotsState(data) {
    if (!data) return;
    if (data.notice) SetSnapshotsStatus(data.notice, !!data.noticeError);
    const list = Array.isArray(data.snapshots) ? data.snapshots : [];

    SetDomText('sumSnapTotal', list.length);
    SetDomText('sumSnapRp', data.restorePointCount ?? list.filter(s => s.restorePoint).length);
    SetDomText('sumSnapSize', `${data.totalSizeKB ?? 0} KB`);
    SetDomText('sumSnapLatest', data.latestCreatedAt || (list[0]?.createdAt || 'None yet'));

    const selB = document.getElementById('selSnapBefore');
    const selA = document.getElementById('selSnapAfter');
    if (selB) {
        selB.innerHTML = list.length
            ? list.map(s => `<option value="${EscapeHtmlTp(s.id)}">${EscapeHtmlTp(s.name)} (${EscapeHtmlTp(s.createdAt)})</option>`).join('')
            : '<option value="">No snapshots saved yet</option>';
    }
    if (selA) {
        selA.innerHTML = `<option value="LIVE">⚡ Live Current PC State</option>` +
            list.map(s => `<option value="${EscapeHtmlTp(s.id)}">${EscapeHtmlTp(s.name)} (${EscapeHtmlTp(s.createdAt)})</option>`).join('');
    }

    const host = document.getElementById('snapshotsList');
    if (host) {
        host.innerHTML = list.length ? list.map(s => {
            const safeId = String(s.id || '').replace(/'/g, "\\'");
            const c = s.counts || {};
            return `<article class="dev-repo-card">
                <div class="dev-repo-head">
                    <span class="dev-repo-name">📸 ${EscapeHtmlTp(s.name)}</span>
                    ${s.restorePoint ? '<span class="sharing-badge ver-uptodate">+Restore Pt</span>' : ''}
                </div>
                <div class="dev-repo-meta">${EscapeHtmlTp(s.createdAt)} · ${s.sizeKB} KB</div>
                <div class="dev-repo-meta">Apps: ${c.apps||0} · Startup: ${c.startup||0} · Svcs: ${c.services||0} · Drivers: ${c.drivers||0}</div>
                ${s.notes ? `<div class="profile-card-desc">${EscapeHtmlTp(s.notes)}</div>` : ''}
                <div class="dev-repo-actions">
                    <button type="button" class="btn-vscode" onclick="document.getElementById('selSnapBefore').value='${safeId}'; document.getElementById('selSnapAfter').value='LIVE'; TriggerCompareSnapshots()">🔍 Diff vs Live PC</button>
                    <button type="button" class="wsl-btn-danger" onclick="TriggerDeleteSnapshot('${safeId}')">🗑️ Delete</button>
                </div>
            </article>`;
        }).join('') : '<div class="driver-text-node">No snapshots saved yet. Click "📸 Capture Snapshot" above to save a baseline.</div>';
    }
}

window.RenderCurrentSnapDiff = function() {
    const data = window._snapLastDiff;
    const host = document.getElementById('snapDiffOutput');
    if (!data || !host) return;
    const kind = window._snapDiffFilterKind || 'all';
    const q = (document.getElementById('inpSnapDiffSearch')?.value || '').trim().toLowerCase();
    const matchText = (t) => !q || String(t || '').toLowerCase().includes(q);

    const blocks = [];
    (data.categories || []).forEach(c => {
        const adds = (kind === 'all' || kind === 'added') ? (c.added || []).filter(x => matchText(`${x.key} ${x.value}`)) : [];
        const rems = (kind === 'all' || kind === 'removed') ? (c.removed || []).filter(x => matchText(`${x.key} ${x.value}`)) : [];
        const mods = (kind === 'all' || kind === 'modified') ? (c.modified || []).filter(x => matchText(`${x.key} ${x.before} ${x.after}`)) : [];
        const shown = adds.length + rems.length + mods.length;
        if (!shown) return;
        const addHtml = adds.map(x => `<div class="new-tab-row-item snap-diff-add"><span><strong>➕ ${EscapeHtmlTp(x.key)}</strong></span><span class="dev-repo-meta">${EscapeHtmlTp(x.value)}</span></div>`).join('');
        const remHtml = rems.map(x => `<div class="new-tab-row-item snap-diff-rem"><span><strong>➖ ${EscapeHtmlTp(x.key)}</strong></span><span class="dev-repo-meta">${EscapeHtmlTp(x.value)}</span></div>`).join('');
        const modHtml = mods.map(x => `<div class="new-tab-row-item snap-diff-mod"><div><strong>✏️ ${EscapeHtmlTp(x.key)}</strong><div class="dev-repo-meta">Before: ${EscapeHtmlTp(x.before)} → After: ${EscapeHtmlTp(x.after)}</div></div></div>`).join('');
        blocks.push(`<div class="cw-set-card"><div class="cw-set-sec-title">${EscapeHtmlTp(c.category)} (${shown} change${shown===1?'':'s'})</div><div class="new-tab-stack">${addHtml}${remHtml}${modHtml}</div></div>`);
    });

    if (!blocks.length) {
        host.innerHTML = `<div class="new-tab-row-item"><strong>${data.totalChanges > 0 ? 'No changes match your filter' : '✓ Zero differences detected'}</strong><span class="cw-settings-sub">${EscapeHtmlTp(data.beforeLabel)} vs ${EscapeHtmlTp(data.afterLabel)}</span></div>`;
        return;
    }
    host.innerHTML = blocks.join('');
};

function RenderSnapshotsDiffResult(data) {
    if (!data) return;
    window._snapLastDiff = data;
    SetSnapshotsStatus(data.notice || 'Diff complete.', !data.ok);
    const expBtn = document.getElementById('btnSnapExportDiff');
    if (expBtn) expBtn.style.display = 'inline-flex';
    const fBar = document.getElementById('snapDiffFilterBar');
    if (fBar) fBar.style.display = data.totalChanges > 0 ? 'flex' : 'none';
    RenderCurrentSnapDiff();
}

// =========================================================================
// 4. BATTERY HEALTH & WIRELESS PERIPHERALS CONTROLLER
// =========================================================================
function SetBatteryStatus(msg, isErr = false) {
    const el = document.getElementById('batteryStatus');
    if (el && msg) { el.classList.toggle('sharing-error', !!isErr); el.textContent = msg; }
    if (msg) AppendConsoleLogEntry(`[BATTERY] ${msg}`);
}

window.RequestBatteryState = function() {
    SetBatteryStatus('Scanning internal batteries and Bluetooth peripherals...');
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'BATTERY_LOAD' }));
};

window.TriggerOpenBatteryReport = function() {
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'BATTERY_OPEN_REPORT' }));
};

window.TriggerOpenSleepStudy = function() {
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'BATTERY_OPEN_SLEEPSTUDY' }));
};

window.TriggerOpenBluetoothSettings = function() {
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'BATTERY_OPEN_BT_SETTINGS' }));
};

window.TriggerOpenPowerSettings = function() {
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'BATTERY_OPEN_POWER_SETTINGS' }));
};

function RenderBatteryPeripheralsState(data) {
    if (!data) return;
    SetDomText('sumBatPowerPlan', data.activePowerPlan || '--');
    SetDomText('sumBatInternal', (data.batteries || []).length);
    SetDomText('sumBatPeripherals', (data.peripherals || []).length);
    SetDomText('sumBatLow', data.lowPeripheralCount ?? 0);
    SetBatteryStatus(data.notice || `Battery & peripheral telemetry refreshed at ${data.scannedAt || '--'}.`, !!data.noticeError);

    const intHost = document.getElementById('batteryInternalGrid');
    if (intHost) {
        const bats = data.batteries || [];
        intHost.innerHTML = bats.length ? bats.map(b => `<article class="dev-repo-card">
            <div class="dev-repo-head"><span class="dev-repo-name">🔋 ${EscapeHtmlTp(b.name)} (${EscapeHtmlTp(b.chemistry)})</span><span class="sharing-badge ${b.chargePct <= 20 ? 'badge-danger' : 'ver-uptodate'}">${b.chargePct}% · ${EscapeHtmlTp(b.state)}</span></div>
            <div class="track-bg"><div class="track-fill" style="width:${b.chargePct}%;"></div></div>
            <div class="dev-repo-meta">Health: <strong>${b.healthPct > 0 ? b.healthPct + '%' : 'N/A'}</strong> (Wear: ${b.wearPct}%) · Cycles: ${b.cycleCount >= 0 ? b.cycleCount : 'N/A'}</div>
            <div class="dev-repo-meta">Design: ${b.designMwh} mWh · Full Charge: ${b.fullMwh} mWh${b.rateMw ? ` · Rate: ${b.rateMw} mW` : ''}</div>
        </article>`).join('') : '<div class="driver-text-node">Desktop / AC Power Only — No internal laptop battery detected. Wireless Bluetooth devices are monitored below.</div>';
    }

    const perHost = document.getElementById('batteryPeripheralsGrid');
    if (perHost) {
        const list = data.peripherals || [];
        perHost.innerHTML = list.length ? list.map(p => `<article class="dev-repo-card">
            <div class="dev-repo-head"><span class="dev-repo-name">🎧 ${EscapeHtmlTp(p.name)}</span><span class="sharing-badge ${p.lowBattery ? 'badge-danger' : 'ver-uptodate'}">${p.batteryPct}%</span></div>
            <div class="track-bg"><div class="track-fill" style="width:${p.batteryPct}%;"></div></div>
            <div class="dev-repo-meta">Type: ${EscapeHtmlTp(p.kind)} · Status: ${EscapeHtmlTp(p.status)}${p.lowBattery ? ' · ⚠️ Low Battery!' : ''}</div>
        </article>`).join('') : '<div class="driver-text-node">No Bluetooth peripherals reporting Windows battery telemetry (DEVPKEY_Bluetooth_Battery) right now.</div>';
    }
}

// =========================================================================
// 5. BACKUP & FOLDER SYNC CONTROLLER
// =========================================================================
window._backupState = null;

function SetBackupStatus(msg, isErr = false) {
    const el = document.getElementById('backupSyncStatus');
    if (el && msg) { el.classList.toggle('sharing-error', !!isErr); el.textContent = msg; }
    if (msg) AppendConsoleLogEntry(`[BACKUP] ${msg}`);
}

window.ToggleBackupJobEditor = function(show, editJobId = null) {
    const card = document.getElementById('backupJobEditorCard');
    if (!card) return;
    if (!show) { card.style.display = 'none'; return; }
    const existing = editJobId ? (window._backupState?.jobs || []).find(j => j.id === editJobId) : null;
    SetDomText('lblBkpEditorTitle', existing ? `✏️ Edit Sync Job — ${existing.name}` : '➕ Create Sync Job');
    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    setVal('inpBkpId', existing ? existing.id : '');
    setVal('inpBkpName', existing ? existing.name : '');
    setVal('selBkpMode', existing ? (existing.mode || 'incremental') : 'incremental');
    setVal('selBkpSchedule', existing ? (existing.schedule || 'manual') : 'manual');
    setVal('inpBkpSource', existing ? (existing.source || '') : '');
    setVal('inpBkpDest', existing ? (existing.destination || '') : '');
    setVal('inpBkpExDirs', existing ? (existing.excludeDirs ?? '') : 'node_modules,.git,target,bin,obj,$RECYCLE.BIN,System Volume Information');
    setVal('inpBkpExFiles', existing ? (existing.excludeFiles ?? '') : '*.tmp,Thumbs.db,desktop.ini');
    card.style.display = 'flex';
    document.getElementById('inpBkpName')?.focus();
};

window.ApplyBackupExcludePreset = function(preset) {
    const inp = document.getElementById('inpBkpExDirs');
    if (!inp) return;
    if (preset === 'dev') inp.value = 'node_modules,.git,target,bin,obj,.venv,dist,build,$RECYCLE.BIN,System Volume Information';
    else if (preset === 'media') inp.value = 'Cache,Media Cache,Previews,Proxy,Temp,$RECYCLE.BIN';
    else inp.value = '';
};

window.BrowseBackupFolder = function(targetKey) {
    window.chrome?.webview?.postMessage(`Browse-Folder:${targetKey}`);
};

window.RequestBackupSyncState = function() {
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'BACKUP_LOAD' }));
};

window.TriggerSaveBackupJob = function() {
    const id = (document.getElementById('inpBkpId')?.value || '').trim();
    const prev = id ? (window._backupState?.jobs || []).find(j => j.id === id) : null;
    const job = {
        id: id || undefined,
        name: (document.getElementById('inpBkpName')?.value || '').trim(),
        source: (document.getElementById('inpBkpSource')?.value || '').trim(),
        destination: (document.getElementById('inpBkpDest')?.value || '').trim(),
        mode: document.getElementById('selBkpMode')?.value || 'incremental',
        schedule: document.getElementById('selBkpSchedule')?.value || 'manual',
        excludeDirs: (document.getElementById('inpBkpExDirs')?.value || '').trim(),
        excludeFiles: (document.getElementById('inpBkpExFiles')?.value || '').trim(),
        lastRun: prev?.lastRun || '',
        lastStatus: prev?.lastStatus || 'Never run'
    };
    if (!job.source || !job.destination) { SetBackupStatus('Select both Source and Destination folders first.', true); return; }
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'BACKUP_SAVE_JOB', job }));
    ToggleBackupJobEditor(false);
};

window.TriggerBackupDryRun = function(jobId) {
    SetBackupStatus('Running robocopy Dry-Run preview (/L)...');
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'BACKUP_DRY_RUN', jobId }));
};

window.TriggerBackupRun = function(jobId, mode) {
    if (mode === 'mirror' && !ConfirmDestructiveAction('Mirror mode (/MIR) deletes files in Destination that no longer exist in Source. Proceed?')) return;
    SetBackupStatus('Running robocopy folder sync...');
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'BACKUP_RUN_JOB', jobId }));
};

window.TriggerOpenBackupFolder = function(path) {
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'BACKUP_OPEN_FOLDER', path }));
};

window.TriggerDeleteBackupJob = function(jobId) {
    if (!ConfirmDestructiveAction('Delete this saved backup job and any scheduled Windows task?')) return;
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'BACKUP_DELETE_JOB', jobId }));
};

function RenderBackupSyncState(data) {
    if (!data) return;
    window._backupState = data;
    const jobs = data.jobs || [];
    const list = data.history || [];
    SetDomText('sumBkpJobs', jobs.length);
    SetDomText('sumBkpScheduled', data.scheduledCount ?? jobs.filter(j => j.schedule && j.schedule !== 'manual').length);
    SetDomText('sumBkpRuns', data.totalRuns ?? list.length);
    SetDomText('sumBkpLast', data.lastRunSummary || (list[0] ? `${list[0].jobName} · ${list[0].timestamp}` : 'Never run'));
    if (data.notice) SetBackupStatus(data.notice, !!data.noticeError);

    const grid = document.getElementById('backupJobsGrid');
    if (grid) {
        grid.innerHTML = jobs.length ? jobs.map(j => {
            const safeId = String(j.id || '').replace(/'/g, "\\'");
            const safeMode = String(j.mode || 'incremental').replace(/'/g, "\\'");
            const safeSrc = String(j.source || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            const safeDst = String(j.destination || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            return `<article class="dev-repo-card">
                <div class="dev-repo-head"><span class="dev-repo-name">💾 ${EscapeHtmlTp(j.name)}</span><div class="card-badge-group"><span class="sharing-badge ${j.mode==='mirror'?'ver-update':'badge-info'}">${EscapeHtmlTp(j.mode)}</span><span class="sharing-badge badge-purple">${EscapeHtmlTp(j.schedule||'manual')}</span></div></div>
                <div class="dev-repo-meta" title="${EscapeHtmlTp(j.source)}">From: ${EscapeHtmlTp(j.source)}</div>
                <div class="dev-repo-meta" title="${EscapeHtmlTp(j.destination)}">To: ${EscapeHtmlTp(j.destination)}</div>
                <div class="dev-repo-meta">Last: ${EscapeHtmlTp(j.lastRun || 'Never')} · ${EscapeHtmlTp(j.lastStatus || '')}</div>
                <div class="dev-repo-actions">
                    <button type="button" onclick="TriggerBackupDryRun('${safeId}')">🔍 Dry-Run</button>
                    <button type="button" class="btn-vscode" onclick="TriggerBackupRun('${safeId}', '${safeMode}')">▶️ Sync</button>
                    <button type="button" onclick="ToggleBackupJobEditor(true, '${safeId}')" title="Edit job settings">✏️ Edit</button>
                    <button type="button" onclick="TriggerOpenBackupFolder('${safeSrc}')" title="Open Source folder">📂 Src</button>
                    <button type="button" onclick="TriggerOpenBackupFolder('${safeDst}')" title="Open Destination folder">📂 Dst</button>
                    <button type="button" class="wsl-btn-danger" onclick="TriggerDeleteBackupJob('${safeId}')">🗑️</button>
                </div>
            </article>`;
        }).join('') : '<div class="driver-text-node">No backup sync jobs saved yet. Click "➕ New Sync Job" above!</div>';
    }
    const hist = document.getElementById('backupHistoryList');
    if (hist) {
        hist.innerHTML = list.length ? list.map(h => `<div class="new-tab-row-item">
            <div><span class="sharing-badge ${h.ok?'ver-uptodate':'badge-danger'}">Exit ${h.exitCode}</span> <strong>${EscapeHtmlTp(h.jobName)}</strong><div class="dev-repo-meta">${EscapeHtmlTp(h.summary)} (${EscapeHtmlTp(h.duration)})</div></div>
            <span class="cw-settings-sub">${EscapeHtmlTp(h.timestamp)}</span>
        </div>`).join('') : '<div class="driver-text-node">No backup runs recorded yet.</div>';
    }
}

function RenderBackupRunOutput(data) {
    if (!data) return;
    SetBackupStatus(data.summary || 'Robocopy finished.', !data.ok);
    const pre = document.getElementById('backupRunOutputBox');
    if (pre) pre.textContent = `${data.summary}\n\n${data.outputText || '(No output)'}`;
    if (data.jobs) RenderBackupSyncState({ jobs: data.jobs, history: data.history || [] });
}

// =========================================================================
// 6. DOCKER / CONTAINERS & LOCAL DEV SERVICES CONTROLLER
// =========================================================================
window._dockerState = null;

function SetDockerStatus(msg, isErr = false) {
    const el = document.getElementById('dockerStatus');
    if (el && msg) { el.classList.toggle('sharing-error', !!isErr); el.textContent = msg; }
    if (msg) AppendConsoleLogEntry(`[DOCKER] ${msg}`);
}

window.RequestDockerState = function() {
    SetDockerStatus('Querying Docker/Podman containers, images & local dev services...');
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'DOCKER_LOAD' }));
};

window.TriggerDockerContainerOp = function(containerId, op) {
    if (op === 'rm' && !ConfirmDestructiveAction(`Force remove container '${containerId}'?`)) return;
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'DOCKER_CONTAINER_ACTION', containerId, op }));
};

window.TriggerDockerRemoveImage = function(imageId, label) {
    if (!ConfirmDestructiveAction(`Remove container image '${label || imageId}'?`)) return;
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'DOCKER_REMOVE_IMAGE', imageId }));
};

window.TriggerDockerLogs = function(containerId, containerName) {
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'DOCKER_CONTAINER_LOGS', containerId, containerName }));
};

window.TriggerDockerShell = function(containerId) {
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'DOCKER_CONTAINER_SHELL', containerId }));
};

window.TriggerDockerPrune = function() {
    if (!ConfirmDestructiveAction('Prune all stopped containers, unused networks, and dangling images?')) return;
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'DOCKER_PRUNE' }));
};

window.TriggerDockerDevServiceOp = function(serviceName, op) {
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'DOCKER_SERVICE_TOGGLE', serviceName, op }));
};

window.JumpDockerPortToTasksPorts = function(portNum) {
    SwitchAppLayoutView('tasksports');
    if (typeof SetTasksPortsSubView === 'function') SetTasksPortsSubView('sockets');
    const srch = document.getElementById('tpSearchInput');
    if (srch) {
        srch.value = String(portNum);
        if (typeof RenderCurrentTasksPortsView === 'function') RenderCurrentTasksPortsView();
    }
};

window.RenderDockerFilteredViews = function() {
    const data = window._dockerState;
    if (!data) return;
    const q = (document.getElementById('inpDockerSearch')?.value || '').trim().toLowerCase();
    const match = (s) => !q || String(s || '').toLowerCase().includes(q);

    const cGrid = document.getElementById('dockerContainersGrid');
    if (cGrid) {
        const list = (data.containers || []).filter(c => match(`${c.name} ${c.image} ${c.ports} ${c.status}`));
        cGrid.innerHTML = list.length ? list.map(c => {
            const sId = String(c.id || '').replace(/'/g, "\\'");
            const sName = String(c.name || '').replace(/'/g, "\\'");
            const portBtns = (c.hostPorts || []).map(p => `<button type="button" class="docker-port-chip" onclick="JumpDockerPortToTasksPorts(${p})" title="Inspect port ${p} in Tasks &amp; Ports">:${p} ↗</button>`).join(' ');
            const statLine = (c.cpuPerc || c.memUsage) ? `<div class="dev-repo-meta">CPU: ${EscapeHtmlTp(c.cpuPerc || '--')} · RAM: ${EscapeHtmlTp(c.memUsage || '--')}</div>` : '';
            return `<article class="dev-repo-card">
                <div class="dev-repo-head"><span class="dev-repo-name">🐳 ${EscapeHtmlTp(c.name)}</span><span class="sharing-badge ${c.state==='running'?'ver-uptodate':'badge-neutral'}">${EscapeHtmlTp(c.state)}</span></div>
                <div class="dev-repo-meta">${EscapeHtmlTp(c.image)} · ${EscapeHtmlTp(c.status)}</div>
                ${statLine}
                ${portBtns ? `<div style="display:flex;gap:4px;flex-wrap:wrap;">${portBtns}</div>` : ''}
                <div class="dev-repo-actions">
                    ${c.state==='running'
                        ? `<button type="button" onclick="TriggerDockerContainerOp('${sId}','stop')">⏹ Stop</button><button type="button" onclick="TriggerDockerContainerOp('${sId}','restart')">🔄 Restart</button><button type="button" class="btn-vscode" onclick="TriggerDockerShell('${sId}')">🐚 Shell</button>`
                        : `<button type="button" class="btn-vscode" onclick="TriggerDockerContainerOp('${sId}','start')">▶️ Start</button>`}
                    <button type="button" onclick="TriggerDockerLogs('${sId}','${sName}')">📜 Logs</button>
                    <button type="button" class="wsl-btn-danger" onclick="TriggerDockerContainerOp('${sId}','rm')">🗑️ Rm</button>
                </div>
            </article>`;
        }).join('') : `<div class="driver-text-node">${q ? 'No containers match your filter.' : (data.engine === 'none' ? (data.engineError || 'No Docker or Podman CLI found on PATH or running WSL. Install Docker Desktop or Podman (or launch your WSL container distro).') : 'No containers found.')}</div>`;
    }

    const imgHost = document.getElementById('dockerImagesList');
    if (imgHost) {
        const imgs = (data.images || []).filter(im => match(`${im.repository}:${im.tag} ${im.id}`));
        imgHost.innerHTML = imgs.length ? imgs.map(im => {
            const safeImgId = String(im.id || '').replace(/'/g, "\\'");
            const safeLbl = `${im.repository}:${im.tag}`.replace(/'/g, "\\'");
            return `<div class="new-tab-row-item">
                <div><strong>${EscapeHtmlTp(im.repository)}:${EscapeHtmlTp(im.tag)}</strong><div class="dev-repo-meta">${EscapeHtmlTp(im.size)} · ${EscapeHtmlTp(im.created)}</div></div>
                <button type="button" class="console-clear-btn wsl-btn-danger" onclick="TriggerDockerRemoveImage('${safeImgId}','${safeLbl}')" title="Remove image">🗑️</button>
            </div>`;
        }).join('') : '<div class="driver-text-node">No container images listed.</div>';
    }

    const svcHost = document.getElementById('dockerDevServicesList');
    if (svcHost) {
        const svcs = (data.devServices || []).filter(s => match(`${s.displayName} ${s.name} ${s.status}`));
        svcHost.innerHTML = svcs.length ? svcs.map(s => {
            const sn = String(s.name || '').replace(/'/g, "\\'");
            const isRun = s.status === 'Running';
            return `<div class="new-tab-row-item">
                <div><strong>${EscapeHtmlTp(s.displayName)}</strong><div class="dev-repo-meta">${EscapeHtmlTp(s.name)} · ${EscapeHtmlTp(s.startType)}</div></div>
                <div style="display:flex;gap:4px;align-items:center;">
                    <span class="sharing-badge ${isRun?'ver-uptodate':'badge-neutral'}">${EscapeHtmlTp(s.status)}</span>
                    <button type="button" class="console-clear-btn" onclick="TriggerDockerDevServiceOp('${sn}','${isRun?'stop':'start'}')">${isRun?'Stop':'Start'}</button>
                </div>
            </div>`;
        }).join('') : '<div class="driver-text-node">No local database/web dev Windows services detected.</div>';
    }
};

function RenderDockerState(data) {
    if (!data) return;
    window._dockerState = data;
    const badge = document.getElementById('lblDockerEngineBadge');
    if (badge) badge.innerHTML = `Engine: <strong>${EscapeHtmlTp(data.engine || 'None')} (${data.daemonRunning ? 'Running' : 'Stopped/Missing'})</strong>`;
    SetDomText('sumDockerRunning', data.runningCount ?? 0);
    SetDomText('sumDockerTotal', (data.containers || []).length);
    SetDomText('sumDockerImages', (data.images || []).length);
    SetDomText('sumDockerDevSvcs', (data.devServices || []).length);
    SetDockerStatus(data.notice || data.engineError || `Loaded ${(data.containers||[]).length} container(s) & ${(data.devServices||[]).length} local dev service(s).`, !!data.noticeError || (!!data.engineError && data.engine !== 'none'));

    const dfStrip = document.getElementById('dockerDiskStrip');
    if (dfStrip) {
        dfStrip.innerHTML = (data.diskUsage || []).map(d => `<span class="summary-chip">${EscapeHtmlTp(d.type)}: <strong>${EscapeHtmlTp(d.size)}</strong> (${EscapeHtmlTp(d.reclaimable)} reclaimable)</span>`).join('');
    }
    RenderDockerFilteredViews();
}

function RenderDockerLogs(data) {
    const card = document.getElementById('dockerLogsCard');
    const pre = document.getElementById('dockerLogsPre');
    if (card) card.style.display = 'flex';
    SetDomText('lblDockerLogsTitle', `📜 Container Logs — ${data.containerName || ''}`);
    if (pre) pre.textContent = data.logs || '(No log output)';
}

// =========================================================================
// 7. SSH HOST LAUNCHER & CERTIFICATE INSPECTOR CONTROLLER
// =========================================================================
window._sshCertsState = null;
window._sshCertFilter = 'all';

function SetSshCertsStatus(msg, isErr = false) {
    const el = document.getElementById('sshCertsStatus');
    if (el && msg) { el.classList.toggle('sharing-error', !!isErr); el.textContent = msg; }
    if (msg) AppendConsoleLogEntry(`[SSH/CERTS] ${msg}`);
}

window.ToggleSshHostEditor = function(show, editAlias = null) {
    const card = document.getElementById('sshHostEditorCard');
    if (!card) return;
    if (!show) { card.style.display = 'none'; return; }
    SetSshSubView('hosts');
    const existing = editAlias ? (window._sshCertsState?.hosts || []).find(h => h.alias === editAlias) : null;
    SetDomText('lblSshHostEditorTitle', existing ? `✏️ Edit SSH Host — ${existing.alias}` : '➕ Add ~/.ssh/config Host');
    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    setVal('inpSshAlias', existing ? existing.alias : '');
    setVal('inpSshHostName', existing ? (existing.hostName || '') : '');
    setVal('inpSshUser', existing ? (existing.user || '') : '');
    setVal('inpSshPort', existing ? (existing.port || '22') : '22');
    setVal('inpSshIdentity', existing ? (existing.identityFile || '') : '');
    setVal('inpSshProxyJump', existing ? (existing.proxyJump || '') : '');
    card.style.display = 'flex';
    document.getElementById('inpSshAlias')?.focus();
};

window.SetSshSubView = function(sub) {
    document.querySelectorAll('#sshSubViewPills .filter-pill').forEach(b => b.classList.toggle('active', b.dataset.sub === sub));
    const map = { hosts: 'sshPaneHosts', keys: 'sshPaneKeys', certs: 'sshPaneCerts' };
    Object.entries(map).forEach(([k, id]) => { const el = document.getElementById(id); if (el) el.classList.toggle('active', k === sub); });
};

window.SetSshCertFilter = function(flt) {
    window._sshCertFilter = flt || 'all';
    document.querySelectorAll('#sshCertFilterPills .filter-pill').forEach(b => b.classList.toggle('active', b.dataset.cfilter === window._sshCertFilter));
    RenderSshCertsList();
};

window.RequestSshCertsState = function() {
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'SSH_LOAD' }));
};

window.TriggerLaunchSshHost = function(alias) {
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'SSH_LAUNCH_HOST', alias }));
};

window.TriggerTestSshHost = function(hostName, port) {
    SetSshCertsStatus(`Testing TCP connectivity to ${hostName}:${port || 22}...`);
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'SSH_TEST_HOST', hostName, port: Number(port || 22) }));
};

window.TriggerSaveSshHost = function() {
    const host = {
        alias: (document.getElementById('inpSshAlias')?.value || '').trim(),
        hostName: (document.getElementById('inpSshHostName')?.value || '').trim(),
        user: (document.getElementById('inpSshUser')?.value || '').trim(),
        port: (document.getElementById('inpSshPort')?.value || '22').trim(),
        identityFile: (document.getElementById('inpSshIdentity')?.value || '').trim(),
        proxyJump: (document.getElementById('inpSshProxyJump')?.value || '').trim()
    };
    if (!host.alias || !host.hostName) { SetSshCertsStatus('Alias and HostName are required.', true); return; }
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'SSH_SAVE_HOST', host }));
    ToggleSshHostEditor(false);
};

window.TriggerDeleteSshHost = function(alias) {
    if (!ConfirmDestructiveAction(`Remove Host '${alias}' from ~/.ssh/config?`)) return;
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'SSH_DELETE_HOST', alias }));
};

window.TriggerGenerateSshKey = function() {
    const name = (document.getElementById('inpSshNewKeyName')?.value || '').trim();
    const comment = (document.getElementById('inpSshNewKeyComment')?.value || '').trim();
    if (!name) { SetSshCertsStatus('Enter a key filename (e.g. id_ed25519_work).', true); return; }
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'SSH_GEN_KEY', name, comment }));
};

window.TriggerOpenSshConfigFile = function() {
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'SSH_OPEN_CONFIG' }));
};

window.TriggerOpenCertMgr = function() {
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'SSH_OPEN_CERTMGR' }));
};

window.RenderSshHostsGrid = function() {
    const hGrid = document.getElementById('sshHostsGrid');
    const data = window._sshCertsState;
    if (!hGrid || !data) return;
    const q = (document.getElementById('inpSshHostSearch')?.value || '').trim().toLowerCase();
    const list = (data.hosts || []).filter(h => !q || `${h.alias} ${h.hostName} ${h.user} ${h.proxyJump}`.toLowerCase().includes(q));
    hGrid.innerHTML = list.length ? list.map(h => {
        const sa = String(h.alias || '').replace(/'/g, "\\'");
        const shn = String(h.hostName || h.alias || '').replace(/'/g, "\\'");
        const cmdStr = `ssh ${h.alias}`.replace(/'/g, "\\'");
        return `<article class="dev-repo-card">
            <div class="dev-repo-head"><span class="dev-repo-name">🖥️ ${EscapeHtmlTp(h.alias)}</span><span class="sharing-badge badge-info">:${EscapeHtmlTp(h.port || '22')}</span></div>
            <div class="dev-repo-meta">${h.user ? EscapeHtmlTp(h.user) + '@' : ''}${EscapeHtmlTp(h.hostName)}</div>
            ${h.identityFile ? `<div class="dev-repo-meta">Key: ${EscapeHtmlTp(h.identityFile)}</div>` : ''}
            ${h.proxyJump ? `<div class="dev-repo-meta">ProxyJump: ${EscapeHtmlTp(h.proxyJump)}</div>` : ''}
            <div class="dev-repo-actions">
                <button type="button" class="btn-vscode" onclick="TriggerLaunchSshHost('${sa}')">🚀 Connect</button>
                <button type="button" onclick="TriggerTestSshHost('${shn}', '${EscapeHtmlTp(h.port || '22')}')" title="Test TCP reachability &amp; latency">📡 Test</button>
                <button type="button" onclick="ToggleSshHostEditor(true, '${sa}')" title="Edit host entry">✏️ Edit</button>
                <button type="button" onclick="CopyRawText('${cmdStr}', 'SSH command')">📋</button>
                <button type="button" class="wsl-btn-danger" onclick="TriggerDeleteSshHost('${sa}')">🗑️</button>
            </div>
        </article>`;
    }).join('') : `<div class="driver-text-node">${q ? 'No SSH hosts match your search.' : 'No SSH hosts configured in ~/.ssh/config yet. Click "➕ Add SSH Host" above!'}</div>`;
};

window.RenderSshCertsList = function() {
    const cHost = document.getElementById('sshCertsList');
    const data = window._sshCertsState;
    if (!cHost || !data) return;
    const flt = window._sshCertFilter || 'all';
    const q = (document.getElementById('inpSshCertSearch')?.value || '').trim().toLowerCase();
    const certs = (data.certs || []).filter(c => {
        if (flt === 'warn' && c.status !== 'expired' && c.status !== 'expiring') return false;
        if (flt === 'valid' && c.status !== 'valid') return false;
        if (!q) return true;
        return `${c.subject} ${c.issuer} ${c.store} ${c.thumbprint}`.toLowerCase().includes(q);
    });
    cHost.innerHTML = certs.length ? certs.map(c => {
        const cls = c.status === 'expired' ? 'badge-danger' : (c.status === 'expiring' ? 'ver-update' : 'ver-uptodate');
        const daysTxt = c.daysLeft < 0 ? `Expired ${Math.abs(c.daysLeft)}d ago` : `${c.daysLeft}d left`;
        return `<div class="new-tab-row-item">
            <div><strong>${EscapeHtmlTp(c.subject)}</strong> <span class="dev-repo-meta">(${EscapeHtmlTp(c.store)}${c.hasPrivKey ? ' · Private Key' : ''})</span><div class="dev-repo-meta">Issuer: ${EscapeHtmlTp(c.issuer)} · Expires: ${EscapeHtmlTp(c.notAfter)} · ${EscapeHtmlTp(c.thumbprint)}</div></div>
            <span class="sharing-badge ${cls}">${daysTxt}</span>
        </div>`;
    }).join('') : `<div class="driver-text-node">${(data.certs || []).length ? 'No certificates match your current filter.' : 'No personal TLS or code-signing certificates found in LocalMachine\\My or CurrentUser\\My.'}</div>`;
};

function RenderSshCertsState(data) {
    if (!data) return;
    window._sshCertsState = data;
    SetDomText('sumSshHosts', (data.hosts || []).length);
    SetDomText('sumSshKeys', (data.keys || []).length);
    SetDomText('sumSshCerts', (data.certs || []).length);
    SetDomText('sumSshExpiring', data.expiringCount ?? 0);
    SetSshCertsStatus(data.notice || `Loaded ${(data.hosts||[]).length} SSH host(s), ${(data.keys||[]).length} key(s), and ${(data.certs||[]).length} certificate(s).`, !!data.noticeError);

    RenderSshHostsGrid();

    const kGrid = document.getElementById('sshKeysGrid');
    if (kGrid) {
        const keys = data.keys || [];
        kGrid.innerHTML = keys.length ? keys.map(k => {
            const pubEsc = String(k.publicKey || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
            return `<article class="dev-repo-card">
                <div class="dev-repo-head"><span class="dev-repo-name">🔑 ${EscapeHtmlTp(k.name)}</span><span class="sharing-badge badge-purple">${EscapeHtmlTp(k.type)}</span></div>
                <div class="dev-repo-meta" title="${EscapeHtmlTp(k.fingerprint)}">${EscapeHtmlTp(k.fingerprint || k.path)}</div>
                <div class="dev-repo-actions">
                    <button type="button" class="btn-vscode" onclick="CopyRawText('${pubEsc}', 'SSH public key')">📋 Copy Public Key (.pub)</button>
                </div>
            </article>`;
        }).join('') : '<div class="driver-text-node">No .pub SSH keys found in ~/.ssh/. Generate an ed25519 key above!</div>';
    }

    RenderSshCertsList();
}

// =========================================================================
// 8. MULTI-PC / HOMELAB MONITOR CONTROLLER
// =========================================================================
window._homelabTimer = null;
window._homelabState = null;

function SetHomelabStatus(msg, isErr = false) {
    const el = document.getElementById('homelabStatus');
    if (el && msg) { el.classList.toggle('sharing-error', !!isErr); el.textContent = msg; }
    if (msg) AppendConsoleLogEntry(`[HOMELAB] ${msg}`);
}

window.ToggleHomelabNodeEditor = function(show, editNodeId = null) {
    const card = document.getElementById('homelabNodeEditorCard');
    if (!card) return;
    if (!show) { card.style.display = 'none'; return; }
    const existing = editNodeId ? (window._homelabState?.nodes || []).find(n => n.id === editNodeId) : null;
    SetDomText('lblHomelabEditorTitle', existing ? `✏️ Edit Node — ${existing.name}` : '➕ Add Remote PC / Server / NAS Target');
    const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
    setVal('inpLabId', existing ? existing.id : '');
    setVal('inpLabName', existing ? (existing.name || '') : '');
    setVal('selLabMode', existing ? (existing.mode || 'ssh') : 'ssh');
    setVal('inpLabHost', existing ? (existing.host || '') : '');
    setVal('inpLabPort', existing ? (existing.port || 22) : 22);
    setVal('inpLabUser', existing ? (existing.user || '') : '');
    setVal('inpLabWebUrl', existing ? (existing.webUrl || '') : '');
    card.style.display = 'flex';
    document.getElementById('inpLabName')?.focus();
};

window.RequestHomelabState = function(pollNow = false) {
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'HOMELAB_LOAD', pollNow: !!pollNow }));
};

window.TriggerPollHomelabAll = function() {
    SetHomelabStatus('Polling all configured homelab & remote PC nodes...');
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'HOMELAB_POLL_ALL' }));
};

window.TriggerPollHomelabOne = function(nodeId) {
    SetHomelabStatus('Polling remote node...');
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'HOMELAB_POLL_ONE', nodeId }));
};

window.TriggerImportSshToHomelab = function() {
    SetHomelabStatus('Importing hosts from ~/.ssh/config...');
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'HOMELAB_IMPORT_SSH_HOSTS' }));
};

window.OnHomelabAutoRefreshChange = function() {
    if (window._homelabTimer) { clearInterval(window._homelabTimer); window._homelabTimer = null; }
    const sec = Number(document.getElementById('selHomelabAutoRefresh')?.value || 0);
    if (sec > 0 && window._activeViewKey === 'homelab') {
        window._homelabTimer = setInterval(() => {
            if (window._activeViewKey === 'homelab') TriggerPollHomelabAll();
        }, sec * 1000);
    }
};

window.TriggerSaveHomelabNode = function() {
    const id = (document.getElementById('inpLabId')?.value || '').trim();
    const node = {
        id: id || undefined,
        name: (document.getElementById('inpLabName')?.value || '').trim(),
        mode: document.getElementById('selLabMode')?.value || 'ssh',
        host: (document.getElementById('inpLabHost')?.value || '').trim(),
        port: Number(document.getElementById('inpLabPort')?.value || 22),
        user: (document.getElementById('inpLabUser')?.value || '').trim(),
        webUrl: (document.getElementById('inpLabWebUrl')?.value || '').trim()
    };
    if (!node.host) { SetHomelabStatus('Enter a Host IP, hostname, or URL.', true); return; }
    SetHomelabStatus(`Saving & polling ${node.name || node.host}...`);
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'HOMELAB_SAVE_NODE', node }));
    ToggleHomelabNodeEditor(false);
};

window.TriggerDeleteHomelabNode = function(nodeId) {
    if (!ConfirmDestructiveAction('Remove this remote node from Homelab Monitor?')) return;
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'HOMELAB_DELETE_NODE', nodeId }));
};

window.TriggerHomelabSsh = function(host, user, port) {
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'HOMELAB_LAUNCH_SSH', host, user, port }));
};

window.TriggerHomelabRdp = function(host) {
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'HOMELAB_LAUNCH_RDP', host }));
};

function RenderHomelabSingleNodePolled(data) {
    if (!data || !data.node) return;
    if (window._homelabState && Array.isArray(window._homelabState.nodes)) {
        const idx = window._homelabState.nodes.findIndex(x => x.id === data.node.id);
        if (idx >= 0) window._homelabState.nodes[idx] = data.node;
        window._homelabState.onlineCount = window._homelabState.nodes.filter(x => x.online).length;
        window._homelabState.notice = data.notice || '';
        window._homelabState.noticeError = !data.ok;
        RenderHomelabState(window._homelabState);
    } else {
        SetHomelabStatus(data.notice || 'Node polled.', !data.ok);
    }
}

function RenderHomelabState(data) {
    if (!data) return;
    window._homelabState = data;
    SetDomText('sumHomelabOnline', data.onlineCount ?? 0);
    SetDomText('sumHomelabTotal', data.totalCount ?? 0);
    if (data.notice) SetHomelabStatus(data.notice, !!data.noticeError);

    const grid = document.getElementById('homelabNodesGrid');
    if (!grid) return;
    const nodes = data.nodes || [];
    grid.innerHTML = nodes.length ? nodes.map(n => {
        const sId = String(n.id || '').replace(/'/g, "\\'");
        const sHost = String(n.host || '').replace(/'/g, "\\'");
        const sUser = String(n.user || '').replace(/'/g, "\\'");
        const sUrl = String(n.webUrl || '').replace(/'/g, "\\'");
        const latTxt = n.latencyMs >= 0 ? `${n.latencyMs} ms` : '--';
        const bars = [];
        if (n.cpuPct >= 0) bars.push(`<div class="homelab-bar-item"><div><span>CPU</span><strong>${n.cpuPct}%</strong></div><div class="track-bg"><div class="track-fill" style="width:${Math.min(100, n.cpuPct)}%;"></div></div></div>`);
        if (n.ramPct >= 0) bars.push(`<div class="homelab-bar-item"><div><span>RAM</span><strong>${n.ramPct}%</strong></div><div class="track-bg"><div class="track-fill" style="width:${Math.min(100, n.ramPct)}%;"></div></div></div>`);
        if (n.diskPct >= 0) bars.push(`<div class="homelab-bar-item"><div><span>Disk /</span><strong>${n.diskPct}%</strong></div><div class="track-bg"><div class="track-fill" style="width:${Math.min(100, n.diskPct)}%;"></div></div></div>`);
        return `<article class="dev-repo-card">
            <div class="dev-repo-head">
                <span class="dev-repo-name">🌐 ${EscapeHtmlTp(n.name)}</span>
                <div class="card-badge-group">
                    <span class="sharing-badge badge-purple">${EscapeHtmlTp(String(n.mode || 'http').toUpperCase())}</span>
                    <span class="sharing-badge ${n.online ? 'ver-uptodate' : 'badge-danger'}">${n.online ? 'Online · ' + latTxt : 'Offline'}</span>
                </div>
            </div>
            <div class="dev-repo-meta">${EscapeHtmlTp(n.host)}${n.osInfo ? ' · ' + EscapeHtmlTp(n.osInfo) : ''}${n.uptime ? ' · Up: ' + EscapeHtmlTp(n.uptime) : ''}</div>
            ${bars.length ? `<div class="homelab-bars-grid">${bars.join('')}</div>` : ''}
            ${n.ramText ? `<div class="dev-repo-meta">Memory: ${EscapeHtmlTp(n.ramText)}</div>` : ''}
            <div class="dev-repo-meta">${EscapeHtmlTp(n.detail || '')} · Checked ${EscapeHtmlTp(n.checkedAt || '--')}</div>
            <div class="dev-repo-actions">
                <button type="button" onclick="TriggerPollHomelabOne('${sId}')" title="Poll this node right now">🔄 Poll</button>
                ${n.mode === 'ssh' ? `<button type="button" class="btn-vscode" onclick="TriggerHomelabSsh('${sHost}','${sUser}',${n.port||22})">🐚 SSH</button>` : ''}
                ${n.mode === 'winrm' ? `<button type="button" class="btn-vscode" onclick="TriggerHomelabRdp('${sHost}')">🖥️ RDP</button>` : ''}
                ${sUrl ? `<button type="button" onclick="OpenExternalHttpsUrl('${sUrl}')">🌐 Web ↗</button>` : ''}
                <button type="button" onclick="ToggleHomelabNodeEditor(true, '${sId}')" title="Edit target configuration">✏️</button>
                <button type="button" class="wsl-btn-danger" onclick="TriggerDeleteHomelabNode('${sId}')">🗑️</button>
            </div>
        </article>`;
    }).join('') : '<div class="driver-text-node">No remote PCs or servers added yet. Click "➕ Add Node" or "📥 Import SSH" above!</div>';
}

// =========================================================================
// CUSTOM FLOATING DISK PARTITIONER CONTROLLER (AUTO-PAUSES LIVE TELEMETRY)
// =========================================================================
window._diskPartState = null;
window._diskPartSelection = null; // { kind: 'disk'|'unallocated'|'partition', diskNumber, partitionNumber, offsetBytes }
window._diskPartBusy = false;

function SetDiskPartStatus(msg, isErr = false) {
    const el = document.getElementById('diskPartStatus');
    if (el && msg) {
        el.classList.toggle('sharing-error', !!isErr);
        el.textContent = msg;
    }
    if (msg) AppendConsoleLogEntry(`[DISKPART] ${msg}`);
}

function HandleTelemetryPauseState(data) {
    const paused = !!data?.paused;
    const badge = document.getElementById('lblDiskPartPauseBadge');
    if (badge) {
        badge.textContent = paused ? '⏸ Telemetry Paused' : '▶ Telemetry Live';
    }
    const cardHint = document.getElementById('lblStorageTelemetryPaused');
    if (cardHint) cardHint.style.display = paused ? 'inline-block' : 'none';
}

function SendTelemetryPauseState(paused) {
    window.chrome?.webview?.postMessage(JSON.stringify({
        command: 'SET_TELEMETRY_PAUSED',
        paused: !!paused,
        reason: 'Disk Partitioner'
    }));
}

window.OpenDiskPartitioner = function() {
    const pop = document.getElementById('diskPartitionerPopup');
    const btn = document.getElementById('btnOpenDiskPartitioner');
    if (!pop) return;
    pop.style.display = 'flex';
    pop.classList.remove('is-collapsed');
    SetDomText('btnDiskPartCollapse', '▾');
    if (btn) btn.classList.add('active');
    SendTelemetryPauseState(true);
    SetDiskPartStatus('Telemetry paused — scanning physical disks & partitions...');
    RequestDiskPartitionerState(false);
    ClampDiskPartitionerIntoViewport();
};

window.CloseDiskPartitioner = function() {
    const pop = document.getElementById('diskPartitionerPopup');
    const btn = document.getElementById('btnOpenDiskPartitioner');
    const wasOpen = pop && pop.style.display !== 'none';
    if (pop) pop.style.display = 'none';
    if (btn) btn.classList.remove('active');
    if (wasOpen) {
        SendTelemetryPauseState(false);
        AppendConsoleLogEntry('[DISKPART] Closed Disk Partitioner — live telemetry resumed.');
    }
};

window.ToggleDiskPartitionerCollapse = function() {
    const pop = document.getElementById('diskPartitionerPopup');
    if (!pop) return;
    const isCol = pop.classList.toggle('is-collapsed');
    SetDomText('btnDiskPartCollapse', isCol ? '▴' : '▾');
};

window.RequestDiskPartitionerState = function(rescan = false) {
    SetDiskPartStatus(rescan ? 'Rescanning storage bus & disks...' : 'Loading physical disks & partitions...');
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'DISKPART_LOAD', rescan: !!rescan }));
};

window.TriggerDiskPartOpenDiskMgmt = function() {
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'DISKPART_OPEN_DISKMGMT' }));
};

window.SelectDiskPartTarget = function(kind, diskNumber, partitionNumber = 0, offsetBytes = 0) {
    window._diskPartSelection = {
        kind,
        diskNumber: Number(diskNumber),
        partitionNumber: Number(partitionNumber || 0),
        offsetBytes: Number(offsetBytes || 0)
    };
    RenderDiskPartitionerDisks();
    RenderDiskPartitionerInspector();
};

window.TriggerDiskPartInit = function(diskNumber) {
    const style = document.getElementById('selDpInitStyle')?.value || 'GPT';
    if (!confirm(`Initialize Disk ${diskNumber} with a ${style} partition table?`)) return;
    SetDiskPartStatus(`Initializing Disk ${diskNumber} as ${style}...`);
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'DISKPART_INIT_DISK', diskNumber, style }));
};

window.TriggerDiskPartOnline = function(diskNumber, online) {
    if (!online && !confirm(`Take Disk ${diskNumber} Offline? Volumes on this disk will become temporarily inaccessible.`)) return;
    SetDiskPartStatus(`Setting Disk ${diskNumber} ${online ? 'Online' : 'Offline'}...`);
    window.chrome?.webview?.postMessage(JSON.stringify({ command: 'DISKPART_SET_ONLINE', diskNumber, online: !!online }));
};

window.TriggerDiskPartCreate = function(diskNumber) {
    const useMax = !!document.getElementById('chkDpCreateMax')?.checked;
    const sizeGB = Number(document.getElementById('inpDpCreateSizeGB')?.value || 0);
    const driveLetter = document.getElementById('selDpCreateLetter')?.value || 'AUTO';
    const fileSystem = document.getElementById('selDpCreateFs')?.value || 'NTFS';
    const label = (document.getElementById('inpDpCreateLabel')?.value || '').trim();
    const allocUnitKB = Number(document.getElementById('selDpCreateAlloc')?.value || 0);
    const quickFormat = !!document.getElementById('chkDpCreateQuick')?.checked;
    if (!useMax && (!sizeGB || sizeGB <= 0)) {
        SetDiskPartStatus('Enter a valid partition size in GB or check "Use Max Space".', true);
        return;
    }
    SetDiskPartStatus(`Creating & formatting ${fileSystem} partition on Disk ${diskNumber}...`);
    window.chrome?.webview?.postMessage(JSON.stringify({
        command: 'DISKPART_CREATE_PART',
        diskNumber, useMax, sizeGB, driveLetter, fileSystem, label, allocUnitKB, quickFormat
    }));
};

window.TriggerDiskPartFormat = function(diskNumber, partitionNumber) {
    const fileSystem = document.getElementById('selDpFmtFs')?.value || 'NTFS';
    const label = (document.getElementById('inpDpFmtLabel')?.value || '').trim();
    const allocUnitKB = Number(document.getElementById('selDpFmtAlloc')?.value || 0);
    const quickFormat = !!document.getElementById('chkDpFmtQuick')?.checked;
    if (!confirm(`WARNING: Formatting Disk ${diskNumber} Partition ${partitionNumber} as ${fileSystem} will permanently erase ALL data on this volume.\n\nProceed?`)) return;
    SetDiskPartStatus(`Formatting Disk ${diskNumber} Partition ${partitionNumber} (${fileSystem})...`);
    window.chrome?.webview?.postMessage(JSON.stringify({
        command: 'DISKPART_FORMAT_PART',
        diskNumber, partitionNumber, fileSystem, label, allocUnitKB, quickFormat
    }));
};

window.TriggerDiskPartResize = function(diskNumber, partitionNumber) {
    const targetSizeGB = Number(document.getElementById('inpDpResizeGB')?.value || 0);
    if (!targetSizeGB || targetSizeGB <= 0) {
        SetDiskPartStatus('Enter a valid target size in GB.', true);
        return;
    }
    if (!confirm(`Resize Disk ${diskNumber} Partition ${partitionNumber} to ${targetSizeGB} GB?`)) return;
    SetDiskPartStatus(`Resizing Disk ${diskNumber} Partition ${partitionNumber} to ${targetSizeGB} GB...`);
    window.chrome?.webview?.postMessage(JSON.stringify({
        command: 'DISKPART_RESIZE_PART',
        diskNumber, partitionNumber, targetSizeGB
    }));
};

window.TriggerDiskPartSetLetter = function(diskNumber, partitionNumber) {
    const newLetter = document.getElementById('selDpLetter')?.value ?? '';
    SetDiskPartStatus(newLetter ? `Assigning drive letter ${newLetter}:...` : 'Removing drive letter...');
    window.chrome?.webview?.postMessage(JSON.stringify({
        command: 'DISKPART_SET_LETTER',
        diskNumber, partitionNumber, newLetter
    }));
};

window.TriggerDiskPartSetLabel = function(diskNumber, partitionNumber) {
    const label = (document.getElementById('inpDpRenameLabel')?.value || '').trim();
    SetDiskPartStatus(`Updating volume label to '${label}'...`);
    window.chrome?.webview?.postMessage(JSON.stringify({
        command: 'DISKPART_SET_LABEL',
        diskNumber, partitionNumber, label
    }));
};

window.TriggerDiskPartDelete = function(diskNumber, partitionNumber) {
    if (!confirm(`DANGER: Permanently DELETE Disk ${diskNumber} Partition ${partitionNumber}?\nAll files on this partition will be lost and converted to unallocated space.`)) return;
    SetDiskPartStatus(`Deleting Disk ${diskNumber} Partition ${partitionNumber}...`);
    window.chrome?.webview?.postMessage(JSON.stringify({
        command: 'DISKPART_DELETE_PART',
        diskNumber, partitionNumber
    }));
};

window.TriggerDiskPartClearDisk = function(diskNumber) {
    const tok = (document.getElementById('inpDpWipeConfirm')?.value || '').trim().toUpperCase();
    if (tok !== `DISK ${diskNumber}`) {
        SetDiskPartStatus(`Type "DISK ${diskNumber}" exactly in the confirmation box to wipe this disk.`, true);
        return;
    }
    if (!confirm(`FINAL WARNING: Wipe ALL partitions and data on Disk ${diskNumber}? This cannot be undone!`)) return;
    SetDiskPartStatus(`Wiping Disk ${diskNumber}...`);
    window.chrome?.webview?.postMessage(JSON.stringify({
        command: 'DISKPART_CLEAR_DISK',
        diskNumber,
        confirmToken: tok
    }));
};

function RenderDiskPartitionerState(data) {
    if (!data) return;
    window._diskPartState = data;
    SetDomText('lblDiskPartStamp', `Scanned ${data.scannedAt || '--'}${data.isAdmin ? ' · Admin' : ' · Read-Only'}`);
    const defaultMsg = data.isAdmin
        ? `Telemetry paused · Detected ${(data.disks || []).length} physical disk(s). Click any disk, unallocated block, or partition to manage.`
        : `Read-Only mode (Administrator required to modify partitions) · Detected ${(data.disks || []).length} disk(s).`;
    SetDiskPartStatus(data.notice || defaultMsg, !!data.noticeError);

    // Keep or pick a sensible default selection
    const disks = data.disks || [];
    if (!window._diskPartSelection && disks.length) {
        window._diskPartSelection = { kind: 'disk', diskNumber: disks[0].number, partitionNumber: 0, offsetBytes: 0 };
    } else if (window._diskPartSelection) {
        const dMatch = disks.find(d => d.number === window._diskPartSelection.diskNumber);
        if (!dMatch && disks.length) {
            window._diskPartSelection = { kind: 'disk', diskNumber: disks[0].number, partitionNumber: 0, offsetBytes: 0 };
        } else if (dMatch && window._diskPartSelection.kind === 'partition') {
            const pMatch = (dMatch.segments || []).find(s => s.kind === 'partition' && s.partitionNumber === window._diskPartSelection.partitionNumber);
            if (!pMatch) window._diskPartSelection = { kind: 'disk', diskNumber: dMatch.number, partitionNumber: 0, offsetBytes: 0 };
        }
    }

    RenderDiskPartitionerDisks();
    RenderDiskPartitionerInspector();
}

function RenderDiskPartitionerDisks() {
    const host = document.getElementById('diskPartDisksList');
    const data = window._diskPartState;
    if (!host || !data) return;
    const disks = data.disks || [];
    const sel = window._diskPartSelection || {};
    if (!disks.length) {
        host.innerHTML = '<div class="driver-text-node">No physical disks detected by Windows Storage API.</div>';
        return;
    }

    host.innerHTML = disks.map(d => {
        const isDiskSel = sel.kind === 'disk' && sel.diskNumber === d.number;
        const segs = d.segments || [];
        const segHtml = segs.length ? segs.map(s => {
            const flexW = Math.max(6, Number(s.pctOfDisk || 10));
            const isSegSel = (sel.diskNumber === d.number) && (
                (s.kind === 'partition' && sel.kind === 'partition' && sel.partitionNumber === s.partitionNumber) ||
                (s.kind === 'unallocated' && sel.kind === 'unallocated' && sel.offsetBytes === s.offsetBytes)
            );
            const cls = s.kind === 'unallocated' ? 'seg-unalloc' : (s.isProtected ? 'seg-protected' : '');
            const topLbl = s.kind === 'unallocated'
                ? `${EscapeHtmlTp(s.label)} (${s.sizeGB} GB)`
                : `${s.driveLetter ? s.driveLetter + ': ' : ''}${EscapeHtmlTp(s.label || s.partType || 'Partition')}`;
            const subLbl = s.kind === 'unallocated'
                ? 'Click to Create Partition'
                : `${s.sizeGB} GB${s.fileSystem ? ' · ' + EscapeHtmlTp(s.fileSystem) : ''}${s.isProtected ? ' · Protected' : ''}`;
            return `<button type="button" class="dp-bar-seg ${cls}${isSegSel ? ' is-selected' : ''}" style="flex: ${flexW} 1 56px;" onclick="SelectDiskPartTarget('${s.kind}', ${d.number}, ${s.partitionNumber || 0}, ${s.offsetBytes || 0})" title="${topLbl} — ${subLbl}">
                <span class="dp-seg-top">${topLbl}</span>
                <span class="dp-seg-sub">${subLbl}</span>
            </button>`;
        }).join('') : '<div class="driver-text-node" style="padding:8px;">Empty / Offline Disk</div>';

        return `<div class="dp-disk-card${isDiskSel ? ' is-selected' : ''}">
            <div class="dp-disk-head" onclick="SelectDiskPartTarget('disk', ${d.number}, 0, 0)" title="Click to select Disk ${d.number} actions">
                <div class="dp-disk-title">
                    <span>💽 Disk ${d.number}: ${EscapeHtmlTp(d.friendlyName)}</span>
                    <span class="sharing-badge badge-info">${EscapeHtmlTp(d.busType)}</span>
                    <span class="sharing-badge ${d.partitionStyle === 'RAW' ? 'ver-update' : 'badge-purple'}">${EscapeHtmlTp(d.partitionStyle)}</span>
                    ${d.isSystemOrBoot ? '<span class="sharing-badge badge-danger">System / Boot</span>' : ''}
                    ${d.isOffline ? '<span class="sharing-badge ver-update">Offline</span>' : ''}
                </div>
                <div class="dp-disk-meta">${d.sizeGB} GB total · ${d.unallocatedGB} GB unallocated · ${EscapeHtmlTp(d.healthStatus)}</div>
            </div>
            <div class="dp-bar-track">${segHtml}</div>
        </div>`;
    }).join('');
}

function RenderDiskPartitionerInspector() {
    const host = document.getElementById('diskPartInspector');
    const data = window._diskPartState;
    const sel = window._diskPartSelection;
    if (!host || !data || !sel) return;

    const disk = (data.disks || []).find(d => d.number === sel.diskNumber);
    if (!disk) {
        host.innerHTML = '<div class="driver-text-node">Select a disk, partition, or unallocated block above.</div>';
        return;
    }
    const availLetters = data.availableLetters || [];
    const letterOpts = `<option value="AUTO">Auto Assign</option>` +
        availLetters.map(l => `<option value="${l}">${l}:</option>`).join('') +
        `<option value="NONE">No Drive Letter</option>`;

    // 1. DISK SELECTED
    if (sel.kind === 'disk') {
        const initBlock = disk.partitionStyle === 'RAW' ? `
            <div class="dp-action-block">
                <div class="dp-action-title">✨ Initialize Uninitialized (RAW) Disk ${disk.number}</div>
                <div class="new-tab-inline-bar">
                    <select id="selDpInitStyle" class="prof-select" style="max-width:220px;">
                        <option value="GPT" selected>GPT (Modern UEFI · >2 TB)</option>
                        <option value="MBR">MBR (Legacy BIOS · ≤2 TB)</option>
                    </select>
                    <button type="button" class="console-clear-btn btn-accent-action" onclick="TriggerDiskPartInit(${disk.number})">Initialize Disk</button>
                </div>
            </div>` : '';

        const quickCreate = (disk.partitionStyle !== 'RAW' && disk.unallocatedGB >= 0.05) ? `
            <div class="dp-action-block">
                <div class="dp-action-title">➕ Quick-Create Partition in Unallocated Space (${disk.unallocatedGB} GB free)</div>
                <button type="button" class="console-clear-btn btn-accent-action" style="align-self:flex-start;" onclick="SelectDiskPartTarget('unallocated', ${disk.number}, 0, ${(disk.segments.find(x => x.kind === 'unallocated')?.offsetBytes) || 0})">Configure New Partition →</button>
            </div>` : '';

        const dangerBlock = !disk.isSystemOrBoot ? `
            <div class="dp-action-block dp-danger-block">
                <div class="dp-action-title">⚠️ Danger Zone — Disk ${disk.number} (${EscapeHtmlTp(disk.friendlyName)})</div>
                <div class="new-tab-inline-bar">
                    <button type="button" class="console-clear-btn" onclick="TriggerDiskPartOnline(${disk.number}, ${disk.isOffline ? 'true' : 'false'})">${disk.isOffline ? '🔌 Bring Online' : '⏸ Take Offline'}</button>
                    <input type="text" id="inpDpWipeConfirm" class="prof-input" style="max-width:170px;" placeholder="Type: DISK ${disk.number}">
                    <button type="button" class="console-clear-btn wsl-btn-danger" onclick="TriggerDiskPartClearDisk(${disk.number})">🧨 Clean / Wipe Disk</button>
                </div>
            </div>` : `<div class="dev-repo-meta">🛡️ Disk ${disk.number} hosts the active Windows System/Boot volume — Wipe &amp; Offline actions are locked for safety.</div>`;

        host.innerHTML = `
            <div class="new-tab-section-head">
                <div class="cw-set-sec-title" style="border:none;padding:0;">💽 Disk ${disk.number} — ${EscapeHtmlTp(disk.friendlyName)} (${disk.sizeGB} GB · ${EscapeHtmlTp(disk.partitionStyle)})</div>
                <span class="cw-settings-sub">${EscapeHtmlTp(disk.busType)} · ${EscapeHtmlTp(disk.operationalStatus)} · ${disk.partitionCount} partition(s)</span>
            </div>
            ${initBlock}
            ${quickCreate}
            ${dangerBlock}`;
        return;
    }

    // 2. UNALLOCATED SPACE SELECTED
    if (sel.kind === 'unallocated') {
        const seg = (disk.segments || []).find(s => s.kind === 'unallocated' && s.offsetBytes === sel.offsetBytes)
            || (disk.segments || []).find(s => s.kind === 'unallocated');
        const freeGB = seg ? seg.sizeGB : disk.unallocatedGB;
        if (disk.partitionStyle === 'RAW') {
            host.innerHTML = `
                <div class="new-tab-section-head">
                    <div class="cw-set-sec-title" style="border:none;padding:0;">✨ Disk ${disk.number} is Uninitialized (RAW · ${freeGB} GB)</div>
                </div>
                <div class="dp-action-block">
                    <div class="dp-action-title">Step 1: Initialize Partition Table (GPT recommended)</div>
                    <div class="new-tab-inline-bar">
                        <select id="selDpInitStyle" class="prof-select" style="max-width:240px;">
                            <option value="GPT" selected>GPT (GUID Partition Table — Recommended)</option>
                            <option value="MBR">MBR (Master Boot Record — Legacy)</option>
                        </select>
                        <button type="button" class="console-clear-btn btn-accent-action" onclick="TriggerDiskPartInit(${disk.number})">Initialize Disk ${disk.number}</button>
                    </div>
                </div>`;
            return;
        }
        host.innerHTML = `
            <div class="new-tab-section-head">
                <div class="cw-set-sec-title" style="border:none;padding:0;">➕ New Partition on Disk ${disk.number} (${freeGB} GB Unallocated)</div>
            </div>
            <div class="dp-action-block">
                <div class="new-tab-form-grid">
                    <div class="cw-dir-row"><label for="inpDpCreateSizeGB">Size (GB)</label><input type="number" id="inpDpCreateSizeGB" class="prof-input" step="0.1" min="0.1" max="${freeGB}" value="${freeGB}"></div>
                    <div class="cw-dir-row"><label for="selDpCreateLetter">Drive Letter</label><select id="selDpCreateLetter" class="prof-select">${letterOpts}</select></div>
                    <div class="cw-dir-row"><label for="selDpCreateFs">File System</label>
                        <select id="selDpCreateFs" class="prof-select">
                            <option value="NTFS" selected>NTFS (Windows Standard)</option>
                            <option value="exFAT">exFAT (USB / Cross-Platform)</option>
                            <option value="FAT32">FAT32 (≤32 GB Legacy)</option>
                            <option value="ReFS">ReFS (Resilient Storage)</option>
                        </select>
                    </div>
                    <div class="cw-dir-row"><label for="inpDpCreateLabel">Volume Label</label><input type="text" id="inpDpCreateLabel" class="prof-input" placeholder="e.g. Games or Data"></div>
                    <div class="cw-dir-row"><label for="selDpCreateAlloc">Allocation Unit</label>
                        <select id="selDpCreateAlloc" class="prof-select">
                            <option value="0" selected>Default</option>
                            <option value="4">4 KB</option>
                            <option value="16">16 KB</option>
                            <option value="64">64 KB (Large Media/VMs)</option>
                        </select>
                    </div>
                    <div class="cw-dir-row" style="justify-content:flex-end;">
                        <label class="org-checkbox-label"><input type="checkbox" id="chkDpCreateMax" checked onchange="document.getElementById('inpDpCreateSizeGB').disabled = this.checked"><span>Use Max Space</span></label>
                        <label class="org-checkbox-label"><input type="checkbox" id="chkDpCreateQuick" checked><span>Quick Format</span></label>
                    </div>
                </div>
                <div style="display:flex;justify-content:flex-end;margin-top:4px;">
                    <button type="button" class="console-clear-btn btn-accent-action" onclick="TriggerDiskPartCreate(${disk.number})">✨ Create &amp; Format Partition</button>
                </div>
            </div>`;
        const sizeInp = document.getElementById('inpDpCreateSizeGB');
        if (sizeInp) sizeInp.disabled = true;
        return;
    }

    // 3. PARTITION SELECTED
    const part = (disk.segments || []).find(s => s.kind === 'partition' && s.partitionNumber === sel.partitionNumber);
    if (!part) return;

    const curLetterOpts = `<option value="">(Remove Drive Letter)</option>` +
        (part.driveLetter ? `<option value="${part.driveLetter}" selected>${part.driveLetter}: (Current)</option>` : '') +
        availLetters.map(l => `<option value="${l}">${l}:</option>`).join('');

    const resizeBlock = (part.minSizeGB > 0 && part.maxSizeGB > 0) ? `
        <div class="dp-action-block">
            <div class="dp-action-title">↔️ Shrink / Extend Partition (Supported: ${part.minSizeGB} GB – ${part.maxSizeGB} GB)</div>
            <div class="new-tab-inline-bar">
                <input type="number" id="inpDpResizeGB" class="prof-input" style="max-width:140px;" step="0.1" min="${part.minSizeGB}" max="${part.maxSizeGB}" value="${part.sizeGB}">
                <span class="cw-settings-sub">GB</span>
                <button type="button" class="console-clear-btn btn-accent-action" onclick="TriggerDiskPartResize(${disk.number}, ${part.partitionNumber})">Apply Resize</button>
            </div>
        </div>` : '';

    const labelLetterBlock = `
        <div class="dp-action-block">
            <div class="dp-action-title">🏷️ Volume Label &amp; Drive Letter</div>
            <div class="new-tab-form-grid">
                <div class="cw-dir-row">
                    <label for="inpDpRenameLabel">Volume Label</label>
                    <div class="cw-dir-input-wrap">
                        <input type="text" id="inpDpRenameLabel" class="prof-input" value="${EscapeHtmlTp(part.label || '')}" placeholder="Volume name">
                        <button type="button" class="console-clear-btn" onclick="TriggerDiskPartSetLabel(${disk.number}, ${part.partitionNumber})">Rename</button>
                    </div>
                </div>
                ${!part.isProtected ? `
                <div class="cw-dir-row">
                    <label for="selDpLetter">Drive Letter</label>
                    <div class="cw-dir-input-wrap">
                        <select id="selDpLetter" class="prof-select">${curLetterOpts}</select>
                        <button type="button" class="console-clear-btn" onclick="TriggerDiskPartSetLetter(${disk.number}, ${part.partitionNumber})">Assign</button>
                    </div>
                </div>` : '<div class="cw-dir-row"><label>Drive Letter</label><span class="cw-settings-sub">Locked on System/Boot partition</span></div>'}
            </div>
        </div>`;

    const formatDeleteBlock = !part.isProtected ? `
        <div class="dp-action-block dp-danger-block">
            <div class="dp-action-title">⚠️ Format or Delete Partition</div>
            <div class="new-tab-form-grid">
                <div class="cw-dir-row"><label for="selDpFmtFs">File System</label>
                    <select id="selDpFmtFs" class="prof-select">
                        <option value="NTFS" ${part.fileSystem==='NTFS'?'selected':''}>NTFS</option>
                        <option value="exFAT" ${part.fileSystem==='exFAT'?'selected':''}>exFAT</option>
                        <option value="FAT32" ${part.fileSystem==='FAT32'?'selected':''}>FAT32</option>
                        <option value="ReFS" ${part.fileSystem==='ReFS'?'selected':''}>ReFS</option>
                    </select>
                </div>
                <div class="cw-dir-row"><label for="inpDpFmtLabel">New Label</label><input type="text" id="inpDpFmtLabel" class="prof-input" value="${EscapeHtmlTp(part.label || '')}"></div>
                <div class="cw-dir-row"><label for="selDpFmtAlloc">Cluster Size</label>
                    <select id="selDpFmtAlloc" class="prof-select">
                        <option value="0" selected>Default</option>
                        <option value="4">4 KB</option>
                        <option value="16">16 KB</option>
                        <option value="64">64 KB</option>
                    </select>
                </div>
                <div class="cw-dir-row" style="justify-content:flex-end; flex-direction:row; align-items:flex-end; gap:6px;">
                    <label class="org-checkbox-label"><input type="checkbox" id="chkDpFmtQuick" checked><span>Quick</span></label>
                    <button type="button" class="console-clear-btn wsl-btn-danger" onclick="TriggerDiskPartFormat(${disk.number}, ${part.partitionNumber})">🧹 Format</button>
                    <button type="button" class="console-clear-btn wsl-btn-danger" onclick="TriggerDiskPartDelete(${disk.number}, ${part.partitionNumber})">🗑️ Delete</button>
                </div>
            </div>
        </div>` : `<div class="dev-repo-meta">🛡️ Protected System / Boot / EFI / Recovery partition — Format and Delete are disabled for safety.</div>`;

    host.innerHTML = `
        <div class="new-tab-section-head">
            <div class="cw-set-sec-title" style="border:none;padding:0;">📂 Disk ${disk.number} · Partition ${part.partitionNumber} ${part.driveLetter ? `(${part.driveLetter}:)` : ''} — ${part.sizeGB} GB</div>
            <span class="cw-settings-sub">${EscapeHtmlTp(part.fileSystem || 'RAW')} · ${EscapeHtmlTp(part.partType)}${part.usedGB >= 0 ? ` · ${part.usedGB} GB used / ${part.freeGB} GB free` : ''}</span>
        </div>
        ${labelLetterBlock}
        ${resizeBlock}
        ${formatDeleteBlock}`;
}

function ClampDiskPartitionerIntoViewport() {
    const pop = document.getElementById('diskPartitionerPopup');
    if (!pop || pop.style.display === 'none') return;
    if (pop.style.transform && pop.style.transform !== 'none') return;
    const rect = pop.getBoundingClientRect();
    const maxL = Math.max(8, window.innerWidth - rect.width - 8);
    const maxT = Math.max(8, window.innerHeight - 48);
    const curL = parseFloat(pop.style.left) || rect.left;
    const curT = parseFloat(pop.style.top) || rect.top;
    pop.style.left = `${Math.max(8, Math.min(maxL, curL))}px`;
    pop.style.top  = `${Math.max(8, Math.min(maxT, curT))}px`;
}

function InitDiskPartitionerDrag() {
    const pop = document.getElementById('diskPartitionerPopup');
    const hdr = document.getElementById('diskPartHeader');
    if (!pop || !hdr || hdr._dragBound) return;
    hdr._dragBound = true;

    let dragging = false;
    let startX = 0, startY = 0, origL = 0, origT = 0;

    hdr.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        if (e.target.closest('button')) return;
        e.preventDefault();
        e.stopPropagation();
        const rect = pop.getBoundingClientRect();
        pop.style.transform = 'none';
        pop.style.left = `${rect.left}px`;
        pop.style.top  = `${rect.top}px`;
        dragging = true;
        startX = e.clientX;
        startY = e.clientY;
        origL = rect.left;
        origT = rect.top;
    });

    window.addEventListener('mousemove', (e) => {
        if (!dragging) return;
        const rect = pop.getBoundingClientRect();
        const maxL = Math.max(8, window.innerWidth - rect.width - 8);
        const maxT = Math.max(8, window.innerHeight - 48);
        const nextL = Math.max(8, Math.min(maxL, origL + (e.clientX - startX)));
        const nextT = Math.max(8, Math.min(maxT, origT + (e.clientY - startY)));
        pop.style.left = `${nextL}px`;
        pop.style.top  = `${nextT}px`;
    });

    window.addEventListener('mouseup', () => { dragging = false; });
    window.addEventListener('resize', ClampDiskPartitionerIntoViewport);
}
