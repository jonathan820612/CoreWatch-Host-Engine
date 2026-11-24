# File: modules/tabs/NetworkDiagnostics.ps1
# =========================================================================
# COREWATCH ACTIVE NETWORK TROUBLESHOOTING TOOLKIT
# Provides IT-grade active network investigation tools inside the Network tab:
#   - NET_DIAG_PING            (Multi-probe ICMP Ping + Min/Avg/Max/Jitter/Loss)
#   - NET_DIAG_TRACEROUTE      (Fast progressive-TTL Traceroute with reverse DNS)
#   - NET_DIAG_PORT_TEST       (Multi-port TCP reachability + service hints + ms)
#   - NET_DIAG_DNS_LOOKUP      (Resolve-DnsName A/AAAA/MX/TXT/NS/CNAME/PTR/SOA)
#   - NET_DIAG_WIFI_AND_ROUTES (Wi-Fi RSSI/Channel/Band/Radio + IPv4 Routes + ARP)
# =========================================================================

[CmdletBinding()]
param()

function Get-WellKnownPortHint {
    param([int]$Port)
    switch ($Port) {
        20   { "FTP-Data" }
        21   { "FTP" }
        22   { "SSH" }
        23   { "Telnet" }
        25   { "SMTP" }
        53   { "DNS" }
        67   { "DHCP" }
        80   { "HTTP" }
        110  { "POP3" }
        123  { "NTP" }
        135  { "RPC" }
        139  { "NetBIOS" }
        143  { "IMAP" }
        161  { "SNMP" }
        389  { "LDAP" }
        443  { "HTTPS" }
        445  { "SMB" }
        587  { "SMTP-TLS" }
        636  { "LDAPS" }
        1433 { "MSSQL" }
        3306 { "MySQL" }
        3389 { "RDP" }
        5432 { "PostgreSQL" }
        5900 { "VNC" }
        5985 { "WinRM-HTTP" }
        5986 { "WinRM-HTTPS" }
        6379 { "Redis" }
        8080 { "HTTP-Alt" }
        8443 { "HTTPS-Alt" }
        9000 { "App/Debug" }
        default { "Custom" }
    }
}

function Resolve-TargetIPv4 {
    param([string]$Target)
    $parsedIp = $null
    if ([System.Net.IPAddress]::TryParse($Target, [ref]$parsedIp)) {
        return $parsedIp.ToString()
    }
    try {
        $addrs = [System.Net.Dns]::GetHostAddresses($Target)
        $v4 = $addrs | Where-Object { $_.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork } | Select-Object -First 1
        if ($v4) { return $v4.ToString() }
        if ($addrs.Length -gt 0) { return $addrs[0].ToString() }
    } catch {}
    return $null
}

function Invoke-NetDiagPing {
    param(
        [string]$Target,
        [int]$Count = 6
    )

    $Count = [math]::Max(1, [math]::Min(20, $Count))
    $resolvedIp = Resolve-TargetIPv4 -Target $Target
    if (-not $resolvedIp) {
        throw "Could not resolve host '$Target'."
    }

    $samples = [System.Collections.Generic.List[PSCustomObject]]::new()
    $rtts    = [System.Collections.Generic.List[double]]::new()
    $pinger  = New-Object System.Net.NetworkInformation.Ping

    try {
        for ($i = 1; $i -le $Count; $i++) {
            try {
                $reply = $pinger.Send($resolvedIp, 1200)
                if ($reply.Status -eq [System.Net.NetworkInformation.IPStatus]::Success) {
                    $rtt = [double]$reply.RoundtripTime
                    $rtts.Add($rtt)
                    $ttl = if ($reply.Options) { [int]$reply.Options.Ttl } else { 0 }
                    $samples.Add([PSCustomObject]@{
                        seq    = $i
                        rttMs  = [int]$rtt
                        ttl    = $ttl
                        status = "OK"
                    })
                } else {
                    $samples.Add([PSCustomObject]@{
                        seq    = $i
                        rttMs  = -1
                        ttl    = 0
                        status = [string]$reply.Status
                    })
                }
            } catch {
                $samples.Add([PSCustomObject]@{
                    seq    = $i
                    rttMs  = -1
                    ttl    = 0
                    status = "Error"
                })
            }
            if ($i -lt $Count) { [System.Threading.Thread]::Sleep(80) }
        }
    } finally {
        $pinger.Dispose()
    }

    $recv    = $rtts.Count
    $lossPct = [math]::Round((($Count - $recv) / [double]$Count) * 100.0, 0)
    $minMs   = if ($recv -gt 0) { [int]($rtts | Measure-Object -Minimum).Minimum } else { -1 }
    $maxMs   = if ($recv -gt 0) { [int]($rtts | Measure-Object -Maximum).Maximum } else { -1 }
    $avgMs   = if ($recv -gt 0) { [math]::Round(($rtts | Measure-Object -Average).Average, 1) } else { -1 }
    $jitter  = 0.0
    if ($recv -ge 2) {
        $deltas = for ($j = 1; $j -lt $recv; $j++) { [math]::Abs($rtts[$j] - $rtts[$j - 1]) }
        $jitter = [math]::Round(($deltas | Measure-Object -Average).Average, 1)
    }

    return [PSCustomObject]@{
        type       = "NET_DIAG_RESULT"
        tool       = "ping"
        ok         = ($recv -gt 0)
        target     = $Target
        resolvedIp = $resolvedIp
        sent       = $Count
        received   = $recv
        lossPct    = $lossPct
        minMs      = $minMs
        avgMs      = $avgMs
        maxMs      = $maxMs
        jitterMs   = $jitter
        samples    = @($samples)
    }
}

function Invoke-NetDiagTraceroute {
    param(
        [string]$Target,
        [int]$MaxHops = 20
    )

    $MaxHops = [math]::Max(1, [math]::Min(30, $MaxHops))
    $resolvedIp = Resolve-TargetIPv4 -Target $Target
    if (-not $resolvedIp) {
        throw "Could not resolve host '$Target'."
    }

    $hops   = [System.Collections.Generic.List[PSCustomObject]]::new()
    $pinger = New-Object System.Net.NetworkInformation.Ping
    $buffer = [byte[]](0..31)
    $reached = $false

    try {
        for ($ttl = 1; $ttl -le $MaxHops; $ttl++) {
            $opts = New-Object System.Net.NetworkInformation.PingOptions($ttl, $true)
            $sw = [System.Diagnostics.Stopwatch]::StartNew()
            $reply = $null
            try {
                $reply = $pinger.Send($resolvedIp, 1200, $buffer, $opts)
            } catch {}
            $sw.Stop()

            if ($null -eq $reply -or $reply.Status -eq [System.Net.NetworkInformation.IPStatus]::TimedOut) {
                $hops.Add([PSCustomObject]@{
                    hop      = $ttl
                    ip       = "*"
                    hostname = "Request timed out"
                    rttMs    = -1
                    status   = "Timeout"
                })
                continue
            }

            $hopIp = if ($reply.Address) { $reply.Address.ToString() } else { "*" }
            $rttMs = if ($reply.Status -eq [System.Net.NetworkInformation.IPStatus]::Success) {
                [int]$reply.RoundtripTime
            } else {
                [int][math]::Max(1, $sw.ElapsedMilliseconds)
            }

            # Fast best-effort reverse DNS with 250ms cap
            $hostName = ""
            if ($hopIp -and $hopIp -ne "*") {
                try {
                    $revTask = [System.Net.Dns]::GetHostEntryAsync($hopIp)
                    if ($revTask.Wait(250) -and $revTask.Result -and $revTask.Result.HostName) {
                        $hostName = [string]$revTask.Result.HostName
                    }
                } catch {}
            }

            $hops.Add([PSCustomObject]@{
                hop      = $ttl
                ip       = $hopIp
                hostname = $hostName
                rttMs    = $rttMs
                status   = [string]$reply.Status
            })

            if ($reply.Status -eq [System.Net.NetworkInformation.IPStatus]::Success -or $hopIp -eq $resolvedIp) {
                $reached = $true
                break
            }
        }
    } finally {
        $pinger.Dispose()
    }

    return [PSCustomObject]@{
        type       = "NET_DIAG_RESULT"
        tool       = "traceroute"
        ok         = $true
        target     = $Target
        resolvedIp = $resolvedIp
        reached    = $reached
        hops       = @($hops)
    }
}

function Invoke-NetDiagPortTest {
    param(
        [string]$Target,
        [string]$PortsSpec = "443"
    )

    $resolvedIp = Resolve-TargetIPv4 -Target $Target
    if (-not $resolvedIp) {
        throw "Could not resolve host '$Target'."
    }

    $portList = @($PortsSpec -split '[,\s;]+' | ForEach-Object {
        $v = 0
        if ([int]::TryParse($_.Trim(), [ref]$v) -and $v -ge 1 -and $v -le 65535) { $v }
    } | Select-Object -Unique -First 12)

    if ($portList.Count -eq 0) {
        throw "Enter at least one valid TCP port (1–65535), e.g. 443 or 22,80,443,3389."
    }

    $results = [System.Collections.Generic.List[PSCustomObject]]::new()
    foreach ($port in $portList) {
        $client = New-Object System.Net.Sockets.TcpClient
        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        $isOpen = $false
        $detail = ""
        try {
            $connectTask = $client.ConnectAsync($resolvedIp, $port)
            if ($connectTask.Wait(1800)) {
                $sw.Stop()
                if ($client.Connected) {
                    $isOpen = $true
                    $detail = "TCP handshake succeeded"
                } else {
                    $detail = "Connection closed"
                }
            } else {
                $sw.Stop()
                $detail = "Filtered / Timed out (1800ms)"
            }
        } catch {
            $sw.Stop()
            $inner = if ($_.Exception.InnerException) { $_.Exception.InnerException.Message } else { $_.Exception.Message }
            $detail = if ($inner -match '(?i)actively refused') { "Closed (Connection refused)" } else { $inner }
        } finally {
            try { $client.Dispose() } catch {}
        }

        $results.Add([PSCustomObject]@{
            port        = $port
            serviceHint = Get-WellKnownPortHint -Port $port
            open        = $isOpen
            rttMs       = [int][math]::Max(1, $sw.ElapsedMilliseconds)
            detail      = $detail
        })
    }

    return [PSCustomObject]@{
        type       = "NET_DIAG_RESULT"
        tool       = "port"
        ok         = $true
        target     = $Target
        resolvedIp = $resolvedIp
        results    = @($results)
    }
}

function Invoke-NetDiagDnsLookup {
    param(
        [string]$Target,
        [string]$RecordType = "A",
        [string]$DnsServer = ""
    )

    $validTypes = @("A", "AAAA", "MX", "TXT", "NS", "CNAME", "SOA", "PTR", "SRV", "ANY")
    $rType = if ($RecordType -and ($validTypes -contains $RecordType.ToUpperInvariant())) { $RecordType.ToUpperInvariant() } else { "A" }

    $sw = [System.Diagnostics.Stopwatch]::StartNew()
    $records = [System.Collections.Generic.List[PSCustomObject]]::new()

    try {
        $params = @{ Name = $Target; Type = $rType; ErrorAction = "Stop" }
        if ($DnsServer -and $DnsServer.Trim() -ne "") {
            $params["Server"] = $DnsServer.Trim()
        }
        $answers = @(Resolve-DnsName @params)
        $sw.Stop()

        foreach ($rec in $answers) {
            $val = ""
            if ($rec.IPAddress)        { $val = [string]$rec.IPAddress }
            elseif ($rec.NameExchange) { $val = "$($rec.Preference) $($rec.NameExchange)" }
            elseif ($rec.NameHost)     { $val = [string]$rec.NameHost }
            elseif ($rec.Strings)      { $val = ($rec.Strings -join " ") }
            elseif ($rec.PrimaryServer){ $val = "$($rec.PrimaryServer) (Serial $($rec.SerialNumber))" }
            elseif ($rec.NameTarget)   { $val = "$($rec.Priority) $($rec.Weight) $($rec.Port) $($rec.NameTarget)" }
            else                       { $val = ($rec | Out-String).Trim() }

            $records.Add([PSCustomObject]@{
                name  = [string]$rec.Name
                type  = [string]$rec.QueryType
                ttl   = if ($null -ne $rec.TTL) { [int]$rec.TTL } else { 0 }
                value = $val
            })
        }
    } catch {
        $sw.Stop()
        # Fallback for A/AAAA via .NET Dns if Resolve-DnsName fails
        if ($rType -in @("A", "AAAA") -and -not $DnsServer) {
            try {
                $addrs = [System.Net.Dns]::GetHostAddresses($Target)
                foreach ($a in $addrs) {
                    $fam = if ($a.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetworkV6) { "AAAA" } else { "A" }
                    if ($fam -eq $rType) {
                        $records.Add([PSCustomObject]@{ name = $Target; type = $fam; ttl = 0; value = $a.ToString() })
                    }
                }
            } catch {
                throw $_.Exception.Message
            }
        } else {
            throw $_.Exception.Message
        }
    }

    return [PSCustomObject]@{
        type       = "NET_DIAG_RESULT"
        tool       = "dns"
        ok         = ($records.Count -gt 0)
        target     = $Target
        recordType = $rType
        server     = if ($DnsServer) { $DnsServer.Trim() } else { "System Default" }
        elapsedMs  = [int][math]::Max(1, $sw.ElapsedMilliseconds)
        records    = @($records)
    }
}

function Get-NetDiagWifiAndRoutes {
    # 1. Live Wi-Fi Radio Telemetry (RSSI dBm, Signal %, Channel, Band, Radio Type, BSSID, Auth, Rates)
    $wifi = [ordered]@{
        connected      = $false
        interfaceName  = "N/A"
        ssid           = "Disconnected / Ethernet Only"
        bssid          = "--"
        signalPct      = 0
        rssiDbm        = "--"
        channel        = "--"
        band           = "--"
        radioType      = "--"
        authentication = "--"
        cipher         = "--"
        rxRateMbps     = "--"
        txRateMbps     = "--"
        note           = ""
    }

    try {
        $wlanLines = @(netsh wlan show interfaces 2>&1)
        $joined = $wlanLines -join "`n"
        if ($joined -match '(?i)location permission|error 5|requires elevation') {
            $wifi.note = "Windows Location Privacy restricted netsh WLAN details (enable Location for apps or run elevated)."
        } else {
            foreach ($line in $wlanLines) {
                $s = [string]$line
                if ($s -match '^\s*Name\s*:\s*(.+)$')                { $wifi.interfaceName = $Matches[1].Trim() }
                elseif ($s -match '^\s*State\s*:\s*connected')       { $wifi.connected = $true }
                elseif ($s -match '^\s*SSID\s*:\s*(.+)$' -and $s -notmatch 'BSSID') { $wifi.ssid = $Matches[1].Trim() }
                elseif ($s -match '^\s*(?:AP\s+)?BSSID\s*:\s*(.+)$') { $wifi.bssid = $Matches[1].Trim() }
                elseif ($s -match '^\s*Radio type\s*:\s*(.+)$')      { $wifi.radioType = $Matches[1].Trim() }
                elseif ($s -match '^\s*Band\s*:\s*(.+)$')            { $wifi.band = $Matches[1].Trim() }
                elseif ($s -match '^\s*Authentication\s*:\s*(.+)$')  { $wifi.authentication = $Matches[1].Trim() }
                elseif ($s -match '^\s*Cipher\s*:\s*(.+)$')          { $wifi.cipher = $Matches[1].Trim() }
                elseif ($s -match '^\s*Channel\s*:\s*(\d+)')         { $wifi.channel = $Matches[1].Trim() }
                elseif ($s -match '^\s*Receive rate \(Mbps\)\s*:\s*(.+)$')  { $wifi.rxRateMbps = "$($Matches[1].Trim()) Mbps" }
                elseif ($s -match '^\s*Transmit rate \(Mbps\)\s*:\s*(.+)$') { $wifi.txRateMbps = "$($Matches[1].Trim()) Mbps" }
                elseif ($s -match '^\s*Signal\s*:\s*(\d+)%') {
                    $sig = [int]$Matches[1]
                    $wifi.signalPct = $sig
                    # Standard Windows WLAN quality-to-RSSI conversion: dBm = (Signal% / 2) - 100
                    $dbm = [int][math]::Round(($sig / 2.0) - 100.0)
                    $wifi.rssiDbm = "$dbm dBm"
                }
            }
            if ($wifi.band -eq "--" -and $wifi.channel -match '^\d+$') {
                $ch = [int]$wifi.channel
                $wifi.band = if ($ch -le 14) { "2.4 GHz" } elseif ($ch -le 177) { "5 GHz" } else { "6 GHz" }
            }
        }
    } catch {}

    # 2. IPv4 Routing Table
    $routes = [System.Collections.Generic.List[PSCustomObject]]::new()
    try {
        $rawRoutes = @(Get-NetRoute -AddressFamily IPv4 -ErrorAction SilentlyContinue |
            Sort-Object RouteMetric, InterfaceMetric, DestinationPrefix | Select-Object -First 60)
        foreach ($r in $rawRoutes) {
            $routes.Add([PSCustomObject]@{
                destination = [string]$r.DestinationPrefix
                nextHop     = [string]$r.NextHop
                interface   = [string]$r.InterfaceAlias
                routeMetric = [int]$r.RouteMetric
                ifMetric    = [int]$r.InterfaceMetric
                totalMetric = ([int]$r.RouteMetric + [int]$r.InterfaceMetric)
            })
        }
    } catch {}

    # 3. Local ARP Neighbor Table (excluding multicast & broadcast)
    $arpEntries = [System.Collections.Generic.List[PSCustomObject]]::new()
    try {
        $rawArp = @(Get-NetNeighbor -AddressFamily IPv4 -ErrorAction SilentlyContinue |
            Where-Object {
                $_.State -in @("Reachable", "Stale", "Delay", "Probe", "Permanent") -and
                $_.IPAddress -notmatch '^(224\.|239\.|255\.|127\.)' -and
                $_.LinkLayerAddress -and $_.LinkLayerAddress -ne "00-00-00-00-00-00" -and $_.LinkLayerAddress -ne "FF-FF-FF-FF-FF-FF"
            } | Sort-Object State, IPAddress | Select-Object -First 60)
        foreach ($n in $rawArp) {
            $arpEntries.Add([PSCustomObject]@{
                ip        = [string]$n.IPAddress
                mac       = [string]$n.LinkLayerAddress
                state     = [string]$n.State
                interface = [string]$n.InterfaceAlias
            })
        }
    } catch {}

    return [PSCustomObject]@{
        type      = "NET_DIAG_WIFI_ROUTES"
        ok        = $true
        timestamp = (Get-Date).ToString("HH:mm:ss")
        wifi      = [PSCustomObject]$wifi
        routes    = @($routes)
        arp       = @($arpEntries)
    }
}

function Invoke-NetworkDiagnosticAction {
    param(
        [Parameter(Mandatory)][string]$RawJson
    )

    $payload = $null
    try {
        $payload = $RawJson | ConvertFrom-Json
    } catch {
        return [PSCustomObject]@{ type = "NET_DIAG_ERROR"; ok = $false; error = "Invalid network diagnostics payload." }
    }

    $cmd = [string]$payload.command
    $target = [string]($payload.target ?? "").Trim()

    try {
        switch ($cmd) {
            "NET_DIAG_PING" {
                if (-not $target) { throw "Enter a hostname or IP address to ping." }
                $cnt = if ($payload.count) { [int]$payload.count } else { 6 }
                return Invoke-NetDiagPing -Target $target -Count $cnt
            }
            "NET_DIAG_TRACEROUTE" {
                if (-not $target) { throw "Enter a hostname or IP address to trace." }
                $maxHops = if ($payload.maxHops) { [int]$payload.maxHops } else { 20 }
                return Invoke-NetDiagTraceroute -Target $target -MaxHops $maxHops
            }
            "NET_DIAG_PORT_TEST" {
                if (-not $target) { throw "Enter a hostname or IP address to test." }
                $ports = if ($payload.ports) { [string]$payload.ports } else { "443" }
                return Invoke-NetDiagPortTest -Target $target -PortsSpec $ports
            }
            "NET_DIAG_DNS_LOOKUP" {
                if (-not $target) { throw "Enter a domain name or IP to resolve." }
                $rType = if ($payload.recordType) { [string]$payload.recordType } else { "A" }
                $srv   = if ($payload.server) { [string]$payload.server } else { "" }
                return Invoke-NetDiagDnsLookup -Target $target -RecordType $rType -DnsServer $srv
            }
            "NET_DIAG_WIFI_AND_ROUTES" {
                return Get-NetDiagWifiAndRoutes
            }
            default {
                throw "Unsupported network diagnostic command: $cmd"
            }
        }
    } catch {
        return [PSCustomObject]@{
            type  = "NET_DIAG_ERROR"
            ok    = $false
            tool  = $cmd
            error = $_.Exception.Message
        }
    }
}
