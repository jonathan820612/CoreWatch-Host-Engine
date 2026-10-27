Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function Initialize-ComputeQuadrant {
    param([System.Windows.Forms.Panel]$TargetPanel)
    $Fonts = $Global:NodeWatchFonts
    $Palette = $Global:NodeWatchPalette

    # Base Text Placeholder
    $Label = New-Object System.Windows.Forms.Label
    $Label.Text = "CPU/GPU Hardware Streams Ready"
    $Label.Font = $Fonts.Normal
    $Label.ForeColor = $Palette.TextGray
    $Label.Location = New-Object System.Drawing.Point(15, 45)
    $Label.AutoSize = $true
    [void]$TargetPanel.Controls.Add($Label)
}
Export-ModuleMember -Function Initialize-ComputeQuadrant
