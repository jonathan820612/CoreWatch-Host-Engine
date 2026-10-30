[CmdletBinding()]
param([Switch]$ForceRefreshModules)

Clear-Host
$Global:NodeWatchRoot = "D:\GitHub\TFOL-Project"
$BinPath = Join-Path $Global:NodeWatchRoot "bin"
$CoreDll = Join-Path $BinPath "Microsoft.Web.WebView2.Core.dll"
$FormDll = Join-Path $BinPath "Microsoft.Web.WebView2.WinForms.dll"

if ((Test-Path $CoreDll) -and (Test-Path $FormDll)) {
    $null = [System.Reflection.Assembly]::LoadFrom($CoreDll)
    $null = [System.Reflection.Assembly]::LoadFrom($FormDll)
} else { return }

Add-Type -AssemblyName System.Windows.Forms, System.Drawing

$StorageEnginePath = Join-Path $Global:NodeWatchRoot "modules\telemetry\StorageEngine.psm1"
if (Test-Path $StorageEnginePath) { Import-Module $StorageEnginePath -Force -ErrorAction SilentlyContinue }
$MetricsEnginePath = Join-Path $Global:NodeWatchRoot "modules\telemetry\GetSystemMetrics.psm1"
if (Test-Path $MetricsEnginePath) { Import-Module $MetricsEnginePath -Force -ErrorAction SilentlyContinue }

$script:DataExchange = [hashtable]::Synchronized(@{ LoopActive = $true })

[System.Threading.Tasks.Task]::Run([Action]{
    try { Start-TelemetryCollection -DataExchange $script:DataExchange } catch {}
})

$MainForm = New-Object System.Windows.Forms.Form
$MainForm.Text = "CoreWatch Host Engine Dashboard Framework"
$MainForm.Size = New-Object System.Drawing.Size(1000, 850)
$MainForm.MinimumSize = New-Object System.Drawing.Size(950, 750)
$MainForm.StartPosition = "CenterScreen"
$MainForm.FormBorderStyle = "FixedSingle"
$MainForm.BackColor = [System.Drawing.Color]::FromArgb(26, 32, 44)

$global:WebViewControl = New-Object Microsoft.Web.WebView2.WinForms.WebView2
$global:WebViewControl.Dock = "Fill"
$MainForm.Controls.Add($global:WebViewControl)

$HandleUiMessageEvent = {
    param($sender, $eventArgs)
    $RawMessage = $eventArgs.TryGetWebMessageAsString()
    switch ($RawMessage) {
        "Exit-App" { $MainForm.Close() }
        "Request-Storage-Refresh" {
            $LatestStorage = Get-SystemStoragePayload | ConvertTo-Json -Compress
            $B64Storage = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($LatestStorage))
            $null = $global:WebViewControl.ExecuteScriptAsync("ReceiveStorageBase64('$B64Storage')")
        }
    }
}

$MainForm.Add_Load({
    $script:UiTimer = New-Object System.Windows.Forms.Timer
    $script:UiTimer.Interval = 1000
    
    $EnvCreationTask = [Microsoft.Web.WebView2.Core.CoreWebView2Environment]::CreateAsync((Join-Path $BinPath "WebView2FixedRuntime"), (Join-Path $BinPath "WebView2UserData"))
    $EnvCreationTask.GetAwaiter().OnCompleted([Action]{
        $InitializeTask = $global:WebViewControl.EnsureCoreWebView2Async($EnvCreationTask.Result)
        $InitializeTask.GetAwaiter().OnCompleted([Action]{
            $global:WebViewControl.CoreWebView2.Settings.AreDefaultContextMenusEnabled = $false
            $global:WebViewControl.CoreWebView2.Settings.AreDevToolsEnabled = $true
            $global:WebViewControl.Add_WebMessageReceived($HandleUiMessageEvent)
            $global:WebViewControl.Source = "file:///" + ((Join-Path $Global:NodeWatchRoot "modules\layouts\index.html") -replace '\\', '/')
            
            $LatestStorage = Get-SystemStoragePayload | ConvertTo-Json -Compress
            $B64Init = [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($LatestStorage))
            $null = $global:WebViewControl.ExecuteScriptAsync("ReceiveStorageBase64('$B64Init')")
            
            $script:UiTimer.Start()
        })
    })
})

$script:UiTimer.Add_Tick({
    if ($global:WebViewControl.CoreWebView2) {
        $Payload = @{
            CpuLoad = [int]($script:DataExchange.CpuLoad); GpuLoad = [int]($script:DataExchange.GpuLoad)
            RamUsageText = "$($script:DataExchange.RamUsedGB) / $($script:DataExchange.RamTotalGB) GB"
            RamPercent = [int]($script:DataExchange.RamPercent); UptimeText = "$($script:DataExchange.UptimeString)"
            HostName = "$($script:DataExchange.HostName)"; Workgroup = "$($script:DataExchange.Workgroup)"
            OsEdition = "$($script:DataExchange.OsEdition)"; CpuModel = "$($script:DataExchange.CpuModel)"
            GpuModel = "$($script:DataExchange.GpuModel)"; PowerPlan = "$($script:DataExchange.PowerPlan)"
            Virtualization = "$($script:DataExchange.Virtualization)"; ChassisType = "$($script:DataExchange.ChassisType)"
            PsVersion = "$($script:DataExchange.PsVersion)"; BiosVersion = "$($script:DataExchange.BiosVersion)"
            SecureBoot = "$($script:DataExchange.SecureBoot)"; WindowsBuild = "$($script:DataExchange.WindowsBuild)"
            WindowsUpdateLevel = "$($script:DataExchange.WindowsUpdateLevel)"; DirectXVersion = "DirectX 12 Core System"
            CpuDriverVersion = "$($script:DataExchange.CpuDriverVersion)"; GpuDriverVersion = "$($script:DataExchange.GpuDriverVersion)"
            NetworkDriverVersion = "$($script:DataExchange.NetworkDriverVersion)"
            PrivateIp = "$($script:DataExchange.PrivateIp)"; SubnetMask = "$($script:DataExchange.SubnetMask)"
            Gateway = "$($script:DataExchange.Gateway)"; PublicIp = "$($script:DataExchange.PublicIp)"
            NetProfile = "$($script:DataExchange.NetProfile)"; NetDiscovery = "$($script:DataExchange.NetDiscovery)"
            WifiState = "$($script:DataExchange.WifiState)"; LinkSpeed = "$($script:DataExchange.LinkSpeed)"
        }
        # FIXED PIPELINE DISPATCH: Post data safely using the native web message channel
        $JsonMessage = $Payload | ConvertTo-Json -Compress
        $global:WebViewControl.CoreWebView2.PostWebMessageAsJson($JsonMessage)
    }
})

$MainForm.Add_FormClosing({ $script:UiTimer.Stop(); $script:DataExchange.LoopActive = $false })
[System.Windows.Forms.Application]::Run($MainForm)
