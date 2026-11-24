# File: modules/telemetry/DashboardControls.ps1
# =========================================================================
# [DYNAMIC CONTROL] UNIFIED DASHBOARD TOGGLE & QUICK-ACTION ENGINE
# Handles all click-togglable On/Off telemetry states and dynamic controls:
#   - TOGGLE_TELEMETRY     (DiagTrack / dmwappushservice On <-> Off)
#   - TOGGLE_FIREWALL      (Windows Firewall Profiles On <-> Off)
#   - TOGGLE_REALTIME      (Microsoft Defender Real-Time Protection On <-> Off)
#   - TOGGLE_DISCOVERY     (Network Discovery Firewall Rules On <-> Off)
#   - TOGGLE_SHARING       (File & Printer Sharing SMB Rules On <-> Off)
#   - TOGGLE_NET_PROFILE   (Active Network Category Public <-> Private)
#   - SET_QUICK_DNS        (Quick-switch Active Adapter IPv4 DNS / Auto DHCP)
#   - FLUSH_AND_TEST_DNS   (Clear DNS Cache + Immediate Resolution Probe)
#   - REFRESH_ARP_GATEWAY  (Clear Gateway ARP Entry + Ping Re-Probe)
#   - TOGGLE_HDR           (Windows Display HDR via CCD DisplayConfig API)
#   - TOGGLE_NIGHT_LIGHT   (Windows Night Light CloudStore Binary Toggle)
#   - END_TOP_PROCESS      (Terminate Runaway Non-Critical Process by PID)
#   - TRIGGER_SYSTEM_REBOOT(Restart Computer when Pending Reboot is active)
# =========================================================================

function Get-PrimaryUplinkInterface {
    $route = Get-NetRoute -DestinationPrefix "0.0.0.0/0" -AddressFamily IPv4 -ErrorAction SilentlyContinue |
             Sort-Object RouteMetric, InterfaceMetric | Select-Object -First 1
    if ($route) {
        return [PSCustomObject]@{
            InterfaceIndex = [int]$route.InterfaceIndex
            Gateway        = [string]$route.NextHop
        }
    }
    $iface = Get-NetIPInterface -AddressFamily IPv4 -ConnectionState Connected -ErrorAction SilentlyContinue |
             Where-Object { $_.InterfaceAlias -notlike "*Loopback*" -and $_.InterfaceAlias -notlike "*vEthernet*" } |
             Sort-Object InterfaceMetric | Select-Object -First 1
    if ($iface) {
        return [PSCustomObject]@{
            InterfaceIndex = [int]$iface.InterfaceIndex
            Gateway        = $null
        }
    }
    return $null
}

function Test-IsRunningElevated {
    try {
        $id = [Security.Principal.WindowsIdentity]::GetCurrent()
        $pr = New-Object Security.Principal.WindowsPrincipal($id)
        return $pr.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    } catch { return $false }
}

function Invoke-DashboardControlAction {
    param(
        [Parameter(Mandatory)][string]$RawJson,
        [Parameter(Mandatory)][string]$RootPath
    )

    $payload = $null
    try {
        $payload = $RawJson | ConvertFrom-Json
    } catch {
        return [PSCustomObject]@{
            type    = "DASHBOARD_CONTROL_RESULT"
            ok      = $false
            control = "UNKNOWN"
            message = "Invalid JSON command payload."
        }
    }

    $cmd = [string]$payload.command
    $targetState = [string]($payload.targetState ?? "")
    $wantOn = ($targetState -eq "On" -or $targetState -eq "True" -or $targetState -eq "1")

    try {
        switch ($cmd) {

            # -----------------------------------------------------------------
            # 1. WINDOWS TELEMETRY (On <-> Off)
            # -----------------------------------------------------------------
            "TOGGLE_TELEMETRY" {
                if (-not (Test-IsRunningElevated)) { throw "Requires Administrator privileges to toggle Windows Telemetry services." }
                if ($wantOn) {
                    Set-Service -Name DiagTrack -StartupType Automatic -ErrorAction Stop
                    Start-Service -Name DiagTrack -ErrorAction Stop
                    Set-Service -Name dmwappushservice -StartupType Manual -ErrorAction SilentlyContinue
                    Start-Service -Name dmwappushservice -ErrorAction SilentlyContinue
                    return [PSCustomObject]@{ type = "DASHBOARD_CONTROL_RESULT"; ok = $true; control = $cmd; state = "On"; message = "Windows Telemetry services (DiagTrack) enabled and started." }
                } else {
                    Stop-Service -Name DiagTrack, dmwappushservice -Force -ErrorAction SilentlyContinue
                    Set-Service -Name DiagTrack -StartupType Disabled -ErrorAction Stop
                    Set-Service -Name dmwappushservice -StartupType Disabled -ErrorAction SilentlyContinue
                    return [PSCustomObject]@{ type = "DASHBOARD_CONTROL_RESULT"; ok = $true; control = $cmd; state = "Off"; message = "Windows Telemetry services (DiagTrack & dmwappushservice) stopped and disabled." }
                }
            }

            # -----------------------------------------------------------------
            # 2. WINDOWS FIREWALL (On <-> Off)
            # -----------------------------------------------------------------
            "TOGGLE_FIREWALL" {
                if (-not (Test-IsRunningElevated)) { throw "Requires Administrator privileges to toggle Windows Firewall." }
                $enabledFlag = if ($wantOn) { 'True' } else { 'False' }
                Set-NetFirewallProfile -Profile Domain, Private, Public -Enabled $enabledFlag -ErrorAction Stop
                $label = if ($wantOn) { "On" } else { "Off" }
                return [PSCustomObject]@{ type = "DASHBOARD_CONTROL_RESULT"; ok = $true; control = $cmd; state = $label; message = "Windows Firewall profiles set to $label." }
            }

            # -----------------------------------------------------------------
            # 3. DEFENDER REAL-TIME PROTECTION (On <-> Off)
            # -----------------------------------------------------------------
            "TOGGLE_REALTIME" {
                if (-not (Test-IsRunningElevated)) { throw "Requires Administrator privileges to toggle Real-Time Protection." }
                $disableBool = -not $wantOn
                Set-MpPreference -DisableRealtimeMonitoring $disableBool -ErrorAction Stop
                Start-Sleep -Milliseconds 250
                $actual = $null
                try { $actual = (Get-MpComputerStatus -ErrorAction SilentlyContinue).RealTimeProtectionEnabled } catch {}
                if ($null -ne $actual -and ([bool]$actual -ne $wantOn)) {
                    throw "Blocked by Windows Security Tamper Protection. Disable Tamper Protection in Windows Security to toggle via API."
                }
                $label = if ($wantOn) { "On" } else { "Off" }
                return [PSCustomObject]@{ type = "DASHBOARD_CONTROL_RESULT"; ok = $true; control = $cmd; state = $label; message = "Defender Real-Time Protection turned $label." }
            }

            # -----------------------------------------------------------------
            # 4. NETWORK DISCOVERY (On <-> Off)
            # -----------------------------------------------------------------
            "TOGGLE_DISCOVERY" {
                if (-not (Test-IsRunningElevated)) { throw "Requires Administrator privileges to toggle Network Discovery." }
                if ($wantOn) {
                    Enable-NetFirewallRule -DisplayGroup "Network Discovery" -ErrorAction SilentlyContinue
                    Enable-NetFirewallRule -Name "FPS-LLMNR-In-UDP", "FPS-SSDP-In-UDP" -ErrorAction SilentlyContinue
                } else {
                    Disable-NetFirewallRule -DisplayGroup "Network Discovery" -ErrorAction SilentlyContinue
                    Disable-NetFirewallRule -Name "FPS-LLMNR-In-UDP", "FPS-SSDP-In-UDP" -ErrorAction SilentlyContinue
                }
                $label = if ($wantOn) { "On" } else { "Off" }
                return [PSCustomObject]@{ type = "DASHBOARD_CONTROL_RESULT"; ok = $true; control = $cmd; state = $label; message = "Network Discovery firewall rules turned $label." }
            }

            # -----------------------------------------------------------------
            # 5. FILE & PRINTER SHARING (On <-> Off)
            # -----------------------------------------------------------------
            "TOGGLE_SHARING" {
                if (-not (Test-IsRunningElevated)) { throw "Requires Administrator privileges to toggle File & Printer Sharing." }
                if ($wantOn) {
                    Enable-NetFirewallRule -DisplayGroup "File and Printer Sharing" -ErrorAction SilentlyContinue
                    Enable-NetFirewallRule -Name "FPS-SMB-In-TCP" -ErrorAction SilentlyContinue
                } else {
                    Disable-NetFirewallRule -DisplayGroup "File and Printer Sharing" -ErrorAction SilentlyContinue
                    Disable-NetFirewallRule -Name "FPS-SMB-In-TCP" -ErrorAction SilentlyContinue
                }
                $label = if ($wantOn) { "On" } else { "Off" }
                return [PSCustomObject]@{ type = "DASHBOARD_CONTROL_RESULT"; ok = $true; control = $cmd; state = $label; message = "File & Printer Sharing (SMB) rules turned $label." }
            }

            # -----------------------------------------------------------------
            # 6. NETWORK PROFILE CATEGORY (Public <-> Private)
            # -----------------------------------------------------------------
            "TOGGLE_NET_PROFILE" {
                if (-not (Test-IsRunningElevated)) { throw "Requires Administrator privileges to change Network Profile category." }
                $uplink = Get-PrimaryUplinkInterface
                if (-not $uplink) { throw "No active uplink network interface detected." }
                $targetCat = if ($targetState -eq "Private") { "Private" } else { "Public" }
                Set-NetConnectionProfile -InterfaceIndex $uplink.InterfaceIndex -NetworkCategory $targetCat -ErrorAction Stop
                return [PSCustomObject]@{ type = "DASHBOARD_CONTROL_RESULT"; ok = $true; control = $cmd; state = $targetCat; message = "Active network profile switched to $targetCat." }
            }

            # -----------------------------------------------------------------
            # 7. QUICK DNS PRESET SWITCHER (Auto / Cloudflare / Google / Quad9 / Custom)
            # -----------------------------------------------------------------
            "SET_QUICK_DNS" {
                if (-not (Test-IsRunningElevated)) { throw "Requires Administrator privileges to change DNS servers." }
                $uplink = Get-PrimaryUplinkInterface
                if (-not $uplink) { throw "No active uplink network interface detected." }
                $servers = @($payload.servers | Where-Object { $_ -and ([string]$_).Trim() -ne "" })
                if ($servers.Count -eq 0 -or $servers[0] -eq "AUTO") {
                    Set-DnsClientServerAddress -InterfaceIndex $uplink.InterfaceIndex -ResetServerAddresses -ErrorAction Stop
                    Clear-DnsClientCache -ErrorAction SilentlyContinue
                    return [PSCustomObject]@{ type = "DASHBOARD_CONTROL_RESULT"; ok = $true; control = $cmd; message = "DNS reset to Automatic (DHCP) and cache flushed." }
                } else {
                    Set-DnsClientServerAddress -InterfaceIndex $uplink.InterfaceIndex -ServerAddresses $servers -ErrorAction Stop
                    Clear-DnsClientCache -ErrorAction SilentlyContinue
                    return [PSCustomObject]@{ type = "DASHBOARD_CONTROL_RESULT"; ok = $true; control = $cmd; message = "DNS servers updated to $($servers -join ', ') and cache flushed." }
                }
            }

            # -----------------------------------------------------------------
            # 8. FLUSH DNS CACHE & IMMEDIATE RESOLUTION PROBE
            # -----------------------------------------------------------------
            "FLUSH_AND_TEST_DNS" {
                Clear-DnsClientCache -ErrorAction SilentlyContinue
                $sw = [System.Diagnostics.Stopwatch]::StartNew()
                $task = [System.Net.Dns]::GetHostAddressesAsync("cloudflare.com")
                if ($task.Wait(1500) -and $task.Result -and $task.Result.Length -gt 0) {
                    $sw.Stop()
                    $ms = [int][math]::Max(1, [math]::Round($sw.Elapsed.TotalMilliseconds))
                    return [PSCustomObject]@{ type = "DASHBOARD_CONTROL_RESULT"; ok = $true; control = $cmd; message = "DNS cache flushed; live probe resolved cloudflare.com in ${ms}ms." }
                } else {
                    return [PSCustomObject]@{ type = "DASHBOARD_CONTROL_RESULT"; ok = $false; control = $cmd; message = "DNS cache flushed, but resolution probe timed out." }
                }
            }

            # -----------------------------------------------------------------
            # 9. REFRESH GATEWAY ARP NEIGHBOR CACHE
            # -----------------------------------------------------------------
            "REFRESH_ARP_GATEWAY" {
                $uplink = Get-PrimaryUplinkInterface
                if (-not $uplink -or -not $uplink.Gateway -or $uplink.Gateway -eq "0.0.0.0") {
                    throw "No active IPv4 default gateway found."
                }
                $gw = $uplink.Gateway
                try {
                    Remove-NetNeighbor -InterfaceIndex $uplink.InterfaceIndex -IPAddress $gw -Confirm:$false -ErrorAction SilentlyContinue
                } catch {}
                try {
                    $pinger = New-Object System.Net.NetworkInformation.Ping
                    $reply = $pinger.Send($gw, 600)
                    $pinger.Dispose()
                    $rttMsg = if ($reply.Status -eq [System.Net.NetworkInformation.IPStatus]::Success) { "Reachable ($($reply.RoundtripTime)ms)" } else { "Status: $($reply.Status)" }
                    return [PSCustomObject]@{ type = "DASHBOARD_CONTROL_RESULT"; ok = $true; control = $cmd; message = "Gateway ARP refreshed for $gw ($rttMsg)." }
                } catch {
                    return [PSCustomObject]@{ type = "DASHBOARD_CONTROL_RESULT"; ok = $true; control = $cmd; message = "Gateway ARP cache refresh triggered for $gw." }
                }
            }

            # -----------------------------------------------------------------
            # 10. DISPLAY HDR TOGGLE (On <-> Off)
            # -----------------------------------------------------------------
            "TOGGLE_HDR" {
                . (Join-Path $RootPath "modules\telemetry\GetDisplayMetrics.ps1")
                $devName = [string]($payload.deviceName ?? "")
                $changed = [CoreWatch.DisplayProbe]::SetHdrState($devName, $wantOn)
                if (-not $changed) {
                    throw "Monitor does not support HDR or Windows rejected DisplayConfig HDR state change."
                }
                $label = if ($wantOn) { "On" } else { "Off" }
                return [PSCustomObject]@{ type = "DASHBOARD_CONTROL_RESULT"; ok = $true; control = $cmd; state = $label; message = "Display HDR turned $label." }
            }

            # -----------------------------------------------------------------
            # 11. DISPLAY NIGHT LIGHT TOGGLE (On <-> Off)
            # -----------------------------------------------------------------
            "TOGGLE_NIGHT_LIGHT" {
                . (Join-Path $RootPath "modules\telemetry\GetDisplayMetrics.ps1")
                $null = Set-NightLightStatus -Enable $wantOn
                $label = if ($wantOn) { "On" } else { "Off" }
                return [PSCustomObject]@{ type = "DASHBOARD_CONTROL_RESULT"; ok = $true; control = $cmd; state = $label; message = "Windows Night Light turned $label." }
            }

            # -----------------------------------------------------------------
            # 11b. NIGHT LIGHT WARMTH / BLUE-LIGHT STRENGTH SLIDER (0..100%)
            # Guard: Only allow writes when Night Light is actively On to avoid LUT glitches
            # -----------------------------------------------------------------
            "SET_NIGHT_LIGHT_STRENGTH" {
                . (Join-Path $RootPath "modules\telemetry\GetDisplayMetrics.ps1")
                if ((Get-NightLightStatus) -ne "On") {
                    throw "Night Light must be turned On before adjusting blue-light warmth strength."
                }
                $pct = [int]($payload.strength ?? 32)
                $res = Set-NightLightStrength -StrengthPct $pct
                return [PSCustomObject]@{
                    type    = "DASHBOARD_CONTROL_RESULT"
                    ok      = $true
                    control = $cmd
                    state   = "$($res.StrengthPct)%"
                    message = "Night Light warmth set to $($res.StrengthPct)% ($($res.Kelvin)K)."
                }
            }

            # -----------------------------------------------------------------
            # 11c. SAFE MONITOR REFRESH RATE SWITCHER (DRIVER-VERIFIED + CDS_TEST)
            # -----------------------------------------------------------------
            "SET_MONITOR_REFRESH_RATE" {
                . (Join-Path $RootPath "modules\telemetry\GetDisplayMetrics.ps1")
                $devName = [string]($payload.deviceName ?? "")
                $hz      = [int]($payload.refreshRate ?? 0)
                $status  = [CoreWatch.DisplayProbe]::SetMonitorRefreshRate($devName, $hz)
                if ($status -ne "OK") { throw $status }
                return [PSCustomObject]@{
                    type    = "DASHBOARD_CONTROL_RESULT"
                    ok      = $true
                    control = $cmd
                    state   = "${hz} Hz"
                    message = "Monitor refresh rate switched safely to ${hz} Hz ($devName)."
                }
            }

            # -----------------------------------------------------------------
            # 12. TERMINATE RUNAWAY TOP PROCESS (WITH CRITICAL OS GUARD)
            # -----------------------------------------------------------------
            "END_TOP_PROCESS" {
                $targetPid = [int]($payload.pid ?? 0)
                if ($targetPid -le 4) { throw "Refused to terminate system kernel process." }
                $proc = Get-Process -Id $targetPid -ErrorAction Stop
                $protected = @('csrss', 'lsass', 'wininit', 'winlogon', 'smss', 'services', 'svchost', 'dwm', 'explorer', 'pwsh', 'powershell', 'system', 'registry')
                if ($proc.ProcessName.ToLowerInvariant() -in $protected) {
                    throw "Refused to terminate protected Windows process '$($proc.ProcessName).exe'."
                }
                $pName = $proc.ProcessName
                Stop-Process -Id $targetPid -Force -ErrorAction Stop
                return [PSCustomObject]@{ type = "DASHBOARD_CONTROL_RESULT"; ok = $true; control = $cmd; message = "Terminated process $pName.exe (PID $targetPid)." }
            }

            # -----------------------------------------------------------------
            # 13. SYSTEM REBOOT (WHEN PENDING REBOOT IS FLAGGED)
            # -----------------------------------------------------------------
            "TRIGGER_SYSTEM_REBOOT" {
                Restart-Computer -Force -ErrorAction Stop
                return [PSCustomObject]@{ type = "DASHBOARD_CONTROL_RESULT"; ok = $true; control = $cmd; message = "System reboot initiated..." }
            }

            default {
                throw "Unsupported dashboard control command: $cmd"
            }
        }
    } catch {
        return [PSCustomObject]@{
            type    = "DASHBOARD_CONTROL_RESULT"
            ok      = $false
            control = $cmd
            message = $_.Exception.Message
        }
    }
}
