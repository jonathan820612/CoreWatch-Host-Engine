# File: Start-NodeWatch.ps1
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

# dot-source EXACTLY based on your tree layout paths
$TelemetryPath = Join-Path $Global:NodeWatchRoot "modules\telemetry"
. (Join-Path $TelemetryPath "GetIDMetrics.ps1")
. (Join-Path $TelemetryPath "GetInfraMetrics.ps1")
. (Join-Path $TelemetryPath "GetNetworkMetrics.ps1")
. (Join-Path $TelemetryPath "GetSystemMetrics.ps1")
. (Join-Path $TelemetryPath "StorageEngine.ps1")

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
    try {
        $MasterObject = [PSCustomObject]@{
            IdentityFrame = Get-IDMetrics
            InfraFrame    = Get-InfraMetrics
            NetworkFrame  = Get-NetworkMetrics
            SystemFrame   = Get-SystemMetrics
            StorageFrame  = Get-StorageMetrics
            PipelineStatus = "SUCCESS"
        }

        if ($null -ne $global:WebViewControl.CoreWebView2) {
            $JsonPayload = $MasterObject | ConvertTo-Json -Compress
            $Bytes = [System.Text.Encoding]::UTF8.GetBytes($JsonPayload)
            $Base64Payload = [Convert]::ToBase64String($Bytes)
            $global:WebViewControl.CoreWebView2.PostWebMessageAsString($Base64Payload)
        }
    } catch {
        # Absorb drop frame traces on system closures
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
    # FIXED: Re-routed payload straight down into the StorageEngine controller functions
    elseif ($RawMessage -and $RawMessage.StartsWith("Rename-Drive:")) {
        $Payload = $RawMessage.Substring(13)
        $SplitIndex = $Payload.IndexOf('|')
        if ($SplitIndex -gt 0) {
            $TargetLetter = $Payload.Substring(0, $SplitIndex)
            $NewVolumeName = $Payload.Substring($SplitIndex + 1)

            # Clean call delegated down to the encapsulated storage module function
            Set-StorageLabel -DriveLetter $TargetLetter -NewLabel $NewVolumeName
        }
    }
}

$FixedRuntimePath = Join-Path $BinPath "WebView2FixedRuntime"
$BrowserExecutableFolder = if (Test-Path $FixedRuntimePath) { [System.IO.Path]::GetFullPath($FixedRuntimePath) } else { $null }

$EnvCreationTask = [Microsoft.Web.WebView2.Core.CoreWebView2Environment]::CreateAsync($BrowserExecutableFolder, $UserDataFolder)
while (-not $EnvCreationTask.IsCompleted) {
    [System.Windows.Forms.Application]::DoEvents()
    [System.Threading.Thread]::Sleep(10)
}
$WebViewEnvironment = $EnvCreationTask.Result

$InitializeTask = $global:WebViewControl.EnsureCoreWebView2Async($WebViewEnvironment)
while (-not $InitializeTask.IsCompleted) {
    [System.Windows.Forms.Application]::DoEvents()
    [System.Threading.Thread]::Sleep(10)
}

if ($null -ne $global:WebViewControl.CoreWebView2) {
    $global:WebViewControl.CoreWebView2.Settings.AreDefaultContextMenusEnabled = $false
    $global:WebViewControl.CoreWebView2.Settings.AreDevToolsEnabled = $true
    $global:WebViewControl.Add_WebMessageReceived($HandleUiMessageEvent)

    $global:WebViewControl.Source = "file:///" + ((Join-Path $Global:NodeWatchRoot "modules\layouts\index.html") -replace '\\', '/')

    $MainForm.Add_FormClosing({
        $global:TelemetryLoopTimer.Stop()
    })

    [System.Windows.Forms.Application]::Run($MainForm)
}
