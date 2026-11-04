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

# FIXED: Suppressed unassigned memory tracking handler warning
$null = $PowerShellPool.BeginInvoke()

$MainForm = New-Object System.Windows.Forms.Form
$MainForm.Text = "CoreWatch Host Engine Dashboard Framework"
$MainForm.Size = New-Object System.Drawing.Size(1000, 1000)
$MainForm.StartPosition = "CenterScreen"
$MainForm.BackColor = [System.Drawing.Color]::FromArgb(26, 32, 44)
$MainForm.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None

$global:IsFormDragging = $false
$global:FormDragCursorOffset = [System.Drawing.Point]::Empty

$MainForm.Add_MouseDown({
    param($evtSource, $evtArgs)
    # FIXED: Original variable used to intercept custom header dragging area
    if ($evtArgs.Button -eq [System.Windows.Forms.MouseButtons]::Left -and $evtArgs.Y -le 50) {
        $global:IsFormDragging = $true
        $global:FormDragCursorOffset = New-Object System.Drawing.Point($evtArgs.X, $evtArgs.Y)
    }
})

$MainForm.Add_MouseMove({
    param($evtSource, $evtArgs)
    if ($global:IsFormDragging) {
        $ScreenMousePos = [System.Windows.Forms.Cursor]::Position
        $MainForm.Location = New-Object System.Drawing.Point(
            ($ScreenMousePos.X - $global:FormDragCursorOffset.X), 
            ($ScreenMousePos.Y - $global:FormDragCursorOffset.Y)
        )
    }
})

$MainForm.Add_MouseUp({
    $global:IsFormDragging = $false
})

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

$HandleUiMessageEvent = {
    param($evtSource, $evtArgs)
    # FIXED: Original variable assignment avoids automatic parameter collisions
    $RawMessage = $evtArgs.TryGetWebMessageAsString()
    if ($null -eq $RawMessage) { return }
    
    if ($RawMessage -eq "Exit-App") { 
        $MainForm.Close() 
    }
    elseif ($RawMessage -eq "Minimize-App") {
        $MainForm.WindowState = [System.Windows.Forms.FormWindowState]::Minimized
    }
    elseif ($RawMessage -eq "Maximize-App") {
        if ($MainForm.WindowState -eq [System.Windows.Forms.FormWindowState]::Maximized) {
            $MainForm.WindowState = [System.Windows.Forms.FormWindowState]::Normal
        } else {
            $MainForm.WindowState = [System.Windows.Forms.FormWindowState]::Maximized
        }
    }
    elseif ($RawMessage.StartsWith("Window-Drag:")) {
        $Delta = $RawMessage.Substring(12).Split('|')
        if ($Delta.Count -eq 2) {
            $dx = [int]$Delta[0]
            $dy = [int]$Delta[1]
            $CursorPos = [System.Windows.Forms.Cursor]::Position
            $MainForm.Location = New-Object System.Drawing.Point(($CursorPos.X - $dx), ($CursorPos.Y - $dy))
        }
    }
    elseif ($RawMessage.StartsWith("Window-Resize:")) {
        $Dimensions = $RawMessage.Substring(14).Split('|')
        if ($Dimensions.Count -eq 2) {
            $Width = [int]$Dimensions[0]
            $Height = [int]$Dimensions[1]
            if ($Width -gt 400 -and $Height -gt 400) {
                $MainForm.Size = New-Object System.Drawing.Size($Width, $Height)
            }
        }
    }
    elseif ($RawMessage -eq "UI-Ready") {
        if (-not $global:TelemetryLoopTimer.Enabled) { $global:TelemetryLoopTimer.Start() }
    }
    elseif ($RawMessage.StartsWith("Rename-Drive:")) {
        $Payload = $RawMessage.Substring(13)
        $SplitIndex = $Payload.IndexOf('|')
        if ($SplitIndex -gt 0) {
            . (Join-Path $Global:NodeWatchRoot "modules\telemetry\StorageEngine.ps1")
            Set-StorageLabel -DriveLetter ($Payload.Substring(0, $SplitIndex)) -NewLabel ($Payload.Substring($SplitIndex + 1))
        }
    }
    elseif ($RawMessage.StartsWith("Launch-Tool:")) {
        $ToolType = $RawMessage.Substring(12)
        switch ($ToolType) {
            "Watchdog-Engine" {
                $WatchdogPath = Join-Path $Global:NodeWatchRoot "modules\layouts\watchdog.html"
                if (Test-Path $WatchdogPath) {
                    Start-Process "msedge.exe" -ArgumentList "--app=`"$WatchdogPath`"", "--window-size=500,320" -ErrorAction SilentlyContinue
                }
            }
            "File-Organizer" {
                [System.Windows.MessageBox]::Show("File Organizer window pipeline coming soon.", "CoreWatch System Tools")
            }
            "Port-Scanner" {
                [System.Windows.MessageBox]::Show("Port Scanner window pipeline coming soon.", "CoreWatch System Tools")
            }
        }
    }
}

$FixedRuntimePath = Join-Path $BinPath "WebView2FixedRuntime"
$BrowserExecutableFolder = if (Test-Path $FixedRuntimePath) { [System.IO.Path]::GetFullPath($FixedRuntimePath) } else { $null }

$EnvCreationTask = [Microsoft.Web.WebView2.Core.CoreWebView2Environment]::CreateAsync($BrowserExecutableFolder, $UserDataFolder)
while (-not $EnvCreationTask.IsCompleted) {
    [System.Windows.Forms.Application]::DoEvents()
    [System.Threading.Thread]::Sleep(1)
}
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

$MainForm.Add_FormClosing({
    $global:TelemetryLoopTimer.Stop()
    $global:SharedData.IsRunning = $false
    if ($null -ne $PowerShellPool) { $PowerShellPool.Dispose() }
    if ($null -ne $Runspace) { $Runspace.Close(); $Runspace.Dispose() }
})

$null = $global:WebViewControl.EnsureCoreWebView2Async($WebViewEnvironment)
[System.Windows.Forms.Application]::Run($MainForm)
