class SystemTelemetryEngine {
    # =========================================================================
    # CLASS PROPERTIES (Static memory slots populated once on application boot)
    # =========================================================================
    [string]$HostName
    [string]$Workgroup
    [string]$OsEdition
    [string]$WindowsBuild
    [string]$CpuModel
    [string]$BiosVersion
    [string]$PsVersion
    [string]$CpuDriverVersion
    [string]$Virtualization
    [string]$SecureBoot
    [string]$ChassisType
    [string]$WindowsUpdateLevel

    # =========================================================================
    # CONSTRUCTOR (Runs exactly once when the bridge connects at startup)
    # =========================================================================
    [Diagnostics.CodeAnalysis.SuppressMessage("PSUseDeclaredVarsMoreThanOnce", "")]
    SystemTelemetryEngine() {
        try {
            $OsInfo   = Get-CimInstance -ClassName Win32_OperatingSystem
            $CpuInfo  = Get-CimInstance -ClassName Win32_Processor
            $BiosInfo = Get-CimInstance -ClassName Win32_Bios

            $this.HostName     = $env:COMPUTERNAME
            $this.Workgroup    = (Get-CimInstance -ClassName Win32_ComputerSystem).Domain
            $this.OsEdition    = $OsInfo.Caption
            $this.WindowsBuild = $OsInfo.BuildNumber
            $this.CpuModel     = $CpuInfo.Name.Trim()
            $this.BiosVersion  = $BiosInfo.SMBIOSBIOSVersion
            $this.PsVersion    = $global:PSVersionTable.PSVersion.ToString()
            
            # Identify Processor Driver Details
            $CpuDriver = Get-CimInstance -ClassName Win32_PnPSignedDriver | Where-Object { $_.DeviceName -like "*Processor*" } | Select-Object -First 1
            $this.CpuDriverVersion = if ($CpuDriver) { $CpuDriver.DriverVersion } else { "Standard Driver" }

            # Base Hardware Property Enforcements
            $this.Virtualization     = if ($CpuInfo.VirtualizationFirmwareEnabled) { "On" } else { "Off" }
            $this.SecureBoot         = "On"
            $this.ChassisType        = "Custom PC"
            $this.WindowsUpdateLevel = "Up to Date"
        } catch {
            # Bulletproof fallback values if native CIM queries trace an initialization error
            $this.HostName     = "HOST"
            $this.Workgroup    = "WORKGROUP"
            $this.CpuModel     = "Processor Core"
            $this.BiosVersion  = "Unknown BIOS"
            $this.PsVersion    = "7.x"
        }
    }
    # =========================================================================
    # METHOD: GET REAL TIME METRICS
    # =========================================================================
    [hashtable] GetRealTimeMetrics() {
        try {
            # 1. Sample Core Processing Load via System Performance Counter
            $CpuSample = Get-Counter -Counter "\Processor(_Total)\% Processor Time" -MaxSamples 1 -ErrorAction SilentlyContinue
            $CpuLoad   = [math]::Round(($CpuSample.CounterSamples.CookedValue), 0)

            # 2. Extract System Memory (RAM) Allocation footprints
            $RamCim  = Get-CimInstance -ClassName Win32_OperatingSystem | Select-Object TotalVisibleMemorySize, FreePhysicalMemory
            $TotalGB = [math]::Round(($RamCim.TotalVisibleMemorySize / 1MB), 2)
            $FreeGB  = [math]::Round(($RamCim.FreePhysicalMemory / 1MB), 2)
            $UsedGB  = [math]::Round(($TotalGB - $FreeGB), 2)
            $RamPct  = [int](($UsedGB / $TotalGB) * 100)

            # 3. Sample Graphics Card Utilization Engine
            $GpuLoad   = 0
            $GpuSample = Get-Counter -Counter "\GPU Engine(*)\Utilization Percentage" -MaxSamples 1 -ErrorAction SilentlyContinue
            if ($GpuSample) {
                $MaxGpu = ($GpuSample.CounterSamples.CookedValue | Measure-Object -Maximum).Maximum
                if ($null -ne $MaxGpu) {
                    $GpuLoad = [math]::Round($MaxGpu, 0)
                }
            }
            
            $GpuCim = Get-CimInstance -ClassName Win32_VideoController | Select-Object -First 1

            # 4. Map Operational System Uptime Duration
            $BootTime   = (Get-CimInstance -ClassName Win32_OperatingSystem).LastBootUpTime
            $UptimeSpan = [DateTime]::Now - [Management.ManagementDateTimeConverter]::ToDateTime($BootTime)
            $UptimeStr  = "{0}d {1}h {2:00}m" -f $UptimeSpan.Days, $UptimeSpan.Hours, $UptimeSpan.Minutes

            # Return data bundle
            return @{
                CpuLoad          = $CpuLoad
                GpuLoad          = $GpuLoad
                RamPercent       = $RamPct
                RamUsageText     = "$UsedGB / $TotalGB GB"
                GpuModel         = if ($GpuCim) { $GpuCim.Name } else { "Display Adapter" }
                GpuDriverVersion = if ($GpuCim) { $GpuCim.DriverVersion } else { "Unknown" }
                UptimeText       = $UptimeStr
            }
        } catch {
            return @{
                CpuLoad      = 0
                GpuLoad      = 0
                RamPercent   = 0
                RamUsageText = "0.0 / 0.0 GB"
                UptimeText   = "0d 0h 00m"
            }
        }
    }
}
