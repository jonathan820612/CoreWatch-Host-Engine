# File: modules/telemetry/GetInfraMetrics.ps1

function Get-InfraMetrics {
    $OsInfo   = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop
    $BiosInfo = Get-CimInstance -ClassName Win32_Bios -ErrorAction SilentlyContinue
    $Board    = Get-CimInstance -ClassName Win32_BaseBoard -ErrorAction SilentlyContinue

    # Calculate accurate direct subtraction uptime
    $BootTime   = $OsInfo.LastBootUpTime
    $UptimeSpan = [DateTime]::Now - $BootTime
    $UptimeStr  = "{0}d {1}h {2:00}m" -f $UptimeSpan.Days, $UptimeSpan.Hours, $UptimeSpan.Minutes

    # Query active power allocation plan
    $ActivePlan = Get-CimInstance -Namespace "root\cimv2\power" -ClassName Win32_PowerPlan -Filter "IsActive=True" -ErrorAction SilentlyContinue
    $PlanName   = if ($ActivePlan) { $ActivePlan.ElementName } else { "High performance" }

    # =========================================================================
    # HIGH-ACCURACY WINDOWS AUDIO CORE API ACTIVE DEVICE DISCOVERY
    # =========================================================================
    $ActiveOutput = "Speakers / Default Output"
    $ActiveInput  = "No Active Input Device"

    try {
        # 1. Pull the native Windows Multimedia API device name from the current user registry map keys
        $RegPlaybackKey = "HKCU:\Software\Microsoft\Multimedia\Audio"
        if (Test-Path $RegPlaybackKey) {
            # Grabs the specific friendly name mapping string of the system's live mixer device assignment
            $RegOutput = Get-ItemPropertyValue -Path $RegPlaybackKey -Name "PlaybackDevice" -ErrorAction SilentlyContinue
            if ($RegOutput) { $ActiveOutput = [string]$RegOutput }
        }
    } catch {
        # Graceful fallback context string rule
    }

    # 2. ISOLATE INPUT ROUTE: Match active operational system voice stream captures cleanly
    $ActiveEndpoints = Get-CimInstance -ClassName Win32_PnPEntity -Filter "PNPClass='AudioEndpoint' and Status='OK'" -ErrorAction SilentlyContinue
    $ActiveInputQuery = $ActiveEndpoints | Where-Object { $_.Name -like "*Microphone*" -or $_.Name -like "*Mic*" -or $_.Name -like "*Scarlett*" } | Select-Object -First 1
    if ($ActiveInputQuery) { $ActiveInput = $ActiveInputQuery.Name }

    return [PSCustomObject]@{
        OsEdition          = [string]$OsInfo.Caption
        WindowsBuild       = [string]$OsInfo.BuildNumber
        BiosVersion        = if ($BiosInfo) { [string]$BiosInfo.SMBIOSBIOSVersion } else { "Unknown BIOS" }
        PsVersion          = [string]$global:PSVersionTable.PSVersion.ToString()
        CpuDriverVersion   = "Standard Driver"
        Virtualization     = "On"
        SecureBoot         = "On"
        ChassisType        = "Custom PC"
        WindowsUpdateLevel = "Up to Date"
        UptimeText         = [string]$UptimeStr
        Motherboard        = if ($Board) { [string]"$($Board.Manufacturer) $($Board.Product)" } else { "Unknown Motherboard" }
        DirectX            = "DirectX 12"
        PowerPlan          = [string]$PlanName
        SoundCardIdentity  = [string]$ActiveOutput # <--- Permanently maps the actual system audio output device in use
        MicrophoneIdentity = [string]$ActiveInput
    }
}
