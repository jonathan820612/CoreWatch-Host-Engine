function Get-NetworkMetrics {
    $IPConfig = Get-NetIPInterface -AddressFamily IPv4 -ConnectionState Connected | 
                Where-Object { $_.InterfaceAlias -notlike "*Loopback*" -and $_.InterfaceAlias -notlike "*vEthernet*" } | 
                Select-Object -First 1
    
    $IntIPv4       = "0.0.0.0"
    $SubMask       = "0.0.0.0"
    $Gateway       = "0.0.0.0"
    $NetProfileStr = "Disconnected"
    $LinkCap       = "0 Mbps"
    $WlanSsid      = "Disconnected"
    $EthDriver     = "Not Present / Inactive"
    $WifiDriver    = "Not Present / Inactive"

    if ($null -ne $IPConfig) {
        $NetProf = Get-NetConnectionProfile -InterfaceIndex $IPConfig.InterfaceIndex -ErrorAction SilentlyContinue
        if ($NetProf) { $NetProfileStr = $NetProf.NetworkCategory.ToString() }

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

        $Route = Get-NetRoute -InterfaceIndex $IPConfig.InterfaceIndex -DestinationPrefix "0.0.0.0/0" -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($Route) { $Gateway = $Route.NextHop }

        # FIXED: Use fast NetIPInterface capacity data to bypass heavy CIM locks
        if ($IPConfig.LinkSpeed -gt 0) {
            $SpeedGbps = [math]::Round(($IPConfig.LinkSpeed / 1GB), 1)
            $LinkCap = if ($SpeedGbps -ge 1) { "$SpeedGbps Gbps" } else { "$([int]($IPConfig.LinkSpeed / 1MB)) Mbps" }
        }
    }

    $WlanInterfaces = netsh wlan show interfaces | Out-String
    if ($WlanInterfaces -match '(?i)^\s+SSID\s+:\s+(.*)$') { 
        $WlanSsid = $Matches[1].Trim() 
    }

    $DiscoveryStatus = "Off"
    $SsdpRule = Get-NetFirewallRule -Name "FPS-LLMNR-In-UDP" -ErrorAction SilentlyContinue
    if ($SsdpRule -and $SsdpRule.Enabled -eq 'True') { $DiscoveryStatus = "On" }

    # FIXED: Replaced heavy Get-CimInstance queries with lightning-fast native Get-NetAdapter calls
    try {
        $AllAdapters = Get-NetAdapter -Physical -ErrorAction SilentlyContinue
        foreach ($Adapter in $AllAdapters) {
            if ($Adapter.Name -like "*Wireless*" -or $Adapter.Name -like "*Wi-Fi*" -or $Adapter.InterfaceDescription -like "*Wireless*" -or $Adapter.InterfaceDescription -like "*Wi-Fi*") { 
                $WifiDriver = $Adapter.InterfaceDescription 
            }
            elseif ($Adapter.Name -like "*Ethernet*" -or $Adapter.InterfaceDescription -like "*Ethernet*" -or $Adapter.InterfaceDescription -like "*Gigabit*" -or $Adapter.InterfaceDescription -like "*Realtek*") { 
                $EthDriver = $Adapter.InterfaceDescription 
            }
        }
    } catch {}

    $ExtIPv4 = "Resolving..."
    try {
        $WebClient = New-Object System.Net.WebClient
        $WebClient.Headers.Add("user-agent", "curl/7.81.0")
        $DownloadTask = $WebClient.DownloadStringTaskAsync("https://api.ipify.org")
        if ($DownloadTask.Wait(400)) { $ExtIPv4 = $DownloadTask.Result.Trim() } else { $ExtIPv4 = "Gateway Latency" }
    } catch { $ExtIPv4 = "Offline / Secure Mesh" }
    
    $DhcpStatus = "Static"
    if ($null -ne $IPConfig -and $IPConfig.Dhcp -eq 'Enabled') { $DhcpStatus = "DHCP" }
    
    return [PSCustomObject]@{
        IntIPv4       = [string]$IntIPv4
        SubnetMask    = [string]$SubMask
        Gateway       = [string]$Gateway
        NetworkStatus = [string]$NetProfileStr
        WlanSsid      = [string]$WlanSsid
        ExtIPv4       = [string]$ExtIPv4
        LinkCap       = [string]$LinkCap
        Discovery     = [string]$DiscoveryStatus
        lblEthDriver  = [string]$EthDriver
        lblWifiDriver = [string]$WifiDriver
        NetAssignment = [string]$DhcpStatus
    }
}
