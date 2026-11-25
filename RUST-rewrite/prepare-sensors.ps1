[CmdletBinding()]
param([switch]$Release)

$ErrorActionPreference = 'Stop'
$source = Join-Path (Split-Path -Parent $PSScriptRoot) 'bin'
$destination = if ($Release) { Join-Path $PSScriptRoot 'target\release\sensors' }
               else { Join-Path $PSScriptRoot 'bin\sensors' }
foreach ($name in 'CoreWatchSensorHelper.exe', 'LibreHardwareMonitorLib.dll') {
    if (-not (Test-Path -LiteralPath (Join-Path $source $name) -PathType Leaf)) {
        throw "$name was not found in the original CoreWatch bin directory."
    }
}
New-Item -ItemType Directory -Path $destination -Force | Out-Null
Get-ChildItem -LiteralPath $source -File | Where-Object {
    $_.Name -in 'CoreWatchSensorHelper.exe', 'CoreWatchSensorHelper.exe.config' -or
    ($_.Extension -eq '.dll' -and $_.Name -notmatch 'WebView2')
} | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $destination }
Write-Output "Sensor helper copied to $destination"
