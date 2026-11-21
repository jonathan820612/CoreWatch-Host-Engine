# File: modules/telemetry/GetNetworkMetrics.ps1

$script:LastSlowNetCheck  = [datetime]::MinValue
$script:CachedExtIPv4     = "Resolving..."
$script:CachedFirewall    = "Unknown"
$script:CachedRealtime    = "Unknown"
$script:CachedDiscovery   = "Off"
$script:CachedSharing     = "Off"
$script:LastWlanCheck     = [datetime]::MinValue
$script:CachedWlanSsid    = "Disconnected"

function Get-NetworkMetrics {
    $IPConfig = Get-NetIPInterface -AddressFamily IPv4 -ConnectionState Connected -ErrorAction SilentlyContinue | 
                Where-Object { $_.InterfaceAlias -notlike "*Loopback*" -and $_.InterfaceAlias -notlike "*vEthernet*" } | 
                Select-Object -First 1
    
    $IntIPv4       = "0.0.0.0"
    $SubMask       = "0.0.0.0"
    $Gateway       = "0.0.0.0"
    $NetProfileStr = "Disconnected"
    $LinkCap       = "0 Mbps"
    $EthDriver     = "Not Present / Inactive"
    $WifiDriver    = "Not Present / Inactive"

    if ($null -ne $IPConfig) {
        $NetProf = Get-NetConnectionProfile -InterfaceIndex $IPConfig.InterfaceIndex -ErrorAction SilentlyContinue
        if ($NetProf) { $NetProfileStr = $NetProf.NetworkCategory.ToString() }

        $IPAddr = Get-NetIPAddress -InterfaceIndex $IPConfig.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue | Select-Object -First 1
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

        if ($IPConfig.LinkSpeed -gt 0) {
            $SpeedGbps = [math]::Round(($IPConfig.LinkSpeed / 1GB), 1)
            $LinkCap = if ($SpeedGbps -ge 1) { "$SpeedGbps Gbps" } else { "$([int]($IPConfig.LinkSpeed / 1MB)) Mbps" }
        }
    }

    # Adapter status & link capacity via single fast Get-NetAdapter call
    $AdapterStatuses = @()
    try {
        $AllAdapters = Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { $_.Status -ne "Not Present" -and -not $_.Virtual }
        if (-not $AllAdapters) {
            $AllAdapters = Get-NetAdapter -Physical -ErrorAction SilentlyContinue
        }
        foreach ($Adapter in $AllAdapters) {
            if ($null -ne $IPConfig -and $Adapter.InterfaceIndex -eq $IPConfig.InterfaceIndex -and $LinkCap -eq "0 Mbps") {
                $LinkCap = $Adapter.LinkSpeed
            }

            $isWifi = ($Adapter.Name -like "*Wireless*" -or $Adapter.Name -like "*Wi-Fi*" -or $Adapter.InterfaceDescription -like "*Wireless*" -or $Adapter.InterfaceDescription -like "*Wi-Fi*")
            $isEth  = ($Adapter.Name -like "*Ethernet*" -or $Adapter.InterfaceDescription -like "*Ethernet*" -or $Adapter.InterfaceDescription -like "*Gigabit*" -or $Adapter.InterfaceDescription -like "*Realtek*")

            if ($isWifi) { $WifiDriver = $Adapter.InterfaceDescription }
            elseif ($isEth) { $EthDriver = $Adapter.InterfaceDescription }

            $type = if ($isWifi) { "Wi-Fi" } elseif ($isEth) { "Ethernet" } else { "Other" }
            $statusStr = if ($Adapter.Status -eq "Up") { 
                "On" 
            } elseif ($Adapter.Status -eq "Disabled" -or $Adapter.AdminStatus -eq "Down") { 
                "Off" 
            } else { 
                "D/C" 
            }

            $AdapterStatuses += [PSCustomObject]@{
                Name        = [string]$Adapter.Name
                Description = [string]$Adapter.InterfaceDescription
                Type        = [string]$type
                Status      = [string]$statusStr
                RawStatus   = [string]$Adapter.Status
            }
        }
    } catch {}

    # Refresh WLAN SSID every 3 seconds (avoids spawning netsh every 1s)
    if (([datetime]::Now - $script:LastWlanCheck).TotalSeconds -ge 3) {
        $WlanSsid = "Disconnected"
        try {
            $WlanOutput = netsh wlan show interfaces
            $interfaceIsConnected = $false
            foreach ($line in $WlanOutput) {
                if ($line -match 'State\s+:\s+connected') { $interfaceIsConnected = $true }
                if ($interfaceIsConnected -and $line -match '^\s+SSID\s+:\s+(.*)$') {
                    $Found = $Matches[1].Trim()
                    if ($Found -and $line -notmatch "BSSID") {
                        $WlanSsid = $Found
                        break
                    }
                }
                if ($line -match '^Name') { $interfaceIsConnected = $false }
            }
        } catch {}
        $script:CachedWlanSsid = $WlanSsid
        $script:LastWlanCheck  = [datetime]::Now
    }

    $DhcpStatus = "Static"
    if ($null -ne $IPConfig -and $IPConfig.Dhcp -eq 'Enabled') { $DhcpStatus = "DHCP" }

    # Refresh slow external IP, Firewall, Defender, Discovery & Sharing rules every 30 seconds
    if (([datetime]::Now - $script:LastSlowNetCheck).TotalSeconds -ge 30) {
        try {
            $WebClient = New-Object System.Net.WebClient
            $WebClient.Headers.Add("user-agent", "curl/7.81.0")
            $DownloadTask = $WebClient.DownloadStringTaskAsync("https://api.ipify.org")
            if ($DownloadTask.Wait(350)) { $script:CachedExtIPv4 = $DownloadTask.Result.Trim() } else { $script:CachedExtIPv4 = "Gateway Latency" }
        } catch { $script:CachedExtIPv4 = "Offline / Secure Mesh" }

        $FirewallStatus = "Off"
        $FirewallProvider = "Windows Firewall"
        try {
            $Profiles = Get-NetFirewallProfile -ErrorAction SilentlyContinue
            if ($Profiles | Where-Object { $_.Enabled -eq 'True' }) { $FirewallStatus = "On" }
            $FwProduct = Get-CimInstance -Namespace "root\SecurityCenter2" -ClassName FirewallProduct -ErrorAction SilentlyContinue | Select-Object -First 1
            if ($FwProduct) { $FirewallProvider = $FwProduct.displayName }
        } catch {}
        $script:CachedFirewall = "$FirewallStatus ($FirewallProvider)"

        $RealtimeStatus = "Off"
        try {
            $MpStatus = Get-MpComputerStatus -ErrorAction SilentlyContinue
            if ($MpStatus -and $MpStatus.RealTimeProtectionEnabled) {
                $RealtimeStatus = "On"
            } else {
                $AvProduct = Get-CimInstance -Namespace "root\SecurityCenter2" -ClassName AntiVirusProduct -ErrorAction SilentlyContinue
                if ($AvProduct | Where-Object { $_.productState -match '262144|266240' }) { $RealtimeStatus = "On" }
            }
        } catch { $RealtimeStatus = "Unknown" }
        $script:CachedRealtime = $RealtimeStatus

        $DiscoveryStatus = "Off"
        try {
            $DiscoveryRules = Get-NetFirewallRule -Name "FPS-LLMNR-In-UDP", "FPS-SSDP-In-UDP" -ErrorAction SilentlyContinue
            if ($DiscoveryRules | Where-Object { $_.Enabled -eq 'True' }) { $DiscoveryStatus = "On" }
        } catch {}
        $script:CachedDiscovery = $DiscoveryStatus

        $SharingStatus = "Off"
        try {
            $SharingRule = Get-NetFirewallRule -Name "FPS-SMB-In-TCP" -ErrorAction SilentlyContinue
            if ($SharingRule -and $SharingRule.Enabled -eq 'True') { $SharingStatus = "On" }
        } catch {}
        $script:CachedSharing = $SharingStatus

        $script:LastSlowNetCheck = [datetime]::Now
    }

    return [PSCustomObject]@{
        IntIPv4         = [string]$IntIPv4
        SubnetMask      = [string]$SubMask
        Gateway         = [string]$Gateway
        NetworkStatus   = [string]$NetProfileStr
        WlanSsid        = [string]$script:CachedWlanSsid
        ExtIPv4         = [string]$script:CachedExtIPv4
        LinkCap         = [string]$LinkCap
        Discovery       = [string]$script:CachedDiscovery
        Firewall        = [string]$script:CachedFirewall
        Realtime        = [string]$script:CachedRealtime
        Sharing         = [string]$script:CachedSharing
        lblEthDriver    = [string]$EthDriver
        lblWifiDriver   = [string]$WifiDriver
        NetAssignment   = [string]$DhcpStatus
        AdapterStatuses = @($AdapterStatuses)
    }
}
