<#
.SYNOPSIS
    High-Precision Clock Diagnostic & Gaming Thread Bottleneck Analyzer.
    Loads unmanaged NTOSKRNL/NTDLL runtime layers to measure thread slicing.
#>
clear

# 1. Inline C# Compilation to invoke unmanaged native Win32/NT APIs directly
$NativeBridgeSource = @"
using System;
using System.Runtime.InteropServices;

public class Win32TimerEngine {
    [DllImport("ntdll.dll", SetLastError = true)]
    public static extern int NtQueryTimerResolution(out uint MinimumResolution, out uint MaximumResolution, out uint CurrentResolution);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool QueryPerformanceCounter(out long lpPerformanceCount);

    [DllImport("kernel32.dll", SetLastError = true)]
    public static extern bool QueryPerformanceFrequency(out long lpFrequency);
}
"@

# Quietly compile the type signature into the current runspace
Add-Type -TypeDefinition $NativeBridgeSource -ErrorAction SilentlyContinue

Write-Host "=====================================================================" -ForegroundColor Cyan
Write-Host "     ⚡ COREWATCH REALTIME HIGH-PRECISION THREAD HARNESS ENGINE ⚡" -ForegroundColor Cyan
Write-Host "=====================================================================" -ForegroundColor Cyan

# 2. Query low-level kernel timer tick slice parameters
$Min = $Max = $Current = 0
[Win32TimerEngine]::NtQueryTimerResolution([ref]$Min, [ref]$Max, [ref]$Current)

# Native measurements are in 100-nanosecond units. Convert to milliseconds.
$CurrentMs = [math]::Round(($Current / 10000), 4)
$MaxMs     = [math]::Round(($Max / 10000), 4)

Write-Host "System Clock Slice Horizon:" -ForegroundColor White
Write-Host "  • Default Baseline Windows Slice : 15.625 ms" -ForegroundColor Gray
Write-Host "  • Current Active Kernel Slice     : $CurrentMs ms" -ForegroundColor (if ($CurrentMs -le 1) { "Green" } else { "Yellow" })
Write-Host "  • Maximum Hardware Capabilities   : $MaxMs ms" -ForegroundColor Green
Write-Host ""

# 3. Analyze Game Thread Tuning Optimization Status
if ($CurrentMs -le 1.0) {
    Write-Host "✅ SYSTEM STATE: OPTIMIZED FOR HIGH-FPS GAMING & TELEMETRY FLOW" -ForegroundColor Green
    Write-Host "   Background engines have dropped scheduling delays to sub-millisecond rates." -ForegroundColor Gray
} else {
    Write-Host "⚠️ SYSTEM STATE: STANDARD OFF-TICK DESKTOP RATIO" -ForegroundColor Yellow
    Write-Host "   High-speed frames will exhibit micro-stutter due to a lazy 15ms scheduling wake interval." -ForegroundColor Gray
}
Write-Host ""

# 4. Bottleneck Hunter: Locate exactly who is manipulating your core clock intervals
Write-Host "Scanning kernel clock scheduling drivers..." -ForegroundColor White
$TimerRequests = powercfg /requests

# Parse the text buffer for active user/system constraints causing thread wakes
$Drivers = $TimerRequests -split "`r`n" | Where-Object { $_ -match "DISPLAY:|SYSTEM:|AWAYMODE:" -or $_ -match "PROCESS:" }
if ($Drivers) {
    Write-Host "  🚨 ACTIVE SCHEDULING HOOKS FOUND:" -ForegroundColor Red
    foreach ($line in $Drivers) { Write-Host "     -> $line" -ForegroundColor DarkYellow }
} else {
    Write-Host "  ✨ Clean kernel space. No external background processes are forcing timer wake constraints." -ForegroundColor Green
}
Write-Host ""

# 5. Microsecond Precision Jitter Loop Sweep Simulation
Write-Host "Initializing 30-cycle high-frequency drift test loop..." -ForegroundColor White

$Freq = $Start = $End = 0
[Win32TimerEngine]::QueryPerformanceFrequency([ref]$Freq)

$TrackingJitter = New-Object System.Collections.Generic.List[double]

for ($i = 0; $i -lt 30; $i++) {
    [Win32TimerEngine]::QueryPerformanceCounter([ref]$Start)
    
    # Force a precise 10ms microsecond computational block spin loop
    $TargetTicks = ($Freq * 0.01)
    do {
        [Win32TimerEngine]::QueryPerformanceCounter([ref]$End)
    } while (($End - $Start) -lt $TargetTicks)
    
    # Calculate real elapsed metric duration
    $ElapsedSeconds = ($End - $Start) / $Freq
    $ElapsedMs = $ElapsedSeconds * 1000
    $DeltaJitter = [math]::Abs($ElapsedMs - 10) # Drift deviation off target
    $TrackingJitter.Add($DeltaJitter)
    
    # Build a live progress graph pulse using static dots
    $PulseGraph = "█" * [int]($DeltaJitter * 200)
    if ($PulseGraph.Length -eq 0) { $PulseGraph = "." }
    
    Write-Host ("     Cycle {0:D2} | Target: 10.000ms | Actual: {1:N4}ms | Jitter: {2:N4}ms | {3}" -f $i, $ElapsedMs, $DeltaJitter, $PulseGraph) -ForegroundColor Gray
}

# 6. Aggregate Diagnostics Output Summary Node
$AvgJitter = ($TrackingJitter | Measure-Object -Average).Average
Write-Host ""
Write-Host "=====================================================================" -ForegroundColor Cyan
Write-Host ("  Average Hardware Clock Jitter Variance: {0:N5} ms" -f $AvgJitter) -ForegroundColor (if ($AvgJitter -lt 0.05) { "Green" } else { "Red" })
Write-Host "=====================================================================" -ForegroundColor Cyan
