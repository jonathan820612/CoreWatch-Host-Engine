[CmdletBinding()]
param()

/**
 * Compiles a raw, un-compressed data object mapping active physical network interfaces.
 * REMOVED: ConvertTo-Json -Compress has been extracted to prevent double-serialization bugs downstream.
 */
function Get-AdapterStateMesh {
    [CmdletBinding()]
    param()
    
    $ActiveInterfaces = Get-NetIPInterface -AddressFamily IPv4 -ConnectionState Connected | 
        Where-Object { $_.InterfaceAlias -notlike "*Loopback*" -and $_.InterfaceAlias -notlike "*Pseudo*" }

    $InterfaceCollection = foreach ($InterfaceSource in $ActiveInterfaces) {
        $IPAddressRecord = Get-NetIPAddress -InterfaceIndex $InterfaceSource.InterfaceIndex -AddressFamily IPv4 | Select-Object -First 1
        $RouteRecord  = Get-NetRoute -InterfaceIndex $InterfaceSource.InterfaceIndex -DestinationPrefix "0.0.0.0/0" -ErrorAction SilentlyContinue | Select-Object -First 1
        
        $PrefixInt = if ($IPAddressRecord) { $IPAddressRecord.PrefixLength } else { 24 }
        $MaskString = switch ($PrefixInt) {
            8  { "255.0.0.0" }
            16 { "255.255.0.0" }
            24 { "255.255.255.0" }
            32 { "255.255.255.255" }
            Default { "255.255.255.0" }
        }

        [PSCustomObject]@{
            Alias        = [string]$InterfaceSource.InterfaceAlias
            IPAddress    = if ($IPAddressRecord) { [string]$IPAddressRecord.IPAddress } else { "0.0.0.0" }
            SubnetMask   = [string]$MaskString
            PrefixLength = [int]$PrefixInt
            Gateway      = if ($RouteRecord) { [string]$RouteRecord.NextHop } else { "N/A" }
            Profile      = if ($InterfaceSource.Dhcp -eq 'Enabled') { "DHCP" } else { "Static" }
        }
    }
    
    # Return a raw object structure so the main application loop handles encoding uniformly
    return [PSCustomObject]@{ 
        type       = "REFRESH_ADAPTER_STATE" 
        interfaces = @($InterfaceCollection) 
    }
}

/**
 * Dedicated provisioning utility designed to run smoothly on the primary thread context.
 */
function Invoke-AdapterProvisioningControl {
    param(
        [Parameter(Mandatory=$true)]
        [string]$PayloadMessageString
    )
    
<<<<<<< HEAD
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
        elif ($Payload.command -eq "TRIGGER_DHCP_REVERSION") {
            # Re-enable standard DHCP leasing interfaces and drop manually bound routes
            Set-NetIPInterface -InterfaceAlias $Payload.interfaceAlias -Dhcp Enabled -Confirm:$false
            Set-DnsClientServerAddress -InterfaceAlias $Payload.interfaceAlias -ResetServerAddresses -Confirm:$false
        }
    } catch {
        Write-Warning "Network engine failed to commit hardware rule changes: $_"
    }
    
    # Instantly compile a fresh post-change data frame back to the calling loop
    return Get-AdapterStateMesh
=======
    $EnvTask = [Microsoft.Web.WebView2.Core.CoreWebView2Environment]::CreateAsync($BrowserFolder, $UserDataFolder)
    
    while (-not $EnvTask.IsCompleted) {
        [System.Windows.Forms.Application]::DoEvents()
        [System.Threading.Thread]::Sleep(10)
    }
    
    $script:SubWindowWebViewControl.Add_CoreWebView2InitializationCompleted({
        param($source, $args)
        if ($args.IsSuccess) {
            $script:SubWindowWebViewControl.CoreWebView2.Settings.AreDefaultContextMenusEnabled = $false
            $script:SubWindowWebViewControl.CoreWebView2.Settings.AreDevToolsEnabled = $true
            $script:SubWindowWebViewControl.Add_WebMessageReceived($HandleSubUiMessageEvent)
            
            # Safe absolute URI conversion
            $HtmlFullPath = [System.IO.Path]::GetFullPath((Join-Path $RootPath "modules\layouts\network-manager.html"))
            $UriObject = New-Object System.Uri($HtmlFullPath)
            $script:SubWindowWebViewControl.CoreWebView2.Navigate($UriObject.AbsoluteUri)
        }
    })
    
    # ─── FIXED CRITICAL LIFECYCLE ORDER ─────────────────────────────
    
    # 1. Force the parent form to create its Win32 Handle immediately
    $script:SubForm.CreateControl()
    
    # 2. Render the window frame layout to the OS desktop structure
    $script:SubForm.Show()
    
    # 3. Pump application message loop once to guarantee handles exist in memory
    [System.Windows.Forms.Application]::DoEvents()
    
    # 4. Trigger engine context allocation safely over the active handle frame
    $null = $script:SubWindowWebViewControl.EnsureCoreWebView2Async($EnvTask.Result)
>>>>>>> 8e1f6f6539920cf932b534cb9a19b0aa2849f537
}
