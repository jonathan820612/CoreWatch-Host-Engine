[CmdletBinding()]
param()

Clear-Host
$Global:NodeWatchRoot = $PSScriptRoot
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
$UserDataFolder = [System.IO.Path]::GetFullPath((Join-Path $BinPath "WebView2UserData"))
if (-not (Test-Path $UserDataFolder)) { $null = New-Item -ItemType Directory -Path $UserDataFolder -Force }
$env:WEBVIEW2_USER_DATA_FOLDER = $UserDataFolder

$global:SharedData = [hashtable]::Synchronized(@{ JsonPayload = $null; IsRunning = $true })

$RunspaceScript = {
    param($RootPath, $SharedData)
    $TelemetryPath = Join-Path $RootPath "modules\telemetry"
    . (Join-Path $TelemetryPath "GetIDMetrics.ps1")
    . (Join-Path $TelemetryPath "GetInfraMetrics.ps1")
    . (Join-Path $TelemetryPath "GetNetworkMetrics.ps1")
    . (Join-Path $TelemetryPath "GetTrafficMetrics.ps1")
    . (Join-Path $TelemetryPath "GetSystemMetrics.ps1")
    . (Join-Path $TelemetryPath "StorageEngine.ps1")

    while ($SharedData.IsRunning) {
        try {
            $StaticNet  = Get-NetworkMetrics
            $DynamicNet = . (Join-Path $TelemetryPath "GetTrafficMetrics.ps1")

            $MergedNetworkFrame = [PSCustomObject]@{
                IntIPv4       = [string]$StaticNet.IntIPv4
                SubnetMask    = [string]$StaticNet.SubnetMask
                Gateway       = [string]$StaticNet.Gateway
                NetworkStatus = [string]$StaticNet.NetworkStatus
                WlanSsid      = [string]$StaticNet.WlanSsid
                ExtIPv4       = [string]$StaticNet.ExtIPv4
                LinkCap       = [string]$StaticNet.LinkCap
                Discovery     = [string]$StaticNet.Discovery
                lblEthDriver  = [string]$StaticNet.lblEthDriver
                lblWifiDriver = [string]$StaticNet.lblWifiDriver
                NetAssignment = [string]$StaticNet.NetAssignment
                RxPct         = [int]$DynamicNet.RxPct
                TxPct         = [int]$DynamicNet.TxPct
                RxText        = [string]$DynamicNet.RxText
                TxText        = [string]$DynamicNet.TxText
            }

            $MasterObject = [PSCustomObject]@{
                IdentityFrame  = Get-IDMetrics
                InfraFrame     = Get-InfraMetrics
                NetworkFrame   = $MergedNetworkFrame
                SystemFrame    = Get-SystemMetrics
                StorageFrame   = Get-StorageMetrics
                PipelineStatus = "SUCCESS"
            }
            $SharedData.JsonPayload = $MasterObject | ConvertTo-Json -Compress
        } catch {}
        [System.Threading.Thread]::Sleep(1000)
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
$MainForm = New-Object System.Windows.Forms.Form
$MainForm.Text = "CoreWatch Host Engine Dashboard Framework"
$MainForm.Size = New-Object System.Drawing.Size(1000, 1000)
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

$SendEncodedPayload = {
    param($RawJsonObject)
    if ($null -ne $global:WebViewControl.CoreWebView2 -and $null -ne $RawJsonObject) {
        try {
            # Check if payload is already a JSON string to prevent double-serialization loops
            if ($RawJsonObject -is [string]) {
                $JsonString = $RawJsonObject
            } else {
                $JsonString = $RawJsonObject | ConvertTo-Json -Compress -Depth 5
            }
            $Bytes = [System.Text.Encoding]::UTF8.GetBytes($JsonString)
            $global:WebViewControl.CoreWebView2.PostWebMessageAsString([Convert]::ToBase64String($Bytes))
        } catch {}
    }
}

$global:TelemetryLoopTimer = New-Object System.Windows.Forms.Timer
$global:TelemetryLoopTimer.Interval = 1000
$global:TelemetryLoopTimer.Add_Tick({
    if ($null -ne $global:WebViewControl.CoreWebView2 -and $null -ne $global:SharedData.JsonPayload) {
        try {
            $Bytes = [System.Text.Encoding]::UTF8.GetBytes($global:SharedData.JsonPayload)
            $global:WebViewControl.CoreWebView2.PostWebMessageAsString([Convert]::ToBase64String($Bytes))
        } catch {}
    }
})

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
        '^UI-Ready$' {
            if (-not $global:TelemetryLoopTimer.Enabled) { $global:TelemetryLoopTimer.Start() }
            try {
                if (Test-Path (Join-Path $Global:NodeWatchRoot "modules\telemetry\NetworkManager.ps1")) {
                    . (Join-Path $Global:NodeWatchRoot "modules\telemetry\NetworkManager.ps1")
                    
                    # 1. Fetch raw uncompressed tracking object mesh
                    $RawMesh = Get-AdapterStateMesh
                    
                    # 2. Convert cleanly to single flat JSON payload block
                    $JsonString = $RawMesh | ConvertTo-Json -Compress -Depth 5
                    
                    # 3. FIXED: Convert cleanly to explicit Base64 string block to satisfy app.js
                    if ($null -ne $global:WebViewControl.CoreWebView2) {
                        $Bytes = [System.Text.Encoding]::UTF8.GetBytes($JsonString)
                        $Base64String = [Convert]::ToBase64String($Bytes)
                        $global:WebViewControl.CoreWebView2.PostWebMessageAsString($Base64String)
                    }
                }
            } catch {}
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
                $Width  = [int]$Dimensions[0]; $Height = [int]$Dimensions[1]
                if ($Width -gt 400 -and $Height -gt 400) { $MainForm.Size = New-Object System.Drawing.Size($Width, $Height) }
            }
        }
        '^Rename-Drive:(.+)' {
            $Payload = $Matches[1]; $SplitIndex = $Payload.IndexOf('|')
            if ($SplitIndex -gt 0) {
                . (Join-Path $Global:NodeWatchRoot "modules\telemetry\StorageEngine.ps1")
                Set-StorageLabel -DriveLetter ($Payload.Substring(0, $SplitIndex)) -NewLabel ($Payload.Substring($SplitIndex + 1))
            }
        }
        '^Launch-Tool:(.+)' {
            switch ($Matches[1]) {
                "Watchdog-Engine" {
                    $WatchdogPath = Join-Path $Global:NodeWatchRoot "modules\layouts\watchdog.html"
                    if (Test-Path $WatchdogPath) { Start-Process "msedge.exe" -ArgumentList "--app=`"$WatchdogPath`"", "--window-size=500,320" -ErrorAction SilentlyContinue }
                }
                "File-Organizer" { [System.Windows.MessageBox]::Show("File Organizer coming soon.", "CoreWatch") }
                "Port-Scanner"   { [System.Windows.MessageBox]::Show("Port Scanner coming soon.", "CoreWatch") }
            }
        }
        '^[\{\[]' {
            try {
                if (Test-Path (Join-Path $Global:NodeWatchRoot "modules\telemetry\NetworkManager.ps1")) {
                    . (Join-Path $Global:NodeWatchRoot "modules\telemetry\NetworkManager.ps1")
                    $UpdatedMesh = Invoke-AdapterProvisioningControl -PayloadMessageString $RawMessage
                    if ($null -ne $UpdatedMesh) {
                        & $SendEncodedPayload $UpdatedMesh
                    }
                }
            } catch {}
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
# TEARDOWN & LIFECYCLE DESTRUCTOR CLEANUP ROUTINES
# =========================================================================
$MainForm.Add_FormClosing({
    if ($null -ne $global:SystemTrayIcon) { $global:SystemTrayIcon.Visible = $false; $global:SystemTrayIcon.Dispose() }
    if ($null -ne $TrayIconInstance) { $TrayIconInstance.Dispose() }
    if ($null -ne $IconHandle) { [CoreWatch.Win32]::DestroyIcon($IconHandle) }
    $global:TelemetryLoopTimer.Stop()
    $global:SharedData.IsRunning = $false
    if ($null -ne $PowerShellPool) { $PowerShellPool.Dispose() }
    if ($null -ne $Runspace) { $Runspace.Close(); $Runspace.Dispose() }
})

# =========================================================================
# WEBVIEW2 WEB ENGINE PROVISIONING AND SYSTEM APPS LAUNCH
# =========================================================================
$FixedRuntimePath = Join-Path $BinPath "WebView2FixedRuntime"
$BrowserExecutableFolder = if (Test-Path $FixedRuntimePath) { [System.IO.Path]::GetFullPath($FixedRuntimePath) } else { $null }

$EnvCreationTask = [Microsoft.Web.WebView2.Core.CoreWebView2Environment]::CreateAsync($BrowserExecutableFolder, $UserDataFolder)
while (-not $EnvCreationTask.IsCompleted) { [System.Windows.Forms.Application]::DoEvents(); [System.Threading.Thread]::Sleep(1) }
$WebViewEnvironment = $EnvCreationTask.Result

$global:WebViewControl.Add_CoreWebView2InitializationCompleted({
    param($evtSource, $evtArgs)
    if ($evtArgs.IsSuccess) {
        $global:WebViewControl.CoreWebView2.Settings.AreDefaultContextMenusEnabled = $false
        $global:WebViewControl.CoreWebView2.Settings.AreDevToolsEnabled = $true
        $global:WebViewControl.Add_WebMessageReceived($HandleUiMessageEvent)
        $global:WebViewControl.Source = "file:///" + ((Join-Path $Global:NodeWatchRoot "modules\layouts\index.html") -replace '\\', '/')
    }
})

$null = $global:WebViewControl.EnsureCoreWebView2Async($WebViewEnvironment)
[System.Windows.Forms.Application]::Run($MainForm)
