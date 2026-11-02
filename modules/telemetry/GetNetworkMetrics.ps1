# File: modules/telemetry/GetNetworkMetrics.ps1

function Get-NetworkMetrics {
    # 1. Profile primary active IPv4 adapter route configuration
    $IPConfig = Get-NetIPInterface -AddressFamily IPv4 -ConnectionState Connected | Where-Object { $_.InterfaceAlias -notlike "*Loopback*" } | Select-Object -First 1
    
    $IntIPv4  = "0.0.0.0"
    $SubMask  = "0.0.0.0"
    $Gateway  = "0.0.0.0"
    $Status   = "Disconnected"
    $NicDriver = "Unknown Driver"
    $LinkCap  = "0 Mbps"
    $WlanSsid = "Disconnected"

    if ($null -ne $IPConfig) {
        $Status = "Connected"
        
        # Pull exact internal IP address mapping
        $IPAddr = Get-NetIPAddress -InterfaceIndex $IPConfig.InterfaceIndex -AddressFamily IPv4 | Select-Object -First 1
        if ($IPAddr) { 
            $IntIPv4 = $IPAddr.IPAddress 
            $SubMask = switch ($IPAddr.PrefixLength) {
                24      { "255.255.255.0" }
                16      { "255.255.0.0" }
                8       { "255.0.0.0" }
                default { "255.255.255.0" }
            }
        }

        # Pull default upstream gateway router path hop
        $Route = Get-NetRoute -InterfaceIndex $IPConfig.InterfaceIndex -DestinationPrefix "0.0.0.0/0" -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($Route) { $Gateway = $Route.NextHop }

        # Profile physical NIC driver data properties
        $Nic = Get-CimInstance -ClassName Win32_NetworkAdapter | Where-Object { $_.InterfaceIndex -eq $IPConfig.InterfaceIndex } -ErrorAction SilentlyContinue
        if ($Nic) { 
            $NicDriver = $Nic.Name 
            if ($Nic.Speed -gt 0) {
                $SpeedGbps = [math]::Round(($Nic.Speed / 1GB), 1)
                $LinkCap = if ($SpeedGbps -ge 1) { "$SpeedGbps Gbps" } else { "$([int]($Nic.Speed / 1MB)) Mbps" }
            }
        }

        # Extract active Wi-Fi wireless profile network SSID context
        if ($IPConfig.InterfaceAlias -like "*Wi-Fi*" -or $IPConfig.InterfaceAlias -like "*Wireless*") {
            $WlanProfile = netsh wlan show interfaces | Out-String
            if ($WlanProfile -match '^\s+SSID\s+:\s+(.*)$') {
                $WlanSsid = $Matches[1].Trim()
            }
        } else {
            $WlanSsid = "Ethernet Link (No WLAN)"
        }
    }

    # =========================================================================
    # FIXED HIGH-ACCURACY TEXT-ONLY EXTERNAL IP EXTRACTION ENGINE
    # =========================================================================
    $ExtIPv4 = "Resolving..."
    try {
        # Deploy a clean WebClient instance to force absolute raw text-string retrieval
        $WebClient = New-Object System.Net.WebClient
        
        # Injected explicit plain text header targets to cleanly bypass browser formatting wraps
        $WebClient.Headers.Add("user-agent", "Mozilla/5.0 node-watch-agent")
        
        # Snappy sub-second async fail ceiling prevents timer cycle stutters
        $DownloadTask = $WebClient.DownloadStringTaskAsync("https://api.ipify.org")
        if ($DownloadTask.Wait(800)) {
            $ExtIPv4 = $DownloadTask.Result.Trim()
        } else {
            $ExtIPv4 = "Secure Gateway Timeout"
        }
    } catch {
        $ExtIPv4 = "Offline / Secure Gateway"
    }

    return [PSCustomObject]@{
        IntIPv4       = [string]$IntIPv4
        SubnetMask    = [string]$SubMask
        Gateway       = [string]$Gateway
        NetworkStatus = [string]$Status
        WlanSsid      = [string]$WlanSsid
        ExtIPv4       = [string]$ExtIPv4
        LinkCap       = [string]$LinkCap
        InterfaceName = [string]$NicDriver
    }
}