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
    # SAFE: Dot-source your new standalone metrics engine into the active thread footprint
    . (Join-Path $TelemetryPath "GetTrafficMetrics.ps1")
    . (Join-Path $TelemetryPath "GetSystemMetrics.ps1")
    . (Join-Path $TelemetryPath "StorageEngine.ps1")

    while ($SharedData.IsRunning) {
        try {
            # Execute both network asset scripts independently
            $StaticNet  = Get-NetworkMetrics
            # Change this specific line inside your orchestrator's while loop:
$DynamicNet = . (Join-Path $TelemetryPath "GetTrafficMetrics.ps1")


            # Merge the static settings and low-latency counters into one unified network frame
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
                
                # Appends the new traffic variables right where app.js expects them
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
$BackgroundAsyncResult = $PowerShellPool.BeginInvoke()

$MainForm = New-Object System.Windows.Forms.Form
$MainForm.Text = "CoreWatch Host Engine Dashboard Framework"
$MainForm.Size = New-Object System.Drawing.Size(1000, 1000)
$MainForm.StartPosition = "CenterScreen"
$MainForm.BackColor = [System.Drawing.Color]::FromArgb(26, 32, 44)

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
    param($sender, $eventArgs)
    $RawMessage = $eventArgs.TryGetWebMessageAsString()
    if ($null -eq $RawMessage) { return }
    
    if ($RawMessage -eq "Exit-App") { 
        $MainForm.Close() 
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
    # =========================================================================
    # MULTI-WINDOW DISPATCHER ROUTING HOOK FOR EXTERNAL UI TOOLS
    # =========================================================================
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
    param($sender, $eventArgs)
    if ($eventArgs.IsSuccess) {
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
