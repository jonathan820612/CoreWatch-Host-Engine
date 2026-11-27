[CmdletBinding()]
param()

<# 
    Compiles a comprehensive data object mapping active network hardware interfaces.
#>
function Get-AdapterStateMesh {
    [CmdletBinding()]
    param()

    try {
        $PhysicalAdapters = Get-NetAdapter | Where-Object { $_.Status -ne "Not Present" -and -not $_.Virtual } -ErrorAction SilentlyContinue
        if (-not $PhysicalAdapters) {
            $PhysicalAdapters = Get-NetAdapter -Physical -ErrorAction SilentlyContinue
        }

        $InterfaceCollection = foreach ($Adapter in $PhysicalAdapters) {
            $IPAddressRecord = Get-NetIPAddress -InterfaceAlias $Adapter.Name -AddressFamily IPv4 -ErrorAction SilentlyContinue | Select-Object -First 1
            $RouteRecord     = Get-NetRoute -InterfaceAlias $Adapter.Name -DestinationPrefix "0.0.0.0/0" -ErrorAction SilentlyContinue | Select-Object -First 1
            $IPInterface     = Get-NetIPInterface -InterfaceAlias $Adapter.Name -AddressFamily IPv4 -ErrorAction SilentlyContinue
            $DnsRecord       = Get-DnsClientServerAddress -InterfaceAlias $Adapter.Name -AddressFamily IPv4 -ErrorAction SilentlyContinue

            $PrefixInt = if ($IPAddressRecord) { $IPAddressRecord.PrefixLength } else { 24 }
            $MaskString = switch ($PrefixInt) {
                8       { "255.0.0.0" }
                16      { "255.255.0.0" }
                24      { "255.255.255.0" }
                32      { "255.255.255.255" }
                Default { "255.255.255.0" }
            }

            $dnsServers = if ($DnsRecord -and $DnsRecord.ServerAddresses) { $DnsRecord.ServerAddresses -join ", " } else { "DHCP / Automatic" }

            [PSCustomObject]@{
                Alias                = [string]$Adapter.Name
                InterfaceDescription = [string]$Adapter.InterfaceDescription
                InterfaceGuid        = [string]$Adapter.InterfaceGuid
                MediaType            = [string]$Adapter.MediaType 
                MacAddress           = [string]$Adapter.MacAddress
                LinkSpeed            = [string]$Adapter.LinkSpeed
                IPAddress            = if ($IPAddressRecord) { [string]$IPAddressRecord.IPAddress } else { "Disconnected" }
                SubnetMask           = [string]$MaskString
                PrefixLength         = [int]$PrefixInt
                Gateway              = if ($RouteRecord) { [string]$RouteRecord.NextHop } else { "N/A" }
                DnsServers           = [string]$dnsServers
                Profile              = if ($IPInterface -and $IPInterface.Dhcp -eq "Enabled") { "DHCP" } else { "Static" }
                Status               = [string]$Adapter.Status
                AdminStatus          = [string]$Adapter.AdminStatus
            }
        }

        return @{ 
            type       = "REFRESH_ADAPTER_STATE" 
            interfaces = @($InterfaceCollection)
            error      = $null
        }
    } catch {
        return @{
            type       = "REFRESH_ADAPTER_STATE"
            interfaces = @()
            error      = $_.Exception.Message
        }
    }
}

function Invoke-AdapterProvisioningControl {
    param(
        [Parameter(Mandatory=$true)]
        $Payload
    )
    
    # If passed as string, deserialize safely
    if ($Payload -is [string]) {
        $Payload = $Payload | ConvertFrom-Json
    }

    if ($null -eq $Payload -or $null -eq $Payload.command) { return $null }

    $msg = "Action completed."
    try {
        if ($Payload.command -eq "SET_STATIC_IP") {
            $alias = [string]$Payload.interfaceAlias
            $ip    = [string]$Payload.ipAddress
            $mask  = if ($Payload.subnetMask) { [string]$Payload.subnetMask } else { "255.255.255.0" }
            $gw    = [string]$Payload.gateway
            $dns   = [string]$Payload.dns

            $prefix = switch ($mask) {
                "255.0.0.0"       { 8 }
                "255.255.0.0"     { 16 }
                "255.255.255.0"   { 24 }
                "255.255.255.255" { 32 }
                Default           { 24 }
            }

            # Remove conflicting IPv4 addresses and default gateways
            Remove-NetIPAddress -InterfaceAlias $alias -AddressFamily IPv4 -Confirm:$false -ErrorAction SilentlyContinue
            Remove-NetRoute -InterfaceAlias $alias -DestinationPrefix "0.0.0.0/0" -Confirm:$false -ErrorAction SilentlyContinue

            # Assign static IP and prefix
            New-NetIPAddress -InterfaceAlias $alias -IPAddress $ip -PrefixLength $prefix -Confirm:$false -ErrorAction Stop

            # Assign gateway if specified
            if ($gw -and $gw -ne "N/A" -and $gw -ne "0.0.0.0") {
                New-NetRoute -InterfaceAlias $alias -DestinationPrefix "0.0.0.0/0" -NextHop $gw -Confirm:$false -ErrorAction SilentlyContinue
            }

            # Assign DNS if specified
            if ($dns -and $dns -ne "DHCP / Automatic") {
                $dnsArr = $dns.Split(",") | ForEach-Object { $_.Trim() } | Where-Object { $_ }
                if ($dnsArr.Count -gt 0) {
                    Set-DnsClientServerAddress -InterfaceAlias $alias -ServerAddresses $dnsArr -Confirm:$false -ErrorAction SilentlyContinue
                }
            }
            $msg = "Static IP configured on [$alias]."
        }
        elseif ($Payload.command -eq "TRIGGER_DHCP_REVERSION") {
            $alias = [string]$Payload.interfaceAlias
            Set-NetIPInterface -InterfaceAlias $alias -Dhcp Enabled -Confirm:$false -ErrorAction Stop
            Set-DnsClientServerAddress -InterfaceAlias $alias -ResetServerAddresses -Confirm:$false -ErrorAction SilentlyContinue
            $msg = "Reverted [$alias] to DHCP automatic addressing."
        }
        elseif ($Payload.command -eq "SET_CUSTOM_DNS") {
            $alias = [string]$Payload.interfaceAlias
            $dns = [string]$Payload.dns
            if (-not $dns -or $dns -eq "DHCP" -or $dns -eq "Reset") {
                Set-DnsClientServerAddress -InterfaceAlias $alias -ResetServerAddresses -Confirm:$false -ErrorAction SilentlyContinue
                $msg = "Reset DNS to DHCP on [$alias]."
            } else {
                $dnsArr = $dns.Split(",") | ForEach-Object { $_.Trim() } | Where-Object { $_ }
                Set-DnsClientServerAddress -InterfaceAlias $alias -ServerAddresses $dnsArr -Confirm:$false -ErrorAction Stop
                $msg = "Configured DNS resolvers on [$alias]: $dns"
            }
        }
        elseif ($Payload.command -eq "FLUSH_DNS_CACHE") {
            Clear-DnsClientCache -ErrorAction Stop
            $msg = "Windows DNS client resolver cache flushed successfully."
        }
        elseif ($Payload.command -eq "RESTART_ADAPTER") {
            $alias = [string]$Payload.interfaceAlias
            Restart-NetAdapter -Name $alias -Confirm:$false -ErrorAction Stop
            $msg = "Restarted network adapter [$alias]."
        }
        elseif ($Payload.command -eq "RENAME_ADAPTER") {
            $alias = [string]$Payload.interfaceAlias
            $newName = if ($Payload.newAlias) { [string]$Payload.newAlias } else { [string]$Payload.newName }
            Rename-NetAdapter -Name $alias -NewName $newName -Confirm:$false -ErrorAction Stop
            $msg = "Renamed adapter to [$newName]."
        }
        elseif ($Payload.command -eq "TOGGLE_ADAPTER_STATE") {
            $alias = [string]$Payload.interfaceAlias
            $Current = Get-NetAdapter -Name $alias -ErrorAction SilentlyContinue
            $shouldEnable = if ($Payload.targetState -eq "On") {
                $true
            } elseif ($Payload.targetState -eq "Off") {
                $false
            } else {
                ($Current -and ($Current.Status -eq "Disabled" -or $Current.AdminStatus -eq "Down"))
            }

            try {
                if ($shouldEnable) {
                    Enable-NetAdapter -Name $alias -Confirm:$false -ErrorAction Stop
                    $msg = "Enabled network adapter [$alias]."
                } else {
                    Disable-NetAdapter -Name $alias -Confirm:$false -ErrorAction Stop
                    $msg = "Disabled network adapter [$alias]."
                }
            } catch {
                $adminState = if ($shouldEnable) { "enable" } else { "disable" }
                netsh interface set interface name="$alias" admin=$adminState
                $msg = "Adapter [$alias] toggled via netsh."
            }
        }
    } catch {
        $state = Get-AdapterStateMesh
        $state.error = $_.Exception.Message
        return $state
    }
    
    $result = Get-AdapterStateMesh
    $result.message = $msg
    return $result
}
