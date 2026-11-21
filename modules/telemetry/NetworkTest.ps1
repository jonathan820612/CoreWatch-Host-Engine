function Get-NetworkSpeedTest {
    [CmdletBinding()]
    param()

    # Enforce TLS 1.2 for Cloudflare HTTPS in Windows PowerShell 5.1
    try {
        [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor [System.Net.SecurityProtocolType]::Tls12
    } catch {}

    $results = [ordered]@{
        type     = "SPEED_TEST_RESULTS"
        Latency  = 0
        Download = 0
        Upload   = 0
    }

    # 1. Latency (Ping 1.1.1.1 via .NET Ping, fallback to Test-Connection)
    try {
        $pinger = New-Object System.Net.NetworkInformation.Ping
        $times = @()
        for ($i = 0; $i -lt 3; $i++) {
            $reply = $pinger.Send("1.1.1.1", 1000)
            if ($reply.Status -eq [System.Net.NetworkInformation.IPStatus]::Success) {
                $times += $reply.RoundtripTime
            }
        }
        $pinger.Dispose()

        if ($times.Count -gt 0) {
            $results.Latency = [Math]::Round(($times | Measure-Object -Average).Average, 0)
        } else {
            $results.Latency = "N/A"
        }
    } catch {
        try {
            $ping = Test-Connection -ComputerName 1.1.1.1 -Count 2 -ErrorAction SilentlyContinue
            if ($ping) {
                $results.Latency = [Math]::Round(($ping.ResponseTime | Measure-Object -Average).Average, 0)
            } else {
                $results.Latency = "N/A"
            }
        } catch {
            $results.Latency = "ERR"
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
