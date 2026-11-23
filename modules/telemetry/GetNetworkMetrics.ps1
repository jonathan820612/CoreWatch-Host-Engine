# File: modules/telemetry/GetNetworkMetrics.ps1

$script:LastSlowNetCheck  = [datetime]::MinValue
$script:CachedExtIPv4     = "Resolving..."
$script:CachedFirewall    = "Unknown"
$script:CachedRealtime    = "Unknown"
$script:CachedDiscovery   = "Off"
$script:CachedSharing     = "Off"
$script:LastWlanCheck     = [datetime]::MinValue
$script:CachedWlanSsid    = "Disconnected"

function Convert-PrefixLengthToMask {
    param([int]$PrefixLength)
    if ($PrefixLength -le 0) { return "0.0.0.0" }
    if ($PrefixLength -ge 32) { return "255.255.255.255" }
    [uint32]$maskInt = [uint32](4294967296.0 - [math]::Pow(2, (32 - $PrefixLength)))
    $bytes = [BitConverter]::GetBytes($maskInt)
    [Array]::Reverse($bytes)
    return ($bytes -join ".")
}

function Get-NetworkMetrics {
    # Prefer the interface owning the lowest-metric IPv4 default gateway (active internet uplink)
    $PrimaryRoute = Get-NetRoute -DestinationPrefix "0.0.0.0/0" -AddressFamily IPv4 -ErrorAction SilentlyContinue |
                    Sort-Object RouteMetric, InterfaceMetric | Select-Object -First 1

    $IPConfig = $null
    if ($PrimaryRoute) {
        $IPConfig = Get-NetIPInterface -InterfaceIndex $PrimaryRoute.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue | Select-Object -First 1
    }
    if (-not $IPConfig) {
        $IPConfig = Get-NetIPInterface -AddressFamily IPv4 -ConnectionState Connected -ErrorAction SilentlyContinue |
                    Where-Object { $_.InterfaceAlias -notlike "*Loopback*" -and $_.InterfaceAlias -notlike "*vEthernet*" } |
                    Sort-Object InterfaceMetric | Select-Object -First 1
    }
    
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
            $SubMask = Convert-PrefixLengthToMask -PrefixLength ([int]$IPAddr.PrefixLength)
        }
        $Route = if ($PrimaryRoute -and $PrimaryRoute.InterfaceIndex -eq $IPConfig.InterfaceIndex) {
            $PrimaryRoute
        } else {
            Get-NetRoute -InterfaceIndex $IPConfig.InterfaceIndex -DestinationPrefix "0.0.0.0/0" -ErrorAction SilentlyContinue | Select-Object -First 1
        }
        if ($Route) { $Gateway = $Route.NextHop }

        if ($IPConfig.LinkSpeed -gt 0) {
            $SpeedGbps = [math]::Round(($IPConfig.LinkSpeed / 1GB), 1)
            $LinkCap = if ($SpeedGbps -ge 1) { "$SpeedGbps Gbps" } else { "$([int]($IPConfig.LinkSpeed / 1MB)) Mbps" }
        }
    }

    # Adapter status & link capacity via single fast Get-NetAdapter call
    $AdapterStatuses = @()
    $ConnectedWifiIndex = $null
    try {
        $AllAdapters = Get-NetAdapter -ErrorAction SilentlyContinue | Where-Object { $_.Status -ne "Not Present" -and -not $_.Virtual }
        if (-not $AllAdapters) {
            $AllAdapters = Get-NetAdapter -Physical -ErrorAction SilentlyContinue
        }
        foreach ($Adapter in $AllAdapters) {
            if ($null -ne $IPConfig -and $Adapter.InterfaceIndex -eq $IPConfig.InterfaceIndex -and $LinkCap -eq "0 Mbps") {
                $LinkCap = $Adapter.LinkSpeed
            }

            $isWifi = ($Adapter.MediaType -eq "Native 802.11" -or $Adapter.Name -like "*Wireless*" -or $Adapter.Name -like "*Wi-Fi*" -or $Adapter.Name -like "*WiFi*" -or $Adapter.InterfaceDescription -like "*Wireless*" -or $Adapter.InterfaceDescription -like "*Wi-Fi*" -or $Adapter.InterfaceDescription -like "*WiFi*")
            $isEth  = (-not $isWifi) -and ($Adapter.Name -like "*Ethernet*" -or $Adapter.Name -like "*Wired*" -or $Adapter.InterfaceDescription -like "*Ethernet*" -or $Adapter.InterfaceDescription -like "*Gigabit*" -or $Adapter.InterfaceDescription -like "*Realtek*")

            if ($isWifi) {
                $WifiDriver = $Adapter.InterfaceDescription
                if ($Adapter.Status -eq "Up" -and $null -eq $ConnectedWifiIndex) {
                    $ConnectedWifiIndex = $Adapter.InterfaceIndex
                }
            }
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

    # Refresh WLAN SSID every 3 seconds (handles Windows 11 24H2/25H2 Location privacy fallback)
    if (([datetime]::Now - $script:LastWlanCheck).TotalSeconds -ge 3) {
        $WlanSsid = "Disconnected"
        $netshBlocked = $false
        try {
            $WlanOutput = netsh wlan show interfaces 2>&1
            $interfaceIsConnected = $false
            foreach ($line in $WlanOutput) {
                $lineStr = [string]$line
                if ($lineStr -match '(?i)location permission|error 5|requires elevation') {
                    $netshBlocked = $true
                    break
                }
                if ($lineStr -match 'State\s+:\s+connected') { $interfaceIsConnected = $true }
                if ($interfaceIsConnected -and $lineStr -match '^\s+SSID\s+:\s+(.*)$') {
                    $Found = $Matches[1].Trim()
                    if ($Found -and $lineStr -notmatch "BSSID") {
                        $WlanSsid = $Found
                        break
                    }
                }
                if ($lineStr -match '^Name') { $interfaceIsConnected = $false }
            }
        } catch {}

        # Fallback when netsh is blocked by Windows 11 24H2/25H2 Location Privacy (or unprivileged run)
        if ($WlanSsid -eq "Disconnected" -and $null -ne $ConnectedWifiIndex) {
            try {
                $WifiProfile = Get-NetConnectionProfile -InterfaceIndex $ConnectedWifiIndex -ErrorAction SilentlyContinue | Select-Object -First 1
                if ($WifiProfile -and $WifiProfile.Name) {
                    $WlanSsid = [string]$WifiProfile.Name
                } elseif ($netshBlocked) {
                    $WlanSsid = "Connected (Location Off)"
                } else {
                    $WlanSsid = "Connected"
                }
            } catch {
                $WlanSsid = if ($netshBlocked) { "Connected (Location Off)" } else { "Connected" }
            }
        }

        $script:CachedWlanSsid = $WlanSsid
        $script:LastWlanCheck  = [datetime]::Now
    }

    $DhcpStatus = "Static"
    if ($null -ne $IPConfig -and $IPConfig.Dhcp -eq 'Enabled') { $DhcpStatus = "DHCP" }

    # Refresh slow external IP, Firewall, Defender, Discovery & Sharing rules every 30 seconds
    if (([datetime]::Now - $script:LastSlowNetCheck).TotalSeconds -ge 30) {
        $WebClient = $null
        try {
            $WebClient = New-Object System.Net.WebClient
            $WebClient.Headers.Add("user-agent", "curl/7.81.0")
            $DownloadTask = $WebClient.DownloadStringTaskAsync("https://api.ipify.org")
            if ($DownloadTask.Wait(1500)) { $script:CachedExtIPv4 = $DownloadTask.Result.Trim() } else { $script:CachedExtIPv4 = "Gateway Latency" }
        } catch { $script:CachedExtIPv4 = "Offline / Secure Mesh" }
        finally { if ($WebClient) { $WebClient.Dispose() } }

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
