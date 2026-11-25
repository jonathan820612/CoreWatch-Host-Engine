# File: modules/tabs/BackupSyncManager.ps1
# =========================================================================
# COREWATCH BACKUP & FOLDER SYNC MANAGER (ROBOCOPY GUI)
#   - Persistent store: %LOCALAPPDATA%\CoreWatch\backup-jobs.json
#   - Incremental (/E /XO) or Mirror (/MIR) sync to USB/local/NAS UNC shares
#   - Dry-Run preview (/L), dev ignore presets (node_modules, .git, target...),
#     Windows Task Scheduler automation, and persisted run history.
# =========================================================================

function Get-BackupJobsStorePath {
    $dir = Join-Path $env:LOCALAPPDATA "CoreWatch"
    if (-not (Test-Path -LiteralPath $dir)) { $null = New-Item -ItemType Directory -Path $dir -Force }
    return (Join-Path $dir "backup-jobs.json")
}

function Get-BackupJobsStore {
    $path = Get-BackupJobsStorePath
    if (Test-Path -LiteralPath $path -PathType Leaf) {
        try {
            $raw = Get-Content -LiteralPath $path -Raw -ErrorAction Stop | ConvertFrom-Json -AsHashtable
            if ($raw -is [System.Collections.IDictionary]) {
                return [ordered]@{
                    schemaVersion = 1
                    jobs          = if ($raw.ContainsKey("jobs") -and $null -ne $raw["jobs"]) { @($raw["jobs"]) } else { @() }
                    history       = if ($raw.ContainsKey("history") -and $null -ne $raw["history"]) { @($raw["history"] | Select-Object -First 40) } else { @() }
                }
            }
        } catch {}
    }
    return [ordered]@{ schemaVersion = 1; jobs = @(); history = @() }
}

function Save-BackupJobsStore {
    param([Parameter(Mandatory)][System.Collections.IDictionary]$Store)
    $path = Get-BackupJobsStorePath
    [System.IO.File]::WriteAllText($path, ($Store | ConvertTo-Json -Depth 8), (New-Object System.Text.UTF8Encoding($false)))
}

function Get-RobocopyArgsForJob {
    param(
        [Parameter(Mandatory)][System.Collections.IDictionary]$Job,
        [switch]$DryRun
    )
    $src = ([string]$Job["source"]).TrimEnd('\')
    $dst = ([string]$Job["destination"]).TrimEnd('\')
    $mode = ([string]($Job["mode"] ?? "incremental")).ToLowerInvariant()

    $argList = New-Object System.Collections.Generic.List[string]
    $argList.Add($src)
    $argList.Add($dst)
    if ($mode -eq "mirror") {
        $argList.Add("/MIR")
    } else {
        $argList.Add("/E")
        $argList.Add("/XO")
    }
    $argList.Add("/R:2")
    $argList.Add("/W:2")
    $argList.Add("/MT:8")
    $argList.Add("/NP")
    $argList.Add("/NDL")
    if ($DryRun) { $argList.Add("/L") }

    $exDirs  = @(([string]($Job["excludeDirs"] ?? "")) -split '[,;]' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    $exFiles = @(([string]($Job["excludeFiles"] ?? "")) -split '[,;]' | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    if ($exDirs.Count -gt 0) {
        $argList.Add("/XD")
        foreach ($d in $exDirs) { $argList.Add($d) }
    }
    if ($exFiles.Count -gt 0) {
        $argList.Add("/XF")
        foreach ($f in $exFiles) { $argList.Add($f) }
    }
    return $argList.ToArray()
}

function Format-RobocopyExitMeaning {
    param([int]$Code)
    if ($Code -eq 0) { return "No changes needed (already in sync)" }
    if ($Code -eq 1) { return "Files copied successfully" }
    if ($Code -eq 2) { return "Extra files/dirs detected in destination" }
    if ($Code -eq 3) { return "Files copied + extra files detected" }
    if ($Code -lt 8) { return "Completed cleanly (code $Code)" }
    return "Completed with errors (robocopy exit $Code)"
}

function Get-BackupSyncState {
    param([string]$Notice = "", [bool]$NoticeError = $false)
    $store = Get-BackupJobsStore
    return [ordered]@{
        type        = "BACKUP_SYNC_STATE"
        jobs        = @($store.jobs)
        history     = @($store.history)
        notice      = $Notice
        noticeError = $NoticeError
    }
}

function Invoke-BackupSyncAction {
    param(
        [Parameter(Mandatory)][string]$RawJson,
        [Parameter(Mandatory)][string]$RootPath
    )
    $payload = $RawJson | ConvertFrom-Json -AsHashtable
    $cmd = [string]$payload["command"]
    try {
        $store = Get-BackupJobsStore
        switch ($cmd) {
            "BACKUP_LOAD" {
                return (Get-BackupSyncState)
            }
            "BACKUP_SAVE_JOB" {
                $j = $payload["job"]
                if (-not ($j -is [System.Collections.IDictionary])) { throw "Invalid backup job payload." }
                $src = ([string]($j["source"] ?? "")).Trim()
                $dst = ([string]($j["destination"] ?? "")).Trim()
                if (-not $src -or -not $dst) { throw "Both Source and Destination folders are required." }
                if ($src.TrimEnd('\').Equals($dst.TrimEnd('\'), [System.StringComparison]::OrdinalIgnoreCase)) {
                    throw "Source and Destination folders cannot be identical."
                }
                $jid = ([string]($j["id"] ?? "")).Trim()
                if (-not $jid) { $jid = "bkp_" + ([guid]::NewGuid().ToString("N").Substring(0, 8)) }
                $jName = ([string]($j["name"] ?? "")).Trim()
                if (-not $jName) { $jName = "$(Split-Path -Leaf $src) → $(Split-Path -Leaf $dst)" }
                $mode = if ([string]$j["mode"] -eq "mirror") { "mirror" } else { "incremental" }
                $sched = ([string]($j["schedule"] ?? "manual")).ToLowerInvariant()
                if ($sched -notin @("manual", "daily", "weekly")) { $sched = "manual" }

                $cleanJob = [ordered]@{
                    id           = $jid
                    name         = $jName
                    source       = $src
                    destination  = $dst
                    mode         = $mode
                    excludeDirs  = ([string]($j["excludeDirs"] ?? "node_modules,.git,target,bin,obj,$RECYCLE.BIN,System Volume Information")).Trim()
                    excludeFiles = ([string]($j["excludeFiles"] ?? "*.tmp,Thumbs.db,desktop.ini")).Trim()
                    schedule     = $sched
                    lastRun      = ([string]($j["lastRun"] ?? ""))
                    lastStatus   = ([string]($j["lastStatus"] ?? "Never run"))
                }

                # Sync Windows Task Scheduler if daily/weekly selected
                $taskName = "Backup_$jid"
                try {
                    if ($sched -eq "manual") {
                        $null = & schtasks.exe /Delete /TN "\CoreWatch\$taskName" /F 2>$null
                    } else {
                        $rcArgs = (Get-RobocopyArgsForJob -Job $cleanJob) | ForEach-Object { if ($_ -match '\s') { "`"$_`"" } else { $_ } }
                        $trCmd = "robocopy.exe " + ($rcArgs -join " ")
                        $scFreq = if ($sched -eq "weekly") { "WEEKLY" } else { "DAILY" }
                        $null = & schtasks.exe /Create /TN "\CoreWatch\$taskName" /TR $trCmd /SC $scFreq /ST 02:00 /F 2>$null
                    }
                } catch {}

                $list = New-Object System.Collections.Generic.List[object]
                $replaced = $false
                foreach ($old in @($store.jobs)) {
                    if ($old["id"] -eq $jid) { $list.Add($cleanJob); $replaced = $true }
                    else { $list.Add($old) }
                }
                if (-not $replaced) { $list.Add($cleanJob) }
                $store["jobs"] = $list.ToArray()
                Save-BackupJobsStore -Store $store
                return (Get-BackupSyncState -Notice "Saved backup job '$jName' ($mode, schedule: $sched).")
            }
            "BACKUP_DELETE_JOB" {
                $jid = ([string]($payload["jobId"] ?? "")).Trim()
                try { $null = & schtasks.exe /Delete /TN "\CoreWatch\Backup_$jid" /F 2>$null } catch {}
                $store["jobs"] = @($store.jobs | Where-Object { $_["id"] -ne $jid })
                Save-BackupJobsStore -Store $store
                return (Get-BackupSyncState -Notice "Deleted backup job and removed any scheduled task.")
            }
            "BACKUP_DRY_RUN" {
                $jid = ([string]($payload["jobId"] ?? "")).Trim()
                $job = @($store.jobs | Where-Object { $_["id"] -eq $jid }) | Select-Object -First 1
                if (-not $job) { throw "Backup job not found." }
                if (-not (Test-Path -LiteralPath $job["source"] -PathType Container)) { throw "Source folder does not exist: $($job['source'])" }

                $sw = [System.Diagnostics.Stopwatch]::StartNew()
                $rcArgs = Get-RobocopyArgsForJob -Job $job -DryRun
                $outLines = @(& robocopy.exe @rcArgs 2>&1 | ForEach-Object { [string]$_ })
                $code = $LASTEXITCODE
                $sw.Stop()

                $previewLines = @($outLines | Where-Object { $_ -and $_.Trim() } | Select-Object -Last 80) -join "`n"
                return [ordered]@{
                    type       = "BACKUP_RUN_OUTPUT"
                    ok         = ($code -lt 8)
                    isDryRun   = $true
                    jobId      = $jid
                    jobName    = [string]$job["name"]
                    exitCode   = $code
                    summary    = "DRY RUN ($([math]::Round($sw.Elapsed.TotalSeconds, 1))s): $(Format-RobocopyExitMeaning -Code $code)"
                    outputText = $previewLines
                }
            }
            "BACKUP_RUN_JOB" {
                $jid = ([string]($payload["jobId"] ?? "")).Trim()
                $job = @($store.jobs | Where-Object { $_["id"] -eq $jid }) | Select-Object -First 1
                if (-not $job) { throw "Backup job not found." }
                if (-not (Test-Path -LiteralPath $job["source"] -PathType Container)) { throw "Source folder does not exist: $($job['source'])" }

                $sw = [System.Diagnostics.Stopwatch]::StartNew()
                $rcArgs = Get-RobocopyArgsForJob -Job $job
                $outLines = @(& robocopy.exe @rcArgs 2>&1 | ForEach-Object { [string]$_ })
                $code = $LASTEXITCODE
                $sw.Stop()

                $meaning = Format-RobocopyExitMeaning -Code $code
                $nowStr = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
                $durStr = "$([math]::Round($sw.Elapsed.TotalSeconds, 1))s"
                $job["lastRun"]    = $nowStr
                $job["lastStatus"] = "$meaning ($durStr)"

                $histEntry = [ordered]@{
                    timestamp = $nowStr
                    jobName   = [string]$job["name"]
                    mode      = [string]$job["mode"]
                    exitCode  = $code
                    ok        = ($code -lt 8)
                    duration  = $durStr
                    summary   = $meaning
                }
                $newH = New-Object System.Collections.Generic.List[object]
                $newH.Add($histEntry)
                foreach ($o in @($store.history)) { if ($newH.Count -lt 40) { $newH.Add($o) } }
                $store["history"] = $newH.ToArray()
                Save-BackupJobsStore -Store $store

                $tailOut = @($outLines | Where-Object { $_ -and $_.Trim() } | Select-Object -Last 80) -join "`n"
                return [ordered]@{
                    type       = "BACKUP_RUN_OUTPUT"
                    ok         = ($code -lt 8)
                    isDryRun   = $false
                    jobId      = $jid
                    jobName    = [string]$job["name"]
                    exitCode   = $code
                    summary    = "SYNC COMPLETE ($durStr): $meaning"
                    outputText = $tailOut
                    jobs       = @($store.jobs)
                    history    = @($store.history)
                }
            }
            default { throw "Unknown Backup Sync command: $cmd" }
        }
    } catch {
        return @{ type = "BACKUP_NOTICE"; ok = $false; error = $_.Exception.Message }
    }
}
