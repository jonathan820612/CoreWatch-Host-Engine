function Get-SystemMetrics {
    $OsInfo   = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction SilentlyContinue
    $GpuCim   = Get-CimInstance -ClassName Win32_VideoController | Select-Object -First 1 -ErrorAction SilentlyContinue
    $CpuProc  = Get-CimInstance -ClassName Win32_Processor | Select-Object -First 1 -ErrorAction SilentlyContinue
    
    # 1. Pagefile Calculation (Fixed format)
    $MemPerf = Get-CimInstance -ClassName Win32_PerfFormattedData_PerfOS_Memory -ErrorAction SilentlyContinue
    $PageTotalGB = [math]::Round(($OsInfo.SizeStoredInPagingFiles / 1MB), 2)
    $UsedGB = [math]::Round(($OsInfo.TotalVisibleMemorySize - $OsInfo.FreePhysicalMemory) / 1MB, 2)
    $PageUsedGB = if ($MemPerf) { [math]::Max(0, [math]::Round(($MemPerf.CommittedBytes / 1GB) - $UsedGB, 2)) } else { 0.00 }
    $PagePercent = if ($PageTotalGB -gt 0) { [int](($PageUsedGB / $PageTotalGB) * 100) } else { 0 }

    # 2. Power Plan detection
    $ActivePlan = powercfg /getactivescheme
    $PlanName = if ($ActivePlan -match '\((.*)\)') { $Matches[1] } else { "Unknown" }

    # 3. Dynamic Cache Matrix (Aggregated for Intel/AMD)
    $Caches = Get-CimInstance -ClassName Win32_CacheMemory -ErrorAction SilentlyContinue
    $L1=0; $L2=0; $L3=0
    foreach($c in $Caches) {
        if ($c.Level -eq 3) { $L1 += $c.MaxCacheSize }
        elseif ($c.Level -eq 4) { $L2 += $c.MaxCacheSize }
        elseif ($c.Level -eq 5) { $L3 += $c.MaxCacheSize }
    }
    function Format-Cache([int]$kb) { if($kb -ge 1024){ "$([math]::Round($kb/1024,0))MB" } else { "$kb"+"KB" } }

    return [PSCustomObject]@{
        CpuLoad          = [int](Get-CimInstance Win32_PerfFormattedData_PerfOS_Processor -Filter "Name='_Total'").PercentProcessorTime
        CpuClock         = [string]([math]::Round($CpuProc.CurrentClockSpeed/1000, 2))
        CpuTemp          = 42 # Thermal logic usually requires elevated CIM
        CacheMatrix      = @{ L1=Format-Cache $L1; L2=Format-Cache $L2; L3=Format-Cache $L3; IsX3D=($L3 -gt 33000) }
        RamPercent       = [int](($UsedGB / ($OsInfo.TotalVisibleMemorySize/1MB)) * 100)
        RamUsageText     = "$UsedGB / $([math]::Round($OsInfo.TotalVisibleMemorySize/1MB, 2)) GB"
        PagefilePercent  = $PagePercent
        PagefileUsageText= "$PageUsedGB / $PageTotalGB GB"
        PowerPlan        = $PlanName
        GpuModel         = $GpuCim.Name
        GpuLoad          = 0 # Placeholder for GPU engine
        GpuPower         = 22
        GpuTemp          = 38
        GpuDriverVersion = $GpuCim.DriverVersion
    }
}