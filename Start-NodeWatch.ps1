[CmdletBinding()]
param(
    [switch]$Release,
    [switch]$DevTools
)

try { if ($Host.Name -eq "ConsoleHost" -and -not [Console]::IsOutputRedirected) { Clear-Host } } catch {}
$Global:NodeWatchRoot = $PSScriptRoot
$Global:EnableDevTools = if ($DevTools) { $true } elseif ($Release) { $false } else { $true }
$BinPath = Join-Path $Global:NodeWatchRoot "bin"
$CoreDll = Join-Path $BinPath "Microsoft.Web.WebView2.Core.dll"
$FormDll = Join-Path $BinPath "Microsoft.Web.WebView2.WinForms.dll"

if ((Test-Path $CoreDll) -and (Test-Path $FormDll)) {
    $null = [System.Reflection.Assembly]::LoadFrom($CoreDll)
    $null = [System.Reflection.Assembly]::LoadFrom($FormDll)
} else { 
    Write-Error "Missing critical WebView2 components in bin folder."
    return 
}

Add-Type -AssemblyName System.Windows.Forms, System.Drawing

if (-not ("CoreWatch.Win32" -as [type])) {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

namespace CoreWatch {
    public static class Win32 {
        public const int WM_NCLBUTTONDOWN = 0x00A1;

        [DllImport("user32.dll")]
        public static extern bool ReleaseCapture();

        [DllImport("user32.dll")]
        public static extern IntPtr SendMessage(IntPtr hWnd, int Msg, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool DestroyIcon(IntPtr hIcon);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool SetProcessWorkingSetSize(IntPtr hProcess, IntPtr dwMinimumWorkingSetSize, IntPtr dwMaximumWorkingSetSize);

        public static void TrimWorkingSet() {
            try {
                GC.Collect(1, GCCollectionMode.Optimized, false);
                SetProcessWorkingSetSize(System.Diagnostics.Process.GetCurrentProcess().Handle, (IntPtr)(-1), (IntPtr)(-1));
            } catch { }
        }
    }
}
"@ -ErrorAction SilentlyContinue
}
$AppDataRoot = Join-Path $env:LOCALAPPDATA "CoreWatch"
$UserDataFolder = [System.IO.Path]::GetFullPath((Join-Path $AppDataRoot "WebView2UserData"))
if (-not (Test-Path $UserDataFolder)) { $null = New-Item -ItemType Directory -Path $UserDataFolder -Force }
$env:WEBVIEW2_USER_DATA_FOLDER = $UserDataFolder

$global:SharedData = [hashtable]::Synchronized(@{
    FullPayload  = $null
    FullVersion  = 0
    FastPayload  = $null
    FastVersion  = 0
    ForceRefresh = $false
    ActiveView   = "dashboard"
    IsMinimized  = $false
    IsRunning    = $true
})

# =========================================================================
# UNIFIED TIERED TELEMETRY PIPELINE (SINGLE RUNSPACE - CUTS CPU/RAM ~50%+)
#   - Dashboard active: 500ms fast counters, 2000ms full mesh
#   - Other tab active: fast loop paused, 4000ms full mesh (for Defender sync)
#   - Minimized:        polling paused until restored (immediate wakeup)
# =========================================================================
$RunspaceScript = {
    param($RootPath, $SharedData)
    $TelemetryPath = Join-Path $RootPath "modules\telemetry"
    . (Join-Path $TelemetryPath "GetIDMetrics.ps1")
    . (Join-Path $TelemetryPath "GetInfraMetrics.ps1")
    . (Join-Path $TelemetryPath "GetNetworkMetrics.ps1")
    . (Join-Path $TelemetryPath "GetTrafficMetrics.ps1")
    . (Join-Path $TelemetryPath "GetSystemMetrics.ps1")
    . (Join-Path $TelemetryPath "StorageEngine.ps1")

    Initialize-StaticSystemCache
    # Prime performance counters once so first pushed frame is immediately accurate
    $null = Get-FastHardwareMetrics
    $null = Get-TrafficMetrics

    $lastFullSample = [datetime]::MinValue
    $lastGcTrim     = [datetime]::Now

    while ($SharedData.IsRunning) {
        # When minimized, pause polling completely and wake immediately when restored
        if ($SharedData.IsMinimized -and -not $SharedData.ForceRefresh) {
            [System.Threading.Thread]::Sleep(250)
            continue
        }

        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        $onDashboard = ($SharedData.ActiveView -eq "dashboard")
        $forceNow    = [bool]$SharedData.ForceRefresh

        try {
            if ($forceNow) {
                $SharedData.ForceRefresh = $false
                if (Get-Command Reset-NetworkMetricsCache -ErrorAction SilentlyContinue) { Reset-NetworkMetricsCache }
                if (Get-Command Reset-SystemMetricsCache -ErrorAction SilentlyContinue)  { Reset-SystemMetricsCache }
                if (Get-Command Reset-InfraMetricsCache -ErrorAction SilentlyContinue)   { Reset-InfraMetricsCache }
            }

            $FastHw  = $null
            $FastNet = $null

            # Fast 0.5s frame runs only while Dashboard is visible (or on forced/initial refresh)
            if ($onDashboard -or $forceNow -or $SharedData.FullVersion -eq 0) {
                $FastHw  = Get-FastHardwareMetrics
                $FastNet = Get-TrafficMetrics

                $FastObject = [PSCustomObject]@{
                    type            = "FAST_TELEMETRY"
                    SystemFrame     = $FastHw
                    NetworkActivity = $FastNet
                }
                $SharedData.FastPayload = $FastObject | ConvertTo-Json -Compress -Depth 4
                $SharedData.FastVersion++
            }

            $fullIntervalMs = if ($onDashboard) { 2000 } else { 4000 }
            $elapsedSinceFull = ([datetime]::Now - $lastFullSample).TotalMilliseconds

            if ($forceNow -or $elapsedSinceFull -ge $fullIntervalMs) {
                if ($null -eq $FastHw)  { $FastHw  = Get-FastHardwareMetrics }
                if ($null -eq $FastNet) { $FastNet = Get-TrafficMetrics }

                function _nz($v, $d) { if ($null -ne $v) { $v } else { $d } }

                $StaticNet   = Get-NetworkMetrics
                $SystemFrame = Get-SystemMetrics -PrecomputedFast $FastHw

                $MergedNetworkFrame = [PSCustomObject]@{
                    IntIPv4          = [string](_nz $StaticNet.IntIPv4 "0.0.0.0")
                    SubnetMask       = [string](_nz $StaticNet.SubnetMask "0.0.0.0")
                    Gateway          = [string](_nz $StaticNet.Gateway "N/A")
                    DnsServers       = [string](_nz $StaticNet.DnsServers "Auto / None")
                    DnsStatus        = [string](_nz $StaticNet.DnsStatus "Checking")
                    DnsStatusText    = [string](_nz $StaticNet.DnsStatusText "Checking...")
                    ArpStatus        = [string](_nz $StaticNet.ArpStatus "Unresolved")
                    GatewayMac       = [string](_nz $StaticNet.GatewayMac "N/A")
                    ArpDetail        = [string](_nz $StaticNet.ArpDetail "")
                    NetworkStatus    = [string](_nz $StaticNet.NetworkStatus "Offline")
                    WlanSsid         = [string](_nz $StaticNet.WlanSsid "None")
                    ExtIPv4          = [string](_nz $StaticNet.ExtIPv4 "Resolving...")
                    LinkCap          = [string](_nz $StaticNet.LinkCap "0 Mbps")
                    Firewall         = [string](_nz $StaticNet.Firewall "Unknown")
                    Realtime         = [string](_nz $StaticNet.Realtime "Unknown")
                    TamperProtection = [string](_nz $StaticNet.TamperProtection "Unknown")
                    BehaviorMonitor  = [string](_nz $StaticNet.BehaviorMonitor "Unknown")
                    CloudProtection  = [string](_nz $StaticNet.CloudProtection "Unknown")
                    IoavProtection   = [string](_nz $StaticNet.IoavProtection "Unknown")
                    Discovery        = [string](_nz $StaticNet.Discovery "Off")
                    Sharing          = [string](_nz $StaticNet.Sharing "Off")
                    lblEthDriver     = [string](_nz $StaticNet.lblEthDriver "Unknown")
                    lblWifiDriver    = [string](_nz $StaticNet.lblWifiDriver "Unknown")
                    NetAssignment    = [string](_nz $StaticNet.NetAssignment "DHCP")
                    AdapterStatuses  = @($StaticNet.AdapterStatuses)
                    RxPct            = [int](_nz $FastNet.RxPct 0)
                    TxPct            = [int](_nz $FastNet.TxPct 0)
                    RxText           = [string](_nz $FastNet.RxText "0.00 KB/s")
                    TxText           = [string](_nz $FastNet.TxText "0.00 KB/s")
                }

                $MasterObject = [PSCustomObject]@{
                    IdentityFrame  = Get-IDMetrics
                    InfraFrame     = Get-InfraMetrics
                    NetworkFrame   = $MergedNetworkFrame
                    SystemFrame    = $SystemFrame
                    StorageFrame   = Get-StorageMetrics
                    PipelineStatus = "SUCCESS"
                }
                $SharedData.FullPayload = $MasterObject | ConvertTo-Json -Compress -Depth 5
                $SharedData.FullVersion++
                $lastFullSample = [datetime]::Now
            }

            # Lightweight periodic GC + working-set trim every 60 seconds to prevent PowerShell Gen2 RAM creep
            if (([datetime]::Now - $lastGcTrim).TotalSeconds -ge 60) {
                $lastGcTrim = [datetime]::Now
                if ("CoreWatch.Win32" -as [type]) { [CoreWatch.Win32]::TrimWorkingSet() }
            }
        } catch {
            $SharedData.FullPayload = @{ PipelineStatus = "LOOP_CRASH: $($_.Exception.Message)" } | ConvertTo-Json -Compress
            $SharedData.FullVersion++
        }

        $targetCadence = if ($onDashboard) { 500 } else { 1000 }
        $sleepMs = [int][math]::Max(80, $targetCadence - $sw.ElapsedMilliseconds)
        $slept = 0
        while ($slept -lt $sleepMs -and $SharedData.IsRunning -and -not $SharedData.ForceRefresh) {
            $chunk = [int][math]::Min(100, $sleepMs - $slept)
            [System.Threading.Thread]::Sleep($chunk)
            $slept += $chunk
        }
    }
}

$Runspace = [runspacefactory]::CreateRunspace()
$Runspace.ApartmentState = "STA"
$Runspace.ThreadOptions = "ReuseThread"
$Runspace.Open()

$PowerShellPool = [powershell]::Create()
$PowerShellPool.Runspace = $Runspace
$null = $PowerShellPool.AddScript($RunspaceScript).AddArgument($Global:NodeWatchRoot).AddArgument($global:SharedData)
$null = $PowerShellPool.BeginInvoke()

# =========================================================================
# CORE WINDOW FORM CONSTRUCTOR
# =========================================================================
$script:MaxWindowWidth  = 2160
$script:MaxWindowHeight = 3840
$script:MinWindowWidth  = 640
$script:MinWindowHeight = 720
$ScreenWorkArea = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$InitWidth  = [Math]::Max($script:MinWindowWidth,  [Math]::Min(1080, $ScreenWorkArea.Width))
$InitHeight = [Math]::Max($script:MinWindowHeight, [Math]::Min(1920, $ScreenWorkArea.Height))

$MainForm = New-Object System.Windows.Forms.Form
$MainForm.Text = "CoreWatch Host Engine Dashboard Framework"
$MainForm.MinimumSize = New-Object System.Drawing.Size($script:MinWindowWidth, $script:MinWindowHeight)
$MainForm.MaximumSize = New-Object System.Drawing.Size($script:MaxWindowWidth, $script:MaxWindowHeight)
$MainForm.Size = New-Object System.Drawing.Size($InitWidth, $InitHeight)
$MainForm.StartPosition = "CenterScreen"
$MainForm.BackColor = [System.Drawing.Color]::FromArgb(26, 32, 44)
$MainForm.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None

$IconPath = Join-Path $Global:NodeWatchRoot "Images\Icon.png"
if (Test-Path $IconPath) {
    try {
        $IconBitmap = New-Object System.Drawing.Bitmap($IconPath)
        $IconHandle = $IconBitmap.GetHicon()
        $AppIconInstance = [System.Drawing.Icon]::FromHandle($IconHandle)
        $MainForm.Icon = $AppIconInstance
        $MainForm.ShowIcon = $true
        $TrayIconSize = [System.Windows.Forms.SystemInformation]::SmallIconSize
        $TrayIconInstance = New-Object System.Drawing.Icon($AppIconInstance, $TrayIconSize.Width, $TrayIconSize.Height)
    } catch { Write-Warning "Failed to pack runtime scaling icon assets." }
}

$global:IsFormDragging = $false
$global:FormDragCursorOffset = [System.Drawing.Point]::Empty
$MainForm.Add_MouseDown({
    param($evtSource, $evtArgs)
    if ($evtArgs.Button -eq [System.Windows.Forms.MouseButtons]::Left -and $evtArgs.Y -le 50) {
        $global:IsFormDragging = $true
        $global:FormDragCursorOffset = New-Object System.Drawing.Point($evtArgs.X, $evtArgs.Y)
    }
})
$MainForm.Add_MouseMove({
    param($evtSource, $evtArgs)
    if ($global:IsFormDragging) {
        $ScreenMousePos = [System.Windows.Forms.Cursor]::Position
        $MainForm.Location = New-Object System.Drawing.Point(($ScreenMousePos.X - $global:FormDragCursorOffset.X), ($ScreenMousePos.Y - $global:FormDragCursorOffset.Y))
    }
})
$MainForm.Add_MouseUp({ $global:IsFormDragging = $false })

$global:WebViewControl = New-Object Microsoft.Web.WebView2.WinForms.WebView2
$global:WebViewControl.Dock = "Fill"
$MainForm.Controls.Add($global:WebViewControl)

$global:LastSentFullVersion = -1
$global:LastSentFastVersion = -1

$global:FlushTelemetryToUi = {
    if ($null -eq $global:WebViewControl.CoreWebView2) { return }
    try {
        if ($null -ne $global:SharedData.FullPayload -and $global:SharedData.FullVersion -ne $global:LastSentFullVersion) {
            $global:LastSentFullVersion = $global:SharedData.FullVersion
            $Bytes = [System.Text.Encoding]::UTF8.GetBytes($global:SharedData.FullPayload)
            $global:WebViewControl.CoreWebView2.PostWebMessageAsString([Convert]::ToBase64String($Bytes))
        }
        if ($null -ne $global:SharedData.FastPayload -and $global:SharedData.FastVersion -ne $global:LastSentFastVersion) {
            $global:LastSentFastVersion = $global:SharedData.FastVersion
            $FastBytes = [System.Text.Encoding]::UTF8.GetBytes($global:SharedData.FastPayload)
            $global:WebViewControl.CoreWebView2.PostWebMessageAsString([Convert]::ToBase64String($FastBytes))
        }
    } catch {}
}

$global:TelemetryLoopTimer = New-Object System.Windows.Forms.Timer
$global:TelemetryLoopTimer.Interval = 500
$global:TelemetryLoopTimer.Add_Tick($global:FlushTelemetryToUi)

$global:ActiveTabTasks = New-Object System.Collections.ArrayList

function Start-AsyncTabTask {
    param(
        [Parameter(Mandatory)][scriptblock]$ScriptBlock,
        [object[]]$Arguments = @(),
        [string]$FallbackType = "TAB_ERROR"
    )
    $ps = [powershell]::Create()
    $null = $ps.AddScript($ScriptBlock)
    foreach ($arg in $Arguments) {
        $null = $ps.AddArgument($arg)
    }
    $handle = $ps.BeginInvoke()

    $timer = New-Object System.Windows.Forms.Timer
    $timer.Interval = 120
    $taskObj = [PSCustomObject]@{
        PS           = $ps
        Handle       = $handle
        Timer        = $timer
        FallbackType = $FallbackType
    }
    $null = $global:ActiveTabTasks.Add($taskObj)

    $timer.Tag = $taskObj
    $timer.Add_Tick({
        param($timerSender, $e)
        $t = $timerSender.Tag
        if ($null -ne $t -and $null -ne $t.Handle -and $t.Handle.IsCompleted) {
            $timerSender.Stop()
            try {
                $output = $t.PS.EndInvoke($t.Handle)
                $json = [string]($output | Select-Object -Last 1)
                if ($json -and $null -ne $global:WebViewControl.CoreWebView2) {
                    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
                    $global:WebViewControl.CoreWebView2.PostWebMessageAsString([Convert]::ToBase64String($bytes))
                }
            } catch {
                $errJson = @{ type = $t.FallbackType; error = $_.Exception.Message } | ConvertTo-Json -Compress
                if ($null -ne $global:WebViewControl.CoreWebView2) {
                    $bytes = [System.Text.Encoding]::UTF8.GetBytes($errJson)
                    $global:WebViewControl.CoreWebView2.PostWebMessageAsString([Convert]::ToBase64String($bytes))
                }
            } finally {
                try { $t.PS.Dispose() } catch {}
                try { $timerSender.Dispose() } catch {}
                $null = $global:ActiveTabTasks.Remove($t)
            }
        }
    })
    $timer.Start()
}

# =========================================================================
# UNIFIED HOST UI MESSAGE DESERIALIZATION & COMMAND HANDLER LOOP
# =========================================================================
$HandleUiMessageEvent = {
    param($evtSource, $evtArgs)
    $RawMessage = $evtArgs.TryGetWebMessageAsString()
    if ($null -eq $RawMessage) { return }
    
    switch -regex ($RawMessage) {
        '^Exit-App$'      { $MainForm.Close() }
        '^Minimize-App$'  { $MainForm.WindowState = [System.Windows.Forms.FormWindowState]::Minimized }
        '^Maximize-App$'  { $MainForm.WindowState = if ($MainForm.WindowState -eq [System.Windows.Forms.FormWindowState]::Maximized) { [System.Windows.Forms.FormWindowState]::Normal } else { [System.Windows.Forms.FormWindowState]::Maximized } }
        
        '^\s*UI-Ready\s*$' {
            if (-not $global:TelemetryLoopTimer.Enabled) { $global:TelemetryLoopTimer.Start() }
            # Immediately push any already-sampled telemetry so startup is instant
            & $global:FlushTelemetryToUi
        }
        '^Active-View:(.+)$' {
            $viewKey = $Matches[1].Trim()
            $global:SharedData.ActiveView = $viewKey
            if ($viewKey -eq 'dashboard') {
                $global:SharedData.ForceRefresh = $true
                & $global:FlushTelemetryToUi
            }
        }
        '^Request-Adapters$' {
            try {
                . (Join-Path $Global:NodeWatchRoot "modules\tabs\NetworkManager.ps1")
                $Data = Get-AdapterStateMesh
            } catch { $Data = @{ type = 'REFRESH_ADAPTER_STATE'; interfaces = @(); error = $_.Exception.Message } }
            $Json = $Data | ConvertTo-Json -Compress -Depth 10
            $global:WebViewControl.CoreWebView2.PostWebMessageAsString([Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($Json)))
        }
        '^Request-StartupApps$' {
            try {
                . (Join-Path $Global:NodeWatchRoot "modules\tabs\StartupManager.ps1")
                $Data = Get-StartupAppsMesh
            } catch { $Data = @{ type = 'REFRESH_STARTUP_APPS'; apps = @(); error = $_.Exception.Message } }
            $Json = $Data | ConvertTo-Json -Compress -Depth 5
            $global:WebViewControl.CoreWebView2.PostWebMessageAsString([Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($Json)))
        }
        '^Request-Shares$' {
            try {
                . (Join-Path $Global:NodeWatchRoot 'modules\tabs\SharingManager.ps1')
                $Data = Get-SharingCenterState
            } catch { $Data = @{ type = 'SHARING_CENTER'; shares = @(); error = $_.Exception.Message } }
            $Json = $Data | ConvertTo-Json -Compress -Depth 5
            $global:WebViewControl.CoreWebView2.PostWebMessageAsString([Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($Json)))
        }
        '^Request-InstalledApps$' {
            Start-AsyncTabTask -FallbackType "REFRESH_INSTALLED_APPS" -Arguments @($Global:NodeWatchRoot) -ScriptBlock {
                param($RootPath)
                . (Join-Path $RootPath "modules\tabs\InstalledAppsManager.ps1")
                $data = Get-InstalledAppsMesh
                return ($data | ConvertTo-Json -Compress -Depth 6)
            }
        }
        '^Request-SystemDevices$' {
            Start-AsyncTabTask -FallbackType "REFRESH_SYSTEM_DEVICES" -Arguments @($Global:NodeWatchRoot) -ScriptBlock {
                param($RootPath)
                . (Join-Path $RootPath "modules\tabs\DeviceManager.ps1")
                $data = Get-SystemDevicesMesh
                return ($data | ConvertTo-Json -Compress -Depth 6)
            }
        }
        '^Request-FileOrganizer$' {
            Start-AsyncTabTask -FallbackType "FILE_ORGANIZER_STATE" -Arguments @($Global:NodeWatchRoot) -ScriptBlock {
                param($RootPath)
                . (Join-Path $RootPath "modules\tabs\FileOrganizer.ps1")
                $data = Get-FileOrganizerState -RootPath $RootPath
                return ($data | ConvertTo-Json -Compress -Depth 6)
            }
        }
        '^Request-WslManager$' {
            Start-AsyncTabTask -FallbackType "WSL_NOTICE" -Arguments @($Global:NodeWatchRoot) -ScriptBlock {
                param($RootPath)
                . (Join-Path $RootPath "modules\tabs\WslManager.ps1")
                $data = Get-WslManagerState -IncludeOnlineCatalog
                return ($data | ConvertTo-Json -Compress -Depth 6)
            }
        }
        '^Request-TasksPorts$' {
            Start-AsyncTabTask -FallbackType "TASKS_PORTS_NOTICE" -Arguments @($Global:NodeWatchRoot) -ScriptBlock {
                param($RootPath)
                . (Join-Path $RootPath "modules\tabs\TasksPortsManager.ps1")
                $data = Get-TasksPortsSnapshot
                return ($data | ConvertTo-Json -Compress -Depth 6)
            }
        }
        '^Request-SecurityRepair$' {
            Start-AsyncTabTask -FallbackType "SECURITY_REPAIR_NOTICE" -Arguments @($Global:NodeWatchRoot) -ScriptBlock {
                param($RootPath)
                . (Join-Path $RootPath "modules\tabs\SecurityRepairManager.ps1")
                $data = Get-SecurityPostureSnapshot
                return ($data | ConvertTo-Json -Compress -Depth 6)
            }
        }
        '^Browse-SupportBundleZip$' {
            $sfd = New-Object System.Windows.Forms.SaveFileDialog
            $sfd.Title = "Save CoreWatch IT Support Bundle Archive"
            $sfd.Filter = "ZIP Support Bundle (*.zip)|*.zip|All Files (*.*)|*.*"
            $sfd.FileName = "CoreWatch_SupportBundle_$($env:COMPUTERNAME)_$(Get-Date -Format 'yyyyMMdd_HHmmss').zip"
            if ($sfd.ShowDialog($MainForm) -eq [System.Windows.Forms.DialogResult]::OK -and $sfd.FileName) {
                $resp = @{ type = "SUPPORT_BUNDLE_PATH_RESULT"; path = [string]$sfd.FileName } | ConvertTo-Json -Compress
                $global:WebViewControl.CoreWebView2.PostWebMessageAsString([Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($resp)))
            }
            $sfd.Dispose()
        }
        '^Browse-Folder:(.+)$' {
            $targetKey = $Matches[1]
            $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
            $dialog.Description = if ($targetKey -eq "dest") { "Select destination root folder for organized files" } elseif ($targetKey -eq "diagfolder") { "Select external program log folder for UltimaDiagX" } elseif ($targetKey -eq "wslinstalldir") { "Select installation folder for WSL virtual disk (ext4.vhdx)" } elseif ($targetKey -eq "diskmap") { "Select folder or drive to map visually in Disk Map" } else { "Select folder to include in File Organizer" }
            $dialog.UseDescriptionForTitle = $true
            $dialog.ShowNewFolderButton = $true
            if ($dialog.ShowDialog($MainForm) -eq [System.Windows.Forms.DialogResult]::OK -and $dialog.SelectedPath) {
                $resp = @{ type = "BROWSE_FOLDER_RESULT"; target = $targetKey; path = [string]$dialog.SelectedPath } | ConvertTo-Json -Compress
                $global:WebViewControl.CoreWebView2.PostWebMessageAsString([Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($resp)))
            }
            $dialog.Dispose()
        }
        '^Browse-WslImportFile$' {
            $fd = New-Object System.Windows.Forms.OpenFileDialog
            $fd.Title = "Select Linux Tarball (.tar) or Virtual Disk (.vhdx) to Import into WSL"
            $fd.Filter = "WSL Archives & Disks (*.tar;*.tar.gz;*.vhdx)|*.tar;*.tar.gz;*.vhdx|All Files (*.*)|*.*"
            if ($fd.ShowDialog($MainForm) -eq [System.Windows.Forms.DialogResult]::OK -and $fd.FileName) {
                $resp = @{ type = "WSL_BROWSE_IMPORT_RESULT"; path = [string]$fd.FileName } | ConvertTo-Json -Compress
                $global:WebViewControl.CoreWebView2.PostWebMessageAsString([Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($resp)))
            }
            $fd.Dispose()
        }
        '^Browse-WslExportFile:(.+)$' {
            $distroName = $Matches[1]
            $sfd = New-Object System.Windows.Forms.SaveFileDialog
            $sfd.Title = "Export WSL Distribution '$distroName' Backup Archive"
            $sfd.Filter = "Tar Archive (*.tar)|*.tar|All Files (*.*)|*.*"
            $sfd.FileName = "${distroName}_$(Get-Date -Format 'yyyyMMdd').tar"
            if ($sfd.ShowDialog($MainForm) -eq [System.Windows.Forms.DialogResult]::OK -and $sfd.FileName) {
                $resp = @{ type = "WSL_BROWSE_EXPORT_RESULT"; distro = $distroName; path = [string]$sfd.FileName } | ConvertTo-Json -Compress
                $global:WebViewControl.CoreWebView2.PostWebMessageAsString([Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($resp)))
            }
            $sfd.Dispose()
        }
        '^Browse-LogFile$' {
            $fd = New-Object System.Windows.Forms.OpenFileDialog
            $fd.Title = "Select External Program Log File for UltimaDiagX"
            $fd.Filter = "Log & Event Files (*.log;*.txt;*.evtx;*.err;*.out)|*.log;*.txt;*.evtx;*.err;*.out|All Files (*.*)|*.*"
            $fd.Multiselect = $true
            if ($fd.ShowDialog($MainForm) -eq [System.Windows.Forms.DialogResult]::OK -and $fd.FileNames) {
                $resp = @{ type = "BROWSE_LOGFILE_RESULT"; paths = @($fd.FileNames) } | ConvertTo-Json -Compress
                $global:WebViewControl.CoreWebView2.PostWebMessageAsString([Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($resp)))
            }
            $fd.Dispose()
        }
        '^Identify-Monitors$' {
            try {
                . (Join-Path $Global:NodeWatchRoot "modules\telemetry\GetDisplayMetrics.ps1")
                $mons = @(Get-DisplayMetrics)

                # Dispose any existing identify overlays cleanly
                if ($null -ne $global:IdentifyOverlayTimer) {
                    $global:IdentifyOverlayTimer.Stop()
                    $global:IdentifyOverlayTimer.Dispose()
                    $global:IdentifyOverlayTimer = $null
                }
                if ($null -ne $global:IdentifyOverlayForms) {
                    foreach ($f in @($global:IdentifyOverlayForms)) { try { $f.Close(); $f.Dispose() } catch {} }
                }
                $global:IdentifyOverlayForms = New-Object System.Collections.ArrayList

                foreach ($m in $mons) {
                    $badge = New-Object System.Windows.Forms.Form
                    $badge.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
                    $badge.StartPosition   = [System.Windows.Forms.FormStartPosition]::Manual
                    $badge.ShowInTaskbar   = $false
                    $badge.TopMost         = $true
                    $badge.BackColor       = [System.Drawing.Color]::FromArgb(26, 32, 44)
                    $badge.Size            = New-Object System.Drawing.Size(220, 140)
                    $badge.Opacity         = 0.94

                    $posX = [int]$m.BoundsX + 36
                    $posY = [int]$m.BoundsY + [int]$m.BoundsHeight - 185
                    if ($posY -lt [int]$m.BoundsY + 20) { $posY = [int]$m.BoundsY + 20 }
                    $badge.Location = New-Object System.Drawing.Point($posX, $posY)

                    $borderPanel = New-Object System.Windows.Forms.Panel
                    $borderPanel.Dock = "Fill"
                    $borderPanel.BackColor = [System.Drawing.Color]::FromArgb(66, 153, 225)
                    $borderPanel.Padding = New-Object System.Windows.Forms.Padding(2)

                    $innerPanel = New-Object System.Windows.Forms.Panel
                    $innerPanel.Dock = "Fill"
                    $innerPanel.BackColor = [System.Drawing.Color]::FromArgb(26, 32, 44)

                    $numLbl = New-Object System.Windows.Forms.Label
                    $numLbl.Text      = [string]$m.DisplayNumber
                    $numLbl.ForeColor = [System.Drawing.Color]::White
                    $numLbl.Font      = New-Object System.Drawing.Font("Segoe UI", 52, [System.Drawing.FontStyle]::Bold)
                    $numLbl.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
                    $numLbl.Dock      = "Fill"

                    $nameLbl = New-Object System.Windows.Forms.Label
                    $nameLbl.Text      = if ($m.IsPrimary) { "$($m.FriendlyName) (Primary)" } else { [string]$m.FriendlyName }
                    $nameLbl.ForeColor = [System.Drawing.Color]::FromArgb(144, 205, 244)
                    $nameLbl.Font      = New-Object System.Drawing.Font("Consolas", 8.5, [System.Drawing.FontStyle]::Bold)
                    $nameLbl.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
                    $nameLbl.Dock      = "Bottom"
                    $nameLbl.Height    = 24

                    $innerPanel.Controls.Add($numLbl)
                    $innerPanel.Controls.Add($nameLbl)
                    $borderPanel.Controls.Add($innerPanel)
                    $badge.Controls.Add($borderPanel)
                    $badge.Show()
                    $null = $global:IdentifyOverlayForms.Add($badge)
                }

                $global:IdentifyOverlayTimer = New-Object System.Windows.Forms.Timer
                $global:IdentifyOverlayTimer.Interval = 2600
                $global:IdentifyOverlayTimer.Add_Tick({
                    $global:IdentifyOverlayTimer.Stop()
                    $global:IdentifyOverlayTimer.Dispose()
                    $global:IdentifyOverlayTimer = $null
                    if ($null -ne $global:IdentifyOverlayForms) {
                        foreach ($f in @($global:IdentifyOverlayForms)) { try { $f.Close(); $f.Dispose() } catch {} }
                        $global:IdentifyOverlayForms.Clear()
                    }
                })
                $global:IdentifyOverlayTimer.Start()
            } catch {}
        }
        '^Execute-SpeedTest$' {
            if ($global:SpeedTestRunning) { return }
            $global:SpeedTestRunning = $true

            $global:SpeedTestPipeline = [powershell]::Create()
            $null = $global:SpeedTestPipeline.AddScript({
                param($RootPath)
                . (Join-Path $RootPath "modules\telemetry\NetworkTest.ps1")
                $results = Get-NetworkSpeedTest
                return ($results | ConvertTo-Json -Compress)
            }).AddArgument($Global:NodeWatchRoot)

            $global:SpeedTestAsyncHandle = $global:SpeedTestPipeline.BeginInvoke()

            $global:SpeedTestTimer = New-Object System.Windows.Forms.Timer
            $global:SpeedTestTimer.Interval = 200
            $global:SpeedTestTimer.Add_Tick({
                if ($null -ne $global:SpeedTestAsyncHandle -and $global:SpeedTestAsyncHandle.IsCompleted) {
                    $global:SpeedTestTimer.Stop()
                    try {
                        $output = $global:SpeedTestPipeline.EndInvoke($global:SpeedTestAsyncHandle)
                        $json = [string]$output
                        if ($json -and $null -ne $global:WebViewControl.CoreWebView2) {
                            $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
                            $global:WebViewControl.CoreWebView2.PostWebMessageAsString([Convert]::ToBase64String($bytes))
                        }
                    } catch {
                        $errJson = @{ type = "SPEED_TEST_RESULTS"; Latency = "ERR"; Download = "ERR"; Upload = "ERR"; Error = $_.Exception.Message } | ConvertTo-Json -Compress
                        if ($null -ne $global:WebViewControl.CoreWebView2) {
                            $bytes = [System.Text.Encoding]::UTF8.GetBytes($errJson)
                            $global:WebViewControl.CoreWebView2.PostWebMessageAsString([Convert]::ToBase64String($bytes))
                        }
                    } finally {
                        if ($null -ne $global:SpeedTestPipeline) { $global:SpeedTestPipeline.Dispose(); $global:SpeedTestPipeline = $null }
                        $global:SpeedTestAsyncHandle = $null
                        if ($null -ne $global:SpeedTestTimer) { $global:SpeedTestTimer.Dispose(); $global:SpeedTestTimer = $null }
                        $global:SpeedTestRunning = $false
                    }
                }
            })
            $global:SpeedTestTimer.Start()
        }
        '^Window-DragStart$' {
            $null = [CoreWatch.Win32]::ReleaseCapture()
            $null = [CoreWatch.Win32]::SendMessage($MainForm.Handle, [CoreWatch.Win32]::WM_NCLBUTTONDOWN, [IntPtr]2, [IntPtr]::Zero)
        }
        '^Window-ResizeHit:(\d+)$' {
            $hitCode = [int]$Matches[1]
            # Native Win32 HTLEFT(10)..HTBOTTOMRIGHT(17)
            if ($hitCode -ge 10 -and $hitCode -le 17) {
                $null = [CoreWatch.Win32]::ReleaseCapture()
                $null = [CoreWatch.Win32]::SendMessage($MainForm.Handle, [CoreWatch.Win32]::WM_NCLBUTTONDOWN, [IntPtr]$hitCode, [IntPtr]::Zero)
            }
        }
        '^Window-Drag:(.+)' {
            $Delta = $Matches[1].Split('|')
            if ($Delta.Count -eq 2) {
                $CursorPos = [System.Windows.Forms.Cursor]::Position
                $MainForm.Location = New-Object System.Drawing.Point(($CursorPos.X - [int]$Delta[0]), ($CursorPos.Y - [int]$Delta[1]))
            }
        }
        '^Window-Resize:(.+)' {
            $Dimensions = $Matches[1].Split('|')
            if ($Dimensions.Count -eq 2) {
                $Width  = [Math]::Max($script:MinWindowWidth,  [Math]::Min($script:MaxWindowWidth,  [int]$Dimensions[0]))
                $Height = [Math]::Max($script:MinWindowHeight, [Math]::Min($script:MaxWindowHeight, [int]$Dimensions[1]))
                $MainForm.Size = New-Object System.Drawing.Size($Width, $Height)
            }
        }
        '^Rename-Drive:(.+)' {
            $Payload = $Matches[1]; $SplitIndex = $Payload.IndexOf('|')
            if ($SplitIndex -gt 0) {
                . (Join-Path $Global:NodeWatchRoot "modules\telemetry\StorageEngine.ps1")
                Set-StorageLabel -DriveLetter ($Payload.Substring(0, $SplitIndex)) -NewLabel ($Payload.Substring($SplitIndex + 1))
            }
        }
        Default {
            if ($RawMessage -match '\{.*"command".*\}') {
                try {
                    $Payload = $RawMessage | ConvertFrom-Json
                    if ($Payload.command -in @('CREATE_SHARE', 'REMOVE_SHARE', 'DELETE_SHARED_FOLDER', 'GRANT_SHARE_ACCESS', 'REMOVE_SHARE_ACCESS')) {
                        try {
                            . (Join-Path $Global:NodeWatchRoot 'modules\tabs\SharingManager.ps1')
                            Invoke-SharingCenterAction -Payload $Payload
                            $Data = Get-SharingCenterState
                            $Data.message = 'Sharing action completed.'
                        } catch {
                            $Data = @{ type = 'SHARING_CENTER'; shares = $null; error = $_.Exception.Message }
                        }
                        $Json = $Data | ConvertTo-Json -Compress -Depth 5
                        $global:WebViewControl.CoreWebView2.PostWebMessageAsString([Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($Json)))
                        return
                    }

                    if ($Payload.command -in @('REMOVE_STARTUP_APP', 'CREATE_STARTUP_APP', 'TOGGLE_STARTUP_APP', 'OPEN_FILE_LOCATION')) {
                        try {
                            . (Join-Path $Global:NodeWatchRoot "modules\tabs\StartupManager.ps1")
                            $Data = Invoke-StartupAppAction -Payload $Payload
                        } catch {
                            $Data = @{ type = 'REFRESH_STARTUP_APPS'; apps = @(); error = $_.Exception.Message }
                        }
                        $Json = $Data | ConvertTo-Json -Compress -Depth 5
                        $global:WebViewControl.CoreWebView2.PostWebMessageAsString([Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($Json)))
                        return
                    }

                    if ($Payload.command -match "SET_STATIC_IP|TRIGGER_DHCP_REVERSION|RENAME_ADAPTER|TOGGLE_ADAPTER_STATE|SET_CUSTOM_DNS|FLUSH_DNS_CACHE|RESTART_ADAPTER") {
                        $NetTabPath = Join-Path $Global:NodeWatchRoot "modules\tabs\NetworkManager.ps1"
                        if (Test-Path $NetTabPath) {
                            . $NetTabPath
                            $UpdateMesh = Invoke-AdapterProvisioningControl -Payload $Payload
                            $global:SharedData.ForceRefresh = $true
                            $Json = $UpdateMesh | ConvertTo-Json -Compress -Depth 10
                            $global:WebViewControl.CoreWebView2.PostWebMessageAsString([Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($Json)))
                        }
                        return
                    }

                    if ($Payload.command -in @('UNINSTALL_APP', 'MODIFY_APP', 'MOVE_APP', 'OPEN_APP_FOLDER', 'OPEN_APP_REGISTRY', 'CALC_APP_SIZE')) {
                        Start-AsyncTabTask -FallbackType "REFRESH_INSTALLED_APPS" -Arguments @($Global:NodeWatchRoot, $RawMessage) -ScriptBlock {
                            param($RootPath, $RawJson)
                            . (Join-Path $RootPath "modules\tabs\InstalledAppsManager.ps1")
                            $data = Invoke-InstalledAppAction -Payload $RawJson
                            return ($data | ConvertTo-Json -Compress -Depth 6)
                        }
                        return
                    }

                    if ($Payload.command -in @('RESCAN_HARDWARE', 'OPEN_NATIVE_DEVMGMT', 'OPEN_DRIVER_INF', 'TOGGLE_DEVICE_STATE', 'RESTART_DEVICE', 'OPEN_DRIVER_URL')) {
                        Start-AsyncTabTask -FallbackType "REFRESH_SYSTEM_DEVICES" -Arguments @($Global:NodeWatchRoot, $RawMessage) -ScriptBlock {
                            param($RootPath, $RawJson)
                            . (Join-Path $RootPath "modules\tabs\DeviceManager.ps1")
                            $data = Invoke-DeviceManagerAction -Payload $RawJson
                            return ($data | ConvertTo-Json -Compress -Depth 6)
                        }
                        return
                    }

                    if ($Payload.command -in @('APPSTORE_LOAD', 'APPSTORE_INSTALL_ONE', 'APPSTORE_INSTALL_BATCH', 'APPSTORE_UPGRADE_ALL', 'APPSTORE_SEARCH_WINGET', 'APPSTORE_OPEN_URL')) {
                        Start-AsyncTabTask -FallbackType "APPSTORE_NOTICE" -Arguments @($Global:NodeWatchRoot, $RawMessage) -ScriptBlock {
                            param($RootPath, $RawJson)
                            . (Join-Path $RootPath "modules\tabs\AppInstallerManager.ps1")
                            $data = Invoke-AppInstallerAction -Payload $RawJson -RootPath $RootPath
                            return ($data | ConvertTo-Json -Compress -Depth 6)
                        }
                        return
                    }

                    if ($Payload.command -in @('DISKMAP_LIST_DRIVES', 'DISKMAP_SCAN', 'DISKMAP_OPEN_EXPLORER', 'DISKMAP_RECYCLE')) {
                        Start-AsyncTabTask -FallbackType "DISKMAP_NOTICE" -Arguments @($Global:NodeWatchRoot, $RawMessage) -ScriptBlock {
                            param($RootPath, $RawJson)
                            . (Join-Path $RootPath "modules\tabs\DiskMapper.ps1")
                            $data = Invoke-DiskMapperAction -Payload $RawJson
                            return ($data | ConvertTo-Json -Compress -Depth 12)
                        }
                        return
                    }

                    if ($Payload.command -in @('PREVIEW_ORGANIZE', 'EXECUTE_ORGANIZE', 'UNDO_ORGANIZE', 'OPEN_ORGANIZER_FOLDER')) {
                        Start-AsyncTabTask -FallbackType "FILE_ORGANIZER_ERROR" -Arguments @($Global:NodeWatchRoot, $RawMessage) -ScriptBlock {
                            param($RootPath, $RawJson)
                            . (Join-Path $RootPath "modules\tabs\FileOrganizer.ps1")
                            $data = Invoke-FileOrganizerAction -Payload $RawJson -RootPath $RootPath
                            return ($data | ConvertTo-Json -Compress -Depth 6)
                        }
                        return
                    }

                    if ($Payload.command -in @('RUN_DIAGNOSTIC', 'TRANSLATE_CODE', 'DISCOVER_APP_LOGS', 'EXPORT_DIAG_REPORT', 'OPEN_EVENT_VIEWER', 'OPEN_RELIABILITY_MONITOR', 'OPEN_DUMP_LOCATION')) {
                        Start-AsyncTabTask -FallbackType "ULTIMADIAGX_NOTICE" -Arguments @($Global:NodeWatchRoot, $RawMessage) -ScriptBlock {
                            param($RootPath, $RawJson)
                            . (Join-Path $RootPath "modules\tabs\UltimaDiagX.ps1")
                            $data = Invoke-UltimaDiagXAction -Payload $RawJson -RootPath $RootPath
                            return ($data | ConvertTo-Json -Compress -Depth 7)
                        }
                        return
                    }

                    if ($Payload.command -in @(
                        'WSL_LOAD_ONLINE_CATALOG', 'WSL_INSTALL_ENGINE', 'WSL_UPDATE_ENGINE',
                        'WSL_SHUTDOWN_ALL', 'WSL_SET_DEFAULT_VERSION', 'WSL_DEPLOY_DISTRO',
                        'WSL_LAUNCH_DISTRO', 'WSL_EXPLORE_DISTRO', 'WSL_TERMINATE_DISTRO',
                        'WSL_SET_DEFAULT_DISTRO', 'WSL_CONVERT_VERSION', 'WSL_UNREGISTER_DISTRO',
                        'WSL_EXPORT_DISTRO', 'WSL_IMPORT_DISTRO', 'WSL_COMPACT_VHDX',
                        'WSL_SAVE_CONFIG', 'WSL_OPEN_CONFIG_FILE', 'WSL_RUN_COMMAND'
                    )) {
                        Start-AsyncTabTask -FallbackType "WSL_NOTICE" -Arguments @($Global:NodeWatchRoot, $RawMessage) -ScriptBlock {
                            param($RootPath, $RawJson)
                            . (Join-Path $RootPath "modules\tabs\WslManager.ps1")
                            $data = Invoke-WslManagerAction -RawJson $RawJson
                            return ($data | ConvertTo-Json -Compress -Depth 6)
                        }
                        return
                    }

                    if ($Payload.command -in @(
                        'SEC_TOGGLE_RDP', 'SEC_TOGGLE_TASK',
                        'SEC_LOAD_ENV_HOSTS_PROXY', 'SEC_TOGGLE_PROXY', 'SEC_OPEN_HOSTS_FILE',
                        'REPAIR_DISM_CHECK', 'REPAIR_DISM_RESTORE_TERM', 'REPAIR_SFC_TERM',
                        'REPAIR_WU_RESET', 'REPAIR_NET_STACK_RESET', 'REPAIR_WINGET_CHECK',
                        'REPAIR_BATTERY_REPORT', 'REPAIR_CLEAN_TEMP', 'EXPORT_SUPPORT_BUNDLE'
                    )) {
                        Start-AsyncTabTask -FallbackType "SECURITY_REPAIR_NOTICE" -Arguments @($Global:NodeWatchRoot, $RawMessage) -ScriptBlock {
                            param($RootPath, $RawJson)
                            . (Join-Path $RootPath "modules\tabs\SecurityRepairManager.ps1")
                            $data = Invoke-SecurityRepairAction -RawJson $RawJson -RootPath $RootPath
                            return ($data | ConvertTo-Json -Compress -Depth 6)
                        }
                        return
                    }

                    if ($Payload.command -in @(
                        'NET_DIAG_PING', 'NET_DIAG_TRACEROUTE', 'NET_DIAG_PORT_TEST',
                        'NET_DIAG_DNS_LOOKUP', 'NET_DIAG_WIFI_AND_ROUTES'
                    )) {
                        Start-AsyncTabTask -FallbackType "NET_DIAG_ERROR" -Arguments @($Global:NodeWatchRoot, $RawMessage) -ScriptBlock {
                            param($RootPath, $RawJson)
                            . (Join-Path $RootPath "modules\tabs\NetworkDiagnostics.ps1")
                            $data = Invoke-NetworkDiagnosticAction -RawJson $RawJson
                            return ($data | ConvertTo-Json -Compress -Depth 6)
                        }
                        return
                    }

                    if ($Payload.command -in @(
                        'TP_KILL_PROCESS', 'TP_OPEN_PROCESS_LOCATION',
                        'TP_SERVICE_ACTION', 'TP_SERVICE_STARTUP'
                    )) {
                        Start-AsyncTabTask -FallbackType "TASKS_PORTS_NOTICE" -Arguments @($Global:NodeWatchRoot, $RawMessage) -ScriptBlock {
                            param($RootPath, $RawJson)
                            . (Join-Path $RootPath "modules\tabs\TasksPortsManager.ps1")
                            $data = Invoke-TasksPortsAction -RawJson $RawJson
                            return ($data | ConvertTo-Json -Compress -Depth 6)
                        }
                        return
                    }

                    # =========================================================================
                    # [DYNAMIC CONTROL] UNIFIED ON/OFF TOGGLES & QUICK DASHBOARD ACTIONS
                    # =========================================================================
                    if ($Payload.command -in @(
                        'TOGGLE_TELEMETRY', 'TOGGLE_FIREWALL', 'TOGGLE_REALTIME',
                        'OPEN_TAMPER_SETTINGS', 'TOGGLE_BEHAVIOR_MONITOR', 'TOGGLE_CLOUD_PROTECTION', 'TOGGLE_IOAV_PROTECTION',
                        'TOGGLE_DISCOVERY', 'TOGGLE_SHARING', 'TOGGLE_NET_PROFILE',
                        'SET_QUICK_DNS', 'FLUSH_AND_TEST_DNS', 'REFRESH_ARP_GATEWAY',
                        'TOGGLE_HDR', 'TOGGLE_NIGHT_LIGHT', 'SET_NIGHT_LIGHT_STRENGTH',
                        'SET_MONITOR_REFRESH_RATE', 'SET_MONITOR_SCALE', 'SET_MONITOR_ORIENTATION',
                        'END_TOP_PROCESS', 'TRIGGER_SYSTEM_REBOOT', 'INSTALL_PAWNIO', 'SET_PRIMARY_JAVA',
                        'CHECK_PS_UPDATE', 'INSTALL_PS_UPDATE'
                    )) {
                        Start-AsyncTabTask -FallbackType "DASHBOARD_CONTROL_RESULT" -Arguments @($Global:NodeWatchRoot, $RawMessage, $global:SharedData) -ScriptBlock {
                            param($RootPath, $RawJson, $SharedData)
                            . (Join-Path $RootPath "modules\telemetry\DashboardControls.ps1")
                            $res = Invoke-DashboardControlAction -RawJson $RawJson -RootPath $RootPath
                            $SharedData.ForceRefresh = $true
                            return ($res | ConvertTo-Json -Compress -Depth 4)
                        }
                        return
                    }

                    if ($Payload.command -eq "RELAUNCH_AS_ADMIN") {
                        try {
                            $pwshExe = (Get-Process -Id $PID).MainModule.FileName
                            $scriptPath = Join-Path $Global:NodeWatchRoot "Start-NodeWatch.ps1"
                            Start-Process -FilePath $pwshExe -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$scriptPath`"") -Verb RunAs -ErrorAction Stop
                            $MainForm.Close()
                        } catch {
                            $errJson = @{ type = "DASHBOARD_CONTROL_RESULT"; ok = $false; control = "RELAUNCH_AS_ADMIN"; message = "Elevation canceled or failed: $($_.Exception.Message)" } | ConvertTo-Json -Compress
                            $global:WebViewControl.CoreWebView2.PostWebMessageAsString([Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($errJson)))
                        }
                        return
                    }

                    if ($Payload.command -eq "SET_POWER_PLAN") {
                        $TargetGuid = $Payload.guid
                        if ($TargetGuid -eq "e9a42b02-d5df-448d-aa00-03f14749eb61") {
                            $Existing = powercfg /l | Select-String "Ultimate Performance"
                            if ($Existing -and $Existing.ToString() -match "([a-z0-9]{8}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{12})") {
                                $TargetGuid = $Matches[1]
                            } else {
                                $NewScheme = powercfg -duplicatescheme e9a42b02-d5df-448d-aa00-03f14749eb61
                                if ($NewScheme -match "([a-z0-9]{8}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{12})") {
                                    $TargetGuid = $Matches[1]
                                }
                            }
                        }
                        powercfg /setactive $TargetGuid
                        $global:SharedData.ForceRefresh = $true
                        return
                    }

                    if ($Payload.command -eq "DISABLE_TELEMETRY") {
                        Stop-Service -Name DiagTrack, dmwappushservice -Force -ErrorAction SilentlyContinue
                        Set-Service -Name DiagTrack, dmwappushservice -StartupType Disabled -ErrorAction SilentlyContinue
                        $global:SharedData.ForceRefresh = $true
                        return
                    }

                    if ($Payload.command -eq "RENAME_COMPUTER") {
                        Rename-Computer -NewName $Payload.newName -Force -Confirm:$false -ErrorAction SilentlyContinue
                        return
                    }
                    if ($Payload.command -eq "RENAME_WORKGROUP") {
                        Add-Computer -WorkgroupName $Payload.newName -Force -Confirm:$false -ErrorAction SilentlyContinue
                        return
                    }
                } catch {
                    Write-Warning "Failed to dispatch JSON command frame: $_"
                }
            }
        }
    }
}
# =========================================================================
# DESKTOP SYSTEM TRAY CONTROLLER AND RUNTIME HOOKS
# =========================================================================
$global:SystemTrayIcon = New-Object System.Windows.Forms.NotifyIcon
$global:SystemTrayIcon.Text = "CoreWatch Host Engine"
$global:SystemTrayIcon.Visible = $true
$global:SystemTrayIcon.Icon = if ($null -ne $TrayIconInstance) { $TrayIconInstance } else { $AppIconInstance }

$TrayContextMenu = New-Object System.Windows.Forms.ContextMenuStrip
$ExitMenuItem = $TrayContextMenu.Items.Add("Terminate Engine")
$ExitMenuItem.Add_Click({ $MainForm.Close() })
$global:SystemTrayIcon.ContextMenuStrip = $TrayContextMenu

$global:SystemTrayIcon.Add_Click({
    param($evtSource, $evtArgs)
    if ($evtArgs.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
        if ($MainForm.WindowState -eq [System.Windows.Forms.FormWindowState]::Minimized) { $MainForm.WindowState = [System.Windows.Forms.FormWindowState]::Normal }
        $MainForm.Activate()
    }
})

# =========================================================================
# VISIBILITY-AWARE THROTTLING & WEBVIEW2 SUSPEND ON MINIMIZE
# =========================================================================
$MainForm.Add_Resize({
    $isMin = ($MainForm.WindowState -eq [System.Windows.Forms.FormWindowState]::Minimized)
    if ($isMin -ne $global:SharedData.IsMinimized) {
        $global:SharedData.IsMinimized = $isMin
        if ($isMin) {
            if ($null -ne $global:TelemetryLoopTimer) { $global:TelemetryLoopTimer.Stop() }
            try {
                if ($null -ne $global:WebViewControl.CoreWebView2) {
                    $null = $global:WebViewControl.CoreWebView2.TrySuspendAsync()
                }
            } catch {}
            if ("CoreWatch.Win32" -as [type]) { [CoreWatch.Win32]::TrimWorkingSet() }
        } else {
            $global:SharedData.ForceRefresh = $true
            if ($null -ne $global:TelemetryLoopTimer -and -not $global:TelemetryLoopTimer.Enabled) {
                $global:TelemetryLoopTimer.Start()
            }
            & $global:FlushTelemetryToUi
        }
    }
})

# =========================================================================
# TEARDOWN & LIFECYCLE DESTRUCTOR CLEANUP ROUTINES
# =========================================================================
$MainForm.Add_FormClosing({
    if ($null -ne $global:SystemTrayIcon) { $global:SystemTrayIcon.Visible = $false; $global:SystemTrayIcon.Dispose() }
    if ($null -ne $TrayIconInstance) { $TrayIconInstance.Dispose() }
    if ($null -ne $IconHandle) { [CoreWatch.Win32]::DestroyIcon($IconHandle) }
    if ($null -ne $global:SpeedTestTimer) { $global:SpeedTestTimer.Stop(); $global:SpeedTestTimer.Dispose() }
    if ($null -ne $global:SpeedTestPipeline) { $global:SpeedTestPipeline.Dispose() }
    if ($null -ne $global:ActiveTabTasks) {
        foreach ($t in @($global:ActiveTabTasks)) {
            try { if ($t.Timer) { $t.Timer.Stop(); $t.Timer.Dispose() } } catch {}
            try { if ($t.PS) { $t.PS.Dispose() } } catch {}
        }
        $global:ActiveTabTasks.Clear()
    }
    if ($null -ne $global:IdentifyOverlayTimer) { $global:IdentifyOverlayTimer.Stop(); $global:IdentifyOverlayTimer.Dispose() }
    if ($null -ne $global:IdentifyOverlayForms) {
        foreach ($f in @($global:IdentifyOverlayForms)) { try { $f.Close(); $f.Dispose() } catch {} }
    }
    try {
        Get-Process -Name "CoreWatchSensorHelper" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    } catch {}
    $global:TelemetryLoopTimer.Stop()
    $global:SharedData.IsRunning = $false
    if ($null -ne $PowerShellPool) { $PowerShellPool.Dispose() }
    if ($null -ne $Runspace) { $Runspace.Close(); $Runspace.Dispose() }
})

# =========================================================================
# WEBVIEW2 WEB ENGINE PROVISIONING AND SYSTEM APPS LAUNCH (LEAN MEMORY PROFILE)
# =========================================================================
$FixedRuntimePath = Join-Path $BinPath "WebView2FixedRuntime"
$BrowserExecutableFolder = if (Test-Path $FixedRuntimePath) { [System.IO.Path]::GetFullPath($FixedRuntimePath) } else { $null }

$WebViewBrowserArgs = "--js-flags=--max-old-space-size=96 --disable-background-networking --disable-component-update --disable-domain-reliability --disable-features=Translate,OptimizationHints,MediaRouter"
$WebViewEnvOptions = $null
try {
    $WebViewEnvOptions = [Microsoft.Web.WebView2.Core.CoreWebView2EnvironmentOptions]::new($WebViewBrowserArgs, $null, $null, $false, $null)
} catch {
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $WebViewBrowserArgs
}

$EnvCreationTask = if ($null -ne $WebViewEnvOptions) {
    [Microsoft.Web.WebView2.Core.CoreWebView2Environment]::CreateAsync($BrowserExecutableFolder, $UserDataFolder, $WebViewEnvOptions)
} else {
    [Microsoft.Web.WebView2.Core.CoreWebView2Environment]::CreateAsync($BrowserExecutableFolder, $UserDataFolder)
}
while (-not $EnvCreationTask.IsCompleted) { [System.Windows.Forms.Application]::DoEvents(); [System.Threading.Thread]::Sleep(1) }
$WebViewEnvironment = $EnvCreationTask.Result

$global:WebViewControl.Add_CoreWebView2InitializationCompleted({
    param($evtSource, $evtArgs)
    if ($evtArgs.IsSuccess) {
        $global:WebViewControl.CoreWebView2.Settings.AreDefaultContextMenusEnabled = $false
        $global:WebViewControl.CoreWebView2.Settings.AreDevToolsEnabled = [bool]$Global:EnableDevTools
        $global:WebViewControl.Add_WebMessageReceived($HandleUiMessageEvent)
        $global:WebViewControl.Source = "file:///" + ((Join-Path $Global:NodeWatchRoot "modules\layouts\index.html") -replace '\\', '/')
    }
})

$null = $global:WebViewControl.EnsureCoreWebView2Async($WebViewEnvironment)
[System.Windows.Forms.Application]::Run($MainForm)
