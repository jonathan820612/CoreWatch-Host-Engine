[CmdletBinding()]
param()

<#
    Resolves a usable application installation directory from Registry Uninstall properties.
    Rejects shared system roots so move/size operations never target Windows or root Program Files.
#>
function Resolve-AppInstallFolder {
    param(
        [string]$InstallLocation,
        [string]$DisplayIcon,
        [string]$UninstallString
    )

    $candidates = New-Object System.Collections.Generic.List[string]

    if ($InstallLocation) {
        $cleaned = $InstallLocation.Trim().Trim('"').TrimEnd('\')
        if ($cleaned) { $candidates.Add($cleaned) }
    }

    foreach ($rawPath in @($DisplayIcon, $UninstallString)) {
        if (-not $rawPath) { continue }
        $pathCandidate = ""
        if ($rawPath -match '^"([^"]+)"') {
            $pathCandidate = $Matches[1]
        } elseif ($rawPath -match '^([^\s,]+\.(?:exe|msi|ico|dll))') {
            $pathCandidate = $Matches[1]
        }
        $pathCandidate = ($pathCandidate -replace ',-?\d+$', '').Trim().Trim('"')
        if ($pathCandidate -and [System.IO.Path]::IsPathRooted($pathCandidate)) {
            try {
                $parent = [System.IO.Path]::GetDirectoryName($pathCandidate)
                if ($parent) { $candidates.Add($parent.TrimEnd('\')) }
            } catch {}
        }
    }

    $blockedExact = @(
        'C:',
        'C:\Windows',
        'C:\Windows\System32',
        'C:\Windows\SysWOW64',
        'C:\Windows\Installer',
        'C:\Program Files',
        'C:\Program Files (x86)',
        'C:\ProgramData',
        'C:\Users',
        ($env:USERPROFILE.TrimEnd('\')),
        ($env:APPDATA.TrimEnd('\')),
        ($env:LOCALAPPDATA.TrimEnd('\')),
        (Join-Path $env:LOCALAPPDATA "Programs")
    )

    foreach ($cand in $candidates) {
        try {
            $expanded = [System.Environment]::ExpandEnvironmentVariables($cand).TrimEnd('\')
            if (-not $expanded -or -not [System.IO.Path]::IsPathRooted($expanded)) { continue }
            $full = [System.IO.Path]::GetFullPath($expanded).TrimEnd('\')
            $root = [System.IO.Path]::GetPathRoot($full).TrimEnd('\')
            if ($full -ieq $root) { continue }
            if ($blockedExact -contains $full) { continue }
            if ($full -match '^[A-Za-z]:\\Windows(\\|$)') { continue }
            if ($full -match '^[A-Za-z]:\\ProgramData\\Package Cache(\\|$)') { continue }
            if (Test-Path -LiteralPath $full -PathType Container -ErrorAction SilentlyContinue) {
                return $full
            }
        } catch {}
    }

    return ""
}

function Resolve-AppExecutable {
    param(
        [string]$DisplayIcon,
        [string]$InstallFolder
    )
    if ($DisplayIcon) {
        $cleaned = ($DisplayIcon -replace ',-?\d+$', '').Trim().Trim('"')
        if ($cleaned -match '^"([^"]+)"') { $cleaned = $Matches[1] }
        $cleaned = [System.Environment]::ExpandEnvironmentVariables($cleaned)
        if ($cleaned -match '\.exe$' -and (Test-Path -LiteralPath $cleaned -PathType Leaf -ErrorAction SilentlyContinue)) {
            return $cleaned
        }
    }
    if ($InstallFolder -and (Test-Path -LiteralPath $InstallFolder -PathType Container -ErrorAction SilentlyContinue)) {
        $exe = Get-ChildItem -LiteralPath $InstallFolder -Filter "*.exe" -File -ErrorAction SilentlyContinue |
               Where-Object { $_.Name -notmatch '(?i)(unins|uninst|setup|update|crash|helper)' } |
               Select-Object -First 1
        if ($exe) { return $exe.FullName }
    }
    return ""
}

function Test-IsSystemApplication {
    param(
        [string]$Name,
        [string]$Publisher,
        [string]$InstallFolder,
        [string]$UninstallString,
        [int]$SystemComponent,
        [int]$NoRemove,
        [string]$ReleaseType
    )

    if ($SystemComponent -eq 1 -or $NoRemove -eq 1) { return $true }
    if ($ReleaseType -match '(?i)(Update|Hotfix|Security Update|Service Pack)') { return $true }
    if ($InstallFolder -and $InstallFolder -match '^[A-Za-z]:\\Windows(\\|$)') { return $true }
    if ($UninstallString -and $UninstallString -match '(?i)\\Windows\\System32\\(msiexec|pnputil|dism|wusa)') {
        if ($Name -match '(?i)(Windows Driver|Hotfix|Security Update|Update for|KB\d{6,})') { return $true }
    }

    $systemNamePattern = '(?i)^(Microsoft Visual C\+\+|Microsoft \.NET|Microsoft Windows|Windows Software Development Kit|Windows Driver Package|Microsoft Edge WebView2|Microsoft Update Health|Update for Microsoft|Security Update|Intel\(R\) (Chipset|Management Engine|Serial IO|Dynamic Tuning)|AMD (Chipset|PSP|GPIO|SMBus|PCI)|Realtek (Audio|Ethernet|PCIe|Card Reader) Driver|NVIDIA (PhysX|FrameView|Graphics Driver|HD Audio|USBC))'
    if ($Name -match $systemNamePattern) { return $true }

    if ($Publisher -match '(?i)^Microsoft Corporation$' -and $Name -match '(?i)(Runtime|Redistributable|SDK|Driver|WebView2|Windows|Update|Framework|Targeting Pack|AppInstaller)') {
        return $true
    }

    return $false
}

function Format-InstallDate {
    param([string]$RawDate, [string]$FolderPath)
    if ($RawDate -and $RawDate.Trim() -match '^(\d{4})(\d{2})(\d{2})$') {
        return "$($Matches[1])-$($Matches[2])-$($Matches[3])"
    }
    if ($RawDate -and $RawDate.Trim() -match '^\d{4}-\d{2}-\d{2}') {
        return $RawDate.Trim().Substring(0, 10)
    }
    if ($FolderPath -and (Test-Path -LiteralPath $FolderPath -PathType Container -ErrorAction SilentlyContinue)) {
        try {
            return (Get-Item -LiteralPath $FolderPath -ErrorAction Stop).CreationTime.ToString("yyyy-MM-dd")
        } catch {}
    }
    return "Unknown"
}

function Get-AvailableTargetDrives {
    $drives = @()
    try {
        $disks = Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DriveType=3" -ErrorAction SilentlyContinue | Sort-Object DeviceID
        foreach ($d in $disks) {
            if ([double]$d.Size -le 0) { continue }
            $drives += [PSCustomObject]@{
                letter  = [string]$d.DeviceID
                label   = if ($d.VolumeName) { [string]$d.VolumeName } else { "Local Disk" }
                freeGB  = [math]::Round(([double]$d.FreeSpace / 1GB), 1)
                totalGB = [math]::Round(([double]$d.Size / 1GB), 1)
            }
        }
    } catch {}
    return $drives
}

<#
    Compiles all installed desktop applications from 64-bit, 32-bit, and Current User uninstall hives
    along with system classification, junction status, disk drive, and available target drives.
#>
function Get-InstalledAppsMesh {
    [CmdletBinding()]
    param()

    try {
        $RegistryHives = @(
            @{ Path = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*";             Scope = "All Users (64-bit)"; Arch = "64-bit" },
            @{ Path = "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*"; Scope = "All Users (32-bit)"; Arch = "32-bit" },
            @{ Path = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*";             Scope = "Current User";       Arch = "User" }
        )

        $Apps = New-Object System.Collections.Generic.List[PSCustomObject]
        $SeenKeys = New-Object System.Collections.Generic.HashSet[string]([System.StringComparer]::OrdinalIgnoreCase)

        foreach ($hive in $RegistryHives) {
            $entries = Get-ItemProperty -Path $hive.Path -ErrorAction SilentlyContinue
            foreach ($entry in $entries) {
                $displayName = [string]$entry.DisplayName
                if (-not $displayName -or -not $displayName.Trim()) { continue }
                $displayName = $displayName.Trim()

                # Skip patch sub-entries tied to a parent application
                if ($entry.ParentKeyName -or $entry.ParentDisplayName) { continue }

                $version    = if ($entry.DisplayVersion) { [string]$entry.DisplayVersion } else { "Unknown" }
                $publisher  = if ($entry.Publisher) { ([string]$entry.Publisher).Trim() } else { "Unknown Publisher" }
                $uninstall  = if ($entry.UninstallString) { [string]$entry.UninstallString } else { "" }
                $quietUnin  = if ($entry.QuietUninstallString) { [string]$entry.QuietUninstallString } else { "" }
                $modifyPath = if ($entry.ModifyPath) { [string]$entry.ModifyPath } else { "" }
                $helpLink   = if ($entry.URLInfoAbout) { [string]$entry.URLInfoAbout } elseif ($entry.HelpLink) { [string]$entry.HelpLink } else { "" }
                $sysComp    = if ($null -ne $entry.SystemComponent) { [int]$entry.SystemComponent } else { 0 }
                $noRemove   = if ($null -ne $entry.NoRemove) { [int]$entry.NoRemove } else { 0 }
                $relType    = if ($entry.ReleaseType) { [string]$entry.ReleaseType } else { "" }

                # Deduplicate identical name + version + scope combinations
                $dedupKey = "$displayName|$version|$($hive.Scope)"
                if (-not $SeenKeys.Add($dedupKey)) { continue }

                $installFolder = Resolve-AppInstallFolder -InstallLocation ([string]$entry.InstallLocation) -DisplayIcon ([string]$entry.DisplayIcon) -UninstallString $uninstall
                $exePath = Resolve-AppExecutable -DisplayIcon ([string]$entry.DisplayIcon) -InstallFolder $installFolder
                $isSystem = Test-IsSystemApplication -Name $displayName -Publisher $publisher -InstallFolder $installFolder -UninstallString $uninstall -SystemComponent $sysComp -NoRemove $noRemove -ReleaseType $relType

                $isJunction = $false
                $junctionTarget = ""
                $installDrive = ""
                if ($installFolder) {
                    $installDrive = [System.IO.Path]::GetPathRoot($installFolder).TrimEnd('\')
                    try {
                        $dirInfo = Get-Item -LiteralPath $installFolder -Force -ErrorAction SilentlyContinue
                        if ($dirInfo -and ($dirInfo.Attributes -band [System.IO.FileAttributes]::ReparsePoint)) {
                            $isJunction = $true
                            if ($dirInfo.Target) {
                                $junctionTarget = ($dirInfo.Target | Select-Object -First 1)
                            }
                        }
                    } catch {}
                }

                $sizeMB = $null
                if ($null -ne $entry.EstimatedSize -and [double]$entry.EstimatedSize -gt 0) {
                    $sizeMB = [math]::Round(([double]$entry.EstimatedSize / 1024.0), 1)
                }

                $installDate = Format-InstallDate -RawDate ([string]$entry.InstallDate) -FolderPath $installFolder
                $regKeyFriendly = ([string]$entry.PSPath) -replace '^Microsoft\.PowerShell\.Core\\Registry::', ''

                $canMove = (-not $isSystem) -and (-not [string]::IsNullOrWhiteSpace($installFolder)) -and (-not $isJunction)
                $canUninstall = (-not $isSystem) -and (-not [string]::IsNullOrWhiteSpace($uninstall) -or -not [string]::IsNullOrWhiteSpace($quietUnin))

                $Apps.Add([PSCustomObject]@{
                    id               = [string]$entry.PSPath
                    name             = $displayName
                    version          = $version
                    publisher        = $publisher
                    installDate      = $installDate
                    sizeMB           = $sizeMB
                    installLocation  = $installFolder
                    installDrive     = $installDrive
                    executablePath   = $exePath
                    registryPath     = $regKeyFriendly
                    scope            = [string]$hive.Scope
                    architecture     = [string]$hive.Arch
                    isSystem         = [bool]$isSystem
                    isJunction       = [bool]$isJunction
                    junctionTarget   = [string]$junctionTarget
                    canMove          = [bool]$canMove
                    canUninstall     = [bool]$canUninstall
                    hasModify        = (-not $isSystem) -and (-not [string]::IsNullOrWhiteSpace($modifyPath))
                    uninstallString  = $uninstall
                    modifyPath       = $modifyPath
                    helpLink         = $helpLink
                })
            }
        }

        $SortedApps = @($Apps | Sort-Object name)
        $UserCount    = @($SortedApps | Where-Object { -not $_.isSystem }).Count
        $SystemCount  = @($SortedApps | Where-Object { $_.isSystem }).Count
        $MovableCount = @($SortedApps | Where-Object { $_.canMove }).Count
        $MovedCount   = @($SortedApps | Where-Object { $_.isJunction }).Count
        $TotalMB      = [math]::Round((($SortedApps | Where-Object { $null -ne $_.sizeMB } | Measure-Object -Property sizeMB -Sum).Sum), 1)

        return @{
            type    = "REFRESH_INSTALLED_APPS"
            apps    = $SortedApps
            drives  = @(Get-AvailableTargetDrives)
            summary = @{
                total      = $SortedApps.Count
                userApps   = $UserCount
                systemApps = $SystemCount
                movable    = $MovableCount
                moved      = $MovedCount
                totalGB    = [math]::Round(($TotalMB / 1024.0), 2)
            }
            error   = $null
        }
    } catch {
        return @{
            type    = "REFRESH_INSTALLED_APPS"
            apps    = @()
            drives  = @(Get-AvailableTargetDrives)
            summary = @{ total = 0; userApps = 0; systemApps = 0; movable = 0; moved = 0; totalGB = 0 }
            error   = $_.Exception.Message
        }
    }
}

function Start-ParsedCommandLine {
    param([Parameter(Mandatory)][string]$CommandLine)

    $cmd = $CommandLine.Trim()
    if (-not $cmd) { throw "No command line available for this application." }

    # Normalize MsiExec install flags (/I) to uninstall (/X)
    if ($cmd -match '(?i)^(?:msiexec(?:\.exe)?)\s+(.*)$') {
        $msiArgs = $Matches[1] -replace '(?i)(^|\s)/I(\s|\{)', '$1/X$2'
        Start-Process -FilePath "msiexec.exe" -ArgumentList $msiArgs -ErrorAction Stop
        return
    }

    if ($cmd -match '^"([^"]+)"\s*(.*)$') {
        $file = [System.Environment]::ExpandEnvironmentVariables($Matches[1])
        $args = $Matches[2].Trim()
        if ($args) {
            Start-Process -FilePath $file -ArgumentList $args -ErrorAction Stop
        } else {
            Start-Process -FilePath $file -ErrorAction Stop
        }
        return
    }

    # Unquoted executable path (may contain spaces before .exe)
    if ($cmd -match '^(.+?\.(?:exe|bat|cmd|msi))\s*(.*)$') {
        $file = [System.Environment]::ExpandEnvironmentVariables($Matches[1].Trim())
        $args = $Matches[2].Trim()
        if ($args) {
            Start-Process -FilePath $file -ArgumentList $args -ErrorAction Stop
        } else {
            Start-Process -FilePath $file -ErrorAction Stop
        }
        return
    }

    Start-Process -FilePath "cmd.exe" -ArgumentList "/c $cmd" -ErrorAction Stop
}

function Move-UserApplicationFolder {
    param(
        [Parameter(Mandatory)][string]$AppName,
        [Parameter(Mandatory)][string]$SourceFolder,
        [Parameter(Mandatory)][string]$TargetParentDir
    )

    $src = [System.IO.Path]::GetFullPath($SourceFolder.Trim().TrimEnd('\'))
    $dstParent = [System.IO.Path]::GetFullPath($TargetParentDir.Trim().TrimEnd('\'))

    if (-not (Test-Path -LiteralPath $src -PathType Container)) {
        throw "Source install folder does not exist: $src"
    }

    $srcInfo = Get-Item -LiteralPath $src -Force -ErrorAction Stop
    if ($srcInfo.Attributes -band [System.IO.FileAttributes]::ReparsePoint) {
        throw "This application folder is already a linked/moved directory junction."
    }

    # Protect critical Windows & shared root directories
    $srcRoot = [System.IO.Path]::GetPathRoot($src).TrimEnd('\')
    if ($src -ieq $srcRoot -or $src -match '^[A-Za-z]:\\(Windows|ProgramData|Users)(\\|$)') {
        throw "Protected system path cannot be moved: $src"
    }
    if ($src -match '^[A-Za-z]:\\(Program Files|Program Files \(x86\))$') {
        throw "Root Program Files directory cannot be moved."
    }

    if (-not [System.IO.Path]::IsPathRooted($dstParent)) {
        throw "Target destination must be a full directory path (e.g. D:\Apps)."
    }
    $dstRoot = [System.IO.Path]::GetPathRoot($dstParent)
    if (-not (Test-Path -LiteralPath $dstRoot)) {
        throw "Destination drive [$dstRoot] is not available."
    }

    $folderName = Split-Path -Path $src -Leaf
    $destFull = Join-Path $dstParent $folderName

    if ($destFull.TrimEnd('\') -ieq $src) {
        throw "Destination directory is the same as the current installation directory."
    }
    if ($destFull.StartsWith($src + '\', [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Destination cannot be inside the source application directory."
    }
    if (Test-Path -LiteralPath $destFull) {
        $existing = @(Get-ChildItem -LiteralPath $destFull -Force -ErrorAction SilentlyContinue)
        if ($existing.Count -gt 0) {
            throw "Destination folder already exists and is not empty: $destFull"
        }
    }

    # Verify no active process is running from inside the application directory
    $runningLocks = @(Get-Process -ErrorAction SilentlyContinue | Where-Object {
        try {
            $p = $_.Path
            $p -and $p.StartsWith($src + '\', [System.StringComparison]::OrdinalIgnoreCase)
        } catch { $false }
    })
    if ($runningLocks.Count -gt 0) {
        $procNames = ($runningLocks | Select-Object -ExpandProperty ProcessName -Unique) -join ", "
        throw "Close running processes for [$AppName] before moving: $procNames"
    }

    # Calculate folder size and validate free disk space on target drive
    $sizeMeasure = Get-ChildItem -LiteralPath $src -File -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum
    $requiredBytes = if ($sizeMeasure -and $sizeMeasure.Sum) { [long]$sizeMeasure.Sum } else { 0L }
    $targetDriveLetter = $dstRoot.TrimEnd('\')
    $targetDisk = Get-CimInstance -ClassName Win32_LogicalDisk -Filter "DeviceID='$targetDriveLetter'" -ErrorAction SilentlyContinue
    if ($targetDisk -and [double]$targetDisk.FreeSpace -lt ($requiredBytes * 1.05)) {
        $needGB = [math]::Round(($requiredBytes / 1GB), 2)
        $freeGB = [math]::Round(([double]$targetDisk.FreeSpace / 1GB), 2)
        throw "Insufficient free space on $targetDriveLetter ($freeGB GB free, need ~$needGB GB)."
    }

    if (-not (Test-Path -LiteralPath $dstParent)) {
        New-Item -ItemType Directory -Path $dstParent -Force -ErrorAction Stop | Out-Null
    }
    if (-not (Test-Path -LiteralPath $destFull)) {
        New-Item -ItemType Directory -Path $destFull -Force -ErrorAction Stop | Out-Null
    }

    # Copy full directory tree with timestamps/attributes via Robocopy
    $roboArgs = @("`"$src`"", "`"$destFull`"", "/E", "/COPY:DAT", "/R:1", "/W:1", "/NFL", "/NDL", "/NJH", "/NJS", "/NP")
    $roboProc = Start-Process -FilePath "robocopy.exe" -ArgumentList $roboArgs -NoNewWindow -Wait -PassThru
    if ($roboProc.ExitCode -ge 8) {
        Remove-Item -LiteralPath $destFull -Recurse -Force -ErrorAction SilentlyContinue
        throw "File copy failed (Robocopy exit code $($roboProc.ExitCode)). Original app was left untouched."
    }

    # Atomic swap: backup original -> create NTFS directory junction -> remove backup
    $backupPath = "$src.__corewatch_move_bak"
    try {
        Rename-Item -LiteralPath $src -NewName (Split-Path $backupPath -Leaf) -ErrorAction Stop
    } catch {
        Remove-Item -LiteralPath $destFull -Recurse -Force -ErrorAction SilentlyContinue
        throw "Could not lock original folder (a file or service may still be using it). Original app untouched: $($_.Exception.Message)"
    }

    try {
        $null = New-Item -ItemType Junction -Path $src -Target $destFull -ErrorAction Stop
    } catch {
        # Roll back immediately if junction creation fails
        Rename-Item -LiteralPath $backupPath -NewName (Split-Path $src -Leaf) -ErrorAction SilentlyContinue
        Remove-Item -LiteralPath $destFull -Recurse -Force -ErrorAction SilentlyContinue
        throw "Failed to create directory junction (Administrator privileges may be required). Restored original folder: $($_.Exception.Message)"
    }

    Remove-Item -LiteralPath $backupPath -Recurse -Force -ErrorAction SilentlyContinue

    $movedMB = [math]::Round(($requiredBytes / 1MB), 1)
    return "Moved [$AppName] ($movedMB MB) to [$destFull] with transparent NTFS junction at [$src]."
}

function Invoke-InstalledAppAction {
    param(
        [Parameter(Mandatory = $true)]
        $Payload
    )

    if ($Payload -is [string]) {
        $Payload = $Payload | ConvertFrom-Json
    }
    if ($null -eq $Payload -or $null -eq $Payload.command) { return $null }

    $cmd = [string]$Payload.command
    $appName = [string]$Payload.name
    $msg = "Application action completed."

    try {
        if ($cmd -eq "UNINSTALL_APP") {
            if ($Payload.isSystem -eq $true) {
                throw "System components cannot be uninstalled from this view."
            }
            $uninstallCmd = [string]$Payload.uninstallString
            Start-ParsedCommandLine -CommandLine $uninstallCmd
            $msg = "Launched native uninstaller for [$appName]. Click Refresh after the uninstall wizard finishes."
        }
        elseif ($cmd -eq "MODIFY_APP") {
            if ($Payload.isSystem -eq $true) {
                throw "System components cannot be modified from this view."
            }
            Start-ParsedCommandLine -CommandLine ([string]$Payload.modifyPath)
            $msg = "Launched Modify / Repair wizard for [$appName]."
        }
        elseif ($cmd -eq "MOVE_APP") {
            if ($Payload.isSystem -eq $true) {
                throw "System components cannot be moved."
            }
            $srcFolder = [string]$Payload.installLocation
            $targetDir = [string]$Payload.targetDirectory
            $msg = Move-UserApplicationFolder -AppName $appName -SourceFolder $srcFolder -TargetParentDir $targetDir
        }
        elseif ($cmd -eq "OPEN_APP_FOLDER") {
            $folder = [string]$Payload.installLocation
            if ($folder -and (Test-Path -LiteralPath $folder -PathType Container)) {
                Start-Process "explorer.exe" -ArgumentList "`"$folder`""
                $msg = "Opened install folder [$folder]."
            } else {
                throw "Install folder not found on disk."
            }
        }
        elseif ($cmd -eq "OPEN_APP_REGISTRY") {
            $regKey = [string]$Payload.registryPath
            if (-not $regKey) { throw "Registry path unavailable." }
            $regEditPref = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Applets\Regedit"
            if (-not (Test-Path $regEditPref)) { New-Item -Path $regEditPref -Force | Out-Null }
            Set-ItemProperty -Path $regEditPref -Name "LastKey" -Value "Computer\$regKey" -Force
            Start-Process "regedit.exe"
            $msg = "Opened Registry Editor at [$regKey]."
        }
        elseif ($cmd -eq "CALC_APP_SIZE") {
            $folder = [string]$Payload.installLocation
            $id     = [string]$Payload.id
            if (-not $folder -or -not (Test-Path -LiteralPath $folder -PathType Container)) {
                throw "Install folder not found on disk."
            }
            $sum = Get-ChildItem -LiteralPath $folder -File -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum
            $bytes = if ($sum -and $sum.Sum) { [long]$sum.Sum } else { 0L }
            $mb = [math]::Round(($bytes / 1MB), 1)
            $fileCount = if ($sum) { [int]$sum.Count } else { 0 }
            return @{
                type      = "APP_FOLDER_SIZE"
                id        = $id
                name      = $appName
                sizeMB    = $mb
                fileCount = $fileCount
                message   = "Measured [$appName]: $mb MB across $fileCount files."
                error     = $null
            }
        }
        else {
            throw "Unsupported installed app command: $cmd"
        }
    } catch {
        $state = Get-InstalledAppsMesh
        $state.error = $_.Exception.Message
        return $state
    }

    $result = Get-InstalledAppsMesh
    $result.message = $msg
    return $result
}
