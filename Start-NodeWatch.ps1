[CmdletBinding()]
param()

Clear-Host
$Global:NodeWatchRoot = $PSScriptRoot
$BinPath = Join-Path $Global:NodeWatchRoot "bin"
$CoreDll = Join-Path $BinPath "Microsoft.Web.WebView2.Core.dll"
$FormDll = Join-Path $BinPath "Microsoft.Web.WebView2.WinForms.dll"

# 1. Load Native WebView2 Infrastructure Assemblies
if ((Test-Path $CoreDll) -and (Test-Path $FormDll)) {
    $null = [System.Reflection.Assembly]::LoadFrom($CoreDll)
    $null = [System.Reflection.Assembly]::LoadFrom($FormDll)
} else { 
    Write-Error "Missing critical WebView2 Assembly components in bin folder."
    return 
}

Add-Type -AssemblyName System.Windows.Forms, System.Drawing

# 2. Configure Global User Data Folder Override
# This forces WebView2 to use your project directory, stopping the pwsh.exe permission crash
$UserDataFolder = [System.IO.Path]::GetFullPath((Join-Path $BinPath "WebView2UserData"))
if (-not (Test-Path $UserDataFolder)) {
    $null = New-Item -ItemType Directory -Path $UserDataFolder -Force
}
$env:WEBVIEW2_USER_DATA_FOLDER = $UserDataFolder

# 3. Dot-Source the Class Engine File Natively into Shell Memory
$MetricsEnginePath = Join-Path $Global:NodeWatchRoot "modules\telemetry\GetSystemMetrics.ps1"
if (Test-Path $MetricsEnginePath) { . $MetricsEnginePath } else { Write-Error "Metrics file not found"; return }

# Instantiate a live instance of the Class blueprint
$script:SystemEngineInstance = [SystemTelemetryEngine]::new()

# 4. Form Window Scaffolding Mesh
$MainForm = New-Object System.Windows.Forms.Form
$MainForm.Text = "CoreWatch Host Engine Dashboard Framework (Direct Bridge)"
$MainForm.Size = New-Object System.Drawing.Size(1000, 850)
$MainForm.StartPosition = "CenterScreen"
$MainForm.BackColor = [System.Drawing.Color]::FromArgb(26, 32, 44)

$global:WebViewControl = New-Object Microsoft.Web.WebView2.WinForms.WebView2
$global:WebViewControl.Dock = "Fill"
$MainForm.Controls.Add($global:WebViewControl)

# 5. Outbound JavaScript Window Event Message Pipeline Interceptor
$HandleUiMessageEvent = {
    param($sender, $eventArgs)
    $RawMessage = $eventArgs.TryGetWebMessageAsString()
    if ($RawMessage -eq "Exit-App") { $MainForm.Close() }
}

# 6. WebView2 Environment Handshake & Native Direct Object Binding
$MainForm.Add_Load({
    # Check if a custom fixed runtime folder exists; if not, pass $null to use the system-installed Edge Chromium runtime
    $FixedRuntimePath = Join-Path $BinPath "WebView2FixedRuntime"
    $BrowserExecutableFolder = if (Test-Path $FixedRuntimePath) { [System.IO.Path]::GetFullPath($FixedRuntimePath) } else { $null }

    $EnvCreationTask = [Microsoft.Web.WebView2.Core.CoreWebView2Environment]::CreateAsync($BrowserExecutableFolder, $UserDataFolder)
    
    $EnvCreationTask.GetAwaiter().OnCompleted([Action]{
        $InitializeTask = $global:WebViewControl.EnsureCoreWebView2Async($EnvCreationTask.Result)
        $InitializeTask.GetAwaiter().OnCompleted([Action]{
            
            if ($null -ne $global:WebViewControl.CoreWebView2) {
                # Framework Configs
                $global:WebViewControl.CoreWebView2.Settings.AreDefaultContextMenusEnabled = $false
                $global:WebViewControl.CoreWebView2.Settings.AreDevToolsEnabled = $true
                $global:WebViewControl.Add_WebMessageReceived($HandleUiMessageEvent)
                
                # THE DIRECT BRIDGE INTERFACE: Expose the Live Class Object directly to JS
                $global:WebViewControl.CoreWebView2.AddHostObjectToScript("hardware", $script:SystemEngineInstance)

                # Point the UI to the local index.html asset canvas
                $global:WebViewControl.Source = "file:///" + ((Join-Path $Global:NodeWatchRoot "modules\layouts\index.html") -replace '\\', '/')
            } else {
                [System.Windows.Forms.MessageBox]::Show("WebView2 runtime core failed to initialize completely.", "Core Failure")
            }
        })
    })
})

[System.Windows.Forms.Application]::Run($MainForm)
