<#
.SYNOPSIS
    CoreWatch Automated Game Stutter Interrupter.
    Tracks high-frequency performance counters, skips whitelisted services,
    safeguards the focused foreground window, and auto-throttles rogue threads.
#>

Clear-Host

# 1. Enforce Elevated Privileges
$Identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$Principal = New-Object Security.Principal.WindowsPrincipal($Identity)
if (-not $Principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host "❌ ERROR: Administrator privileges required!" -ForegroundColor Red
    Exit
}

# 2. C# Native API Interop Definition (Foreground Tracking)
$Win32Signatures = @"
using System;
using System.Runtime.InteropServices;

public class Win32WindowEngine {
    [DllImport("user32.dll")]
    public static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll", SetLastError = true)]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
}
"@
Add-Type -TypeDefinition $Win32Signatures -ErrorAction SilentlyContinue

# 3. Watchdog Rules and Tuning Profiles
$CpuThresholdPct  = 20.0  # Trigger action if a background process takes >20% of total CPU resources
$WatchdogInterval = 1.0   # Fast polling sweep frequency in seconds
$AutoActionTarget = "Throttle" # "Throttle" (sets priority low) or "Terminate" (kills background task)

# Immutable System Service Protection Filter Array
$SystemWhitelist = @(
    "idle", "system", "svchost", "explorer", "csrss", "wininit", "services", 
    "lsass", "smss", "winlogon", "spoolsv", "dwm", "ctfmon", "nvspcaps64",
    "powershell", "pwsh", "conhost", "taskmgr"
)

# Custom Gaming/Application Exception List
$UserCustomWhitelist = @("obs64", "discord", "spotify", "steamwebhelper")

Write-Host "=====================================================================" -ForegroundColor Green
Write-Host "     🛡️ COREWATCH INTELLIGENT ANTI-STUTTER ENFORCEMENT WATCHDOG 🛡️" -ForegroundColor Green
Write-Host "=====================================================================" -ForegroundColor Green
Write-Host "Active Tuning Rules:" -ForegroundColor White
Write-Host "  • CPU Filter Cap      : $CpuThresholdPct%" -ForegroundColor Gray
Write-Host "  • Automated Response  : $AutoActionTarget background threads" -ForegroundColor Gray
Write-Host "  • Protective Mode     : Ignoring Whitelists & Active Foreground Window" -ForegroundColor Cyan
Write-Host "Press [CTRL+C] to disconnect the engine.`n" -ForegroundColor Gray

function Get-ForegroundProcessId {
    $Hwnd = [Win32WindowEngine]::GetForegroundWindow()
    if ($Hwnd -eq [IntPtr]::Zero) { return 0 }
    $ProcessId = 0
    [void][Win32WindowEngine]::GetWindowThreadProcessId($Hwnd, [ref]$ProcessId)
    return $ProcessId
}

try {
    while ($true) {
        # Determine the current active window to avoid interrupting user focus
        $ActivePid = Get-ForegroundProcessId
        $ActiveProcessName = if ($ActivePid -gt 0) { (Get-Process -Id $ActivePid -ErrorAction SilentlyContinue).ProcessName } else { "None" }

        # Capture core allocations across all execution threads
        $ProcessSamples = Get-Process | Where-Object { $_.Id -ne $PID -and $_.CPU -gt 0 } | 
            Select-Object ProcessName, Id, CPU, @{Name="MemoryMB"; Expression={[math]::Round($_.WorkingSet64 / 1MB, 1)}}

        # Clean display trace frame update
        Write-Host ("`r[WATCHDOG: {0:HH:mm:ss}] Active Focus: {1} (PID: {2})" -f (Get-Date), $ActiveProcessName, $ActivePid) -NoNewline -ForegroundColor DarkGray

        foreach ($Proc in $ProcessSamples) {
            # Compute actual utilization load balanced over total CPU core architectures
            $CalculatedCpuLoad = [math]::Round(($Proc.CPU / [Environment]::ProcessorCount), 1)

            # Skip tracking if the item is below our stutter filter limit
            if ($CalculatedCpuLoad -le $CpuThresholdPct) { continue }

            $PName = $Proc.ProcessName.ToLower()

            # --- INTEL FILTERING CHECKS ---
            # 1. Protect the active foreground window
            if ($Proc.Id -eq $ActivePid) { continue }

            # 2. Protect critical system kernel components
            if ($SystemWhitelist -contains $PName) { continue }

            # 3. Respect user-defined software exceptions
            if ($UserCustomWhitelist -contains $PName) { continue }

            # If execution bypasses all protections, it is a rogue background thread
            Write-Host " " # Reset inline string cursor
            Write-Host ("  🚨 ROGUE SYSTEM METRIC DETECTED: [{0} (PID: {1})] running at {2}% CPU!" -f $Proc.ProcessName, $Proc.Id, $CalculatedCpuLoad) -ForegroundColor Yellow

            if ($AutoActionTarget -eq "Throttle") {
                $ProcessObject = Get-Process -Id $Proc.Id -ErrorAction SilentlyContinue
                if ($ProcessObject) {
                    $ProcessObject.PriorityClass = "Idle"
                    Write-Host ("     ⚡ AUTOMATED REACTION: Dropped '{0}' thread scheduling priority down to IDLE." -f $Proc.ProcessName) -ForegroundColor Cyan
                }
            }
            elseif ($AutoActionTarget -eq "Terminate") {
                Stop-Process -Id $Proc.Id -Force -ErrorAction SilentlyContinue
                Write-Host ("     💥 AUTOMATED REACTION: Forcibly terminated '{0}' thread boundary." -f $Proc.ProcessName) -ForegroundColor Red
            }
        }

        Start-Sleep -Seconds $WatchdogInterval
    }
}
catch {
    Write-Host "`n`n[SYSTEM: Enforcement matrix shut down cleanly.]" -ForegroundColor Gray
}
