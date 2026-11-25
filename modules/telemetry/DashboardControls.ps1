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
            # 3. DEFENDER TAMPER PROTECTION & GATED DEFENDER TOGGLES
            # -----------------------------------------------------------------
            "OPEN_TAMPER_SETTINGS" {
                Start-Process "windowsdefender://threatsettings"
                return [PSCustomObject]@{ type = "DASHBOARD_CONTROL_RESULT"; ok = $true; control = $cmd; message = "Opened Windows Security (Virus & threat protection settings) to toggle Tamper Protection." }
            }

            "TOGGLE_REALTIME" {
                if (-not (Test-IsRunningElevated)) { throw "Requires Administrator privileges to toggle Real-Time Protection." }
                $mpPre = Get-MpComputerStatus -ErrorAction SilentlyContinue
                if ($mpPre -and $mpPre.IsTamperProtected) {
                    throw "Blocked: Turn OFF Tamper Protection in Windows Security first (click T. Protection)."
                }
                $disableBool = -not $wantOn
                Set-MpPreference -DisableRealtimeMonitoring $disableBool -ErrorAction Stop
                Start-Sleep -Milliseconds 250
                $actual = $null
                try { $actual = (Get-MpComputerStatus -ErrorAction SilentlyContinue).RealTimeProtectionEnabled } catch {}
                if ($null -ne $actual -and ([bool]$actual -ne $wantOn)) {
                    throw "Blocked by Windows Security Tamper Protection. Turn OFF Tamper Protection in Windows Security first."
                }
                $label = if ($wantOn) { "On" } else { "Off" }
                return [PSCustomObject]@{ type = "DASHBOARD_CONTROL_RESULT"; ok = $true; control = $cmd; state = $label; message = "Defender Real-Time Protection turned $label." }
            }

            "TOGGLE_BEHAVIOR_MONITOR" {
                if (-not (Test-IsRunningElevated)) { throw "Requires Administrator privileges to toggle Behavior Monitoring." }
                $mpPre = Get-MpComputerStatus -ErrorAction SilentlyContinue
                if ($mpPre -and $mpPre.IsTamperProtected) {
                    throw "Blocked: Turn OFF Tamper Protection in Windows Security first."
                }
                Set-MpPreference -DisableBehaviorMonitoring (-not $wantOn) -ErrorAction Stop
                $label = if ($wantOn) { "On" } else { "Off" }
                return [PSCustomObject]@{ type = "DASHBOARD_CONTROL_RESULT"; ok = $true; control = $cmd; state = $label; message = "Defender Behavior Monitoring turned $label." }
            }

            "TOGGLE_CLOUD_PROTECTION" {
                if (-not (Test-IsRunningElevated)) { throw "Requires Administrator privileges to toggle Cloud-Delivered Protection." }
                $mpPre = Get-MpComputerStatus -ErrorAction SilentlyContinue
                if ($mpPre -and $mpPre.IsTamperProtected) {
                    throw "Blocked: Turn OFF Tamper Protection in Windows Security first."
                }
                $mapsVal = if ($wantOn) { 2 } else { 0 }
                Set-MpPreference -MAPSReporting $mapsVal -ErrorAction Stop
                $label = if ($wantOn) { "On" } else { "Off" }
                return [PSCustomObject]@{ type = "DASHBOARD_CONTROL_RESULT"; ok = $true; control = $cmd; state = $label; message = "Defender Cloud-Delivered Protection turned $label." }
            }

            "TOGGLE_IOAV_PROTECTION" {
                if (-not (Test-IsRunningElevated)) { throw "Requires Administrator privileges to toggle Downloads/Attachments (IOAV) Scan." }
                $mpPre = Get-MpComputerStatus -ErrorAction SilentlyContinue
                if ($mpPre -and $mpPre.IsTamperProtected) {
                    throw "Blocked: Turn OFF Tamper Protection in Windows Security first."
                }
                Set-MpPreference -DisableIOAVProtection (-not $wantOn) -ErrorAction Stop
                $label = if ($wantOn) { "On" } else { "Off" }
                return [PSCustomObject]@{ type = "DASHBOARD_CONTROL_RESULT"; ok = $true; control = $cmd; state = $label; message = "Defender Download & Attachment Scan (IOAV) turned $label." }
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
            # 11d. PER-MONITOR DISPLAY SCALE SWITCHER (NATIVE WINDOWS CCD API)
            # -----------------------------------------------------------------
            "SET_MONITOR_SCALE" {
                . (Join-Path $RootPath "modules\telemetry\GetDisplayMetrics.ps1")
                $devName  = [string]($payload.deviceName ?? "")
                $scalePct = [int]($payload.scalePct ?? 100)
                $status   = [CoreWatch.DisplayProbe]::SetMonitorScale($devName, $scalePct)
                if ($status -ne "OK") { throw $status }
                return [PSCustomObject]@{
                    type    = "DASHBOARD_CONTROL_RESULT"
                    ok      = $true
                    control = $cmd
                    state   = "${scalePct}%"
                    message = "Display scale updated to ${scalePct}% ($devName)."
                }
            }

            # -----------------------------------------------------------------
            # 11e. SAFE MONITOR ORIENTATION SWITCHER (CDS_TEST PRE-VALIDATED)
            # -----------------------------------------------------------------
            "SET_MONITOR_ORIENTATION" {
                . (Join-Path $RootPath "modules\telemetry\GetDisplayMetrics.ps1")
                $devName = [string]($payload.deviceName ?? "")
                $oriCode = [int]($payload.orientationCode ?? 0)
                $status  = [CoreWatch.DisplayProbe]::SetMonitorOrientation($devName, $oriCode)
                if ($status -ne "OK") { throw $status }
                $oriLabel = switch ($oriCode) {
                    1 { "Portrait" }
                    2 { "Landscape (Flipped)" }
                    3 { "Portrait (Flipped)" }
                    default { "Landscape" }
                }
                return [PSCustomObject]@{
                    type    = "DASHBOARD_CONTROL_RESULT"
                    ok      = $true
                    control = $cmd
                    state   = $oriLabel
                    message = "Display orientation switched to $oriLabel ($devName)."
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

            # -----------------------------------------------------------------
            # 14. INSTALL PAWNIO KERNEL DRIVER (REQUIRED FOR LIBREHARDWAREMONITOR)
            # -----------------------------------------------------------------
            "INSTALL_PAWNIO" {
                $winget = Get-Command "winget.exe" -ErrorAction SilentlyContinue
                if ($winget) {
                    Start-Process -FilePath "cmd.exe" -ArgumentList "/k winget install --id namazso.PawnIO --source winget --accept-package-agreements --accept-source-agreements" -Verb RunAs -ErrorAction Stop
                    return [PSCustomObject]@{ type = "DASHBOARD_CONTROL_RESULT"; ok = $true; control = $cmd; message = "Launched PawnIO installer via winget. Restart CoreWatch after installation completes." }
                } else {
                    Start-Process "https://pawnio.eu/"
                    return [PSCustomObject]@{ type = "DASHBOARD_CONTROL_RESULT"; ok = $true; control = $cmd; message = "Opened pawnio.eu to download the signed PawnIO driver installer." }
                }
            }

            # -----------------------------------------------------------------
            # 15. SWITCH PRIMARY JAVA RUNTIME (JAVA_HOME + SYSTEM PATH)
            # -----------------------------------------------------------------
            "SET_PRIMARY_JAVA" {
                if (-not (Test-IsRunningElevated)) { throw "Requires Administrator privileges to switch System JAVA_HOME and PATH." }
                $javaHome = ([string]($payload.javaHome ?? "")).Trim().TrimEnd('\')
                if (-not $javaHome -or -not (Test-Path -LiteralPath (Join-Path $javaHome "bin\java.exe") -PathType Leaf)) {
                    throw "Selected Java directory does not contain bin\java.exe: $javaHome"
                }

                # Update Machine + User JAVA_HOME and current process environment
                [Environment]::SetEnvironmentVariable("JAVA_HOME", $javaHome, "Machine")
                if ([Environment]::GetEnvironmentVariable("JAVA_HOME", "User")) {
                    [Environment]::SetEnvironmentVariable("JAVA_HOME", $javaHome, "User")
                }
                $env:JAVA_HOME = $javaHome

                # Update Machine PATH cleanly (preserving REG_EXPAND_SZ)
                $envRegPath = "HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager\Environment"
                $rawPath = (Get-ItemProperty -Path $envRegPath -Name Path -ErrorAction Stop).Path
                $newBin = Join-Path $javaHome "bin"

                $javaDirPattern = '(?i)(^%JAVA_HOME%\\bin$|\\(Eclipse Adoptium|Java|AdoptOpenJDK|Zulu|Amazon Corretto|BellSoft|Semeru|Oracle\\Java)\\.*|Microsoft\\jdk-[^\\]+\\bin)'
                $kept = New-Object System.Collections.Generic.List[string]
                $kept.Add($newBin)
                foreach ($entry in ($rawPath -split ';')) {
                    $e = $entry.Trim()
                    if (-not $e) { continue }
                    if ($e.TrimEnd('\').Equals($newBin, [System.StringComparison]::OrdinalIgnoreCase)) { continue }
                    if ($e -match $javaDirPattern) { continue }
                    $kept.Add($e)
                }
                $updatedPath = $kept -join ';'
                Set-ItemProperty -Path $envRegPath -Name Path -Value $updatedPath -Type ExpandString -ErrorAction Stop

                # Broadcast WM_SETTINGCHANGE so Explorer & new terminals immediately pick up the new primary Java
                if (-not ("CoreWatch.EnvBroadcast" -as [type])) {
                    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
namespace CoreWatch {
    public static class EnvBroadcast {
        [DllImport("user32.dll", SetLastError = true, CharSet = CharSet.Auto)]
        public static extern IntPtr SendMessageTimeout(IntPtr hWnd, uint Msg, UIntPtr wParam, string lParam, uint fuFlags, uint uTimeout, out UIntPtr lpdwResult);
    }
}
"@ -ErrorAction SilentlyContinue
                }
                try {
                    [UIntPtr]$resPtr = [UIntPtr]::Zero
                    $null = [CoreWatch.EnvBroadcast]::SendMessageTimeout([IntPtr]0xffff, 0x001A, [UIntPtr]::Zero, "Environment", 2, 3000, [ref]$resPtr)
                } catch {}

                $label = [string]($payload.label ?? (Split-Path -Path $javaHome -Leaf))
                return [PSCustomObject]@{
                    type    = "DASHBOARD_CONTROL_RESULT"
                    ok      = $true
                    control = $cmd
                    state   = $label
                    message = "Primary Java switched to $label ($javaHome). New terminals will use this version."
                }
            }

            # -----------------------------------------------------------------
            # 16. POWERSHELL LIVE UPDATE CHECK & 1-CLICK INSTALLER
            # -----------------------------------------------------------------
            "CHECK_PS_UPDATE" {
                . (Join-Path $RootPath "modules\telemetry\GetInfraMetrics.ps1")
                $info = Get-PowerShellUpdateStatus -Force
                return [PSCustomObject]@{
                    type    = "DASHBOARD_CONTROL_RESULT"
                    ok      = $true
                    control = $cmd
                    state   = $info.tier
                    message = $info.detail
                }
            }

            "INSTALL_PS_UPDATE" {
                $runnerPath = Join-Path $env:TEMP ("CoreWatch-PsUpdate-{0}.ps1" -f ([guid]::NewGuid().ToString('N').Substring(0,8)))
                $relaunchExe = Join-Path $RootPath "CoreWatch.exe"
                $relaunchScript = Join-Path $RootPath "Start-NodeWatch.ps1"
                $safeRelaunchExe = $relaunchExe.Replace("'", "''")
                $safeRelaunchScript = $relaunchScript.Replace("'", "''")

                $psRunner = @"
`$Host.UI.RawUI.WindowTitle = 'CoreWatch PowerShell 7 Installer / Updater'
Write-Host '============================================================' -ForegroundColor Cyan
Write-Host '  CoreWatch PowerShell 7 Smart Installer & Updater' -ForegroundColor Cyan
Write-Host '============================================================' -ForegroundColor Cyan

`$targetDir = 'C:\Program Files\PowerShell\7'
`$msiExe    = Join-Path `$targetDir 'pwsh.exe'
`$msixAlias = Join-Path `$env:LOCALAPPDATA 'Microsoft\WindowsApps\pwsh.exe'
`$hasMsiInstall  = Test-Path -LiteralPath `$msiExe -PathType Leaf
`$hasMsixInstall = (-not `$hasMsiInstall) -and (Test-Path -LiteralPath `$msixAlias -PathType Leaf)
`$updatedOk = `$false

try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    `$arch = if (`$env:PROCESSOR_ARCHITECTURE -match 'ARM64') { 'arm64' } elseif ([Environment]::Is64BitOperatingSystem) { 'x64' } else { 'x86' }

    if (`$hasMsiInstall) {
        Write-Host "`nDetected existing MSI install in `$targetDir (full folder access)." -ForegroundColor Cyan
        Write-Host "Querying official PowerShell 7 stable releases (win-`$arch MSI channel)..." -ForegroundColor Green

        `$rels = @(Invoke-RestMethod -Uri 'https://api.github.com/repos/PowerShell/PowerShell/releases?per_page=30' -Headers @{'User-Agent'='CoreWatch'} -TimeoutSec 20 -ErrorAction Stop)
        `$msiCandidates = New-Object System.Collections.Generic.List[object]
        `$zipCandidates = New-Object System.Collections.Generic.List[object]

        foreach (`$r in `$rels) {
            if (`$r.prerelease -or `$r.draft) { continue }
            if ([string]`$r.tag_name -notmatch '^v(\d+\.\d+\.\d+)$') { continue }
            `$vObj = [version]`$Matches[1]
            `$mA = `$r.assets | Where-Object { `$_.name -match "^PowerShell-.*-win-`$arch\.msi`$" } | Select-Object -First 1
            `$zA = `$r.assets | Where-Object { `$_.name -match "^PowerShell-.*-win-`$arch\.zip`$" } | Select-Object -First 1
            if (`$mA) { `$msiCandidates.Add([PSCustomObject]@{ ver = `$vObj; tag = [string]`$r.tag_name; asset = `$mA }) }
            if (`$zA) { `$zipCandidates.Add([PSCustomObject]@{ ver = `$vObj; tag = [string]`$r.tag_name; asset = `$zA }) }
        }

        `$bestMsi = `$msiCandidates | Sort-Object ver -Descending | Select-Object -First 1
        `$bestZip = `$zipCandidates | Sort-Object ver -Descending | Select-Object -First 1

        if (`$bestMsi) {
            `$tag = `$bestMsi.tag
            `$msiAsset = `$bestMsi.asset
            if (`$bestZip -and `$bestZip.ver -gt `$bestMsi.ver) {
                Write-Host "NOTE: `$(`$bestZip.tag) has no official .msi installer (WinGet uses WindowsApps MSIX)." -ForegroundColor Yellow
                Write-Host "Installing latest official .MSI release `$tag to keep `$targetDir unlocked & cleanly upgradable." -ForegroundColor Cyan
            }
            Write-Host "Found official .MSI installer for `$tag: `$(`$msiAsset.name) (`$([math]::Round(`$msiAsset.size / 1MB, 1)) MB)" -ForegroundColor Green
            `$msiPath = Join-Path `$env:TEMP `$msiAsset.name
            Write-Host 'Downloading MSI...' -ForegroundColor Cyan
            Invoke-WebRequest -Uri `$msiAsset.browser_download_url -OutFile `$msiPath -UseBasicParsing -ErrorAction Stop

            `$lockingProcs = @(Get-Process -Name 'pwsh' -ErrorAction SilentlyContinue | Where-Object {
                try { `$_.MainModule.FileName -like "`$targetDir\*" } catch { `$false }
            })
            if (`$lockingProcs.Count -gt 0) {
                Write-Host "`nClosing `$(`$lockingProcs.Count) running pwsh.exe process(es) (including CoreWatch) for clean MSI upgrade..." -ForegroundColor Yellow
                Start-Sleep -Seconds 2
                foreach (`$lp in `$lockingProcs) { try { Stop-Process -Id `$lp.Id -Force -ErrorAction SilentlyContinue } catch {} }
                Start-Sleep -Milliseconds 800
            }

            Write-Host "Running msiexec into `$targetDir..." -ForegroundColor Green
            `$proc = Start-Process -FilePath 'msiexec.exe' -ArgumentList @('/i', "`"`$msiPath`"", '/qb', 'ADD_PATH=1', 'REGISTER_MANIFEST=1', 'USE_MU=1', 'ENABLE_MU=1') -Wait -PassThru
            Remove-Item -LiteralPath `$msiPath -Force -ErrorAction SilentlyContinue
            if (`$proc.ExitCode -eq 0 -or `$proc.ExitCode -eq 3010) { `$updatedOk = `$true }
            else { Write-Host "msiexec exited with code `$(`$proc.ExitCode)." -ForegroundColor Yellow }
        }
    } elseif (`$hasMsixInstall) {
        Write-Host "`nDetected existing MSIX / Microsoft Store PowerShell 7 in WindowsApps." -ForegroundColor Yellow
        Write-Host "NOTE: MSIX installs live in C:\Program Files\WindowsApps where Windows restricts direct folder access/editing." -ForegroundColor DarkYellow
        Write-Host "Upgrading via WinGet..." -ForegroundColor Green
        & winget upgrade --id Microsoft.PowerShell -e --source winget --accept-package-agreements --accept-source-agreements
        if (`$LASTEXITCODE -eq 0 -or `$LASTEXITCODE -eq -1978335189) { `$updatedOk = `$true }
    } else {
        # No PowerShell Core currently installed -> Install MSIX version via WinGet (with directory limitation notice)
        Write-Host "`nNo existing PowerShell Core 7 installation detected." -ForegroundColor Cyan
        Write-Host "Installing PowerShell 7 (MSIX) via WinGet..." -ForegroundColor Green
        Write-Host "NOTE: The MSIX version installs into C:\Program Files\WindowsApps where Windows restricts direct directory browsing and manual edits." -ForegroundColor Yellow
        if (Get-Command winget -ErrorAction SilentlyContinue) {
            & winget install --id Microsoft.PowerShell -e --source winget --accept-package-agreements --accept-source-agreements
            if (`$LASTEXITCODE -eq 0 -or `$LASTEXITCODE -eq -1978335189) { `$updatedOk = `$true }
        }
        if (-not `$updatedOk) {
            Write-Host "WinGet unavailable or failed — falling back to latest official GitHub .MSI..." -ForegroundColor Yellow
            `$rels = @(Invoke-RestMethod -Uri 'https://api.github.com/repos/PowerShell/PowerShell/releases?per_page=30' -Headers @{'User-Agent'='CoreWatch'} -TimeoutSec 20 -ErrorAction Stop)
            `$bestMsi = `$null; `$bestVer = [version]'0.0.0'
            foreach (`$r in `$rels) {
                if (`$r.prerelease -or `$r.draft) { continue }
                if ([string]`$r.tag_name -notmatch '^v(\d+\.\d+\.\d+)$') { continue }
                `$v = [version]`$Matches[1]
                `$a = `$r.assets | Where-Object { `$_.name -match "^PowerShell-.*-win-`$arch\.msi`$" } | Select-Object -First 1
                if (`$a -and `$v -gt `$bestVer) { `$bestVer = `$v; `$bestMsi = `$a }
            }
            if (`$bestMsi) {
                `$msiPath = Join-Path `$env:TEMP `$bestMsi.name
                Invoke-WebRequest -Uri `$bestMsi.browser_download_url -OutFile `$msiPath -UseBasicParsing -ErrorAction Stop
                `$proc = Start-Process -FilePath 'msiexec.exe' -ArgumentList @('/i', "`"`$msiPath`"", '/qb', 'ADD_PATH=1', 'REGISTER_MANIFEST=1') -Wait -PassThru
                Remove-Item -LiteralPath `$msiPath -Force -ErrorAction SilentlyContinue
                if (`$proc.ExitCode -eq 0 -or `$proc.ExitCode -eq 3010) { `$updatedOk = `$true }
            }
        }
    }

    `$finalPwsh = if (Test-Path -LiteralPath `$msiExe) { `$msiExe } elseif (Test-Path -LiteralPath `$msixAlias) { `$msixAlias } else { (Get-Command pwsh -ErrorAction SilentlyContinue).Source }
    if (`$updatedOk -and `$finalPwsh) {
        `$verifiedVer = (& `$finalPwsh -NoProfile -Command '`$PSVersionTable.PSVersion.ToString()' 2>`$null)
        Write-Host "`nVERIFIED INSTALLED VERSION: PowerShell `$verifiedVer (`$finalPwsh)" -ForegroundColor Green

        if (Test-Path -LiteralPath '$safeRelaunchExe') {
            Write-Host 'Relaunching CoreWatch.exe...' -ForegroundColor Cyan
            Start-Process -FilePath '$safeRelaunchExe'
        } elseif (Test-Path -LiteralPath '$safeRelaunchScript') {
            Write-Host 'Relaunching CoreWatch on updated pwsh.exe...' -ForegroundColor Cyan
            Start-Process -FilePath `$finalPwsh -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', '"$safeRelaunchScript"')
        }
    }
} catch {
    Write-Host "Update failed: `$(`$_.Exception.Message)" -ForegroundColor Red
}

Read-Host "`nPress Enter to close this updater window"
Remove-Item -LiteralPath '$runnerPath' -Force -ErrorAction SilentlyContinue
"@
                Set-Content -LiteralPath $runnerPath -Value $psRunner -Encoding UTF8
                $winPs = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
                Start-Process -FilePath $winPs -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$runnerPath`"") -Verb RunAs -ErrorAction Stop
                return [PSCustomObject]@{
                    type    = "DASHBOARD_CONTROL_RESULT"
                    ok      = $true
                    control = $cmd
                    message = "Launched PowerShell 7 updater (MSI or official .zip -> C:\Program Files\PowerShell\7)."
                }
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
