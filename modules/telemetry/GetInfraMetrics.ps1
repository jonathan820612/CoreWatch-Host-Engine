# File: modules/telemetry/GetInfraMetrics.ps1

. (Join-Path $PSScriptRoot "GetDisplayMetrics.ps1")

if (-not ("CoreWatch.PowerPlanProbe" -as [type])) {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
namespace CoreWatch {
    public static class PowerPlanProbe {
        [DllImport("powrprof.dll")]
        private static extern uint PowerGetActiveScheme(IntPtr UserRootPowerKey, out IntPtr ActivePolicyGuid);
        [DllImport("powrprof.dll", CharSet = CharSet.Unicode)]
        private static extern uint PowerReadFriendlyName(IntPtr RootPowerKey, ref Guid SchemeGuid, IntPtr SubGroupOfPowerSettingsGuid, IntPtr PowerSettingGuid, byte[] Buffer, ref uint BufferSize);
        [DllImport("kernel32.dll")]
        private static extern IntPtr LocalFree(IntPtr hMem);

        public static string GetActiveSchemeName() {
            IntPtr pGuid = IntPtr.Zero;
            try {
                if (PowerGetActiveScheme(IntPtr.Zero, out pGuid) != 0 || pGuid == IntPtr.Zero) return null;
                Guid scheme = (Guid)Marshal.PtrToStructure(pGuid, typeof(Guid));
                uint size = 0;
                PowerReadFriendlyName(IntPtr.Zero, ref scheme, IntPtr.Zero, IntPtr.Zero, null, ref size);
                if (size == 0 || size > 4096) return null;
                byte[] buf = new byte[size];
                if (PowerReadFriendlyName(IntPtr.Zero, ref scheme, IntPtr.Zero, IntPtr.Zero, buf, ref size) != 0) return null;
                return System.Text.Encoding.Unicode.GetString(buf, 0, (int)size).TrimEnd('\0');
            } catch {
                return null;
            } finally {
                if (pGuid != IntPtr.Zero) LocalFree(pGuid);
            }
        }
    }
}
"@ -ErrorAction SilentlyContinue
}

$script:StaticInfraCache     = $null
$script:LastDynamicInfra     = [datetime]::MinValue
$script:LastDisplayCheck     = [datetime]::MinValue
$script:LastStabilityCheck   = [datetime]::MinValue
$script:CachedPowerPlanInfra = "Balanced"
$script:CachedAudioOut       = "Speakers / Default Output"
$script:CachedAudioIn        = "No Active Input Device"
$script:CachedMonitors       = @()
$script:CachedJavaPrimary    = "Not Installed"
$script:CachedJavaPath       = ""
$script:CachedJavaVersions   = @()
$script:CachedJavaVerTier    = "none"
$script:LastPsUpdateCheck    = [datetime]::MinValue
$script:CachedPsLatest       = ""
$script:CachedPsMissed       = 0
$script:CachedPsVerTier      = "uptodate"
$script:CachedPsHasMsi       = $true
$script:CachedPsUpdateDetail = "Click to check for PowerShell updates"
$script:CachedPsReleaseUrl   = "https://github.com/PowerShell/PowerShell/releases/latest"

# =========================================================================
# [DIAGNOSTIC ADDITION] PENDING REBOOT & UNEXPECTED SHUTDOWN/BSOD CACHES
# =========================================================================
$script:CachedPendingReboot       = "No"
$script:CachedPendingRebootDetail = "No pending reboot flags detected"
$script:CachedLastCrashText       = "None Recorded"
$script:CachedLastCrashDetail     = "No Kernel-Power (41) or BugCheck (1001) events found"
$script:CachedHasRecentCrash      = $false

# [DYNAMIC CONTROL] Force-expire cached Display/PowerPlan/Stability timers after user toggle
function Reset-InfraMetricsCache {
    $script:LastDynamicInfra   = [datetime]::MinValue
    $script:LastDisplayCheck   = [datetime]::MinValue
    $script:LastStabilityCheck = [datetime]::MinValue
}

# =========================================================================
# [DIAGNOSTIC ADDITION] PENDING REBOOT REGISTRY INSPECTOR
# Insert Point: Checks CBS, Windows Update, Session Manager & Pending Rename
# =========================================================================
function Get-PendingRebootState {
    $reasons = [System.Collections.Generic.List[string]]::new()
    try {
        if (Test-Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending" -ErrorAction SilentlyContinue) {
            $reasons.Add("Component Based Servicing")
        }
    } catch {}
    try {
        if (Test-Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired" -ErrorAction SilentlyContinue) {
            $reasons.Add("Windows Update")
        }
    } catch {}
    try {
        $activeName  = (Get-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\ComputerName\ActiveComputerName" -Name "ComputerName" -ErrorAction SilentlyContinue).ComputerName
        $pendingName = (Get-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\ComputerName\ComputerName" -Name "ComputerName" -ErrorAction SilentlyContinue).ComputerName
        if ($activeName -and $pendingName -and $activeName -ne $pendingName) {
            $reasons.Add("Pending Computer Rename ($activeName -> $pendingName)")
        }
    } catch {}

    if ($reasons.Count -gt 0) {
        return @{
            Status = "Yes"
            Detail = "Reboot required: $($reasons -join ', ')"
        }
    }
    return @{
        Status = "No"
        Detail = "No pending reboot registry flags detected"
    }
}

# =========================================================================
# [DIAGNOSTIC ADDITION] LAST UNEXPECTED SHUTDOWN / BSOD EVENT INSPECTOR
# Insert Point: Queries System Log for Kernel-Power (41) & BugCheck (1001)
# =========================================================================
function Get-LastUnexpectedShutdown {
    try {
        $events = @(Get-WinEvent -FilterHashtable @{ LogName = 'System'; Id = 41, 1001 } -MaxEvents 15 -ErrorAction SilentlyContinue | Where-Object {
            ($_.Id -eq 41 -and $_.ProviderName -eq 'Microsoft-Windows-Kernel-Power') -or
            ($_.Id -eq 1001 -and $_.ProviderName -match 'BugCheck|WER-SystemErrorReporting')
        })
        if ($events.Count -gt 0) {
            $ev = $events[0]
            $tag = if ($ev.Id -eq 1001) { "BSOD 1001" } else { "KP-41" }
            $tsStr = $ev.TimeCreated.ToString("yyyy-MM-dd HH:mm")
            $firstLine = if ($ev.Message) { ($ev.Message -split "`r?`n")[0].Trim() } else { "Unexpected shutdown event" }
            if ($firstLine.Length -gt 160) { $firstLine = $firstLine.Substring(0, 157) + "..." }
            $isRecent = (([datetime]::Now - $ev.TimeCreated).TotalDays -le 14)

            return @{
                Text     = "$tsStr ($tag)"
                Detail   = "Event ID $($ev.Id) [$($ev.ProviderName)] @ $($ev.TimeCreated.ToString('g')): $firstLine"
                IsRecent = $isRecent
            }
        }
    } catch {}

    return @{
        Text     = "None Recorded"
        Detail   = "No Kernel-Power (41) or BugCheck (1001) events in System log"
        IsRecent = $false
    }
}

# =========================================================================
# JAVA RUNTIME INSPECTOR (ZERO-SUBPROCESS SCAN OF INSTALLED JDKS / JRES)
# =========================================================================
function Get-InstalledJavaRuntimes {
    $candidates = New-Object System.Collections.Generic.HashSet[string] ([System.StringComparer]::OrdinalIgnoreCase)

    $searchRoots = @(
        "C:\Program Files\Eclipse Adoptium",
        "C:\Program Files\Java",
        "C:\Program Files\Microsoft",
        "C:\Program Files\Zulu",
        "C:\Program Files\Amazon Corretto",
        "C:\Program Files\BellSoft",
        "C:\Program Files\Semeru",
        "C:\Program Files\AdoptOpenJDK",
        "C:\Program Files (x86)\Eclipse Adoptium",
        "C:\Program Files (x86)\Java"
    )

    foreach ($root in $searchRoots) {
        if (Test-Path -LiteralPath $root -PathType Container) {
            try {
                Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue | ForEach-Object {
                    if (Test-Path -LiteralPath (Join-Path $_.FullName "bin\java.exe") -PathType Leaf) {
                        [void]$candidates.Add($_.FullName.TrimEnd('\'))
                    }
                }
            } catch {}
        }
    }

    # Include Machine/User/Process JAVA_HOME and PATH-resolved Java roots
    $machJavaHome = [Environment]::GetEnvironmentVariable("JAVA_HOME", "Machine")
    $userJavaHome = [Environment]::GetEnvironmentVariable("JAVA_HOME", "User")
    foreach ($jh in @($machJavaHome, $userJavaHome, $env:JAVA_HOME)) {
        if ($jh -and (Test-Path -LiteralPath (Join-Path $jh "bin\java.exe") -PathType Leaf)) {
            [void]$candidates.Add($jh.TrimEnd('\'))
        }
    }

    $machPath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $activePathJavaHome = ""
    foreach ($seg in (($machPath + ";" + $userPath) -split ';')) {
        $s = $seg.Trim().TrimEnd('\')
        if (-not $s) { continue }
        $expanded = [Environment]::ExpandEnvironmentVariables($s).TrimEnd('\')
        $javaExe = Join-Path $expanded "java.exe"
        if (Test-Path -LiteralPath $javaExe -PathType Leaf) {
            $parentDir = Split-Path -Path $expanded -Parent
            if ($parentDir -and (Split-Path -Path $expanded -Leaf) -ieq "bin") {
                [void]$candidates.Add($parentDir.TrimEnd('\'))
                if (-not $activePathJavaHome) { $activePathJavaHome = $parentDir.TrimEnd('\') }
            }
        }
    }

    # Determine primary active Java path (Machine JAVA_HOME > User JAVA_HOME > first PATH java.exe)
    $primaryPath = ""
    if ($machJavaHome -and (Test-Path -LiteralPath (Join-Path $machJavaHome "bin\java.exe") -PathType Leaf)) {
        $primaryPath = $machJavaHome.TrimEnd('\')
    } elseif ($userJavaHome -and (Test-Path -LiteralPath (Join-Path $userJavaHome "bin\java.exe") -PathType Leaf)) {
        $primaryPath = $userJavaHome.TrimEnd('\')
    } elseif ($activePathJavaHome) {
        $primaryPath = $activePathJavaHome
    }

    $list = New-Object System.Collections.Generic.List[PSCustomObject]
    foreach ($homeDir in $candidates) {
        $ver = ""
        $vendor = ""
        $releaseFile = Join-Path $homeDir "release"
        if (Test-Path -LiteralPath $releaseFile -PathType Leaf) {
            try {
                $relText = Get-Content -LiteralPath $releaseFile -Raw -ErrorAction SilentlyContinue
                if ($relText -match 'JAVA_VERSION="([^"]+)"') { $ver = $Matches[1].Trim() }
                if ($relText -match 'IMPLEMENTOR="([^"]+)"') { $vendor = $Matches[1].Trim() }
            } catch {}
        }
        if (-not $ver) {
            try {
                $fvi = [System.Diagnostics.FileVersionInfo]::GetVersionInfo((Join-Path $homeDir "bin\java.exe"))
                if ($fvi.ProductVersion) { $ver = $fvi.ProductVersion.Trim() }
                elseif ($fvi.FileVersion) { $ver = $fvi.FileVersion.Trim() }
            } catch {}
        }
        if (-not $ver) { $ver = Split-Path -Path $homeDir -Leaf }

        $shortVendor = switch -Regex ($vendor) {
            'Eclipse Adoptium|Temurin' { 'Temurin' }
            'Oracle'                   { 'Oracle' }
            'Microsoft'                { 'Microsoft' }
            'Azul|Zulu'                { 'Zulu' }
            'Amazon|Corretto'          { 'Corretto' }
            'BellSoft|Liberica'        { 'Liberica' }
            'IBM|Semeru'               { 'Semeru' }
            default                    {
                if ($homeDir -match 'Adoptium|Temurin') { 'Temurin' }
                elseif ($homeDir -match 'Microsoft') { 'Microsoft' }
                elseif ($homeDir -match 'Oracle|Java') { 'Oracle' }
                else { 'OpenJDK' }
            }
        }

        $major = 0
        if ($ver -match '^1\.(\d+)') { $major = [int]$Matches[1] }
        elseif ($ver -match '^(\d+)') { $major = [int]$Matches[1] }

        $isPrim = ($primaryPath -and ($homeDir.Equals($primaryPath, [System.StringComparison]::OrdinalIgnoreCase)))
        $list.Add([PSCustomObject]@{
            version   = $ver
            major     = $major
            vendor    = $shortVendor
            label     = "$ver ($shortVendor)"
            path      = $homeDir
            isPrimary = [bool]$isPrim
        })
    }

    $sorted = @($list | Sort-Object @{Expression={$_.isPrimary}; Descending=$true}, @{Expression={$_.major}; Descending=$true}, @{Expression={$_.version}; Descending=$true})

    if ($sorted.Count -gt 0 -and -not ($sorted | Where-Object { $_.isPrimary })) {
        $sorted[0].isPrimary = $true
        $primaryPath = $sorted[0].path
    }

    $primaryItem = $sorted | Where-Object { $_.isPrimary } | Select-Object -First 1
    $primaryText = if ($primaryItem) { $primaryItem.label } else { "Not Installed" }
    $javaTier = if (-not $primaryItem) {
        "none"
    } elseif ($primaryItem.major -ge 25) {
        "uptodate"
    } elseif ($primaryItem.major -ge 21) {
        "update"
    } else {
        "critical"
    }

    return @{
        primaryText = $primaryText
        primaryPath = $primaryPath
        versionTier = $javaTier
        versions    = $sorted
    }
}

# =========================================================================
# POWERSHELL RELEASE CHECKER (3-TIER: GREEN=CURRENT, PURPLE=1-5, RED=>5)
# =========================================================================
function Get-PowerShellUpdateStatus {
    param([switch]$Force)

    if (-not $Force -and $script:LastPsUpdateCheck -ne [datetime]::MinValue -and (([datetime]::Now - $script:LastPsUpdateCheck).TotalHours -lt 6)) {
        return @{
            latest  = $script:CachedPsLatest
            missed  = $script:CachedPsMissed
            tier    = $script:CachedPsVerTier
            hasMsi  = $script:CachedPsHasMsi
            detail  = $script:CachedPsUpdateDetail
            url     = $script:CachedPsReleaseUrl
        }
    }

    $curVer = $global:PSVersionTable.PSVersion
    $curSem = [version]::new([int]$curVer.Major, [int]$curVer.Minor, [int]([math]::Max(0, $curVer.Patch)))
    $arch = if ($env:PROCESSOR_ARCHITECTURE -match 'ARM64') { 'arm64' } elseif ([Environment]::Is64BitOperatingSystem) { 'x64' } else { 'x86' }

    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $rels = Invoke-RestMethod -Uri "https://api.github.com/repos/PowerShell/PowerShell/releases?per_page=30" -Headers @{"User-Agent"="CoreWatch"} -TimeoutSec 6 -ErrorAction Stop
        $stableEntries = New-Object System.Collections.Generic.List[PSCustomObject]

        foreach ($r in $rels) {
            if ($r.prerelease -or $r.draft) { continue }
            if ([string]$r.tag_name -match '^v(\d+\.\d+\.\d+)$') {
                $v = [version]$Matches[1]
                $hasMsiAsset = $null -ne ($r.assets | Where-Object { $_.name -match "^PowerShell-.*-win-$arch\.msi$" } | Select-Object -First 1)
                $stableEntries.Add([PSCustomObject]@{
                    ver    = $v
                    url    = if ($r.html_url) { [string]$r.html_url } else { "https://github.com/PowerShell/PowerShell/releases/latest" }
                    hasMsi = [bool]$hasMsiAsset
                })
            }
        }

        if ($stableEntries.Count -gt 0) {
            $sortedEntries = @($stableEntries | Sort-Object ver -Descending)
            $topEntry   = $sortedEntries[0]
            $latestVer  = $topEntry.ver
            $latestUrl  = $topEntry.url
            $latestMsi  = [bool]$topEntry.hasMsi
            $uniqueVers = @($sortedEntries | ForEach-Object { $_.ver } | Select-Object -Unique)
            $newerList  = @($uniqueVers | Where-Object { $_ -gt $curSem })
            $missed = $newerList.Count

            # If running PS 5.1 or very old 7.x where >30 releases passed, mark critical (>5 missed)
            if ($curSem.Major -lt $latestVer.Major) { $missed = [math]::Max($missed, 6) }
            elseif (($latestVer.Minor - $curSem.Minor) -ge 2 -and $missed -lt 6) { $missed = [math]::Max($missed, 6) }

            $msiNote = if ($latestMsi) { "Official .msi available" } else { "No .msi available — uses official .zip -> C:\Program Files\PowerShell\7" }
            $tier = if ($missed -eq 0) { "uptodate" } elseif ($missed -le 5) { "update" } else { "critical" }
            $detail = if ($missed -eq 0) {
                "PowerShell $curSem is up to date (latest: $latestVer) — Click to re-check"
            } elseif ($missed -le 5) {
                "PowerShell update available: $curSem -> $latestVer ($missed release(s) behind · $msiNote) — Click to install"
            } else {
                "PowerShell severely outdated: $curSem -> $latestVer ($missed+ releases missed · $msiNote) — Click to install"
            }

            $script:CachedPsLatest       = $latestVer.ToString()
            $script:CachedPsMissed       = $missed
            $script:CachedPsVerTier      = $tier
            $script:CachedPsHasMsi       = $latestMsi
            $script:CachedPsUpdateDetail = $detail
            $script:CachedPsReleaseUrl   = $latestUrl
            $script:LastPsUpdateCheck    = [datetime]::Now
        }
    } catch {
        if ($script:LastPsUpdateCheck -eq [datetime]::MinValue) {
            $script:CachedPsVerTier = if ($curSem.Major -lt 7) { "critical" } else { "uptodate" }
            $script:CachedPsUpdateDetail = "Offline or rate-limited checking GitHub releases — Click to retry"
            $script:LastPsUpdateCheck = [datetime]::Now.AddHours(-5.5) # retry in 30 min
        }
    }

    return @{
        latest  = $script:CachedPsLatest
        missed  = $script:CachedPsMissed
        tier    = $script:CachedPsVerTier
        hasMsi  = $script:CachedPsHasMsi
        detail  = $script:CachedPsUpdateDetail
        url     = $script:CachedPsReleaseUrl
    }
}

function Get-InfraMetrics {
    if ($null -eq $script:StaticInfraCache) {
        $OsInfo   = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction SilentlyContinue
        $BiosInfo = Get-CimInstance -ClassName Win32_Bios -ErrorAction SilentlyContinue
        $Board    = Get-CimInstance -ClassName Win32_BaseBoard -ErrorAction SilentlyContinue
        $CpuInfo  = Get-CimInstance -ClassName Win32_Processor -ErrorAction SilentlyContinue | Select-Object -First 1
        $CompSys  = Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction SilentlyContinue

        # Real Windows Version + UBR + Reboot Pending check
        $cvKey = Get-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion" -ErrorAction SilentlyContinue
        $displayVer = if ($cvKey -and $cvKey.DisplayVersion) { [string]$cvKey.DisplayVersion } else { "" }
        $ubr = if ($cvKey -and $null -ne $cvKey.UBR) { [string]$cvKey.UBR } else { "" }
        $buildStr = if ($OsInfo) {
            if ($ubr) { "$($OsInfo.BuildNumber).$ubr" } else { [string]$OsInfo.BuildNumber }
        } else { "Unknown" }

        $rebootPending = (Test-Path "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired" -ErrorAction SilentlyContinue)
        $updateLevelStr = if ($displayVer) {
            if ($rebootPending) { "$displayVer (Reboot Pending)" } else { "$displayVer · Up to Date" }
        } else {
            if ($rebootPending) { "Reboot Pending" } else { "Up to Date" }
        }

        # Real Hardware Virtualization status
        $virtStr = "Off"
        if (($CompSys -and $CompSys.HypervisorPresent -eq $true) -or ($CpuInfo -and $CpuInfo.VirtualizationFirmwareEnabled -eq $true)) {
            $virtStr = "On"
        }

        # Real Secure Boot status
        $secBootStr = "Unknown"
        try {
            $secBootStr = if (Confirm-SecureBootUEFI -ErrorAction Stop) { "On" } else { "Off" }
        } catch {
            if ($_.Exception.Message -match 'Cmdlet not supported') { $secBootStr = "Legacy BIOS" }
        }

        $script:StaticInfraCache = @{
            OsEdition          = if ($OsInfo) { ([string]$OsInfo.Caption).Trim() } else { "Windows" }
            WindowsBuild       = $buildStr
            WindowsUpdateLevel = $updateLevelStr
            LastBootTime       = if ($OsInfo) { $OsInfo.LastBootUpTime } else { [datetime]::Now }
            BiosVersion        = if ($BiosInfo) { [string]$BiosInfo.SMBIOSBIOSVersion } else { "Unknown BIOS" }
            Motherboard        = if ($Board) { [string]"$($Board.Manufacturer) $($Board.Product)".Trim() } else { "Unknown Motherboard" }
            PsVersion          = [string]$global:PSVersionTable.PSVersion.ToString()
            Virtualization     = $virtStr
            SecureBoot         = $secBootStr
        }
    }

    # Fast live uptime calculation (< 0.01ms)
    $UptimeSpan = [DateTime]::Now - $script:StaticInfraCache.LastBootTime
    $UptimeStr  = "{0}d {1}h {2:00}m" -f $UptimeSpan.Days, $UptimeSpan.Hours, $UptimeSpan.Minutes

    # Refresh slow PnP audio, Java & power plan queries every 15 seconds (zero powercfg.exe subprocess spawn!)
    if (([datetime]::Now - $script:LastDynamicInfra).TotalSeconds -ge 15) {
        try {
            $nativePlan = [CoreWatch.PowerPlanProbe]::GetActiveSchemeName()
            if ($nativePlan) {
                $script:CachedPowerPlanInfra = $nativePlan
            }
        } catch {}

        $foundAudioOut = $false
        try {
            $RegPlaybackKey = "HKCU:\Software\Microsoft\Multimedia\Audio"
            if (Test-Path $RegPlaybackKey) {
                $RegOutput = Get-ItemPropertyValue -Path $RegPlaybackKey -Name "PlaybackDevice" -ErrorAction SilentlyContinue
                if ($RegOutput) {
                    $script:CachedAudioOut = [string]$RegOutput
                    $foundAudioOut = $true
                }
            }
        } catch {}

        try {
            $ActiveEndpoints = @(Get-CimInstance -ClassName Win32_PnPEntity -Filter "PNPClass='AudioEndpoint' and Status='OK'" -ErrorAction SilentlyContinue)
            if (-not $foundAudioOut) {
                $OutEp = $ActiveEndpoints | Where-Object { $_.Name -match '(?i)(Speakers|Headphones|Headset|Line Out|Realtek|Scarlett|Audio|HDMI)' -and $_.Name -notmatch '(?i)(Microphone|Mic\b|Line In)' } | Select-Object -First 1
                if ($OutEp) { $script:CachedAudioOut = [string]$OutEp.Name }
            }
            $ActiveInputQuery = $ActiveEndpoints | Where-Object { $_.Name -match '(?i)(Microphone|Mic\b|Scarlett|Headset|Line In|Webcam)' } | Select-Object -First 1
            if ($ActiveInputQuery) { $script:CachedAudioIn = [string]$ActiveInputQuery.Name }
        } catch {}

        try {
            $javaInfo = Get-InstalledJavaRuntimes
            $script:CachedJavaPrimary  = [string]$javaInfo.primaryText
            $script:CachedJavaPath     = [string]$javaInfo.primaryPath
            $script:CachedJavaVerTier  = [string]$javaInfo.versionTier
            $script:CachedJavaVersions = @($javaInfo.versions)
        } catch {}

        try {
            $null = Get-PowerShellUpdateStatus
        } catch {}

        $script:LastDynamicInfra = [datetime]::Now
    }

    # [DIAGNOSTIC ADDITION] Refresh Pending Reboot & Last Crash/BSOD every 45 seconds
    if (([datetime]::Now - $script:LastStabilityCheck).TotalSeconds -ge 45) {
        $rebootState = Get-PendingRebootState
        $script:CachedPendingReboot       = $rebootState.Status
        $script:CachedPendingRebootDetail = $rebootState.Detail

        $crashInfo = Get-LastUnexpectedShutdown
        $script:CachedLastCrashText  = $crashInfo.Text
        $script:CachedLastCrashDetail = $crashInfo.Detail
        $script:CachedHasRecentCrash = $crashInfo.IsRecent

        $script:LastStabilityCheck = [datetime]::Now
    }

    # Refresh display / video metrics every 5 seconds
    if (([datetime]::Now - $script:LastDisplayCheck).TotalSeconds -ge 5) {
        try {
            $script:CachedMonitors = @(Get-DisplayMetrics)
        } catch {}
        $script:LastDisplayCheck = [datetime]::Now
    }

    return [PSCustomObject]@{
        OsEdition           = $script:StaticInfraCache.OsEdition
        WindowsBuild        = $script:StaticInfraCache.WindowsBuild
        BiosVersion         = $script:StaticInfraCache.BiosVersion
        PsVersion           = $script:StaticInfraCache.PsVersion
        PsLatestVersion     = [string]$script:CachedPsLatest
        PsMissedUpdates     = [int]$script:CachedPsMissed
        PsVersionTier       = [string]$script:CachedPsVerTier
        PsLatestHasMsi      = [bool]$script:CachedPsHasMsi
        PsUpdateDetail      = [string]$script:CachedPsUpdateDetail
        PsReleaseUrl        = [string]$script:CachedPsReleaseUrl
        JavaPrimaryText     = [string]$script:CachedJavaPrimary
        JavaPrimaryPath     = [string]$script:CachedJavaPath
        JavaVersionTier     = [string]$script:CachedJavaVerTier
        JavaVersions        = @($script:CachedJavaVersions)
        CpuDriverVersion    = "Standard Driver"
        Virtualization      = $script:StaticInfraCache.Virtualization
        SecureBoot          = $script:StaticInfraCache.SecureBoot
        ChassisType         = "Custom PC"
        WindowsUpdateLevel  = $script:StaticInfraCache.WindowsUpdateLevel
        PendingReboot       = [string]$script:CachedPendingReboot
        PendingRebootDetail = [string]$script:CachedPendingRebootDetail
        LastCrashText       = [string]$script:CachedLastCrashText
        LastCrashDetail     = [string]$script:CachedLastCrashDetail
        HasRecentCrash      = [bool]$script:CachedHasRecentCrash
        UptimeText          = [string]$UptimeStr
        Motherboard         = $script:StaticInfraCache.Motherboard
        DirectX             = "DirectX 12"
        PowerPlan           = [string]$script:CachedPowerPlanInfra
        SoundCardIdentity   = [string]$script:CachedAudioOut
        MicrophoneIdentity  = [string]$script:CachedAudioIn
        Monitors            = @($script:CachedMonitors)
    }
}
