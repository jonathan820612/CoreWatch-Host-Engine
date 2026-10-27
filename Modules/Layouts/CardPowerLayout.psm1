Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

function Initialize-PowerQuadrant {
    param([System.Windows.Forms.Panel]$TargetPanel)
    $Fonts = $Global:NodeWatchFonts
    $Palette = $Global:NodeWatchPalette

    $Label = New-Object System.Windows.Forms.Label
    $Label.Text = "Power Profile & Firmware Ready"
    $Label.Font = $Fonts.Normal
    $Label.ForeColor = $Palette.TextGray
    $Label.Location = New-Object System.Drawing.Point(15, 45)
    $Label.AutoSize = $true
    [void]$TargetPanel.Controls.Add($Label)
}
Export-ModuleMember -Function Initialize-PowerQuadrant
