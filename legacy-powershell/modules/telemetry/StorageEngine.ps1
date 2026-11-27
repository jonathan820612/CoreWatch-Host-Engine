# File: modules/telemetry/StorageEngine.ps1

# =========================================================================
# [DIAGNOSTIC ADDITION] SMART HEALTH/WEAR & DISK I/O LATENCY CACHES
# =========================================================================
$script:LastSmartRefresh = [datetime]::MinValue
$script:SmartHealthMap   = @{}
$script:DiskPerfCounters = @{}

# =========================================================================
# [DIAGNOSTIC ADDITION] SMART / MEDIA WEAR MAPPER (CACHED EVERY 30s)
# Insert Point: Maps Logical Drive Letter -> PhysicalDisk -> ReliabilityCounter
# =========================================================================
function Update-StorageSmartHealthMap {
    if (([datetime]::Now - $script:LastSmartRefresh).TotalSeconds -lt 30 -and $script:SmartHealthMap.Count -gt 0) { return }
    $script:LastSmartRefresh = [datetime]::Now

    $newMap = @{}
    try {
        $partitions = @(Get-Partition -ErrorAction SilentlyContinue | Where-Object { $_.DriveLetter })
        $physDisks  = @(Get-PhysicalDisk -ErrorAction SilentlyContinue)

        $physById = @{}
        foreach ($pd in $physDisks) {
            if ($null -ne $pd.DeviceId) {
                $physById[[string]$pd.DeviceId] = $pd
            }
        }

        $relByDiskId = @{}
        foreach ($pd in $physDisks) {
            $diskId = [string]$pd.DeviceId
            $rel = $null
            try { $rel = $pd | Get-StorageReliabilityCounter -ErrorAction SilentlyContinue } catch {}

            $media = if ($pd.BusType -eq 'NVMe') { "NVMe" }
                     elseif ($pd.BusType -eq 'USB') { "USB" }
                     elseif ($pd.MediaType -and $pd.MediaType -ne 'Unspecified') { [string]$pd.MediaType }
                     elseif ($pd.BusType) { [string]$pd.BusType }
                     else { "" }

            $wearVal = if ($rel -and $null -ne $rel.Wear -and [int]$rel.Wear -ge 0 -and [int]$rel.Wear -le 100) { [int]$rel.Wear } else { $null }
            $tempVal = if ($rel -and $null -ne $rel.Temperature -and [int]$rel.Temperature -gt 0 -and [int]$rel.Temperature -lt 120) { [int]$rel.Temperature } else { $null }
            $readErr = if ($rel -and $null -ne $rel.ReadErrorsTotal) { [long]$rel.ReadErrorsTotal } else { $null }
            $writeErr = if ($rel -and $null -ne $rel.WriteErrorsTotal) { [long]$rel.WriteErrorsTotal } else { $null }

            $health = if ($pd.HealthStatus) { [string]$pd.HealthStatus } else { "Unknown" }

            $summaryParts = [System.Collections.Generic.List[string]]::new()
            if ($pd.FriendlyName) { $summaryParts.Add($pd.FriendlyName.Trim()) }
            if ($media)           { $summaryParts.Add($media) }
            $summaryParts.Add("Health: $health")
            if ($null -ne $wearVal) { $summaryParts.Add("Wear: $wearVal%") }
            if ($null -ne $tempVal) { $summaryParts.Add("Temp: ${tempVal}°C") }
            if ($null -ne $readErr -or $null -ne $writeErr) {
                $summaryParts.Add("Errors(R/W): $(if ($null -ne $readErr) { $readErr } else { 0 })/$(if ($null -ne $writeErr) { $writeErr } else { 0 })")
            }

            $relByDiskId[$diskId] = @{
                HealthStatus = $health
                WearPercent  = $wearVal
                DiskTempC    = $tempVal
                MediaType    = $media
                SmartSummary = $summaryParts -join " · "
            }
        }

        foreach ($part in $partitions) {
            $letter = "$($part.DriveLetter):"
            $diskId = [string]$part.DiskNumber
            if ($relByDiskId.ContainsKey($diskId)) {
                $newMap[$letter] = $relByDiskId[$diskId]
            }
        }
    } catch {}

    if ($newMap.Count -gt 0) {
        $script:SmartHealthMap = $newMap
    }
}

# =========================================================================
# [DIAGNOSTIC ADDITION] LIVE PER-VOLUME ACTIVE TIME %, LATENCY (ms) & QUEUE
# Insert Point: Uses .NET LogicalDisk PerformanceCounters for exact float ms
# =========================================================================
function Get-DriveIoLatencySample {
    param([string]$DriveLetter)

    $activePct = 0
    $latencyMs = 0.0
    $queueLen  = 0.0

    try {
        if (-not $script:DiskPerfCounters.ContainsKey($DriveLetter)) {
            $cActive = New-Object System.Diagnostics.PerformanceCounter("LogicalDisk", "% Disk Time", $DriveLetter)
            $cLat    = New-Object System.Diagnostics.PerformanceCounter("LogicalDisk", "Avg. Disk sec/Transfer", $DriveLetter)
            $cQueue  = New-Object System.Diagnostics.PerformanceCounter("LogicalDisk", "Current Disk Queue Length", $DriveLetter)
            # Prime counters on first read
            $null = $cActive.NextValue()
            $null = $cLat.NextValue()
            $null = $cQueue.NextValue()
            $script:DiskPerfCounters[$DriveLetter] = @{
                Active  = $cActive
                Latency = $cLat
                Queue   = $cQueue
            }
        } else {
            $entry     = $script:DiskPerfCounters[$DriveLetter]
            $activePct = [int][math]::Min(100, [math]::Max(0, [math]::Round($entry.Active.NextValue())))
            $latencyMs = [math]::Round([math]::Max(0.0, ($entry.Latency.NextValue() * 1000.0)), 1)
            $queueLen  = [math]::Round([math]::Max(0.0, $entry.Queue.NextValue()), 1)
        }
    } catch {
        # Fallback if LogicalDisk counter instance is unavailable (e.g. disconnected/network drive)
        $activePct = 0
        $latencyMs = 0.0
        $queueLen  = 0.0
    }

    return @{
        DiskActivePct = $activePct
        DiskLatencyMs = $latencyMs
        DiskQueueLen  = $queueLen
    }
}

function Get-StorageMetrics {
    Update-StorageSmartHealthMap

    # Pure .NET DriveInfo enumeration (<0.1ms, zero WmiPrvSE / CIM overhead)
    $AllDrives = @([System.IO.DriveInfo]::GetDrives())

    $StorageArray = foreach ($Drive in $AllDrives) {
        try {
            if (-not $Drive.IsReady) { continue }
            $RawTotalBytes = [double]$Drive.TotalSize
            if ($RawTotalBytes -le 0) { continue }
            $RawFreeBytes  = [double]$Drive.AvailableFreeSpace
        } catch { continue }

        $DriveTotal = [math]::Round(($RawTotalBytes / 1GB), 2)
        $DriveFree  = [math]::Round(($RawFreeBytes / 1GB), 2)
        $DriveUsed  = [math]::Round(($DriveTotal - $DriveFree), 2)

        $dType = $Drive.DriveType
        $TypeDescription = switch ($dType) {
            ([System.IO.DriveType]::Removable) { "Removable" }
            ([System.IO.DriveType]::Fixed)     { "Local Volume" }
            ([System.IO.DriveType]::Network)   { "Network Route" }
            ([System.IO.DriveType]::CDRom)     { "Optical Compact Disc" }
            default                            { "External Device" }
        }

        $CurrentLabel = try { if ($Drive.VolumeLabel) { [string]$Drive.VolumeLabel } else { "Local Disk" } } catch { "Local Disk" }
        $driveId = $Drive.Name.TrimEnd('\')

        # Merge SMART Health/Wear and live I/O latency metrics per drive
        $smart = if ($script:SmartHealthMap.ContainsKey($driveId)) { $script:SmartHealthMap[$driveId] } else { $null }
        $io    = if ($dType -eq [System.IO.DriveType]::Fixed -or $dType -eq [System.IO.DriveType]::Removable) {
            Get-DriveIoLatencySample -DriveLetter $driveId
        } else {
            @{ DiskActivePct = 0; DiskLatencyMs = 0.0; DiskQueueLen = 0.0 }
        }

        [PSCustomObject]@{
            MainDriveLetter = $driveId
            StorageTotalGB  = $DriveTotal
            StorageFreeGB   = $DriveFree
            StorageUsedGB   = $DriveUsed
            DriveType       = $TypeDescription
            VolumeLabel     = $CurrentLabel
            HealthStatus    = if ($smart) { [string]$smart.HealthStatus } else { "N/A" }
            WearPercent     = if ($smart) { $smart.WearPercent } else { $null }
            DiskTempC       = if ($smart) { $smart.DiskTempC } else { $null }
            MediaType       = if ($smart) { [string]$smart.MediaType } else { "" }
            SmartSummary    = if ($smart) { [string]$smart.SmartSummary } else { "SMART counters unavailable (USB/virtual controller or non-admin)" }
            DiskActivePct   = [int]$io.DiskActivePct
            DiskLatencyMs   = [double]$io.DiskLatencyMs
            DiskQueueLen    = [double]$io.DiskQueueLen
        }
    }

    return $StorageArray
}

function Set-StorageLabel {
    param(
        [string]$DriveLetter,
        [string]$NewLabel
    )
    # The entire WMI execution block lives safely in its designated engine file
    $DriveInstance = Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DeviceID='$DriveLetter'" -ErrorAction SilentlyContinue
    if ($null -ne $DriveInstance) {
        $DriveInstance | Invoke-CimMethod -MethodName SetVolumeLabel -Arguments @{ VolumeLabel = $NewLabel.Trim() } -ErrorAction SilentlyContinue
    }
}
