# File: modules/telemetry/GetTrafficMetrics.ps1

$IPConfig = Get-NetIPInterface -AddressFamily IPv4 -ConnectionState Connected | 
            Where-Object { $_.InterfaceAlias -notlike "*Loopback*" -and $_.InterfaceAlias -notlike "*vEthernet*" } | 
            Select-Object -First 1

$RxPct  = 0
$TxPct  = 0
$RxText = "0.00 KB/s"
$TxText = "0.00 KB/s"

if ($null -ne $IPConfig) {
    $CurrentNic = Get-CimInstance -ClassName Win32_NetworkAdapter | Where-Object { $_.InterfaceIndex -eq $IPConfig.InterfaceIndex } -ErrorAction SilentlyContinue
    if ($CurrentNic) {
        # Clean the name string to match standard Windows Performance Counter formatting
        $CleanedName = $CurrentNic.Name -replace ' - ', ' ' -replace '/', '_' -replace '#', '_' -replace '\(', '[' -replace '\)', ']'
        
        # Read the raw byte traffic metrics directly via the high-speed native counter engine
        $RxCounter = Get-Counter -Counter "\Network Interface($CleanedName)\Bytes Received/sec" -ErrorAction SilentlyContinue
        $TxCounter = Get-Counter -Counter "\Network Interface($CleanedName)\Bytes Sent/sec" -ErrorAction SilentlyContinue

        # Fallback to a wildcard match if the primary adapter name formatting changes
        if (-not $RxCounter -or -not $TxCounter) {
            $RxCounter = Get-Counter -Counter "\Network Interface(*)\Bytes Received/sec" -ErrorAction SilentlyContinue | Select-Object -First 1
            $TxCounter = Get-Counter -Counter "\Network Interface(*)\Bytes Sent/sec" -ErrorAction SilentlyContinue | Select-Object -First 1
        }

        $RxBytes = if ($RxCounter) { [double]$RxCounter.CounterSamples[0].CookedValue } else { 0 }
        $TxBytes = if ($TxCounter) { [double]$TxCounter.CounterSamples[0].CookedValue } else { 0 }

        # Format Human-Readable String Output Tracers
        $RxText = if ($RxBytes -gt 1MB) { "$([math]::Round($RxBytes / 1MB, 2)) MB/s" } else { "$([math]::Round($RxBytes / 1KB, 2)) KB/s" }
        $TxText = if ($TxBytes -gt 1MB) { "$([math]::Round($TxBytes / 1MB, 2)) MB/s" } else { "$([math]::Round($TxBytes / 1KB, 2)) KB/s" }

        # Logarithmic scaling maps minor traffic drops to noticeable UI changes
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
    }
}

# Emits the telemetry object down the runspace pipeline directly
[PSCustomObject]@{
    RxPct  = [int]$RxPct
    TxPct  = [int]$TxPct
    RxText = [string]$RxText
    TxText = [string]$TxText
}
