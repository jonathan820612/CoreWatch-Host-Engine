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
            $SystemFrame = Get-SystemMetrics

            $MergedNetworkFrame = [PSCustomObject]@{
                IntIPv4       = [string]($StaticNet.IntIPv4 ?? "0.0.0.0")
                SubnetMask    = [string]($StaticNet.SubnetMask ?? "0.0.0.0")
                Gateway       = [string]($StaticNet.Gateway ?? "N/A")
                NetworkStatus = [string]($StaticNet.NetworkStatus ?? "Offline")
                WlanSsid      = [string]($StaticNet.WlanSsid ?? "None")
                ExtIPv4       = [string]($StaticNet.ExtIPv4 ?? "Resolving...")
                LinkCap       = [string]($StaticNet.LinkCap ?? "0 Mbps")
                Firewall      = [string]($StaticNet.Firewall ?? "Unknown")
                Realtime      = [string]($StaticNet.Realtime ?? "Unknown")
                Discovery     = [string]($StaticNet.Discovery ?? "Off")
                Sharing       = [string]($StaticNet.Sharing ?? "Off")
                lblEthDriver    = [string]($StaticNet.lblEthDriver ?? "Unknown")
                lblWifiDriver   = [string]($StaticNet.lblWifiDriver ?? "Unknown")
                NetAssignment   = [string]($StaticNet.NetAssignment ?? "DHCP")
                AdapterStatuses = @($StaticNet.AdapterStatuses)
                RxPct         = [int]($DynamicNet.RxPct ?? 0)
                TxPct         = [int]($DynamicNet.TxPct ?? 0)
                RxText        = [string]($DynamicNet.RxText ?? "0.00 KB/s")
                TxText        = [string]($DynamicNet.TxText ?? "0.00 KB/s")
            }

            $MasterObject = [PSCustomObject]@{
                IdentityFrame  = Get-IDMetrics
                InfraFrame     = Get-InfraMetrics
                NetworkFrame   = $MergedNetworkFrame
                SystemFrame    = $SystemFrame
                StorageFrame   = Get-StorageMetrics
                PipelineStatus = "SUCCESS"
            }
            $SharedData.JsonPayload = $MasterObject | ConvertTo-Json -Compress -Depth 5
        } catch {
            $SharedData.JsonPayload = @{ PipelineStatus = "LOOP_CRASH: $($_.Exception.Message)" } | ConvertTo-Json -Compress
        }
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
        
        '^\s*UI-Ready\s*$' {
            if (-not $global:TelemetryLoopTimer.Enabled) { $global:TelemetryLoopTimer.Start() }
            try {
                $LogManagerPath = Join-Path $Global:NodeWatchRoot "modules\tabs\NetworkManager.ps1"
                if (Test-Path $LogManagerPath) {
                    . $LogManagerPath
                    $RawMesh = Get-AdapterStateMesh
                    $JsonString = $RawMesh | ConvertTo-Json -Compress -Depth 10
                    if ($null -ne $global:WebViewControl.CoreWebView2) {
                        $Bytes = [System.Text.Encoding]::UTF8.GetBytes($JsonString)
                        $Base64String = [Convert]::ToBase64String($Bytes)
                        $global:WebViewControl.CoreWebView2.PostWebMessageAsString($Base64String)
                    }
                }
            } catch {
                Write-Error "NetworkManager failed: $_"
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
                            $Json = $UpdateMesh | ConvertTo-Json -Compress -Depth 10
                            $global:WebViewControl.CoreWebView2.PostWebMessageAsString([Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($Json)))
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
                        return
                    }

                    if ($Payload.command -eq "DISABLE_TELEMETRY") {
                        Stop-Service -Name DiagTrack, dmwappushservice -Force -ErrorAction SilentlyContinue
                        Set-Service -Name DiagTrack, dmwappushservice -StartupType Disabled -ErrorAction SilentlyContinue
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
# TEARDOWN & LIFECYCLE DESTRUCTOR CLEANUP ROUTINES
# =========================================================================
$MainForm.Add_FormClosing({
    if ($null -ne $global:SystemTrayIcon) { $global:SystemTrayIcon.Visible = $false; $global:SystemTrayIcon.Dispose() }
    if ($null -ne $TrayIconInstance) { $TrayIconInstance.Dispose() }
    if ($null -ne $IconHandle) { [CoreWatch.Win32]::DestroyIcon($IconHandle) }
    if ($null -ne $global:SpeedTestTimer) { $global:SpeedTestTimer.Stop(); $global:SpeedTestTimer.Dispose() }
    if ($null -ne $global:SpeedTestPipeline) { $global:SpeedTestPipeline.Dispose() }
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
