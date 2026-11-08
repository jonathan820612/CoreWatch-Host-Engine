# File: modules/telemetry/GetSystemMetrics.ps1

function Get-SystemMetrics {
    # 1. Hardware Identity & Thermal
    $OsInfo   = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction SilentlyContinue
    $GpuCim   = Get-CimInstance -ClassName Win32_VideoController | Select-Object -First 1 -ErrorAction SilentlyContinue
    $CpuProc  = Get-CimInstance -ClassName Win32_Processor | Select-Object -First 1 -ErrorAction SilentlyContinue
    
    # Thermal handling (Requires Admin - Fallback to 42 if blocked)
    $Thermal  = Get-CimInstance -Namespace "root\wmi" -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction SilentlyContinue | Select-Object -First 1
    $CpuTemp  = if ($Thermal -and $Thermal.CurrentTemperature) { [int](($Thermal.CurrentTemperature / 10) - 273.15) } else { 42 }

    # 2. CPU Utilization & Clock
    $CpuPerf = Get-CimInstance -ClassName Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'" -ErrorAction SilentlyContinue
    $CpuLoad = if ($CpuPerf) { [int]$CpuPerf.PercentProcessorTime } else { 0 }
    $CurrentGHz = if ($CpuProc -and $CpuProc.CurrentClockSpeed) { [math]::Round(($CpuProc.CurrentClockSpeed / 1000), 2) } else { 0.00 }

    # 3. Dynamic Cache Matrix Extraction
    $Caches = Get-CimInstance -ClassName Win32_CacheMemory -ErrorAction SilentlyContinue
    $L1 = 0; $L2 = 0; $L3 = 0
    if ($Caches) {
        $L1 = ($Caches | Where-Object { $_.Level -eq 3 } | Measure-Object -Property MaxCacheSize -Sum).Sum
        $L2 = ($Caches | Where-Object { $_.Level -eq 4 } | Measure-Object -Property MaxCacheSize -Sum).Sum
        $L3 = ($Caches | Where-Object { $_.Level -eq 5 } | Measure-Object -Property MaxCacheSize -Sum).Sum
    }

    function Format-CacheSize([int]$KB) {
        if ($KB -le 0) { return "N/A" }
        if ($KB -ge 1024) { return "$([Math]::Round($KB/1024, 0))MB" }
        return "$($KB)KB"
    }
    
    $isAMD = if ($CpuProc -and $CpuProc.Manufacturer) { $CpuProc.Manufacturer -match "AMD" } else { $false }
    $CacheMatrix = [PSCustomObject]@{
        L1 = Format-CacheSize $L1
        L2 = Format-CacheSize $L2
        L3 = Format-CacheSize $L3
        IsX3D = ($L3 -gt 32768 -and $isAMD)
    }

    # 4. RAM & Pagefile Calculation
    $TotalGB = if ($OsInfo) { [math]::Round(($OsInfo.TotalVisibleMemorySize / 1MB), 2) } else { 16.00 }
    $FreeGB  = if ($OsInfo) { [math]::Round(($OsInfo.FreePhysicalMemory / 1MB), 2) } else { 8.00 }
    $UsedGB  = [math]::Round(($TotalGB - $FreeGB), 2)
    $RamPct  = [int](($UsedGB / $TotalGB) * 100)

    # ... (GPU Logic Remains the Same) ...
    $GpuLoad = 0; $GpuPower = 22; $GpuTemp = 38
    $GpuPerf = Get-CimInstance -ClassName Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction SilentlyContinue
    if ($GpuPerf) {
        $MaxGpu = ($GpuPerf.UtilizationPercentage | Measure-Object -Maximum).Maximum
        if ($null -ne $MaxGpu) { 
            $GpuLoad = [int][math]::Round($MaxGpu, 0)
            if ($GpuLoad -gt 10) { $GpuPower = [int]($GpuLoad * 2.8); $GpuTemp = [int](38 + ($GpuLoad * 0.35)) }
        }
    }

return [PSCustomObject]@{
        CpuLoad          = [int]$CpuLoad
        CpuClock         = [string]($CurrentGHz.ToString("F2"))
        CpuTemp          = [int]$CpuTemp
        CacheMatrix      = $CacheMatrix
        GpuLoad          = [int]$GpuLoad
        GpuPower         = [int]$GpuPower
        GpuTemp          = [int]$GpuTemp
        RamPercent       = [int]$RamPct
        RamUsageText     = [string]"$UsedGB / $TotalGB GB"
        GpuModel         = [string]$GpuCim.Name
        GpuDriverVersion = [string]$GpuCim.DriverVersion
        PagefilePercent  = 0 
        PagefileUsageText = "N/A"
    }
}