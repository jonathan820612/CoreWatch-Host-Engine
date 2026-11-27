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

function Resolve-DeviceDriverLinks {
    param(
        [string]$Name,
        [string]$Manufacturer,
        [string]$DriverProvider,
        [string]$HardwareId,
        [string]$DeviceId,
        [int]$ProblemCode
    )

    $combinedIds = "$HardwareId $DeviceId".ToUpperInvariant()
    $combinedTxt = "$Name $Manufacturer $DriverProvider"

    $vendorName = ""
    $vendorUrl  = ""

    # 1. Exact USB VID / PCI VEN Hardware ID mapping (works even for 'Unknown Device' with Code 28!)
    $vidMatch = if ($combinedIds -match 'VID_([0-9A-F]{4})') { $Matches[1] } else { "" }
    $venMatch = if ($combinedIds -match 'VEN_([0-9A-F]{4})') { $Matches[1] } else { "" }

    $usbVidTable = @{
        '1235' = @{ Name = 'Focusrite / Novation Drivers'; Url = 'https://downloads.focusrite.com/focusrite' }
        '194F' = @{ Name = 'PreSonus Audio Drivers';       Url = 'https://www.presonus.com/en-US/support/downloads' }
        '1397' = @{ Name = 'Behringer Audio Drivers';      Url = 'https://www.behringer.com/downloads.html' }
        '0499' = @{ Name = 'Yamaha / Steinberg Drivers';   Url = 'https://o.steinberg.net/en/support/downloads_hardware/yamaha_steinberg_usb_driver.html' }
        '0FD9' = @{ Name = 'Elgato Downloads';             Url = 'https://www.elgato.com/us/en/s/downloads' }
        '2708' = @{ Name = 'Audient / EVO Drivers';        Url = 'https://audient.com/support/' }
        '07FD' = @{ Name = 'MOTU Audio Drivers';           Url = 'https://motu.com/en-us/download/' }
        '041E' = @{ Name = 'Creative / Sound Blaster';     Url = 'https://support.creative.com/' }
        '0763' = @{ Name = 'M-Audio Drivers';              Url = 'https://www.m-audio.com/support/drivers' }
        '046D' = @{ Name = 'Logitech Support & Drivers';   Url = 'https://support.logi.com/hc/en-us/articles/360024361233' }
        '1532' = @{ Name = 'Razer Drivers & Synapse';      Url = 'https://mysupport.razer.com/app/answers/detail/a_id/4166' }
        '1B1C' = @{ Name = 'Corsair Downloads';            Url = 'https://www.corsair.com/us/en/s/downloads' }
        '1038' = @{ Name = 'SteelSeries GG & Drivers';     Url = 'https://steelseries.com/gg' }
        '056A' = @{ Name = 'Wacom Tablet Drivers';         Url = 'https://www.wacom.com/en-us/support/product-support/drivers' }
        '256C' = @{ Name = 'Huion Tablet Drivers';         Url = 'https://www.huion.com/download/' }
        '0BDA' = @{ Name = 'Realtek USB/Audio Drivers';    Url = 'https://www.realtek.com/Download/Index' }
        '8087' = @{ Name = 'Intel Wireless & Bluetooth';   Url = 'https://www.intel.com/content/www/us/en/download-center/home.html' }
        '2357' = @{ Name = 'TP-Link Download Center';      Url = 'https://www.tp-link.com/us/support/download/' }
        '0846' = @{ Name = 'Netgear Downloads';            Url = 'https://www.netgear.com/support/download/' }
        '0403' = @{ Name = 'FTDI USB-Serial Drivers';      Url = 'https://ftdichip.com/drivers/vcp-drivers/' }
        '10C4' = @{ Name = 'Silicon Labs CP210x Drivers';  Url = 'https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers' }
        '1A86' = @{ Name = 'WCH CH340/CH341 Drivers';      Url = 'https://www.wch-ic.com/downloads/CH341SER_EXE.html' }
        '2341' = @{ Name = 'Arduino USB Drivers';          Url = 'https://www.arduino.cc/en/software' }
        '0951' = @{ Name = 'HyperX / Kingston Support';    Url = 'https://support.hyperx.com/' }
        '0B05' = @{ Name = 'ASUS Support & Drivers';       Url = 'https://www.asus.com/support/download-center/' }
        '1462' = @{ Name = 'MSI Support & Drivers';        Url = 'https://www.msi.com/support' }
        '04A9' = @{ Name = 'Canon Drivers & Support';      Url = 'https://www.usa.canon.com/support' }
        '04B8' = @{ Name = 'Epson Drivers & Support';      Url = 'https://epson.com/Support/sl/s' }
        '04F9' = @{ Name = 'Brother Drivers & Support';    Url = 'https://support.brother.com/' }
    }

    $pciVenTable = @{
        '10DE' = @{ Name = 'NVIDIA Drivers';               Url = 'https://www.nvidia.com/Download/index.aspx' }
        '1002' = @{ Name = 'AMD Radeon & Chipset Drivers'; Url = 'https://www.amd.com/en/support/download/drivers.html' }
        '1022' = @{ Name = 'AMD Chipset Drivers';          Url = 'https://www.amd.com/en/support/download/drivers.html' }
        '8086' = @{ Name = 'Intel Download Center';        Url = 'https://www.intel.com/content/www/us/en/download-center/home.html' }
        '10EC' = @{ Name = 'Realtek LAN / Audio Drivers';  Url = 'https://www.realtek.com/Download/Index' }
        '14E4' = @{ Name = 'Broadcom Support Portal';      Url = 'https://www.broadcom.com/support/download-search' }
        '17CB' = @{ Name = 'Qualcomm / Killer Drivers';    Url = 'https://www.intel.com/content/www/us/en/support/products/211609/wireless/intel-killer-wireless-products.html' }
        '168C' = @{ Name = 'Qualcomm Atheros Drivers';     Url = 'https://www.catalog.update.microsoft.com/Home.aspx' }
        '144D' = @{ Name = 'Samsung NVMe / Magician';      Url = 'https://semiconductor.samsung.com/consumer-storage/support/tools/' }
        '15B7' = @{ Name = 'WD / SanDisk Support';         Url = 'https://support-en.wd.com/app/products/downloads/softwaredownloads' }
        '1987' = @{ Name = 'Phison / OEM SSD Support';     Url = 'https://www.catalog.update.microsoft.com/Home.aspx' }
    }

    if ($vidMatch -and $usbVidTable.ContainsKey($vidMatch)) {
        $vendorName = $usbVidTable[$vidMatch].Name
        $vendorUrl  = $usbVidTable[$vidMatch].Url
    } elseif ($venMatch -and $pciVenTable.ContainsKey($venMatch)) {
        $vendorName = $pciVenTable[$venMatch].Name
        $vendorUrl  = $pciVenTable[$venMatch].Url
    }

    # 2. Friendly name / Manufacturer / Provider matching (takes precedence for specific audio/OEM names)
    $nameRules = @(
        @{ Rx = 'Focusrite|Scarlett|Clarett|Vocaster|Novation';      Name = 'Focusrite Downloads';          Url = 'https://downloads.focusrite.com/focusrite' }
        @{ Rx = 'PreSonus|AudioBox|StudioLive|Revelator';            Name = 'PreSonus Downloads';           Url = 'https://www.presonus.com/en-US/support/downloads' }
        @{ Rx = 'Universal Audio|\bUAD\b|Apollo|Volt\s*\d';          Name = 'Universal Audio Downloads';    Url = 'https://help.uaudio.com/hc/en-us/sections/204642126-Software-Downloads' }
        @{ Rx = 'Behringer|U-Phoria|UMC\d';                          Name = 'Behringer Downloads';          Url = 'https://www.behringer.com/downloads.html' }
        @{ Rx = 'Steinberg|Yamaha';                                  Name = 'Steinberg / Yamaha Drivers';   Url = 'https://o.steinberg.net/en/support/downloads_hardware/yamaha_steinberg_usb_driver.html' }
        @{ Rx = 'Solid State Logic|\bSSL\s*2';                       Name = 'SSL Downloads';                Url = 'https://solidstatelogic.com/support' }
        @{ Rx = 'Audient|\bEVO\s*\d';                                Name = 'Audient / EVO Drivers';        Url = 'https://audient.com/support/' }
        @{ Rx = '\bMOTU\b';                                          Name = 'MOTU Downloads';               Url = 'https://motu.com/en-us/download/' }
        @{ Rx = 'RME|Babyface|Fireface';                             Name = 'RME Audio Drivers';            Url = 'https://rme-audio.de/downloads.html' }
        @{ Rx = 'GoXLR|TC-Helicon';                                  Name = 'TC-Helicon / GoXLR Drivers';   Url = 'https://www.tc-helicon.com/downloads.html' }
        @{ Rx = 'M-Audio';                                           Name = 'M-Audio Drivers';              Url = 'https://www.m-audio.com/support/drivers' }
        @{ Rx = 'Elgato|Stream Deck|Cam Link';                       Name = 'Elgato Downloads';             Url = 'https://www.elgato.com/us/en/s/downloads' }
        @{ Rx = 'Creative|Sound Blaster';                            Name = 'Creative Support';             Url = 'https://support.creative.com/' }
        @{ Rx = 'NVIDIA|GeForce|RTX|GTX|Quadro';                     Name = 'NVIDIA Drivers';               Url = 'https://www.nvidia.com/Download/index.aspx' }
        @{ Rx = '\bAMD\b|Radeon|Ryzen';                              Name = 'AMD Drivers & Chipset';        Url = 'https://www.amd.com/en/support/download/drivers.html' }
        @{ Rx = 'Intel';                                             Name = 'Intel Download Center';        Url = 'https://www.intel.com/content/www/us/en/download-center/home.html' }
        @{ Rx = 'Realtek';                                           Name = 'Realtek Downloads';            Url = 'https://www.realtek.com/Download/Index' }
        @{ Rx = 'Logitech';                                          Name = 'Logitech Support';             Url = 'https://support.logi.com/hc/en-us/articles/360024361233' }
        @{ Rx = 'Razer';                                             Name = 'Razer Support';                Url = 'https://mysupport.razer.com/app/answers/detail/a_id/4166' }
        @{ Rx = 'Corsair';                                           Name = 'Corsair Downloads';            Url = 'https://www.corsair.com/us/en/s/downloads' }
        @{ Rx = 'SteelSeries';                                       Name = 'SteelSeries GG';               Url = 'https://steelseries.com/gg' }
        @{ Rx = 'HyperX';                                            Name = 'HyperX Support';               Url = 'https://support.hyperx.com/' }
        @{ Rx = 'ASUS|ASUSTeK|\bROG\b';                              Name = 'ASUS Download Center';         Url = 'https://www.asus.com/support/download-center/' }
        @{ Rx = '\bMSI\b|Micro-Star';                                Name = 'MSI Support';                  Url = 'https://www.msi.com/support' }
        @{ Rx = 'Gigabyte|AORUS';                                    Name = 'Gigabyte Support';             Url = 'https://www.gigabyte.com/Support' }
        @{ Rx = 'ASRock';                                            Name = 'ASRock Support';               Url = 'https://www.asrock.com/support/index.asp' }
        @{ Rx = '\bDell\b';                                          Name = 'Dell Drivers';                 Url = 'https://www.dell.com/support/home/en-us?app=drivers' }
        @{ Rx = 'Hewlett-Packard|\bHP\b';                            Name = 'HP Drivers';                   Url = 'https://support.hp.com/us-en/drivers' }
        @{ Rx = 'Lenovo';                                            Name = 'Lenovo Support';               Url = 'https://pcsupport.lenovo.com/us/en' }
        @{ Rx = 'Samsung';                                           Name = 'Samsung Storage Support';      Url = 'https://semiconductor.samsung.com/consumer-storage/support/tools/' }
        @{ Rx = 'Western Digital|SanDisk';                           Name = 'WD / SanDisk Support';         Url = 'https://support-en.wd.com/app/products/downloads/softwaredownloads' }
        @{ Rx = 'Crucial|Micron';                                    Name = 'Crucial Support';              Url = 'https://www.crucial.com/support/storage-executive' }
        @{ Rx = 'TP-Link';                                           Name = 'TP-Link Downloads';            Url = 'https://www.tp-link.com/us/support/download/' }
        @{ Rx = 'Netgear';                                           Name = 'Netgear Downloads';            Url = 'https://www.netgear.com/support/download/' }
        @{ Rx = 'Wacom';                                             Name = 'Wacom Drivers';                Url = 'https://www.wacom.com/en-us/support/product-support/drivers' }
        @{ Rx = 'Huion';                                             Name = 'Huion Drivers';                Url = 'https://www.huion.com/download/' }
        @{ Rx = 'FTDI';                                              Name = 'FTDI Drivers';                 Url = 'https://ftdichip.com/drivers/vcp-drivers/' }
        @{ Rx = 'Silicon Labs|CP210';                                Name = 'Silicon Labs Drivers';         Url = 'https://www.silabs.com/developers/usb-to-uart-bridge-vcp-drivers' }
        @{ Rx = 'CH340|WCH';                                         Name = 'WCH CH340 Drivers';            Url = 'https://www.wch-ic.com/downloads/CH341SER_EXE.html' }
        @{ Rx = 'Canon';                                             Name = 'Canon Support';                Url = 'https://www.usa.canon.com/support' }
        @{ Rx = 'Epson';                                             Name = 'Epson Support';                Url = 'https://epson.com/Support/sl/s' }
        @{ Rx = 'Brother';                                           Name = 'Brother Support';              Url = 'https://support.brother.com/' }
    )

    if (-not $vendorUrl) {
        foreach ($r in $nameRules) {
            if ($combinedTxt -match "(?i)$($r.Rx)") {
                $vendorName = $r.Name
                $vendorUrl  = $r.Url
                break
            }
        }
    }

    # Microsoft Update Catalog exact Hardware ID search URL
    $queryToken = ""
    if ($HardwareId) {
        # Strip noisy revision suffixes so Update Catalog gets exact VID/PID or VEN/DEV matches
        $queryToken = ($HardwareId -replace '&REV_[0-9A-Fa-f]+', '' -replace '&SUBSYS_[0-9A-Fa-f]+', '').Trim()
    } elseif ($Name -and $Name -notmatch '(?i)^Unknown') {
        $queryToken = $Name.Trim()
    }
    $catalogUrl = if ($queryToken) {
        "https://www.catalog.update.microsoft.com/Search.aspx?q=" + [System.Uri]::EscapeDataString($queryToken)
    } else {
        "https://www.catalog.update.microsoft.com/Home.aspx"
    }

    # Concise hardware/web driver lookup URL
    $lookupQuery = if ($Name -and $Name -notmatch '(?i)^Unknown Device$') {
        "$Name $HardwareId Windows 11 driver download"
    } elseif ($HardwareId) {
        "$HardwareId Windows driver download"
    } else {
        "Windows device driver download"
    }
    $webSearchUrl = "https://www.google.com/search?q=" + [System.Uri]::EscapeDataString($lookupQuery.Trim())

    # Actionable guided fix hint based on Windows ConfigManager problem code
    $fixHint = ""
    if ($ProblemCode -ne 0 -and $ProblemCode -ne 22) {
        $vendorAdvice = if ($vendorName) { "Download the official installer from $vendorName, or search the Microsoft Update Catalog by Hardware ID." } else { "Search the Microsoft Update Catalog using the Hardware ID or check the manufacturer's support page." }
        switch ($ProblemCode) {
            1  { $fixHint = "Device not configured properly. $vendorAdvice" }
            10 { $fixHint = "Device failed to start. Try 'Restart Device', unplug/replug USB, or reinstall the latest driver. $vendorAdvice" }
            14 { $fixHint = "A Windows reboot is pending to complete driver installation for this device." }
            18 { $fixHint = "Windows recommends reinstalling this driver. $vendorAdvice" }
            28 { $fixHint = "Missing driver (Code 28). $vendorAdvice" }
            31 { $fixHint = "Windows could not load the required driver. Reinstall the signed vendor package. $vendorAdvice" }
            39 { $fixHint = "Driver registry entry or .sys file is corrupted/missing. Reinstall from the official vendor installer. $vendorAdvice" }
            43 { $fixHint = "Hardware/driver reported failure (Code 43). Power-cycle/replug the device, restart it, or clean-reinstall the official driver. $vendorAdvice" }
            52 { $fixHint = "Unsigned driver blocked by Windows signature enforcement. Install the latest WHQL-signed driver from the vendor. $vendorAdvice" }
            default { $fixHint = "Device error Code $ProblemCode. $vendorAdvice" }
        }
    }

    return @{
        vendorName   = $vendorName
        vendorUrl    = $vendorUrl
        catalogUrl   = $catalogUrl
        webSearchUrl = $webSearchUrl
        fixHint      = $fixHint
    }
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
            $devDisplayName = if ($ent.Name) { [string]$ent.Name } elseif ($ent.Caption) { [string]$ent.Caption } else { $devId }
            $drvLinks = Resolve-DeviceDriverLinks -Name $devDisplayName -Manufacturer $manufacturer -DriverProvider $driverProvider -HardwareId $primaryHwId -DeviceId $devId -ProblemCode $errCode

            $devices.Add([PSCustomObject]@{
                id                 = $devId
                name               = $devDisplayName
                pnpClass           = $className
                categoryLabel      = [string]$catMeta.Label
                categoryIcon       = [string]$catMeta.Icon
                categoryPriority   = [int]$catMeta.Priority
                manufacturer       = $manufacturer
                busType            = $busType
                service            = $serviceName
                status             = $statusState
                problemCode        = $errCode
                problemText        = Get-ProblemCodeDescription -Code $errCode
                driverVersion      = $driverVersion
                driverDate         = $driverDateStr
                driverAgeText      = $driverAgeText
                driverAgeDays      = $driverAgeDays
                driverProvider     = $driverProvider
                infName            = $infName
                signer             = $signer
                isSigned           = $isSigned
                isThirdParty       = $isThirdParty
                locationInfo       = $locationInfo
                hardwareId         = $primaryHwId
                isCritical         = [bool]$isCritical
                vendorDownloadName = [string]$drvLinks.vendorName
                vendorDownloadUrl  = [string]$drvLinks.vendorUrl
                catalogSearchUrl   = [string]$drvLinks.catalogUrl
                webSearchUrl       = [string]$drvLinks.webSearchUrl
                fixHint            = [string]$drvLinks.fixHint
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
        elseif ($cmd -eq "OPEN_DRIVER_URL") {
            $url = ([string]$Payload.url).Trim()
            if ($url -notmatch '^https://[A-Za-z0-9\-\.]+(/.*)?$') {
                throw "Blocked non-HTTPS driver URL."
            }
            Start-Process $url
            return @{
                type    = "DEVICE_LINK_NOTICE"
                ok      = $true
                message = "Opened driver support link: $url"
            }
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
