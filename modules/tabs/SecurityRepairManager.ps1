# File: modules/tabs/SecurityRepairManager.ps1
# =========================================================================
# COREWATCH SECURITY POSTURE, WINDOWS REPAIR TOOLKIT & SUPPORT BUNDLE ENGINE
# Provides:
#   1. Security & Compliance Audit (BitLocker, TPM, Secure Boot, HVCI, RDP, Local Admins, Non-MS Tasks)
#   2. Safe Click-Togglable RDP Control & Scheduled Task Enable/Disable
#   3. One-Click Windows Repair & Health Toolkit (DISM, SFC, WU Reset, Winsock/IP Reset, Winget, Battery)
#   4. 1-Click Consolidated IT Support Bundle ZIP Exporter
# =========================================================================

[CmdletBinding()]
param()

function Test-SecRepairElevated {
    try {
        $id = [Security.Principal.WindowsIdentity]::GetCurrent()
        $pr = New-Object Security.Principal.WindowsPrincipal($id)
        return $pr.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    } catch { return $false }
}

function Get-BatteryHealthInfo {
    $info = [ordered]@{
        present         = $false
        status          = "No Battery (Desktop / AC)"
        chargePct       = $null
        designMWh       = $null
        fullChargeMWh   = $null
        healthPct       = $null
        wearPct         = $null
        cycleCount      = $null
    }

    try {
        $bat = Get-CimInstance -ClassName Win32_Battery -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $bat) { return [PSCustomObject]$info }

        $info.present   = $true
        $info.chargePct = if ($null -ne $bat.EstimatedChargeRemaining) { [int]$bat.EstimatedChargeRemaining } else { $null }
        $info.status    = switch ([int]$bat.BatteryStatus) {
            1 { "Discharging" }
            2 { "AC Connected" }
            3 { "Fully Charged" }
            4 { "Low" }
            5 { "Critical" }
            6 { "Charging" }
            default { "Detected" }
        }

        $static = Get-CimInstance -Namespace "root\wmi" -ClassName BatteryStaticData -ErrorAction SilentlyContinue | Select-Object -First 1
        $full   = Get-CimInstance -Namespace "root\wmi" -ClassName BatteryFullChargedCapacity -ErrorAction SilentlyContinue | Select-Object -First 1
        $cycle  = Get-CimInstance -Namespace "root\wmi" -ClassName BatteryCycleCount -ErrorAction SilentlyContinue | Select-Object -First 1

        if ($static -and $static.DesignedCapacity -gt 0) { $info.designMWh = [int]$static.DesignedCapacity }
        if ($full -and $full.FullChargedCapacity -gt 0)  { $info.fullChargeMWh = [int]$full.FullChargedCapacity }
        if ($cycle -and $null -ne $cycle.CycleCount)     { $info.cycleCount = [int]$cycle.CycleCount }

        if ($info.designMWh -gt 0 -and $info.fullChargeMWh -gt 0) {
            $hp = [math]::Min(100, [math]::Round(($info.fullChargeMWh / [double]$info.designMWh) * 100.0, 1))
            $info.healthPct = $hp
            $info.wearPct   = [math]::Max(0, [math]::Round(100.0 - $hp, 1))
        }
    } catch {}

    return [PSCustomObject]$info
}

# =========================================================================
# [IT DIAGNOSTIC ADDITION] HOSTS FILE, PROXY, PATH AUDIT, RECENT KBs & TEMP BLOAT
# =========================================================================
function Get-FolderSizeBytesSafe {
    param([string]$FolderPath)
    if (-not $FolderPath -or -not (Test-Path -LiteralPath $FolderPath -ErrorAction SilentlyContinue)) { return 0L }
    $sum = 0L
    try {
        foreach ($f in [System.IO.Directory]::EnumerateFiles($FolderPath, "*", [System.IO.SearchOption]::AllDirectories)) {
            try { $sum += ([System.IO.FileInfo]::new($f)).Length } catch {}
        }
    } catch {
        try {
            $sum = [long]((Get-ChildItem -LiteralPath $FolderPath -File -Recurse -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum)
        } catch {}
    }
    return $sum
}

function Format-AuditSize {
    param([long]$Bytes)
    if ($Bytes -le 0) { return "0 MB" }
    if ($Bytes -ge 1GB) { return "{0:N2} GB" -f ($Bytes / 1GB) }
    if ($Bytes -ge 1MB) { return "{0:N1} MB" -f ($Bytes / 1MB) }
    return "{0:N0} KB" -f ([math]::Max(1, $Bytes / 1KB))
}

function Get-TempBloatAudit {
    $targets = @(
        @{ id = "userTemp";  label = "User Temp (%TEMP%)";          path = $env:TEMP;                                cleanable = $true }
        @{ id = "winTemp";   label = "Windows Temp";                path = "$env:SystemRoot\Temp";                   cleanable = $true }
        @{ id = "wuCache";   label = "Windows Update Download";     path = "$env:SystemRoot\SoftwareDistribution\Download"; cleanable = $false }
        @{ id = "minidump";  label = "BSOD Minidumps";              path = "$env:SystemRoot\Minidump";               cleanable = $false }
        @{ id = "prefetch";  label = "Windows Prefetch";            path = "$env:SystemRoot\Prefetch";               cleanable = $false }
    )

    $rows = [System.Collections.Generic.List[PSCustomObject]]::new()
    $totalBytes = 0L
    foreach ($t in $targets) {
        $bytes = Get-FolderSizeBytesSafe -FolderPath $t.path
        $totalBytes += $bytes
        $rows.Add([PSCustomObject]@{
            id        = $t.id
            label     = $t.label
            path      = $t.path
            bytes     = $bytes
            sizeText  = Format-AuditSize -Bytes $bytes
            cleanable = [bool]$t.cleanable
        })
    }

    # Also check full MEMORY.DMP if present
    $memDmp = "$env:SystemRoot\MEMORY.DMP"
    if (Test-Path -LiteralPath $memDmp -ErrorAction SilentlyContinue) {
        try {
            $len = (Get-Item -LiteralPath $memDmp -ErrorAction SilentlyContinue).Length
            $totalBytes += $len
            $rows.Add([PSCustomObject]@{
                id = "memdump"; label = "Full Kernel MEMORY.DMP"; path = $memDmp; bytes = $len; sizeText = Format-AuditSize -Bytes $len; cleanable = $false
            })
        } catch {}
    }

    return [PSCustomObject]@{
        totalBytes = $totalBytes
        totalText  = Format-AuditSize -Bytes $totalBytes
        items      = @($rows)
    }
}

function Get-EnvHostsProxySnapshot {
    # 1. Hosts file active (non-comment) entries
    $hostsPath = "$env:SystemRoot\System32\drivers\etc\hosts"
    $hostsEntries = [System.Collections.Generic.List[PSCustomObject]]::new()
    try {
        if (Test-Path -LiteralPath $hostsPath -ErrorAction SilentlyContinue) {
            $lineNo = 0
            foreach ($line in (Get-Content -LiteralPath $hostsPath -ErrorAction SilentlyContinue)) {
                $lineNo++
                $clean = ($line -replace '#.*$', '').Trim()
                if (-not $clean) { continue }
                $parts = $clean -split '\s+'
                if ($parts.Count -ge 2) {
                    $hostsEntries.Add([PSCustomObject]@{
                        line = $lineNo
                        ip   = $parts[0]
                        host = ($parts[1..($parts.Count - 1)] -join ", ")
                    })
                }
            }
        }
    } catch {}

    # 2. WinINET (User) & WinHTTP (System) Proxy state
    $proxyEnabled = $false
    $proxyServer  = "None"
    $autoConfig   = "None"
    try {
        $inet = Get-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings" -ErrorAction SilentlyContinue
        if ($inet) {
            $proxyEnabled = ($inet.ProxyEnable -eq 1)
            if ($inet.ProxyServer)   { $proxyServer = [string]$inet.ProxyServer }
            if ($inet.AutoConfigURL) { $autoConfig  = [string]$inet.AutoConfigURL }
        }
    } catch {}

    $winHttpProxy = "Direct access (no proxy)"
    try {
        $whOut = (& netsh.exe winhttp show proxy 2>&1 | Out-String)
        if ($whOut -match 'Proxy Server\(s\)\s*:\s*(.+)') {
            $winHttpProxy = $Matches[1].Trim()
        }
    } catch {}

    # 3. PATH Environment Variable Health Audit (detects dead/missing folders & duplicates)
    $pathItems = [System.Collections.Generic.List[PSCustomObject]]::new()
    $seen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
    $missingCnt = 0
    $dupCnt = 0
    foreach ($scope in @("Machine", "User")) {
        $rawPath = [Environment]::GetEnvironmentVariable("Path", $scope)
        if (-not $rawPath) { continue }
        foreach ($seg in ($rawPath -split ';')) {
            $dir = $seg.Trim()
            if (-not $dir) { continue }
            $expanded = [Environment]::ExpandEnvironmentVariables($dir)
            $isDup = -not $seen.Add($expanded.TrimEnd('\'))
            $exists = Test-Path -LiteralPath $expanded -ErrorAction SilentlyContinue
            if (-not $exists) { $missingCnt++ }
            if ($isDup)       { $dupCnt++ }
            $pathItems.Add([PSCustomObject]@{
                scope  = $scope
                entry  = $dir
                exists = [bool]$exists
                isDup  = [bool]$isDup
            })
        }
    }

    # 4. Recent Windows Updates / Hotfixes (KBs)
    $hotfixes = [System.Collections.Generic.List[PSCustomObject]]::new()
    try {
        $hfs = @(Get-CimInstance -ClassName Win32_QuickFixEngineering -ErrorAction Stop |
            Sort-Object { try { [datetime]$_.InstalledOn } catch { [datetime]::MinValue } } -Descending |
            Select-Object -First 25)
        foreach ($h in $hfs) {
            $dtStr = if ($h.InstalledOn) {
                try { ([datetime]$h.InstalledOn).ToString("yyyy-MM-dd") } catch { [string]$h.InstalledOn }
            } else { "--" }
            $hotfixes.Add([PSCustomObject]@{
                kb          = [string]$h.HotFixID
                description = if ($h.Description) { [string]$h.Description } else { "Update" }
                installedOn = $dtStr
                installedBy = if ($h.InstalledBy) { [string]$h.InstalledBy } else { "System" }
            })
        }
    } catch {}

    return [PSCustomObject]@{
        type      = "SEC_ENV_HOSTS_PROXY_STATE"
        timestamp = (Get-Date).ToString("HH:mm:ss")
        hostsPath = $hostsPath
        hosts     = @($hostsEntries)
        proxy     = [PSCustomObject]@{
            enabled    = $proxyEnabled
            server     = $proxyServer
            pacUrl     = $autoConfig
            winHttp    = $winHttpProxy
        }
        pathAudit = [PSCustomObject]@{
            total   = $pathItems.Count
            missing = $missingCnt
            dups    = $dupCnt
            items   = @($pathItems)
        }
        hotfixes  = @($hotfixes)
        tempBloat = Get-TempBloatAudit
    }
}

function Get-SecurityPostureSnapshot {
    [CmdletBinding()]
    param()

    $isAdmin = Test-SecRepairElevated

    # 1. Secure Boot
    $secureBoot = "Unknown"
    try {
        $secureBoot = if (Confirm-SecureBootUEFI -ErrorAction Stop) { "On" } else { "Off" }
    } catch {
        if ($_.Exception.Message -match 'Cmdlet not supported') { $secureBoot = "Legacy BIOS" }
    }

    # 2. TPM 2.0 Readiness
    $tpmPresent = $false
    $tpmReady   = $false
    $tpmVersion = "Unknown"
    try {
        $tpmCim = Get-CimInstance -Namespace "root\CIMV2\Security\MicrosoftTpm" -ClassName Win32_Tpm -ErrorAction Stop | Select-Object -First 1
        if ($tpmCim) {
            $tpmPresent = $true
            $tpmReady   = [bool]($tpmCim.IsEnabled_InitialValue -and $tpmCim.IsActivated_InitialValue)
            $specVer    = [string]$tpmCim.SpecVersion
            if ($specVer) { $tpmVersion = ($specVer -split ',')[0].Trim() }
        }
    } catch {
        try {
            $t = Get-Tpm -ErrorAction Stop
            if ($t) {
                $tpmPresent = [bool]$t.TpmPresent
                $tpmReady   = [bool]$t.TpmReady
                $tpmVersion = if ($t.TpmPresent) { "2.0 / Present" } else { "Not Present" }
            }
        } catch {
            $tpmVersion = if (-not $isAdmin) { "Requires Admin" } else { "Unavailable" }
        }
    }

    # 3. Core Isolation / HVCI (Memory Integrity)
    $hvciStatus = "Off"
    try {
        $dg = Get-CimInstance -Namespace "root\Microsoft\Windows\DeviceGuard" -ClassName Win32_DeviceGuard -ErrorAction Stop | Select-Object -First 1
        if ($dg -and $dg.SecurityServicesRunning -contains 2) {
            $hvciStatus = "On"
        } elseif ($dg -and $dg.SecurityServicesConfigured -contains 2) {
            $hvciStatus = "Configured (Reboot)"
        }
    } catch {
        try {
            $hvciReg = Get-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\DeviceGuard\Scenarios\HypervisorEnforcedCodeIntegrity" -Name "Enabled" -ErrorAction SilentlyContinue
            if ($hvciReg -and $hvciReg.Enabled -eq 1) { $hvciStatus = "On" }
        } catch {}
    }

    # 4. Remote Desktop (RDP) Status + Port + NLA
    $rdpEnabled = $false
    $rdpPort    = 3389
    $rdpNla     = $true
    try {
        $tsKey = Get-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server" -Name "fDenyTSConnections" -ErrorAction SilentlyContinue
        if ($tsKey -and $tsKey.fDenyTSConnections -eq 0) { $rdpEnabled = $true }
        $tcpKey = Get-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp" -ErrorAction SilentlyContinue
        if ($tcpKey) {
            if ($tcpKey.PortNumber) { $rdpPort = [int]$tcpKey.PortNumber }
            if ($null -ne $tcpKey.UserAuthentication) { $rdpNla = ($tcpKey.UserAuthentication -eq 1) }
        }
    } catch {}

    # 5. BitLocker Volume Encryption Status
    $bitlocker = [System.Collections.Generic.List[PSCustomObject]]::new()
    $blAccessNote = ""
    try {
        $vols = @(Get-BitLockerVolume -ErrorAction Stop)
        foreach ($v in $vols) {
            $bitlocker.Add([PSCustomObject]@{
                mountPoint       = [string]$v.MountPoint
                protectionStatus = [string]$v.ProtectionStatus
                volumeStatus     = [string]$v.VolumeStatus
                encryptionPct    = [int]$v.EncryptionPercentage
                method           = if ($v.EncryptionMethod) { [string]$v.EncryptionMethod } else { "None" }
                lockStatus       = [string]$v.LockStatus
            })
        }
    } catch {
        $blAccessNote = if (-not $isAdmin) { "Run CoreWatch as Administrator to query BitLocker volume encryption status." } else { "BitLocker management unavailable on this Windows edition." }
    }

    # 6. Local Administrators Group Members
    $localAdmins = [System.Collections.Generic.List[PSCustomObject]]::new()
    try {
        $members = @(Get-LocalGroupMember -Group "Administrators" -ErrorAction Stop)
        foreach ($m in $members) {
            $localAdmins.Add([PSCustomObject]@{
                name   = [string]$m.Name
                class  = [string]$m.ObjectClass
                source = [string]$m.PrincipalSource
            })
        }
    } catch {
        # Fallback via net localgroup
        try {
            $lines = @(net localgroup Administrators 2>&1)
            $inList = $false
            foreach ($l in $lines) {
                $t = ([string]$l).Trim()
                if ($t -match '^-{5,}$') { $inList = $true; continue }
                if ($inList) {
                    if (-not $t -or $t -match 'command completed successfully') { break }
                    $localAdmins.Add([PSCustomObject]@{ name = $t; class = "Account"; source = "Local/Domain" })
                }
            }
        } catch {}
    }

    # 7. Non-Microsoft Scheduled Tasks (Persistence & 3rd-Party Audit)
    $tasks = [System.Collections.Generic.List[PSCustomObject]]::new()
    try {
        $allTasks = @(Get-ScheduledTask -ErrorAction Stop | Where-Object {
            $_.TaskPath -notlike "\Microsoft\Windows\*" -and $_.TaskPath -notlike "\Microsoft\Office\*"
        } | Sort-Object TaskPath, TaskName | Select-Object -First 120)

        foreach ($t in $allTasks) {
            $actSummary = ""
            if ($t.Actions -and $t.Actions.Count -gt 0) {
                $a0 = $t.Actions[0]
                if ($a0.Execute) {
                    $actSummary = ("$($a0.Execute) $($a0.Arguments)").Trim()
                }
            }
            $tasks.Add([PSCustomObject]@{
                name      = [string]$t.TaskName
                path      = [string]$t.TaskPath
                state     = [string]$t.State
                author    = if ($t.Author) { [string]$t.Author } else { "Unknown" }
                action    = $actSummary
            })
        }
    } catch {}

    # 8. Battery Health
    $battery = Get-BatteryHealthInfo

    return [PSCustomObject]@{
        type          = "SECURITY_REPAIR_STATE"
        isAdmin       = $isAdmin
        timestamp     = (Get-Date).ToString("HH:mm:ss")
        posture       = [PSCustomObject]@{
            secureBoot   = $secureBoot
            tpmPresent   = $tpmPresent
            tpmReady     = $tpmReady
            tpmVersion   = $tpmVersion
            hvciStatus   = $hvciStatus
            rdpEnabled   = $rdpEnabled
            rdpPort      = $rdpPort
            rdpNla       = $rdpNla
            blAccessNote = $blAccessNote
        }
        bitlocker     = @($bitlocker)
        localAdmins   = @($localAdmins)
        tasks         = @($tasks)
        battery       = $battery
    }
}

function Export-CoreWatchSupportBundle {
    param(
        [Parameter(Mandatory)][string]$RootPath,
        [Parameter(Mandatory)][string]$OutputZipPath
    )

    $tempDir = Join-Path $env:TEMP ("CoreWatch_Bundle_" + [guid]::NewGuid().ToString("N"))
    $null = New-Item -ItemType Directory -Path $tempDir -Force

    try {
        # 1. Core Telemetry Snapshot
        . (Join-Path $RootPath "modules\telemetry\GetIDMetrics.ps1")
        . (Join-Path $RootPath "modules\telemetry\GetInfraMetrics.ps1")
        . (Join-Path $RootPath "modules\telemetry\GetSystemMetrics.ps1")
        . (Join-Path $RootPath "modules\telemetry\GetNetworkMetrics.ps1")
        . (Join-Path $RootPath "modules\telemetry\StorageEngine.ps1")

        $idInfo    = try { Get-IDMetrics } catch { [PSCustomObject]@{ HostName = $env:COMPUTERNAME; Workgroup = "Unknown"; ElevationStatus = "Unknown"; CpuModel = "Unknown" } }
        $infraInfo = try { Get-InfraMetrics } catch { [PSCustomObject]@{ OsEdition = "Windows"; WindowsBuild = "Unknown"; WindowsUpdateLevel = "Unknown"; PendingReboot = "Unknown"; PendingRebootDetail = ""; LastCrashText = "Unknown"; UptimeText = "Unknown" } }
        $sysInfo   = try { Get-SystemMetrics } catch { [PSCustomObject]@{ CpuLoad = 0; CpuClock = "--"; ThrottleState = "Unknown"; GpuModel = "Unknown"; GpuVramText = "--"; RamUsageText = "--"; RamPercent = 0; PagefileUsageText = "--" } }
        $netInfo   = try { Get-NetworkMetrics } catch { [PSCustomObject]@{ IntIPv4 = "0.0.0.0"; Gateway = "N/A"; DnsServers = "N/A"; DnsStatusText = "N/A"; ArpStatus = "N/A" } }
        $storInfo  = try { @(Get-StorageMetrics) } catch { @() }

        $coreSnap = [PSCustomObject]@{
            GeneratedAt = (Get-Date).ToString("o")
            Identity    = $idInfo
            Infra       = $infraInfo
            System      = $sysInfo
            Network     = $netInfo
            Storage     = $storInfo
        }
        $coreSnap | ConvertTo-Json -Depth 6 | Set-Content -Path (Join-Path $tempDir "01_System_Hardware_Identity.json") -Encoding UTF8

        # 2. Processes, Services & Open Ports
        $tpPath = Join-Path $RootPath "modules\tabs\TasksPortsManager.ps1"
        $tpSnap = $null
        if (Test-Path $tpPath) {
            . $tpPath
            $tpSnap = Get-TasksPortsSnapshot
            $tpSnap | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $tempDir "02_Processes_Services_Ports.json") -Encoding UTF8
        }

        # 3. Security & Compliance Posture
        $secSnap = Get-SecurityPostureSnapshot
        $secSnap | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $tempDir "03_Security_Compliance.json") -Encoding UTF8

        # 4. Wi-Fi, IPv4 Routing Table & ARP Table
        $ndPath = Join-Path $RootPath "modules\tabs\NetworkDiagnostics.ps1"
        if (Test-Path $ndPath) {
            . $ndPath
            $wrSnap = Get-NetDiagWifiAndRoutes
            $wrSnap | ConvertTo-Json -Depth 5 | Set-Content -Path (Join-Path $tempDir "04_WiFi_Routes_ARP.json") -Encoding UTF8
        }

        # 5. Recent System & Application Critical/Error Events (Last 50)
        $evLines = [System.Collections.Generic.List[string]]::new()
        foreach ($logName in @("System", "Application")) {
            $evLines.Add("===== $logName LOG (Recent Critical / Error) =====")
            try {
                $evs = @(Get-WinEvent -FilterHashtable @{ LogName = $logName; Level = 1, 2 } -MaxEvents 25 -ErrorAction SilentlyContinue)
                if ($evs.Count -eq 0) { $evLines.Add("No Critical/Error events found.") }
                foreach ($e in $evs) {
                    $firstMsg = if ($e.Message) { ($e.Message -split "`r?`n")[0].Trim() } else { "" }
                    $evLines.Add("[$($e.TimeCreated.ToString('yyyy-MM-dd HH:mm:ss'))] Lvl=$($e.LevelDisplayName) ID=$($e.Id) Provider=$($e.ProviderName) :: $firstMsg")
                }
            } catch {
                $evLines.Add("Unable to query $logName log: $($_.Exception.Message)")
            }
            $evLines.Add("")
        }
        $evLines | Set-Content -Path (Join-Path $tempDir "05_Recent_System_Errors.txt") -Encoding UTF8

        # 6. Ticket-Ready Executive Markdown Summary
        $md = @(
            "# CoreWatch IT Support Bundle Summary"
            "- **Generated:** $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')"
            "- **Host / Workgroup:** $($idInfo.HostName) ($($idInfo.Workgroup))"
            "- **Elevation:** $($idInfo.ElevationStatus)"
            "- **OS:** $($infraInfo.OsEdition) (Build $($infraInfo.WindowsBuild), $($infraInfo.WindowsUpdateLevel))"
            "- **Pending Reboot:** $($infraInfo.PendingReboot) ($($infraInfo.PendingRebootDetail))"
            "- **Last Crash / BSOD:** $($infraInfo.LastCrashText)"
            "- **Uptime:** $($infraInfo.UptimeText)"
            "- **CPU / GPU:** $($idInfo.CpuModel) ($($sysInfo.CpuLoad)% @ $($sysInfo.CpuClock), Throttle: $($sysInfo.ThrottleState)) | $($sysInfo.GpuModel) (VRAM: $($sysInfo.GpuVramText))"
            "- **RAM / Pagefile:** $($sysInfo.RamUsageText) ($($sysInfo.RamPercent)%) | Pagefile: $($sysInfo.PagefileUsageText)"
            "- **Network:** IP=$($netInfo.IntIPv4) GW=$($netInfo.Gateway) DNS=$($netInfo.DnsServers) (Check: $($netInfo.DnsStatusText), ARP: $($netInfo.ArpStatus))"
            "- **Security:** SecureBoot=$($secSnap.posture.secureBoot) | TPM=$($secSnap.posture.tpmVersion) | HVCI=$($secSnap.posture.hvciStatus) | RDP=$(if ($secSnap.posture.rdpEnabled) { 'On:' + $secSnap.posture.rdpPort } else { 'Off' }) | LocalAdmins=$($secSnap.localAdmins.Count)"
            "- **Tasks/Ports:** $(if ($tpSnap) { "Procs=$($tpSnap.summary.totalProcesses), StoppedAutoSvc=$($tpSnap.summary.stoppedAutoSvc), Listening=$($tpSnap.summary.listeningPorts)" } else { 'N/A' })"
            ""
            "## Attached Files"
            '- `01_System_Hardware_Identity.json`'
            '- `02_Processes_Services_Ports.json`'
            '- `03_Security_Compliance.json`'
            '- `04_WiFi_Routes_ARP.json`'
            '- `05_Recent_System_Errors.txt`'
        )
        $md | Set-Content -Path (Join-Path $tempDir "README_SUMMARY.md") -Encoding UTF8

        # Create ZIP archive
        $parentDir = Split-Path -Path $OutputZipPath -Parent
        if ($parentDir -and -not (Test-Path -LiteralPath $parentDir)) {
            $null = New-Item -ItemType Directory -Path $parentDir -Force
        }
        if (Test-Path -LiteralPath $OutputZipPath) {
            Remove-Item -LiteralPath $OutputZipPath -Force -ErrorAction SilentlyContinue
        }

        Compress-Archive -Path (Join-Path $tempDir "*") -DestinationPath $OutputZipPath -CompressionLevel Optimal -Force -ErrorAction Stop
        $zipSizeKB = [math]::Round(((Get-Item -LiteralPath $OutputZipPath).Length / 1KB), 1)
        return [PSCustomObject]@{
            type    = "SECURITY_REPAIR_NOTICE"
            ok      = $true
            zipPath = $OutputZipPath
            message = "Support bundle exported to $OutputZipPath (${zipSizeKB} KB)."
        }
    } finally {
        Remove-Item -LiteralPath $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Invoke-SecurityRepairAction {
    param(
        [Parameter(Mandatory)][string]$RawJson,
        [Parameter(Mandatory)][string]$RootPath
    )

    $payload = $null
    try {
        $payload = $RawJson | ConvertFrom-Json
    } catch {
        return [PSCustomObject]@{ type = "SECURITY_REPAIR_NOTICE"; ok = $false; error = "Invalid security/repair command payload." }
    }

    $cmd = [string]$payload.command

    try {
        switch ($cmd) {

            "SEC_TOGGLE_RDP" {
                if (-not (Test-SecRepairElevated)) { throw "Administrator privileges are required to toggle Remote Desktop (RDP)." }
                $enable = ($payload.targetState -eq "On")
                $denyVal = if ($enable) { 0 } else { 1 }
                Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server" -Name "fDenyTSConnections" -Value $denyVal -ErrorAction Stop
                if ($enable) {
                    Enable-NetFirewallRule -DisplayGroup "Remote Desktop" -ErrorAction SilentlyContinue
                } else {
                    Disable-NetFirewallRule -DisplayGroup "Remote Desktop" -ErrorAction SilentlyContinue
                }
                $snap = Get-SecurityPostureSnapshot
                $snap | Add-Member -NotePropertyName "actionMessage" -NotePropertyValue "Remote Desktop (RDP) turned $(if ($enable) { 'On' } else { 'Off' })." -Force
                return $snap
            }

            "SEC_TOGGLE_TASK" {
                if (-not (Test-SecRepairElevated)) { throw "Administrator privileges are required to enable or disable Scheduled Tasks." }
                $tName  = [string]($payload.taskName ?? "").Trim()
                $tPath  = [string]($payload.taskPath ?? "\").Trim()
                $enable = ($payload.targetState -eq "Enable")
                if (-not $tName) { throw "Task name is required." }

                if ($enable) {
                    Enable-ScheduledTask -TaskPath $tPath -TaskName $tName -ErrorAction Stop | Out-Null
                } else {
                    Disable-ScheduledTask -TaskPath $tPath -TaskName $tName -ErrorAction Stop | Out-Null
                }
                $snap = Get-SecurityPostureSnapshot
                $snap | Add-Member -NotePropertyName "actionMessage" -NotePropertyValue "Scheduled Task '$tName' $(if ($enable) { 'enabled' } else { 'disabled' })." -Force
                return $snap
            }

            "REPAIR_DISM_CHECK" {
                if (-not (Test-SecRepairElevated)) { throw "Administrator privileges are required to run DISM." }
                $sw = [System.Diagnostics.Stopwatch]::StartNew()
                $out = (& dism.exe /Online /Cleanup-Image /CheckHealth 2>&1 | Out-String).Trim()
                $sw.Stop()
                return [PSCustomObject]@{
                    type      = "REPAIR_TOOL_OUTPUT"
                    ok        = ($LASTEXITCODE -eq 0)
                    tool      = "DISM /CheckHealth"
                    exitCode  = $LASTEXITCODE
                    elapsedMs = [int]$sw.ElapsedMilliseconds
                    output    = $out
                }
            }

            "REPAIR_DISM_RESTORE_TERM" {
                $pwshExe = (Get-Process -Id $PID).MainModule.FileName
                $cmdStr = "Write-Host '=== CoreWatch Windows Image Repair (DISM /RestoreHealth) ===' -ForegroundColor Cyan; dism.exe /Online /Cleanup-Image /RestoreHealth; Write-Host ''; Read-Host 'DISM finished. Press Enter to close'"
                Start-Process -FilePath $pwshExe -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $cmdStr) -Verb RunAs -ErrorAction Stop
                return [PSCustomObject]@{
                    type      = "REPAIR_TOOL_OUTPUT"
                    ok        = $true
                    tool      = "DISM /RestoreHealth"
                    exitCode  = 0
                    elapsedMs = 0
                    output    = "Launched elevated interactive terminal running: dism.exe /Online /Cleanup-Image /RestoreHealth"
                }
            }

            "REPAIR_SFC_TERM" {
                $pwshExe = (Get-Process -Id $PID).MainModule.FileName
                $cmdStr = "Write-Host '=== CoreWatch System File Checker (sfc /scannow) ===' -ForegroundColor Cyan; sfc.exe /scannow; Write-Host ''; Read-Host 'SFC scan finished. Press Enter to close'"
                Start-Process -FilePath $pwshExe -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $cmdStr) -Verb RunAs -ErrorAction Stop
                return [PSCustomObject]@{
                    type      = "REPAIR_TOOL_OUTPUT"
                    ok        = $true
                    tool      = "SFC /scannow"
                    exitCode  = 0
                    elapsedMs = 0
                    output    = "Launched elevated interactive terminal running: sfc.exe /scannow"
                }
            }

            "REPAIR_WU_RESET" {
                if (-not (Test-SecRepairElevated)) { throw "Administrator privileges are required to reset Windows Update components." }
                $log = [System.Collections.Generic.List[string]]::new()
                $sw = [System.Diagnostics.Stopwatch]::StartNew()
                $svcs = @("wuauserv", "cryptSvc", "bits", "msiserver")
                foreach ($s in $svcs) {
                    try { Stop-Service -Name $s -Force -ErrorAction SilentlyContinue; $log.Add("Stopped $s") } catch {}
                }
                $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
                $sdPath = "$env:SystemRoot\SoftwareDistribution"
                $crPath = "$env:SystemRoot\System32\catroot2"
                if (Test-Path $sdPath) {
                    try { Rename-Item -Path $sdPath -NewName "SoftwareDistribution.bak_$stamp" -ErrorAction Stop; $log.Add("Renamed SoftwareDistribution -> .bak_$stamp") }
                    catch { $log.Add("SoftwareDistribution rename skipped (file locked): $($_.Exception.Message)") }
                }
                if (Test-Path $crPath) {
                    try { Rename-Item -Path $crPath -NewName "catroot2.bak_$stamp" -ErrorAction Stop; $log.Add("Renamed catroot2 -> .bak_$stamp") }
                    catch { $log.Add("catroot2 rename skipped (file locked): $($_.Exception.Message)") }
                }
                foreach ($s in $svcs) {
                    try { Start-Service -Name $s -ErrorAction SilentlyContinue; $log.Add("Started $s") } catch {}
                }
                $sw.Stop()
                return [PSCustomObject]@{
                    type      = "REPAIR_TOOL_OUTPUT"
                    ok        = $true
                    tool      = "Windows Update Reset"
                    exitCode  = 0
                    elapsedMs = [int]$sw.ElapsedMilliseconds
                    output    = ($log -join "`n") + "`nWindows Update cache reset complete."
                }
            }

            "REPAIR_NET_STACK_RESET" {
                if (-not (Test-SecRepairElevated)) { throw "Administrator privileges are required to reset Winsock & TCP/IP stack." }
                $sw = [System.Diagnostics.Stopwatch]::StartNew()
                $out1 = (& netsh.exe winsock reset 2>&1 | Out-String).Trim()
                $out2 = (& netsh.exe int ip reset 2>&1 | Out-String).Trim()
                $null = Clear-DnsClientCache -ErrorAction SilentlyContinue
                $sw.Stop()
                return [PSCustomObject]@{
                    type      = "REPAIR_TOOL_OUTPUT"
                    ok        = $true
                    tool      = "Winsock & TCP/IP Reset"
                    exitCode  = 0
                    elapsedMs = [int]$sw.ElapsedMilliseconds
                    output    = "=== netsh winsock reset ===`n$out1`n`n=== netsh int ip reset ===`n$out2`n`nDNS cache flushed. Restart Windows to finalize TCP/IP stack reset."
                }
            }

            "REPAIR_WINGET_CHECK" {
                $wg = Get-Command "winget.exe" -ErrorAction SilentlyContinue
                if (-not $wg) { throw "winget.exe is not installed on this system." }
                $sw = [System.Diagnostics.Stopwatch]::StartNew()
                $out = (& $wg.Source upgrade --accept-source-agreements 2>&1 | Out-String).Trim()
                $sw.Stop()
                return [PSCustomObject]@{
                    type      = "REPAIR_TOOL_OUTPUT"
                    ok        = $true
                    tool      = "Winget Outdated Packages"
                    exitCode  = $LASTEXITCODE
                    elapsedMs = [int]$sw.ElapsedMilliseconds
                    output    = if ($out) { $out } else { "All winget packages are up to date." }
                }
            }

            "REPAIR_BATTERY_REPORT" {
                $reportPath = Join-Path $env:TEMP ("CoreWatch_BatteryReport_" + (Get-Date -Format "yyyyMMdd_HHmmss") + ".html")
                $out = (& powercfg.exe /batteryreport /output "$reportPath" 2>&1 | Out-String).Trim()
                if (Test-Path -LiteralPath $reportPath) {
                    Start-Process -FilePath $reportPath
                    return [PSCustomObject]@{
                        type      = "REPAIR_TOOL_OUTPUT"
                        ok        = $true
                        tool      = "Battery Health Report"
                        exitCode  = 0
                        elapsedMs = 0
                        output    = "$out`nOpened battery health report in your default browser: $reportPath"
                    }
                } else {
                    return [PSCustomObject]@{
                        type      = "REPAIR_TOOL_OUTPUT"
                        ok        = $false
                        tool      = "Battery Health Report"
                        exitCode  = $LASTEXITCODE
                        elapsedMs = 0
                        output    = if ($out) { $out } else { "No system battery detected on this machine (desktop PC)." }
                    }
                }
            }

            "EXPORT_SUPPORT_BUNDLE" {
                $targetZip = [string]($payload.targetPath ?? "").Trim()
                if (-not $targetZip) {
                    $desktop = [Environment]::GetFolderPath("Desktop")
                    $targetZip = Join-Path $desktop ("CoreWatch_SupportBundle_$($env:COMPUTERNAME)_$(Get-Date -Format 'yyyyMMdd_HHmmss').zip")
                }
                return Export-CoreWatchSupportBundle -RootPath $RootPath -OutputZipPath $targetZip
            }

            "SEC_LOAD_ENV_HOSTS_PROXY" {
                return Get-EnvHostsProxySnapshot
            }

            "SEC_TOGGLE_PROXY" {
                $enable = ($payload.targetState -eq "On")
                $val = if ($enable) { 1 } else { 0 }
                Set-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings" -Name "ProxyEnable" -Value $val -ErrorAction Stop
                $snap = Get-EnvHostsProxySnapshot
                $snap | Add-Member -NotePropertyName "actionMessage" -NotePropertyValue "Windows User System Proxy turned $(if ($enable) { 'On' } else { 'Off' })." -Force
                return $snap
            }

            "SEC_OPEN_HOSTS_FILE" {
                $hostsPath = "$env:SystemRoot\System32\drivers\etc\hosts"
                Start-Process -FilePath "notepad.exe" -ArgumentList @($hostsPath) -ErrorAction Stop
                return [PSCustomObject]@{ type = "SECURITY_REPAIR_NOTICE"; ok = $true; message = "Opened $hostsPath in Notepad." }
            }

            "REPAIR_CLEAN_TEMP" {
                $sw = [System.Diagnostics.Stopwatch]::StartNew()
                $reclaimed = 0L
                $deletedFiles = 0
                $skippedFiles = 0
                foreach ($dir in @($env:TEMP, "$env:SystemRoot\Temp")) {
                    if (-not $dir -or -not (Test-Path -LiteralPath $dir -ErrorAction SilentlyContinue)) { continue }
                    $children = @(Get-ChildItem -LiteralPath $dir -Force -ErrorAction SilentlyContinue)
                    foreach ($item in $children) {
                        try {
                            $itemBytes = if ($item.PSIsContainer) { Get-FolderSizeBytesSafe -FolderPath $item.FullName } else { $item.Length }
                            Remove-Item -LiteralPath $item.FullName -Recurse -Force -ErrorAction Stop
                            $reclaimed += $itemBytes
                            $deletedFiles++
                        } catch {
                            $skippedFiles++
                        }
                    }
                }
                $sw.Stop()
                $msg = "Cleaned $deletedFiles temp item(s) across %TEMP% & Windows\Temp — Reclaimed $(Format-AuditSize -Bytes $reclaimed) ($skippedFiles locked in-use item(s) safely skipped)."
                return [PSCustomObject]@{
                    type      = "REPAIR_TOOL_OUTPUT"
                    ok        = $true
                    tool      = "Safe Temp Cleanup"
                    exitCode  = 0
                    elapsedMs = [int]$sw.ElapsedMilliseconds
                    output    = $msg
                    tempBloat = Get-TempBloatAudit
                }
            }

            default {
                throw "Unsupported Security/Repair command: $cmd"
            }
        }
    } catch {
        return [PSCustomObject]@{
            type  = "SECURITY_REPAIR_NOTICE"
            ok    = $false
            error = $_.Exception.Message
        }
    }
}
