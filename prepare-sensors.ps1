[CmdletBinding()]
param([switch]$Release)

$ErrorActionPreference = 'Stop'

$candidates = @(
    (Join-Path $PSScriptRoot 'legacy-powershell\bin'),
    (Join-Path $PSScriptRoot 'bin')
)
$source = $candidates | Where-Object {
    (Test-Path -LiteralPath (Join-Path $_ 'CoreWatchSensorHelper.exe') -PathType Leaf) -and
    (Test-Path -LiteralPath (Join-Path $_ 'LibreHardwareMonitorLib.dll') -PathType Leaf)
} | Select-Object -First 1

if (-not $source) {
    throw "CoreWatchSensorHelper.exe and LibreHardwareMonitorLib.dll were not found in legacy-powershell\bin or bin."
}

$destination = if ($Release) { Join-Path $PSScriptRoot 'target\release\sensors' }
               else { Join-Path $PSScriptRoot 'bin\sensors' }

New-Item -ItemType Directory -Path $destination -Force | Out-Null
Get-ChildItem -LiteralPath $source -File | Where-Object {
    $_.Name -in 'CoreWatchSensorHelper.exe', 'CoreWatchSensorHelper.exe.config' -or
    ($_.Extension -eq '.dll' -and $_.Name -notmatch 'WebView2')
} | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $destination -Force }

Write-Output "Sensor helper copied from $source to $destination"
