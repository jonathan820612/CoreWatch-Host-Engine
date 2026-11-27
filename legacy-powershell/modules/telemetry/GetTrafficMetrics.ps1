# File: modules/telemetry/GetTrafficMetrics.ps1

$script:LastTrafficRxBytes = $null
$script:LastTrafficTxBytes = $null
$script:TrafficStopwatch   = $null

function Get-TrafficMetrics {
    $RxPct  = 0
    $TxPct  = 0
    $RxText = "0.00 KB/s"
    $TxText = "0.00 KB/s"

    try {
        $totalRx = [double]0
        $totalTx = [double]0

        $nics = [System.Net.NetworkInformation.NetworkInterface]::GetAllNetworkInterfaces()
        foreach ($nic in $nics) {
            if ($nic.OperationalStatus -ne [System.Net.NetworkInformation.OperationalStatus]::Up) { continue }
            $nicType = $nic.NetworkInterfaceType
            if ($nicType -eq [System.Net.NetworkInformation.NetworkInterfaceType]::Loopback -or
                $nicType -eq [System.Net.NetworkInformation.NetworkInterfaceType]::Tunnel) { continue }
            if ($nic.Name -like "*vEthernet*" -or $nic.Description -like "*Hyper-V*") { continue }

            $stats = $nic.GetIPv4Statistics()
            $totalRx += [double]$stats.BytesReceived
            $totalTx += [double]$stats.BytesSent
        }

        if ($null -eq $script:TrafficStopwatch) {
            $script:TrafficStopwatch   = [System.Diagnostics.Stopwatch]::StartNew()
            $script:LastTrafficRxBytes = $totalRx
            $script:LastTrafficTxBytes = $totalTx
            $RxBytes = 0.0
            $TxBytes = 0.0
        } else {
            $elapsedSec = $script:TrafficStopwatch.Elapsed.TotalSeconds
            $script:TrafficStopwatch.Restart()

            if ($elapsedSec -gt 0.05) {
                $RxBytes = [math]::Max(0.0, ($totalRx - $script:LastTrafficRxBytes) / $elapsedSec)
                $TxBytes = [math]::Max(0.0, ($totalTx - $script:LastTrafficTxBytes) / $elapsedSec)
            } else {
                $RxBytes = 0.0
                $TxBytes = 0.0
            }

            $script:LastTrafficRxBytes = $totalRx
            $script:LastTrafficTxBytes = $totalTx
        }

        $RxText = if ($RxBytes -gt 1MB) { "$([math]::Round($RxBytes / 1MB, 2)) MB/s" } else { "$([math]::Round($RxBytes / 1KB, 2)) KB/s" }
        $TxText = if ($TxBytes -gt 1MB) { "$([math]::Round($TxBytes / 1MB, 2)) MB/s" } else { "$([math]::Round($TxBytes / 1KB, 2)) KB/s" }

        if ($RxBytes -gt 0) {
            $RxPct = [int](([math]::Log($RxBytes) / [math]::Log(1.5)) * 2)
            if ($RxPct -lt 8) { $RxPct = 8 }
            if ($RxPct -gt 100) { $RxPct = 100 }
        }
        if ($TxBytes -gt 0) {
            $TxPct = [int](([math]::Log($TxBytes) / [math]::Log(1.5)) * 2)
            if ($TxPct -lt 8) { $TxPct = 8 }
            if ($TxPct -gt 100) { $TxPct = 100 }
        }
    } catch {}

    return [PSCustomObject]@{
        RxPct  = [int]$RxPct
        TxPct  = [int]$TxPct
        RxText = [string]$RxText
        TxText = [string]$TxText
    }
}
