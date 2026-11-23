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

$script:StaticSystemCache    = $null
$script:CpuPerfCounter       = $null
$script:CpuFreqPctCounter    = $null
$script:NvidiaSmiPath        = $null
$script:NvidiaSmiChecked     = $false
$script:LastSensorSample     = [datetime]::MinValue
$script:CachedGpuLoad        = 0
$script:CachedGpuPower       = "-- W"
$script:CachedGpuTemp        = "--"
$script:CachedCpuTemp        = "--"
$script:LastPowerPlanCheck   = [datetime]::MinValue
$script:CachedPowerPlan      = "Balanced"
$script:CachedTelemetry      = "Off"

# =========================================================================
# [DIAGNOSTIC ADDITION] HARDWARE BOTTLENECK, VRAM & TOP PROCESS CACHES
# =========================================================================
$script:CachedGpuVramPct     = 0
$script:CachedGpuVramText    = "-- / -- GB"
$script:CachedThrottleState  = "None"
$script:CachedThrottleDetail = "No CPU/GPU throttling detected"
$script:CachedTopProcessText = "Sampling..."
$script:CachedTopProcessDetail = ""
$script:LastProcCpuMap       = @{}
$script:LastProcSampleTime   = [datetime]::MinValue
$script:LastCpuLoadSample    = 0
$script:LastCpuPerfPct       = 100.0

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

    # [DIAGNOSTIC ADDITION] Resolve accurate 64-bit GPU VRAM total (Win32_VideoController.AdapterRAM caps at 4GB)
    $gpuVramTotalBytes = [double]0
    try {
        $displayClassPath = "HKLM:\SYSTEM\ControlSet001\Control\Class\{4d36e968-e325-11ce-bfc1-08002be10318}\0*"
        $regAdapters = Get-ItemProperty -Path $displayClassPath -ErrorAction SilentlyContinue
        foreach ($ra in $regAdapters) {
            if ($ra.'HardwareInformation.qwMemorySize' -and $ra.DriverDesc) {
                $qwBytes = [double]$ra.'HardwareInformation.qwMemorySize'
                if ($GpuCim -and $ra.DriverDesc -like "*$($GpuCim.Name)*") {
                    $gpuVramTotalBytes = $qwBytes
                    break
                }
                if ($qwBytes -gt $gpuVramTotalBytes) { $gpuVramTotalBytes = $qwBytes }
            }
        }
    } catch {}
    if ($gpuVramTotalBytes -le 0 -and $GpuCim -and $GpuCim.AdapterRAM -gt 0) {
        $gpuVramTotalBytes = [double]$GpuCim.AdapterRAM
    }

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
        CacheMatrix       = @{
            L1    = Format-Cache $L1
            L2    = Format-Cache $L2
            L3    = Format-Cache $L3
            IsX3D = ($CpuProc -and ($CpuProc.Name -match '(?i)\b\w*X3D\b'))
        }
        GpuModel          = if ($GpuCim) { [string]$GpuCim.Name } else { "Display Adapter" }
        GpuDriverVersion  = if ($GpuCim) { [string]$GpuCim.DriverVersion } else { "Unknown" }
        GpuVramTotalBytes = $gpuVramTotalBytes
        BaseClockMHz      = $baseClockMHz
        CpuClockGHz       = $clockGHz
        LogicalProcessors = [math]::Max(1, [Environment]::ProcessorCount)
    }
}

# =========================================================================
# [DIAGNOSTIC ADDITION] TOP ACTIVE PROCESS SAMPLER (CPU % DELTA + RAM)
# Insert Point: Called every 2 seconds inside Update-LiveThermalAndGpuSensors
# =========================================================================
function Update-TopResourceConsumer {
    try {
        $now = [datetime]::Now
        $elapsedMs = if ($script:LastProcSampleTime -ne [datetime]::MinValue) {
            ($now - $script:LastProcSampleTime).TotalMilliseconds
        } else { 0.0 }

        $logicalCores = if ($script:StaticSystemCache) { $script:StaticSystemCache.LogicalProcessors } else { [math]::Max(1, [Environment]::ProcessorCount) }
        $newCpuMap = @{}

        $topRamName = $null; $topRamBytes = 0L
        $topCpuName = $null; $topCpuPct = 0.0; $topCpuBytes = 0L

        $procs = [System.Diagnostics.Process]::GetProcesses()
        foreach ($p in $procs) {
            try {
                $pidVal = $p.Id
                $pName  = $p.ProcessName
                if ($pidVal -eq 0 -or $pName -eq 'Idle' -or $pName -eq 'System' -or $pName -eq 'Memory Compression') { continue }

                $ws = $p.WorkingSet64
                if ($ws -gt $topRamBytes) {
                    $topRamBytes = $ws
                    $topRamName  = $pName
                }

                try {
                    $cpuMs = $p.TotalProcessorTime.TotalMilliseconds
                    $newCpuMap[$pidVal] = $cpuMs
                    if ($elapsedMs -ge 400 -and $script:LastProcCpuMap.ContainsKey($pidVal)) {
                        $deltaMs = $cpuMs - [double]$script:LastProcCpuMap[$pidVal]
                        if ($deltaMs -gt 0) {
                            $pct = ($deltaMs / ($elapsedMs * $logicalCores)) * 100.0
                            if ($pct -gt $topCpuPct) {
                                $topCpuPct   = [math]::Min(100.0, $pct)
                                $topCpuName  = $pName
                                $topCpuBytes = $ws
                            }
                        }
                    }
                } catch {}
            } finally {
                $p.Dispose()
            }
        }

        $script:LastProcCpuMap     = $newCpuMap
        $script:LastProcSampleTime = $now

        $fmtMem = {
            param([long]$bytes)
            if ($bytes -ge 1GB) { "{0:N2} GB" -f ($bytes / 1GB) }
            else { "{0:N0} MB" -f ($bytes / 1MB) }
        }

        $ramStr = if ($topRamName) { & $fmtMem $topRamBytes } else { "0 MB" }
        $cpuMemStr = if ($topCpuName) { & $fmtMem $topCpuBytes } else { "0 MB" }
        $cpuPctRounded = [int][math]::Round($topCpuPct)

        # Highlight active CPU spike (>= 10% CPU), otherwise display top RAM consumer
        if ($topCpuName -and $cpuPctRounded -ge 10) {
            $script:CachedTopProcessText = "$topCpuName.exe ($cpuPctRounded% CPU · $cpuMemStr)"
        } elseif ($topRamName) {
            $script:CachedTopProcessText = "$topRamName.exe ($ramStr)"
        }

        $cpuSummary = if ($topCpuName) { "$topCpuName.exe ($cpuPctRounded% CPU)" } else { "Idle" }
        $ramSummary = if ($topRamName) { "$topRamName.exe ($ramStr RAM)" } else { "N/A" }
        $script:CachedTopProcessDetail = "Top CPU: $cpuSummary | Top RAM: $ramSummary"
    } catch {}
}

function Update-LiveThermalAndGpuSensors {
    # Throttled to every 2 seconds so the 0.5s fast loop stays sub-millisecond
    if (([datetime]::Now - $script:LastSensorSample).TotalSeconds -lt 2) { return }
    $script:LastSensorSample = [datetime]::Now

    $thermalFlags = [System.Collections.Generic.List[string]]::new()
    $powerFlags   = [System.Collections.Generic.List[string]]::new()

    # 1. Live NVIDIA GPU telemetry via nvidia-smi (Load, Temp, Power, VRAM Used/Total, Throttle Event Mask)
    if ($script:NvidiaSmiPath) {
        $smiLine = $null
        foreach ($queryArgs in @(
            "--query-gpu=utilization.gpu,temperature.gpu,power.draw,memory.used,memory.total,power.limit,clocks_event_reasons.active --format=csv,noheader,nounits",
            "--query-gpu=utilization.gpu,temperature.gpu,power.draw,memory.used,memory.total,power.limit --format=csv,noheader,nounits"
        )) {
            try {
                $psi = New-Object System.Diagnostics.ProcessStartInfo
                $psi.FileName = $script:NvidiaSmiPath
                $psi.Arguments = $queryArgs
                $psi.RedirectStandardOutput = $true
                $psi.UseShellExecute = $false
                $psi.CreateNoWindow = $true
                $proc = [System.Diagnostics.Process]::Start($psi)
                if ($proc -and $proc.WaitForExit(750) -and $proc.ExitCode -eq 0) {
                    $candidate = $proc.StandardOutput.ReadLine()
                    if ($candidate -and $candidate -notmatch '(?i)not supported|error|invalid') {
                        $smiLine = $candidate
                    }
                }
                if ($proc) { $proc.Dispose() }
                if ($smiLine) { break }
            } catch {}
        }

        if ($smiLine) {
            $parts = $smiLine -split ','
            $inv = [System.Globalization.CultureInfo]::InvariantCulture
            $loadVal = 0; $tempVal = 0; $pwrVal = 0.0; $memUsed = 0.0; $memTotal = 0.0; $pwrLimit = 0.0

            if ($parts.Count -ge 3) {
                if ([int]::TryParse($parts[0].Trim(), [ref]$loadVal)) {
                    $script:CachedGpuLoad = [math]::Max(0, [math]::Min(100, $loadVal))
                }
                if ([int]::TryParse($parts[1].Trim(), [ref]$tempVal)) {
                    $script:CachedGpuTemp = $tempVal
                }
                if ([double]::TryParse($parts[2].Trim(), [System.Globalization.NumberStyles]::Float, $inv, [ref]$pwrVal)) {
                    $script:CachedGpuPower = "$([int][math]::Round($pwrVal)) W"
                }
            }

            # [DIAGNOSTIC ADDITION] GPU VRAM Allocation (MiB -> GB)
            if ($parts.Count -ge 5) {
                if ([double]::TryParse($parts[3].Trim(), [System.Globalization.NumberStyles]::Float, $inv, [ref]$memUsed) -and
                    [double]::TryParse($parts[4].Trim(), [System.Globalization.NumberStyles]::Float, $inv, [ref]$memTotal) -and
                    $memTotal -gt 0) {
                    $usedGB  = $memUsed / 1024.0
                    $totalGB = $memTotal / 1024.0
                    $script:CachedGpuVramPct  = [int][math]::Min(100, [math]::Max(0, [math]::Round(($usedGB / $totalGB) * 100.0)))
                    $script:CachedGpuVramText = "{0:N1} / {1:N1} GB" -f $usedGB, $totalGB
                }
            }

            if ($parts.Count -ge 6) {
                $null = [double]::TryParse($parts[5].Trim(), [System.Globalization.NumberStyles]::Float, $inv, [ref]$pwrLimit)
            }

            # [DIAGNOSTIC ADDITION] NVIDIA Clocks Throttle/Event Reason Bitmask Decoding
            $gpuMaskParsed = $false
            if ($parts.Count -ge 7) {
                $maskStr = $parts[6].Trim()
                if ($maskStr -match '^0x([0-9a-fA-F]+)$') {
                    try {
                        $mask = [Convert]::ToUInt64($Matches[1], 16)
                        $gpuMaskParsed = $true
                        # NVML bitmask: 0x04=SwPowerCap, 0x08=HwSlowdown, 0x20=SwThermal, 0x40=HwThermal, 0x80=HwPowerBrake
                        if (($mask -band 0x60) -ne 0) { $thermalFlags.Add("GPU Thermal Slowdown ($($script:CachedGpuTemp)°C)") }
                        if (($mask -band 0x84) -ne 0) { $powerFlags.Add("GPU Power Cap ($($script:CachedGpuPower))") }
                        if (($mask -band 0x08) -ne 0 -and ($mask -band 0xE4) -eq 0) {
                            if ($tempVal -ge 82) { $thermalFlags.Add("GPU HW Thermal Slowdown ($tempVal°C)") }
                            else { $powerFlags.Add("GPU HW Power Slowdown") }
                        }
                    } catch {}
                }
            }
            if (-not $gpuMaskParsed) {
                if ($tempVal -ge 85) { $thermalFlags.Add("GPU High Temp ($tempVal°C)") }
                if ($pwrLimit -gt 0 -and $pwrVal -ge ($pwrLimit * 0.98) -and $loadVal -ge 85) {
                    $powerFlags.Add("GPU Power Limit ($([int]$pwrVal)/$([int]$pwrLimit)W)")
                }
            }
        }
    } else {
        # Fallback GPU Load + VRAM via Windows GPU Performance Counters (AMD / Intel / non-NVIDIA)
        try {
            $gpuSamples = (Get-Counter '\GPU Engine(*engtype_3D)\Utilization Percentage' -ErrorAction SilentlyContinue).CounterSamples
            if ($gpuSamples) {
                $sumLoad = ($gpuSamples | Measure-Object -Property CookedValue -Sum).Sum
                $script:CachedGpuLoad = [int][math]::Min(100, [math]::Max(0, [math]::Round($sumLoad)))
            }
        } catch {}

        try {
            $vramRows = Get-CimInstance -ClassName Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory -ErrorAction SilentlyContinue
            if ($vramRows) {
                $dedUsedBytes = ($vramRows | Measure-Object -Property DedicatedUsage -Maximum).Maximum
                $totalBytes   = if ($script:StaticSystemCache) { [double]$script:StaticSystemCache.GpuVramTotalBytes } else { 0.0 }
                if ($totalBytes -gt 0) {
                    $usedGB  = $dedUsedBytes / 1GB
                    $totalGB = $totalBytes / 1GB
                    $script:CachedGpuVramPct  = [int][math]::Min(100, [math]::Max(0, [math]::Round(($usedGB / $totalGB) * 100.0)))
                    $script:CachedGpuVramText = "{0:N1} / {1:N1} GB" -f $usedGB, $totalGB
                }
            }
        } catch {}
    }

    # 2. Live CPU / ACPI Thermal Zone sensor + CPU Thermal/Power Throttling Flags
    $resolvedCpuTemp = $null
    try {
        $tz = Get-CimInstance -Namespace "root\WMI" -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($tz -and $tz.CurrentTemperature -gt 2732) {
            $c = [int][math]::Round(($tz.CurrentTemperature / 10.0) - 273.15)
            if ($c -ge 23 -and $c -le 115) { $resolvedCpuTemp = $c }
        }
    } catch {}

    try {
        $tzPerfs = @(Get-CimInstance -ClassName Win32_PerfFormattedData_Counters_ThermalZoneInformation -ErrorAction SilentlyContinue)
        foreach ($tzPerf in $tzPerfs) {
            if ($null -eq $resolvedCpuTemp -and ($tzPerf.HighPrecisionTemperature -gt 2732 -or $tzPerf.Temperature -gt 273)) {
                $c = if ($tzPerf.HighPrecisionTemperature -gt 2732) {
                    [int][math]::Round(($tzPerf.HighPrecisionTemperature / 10.0) - 273.15)
                } else {
                    [int]($tzPerf.Temperature - 273)
                }
                if ($c -ge 23 -and $c -le 115) { $resolvedCpuTemp = $c }
            }
            if ($tzPerf.ThrottleReasons -gt 0) {
                $thermalFlags.Add("ACPI Thermal Zone Throttled ($($tzPerf.Name))")
            }
        }
    } catch {}

    if ($null -ne $resolvedCpuTemp) {
        $script:CachedCpuTemp = $resolvedCpuTemp
        if ($resolvedCpuTemp -ge 92) {
            $thermalFlags.Add("CPU High Temp ($resolvedCpuTemp°C)")
        }
    }

    # [DIAGNOSTIC ADDITION] CPU Performance Limit Flags (Thermal / Power Limit)
    try {
        $procInfo = Get-CimInstance -ClassName Win32_PerfFormattedData_Counters_ProcessorInformation -Filter "Name='_Total'" -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($procInfo) {
            $flags = [int]$procInfo.PerformanceLimitFlags
            $limitPct = [int]$procInfo.PercentPerformanceLimit
            if ($limitPct -gt 0 -and $limitPct -lt 100) {
                if (($flags -band 2) -ne 0) { $thermalFlags.Add("CPU Thermal Limit ($limitPct% cap)") }
                if (($flags -band 1) -ne 0) { $powerFlags.Add("CPU Power Limit ($limitPct% cap)") }
                if ($flags -eq 0 -and $limitPct -le 85) { $powerFlags.Add("CPU Perf Capped ($limitPct%)") }
            }
        }
    } catch {}

    if ($thermalFlags.Count -eq 0 -and $powerFlags.Count -eq 0) {
        if ($script:LastCpuLoadSample -ge 85 -and $script:LastCpuPerfPct -gt 5 -and $script:LastCpuPerfPct -lt 75) {
            $powerFlags.Add("CPU Downclock Under Load ($([int]$script:LastCpuPerfPct)% freq)")
        }
    }

    if ($thermalFlags.Count -gt 0 -and $powerFlags.Count -gt 0) {
        $script:CachedThrottleState  = "Thermal/Power"
        $script:CachedThrottleDetail = ($thermalFlags + $powerFlags) -join " | "
    } elseif ($thermalFlags.Count -gt 0) {
        $script:CachedThrottleState  = "Thermal"
        $script:CachedThrottleDetail = $thermalFlags -join " | "
    } elseif ($powerFlags.Count -gt 0) {
        $script:CachedThrottleState  = "Power"
        $script:CachedThrottleDetail = $powerFlags -join " | "
    } else {
        $script:CachedThrottleState  = "None"
        $script:CachedThrottleDetail = "No CPU/GPU thermal or power throttling detected"
    }

    # 3. Sample Top Active Process (CPU spike or RAM leader)
    Update-TopResourceConsumer
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
    $script:LastCpuLoadSample = $cpuLoad

    # Dynamic live CPU clock (Base MHz * % Processor Performance)
    $clockStr = if ($script:StaticSystemCache) { "$($script:StaticSystemCache.CpuClockGHz) GHz" } else { "0.00 GHz" }
    if ($null -ne $script:CpuFreqPctCounter -and $script:StaticSystemCache -and $script:StaticSystemCache.BaseClockMHz -gt 0) {
        try {
            $perfPct = [double]$script:CpuFreqPctCounter.NextValue()
            if ($perfPct -gt 5) {
                $script:LastCpuPerfPct = $perfPct
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
        ThrottleState     = $script:CachedThrottleState
        ThrottleDetail    = $script:CachedThrottleDetail
        RamPercent        = $ramPct
        RamUsageText      = $ramUsageText
        PagefilePercent   = $pagePct
        PagefileUsageText = $pageUsageText
        GpuLoad           = $script:CachedGpuLoad
        GpuPower          = $script:CachedGpuPower
        GpuTemp           = $script:CachedGpuTemp
        GpuVramPercent    = $script:CachedGpuVramPct
        GpuVramText       = $script:CachedGpuVramText
        TopProcessText    = $script:CachedTopProcessText
        TopProcessDetail  = $script:CachedTopProcessDetail
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
        ThrottleState     = $fast.ThrottleState
        ThrottleDetail    = $fast.ThrottleDetail
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
        GpuVramPercent    = $fast.GpuVramPercent
        GpuVramText       = $fast.GpuVramText
        GpuDriverVersion  = $script:StaticSystemCache.GpuDriverVersion
        TopProcessText    = $fast.TopProcessText
        TopProcessDetail  = $fast.TopProcessDetail
    }
}
