function Get-SystemStoragePayload {
    [CmdletBinding()]
    param()
    try {
        $Drives = Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DriveType=2 OR DriveType=3" -ErrorAction SilentlyContinue
        $StorageArray = @()
        
        foreach ($Drive in $Drives) {
            $TotalByte = if ($Drive.Size) { $Drive.Size } else { 1 }
            $FreeByte = if ($Drive.FreeSpace) { $Drive.FreeSpace } else { 0 }
            
            $TotalGb = [math]::Round($TotalByte / 1GB, 2)
            $FreeGb = [math]::Round($FreeByte / 1GB, 2)
            $UsedPercent = [int](100 - (($FreeByte / $TotalByte) * 100))
            
            $TypeLabel = switch ($Drive.DriveType) {
                2 { "💾 Removable Storage" }
                3 { "💽 Fixed Partition" }
                default { "💿 Media Drive" }
            }

            # RESTORED AND VERIFIED PROXIES: Prevents blank text breaks
            $FinalName = "Local Disk"
            if ($Drive.VolumeName -and $Drive.VolumeName.Trim() -ne "") {
                $FinalName = $Drive.VolumeName.Trim()
            }

            $StorageArray += @{
                DriveLetter = $Drive.DeviceID
                VolumeName  = $FinalName
                TypeLabel   = $TypeLabel
                TotalSpace  = "$TotalGb GB"
                FreeSpace   = "$FreeGb GB"
                PercentUsed = $UsedPercent
            }
        }
        return $StorageArray
    } catch { return @() }
}

function Set-SystemStorageLabel {
    param(
        [string]$DriveLetter,
        [string]$NewLabel
    )
    try {
        $Target = Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DeviceID='$DriveLetter'" -ErrorAction SilentlyContinue
        if ($Target) {
            $Target.VolumeName = $NewLabel
            Set-CimInstance -CimInstance $Target -ErrorAction SilentlyContinue
            return $true
        }
        return $false
    } catch { return $false }
}

Export-ModuleMember -Function Get-SystemStoragePayload, Set-SystemStorageLabel
