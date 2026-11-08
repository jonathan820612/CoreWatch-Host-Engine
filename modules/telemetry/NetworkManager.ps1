[CmdletBinding()]
param()

<# 
Compiles a raw, un-compressed data object mapping active physical network interfaces.
REMOVED: ConvertTo-Json -Compress has been extracted to prevent double-serialization bugs downstream.
#>
function Get-AdapterStateMesh {
    [CmdletBinding()]
    param()

    $PhysicalAdapters = Get-NetAdapter | Where-Object { $_.Status -ne "Not Present" -and $_.Virtual -eq $false }

    $InterfaceCollection = foreach ($Adapter in $PhysicalAdapters) {
        $IPAddressRecord = Get-NetIPAddress -InterfaceAlias $Adapter.Name -AddressFamily IPv4 -ErrorAction SilentlyContinue | Select-Object -First 1
        $RouteRecord  = Get-NetRoute -InterfaceAlias $Adapter.Name -DestinationPrefix "0.0.0.0/0" -ErrorAction SilentlyContinue | Select-Object -First 1
        $IPInterface = Get-NetIPInterface -InterfaceAlias $Adapter.Name -AddressFamily IPv4 -ErrorAction SilentlyContinue
        
        $PrefixInt = if ($IPAddressRecord) { $IPAddressRecord.PrefixLength } else { 24 }
        $MaskString = switch ($PrefixInt) {
            8  { "255.0.0.0" }
            16 { "255.255.0.0" }
            24 { "255.255.255.0" }
            32 { "255.255.255.255" }
            Default { "255.255.255.0" }
        }

        [PSCustomObject]@{
            Alias         = [string]$Adapter.Name
            InterfaceGuid = [string]$Adapter.InterfaceGuid
            # Fixed: Simply cast to string. If null, it becomes ""
            MediaType     = [string]$Adapter.MediaType 
            IPAddress     = if ($IPAddressRecord) { [string]$IPAddressRecord.IPAddress } else { "Disconnected" }
            SubnetMask    = [string]$MaskString
            PrefixLength  = [int]$PrefixInt
            Gateway       = if ($RouteRecord) { [string]$RouteRecord.NextHop } else { "N/A" }
            Profile       = if ($IPInterface.Dhcp -eq 'Enabled') { "DHCP" } else { "Static" }
            Status        = [string]$Adapter.Status
        }
    }
    
    # Return a raw object structure so the main application loop handles encoding uniformly
    return [PSCustomObject]@{ 
        type       = "REFRESH_ADAPTER_STATE" 
        interfaces = @($InterfaceCollection) 
    }
}
function Invoke-AdapterProvisioningControl {
    param(
        [Parameter(Mandatory=$true)]
        [string]$PayloadMessageString
    )
    
    try {
        $Payload = $PayloadMessageString | ConvertFrom-Json
        if ($null -eq $Payload -or $null -eq $Payload.command) { return $null }

        if ($Payload.command -eq "SET_STATIC_IP") {
            # Safely clear out conflicting static bindings and primary default gateways first
            Remove-NetIPAddress -InterfaceAlias $Payload.interfaceAlias -AddressFamily IPv4 -Confirm:$false -ErrorAction SilentlyContinue
            Remove-NetRoute -InterfaceAlias $Payload.interfaceAlias -DestinationPrefix "0.0.0.0/0" -Confirm:$false -ErrorAction SilentlyContinue
            
            # Apply the new static configuration profile layout 
            New-NetIPAddress -InterfaceAlias $Payload.interfaceAlias -IPAddress $Payload.ipAddress -PrefixLength 24 -Confirm:$false
        }
        elseif ($Payload.command -eq "TRIGGER_DHCP_REVERSION") {
            # Re-enable standard DHCP leasing interfaces and drop manually bound routes
            Set-NetIPInterface -InterfaceAlias $Payload.interfaceAlias -Dhcp Enabled -Confirm:$false
            Set-DnsClientServerAddress -InterfaceAlias $Payload.interfaceAlias -ResetServerAddresses -Confirm:$false
        }
        elseif ($Payload.command -eq "RENAME_ADAPTER") {
            # Rename the physical hardware alias
            Rename-NetAdapter -Name $Payload.interfaceAlias -NewName $Payload.newAlias -Confirm:$false
        }
    } catch {
        Write-Warning "Network engine failed to commit hardware rule changes: $_"
    }
    
    # Instantly compile a fresh post-change data frame back to the calling loop
    return Get-AdapterStateMesh
}
