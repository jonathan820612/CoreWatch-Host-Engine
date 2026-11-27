# File: modules/tabs/DockerServicesManager.ps1
# =========================================================================
# COREWATCH DOCKER / PODMAN CONTAINERS & LOCAL DEV SERVICES MANAGER
#   - Auto-detects Docker CLI or Podman CLI
#   - Live container list (Start/Stop/Restart/Logs/Shell/Remove)
#   - Published host ports parsed for 1-click cross-link to Tasks & Ports
#   - Disk usage (system df) + 1-click unused image/volume/container prune
#   - Local Windows Dev Services quick control strip (Postgres/MySQL/Redis/Mongo/IIS/Docker)
# =========================================================================

function Get-ContainerEngineCli {
    $d = Get-Command docker -ErrorAction SilentlyContinue
    if ($d -and $d.Source) { return @{ engine = "docker"; exe = $d.Source; wslDistro = ""; wslHint = "" } }
    $p = Get-Command podman -ErrorAction SilentlyContinue
    if ($p -and $p.Source) { return @{ engine = "podman"; exe = $p.Source; wslDistro = ""; wslHint = "" } }

    # Fallback: check running WSL distros for docker or podman (never cold-boots stopped VMs)
    $wsl = Get-Command wsl.exe -ErrorAction SilentlyContinue
    $wslHint = ""
    if ($wsl -and $wsl.Source) {
        try {
            $running = @(& $wsl.Source -l --running -q 2>$null | ForEach-Object { ([string]$_ -replace '\0', '').Trim() } | Where-Object { $_ })
            foreach ($dist in $running) {
                $hasD = (& $wsl.Source -d $dist -- which docker 2>$null | Out-String).Trim()
                if ($LASTEXITCODE -eq 0 -and $hasD) { return @{ engine = "docker (WSL:$dist)"; exe = $wsl.Source; wslDistro = $dist; wslBin = "docker"; wslHint = "" } }
                $hasP = (& $wsl.Source -d $dist -- which podman 2>$null | Out-String).Trim()
                if ($LASTEXITCODE -eq 0 -and $hasP) { return @{ engine = "podman (WSL:$dist)"; exe = $wsl.Source; wslDistro = $dist; wslBin = "podman"; wslHint = "" } }
            }
            $allDists = @(& $wsl.Source -l -q 2>$null | ForEach-Object { ([string]$_ -replace '\0', '').Trim() } | Where-Object { $_ })
            $containerDist = @($allDists | Where-Object { $_ -match '(?i)docker|podman' }) | Select-Object -First 1
            if ($containerDist) {
                $wslHint = "Detected stopped container WSL distro '$containerDist'. Launch it from the WSL tab or start Docker/Podman Desktop, then click Refresh."
            }
        } catch {}
    }
    return @{ engine = "none"; exe = ""; wslDistro = ""; wslBin = ""; wslHint = $wslHint }
}

function Invoke-ContainerCli {
    param(
        [Parameter(Mandatory)][System.Collections.IDictionary]$Cli,
        [Parameter(Mandatory)][string[]]$CliArgs
    )
    if ($Cli.wslDistro) {
        $fullArgs = @("-d", $Cli.wslDistro, "--", $Cli.wslBin) + $CliArgs
        return @(& $Cli.exe @fullArgs 2>&1)
    }
    return @(& $Cli.exe @CliArgs 2>&1)
}

function Get-LocalDevWindowsServices {
    $patterns = @("postgresql*", "MySQL*", "MariaDB*", "Redis*", "Memurai*", "MongoDB*", "W3SVC", "com.docker.service", "MSSQL*", "Apache*", "RabbitMQ*", "nginx*")
    $list = New-Object System.Collections.Generic.List[object]
    $seen = @{}
    foreach ($pat in $patterns) {
        Get-Service -Name $pat -ErrorAction SilentlyContinue | ForEach-Object {
            if (-not $seen.ContainsKey($_.Name)) {
                $seen[$_.Name] = $true
                $list.Add([PSCustomObject]@{
                    name        = [string]$_.Name
                    displayName = [string]$_.DisplayName
                    status      = [string]$_.Status
                    startType   = [string]$_.StartType
                })
            }
        }
    }
    return ($list.ToArray() | Sort-Object displayName)
}

function Get-DockerServicesState {
    param([string]$Notice = "", [bool]$NoticeError = $false)
    $cli = Get-ContainerEngineCli
    $containers = New-Object System.Collections.Generic.List[object]
    $images     = New-Object System.Collections.Generic.List[object]
    $diskUsage  = New-Object System.Collections.Generic.List[object]
    $daemonOk   = $false
    $engineErr  = ""

    if ($cli.exe) {
        try {
            $psRaw = Invoke-ContainerCli -Cli $cli -CliArgs @("ps", "-a", "--format", "{{json .}}")
            if ($LASTEXITCODE -eq 0) {
                $daemonOk = $true
                $statsMap = @{}
                try {
                    $stRaw = Invoke-ContainerCli -Cli $cli -CliArgs @("stats", "--no-stream", "--format", "{{json .}}")
                    if ($LASTEXITCODE -eq 0) {
                        foreach ($sln in $stRaw) {
                            $ss = ([string]$sln).Trim()
                            if (-not $ss -or -not $ss.StartsWith("{")) { continue }
                            try {
                                $so = $ss | ConvertFrom-Json
                                $sid = ([string]($so.ID ?? $so.Id ?? $so.Container ?? "")).Trim()
                                if ($sid) {
                                    $statsMap[$sid] = @{
                                        cpu = [string]($so.CPUPerc ?? "")
                                        mem = [string]($so.MemUsage ?? "")
                                    }
                                }
                            } catch {}
                        }
                    }
                } catch {}

                foreach ($ln in $psRaw) {
                    $s = ([string]$ln).Trim()
                    if (-not $s -or -not $s.StartsWith("{")) { continue }
                    try {
                        $obj = $s | ConvertFrom-Json
                        $portsStr = [string]($obj.Ports ?? "")
                        $hostPorts = @([regex]::Matches($portsStr, ':(\d+)->') | ForEach-Object { [int]$_.Groups[1].Value } | Select-Object -Unique)
                        $stateVal = ([string]($obj.State ?? "")).ToLowerInvariant()
                        $statusStr = [string]($obj.Status ?? $stateVal)
                        $isRunning = ($stateVal -eq "running" -or $statusStr -match '^Up\b')
                        $cName = ([string]($obj.Names ?? $obj.Name ?? "")).TrimStart('/')
                        $cId   = [string]($obj.ID ?? $obj.Id ?? "")
                        $cStat = if ($statsMap.ContainsKey($cId)) { $statsMap[$cId] } else { $null }
                        $containers.Add([PSCustomObject]@{
                            id        = $cId
                            name      = $cName
                            image     = [string]($obj.Image ?? "")
                            state     = if ($isRunning) { "running" } else { "stopped" }
                            status    = $statusStr
                            ports     = $portsStr
                            hostPorts = $hostPorts
                            cpuPerc   = if ($cStat) { $cStat.cpu } else { "" }
                            memUsage  = if ($cStat) { $cStat.mem } else { "" }
                        })
                    } catch {}
                }

                $imgRaw = Invoke-ContainerCli -Cli $cli -CliArgs @("images", "--format", "{{json .}}")
                foreach ($ln in $imgRaw) {
                    $s = ([string]$ln).Trim()
                    if (-not $s -or -not $s.StartsWith("{")) { continue }
                    try {
                        $im = $s | ConvertFrom-Json
                        $images.Add([PSCustomObject]@{
                            id         = [string]($im.ID ?? $im.Id ?? "")
                            repository = [string]($im.Repository ?? "<none>")
                            tag        = [string]($im.Tag ?? "<none>")
                            size       = [string]($im.Size ?? "")
                            created    = [string]($im.CreatedSince ?? $im.CreatedAt ?? "")
                        })
                    } catch {}
                }

                $dfRaw = Invoke-ContainerCli -Cli $cli -CliArgs @("system", "df", "--format", "{{json .}}")
                foreach ($ln in $dfRaw) {
                    $s = ([string]$ln).Trim()
                    if (-not $s -or -not $s.StartsWith("{")) { continue }
                    try {
                        $df = $s | ConvertFrom-Json
                        $diskUsage.Add([PSCustomObject]@{
                            type        = [string]($df.Type ?? "")
                            totalCount  = [string]($df.TotalCount ?? "")
                            active      = [string]($df.Active ?? "")
                            size        = [string]($df.Size ?? "")
                            reclaimable = [string]($df.Reclaimable ?? "")
                        })
                    } catch {}
                }
            } else {
                $engineErr = ($psRaw -join " ").Trim()
            }
        } catch {
            $engineErr = $_.Exception.Message
        }
    } elseif ($cli.wslHint) {
        $engineErr = $cli.wslHint
    }

    $devSvcs = @(Get-LocalDevWindowsServices)
    $runningCnt = (@($containers | Where-Object { $_.state -eq "running" })).Count

    return [ordered]@{
        type           = "DOCKER_SERVICES_STATE"
        engine         = [string]$cli.engine
        daemonRunning  = $daemonOk
        engineError    = $engineErr
        containers     = $containers.ToArray()
        runningCount   = $runningCnt
        images         = $images.ToArray()
        diskUsage      = $diskUsage.ToArray()
        devServices    = $devSvcs
        notice         = $Notice
        noticeError    = $NoticeError
    }
}

function Invoke-DockerServicesAction {
    param(
        [Parameter(Mandatory)][string]$RawJson,
        [Parameter(Mandatory)][string]$RootPath
    )
    $payload = $RawJson | ConvertFrom-Json -AsHashtable
    $cmd = [string]$payload["command"]
    try {
        $cli = Get-ContainerEngineCli
        switch ($cmd) {
            "DOCKER_LOAD" {
                return (Get-DockerServicesState)
            }
            "DOCKER_CONTAINER_ACTION" {
                if (-not $cli.exe) { throw "No Docker or Podman CLI found on PATH or running WSL." }
                $cid = ([string]($payload["containerId"] ?? "")).Trim()
                $op  = ([string]($payload["op"] ?? "")).Trim().ToLowerInvariant()
                if (-not $cid -or $op -notin @("start", "stop", "restart", "rm")) { throw "Invalid container action." }
                $cArgs = if ($op -eq "rm") { @("rm", "-f", $cid) } else { @($op, $cid) }
                $out = Invoke-ContainerCli -Cli $cli -CliArgs $cArgs
                if ($LASTEXITCODE -ne 0) { throw "Container $op failed: $($out -join ' ')" }
                return (Get-DockerServicesState -Notice "Executed '$($cli.engine) $op $cid' successfully.")
            }
            "DOCKER_REMOVE_IMAGE" {
                if (-not $cli.exe) { throw "No Docker or Podman CLI found." }
                $imgId = ([string]($payload["imageId"] ?? "")).Trim()
                if (-not $imgId) { throw "Image ID is required." }
                $out = Invoke-ContainerCli -Cli $cli -CliArgs @("rmi", "-f", $imgId)
                if ($LASTEXITCODE -ne 0) { throw "Image removal failed: $($out -join ' ')" }
                return (Get-DockerServicesState -Notice "Removed container image '$imgId'.")
            }
            "DOCKER_CONTAINER_LOGS" {
                if (-not $cli.exe) { throw "No Docker or Podman CLI found." }
                $cid   = ([string]($payload["containerId"] ?? "")).Trim()
                $cname = ([string]($payload["containerName"] ?? $cid)).Trim()
                $logs  = ((Invoke-ContainerCli -Cli $cli -CliArgs @("logs", "--tail", "150", $cid)) -join "`n")
                return [ordered]@{
                    type          = "DOCKER_LOGS_RESULT"
                    ok            = $true
                    containerName = $cname
                    logs          = $logs
                }
            }
            "DOCKER_CONTAINER_SHELL" {
                if (-not $cli.exe) { throw "No Docker or Podman CLI found." }
                $cid = ([string]($payload["containerId"] ?? "")).Trim()
                $wt = Get-Command wt.exe -ErrorAction SilentlyContinue
                $shellArgs = if ($cli.wslDistro) { @("-d", $cli.wslDistro, "--", $cli.wslBin, "exec", "-it", $cid, "/bin/sh") } else { @("exec", "-it", $cid, "/bin/sh") }
                if ($wt) {
                    Start-Process -FilePath $wt.Source -ArgumentList (@($cli.exe) + $shellArgs)
                } else {
                    Start-Process -FilePath $cli.exe -ArgumentList $shellArgs
                }
                return @{ type = "DOCKER_NOTICE"; ok = $true; message = "Opened interactive shell in container '$cid'." }
            }
            "DOCKER_PRUNE" {
                if (-not $cli.exe) { throw "No Docker or Podman CLI found." }
                $out = ((Invoke-ContainerCli -Cli $cli -CliArgs @("system", "prune", "-f")) -join "`n").Trim()
                return (Get-DockerServicesState -Notice "Pruned unused containers, networks & dangling images: $($out.Split("`n")[-1])")
            }
            "DOCKER_SERVICE_TOGGLE" {
                $sname = ([string]($payload["serviceName"] ?? "")).Trim()
                $op    = ([string]($payload["op"] ?? "start")).ToLowerInvariant()
                if (-not $sname) { throw "Service name is required." }
                if ($op -eq "stop") { Stop-Service -Name $sname -Force -ErrorAction Stop }
                elseif ($op -eq "restart") { Restart-Service -Name $sname -Force -ErrorAction Stop }
                else { Start-Service -Name $sname -ErrorAction Stop }
                return (Get-DockerServicesState -Notice "Service '$sname' -> $op completed.")
            }
            default { throw "Unknown Docker & Dev Services command: $cmd" }
        }
    } catch {
        return @{ type = "DOCKER_NOTICE"; ok = $false; error = $_.Exception.Message }
    }
}
