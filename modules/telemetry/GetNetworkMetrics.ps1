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

        $CurrentNic = Get-CimInstance -ClassName Win32_NetworkAdapter | Where-Object { $_.InterfaceIndex -eq $IPConfig.InterfaceIndex } -ErrorAction SilentlyContinue
        if ($CurrentNic -and $CurrentNic.Speed -gt 0) {
            $SpeedGbps = [math]::Round(($CurrentNic.Speed / 1GB), 1)
            $LinkCap = if ($SpeedGbps -ge 1) { "$SpeedGbps Gbps" } else { "$([int]($CurrentNic.Speed / 1MB)) Mbps" }
        }
    }

    $WlanInterfaces = netsh wlan show interfaces | Out-String
    if ($WlanInterfaces -match '(?i)^\s+SSID\s+:\s+(.*)$') { 
        $WlanSsid = $Matches[1].Trim() 
    }

    $DiscoveryStatus = "Off"
    $SsdpRule = Get-NetFirewallRule -Name "FPS-LLMNR-In-UDP" -ErrorAction SilentlyContinue
    if ($SsdpRule -and $SsdpRule.Enabled -eq 'True') { $DiscoveryStatus = "On" }

    $EthDriver  = "Not Present / Inactive"
    $WifiDriver = "Not Present / Inactive"
    $AllAdapters = Get-CimInstance -ClassName Win32_NetworkAdapter -Filter "PhysicalAdapter=True" -ErrorAction SilentlyContinue
    
    foreach ($Adapter in $AllAdapters) {
        if ($Adapter.Name -like "*Wireless*" -or $Adapter.Name -like "*Wi-Fi*" -or $Adapter.Name -like "*802.11*") { $WifiDriver = $Adapter.Name }
        elseif ($Adapter.Name -like "*Ethernet*" -or $Adapter.Name -like "*Gigabit*" -or $Adapter.Name -like "*PCIe*") { $EthDriver = $Adapter.Name }
    }

    $ExtIPv4 = "Resolving..."
    try {
        $WebClient = New-Object System.Net.WebClient
        $WebClient.Headers.Add("user-agent", "curl/7.81.0")
        $DownloadTask = $WebClient.DownloadStringTaskAsync("https://api.ipify.org")
        if ($DownloadTask.Wait(400)) { $ExtIPv4 = $DownloadTask.Result.Trim() } else { $ExtIPv4 = "Gateway Latency" }
    } catch { $ExtIPv4 = "Offline / Secure Mesh" }
    
    $DhcpStatus = "Static"
    if ($IPConfig.Dhcp -eq 'Enabled') { $DhcpStatus = "DHCP" }
    
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
