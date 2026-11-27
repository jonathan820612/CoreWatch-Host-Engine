# File: modules/core/DiskPartitionerManager.ps1
# =========================================================================
# COREWATCH CUSTOM DISK PARTITIONER ENGINE
#   - Uses native Windows Storage cmdlets (Get-Disk, Get-Partition,
#     Get-Volume, Initialize-Disk, New-Partition, Format-Volume,
#     Resize-Partition, Set-Partition, Set-Volume, Remove-Partition,
#     Clear-Disk, Set-Disk).
#   - Strict server-side safety guardrails block destructive actions on
#     System, Boot, C:, EFI System, MSR Reserved, and Recovery partitions.
# =========================================================================

function Test-DiskPartitionerIsAdmin {
    try {
        $id = [Security.Principal.WindowsIdentity]::GetCurrent()
        $pr = New-Object Security.Principal.WindowsPrincipal($id)
        return $pr.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    } catch {
        return $false
    }
}

function Assert-DiskPartitionerAdmin {
    if (-not (Test-DiskPartitionerIsAdmin)) {
        throw "Administrator privileges are required to modify disks and partitions. Relaunch CoreWatch as Administrator."
    }
}

function Test-IsProtectedPartitionObject {
    param($Partition)
    if ($null -eq $Partition) { return $true }
    $letter = if ($Partition.DriveLetter) { ([string]$Partition.DriveLetter).Trim().ToUpperInvariant() } else { "" }
    if ($letter -eq "C") { return $true }
    if ([bool]$Partition.IsSystem -or [bool]$Partition.IsBoot) { return $true }
    $pType = [string]($Partition.Type ?? "")
    if ($pType -in @("System", "Reserved", "Recovery", "EFI System Partition")) { return $true }
    return $false
}

function Test-IsSystemOrBootDisk {
    param($Disk, $Partitions)
    if ($null -eq $Disk) { return $true }
    if ([bool]$Disk.IsSystem -or [bool]$Disk.IsBoot) { return $true }
    foreach ($p in @($Partitions)) {
        $ltr = if ($p.DriveLetter) { ([string]$p.DriveLetter).Trim().ToUpperInvariant() } else { "" }
        if ($ltr -eq "C" -or [bool]$p.IsSystem -or [bool]$p.IsBoot) { return $true }
    }
    return $false
}

function Get-AvailableDriveLetters {
    $used = New-Object System.Collections.Generic.HashSet[string]([System.StringComparer]::OrdinalIgnoreCase)
    try {
        Get-Volume -ErrorAction SilentlyContinue | ForEach-Object {
            if ($_.DriveLetter) { $null = $used.Add(([string]$_.DriveLetter).Trim().ToUpperInvariant()) }
        }
        [System.IO.DriveInfo]::GetDrives() | ForEach-Object {
            $ch = $_.Name.Substring(0, 1).ToUpperInvariant()
            $null = $used.Add($ch)
        }
    } catch {}
    $avail = New-Object System.Collections.Generic.List[string]
    foreach ($code in 68..90) { # D..Z
        $l = [string][char]$code
        if (-not $used.Contains($l)) { $avail.Add($l) }
    }
    return $avail.ToArray()
}

function Get-DiskPartitionerState {
    param(
        [switch]$Rescan,
        [string]$Notice = "",
        [bool]$NoticeError = $false
    )
    if ($Rescan) {
        try { Update-HostStorageCache -ErrorAction SilentlyContinue } catch {}
    }

    $isAdmin = Test-DiskPartitionerIsAdmin
    $availLetters = @(Get-AvailableDriveLetters)
    $disksOut = New-Object System.Collections.Generic.List[object]

    $allDisks = @(Get-Disk -ErrorAction SilentlyContinue | Sort-Object Number)
    foreach ($d in $allDisks) {
        $diskNum   = [int]$d.Number
        $diskBytes = [double]$d.Size
        $diskGB    = [math]::Round($diskBytes / 1GB, 2)
        $partStyle = [string]($d.PartitionStyle ?? "RAW")
        $rawParts  = @(Get-Partition -DiskNumber $diskNum -ErrorAction SilentlyContinue | Sort-Object Offset)
        $isSysDisk = Test-IsSystemOrBootDisk -Disk $d -Partitions $rawParts

        $segments = New-Object System.Collections.Generic.List[object]
        $partCount = 0
        $cursorBytes = 1048576.0 # 1 MB alignment start
        $minUnallocBytes = 16MB  # hide tiny alignment gaps (<16 MB)

        if ($partStyle -eq "RAW" -and $rawParts.Count -eq 0) {
            if ($diskBytes -ge $minUnallocBytes) {
                $segments.Add([ordered]@{
                    kind            = "unallocated"
                    diskNumber      = $diskNum
                    partitionNumber = 0
                    offsetBytes     = 0
                    sizeBytes       = [long]$diskBytes
                    sizeGB          = $diskGB
                    pctOfDisk       = 100.0
                    label           = "Uninitialized (RAW)"
                    driveLetter     = ""
                    fileSystem      = ""
                    partType        = "Unallocated"
                    isProtected     = $false
                })
            }
        } else {
            foreach ($p in $rawParts) {
                $pOff  = [double]$p.Offset
                $pSize = [double]$p.Size
                if (($pOff - $cursorBytes) -ge $minUnallocBytes) {
                    $gapBytes = $pOff - $cursorBytes
                    $gapPct   = if ($diskBytes -gt 0) { [math]::Round(($gapBytes / $diskBytes) * 100, 2) } else { 0 }
                    $segments.Add([ordered]@{
                        kind            = "unallocated"
                        diskNumber      = $diskNum
                        partitionNumber = 0
                        offsetBytes     = [long]$cursorBytes
                        sizeBytes       = [long]$gapBytes
                        sizeGB          = [math]::Round($gapBytes / 1GB, 2)
                        pctOfDisk       = $gapPct
                        label           = "Unallocated Space"
                        driveLetter     = ""
                        fileSystem      = ""
                        partType        = "Unallocated"
                        isProtected     = $false
                    })
                }

                $vol = $null
                try { $vol = Get-Volume -Partition $p -ErrorAction SilentlyContinue } catch {}
                $ltr = if ($p.DriveLetter -and [int][char]$p.DriveLetter -ge 65) { ([string]$p.DriveLetter).Trim().ToUpperInvariant() } else { "" }
                $fs  = if ($vol -and $vol.FileSystemType) { [string]$vol.FileSystemType } elseif ($vol -and $vol.FileSystem) { [string]$vol.FileSystem } else { "" }
                $lbl = if ($vol -and $vol.FileSystemLabel) { [string]$vol.FileSystemLabel } else { "" }
                $freeGB = if ($vol -and $null -ne $vol.SizeRemaining) { [math]::Round([double]$vol.SizeRemaining / 1GB, 2) } else { -1 }
                $usedGB = if ($vol -and $vol.Size -gt 0 -and $null -ne $vol.SizeRemaining) { [math]::Round(([double]$vol.Size - [double]$vol.SizeRemaining) / 1GB, 2) } else { -1 }
                $usedPct = if ($vol -and $vol.Size -gt 0 -and $null -ne $vol.SizeRemaining) { [math]::Round((([double]$vol.Size - [double]$vol.SizeRemaining) / [double]$vol.Size) * 100, 1) } else { -1 }

                $minGB = -1.0; $maxGB = -1.0
                if ($isAdmin -and -not (Test-IsProtectedPartitionObject -Partition $p) -or ($isAdmin -and $ltr -eq "C")) {
                    try {
                        $sup = Get-PartitionSupportedSize -DiskNumber $diskNum -PartitionNumber ([int]$p.PartitionNumber) -ErrorAction SilentlyContinue
                        if ($sup) {
                            $minGB = [math]::Round([double]$sup.SizeMin / 1GB, 2)
                            $maxGB = [math]::Round([double]$sup.SizeMax / 1GB, 2)
                        }
                    } catch {}
                }

                $pPct = if ($diskBytes -gt 0) { [math]::Round(($pSize / $diskBytes) * 100, 2) } else { 0 }
                $isProt = Test-IsProtectedPartitionObject -Partition $p
                $segments.Add([ordered]@{
                    kind            = "partition"
                    diskNumber      = $diskNum
                    partitionNumber = [int]$p.PartitionNumber
                    offsetBytes     = [long]$pOff
                    sizeBytes       = [long]$pSize
                    sizeGB          = [math]::Round($pSize / 1GB, 2)
                    pctOfDisk       = $pPct
                    driveLetter     = $ltr
                    label           = $lbl
                    fileSystem      = $fs
                    partType        = [string]($p.Type ?? "Basic")
                    isSystem        = [bool]$p.IsSystem
                    isBoot          = [bool]$p.IsBoot
                    isActive        = [bool]$p.IsActive
                    isProtected     = $isProt
                    freeGB          = $freeGB
                    usedGB          = $usedGB
                    usedPct         = $usedPct
                    minSizeGB       = $minGB
                    maxSizeGB       = $maxGB
                })
                $partCount++
                $endOff = $pOff + $pSize
                if ($endOff -gt $cursorBytes) { $cursorBytes = $endOff }
            }

            if (($diskBytes - $cursorBytes) -ge $minUnallocBytes) {
                $tailBytes = $diskBytes - $cursorBytes
                $tailPct   = if ($diskBytes -gt 0) { [math]::Round(($tailBytes / $diskBytes) * 100, 2) } else { 0 }
                $segments.Add([ordered]@{
                    kind            = "unallocated"
                    diskNumber      = $diskNum
                    partitionNumber = 0
                    offsetBytes     = [long]$cursorBytes
                    sizeBytes       = [long]$tailBytes
                    sizeGB          = [math]::Round($tailBytes / 1GB, 2)
                    pctOfDisk       = $tailPct
                    label           = "Unallocated Space"
                    driveLetter     = ""
                    fileSystem      = ""
                    partType        = "Unallocated"
                    isProtected     = $false
                })
            }
        }

        $unallocGB = [math]::Round([math]::Max(0.0, ($diskBytes - [double]$d.AllocatedSize)) / 1GB, 2)
        $disksOut.Add([ordered]@{
            number            = $diskNum
            friendlyName      = ([string]($d.FriendlyName ?? "Disk $diskNum")).Trim()
            busType           = [string]($d.BusType ?? "Unknown")
            partitionStyle    = $partStyle
            operationalStatus = [string]($d.OperationalStatus ?? "Unknown")
            healthStatus      = [string]($d.HealthStatus ?? "Unknown")
            isOffline         = [bool]$d.IsOffline
            isReadOnly        = [bool]$d.IsReadOnly
            isSystemOrBoot    = $isSysDisk
            sizeGB            = $diskGB
            allocatedGB       = [math]::Round([double]$d.AllocatedSize / 1GB, 2)
            unallocatedGB     = $unallocGB
            partitionCount    = $partCount
            segments          = $segments.ToArray()
        })
    }

    return [ordered]@{
        type             = "DISKPART_STATE"
        isAdmin          = $isAdmin
        disks            = $disksOut.ToArray()
        availableLetters = $availLetters
        scannedAt        = (Get-Date).ToString("HH:mm:ss")
        notice           = $Notice
        noticeError      = $NoticeError
    }
}

function Invoke-DiskPartitionerAction {
    param(
        [Parameter(Mandatory)][string]$RawJson,
        [Parameter(Mandatory)][string]$RootPath
    )
    $payload = $RawJson | ConvertFrom-Json -AsHashtable
    $cmd = [string]$payload["command"]
    try {
        switch ($cmd) {
            "DISKPART_LOAD" {
                $doRescan = [bool]($payload["rescan"] ?? $false)
                $note = if ($doRescan) { "Rescanned storage bus and refreshed disk layout." } else { "" }
                return (Get-DiskPartitionerState -Rescan:$doRescan -Notice $note)
            }
            "DISKPART_OPEN_DISKMGMT" {
                Start-Process "diskmgmt.msc"
                return @{ type = "DISKPART_NOTICE"; ok = $true; message = "Opened Windows Disk Management (diskmgmt.msc)." }
            }
            "DISKPART_SET_ONLINE" {
                Assert-DiskPartitionerAdmin
                $dn = [int]$payload["diskNumber"]
                $wantOnline = [bool]$payload["online"]
                $disk = Get-Disk -Number $dn -ErrorAction Stop
                $parts = @(Get-Partition -DiskNumber $dn -ErrorAction SilentlyContinue)
                if (-not $wantOnline -and (Test-IsSystemOrBootDisk -Disk $disk -Partitions $parts)) {
                    throw "Refused: Disk $dn is a System or Boot disk and cannot be taken offline."
                }
                Set-Disk -Number $dn -IsOffline (-not $wantOnline) -ErrorAction Stop
                $lbl = if ($wantOnline) { "online" } else { "offline" }
                return (Get-DiskPartitionerState -Notice "Disk $dn is now $lbl.")
            }
            "DISKPART_INIT_DISK" {
                Assert-DiskPartitionerAdmin
                $dn = [int]$payload["diskNumber"]
                $style = ([string]($payload["style"] ?? "GPT")).Trim().ToUpperInvariant()
                if ($style -notin @("GPT", "MBR")) { throw "Partition style must be GPT or MBR." }
                $disk = Get-Disk -Number $dn -ErrorAction Stop
                $parts = @(Get-Partition -DiskNumber $dn -ErrorAction SilentlyContinue)
                if (Test-IsSystemOrBootDisk -Disk $disk -Partitions $parts) {
                    throw "Refused: Cannot initialize a System or Boot disk."
                }
                if ($disk.PartitionStyle -ne "RAW") {
                    throw "Disk $dn is already initialized as $($disk.PartitionStyle). Clean/wipe the disk first if you want to convert it."
                }
                if ($disk.IsOffline) { Set-Disk -Number $dn -IsOffline $false -ErrorAction Stop }
                if ($disk.IsReadOnly) { Set-Disk -Number $dn -IsReadOnly $false -ErrorAction SilentlyContinue }
                Initialize-Disk -Number $dn -PartitionStyle $style -ErrorAction Stop
                return (Get-DiskPartitionerState -Notice "Initialized Disk $dn as $style.")
            }
            "DISKPART_CREATE_PART" {
                Assert-DiskPartitionerAdmin
                $dn      = [int]$payload["diskNumber"]
                $useMax  = [bool]($payload["useMax"] ?? $true)
                $sizeGB  = [double]($payload["sizeGB"] ?? 0)
                $letter  = ([string]($payload["driveLetter"] ?? "AUTO")).Trim().ToUpperInvariant()
                $fs      = ([string]($payload["fileSystem"] ?? "NTFS")).Trim()
                $label   = ([string]($payload["label"] ?? "")).Trim()
                $allocKB = [int]($payload["allocUnitKB"] ?? 0)
                $quick   = [bool]($payload["quickFormat"] ?? $true)

                if ($fs -notin @("NTFS", "exFAT", "FAT32", "ReFS")) { $fs = "NTFS" }
                $disk = Get-Disk -Number $dn -ErrorAction Stop
                if ($disk.PartitionStyle -eq "RAW") {
                    throw "Disk $dn is uninitialized (RAW). Initialize it as GPT or MBR first."
                }
                if ($disk.IsOffline) { Set-Disk -Number $dn -IsOffline $false -ErrorAction Stop }

                $newPartParams = @{ DiskNumber = $dn; ErrorAction = "Stop" }
                if ($useMax -or $sizeGB -le 0) {
                    $newPartParams["UseMaximumSize"] = $true
                } else {
                    $newPartParams["Size"] = [uint64]([math]::Round($sizeGB * 1GB))
                }
                if ($letter -eq "AUTO") {
                    $newPartParams["AssignDriveLetter"] = $true
                } elseif ($letter -match '^[D-Z]$') {
                    $newPartParams["DriveLetter"] = $letter
                }

                $createdPart = New-Partition @newPartParams
                $fmtParams = @{
                    Partition  = $createdPart
                    FileSystem = $fs
                    Confirm    = $false
                    ErrorAction = "Stop"
                }
                if ($label) { $fmtParams["NewFileSystemLabel"] = $label }
                if ($allocKB -gt 0) { $fmtParams["AllocationUnitSize"] = ($allocKB * 1024) }
                if (-not $quick) { $fmtParams["Full"] = $true }

                $vol = Format-Volume @fmtParams
                $assigned = if ($vol.DriveLetter) { "$($vol.DriveLetter):" } elseif ($createdPart.DriveLetter) { "$($createdPart.DriveLetter):" } else { "Partition $($createdPart.PartitionNumber)" }
                return (Get-DiskPartitionerState -Notice "Created & formatted $assigned ($fs) on Disk $dn.")
            }
            "DISKPART_FORMAT_PART" {
                Assert-DiskPartitionerAdmin
                $dn      = [int]$payload["diskNumber"]
                $pn      = [int]$payload["partitionNumber"]
                $fs      = ([string]($payload["fileSystem"] ?? "NTFS")).Trim()
                $label   = ([string]($payload["label"] ?? "")).Trim()
                $allocKB = [int]($payload["allocUnitKB"] ?? 0)
                $quick   = [bool]($payload["quickFormat"] ?? $true)

                if ($fs -notin @("NTFS", "exFAT", "FAT32", "ReFS")) { throw "Unsupported filesystem: $fs" }
                $part = Get-Partition -DiskNumber $dn -PartitionNumber $pn -ErrorAction Stop
                if (Test-IsProtectedPartitionObject -Partition $part) {
                    throw "Refused: Disk $dn Partition $pn is a protected System, Boot, C:, EFI, or Recovery partition."
                }
                $fmtParams = @{
                    Partition   = $part
                    FileSystem  = $fs
                    Confirm     = $false
                    Force       = $true
                    ErrorAction = "Stop"
                }
                if ($label) { $fmtParams["NewFileSystemLabel"] = $label }
                if ($allocKB -gt 0) { $fmtParams["AllocationUnitSize"] = ($allocKB * 1024) }
                if (-not $quick) { $fmtParams["Full"] = $true }
                $null = Format-Volume @fmtParams
                return (Get-DiskPartitionerState -Notice "Formatted Disk $dn Partition $pn as $fs.")
            }
            "DISKPART_RESIZE_PART" {
                Assert-DiskPartitionerAdmin
                $dn       = [int]$payload["diskNumber"]
                $pn       = [int]$payload["partitionNumber"]
                $targetGB = [double]($payload["targetSizeGB"] ?? 0)
                if ($targetGB -le 0) { throw "Enter a valid target size in GB." }

                $part = Get-Partition -DiskNumber $dn -PartitionNumber $pn -ErrorAction Stop
                $sup  = Get-PartitionSupportedSize -DiskNumber $dn -PartitionNumber $pn -ErrorAction Stop
                $targetBytes = [uint64]([math]::Round($targetGB * 1GB))
                if ($targetBytes -lt $sup.SizeMin) { $targetBytes = [uint64]$sup.SizeMin }
                if ($targetBytes -gt $sup.SizeMax) { $targetBytes = [uint64]$sup.SizeMax }

                Resize-Partition -DiskNumber $dn -PartitionNumber $pn -Size $targetBytes -ErrorAction Stop
                $finalGB = [math]::Round([double]$targetBytes / 1GB, 2)
                return (Get-DiskPartitionerState -Notice "Resized Disk $dn Partition $pn to $finalGB GB.")
            }
            "DISKPART_SET_LETTER" {
                Assert-DiskPartitionerAdmin
                $dn     = [int]$payload["diskNumber"]
                $pn     = [int]$payload["partitionNumber"]
                $newLtr = ([string]($payload["newLetter"] ?? "")).Trim().TrimEnd(':').ToUpperInvariant()

                $part = Get-Partition -DiskNumber $dn -PartitionNumber $pn -ErrorAction Stop
                if (Test-IsProtectedPartitionObject -Partition $part) {
                    throw "Refused: Cannot change or remove the drive letter on a System, Boot, or C: partition."
                }
                if (-not $newLtr) {
                    if ($part.DriveLetter) {
                        Remove-PartitionAccessPath -DiskNumber $dn -PartitionNumber $pn -AccessPath "$($part.DriveLetter):\" -ErrorAction Stop
                    }
                    return (Get-DiskPartitionerState -Notice "Removed drive letter from Disk $dn Partition $pn.")
                }
                if ($newLtr -notmatch '^[D-Z]$') { throw "Choose a valid drive letter between D and Z." }
                Set-Partition -DiskNumber $dn -PartitionNumber $pn -NewDriveLetter $newLtr -ErrorAction Stop
                return (Get-DiskPartitionerState -Notice "Assigned drive letter ${newLtr}: to Disk $dn Partition $pn.")
            }
            "DISKPART_SET_LABEL" {
                Assert-DiskPartitionerAdmin
                $dn    = [int]$payload["diskNumber"]
                $pn    = [int]$payload["partitionNumber"]
                $label = ([string]($payload["label"] ?? "")).Trim()
                if ($label.Length -gt 32) { $label = $label.Substring(0, 32) }
                $part = Get-Partition -DiskNumber $dn -PartitionNumber $pn -ErrorAction Stop
                $vol  = Get-Volume -Partition $part -ErrorAction Stop
                Set-Volume -InputObject $vol -NewFileSystemLabel $label -ErrorAction Stop
                return (Get-DiskPartitionerState -Notice "Updated volume label on Disk $dn Partition $pn to '$label'.")
            }
            "DISKPART_DELETE_PART" {
                Assert-DiskPartitionerAdmin
                $dn = [int]$payload["diskNumber"]
                $pn = [int]$payload["partitionNumber"]
                $part = Get-Partition -DiskNumber $dn -PartitionNumber $pn -ErrorAction Stop
                if (Test-IsProtectedPartitionObject -Partition $part) {
                    throw "Refused: Disk $dn Partition $pn is a protected System, Boot, C:, EFI, MSR, or Recovery partition."
                }
                Remove-Partition -DiskNumber $dn -PartitionNumber $pn -Confirm:$false -ErrorAction Stop
                return (Get-DiskPartitionerState -Notice "Deleted Disk $dn Partition $pn (space is now unallocated).")
            }
            "DISKPART_CLEAR_DISK" {
                Assert-DiskPartitionerAdmin
                $dn = [int]$payload["diskNumber"]
                $tok = ([string]($payload["confirmToken"] ?? "")).Trim().ToUpperInvariant()
                if ($tok -ne "DISK $dn") {
                    throw "Safety confirmation mismatch. Type 'DISK $dn' exactly to wipe this disk."
                }
                $disk = Get-Disk -Number $dn -ErrorAction Stop
                $parts = @(Get-Partition -DiskNumber $dn -ErrorAction SilentlyContinue)
                if (Test-IsSystemOrBootDisk -Disk $disk -Partitions $parts) {
                    throw "Refused: Disk $dn is a System or Boot disk and cannot be wiped."
                }
                Clear-Disk -Number $dn -RemoveData -RemoveOEM -Confirm:$false -ErrorAction Stop
                return (Get-DiskPartitionerState -Notice "Wiped Disk $dn cleanly — it is now RAW/uninitialized and ready to initialize.")
            }
            default { throw "Unknown Disk Partitioner command: $cmd" }
        }
    } catch {
        return (Get-DiskPartitionerState -Notice $_.Exception.Message -NoticeError $true)
    }
}
