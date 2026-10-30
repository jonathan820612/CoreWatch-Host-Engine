function Start-TelemetryCollection {
    [CmdletBinding()]
    param(
        [Parameter(Position=0, Mandatory=$true)]
        [hashtable]$DataExchange
    )

    # Base Init State Setup - Keeping your exact layout variables intact
    $DataExchange.CpuLoad = 0; $DataExchange.GpuLoad = 0
    $DataExchange.RamUsedGB = 0.00; $DataExchange.RamTotalGB = 0.00; $DataExchange.RamPercent = 0
    $DataExchange.HostName = "HOST"; $DataExchange.Workgroup = "WORKGROUP"
    $DataExchange.OsEdition = "Windows Core"; $DataExchange.CpuModel = "Processor Core"; $DataExchange.GpuModel = "Display Adapter"
    $DataExchange.PowerPlan = "Performance"; $DataExchange.Virtualization = "Off"; $DataExchange.ChassisType = "Custom PC"
    $DataExchange.PsVersion = "$($PSVersionTable.PSVersion.Major).$($PSVersionTable.PSVersion.Minor)"
    $DataExchange.BiosVersion = "Unknown"; $DataExchange.SecureBoot = "Off"; $DataExchange.LinkSpeed = "1 Gbps"
    $DataExchange.UptimeString = "0d 0h 0m"
    $DataExchange.WindowsBuild = "00000.0000"; $DataExchange.WindowsUpdateLevel = "Unknown"
    $DataExchange.DirectXVersion = "DirectX 12 Core System"; $DataExchange.CpuDriverVersion = "Unknown"
    $DataExchange.GpuDriverVersion = "Unknown"; $DataExchange.NetworkDriverVersion = "Unknown"
    $DataExchange.PublicIp = "Resolving..."
    $DataExchange.LoopActive = $true

    try {
        $Bios = Get-CimInstance -ClassName Win32_Bios -ErrorAction SilentlyContinue
        $Baseboard = Get-CimInstance -ClassName Win32_BaseBoard -ErrorAction SilentlyContinue
        $DataExchange.BiosVersion = "$($Baseboard.Product) [Firmware v$($Bios.SMBIOSBIOSVersion)]"

        $SbRegistry = Get-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\SecureBoot\State" -Name "UEFISecureBootEnabled" -ErrorAction SilentlyContinue
        $DataExchange.SecureBoot = if ($SbRegistry -and $SbRegistry.UEFISecureBootEnabled -eq 1) { "On" } else { "Off" }

        $CompSystem = Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction SilentlyContinue
        $DataExchange.HostName = $CompSystem.Name.ToUpper()
        $DataExchange.Workgroup = if ($CompSystem.PartOfDomain) { $CompSystem.Domain.ToUpper() } else { $CompSystem.Workgroup.ToUpper() }
        $DataExchange.Virtualization = if ($CompSystem.HypervisorPresent) { "On" } else { "Off" }

        $OsMetrics = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction SilentlyContinue
        $DataExchange.OsEdition = $OsMetrics.Caption -replace "Microsoft ", "" -replace " Edition", ""
        $DataExchange.WindowsBuild = "$($OsMetrics.Version).$($OsMetrics.OSArchitecture)"
        $DataExchange.RamTotalGB = [math]::Round(($OsMetrics.TotalVisibleMemorySize * 1KB) / 1GB, 2)
        
        $UpdateLevel = Get-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion" -ErrorAction SilentlyContinue
        $DataExchange.WindowsUpdateLevel = "Release $($UpdateLevel.DisplayVersion) (UBR: $($UpdateLevel.UBR))"

        $CpuInstance = Get-CimInstance -ClassName Win32_Processor -ErrorAction SilentlyContinue | Select-Object -First 1
        $DataExchange.CpuModel = $CpuInstance.Name.Trim()

        $GpuInstance = Get-CimInstance -ClassName Win32_VideoController -ErrorAction SilentlyContinue | Select-Object -First 1
        $DataExchange.GpuModel = $GpuInstance.Name

        $Enclosure = Get-CimInstance -ClassName Win32_SystemEnclosure -ErrorAction SilentlyContinue
        $RawType = if ($null -ne $Enclosure.ChassisTypes) { @($Enclosure.ChassisTypes) } else { 3 }
        $DataExchange.ChassisType = switch ($RawType) { 3 { "Custom PC" }; 4 { "Low Profile" }; 6 { "Mini Tower" }; 7 { "Tower" }; 9 { "Laptop" }; 10 { "Notebook" }; 23 { "Server" }; default { "Custom PC" } }

        $PnpDrivers = Get-CimInstance -ClassName Win32_PnPSignedDriver -ErrorAction SilentlyContinue
        $CpuDriver = $PnpDrivers | Where-Object { $_.DeviceClass -eq "PROCESSOR" -and $_.DeviceName -like "*Processor*" } | Select-Object -First 1
        if ($CpuDriver) { $DataExchange.CpuDriverVersion = "v$($CpuDriver.DriverVersion) ($($CpuDriver.DriverProviderName))" }

        $GpuDriver = $PnpDrivers | Where-Object { $_.DeviceClass -eq "DISPLAY" -and ($_.DeviceName -like "*NVIDIA*" -or $_.DeviceName -like "*AMD*" -or $_.DeviceName -like "*Intel*") } | Select-Object -First 1
        if ($GpuDriver) { $DataExchange.GpuDriverVersion = "v$($GpuDriver.DriverVersion) ($($GpuDriver.DriverProviderName))" }
    } catch {}

    $null = [System.Threading.Tasks.Task]::Run([Action]{
        try {
            $Client = New-Object System.Net.WebClient
            $Client.Headers.Add("user-agent", "Mozilla/5.0")
            $DataExchange.PublicIp = ($Client.DownloadString("https://ipify.org").Trim())
        } catch { $DataExchange.PublicIp = "Unavailable" }
    })

    while ($DataExchange.LoopActive -eq $true) {
        try {
            $DataExchange.CpuLoad = [int](Get-CimInstance -ClassName Win32_Processor -ErrorAction SilentlyContinue | Measure-Object -Property LoadPercentage -Average).Average

            $MemoryInstance = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction SilentlyContinue
            $DataExchange.RamUsedGB = [math]::Round((($MemoryInstance.TotalVisibleMemorySize - $MemoryInstance.FreePhysicalMemory) * 1KB) / 1GB, 2)
            $DataExchange.RamPercent = [int](($DataExchange.RamUsedGB / ($MemoryInstance.TotalVisibleMemorySize * 1KB / 1GB)) * 100)

            $UptimeSpan = (Get-Date) - $MemoryInstance.LastBootUpTime
            $DataExchange.UptimeString = "{0}d {1}h {2}m" -f $UptimeSpan.Days, $UptimeSpan.Hours, $UptimeSpan.Minutes

            $ActivePlan = (Get-CimInstance -Namespace root\cimv2\power -ClassName Win32_PowerPlan -Filter "IsActive=True" -ErrorAction SilentlyContinue).ElementName
            $DataExchange.PowerPlan = if ($null -ne $ActivePlan) { $ActivePlan } else { "Performance" }
            $DataExchange.NetDiscovery = if ((Get-Service -Name "FDResPub" -ErrorAction SilentlyContinue).Status -eq "Running") { "On" } else { "Off" }

            $ActiveRoute = Get-NetRoute -DestinationPrefix "0.0.0.0/0" -ErrorAction SilentlyContinue | Sort-Object RouteMetric | Select-Object -First 1
            if ($null -ne $ActiveRoute) {
                $Idx = $ActiveRoute.InterfaceIndex
                $DataExchange.Gateway = $ActiveRoute.NextHop
                $IpConfig = Get-NetIPAddress -InterfaceIndex $Idx -AddressFamily IPv4 -ErrorAction SilentlyContinue | Select-Object -First 1
                $DataExchange.PrivateIp = $IpConfig.IPAddress
                $DataExchange.SubnetMask = switch ($IpConfig.PrefixLength) { 24 { "255.255.255.0" }; 16 { "255.255.0.0" }; 8 { "255.0.0.0" }; default { "255.255.255.0" } }
                $DataExchange.NetProfile = "$((Get-NetConnectionProfile -InterfaceIndex $Idx -ErrorAction SilentlyContinue).NetworkCategory)"
                
                $Adapter = Get-NetAdapter -InterfaceIndex $Idx -ErrorAction SilentlyContinue
                $DataExchange.LinkSpeed = if ($Adapter.LinkSpeed -ge 1GB) { "$([int]($Adapter.LinkSpeed / 1GB)) Gbps" } else { "$($Adapter.LinkSpeed) Mbps" }
                
                $SysAdapter = Get-CimInstance -ClassName Win32_NetworkAdapter -Filter "InterfaceIndex=$Idx" -ErrorAction SilentlyContinue
                if ($SysAdapter -and $SysAdapter.PNPDeviceID) {
                    $EscapedPnpId = $SysAdapter.PNPDeviceID -replace "\\", "\\"
                    $DriverMatch = Get-CimInstance -ClassName Win32_PnPSignedDriver -Filter "DeviceID='$EscapedPnpId'" -ErrorAction SilentlyContinue
                    $DataExchange.NetworkDriverVersion = if ($DriverMatch) { "$($DriverMatch.DriverProviderName) v$($DriverMatch.DriverVersion)" } else { "v$($Adapter.DriverVersion)" }
                } else { $DataExchange.NetworkDriverVersion = "Generic Controller" }

                # FIXED WLAN SSID PARSER: Case-insensitive array string loop that works on all Windows 11 layouts natively
                if ($Adapter.MediaType -eq "Native 802.11" -or $Adapter.InterfaceDescription -like "*Wireless*" -or $Adapter.InterfaceDescription -like "*Wi-Fi*") {
                    $WlanLines = netsh wlan show interfaces
                    $MatchLine = $WlanLines | Where-Object { $_ -like "*SSID*" -and $_ -notlike "*BSSID*" }
                    if ($MatchLine) {
                        $DataExchange.WifiState = ($MatchLine -replace '^.*:\s+', '').Trim()
                    } else { $DataExchange.WifiState = "Connected" }
                } else { $DataExchange.WifiState = "Disconnected" }
            }
        } catch {}
        Start-Sleep -Seconds 2
    }
}

Export-ModuleMember -Function Start-TelemetryCollection
