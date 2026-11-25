# File: modules/tabs/HomelabManager.ps1
# =========================================================================
# COREWATCH MULTI-PC / HOMELAB MONITOR
#   - Persistent node inventory: %LOCALAPPDATA%\CoreWatch\homelab-nodes.json
#   - Supports 3 lightweight zero-agent probe modes:
#     1. SSH (Linux/macOS/NAS/WSL via Windows OpenSSH key auth)
#     2. WinRM (Windows secondary PCs/servers via Invoke-Command)
#     3. HTTP / Ping (Proxmox, TrueNAS, Unraid, Pi-hole, routers, web APIs)
#   - 1-click Launch SSH Terminal, RDP (mstsc), or Web UI
# =========================================================================

function Get-HomelabStorePath {
    $dir = Join-Path $env:LOCALAPPDATA "CoreWatch"
    if (-not (Test-Path -LiteralPath $dir)) { $null = New-Item -ItemType Directory -Path $dir -Force }
    return (Join-Path $dir "homelab-nodes.json")
}

function Get-HomelabStore {
    $path = Get-HomelabStorePath
    if (Test-Path -LiteralPath $path -PathType Leaf) {
        try {
            $raw = Get-Content -LiteralPath $path -Raw -ErrorAction Stop | ConvertFrom-Json -AsHashtable
            if ($raw -is [System.Collections.IDictionary] -and $raw.ContainsKey("nodes")) {
                return [ordered]@{ schemaVersion = 1; nodes = @($raw["nodes"]) }
            }
        } catch {}
    }
    return [ordered]@{ schemaVersion = 1; nodes = @() }
}

function Save-HomelabStore {
    param([Parameter(Mandatory)][System.Collections.IDictionary]$Store)
    $path = Get-HomelabStorePath
    [System.IO.File]::WriteAllText($path, ($Store | ConvertTo-Json -Depth 8), (New-Object System.Text.UTF8Encoding($false)))
}

function Test-HomelabNodeTelemetry {
    param([Parameter(Mandatory)][System.Collections.IDictionary]$Node)
    $mode = ([string]($Node["mode"] ?? "http")).ToLowerInvariant()
    $addr = ([string]($Node["host"] ?? "")).Trim()
    $port = [int]($Node["port"] ?? 22)
    $user = ([string]($Node["user"] ?? "")).Trim()
    $webUrl = ([string]($Node["webUrl"] ?? "")).Trim()

    $res = [ordered]@{
        id         = [string]$Node["id"]
        name       = [string]$Node["name"]
        mode       = $mode
        host       = $addr
        port       = $port
        user       = $user
        webUrl     = $webUrl
        online     = $false
        latencyMs  = -1
        osInfo     = ""
        uptime     = ""
        cpuPct     = -1
        ramPct     = -1
        ramText    = ""
        diskPct    = -1
        detail     = ""
        checkedAt  = (Get-Date).ToString("HH:mm:ss")
    }

    # Quick ICMP Ping latency probe
    $pingHost = ($addr -replace '^https?://','').Split('/')[0].Split(':')[0]
    try {
        $pObj = New-Object System.Net.NetworkInformation.Ping
        $reply = $pObj.Send($pingHost, 1800)
        if ($reply.Status -eq [System.Net.NetworkInformation.IPStatus]::Success) {
            $res["latencyMs"] = [int]$reply.RoundtripTime
            $res["online"] = $true
        }
        $pObj.Dispose()
    } catch {}

    if ($mode -eq "http") {
        $probeUrl = if ($webUrl) { $webUrl } elseif ($addr -match '^https?://') { $addr } else { "http://$addr" }
        try {
            $sw = [System.Diagnostics.Stopwatch]::StartNew()
            $resp = Invoke-WebRequest -Uri $probeUrl -Method Get -TimeoutSec 5 -SkipCertificateCheck -ErrorAction Stop
            $sw.Stop()
            $res["online"] = $true
            if ($res["latencyMs"] -lt 0) { $res["latencyMs"] = [int]$sw.ElapsedMilliseconds }
            $res["detail"] = "HTTP $($resp.StatusCode) OK ($([int]$sw.ElapsedMilliseconds) ms)"
        } catch {
            $res["detail"] = if ($res["online"]) { "Ping OK, HTTP error: $($_.Exception.Message)" } else { "Unreachable: $($_.Exception.Message)" }
        }
        return $res
    }

    if ($mode -eq "ssh") {
        $sshExe = Get-Command ssh -ErrorAction SilentlyContinue
        if (-not $sshExe) { $res["detail"] = "OpenSSH client not found on PATH"; return $res }
        $target = if ($user) { "$user@$addr" } else { $addr }
        $remoteCmd = 'printf "HOST=%s|OS=%s|UP=%s|MEM=%s|DISK=%s|LOAD=%s\n" "$(hostname)" "$(uname -sr)" "$(uptime -p 2>/dev/null || uptime)" "$(free -m 2>/dev/null | awk ''/Mem:/{printf \"%d/%d\",$3,$2}'')" "$(df -P / 2>/dev/null | awk ''NR==2{gsub(/%/,\"\",$5); print $5}'')" "$(cut -d\" \" -f1 /proc/loadavg 2>/dev/null)"'
        try {
            $sshOut = (& $sshExe.Source -o BatchMode=yes -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new -p $port $target $remoteCmd 2>&1 | Out-String).Trim()
            if ($LASTEXITCODE -eq 0 -and $sshOut -match 'HOST=') {
                $res["online"] = $true
                $kv = @{}
                foreach ($part in ($sshOut -split '\|')) {
                    $eq = $part.IndexOf('=')
                    if ($eq -gt 0) { $kv[$part.Substring(0, $eq)] = $part.Substring($eq + 1) }
                }
                $res["osInfo"] = [string]($kv["OS"] ?? "Linux/SSH")
                $res["uptime"] = [string]($kv["UP"] ?? "")
                if ($kv["MEM"] -match '^(\d+)/(\d+)$' -and [int]$Matches[2] -gt 0) {
                    $uMb = [int]$Matches[1]; $tMb = [int]$Matches[2]
                    $res["ramPct"]  = [math]::Round(($uMb / $tMb) * 100, 1)
                    $res["ramText"] = "$([math]::Round($uMb/1024,1)) / $([math]::Round($tMb/1024,1)) GB"
                }
                if ($kv["DISK"] -match '^\d+$') { $res["diskPct"] = [int]$kv["DISK"] }
                $load1 = [string]($kv["LOAD"] ?? "")
                $res["detail"] = if ($load1) { "SSH OK · Load avg: $load1" } else { "SSH OK" }
            } else {
                $res["detail"] = "SSH probe failed (ensure key-based auth is set up): $sshOut"
            }
        } catch {
            $res["detail"] = "SSH error: $($_.Exception.Message)"
        }
        return $res
    }

    if ($mode -eq "winrm") {
        try {
            $sb = {
                $os  = Get-CimInstance Win32_OperatingSystem
                $cpu = (Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average
                $dsk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='C:'"
                $up  = (Get-Date) - $os.LastBootUpTime
                @{
                    os      = $os.Caption
                    uptime  = "{0}d {1}h" -f [int]$up.TotalDays, $up.Hours
                    cpuPct  = [int]($cpu ?? 0)
                    ramTot  = [math]::Round($os.TotalVisibleMemorySize / 1MB, 1)
                    ramUsed = [math]::Round(($os.TotalVisibleMemorySize - $os.FreePhysicalMemory) / 1MB, 1)
                    diskPct = if ($dsk -and $dsk.Size -gt 0) { [int][math]::Round((($dsk.Size - $dsk.FreeSpace) / $dsk.Size) * 100) } else { -1 }
                }
            }
            $data = Invoke-Command -ComputerName $addr -ScriptBlock $sb -ErrorAction Stop
            $res["online"]  = $true
            $res["osInfo"]  = [string]$data.os
            $res["uptime"]  = [string]$data.uptime
            $res["cpuPct"]  = [int]$data.cpuPct
            if ($data.ramTot -gt 0) {
                $res["ramPct"]  = [math]::Round(($data.ramUsed / $data.ramTot) * 100, 1)
                $res["ramText"] = "$($data.ramUsed) / $($data.ramTot) GB"
            }
            $res["diskPct"] = [int]$data.diskPct
            $res["detail"]  = "WinRM OK"
        } catch {
            $res["detail"] = "WinRM failed (enable Enable-PSRemoting & TrustedHosts): $($_.Exception.Message)"
        }
        return $res
    }

    return $res
}

function Get-HomelabState {
    param([switch]$PollNow, [string]$Notice = "", [bool]$NoticeError = $false)
    $store = Get-HomelabStore
    $results = New-Object System.Collections.Generic.List[object]
    foreach ($n in @($store.nodes)) {
        if ($PollNow) {
            $results.Add((Test-HomelabNodeTelemetry -Node $n))
        } else {
            $results.Add([ordered]@{
                id = [string]$n["id"]; name = [string]$n["name"]; mode = [string]$n["mode"]
                host = [string]$n["host"]; port = [int]($n["port"] ?? 22); user = [string]($n["user"] ?? "")
                webUrl = [string]($n["webUrl"] ?? ""); online = $false; latencyMs = -1
                osInfo = ""; uptime = ""; cpuPct = -1; ramPct = -1; ramText = ""; diskPct = -1
                detail = "Click 'Poll All Nodes' to fetch live metrics"; checkedAt = "--"
            })
        }
    }
    $onlineCnt = (@($results | Where-Object { $_.online })).Count
    return [ordered]@{
        type        = "HOMELAB_STATE"
        nodes       = $results.ToArray()
        onlineCount = $onlineCnt
        totalCount  = $results.Count
        polled      = [bool]$PollNow
        notice      = $Notice
        noticeError = $NoticeError
    }
}

function Invoke-HomelabAction {
    param(
        [Parameter(Mandatory)][string]$RawJson,
        [Parameter(Mandatory)][string]$RootPath
    )
    $payload = $RawJson | ConvertFrom-Json -AsHashtable
    $cmd = [string]$payload["command"]
    try {
        $store = Get-HomelabStore
        switch ($cmd) {
            "HOMELAB_LOAD" {
                return (Get-HomelabState -PollNow:([bool]($payload["pollNow"] ?? $false)))
            }
            "HOMELAB_POLL_ALL" {
                return (Get-HomelabState -PollNow -Notice "Polled $($store.nodes.Count) homelab node(s).")
            }
            "HOMELAB_SAVE_NODE" {
                $n = $payload["node"]
                if (-not ($n -is [System.Collections.IDictionary])) { throw "Invalid node payload." }
                $hostVal = ([string]($n["host"] ?? "")).Trim()
                if (-not $hostVal) { throw "Host IP, hostname, or URL is required." }
                $nid = ([string]($n["id"] ?? "")).Trim()
                if (-not $nid) { $nid = "node_" + ([guid]::NewGuid().ToString("N").Substring(0, 8)) }
                $nName = ([string]($n["name"] ?? "")).Trim()
                if (-not $nName) { $nName = $hostVal }
                $mode = ([string]($n["mode"] ?? "ssh")).ToLowerInvariant()
                if ($mode -notin @("ssh", "winrm", "http")) { $mode = "http" }
                $port = [int]($n["port"] ?? $(if ($mode -eq "ssh") { 22 } else { 80 }))

                $clean = [ordered]@{
                    id     = $nid
                    name   = $nName
                    mode   = $mode
                    host   = $hostVal
                    port   = $port
                    user   = ([string]($n["user"] ?? "")).Trim()
                    webUrl = ([string]($n["webUrl"] ?? "")).Trim()
                }
                $list = New-Object System.Collections.Generic.List[object]
                $replaced = $false
                foreach ($old in @($store.nodes)) {
                    if ($old["id"] -eq $nid) { $list.Add($clean); $replaced = $true }
                    else { $list.Add($old) }
                }
                if (-not $replaced) { $list.Add($clean) }
                $store["nodes"] = $list.ToArray()
                Save-HomelabStore -Store $store
                return (Get-HomelabState -PollNow -Notice "Saved and polled node '$nName'.")
            }
            "HOMELAB_DELETE_NODE" {
                $nid = ([string]($payload["nodeId"] ?? "")).Trim()
                $store["nodes"] = @($store.nodes | Where-Object { $_["id"] -ne $nid })
                Save-HomelabStore -Store $store
                return (Get-HomelabState -Notice "Removed remote node.")
            }
            "HOMELAB_LAUNCH_SSH" {
                $h = ([string]($payload["host"] ?? "")).Trim()
                $u = ([string]($payload["user"] ?? "")).Trim()
                $p = [int]($payload["port"] ?? 22)
                $tgt = if ($u) { "$u@$h" } else { $h }
                $wt = Get-Command wt.exe -ErrorAction SilentlyContinue
                if ($wt) { Start-Process $wt.Source -ArgumentList @("new-tab", "ssh", "-p", "$p", $tgt) }
                else { Start-Process "ssh.exe" -ArgumentList @("-p", "$p", $tgt) }
                return @{ type = "HOMELAB_NOTICE"; ok = $true; message = "Launched SSH terminal to $tgt." }
            }
            "HOMELAB_LAUNCH_RDP" {
                $h = ([string]($payload["host"] ?? "")).Trim()
                Start-Process "mstsc.exe" -ArgumentList "/v:$h"
                return @{ type = "HOMELAB_NOTICE"; ok = $true; message = "Launched Remote Desktop to $h." }
            }
            default { throw "Unknown Homelab command: $cmd" }
        }
    } catch {
        return @{ type = "HOMELAB_NOTICE"; ok = $false; error = $_.Exception.Message }
    }
}
