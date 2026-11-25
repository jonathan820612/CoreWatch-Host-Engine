# File: modules/tabs/SmartAlertsManager.ps1
# =========================================================================
# COREWATCH SMART ALERTS & WATCHDOG RULES ENGINE
#   - Persistent store: %LOCALAPPDATA%\CoreWatch\alerts.json
#   - Built-in & custom watchdog rules (CPU/GPU temp, low disk %, RAM %,
#     internet drop/recovery, critical Windows service stopped)
#   - Sustained duration tracking + per-rule cooldown
#   - Native Windows Toast notifications (WinRT) with NotifyIcon fallback
# =========================================================================

$script:WatchdogBreachStarts = @{}
$script:WatchdogLastFired    = @{}
$script:WatchdogPrevOnline   = $null

function Get-SmartAlertsStorePath {
    $dir = Join-Path $env:LOCALAPPDATA "CoreWatch"
    if (-not (Test-Path -LiteralPath $dir)) { $null = New-Item -ItemType Directory -Path $dir -Force }
    return (Join-Path $dir "alerts.json")
}

function Get-DefaultSmartAlertRules {
    return @(
        [ordered]@{
            id              = "cpu_temp_high"
            name            = "CPU Overheat Guard"
            enabled         = $true
            metric          = "cpu_temp"
            operator        = "gt"
            threshold       = 85
            target          = ""
            durationSec     = 30
            cooldownMin     = 5
            severity        = "critical"
            action          = "toast"
            actionTarget    = ""
            isBuiltIn       = $true
        },
        [ordered]@{
            id              = "gpu_temp_high"
            name            = "GPU Overheat Guard"
            enabled         = $true
            metric          = "gpu_temp"
            operator        = "gt"
            threshold       = 85
            target          = ""
            durationSec     = 30
            cooldownMin     = 5
            severity        = "critical"
            action          = "toast"
            actionTarget    = ""
            isBuiltIn       = $true
        },
        [ordered]@{
            id              = "drive_low_space"
            name            = "Low Disk Free Space"
            enabled         = $true
            metric          = "drive_free_pct"
            operator        = "lt"
            threshold       = 10
            target          = "ANY"
            durationSec     = 10
            cooldownMin     = 30
            severity        = "warning"
            action          = "toast"
            actionTarget    = ""
            isBuiltIn       = $true
        },
        [ordered]@{
            id              = "ram_pressure"
            name            = "High Memory Pressure"
            enabled         = $false
            metric          = "ram_pct"
            operator        = "gt"
            threshold       = 90
            target          = ""
            durationSec     = 30
            cooldownMin     = 10
            severity        = "warning"
            action          = "toast"
            actionTarget    = ""
            isBuiltIn       = $true
        },
        [ordered]@{
            id              = "net_drop"
            name            = "Internet Drop / Recovery"
            enabled         = $true
            metric          = "internet_status"
            operator        = "eq"
            threshold       = 0
            target          = ""
            durationSec     = 6
            cooldownMin     = 2
            severity        = "warning"
            action          = "toast"
            actionTarget    = ""
            isBuiltIn       = $true
        },
        [ordered]@{
            id              = "svc_stopped"
            name            = "Critical Service Stopped"
            enabled         = $false
            metric          = "service_stopped"
            operator        = "eq"
            threshold       = 1
            target          = "Dhcp,Dnscache,EventLog"
            durationSec     = 10
            cooldownMin     = 10
            severity        = "critical"
            action          = "toast"
            actionTarget    = ""
            isBuiltIn       = $true
        }
    )
}

function ConvertTo-NormalizedAlertRule {
    param([System.Collections.IDictionary]$Raw)
    $rid = ([string]($Raw["id"] ?? "")).Trim()
    if (-not $rid) { $rid = "rule_" + ([guid]::NewGuid().ToString("N").Substring(0, 8)) }
    $rName = ([string]($Raw["name"] ?? "Custom Alert")).Trim()
    if (-not $rName) { $rName = "Custom Alert" }
    $metric = ([string]($Raw["metric"] ?? "cpu_temp")).Trim().ToLowerInvariant()
    if ($metric -notin @("cpu_temp", "gpu_temp", "cpu_load", "ram_pct", "drive_free_pct", "internet_status", "service_stopped")) { $metric = "cpu_temp" }
    $op = ([string]($Raw["operator"] ?? "gt")).Trim().ToLowerInvariant()
    if ($op -notin @("gt", "lt", "eq")) { $op = "gt" }
    $sev = ([string]($Raw["severity"] ?? "warning")).Trim().ToLowerInvariant()
    if ($sev -notin @("info", "warning", "critical")) { $sev = "warning" }
    $act = ([string]($Raw["action"] ?? "toast")).Trim().ToLowerInvariant()
    if ($act -notin @("toast", "log_only", "toast_chime", "restart_service")) { $act = "toast" }

    return [ordered]@{
        id           = $rid
        name         = $rName
        enabled      = [bool]($Raw["enabled"] ?? $true)
        metric       = $metric
        operator     = $op
        threshold    = [double]($Raw["threshold"] ?? 85)
        target       = ([string]($Raw["target"] ?? "")).Trim()
        durationSec  = [math]::Max(0, [math]::Min(3600, [int]($Raw["durationSec"] ?? 15)))
        cooldownMin  = [math]::Max(1, [math]::Min(1440, [int]($Raw["cooldownMin"] ?? 5)))
        severity     = $sev
        action       = $act
        actionTarget = ([string]($Raw["actionTarget"] ?? "")).Trim()
        isBuiltIn    = [bool]($Raw["isBuiltIn"] ?? $false)
    }
}

function Get-SmartAlertsStore {
    $path = Get-SmartAlertsStorePath
    if (Test-Path -LiteralPath $path -PathType Leaf) {
        try {
            $raw = Get-Content -LiteralPath $path -Raw -ErrorAction Stop | ConvertFrom-Json -AsHashtable
            if ($raw -is [System.Collections.IDictionary] -and $raw.ContainsKey("rules")) {
                $rules = New-Object System.Collections.Generic.List[object]
                foreach ($r in @($raw["rules"])) {
                    if ($r -is [System.Collections.IDictionary]) { $rules.Add((ConvertTo-NormalizedAlertRule -Raw $r)) }
                }
                $hist = if ($raw.ContainsKey("history") -and $null -ne $raw["history"]) { @($raw["history"]) } else { @() }
                return [ordered]@{
                    schemaVersion = 1
                    muted         = [bool]($raw["muted"] ?? $false)
                    rules         = $rules.ToArray()
                    history       = @($hist | Select-Object -First 80)
                }
            }
        } catch {}
    }

    $init = [ordered]@{
        schemaVersion = 1
        muted         = $false
        rules         = (Get-DefaultSmartAlertRules)
        history       = @()
    }
    Save-SmartAlertsStore -Store $init
    return $init
}

function Save-SmartAlertsStore {
    param([Parameter(Mandatory)][System.Collections.IDictionary]$Store)
    $path = Get-SmartAlertsStorePath
    [System.IO.File]::WriteAllText($path, ($Store | ConvertTo-Json -Depth 8), (New-Object System.Text.UTF8Encoding($false)))
}

function Send-CoreWatchToastNotification {
    param(
        [Parameter(Mandatory)][string]$Title,
        [Parameter(Mandatory)][string]$Message,
        [string]$Severity = "warning",
        [bool]$PlayChime = $false
    )
    if ($PlayChime) {
        try {
            if ($Severity -eq "critical") { [System.Media.SystemSounds]::Hand.Play() }
            else { [System.Media.SystemSounds]::Exclamation.Play() }
        } catch {}
    }

    # Try native WinRT ToastNotification first (Windows 10/11 Action Center)
    $toastSent = $false
    try {
        $null = [Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
        $null = [Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]
        $escTitle = [System.Security.SecurityElement]::Escape($Title)
        $escBody  = [System.Security.SecurityElement]::Escape($Message)
        $xmlStr = "<toast><visual><binding template='ToastGeneric'><text>$escTitle</text><text>$escBody</text></binding></visual></toast>"
        $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
        $xml.LoadXml($xmlStr)
        $toast = New-Object Windows.UI.Notifications.ToastNotification $xml
        $appId = "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe"
        $notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId)
        $notifier.Show($toast)
        $toastSent = $true
    } catch {}

    # Reliable fallback: CoreWatch System Tray BalloonTip
    if (-not $toastSent -and $null -ne $global:SystemTrayIcon) {
        try {
            $icon = if ($Severity -eq "critical") { [System.Windows.Forms.ToolTipIcon]::Error }
                    elseif ($Severity -eq "warning") { [System.Windows.Forms.ToolTipIcon]::Warning }
                    else { [System.Windows.Forms.ToolTipIcon]::Info }
            $global:SystemTrayIcon.ShowBalloonTip(5000, $Title, $Message, $icon)
            $toastSent = $true
        } catch {}
    }
    return $toastSent
}

function Test-SmartAlertRulesAgainstTelemetry {
    param(
        [Parameter(Mandatory)]$TelemetryObj
    )
    $store = Get-SmartAlertsStore
    if ($store.muted) { return @() }
    $now = [datetime]::Now
    $firedList = New-Object System.Collections.Generic.List[object]

    $sys = $TelemetryObj.SystemFrame
    $net = $TelemetryObj.NetworkFrame
    $sto = $TelemetryObj.StorageFrame

    $cpuTemp = if ($sys -and $null -ne $sys.CpuTempC) { [double]$sys.CpuTempC } else { $null }
    $gpuTemp = if ($sys -and $null -ne $sys.GpuTempC) { [double]$sys.GpuTempC } else { $null }
    $cpuLoad = if ($sys -and $null -ne $sys.CpuLoadPct) { [double]$sys.CpuLoadPct } else { $null }
    $ramPct  = if ($sys -and $sys.RamTotalGB -and [double]$sys.RamTotalGB -gt 0) { [math]::Round(([double]$sys.RamUsedGB / [double]$sys.RamTotalGB) * 100, 1) } else { $null }
    $isOnline = if ($net) { ([string]$net.NetworkStatus -ne "Offline" -and [string]$net.InternalIPv4 -and [string]$net.InternalIPv4 -ne "0.0.0.0") } else { $null }

    foreach ($rule in @($store.rules)) {
        if (-not $rule.enabled) { continue }
        $rid = [string]$rule.id
        $breached = $false
        $detailMsg = ""

        switch ($rule.metric) {
            "cpu_temp" {
                if ($null -ne $cpuTemp -and $cpuTemp -gt 0) {
                    $breached = ($rule.operator -eq "gt" -and $cpuTemp -ge $rule.threshold) -or ($rule.operator -eq "lt" -and $cpuTemp -le $rule.threshold)
                    $detailMsg = "CPU temperature reached $([math]::Round($cpuTemp))°C (threshold: $($rule.threshold)°C)."
                }
            }
            "gpu_temp" {
                if ($null -ne $gpuTemp -and $gpuTemp -gt 0) {
                    $breached = ($rule.operator -eq "gt" -and $gpuTemp -ge $rule.threshold) -or ($rule.operator -eq "lt" -and $gpuTemp -le $rule.threshold)
                    $detailMsg = "GPU temperature reached $([math]::Round($gpuTemp))°C (threshold: $($rule.threshold)°C)."
                }
            }
            "cpu_load" {
                if ($null -ne $cpuLoad) {
                    $breached = ($rule.operator -eq "gt" -and $cpuLoad -ge $rule.threshold)
                    $detailMsg = "CPU utilization sustained at $([math]::Round($cpuLoad))% (threshold: $($rule.threshold)%)."
                }
            }
            "ram_pct" {
                if ($null -ne $ramPct) {
                    $breached = ($rule.operator -eq "gt" -and $ramPct -ge $rule.threshold)
                    $detailMsg = "RAM utilization sustained at $ramPct% (threshold: $($rule.threshold)%)."
                }
            }
            "drive_free_pct" {
                if ($sto) {
                    $drives = @($sto)
                    $tgt = ([string]$rule.target).Trim().ToUpperInvariant()
                    foreach ($d in $drives) {
                        if (-not $d.StorageTotalGB -or [double]$d.StorageTotalGB -le 0) { continue }
                        $ltr = ([string]$d.DriveLetter).Trim().ToUpperInvariant()
                        if ($tgt -and $tgt -ne "ANY" -and $ltr -notlike "$tgt*") { continue }
                        $freePct = [math]::Round((([double]$d.StorageTotalGB - [double]$d.StorageUsedGB) / [double]$d.StorageTotalGB) * 100, 1)
                        if ($freePct -le $rule.threshold) {
                            $breached = $true
                            $detailMsg = "Drive $ltr has only $freePct% free space remaining (threshold: $($rule.threshold)%)."
                            break
                        }
                    }
                }
            }
            "internet_status" {
                if ($null -ne $isOnline) {
                    if ($null -ne $script:WatchdogPrevOnline -and $script:WatchdogPrevOnline -eq $true -and $isOnline -eq $false) {
                        $breached = $true
                        $detailMsg = "Network uplink dropped offline."
                    } elseif ($null -ne $script:WatchdogPrevOnline -and $script:WatchdogPrevOnline -eq $false -and $isOnline -eq $true) {
                        $evtRec = [ordered]@{
                            id           = "evt_" + ([guid]::NewGuid().ToString("N").Substring(0, 8))
                            ruleId       = $rid
                            ruleName     = "$($rule.name) (Recovered)"
                            severity     = "info"
                            message      = "Internet connectivity recovered."
                            timestamp    = $now.ToString("yyyy-MM-dd HH:mm:ss")
                            acknowledged = $false
                        }
                        $firedList.Add($evtRec)
                        if ($rule.action -in @("toast", "toast_chime")) {
                            $null = Send-CoreWatchToastNotification -Title "CoreWatch: Network Recovered" -Message $evtRec.message -Severity "info" -PlayChime ($rule.action -eq "toast_chime")
                        }
                    }
                    $script:WatchdogPrevOnline = $isOnline
                }
            }
            "service_stopped" {
                $svcs = @(([string]$rule.target) -split '[,;]' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
                foreach ($sn in $svcs) {
                    $sObj = Get-Service -Name $sn -ErrorAction SilentlyContinue
                    if ($sObj -and $sObj.Status -ne 'Running') {
                        $breached = $true
                        $detailMsg = "Monitored Windows service '$($sObj.Name)' ($($sObj.DisplayName)) is $($sObj.Status)."
                        if ($rule.action -eq "restart_service") {
                            try {
                                Start-Service -Name $sObj.Name -ErrorAction Stop
                                $detailMsg += " Auto-restarted successfully."
                            } catch {
                                $detailMsg += " Auto-restart failed: $($_.Exception.Message)"
                            }
                        }
                        break
                    }
                }
            }
        }

        if ($breached) {
            if (-not $script:WatchdogBreachStarts.ContainsKey($rid)) {
                $script:WatchdogBreachStarts[$rid] = $now
            }
            $elapsedSec = ($now - $script:WatchdogBreachStarts[$rid]).TotalSeconds
            if ($elapsedSec -ge [double]$rule.durationSec) {
                $lastFire = if ($script:WatchdogLastFired.ContainsKey($rid)) { $script:WatchdogLastFired[$rid] } else { [datetime]::MinValue }
                if (($now - $lastFire).TotalMinutes -ge [double]$rule.cooldownMin) {
                    $script:WatchdogLastFired[$rid] = $now
                    $evt = [ordered]@{
                        id           = "evt_" + ([guid]::NewGuid().ToString("N").Substring(0, 8))
                        ruleId       = $rid
                        ruleName     = [string]$rule.name
                        severity     = [string]$rule.severity
                        message      = $detailMsg
                        timestamp    = $now.ToString("yyyy-MM-dd HH:mm:ss")
                        acknowledged = $false
                    }
                    $firedList.Add($evt)
                    if ($rule.action -in @("toast", "toast_chime", "restart_service")) {
                        $null = Send-CoreWatchToastNotification -Title "CoreWatch Alert: $($rule.name)" -Message $detailMsg -Severity $rule.severity -PlayChime ($rule.action -eq "toast_chime")
                    }
                }
            }
        } else {
            if ($script:WatchdogBreachStarts.ContainsKey($rid)) { $script:WatchdogBreachStarts.Remove($rid) }
        }
    }

    if ($firedList.Count -gt 0) {
        $newHist = New-Object System.Collections.Generic.List[object]
        foreach ($f in $firedList) { $newHist.Add($f) }
        foreach ($old in @($store.history)) {
            if ($newHist.Count -lt 80) { $newHist.Add($old) }
        }
        $store["history"] = $newHist.ToArray()
        Save-SmartAlertsStore -Store $store
    }
    return $firedList.ToArray()
}

function Get-SmartAlertsState {
    param([string]$Notice = "", [bool]$NoticeError = $false)
    $store = Get-SmartAlertsStore
    $unacked = (@($store.history | Where-Object { -not $_.acknowledged })).Count
    $enabledCnt = (@($store.rules | Where-Object { $_.enabled })).Count
    return [ordered]@{
        type         = "SMART_ALERTS_STATE"
        muted        = [bool]$store.muted
        rules        = @($store.rules)
        history      = @($store.history)
        enabledCount = $enabledCnt
        unackedCount = $unacked
        notice       = $Notice
        noticeError  = $NoticeError
    }
}

function Invoke-SmartAlertsAction {
    param(
        [Parameter(Mandatory)][string]$RawJson,
        [Parameter(Mandatory)][string]$RootPath
    )
    $payload = $RawJson | ConvertFrom-Json -AsHashtable
    $cmd = [string]$payload["command"]
    try {
        $store = Get-SmartAlertsStore
        switch ($cmd) {
            "ALERTS_LOAD" {
                return (Get-SmartAlertsState)
            }
            "ALERTS_TOGGLE_MUTE" {
                $store["muted"] = [bool]($payload["muted"] ?? (-not $store.muted))
                Save-SmartAlertsStore -Store $store
                $lbl = if ($store["muted"]) { "Watchdog alerts muted." } else { "Watchdog alerts active." }
                return (Get-SmartAlertsState -Notice $lbl)
            }
            "ALERTS_TOGGLE_RULE" {
                $rid = [string]($payload["ruleId"] ?? "")
                foreach ($r in @($store.rules)) {
                    if ($r["id"] -eq $rid) { $r["enabled"] = [bool]($payload["enabled"] ?? (-not $r["enabled"])) }
                }
                Save-SmartAlertsStore -Store $store
                return (Get-SmartAlertsState -Notice "Updated alert rule state.")
            }
            "ALERTS_SAVE_RULE" {
                $ruleHash = $payload["rule"]
                if (-not ($ruleHash -is [System.Collections.IDictionary])) { throw "Invalid alert rule payload." }
                $norm = ConvertTo-NormalizedAlertRule -Raw $ruleHash
                $list = New-Object System.Collections.Generic.List[object]
                $replaced = $false
                foreach ($r in @($store.rules)) {
                    if ($r["id"] -eq $norm["id"]) { $list.Add($norm); $replaced = $true }
                    else { $list.Add($r) }
                }
                if (-not $replaced) { $list.Add($norm) }
                $store["rules"] = $list.ToArray()
                Save-SmartAlertsStore -Store $store
                return (Get-SmartAlertsState -Notice "Saved watchdog rule '$($norm.name)'.")
            }
            "ALERTS_DELETE_RULE" {
                $rid = [string]($payload["ruleId"] ?? "")
                $kept = @($store.rules | Where-Object { $_["id"] -ne $rid })
                $store["rules"] = $kept
                Save-SmartAlertsStore -Store $store
                return (Get-SmartAlertsState -Notice "Deleted watchdog rule.")
            }
            "ALERTS_RESET_DEFAULTS" {
                $store["rules"] = (Get-DefaultSmartAlertRules)
                $store["muted"] = $false
                Save-SmartAlertsStore -Store $store
                return (Get-SmartAlertsState -Notice "Restored default Smart Alert rules.")
            }
            "ALERTS_TEST_TOAST" {
                $ok = Send-CoreWatchToastNotification -Title "CoreWatch Watchdog Test" -Message "Smart Alerts toast notifications are working properly!" -Severity "info" -PlayChime $true
                $evt = [ordered]@{
                    id           = "evt_" + ([guid]::NewGuid().ToString("N").Substring(0, 8))
                    ruleId       = "test"
                    ruleName     = "Test Notification"
                    severity     = "info"
                    message      = "Manual test toast notification triggered by user."
                    timestamp    = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
                    acknowledged = $true
                }
                $newH = New-Object System.Collections.Generic.List[object]
                $newH.Add($evt)
                foreach ($o in @($store.history)) { if ($newH.Count -lt 80) { $newH.Add($o) } }
                $store["history"] = $newH.ToArray()
                Save-SmartAlertsStore -Store $store
                $msg = if ($ok) { "Sent test Windows toast notification." } else { "Logged test alert (Windows toast unavailable in this session)." }
                return (Get-SmartAlertsState -Notice $msg)
            }
            "ALERTS_ACK_ALL" {
                foreach ($h in @($store.history)) { $h["acknowledged"] = $true }
                Save-SmartAlertsStore -Store $store
                return (Get-SmartAlertsState -Notice "Acknowledged all alert notifications.")
            }
            "ALERTS_CLEAR_HISTORY" {
                $store["history"] = @()
                Save-SmartAlertsStore -Store $store
                return (Get-SmartAlertsState -Notice "Cleared alert history.")
            }
            default { throw "Unknown Smart Alerts command: $cmd" }
        }
    } catch {
        return (Get-SmartAlertsState -Notice $_.Exception.Message -NoticeError $true)
    }
}
