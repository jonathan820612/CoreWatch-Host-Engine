[CmdletBinding()]
param(
    [Switch]$ForceRefreshModules
)

# =========================================================================
# APPLICATION ORCHESTRATOR & BOOTSTRAP LIFECYCLE PIPELINE
# =========================================================================
Clear-Host

# Establish strict global root constant to replace automatic execution path lookups
$Global:NodeWatchRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition

Write-Verbose "Initializing CoreWatch Host Engine environment lifecycle..."

# 1. INTEGRITY & SECURITY ELEVATION CHECKS
$IsAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $IsAdmin) { 
    Write-Warning "NODEWATCH WARNING: Running without full Administrator privileges. Certain telemetry layers will fail to poll."
} else {
    Write-Verbose "Security Token Verification: Administrative elevation confirmed."
}

# Load Core Graphical Assemblies Natively
Write-Verbose "Loading Win32 UI presentation subsystem assemblies..."
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

# 2. DEFINITIVE DESIGN TOKENS (Locked-In Low-Contrast Dark Theme)
Write-Verbose "Registering design tokens into global application context..."
$Global:NodeWatchPalette = [PSCustomObject]@{
    DarkFormBack      = [System.Drawing.Color]::FromArgb(26, 32, 44)    # Strict Muted Outer Canvas
    PanelBackground   = [System.Drawing.Color]::FromArgb(33, 41, 54)    # Smooth Internal Component Surface
    ControlBackground = [System.Drawing.Color]::FromArgb(45, 55, 72)    # Interactive Control Idle State
    ActiveBorderColor = [System.Drawing.Color]::FromArgb(50, 60, 75)    # Muted Low-Contrast Structural Borders
    TextWhite         = [System.Drawing.Color]::FromArgb(247, 250, 252)  # Primary Metric Typography
    TextGray          = [System.Drawing.Color]::FromArgb(160, 174, 192)  # Secondary Label Alignment
    AccentBlue        = [System.Drawing.Color]::FromArgb(49, 130, 206)   # Standard Telemetry Track Filled
    AccentGreen       = [System.Drawing.Color]::FromArgb(56, 178, 172)   # Thermal/Stable Badge Tracking
}

# Typography Engine Configuration
$Global:NodeWatchFonts = [PSCustomObject]@{
    Header = New-Object System.Drawing.Font("Segoe UI Semibold", 10, [System.Drawing.FontStyle]::Bold)
    Normal = New-Object System.Drawing.Font("Segoe UI", 9, [System.Drawing.FontStyle]::Regular)
    Status = New-Object System.Drawing.Font("Segoe UI", 8, [System.Drawing.FontStyle]::Regular)
}

# 3. INTERACTIVE CONSOLE SUBSYSTEM HOISTING (Module Manifest Loading)
$LayoutDir = Join-Path $Global:NodeWatchRoot "Modules\Layouts"
$TelemetryDir = Join-Path $Global:NodeWatchRoot "Modules\Telemetry"

Write-Verbose "Verifying layout and telemetry directory trees..."
foreach ($Path in @($LayoutDir, $TelemetryDir)) { 
    if (-not (Test-Path $Path)) { 
        Write-Verbose "Creating missing workspace node: $Path"
        New-Item -ItemType Directory -Path $Path -Force | Out-Null 
    } 
}

# Core Layout Engines Manifest Binding (Using Global Root References)
Write-Verbose "Importing presentation modules into application context..."
if (Test-Path "$LayoutDir\DashboardBaseEngine.psm1") { Import-Module "$LayoutDir\DashboardBaseEngine.psm1" -Force; Write-Verbose "Loaded Base Layout Engine." }
if (Test-Path "$LayoutDir\CardComputeLayout.psm1")   { Import-Module "$LayoutDir\CardComputeLayout.psm1" -Force; Write-Verbose "Loaded Compute Card Layout Engine." }
if (Test-Path "$LayoutDir\CardMemoryLayout.psm1")    { Import-Module "$LayoutDir\CardMemoryLayout.psm1" -Force; Write-Verbose "Loaded Memory Card Layout Engine." }
if (Test-Path "$LayoutDir\CardStorageLayout.psm1")   { Import-Module "$LayoutDir\CardStorageLayout.psm1" -Force; Write-Verbose "Loaded Storage Card Layout Engine." }
if (Test-Path "$LayoutDir\CardPowerLayout.psm1")     { Import-Module "$LayoutDir\CardPowerLayout.psm1" -Force; Write-Verbose "Loaded Power Card Layout Engine." }
if (Test-Path "$LayoutDir\CardNetworkLayout.psm1")   { Import-Module "$LayoutDir\CardNetworkLayout.psm1" -Force; Write-Verbose "Loaded Network Card Layout Engine." }

# 4. BACKGROUND ASYNCHRONOUS ENGINE PROVISIONING
Write-Verbose "Allocating isolated runspace threads for background telemetry..."
$Global:NetPoolTracker = [runspacefactory]::CreateRunspacePool(1, 4)
$Global:NetPoolTracker.Open()

# 5. FOUNDATIONAL WINDOW COMPOSITION & RUNTIME MANAGEMENT
Write-Verbose "Assembling main form framework shell..."
$MainForm = New-Object System.Windows.Forms.Form
$MainForm.Text = "CoreWatch Host Engine (Administrator)"
$MainForm.Size = New-Object System.Drawing.Size(860, 700)
$MainForm.MinimumSize = New-Object System.Drawing.Size(860, 500)
$MainForm.StartPosition = "CenterScreen"
$MainForm.BackColor = $Global:NodeWatchPalette.DarkFormBack

# Safe Infrastructure Teardown Implementation Hooked to Main Close Event
$MainForm.Add_FormClosing({
    param($s, $e)
    Write-Verbose "Intercepted form exit event. Activating infrastructure teardown sequence..."
    if ($Global:NetPoolTracker) {
        $Global:NetPoolTracker.Close()
        $Global:NetPoolTracker.Dispose()
        Write-Verbose "Asynchronous background runspace pool closed safely."
    }
})

# --- LAYOUT ENGINE ASSEMBLY TEST STAGE ---
if (Get-Command New-ModernHardwareDashboard -ErrorAction SilentlyContinue) {
    Write-Verbose "Binding sub-module interface components directly to parent form node..."
    $Global:ActiveDashboard = New-ModernHardwareDashboard -ParentForm $MainForm -Palette $Global:NodeWatchPalette -Fonts $Global:NodeWatchFonts
} else {
    Write-Verbose "Sub-modules absent or unlinked. Falling back to inline token test canvas..."
    
    $TestContainer = New-Object System.Windows.Forms.Panel
    $TestContainer.Dock = "Fill"
    $TestContainer.BackColor = $Global:NodeWatchPalette.DarkFormBack
    
    $TestCard = New-Object System.Windows.Forms.Panel
    $TestCard.Size = New-Object System.Drawing.Size(400, 200)
    $TestCard.Location = New-Object System.Drawing.Point(20, 20)
    $TestCard.BackColor = $Global:NodeWatchPalette.PanelBackground
    
    $TestCard.Add_Paint({
        param($s,$e)
        $Pen = New-Object System.Drawing.Pen($Global:NodeWatchPalette.ActiveBorderColor, 1)
        $e.Graphics.DrawRectangle($Pen, 0, 0, 400 - 1, 200 - 1)
        $Pen.Dispose()
    })
    
    $TestLabel = New-Object System.Windows.Forms.Label
    $TestLabel.Text = "🖳  Base Engine Active: Dark-Token Blueprint Operational"
    $TestLabel.Font = $Global:NodeWatchFonts.Header
    $TestLabel.ForeColor = $Global:NodeWatchPalette.TextWhite
    $TestLabel.Location = New-Object System.Drawing.Point(15, 15)
    $TestLabel.AutoSize = $true
    
    $TestCard.Controls.Add($TestLabel)
    $TestContainer.Controls.Add($TestCard)
    $MainForm.Controls.Add($TestContainer)
}

# Invoke Windows Message Runtime
Write-Verbose "Starting Windows Forms application messaging loops..."
$Global:AppContext = New-Object System.Windows.Forms.ApplicationContext
$MainForm.Show()
[System.Windows.Forms.Application]::Run($Global:AppContext)