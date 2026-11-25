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
    if ($d -and $d.Source) { return @{ engine = "docker"; exe = $d.Source } }
    $p = Get-Command podman -ErrorAction SilentlyContinue
    if ($p -and $p.Source) { return @{ engine = "podman"; exe = $p.Source } }
    return @{ engine = "none"; exe = "" }
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
            $psRaw = @(& $cli.exe ps -a --format '{{json .}}' 2>&1)
            if ($LASTEXITCODE -eq 0) {
                $daemonOk = $true
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
                        $containers.Add([PSCustomObject]@{
                            id        = [string]($obj.ID ?? $obj.Id ?? "")
                            name      = $cName
                            image     = [string]($obj.Image ?? "")
                            state     = if ($isRunning) { "running" } else { "stopped" }
                            status    = $statusStr
                            ports     = $portsStr
                            hostPorts = $hostPorts
                        })
                    } catch {}
                }

                $imgRaw = @(& $cli.exe images --format '{{json .}}' 2>$null)
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

                $dfRaw = @(& $cli.exe system df --format '{{json .}}' 2>$null)
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
                if (-not $cli.exe) { throw "No Docker or Podman CLI found on PATH." }
                $cid = ([string]($payload["containerId"] ?? "")).Trim()
                $op  = ([string]($payload["op"] ?? "")).Trim().ToLowerInvariant()
                if (-not $cid -or $op -notin @("start", "stop", "restart", "rm")) { throw "Invalid container action." }
                $out = if ($op -eq "rm") { & $cli.exe rm -f $cid 2>&1 } else { & $cli.exe $op $cid 2>&1 }
                if ($LASTEXITCODE -ne 0) { throw "Container $op failed: $($out -join ' ')" }
                return (Get-DockerServicesState -Notice "Executed '$($cli.engine) $op $cid' successfully.")
            }
            "DOCKER_CONTAINER_LOGS" {
                if (-not $cli.exe) { throw "No Docker or Podman CLI found." }
                $cid   = ([string]($payload["containerId"] ?? "")).Trim()
                $cname = ([string]($payload["containerName"] ?? $cid)).Trim()
                $logs  = (& $cli.exe logs --tail 150 $cid 2>&1 | Out-String)
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
                if ($wt) {
                    Start-Process -FilePath $wt.Source -ArgumentList @($cli.exe, "exec", "-it", $cid, "/bin/sh")
                } else {
                    Start-Process -FilePath $cli.exe -ArgumentList @("exec", "-it", $cid, "/bin/sh")
                }
                return @{ type = "DOCKER_NOTICE"; ok = $true; message = "Opened interactive shell in container '$cid'." }
            }
            "DOCKER_PRUNE" {
                if (-not $cli.exe) { throw "No Docker or Podman CLI found." }
                $out = (& $cli.exe system prune -f 2>&1 | Out-String).Trim()
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
