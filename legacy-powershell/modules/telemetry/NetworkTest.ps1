# File: modules/telemetry/NetworkTest.ps1

function Get-NetworkSpeedTest {
    [CmdletBinding()]
    param()

    # Enforce TLS 1.2 for Cloudflare HTTPS in Windows PowerShell 5.1
    try {
        [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor [System.Net.SecurityProtocolType]::Tls12
    } catch {}

    $results = [ordered]@{
        type       = "SPEED_TEST_RESULTS"
        Latency    = 0
        Jitter     = 0
        PacketLoss = 0
        Download   = 0
        Upload     = 0
    }

    # =========================================================================
    # [DIAGNOSTIC ADDITION] 1. Latency, Jitter (ms) & Packet Loss (%)
    # Insert Point: Sends 6 ICMP probes to 1.1.1.1 to detect Wi-Fi interference
    # =========================================================================
    $probeCount = 6
    try {
        $pinger = New-Object System.Net.NetworkInformation.Ping
        $times = [System.Collections.Generic.List[double]]::new()
        for ($i = 0; $i -lt $probeCount; $i++) {
            try {
                $reply = $pinger.Send("1.1.1.1", 1000)
                if ($reply.Status -eq [System.Net.NetworkInformation.IPStatus]::Success) {
                    $times.Add([double]$reply.RoundtripTime)
                }
            } catch {}
            if ($i -lt ($probeCount - 1)) { [System.Threading.Thread]::Sleep(35) }
        }
        $pinger.Dispose()

        $received = $times.Count
        $results.PacketLoss = [Math]::Round((($probeCount - $received) / [double]$probeCount) * 100.0, 0)

        if ($received -gt 0) {
            $results.Latency = [Math]::Round(($times | Measure-Object -Average).Average, 0)
            if ($received -ge 2) {
                $deltas = for ($j = 1; $j -lt $received; $j++) { [Math]::Abs($times[$j] - $times[$j - 1]) }
                $results.Jitter = [Math]::Round(($deltas | Measure-Object -Average).Average, 1)
            } else {
                $results.Jitter = 0
            }
        } else {
            $results.Latency = "N/A"
            $results.Jitter  = "N/A"
        }
    } catch {
        try {
            $ping = @(Test-Connection -ComputerName 1.1.1.1 -Count 4 -ErrorAction SilentlyContinue)
            if ($ping.Count -gt 0) {
                $rtts = @($ping | ForEach-Object { [double]($_.Latency ?? $_.ResponseTime) })
                $results.Latency    = [Math]::Round(($rtts | Measure-Object -Average).Average, 0)
                $results.PacketLoss = [Math]::Round(((4 - $rtts.Count) / 4.0) * 100.0, 0)
                if ($rtts.Count -ge 2) {
                    $deltas = for ($j = 1; $j -lt $rtts.Count; $j++) { [Math]::Abs($rtts[$j] - $rtts[$j - 1]) }
                    $results.Jitter = [Math]::Round(($deltas | Measure-Object -Average).Average, 1)
                } else { $results.Jitter = 0 }
            } else {
                $results.Latency    = "N/A"
                $results.Jitter     = "N/A"
                $results.PacketLoss = 100
            }
        } catch {
            $results.Latency    = "ERR"
            $results.Jitter     = "ERR"
            $results.PacketLoss = "ERR"
        }
    }

    # 2. Download Speed (5MB test payload from Cloudflare Speedtest)
    try {
        $url = "https://speed.cloudflare.com/__down?bytes=5242880"
        $client = New-Object System.Net.WebClient
        $start = [System.Diagnostics.Stopwatch]::StartNew()
        $data = $client.DownloadData($url)
        $start.Stop()
        $client.Dispose()
        $elapsed = $start.Elapsed.TotalSeconds
        if ($elapsed -gt 0 -and $data.Length -gt 0) {
            # Convert bytes to megabits and divide by seconds (Mbps)
            $results.Download = [Math]::Round((($data.Length * 8) / 1000000) / $elapsed, 2)
        } else {
            $results.Download = 0
        }
    } catch {
        $results.Download = "ERR"
    }

    # 3. Upload Speed (2MB POST payload to Cloudflare Speedtest)
    try {
        $url = "https://speed.cloudflare.com/__up"
        $payload = New-Object byte[] 2097152 # 2MB
        $wc = New-Object System.Net.WebClient
        $start = [System.Diagnostics.Stopwatch]::StartNew()
        $null = $wc.UploadData($url, "POST", $payload)
        $start.Stop()
        $wc.Dispose()
        $elapsed = $start.Elapsed.TotalSeconds
        if ($elapsed -gt 0) {
            # Convert bytes to megabits and divide by seconds (Mbps)
            $results.Upload = [Math]::Round(((2097152 * 8) / 1000000) / $elapsed, 2)
        } else {
            $results.Upload = 0
        }
    } catch {
        $results.Upload = "ERR"
    }

    return [PSCustomObject]$results
}
