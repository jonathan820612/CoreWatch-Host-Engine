# File: modules/tabs/WslManager.ps1
# =========================================================================
# COREWATCH WSL (WINDOWS SUBSYSTEM FOR LINUX) DEPLOYMENT & MANAGEMENT ENGINE
# Provides full WSL lifecycle, deployment, VHDX inspection, .wslconfig editor,
# prerequisites readiness checks, backup/import, and quick command execution.
# =========================================================================

[CmdletBinding()]
param()

function Invoke-WslCli {
    param(
        [Parameter(Mandatory)][string[]]$Arguments,
        [int]$TimeoutMs = 15000
    )

    $wslCmd = Get-Command "wsl.exe" -ErrorAction SilentlyContinue
    if (-not $wslCmd) {
        return [PSCustomObject]@{
            Found    = $false
            ExitCode = -1
            StdOut   = ""
            StdErr   = "wsl.exe was not found in PATH."
            Combined = "wsl.exe was not found in PATH."
        }
    }

    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = $wslCmd.Source
    $psi.UseShellExecute = $false
    $psi.RedirectStandardOutput = $true
    $psi.RedirectStandardError = $true
    $psi.CreateNoWindow = $true
    # Prefer UTF-8 output on modern WSL builds; still strip NUL bytes for inbox UTF-16LE fallback
    $psi.EnvironmentVariables["WSL_UTF8"] = "1"
    $psi.Arguments = ($Arguments | ForEach-Object {
        if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ }
    }) -join ' '

    $proc = $null
    try {
        $proc = [System.Diagnostics.Process]::Start($psi)
        $outTask = $proc.StandardOutput.ReadToEndAsync()
        $errTask = $proc.StandardError.ReadToEndAsync()
        $exited = $proc.WaitForExit($TimeoutMs)
        if (-not $exited) {
            try { $proc.Kill() } catch {}
            return [PSCustomObject]@{
                Found    = $true
                ExitCode = -2
                StdOut   = ""
                StdErr   = "Command timed out after ${TimeoutMs}ms."
                Combined = "Command timed out after ${TimeoutMs}ms."
            }
        }
        $stdout = (($outTask.GetAwaiter().GetResult()) -replace "`0", "").Trim()
        $stderr = (($errTask.GetAwaiter().GetResult()) -replace "`0", "").Trim()
        $combined = (@($stdout, $stderr) | Where-Object { $_ }) -join "`n"

        return [PSCustomObject]@{
            Found    = $true
            ExitCode = [int]$proc.ExitCode
            StdOut   = $stdout
            StdErr   = $stderr
            Combined = $combined
        }
    } catch {
        return [PSCustomObject]@{
            Found    = $true
            ExitCode = -1
            StdOut   = ""
            StdErr   = $_.Exception.Message
            Combined = $_.Exception.Message
        }
    } finally {
        if ($proc) { $proc.Dispose() }
    }
}

function Format-WslByteSize {
    param([long]$Bytes)
    if ($Bytes -le 0) { return "0 MB" }
    if ($Bytes -ge 1GB) { return "{0:N2} GB" -f ($Bytes / 1GB) }
    if ($Bytes -ge 1MB) { return "{0:N1} MB" -f ($Bytes / 1MB) }
    return "{0:N0} KB" -f ([math]::Max(1, $Bytes / 1KB))
}

function Get-WslPrerequisites {
    $virtEnabled = $false
    try {
        $cs = Get-CimInstance -ClassName Win32_ComputerSystem -ErrorAction SilentlyContinue
        $cpu = Get-CimInstance -ClassName Win32_Processor -ErrorAction SilentlyContinue | Select-Object -First 1
        if (($cs -and $cs.HypervisorPresent -eq $true) -or ($cpu -and $cpu.VirtualizationFirmwareEnabled -eq $true)) {
            $virtEnabled = $true
        }
    } catch {}

    # Check Windows optional feature states via fast registry/service probes (no admin required)
    $wslFeatureState = "Unknown"
    $vmpFeatureState = "Unknown"
    try {
        $lxssSvc = Get-Service -Name "LxssManager" -ErrorAction SilentlyContinue
        $wslSvc  = Get-Service -Name "WSLService" -ErrorAction SilentlyContinue
        if ($wslSvc -or $lxssSvc) {
            $wslFeatureState = "Enabled"
        } else {
            $wslFeatureState = "Not Enabled"
        }
    } catch {}

    try {
        $vmms = Get-Service -Name "vmcompute" -ErrorAction SilentlyContinue
        if ($vmms) {
            $vmpFeatureState = "Enabled"
        } else {
            $vmpFeatureState = "Not Enabled"
        }
    } catch {}

    $isAdmin = $false
    try {
        $id = [Security.Principal.WindowsIdentity]::GetCurrent()
        $pr = New-Object Security.Principal.WindowsPrincipal($id)
        $isAdmin = $pr.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    } catch {}

    return [PSCustomObject]@{
        virtualization = if ($virtEnabled) { "Enabled" } else { "Unknown / Check BIOS" }
        wslFeature     = $wslFeatureState
        vmPlatform     = $vmpFeatureState
        isAdmin        = $isAdmin
    }
}

function Get-WslLxssRegistryMap {
    $map = @{}
    $lxssRoot = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Lxss"
    if (-not (Test-Path $lxssRoot -ErrorAction SilentlyContinue)) { return $map }

    try {
        $subKeys = Get-ChildItem -Path $lxssRoot -ErrorAction SilentlyContinue
        foreach ($sk in $subKeys) {
            $props = Get-ItemProperty -Path $sk.PSPath -ErrorAction SilentlyContinue
            if ($props -and $props.DistributionName) {
                $name = [string]$props.DistributionName
                $basePath = if ($props.BasePath) { ([string]$props.BasePath) -replace '^\\\\\?\\', '' } else { "" }
                $vhdxPath = ""
                $vhdxBytes = 0L
                if ($basePath -and (Test-Path $basePath -ErrorAction SilentlyContinue)) {
                    $candidate = Join-Path $basePath "ext4.vhdx"
                    if (Test-Path $candidate -ErrorAction SilentlyContinue) {
                        $vhdxPath = $candidate
                        try { $vhdxBytes = (Get-Item -LiteralPath $candidate -ErrorAction SilentlyContinue).Length } catch {}
                    } else {
                        $anyVhdx = Get-ChildItem -LiteralPath $basePath -Filter "*.vhdx" -ErrorAction SilentlyContinue | Select-Object -First 1
                        if ($anyVhdx) {
                            $vhdxPath = $anyVhdx.FullName
                            $vhdxBytes = $anyVhdx.Length
                        }
                    }
                }

                $map[$name] = @{
                    Guid       = $sk.PSChildName
                    BasePath   = $basePath
                    VhdxPath   = $vhdxPath
                    VhdxBytes  = $vhdxBytes
                    VhdxSize   = if ($vhdxBytes -gt 0) { Format-WslByteSize -Bytes $vhdxBytes } else { "N/A" }
                    DefaultUid = if ($null -ne $props.DefaultUid) { [int]$props.DefaultUid } else { 1000 }
                    Version    = if ($null -ne $props.Version) { [int]$props.Version } else { 2 }
                    Flags      = if ($null -ne $props.Flags) { [int]$props.Flags } else { 0 }
                }
            }
        }
    } catch {}

    return $map
}

function Get-WslGlobalConfig {
    $cfgPath = Join-Path $env:USERPROFILE ".wslconfig"
    $exists = Test-Path -LiteralPath $cfgPath -ErrorAction SilentlyContinue
    $values = [ordered]@{
        path                 = $cfgPath
        exists               = $exists
        memory               = ""
        processors           = ""
        swap                 = ""
        networkingMode       = "nat"
        dnsTunneling         = $true
        firewall             = $true
        autoProxy            = $true
        autoMemoryReclaim    = "disabled"
        sparseVhd            = $false
        guiApplications      = $true
        nestedVirtualization = $true
        rawText              = ""
    }

    if (-not $exists) {
        return [PSCustomObject]$values
    }

    try {
        $raw = Get-Content -LiteralPath $cfgPath -Raw -ErrorAction Stop
        $values.rawText = $raw
        $section = ""
        foreach ($line in ($raw -split "`r?`n")) {
            $trim = $line.Trim()
            if (-not $trim -or $trim.StartsWith("#") -or $trim.StartsWith(";")) { continue }
            if ($trim -match '^\[(.+)\]$') {
                $section = $Matches[1].Trim().ToLowerInvariant()
                continue
            }
            if ($trim -match '^([^=]+)=(.*)$') {
                $k = $Matches[1].Trim().ToLowerInvariant()
                $v = $Matches[2].Trim()
                if ($section -eq "wsl2" -or $section -eq "") {
                    switch ($k) {
                        "memory"               { $values.memory = $v }
                        "processors"           { $values.processors = $v }
                        "swap"                 { $values.swap = $v }
                        "networkingmode"       { $values.networkingMode = $v.ToLowerInvariant() }
                        "dnstunneling"         { $values.dnsTunneling = ($v -match '^(?i)true|1|yes$') }
                        "firewall"             { $values.firewall = ($v -match '^(?i)true|1|yes$') }
                        "autoproxy"            { $values.autoProxy = ($v -match '^(?i)true|1|yes$') }
                        "guiapplications"      { $values.guiApplications = ($v -match '^(?i)true|1|yes$') }
                        "nestedvirtualization" { $values.nestedVirtualization = ($v -match '^(?i)true|1|yes$') }
                    }
                } elseif ($section -eq "experimental") {
                    switch ($k) {
                        "automemoryreclaim" { $values.autoMemoryReclaim = $v.ToLowerInvariant() }
                        "sparsevhd"         { $values.sparseVhd = ($v -match '^(?i)true|1|yes$') }
                    }
                }
            }
        }
    } catch {}

    return [PSCustomObject]$values
}

function Save-WslGlobalConfig {
    param([Parameter(Mandatory)]$ConfigData)

    $cfgPath = Join-Path $env:USERPROFILE ".wslconfig"
    $lines = [System.Collections.Generic.List[string]]::new()
    $lines.Add("# Managed by CoreWatch WSL Manager")
    $lines.Add("[wsl2]")

    if ($ConfigData.memory -and ([string]$ConfigData.memory).Trim() -ne "") {
        $lines.Add("memory=$([string]$ConfigData.memory.Trim())")
    }
    if ($ConfigData.processors -and ([string]$ConfigData.processors).Trim() -ne "") {
        $lines.Add("processors=$([string]$ConfigData.processors.Trim())")
    }
    if ($ConfigData.swap -and ([string]$ConfigData.swap).Trim() -ne "") {
        $lines.Add("swap=$([string]$ConfigData.swap.Trim())")
    }
    $netMode = if ($ConfigData.networkingMode -eq "mirrored") { "mirrored" } else { "nat" }
    $lines.Add("networkingMode=$netMode")
    $lines.Add("dnsTunneling=$(if ($ConfigData.dnsTunneling) { 'true' } else { 'false' })")
    $lines.Add("firewall=$(if ($ConfigData.firewall) { 'true' } else { 'false' })")
    $lines.Add("autoProxy=$(if ($ConfigData.autoProxy) { 'true' } else { 'false' })")
    $lines.Add("guiApplications=$(if ($ConfigData.guiApplications) { 'true' } else { 'false' })")
    $lines.Add("nestedVirtualization=$(if ($ConfigData.nestedVirtualization) { 'true' } else { 'false' })")

    $reclaim = switch ([string]$ConfigData.autoMemoryReclaim) {
        "gradual"   { "gradual" }
        "dropcache" { "dropcache" }
        default     { "disabled" }
    }
    $sparse = if ($ConfigData.sparseVhd) { "true" } else { "false" }

    $lines.Add("")
    $lines.Add("[experimental]")
    $lines.Add("autoMemoryReclaim=$reclaim")
    $lines.Add("sparseVhd=$sparse")

    $content = ($lines -join "`r`n") + "`r`n"
    [System.IO.File]::WriteAllText($cfgPath, $content, (New-Object System.Text.UTF8Encoding($false)))
    return $cfgPath
}

function Get-WslOnlineCatalog {
    # Curated fallback catalog used when offline or before WSL is installed
    $fallback = @(
        [PSCustomObject]@{ id = "Ubuntu";               friendlyName = "Ubuntu (Latest LTS)" }
        [PSCustomObject]@{ id = "Ubuntu-24.04";         friendlyName = "Ubuntu 24.04 LTS" }
        [PSCustomObject]@{ id = "Ubuntu-22.04";         friendlyName = "Ubuntu 22.04 LTS" }
        [PSCustomObject]@{ id = "Debian";               friendlyName = "Debian GNU/Linux" }
        [PSCustomObject]@{ id = "kali-linux";           friendlyName = "Kali Linux Rolling" }
        [PSCustomObject]@{ id = "FedoraLinux-42";       friendlyName = "Fedora Linux 42" }
        [PSCustomObject]@{ id = "archlinux";            friendlyName = "Arch Linux" }
        [PSCustomObject]@{ id = "openSUSE-Tumbleweed";  friendlyName = "openSUSE Tumbleweed" }
        [PSCustomObject]@{ id = "AlmaLinux-9";          friendlyName = "AlmaLinux OS 9" }
        [PSCustomObject]@{ id = "OracleLinux_9_1";      friendlyName = "Oracle Linux 9.1" }
    )

    $res = Invoke-WslCli -Arguments @("--list", "--online") -TimeoutMs 8000
    if ($res.ExitCode -ne 0 -or -not $res.StdOut) {
        return @{ items = $fallback; source = "built-in" }
    }

    $parsed = [System.Collections.Generic.List[PSCustomObject]]::new()
    $inTable = $false
    foreach ($line in ($res.StdOut -split "`r?`n")) {
        $t = $line.Trim()
        if (-not $t) { continue }
        if ($t -match '^NAME\s+FRIENDLY NAME') {
            $inTable = $true
            continue
        }
        if ($inTable -and $t -match '^(\S+)\s+(.+)$') {
            $parsed.Add([PSCustomObject]@{
                id           = $Matches[1].Trim()
                friendlyName = $Matches[2].Trim()
            })
        }
    }

    if ($parsed.Count -gt 0) {
        return @{ items = @($parsed); source = "live" }
    }
    return @{ items = $fallback; source = "built-in" }
}

function Get-WslManagerState {
    [CmdletBinding()]
    param(
        [switch]$IncludeOnlineCatalog
    )

    $prereqs = Get-WslPrerequisites
    $config  = Get-WslGlobalConfig
    $lxssMap = Get-WslLxssRegistryMap

    $statusRes  = Invoke-WslCli -Arguments @("--status") -TimeoutMs 6000
    $versionRes = Invoke-WslCli -Arguments @("--version") -TimeoutMs 6000
    $listRes    = Invoke-WslCli -Arguments @("--list", "--verbose") -TimeoutMs 6000

    $notInstalledPattern = '(?i)(is not installed|has no installed distributions|not recognized|cannot find the file)'
    $wslInstalled = $statusRes.Found -and ($statusRes.Combined -notmatch '(?i)windows subsystem for linux is not installed')

    # Parse version details (WSL version, Kernel, WSLg, MSRDC, Direct3D)
    $wslVersion    = if ($wslInstalled) { "Installed" } else { "Not Installed" }
    $kernelVersion = "--"
    $wslgVersion   = "--"
    $msrdcVersion  = "--"
    $defaultVer    = 2
    $defaultDistro = ""

    if ($versionRes.ExitCode -eq 0 -and $versionRes.StdOut) {
        foreach ($line in ($versionRes.StdOut -split "`r?`n")) {
            if ($line -match 'WSL version\s*:\s*(.+)$')    { $wslVersion    = $Matches[1].Trim() }
            elseif ($line -match 'Kernel version\s*:\s*(.+)$') { $kernelVersion = $Matches[1].Trim() }
            elseif ($line -match 'WSLg version\s*:\s*(.+)$')   { $wslgVersion   = $Matches[1].Trim() }
            elseif ($line -match 'MSRDC version\s*:\s*(.+)$')  { $msrdcVersion  = $Matches[1].Trim() }
        }
    }

    if ($statusRes.StdOut) {
        foreach ($line in ($statusRes.StdOut -split "`r?`n")) {
            if ($line -match 'Default Version\s*:\s*(\d+)') { $defaultVer = [int]$Matches[1] }
            elseif ($line -match 'Default Distribution\s*:\s*(.+)$') { $defaultDistro = $Matches[1].Trim() }
        }
    }

    # Parse installed distributions
    $distros = [System.Collections.Generic.List[PSCustomObject]]::new()
    if ($wslInstalled -and $listRes.ExitCode -eq 0 -and $listRes.StdOut -and $listRes.StdOut -notmatch $notInstalledPattern) {
        foreach ($rawLine in ($listRes.StdOut -split "`r?`n")) {
            $line = $rawLine.TrimEnd()
            if (-not $line.Trim()) { continue }
            if ($line -match '^\s*NAME\s+STATE\s+VERSION') { continue }

            $isDef = $false
            $clean = $line.Trim()
            if ($clean.StartsWith("*")) {
                $isDef = $true
                $clean = $clean.Substring(1).Trim()
            }

            if ($clean -match '^(.+?)\s{2,}(Running|Stopped|Installing|Uninstalling|Converting)\s+(\d+)$' -or
                $clean -match '^(\S+)\s+(Running|Stopped|Installing|Uninstalling|Converting)\s+(\d+)$') {
                $dName  = $Matches[1].Trim()
                $dState = $Matches[2].Trim()
                $dVer   = [int]$Matches[3]
                if ($isDef -and -not $defaultDistro) { $defaultDistro = $dName }

                $regInfo = if ($lxssMap.ContainsKey($dName)) { $lxssMap[$dName] } else { $null }

                # Probe live IPv4 only for currently Running distros (fast, non-waking)
                $distroIp = ""
                if ($dState -eq "Running") {
                    $ipProbe = Invoke-WslCli -Arguments @("-d", $dName, "--", "hostname", "-I") -TimeoutMs 2500
                    if ($ipProbe.ExitCode -eq 0 -and $ipProbe.StdOut) {
                        $firstIp = ($ipProbe.StdOut -split '\s+' | Where-Object { $_ -match '^\d+\.\d+\.\d+\.\d+$' } | Select-Object -First 1)
                        if ($firstIp) { $distroIp = $firstIp }
                    }
                }

                $distros.Add([PSCustomObject]@{
                    name       = $dName
                    state      = $dState
                    version    = $dVer
                    isDefault  = $isDef
                    basePath   = if ($regInfo) { [string]$regInfo.BasePath } else { "" }
                    vhdxPath   = if ($regInfo) { [string]$regInfo.VhdxPath } else { "" }
                    vhdxBytes  = if ($regInfo) { [long]$regInfo.VhdxBytes } else { 0L }
                    vhdxSize   = if ($regInfo) { [string]$regInfo.VhdxSize } else { "N/A" }
                    defaultUid = if ($regInfo) { [int]$regInfo.DefaultUid } else { 1000 }
                    ipAddress  = $distroIp
                })
            }
        }
    }

    # Live vmmemWSL / vmmem memory usage
    $vmmemBytes = 0L
    $vmmemActive = $false
    try {
        $vmmemProcs = @(Get-Process -Name "vmmemWSL", "vmmem" -ErrorAction SilentlyContinue)
        if ($vmmemProcs.Count -gt 0) {
            $vmmemActive = $true
            $vmmemBytes = [long](($vmmemProcs | Measure-Object -Property WorkingSet64 -Sum).Sum)
        }
    } catch {}

    $runningCount = @($distros | Where-Object { $_.state -eq "Running" }).Count
    $totalVhdxBytes = [long](($distros | Measure-Object -Property vhdxBytes -Sum).Sum)

    $catalogInfo = if ($IncludeOnlineCatalog) {
        Get-WslOnlineCatalog
    } else {
        @{ items = @(); source = "deferred" }
    }

    return [PSCustomObject]@{
        type          = "WSL_MANAGER_STATE"
        installed     = [bool]$wslInstalled
        wslFound      = [bool]$statusRes.Found
        statusMessage = if (-not $wslInstalled) { "WSL is not installed on this system yet. Use 'Install WSL Engine' below to deploy it." } else { "WSL Engine Ready · $($distros.Count) distribution(s) registered ($runningCount running)" }
        engine        = [PSCustomObject]@{
            wslVersion     = $wslVersion
            kernelVersion  = $kernelVersion
            wslgVersion    = $wslgVersion
            msrdcVersion   = $msrdcVersion
            defaultVersion = $defaultVer
            defaultDistro  = if ($defaultDistro) { $defaultDistro } else { "None" }
            vmmemActive    = $vmmemActive
            vmmemMemory    = if ($vmmemActive) { Format-WslByteSize -Bytes $vmmemBytes } else { "Idle (0 MB)" }
            runningCount   = $runningCount
            totalDistros   = $distros.Count
            totalDiskUsage = Format-WslByteSize -Bytes $totalVhdxBytes
        }
        prerequisites = $prereqs
        distributions = @($distros)
        wslConfig     = $config
        onlineCatalog = @($catalogInfo.items)
        catalogSource = [string]$catalogInfo.source
    }
}

function Invoke-WslManagerAction {
    param(
        [Parameter(Mandatory)][string]$RawJson
    )

    $payload = $null
    try {
        $payload = $RawJson | ConvertFrom-Json
    } catch {
        return [PSCustomObject]@{ type = "WSL_NOTICE"; ok = $false; error = "Invalid WSL command payload." }
    }

    $cmd = [string]$payload.command

    try {
        switch ($cmd) {

            "WSL_LOAD_ONLINE_CATALOG" {
                $cat = Get-WslOnlineCatalog
                return [PSCustomObject]@{
                    type          = "WSL_ONLINE_CATALOG"
                    ok            = $true
                    onlineCatalog = @($cat.items)
                    catalogSource = [string]$cat.source
                }
            }

            "WSL_INSTALL_ENGINE" {
                # Launch an elevated interactive terminal so user watches live download & sees reboot prompt
                $pwshExe = (Get-Process -Id $PID).MainModule.FileName
                $cmdStr = "Write-Host '=== CoreWatch WSL Engine Installer ===' -ForegroundColor Cyan; wsl.exe --install --no-distribution; Write-Host ''; Write-Host 'Installation command finished. If prompted, restart Windows to complete WSL setup.' -ForegroundColor Green; Read-Host 'Press Enter to close'"
                Start-Process -FilePath $pwshExe -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $cmdStr) -Verb RunAs -ErrorAction Stop
                return [PSCustomObject]@{
                    type    = "WSL_NOTICE"
                    ok      = $true
                    message = "Launched elevated WSL installer terminal (`wsl --install --no-distribution`). Refresh once installation completes."
                }
            }

            "WSL_UPDATE_ENGINE" {
                $pwshExe = (Get-Process -Id $PID).MainModule.FileName
                $cmdStr = "Write-Host '=== CoreWatch WSL Kernel & Engine Update ===' -ForegroundColor Cyan; wsl.exe --update; Write-Host ''; Read-Host 'Press Enter to close'"
                Start-Process -FilePath $pwshExe -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $cmdStr) -Verb RunAs -ErrorAction Stop
                return [PSCustomObject]@{
                    type    = "WSL_NOTICE"
                    ok      = $true
                    message = "Launched elevated WSL update terminal (`wsl --update`)."
                }
            }

            "WSL_SHUTDOWN_ALL" {
                $res = Invoke-WslCli -Arguments @("--shutdown") -TimeoutMs 15000
                if ($res.ExitCode -ne 0) { throw ($res.Combined ? $res.Combined : "wsl --shutdown failed.") }
                $state = Get-WslManagerState
                $state | Add-Member -NotePropertyName "actionMessage" -NotePropertyValue "All running WSL distributions and the WSL2 lightweight VM have been shut down." -Force
                return $state
            }

            "WSL_SET_DEFAULT_VERSION" {
                $ver = [int]($payload.version ?? 2)
                if ($ver -notin @(1, 2)) { throw "WSL default version must be 1 or 2." }
                $res = Invoke-WslCli -Arguments @("--set-default-version", "$ver") -TimeoutMs 10000
                if ($res.ExitCode -ne 0) { throw ($res.Combined ? $res.Combined : "Failed to set default WSL version.") }
                $state = Get-WslManagerState
                $state | Add-Member -NotePropertyName "actionMessage" -NotePropertyValue "Default WSL version for new deployments set to WSL $ver." -Force
                return $state
            }

            "WSL_DEPLOY_DISTRO" {
                $distroId = [string]($payload.distroId ?? "").Trim()
                if (-not $distroId) { throw "Please select a Linux distribution to deploy." }
                $pwshExe = (Get-Process -Id $PID).MainModule.FileName
                $safeId = $distroId -replace '[^a-zA-Z0-9._-]', ''
                $cmdStr = "Write-Host '=== Deploying WSL Distribution: $safeId ===' -ForegroundColor Cyan; wsl.exe --install -d $safeId; Write-Host ''; Write-Host 'Deployment finished. You may close this window and click Refresh in CoreWatch.' -ForegroundColor Green; Read-Host 'Press Enter to close'"
                Start-Process -FilePath $pwshExe -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $cmdStr) -ErrorAction Stop
                return [PSCustomObject]@{
                    type    = "WSL_NOTICE"
                    ok      = $true
                    message = "Launched interactive deployment terminal for '$safeId'. Complete initial UNIX user setup there, then click Refresh."
                }
            }

            "WSL_LAUNCH_DISTRO" {
                $name = [string]($payload.name ?? "").Trim()
                if (-not $name) { throw "Distribution name is required." }
                $wt = Get-Command "wt.exe" -ErrorAction SilentlyContinue
                if ($wt) {
                    Start-Process -FilePath $wt.Source -ArgumentList @("wsl.exe", "-d", $name) -ErrorAction Stop
                } else {
                    Start-Process -FilePath "wsl.exe" -ArgumentList @("-d", $name) -ErrorAction Stop
                }
                Start-Sleep -Milliseconds 600
                $state = Get-WslManagerState
                $state | Add-Member -NotePropertyName "actionMessage" -NotePropertyValue "Opened interactive Linux shell for '$name'." -Force
                return $state
            }

            "WSL_EXPLORE_DISTRO" {
                $name = [string]($payload.name ?? "").Trim()
                if (-not $name) { throw "Distribution name is required." }
                Start-Process -FilePath "explorer.exe" -ArgumentList @("\\wsl.localhost\$name") -ErrorAction Stop
                return [PSCustomObject]@{
                    type    = "WSL_NOTICE"
                    ok      = $true
                    message = "Opened \\wsl.localhost\$name in Windows File Explorer."
                }
            }

            "WSL_TERMINATE_DISTRO" {
                $name = [string]($payload.name ?? "").Trim()
                if (-not $name) { throw "Distribution name is required." }
                $res = Invoke-WslCli -Arguments @("--terminate", $name) -TimeoutMs 15000
                if ($res.ExitCode -ne 0) { throw ($res.Combined ? $res.Combined : "Failed to terminate '$name'.") }
                $state = Get-WslManagerState
                $state | Add-Member -NotePropertyName "actionMessage" -NotePropertyValue "Terminated running distribution '$name'." -Force
                return $state
            }

            "WSL_SET_DEFAULT_DISTRO" {
                $name = [string]($payload.name ?? "").Trim()
                if (-not $name) { throw "Distribution name is required." }
                $res = Invoke-WslCli -Arguments @("--set-default", $name) -TimeoutMs 10000
                if ($res.ExitCode -ne 0) { throw ($res.Combined ? $res.Combined : "Failed to set '$name' as default.") }
                $state = Get-WslManagerState
                $state | Add-Member -NotePropertyName "actionMessage" -NotePropertyValue "Set '$name' as the default WSL distribution." -Force
                return $state
            }

            "WSL_CONVERT_VERSION" {
                $name = [string]($payload.name ?? "").Trim()
                $ver  = [int]($payload.version ?? 2)
                if (-not $name -or $ver -notin @(1, 2)) { throw "Valid distribution name and WSL version (1 or 2) are required." }
                $res = Invoke-WslCli -Arguments @("--set-version", $name, "$ver") -TimeoutMs 180000
                if ($res.ExitCode -ne 0) { throw ($res.Combined ? $res.Combined : "Failed to convert '$name' to WSL $ver.") }
                $state = Get-WslManagerState
                $state | Add-Member -NotePropertyName "actionMessage" -NotePropertyValue "Converted '$name' to WSL $ver." -Force
                return $state
            }

            "WSL_UNREGISTER_DISTRO" {
                $name = [string]($payload.name ?? "").Trim()
                if (-not $name) { throw "Distribution name is required." }
                $res = Invoke-WslCli -Arguments @("--unregister", $name) -TimeoutMs 30000
                if ($res.ExitCode -ne 0) { throw ($res.Combined ? $res.Combined : "Failed to unregister '$name'.") }
                $state = Get-WslManagerState
                $state | Add-Member -NotePropertyName "actionMessage" -NotePropertyValue "Unregistered and removed WSL distribution '$name'." -Force
                return $state
            }

            "WSL_EXPORT_DISTRO" {
                $name   = [string]($payload.name ?? "").Trim()
                $target = [string]($payload.targetPath ?? "").Trim()
                if (-not $name -or -not $target) { throw "Distribution name and export file path are required." }
                $res = Invoke-WslCli -Arguments @("--export", $name, $target) -TimeoutMs 300000
                if ($res.ExitCode -ne 0) { throw ($res.Combined ? $res.Combined : "Failed to export '$name'.") }
                $sizeStr = if (Test-Path -LiteralPath $target) { Format-WslByteSize -Bytes (Get-Item -LiteralPath $target).Length } else { "" }
                return [PSCustomObject]@{
                    type    = "WSL_NOTICE"
                    ok      = $true
                    message = "Exported '$name' to $target ($sizeStr)."
                }
            }

            "WSL_IMPORT_DISTRO" {
                $name       = [string]($payload.name ?? "").Trim()
                $installDir = [string]($payload.installDir ?? "").Trim()
                $sourcePath = [string]($payload.sourcePath ?? "").Trim()
                $ver        = [int]($payload.version ?? 2)

                if (-not $name)       { throw "Enter a custom distribution name." }
                if (-not $installDir) { throw "Select an installation folder for the virtual disk." }
                if (-not $sourcePath -or -not (Test-Path -LiteralPath $sourcePath)) { throw "Source .tar or .vhdx file does not exist." }

                if (-not (Test-Path -LiteralPath $installDir)) {
                    $null = New-Item -ItemType Directory -Path $installDir -Force
                }

                $argsList = if ($sourcePath -match '\.vhdx$') {
                    @("--import", $name, $installDir, $sourcePath, "--vhd")
                } else {
                    @("--import", $name, $installDir, $sourcePath, "--version", "$ver")
                }

                $res = Invoke-WslCli -Arguments $argsList -TimeoutMs 300000
                if ($res.ExitCode -ne 0) { throw ($res.Combined ? $res.Combined : "Failed to import '$name'.") }
                $state = Get-WslManagerState
                $state | Add-Member -NotePropertyName "actionMessage" -NotePropertyValue "Imported custom distribution '$name' into $installDir." -Force
                return $state
            }

            "WSL_COMPACT_VHDX" {
                $name = [string]($payload.name ?? "").Trim()
                if (-not $name) { throw "Distribution name is required." }

                $lxssMap = Get-WslLxssRegistryMap
                if (-not $lxssMap.ContainsKey($name) -or -not $lxssMap[$name].VhdxPath) {
                    throw "Could not locate ext4.vhdx disk image for '$name' (WSL 1 distros do not use VHDX)."
                }
                $vhdx = $lxssMap[$name].VhdxPath
                $beforeBytes = (Get-Item -LiteralPath $vhdx).Length

                # Shutdown WSL so VHDX file lock is released
                $null = Invoke-WslCli -Arguments @("--shutdown") -TimeoutMs 15000
                Start-Sleep -Milliseconds 500

                $compacted = $false
                if (Get-Command "Optimize-VHD" -ErrorAction SilentlyContinue) {
                    Optimize-VHD -Path $vhdx -Mode Full -ErrorAction Stop
                    $compacted = $true
                } else {
                    # Use diskpart script for machines without Hyper-V PowerShell cmdlets
                    $tmpScript = Join-Path $env:TEMP ("corewatch_compact_" + [guid]::NewGuid().ToString("N") + ".txt")
                    try {
                        $dpLines = @(
                            "select vdisk file=`"$vhdx`""
                            "attach vdisk readonly"
                            "compact vdisk"
                            "detach vdisk"
                            "exit"
                        )
                        [System.IO.File]::WriteAllLines($tmpScript, $dpLines)
                        $dpOut = & diskpart.exe /s $tmpScript 2>&1 | Out-String
                        if ($LASTEXITCODE -ne 0) {
                            throw "Diskpart compact failed (Administrator privileges required): $($dpOut.Trim())"
                        }
                        $compacted = $true
                    } finally {
                        Remove-Item -LiteralPath $tmpScript -Force -ErrorAction SilentlyContinue
                    }
                }

                $afterBytes = (Get-Item -LiteralPath $vhdx).Length
                $savedBytes = [math]::Max(0L, $beforeBytes - $afterBytes)
                $state = Get-WslManagerState
                $state | Add-Member -NotePropertyName "actionMessage" -NotePropertyValue "Compacted '$name' VHDX: $(Format-WslByteSize $beforeBytes) -> $(Format-WslByteSize $afterBytes) (Reclaimed $(Format-WslByteSize $savedBytes))." -Force
                return $state
            }

            "WSL_SAVE_CONFIG" {
                $cfgPath = Save-WslGlobalConfig -ConfigData $payload.config
                $restartNote = ""
                if ($payload.restartWsl) {
                    $null = Invoke-WslCli -Arguments @("--shutdown") -TimeoutMs 15000
                    $restartNote = " and shut down WSL to apply immediately"
                }
                $state = Get-WslManagerState
                $state | Add-Member -NotePropertyName "actionMessage" -NotePropertyValue "Saved global config to $cfgPath$restartNote." -Force
                return $state
            }

            "WSL_OPEN_CONFIG_FILE" {
                $cfgPath = Join-Path $env:USERPROFILE ".wslconfig"
                if (-not (Test-Path -LiteralPath $cfgPath)) {
                    $null = Save-WslGlobalConfig -ConfigData (Get-WslGlobalConfig)
                }
                Start-Process -FilePath "notepad.exe" -ArgumentList @($cfgPath) -ErrorAction Stop
                return [PSCustomObject]@{
                    type    = "WSL_NOTICE"
                    ok      = $true
                    message = "Opened $cfgPath in Notepad."
                }
            }

            "WSL_RUN_COMMAND" {
                $distro  = [string]($payload.distro ?? "").Trim()
                $command = [string]($payload.linuxCommand ?? "").Trim()
                if (-not $command) { throw "Enter a Linux command to run." }

                $argsList = if ($distro -and $distro -ne "__default__") {
                    @("-d", $distro, "--", "sh", "-c", $command)
                } else {
                    @("--", "sh", "-c", $command)
                }

                $sw = [System.Diagnostics.Stopwatch]::StartNew()
                $res = Invoke-WslCli -Arguments $argsList -TimeoutMs 20000
                $sw.Stop()

                return [PSCustomObject]@{
                    type       = "WSL_COMMAND_OUTPUT"
                    ok         = ($res.ExitCode -eq 0)
                    distro     = if ($distro -and $distro -ne "__default__") { $distro } else { "Default" }
                    command    = $command
                    exitCode   = $res.ExitCode
                    elapsedMs  = [int]$sw.ElapsedMilliseconds
                    output     = if ($res.Combined) { $res.Combined } else { "(Command completed with no output)" }
                }
            }

            default {
                throw "Unsupported WSL Manager command: $cmd"
            }
        }
    } catch {
        return [PSCustomObject]@{
            type    = "WSL_NOTICE"
            ok      = $false
            error   = $_.Exception.Message
        }
    }
}
