[CmdletBinding()]
param([switch]$Release)

$ErrorActionPreference = 'Stop'

$candidates = @(
    (Join-Path $PSScriptRoot 'bin\sensors'),
    (Join-Path $PSScriptRoot 'bin'),
    (Join-Path $PSScriptRoot 'legacy-powershell\bin')
)
$source = $candidates | Where-Object {
    (Test-Path -LiteralPath (Join-Path $_ 'CoreWatchSensorHelper.exe') -PathType Leaf) -and
    (Test-Path -LiteralPath (Join-Path $_ 'LibreHardwareMonitorLib.dll') -PathType Leaf)
} | Select-Object -First 1

# If build\CoreWatchSensorHelper.cs is newer than bin\sensors\CoreWatchSensorHelper.exe, compile it automatically
$helperSrc = Join-Path $PSScriptRoot 'build\CoreWatchSensorHelper.cs'
$binSensors = Join-Path $PSScriptRoot 'bin\sensors'
$csc = 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if ((Test-Path -LiteralPath $helperSrc) -and (Test-Path -LiteralPath $csc) -and (Test-Path -LiteralPath (Join-Path $binSensors 'LibreHardwareMonitorLib.dll'))) {
    $binExe = Join-Path $binSensors 'CoreWatchSensorHelper.exe'
    if (-not (Test-Path -LiteralPath $binExe) -or (Get-Item $helperSrc).LastWriteTimeUtc -gt (Get-Item $binExe).LastWriteTimeUtc) {
        & $csc /nologo /optimize+ /platform:x64 /target:exe "/out:$binExe" "/reference:$(Join-Path $binSensors 'LibreHardwareMonitorLib.dll')" $helperSrc
        if ($LASTEXITCODE -eq 0) { $source = $binSensors }
    }
}

if (-not $source) {
    throw "CoreWatchSensorHelper.exe and LibreHardwareMonitorLib.dll were not found in legacy-powershell\bin, bin\sensors, or bin."
}

$destination = if ($Release) { Join-Path $PSScriptRoot 'target\release\sensors' }
               else { Join-Path $PSScriptRoot 'bin\sensors' }

New-Item -ItemType Directory -Path $destination -Force | Out-Null
if ([System.IO.Path]::GetFullPath($source).TrimEnd('\') -ieq [System.IO.Path]::GetFullPath($destination).TrimEnd('\')) {
    Write-Output "Sensor helper already staged at $destination"
    exit 0
}
Get-ChildItem -LiteralPath $source -File | Where-Object {
    $_.Name -in 'CoreWatchSensorHelper.exe', 'CoreWatchSensorHelper.exe.config' -or
    ($_.Extension -eq '.dll' -and $_.Name -notmatch 'WebView2')
} | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $destination -Force }

Write-Output "Sensor helper copied from $source to $destination"
