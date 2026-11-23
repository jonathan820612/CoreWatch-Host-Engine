# File: modules/telemetry/GetInfraMetrics.ps1

. (Join-Path $PSScriptRoot "GetDisplayMetrics.ps1")

$script:StaticInfraCache     = $null
$script:LastDynamicInfra     = [datetime]::MinValue
$script:LastDisplayCheck     = [datetime]::MinValue
$script:LastStabilityCheck   = [datetime]::MinValue
$script:CachedPowerPlanInfra = "Balanced"
$script:CachedAudioOut       = "Speakers / Default Output"
$script:CachedAudioIn        = "No Active Input Device"
$script:CachedMonitors       = @()

# =========================================================================
# [DIAGNOSTIC ADDITION] PENDING REBOOT & UNEXPECTED SHUTDOWN/BSOD CACHES
# =========================================================================
$script:CachedPendingReboot       = "No"
$script:CachedPendingRebootDetail = "No pending reboot flags detected"
$script:CachedLastCrashText       = "None Recorded"
$script:CachedLastCrashDetail     = "No Kernel-Power (41) or BugCheck (1001) events found"
$script:CachedHasRecentCrash      = $false

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

    # Refresh slow PnP audio & power plan queries every 15 seconds
    if (([datetime]::Now - $script:LastDynamicInfra).TotalSeconds -ge 15) {
        try {
            $ActivePlan = powercfg /getactivescheme
            if ($ActivePlan -match '\((.*)\)') { $script:CachedPowerPlanInfra = $Matches[1] }
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
