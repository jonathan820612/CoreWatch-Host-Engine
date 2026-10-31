[CmdletBinding()]
param()

Clear-Host
$Global:NodeWatchRoot = "D:\GitHub\TFOL-Project"
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

# 2. Dot-Source the Class Engine File Natively into Shell Memory
$MetricsEnginePath = Join-Path $Global:NodeWatchRoot "modules\telemetry\GetSystemMetrics.ps1"
if (Test-Path $MetricsEnginePath) { . $MetricsEnginePath } else { Write-Error "Metrics file not found"; return }

# Instantiate a live instance of the Class blueprint (runs the Constructor once right here)
$script:SystemEngineInstance = [SystemTelemetryEngine]::new()

# 3. Form Window Scaffolding Mesh
$MainForm = New-Object System.Windows.Forms.Form
$MainForm.Text = "CoreWatch Host Engine Dashboard Framework (Direct Bridge)"
$MainForm.Size = New-Object System.Drawing.Size(1000, 850)
$MainForm.StartPosition = "CenterScreen"
$MainForm.BackColor = [System.Drawing.Color]::FromArgb(26, 32, 44)

$global:WebViewControl = New-Object Microsoft.Web.WebView2.WinForms.WebView2
$global:WebViewControl.Dock = "Fill"
$MainForm.Controls.Add($global:WebViewControl)

# 4. Outbound JavaScript Window Event Message Pipeline Interceptor
$HandleUiMessageEvent = {
    param($sender, $eventArgs)
    $RawMessage = $eventArgs.TryGetWebMessageAsString()
    if ($RawMessage -eq "Exit-App") { $MainForm.Close() }
}

# 5. WebView2 Environment Handshake & Native Direct Object Binding
$MainForm.Add_Load({
    $EnvCreationTask = [Microsoft.Web.WebView2.Core.CoreWebView2Environment]::CreateAsync((Join-Path $BinPath "WebView2FixedRuntime"), (Join-Path $BinPath "WebView2UserData"))
    $EnvCreationTask.GetAwaiter().OnCompleted([Action]{
        $InitializeTask = $global:WebViewControl.EnsureCoreWebView2Async($EnvCreationTask.Result)
        $InitializeTask.GetAwaiter().OnCompleted([Action]{
            
            # Framework Configs
            $global:WebViewControl.CoreWebView2.Settings.AreDefaultContextMenusEnabled = $false
            $global:WebViewControl.CoreWebView2.Settings.AreDevToolsEnabled = $true
            $global:WebViewControl.Add_WebMessageReceived($HandleUiMessageEvent)
            
            # =========================================================================
            # THE DIRECT BRIDGE INTERFACE: Expose the Live Class Object directly to JS
            # =========================================================================
            # FIND THIS OLD LINE INSIDE YOUR START-NODEWATCH.PS1:
            
            $ObjectWrapper = New-Object Microsoft.Web.WebView2.Core.CoreWebView2InjectedHostObjectWrapper($script:SystemEngineInstance)
            $global:WebViewControl.CoreWebView2.AddHostObjectToScript("hardware", $ObjectWrapper)

            # Point the UI to the local index.html asset canvas
            $global:WebViewControl.Source = "file:///" + ((Join-Path $Global:NodeWatchRoot "modules\layouts\index.html") -replace '\\', '/')
        })
    })
})

[System.Windows.Forms.Application]::Run($MainForm)
