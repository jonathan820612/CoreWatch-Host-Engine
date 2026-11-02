# File: modules/telemetry/StorageEngine.ps1

function Get-StorageMetrics {
    $AllDrives = Get-CimInstance -ClassName Win32_LogicalDisk -ErrorAction Stop

    $StorageArray = foreach ($Drive in $AllDrives) {
        if ([double]$Drive.Size -le 0) { continue }

        $RawTotalBytes = [double]$Drive.Size
        $RawFreeBytes  = [double]$Drive.FreeSpace

        $DriveTotal = [math]::Round(($RawTotalBytes / 1GB), 2)
        $DriveFree  = [math]::Round(($RawFreeBytes / 1GB), 2)
        $DriveUsed  = [math]::Round(($DriveTotal - $DriveFree), 2)

        $TypeDescription = switch ($Drive.DriveType) {
            2 { "Removable" }
            3 { "Local Volume" }
            4 { "Network Route" }
            5 { "Optical Compact Disc" }
            default { "External Device" }
        }

        $CurrentLabel = if ($Drive.VolumeName) { [string]$Drive.VolumeName } else { "Local Disk" }

        [PSCustomObject]@{
            MainDriveLetter = [string]$Drive.DeviceID
            StorageTotalGB  = $DriveTotal
            StorageFreeGB   = $DriveFree
            StorageUsedGB   = $DriveUsed
            DriveType       = $TypeDescription
            VolumeLabel     = $CurrentLabel
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
