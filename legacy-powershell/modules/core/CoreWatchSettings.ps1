# File: modules/core/CoreWatchSettings.ps1
# =========================================================================
# COREWATCH UNIFIED SETTINGS, MODULE REGISTRY, AUTO-START & SECRETS ENGINE
#   - Persistent config:    %LOCALAPPDATA%\CoreWatch\settings.json
#   - Encrypted secrets:    %LOCALAPPDATA%\CoreWatch\secrets.dat.json (Windows DPAPI CurrentUser)
#   - Module catalog:       <AppRoot>\modules\modules-catalog.json
#   - Installer manifest:   <AppRoot>\installed-modules.json (optional, written by Inno Setup)
# =========================================================================

$script:CoreWatchAutoStartTaskName = "CoreWatchAutoStart"
$script:CoreWatchAutoStartTaskPath = "\CoreWatch\"
$script:CoreWatchRunRegPath        = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$script:CoreWatchRunRegName        = "CoreWatch"

function Get-CoreWatchAppDataDir {
    $dir = Join-Path $env:LOCALAPPDATA "CoreWatch"
    if (-not (Test-Path -LiteralPath $dir)) {
        $null = New-Item -ItemType Directory -Path $dir -Force
    }
    return $dir
}

function Get-CoreWatchSettingsPath {
    return (Join-Path (Get-CoreWatchAppDataDir) "settings.json")
}

function Get-CoreWatchSecretsPath {
    return (Join-Path (Get-CoreWatchAppDataDir) "secrets.dat.json")
}

function Test-CoreWatchIsElevated {
    try {
        $id = [Security.Principal.WindowsIdentity]::GetCurrent()
        $pr = New-Object Security.Principal.WindowsPrincipal($id)
        return $pr.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    } catch { return $false }
}

function Get-CoreWatchDefaultEditorPath {
    $candidates = @(
        (Join-Path $env:LOCALAPPDATA "Programs\Microsoft VS Code\Code.exe"),
        (Join-Path $env:ProgramFiles "Microsoft VS Code\Code.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\Microsoft VS Code Insiders\Code - Insiders.exe"),
        (Join-Path $env:LOCALAPPDATA "Programs\cursor\Cursor.exe")
    )
    foreach ($c in $candidates) {
        if ($c -and (Test-Path -LiteralPath $c -PathType Leaf)) { return $c }
    }
    $cmd = Get-Command "code.cmd" -ErrorAction SilentlyContinue
    if (-not $cmd) { $cmd = Get-Command "code" -ErrorAction SilentlyContinue }
    if ($cmd -and $cmd.Source) { return [string]$cmd.Source }
    return ""
}

function Get-CoreWatchDefaultProjectsRoot {
    $candidates = @(
        "D:\GitHub",
        "C:\GitHub",
        (Join-Path $env:USERPROFILE "source\repos"),
        (Join-Path $env:USERPROFILE "Projects"),
        (Join-Path $env:USERPROFILE "Documents\GitHub")
    )
    foreach ($c in $candidates) {
        if ($c -and (Test-Path -LiteralPath $c -PathType Container)) { return $c }
    }
    return (Join-Path $env:USERPROFILE "Documents\GitHub")
}

function Get-CoreWatchDefaultSettingsObject {
    $docs = [Environment]::GetFolderPath("MyDocuments")
    if (-not $docs) { $docs = Join-Path $env:USERPROFILE "Documents" }
    return @{
        schemaVersion = 1
        general       = @{
            startWithWindows          = $false
            startMinimized            = $false
            minimizeToTrayOnClose     = $false
            confirmDestructiveActions = $true
            autoCheckCoreWatchUpdates = $true
            fontSize                  = "normal"   # small | normal | large | xlarge
        }
        telemetry     = @{
            pollingProfile  = "balanced"   # fast | balanced | eco
            temperatureUnit = "C"          # C | F
        }
        directories   = @{
            projectsRoot      = (Get-CoreWatchDefaultProjectsRoot)
            exportsRoot       = (Join-Path $docs "CoreWatch Exports")
            wslInstallRoot    = "C:\WSL"
            organizerDestRoot = (Join-Path $env:USERPROFILE "Organized")
            editorPath        = (Get-CoreWatchDefaultEditorPath)
        }
        modules       = @{
            disabled = @()
        }
    }
}

function Merge-CoreWatchSettingsWithDefaults {
    param([hashtable]$Raw)
    $def = Get-CoreWatchDefaultSettingsObject
    if (-not ($Raw -is [hashtable])) { return $def }

    foreach ($section in @("general", "telemetry", "directories", "modules")) {
        if ($Raw.ContainsKey($section) -and ($Raw[$section] -is [hashtable])) {
            foreach ($k in @($def[$section].Keys)) {
                if ($Raw[$section].ContainsKey($k) -and $null -ne $Raw[$section][$k]) {
                    $def[$section][$k] = $Raw[$section][$k]
                }
            }
        }
    }

    # Normalize constrained enums & array types
    $pol = ([string]$def.telemetry.pollingProfile).ToLowerInvariant()
    if ($pol -notin @("fast", "balanced", "eco")) { $pol = "balanced" }
    $def.telemetry.pollingProfile = $pol

    $unit = ([string]$def.telemetry.temperatureUnit).ToUpperInvariant()
    if ($unit -notin @("C", "F")) { $unit = "C" }
    $def.telemetry.temperatureUnit = $unit

    $def.general.startWithWindows          = [bool]$def.general.startWithWindows
    $def.general.startMinimized            = [bool]$def.general.startMinimized
    $def.general.minimizeToTrayOnClose     = [bool]$def.general.minimizeToTrayOnClose
    $def.general.confirmDestructiveActions = [bool]$def.general.confirmDestructiveActions
    $def.general.autoCheckCoreWatchUpdates = [bool]$def.general.autoCheckCoreWatchUpdates

    $fsVal = ([string]$def.general.fontSize).ToLowerInvariant()
    if ($fsVal -notin @("small", "normal", "large", "xlarge")) { $fsVal = "normal" }
    $def.general.fontSize = $fsVal

    $def.modules.disabled = @($def.modules.disabled | Where-Object { $_ -and ([string]$_).Trim() -ne "" } | ForEach-Object { ([string]$_).Trim() } | Select-Object -Unique)

    return $def
}

function Get-CoreWatchAppSettings {
    $path = Get-CoreWatchSettingsPath
    $raw  = $null
    if (Test-Path -LiteralPath $path -ErrorAction SilentlyContinue) {
        try {
            $txt = Get-Content -LiteralPath $path -Raw -ErrorAction Stop
            if ($txt -and $txt.Trim()) {
                $raw = $txt | ConvertFrom-Json -AsHashtable
            }
        } catch {}
    }
    $merged = Merge-CoreWatchSettingsWithDefaults -Raw $raw
    # Sync live Windows auto-start state so checkbox always reflects reality
    $autoInfo = Get-CoreWatchAutoStartStatus
    $merged.general.startWithWindows = [bool]$autoInfo.enabled
    return $merged
}

function Save-CoreWatchAppSettings {
    param([Parameter(Mandatory)][hashtable]$Settings)
    $normalized = Merge-CoreWatchSettingsWithDefaults -Raw $Settings
    $path = Get-CoreWatchSettingsPath
    $json = $normalized | ConvertTo-Json -Depth 8
    [System.IO.File]::WriteAllText($path, $json, (New-Object System.Text.UTF8Encoding($false)))
    return $normalized
}

# =========================================================================
# WINDOWS AUTO-START MANAGEMENT (UAC-SAFE SCHEDULED TASK + HKCU RUN FALLBACK)
# =========================================================================
function Get-CoreWatchLaunchSpec {
    param(
        [Parameter(Mandatory)][string]$RootPath,
        [bool]$Minimized = $false
    )
    $exePath    = Join-Path $RootPath "CoreWatch.exe"
    $scriptPath = Join-Path $RootPath "Start-NodeWatch.ps1"
    $minArg     = if ($Minimized) { " -Minimized" } else { "" }

    if (Test-Path -LiteralPath $exePath -PathType Leaf) {
        return @{
            mode      = "exe"
            filePath  = $exePath
            arguments = ($minArg.Trim())
            command   = if ($Minimized) { "`"$exePath`" -Minimized" } else { "`"$exePath`"" }
        }
    }

    $pwshExe = $null
    try { $pwshExe = (Get-Process -Id $PID -ErrorAction SilentlyContinue).MainModule.FileName } catch {}
    if (-not $pwshExe -or -not (Test-Path -LiteralPath $pwshExe)) {
        $cmd = Get-Command "pwsh.exe" -ErrorAction SilentlyContinue
        $pwshExe = if ($cmd) { $cmd.Source } else { "pwsh.exe" }
    }
    $argStr = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$scriptPath`"$minArg"
    return @{
        mode      = "script"
        filePath  = $pwshExe
        arguments = $argStr
        command   = "`"$pwshExe`" $argStr"
    }
}

function Get-CoreWatchAutoStartStatus {
    $hasTask = $false
    $hasReg  = $false
    $detail  = "Disabled"
    $method  = "none"

    # Fast (~10-20ms) native Task Scheduler COM query instead of slow CIM Get-ScheduledTask (~800ms)
    try {
        $svc = New-Object -ComObject "Schedule.Service"
        $svc.Connect()
        try {
            $folder = $svc.GetFolder($script:CoreWatchAutoStartTaskPath.TrimEnd('\'))
            $task   = $folder.GetTask($script:CoreWatchAutoStartTaskName)
            if ($null -ne $task -and $task.Enabled) {
                $hasTask = $true
                $method  = "ScheduledTask"
                $detail  = "Enabled via Windows Task Scheduler (Elevated / No UAC prompt at logon)"
            }
        } catch {}
        finally {
            try { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($svc) } catch {}
        }
    } catch {}

    if (-not $hasTask) {
        try {
            if (Test-Path -LiteralPath $script:CoreWatchRunRegPath) {
                $val = (Get-ItemProperty -Path $script:CoreWatchRunRegPath -Name $script:CoreWatchRunRegName -ErrorAction SilentlyContinue).($script:CoreWatchRunRegName)
                if ($val) {
                    $hasReg = $true
                    $method = "RegistryRun"
                    $detail = "Enabled via Current User Startup Registry (HKCU Run)"
                }
            }
        } catch {}
    }

    return @{
        enabled = ($hasTask -or $hasReg)
        method  = $method
        detail  = $detail
    }
}

function Set-CoreWatchAutoStart {
    param(
        [Parameter(Mandatory)][bool]$Enable,
        [Parameter(Mandatory)][string]$RootPath,
        [bool]$Minimized = $false
    )

    # Always clean up old entries first to prevent duplicate launches at logon
    try {
        $existingTask = Get-ScheduledTask -TaskName $script:CoreWatchAutoStartTaskName -TaskPath $script:CoreWatchAutoStartTaskPath -ErrorAction SilentlyContinue
        if ($existingTask) {
            Unregister-ScheduledTask -TaskName $script:CoreWatchAutoStartTaskName -TaskPath $script:CoreWatchAutoStartTaskPath -Confirm:$false -ErrorAction SilentlyContinue
        }
    } catch {}
    try {
        if (Test-Path -LiteralPath $script:CoreWatchRunRegPath) {
            Remove-ItemProperty -Path $script:CoreWatchRunRegPath -Name $script:CoreWatchRunRegName -Force -ErrorAction SilentlyContinue
        }
    } catch {}

    if (-not $Enable) {
        return @{
            ok      = $true
            enabled = $false
            method  = "none"
            detail  = "Disabled"
            message = "Start with Windows disabled."
        }
    }

    $spec = Get-CoreWatchLaunchSpec -RootPath $RootPath -Minimized $Minimized

    # Prefer Task Scheduler (RunLevel Highest) when elevated so requireAdministrator apps start smoothly at logon
    if (Test-CoreWatchIsElevated) {
        try {
            $actionArgs = @{ Execute = $spec.filePath; WorkingDirectory = $RootPath }
            if ($spec.arguments) { $actionArgs["Argument"] = $spec.arguments }
            $action    = New-ScheduledTaskAction @actionArgs
            $trigger   = New-ScheduledTaskTrigger -AtLogOn -User "$env:USERDOMAIN\$env:USERNAME"
            $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Highest
            $taskSet   = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
            $null = Register-ScheduledTask -TaskName $script:CoreWatchAutoStartTaskName -TaskPath $script:CoreWatchAutoStartTaskPath -Action $action -Trigger $trigger -Principal $principal -Settings $taskSet -Description "Launch CoreWatch Host Engine at Windows logon" -Force -ErrorAction Stop
            return @{
                ok      = $true
                enabled = $true
                method  = "ScheduledTask"
                detail  = "Enabled via Windows Task Scheduler (Elevated / No UAC prompt at logon)"
                message = "Start with Windows enabled via Task Scheduler (elevated logon task)."
            }
        } catch {
            # Fall back to HKCU Run below if Task Scheduler service is restricted
        }
    }

    try {
        if (-not (Test-Path -LiteralPath $script:CoreWatchRunRegPath)) {
            $null = New-Item -Path $script:CoreWatchRunRegPath -Force
        }
        Set-ItemProperty -Path $script:CoreWatchRunRegPath -Name $script:CoreWatchRunRegName -Value $spec.command -Type String -ErrorAction Stop
        return @{
            ok      = $true
            enabled = $true
            method  = "RegistryRun"
            detail  = "Enabled via Current User Startup Registry (HKCU Run)"
            message = "Start with Windows enabled via HKCU Run registry key."
        }
    } catch {
        return @{
            ok      = $false
            enabled = $false
            method  = "none"
            detail  = "Failed to configure auto-start: $($_.Exception.Message)"
            message = "Failed to configure Start with Windows: $($_.Exception.Message)"
        }
    }
}

# =========================================================================
# DPAPI ENCRYPTED SECRETS VAULT (READY FOR GITHUB PAT / JIRA API TOKENS)
# =========================================================================
function Get-CoreWatchSecretsMap {
    $path = Get-CoreWatchSecretsPath
    if (Test-Path -LiteralPath $path -ErrorAction SilentlyContinue) {
        try {
            $txt = Get-Content -LiteralPath $path -Raw -ErrorAction Stop
            if ($txt -and $txt.Trim()) {
                return ($txt | ConvertFrom-Json -AsHashtable)
            }
        } catch {}
    }
    return @{}
}

function Save-CoreWatchSecretsMap {
    param([hashtable]$Map)
    $path = Get-CoreWatchSecretsPath
    $json = $Map | ConvertTo-Json -Depth 4
    [System.IO.File]::WriteAllText($path, $json, (New-Object System.Text.UTF8Encoding($false)))
}

function Set-CoreWatchSecret {
    param(
        [Parameter(Mandatory)][string]$Key,
        [Parameter(Mandatory)][string]$Value
    )
    $secure = ConvertTo-SecureString -String $Value -AsPlainText -Force
    $cipher = ConvertFrom-SecureString -SecureString $secure
    $map = Get-CoreWatchSecretsMap
    $map[$Key] = $cipher
    Save-CoreWatchSecretsMap -Map $map
}

function Get-CoreWatchSecret {
    param([Parameter(Mandatory)][string]$Key)
    $map = Get-CoreWatchSecretsMap
    if (-not $map.ContainsKey($Key) -or -not $map[$Key]) { return $null }
    try {
        $secure = ConvertTo-SecureString -String ([string]$map[$Key]) -ErrorAction Stop
        $bstr   = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        try {
            return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
        } finally {
            [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
        }
    } catch {
        return $null
    }
}

function Remove-CoreWatchSecret {
    param([Parameter(Mandatory)][string]$Key)
    $map = Get-CoreWatchSecretsMap
    if ($map.ContainsKey($Key)) {
        $map.Remove($Key)
        Save-CoreWatchSecretsMap -Map $map
    }
}

function Test-CoreWatchSecret {
    param([Parameter(Mandatory)][string]$Key)
    $map = Get-CoreWatchSecretsMap
    return ($map.ContainsKey($Key) -and -not [string]::IsNullOrWhiteSpace([string]$map[$Key]))
}

# =========================================================================
# MODULAR TAB REGISTRY & INSTALLER MANIFEST DISCOVERY
# =========================================================================
function Get-CoreWatchModuleCatalog {
    param([Parameter(Mandatory)][string]$RootPath)
    $catalogPath = Join-Path $RootPath "modules\modules-catalog.json"
    if (Test-Path -LiteralPath $catalogPath -PathType Leaf) {
        try {
            $obj = Get-Content -LiteralPath $catalogPath -Raw -ErrorAction Stop | ConvertFrom-Json
            if ($obj -and $obj.modules) { return @($obj.modules) }
        } catch {}
    }
    return @()
}

function Get-CoreWatchInstalledManifest {
    param([Parameter(Mandatory)][string]$RootPath)
    $manifestPath = Join-Path $RootPath "installed-modules.json"
    if (Test-Path -LiteralPath $manifestPath -PathType Leaf) {
        try {
            $obj = Get-Content -LiteralPath $manifestPath -Raw -ErrorAction Stop | ConvertFrom-Json
            if ($obj -and $null -ne $obj.installedModules) {
                return @{
                    hasManifest = $true
                    installType = [string]($obj.installType ?? "custom")
                    modules     = @($obj.installedModules | ForEach-Object { [string]$_ })
                }
            }
        } catch {}
    }
    return @{
        hasManifest = $false
        installType = if (Test-Path -LiteralPath (Join-Path $RootPath "CoreWatch.exe")) { "portable" } else { "dev" }
        modules     = @()
    }
}

function Get-CoreWatchModulesState {
    param(
        [Parameter(Mandatory)][string]$RootPath,
        [hashtable]$Settings = $null
    )
    if ($null -eq $Settings) { $Settings = Get-CoreWatchAppSettings }
    $catalog  = Get-CoreWatchModuleCatalog -RootPath $RootPath
    $manifest = Get-CoreWatchInstalledManifest -RootPath $RootPath
    $disabled = @($Settings.modules.disabled)

    $list = New-Object System.Collections.Generic.List[PSCustomObject]
    foreach ($m in $catalog) {
        $filesOk = $true
        foreach ($rel in @($m.files)) {
            $full = Join-Path $RootPath $rel
            if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
                $filesOk = $false
                break
            }
        }

        $installed = $filesOk
        if ($manifest.hasManifest -and $installed) {
            # Respect installer manifest when present; still require actual files on disk
            $installed = ($manifest.modules -contains [string]$m.id)
        }

        $enabled = $installed -and (-not ($disabled -contains [string]$m.id))

        $list.Add([PSCustomObject]@{
            id             = [string]$m.id
            name           = [string]$m.name
            shortName      = [string]$m.shortName
            icon           = [string]$m.icon
            group          = [string]$m.group
            navSlot        = [string]$m.navSlot
            tabButtonId    = [string]$m.tabButtonId
            panelId        = [string]$m.panelId
            description    = [string]$m.description
            installed      = [bool]$installed
            enabled        = [bool]$enabled
        })
    }

    return @{
        installMode = [string]$manifest.installType
        hasManifest = [bool]$manifest.hasManifest
        modules     = @($list)
    }
}

# =========================================================================
# COREWATCH VERSION & SELF-UPDATE CHECKER (GITHUB RELEASES)
# =========================================================================
function Get-CoreWatchVersionInfo {
    param([Parameter(Mandatory)][string]$RootPath)
    $verFile  = Join-Path $RootPath "version.json"
    $infoFile = Join-Path $RootPath "build-info.json"

    $semVer   = "0.0.0-dev"
    $label    = "Dev Build"
    $assembly = "0.0.0.0"

    if (Test-Path -LiteralPath $verFile -PathType Leaf) {
        try {
            $v = Get-Content -LiteralPath $verFile -Raw | ConvertFrom-Json
            $maj = [int]$v.major; $min = [int]$v.minor; $pat = [int]$v.patch; $bld = [int]$v.build
            $pre = [string]$v.prerelease
            $bn  = if ($null -ne $v.buildNumber) { [int]$v.buildNumber } else { ($pat * 10) + $bld }
            $semVer = if ($pre) {
                if ($bld -eq 0) { "$maj.$min.$pat-$pre" } else { "$maj.$min.$pat-$pre.$bld" }
            } else {
                if ($bld -eq 0) { "$maj.$min.$pat" } else { "$maj.$min.$pat.$bld" }
            }
            $assembly = "$maj.$min.$pat.$bld"
            $label    = if ($pre) { "$($pre.Substring(0,1).ToUpper())$($pre.Substring(1)) #$bn" } else { "Build #$bn" }
        } catch {}
    }

    $installMode = if (Test-Path -LiteralPath (Join-Path $RootPath "installed-modules.json")) {
        "Installed (Modular)"
    } elseif (Test-Path -LiteralPath (Join-Path $RootPath "CoreWatch.exe")) {
        "Portable Release"
    } else {
        "Source / Dev Mode"
    }

    $builtUtc = ""
    if (Test-Path -LiteralPath $infoFile -PathType Leaf) {
        try {
            $bi = Get-Content -LiteralPath $infoFile -Raw | ConvertFrom-Json
            if ($bi.builtUtc) { $builtUtc = [string]$bi.builtUtc }
        } catch {}
    }

    return @{
        version     = $semVer
        tag         = "v$semVer"
        buildLabel  = $label
        assembly    = $assembly
        installMode = $installMode
        builtUtc    = $builtUtc
        appDataDir  = (Get-CoreWatchAppDataDir)
        rootPath    = $RootPath
    }
}

function Compare-CoreWatchSemVer {
    param([string]$A, [string]$B)
    # Returns -1 if A < B, 0 if equal, 1 if A > B
    function ParseVer([string]$s) {
        $clean = ($s -replace '^[vV]', '').Trim()
        $core = $clean; $pre = ""; $preNum = 0
        if ($clean -match '^(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z]+)(?:\.(\d+))?)?') {
            return @{
                maj    = [int]$Matches[1]
                min    = [int]$Matches[2]
                pat    = [int]$Matches[3]
                isPre  = -not [string]::IsNullOrEmpty($Matches[4])
                preTag = if ($Matches[4]) { $Matches[4].ToLowerInvariant() } else { "" }
                preNum = if ($Matches[5]) { [int]$Matches[5] } else { 0 }
            }
        }
        return @{ maj = 0; min = 0; pat = 0; isPre = $false; preTag = ""; preNum = 0 }
    }
    $va = ParseVer $A; $vb = ParseVer $B
    foreach ($k in @("maj", "min", "pat")) {
        if ($va[$k] -lt $vb[$k]) { return -1 }
        if ($va[$k] -gt $vb[$k]) { return 1 }
    }
    if ($va.isPre -and -not $vb.isPre) { return -1 }
    if (-not $va.isPre -and $vb.isPre) { return 1 }
    if ($va.isPre -and $vb.isPre) {
        if ($va.preTag -ne $vb.preTag) { return [string]::Compare($va.preTag, $vb.preTag, $true) }
        if ($va.preNum -lt $vb.preNum) { return -1 }
        if ($va.preNum -gt $vb.preNum) { return 1 }
    }
    return 0
}

function Test-CoreWatchAppUpdate {
    param([Parameter(Mandatory)][string]$RootPath)
    $verInfo = Get-CoreWatchVersionInfo -RootPath $RootPath
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $rels = @(Invoke-RestMethod -Uri "https://api.github.com/repos/jonathan820612/CoreWatch-Host-Engine/releases?per_page=10" -Headers @{ "User-Agent" = "CoreWatch-App" } -TimeoutSec 10 -ErrorAction Stop)
        $latest = $rels | Where-Object { -not $_.draft } | Select-Object -First 1
        if (-not $latest) {
            return @{
                type            = "APP_UPDATE_STATUS"
                ok              = $true
                updateAvailable = $false
                currentVersion  = $verInfo.tag
                latestVersion   = $verInfo.tag
                url             = "https://github.com/jonathan820612/CoreWatch-Host-Engine/releases"
                message         = "No published GitHub releases found yet."
            }
        }
        $latestTag = [string]$latest.tag_name
        $cmp = Compare-CoreWatchSemVer -A $verInfo.version -B $latestTag
        $hasUpdate = ($cmp -lt 0)
        return @{
            type            = "APP_UPDATE_STATUS"
            ok              = $true
            updateAvailable = [bool]$hasUpdate
            currentVersion  = $verInfo.tag
            latestVersion   = $latestTag
            releaseName     = [string]$latest.name
            isPrerelease    = [bool]$latest.prerelease
            url             = [string]$latest.html_url
            message         = if ($hasUpdate) { "Update available: $($verInfo.tag) -> $latestTag" } else { "CoreWatch $($verInfo.tag) is up to date (latest: $latestTag)." }
        }
    } catch {
        return @{
            type            = "APP_UPDATE_STATUS"
            ok              = $false
            updateAvailable = $false
            currentVersion  = $verInfo.tag
            latestVersion   = ""
            url             = "https://github.com/jonathan820612/CoreWatch-Host-Engine/releases"
            message         = "Unable to check GitHub Releases: $($_.Exception.Message)"
        }
    }
}

function Get-CoreWatchTelemetryCadence {
    param([string]$Profile)
    switch (([string]$Profile).ToLowerInvariant()) {
        "fast" { return @{ fastMs = 250; fullDashMs = 1500; fullBgMs = 3000; uiTimerMs = 250 } }
        "eco"  { return @{ fastMs = 1000; fullDashMs = 4000; fullBgMs = 6000; uiTimerMs = 1000 } }
        default { return @{ fastMs = 500; fullDashMs = 2000; fullBgMs = 4000; uiTimerMs = 500 } }
    }
}
