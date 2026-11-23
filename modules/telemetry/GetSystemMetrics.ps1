# File: modules/telemetry/GetSystemMetrics.ps1

if (-not ("CoreWatch.NativeMemory" -as [type])) {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

namespace CoreWatch {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Auto)]
    public struct MEMORYSTATUSEX {
        public uint dwLength;
        public uint dwMemoryLoad;
        public ulong ullTotalPhys;
        public ulong ullAvailPhys;
        public ulong ullTotalPageFile;
        public ulong ullAvailPageFile;
        public ulong ullTotalVirtual;
        public ulong ullAvailVirtual;
        public ulong ullAvailExtendedVirtual;
    }

    public static class NativeMemory {
        [DllImport("kernel32.dll", CharSet = CharSet.Auto, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool GlobalMemoryStatusEx(ref MEMORYSTATUSEX lpBuffer);

        public static MEMORYSTATUSEX Query() {
            MEMORYSTATUSEX mem = new MEMORYSTATUSEX();
            mem.dwLength = (uint)Marshal.SizeOf(typeof(MEMORYSTATUSEX));
            GlobalMemoryStatusEx(ref mem);
            return mem;
        }
    }
}
"@ -ErrorAction SilentlyContinue
}

$script:StaticSystemCache  = $null
$script:CpuPerfCounter     = $null
$script:CpuFreqPctCounter  = $null
$script:NvidiaSmiPath      = $null
$script:NvidiaSmiChecked   = $false
$script:LastSensorSample   = [datetime]::MinValue
$script:CachedGpuLoad      = 0
$script:CachedGpuPower     = "-- W"
$script:CachedGpuTemp      = "--"
$script:CachedCpuTemp      = "--"
$script:LastPowerPlanCheck = [datetime]::MinValue
$script:CachedPowerPlan    = "Balanced"
$script:CachedTelemetry    = "Off"

function Initialize-StaticSystemCache {
    if ($null -ne $script:StaticSystemCache) { return }

    # Prefer discrete GPU (NVIDIA/AMD/Arc) over virtual display drivers or integrated adapters
    $AllGpus = @(Get-CimInstance -ClassName Win32_VideoController -ErrorAction SilentlyContinue | Where-Object { $_.Name })
    $GpuCim  = $AllGpus | Where-Object { $_.Name -match '(?i)(NVIDIA|GeForce|RTX|GTX|Radeon|AMD|Intel\(R\) Arc)' -and $_.Name -notmatch '(?i)(Basic Display|Virtual|Parsec|Remote)' } | Select-Object -First 1
    if (-not $GpuCim) { $GpuCim = $AllGpus | Select-Object -First 1 }

    $CpuProc = Get-CimInstance -ClassName Win32_Processor -ErrorAction SilentlyContinue | Select-Object -First 1
    $Caches  = Get-CimInstance -ClassName Win32_CacheMemory -ErrorAction SilentlyContinue

    $L1 = 0L; $L2 = 0L; $L3 = 0L
    foreach ($c in $Caches) {
        $SizeKB = if ($c.InstalledSize -gt 0) { [long]$c.InstalledSize } else { [long]$c.MaxCacheSize }
        if ($c.Level -eq 3) { $L1 += $SizeKB }
        elseif ($c.Level -eq 4) { $L2 += $SizeKB }
        elseif ($c.Level -eq 5) { $L3 += $SizeKB }
    }
    if ($L2 -eq 0 -and $CpuProc) { $L2 = [long]$CpuProc.L2CacheSize }
    if ($L3 -eq 0 -and $CpuProc) { $L3 = [long]$CpuProc.L3CacheSize }

    function Format-Cache([long]$kb) {
        if ($kb -le 0) { 'N/A' }
        elseif ($kb -ge 1024) { "$([math]::Round($kb / 1024, 2))MB" }
        else { "${kb}KB" }
    }

    $baseClockMHz = if ($CpuProc -and $CpuProc.MaxClockSpeed) {
        [double]$CpuProc.MaxClockSpeed
    } elseif ($CpuProc -and $CpuProc.CurrentClockSpeed) {
        [double]$CpuProc.CurrentClockSpeed
    } else { 0.0 }

    $clockGHz = if ($baseClockMHz -gt 0) { "{0:N2}" -f ($baseClockMHz / 1000.0) } else { "0.00" }

    if (-not $script:NvidiaSmiChecked) {
        $script:NvidiaSmiChecked = $true
        $smiCmd = Get-Command "nvidia-smi.exe" -ErrorAction SilentlyContinue
        if ($smiCmd) {
            $script:NvidiaSmiPath = $smiCmd.Source
        } elseif (Test-Path "$env:SystemRoot\System32\nvidia-smi.exe") {
            $script:NvidiaSmiPath = "$env:SystemRoot\System32\nvidia-smi.exe"
        }
    }

    $script:StaticSystemCache = @{
        CacheMatrix      = @{
            L1    = Format-Cache $L1
            L2    = Format-Cache $L2
            L3    = Format-Cache $L3
            IsX3D = ($CpuProc -and ($CpuProc.Name -match '(?i)\b\w*X3D\b'))
        }
        GpuModel         = if ($GpuCim) { [string]$GpuCim.Name } else { "Display Adapter" }
        GpuDriverVersion = if ($GpuCim) { [string]$GpuCim.DriverVersion } else { "Unknown" }
        BaseClockMHz     = $baseClockMHz
        CpuClockGHz      = $clockGHz
    }
}

function Update-LiveThermalAndGpuSensors {
    # Throttled to every 2 seconds so the 0.5s fast loop stays sub-millisecond
    if (([datetime]::Now - $script:LastSensorSample).TotalSeconds -lt 2) { return }
    $script:LastSensorSample = [datetime]::Now

    # 1. Live NVIDIA GPU telemetry via nvidia-smi (exact load %, temp C, power W)
    if ($script:NvidiaSmiPath) {
        try {
            $psi = New-Object System.Diagnostics.ProcessStartInfo
            $psi.FileName = $script:NvidiaSmiPath
            $psi.Arguments = "--query-gpu=utilization.gpu,temperature.gpu,power.draw --format=csv,noheader,nounits"
            $psi.RedirectStandardOutput = $true
            $psi.UseShellExecute = $false
            $psi.CreateNoWindow = $true
            $proc = [System.Diagnostics.Process]::Start($psi)
            if ($proc -and $proc.WaitForExit(750)) {
                $line = $proc.StandardOutput.ReadLine()
                if ($line) {
                    $parts = $line -split ','
                    if ($parts.Count -ge 3) {
                        $loadVal = 0; $tempVal = 0; $pwrVal = 0.0
                        if ([int]::TryParse($parts[0].Trim(), [ref]$loadVal)) {
                            $script:CachedGpuLoad = [math]::Max(0, [math]::Min(100, $loadVal))
                        }
                        if ([int]::TryParse($parts[1].Trim(), [ref]$tempVal)) {
                            $script:CachedGpuTemp = $tempVal
                        }
                        if ([double]::TryParse($parts[2].Trim(), [System.Globalization.CultureInfo]::InvariantCulture, [ref]$pwrVal)) {
                            $script:CachedGpuPower = "$([int][math]::Round($pwrVal)) W"
                        }
                    }
                }
            }
            if ($proc) { $proc.Dispose() }
        } catch {}
    } else {
        # Fallback GPU Load via Windows GPU Engine performance counter (AMD / Intel / non-NVIDIA)
        try {
            $gpuSamples = (Get-Counter '\GPU Engine(*engtype_3D)\Utilization Percentage' -ErrorAction SilentlyContinue).CounterSamples
            if ($gpuSamples) {
                $sumLoad = ($gpuSamples | Measure-Object -Property CookedValue -Sum).Sum
                $script:CachedGpuLoad = [int][math]::Min(100, [math]::Max(0, [math]::Round($sumLoad)))
            }
        } catch {}
    }

    # 2. Live CPU / ACPI Thermal Zone sensor (filters out common static ACPI dummy values <23C)
    $resolvedCpuTemp = $null
    try {
        $tz = Get-CimInstance -Namespace "root\WMI" -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($tz -and $tz.CurrentTemperature -gt 2732) {
            $c = [int][math]::Round(($tz.CurrentTemperature / 10.0) - 273.15)
            if ($c -ge 23 -and $c -le 115) { $resolvedCpuTemp = $c }
        }
    } catch {}

    if ($null -eq $resolvedCpuTemp) {
        try {
            $tzPerf = Get-CimInstance -ClassName Win32_PerfFormattedData_Counters_ThermalZoneInformation -ErrorAction SilentlyContinue |
                      Where-Object { $_.HighPrecisionTemperature -gt 2732 -or $_.Temperature -gt 273 } | Select-Object -First 1
            if ($tzPerf) {
                $c = if ($tzPerf.HighPrecisionTemperature -gt 2732) {
                    [int][math]::Round(($tzPerf.HighPrecisionTemperature / 10.0) - 273.15)
                } else {
                    [int]($tzPerf.Temperature - 273)
                }
                if ($c -ge 23 -and $c -le 115) { $resolvedCpuTemp = $c }
            }
        } catch {}
    }

    if ($null -ne $resolvedCpuTemp) {
        $script:CachedCpuTemp = $resolvedCpuTemp
    }
}

function Get-FastHardwareMetrics {
    Initialize-StaticSystemCache

    # Ultra-fast 0.5s hardware sampler using .NET PerformanceCounter + Win32 GlobalMemoryStatusEx
    if ($null -eq $script:CpuPerfCounter) {
        try {
            $script:CpuPerfCounter = New-Object System.Diagnostics.PerformanceCounter("Processor", "% Processor Time", "_Total")
            $null = $script:CpuPerfCounter.NextValue()
        } catch {}
    }
    if ($null -eq $script:CpuFreqPctCounter) {
        try {
            $script:CpuFreqPctCounter = New-Object System.Diagnostics.PerformanceCounter("Processor Information", "% Processor Performance", "_Total")
            $null = $script:CpuFreqPctCounter.NextValue()
        } catch {}
    }

    $cpuLoad = 0
    if ($null -ne $script:CpuPerfCounter) {
        try { $cpuLoad = [int][math]::Min(100, [math]::Max(0, [math]::Round($script:CpuPerfCounter.NextValue()))) } catch {}
    }

    # Dynamic live CPU clock (Base MHz * % Processor Performance)
    $clockStr = if ($script:StaticSystemCache) { "$($script:StaticSystemCache.CpuClockGHz) GHz" } else { "0.00 GHz" }
    if ($null -ne $script:CpuFreqPctCounter -and $script:StaticSystemCache -and $script:StaticSystemCache.BaseClockMHz -gt 0) {
        try {
            $perfPct = [double]$script:CpuFreqPctCounter.NextValue()
            if ($perfPct -gt 5) {
                $liveGHz = ($script:StaticSystemCache.BaseClockMHz * ($perfPct / 100.0)) / 1000.0
                $clockStr = "{0:N2} GHz" -f $liveGHz
            }
        } catch {}
    }

    $ramPct = 0
    $ramUsageText = "0.00 / 0.00 GB"
    $pagePct = 0
    $pageUsageText = "0.00 / 0.00 GB"

    try {
        $mem = [CoreWatch.NativeMemory]::Query()
        if ($mem.ullTotalPhys -gt 0) {
            $totalRamGB = $mem.ullTotalPhys / 1GB
            $usedRamGB  = ($mem.ullTotalPhys - $mem.ullAvailPhys) / 1GB
            $ramPct     = [int]$mem.dwMemoryLoad
            $ramUsageText = "{0:N2} / {1:N2} GB" -f $usedRamGB, $totalRamGB

            # Pagefile / Commit delta above physical RAM
            $pageTotalBytes  = [math]::Max([double]0, ([double]$mem.ullTotalPageFile - [double]$mem.ullTotalPhys))
            $commitUsedBytes = [double]$mem.ullTotalPageFile - [double]$mem.ullAvailPageFile
            $physUsedBytes   = [double]$mem.ullTotalPhys - [double]$mem.ullAvailPhys
            $pageUsedBytes   = [math]::Max([double]0, $commitUsedBytes - $physUsedBytes)

            $pageTotalGB = $pageTotalBytes / 1GB
            $pageUsedGB  = $pageUsedBytes / 1GB
            $pagePct     = if ($pageTotalGB -gt 0) { [int][math]::Min(100, ($pageUsedGB / $pageTotalGB) * 100) } else { 0 }
            $pageUsageText = "{0:N2} / {1:N2} GB" -f $pageUsedGB, $pageTotalGB
        }
    } catch {}

    Update-LiveThermalAndGpuSensors

    return [PSCustomObject]@{
        CpuLoad           = $cpuLoad
        CpuClock          = $clockStr
        CpuTemp           = $script:CachedCpuTemp
        RamPercent        = $ramPct
        RamUsageText      = $ramUsageText
        PagefilePercent   = $pagePct
        PagefileUsageText = $pageUsageText
        GpuLoad           = $script:CachedGpuLoad
        GpuPower          = $script:CachedGpuPower
        GpuTemp           = $script:CachedGpuTemp
    }
}

function Get-SystemMetrics {
    Initialize-StaticSystemCache
    $fast = Get-FastHardwareMetrics

    # Refresh PowerPlan & Telemetry service status every 5 seconds instead of every tick
    if (([datetime]::Now - $script:LastPowerPlanCheck).TotalSeconds -ge 5) {
        try {
            $ActivePlan = powercfg /getactivescheme
            if ($ActivePlan -match '\((.*)\)') { $script:CachedPowerPlan = $Matches[1] }
        } catch {}
        try {
            $TelService = Get-Service -Name DiagTrack -ErrorAction SilentlyContinue
            $script:CachedTelemetry = if ($TelService -and $TelService.Status -eq 'Running') { "On" } else { "Off" }
        } catch {}
        $script:LastPowerPlanCheck = [datetime]::Now
    }

    return [PSCustomObject]@{
        CpuLoad           = $fast.CpuLoad
        CpuClock          = $fast.CpuClock
        CpuTemp           = $fast.CpuTemp
        CacheMatrix       = $script:StaticSystemCache.CacheMatrix
        TelemetryStatus   = $script:CachedTelemetry
        RamPercent        = $fast.RamPercent
        RamUsageText      = $fast.RamUsageText
        PagefilePercent   = $fast.PagefilePercent
        PagefileUsageText = $fast.PagefileUsageText
        PowerPlan         = $script:CachedPowerPlan
        GpuModel          = $script:StaticSystemCache.GpuModel
        GpuLoad           = $fast.GpuLoad
        GpuPower          = $fast.GpuPower
        GpuTemp           = $fast.GpuTemp
        GpuDriverVersion  = $script:StaticSystemCache.GpuDriverVersion
    }
}
