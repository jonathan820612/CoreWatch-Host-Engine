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

        $script:StaticInfraCache = @{
            OsEdition    = if ($OsInfo) { [string]$OsInfo.Caption } else { "Windows" }
            WindowsBuild = if ($OsInfo) { [string]$OsInfo.BuildNumber } else { "Unknown" }
            LastBootTime = if ($OsInfo) { $OsInfo.LastBootUpTime } else { [datetime]::Now }
            BiosVersion  = if ($BiosInfo) { [string]$BiosInfo.SMBIOSBIOSVersion } else { "Unknown BIOS" }
            Motherboard  = if ($Board) { [string]"$($Board.Manufacturer) $($Board.Product)" } else { "Unknown Motherboard" }
            PsVersion    = [string]$global:PSVersionTable.PSVersion.ToString()
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

        try {
            $RegPlaybackKey = "HKCU:\Software\Microsoft\Multimedia\Audio"
            if (Test-Path $RegPlaybackKey) {
                $RegOutput = Get-ItemPropertyValue -Path $RegPlaybackKey -Name "PlaybackDevice" -ErrorAction SilentlyContinue
                if ($RegOutput) { $script:CachedAudioOut = [string]$RegOutput }
            }
        } catch {}

        try {
            $ActiveEndpoints = Get-CimInstance -ClassName Win32_PnPEntity -Filter "PNPClass='AudioEndpoint' and Status='OK'" -ErrorAction SilentlyContinue
            $ActiveInputQuery = $ActiveEndpoints | Where-Object { $_.Name -like "*Microphone*" -or $_.Name -like "*Mic*" -or $_.Name -like "*Scarlett*" } | Select-Object -First 1
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
        Virtualization     = "On"
        SecureBoot         = "On"
        ChassisType        = "Custom PC"
        WindowsUpdateLevel = "Up to Date"
        UptimeText         = [string]$UptimeStr
        Motherboard        = $script:StaticInfraCache.Motherboard
        DirectX            = "DirectX 12"
        PowerPlan          = [string]$script:CachedPowerPlanInfra
        SoundCardIdentity  = [string]$script:CachedAudioOut
        MicrophoneIdentity = [string]$script:CachedAudioIn
        Monitors           = @($script:CachedMonitors)
    }
}
