# File: modules/tabs/BatteryPeripheralsManager.ps1
# =========================================================================
# COREWATCH BATTERY HEALTH & WIRELESS PERIPHERAL POWER MONITOR
#   - Laptop/UPS Battery: Win32_Battery + root\WMI BatteryStaticData /
#     BatteryFullChargedCapacity / BatteryCycleCount / powercfg reports
#   - Wireless Peripherals: PnP DEVPKEY_Bluetooth_Battery
#     ({104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2) for BT mice, keyboards,
#     headsets, earbuds, and controllers.
# =========================================================================

function Get-InternalBatteryDiagnostics {
    $batteries = New-Object System.Collections.Generic.List[object]
    $w32Bats = @(Get-CimInstance -ClassName Win32_Battery -ErrorAction SilentlyContinue)
    $staticList = @(Get-CimInstance -Namespace root\WMI -ClassName BatteryStaticData -ErrorAction SilentlyContinue)
    $fullList   = @(Get-CimInstance -Namespace root\WMI -ClassName BatteryFullChargedCapacity -ErrorAction SilentlyContinue)
    $cycleList  = @(Get-CimInstance -Namespace root\WMI -ClassName BatteryCycleCount -ErrorAction SilentlyContinue)
    $statusList = @(Get-CimInstance -Namespace root\WMI -ClassName BatteryStatus -ErrorAction SilentlyContinue)

    for ($i = 0; $i -lt $w32Bats.Count; $i++) {
        $b = $w32Bats[$i]
        $st = if ($i -lt $staticList.Count) { $staticList[$i] } else { $null }
        $fc = if ($i -lt $fullList.Count)   { $fullList[$i] }   else { $null }
        $cy = if ($i -lt $cycleList.Count)  { $cycleList[$i] }  else { $null }
        $bs = if ($i -lt $statusList.Count) { $statusList[$i] } else { $null }

        $designMwh = if ($st -and $st.DesignedCapacity) { [int]$st.DesignedCapacity } elseif ($b.DesignCapacity) { [int]$b.DesignCapacity } else { 0 }
        $fullMwh   = if ($fc -and $fc.FullChargedCapacity) { [int]$fc.FullChargedCapacity } else { 0 }
        $healthPct = if ($designMwh -gt 0 -and $fullMwh -gt 0) { [math]::Round([math]::Min(100, ($fullMwh / $designMwh) * 100), 1) } else { 0 }
        $wearPct   = if ($healthPct -gt 0) { [math]::Round([math]::Max(0, 100 - $healthPct), 1) } else { 0 }
        $cycles    = if ($cy -and $null -ne $cy.CycleCount) { [int]$cy.CycleCount } else { -1 }

        $chargePct = if ($null -ne $b.EstimatedChargeRemaining) { [int]$b.EstimatedChargeRemaining } else { 0 }
        $runMin    = if ($b.EstimatedRunTime -and [uint32]$b.EstimatedRunTime -lt 700000) { [int]$b.EstimatedRunTime } else { -1 }
        $isCharging = ($b.BatteryStatus -in @(2, 6, 7, 8, 9)) -or ($bs -and $bs.Charging)
        $isOnAc     = ($b.BatteryStatus -eq 2) -or ($bs -and $bs.PowerOnline)
        $rateMw     = 0
        if ($bs) {
            if ($bs.ChargeRate -gt 0) { $rateMw = [int]$bs.ChargeRate }
            elseif ($bs.DischargeRate -gt 0) { $rateMw = -([int]$bs.DischargeRate) }
        }
        $chemMap = @{ 1="Other"; 2="Unknown"; 3="Lead Acid"; 4="NiCd"; 5="NiMH"; 6="Li-Ion"; 7="Zinc Air"; 8="Li-Poly" }
        $chemStr = if ($b.Chemistry -and $chemMap.ContainsKey([int]$b.Chemistry)) { $chemMap[[int]$b.Chemistry] } else { "Li-Ion" }

        $stateLbl = if ($isCharging) { "Charging" } elseif ($isOnAc) { "Plugged In (Full / Idle)" } else { "On Battery" }
        $batteries.Add([PSCustomObject]@{
            name         = if ($b.Name) { [string]$b.Name } else { "Internal Battery #$($i+1)" }
            chemistry    = $chemStr
            chargePct    = $chargePct
            state        = $stateLbl
            isCharging   = [bool]$isCharging
            isOnAc       = [bool]$isOnAc
            designMwh    = $designMwh
            fullMwh      = $fullMwh
            healthPct    = $healthPct
            wearPct      = $wearPct
            cycleCount   = $cycles
            rateMw       = $rateMw
            estMinutes   = $runMin
        })
    }
    return $batteries.ToArray()
}

function Get-WirelessPeripheralBatteries {
    $peripherals = New-Object System.Collections.Generic.List[object]
    $seenNames = @{}
    try {
        $btDevs = @(Get-PnpDevice -Class Bluetooth, HIDClass, AudioEndpoint, Media -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -match '^BTHENUM\\|^BTHLE|^BTH\\' })
        foreach ($dev in $btDevs) {
            try {
                $prop = Get-PnpDeviceProperty -InstanceId $dev.InstanceId -KeyName '{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2' -ErrorAction SilentlyContinue
                if ($prop -and $null -ne $prop.Data) {
                    $pct = [int]$prop.Data
                    if ($pct -ge 0 -and $pct -le 100) {
                        $fname = ([string]($dev.FriendlyName ?? $dev.Name ?? "Bluetooth Device")).Trim()
                        $cleanName = ($fname -replace '\s+(Hands-Free|Stereo|Avrcp Transport|HID).*$','').Trim()
                        if (-not $cleanName) { $cleanName = $fname }
                        if ($seenNames.ContainsKey($cleanName.ToLowerInvariant())) { continue }
                        $seenNames[$cleanName.ToLowerInvariant()] = $true

                        $kind = "Peripheral"
                        if ($cleanName -match '(?i)mouse|g pro|mx master|viper|deathadder|basilisk|superlight') { $kind = "Mouse" }
                        elseif ($cleanName -match '(?i)keyb|keychron|mx keys|k\d{3}') { $kind = "Keyboard" }
                        elseif ($cleanName -match '(?i)head|buds|airpods|wh-|wf-|arctis|bose|jabra|sony|audio|speaker') { $kind = "Audio" }
                        elseif ($cleanName -match '(?i)xbox|dualsense|dualshock|controller|gamepad|pro controller') { $kind = "Controller" }

                        $peripherals.Add([PSCustomObject]@{
                            name       = $cleanName
                            kind       = $kind
                            batteryPct = $pct
                            status     = [string]$dev.Status
                            lowBattery = ($pct -le 20)
                            instanceId = [string]$dev.InstanceId
                        })
                    }
                }
            } catch {}
        }
    } catch {}
    return ($peripherals.ToArray() | Sort-Object batteryPct)
}

function Get-BatteryPeripheralsState {
    param([string]$Notice = "", [bool]$NoticeError = $false)
    $bats  = @(Get-InternalBatteryDiagnostics)
    $peris = @(Get-WirelessPeripheralBatteries)
    $lowCnt = (@($peris | Where-Object { $_.lowBattery })).Count

    $powerScheme = ""
    try {
        $rawP = (& powercfg /getactivescheme 2>$null | Out-String).Trim()
        if ($rawP -match '\(([^)]+)\)') { $powerScheme = $Matches[1] }
    } catch {}

    return [ordered]@{
        type              = "BATTERY_PERIPHERALS_STATE"
        hasInternalBattery = ($bats.Count -gt 0)
        batteries         = $bats
        peripherals       = $peris
        lowPeripheralCount = $lowCnt
        activePowerPlan   = $powerScheme
        scannedAt         = (Get-Date).ToString("HH:mm:ss")
        notice            = $Notice
        noticeError       = $NoticeError
    }
}

function Invoke-BatteryPeripheralsAction {
    param(
        [Parameter(Mandatory)][string]$RawJson,
        [Parameter(Mandatory)][string]$RootPath
    )
    $payload = $RawJson | ConvertFrom-Json -AsHashtable
    $cmd = [string]$payload["command"]
    try {
        switch ($cmd) {
            "BATTERY_LOAD" {
                return (Get-BatteryPeripheralsState)
            }
            "BATTERY_OPEN_REPORT" {
                $outHtml = Join-Path $env:TEMP "CoreWatch_BatteryReport_$(Get-Date -Format 'yyyyMMdd_HHmmss').html"
                $null = & powercfg /batteryreport /output "$outHtml" 2>&1
                if (Test-Path -LiteralPath $outHtml -PathType Leaf) {
                    Start-Process $outHtml
                    return @{ type = "BATTERY_NOTICE"; ok = $true; message = "Generated and opened Windows Battery Report ($outHtml)." }
                }
                throw "Windows could not generate a Battery Report (typical on desktop PCs without an internal battery)."
            }
            "BATTERY_OPEN_SLEEPSTUDY" {
                $outHtml = Join-Path $env:TEMP "CoreWatch_SleepStudy_$(Get-Date -Format 'yyyyMMdd_HHmmss').html"
                $null = & powercfg /sleepstudy /output "$outHtml" 2>&1
                if (Test-Path -LiteralPath $outHtml -PathType Leaf) {
                    Start-Process $outHtml
                    return @{ type = "BATTERY_NOTICE"; ok = $true; message = "Generated and opened Windows Modern Standby SleepStudy ($outHtml)." }
                }
                throw "Windows SleepStudy requires a Modern Standby (S0 Low Power Idle) capable system."
            }
            default { throw "Unknown Battery & Peripherals command: $cmd" }
        }
    } catch {
        return @{ type = "BATTERY_NOTICE"; ok = $false; error = $_.Exception.Message }
    }
}
