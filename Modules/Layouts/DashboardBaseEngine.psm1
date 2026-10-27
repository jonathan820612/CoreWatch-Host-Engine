# =========================================================================
# PRESENTATION MODULE: MASTER DASHBOARD ENGINE & SURFACE ARCHITECTURE
# =========================================================================
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function New-ModernHardwareDashboard {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)][System.Windows.Forms.Form]$ParentForm,
        [Parameter(Mandatory=$true)][PSCustomObject]$Palette,
        [Parameter(Mandatory=$true)][PSCustomObject]$Fonts
    )

    Write-Verbose "Layout Engine: Initializing core workspace surface controls..."

    # 1. ROOT WORKSPACE PANEL WRAPPER
    $WorkspaceViewPanel = New-Object System.Windows.Forms.Panel
    $WorkspaceViewPanel.Dock = "Fill"
    $WorkspaceViewPanel.BackColor = $Palette.DarkFormBack

    # 2. TOP ACTION NAVIGATION BAR (Segment Switch & Badges Anchor)
    $TopActionBar = New-Object System.Windows.Forms.Panel
    $TopActionBar.Size = New-Object System.Drawing.Size($ParentForm.ClientSize.Width, 45)
    $TopActionBar.Dock = "Top"
    $TopActionBar.BackColor = $Palette.DarkFormBack

    $SegmentControlContainer = New-Object System.Windows.Forms.Panel
    $SegmentControlContainer.Location = New-Object System.Drawing.Point(15, 10)
    $SegmentControlContainer.Size = New-Object System.Drawing.Size(240, 28)
    $SegmentControlContainer.BackColor = $Palette.PanelBackground

    # Static property evaluations inside graphics loop
    $SegmentControlContainer.Add_Paint({
        param($s, $e)
        if ($null -ne $Palette -and $null -ne $Palette.ActiveBorderColor) {
            $BorderPen = New-Object System.Drawing.Pen($Palette.ActiveBorderColor, 1)
            $e.Graphics.DrawRectangle($BorderPen, 0, 0, 240 - 1, 28 - 1)
            $BorderPen.Dispose()
        }
    })

    $BtnCompactMode = New-Object System.Windows.Forms.Button
    $BtnCompactMode.Text = "Compact View"
    $BtnCompactMode.Location = New-Object System.Drawing.Point(2, 2)
    $BtnCompactMode.Size = New-Object System.Drawing.Size(116, 24)
    $BtnCompactMode.Font = $Fonts.Status
    $BtnCompactMode.BackColor = $Palette.AccentBlue
    $BtnCompactMode.ForeColor = $Palette.TextWhite
    $BtnCompactMode.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
    $BtnCompactMode.FlatAppearance.BorderSize = 0

    $BtnExpandedMode = New-Object System.Windows.Forms.Button
    $BtnExpandedMode.Text = "Expanded Diagnostics"
    $BtnExpandedMode.Location = New-Object System.Drawing.Point(120, 2)
    $BtnExpandedMode.Size = New-Object System.Drawing.Size(118, 24)
    $BtnExpandedMode.Font = $Fonts.Status
    $BtnExpandedMode.BackColor = $Palette.PanelBackground
    $BtnExpandedMode.ForeColor = $Palette.TextGray
    $BtnExpandedMode.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
    $BtnExpandedMode.FlatAppearance.BorderSize = 0

    $SegmentControlContainer.Controls.AddRange(@($BtnCompactMode, $BtnExpandedMode))
    $TopActionBar.Controls.Add($SegmentControlContainer)

    # 3. MASTER PROPORTIONAL MESH PANEL (The Layout Grid)
    $MasterLayoutGrid = New-Object System.Windows.Forms.TableLayoutPanel
    $MasterLayoutGrid.Dock = "Fill"
    $MasterLayoutGrid.Padding = New-Object System.Windows.Forms.Padding(15, 5, 15, 15)
    $MasterLayoutGrid.ColumnCount = 2
    $MasterLayoutGrid.RowCount = 3
    $MasterLayoutGrid.BackColor = $Palette.DarkFormBack

    $MasterLayoutGrid.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Percent, 50)))
    $MasterLayoutGrid.ColumnStyles.Add((New-Object System.Windows.Forms.ColumnStyle([System.Windows.Forms.SizeType]::Percent, 50)))
    
    $MasterLayoutGrid.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Percent, 40)))
    $MasterLayoutGrid.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Percent, 40)))
    $MasterLayoutGrid.RowStyles.Add((New-Object System.Windows.Forms.RowStyle([System.Windows.Forms.SizeType]::Percent, 20)))

    # 4. STRUCTURAL HOUSING CARD GENERATION METHOD
    $NewBaseLayoutCard = {
        param([string]$DisplayTitle, [string]$SymbolIcon, [System.Windows.Forms.Panel]$AssignedPanel)
        
        $AssignedPanel.Dock = "Fill"
        $AssignedPanel.BackColor = $Palette.PanelBackground
        $AssignedPanel.Margin = New-Object System.Windows.Forms.Padding(6)

        $AssignedPanel.Add_Paint({
            param($s, $e)
            if ($null -ne $Palette -and $null -ne $Palette.ActiveBorderColor) {
                $LinePen = New-Object System.Drawing.Pen($Palette.ActiveBorderColor, 1)
                $e.Graphics.DrawRectangle($LinePen, 0, 0, $AssignedPanel.Width - 1, $AssignedPanel.Height - 1)
                $LinePen.Dispose()
            }
        })

        $LabelControl = New-Object System.Windows.Forms.Label
        $LabelControl.Text = "$SymbolIcon  $DisplayTitle"
        $LabelControl.Font = $Fonts.Header
        $LabelControl.ForeColor = $Palette.TextWhite
        $LabelControl.Location = New-Object System.Drawing.Point(15, 12)
        $LabelControl.AutoSize = $true
        $AssignedPanel.Controls.Add($LabelControl)
    }

    # Use explicit layout allocation handles
    $ComputeSurface = New-Object System.Windows.Forms.Panel
    $MemorySurface  = New-Object System.Windows.Forms.Panel
    $StorageSurface = New-Object System.Windows.Forms.Panel
    $PowerSurface   = New-Object System.Windows.Forms.Panel
    $NetworkSurface = New-Object System.Windows.Forms.Panel

    &$NewBaseLayoutCard -DisplayTitle "COMPUTE CLUSTER" -SymbolIcon "CPU" -AssignedPanel $ComputeSurface
    &$NewBaseLayoutCard -DisplayTitle "MEMORY & KERNEL" -SymbolIcon "RAM" -AssignedPanel $MemorySurface
    &$NewBaseLayoutCard -DisplayTitle "STORAGE & VOLUMETRIC" -SymbolIcon "DISK" -AssignedPanel $StorageSurface
    &$NewBaseLayoutCard -DisplayTitle "POWER & INFRASTRUCTURE" -SymbolIcon "PWR" -AssignedPanel $PowerSurface
    &$NewBaseLayoutCard -DisplayTitle "NETWORK SUB-CONSOLE" -SymbolIcon "NET" -AssignedPanel $NetworkSurface

    # --- CROSS-MODULE PRESENTATION EXECUTION ---
    if (Get-Command Initialize-ComputeQuadrant -ErrorAction SilentlyContinue) { Initialize-ComputeQuadrant -TargetPanel $ComputeSurface }
    if (Get-Command Initialize-MemoryQuadrant  -ErrorAction SilentlyContinue) { Initialize-MemoryQuadrant  -TargetPanel $MemorySurface }
    if (Get-Command Initialize-StorageQuadrant -ErrorAction SilentlyContinue) { Initialize-StorageQuadrant -TargetPanel $StorageSurface }
    if (Get-Command Initialize-PowerQuadrant   -ErrorAction SilentlyContinue) { Initialize-PowerQuadrant   -TargetPanel $PowerSurface }
    if (Get-Command Initialize-NetworkQuadrant -ErrorAction SilentlyContinue) { Initialize-NetworkQuadrant -TargetPanel $NetworkSurface }

    # Map created objects to their target cell addresses inside the mesh
    $MasterLayoutGrid.Controls.Add($ComputeSurface, 0, 0)
    $MasterLayoutGrid.Controls.Add($MemorySurface, 1, 0)
    $MasterLayoutGrid.Controls.Add($StorageSurface, 0, 1)
    $MasterLayoutGrid.Controls.Add($PowerSurface, 1, 1)
    
    $MasterLayoutGrid.Controls.Add($NetworkSurface, 0, 2)
    $MasterLayoutGrid.SetColumnSpan($NetworkSurface, 2)

    $WorkspaceViewPanel.Controls.Add($MasterLayoutGrid)
    $WorkspaceViewPanel.Controls.Add($TopActionBar)

    $ExecuteViewToggle = {
        param([bool]$ShowAdvancedTelemetry)
        if ($ShowAdvancedTelemetry) {
            $BtnExpandedMode.BackColor = $Palette.AccentBlue
            $BtnExpandedMode.ForeColor = $Palette.TextWhite
            $BtnCompactMode.BackColor  = $Palette.PanelBackground
            $BtnCompactMode.ForeColor  = $Palette.TextGray
        } else {
            $BtnCompactMode.BackColor  = $Palette.AccentBlue
            $BtnCompactMode.ForeColor  = $Palette.TextWhite
            $BtnExpandedMode.BackColor = $Palette.PanelBackground
            $BtnExpandedMode.ForeColor = $Palette.TextGray
        }
    }

    $BtnCompactMode.Add_Click({ &$ExecuteViewToggle -ShowAdvancedTelemetry $false })
    $BtnExpandedMode.Add_Click({ &$ExecuteViewToggle -ShowAdvancedTelemetry $true })

    $ParentForm.Controls.Add($WorkspaceViewPanel)

    return [PSCustomObject]@{
        MainViewContainer = $WorkspaceViewPanel
        ComputeQuadrant   = $ComputeSurface
        MemoryQuadrant    = $MemorySurface
        StorageQuadrant   = $StorageSurface
        PowerQuadrant     = $PowerSurface
        NetworkConsole    = $NetworkSurface
    }
}

Export-ModuleMember -Function New-ModernHardwareDashboard