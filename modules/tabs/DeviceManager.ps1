[CmdletBinding()]
param()

function Get-DeviceCategoryMeta {
    param([string]$ClassName)

    $key = if ($ClassName) { $ClassName.Trim() } else { "Other" }
    switch -Regex ($key) {
        '^AudioEndpoint$'          { return @{ Label = "Audio inputs and outputs"; Icon = "🔊"; Priority = 1 } }
        '^MEDIA$'                  { return @{ Label = "Sound, video and game controllers"; Icon = "🎵"; Priority = 2 } }
        '^Display$'                { return @{ Label = "Display adapters"; Icon = "🎮"; Priority = 3 } }
        '^Monitor$'                { return @{ Label = "Monitors"; Icon = "🖥️"; Priority = 4 } }
        '^Net$'                    { return @{ Label = "Network adapters"; Icon = "📡"; Priority = 5 } }
        '^Bluetooth$'              { return @{ Label = "Bluetooth"; Icon = "📶"; Priority = 6 } }
        '^Processor$'              { return @{ Label = "Processors"; Icon = "⚡"; Priority = 7 } }
        '^DiskDrive$'              { return @{ Label = "Disk drives"; Icon = "💾"; Priority = 8 } }
        '^SCSIAdapter$|^HDC$'      { return @{ Label = "Storage controllers"; Icon = "🗄️"; Priority = 9 } }
        '^USB$'                    { return @{ Label = "Universal Serial Bus controllers"; Icon = "🔌"; Priority = 10 } }
        '^USBDevice$'              { return @{ Label = "Universal Serial Bus devices"; Icon = "🔌"; Priority = 11 } }
        '^HIDClass$'               { return @{ Label = "Human Interface Devices"; Icon = "🕹️"; Priority = 12 } }
        '^Keyboard$'               { return @{ Label = "Keyboards"; Icon = "⌨️"; Priority = 13 } }
        '^Mouse$'                  { return @{ Label = "Mice and other pointing devices"; Icon = "🖱️"; Priority = 14 } }
        '^Camera$|^Image$'         { return @{ Label = "Cameras & Imaging devices"; Icon = "📷"; Priority = 15 } }
        '^Ports$'                  { return @{ Label = "Ports (COM & LPT)"; Icon = "🔗"; Priority = 16 } }
        '^Battery$'                { return @{ Label = "Batteries"; Icon = "🔋"; Priority = 17 } }
        '^Biometric$'              { return @{ Label = "Biometric devices"; Icon = "🧬"; Priority = 18 } }
        '^SecurityDevices$'        { return @{ Label = "Security devices"; Icon = "🛡️"; Priority = 19 } }
        '^Firmware$'               { return @{ Label = "Firmware"; Icon = "🧩"; Priority = 20 } }
        '^Computer$'               { return @{ Label = "Computer"; Icon = "💻"; Priority = 21 } }
        '^System$'                 { return @{ Label = "System devices"; Icon = "⚙️"; Priority = 22 } }
        '^PrintQueue$|^Printer$'   { return @{ Label = "Print queues & Printers"; Icon = "🖨️"; Priority = 23 } }
        '^SoftwareComponent$'      { return @{ Label = "Software components"; Icon = "📦"; Priority = 24 } }
        '^SoftwareDevice$'         { return @{ Label = "Software devices"; Icon = "📦"; Priority = 25 } }
        '^Unknown$'                { return @{ Label = "Other / Unknown devices"; Icon = "❓"; Priority = 0 } }
        default                    { return @{ Label = $key; Icon = "🔧"; Priority = 30 } }
    }
}

function Get-ProblemCodeDescription {
    param([int]$Code)

    switch ($Code) {
        0  { return "Working properly" }
        1  { return "Not configured correctly (Code 1)" }
        3  { return "Driver may be corrupted or system low on memory (Code 3)" }
        10 { return "Device cannot start (Code 10)" }
        12 { return "Not enough free resources available (Code 12)" }
        14 { return "Restart required to finish setup (Code 14)" }
        18 { return "Reinstall drivers for this device (Code 18)" }
        19 { return "Windows cannot start due to incomplete registry config (Code 19)" }
        21 { return "Windows is removing this device (Code 21)" }
        22 { return "Device is disabled (Code 22)" }
        24 { return "Device is not present or missing drivers (Code 24)" }
        28 { return "Drivers for this device are not installed (Code 28)" }
        29 { return "Disabled by firmware (Code 29)" }
        31 { return "Windows cannot load required drivers (Code 31)" }
        32 { return "Driver service has been disabled (Code 32)" }
        37 { return "Driver failed to initialize (Code 37)" }
        39 { return "Driver may be corrupted or missing (Code 39)" }
        43 { return "Windows stopped this device after reported problems (Code 43)" }
        45 { return "Device is currently not connected (Code 45)" }
        47 { return "Device has been prepared for safe removal (Code 47)" }
        52 { return "Cannot verify digital signature for driver (Code 52)" }
        default { return "Device problem detected (Code $Code)" }
    }
}

function Resolve-DeviceBusType {
    param([string]$DeviceId)
    if (-not $DeviceId) { return "Unknown" }
    $prefix = ($DeviceId -split '\\')[0].ToUpperInvariant()
    switch ($prefix) {
        "PCI"      { return "PCI / PCIe" }
        "USB"      { return "USB" }
        "USBSTOR"  { return "USB Storage" }
        "HID"      { return "HID" }
        "ACPI"     { return "ACPI / Motherboard" }
        "HDAUDIO"  { return "HD Audio" }
        "INTELAUDIO" { return "Intel Audio" }
        "SCSI"     { return "SCSI / NVMe / SATA" }
        "STORAGE"  { return "Storage Volume" }
        "DISPLAY"  { return "Display Output" }
        "BTH"      { return "Bluetooth" }
        "BTHENUM"  { return "Bluetooth" }
        "SWD"      { return "Software / Virtual" }
        "ROOT"     { return "System Root" }
        "UEFI"     { return "UEFI Firmware" }
        default    { return $prefix }
    }
}

function Format-DriverAgeText {
    param([datetime]$DriverDate)
    $days = [int][math]::Floor(([datetime]::Now - $DriverDate).TotalDays)
    if ($days -lt 0) { return "Recent" }
    if ($days -lt 30) { return "$days d" }
    if ($days -lt 365) { return "$([math]::Round($days / 30.0, 1)) mo" }
    return "$([math]::Round($days / 365.25, 1)) yr"
}

<#
    Queries all present PnP devices and merges Win32_PnPSignedDriver telemetry into a rich
    Device Manager-style catalog grouped by device category.
#>
function Get-SystemDevicesMesh {
    [CmdletBinding()]
    param()

    try {
        $pnpEntities = @(Get-CimInstance -ClassName Win32_PnPEntity -ErrorAction Stop | Where-Object { $_.Present -ne $false })
        $signedDrivers = @(Get-CimInstance -ClassName Win32_PnPSignedDriver -ErrorAction SilentlyContinue)

        $driverMap = @{}
        foreach ($drv in $signedDrivers) {
            if ($drv.DeviceID) {
                $driverMap[$drv.DeviceID] = $drv
            }
        }

        $devices = New-Object System.Collections.Generic.List[PSCustomObject]
        $okCount = 0
        $issueCount = 0
        $disabledCount = 0
        $thirdPartyCount = 0

        foreach ($ent in $pnpEntities) {
            $devId = [string]$ent.DeviceID
            if (-not $devId) { continue }

            $className = if ($ent.PNPClass) { [string]$ent.PNPClass } else { "Unknown" }
            $catMeta = Get-DeviceCategoryMeta -ClassName $className
            $drv = if ($driverMap.ContainsKey($devId)) { $driverMap[$devId] } else { $null }

            $errCode = if ($null -ne $ent.ConfigManagerErrorCode) { [int]$ent.ConfigManagerErrorCode } else { 0 }
            $statusState = if ($errCode -eq 0) {
                $okCount++
                "OK"
            } elseif ($errCode -eq 22) {
                $disabledCount++
                "Disabled"
            } else {
                $issueCount++
                "Error"
            }

            $driverVersion = if ($drv -and $drv.DriverVersion) { [string]$drv.DriverVersion } else { "Inbox / None" }
            $driverProvider = if ($drv -and $drv.DriverProviderName) { [string]$drv.DriverProviderName } elseif ($ent.Manufacturer) { [string]$ent.Manufacturer } else { "Unknown" }
            $infName = if ($drv -and $drv.InfName) { [string]$drv.InfName } else { "" }
            $signer = if ($drv -and $drv.Signer) { [string]$drv.Signer } else { "Unsigned / System" }
            $isSigned = if ($drv -and $null -ne $drv.IsSigned) { [bool]$drv.IsSigned } else { $false }
            $locationInfo = if ($drv -and $drv.Location) { [string]$drv.Location } else { "" }

            $driverDateStr = "Unknown"
            $driverAgeText = ""
            $driverAgeDays = -1
            if ($drv -and $drv.DriverDate) {
                try {
                    $dt = [datetime]$drv.DriverDate
                    $driverDateStr = $dt.ToString("yyyy-MM-dd")
                    $driverAgeDays = [int][math]::Floor(([datetime]::Now - $dt).TotalDays)
                    $driverAgeText = Format-DriverAgeText -DriverDate $dt
                } catch {}
            }

            $isThirdParty = ($driverProvider -notmatch '(?i)^Microsoft$' -and $driverProvider -notmatch '(?i)^\(Standard' -and $driverProvider -ne "Unknown" -and $infName -match '(?i)^oem\d+\.inf$')
            if ($isThirdParty) { $thirdPartyCount++ }

            $primaryHwId = ""
            if ($ent.HardwareID -and $ent.HardwareID.Count -gt 0) {
                $primaryHwId = [string]($ent.HardwareID | Select-Object -First 1)
            }

            $serviceName = if ($ent.Service) { [string]$ent.Service } else { "None" }
            $manufacturer = if ($ent.Manufacturer) { [string]$ent.Manufacturer } else { $driverProvider }
            $busType = Resolve-DeviceBusType -DeviceId $devId
            $isCritical = ($className -in @("Processor", "Computer", "DiskDrive", "SCSIAdapter", "HDC", "Firmware", "System"))

            $devices.Add([PSCustomObject]@{
                id               = $devId
                name             = if ($ent.Name) { [string]$ent.Name } elseif ($ent.Caption) { [string]$ent.Caption } else { $devId }
                pnpClass         = $className
                categoryLabel    = [string]$catMeta.Label
                categoryIcon     = [string]$catMeta.Icon
                categoryPriority = [int]$catMeta.Priority
                manufacturer     = $manufacturer
                busType          = $busType
                service          = $serviceName
                status           = $statusState
                problemCode      = $errCode
                problemText      = Get-ProblemCodeDescription -Code $errCode
                driverVersion    = $driverVersion
                driverDate       = $driverDateStr
                driverAgeText    = $driverAgeText
                driverAgeDays    = $driverAgeDays
                driverProvider   = $driverProvider
                infName          = $infName
                signer           = $signer
                isSigned         = $isSigned
                isThirdParty     = $isThirdParty
                locationInfo     = $locationInfo
                hardwareId       = $primaryHwId
                isCritical       = [bool]$isCritical
            })
        }

        $sortedDevices = @($devices | Sort-Object categoryPriority, categoryLabel, name)

        return @{
            type    = "REFRESH_SYSTEM_DEVICES"
            devices = $sortedDevices
            summary = @{
                total      = $sortedDevices.Count
                ok         = $okCount
                issues     = $issueCount
                disabled   = $disabledCount
                thirdParty = $thirdPartyCount
            }
            error   = $null
        }
    } catch {
        return @{
            type    = "REFRESH_SYSTEM_DEVICES"
            devices = @()
            summary = @{ total = 0; ok = 0; issues = 0; disabled = 0; thirdParty = 0 }
            error   = $_.Exception.Message
        }
    }
}

function Invoke-DeviceManagerAction {
    param(
        [Parameter(Mandatory = $true)]
        $Payload
    )

    if ($Payload -is [string]) {
        $Payload = $Payload | ConvertFrom-Json
    }
    if ($null -eq $Payload -or $null -eq $Payload.command) { return $null }

    $cmd = [string]$Payload.command
    $devId = [string]$Payload.deviceId
    $devName = [string]$Payload.deviceName
    $msg = "Device action completed."

    try {
        if ($cmd -eq "RESCAN_HARDWARE") {
            $null = pnputil /scan-devices 2>&1
            $msg = "Hardware bus rescan completed (pnputil /scan-devices)."
        }
        elseif ($cmd -eq "OPEN_NATIVE_DEVMGMT") {
            Start-Process "mmc.exe" -ArgumentList "devmgmt.msc"
            $msg = "Opened native Windows Device Manager."
        }
        elseif ($cmd -eq "OPEN_DRIVER_INF") {
            $inf = ([string]$Payload.infName).Trim()
            if (-not $inf -or $inf -notmatch '^[\w\-.]+\.inf$') {
                throw "No valid INF driver package file recorded for this device."
            }
            $infPath = Join-Path "$env:SystemRoot\INF" $inf
            if (Test-Path -LiteralPath $infPath -PathType Leaf) {
                Start-Process "explorer.exe" -ArgumentList "/select,`"$infPath`""
                $msg = "Revealed driver INF package [$infPath] in Windows Explorer."
            } else {
                throw "Driver INF file not found at $infPath."
            }
        }
        elseif ($cmd -eq "TOGGLE_DEVICE_STATE") {
            if (-not $devId) { throw "Missing device instance ID." }
            $enable = [bool]$Payload.enable
            if ($enable) {
                Enable-PnpDevice -InstanceId $devId -Confirm:$false -ErrorAction Stop
                $msg = "Enabled device [$devName]."
            } else {
                Disable-PnpDevice -InstanceId $devId -Confirm:$false -ErrorAction Stop
                $msg = "Disabled device [$devName]."
            }
        }
        elseif ($cmd -eq "RESTART_DEVICE") {
            if (-not $devId) { throw "Missing device instance ID." }
            Disable-PnpDevice -InstanceId $devId -Confirm:$false -ErrorAction Stop
            Start-Sleep -Milliseconds 400
            Enable-PnpDevice -InstanceId $devId -Confirm:$false -ErrorAction Stop
            $msg = "Restarted device [$devName]."
        }
        else {
            throw "Unsupported device action: $cmd"
        }
    } catch {
        $state = Get-SystemDevicesMesh
        $state.error = $_.Exception.Message
        return $state
    }

    $result = Get-SystemDevicesMesh
    $result.message = $msg
    return $result
}
