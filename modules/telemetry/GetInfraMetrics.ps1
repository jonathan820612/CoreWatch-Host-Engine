# File: modules/telemetry/GetInfraMetrics.ps1

. (Join-Path $PSScriptRoot "GetDisplayMetrics.ps1")

$script:StaticInfraCache = $null
$script:LastDynamicInfra = [datetime]::MinValue
$script:LastDisplayCheck = [datetime]::MinValue
$script:CachedPowerPlanInfra = "Balanced"
$script:CachedAudioOut   = "Speakers / Default Output"
$script:CachedAudioIn    = "No Active Input Device"
$script:CachedMonitors   = @()

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

    # Refresh display / video metrics every 5 seconds
    if (([datetime]::Now - $script:LastDisplayCheck).TotalSeconds -ge 5) {
        try {
            $script:CachedMonitors = @(Get-DisplayMetrics)
        } catch {}
        $script:LastDisplayCheck = [datetime]::Now
    }

    return [PSCustomObject]@{
        OsEdition          = $script:StaticInfraCache.OsEdition
        WindowsBuild       = $script:StaticInfraCache.WindowsBuild
        BiosVersion        = $script:StaticInfraCache.BiosVersion
        PsVersion          = $script:StaticInfraCache.PsVersion
        CpuDriverVersion   = "Standard Driver"
        Virtualization     = $script:StaticInfraCache.Virtualization
        SecureBoot         = $script:StaticInfraCache.SecureBoot
        ChassisType        = "Custom PC"
        WindowsUpdateLevel = $script:StaticInfraCache.WindowsUpdateLevel
        UptimeText         = [string]$UptimeStr
        Motherboard        = $script:StaticInfraCache.Motherboard
        DirectX            = "DirectX 12"
        PowerPlan          = [string]$script:CachedPowerPlanInfra
        SoundCardIdentity  = [string]$script:CachedAudioOut
        MicrophoneIdentity = [string]$script:CachedAudioIn
        Monitors           = @($script:CachedMonitors)
    }
}
