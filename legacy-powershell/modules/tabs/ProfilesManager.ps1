# File: modules/tabs/ProfilesManager.ps1
# =========================================================================
# COREWATCH SYSTEM PROFILES & MODES ENGINE (v1 — CORE SYSTEM & DISPLAY)
#   - Persistence: %LOCALAPPDATA%\CoreWatch\profiles.json
#   - Controls:
#       * Windows Do Not Disturb / Focus Assist (WNF Quiet Hours native API)
#       * Windows Power Plan (Balanced / High Performance / Power Saver / Ultimate)
#       * Keep Screen Awake (Win32 SetThreadExecutionState on host UI thread)
#       * Windows Night Light (+ Warmth % via GetDisplayMetrics CloudStore)
#       * Per-Monitor Display Overrides (Primary / All / Specific: HDR, Hz, Scale %)
#   - Safety: Captures 'Before Profile' baseline snapshot for 1-click Revert
#   - Extensibility: Schema reserves optional 'audio' & 'apps' slots for v2
# =========================================================================

if (-not ("CoreWatch.ProfileNative" -as [type])) {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

namespace CoreWatch {
    public static class ProfileNative {
        public const uint ES_CONTINUOUS       = 0x80000000;
        public const uint ES_SYSTEM_REQUIRED  = 0x00000001;
        public const uint ES_DISPLAY_REQUIRED = 0x00000002;

        // WNF_SHEL_QUIETHOURS_ACTIVE_PROFILE_CHANGED (Win10 1803+ / Win11 DnD & Focus Assist)
        // Values: 0 = Off, 1 = Priority Only, 2 = Alarms Only
        private static readonly ulong WNF_SHEL_QUIETHOURS_ACTIVE_PROFILE_CHANGED = 0x0D83063EA3BF1C75UL;

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern uint SetThreadExecutionState(uint esFlags);

        [DllImport("ntdll.dll")]
        private static extern int NtQueryWnfStateData(
            ref ulong StateName,
            IntPtr TypeId,
            IntPtr ExplicitScope,
            out uint ChangeStamp,
            byte[] Buffer,
            ref uint BufferSize
        );

        [DllImport("ntdll.dll")]
        private static extern int NtUpdateWnfStateData(
            ref ulong StateName,
            byte[] Buffer,
            uint Length,
            IntPtr TypeId,
            IntPtr ExplicitScope,
            uint MatchingChangeStamp,
            uint CheckStamp
        );

        public static bool SetKeepAwake(bool enable) {
            uint flags = enable
                ? (ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED)
                : ES_CONTINUOUS;
            return SetThreadExecutionState(flags) != 0;
        }

        public static int GetQuietHoursMode() {
            try {
                ulong stateName = WNF_SHEL_QUIETHOURS_ACTIVE_PROFILE_CHANGED;
                uint stamp = 0;
                byte[] buf = new byte[16];
                uint len = (uint)buf.Length;
                int status = NtQueryWnfStateData(ref stateName, IntPtr.Zero, IntPtr.Zero, out stamp, buf, ref len);
                if (status == 0 && len >= 4) {
                    int val = BitConverter.ToInt32(buf, 0);
                    if (val >= 0 && val <= 2) return val;
                }
            } catch { }
            return 0;
        }

        public static bool SetQuietHoursMode(int mode) {
            if (mode < 0 || mode > 2) return false;
            try {
                ulong stateName = WNF_SHEL_QUIETHOURS_ACTIVE_PROFILE_CHANGED;
                byte[] buf = BitConverter.GetBytes(mode);
                int status = NtUpdateWnfStateData(ref stateName, buf, (uint)buf.Length, IntPtr.Zero, IntPtr.Zero, 0, 0);
                return status == 0;
            } catch {
                return false;
            }
        }
    }
}
"@ -ErrorAction SilentlyContinue
}

function Get-CoreWatchProfilesStorePath {
    $dir = Join-Path $env:LOCALAPPDATA "CoreWatch"
    if (-not (Test-Path -LiteralPath $dir)) { $null = New-Item -ItemType Directory -Path $dir -Force }
    return (Join-Path $dir "profiles.json")
}

function Get-BuiltInProfilePresets {
    return @(
        [ordered]@{
            id          = "normal"
            name        = "Normal / Default"
            icon        = "🖥️"
            accent      = "#4299e1"
            description = "Balanced everyday desktop posture with notifications enabled and normal sleep timers."
            isBuiltIn   = $true
            settings    = [ordered]@{
                powerPlan          = "balanced"       # unchanged | balanced | high_performance | power_saver | ultimate
                dndMode            = "off"            # unchanged | off | priority | alarms
                keepAwake          = "off"            # unchanged | on | off
                nightLight         = "off"            # unchanged | on | off
                nightLightStrength = -1               # -1 = unchanged, 0..100
                displays           = @()
            }
        },
        [ordered]@{
            id          = "work"
            name        = "Work / Focus"
            icon        = "💼"
            accent      = "#38b2ac"
            description = "Balanced power with Windows Do Not Disturb (Priority Only) to cut distractions."
            isBuiltIn   = $true
            settings    = [ordered]@{
                powerPlan          = "balanced"
                dndMode            = "priority"
                keepAwake          = "off"
                nightLight         = "unchanged"
                nightLightStrength = -1
                displays           = @()
            }
        },
        [ordered]@{
            id          = "gaming"
            name        = "Gaming"
            icon        = "🎮"
            accent      = "#9f7aea"
            description = "High Performance power, Alarms Only DnD, Keep Awake, Night Light Off, and Primary monitor at max Hz."
            isBuiltIn   = $true
            settings    = [ordered]@{
                powerPlan          = "high_performance"
                dndMode            = "alarms"
                keepAwake          = "on"
                nightLight         = "off"
                nightLightStrength = -1
                displays           = @(
                    [ordered]@{
                        target       = "primary"      # primary | all | device name (\\.\DISPLAY1)
                        friendlyName = "Primary Monitor"
                        hdr          = "unchanged"    # unchanged | on | off
                        refreshMode  = "max"          # unchanged | max | exact
                        refreshHz    = 0
                        scalePct     = 0              # 0 = unchanged
                    }
                )
            }
        },
        [ordered]@{
            id          = "presentation"
            name        = "Presentation / Streaming"
            icon        = "🎙️"
            accent      = "#ed8936"
            description = "Silences notifications (Alarms Only), keeps the screen awake, disables Night Light, and boosts performance."
            isBuiltIn   = $true
            settings    = [ordered]@{
                powerPlan          = "high_performance"
                dndMode            = "alarms"
                keepAwake          = "on"
                nightLight         = "off"
                nightLightStrength = -1
                displays           = @()
            }
        },
        [ordered]@{
            id          = "night"
            name        = "Night / Quiet"
            icon        = "🌙"
            accent      = "#667eea"
            description = "Enables warm Night Light (50%), Priority Only DnD, and quiet balanced power for late-night use."
            isBuiltIn   = $true
            settings    = [ordered]@{
                powerPlan          = "balanced"
                dndMode            = "priority"
                keepAwake          = "off"
                nightLight         = "on"
                nightLightStrength = 50
                displays           = @()
            }
        }
    )
}

function Convert-DndCodeToName {
    param([int]$Code)
    switch ($Code) {
        1 { return "priority" }
        2 { return "alarms" }
        default { return "off" }
    }
}

function Convert-DndNameToCode {
    param([string]$Name)
    switch (([string]$Name).ToLowerInvariant()) {
        "priority" { return 1 }
        "alarms"   { return 2 }
        default    { return 0 }
    }
}

function Get-ActivePowerPlanInfo {
    $guid = ""
    $name = "Balanced"
    try {
        $out = (& powercfg /getactivescheme 2>$null | Out-String).Trim()
        if ($out -match '([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\s*\((.+)\)') {
            $guid = $Matches[1].ToLowerInvariant()
            $name = $Matches[2].Trim()
        }
    } catch {}

    $key = switch -Regex ($name) {
        'Ultimate' { 'ultimate' }
        'High'     { 'high_performance' }
        'Saver'    { 'power_saver' }
        default    { 'balanced' }
    }
    return @{ guid = $guid; name = $name; key = $key }
}

function Set-ProfilePowerPlan {
    param(
        [string]$PlanKey,
        [string]$ExactGuid = ""
    )
    if ($ExactGuid -and $ExactGuid -match '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$') {
        $null = & powercfg /setactive $ExactGuid 2>$null
        return ($LASTEXITCODE -eq 0)
    }

    $targetGuid = switch (([string]$PlanKey).ToLowerInvariant()) {
        "balanced"         { "381b4222-f694-41f0-9685-ff5bb260df2e" }
        "high_performance" { "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c" }
        "power_saver"      { "a1841308-3541-4fab-bc81-f71556f20b4a" }
        "ultimate"         { "e9a42b02-d5df-448d-aa00-03f14749eb61" }
        default            { "" }
    }
    if (-not $targetGuid) { return $false }

    $allPlans = @(& powercfg /l 2>$null)
    if ($PlanKey -eq "ultimate") {
        $existing = $allPlans | Select-String "Ultimate Performance" | Select-Object -First 1
        if ($existing -and $existing.ToString() -match '([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})') {
            $targetGuid = $Matches[1]
        } else {
            $dup = (& powercfg -duplicatescheme e9a42b02-d5df-448d-aa00-03f14749eb61 2>$null | Out-String)
            if ($dup -match '([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})') {
                $targetGuid = $Matches[1]
            }
        }
    } elseif ($PlanKey -eq "high_performance") {
        # Some Modern Standby systems hide High Performance; fall back to Ultimate or duplicate High Perf if missing
        $hasHigh = $allPlans | Select-String $targetGuid
        if (-not $hasHigh) {
            $dup = (& powercfg -duplicatescheme 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c 2>$null | Out-String)
            if ($dup -match '([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})') {
                $targetGuid = $Matches[1]
            }
        }
    }

    $null = & powercfg /setactive $targetGuid 2>$null
    return ($LASTEXITCODE -eq 0)
}

function ConvertTo-NormalizedProfile {
    param([System.Collections.IDictionary]$Raw)
    if ($null -eq $Raw) { return $null }
    $id = ([string]($Raw["id"] ?? "")).Trim()
    if (-not $id) { $id = "custom-" + ([guid]::NewGuid().ToString("N").Substring(0, 8)) }
    $name = ([string]($Raw["name"] ?? "Custom Profile")).Trim()
    if (-not $name) { $name = "Custom Profile" }
    $icon = ([string]($Raw["icon"] ?? "⚡")).Trim()
    if (-not $icon) { $icon = "⚡" }
    $accent = ([string]($Raw["accent"] ?? "#4299e1")).Trim()
    if ($accent -notmatch '^#[0-9a-fA-F]{6}$') { $accent = "#4299e1" }
    $desc = ([string]($Raw["description"] ?? "")).Trim()

    $s = if ($Raw["settings"] -is [System.Collections.IDictionary]) { $Raw["settings"] } else { @{} }
    $pp = ([string]($s["powerPlan"] ?? "unchanged")).ToLowerInvariant()
    if ($pp -notin @("unchanged", "balanced", "high_performance", "power_saver", "ultimate")) { $pp = "unchanged" }
    $dnd = ([string]($s["dndMode"] ?? "unchanged")).ToLowerInvariant()
    if ($dnd -notin @("unchanged", "off", "priority", "alarms")) { $dnd = "unchanged" }
    $ka = ([string]($s["keepAwake"] ?? "unchanged")).ToLowerInvariant()
    if ($ka -notin @("unchanged", "on", "off")) { $ka = "unchanged" }
    $nl = ([string]($s["nightLight"] ?? "unchanged")).ToLowerInvariant()
    if ($nl -notin @("unchanged", "on", "off")) { $nl = "unchanged" }
    $nlStr = if ($null -ne $s["nightLightStrength"]) { [int]$s["nightLightStrength"] } else { -1 }
    if ($nlStr -lt -1) { $nlStr = -1 } elseif ($nlStr -gt 100) { $nlStr = 100 }

    $dispList = New-Object System.Collections.Generic.List[object]
    foreach ($d in @($s["displays"])) {
        if (-not ($d -is [System.Collections.IDictionary])) { continue }
        $tgt = ([string]($d["target"] ?? "")).Trim()
        if (-not $tgt) { continue }
        $hdr = ([string]($d["hdr"] ?? "unchanged")).ToLowerInvariant()
        if ($hdr -notin @("unchanged", "on", "off")) { $hdr = "unchanged" }
        $rm  = ([string]($d["refreshMode"] ?? "unchanged")).ToLowerInvariant()
        if ($rm -notin @("unchanged", "max", "exact")) { $rm = "unchanged" }
        $hz  = if ($null -ne $d["refreshHz"]) { [int]$d["refreshHz"] } else { 0 }
        $sc  = if ($null -ne $d["scalePct"]) { [int]$d["scalePct"] } else { 0 }
        $dispList.Add([ordered]@{
            target       = $tgt
            friendlyName = ([string]($d["friendlyName"] ?? $tgt)).Trim()
            hdr          = $hdr
            refreshMode  = $rm
            refreshHz    = $hz
            scalePct     = $sc
        })
    }

    return [ordered]@{
        id          = $id
        name        = $name
        icon        = $icon
        accent      = $accent
        description = $desc
        isBuiltIn   = [bool]($Raw["isBuiltIn"] -eq $true)
        settings    = [ordered]@{
            powerPlan          = $pp
            dndMode            = $dnd
            keepAwake          = $ka
            nightLight         = $nl
            nightLightStrength = $nlStr
            displays           = $dispList.ToArray()
        }
    }
}

function Get-CoreWatchProfilesStore {
    $path = Get-CoreWatchProfilesStorePath
    $builtIns = Get-BuiltInProfilePresets
    $store = $null

    if (Test-Path -LiteralPath $path -PathType Leaf) {
        try {
            $txt = Get-Content -LiteralPath $path -Raw -ErrorAction Stop
            if ($txt -and $txt.Trim()) {
                $store = $txt | ConvertFrom-Json -AsHashtable
            }
        } catch {}
    }

    if (-not ($store -is [System.Collections.IDictionary]) -or -not $store.Contains("profiles")) {
        $store = [ordered]@{
            schemaVersion    = 1
            activeProfileId  = "normal"
            keepAwakeActive  = $false
            baselineSnapshot = $null
            profiles         = @($builtIns)
        }
        Save-CoreWatchProfilesStore -Store $store
        return $store
    }

    $normalizedList = New-Object System.Collections.Generic.List[object]
    $seenIds = New-Object System.Collections.Generic.HashSet[string] ([System.StringComparer]::OrdinalIgnoreCase)
    foreach ($p in @($store["profiles"])) {
        $norm = ConvertTo-NormalizedProfile -Raw $p
        if ($norm -and $seenIds.Add($norm.id)) {
            $normalizedList.Add($norm)
        }
    }
    # Ensure all 5 built-in presets exist even if upgrading from an older store
    foreach ($bp in $builtIns) {
        if (-not $seenIds.Contains($bp.id)) {
            $normalizedList.Add($bp)
        }
    }

    $store["schemaVersion"] = 1
    $store["profiles"] = $normalizedList.ToArray()
    if (-not $store.Contains("activeProfileId")) { $store["activeProfileId"] = "normal" }
    if (-not $store.Contains("keepAwakeActive")) { $store["keepAwakeActive"] = $false }
    if (-not $store.Contains("baselineSnapshot")) { $store["baselineSnapshot"] = $null }
    return $store
}

function Save-CoreWatchProfilesStore {
    param([Parameter(Mandatory)][System.Collections.IDictionary]$Store)
    $path = Get-CoreWatchProfilesStorePath
    $json = $Store | ConvertTo-Json -Depth 10
    [System.IO.File]::WriteAllText($path, $json, (New-Object System.Text.UTF8Encoding($false)))
}

function Get-LiveSystemProfileSnapshot {
    param(
        [Parameter(Mandatory)][string]$RootPath,
        [bool]$KeepAwakeActive = $false
    )
    . (Join-Path $RootPath "modules\telemetry\GetDisplayMetrics.ps1")

    $planInfo = Get-ActivePowerPlanInfo
    $dndCode  = [CoreWatch.ProfileNative]::GetQuietHoursMode()
    $dndName  = Convert-DndCodeToName -Code $dndCode
    $nlState  = Get-NightLightStatus
    $nlMode   = if ($nlState -eq "On") { "on" } else { "off" }
    $nlStr    = Get-NightLightStrength
    $mons     = @(Get-DisplayMetrics)

    $monSnaps = New-Object System.Collections.Generic.List[object]
    foreach ($m in $mons) {
        $monSnaps.Add([ordered]@{
            deviceName            = [string]$m.Id
            friendlyName          = [string]$m.FriendlyName
            isPrimary             = [bool]$m.IsPrimary
            displayNumber         = [int]$m.DisplayNumber
            resolution            = [string]$m.Resolution
            hdrStatus             = [string]$m.HdrStatus
            hdrOn                 = ($m.HdrStatus -eq "On")
            hdrSupported          = ($m.HdrStatus -eq "On" -or $m.HdrStatus -like "Off*")
            refreshRateHz         = [int]$m.RefreshRateHz
            availableRefreshRates = @($m.AvailableRefreshRates)
            scalePct              = [int]$m.ScalePct
            availableScales       = @($m.AvailableScales)
        })
    }

    return [ordered]@{
        capturedUtc        = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        powerPlanGuid      = [string]$planInfo.guid
        powerPlanName      = [string]$planInfo.name
        powerPlanKey       = [string]$planInfo.key
        dndMode            = $dndName
        keepAwake          = [bool]$KeepAwakeActive
        nightLight         = $nlMode
        nightLightStrength = [int]$nlStr.StrengthPct
        monitors           = $monSnaps.ToArray()
    }
}

function Get-ProfilesManagerState {
    param(
        [Parameter(Mandatory)][string]$RootPath,
        [bool]$KeepAwakeActive = $false,
        [string]$Notice = "",
        [bool]$NoticeError = $false
    )
    $store = Get-CoreWatchProfilesStore
    $store["keepAwakeActive"] = [bool]$KeepAwakeActive
    $live = Get-LiveSystemProfileSnapshot -RootPath $RootPath -KeepAwakeActive $KeepAwakeActive
    $baseCap = if ($store["baselineSnapshot"] -and $store["baselineSnapshot"]["capturedUtc"]) { [string]$store["baselineSnapshot"]["capturedUtc"] } else { "" }

    return [ordered]@{
        type             = "PROFILES_STATE"
        activeProfileId  = [string]$store["activeProfileId"]
        keepAwakeActive  = [bool]$KeepAwakeActive
        hasBaseline      = ($null -ne $store["baselineSnapshot"])
        baselineCaptured = $baseCap
        profiles         = @($store["profiles"])
        liveState        = $live
        notice           = $Notice
        noticeError      = $NoticeError
    }
}

function Invoke-ApplySystemProfile {
    param(
        [Parameter(Mandatory)][string]$ProfileId,
        [Parameter(Mandatory)][string]$RootPath,
        [bool]$CurrentKeepAwake = $false
    )
    . (Join-Path $RootPath "modules\telemetry\GetDisplayMetrics.ps1")

    $store = Get-CoreWatchProfilesStore
    $targetProfile = @($store["profiles"]) | Where-Object { $_.id -eq $ProfileId } | Select-Object -First 1
    if (-not $targetProfile) { throw "Profile '$ProfileId' not found." }

    # Capture 'Before Profile' baseline snapshot if none exists yet (or when leaving Normal for another mode)
    if ($null -eq $store["baselineSnapshot"] -or $store["activeProfileId"] -eq "normal") {
        if ($ProfileId -ne "normal") {
            $store["baselineSnapshot"] = Get-LiveSystemProfileSnapshot -RootPath $RootPath -KeepAwakeActive $CurrentKeepAwake
        }
    }

    $s = $targetProfile["settings"]
    $applied = New-Object System.Collections.Generic.List[string]
    $warnings = New-Object System.Collections.Generic.List[string]
    $nextKeepAwake = $CurrentKeepAwake

    # 1. Power Plan
    if ($s["powerPlan"] -and $s["powerPlan"] -ne "unchanged") {
        if (Set-ProfilePowerPlan -PlanKey $s["powerPlan"]) {
            $applied.Add("Power=$($s['powerPlan'])")
        } else {
            $warnings.Add("Power plan '$($s['powerPlan'])' unavailable")
        }
    }

    # 2. Windows Do Not Disturb / Focus Assist
    if ($s["dndMode"] -and $s["dndMode"] -ne "unchanged") {
        $code = Convert-DndNameToCode -Name $s["dndMode"]
        if ([CoreWatch.ProfileNative]::SetQuietHoursMode($code)) {
            $applied.Add("DnD=$($s['dndMode'])")
        } else {
            $warnings.Add("DnD WNF update rejected")
        }
    }

    # 3. Keep Screen Awake (returned for main UI thread SetThreadExecutionState)
    if ($s["keepAwake"] -eq "on") {
        $nextKeepAwake = $true
        $applied.Add("KeepAwake=On")
    } elseif ($s["keepAwake"] -eq "off") {
        $nextKeepAwake = $false
        $applied.Add("KeepAwake=Off")
    }

    # 4. Windows Night Light & Warmth Strength
    if ($s["nightLight"] -eq "on") {
        try {
            $null = Set-NightLightStatus -Enable $true
            $strVal = [int]($s["nightLightStrength"] ?? -1)
            if ($strVal -ge 0 -and $strVal -le 100) {
                $null = Set-NightLightStrength -StrengthPct $strVal
                $applied.Add("NightLight=On ($strVal%)")
            } else {
                $applied.Add("NightLight=On")
            }
        } catch {
            $warnings.Add("Night Light error: $($_.Exception.Message)")
        }
    } elseif ($s["nightLight"] -eq "off") {
        try {
            $null = Set-NightLightStatus -Enable $false
            $applied.Add("NightLight=Off")
        } catch {
            $warnings.Add("Night Light error: $($_.Exception.Message)")
        }
    }

    # 5. Per-Monitor Display Overrides (Primary | All | Individual Monitor by deviceName/friendlyName)
    $dispRules = @($s["displays"])
    if ($dispRules.Count -gt 0) {
        $liveMons = @(Get-DisplayMetrics)
        foreach ($rule in $dispRules) {
            $tgt = [string]$rule["target"]
            $matchedMons = @()
            if ($tgt -eq "all") {
                $matchedMons = $liveMons
            } elseif ($tgt -eq "primary") {
                $matchedMons = @($liveMons | Where-Object { $_.IsPrimary } | Select-Object -First 1)
                if ($matchedMons.Count -eq 0 -and $liveMons.Count -gt 0) { $matchedMons = @($liveMons[0]) }
            } else {
                $matchedMons = @($liveMons | Where-Object { $_.Id -ieq $tgt -or ($rule["friendlyName"] -and $_.FriendlyName -ieq $rule["friendlyName"]) })
            }

            if ($matchedMons.Count -eq 0) { continue } # Gracefully skip disconnected displays

            foreach ($mon in $matchedMons) {
                # HDR override
                $hdrRule = [string]($rule["hdr"] ?? "unchanged")
                if ($hdrRule -in @("on", "off")) {
                    $canHdr = ($mon.HdrStatus -eq "On" -or $mon.HdrStatus -like "Off*")
                    if ($canHdr) {
                        $wantHdr = ($hdrRule -eq "on")
                        if ([CoreWatch.DisplayProbe]::SetHdrState($mon.Id, $wantHdr)) {
                            $applied.Add("$($mon.FriendlyName) HDR=$hdrRule")
                        }
                    }
                }

                # Refresh Rate override (Max available or Exact driver-verified Hz)
                $refMode = [string]($rule["refreshMode"] ?? "unchanged")
                if ($refMode -eq "max" -and $mon.AvailableRefreshRates -and $mon.AvailableRefreshRates.Count -gt 0) {
                    $maxHz = ($mon.AvailableRefreshRates | Measure-Object -Maximum).Maximum
                    if ($maxHz -and [int]$maxHz -ne [int]$mon.RefreshRateHz) {
                        $resHz = [CoreWatch.DisplayProbe]::SetMonitorRefreshRate($mon.Id, [int]$maxHz)
                        if ($resHz -eq "OK") { $applied.Add("$($mon.FriendlyName) ${maxHz}Hz") }
                        else { $warnings.Add("$($mon.FriendlyName) Hz: $resHz") }
                    }
                } elseif ($refMode -eq "exact" -and [int]$rule["refreshHz"] -ge 24) {
                    $wantHz = [int]$rule["refreshHz"]
                    if ($wantHz -ne [int]$mon.RefreshRateHz) {
                        $resHz = [CoreWatch.DisplayProbe]::SetMonitorRefreshRate($mon.Id, $wantHz)
                        if ($resHz -eq "OK") { $applied.Add("$($mon.FriendlyName) ${wantHz}Hz") }
                        else { $warnings.Add("$($mon.FriendlyName) Hz: $resHz") }
                    }
                }

                # Scale % override
                $wantScale = [int]($rule["scalePct"] ?? 0)
                if ($wantScale -ge 100 -and $wantScale -ne [int]$mon.ScalePct) {
                    $resSc = [CoreWatch.DisplayProbe]::SetMonitorScale($mon.Id, $wantScale)
                    if ($resSc -eq "OK") { $applied.Add("$($mon.FriendlyName) ${wantScale}%") }
                    else { $warnings.Add("$($mon.FriendlyName) Scale: $resSc") }
                }
            }
        }
    }

    $store["activeProfileId"] = [string]$targetProfile.id
    $store["keepAwakeActive"] = [bool]$nextKeepAwake
    if ($ProfileId -eq "normal") {
        $store["baselineSnapshot"] = $null
    }
    Save-CoreWatchProfilesStore -Store $store

    $summary = if ($applied.Count -gt 0) { $applied -join " · " } else { "No changes required (already matching)" }
    if ($warnings.Count -gt 0) { $summary += " | Notes: " + ($warnings -join "; ") }

    return @{
        ok              = $true
        keepAwakeActive = [bool]$nextKeepAwake
        activeProfileId = [string]$targetProfile.id
        profileName     = [string]$targetProfile.name
        notice          = "Activated '$($targetProfile.name)': $summary"
    }
}

function Invoke-RevertSystemProfileBaseline {
    param(
        [Parameter(Mandatory)][string]$RootPath,
        [bool]$CurrentKeepAwake = $false
    )
    . (Join-Path $RootPath "modules\telemetry\GetDisplayMetrics.ps1")

    $store = Get-CoreWatchProfilesStore
    $base  = $store["baselineSnapshot"]
    if (-not ($base -is [System.Collections.IDictionary])) {
        throw "No baseline snapshot is currently saved to revert to."
    }

    $restored = New-Object System.Collections.Generic.List[string]
    if ($base["powerPlanGuid"]) {
        if (Set-ProfilePowerPlan -PlanKey $base["powerPlanKey"] -ExactGuid $base["powerPlanGuid"]) {
            $restored.Add("Power=$($base['powerPlanName'])")
        }
    }
    if ($base["dndMode"]) {
        $code = Convert-DndNameToCode -Name $base["dndMode"]
        if ([CoreWatch.ProfileNative]::SetQuietHoursMode($code)) {
            $restored.Add("DnD=$($base['dndMode'])")
        }
    }
    $nextKeepAwake = [bool]($base["keepAwake"] -eq $true)
    $restored.Add("KeepAwake=$(if ($nextKeepAwake) { 'On' } else { 'Off' })")

    if ($base["nightLight"] -eq "on") {
        try {
            $null = Set-NightLightStatus -Enable $true
            if ($null -ne $base["nightLightStrength"] -and [int]$base["nightLightStrength"] -ge 0) {
                $null = Set-NightLightStrength -StrengthPct ([int]$base["nightLightStrength"])
            }
            $restored.Add("NightLight=On")
        } catch {}
    } elseif ($base["nightLight"] -eq "off") {
        try {
            $null = Set-NightLightStatus -Enable $false
            $restored.Add("NightLight=Off")
        } catch {}
    }

    $liveMons = @(Get-DisplayMetrics)
    foreach ($bm in @($base["monitors"])) {
        $cur = $liveMons | Where-Object { $_.Id -ieq $bm["deviceName"] } | Select-Object -First 1
        if (-not $cur) { continue }
        if ($bm["hdrSupported"] -and ($cur.HdrStatus -eq "On") -ne [bool]$bm["hdrOn"]) {
            $null = [CoreWatch.DisplayProbe]::SetHdrState($cur.Id, [bool]$bm["hdrOn"])
            $restored.Add("$($cur.FriendlyName) HDR=$(if ($bm['hdrOn']) { 'On' } else { 'Off' })")
        }
        if ([int]$bm["refreshRateHz"] -ge 24 -and [int]$bm["refreshRateHz"] -ne [int]$cur.RefreshRateHz) {
            $null = [CoreWatch.DisplayProbe]::SetMonitorRefreshRate($cur.Id, [int]$bm["refreshRateHz"])
            $restored.Add("$($cur.FriendlyName) $($bm['refreshRateHz'])Hz")
        }
        if ([int]$bm["scalePct"] -ge 100 -and [int]$bm["scalePct"] -ne [int]$cur.ScalePct) {
            $null = [CoreWatch.DisplayProbe]::SetMonitorScale($cur.Id, [int]$bm["scalePct"])
            $restored.Add("$($cur.FriendlyName) $($bm['scalePct'])%")
        }
    }

    $store["activeProfileId"]  = "normal"
    $store["keepAwakeActive"]  = $nextKeepAwake
    $store["baselineSnapshot"] = $null
    Save-CoreWatchProfilesStore -Store $store

    return @{
        ok              = $true
        keepAwakeActive = $nextKeepAwake
        activeProfileId = "normal"
        notice          = "Reverted to pre-profile baseline: $($restored -join ' · ')"
    }
}

function Save-CustomOrEditedProfile {
    param([Parameter(Mandatory)][System.Collections.IDictionary]$ProfileHash)
    $store = Get-CoreWatchProfilesStore
    $norm  = ConvertTo-NormalizedProfile -Raw $ProfileHash
    if (-not $norm) { throw "Invalid profile payload." }

    $builtInIds = @(Get-BuiltInProfilePresets | ForEach-Object { $_.id })
    $norm["isBuiltIn"] = ($builtInIds -contains $norm.id)

    $list = New-Object System.Collections.Generic.List[object]
    $replaced = $false
    foreach ($p in @($store["profiles"])) {
        if ($p["id"] -eq $norm.id) {
            $list.Add($norm)
            $replaced = $true
        } else {
            $list.Add($p)
        }
    }
    if (-not $replaced) { $list.Add($norm) }
    $store["profiles"] = $list.ToArray()
    Save-CoreWatchProfilesStore -Store $store
    return $norm
}

function Remove-CustomProfile {
    param([Parameter(Mandatory)][string]$ProfileId)
    $builtInIds = @(Get-BuiltInProfilePresets | ForEach-Object { $_.id })
    if ($builtInIds -contains $ProfileId) {
        throw "Built-in presets cannot be deleted (use Reset Preset instead)."
    }
    $store = Get-CoreWatchProfilesStore
    $store["profiles"] = @($store["profiles"] | Where-Object { $_["id"] -ne $ProfileId })
    if ($store["activeProfileId"] -eq $ProfileId) { $store["activeProfileId"] = "normal" }
    Save-CoreWatchProfilesStore -Store $store
}

function Reset-BuiltInProfilePreset {
    param([Parameter(Mandatory)][string]$ProfileId)
    $orig = Get-BuiltInProfilePresets | Where-Object { $_.id -eq $ProfileId } | Select-Object -First 1
    if (-not $orig) { throw "'$ProfileId' is not a built-in preset." }
    $store = Get-CoreWatchProfilesStore
    $list = New-Object System.Collections.Generic.List[object]
    foreach ($p in @($store["profiles"])) {
        if ($p["id"] -eq $ProfileId) { $list.Add($orig) } else { $list.Add($p) }
    }
    $store["profiles"] = @($list)
    Save-CoreWatchProfilesStore -Store $store
    return $orig
}
