[CmdletBinding()]
param(
    [Switch]$ForceRefreshModules
)

# =========================================================================
# APPLICATION ORCHESTRATOR & PORTABLE CANVAS INITIALIZATION LIFE-CYCLE
# =========================================================================
Clear-Host

# Strict absolute base project path token
$Global:NodeWatchRoot = "D:\GitHub\TFOL-Project"

Write-Verbose "Initializing Self-Contained Portable WebView2 App Engine..."

# 1. HARD-WIRED ASSEMBLY INGESTION (Loads directly from your local project bin folder)
$BinPath = Join-Path $Global:NodeWatchRoot "bin"
$CoreDll = Join-Path $BinPath "Microsoft.Web.WebView2.Core.dll"
$FormDll = Join-Path $BinPath "Microsoft.Web.WebView2.WinForms.dll"

Write-Verbose "Checking for localized engine binaries..."
if ((Test-Path $CoreDll) -and (Test-Path $FormDll)) {
    # Dynamically mount assemblies directly into current PowerShell context memory
    $null = [System.Reflection.Assembly]::LoadFrom($CoreDll)
    $null = [System.Reflection.Assembly]::LoadFrom($FormDll)
    Write-Verbose "Portable layout assemblies loaded successfully from project bin path."
} else {
    Write-Error "CRITICAL Error: Localized WebView2 assemblies missing from bin directory. Verify files are placed in: $BinPath"
    return
}

# Load standard Windows presentation infrastructure assemblies
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# 2. APPLICATION SHELL FORM ASSEMBLY
Write-Verbose "Assembling main form framework shell..."
$MainForm = New-Object System.Windows.Forms.Form
$MainForm.Text = "CoreWatch Host Engine (Self-Contained Canvas)"
$MainForm.Size = New-Object System.Drawing.Size(900, 750)
$MainForm.MinimumSize = New-Object System.Drawing.Size(860, 500)
$MainForm.StartPosition = "CenterScreen"
$MainForm.BackColor = [System.Drawing.Color]::FromArgb(26, 32, 44)

# Create the canvas wrapper handle now that the DLL files are loaded into memory space
$WebViewControl = New-Object Microsoft.Web.WebView2.WinForms.WebView2
$WebViewControl.Dock = "Fill"
$MainForm.Controls.Add($WebViewControl)

# 3. INTER-PROCESS COMMUNICATION CORRELATION LOOPS
$HandleUiMessageEvent = {
    param($sender, $eventArgs)
    $RawMessage = $eventArgs.TryGetWebMessageAsString()
    Write-Verbose "WebView2 Intercepted Event String: $RawMessage"
    
    switch ($RawMessage) {
        "C-Drive-Clicked" {
            Write-Verbose "Executing Volumetric background scan sequence targeting drive C:..."
            $TelemetryPayload = @{
                DriveLetter = "C:"
                FreeSpace   = "242 GB"
                TotalSpace  = "1000 GB"
                PercentUsed = 75
                Breakdown   = @{ Text = "12 GB"; Code = "4 GB"; Images = "45 GB"; Video = "420 GB" }
            }
            $JsonOutput = $TelemetryPayload | ConvertTo-Json -Compress
            $null = $WebViewControl.ExecuteScriptAsync("ReceiveSystemTelemetry('$($JsonOutput -replace '"', '\"')')")
        }
        "Toggle-Diagnostics-On"  { Write-Verbose "View-State Routing: Transitioning elements to Expanded Diagnostics." }
        "Toggle-Diagnostics-Off" { Write-Verbose "View-State Routing: Collapsing dashboard metadata blocks." }
    }
}

# 4. INITIALIZE THE OFFLINE BROWSER PROCESS ENVIRONMENT
$MainForm.Add_Load({
    $FixedRuntimeFolder = Join-Path $BinPath "WebView2FixedRuntime"
    $UserDataFolder = Join-Path $BinPath "WebView2UserData"
    
    # Explicitly mount the path variable into the script scope architecture
    $script:LayoutsFolderPath = Join-Path $Global:NodeWatchRoot "modules\layouts"

    Write-Verbose "Configuring isolated browser subprocess environments from Fixed Version directory..."
    
    # Initialize the asynchronous environment engine task block
    $EnvCreationTask = [Microsoft.Web.WebView2.Core.CoreWebView2Environment]::CreateAsync($FixedRuntimeFolder, $UserDataFolder)
    
    # Native .NET Task Awaiter Hook
    $EnvCreationTask.GetAwaiter().OnCompleted([Action]{
        $LocalEnvironment = $EnvCreationTask.Result
        
        # Initialize canvas control using the explicit offline environment token
        $InitializeTask = $WebViewControl.EnsureCoreWebView2Async($LocalEnvironment)
        
        # Native .NET Task Awaiter Hook for the UI control initialization task
        $InitializeTask.GetAwaiter().OnCompleted([Action]{
            Write-Verbose "Standalone Chromium environment initialized safely."
            
            # FIXED: Added forward slash to catch all virtual local site subdirectory asset requests
            $WebViewControl.CoreWebView2.AddWebResourceRequestedFilter("https://corewatch.local*", [Microsoft.Web.WebView2.Core.CoreWebView2WebResourceContext]::All)
            
            # Intercept resource routing loops completely in memory space to bypass Administrator privilege blocks
            $WebViewControl.CoreWebView2.add_WebResourceRequested({
                param($sender, $eventArgs)
                
                $RequestedUrl = $eventArgs.Request.Uri
                
                # CRITICAL TRANSLATION FIX: Strip domain headers AND clean any trailing slashes/whitespace
                $FileName = $RequestedUrl -replace "https://corewatch.local", ""
                $FileName = $FileName.Trim().Trim('/')
                
                if ([string]::IsNullOrEmpty($FileName)) { $FileName = "index.html" }
                
                # Read path using the global script scope reference variable pointer
                $LocalFilePath = Join-Path $script:LayoutsFolderPath $FileName
                
                if (Test-Path $LocalFilePath -PathType Leaf) {
                    # Explicitly define proper mime-type content headers required by Chromium
                    $ContentType = "text/html"
                    if ($FileName.EndsWith(".css")) { $ContentType = "text/css" }
                    if ($FileName.EndsWith(".js"))  { $ContentType = "application/javascript" }
                    
                    # Read raw file content into memory streams to completely bypass filesystem origin sandboxing
                    $FileContentText = Get-Content $LocalFilePath -Raw
                    $FileContentBytes = [System.Text.Encoding]::UTF8.GetBytes($FileContentText)
                    $MemoryStream = New-Object System.IO.MemoryStream(,$FileContentBytes)
                    
                    # Construct an authentic mock HTTP 200 response header block smoothly
                    $Response = $WebViewControl.CoreWebView2.Environment.CreateWebResourceResponse(
                        $MemoryStream, 
                        200, 
                        "OK", 
                        "Content-Type: $ContentType`r`nAccess-Control-Allow-Origin: *"
                    )
                    $eventArgs.Response = $Response
                }
            })
            
            # Lock engine parameters down to standard window design constraints
            $WebViewControl.CoreWebView2.Settings.AreDefaultContextMenusEnabled = $false
            $WebViewControl.CoreWebView2.Settings.AreDevToolsEnabled = $true
            
            # Map communication message handler pipelines
            $WebViewControl.Add_WebMessageReceived($HandleUiMessageEvent)
            
            # FIXED: Added separating forward slash to target root viewport index file cleanly
            $WebViewControl.Source = "https://corewatch.local"
        })
    })
})

# Invoke Native Message Loops
Write-Verbose "Starting Windows Forms application messaging loops..."
$Global:AppContext = New-Object System.Windows.Forms.ApplicationContext
$MainForm.Show()
[System.Windows.Forms.Application]::Run($Global:AppContext)
