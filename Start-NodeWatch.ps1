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
if (-not (Test-Path $UserDataFolder)) {
    $null = New-Item -ItemType Directory -Path $UserDataFolder -Force
}
$env:WEBVIEW2_USER_DATA_FOLDER = $UserDataFolder

# Create a Thread-Safe synchronized hash table to pass data safely across threads
$global:SharedData = [hashtable]::Synchronized(@{
    JsonPayload = $null
    IsRunning   = $true
})

# =========================================================================
# BACKGROUND WORKER RUNSPACE (THE BALANCING FIX)
# =========================================================================
$RunspaceScript = {
    param($RootPath, $SharedData)
    
    # Dot-source the heavy modules safely inside the worker thread session
    $TelemetryPath = Join-Path $RootPath "modules\telemetry"
    . (Join-Path $TelemetryPath "GetIDMetrics.ps1")
    . (Join-Path $TelemetryPath "GetInfraMetrics.ps1")
    . (Join-Path $TelemetryPath "GetNetworkMetrics.ps1")
    . (Join-Path $TelemetryPath "GetSystemMetrics.ps1")
    . (Join-Path $TelemetryPath "StorageEngine.ps1")

    while ($SharedData.IsRunning) {
        try {
            $MasterObject = [PSCustomObject]@{
                IdentityFrame  = Get-IDMetrics
                InfraFrame     = Get-InfraMetrics
                NetworkFrame   = Get-NetworkMetrics
                SystemFrame    = Get-SystemMetrics
                StorageFrame   = Get-StorageMetrics
                PipelineStatus = "SUCCESS"
            }
            # Serialize to string safely on the background thread
            $SharedData.JsonPayload = $MasterObject | ConvertTo-Json -Compress
        } catch {
            # Absorb transient worker query trace warnings drops safely
        }
        [System.Threading.Thread]::Sleep(1000) # Throttled iteration loop interval
    }
}

# Spin up and dispatch the pipeline worker thread
$Runspace = [runspacefactory]::CreateRunspace()
$Runspace.ApartmentState = "STA"
$Runspace.ThreadOptions = "ReuseThread"
$Runspace.Open()

$PowerShellPool = [powershell]::Create()
$PowerShellPool.Runspace = $Runspace
$null = $PowerShellPool.AddScript($RunspaceScript).AddArgument($Global:NodeWatchRoot).AddArgument($global:SharedData)
$BackgroundAsyncResult = $PowerShellPool.BeginInvoke()

# =========================================================================
# COMPACT MAIN UI TIMED DIPATCHER (LIGHTWEIGHT REFRESH ENGINE)
# =========================================================================
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
    # The UI Timer ONLY checks the thread-safe hashtable. No blocking queries are run here!
    if ($null -ne $global:WebViewControl.CoreWebView2 -and $null -ne $global:SharedData.JsonPayload) {
        try {
            $JsonPayload = $global:SharedData.JsonPayload
            $Bytes = [System.Text.Encoding]::UTF8.GetBytes($JsonPayload)
            $Base64Payload = [Convert]::ToBase64String($Bytes)
            $global:WebViewControl.CoreWebView2.PostWebMessageAsString($Base64Payload)
        } catch {
            # Absorb pipeline UI drops safely
        }
    }
})

$HandleUiMessageEvent = {
    param($sender, $eventArgs)
    $RawMessage = $eventArgs.TryGetWebMessageAsString()
    
    if ($RawMessage -eq "Exit-App") { 
        $MainForm.Close() 
    }
    elseif ($RawMessage -eq "UI-Ready") {
        if (-not $global:TelemetryLoopTimer.Enabled) {
            $global:TelemetryLoopTimer.Start()
        }
    }
    elseif ($RawMessage -and $RawMessage.StartsWith("Rename-Drive:")) {
        $Payload = $RawMessage.Substring(13)
        $SplitIndex = $Payload.IndexOf('|')
        if ($SplitIndex -gt 0) {
            $TargetLetter = $Payload.Substring(0, $SplitIndex)
            $NewVolumeName = $Payload.Substring($SplitIndex + 1)
            Set-StorageLabel -DriveLetter $TargetLetter -NewLabel $NewVolumeName
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

# Securely terminate background allocations when the frame exits
$MainForm.Add_FormClosing({
    $global:TelemetryLoopTimer.Stop()
    $global:SharedData.IsRunning = $false # Tell background loop to terminate
    if ($null -ne $PowerShellPool) {
        $PowerShellPool.Dispose()
    }
    if ($null -ne $Runspace) {
        $Runspace.Close()
        $Runspace.Dispose()
    }
})

$null = $global:WebViewControl.EnsureCoreWebView2Async($WebViewEnvironment)
[System.Windows.Forms.Application]::Run($MainForm)
