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
        $Adapter = Get-NetAdapter -InterfaceIndex $IPConfig.InterfaceIndex -ErrorAction SilentlyContinue
        if ($Adapter) {
            $LinkCap = $Adapter.LinkSpeed
        }
        $Route = Get-NetRoute -InterfaceIndex $IPConfig.InterfaceIndex -DestinationPrefix "0.0.0.0/0" -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($Route) { $Gateway = $Route.NextHop }

        # FIXED: Use fast NetIPInterface capacity data to bypass heavy CIM locks
        if ($IPConfig.LinkSpeed -gt 0) {
            $SpeedGbps = [math]::Round(($IPConfig.LinkSpeed / 1GB), 1)
            $LinkCap = if ($SpeedGbps -ge 1) { "$SpeedGbps Gbps" } else { "$([int]($IPConfig.LinkSpeed / 1MB)) Mbps" }
        }
    }

    $WlanSsid = "Disconnected"
    $WlanOutput = netsh wlan show interfaces
    $interfaceIsConnected = $false

    foreach ($line in $WlanOutput) {
        # 1. Detect if this specific interface block is active
        if ($line -match 'State\s+:\s+connected') {
            $interfaceIsConnected = $true
        }
        
        # 2. If we are in a connected block, look for the SSID
        if ($interfaceIsConnected -and $line -match '^\s+SSID\s+:\s+(.*)$') {
            $Found = $Matches[1].Trim()
            # Ensure we don't accidentally grab the 'BSSID' line
            if ($Found -and $line -notmatch "BSSID") {
                $WlanSsid = $Found
                break # Exit loop once the active SSID is found
            }
        }

        # 3. Reset the connection flag if we move to a new interface block
        if ($line -match '^Name') {
            $interfaceIsConnected = $false
        }
    }
    $DiscoveryStatus = "Off"
    $SsdpRule = Get-NetFirewallRule -Name "FPS-LLMNR-In-UDP" -ErrorAction SilentlyContinue
    if ($SsdpRule -and $SsdpRule.Enabled -eq 'True') { $DiscoveryStatus = "On" }

    # FIXED: Replaced heavy Get-CimInstance queries with lightning-fast native Get-NetAdapter calls
    $AdapterStatuses = @()
    try {
        $AllAdapters = Get-NetAdapter | Where-Object { $_.Status -ne "Not Present" -and -not $_.Virtual } -ErrorAction SilentlyContinue
        if (-not $AllAdapters) {
            $AllAdapters = Get-NetAdapter -Physical -ErrorAction SilentlyContinue
        }
        foreach ($Adapter in $AllAdapters) {
            $isWifi = ($Adapter.Name -like "*Wireless*" -or $Adapter.Name -like "*Wi-Fi*" -or $Adapter.InterfaceDescription -like "*Wireless*" -or $Adapter.InterfaceDescription -like "*Wi-Fi*")
            $isEth  = ($Adapter.Name -like "*Ethernet*" -or $Adapter.InterfaceDescription -like "*Ethernet*" -or $Adapter.InterfaceDescription -like "*Gigabit*" -or $Adapter.InterfaceDescription -like "*Realtek*")

            if ($isWifi) { 
                $WifiDriver = $Adapter.InterfaceDescription 
            }
            elseif ($isEth) { 
                $EthDriver = $Adapter.InterfaceDescription 
            }

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

    $ExtIPv4 = "Resolving..."
    try {
        $WebClient = New-Object System.Net.WebClient
        $WebClient.Headers.Add("user-agent", "curl/7.81.0")
        $DownloadTask = $WebClient.DownloadStringTaskAsync("https://api.ipify.org")
        if ($DownloadTask.Wait(400)) { $ExtIPv4 = $DownloadTask.Result.Trim() } else { $ExtIPv4 = "Gateway Latency" }
    } catch { $ExtIPv4 = "Offline / Secure Mesh" }
    
    $DhcpStatus = "Static"
    if ($null -ne $IPConfig -and $IPConfig.Dhcp -eq 'Enabled') { $DhcpStatus = "DHCP" }
        # NEW: Firewall Detection Logic
    $FirewallStatus = "Off"
    $FirewallProvider = "Windows Firewall"
    try {
        # Check Windows Defender Firewall state
        $Profiles = Get-NetFirewallProfile -ErrorAction SilentlyContinue
        if ($Profiles | Where-Object { $_.Enabled -eq 'True' }) { $FirewallStatus = "On" }

        # Query Security Center for 3rd party providers (Norton, McAfee, UFC, etc.)
        $FwProduct = Get-CimInstance -Namespace "root\SecurityCenter2" -ClassName FirewallProduct -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($FwProduct) { $FirewallProvider = $FwProduct.displayName }
    } catch {}
        $RealtimeStatus = "Off"
    try {
        # Check Windows Defender specifically
        $MpStatus = Get-MpComputerStatus -ErrorAction SilentlyContinue
        if ($MpStatus -and $MpStatus.RealTimeProtectionEnabled) {
            $RealtimeStatus = "On"
        } else {
            # Fallback check for 3rd party AV via Security Center
            $AvProduct = Get-CimInstance -Namespace "root\SecurityCenter2" -ClassName AntiVirusProduct -ErrorAction SilentlyContinue
            # If a 3rd party AV is active/enabled, we consider Realtime protection 'On'
            if ($AvProduct | Where-Object { $_.productState -match '262144|266240' }) { $RealtimeStatus = "On" }
        }
    } catch { $RealtimeStatus = "Unknown" }
    $FirewallCombined = "$FirewallStatus ($FirewallProvider)"
    $DiscoveryStatus = "Off"
    try {
        $DiscoveryRules = Get-NetFirewallRule -Name "FPS-LLMNR-In-UDP", "FPS-SSDP-In-UDP" -ErrorAction SilentlyContinue
        if ($DiscoveryRules | Where-Object { $_.Enabled -eq 'True' }) {
            $DiscoveryStatus = "On"
        }
    } catch {}
    $SharingStatus = "Off"
    try {
        # Check if SMB (Server Message Block) rules are enabled
        $SharingRule = Get-NetFirewallRule -Name "FPS-SMB-In-TCP" -ErrorAction SilentlyContinue
        if ($SharingRule -and $SharingRule.Enabled -eq 'True') { $SharingStatus = "On" }
    } catch {}
    return [PSCustomObject]@{
        IntIPv4       = [string]$IntIPv4
        SubnetMask    = [string]$SubMask
        Gateway       = [string]$Gateway
        NetworkStatus = [string]$NetProfileStr
        WlanSsid      = [string]$WlanSsid
        ExtIPv4       = [string]$ExtIPv4
        LinkCap       = [string]$LinkCap
        Discovery     = [string]$DiscoveryStatus
        Firewall      = [string]$FirewallCombined
        Realtime      = [string]$RealtimeStatus
        Sharing       = [string]$SharingStatus
        lblEthDriver    = [string]$EthDriver
        lblWifiDriver   = [string]$WifiDriver
        NetAssignment   = [string]$DhcpStatus
        AdapterStatuses = @($AdapterStatuses)
    }
}
