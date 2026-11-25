# File: modules/tabs/SnapshotsManager.ps1
# =========================================================================
# COREWATCH SYSTEM SNAPSHOTS & "WHAT CHANGED?" DIFF ENGINE
#   - Captures lightweight JSON snapshots (%LOCALAPPDATA%\CoreWatch\snapshots\)
#     covering Installed Apps, Startup Items, Services, Signed Drivers,
#     Hosts File, and Network Adapter/IP/DNS Config.
#   - Optionally creates a paired Windows System Restore Point.
#   - Compares Snapshot A vs Snapshot B, or Snapshot A vs Live Current PC.
# =========================================================================

function Get-SnapshotsDir {
    $dir = Join-Path (Join-Path $env:LOCALAPPDATA "CoreWatch") "snapshots"
    if (-not (Test-Path -LiteralPath $dir)) { $null = New-Item -ItemType Directory -Path $dir -Force }
    return $dir
}

function Get-LiveSystemStateFingerprint {
    # 1. Installed Apps (Registry Uninstall hives)
    $appsMap = [ordered]@{}
    $uninstPaths = @(
        "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*",
        "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*"
    )
    foreach ($up in $uninstPaths) {
        Get-ItemProperty -Path $up -ErrorAction SilentlyContinue | ForEach-Object {
            $dn = ([string]$_.DisplayName).Trim()
            if ($dn) {
                $ver = ([string]$_.DisplayVersion).Trim()
                $pub = ([string]$_.Publisher).Trim()
                $appsMap[$dn] = if ($ver) { "$ver ($pub)".Trim() } else { $pub }
            }
        }
    }

    # 2. Startup Items
    $startupMap = [ordered]@{}
    foreach ($rk in @("HKCU:\Software\Microsoft\Windows\CurrentVersion\Run", "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Run", "HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Run")) {
        $props = Get-ItemProperty -Path $rk -ErrorAction SilentlyContinue
        if ($props) {
            foreach ($p in $props.PSObject.Properties) {
                if ($p.Name -in @("PSPath","PSParentPath","PSChildName","PSDrive","PSProvider")) { continue }
                $scope = if ($rk -like "HKCU*") { "HKCU" } else { "HKLM" }
                $startupMap["${scope}:$($p.Name)"] = [string]$p.Value
            }
        }
    }

    # 3. Windows Services
    $svcMap = [ordered]@{}
    Get-CimInstance -ClassName Win32_Service -Property Name, State, StartMode -ErrorAction SilentlyContinue | ForEach-Object {
        $svcMap[[string]$_.Name] = "$($_.State) / $($_.StartMode)"
    }

    # 4. Signed Hardware Drivers (non-empty versions)
    $drvMap = [ordered]@{}
    Get-CimInstance -ClassName Win32_PnPSignedDriver -Property DeviceName, DriverVersion, DriverProviderName -ErrorAction SilentlyContinue | ForEach-Object {
        $n = ([string]$_.DeviceName).Trim()
        if ($n -and $_.DriverVersion) {
            $drvMap[$n] = "$($_.DriverVersion) ($($_.DriverProviderName))"
        }
    }

    # 5. Hosts File active entries
    $hostsMap = [ordered]@{}
    $hostsPath = Join-Path $env:SystemRoot "System32\drivers\etc\hosts"
    if (Test-Path -LiteralPath $hostsPath -PathType Leaf) {
        $idx = 0
        Get-Content -LiteralPath $hostsPath -ErrorAction SilentlyContinue | ForEach-Object {
            $ln = $_.Trim()
            if ($ln -and -not $ln.StartsWith("#")) {
                $idx++
                $hostsMap["entry_$idx"] = ($ln -replace '\s+', ' ')
            }
        }
    }

    # 6. Network Adapter IPv4 & DNS Config
    $netMap = [ordered]@{}
    Get-NetIPConfiguration -ErrorAction SilentlyContinue | ForEach-Object {
        $alias = [string]$_.InterfaceAlias
        $ip4 = (@($_.IPv4Address | ForEach-Object { "$($_.IPAddress)/$($_.PrefixLength)" })) -join ", "
        $gw  = (@($_.IPv4DefaultGateway | ForEach-Object { $_.NextHop })) -join ", "
        $dns = (@($_.DNSServer | Where-Object { $_.AddressFamily -eq 2 } | ForEach-Object { $_.ServerAddresses })) -join ", "
        if ($alias) { $netMap[$alias] = "IP=[$ip4] GW=[$gw] DNS=[$dns]" }
    }

    return [ordered]@{
        installedApps = $appsMap
        startupItems  = $startupMap
        services      = $svcMap
        drivers       = $drvMap
        hostsFile     = $hostsMap
        networkConfig = $netMap
    }
}

function Compare-SnapshotCategory {
    param(
        [string]$Label,
        [System.Collections.IDictionary]$Before,
        [System.Collections.IDictionary]$After
    )
    $added    = New-Object System.Collections.Generic.List[object]
    $removed  = New-Object System.Collections.Generic.List[object]
    $modified = New-Object System.Collections.Generic.List[object]

    $bKeys = if ($Before) { @($Before.Keys) } else { @() }
    $aKeys = if ($After)  { @($After.Keys) }  else { @() }

    foreach ($k in $aKeys) {
        if (-not $Before -or -not $Before.Contains($k)) {
            $added.Add([PSCustomObject]@{ key = [string]$k; value = [string]$After[$k] })
        } elseif ([string]$Before[$k] -ne [string]$After[$k]) {
            $modified.Add([PSCustomObject]@{ key = [string]$k; before = [string]$Before[$k]; after = [string]$After[$k] })
        }
    }
    foreach ($k in $bKeys) {
        if (-not $After -or -not $After.Contains($k)) {
            $removed.Add([PSCustomObject]@{ key = [string]$k; value = [string]$Before[$k] })
        }
    }

    return [PSCustomObject]@{
        category = $Label
        added    = $added.ToArray()
        removed  = $removed.ToArray()
        modified = $modified.ToArray()
        total    = ($added.Count + $removed.Count + $modified.Count)
    }
}

function Get-SavedSnapshotsMetadata {
    $dir = Get-SnapshotsDir
    $list = New-Object System.Collections.Generic.List[object]
    Get-ChildItem -LiteralPath $dir -Filter "*.json" -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | ForEach-Object {
        try {
            $raw = Get-Content -LiteralPath $_.FullName -Raw -ErrorAction Stop | ConvertFrom-Json -AsHashtable
            $fp = $raw["fingerprint"]
            $list.Add([PSCustomObject]@{
                id            = [string]$raw["id"]
                name          = [string]$raw["name"]
                notes         = [string]($raw["notes"] ?? "")
                createdAt     = [string]$raw["createdAt"]
                restorePoint  = [bool]($raw["restorePointCreated"] ?? $false)
                sizeKB        = [math]::Round($_.Length / 1KB, 1)
                counts        = [ordered]@{
                    apps     = if ($fp -and $fp["installedApps"]) { $fp["installedApps"].Count } else { 0 }
                    startup  = if ($fp -and $fp["startupItems"])  { $fp["startupItems"].Count } else { 0 }
                    services = if ($fp -and $fp["services"])      { $fp["services"].Count } else { 0 }
                    drivers  = if ($fp -and $fp["drivers"])       { $fp["drivers"].Count } else { 0 }
                }
            })
        } catch {}
    }
    return $list.ToArray()
}

function Get-SnapshotsState {
    param([string]$Notice = "", [bool]$NoticeError = $false)
    $snaps = @(Get-SavedSnapshotsMetadata)
    return [ordered]@{
        type        = "SNAPSHOTS_STATE"
        snapshots   = $snaps
        notice      = $Notice
        noticeError = $NoticeError
    }
}

function Invoke-SnapshotsAction {
    param(
        [Parameter(Mandatory)][string]$RawJson,
        [Parameter(Mandatory)][string]$RootPath
    )
    $payload = $RawJson | ConvertFrom-Json -AsHashtable
    $cmd = [string]$payload["command"]
    try {
        switch ($cmd) {
            "SNAP_LOAD" {
                return (Get-SnapshotsState)
            }
            "SNAP_CREATE" {
                $name = ([string]($payload["name"] ?? "")).Trim()
                if (-not $name) { $name = "Snapshot $(Get-Date -Format 'yyyy-MM-dd HH:mm')" }
                $notes = ([string]($payload["notes"] ?? "")).Trim()
                $wantRp = [bool]($payload["createRestorePoint"] ?? $false)

                $rpCreated = $false
                $rpNote = ""
                if ($wantRp) {
                    try {
                        Checkpoint-Computer -Description "CoreWatch: $name" -RestorePointType "MODIFY_SETTINGS" -ErrorAction Stop
                        $rpCreated = $true
                        $rpNote = " + Windows Restore Point created"
                    } catch {
                        $rpNote = " (Restore Point skipped: $($_.Exception.Message))"
                    }
                }

                $fp = Get-LiveSystemStateFingerprint
                $sid = "snap_" + (Get-Date -Format "yyyyMMdd_HHmmss") + "_" + ([guid]::NewGuid().ToString("N").Substring(0, 4))
                $doc = [ordered]@{
                    schemaVersion       = 1
                    id                  = $sid
                    name                = $name
                    notes               = $notes
                    createdAt           = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
                    computerName        = $env:COMPUTERNAME
                    restorePointCreated = $rpCreated
                    fingerprint         = $fp
                }
                $dest = Join-Path (Get-SnapshotsDir) "$sid.json"
                [System.IO.File]::WriteAllText($dest, ($doc | ConvertTo-Json -Depth 8), (New-Object System.Text.UTF8Encoding($false)))
                return (Get-SnapshotsState -Notice "Captured snapshot '$name'$rpNote.")
            }
            "SNAP_DIFF" {
                $beforeId = ([string]($payload["beforeId"] ?? "")).Trim()
                $afterId  = ([string]($payload["afterId"] ?? "LIVE")).Trim()
                if (-not $beforeId) { throw "Select a 'Before' snapshot to compare." }

                $beforePath = Join-Path (Get-SnapshotsDir) "$beforeId.json"
                if (-not (Test-Path -LiteralPath $beforePath -PathType Leaf)) { throw "Before snapshot '$beforeId' not found." }
                $beforeDoc = Get-Content -LiteralPath $beforePath -Raw | ConvertFrom-Json -AsHashtable
                $beforeFp  = $beforeDoc["fingerprint"]

                $afterName = "Live Current PC ($(Get-Date -Format 'HH:mm:ss'))"
                $afterFp   = $null
                if ($afterId -eq "LIVE" -or -not $afterId) {
                    $afterFp = Get-LiveSystemStateFingerprint
                } else {
                    $afterPath = Join-Path (Get-SnapshotsDir) "$afterId.json"
                    if (-not (Test-Path -LiteralPath $afterPath -PathType Leaf)) { throw "After snapshot '$afterId' not found." }
                    $afterDoc  = Get-Content -LiteralPath $afterPath -Raw | ConvertFrom-Json -AsHashtable
                    $afterName = "$($afterDoc['name']) ($($afterDoc['createdAt']))"
                    $afterFp   = $afterDoc["fingerprint"]
                }

                $cats = @(
                    (Compare-SnapshotCategory -Label "Installed Apps"   -Before $beforeFp["installedApps"] -After $afterFp["installedApps"]),
                    (Compare-SnapshotCategory -Label "Startup Items"    -Before $beforeFp["startupItems"]  -After $afterFp["startupItems"]),
                    (Compare-SnapshotCategory -Label "Windows Services" -Before $beforeFp["services"]      -After $afterFp["services"]),
                    (Compare-SnapshotCategory -Label "Signed Drivers"   -Before $beforeFp["drivers"]       -After $afterFp["drivers"]),
                    (Compare-SnapshotCategory -Label "Hosts File"       -Before $beforeFp["hostsFile"]     -After $afterFp["hostsFile"]),
                    (Compare-SnapshotCategory -Label "Network Config"   -Before $beforeFp["networkConfig"] -After $afterFp["networkConfig"])
                )
                $totalChanges = 0
                foreach ($c in $cats) { $totalChanges += [int]$c.total }

                return [ordered]@{
                    type         = "SNAPSHOTS_DIFF_RESULT"
                    ok           = $true
                    beforeLabel  = "$($beforeDoc['name']) ($($beforeDoc['createdAt']))"
                    afterLabel   = $afterName
                    totalChanges = $totalChanges
                    categories   = $cats
                    notice       = if ($totalChanges -eq 0) { "Zero differences detected between the two states." } else { "Found $totalChanges total change(s) across 6 system domains." }
                }
            }
            "SNAP_DELETE" {
                $sid = ([string]($payload["snapshotId"] ?? "")).Trim()
                $p = Join-Path (Get-SnapshotsDir) "$sid.json"
                if (Test-Path -LiteralPath $p -PathType Leaf) { Remove-Item -LiteralPath $p -Force }
                return (Get-SnapshotsState -Notice "Deleted snapshot.")
            }
            "SNAP_OPEN_RESTORE_UI" {
                Start-Process "rstrui.exe"
                return @{ type = "SNAPSHOTS_NOTICE"; ok = $true; message = "Opened Windows System Restore (rstrui.exe)." }
            }
            default { throw "Unknown Snapshots command: $cmd" }
        }
    } catch {
        return @{ type = "SNAPSHOTS_NOTICE"; ok = $false; error = $_.Exception.Message }
    }
}
