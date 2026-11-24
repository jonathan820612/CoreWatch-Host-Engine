# File: modules/tabs/TasksPortsManager.ps1
# =========================================================================
# COREWATCH LIVE PROCESSES, WINDOWS SERVICES & OPEN PORTS/SOCKETS INSPECTOR
# High-impact IT diagnostic workbench for investigating:
#   1. Active Processes (CPU %, RAM, Handles, Threads, PID, Path, Safe Kill)
#   2. Windows Services (Status, StartMode, Failed-Auto detection, Start/Stop/Restart)
#   3. Open TCP/UDP Ports & Established Sockets mapped to Owning Process & Path
# =========================================================================

[CmdletBinding()]
param()

function Test-TasksPortsElevated {
    try {
        $id = [Security.Principal.WindowsIdentity]::GetCurrent()
        $pr = New-Object Security.Principal.WindowsPrincipal($id)
        return $pr.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    } catch { return $false }
}

function Format-TasksMemMB {
    param([long]$Bytes)
    if ($Bytes -le 0) { return "0 MB" }
    if ($Bytes -ge 1GB) { return "{0:N2} GB" -f ($Bytes / 1GB) }
    return "{0:N1} MB" -f ($Bytes / 1MB)
}

function Get-TasksPortsSnapshot {
    [CmdletBinding()]
    param()

    $isAdmin = Test-TasksPortsElevated
    $logicalCores = [math]::Max(1, [Environment]::ProcessorCount)

    # -------------------------------------------------------------------------
    # 1. LIVE PROCESSES (2-pass 220ms CPU delta for real live CPU% + RAM/Handles)
    # -------------------------------------------------------------------------
    $procPathMap = @{}
    $procNameByPid = @{}
    $sample1 = @{}

    $rawProcs1 = [System.Diagnostics.Process]::GetProcesses()
    $t1 = [System.Diagnostics.Stopwatch]::StartNew()
    foreach ($p in $rawProcs1) {
        try {
            $pidVal = $p.Id
            $procNameByPid[$pidVal] = $p.ProcessName
            try { $sample1[$pidVal] = $p.TotalProcessorTime.TotalMilliseconds } catch {}
        } finally {
            $p.Dispose()
        }
    }

    Start-Sleep -Milliseconds 220
    $elapsedMs = [math]::Max(100.0, $t1.Elapsed.TotalMilliseconds)

    # Lightweight CIM lookup for paths/commandlines (graceful fallback if unavailable)
    try {
        $cimProcs = Get-CimInstance -ClassName Win32_Process -Property ProcessId, ExecutablePath -ErrorAction SilentlyContinue
        foreach ($cp in $cimProcs) {
            if ($cp.ExecutablePath) {
                $procPathMap[[int]$cp.ProcessId] = [string]$cp.ExecutablePath
            }
        }
    } catch {}

    $processes = [System.Collections.Generic.List[PSCustomObject]]::new()
    $rawProcs2 = [System.Diagnostics.Process]::GetProcesses()
    $totalHandles = 0L

    foreach ($p in $rawProcs2) {
        try {
            $pidVal = $p.Id
            if ($pidVal -eq 0) { continue }

            $pName = [string]$p.ProcessName
            $procNameByPid[$pidVal] = $pName
            $ws = 0L
            try { $ws = [long]$p.WorkingSet64 } catch {}
            $handles = 0
            try { $handles = [int]$p.HandleCount; $totalHandles += $handles } catch {}
            $threads = 0
            try { $threads = [int]$p.Threads.Count } catch {}

            $cpuPct = 0.0
            try {
                $cpu2 = $p.TotalProcessorTime.TotalMilliseconds
                if ($sample1.ContainsKey($pidVal)) {
                    $delta = $cpu2 - [double]$sample1[$pidVal]
                    if ($delta -gt 0) {
                        $cpuPct = [math]::Min(100.0, [math]::Round(($delta / ($elapsedMs * $logicalCores)) * 100.0, 1))
                    }
                }
            } catch {}

            $exePath = ""
            if ($procPathMap.ContainsKey($pidVal)) {
                $exePath = $procPathMap[$pidVal]
            } else {
                try { $exePath = [string]$p.MainModule.FileName } catch {}
            }
            if ($exePath) { $procPathMap[$pidVal] = $exePath }

            $processes.Add([PSCustomObject]@{
                pid        = $pidVal
                name       = $pName
                cpuPct     = $cpuPct
                ramBytes   = $ws
                ramText    = Format-TasksMemMB -Bytes $ws
                handles    = $handles
                threads    = $threads
                path       = $exePath
            })
        } finally {
            $p.Dispose()
        }
    }

    # Sort by RAM desc initially, cap to top 160 active processes for fast WebView rendering
    $sortedProcs = @($processes | Sort-Object -Property @{ Expression = "cpuPct"; Descending = $true }, @{ Expression = "ramBytes"; Descending = $true } | Select-Object -First 180)

    # -------------------------------------------------------------------------
    # 2. WINDOWS SERVICES (State, StartMode, Failed-Auto detection, PID, Path)
    # -------------------------------------------------------------------------
    $services = [System.Collections.Generic.List[PSCustomObject]]::new()
    $svcRunning = 0
    $svcStoppedAuto = 0

    $cimServices = $null
    try {
        $cimServices = @(Get-CimInstance -ClassName Win32_Service -ErrorAction Stop)
    } catch {}

    if ($cimServices -and $cimServices.Count -gt 0) {
        foreach ($s in $cimServices) {
            $st = [string]$s.State
            $sm = [string]$s.StartMode
            $isAutoStopped = ($sm -eq "Auto" -and $st -ne "Running" -and -not $s.DelayedAutoStart)
            if ($st -eq "Running") { $svcRunning++ }
            if ($isAutoStopped)    { $svcStoppedAuto++ }

            $services.Add([PSCustomObject]@{
                name          = [string]$s.Name
                displayName   = [string]$s.DisplayName
                state         = $st
                startMode     = $sm
                delayedAuto   = [bool]$s.DelayedAutoStart
                isAutoStopped = [bool]$isAutoStopped
                pid           = [int]$s.ProcessId
                account       = if ($s.StartName) { [string]$s.StartName } else { "" }
                path          = if ($s.PathName) { [string]$s.PathName } else { "" }
            })
        }
    } else {
        # Fallback to Get-Service if CIM is unavailable
        try {
            $regSvc = Get-Service -ErrorAction SilentlyContinue
            foreach ($s in $regSvc) {
                $st = [string]$s.Status
                $sm = [string]$s.StartType
                $isAutoStopped = ($sm -eq "Automatic" -and $st -ne "Running")
                if ($st -eq "Running") { $svcRunning++ }
                if ($isAutoStopped)    { $svcStoppedAuto++ }
                $services.Add([PSCustomObject]@{
                    name          = [string]$s.Name
                    displayName   = [string]$s.DisplayName
                    state         = $st
                    startMode     = if ($sm -eq "Automatic") { "Auto" } else { $sm }
                    delayedAuto   = $false
                    isAutoStopped = [bool]$isAutoStopped
                    pid           = 0
                    account       = ""
                    path          = ""
                })
            }
        } catch {}
    }

    $sortedServices = @($services | Sort-Object -Property @{ Expression = "isAutoStopped"; Descending = $true }, @{ Expression = "displayName"; Descending = $false })

    # -------------------------------------------------------------------------
    # 3. OPEN PORTS & ACTIVE SOCKETS (TCP Listen/Established + UDP -> PID/Process)
    # -------------------------------------------------------------------------
    $sockets = [System.Collections.Generic.List[PSCustomObject]]::new()
    $listenCount = 0
    $estabCount  = 0

    try {
        $tcpConns = @(Get-NetTCPConnection -ErrorAction Stop)
        foreach ($c in $tcpConns) {
            $stStr = [string]$c.State
            if ($stStr -eq "Listen")      { $listenCount++ }
            if ($stStr -eq "Established") { $estabCount++ }

            $ownPid = [int]$c.OwningProcess
            $ownName = if ($procNameByPid.ContainsKey($ownPid)) { $procNameByPid[$ownPid] } elseif ($ownPid -eq 4) { "System" } else { "PID $ownPid" }
            $ownPath = if ($procPathMap.ContainsKey($ownPid)) { $procPathMap[$ownPid] } else { "" }

            $sockets.Add([PSCustomObject]@{
                protocol      = "TCP"
                localAddress  = [string]$c.LocalAddress
                localPort     = [int]$c.LocalPort
                remoteAddress = [string]$c.RemoteAddress
                remotePort    = [int]$c.RemotePort
                state         = $stStr
                pid           = $ownPid
                processName   = $ownName
                processPath   = $ownPath
            })
        }
    } catch {}

    try {
        $udpEps = @(Get-NetUDPEndpoint -ErrorAction Stop)
        foreach ($u in $udpEps) {
            $ownPid = [int]$u.OwningProcess
            $ownName = if ($procNameByPid.ContainsKey($ownPid)) { $procNameByPid[$ownPid] } elseif ($ownPid -eq 4) { "System" } else { "PID $ownPid" }
            $ownPath = if ($procPathMap.ContainsKey($ownPid)) { $procPathMap[$ownPid] } else { "" }

            $sockets.Add([PSCustomObject]@{
                protocol      = "UDP"
                localAddress  = [string]$u.LocalAddress
                localPort     = [int]$u.LocalPort
                remoteAddress = "*"
                remotePort    = 0
                state         = "Bound"
                pid           = $ownPid
                processName   = $ownName
                processPath   = $ownPath
            })
        }
    } catch {}

    $sortedSockets = @($sockets | Sort-Object -Property @{ Expression = "localPort"; Descending = $false }, @{ Expression = "protocol"; Descending = $false })

    return [PSCustomObject]@{
        type      = "TASKS_PORTS_STATE"
        isAdmin   = $isAdmin
        timestamp = (Get-Date).ToString("HH:mm:ss")
        summary   = [PSCustomObject]@{
            totalProcesses = $processes.Count
            totalHandles   = $totalHandles
            totalServices  = $sortedServices.Count
            runningSvcs    = $svcRunning
            stoppedAutoSvc = $svcStoppedAuto
            listeningPorts = $listenCount
            establishedTcp = $estabCount
            totalSockets   = $sortedSockets.Count
        }
        processes = $sortedProcs
        services  = $sortedServices
        sockets   = $sortedSockets
    }
}

function Invoke-TasksPortsAction {
    param(
        [Parameter(Mandatory)][string]$RawJson
    )

    $payload = $null
    try {
        $payload = $RawJson | ConvertFrom-Json
    } catch {
        return [PSCustomObject]@{ type = "TASKS_PORTS_NOTICE"; ok = $false; error = "Invalid command payload." }
    }

    $cmd = [string]$payload.command

    try {
        switch ($cmd) {

            "TP_KILL_PROCESS" {
                $targetPid = [int]($payload.pid ?? 0)
                if ($targetPid -le 4) { throw "Refused to terminate protected Windows kernel process." }
                $proc = Get-Process -Id $targetPid -ErrorAction Stop
                $protected = @('csrss', 'lsass', 'wininit', 'winlogon', 'smss', 'services', 'svchost', 'dwm', 'explorer', 'pwsh', 'powershell', 'system', 'registry')
                if ($proc.ProcessName.ToLowerInvariant() -in $protected) {
                    throw "Refused to terminate critical Windows process '$($proc.ProcessName).exe'."
                }
                $pName = $proc.ProcessName
                Stop-Process -Id $targetPid -Force -ErrorAction Stop
                Start-Sleep -Milliseconds 250
                $snap = Get-TasksPortsSnapshot
                $snap | Add-Member -NotePropertyName "actionMessage" -NotePropertyValue "Terminated process '$pName.exe' (PID $targetPid)." -Force
                return $snap
            }

            "TP_OPEN_PROCESS_LOCATION" {
                $path = [string]($payload.path ?? "").Trim()
                if (-not $path -or -not (Test-Path -LiteralPath $path -ErrorAction SilentlyContinue)) {
                    throw "Executable file path is unavailable or protected."
                }
                Start-Process -FilePath "explorer.exe" -ArgumentList @("/select,`"$path`"") -ErrorAction Stop
                return [PSCustomObject]@{ type = "TASKS_PORTS_NOTICE"; ok = $true; message = "Opened File Explorer at $path" }
            }

            "TP_SERVICE_ACTION" {
                if (-not (Test-TasksPortsElevated)) { throw "Administrator privileges are required to control Windows Services." }
                $svcName = [string]($payload.serviceName ?? "").Trim()
                $action  = [string]($payload.action ?? "").Trim().ToLowerInvariant()
                if (-not $svcName) { throw "Service name is required." }

                switch ($action) {
                    "start"   { Start-Service -Name $svcName -ErrorAction Stop }
                    "stop"    { Stop-Service -Name $svcName -Force -ErrorAction Stop }
                    "restart" { Restart-Service -Name $svcName -Force -ErrorAction Stop }
                    default   { throw "Unknown service action: $action" }
                }
                Start-Sleep -Milliseconds 300
                $snap = Get-TasksPortsSnapshot
                $snap | Add-Member -NotePropertyName "actionMessage" -NotePropertyValue "Service '$svcName' action '$action' completed." -Force
                return $snap
            }

            "TP_SERVICE_STARTUP" {
                if (-not (Test-TasksPortsElevated)) { throw "Administrator privileges are required to change service startup type." }
                $svcName = [string]($payload.serviceName ?? "").Trim()
                $mode    = [string]($payload.startupType ?? "").Trim()
                if (-not $svcName -or $mode -notin @("Automatic", "Manual", "Disabled")) {
                    throw "Valid service name and startup type (Automatic, Manual, Disabled) are required."
                }
                Set-Service -Name $svcName -StartupType $mode -ErrorAction Stop
                $snap = Get-TasksPortsSnapshot
                $snap | Add-Member -NotePropertyName "actionMessage" -NotePropertyValue "Changed startup type of '$svcName' to $mode." -Force
                return $snap
            }

            default {
                throw "Unsupported Tasks & Ports command: $cmd"
            }
        }
    } catch {
        return [PSCustomObject]@{
            type  = "TASKS_PORTS_NOTICE"
            ok    = $false
            error = $_.Exception.Message
        }
    }
}
