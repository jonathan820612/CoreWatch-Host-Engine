[CmdletBinding()]
param()

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
    return [PSCustomObject]@{ type = "REFRESH_ADAPTER_STATE"; interfaces = $InterfaceCollection } | ConvertTo-Json -Compress
}

function Show-NetworkManagerWindow {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory=$true)]
        [string]$RootPath
    )

    $script:SubForm = New-Object System.Windows.Forms.Form
    $script:SubForm.Text = "CoreWatch Network Manager Sub-Module"
    $script:SubForm.Size = New-Object System.Drawing.Size(600, 480)
    $script:SubForm.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen
    $script:SubForm.BackColor = [System.Drawing.Color]::FromArgb(33, 41, 54)
    $script:SubForm.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
    $script:SubForm.KeyPreview = $true

    $script:SubForm.Add_KeyDown({
        param($evtSource, $evtArgs)
        if ($evtArgs.KeyCode -eq [System.Windows.Forms.Keys]::Escape) { $script:SubForm.Close() }
    })

    $HeaderGripBar = New-Object System.Windows.Forms.Panel
    $HeaderGripBar.Dock = [System.Windows.Forms.DockStyle]::Top
    $HeaderGripBar.Height = 35
    $HeaderGripBar.BackColor = [System.Drawing.Color]::FromArgb(26, 32, 44)
    $script:SubForm.Controls.Add($HeaderGripBar)

    $btnNativeClose = New-Object System.Windows.Forms.Button
    $btnNativeClose.Text = "✕"
    $btnNativeClose.Font = New-Object System.Drawing.Font("Consolas", 10, [System.Drawing.FontStyle]::Bold)
    $btnNativeClose.ForeColor = [System.Drawing.Color]::White
    $btnNativeClose.BackColor = [System.Drawing.Color]::FromArgb(239, 68, 68)
    $btnNativeClose.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
    $btnNativeClose.FlatAppearance.BorderSize = 0
    $btnNativeClose.SetBounds(560, 4, 35, 26)
    $btnNativeClose.Add_Click({ $script:SubForm.Close() })
    $HeaderGripBar.Controls.Add($btnNativeClose)

    $script:DragStateActive = $false
    $script:DragCursorOrigin = [System.Drawing.Point]::Empty

    $HeaderGripBar.Add_MouseDown({
        param($evtSource, $evtArgs)
        if ($evtArgs.Button -eq [System.Windows.Forms.MouseButtons]::Left -and $evtArgs.X -lt 550) {
            $script:DragStateActive = $true
            $script:DragCursorOrigin = New-Object System.Drawing.Point($evtArgs.X, $evtArgs.Y)
        }
    })
    $HeaderGripBar.Add_MouseMove({
        param($evtSource, $evtArgs)
        if ($script:DragStateActive) {
            $CurrentPos = [System.Windows.Forms.Cursor]::Position
            $script:SubForm.Location = New-Object System.Drawing.Point(($CurrentPos.X - $script:DragCursorOrigin.X), ($CurrentPos.Y - $script:DragCursorOrigin.Y))
        }
    })
    $HeaderGripBar.Add_MouseUp({ $script:DragStateActive = $false })

    $CanvasPanel = New-Object System.Windows.Forms.Panel
    $CanvasPanel.Dock = [System.Windows.Forms.DockStyle]::Fill
    $script:SubForm.Controls.Add($CanvasPanel)

    $script:SubWindowWebViewControl = New-Object Microsoft.Web.WebView2.WinForms.WebView2
    $script:SubWindowWebViewControl.Dock = [System.Windows.Forms.DockStyle]::Fill
    $CanvasPanel.Controls.Add($script:SubWindowWebViewControl)

function Invoke-SubWindowTransmission {
    param($PayloadString)
    if ($null -ne $script:SubWindowWebViewControl.CoreWebView2 -and $null -ne $PayloadString) {
        # Fix: Encode to UTF8 bytes and pack into a uniform Base64 stream matching app.js expectations
        $TextBytes = [System.Text.Encoding]::UTF8.GetBytes($PayloadString)
        $Base64Payload = [Convert]::ToBase64String($TextBytes)
        $script:SubWindowWebViewControl.CoreWebView2.PostWebMessageAsString($Base64Payload)
    }
}

    $HandleSubUiMessageEvent = {
        param($evtSource, $evtArgs)
        $Msg = $evtArgs.TryGetWebMessageAsString()
        if ($null -eq $Msg) { return }

        if ($Msg -eq "Exit-App") { $script:SubForm.Close() }
        elseif ($Msg -eq "UI-Ready") {
            Invoke-SubWindowTransmission (Get-AdapterStateMesh)
        }
        elseif ($Msg.StartsWith("{") -or $Msg.StartsWith("[")) {
            try {
                $Payload = $Msg | ConvertFrom-Json
                if ($Payload.command -eq "SET_STATIC_IP") {
                    Remove-NetIPAddress -InterfaceAlias $Payload.interfaceAlias -AddressFamily IPv4 -Confirm:$false -ErrorAction SilentlyContinue
                    Remove-NetRoute -InterfaceAlias $Payload.interfaceAlias -DestinationPrefix "0.0.0.0/0" -Confirm:$false -ErrorAction SilentlyContinue
                    New-NetIPAddress -InterfaceAlias $Payload.interfaceAlias -IPAddress $Payload.ipAddress -PrefixLength 24 -Confirm:$false
                }
                elseif ($Payload.command -eq "TRIGGER_DHCP_REVERSION") {
                    Set-NetIPInterface -InterfaceAlias $Payload.interfaceAlias -Dhcp Enabled -Confirm:$false
                    Set-DnsClientServerAddress -InterfaceAlias $Payload.interfaceAlias -ResetServerAddresses -Confirm:$false
                }
                Invoke-SubWindowTransmission (Get-AdapterStateMesh)
            } catch {}
        }
    }

    $UserDataFolder = [System.IO.Path]::GetFullPath((Join-Path $RootPath "bin\WebView2UserData"))
    $FixedRuntimePath = Join-Path $RootPath "bin\WebView2FixedRuntime"
    $BrowserFolder = if (Test-Path $FixedRuntimePath) { [System.IO.Path]::GetFullPath($FixedRuntimePath) } else { $null }
    
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
}
