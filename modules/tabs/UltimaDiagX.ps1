[CmdletBinding()]
param()

# =========================================================================
# ULTIMADIAGX - CURATED NATIVE WINDOWS EVENT ID & ERROR CODE KNOWLEDGE BASE
# =========================================================================
$script:EventIdKB = @{
    "41"    = @{ Title = "Kernel-Power: Unexpected Reboot / Power Loss"; Subsystem = "Kernel & Power"; Explanation = "The system rebooted without cleanly shutting down first (power loss, BSOD crash, PSU trip, or forced reset)."; Fix = "Check BSOD minidumps, PSU stability, CPU/RAM overclocking, and thermal logs around this timestamp." }
    "6008"  = @{ Title = "Unexpected System Shutdown"; Subsystem = "Kernel & Power"; Explanation = "Windows detected that the previous system shutdown was unexpected."; Fix = "Correlate with Event 41 (Kernel-Power) and Event 1001 (BugCheck) immediately before or after this event." }
    "1001"  = @{ Title = "BugCheck / Windows Error Reporting Crash Dump"; Subsystem = "Kernel & Power"; Explanation = "A fatal crash (BSOD BugCheck or WER fault bucket) was recorded and dumped."; Fix = "Inspect the BugCheck stop code in the message and check C:\Windows\Minidump for the faulting driver." }
    "1074"  = @{ Title = "Planned Shutdown / Restart Initiated"; Subsystem = "Kernel & Power"; Explanation = "A user, Windows Update, or service initiated a clean restart or shutdown."; Fix = "Informational unless restarts occur unexpectedly (check the initiating process name)."; IsBenign = $true }
    "17"    = @{ Title = "WHEA-Logger: Corrected PCIe Hardware Error"; Subsystem = "Hardware / WHEA"; Explanation = "A corrected hardware error occurred on a PCI Express link (GPU, NVMe, chipset, or riser)."; Fix = "Update BIOS/chipset drivers, reseat PCIe devices, or check PCIe Link State Power Management settings." }
    "18"    = @{ Title = "WHEA-Logger: Fatal CPU Machine Check Exception"; Subsystem = "Hardware / WHEA"; Explanation = "A fatal processor/cache hardware error occurred (often triggers instant reboot or BSOD 0x124)."; Fix = "Reset CPU Curve Optimizer / PBO / undervolt / overclock to stock, update BIOS, and verify CPU cooling." }
    "19"    = @{ Title = "WHEA-Logger: Corrected CPU / Memory Hardware Error"; Subsystem = "Hardware / WHEA"; Explanation = "A corrected hardware error was detected in CPU cache, memory controller, or RAM."; Fix = "Test RAM stability (XMP/DOCP/EXPO), verify FCLK/memory voltages, and run Windows Memory Diagnostic." }
    "20"    = @{ Title = "WHEA-Logger / Windows Update Failure"; Subsystem = "Windows Update & Services"; Explanation = "Either a fatal WHEA hardware error (if source is WHEA-Logger) or a failed Windows Update installation (if source is WindowsUpdateClient)."; Fix = "Check the Event Provider name: for WindowsUpdateClient, inspect the 0x80xxxxxx HRESULT; for WHEA, check hardware stability." }
    "47"    = @{ Title = "WHEA-Logger: Corrected Memory Error"; Subsystem = "Hardware / WHEA"; Explanation = "Corrected ECC/memory bus error detected."; Fix = "Run a full memory test and check DIMM seating/timings." }
    "7"     = @{ Title = "Disk: Bad Block Detected"; Subsystem = "Storage & Disk"; Explanation = "Windows encountered an unreadable bad sector/block on a storage drive."; Fix = "Back up important data immediately, check drive SMART health, and run 'chkdsk /r'." }
    "11"    = @{ Title = "Storage Controller Error"; Subsystem = "Storage & Disk"; Explanation = "The storage driver detected a controller error on a disk or NVMe/SATA channel."; Fix = "Update NVMe/chipset storage drivers, check SATA/power cables, and inspect drive SMART status." }
    "51"    = @{ Title = "Disk Paging Operation Error"; Subsystem = "Storage & Disk"; Explanation = "An error was detected on a storage device during a paging I/O operation."; Fix = "Verify drive health, cable seating, and storage controller drivers." }
    "55"    = @{ Title = "NTFS File System Structure Corruption"; Subsystem = "Storage & Disk"; Explanation = "Corruption was found in the NTFS file system structure on a volume."; Fix = "Run 'chkdsk <Drive>: /f' (or schedule on reboot) and verify underlying disk SMART health." }
    "98"    = @{ Title = "NTFS Volume Needs Offline Scan"; Subsystem = "Storage & Disk"; Explanation = "Windows flagged a volume as requiring an offline chkdsk repair."; Fix = "Run 'chkdsk <Drive>: /scan' or reboot to let Windows repair the volume." }
    "129"   = @{ Title = "Storage Device Bus Reset"; Subsystem = "Storage & Disk"; Explanation = "A reset to the storage device was issued because an I/O command timed out."; Fix = "Update NVMe/SSD firmware & chipset drivers; check SSD temperatures and PCIe/SATA power saving." }
    "153"   = @{ Title = "Disk I/O Operation Retried"; Subsystem = "Storage & Disk"; Explanation = "A storage I/O operation had to be retried after failing or timing out."; Fix = "Monitor for recurring Event 153/129; inspect SSD firmware, cooling, and SMART attributes." }
    "4101"  = @{ Title = "Display Driver Stopped Responding (TDR Reset)"; Subsystem = "Graphics / GPU"; Explanation = "The GPU display driver (e.g., nvlddmkm / amdkmdag) hung and Windows reset the graphics pipeline."; Fix = "Check GPU temperatures, PSU power rails, GPU overclock/undervolt, or perform a clean GPU driver reinstall." }
    "14"    = @{ Title = "GPU / Kernel Driver Hardware Reset"; Subsystem = "Graphics / GPU"; Explanation = "A hardware or display driver (such as nvlddmkm) reported an internal reset or device error."; Fix = "Update or cleanly reinstall the GPU/device driver and verify PCIe power & stability." }
    "1000"  = @{ Title = "Application Error (Process Crash)"; Subsystem = "Applications & Crashes"; Explanation = "An application terminated unexpectedly due to an unhandled exception."; Fix = "Check the Faulting Module and Exception Code (e.g., 0xC0000005 Access Violation) translated below." }
    "1002"  = @{ Title = "Application Hang (Frozen UI)"; Subsystem = "Applications & Crashes"; Explanation = "An application stopped interacting with Windows and had to be closed."; Fix = "Check GPU/storage latency, conflicting overlays/plugins, or update the hanging application." }
    "1026"  = @{ Title = ".NET Runtime Unhandled Exception"; Subsystem = "Applications & Crashes"; Explanation = "A .NET application threw an unhandled managed exception and exited."; Fix = "Review the stack trace in the message and ensure required .NET Desktop Runtimes are up to date." }
    "7000"  = @{ Title = "Service Failed to Start"; Subsystem = "Windows Update & Services"; Explanation = "A Windows service could not start due to a missing binary, bad credentials, or driver error."; Fix = "Check the error text in the event; verify the service executable exists and dependencies are running." }
    "7001"  = @{ Title = "Service Dependency Failed"; Subsystem = "Windows Update & Services"; Explanation = "A service failed to start because a required dependency service did not start."; Fix = "Inspect the named parent dependency service in Services (services.msc)." }
    "7009"  = @{ Title = "Service Startup Timeout"; Subsystem = "Windows Update & Services"; Explanation = "A service did not respond to the Service Control Manager within the timeout window (default 30s)."; Fix = "Check disk I/O load at boot or reinstall the software owning the timed-out service." }
    "7023"  = @{ Title = "Service Terminated with Error"; Subsystem = "Windows Update & Services"; Explanation = "A Windows service exited with a specific error code."; Fix = "Review the embedded error code translation and check the owning application's logs." }
    "7031"  = @{ Title = "Service Crashed Unexpectedly"; Subsystem = "Windows Update & Services"; Explanation = "A background Windows service terminated unexpectedly and triggered recovery action."; Fix = "Correlate with Application Error 1000 around the same timestamp for the crashing service executable." }
    "7034"  = @{ Title = "Service Terminated Unexpectedly"; Subsystem = "Windows Update & Services"; Explanation = "A service crashed unexpectedly (no automatic restart action configured)."; Fix = "Check Application logs for a matching crash dump or update the software providing this service." }
    "1014"  = @{ Title = "DNS Client Name Resolution Timeout"; Subsystem = "Network & DNS"; Explanation = "None of the configured DNS servers responded in time to resolve a hostname."; Fix = "Usually transient on wake/VPN switch; if frequent, test DNS servers (e.g., 1.1.1.1 / 8.8.8.8) or check router link." }
    "4003"  = @{ Title = "WLAN AutoConfig Connection Failure"; Subsystem = "Network & DNS"; Explanation = "Wi-Fi adapter failed to connect or dropped wireless association."; Fix = "Update Wi-Fi drivers, check router signal/channel, or disable Wi-Fi adapter power saving." }
    "10016" = @{ Title = "DistributedCOM Permission Warning"; Subsystem = "System General"; Explanation = "A COM component attempted activation without local/remote permissions (very common built-in Windows noise)."; Fix = "Almost always benign in Windows 10/11 unless accompanied by an actual app failure."; IsBenign = $true }
    "2004"  = @{ Title = "Resource Exhaustion: Low Virtual Memory"; Subsystem = "Kernel & Power"; Explanation = "Windows ran critically low on commit charge / virtual memory (RAM + Pagefile)."; Fix = "Identify the top memory-consuming processes listed in the event message and verify pagefile sizing." }
    "1116"  = @{ Title = "Windows Defender: Malware / Threat Detected"; Subsystem = "Security & Defender"; Explanation = "Microsoft Defender Antivirus detected malware or potentially unwanted software."; Fix = "Open Windows Security Protection History immediately to verify the threat was quarantined." }
    "1117"  = @{ Title = "Windows Defender: Remediation Action Taken"; Subsystem = "Security & Defender"; Explanation = "Microsoft Defender took action (quarantine/remove) on a detected threat."; Fix = "Verify the action succeeded and run a follow-up scan if needed." }
    "4625"  = @{ Title = "Security Audit: Failed Account Logon"; Subsystem = "Security & Defender"; Explanation = "An attempt to log on to this computer failed (bad password, locked account, or remote SMB/RDP probe)."; Fix = "Verify whether this was a mistyped password or unexpected network logon attempt." }
    "10000" = @{ Title = "DCOM Unable to Start Server"; Subsystem = "System General"; Explanation = "DistributedCOM could not start a registered COM server."; Fix = "Usually tied to an uninstalled app or UWP background task." }
    "131"   = @{ Title = "DeviceSetupManager Metadata Staging Failed"; Subsystem = "System General"; Explanation = "Windows failed to fetch optional device icon/metadata from Microsoft servers."; Fix = "Benign cosmetic warning (typically transient network/Microsoft server issue)."; IsBenign = $true }
    "219"   = @{ Title = "Kernel-PnP Driver Failed to Load"; Subsystem = "Hardware / WHEA"; Explanation = "A Plug and Play device driver failed to load during startup or device attach."; Fix = "Check the System Devices tab for yellow warning devices and reinstall the named driver." }
    "37"    = @{ Title = "Kernel-Processor-Power: CPU Speed Limited"; Subsystem = "Hardware / WHEA"; Explanation = "Processor speed was capped by system firmware (thermal limit, power plan, or battery/VRM limit)."; Fix = "Check CPU/VRM temperatures, BIOS power limits, and active Windows Power Plan." }
}

$script:HexCodeKB = @{
    "0xC0000005" = @{ Name = "STATUS_ACCESS_VIOLATION"; Category = "App / Memory Exception"; Explanation = "A program tried to read or write protected or invalid memory (null pointer, corrupted heap, bad driver/overlay)."; Fix = "Update the crashing app & GPU driver, disable overlays, or test RAM stability if multiple apps hit 0xC0000005." }
    "0xC0000409" = @{ Name = "STATUS_STACK_BUFFER_OVERRUN"; Category = "App / Security Exception"; Explanation = "A program triggered a fast-fail stack/security check (buffer overrun or corrupted state)."; Fix = "Update or repair the crashing application; check for corrupted DLLs with 'sfc /scannow'." }
    "0xC00000FD" = @{ Name = "STATUS_STACK_OVERFLOW"; Category = "App Exception"; Explanation = "A thread exhausted its stack memory (infinite recursion or deeply nested call)."; Fix = "Update the application or report the crash stack to the app vendor." }
    "0xC0000135" = @{ Name = "STATUS_DLL_NOT_FOUND"; Category = "App / Runtime"; Explanation = "A required DLL dependency could not be located when launching the application."; Fix = "Reinstall the application or install the required Visual C++ / .NET Redistributable." }
    "0xC000007B" = @{ Name = "STATUS_INVALID_IMAGE_FORMAT"; Category = "App / Runtime"; Explanation = "32-bit vs 64-bit DLL architecture mismatch or corrupted binary."; Fix = "Reinstall both x86 and x64 Visual C++ Redistributables and DirectX runtimes." }
    "0xE0434352" = @{ Name = "CLR_EXCEPTION (.NET Unhandled)"; Category = "App / .NET"; Explanation = "A .NET managed application threw an unhandled exception."; Fix = "Check Event 1026 (.NET Runtime) immediately before this event for the exact exception type." }
    "0x80000003" = @{ Name = "STATUS_BREAKPOINT"; Category = "App Exception"; Explanation = "A program hit a hardcoded breakpoint or assertion failure (common in Electron/Chromium OOM)."; Fix = "Check memory usage, GPU hardware acceleration settings, or update the app." }
    "0x80070002" = @{ Name = "ERROR_FILE_NOT_FOUND"; Category = "Win32 / HRESULT"; Explanation = "The system cannot find the file specified."; Fix = "Verify the file/update payload exists; for Windows Update, run 'DISM /Online /Cleanup-Image /RestoreHealth'." }
    "0x80070003" = @{ Name = "ERROR_PATH_NOT_FOUND"; Category = "Win32 / HRESULT"; Explanation = "The system cannot find the specified folder path."; Fix = "Verify the configured folder/drive is mounted and accessible." }
    "0x80070005" = @{ Name = "E_ACCESSDENIED"; Category = "Win32 / Permissions"; Explanation = "Access is denied due to insufficient permissions, UAC elevation, or security software blocking."; Fix = "Run with Administrator privileges or check NTFS/Defender Controlled Folder Access permissions." }
    "0x8007000E" = @{ Name = "E_OUTOFMEMORY"; Category = "Memory"; Explanation = "Not enough memory resources available to complete the operation."; Fix = "Close heavy apps, check for memory leaks, and confirm Windows pagefile is enabled." }
    "0x80070020" = @{ Name = "ERROR_SHARING_VIOLATION"; Category = "File I/O"; Explanation = "The file is currently locked/in use by another process."; Fix = "Close the application holding the file open and retry." }
    "0x80070070" = @{ Name = "ERROR_DISK_FULL"; Category = "Storage"; Explanation = "Not enough free disk space available on the target volume."; Fix = "Free up disk space on the affected drive." }
    "0x80070490" = @{ Name = "ERROR_NOT_FOUND"; Category = "Windows Servicing"; Explanation = "A required element or CBS servicing manifest was not found."; Fix = "Run 'sfc /scannow' and 'DISM /Online /Cleanup-Image /RestoreHealth'." }
    "0x800705B4" = @{ Name = "ERROR_TIMEOUT"; Category = "Timeout"; Explanation = "The operation timed out waiting for a response."; Fix = "Check network connectivity, service responsiveness, or storage latency." }
    "0x800F081F" = @{ Name = "CBS_E_SOURCE_MISSING"; Category = "Windows Update"; Explanation = "Source files needed for Windows Update or optional feature could not be found."; Fix = "Run 'DISM /Online /Cleanup-Image /RestoreHealth' and retry Windows Update." }
    "0x800F0922" = @{ Name = "CBS_E_INSTALLERS_FAILED"; Category = "Windows Update"; Explanation = "Windows Update failed to connect to update servers or ran low on System Reserved partition space."; Fix = "Check VPN/firewall, free space in System Reserved/EFI partition, and inspect C:\Windows\Logs\CBS\CBS.log." }
    "0x8024001E" = @{ Name = "WU_E_SERVICE_STOP"; Category = "Windows Update"; Explanation = "Operation did not complete because the Windows Update service or system was shutting down."; Fix = "Retry Windows Update once the system is idle." }
    "0x8024402C" = @{ Name = "WU_E_PT_WINHTTP_NAME_NOT_RESOLVED"; Category = "Windows Update / DNS"; Explanation = "Windows Update could not resolve the update server hostname via DNS."; Fix = "Check internet connection, proxy settings, and DNS resolver." }
    "0x0000000A" = @{ Name = "IRQL_NOT_LESS_OR_EQUAL"; Category = "BSOD BugCheck"; Explanation = "A kernel driver accessed pageable memory at an elevated interrupt request level."; Fix = "Update network/storage/GPU drivers and test RAM stability." }
    "0x0000001A" = @{ Name = "MEMORY_MANAGEMENT"; Category = "BSOD BugCheck"; Explanation = "A severe memory management error occurred in the Windows kernel."; Fix = "Run Windows Memory Diagnostic / MemTest86, test without XMP/EXPO, and check SSD health." }
    "0x0000001E" = @{ Name = "KMODE_EXCEPTION_NOT_HANDLED"; Category = "BSOD BugCheck"; Explanation = "A kernel-mode program generated an unhandled exception."; Fix = "Identify the faulting .sys driver in C:\Windows\Minidump and update or roll it back." }
    "0x0000003B" = @{ Name = "SYSTEM_SERVICE_EXCEPTION"; Category = "BSOD BugCheck"; Explanation = "An exception occurred while transitioning from non-privileged code to privileged kernel code."; Fix = "Update GPU, audio, and chipset drivers; run 'sfc /scannow'." }
    "0x00000050" = @{ Name = "PAGE_FAULT_IN_NONPAGED_AREA"; Category = "BSOD BugCheck"; Explanation = "Invalid system memory was referenced (faulty RAM, bad driver, or corrupted NTFS/pagefile)."; Fix = "Test RAM, check disk SMART status, and inspect recent kernel drivers." }
    "0x0000007A" = @{ Name = "KERNEL_DATA_INPAGE_ERROR"; Category = "BSOD BugCheck"; Explanation = "Requested kernel data page could not be read from the paging file into memory."; Fix = "Strong indicator of SSD/HDD/cable failure — back up data and inspect SMART immediately." }
    "0x0000009F" = @{ Name = "DRIVER_POWER_STATE_FAILURE"; Category = "BSOD BugCheck"; Explanation = "A driver failed to complete a sleep/wake/power state transition in time."; Fix = "Update chipset, USB, Wi-Fi, and GPU drivers; check Fast Startup / PCIe power saving." }
    "0x000000D1" = @{ Name = "DRIVER_IRQL_NOT_LESS_OR_EQUAL"; Category = "BSOD BugCheck"; Explanation = "A specific kernel driver attempted to access invalid memory at high IRQL."; Fix = "Update the named driver (commonly network, audio, or anti-cheat drivers)." }
    "0x000000EF" = @{ Name = "CRITICAL_PROCESS_DIED"; Category = "BSOD BugCheck"; Explanation = "A critical Windows system process terminated unexpectedly."; Fix = "Run 'sfc /scannow' and 'DISM /Online /Cleanup-Image /RestoreHealth'; inspect OS drive health." }
    "0x00000116" = @{ Name = "VIDEO_TDR_FAILURE"; Category = "BSOD BugCheck (GPU)"; Explanation = "Attempt to reset the display driver and recover from a GPU timeout failed."; Fix = "Cleanly reinstall GPU drivers (DDU), check GPU temps, power connectors, and remove GPU overclocks." }
    "0x00000119" = @{ Name = "VIDEO_SCHEDULER_INTERNAL_ERROR"; Category = "BSOD BugCheck (GPU)"; Explanation = "The Windows video scheduler detected a fatal GPU driver or VRAM violation."; Fix = "Update GPU drivers, test without GPU overclock, and verify DirectX/Windows updates." }
    "0x00000124" = @{ Name = "WHEA_UNCORRECTABLE_ERROR"; Category = "BSOD BugCheck (Hardware)"; Explanation = "A fatal hardware error occurred (CPU voltage/clock instability, PCIe fault, overheating, or defective hardware)."; Fix = "Reset BIOS CPU/RAM overclocks & Curve Optimizer to stock, update BIOS, and check CPU temps." }
    "0x00000133" = @{ Name = "DPC_WATCHDOG_VIOLATION"; Category = "BSOD BugCheck"; Explanation = "A Deferred Procedure Call (DPC) ran for too long, freezing a CPU core."; Fix = "Update SSD/NVMe firmware, Wi-Fi/Ethernet drivers, and GPU drivers." }
    "0x00000139" = @{ Name = "KERNEL_SECURITY_CHECK_FAILURE"; Category = "BSOD BugCheck"; Explanation = "The kernel detected corruption of a critical data structure."; Fix = "Test RAM stability, update kernel/anti-cheat drivers, and run 'sfc /scannow'." }
    "0x00000154" = @{ Name = "UNEXPECTED_STORE_EXCEPTION"; Category = "BSOD BugCheck (Storage)"; Explanation = "The kernel memory/storage store component caught an unexpected I/O or memory exception."; Fix = "Check SSD/NVMe SMART health, firmware, and test system RAM." }
}

function Resolve-HexOrWin32Code {
    param([string]$RawCode)

    $inputClean = if ($RawCode) { $RawCode.Trim() } else { "" }
    if (-not $inputClean) { return $null }

    $parsedInt = $null
    $hexKey = ""
    $isHexInput = $false

    if ($inputClean -match '^(?i)0x([0-9a-f]{1,8})$') {
        $isHexInput = $true
        $hexDigits = $Matches[1].ToUpperInvariant().PadLeft(8, '0')
        $hexKey = "0x$hexDigits"
        try {
            $uval = [Convert]::ToUInt32($hexDigits, 16)
            $parsedInt = [BitConverter]::ToInt32([BitConverter]::GetBytes($uval), 0)
        } catch {}
    } elseif ($inputClean -match '^-?\d{1,11}$') {
        try {
            $val64 = [int64]$inputClean
            if ($val64 -ge [int]::MinValue -and $val64 -le [uint32]::MaxValue) {
                $uval = if ($val64 -lt 0) { [BitConverter]::ToUInt32([BitConverter]::GetBytes([int]$val64), 0) } else { [uint32]$val64 }
                $parsedInt = [BitConverter]::ToInt32([BitConverter]::GetBytes($uval), 0)
                $hexKey = "0x{0:X8}" -f $uval
            }
        } catch {}
    } elseif ($inputClean -match '^(?i)([0-9a-f]{8})$') {
        $isHexInput = $true
        $hexDigits = $Matches[1].ToUpperInvariant()
        $hexKey = "0x$hexDigits"
        try {
            $uval = [Convert]::ToUInt32($hexDigits, 16)
            $parsedInt = [BitConverter]::ToInt32([BitConverter]::GetBytes($uval), 0)
        } catch {}
    }

    # 1. Check Curated Hex/BugCheck/NTSTATUS/HRESULT KB
    if ($hexKey -and $script:HexCodeKB.ContainsKey($hexKey)) {
        $kb = $script:HexCodeKB[$hexKey]
        return [PSCustomObject]@{
            input         = $inputClean
            code          = $hexKey
            decimal       = if ($null -ne $parsedInt) { [string]$parsedInt } else { "" }
            name          = $kb.Name
            category      = $kb.Category
            explanation   = $kb.Explanation
            fix           = $kb.Fix
            nativeMessage = ""
            source        = "UltimaDiagX Knowledge Base"
        }
    }

    # 2. If decimal (not 0x...), check Curated Windows Event ID KB
    if (-not $isHexInput -and $script:EventIdKB.ContainsKey($inputClean)) {
        $ev = $script:EventIdKB[$inputClean]
        return [PSCustomObject]@{
            input         = $inputClean
            code          = "Event ID $inputClean"
            decimal       = $inputClean
            name          = $ev.Title
            category      = "Windows Event ID ($($ev.Subsystem))"
            explanation   = $ev.Explanation
            fix           = $ev.Fix
            nativeMessage = ""
            source        = "UltimaDiagX Event ID KB"
        }
    }

    # 3. Check masked HRESULT 0x8007xxxx -> Win32 error code
    $nativeMsg = ""
    if ($null -ne $parsedInt) {
        try {
            $win32Code = $parsedInt
            if ($hexKey -match '^0x8007([0-9A-F]{4})$') {
                $win32Code = [Convert]::ToInt32($Matches[1], 16)
            }
            $ex = New-Object System.ComponentModel.Win32Exception($win32Code)
            if ($ex -and $ex.Message -and $ex.Message -notmatch '^Unknown error') {
                $nativeMsg = $ex.Message
            }
        } catch {}
    }

    if ($nativeMsg) {
        return [PSCustomObject]@{
            input         = $inputClean
            code          = if ($hexKey) { $hexKey } else { $inputClean }
            decimal       = if ($null -ne $parsedInt) { [string]$parsedInt } else { "" }
            name          = "Native Windows System Code"
            category      = "Win32 / HRESULT"
            explanation   = $nativeMsg
            fix           = "Use this native Windows message alongside the failing service, module, or file path in the event details."
            nativeMessage = $nativeMsg
            source        = "Windows Native Error Table (Win32)"
        }
    }

    return [PSCustomObject]@{
        input         = $inputClean
        code          = if ($hexKey) { $hexKey } else { $inputClean }
        decimal       = if ($null -ne $parsedInt) { [string]$parsedInt } else { "" }
        name          = "Unrecognized Code"
        category      = "Unknown"
        explanation   = "No built-in Windows Win32/Event ID/BugCheck translation matched '$inputClean'."
        fix           = "Try entering the full 8-digit hex code (e.g. 0x80070005, 0xC0000005, 0x00000116) or decimal Event ID (e.g. 41, 4101, 1000)."
        nativeMessage = ""
        source        = "Not Found"
    }
}

function Extract-TranslatedCodesFromMessage {
    param([string]$Message)
    $found = New-Object System.Collections.Generic.List[PSCustomObject]
    if (-not $Message) { return $found.ToArray() }

    $seen = New-Object System.Collections.Generic.HashSet[string]([System.StringComparer]::OrdinalIgnoreCase)
    $hexMatches = [regex]::Matches($Message, '\b0x([0-9a-fA-F]{4,8})\b')
    foreach ($m in $hexMatches) {
        $norm = "0x" + $m.Groups[1].Value.ToUpperInvariant().PadLeft(8, '0')
        if ($norm -eq "0x00000000" -or -not $seen.Add($norm)) { continue }
        $res = Resolve-HexOrWin32Code -RawCode $norm
        if ($res -and $res.source -ne "Not Found") {
            $found.Add($res)
        }
        if ($found.Count -ge 3) { break }
    }
    return $found.ToArray()
}

function Classify-EventSubsystem {
    param(
        [string]$Channel,
        [string]$Provider,
        [int]$EventId,
        [string]$Message
    )

    $idStr = [string]$EventId
    if ($Provider -match '(?i)WHEA') { return "Hardware / WHEA" }
    if ($Provider -match '(?i)Display|nvlddmkm|amdkmdag|igfx|dxgkrnl') { return "Graphics / GPU" }
    if ($Provider -match '(?i)Disk|Ntfs|stornvme|storahci|volmgr|partmgr|iaStor') { return "Storage & Disk" }
    if ($Provider -match '(?i)Kernel-Power|BugCheck|Kernel-General|Resource-Exhaustion|Kernel-Boot') { return "Kernel & Power" }
    if ($Provider -match '(?i)DNS|Dhcp|WLAN|Tcpip|NetBT|e1|rt64|Netwtw|Ndis|BTH') { return "Network & DNS" }
    if ($Provider -match '(?i)WindowsUpdate|TrustedInstaller|Service Control Manager|WUSA|MsiInstaller|CBS') { return "Windows Update & Services" }
    if ($Provider -match '(?i)Defender|Security|Audit|TPM|BitLocker') { return "Security & Defender" }
    if ($Provider -match '(?i)Application Error|Application Hang|Windows Error Reporting|\.NET Runtime|SideBySide') { return "Applications & Crashes" }
    if ($Channel -match '(?i)WHEA') { return "Hardware / WHEA" }
    if ($Channel -match '(?i)Ntfs') { return "Storage & Disk" }
    if ($Channel -match '(?i)WLAN|DHCP') { return "Network & DNS" }
    if ($Channel -match '(?i)WindowsUpdate|Setup') { return "Windows Update & Services" }
    if ($Channel -match '(?i)Defender|Security') { return "Security & Defender" }
    if ($Channel -eq "Application") { return "Applications & Crashes" }
    if ($script:EventIdKB.ContainsKey($idStr)) { return $script:EventIdKB[$idStr].Subsystem }
    return "System General"
}

function Parse-ExternalLogSources {
    param(
        [string[]]$Paths,
        [datetime]$SinceTime
    )

    $entries = New-Object System.Collections.Generic.List[PSCustomObject]
    $sourcesScanned = New-Object System.Collections.Generic.List[PSCustomObject]
    if (-not $Paths -or $Paths.Count -eq 0) {
        return @{ entries = @(); sources = @() }
    }

    foreach ($rawPath in $Paths) {
        $p = ([string]$rawPath).Trim().Trim('"')
        if (-not $p -or -not (Test-Path -LiteralPath $p -ErrorAction SilentlyContinue)) {
            $sourcesScanned.Add([PSCustomObject]@{ path = $p; status = "Missing"; matched = 0 })
            continue
        }

        $filesToRead = @()
        if (Test-Path -LiteralPath $p -PathType Container) {
            $filesToRead = @(Get-ChildItem -LiteralPath $p -File -ErrorAction SilentlyContinue |
                Where-Object { $_.Extension -in @('.log', '.txt', '.err', '.out', '.evtx') } |
                Sort-Object LastWriteTime -Descending | Select-Object -First 4)
        } else {
            $filesToRead = @(Get-Item -LiteralPath $p -ErrorAction SilentlyContinue)
        }

        $sourceHits = 0
        foreach ($file in $filesToRead) {
            if (-not $file) { continue }

            # Support exported Windows .evtx log files natively!
            if ($file.Extension -ieq '.evtx') {
                try {
                    $evtxEvents = Get-WinEvent -FilterHashtable @{ Path = $file.FullName; Level = @(1, 2, 3) } -MaxEvents 60 -ErrorAction Stop
                    foreach ($ev in $evtxEvents) {
                        $sev = switch ($ev.Level) { 1 { "Critical" } 2 { "Error" } 3 { "Warning" } default { "Info" } }
                        $msg = if ($ev.Message) { ($ev.Message -replace '\s+', ' ').Trim() } else { "Event $($ev.Id) from $($ev.ProviderName)" }
                        if ($msg.Length -gt 450) { $msg = $msg.Substring(0, 447) + "..." }
                        $codes = @(Extract-TranslatedCodesFromMessage -Message $msg)
                        $entries.Add([PSCustomObject]@{
                            timestamp      = $ev.TimeCreated.ToString("yyyy-MM-dd HH:mm:ss")
                            epochMs        = [long]([DateTimeOffset]$ev.TimeCreated).ToUnixTimeMilliseconds()
                            severity       = $sev
                            sourceType     = "External"
                            channel        = $file.Name
                            provider       = [string]$ev.ProviderName
                            eventId        = [int]$ev.Id
                            subsystem      = "External App Logs"
                            message        = $msg
                            translation    = if ($script:EventIdKB.ContainsKey([string]$ev.Id)) { $script:EventIdKB[[string]$ev.Id].Explanation } elseif ($codes.Count -gt 0) { "$($codes[0].code) ($($codes[0].name)): $($codes[0].explanation)" } else { "" }
                            recommendedFix = if ($script:EventIdKB.ContainsKey([string]$ev.Id)) { $script:EventIdKB[[string]$ev.Id].Fix } elseif ($codes.Count -gt 0) { $codes[0].fix } else { "" }
                            extractedCodes = $codes
                            isBenign       = $false
                        })
                        $sourceHits++
                    }
                } catch {}
                continue
            }

            # Text / .log / .txt parser (tail last 400 lines so even 200MB logs parse in <20ms!)
            try {
                $lines = @(Get-Content -LiteralPath $file.FullName -Tail 400 -ErrorAction Stop)
                $lineNum = 0
                foreach ($line in $lines) {
                    $lineNum++
                    if (-not $line -or -not $line.Trim()) { continue }
                    $trim = $line.Trim()

                    $sev = ""
                    if ($trim -match '(?i)\b(FATAL|CRITICAL|PANIC|CRASH|BUGCHECK|UNHANDLED EXCEPTION|BSOD)\b') {
                        $sev = "Critical"
                    } elseif ($trim -match '(?i)\b(ERROR|ERR|EXCEPTION|FAILED|FAILURE|SEGFAULT|ACCESS VIOLATION)\b|0x(?:C000|8007|800F|8024)[0-9A-Fa-f]{4}') {
                        $sev = "Error"
                    } elseif ($trim -match '(?i)\b(WARN|WARNING|TIMEOUT|RETRY|DEGRADED|THROTTL)\b') {
                        $sev = "Warning"
                    } else {
                        continue
                    }

                    $ts = $file.LastWriteTime
                    if ($trim -match '(\d{4}[-/]\d{2}[-/]\d{2}[T\s]\d{2}:\d{2}:\d{2})') {
                        try { $ts = [datetime]::Parse($Matches[1]) } catch {}
                    }

                    $cleanMsg = if ($trim.Length -gt 450) { $trim.Substring(0, 447) + "..." } else { $trim }
                    $codes = @(Extract-TranslatedCodesFromMessage -Message $cleanMsg)
                    $transText = if ($codes.Count -gt 0) { "$($codes[0].code) ($($codes[0].name)): $($codes[0].explanation)" } else { "" }
                    $fixText   = if ($codes.Count -gt 0) { $codes[0].fix } else { "" }

                    $entries.Add([PSCustomObject]@{
                        timestamp      = $ts.ToString("yyyy-MM-dd HH:mm:ss")
                        epochMs        = [long]([DateTimeOffset]$ts).ToUnixTimeMilliseconds()
                        severity       = $sev
                        sourceType     = "External"
                        channel        = $file.Name
                        provider       = $file.Directory.Name
                        eventId        = 0
                        subsystem      = "External App Logs"
                        message        = $cleanMsg
                        translation    = $transText
                        recommendedFix = $fixText
                        extractedCodes = $codes
                        isBenign       = $false
                    })
                    $sourceHits++
                    if ($sourceHits -ge 80) { break }
                }
            } catch {}
        }

        $sourcesScanned.Add([PSCustomObject]@{ path = $p; status = "Active"; matched = $sourceHits })
    }

    return @{
        entries = $entries.ToArray()
        sources = $sourcesScanned.ToArray()
    }
}

function Get-CrashDumpsAndReliability {
    $dumps = New-Object System.Collections.Generic.List[PSCustomObject]
    $dumpLocations = @(
        @{ Path = "$env:SystemRoot\Minidump"; Filter = "*.dmp"; Kind = "Kernel BSOD Minidump" },
        @{ Path = "$env:LOCALAPPDATA\CrashDumps"; Filter = "*.dmp"; Kind = "User App Crash Dump" }
    )
    foreach ($loc in $dumpLocations) {
        if (Test-Path -LiteralPath $loc.Path -PathType Container -ErrorAction SilentlyContinue) {
            Get-ChildItem -LiteralPath $loc.Path -Filter $loc.Filter -File -ErrorAction SilentlyContinue |
                Sort-Object LastWriteTime -Descending | Select-Object -First 10 | ForEach-Object {
                    $dumps.Add([PSCustomObject]@{
                        name      = $_.Name
                        path      = $_.FullName
                        kind      = $loc.Kind
                        timestamp = $_.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss")
                        sizeMB    = [math]::Round(($_.Length / 1MB), 2)
                    })
                }
        }
    }
    $memDmp = "$env:SystemRoot\MEMORY.DMP"
    if (Test-Path -LiteralPath $memDmp -PathType Leaf -ErrorAction SilentlyContinue) {
        $mi = Get-Item -LiteralPath $memDmp -ErrorAction SilentlyContinue
        if ($mi) {
            $dumps.Add([PSCustomObject]@{
                name      = $mi.Name
                path      = $mi.FullName
                kind      = "Full Kernel Memory Dump"
                timestamp = $mi.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss")
                sizeMB    = [math]::Round(($mi.Length / 1MB), 1)
            })
        }
    }

    $reliabilityScore = $null
    try {
        $rel = Get-CimInstance -ClassName Win32_ReliabilityStabilityMetrics -ErrorAction SilentlyContinue |
               Sort-Object TimeGenerated -Descending | Select-Object -First 1
        if ($rel -and $null -ne $rel.SystemStabilityIndex) {
            $reliabilityScore = [math]::Round([double]$rel.SystemStabilityIndex, 1)
        }
    } catch {}

    $werCount = 0
    $werPath = "$env:ProgramData\Microsoft\Windows\WER\ReportArchive"
    if (Test-Path -LiteralPath $werPath -PathType Container -ErrorAction SilentlyContinue) {
        $cutoff = (Get-Date).AddDays(-7)
        $werCount = @(Get-ChildItem -LiteralPath $werPath -Directory -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -ge $cutoff }).Count
    }

    return @{
        dumps            = $dumps.ToArray()
        reliabilityIndex = $reliabilityScore
        werRecent7d      = $werCount
    }
}

function Discover-CommonSystemAndAppLogs {
    $candidates = @(
        @{ label = "Windows CBS Servicing Log";       path = "$env:SystemRoot\Logs\CBS\CBS.log" },
        @{ label = "Windows DISM Log";                path = "$env:SystemRoot\Logs\DISM\dism.log" },
        @{ label = "Windows SetupAPI Device Log";     path = "$env:SystemRoot\INF\setupapi.dev.log" },
        @{ label = "Windows Defender Support Logs";   path = "$env:ProgramData\Microsoft\Windows Defender\Support" },
        @{ label = "User Crash Dumps Folder";         path = "$env:LOCALAPPDATA\CrashDumps" },
        @{ label = "Steam Logs Folder";               path = "C:\Program Files (x86)\Steam\logs" },
        @{ label = "Discord Squirrel Log";            path = "$env:LOCALAPPDATA\Discord\SquirrelSetup.log" },
        @{ label = "NVIDIA Display Container Logs";   path = "$env:ProgramData\NVIDIA Corporation\DisplaySessionContainer" },
        @{ label = "VS Code User Logs";               path = "$env:APPDATA\Code\logs" }
    )

    $found = foreach ($c in $candidates) {
        if (Test-Path -LiteralPath $c.path -ErrorAction SilentlyContinue) {
            [PSCustomObject]@{
                label = $c.label
                path  = $c.path
                isDir = (Test-Path -LiteralPath $c.path -PathType Container)
            }
        }
    }
    return @{
        type    = "ULTIMADIAGX_DISCOVERED_LOGS"
        logs    = @($found)
        message = "Discovered $(@($found).Count) available system & program log sources."
        error   = $null
    }
}

function Get-UltimaDiagXReport {
    [CmdletBinding()]
    param(
        [int]$HoursBack = 24,
        [bool]$IncludeWarnings = $true,
        [string[]]$ExternalLogs = @()
    )

    try {
        if ($HoursBack -lt 1) { $HoursBack = 24 }
        $since = (Get-Date).AddHours(-$HoursBack)
        $levels = if ($IncludeWarnings) { @(1, 2, 3) } else { @(1, 2) }

        $channels = @(
            @{ Name = "System";                                            Max = 140 },
            @{ Name = "Application";                                       Max = 140 },
            @{ Name = "Setup";                                             Max = 40  },
            @{ Name = "Microsoft-Windows-Kernel-WHEA/Errors";              Max = 40  },
            @{ Name = "Microsoft-Windows-Ntfs/Operational";                Max = 40  },
            @{ Name = "Microsoft-Windows-WindowsUpdateClient/Operational"; Max = 40  },
            @{ Name = "Microsoft-Windows-WLAN-AutoConfig/Operational";     Max = 40  },
            @{ Name = "Microsoft-Windows-DHCP-Client/Admin";               Max = 30  },
            @{ Name = "Microsoft-Windows-Windows Defender/Operational";    Max = 40  },
            @{ Name = "Microsoft-Windows-TaskScheduler/Operational";       Max = 30  }
        )

        $allEvents = New-Object System.Collections.Generic.List[PSCustomObject]
        $channelsScanned = 0

        foreach ($ch in $channels) {
            try {
                $raw = Get-WinEvent -FilterHashtable @{
                    LogName   = $ch.Name
                    Level     = $levels
                    StartTime = $since
                } -MaxEvents $ch.Max -ErrorAction Stop
                $channelsScanned++

                foreach ($ev in $raw) {
                    $sev = switch ($ev.Level) {
                        1 { "Critical" }
                        2 { "Error" }
                        3 { "Warning" }
                        default { "Info" }
                    }
                    $idInt = [int]$ev.Id
                    $idStr = [string]$idInt
                    $prov  = [string]$ev.ProviderName
                    $msg   = if ($ev.Message) { ($ev.Message -replace '\r?\n+', ' ' -replace '\s{2,}', ' ').Trim() } else { "Event ID $idInt from $prov" }
                    if ($msg.Length -gt 480) { $msg = $msg.Substring(0, 477) + "..." }

                    $subsystem = Classify-EventSubsystem -Channel $ch.Name -Provider $prov -EventId $idInt -Message $msg
                    $extractedCodes = @(Extract-TranslatedCodesFromMessage -Message $msg)

                    $transText = ""
                    $fixText   = ""
                    $isBenign  = $false

                    # Avoid Event ID collisions (e.g. Event 1001 from Dhcp vs BugCheck, Event 20 from WU vs WHEA)
                    if ($script:EventIdKB.ContainsKey($idStr)) {
                        $kbEntry = $script:EventIdKB[$idStr]
                        $skipKb = ($idInt -eq 1001 -and $prov -match 'Dhcp') -or ($idInt -eq 1002 -and $prov -match 'Dhcp') -or ($idInt -eq 20 -and $prov -notmatch 'WindowsUpdate|WHEA')
                        if (-not $skipKb) {
                            $transText = "$($kbEntry.Title) — $($kbEntry.Explanation)"
                            $fixText   = $kbEntry.Fix
                            $isBenign  = [bool]$kbEntry.IsBenign
                        }
                    }
                    if ($extractedCodes.Count -gt 0) {
                        $codeNote = "$($extractedCodes[0].code) ($($extractedCodes[0].name)): $($extractedCodes[0].explanation)"
                        $transText = if ($transText) { "$transText | Code: $codeNote" } else { $codeNote }
                        if (-not $fixText) { $fixText = $extractedCodes[0].fix }
                    }

                    $allEvents.Add([PSCustomObject]@{
                        timestamp      = $ev.TimeCreated.ToString("yyyy-MM-dd HH:mm:ss")
                        epochMs        = [long]([DateTimeOffset]$ev.TimeCreated).ToUnixTimeMilliseconds()
                        severity       = $sev
                        sourceType     = "Windows"
                        channel        = $ch.Name
                        provider       = $prov
                        eventId        = $idInt
                        subsystem      = $subsystem
                        message        = $msg
                        translation    = $transText
                        recommendedFix = $fixText
                        extractedCodes = $extractedCodes
                        isBenign       = $isBenign
                    })
                }
            } catch {
                # Channel may have 0 matching events or require elevation; count as scanned cleanly
                $channelsScanned++
            }
        }

        # Merge External Program Logs
        $extRes = Parse-ExternalLogSources -Paths $ExternalLogs -SinceTime $since
        foreach ($e in $extRes.entries) {
            $allEvents.Add($e)
        }

        $sortedEvents = @($allEvents | Sort-Object epochMs -Descending)

        # Crash Dumps + Windows Reliability Monitor
        $crashInfo = Get-CrashDumpsAndReliability

        # =========================================================================
        # AUTOMATED SYSTEM SYNOPSIS & SUBSYSTEM HEALTH ENGINE
        # =========================================================================
        $critCount = @($sortedEvents | Where-Object { $_.severity -eq "Critical" }).Count
        $errCount  = @($sortedEvents | Where-Object { $_.severity -eq "Error" -and -not $_.isBenign }).Count
        $warnCount = @($sortedEvents | Where-Object { $_.severity -eq "Warning" -and -not $_.isBenign }).Count
        $benignCount = @($sortedEvents | Where-Object { $_.isBenign }).Count
        $extErrCount = @($sortedEvents | Where-Object { $_.sourceType -eq "External" -and $_.severity -in @("Critical", "Error") }).Count

        $subsystemDefs = @(
            @{ Name = "Kernel & Power";            Icon = "⚡" },
            @{ Name = "Hardware / WHEA";           Icon = "🧬" },
            @{ Name = "Storage & Disk";            Icon = "💾" },
            @{ Name = "Graphics / GPU";            Icon = "🎮" },
            @{ Name = "Network & DNS";             Icon = "📡" },
            @{ Name = "Applications & Crashes";    Icon = "📦" },
            @{ Name = "Windows Update & Services"; Icon = "🛠️" },
            @{ Name = "External App Logs";         Icon = "📄" }
        )

        $subsystemsOut = foreach ($sd in $subsystemDefs) {
            $subEvents = @($sortedEvents | Where-Object { $_.subsystem -eq $sd.Name -and -not $_.isBenign })
            $sc = @($subEvents | Where-Object { $_.severity -eq "Critical" }).Count
            $se = @($subEvents | Where-Object { $_.severity -eq "Error" }).Count
            $sw = @($subEvents | Where-Object { $_.severity -eq "Warning" }).Count
            $state = if ($sc -gt 0 -or ($sd.Name -in @("Hardware / WHEA", "Storage & Disk") -and $se -gt 0)) { "CRITICAL" }
                     elseif ($se -gt 0 -or $sw -ge 5) { "WARN" }
                     else { "OK" }
            [PSCustomObject]@{
                name     = $sd.Name
                icon     = $sd.Icon
                status   = $state
                critical = $sc
                errors   = $se
                warnings = $sw
                total    = $subEvents.Count
            }
        }

        # Detect High-Priority Diagnostic Findings (Root-Cause Patterns)
        $findings = New-Object System.Collections.Generic.List[PSCustomObject]
        function _maxEpoch($arr) {
            if (-not $arr -or $arr.Count -eq 0) { return [long]0 }
            $m = ($arr | Measure-Object -Property epochMs -Maximum).Maximum
            if ($null -ne $m) { return [long]$m }
            return [long]0
        }

        $kp41 = @($sortedEvents | Where-Object { $_.eventId -eq 41 -and $_.provider -match 'Kernel-Power' })
        if ($kp41.Count -gt 0) {
            $findings.Add([PSCustomObject]@{
                id             = "kp41"
                latestEpochMs  = _maxEpoch $kp41
                severity       = "CRITICAL"
                title          = "Unexpected System Reboots / Power Loss (Event 41)"
                count          = $kp41.Count
                subsystem      = "Kernel & Power"
                explanation    = "Detected $($kp41.Count) unexpected reboot(s) in the last $HoursBack hour(s) where Windows did not shut down cleanly."
                recommendation = "Inspect BSOD minidumps below, check PSU cables/load, and verify CPU/RAM stability."
            })
        }

        $whea = @($sortedEvents | Where-Object { $_.subsystem -eq "Hardware / WHEA" -and -not $_.isBenign })
        if ($whea.Count -gt 0) {
            $findings.Add([PSCustomObject]@{
                id             = "whea"
                latestEpochMs  = _maxEpoch $whea
                severity       = "CRITICAL"
                title          = "Hardware / WHEA Faults Detected"
                count          = $whea.Count
                subsystem      = "Hardware / WHEA"
                explanation    = "Windows Hardware Error Architecture logged $($whea.Count) CPU, RAM, or PCIe hardware fault(s)."
                recommendation = "Reset CPU/RAM overclocks or undervolts to stock, update motherboard BIOS, and run memory diagnostics."
            })
        }

        $diskIssues = @($sortedEvents | Where-Object { $_.subsystem -eq "Storage & Disk" -and $_.eventId -in @(7, 11, 51, 55, 98, 129, 153) })
        if ($diskIssues.Count -gt 0) {
            $findings.Add([PSCustomObject]@{
                id             = "disk"
                latestEpochMs  = _maxEpoch $diskIssues
                severity       = "CRITICAL"
                title          = "Storage / Disk I/O or NTFS Warnings"
                count          = $diskIssues.Count
                subsystem      = "Storage & Disk"
                explanation    = "Detected $($diskIssues.Count) disk bad block, controller reset, I/O retry, or NTFS corruption event(s)."
                recommendation = "Back up important data, verify SSD/HDD SMART health, and run 'chkdsk /scan'."
            })
        }

        $gpuTdr = @($sortedEvents | Where-Object { $_.subsystem -eq "Graphics / GPU" -and $_.eventId -in @(4101, 14) })
        if ($gpuTdr.Count -gt 0) {
            $findings.Add([PSCustomObject]@{
                id             = "gpu_tdr"
                latestEpochMs  = _maxEpoch $gpuTdr
                severity       = "WARN"
                title          = "GPU Display Driver Timeout / Reset (TDR)"
                count          = $gpuTdr.Count
                subsystem      = "Graphics / GPU"
                explanation    = "The graphics driver stopped responding and was recovered $($gpuTdr.Count) time(s)."
                recommendation = "Check GPU temperatures, PSU power delivery, and consider a clean GPU driver reinstall."
            })
        }

        $appCrashes = @($sortedEvents | Where-Object { $_.eventId -in @(1000, 1002, 1026) -and $_.channel -eq "Application" })
        if ($appCrashes.Count -gt 0) {
            $findings.Add([PSCustomObject]@{
                id             = "app_crashes"
                latestEpochMs  = _maxEpoch $appCrashes
                severity       = if ($appCrashes.Count -ge 5) { "CRITICAL" } else { "WARN" }
                title          = "Application Crashes & Hangs"
                count          = $appCrashes.Count
                subsystem      = "Applications & Crashes"
                explanation    = "Recorded $($appCrashes.Count) application crash/hang/.NET exception event(s) in the selected window."
                recommendation = "Filter by 'Applications & Crashes' below to inspect the faulting module and translated exception code."
            })
        }

        $svcFails = @($sortedEvents | Where-Object { $_.provider -match 'Service Control Manager' -and $_.eventId -in @(7000, 7001, 7009, 7023, 7031, 7034) })
        if ($svcFails.Count -gt 0) {
            $findings.Add([PSCustomObject]@{
                id             = "svc_fails"
                latestEpochMs  = _maxEpoch $svcFails
                severity       = "WARN"
                title          = "Windows Service Start / Crash Failures"
                count          = $svcFails.Count
                subsystem      = "Windows Update & Services"
                explanation    = "$($svcFails.Count) Windows service(s) failed to start, timed out, or terminated unexpectedly."
                recommendation = "Inspect the named service in the event list; repair or disable orphaned third-party services."
            })
        }

        $netDrops = @($sortedEvents | Where-Object { $_.subsystem -eq "Network & DNS" -and $_.severity -in @("Critical", "Error", "Warning") })
        if ($netDrops.Count -ge 3) {
            $findings.Add([PSCustomObject]@{
                id             = "net_drops"
                latestEpochMs  = _maxEpoch $netDrops
                severity       = "WARN"
                title          = "Network / DNS / WLAN Disruptions"
                count          = $netDrops.Count
                subsystem      = "Network & DNS"
                explanation    = "Detected $($netDrops.Count) DNS timeout, DHCP, or Wi-Fi disconnect events."
                recommendation = "Check router/ISP stability, DNS server latency, and network adapter drivers."
            })
        }

        $recentKernelDumps = @($crashInfo.dumps | Where-Object { $_.kind -match 'Kernel' })
        if ($recentKernelDumps.Count -gt 0) {
            $dumpEpoch = [long]0
            try {
                if ($recentKernelDumps[0].timestamp) {
                    $dt = [datetime]::ParseExact([string]$recentKernelDumps[0].timestamp, "yyyy-MM-dd HH:mm:ss", [System.Globalization.CultureInfo]::InvariantCulture)
                    $dumpEpoch = [long]([DateTimeOffset]$dt).ToUnixTimeMilliseconds()
                }
            } catch {}
            $findings.Add([PSCustomObject]@{
                id             = "kernel_dumps"
                latestEpochMs  = $dumpEpoch
                severity       = "WARN"
                title          = "BSOD Kernel Crash Dumps Found on Disk"
                count          = $recentKernelDumps.Count
                subsystem      = "Kernel & Power"
                explanation    = "Found $($recentKernelDumps.Count) kernel crash dump file(s) (latest: $($recentKernelDumps[0].name) on $($recentKernelDumps[0].timestamp))."
                recommendation = "Analyze the latest minidump with WinDbg to pinpoint the exact faulting kernel driver."
            })
        }

        if ($extErrCount -gt 0) {
            $extErrEvs = @($sortedEvents | Where-Object { $_.sourceType -eq "External" -and $_.severity -in @("Critical", "Error") })
            $findings.Add([PSCustomObject]@{
                id             = "ext_errors"
                latestEpochMs  = _maxEpoch $extErrEvs
                severity       = "WARN"
                title          = "External Program Log Errors Detected"
                count          = $extErrCount
                subsystem      = "External App Logs"
                explanation    = "Found $extErrCount error/critical line(s) across your attached third-party program logs."
                recommendation = "Filter by 'External App Logs' to review each program error and any translated Windows codes."
            })
        }

        # Top Recurring Event Signatures
        $topRecurring = @($sortedEvents | Where-Object { -not $_.isBenign -and $_.eventId -gt 0 } |
            Group-Object { "$($_.provider)|$($_.eventId)" } |
            Sort-Object Count -Descending | Select-Object -First 6 | ForEach-Object {
                $first = $_.Group[0]
                [PSCustomObject]@{
                    provider  = $first.provider
                    eventId   = $first.eventId
                    severity  = $first.severity
                    subsystem = $first.subsystem
                    count     = $_.Count
                    summary   = if ($first.translation) { $first.translation } else { $first.message }
                }
            })

        # Compute Composite Health Score (0 - 100)
        $score = 100
        $score -= [math]::Min(45, ($critCount * 15))
        $score -= [math]::Min(30, ($errCount * 2))
        $score -= [math]::Min(12, ([math]::Floor($warnCount / 4)))
        if ($whea.Count -gt 0) { $score -= 12 }
        if ($diskIssues.Count -gt 0) { $score -= 12 }
        if ($null -ne $crashInfo.reliabilityIndex -and $crashInfo.reliabilityIndex -lt 7.0) {
            $score -= [int][math]::Round((7.0 - $crashInfo.reliabilityIndex) * 4)
        }
        $score = [math]::Max(5, [math]::Min(100, $score))

        $grade = if ($score -ge 85 -and $critCount -eq 0) { "HEALTHY" }
                 elseif ($score -ge 65) { "ADVISORY" }
                 elseif ($score -ge 40) { "DEGRADED" }
                 else { "CRITICAL" }

        # Build Plain-English Executive Synopsis
        $synopsisParts = New-Object System.Collections.Generic.List[string]
        $synopsisParts.Add("Analyzed $($sortedEvents.Count) diagnostic events across $channelsScanned Windows channels$(if ($ExternalLogs.Count -gt 0) { " and $($ExternalLogs.Count) external log source(s)" }) over the last $HoursBack hour(s).")
        if ($critCount -eq 0 -and $errCount -eq 0) {
            $synopsisParts.Add("No critical faults or actionable errors were detected — system stability looks solid.")
        } else {
            $synopsisParts.Add("Detected $critCount critical fault(s), $errCount actionable error(s), and $warnCount warning(s)$(if ($benignCount -gt 0) { " ($benignCount known benign Windows noise events filtered from health penalty)" }).")
        }
        if ($findings.Count -gt 0) {
            $topNames = ($findings | Select-Object -First 3 -ExpandProperty title) -join "; "
            $synopsisParts.Add("Primary attention areas: $topNames.")
        }
        if ($null -ne $crashInfo.reliabilityIndex) {
            $synopsisParts.Add("Windows Reliability Monitor Stability Index: $($crashInfo.reliabilityIndex) / 10.")
        }

        $cappedEvents = if ($sortedEvents.Count -gt 350) { @($sortedEvents | Select-Object -First 350) } else { $sortedEvents }

        return @{
            type             = "ULTIMADIAGX_REPORT"
            generatedAt      = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
            hoursBack        = $HoursBack
            healthScore      = $score
            healthGrade      = $grade
            reliabilityIndex = $crashInfo.reliabilityIndex
            werRecent7d      = $crashInfo.werRecent7d
            executiveSummary = ($synopsisParts -join " ")
            counts           = @{
                total      = $sortedEvents.Count
                critical   = $critCount
                errors     = $errCount
                warnings   = $warnCount
                benign     = $benignCount
                external   = @($sortedEvents | Where-Object { $_.sourceType -eq "External" }).Count
                channels   = $channelsScanned
            }
            subsystems       = @($subsystemsOut)
            findings         = $findings.ToArray()
            topRecurring     = $topRecurring
            crashDumps       = $crashInfo.dumps
            externalSources  = $extRes.sources
            events           = $cappedEvents
            truncated        = ($sortedEvents.Count -gt 350)
            error            = $null
        }
    } catch {
        return @{
            type  = "ULTIMADIAGX_REPORT"
            error = $_.Exception.Message
        }
    }
}

function Escape-MdCell {
    param([string]$Text)
    if ($null -eq $Text) { return "" }
    return (($Text -replace '\r?\n+', ' ') -replace '\|', '\|').Trim()
}

function Collect-CoreWatchSnapshotForExport {
    param([string]$RootPath)

    $snap = @{
        Id             = $null
        Infra          = $null
        System         = $null
        Storage        = @()
        PhysicalDisks  = @()
        Network        = $null
        Adapters       = @()
        Devices        = $null
        Startup        = $null
        InstalledApps  = $null
        Shares         = $null
        TopProcesses   = @()
        IsAdmin        = $false
    }

    try {
        $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
        $snap.IsAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    } catch {}

    $resolvedRoot = if ($RootPath -and (Test-Path -LiteralPath $RootPath)) {
        $RootPath
    } else {
        Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
    }
    $telDir = Join-Path $resolvedRoot "modules\telemetry"
    $tabDir = Join-Path $resolvedRoot "modules\tabs"

    # 1. Core Identity, Infrastructure, Display, Hardware, Storage & Network Telemetry
    try {
        $p = Join-Path $telDir "GetIDMetrics.ps1"
        if (Test-Path -LiteralPath $p) { . $p; $snap.Id = Get-IDMetrics }
    } catch {}

    try {
        $p = Join-Path $telDir "GetInfraMetrics.ps1"
        if (Test-Path -LiteralPath $p) { . $p; $snap.Infra = Get-InfraMetrics }
    } catch {}

    try {
        $p = Join-Path $telDir "GetSystemMetrics.ps1"
        if (Test-Path -LiteralPath $p) {
            . $p
            $null = Get-SystemMetrics
            Start-Sleep -Milliseconds 150
            $snap.System = Get-SystemMetrics
        }
    } catch {}

    try {
        $p = Join-Path $telDir "StorageEngine.ps1"
        if (Test-Path -LiteralPath $p) { . $p; $snap.Storage = @(Get-StorageMetrics) }
    } catch {}

    try {
        $snap.PhysicalDisks = @(Get-PhysicalDisk -ErrorAction SilentlyContinue | Select-Object FriendlyName, MediaType, BusType, HealthStatus, OperationalStatus, @{ N = 'SizeGB'; E = { [math]::Round(($_.Size / 1GB), 1) } })
    } catch {}

    try {
        $p = Join-Path $telDir "GetNetworkMetrics.ps1"
        if (Test-Path -LiteralPath $p) { . $p; $snap.Network = Get-NetworkMetrics }
    } catch {}

    # 2. Tab Systems: Network Adapters, System Devices, Startup Apps, Installed Apps, Sharing Center
    try {
        $p = Join-Path $tabDir "NetworkManager.ps1"
        if (Test-Path -LiteralPath $p) { . $p; $ad = Get-AdapterStateMesh; $snap.Adapters = @($ad.interfaces) }
    } catch {}

    try {
        $p = Join-Path $tabDir "DeviceManager.ps1"
        if (Test-Path -LiteralPath $p) { . $p; $snap.Devices = Get-SystemDevicesMesh }
    } catch {}

    try {
        $p = Join-Path $tabDir "StartupManager.ps1"
        if (Test-Path -LiteralPath $p) { . $p; $snap.Startup = Get-StartupAppsMesh }
    } catch {}

    try {
        $p = Join-Path $tabDir "InstalledAppsManager.ps1"
        if (Test-Path -LiteralPath $p) { . $p; $snap.InstalledApps = Get-InstalledAppsMesh }
    } catch {}

    try {
        $p = Join-Path $tabDir "SharingManager.ps1"
        if (Test-Path -LiteralPath $p) { . $p; $snap.Shares = Get-SharingCenterState }
    } catch {}

    # 3. Live Top Memory / CPU Processes Snapshot
    try {
        $snap.TopProcesses = @(Get-Process -ErrorAction SilentlyContinue |
            Sort-Object WorkingSet64 -Descending | Select-Object -First 12 | ForEach-Object {
                [PSCustomObject]@{
                    Name     = [string]$_.ProcessName
                    Id       = [int]$_.Id
                    MemoryMB = [math]::Round(($_.WorkingSet64 / 1MB), 1)
                    CpuSec   = if ($null -ne $_.CPU) { [math]::Round([double]$_.CPU, 1) } else { 0 }
                }
            })
    } catch {}

    return $snap
}

function Export-UltimaDiagXMarkdown {
    param(
        $Payload,
        [string]$RootPath = ""
    )

    $hours = if ($Payload.hoursBack) { [int]$Payload.hoursBack } else { 24 }
    $includeWarn = if ($null -ne $Payload.includeWarnings) { [bool]$Payload.includeWarnings } else { $true }
    $extLogs = @($Payload.externalLogs | Where-Object { $_ })

    $report = Get-UltimaDiagXReport -HoursBack $hours -IncludeWarnings $includeWarn -ExternalLogs $extLogs
    if ($report.error) { throw $report.error }

    $snap = Collect-CoreWatchSnapshotForExport -RootPath $RootPath

    $desktop = [Environment]::GetFolderPath("Desktop")
    if (-not $desktop -or -not (Test-Path -LiteralPath $desktop)) { $desktop = $env:USERPROFILE }
    $stamp = (Get-Date).ToString("yyyyMMdd_HHmmss")
    $outFile = Join-Path $desktop "UltimaDiagX_Report_$stamp.md"

    $sb = New-Object System.Text.StringBuilder
    $null = $sb.AppendLine("# UltimaDiagX - Full System & Diagnostic Report")
    $null = $sb.AppendLine("- **Generated:** $($report.generatedAt)")
    $null = $sb.AppendLine("- **Host:** $(if ($snap.Id) { $snap.Id.HostName } else { $env:COMPUTERNAME })")
    $null = $sb.AppendLine("- **Elevated (Admin):** $(if ($snap.IsAdmin) { 'Yes' } else { 'No' })")
    $null = $sb.AppendLine("- **Diagnostic Window:** Last $($report.hoursBack) hour(s)")
    $null = $sb.AppendLine("- **Composite Health Score:** $($report.healthScore)/100 ($($report.healthGrade))")
    if ($null -ne $report.reliabilityIndex) { $null = $sb.AppendLine("- **Windows Reliability Monitor Index:** $($report.reliabilityIndex) / 10") }
    $null = $sb.AppendLine("- **WER Crash Reports (Last 7 Days):** $($report.werRecent7d)")
    $null = $sb.AppendLine("")

    # --- SECTION 1: SYSTEM SYNOPSIS ---
    $null = $sb.AppendLine("## 1. Executive System Synopsis")
    $null = $sb.AppendLine($report.executiveSummary)
    $null = $sb.AppendLine("")

    # --- SECTION 2: SYSTEM IDENTITY & INFRASTRUCTURE ---
    $null = $sb.AppendLine("## 2. System Identity & Infrastructure")
    if ($snap.Id -or $snap.Infra) {
        if ($snap.Id) {
            $null = $sb.AppendLine("- **Computer Name:** $($snap.Id.HostName)")
            $null = $sb.AppendLine("- **Domain / Workgroup:** $($snap.Id.Workgroup)")
            $null = $sb.AppendLine("- **Processor:** $($snap.Id.CpuModel)")
        }
        if ($snap.Infra) {
            $null = $sb.AppendLine("- **OS Edition:** $($snap.Infra.OsEdition) (Build $($snap.Infra.WindowsBuild))")
            $null = $sb.AppendLine("- **Update Status:** $($snap.Infra.WindowsUpdateLevel) | **DirectX:** $($snap.Infra.DirectX) | **PowerShell:** $($snap.Infra.PsVersion)")
            $null = $sb.AppendLine("- **Virtualization:** $($snap.Infra.Virtualization) | **Secure Boot:** $($snap.Infra.SecureBoot)")
            $null = $sb.AppendLine("- **Motherboard:** $($snap.Infra.Motherboard)")
            $null = $sb.AppendLine("- **BIOS Version:** $($snap.Infra.BiosVersion)")
            $null = $sb.AppendLine("- **Power Plan:** $(if ($snap.System -and $snap.System.PowerPlan) { $snap.System.PowerPlan } else { $snap.Infra.PowerPlan }) | **System Uptime:** $($snap.Infra.UptimeText)")
            $null = $sb.AppendLine("- **Audio Output:** $($snap.Infra.SoundCardIdentity)")
            $null = $sb.AppendLine("- **Audio Input:** $($snap.Infra.MicrophoneIdentity)")

            $monitors = @($snap.Infra.Monitors)
            if ($monitors.Count -gt 0) {
                $null = $sb.AppendLine("")
                $null = $sb.AppendLine("### Connected Displays ($($monitors.Count))")
                $null = $sb.AppendLine("| Display | Resolution | Refresh | Connection | Scale | Orientation | HDR | Night Light | Color Profile |")
                $null = $sb.AppendLine("|---|---|---|---|---|---|---|---|---|")
                foreach ($m in $monitors) {
                    $null = $sb.AppendLine("| $(Escape-MdCell $m.Label) | $(Escape-MdCell $m.Resolution) | $(Escape-MdCell $m.RefreshRate) | $(Escape-MdCell $m.ConnectionType) | $(Escape-MdCell $m.Scale) | $(Escape-MdCell $m.Orientation) | $(Escape-MdCell $m.HdrStatus) | $(Escape-MdCell $m.NightLight) | $(Escape-MdCell $m.ColorProfile) |")
                }
            }
        }
    } else {
        $null = $sb.AppendLine("_System identity telemetry unavailable._")
    }
    $null = $sb.AppendLine("")

    # --- SECTION 3: CORE HARDWARE TELEMETRY ---
    $null = $sb.AppendLine("## 3. Core Hardware Telemetry Snapshot")
    if ($snap.System) {
        $sys = $snap.System
        $cache = $sys.CacheMatrix
        $cacheStr = if ($cache) { "L1: $($cache.L1), L2: $($cache.L2), L3: $($cache.L3)$(if ($cache.IsX3D) { ' (3D V-Cache)' })" } else { "N/A" }
        $null = $sb.AppendLine("- **CPU Load / Clock / Temp:** $($sys.CpuLoad)% | $($sys.CpuClock) | $($sys.CpuTemp) C")
        $null = $sb.AppendLine("- **CPU Cache Matrix:** $cacheStr")
        $null = $sb.AppendLine("- **GPU Model:** $($sys.GpuModel) (Driver: $($sys.GpuDriverVersion))")
        $null = $sb.AppendLine("- **GPU Load / Power / Temp:** $($sys.GpuLoad)% | $($sys.GpuPower) | $($sys.GpuTemp) C")
        $null = $sb.AppendLine("- **RAM Allocation:** $($sys.RamUsageText) ($($sys.RamPercent)%)")
        $null = $sb.AppendLine("- **Pagefile Commitment:** $($sys.PagefileUsageText) ($($sys.PagefilePercent)%)")
        $null = $sb.AppendLine("- **Windows Telemetry Service:** $($sys.TelemetryStatus)")
    } else {
        $null = $sb.AppendLine("_Core hardware telemetry unavailable._")
    }
    $null = $sb.AppendLine("")

    # --- SECTION 4: STORAGE VOLUMES & PHYSICAL DISK HEALTH ---
    $null = $sb.AppendLine("## 4. Storage Volumes & Physical Disk Health")
    if ($snap.Storage.Count -gt 0) {
        $null = $sb.AppendLine("| Drive | Label | Type | Used / Total (GB) | Free (GB) | Usage |")
        $null = $sb.AppendLine("|---|---|---|---|---|---|")
        foreach ($d in $snap.Storage) {
            $pct = if ($d.StorageTotalGB -gt 0) { [math]::Round(($d.StorageUsedGB / $d.StorageTotalGB) * 100, 1) } else { 0 }
            $null = $sb.AppendLine("| $(Escape-MdCell $d.MainDriveLetter) | $(Escape-MdCell $d.VolumeLabel) | $(Escape-MdCell $d.DriveType) | $($d.StorageUsedGB) / $($d.StorageTotalGB) GB | $($d.StorageFreeGB) GB | $pct% |")
        }
    }
    if ($snap.PhysicalDisks.Count -gt 0) {
        $null = $sb.AppendLine("")
        $null = $sb.AppendLine("### Physical Disks (SMART / Operational Health)")
        $null = $sb.AppendLine("| Model | Media | Bus | Size (GB) | Health | Operational Status |")
        $null = $sb.AppendLine("|---|---|---|---|---|---|")
        foreach ($pd in $snap.PhysicalDisks) {
            $null = $sb.AppendLine("| $(Escape-MdCell $pd.FriendlyName) | $(Escape-MdCell $pd.MediaType) | $(Escape-MdCell $pd.BusType) | $($pd.SizeGB) GB | $(Escape-MdCell $pd.HealthStatus) | $(Escape-MdCell ($pd.OperationalStatus -join ', ')) |")
        }
    }
    $null = $sb.AppendLine("")

    # --- SECTION 5: NETWORK PROFILE & ADAPTERS ---
    $null = $sb.AppendLine("## 5. Network Profile & Active Adapters")
    if ($snap.Network) {
        $net = $snap.Network
        $null = $sb.AppendLine("- **Internal IPv4 / Mask / Gateway:** $($net.IntIPv4) / $($net.SubnetMask) / $($net.Gateway) ($($net.NetAssignment))")
        $null = $sb.AppendLine("- **External IPv4:** $($net.ExtIPv4) | **Profile:** $($net.NetworkStatus) | **Link Capacity:** $($net.LinkCap) | **WLAN SSID:** $($net.WlanSsid)")
        $null = $sb.AppendLine("- **Security & Sharing:** Firewall: $($net.Firewall) | Realtime Protection: $($net.Realtime) | Discovery: $($net.Discovery) | File Sharing: $($net.Sharing)")
        $null = $sb.AppendLine("- **Ethernet Driver:** $($net.lblEthDriver)")
        $null = $sb.AppendLine("- **Wi-Fi Driver:** $($net.lblWifiDriver)")
    }
    if ($snap.Adapters.Count -gt 0) {
        $null = $sb.AppendLine("")
        $null = $sb.AppendLine("| Alias | Status | Link Speed | IPv4 | Gateway | DNS Servers | MAC | Assignment |")
        $null = $sb.AppendLine("|---|---|---|---|---|---|---|---|")
        foreach ($ad in $snap.Adapters) {
            $null = $sb.AppendLine("| $(Escape-MdCell $ad.Alias) | $(Escape-MdCell $ad.Status) | $(Escape-MdCell $ad.LinkSpeed) | $(Escape-MdCell $ad.IPAddress) | $(Escape-MdCell $ad.Gateway) | $(Escape-MdCell $ad.DnsServers) | $(Escape-MdCell $ad.MacAddress) | $(Escape-MdCell $ad.Profile) |")
        }
    }
    $null = $sb.AppendLine("")

    # --- SECTION 6: SYSTEM DEVICES & DRIVER ALERTS ---
    $null = $sb.AppendLine("## 6. System Devices & Driver Overview")
    if ($snap.Devices -and $snap.Devices.summary) {
        $ds = $snap.Devices.summary
        $null = $sb.AppendLine("- **Devices Indexed:** $($ds.total) | **Working OK:** $($ds.ok) | **Issues:** $($ds.issues) | **Disabled:** $($ds.disabled) | **3rd-Party Drivers:** $($ds.thirdParty)")
        $problemDevs = @($snap.Devices.devices | Where-Object { $_.status -ne "OK" })
        if ($problemDevs.Count -gt 0) {
            $null = $sb.AppendLine("")
            $null = $sb.AppendLine("### Devices with Issues or Disabled ($($problemDevs.Count))")
            $null = $sb.AppendLine("| Device | Category | Status | Problem | Driver Version | INF | Hardware ID |")
            $null = $sb.AppendLine("|---|---|---|---|---|---|---|")
            foreach ($d in $problemDevs) {
                $null = $sb.AppendLine("| $(Escape-MdCell $d.name) | $(Escape-MdCell $d.categoryLabel) | $(Escape-MdCell $d.status) | $(Escape-MdCell $d.problemText) | $(Escape-MdCell $d.driverVersion) | $(Escape-MdCell $d.infName) | $(Escape-MdCell $d.hardwareId) |")
            }
        }
        $keyDrivers = @($snap.Devices.devices | Where-Object { $_.isThirdParty -or $_.pnpClass -in @("Display", "Net", "SCSIAdapter") } | Select-Object -First 20)
        if ($keyDrivers.Count -gt 0) {
            $null = $sb.AppendLine("")
            $null = $sb.AppendLine("### Key Hardware & 3rd-Party Drivers")
            $null = $sb.AppendLine("| Device | Category | Provider | Version | Date (Age) | INF |")
            $null = $sb.AppendLine("|---|---|---|---|---|---|")
            foreach ($d in $keyDrivers) {
                $dtStr = if ($d.driverAgeText) { "$($d.driverDate) ($($d.driverAgeText))" } else { $d.driverDate }
                $null = $sb.AppendLine("| $(Escape-MdCell $d.name) | $(Escape-MdCell $d.categoryLabel) | $(Escape-MdCell $d.driverProvider) | $(Escape-MdCell $d.driverVersion) | $(Escape-MdCell $dtStr) | $(Escape-MdCell $d.infName) |")
            }
        }
    }
    $null = $sb.AppendLine("")

    # --- SECTION 7: STARTUP APPS, INSTALLED APPS, SHARES & TOP PROCESSES ---
    $null = $sb.AppendLine("## 7. Applications, Startup Entries, Shares & Top Processes")
    if ($snap.Startup -and $snap.Startup.apps) {
        $stApps = @($snap.Startup.apps)
        $enabledSt = @($stApps | Where-Object { $_.Status -eq "Enabled" })
        $missingSt = @($stApps | Where-Object { -not $_.FileExists })
        $null = $sb.AppendLine("- **Startup Registrations:** $($stApps.Count) total ($($enabledSt.Count) enabled, $($missingSt.Count) missing target on disk)")
        if ($enabledSt.Count -gt 0) {
            $null = $sb.AppendLine("")
            $null = $sb.AppendLine("### Enabled Startup Applications")
            $null = $sb.AppendLine("| Name | Publisher | Scope | Target Exists | Command |")
            $null = $sb.AppendLine("|---|---|---|---|---|")
            foreach ($sa in ($enabledSt | Select-Object -First 25)) {
                $null = $sb.AppendLine("| $(Escape-MdCell $sa.Name) | $(Escape-MdCell $sa.Publisher) | $(Escape-MdCell $sa.Scope) | $(if ($sa.FileExists) { 'Yes' } else { 'Missing' }) | $(Escape-MdCell $sa.Command) |")
            }
        }
    }
    if ($snap.InstalledApps -and $snap.InstalledApps.summary) {
        $ia = $snap.InstalledApps.summary
        $null = $sb.AppendLine("")
        $null = $sb.AppendLine("### Installed Applications Summary")
        $null = $sb.AppendLine("- **Total Indexed:** $($ia.total) | **User Apps:** $($ia.userApps) | **System / Runtimes:** $($ia.systemApps) | **Relocated (Junction):** $($ia.moved) | **Est. Footprint:** $($ia.totalGB) GB")
        $userApps = @($snap.InstalledApps.apps | Where-Object { -not $_.isSystem } | Select-Object -First 40)
        if ($userApps.Count -gt 0) {
            $null = $sb.AppendLine("")
            $null = $sb.AppendLine("| Application | Version | Publisher | Installed | Size (MB) | Location |")
            $null = $sb.AppendLine("|---|---|---|---|---|---|")
            foreach ($ua in $userApps) {
                $loc = if ($ua.isJunction -and $ua.junctionTarget) { "$($ua.installLocation) -> $($ua.junctionTarget)" } else { $ua.installLocation }
                $null = $sb.AppendLine("| $(Escape-MdCell $ua.name) | $(Escape-MdCell $ua.version) | $(Escape-MdCell $ua.publisher) | $(Escape-MdCell $ua.installDate) | $(if ($null -ne $ua.sizeMB) { $ua.sizeMB } else { '-' }) | $(Escape-MdCell $loc) |")
            }
        }
    }
    if ($snap.Shares -and $snap.Shares.shares) {
        $customShares = @($snap.Shares.shares | Where-Object { -not $_.special })
        $null = $sb.AppendLine("")
        $null = $sb.AppendLine("### Active User SMB Network Shares ($($customShares.Count))")
        if ($customShares.Count -gt 0) {
            $null = $sb.AppendLine("| Share Name | Local Path | Network Path | Permissions |")
            $null = $sb.AppendLine("|---|---|---|---|")
            foreach ($sh in $customShares) {
                $perms = if ($sh.access) { (@($sh.access | ForEach-Object { "$($_.account):$($_.right)" }) -join ', ') } else { "Unavailable" }
                $null = $sb.AppendLine("| $(Escape-MdCell $sh.name) | $(Escape-MdCell $sh.path) | $(Escape-MdCell $sh.networkPath) | $(Escape-MdCell $perms) |")
            }
        } else {
            $null = $sb.AppendLine("- None (only default Windows administrative shares active).")
        }
    }
    if ($snap.TopProcesses.Count -gt 0) {
        $null = $sb.AppendLine("")
        $null = $sb.AppendLine("### Top Live Processes by Memory (At Export Time)")
        $null = $sb.AppendLine("| Process | PID | Memory (MB) | CPU Time (s) |")
        $null = $sb.AppendLine("|---|---|---|---|")
        foreach ($pr in $snap.TopProcesses) {
            $null = $sb.AppendLine("| $(Escape-MdCell $pr.Name) | $($pr.Id) | $($pr.MemoryMB) MB | $($pr.CpuSec) s |")
        }
    }
    $null = $sb.AppendLine("")

    # --- SECTION 8: DIAGNOSTIC SUBSYSTEM MATRIX, FINDINGS & CRASH DUMPS ---
    $null = $sb.AppendLine("## 8. UltimaDiagX Subsystem Health Matrix")
    $null = $sb.AppendLine("| Subsystem | Status | Critical | Errors | Warnings |")
    $null = $sb.AppendLine("|---|---|---|---|---|")
    foreach ($sub in $report.subsystems) {
        $null = $sb.AppendLine("| $(Escape-MdCell $sub.name) | **$($sub.status)** | $($sub.critical) | $($sub.errors) | $($sub.warnings) |")
    }
    $null = $sb.AppendLine("")

    if ($report.findings.Count -gt 0) {
        $null = $sb.AppendLine("## 9. Key Diagnostic Findings & Actionable Recommendations")
        foreach ($f in $report.findings) {
            $null = $sb.AppendLine("### [$($f.severity)] $($f.title) ($($f.count)x)")
            $null = $sb.AppendLine("- **Analysis:** $($f.explanation)")
            $null = $sb.AppendLine("- **Recommendation:** $($f.recommendation)")
        }
        $null = $sb.AppendLine("")
    }

    if ($report.topRecurring.Count -gt 0) {
        $null = $sb.AppendLine("## 10. Top Recurring Fault Signatures")
        foreach ($r in $report.topRecurring) {
            $null = $sb.AppendLine("- **$($r.provider)** (Event ID $($r.eventId) | $($r.severity) | $($r.count)x): $($r.summary)")
        }
        $null = $sb.AppendLine("")
    }

    if ($report.crashDumps.Count -gt 0) {
        $null = $sb.AppendLine("## 11. Crash Dumps Detected")
        foreach ($d in $report.crashDumps) {
            $null = $sb.AppendLine(("- ``{0}`` ({1}, {2} MB, {3}) - ``{4}``" -f $d.name, $d.kind, $d.sizeMB, $d.timestamp, $d.path))
        }
        $null = $sb.AppendLine("")
    }

    if ($report.externalSources.Count -gt 0) {
        $null = $sb.AppendLine("## 12. Attached External Program Logs")
        foreach ($es in $report.externalSources) {
            $null = $sb.AppendLine(("- ``{0}`` - Status: {1} ({2} matched log entries)" -f $es.path, $es.status, $es.matched))
        }
        $null = $sb.AppendLine("")
    }

    $null = $sb.AppendLine("## Consolidated Diagnostic Events (Top 100)")
    foreach ($ev in ($report.events | Select-Object -First 100)) {
        $idTag = if ($ev.eventId -gt 0) { "ID $($ev.eventId)" } else { "EXT" }
        $null = $sb.AppendLine("- **[$($ev.timestamp)] [$($ev.severity)] [$($ev.channel) / $($ev.provider) / $idTag]**: $($ev.message)")
        if ($ev.translation) { $null = $sb.AppendLine("  - *Translation:* $($ev.translation)") }
        if ($ev.recommendedFix) { $null = $sb.AppendLine("  - *Suggested Fix:* $($ev.recommendedFix)") }
    }

    [System.IO.File]::WriteAllText($outFile, $sb.ToString(), [System.Text.Encoding]::UTF8)
    Start-Process "explorer.exe" -ArgumentList "/select,`"$outFile`""

    return @{
        type    = "ULTIMADIAGX_NOTICE"
        message = "Exported full UltimaDiagX system & diagnostic report to $outFile"
        path    = $outFile
        error   = $null
    }
}

function Invoke-UltimaDiagXAction {
    param(
        [Parameter(Mandatory = $true)]
        $Payload,
        [string]$RootPath = ""
    )

    if ($Payload -is [string]) {
        $Payload = $Payload | ConvertFrom-Json
    }
    if ($null -eq $Payload -or $null -eq $Payload.command) { return $null }

    $cmd = [string]$Payload.command
    try {
        if ($cmd -eq "RUN_DIAGNOSTIC") {
            $hours = if ($Payload.hoursBack) { [int]$Payload.hoursBack } else { 24 }
            $includeWarn = if ($null -ne $Payload.includeWarnings) { [bool]$Payload.includeWarnings } else { $true }
            $extLogs = @($Payload.externalLogs | Where-Object { $_ })
            return (Get-UltimaDiagXReport -HoursBack $hours -IncludeWarnings $includeWarn -ExternalLogs $extLogs)
        }
        elseif ($cmd -eq "TRANSLATE_CODE") {
            $res = Resolve-HexOrWin32Code -RawCode ([string]$Payload.code)
            return @{
                type        = "ULTIMADIAGX_CODE_TRANSLATION"
                translation = $res
                error       = $null
            }
        }
        elseif ($cmd -eq "DISCOVER_APP_LOGS") {
            return (Discover-CommonSystemAndAppLogs)
        }
        elseif ($cmd -eq "EXPORT_DIAG_REPORT") {
            return (Export-UltimaDiagXMarkdown -Payload $Payload -RootPath $RootPath)
        }
        elseif ($cmd -eq "OPEN_EVENT_VIEWER") {
            Start-Process "mmc.exe" -ArgumentList "eventvwr.msc"
            return @{ type = "ULTIMADIAGX_NOTICE"; message = "Opened native Windows Event Viewer."; error = $null }
        }
        elseif ($cmd -eq "OPEN_RELIABILITY_MONITOR") {
            Start-Process "perfmon.exe" -ArgumentList "/rel"
            return @{ type = "ULTIMADIAGX_NOTICE"; message = "Opened Windows Reliability Monitor."; error = $null }
        }
        elseif ($cmd -eq "OPEN_DUMP_LOCATION") {
            $target = [string]$Payload.path
            if ($target -and (Test-Path -LiteralPath $target)) {
                Start-Process "explorer.exe" -ArgumentList "/select,`"$target`""
                return @{ type = "ULTIMADIAGX_NOTICE"; message = "Revealed [$target] in Windows Explorer."; error = $null }
            }
            throw "File not found: $target"
        }
        else {
            throw "Unsupported UltimaDiagX command: $cmd"
        }
    } catch {
        return @{
            type  = "ULTIMADIAGX_NOTICE"
            error = $_.Exception.Message
        }
    }
}
