# File: modules/tabs/UpdateCenterManager.ps1
# =========================================================================
# COREWATCH UNIFIED UPDATE CENTER
#   - Scans 4 update channels in one unified dashboard:
#     1. WinGet pending software upgrades (with Pin / Ignore list)
#     2. Pending Windows OS & Security Updates (COM Microsoft.Update.Session)
#     3. PowerShell 7 (MSI/MSIX channel) & Local Dev Runtimes
#     4. CoreWatch self-update (GitHub Releases)
#   - Persistent pin/ignore list: %LOCALAPPDATA%\CoreWatch\update-pins.json
# =========================================================================

function Get-UpdatePinsPath {
    $dir = Join-Path $env:LOCALAPPDATA "CoreWatch"
    if (-not (Test-Path -LiteralPath $dir)) { $null = New-Item -ItemType Directory -Path $dir -Force }
    return (Join-Path $dir "update-pins.json")
}

function Get-PinnedUpdateIds {
    $path = Get-UpdatePinsPath
    if (Test-Path -LiteralPath $path -PathType Leaf) {
        try {
            $raw = Get-Content -LiteralPath $path -Raw -ErrorAction Stop | ConvertFrom-Json
            if ($raw -and $raw.pinnedIds) { return @($raw.pinnedIds | ForEach-Object { [string]$_ } | Where-Object { $_ } | Select-Object -Unique) }
        } catch {}
    }
    return @()
}

function Save-PinnedUpdateIds {
    param([string[]]$PinnedIds)
    $path = Get-UpdatePinsPath
    $clean = @($PinnedIds | Where-Object { $_ -and $_.Trim() } | ForEach-Object { $_.Trim() } | Select-Object -Unique)
    $obj = [ordered]@{ schemaVersion = 1; pinnedIds = $clean }
    [System.IO.File]::WriteAllText($path, ($obj | ConvertTo-Json -Depth 4), (New-Object System.Text.UTF8Encoding($false)))
    return $clean
}

function Get-WinGetPendingUpgrades {
    param([string[]]$PinnedIds = @())
    $wg = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $wg) { return @{ available = $false; items = @(); error = "WinGet CLI is not installed on this PC." } }

    $items = New-Object System.Collections.Generic.List[object]
    try {
        $rawOut = @(& $wg.Source upgrade --accept-source-agreements 2>$null)
        $sepIdx = -1
        for ($i = 0; $i -lt $rawOut.Count; $i++) {
            if ($rawOut[$i] -match '^-{10,}') { $sepIdx = $i; break }
        }
        if ($sepIdx -ge 1) {
            $header = [string]$rawOut[$sepIdx - 1]
            $idPos    = $header.IndexOf("Id")
            $verPos   = $header.IndexOf("Version")
            $availPos = $header.IndexOf("Available")
            $srcPos   = $header.IndexOf("Source")

            for ($r = $sepIdx + 1; $r -lt $rawOut.Count; $r++) {
                $line = [string]$rawOut[$r]
                if (-not $line -or $line.Trim() -eq "" -or $line -match '^\d+\s+upgrades?\s+available' -or $line -match 'have version numbers|cannot be determined|explicit targeting') { continue }
                $name = ""; $pkgId = ""; $curVer = ""; $availVer = ""; $source = "winget"
                if ($idPos -gt 0 -and $verPos -gt $idPos -and $availPos -gt $verPos -and $line.Length -gt $availPos) {
                    $name     = $line.Substring(0, [math]::Min($idPos, $line.Length)).Trim()
                    $pkgId    = $line.Substring($idPos, [math]::Min($verPos - $idPos, $line.Length - $idPos)).Trim()
                    $curVer   = $line.Substring($verPos, [math]::Min($availPos - $verPos, $line.Length - $verPos)).Trim()
                    $endAvail = if ($srcPos -gt $availPos -and $line.Length -gt $srcPos) { $srcPos } else { $line.Length }
                    $availVer = $line.Substring($availPos, [math]::Min($endAvail - $availPos, $line.Length - $availPos)).Trim()
                    if ($srcPos -gt $availPos -and $line.Length -gt $srcPos) { $source = $line.Substring($srcPos).Trim() }
                } else {
                    $parts = @($line.Trim() -split '\s{2,}')
                    if ($parts.Count -ge 4) {
                        $name = $parts[0]; $pkgId = $parts[1]; $curVer = $parts[2]; $availVer = $parts[3]
                        if ($parts.Count -ge 5) { $source = $parts[4] }
                    }
                }
                if ($pkgId -and $pkgId -notmatch '\s' -and $availVer) {
                    $isPinned = ($PinnedIds -contains $pkgId)
                    $items.Add([PSCustomObject]@{
                        name      = if ($name) { $name } else { $pkgId }
                        id        = $pkgId
                        installed = $curVer
                        available = $availVer
                        source    = $source
                        pinned    = [bool]$isPinned
                    })
                }
            }
        }
        return @{ available = $true; items = $items.ToArray(); error = "" }
    } catch {
        return @{ available = $true; items = @(); error = $_.Exception.Message }
    }
}

function Get-PendingWindowsUpdatesFast {
    param([switch]$IncludeOnline)
    $list = New-Object System.Collections.Generic.List[object]
    try {
        $sess = New-Object -ComObject Microsoft.Update.Session
        $searcher = $sess.CreateUpdateSearcher()
        $searcher.Online = [bool]$IncludeOnline
        $res = $searcher.Search("IsInstalled=0 and Type='Software' and IsHidden=0")
        foreach ($u in $res.Updates) {
            $kbs = @()
            try { foreach ($kb in $u.KBArticleIDs) { $kbs += "KB$kb" } } catch {}
            $sizeMB = 0
            try { $sizeMB = [math]::Round(([double]$u.MaxDownloadSize) / 1MB, 1) } catch {}
            $cats = @()
            try { foreach ($c in $u.Categories) { $cats += [string]$c.Name } } catch {}
            $list.Add([PSCustomObject]@{
                title       = [string]$u.Title
                kb          = ($kbs -join ", ")
                sizeMB      = $sizeMB
                isMandatory = [bool]$u.IsMandatory
                rebootReq   = [bool]$u.RebootRequired
                category    = ($cats | Select-Object -First 1)
            })
        }
        return @{ ok = $true; items = $list.ToArray(); online = [bool]$IncludeOnline; error = "" }
    } catch {
        return @{ ok = $false; items = @(); online = [bool]$IncludeOnline; error = $_.Exception.Message }
    }
}

function Get-UpdateCenterState {
    param(
        [Parameter(Mandatory)][string]$RootPath,
        [switch]$OnlineWindowsUpdate,
        [switch]$ForcePsCheck,
        [string]$Notice = "",
        [bool]$NoticeError = $false
    )
    $settingsScript = Join-Path $RootPath "modules\core\CoreWatchSettings.ps1"
    if (Test-Path -LiteralPath $settingsScript -PathType Leaf) { . $settingsScript }
    $infraScript = Join-Path $RootPath "modules\telemetry\GetInfraMetrics.ps1"
    if (Test-Path -LiteralPath $infraScript -PathType Leaf) { . $infraScript }

    $pins = Get-PinnedUpdateIds
    $wg   = Get-WinGetPendingUpgrades -PinnedIds $pins
    $wu   = Get-PendingWindowsUpdatesFast -IncludeOnline:$OnlineWindowsUpdate
    $ps   = Get-PowerShellUpdateStatus -Force:$ForcePsCheck
    $cw   = Invoke-CoreWatchUpdateCheck -RootPath $RootPath

    $activeWg = (@($wg.items | Where-Object { -not $_.pinned })).Count
    $pinnedWg = (@($wg.items | Where-Object { $_.pinned })).Count

    return [ordered]@{
        type           = "UPDATE_CENTER_STATE"
        scannedAt      = (Get-Date).ToString("HH:mm:ss")
        pinnedIds      = @($pins)
        winget         = $wg
        windowsUpdates = $wu
        powershell     = [ordered]@{
            current = [string]$global:PSVersionTable.PSVersion.ToString()
            latest  = [string]$ps.latest
            missed  = [int]$ps.missed
            tier    = [string]$ps.tier
            channel = [string]$ps.channel
            detail  = [string]$ps.detail
            url     = [string]$ps.url
        }
        corewatch      = $cw
        summary        = [ordered]@{
            wingetPending = $activeWg
            wingetPinned  = $pinnedWg
            windowsCount  = $wu.items.Count
            psMissed      = [int]$ps.missed
            cwHasUpdate   = [bool]$cw.hasUpdate
        }
        notice         = $Notice
        noticeError    = $NoticeError
    }
}

function Invoke-UpdateCenterAction {
    param(
        [Parameter(Mandatory)][string]$RawJson,
        [Parameter(Mandatory)][string]$RootPath
    )
    $payload = $RawJson | ConvertFrom-Json -AsHashtable
    $cmd = [string]$payload["command"]
    try {
        switch ($cmd) {
            "UPDATES_LOAD" {
                $onlineWu = [bool]($payload["onlineWindowsUpdate"] ?? $false)
                $forcePs  = [bool]($payload["forcePsCheck"] ?? $false)
                return (Get-UpdateCenterState -RootPath $RootPath -OnlineWindowsUpdate:$onlineWu -ForcePsCheck:$forcePs)
            }
            "UPDATES_TOGGLE_PIN" {
                $pkgId = ([string]($payload["packageId"] ?? "")).Trim()
                if (-not $pkgId) { throw "Package ID is required." }
                $pins = New-Object System.Collections.Generic.List[string]
                $existing = @(Get-PinnedUpdateIds)
                if ($existing -contains $pkgId) {
                    foreach ($p in $existing) { if ($p -ne $pkgId) { $pins.Add($p) } }
                    $null = Save-PinnedUpdateIds -PinnedIds $pins.ToArray()
                    return (Get-UpdateCenterState -RootPath $RootPath -Notice "Unpinned '$pkgId' — it will now appear in active updates.")
                } else {
                    foreach ($p in $existing) { $pins.Add($p) }
                    $pins.Add($pkgId)
                    $null = Save-PinnedUpdateIds -PinnedIds $pins.ToArray()
                    return (Get-UpdateCenterState -RootPath $RootPath -Notice "Pinned/ignored '$pkgId' from batch upgrades.")
                }
            }
            "UPDATES_RUN_WINGET_BATCH" {
                $ids = @($payload["packageIds"] | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ })
                if ($ids.Count -eq 0) { throw "Select at least one package to upgrade." }
                $runnerPath = Join-Path $env:TEMP ("CoreWatch-UpdateBatch-{0}.ps1" -f ([guid]::NewGuid().ToString("N").Substring(0, 8)))
                $sb = New-Object System.Text.StringBuilder
                [void]$sb.AppendLine('$Host.UI.RawUI.WindowTitle = "CoreWatch Unified Update Center — Batch Upgrade"')
                [void]$sb.AppendLine('Write-Host "============================================================" -ForegroundColor Cyan')
                [void]$sb.AppendLine("Write-Host '  CoreWatch Selective Package Upgrade ($($ids.Count) selected)' -ForegroundColor Cyan")
                [void]$sb.AppendLine('Write-Host "============================================================" -ForegroundColor Cyan')
                $idx = 0
                foreach ($pkg in $ids) {
                    $idx++
                    $safe = $pkg.Replace("'", "''")
                    [void]$sb.AppendLine("Write-Host `"`n[$idx/$($ids.Count)] Upgrading $safe...`" -ForegroundColor Green")
                    [void]$sb.AppendLine("& winget upgrade --id '$safe' -e --source winget --accept-package-agreements --accept-source-agreements")
                }
                [void]$sb.AppendLine('Write-Host "`nAll selected upgrades completed! Return to CoreWatch and click Scan All." -ForegroundColor Green')
                [void]$sb.AppendLine('Read-Host "Press Enter to close"')
                [void]$sb.AppendLine("Remove-Item -LiteralPath '$runnerPath' -Force -ErrorAction SilentlyContinue")
                [System.IO.File]::WriteAllText($runnerPath, $sb.ToString(), (New-Object System.Text.UTF8Encoding($false)))
                $winPs = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
                Start-Process -FilePath $winPs -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$runnerPath`"") -ErrorAction Stop
                return @{ type = "UPDATE_CENTER_NOTICE"; ok = $true; message = "Launched selective upgrade terminal for $($ids.Count) package(s)." }
            }
            "UPDATES_OPEN_WINUPDATE" {
                Start-Process "ms-settings:windowsupdate"
                return @{ type = "UPDATE_CENTER_NOTICE"; ok = $true; message = "Opened Windows Update settings." }
            }
            default { throw "Unknown Update Center command: $cmd" }
        }
    } catch {
        return @{ type = "UPDATE_CENTER_NOTICE"; ok = $false; error = $_.Exception.Message }
    }
}
