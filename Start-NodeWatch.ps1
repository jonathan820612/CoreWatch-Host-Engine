[CmdletBinding()]
param(
    [switch]$Release,
    [switch]$DevTools,
    [switch]$ShowConsole,
    [switch]$Minimized
)

try { if ($Host.Name -eq "ConsoleHost" -and -not [Console]::IsOutputRedirected) { Clear-Host } } catch {}
$Global:NodeWatchRoot = $PSScriptRoot
$Global:EnableDevTools = if ($DevTools) { $true } elseif ($Release) { $false } else { $true }
$BinPath = Join-Path $Global:NodeWatchRoot "bin"
$CoreDll = Join-Path $BinPath "Microsoft.Web.WebView2.Core.dll"
$FormDll = Join-Path $BinPath "Microsoft.Web.WebView2.WinForms.dll"

if ((Test-Path $CoreDll) -and (Test-Path $FormDll)) {
    $null = [System.Reflection.Assembly]::LoadFrom($CoreDll)
    $null = [System.Reflection.Assembly]::LoadFrom($FormDll)
} else { 
    Write-Error "Missing critical WebView2 components in bin folder."
    return 
}

Add-Type -AssemblyName System.Windows.Forms, System.Drawing

# Enable Per-Monitor V2 DPI awareness on the pwsh.exe host process before any
# Screen/Form/WebView2 calls so WinForms, WebView2, and DEVMODE/CCD APIs share
# a single physical-pixel coordinate space across mixed-DPI monitors.
try {
    $null = [System.Windows.Forms.Application]::SetHighDpiMode([System.Windows.Forms.HighDpiMode]::PerMonitorV2)
} catch {}

if (-not ("CoreWatch.Win32" -as [type])) {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

namespace CoreWatch {
    public static class Win32 {
        public const int WM_NCLBUTTONDOWN = 0x00A1;
        public const uint SWP_NOACTIVATE  = 0x0010;
        public const uint SWP_SHOWWINDOW  = 0x0040;
        public static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);

        [DllImport("user32.dll")]
        public static extern bool ReleaseCapture();

        [DllImport("user32.dll")]
        public static extern IntPtr SendMessage(IntPtr hWnd, int Msg, IntPtr wParam, IntPtr lParam);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool SetWindowPos(IntPtr hWnd, IntPtr hWndInsertAfter, int X, int Y, int cx, int cy, uint uFlags);

        [DllImport("user32.dll")]
        public static extern uint GetDpiForSystem();

        [DllImport("user32.dll")]
        public static extern uint GetDpiForWindow(IntPtr hwnd);

        [DllImport("user32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool DestroyIcon(IntPtr hIcon);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        public static extern bool SetProcessWorkingSetSize(IntPtr hProcess, IntPtr dwMinimumWorkingSetSize, IntPtr dwMaximumWorkingSetSize);

        // [PHASE 1] Dedicated Taskbar Section (AppUserModelID) + Relaunch/Pin Metadata + Safe Standalone Console Hide
        [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern int SetCurrentProcessExplicitAppUserModelID([MarshalAs(UnmanagedType.LPWStr)] string AppID);

        [DllImport("kernel32.dll")]
        private static extern IntPtr GetConsoleWindow();

        [DllImport("kernel32.dll", SetLastError = true)]
        private static extern uint GetConsoleProcessList(uint[] lpdwProcessList, uint dwProcessCount);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

        [StructLayout(LayoutKind.Sequential, Pack = 4)]
        private struct PROPERTYKEY {
            public Guid fmtid;
            public uint pid;
        }

        [StructLayout(LayoutKind.Explicit)]
        private struct PROPVARIANT {
            [FieldOffset(0)] public ushort vt;
            [FieldOffset(8)] public IntPtr ptrVal;
        }

        [ComImport]
        [Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99")]
        [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IPropertyStore {
            int GetCount(out uint cProps);
            int GetAt(uint iProp, out PROPERTYKEY pkey);
            int GetValue(ref PROPERTYKEY key, out PROPVARIANT pv);
            int SetValue(ref PROPERTYKEY key, ref PROPVARIANT pv);
            int Commit();
        }

        [DllImport("shell32.dll")]
        private static extern int SHGetPropertyStoreForWindow(IntPtr hwnd, ref Guid iid, out IPropertyStore propertyStore);

        [DllImport("ole32.dll")]
        private static extern int PropVariantClear(ref PROPVARIANT pvar);

        private static void SetPropString(IPropertyStore store, Guid fmtid, uint pid, string value) {
            if (string.IsNullOrEmpty(value)) return;
            var key = new PROPERTYKEY { fmtid = fmtid, pid = pid };
            var pv = new PROPVARIANT { vt = 31 /* VT_LPWSTR */, ptrVal = Marshal.StringToCoTaskMemUni(value) };
            try {
                store.SetValue(ref key, ref pv);
            } finally {
                PropVariantClear(ref pv);
            }
        }

        public static bool SetWindowAppUserModelProperties(IntPtr hwnd, string appId, string displayName, string iconResource, string relaunchCmd) {
            if (hwnd == IntPtr.Zero) return false;
            try {
                Guid iid = new Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99");
                IPropertyStore store;
                if (SHGetPropertyStoreForWindow(hwnd, ref iid, out store) != 0 || store == null) return false;
                try {
                    Guid aumidFmt = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3");
                    SetPropString(store, aumidFmt, 5, appId);            // System.AppUserModel.ID
                    SetPropString(store, aumidFmt, 4, displayName);      // System.AppUserModel.RelaunchDisplayNameResource
                    SetPropString(store, aumidFmt, 3, iconResource);     // System.AppUserModel.RelaunchIconResource
                    SetPropString(store, aumidFmt, 2, relaunchCmd);      // System.AppUserModel.RelaunchCommand
                    store.Commit();
                    return true;
                } finally {
                    Marshal.ReleaseComObject(store);
                }
            } catch {
                return false;
            }
        }

        public static bool HideStandaloneConsole() {
            try {
                IntPtr hCon = GetConsoleWindow();
                if (hCon == IntPtr.Zero) return false;
                uint[] pids = new uint[4];
                uint count = GetConsoleProcessList(pids, (uint)pids.Length);
                if (count <= 1) {
                    ShowWindow(hCon, 0); // SW_HIDE only when PowerShell owns this console exclusively
                    return true;
                }
            } catch { }
            return false;
        }

        public static void TrimWorkingSet() {
            try {
                GC.Collect(1, GCCollectionMode.Optimized, false);
                SetProcessWorkingSetSize(System.Diagnostics.Process.GetCurrentProcess().Handle, (IntPtr)(-1), (IntPtr)(-1));
            } catch { }
        }
    }
}
"@ -ErrorAction SilentlyContinue
}

# Assign CoreWatch its own Windows Taskbar AppUserModelID BEFORE creating any Form/Window
$Global:CoreWatchAppUserModelId = "CoreWatch.HostEngine.Dashboard"
try { $null = [CoreWatch.Win32]::SetCurrentProcessExplicitAppUserModelID($Global:CoreWatchAppUserModelId) } catch {}
if (-not $ShowConsole) {
    try { $null = [CoreWatch.Win32]::HideStandaloneConsole() } catch {}
}

if (-not ("CoreWatch.IdentifyOverlayForm" -as [type])) {
    $overlayRefs = @(
        [System.Windows.Forms.Form].Assembly.Location,
        [System.Drawing.Point].Assembly.Location,
        [System.ComponentModel.Component].Assembly.Location
    ) | Where-Object { $_ } | Select-Object -Unique
    Add-Type -ReferencedAssemblies $overlayRefs -TypeDefinition @"
using System.Windows.Forms;

namespace CoreWatch {
    public class IdentifyOverlayForm : Form {
        private const int WS_EX_TRANSPARENT = 0x00000020;
        private const int WS_EX_TOOLWINDOW  = 0x00000080;
        private const int WS_EX_NOACTIVATE  = 0x08000000;

        protected override bool ShowWithoutActivation {
            get { return true; }
        }

        protected override CreateParams CreateParams {
            get {
                CreateParams cp = base.CreateParams;
                cp.ExStyle |= WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE;
                return cp;
            }
        }
    }
}
"@ -ErrorAction SilentlyContinue
}
$AppDataRoot = Join-Path $env:LOCALAPPDATA "CoreWatch"
$UserDataFolder = [System.IO.Path]::GetFullPath((Join-Path $AppDataRoot "WebView2UserData"))
if (-not (Test-Path $UserDataFolder)) { $null = New-Item -ItemType Directory -Path $UserDataFolder -Force }
$env:WEBVIEW2_USER_DATA_FOLDER = $UserDataFolder

# [PHASE 1] Persistent UI & Window Preferences File (%LOCALAPPDATA%\CoreWatch\ui-settings.json)
$Global:UiSettingsPath = Join-Path $AppDataRoot "ui-settings.json"

function Get-CoreWatchUiSettings {
    if (Test-Path -LiteralPath $Global:UiSettingsPath -ErrorAction SilentlyContinue) {
        try {
            $raw = Get-Content -LiteralPath $Global:UiSettingsPath -Raw -ErrorAction Stop
            if ($raw -and $raw.Trim()) {
                return ($raw | ConvertFrom-Json -AsHashtable)
            }
        } catch {}
    }
    return @{}
}

function Save-CoreWatchUiSettings {
    param([hashtable]$Settings)
    try {
        $json = $Settings | ConvertTo-Json -Depth 8
        [System.IO.File]::WriteAllText($Global:UiSettingsPath, $json, (New-Object System.Text.UTF8Encoding($false)))
    } catch {}
}

function Initialize-CoreWatchMultiSizeIco {
    param(
        [string]$SourcePngPath,
        [string]$DestIcoPath
    )
    if (-not (Test-Path -LiteralPath $SourcePngPath)) { return $false }
    try {
        if ((Test-Path -LiteralPath $DestIcoPath) -and ((Get-Item -LiteralPath $DestIcoPath).LastWriteTimeUtc -ge (Get-Item -LiteralPath $SourcePngPath).LastWriteTimeUtc)) {
            return $true
        }
        $sizes = @(16, 32, 48, 256)
        $srcImg = [System.Drawing.Image]::FromFile($SourcePngPath)
        $frames = [System.Collections.Generic.List[byte[]]]::new()
        try {
            foreach ($sz in $sizes) {
                $bmp = New-Object System.Drawing.Bitmap($sz, $sz, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
                $g = [System.Drawing.Graphics]::FromImage($bmp)
                try {
                    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
                    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                    $g.Clear([System.Drawing.Color]::Transparent)
                    $g.DrawImage($srcImg, 0, 0, $sz, $sz)
                } finally {
                    $g.Dispose()
                }
                $ms = New-Object System.IO.MemoryStream
                try {
                    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
                    $frames.Add($ms.ToArray())
                } finally {
                    $ms.Dispose()
                    $bmp.Dispose()
                }
            }
        } finally {
            $srcImg.Dispose()
        }

        $fs = [System.IO.File]::Create($DestIcoPath)
        $bw = New-Object System.IO.BinaryWriter($fs)
        try {
            # ICONDIR header (6 bytes)
            $bw.Write([uint16]0)
            $bw.Write([uint16]1)
            $bw.Write([uint16]$sizes.Count)

            $offset = 6 + (16 * $sizes.Count)
            for ($i = 0; $i -lt $sizes.Count; $i++) {
                $dimByte = if ($sizes[$i] -ge 256) { [byte]0 } else { [byte]$sizes[$i] }
                $bw.Write($dimByte)              # width
                $bw.Write($dimByte)              # height
                $bw.Write([byte]0)               # color palette
                $bw.Write([byte]0)               # reserved
                $bw.Write([uint16]1)             # planes
                $bw.Write([uint16]32)            # bpp
                $bw.Write([uint32]$frames[$i].Length)
                $bw.Write([uint32]$offset)
                $offset += $frames[$i].Length
            }
            foreach ($frameBytes in $frames) {
                $bw.Write($frameBytes)
            }
        } finally {
            $bw.Dispose()
            $fs.Dispose()
        }
        return (Test-Path -LiteralPath $DestIcoPath)
    } catch {
        return $false
    }
}

$Global:SavedUiSettings = Get-CoreWatchUiSettings

# [CORE SETTINGS & MODULAR REGISTRY ENGINE]
$CoreSettingsScript = Join-Path $Global:NodeWatchRoot "modules\core\CoreWatchSettings.ps1"
if (Test-Path -LiteralPath $CoreSettingsScript -PathType Leaf) {
    . $CoreSettingsScript
}
$Global:AppSettings  = Get-CoreWatchAppSettings
$Global:ModulesState = Get-CoreWatchModulesState -RootPath $Global:NodeWatchRoot -Settings $Global:AppSettings
$Global:VersionInfo  = Get-CoreWatchVersionInfo -RootPath $Global:NodeWatchRoot
$Global:ForceExitApp     = $false
$Global:MainFormHasShown = $false
$Global:KeepAwakeActive  = $false
$Global:WindowLockMode   = "none" # none | position | all

$ProfilesScriptPath = Join-Path $Global:NodeWatchRoot "modules\tabs\ProfilesManager.ps1"
$Global:ProfilesModuleAvailable = Test-Path -LiteralPath $ProfilesScriptPath -PathType Leaf
if ($Global:ProfilesModuleAvailable) {
    try { . $ProfilesScriptPath } catch { $Global:ProfilesModuleAvailable = $false }
}

$initCadence = Get-CoreWatchTelemetryCadence -Profile $Global:AppSettings.telemetry.pollingProfile

$global:SharedData = [hashtable]::Synchronized(@{
    FullPayload    = $null
    FullVersion    = 0
    FastPayload    = $null
    FastVersion    = 0
    ForceRefresh   = $false
    ActiveView     = "dashboard"
    SideDockOpen   = $false
    IsMinimized    = $false
    IsRunning      = $true
    PollingProfile = [string]$Global:AppSettings.telemetry.pollingProfile
    FastCadenceMs  = [int]$initCadence.fastMs
    FullDashMs     = [int]$initCadence.fullDashMs
    FullBgMs       = [int]$initCadence.fullBgMs
})

# =========================================================================
# UNIFIED TIERED TELEMETRY PIPELINE (SINGLE RUNSPACE - CUTS CPU/RAM ~50%+)
#   - Dashboard active: 500ms fast counters, 2000ms full mesh
#   - Other tab active: fast loop paused, 4000ms full mesh (for Defender sync)
#   - Minimized:        polling paused until restored (immediate wakeup)
# =========================================================================
$RunspaceScript = {
    param($RootPath, $SharedData)
    $TelemetryPath = Join-Path $RootPath "modules\telemetry"
    . (Join-Path $TelemetryPath "GetIDMetrics.ps1")
    . (Join-Path $TelemetryPath "GetInfraMetrics.ps1")
    . (Join-Path $TelemetryPath "GetNetworkMetrics.ps1")
    . (Join-Path $TelemetryPath "GetTrafficMetrics.ps1")
    . (Join-Path $TelemetryPath "GetSystemMetrics.ps1")
    . (Join-Path $TelemetryPath "StorageEngine.ps1")

    Initialize-StaticSystemCache
    # Prime performance counters once so first pushed frame is immediately accurate
    $null = Get-FastHardwareMetrics
    $null = Get-TrafficMetrics

    $lastFullSample = [datetime]::MinValue
    $lastGcTrim     = [datetime]::Now

    while ($SharedData.IsRunning) {
        # When minimized, pause polling completely and wake immediately when restored
        if ($SharedData.IsMinimized -and -not $SharedData.ForceRefresh) {
            [System.Threading.Thread]::Sleep(250)
            continue
        }

        $sw = [System.Diagnostics.Stopwatch]::StartNew()
        $onDashboard = ($SharedData.ActiveView -eq "dashboard") -or [bool]$SharedData.SideDockOpen
        $forceNow    = [bool]$SharedData.ForceRefresh

        try {
            if ($forceNow) {
                $SharedData.ForceRefresh = $false
                if (Get-Command Reset-NetworkMetricsCache -ErrorAction SilentlyContinue) { Reset-NetworkMetricsCache }
                if (Get-Command Reset-SystemMetricsCache -ErrorAction SilentlyContinue)  { Reset-SystemMetricsCache }
                if (Get-Command Reset-InfraMetricsCache -ErrorAction SilentlyContinue)   { Reset-InfraMetricsCache }
            }

            $FastHw  = $null
            $FastNet = $null

            # Fast 0.5s frame runs only while Dashboard is visible (or on forced/initial refresh)
            if ($onDashboard -or $forceNow -or $SharedData.FullVersion -eq 0) {
                $FastHw  = Get-FastHardwareMetrics
                $FastNet = Get-TrafficMetrics

                $FastObject = [PSCustomObject]@{
                    type            = "FAST_TELEMETRY"
                    SystemFrame     = $FastHw
                    NetworkActivity = $FastNet
                }
                $SharedData.FastPayload = $FastObject | ConvertTo-Json -Compress -Depth 4
                $SharedData.FastVersion++
            }

            $fullDashMs = if ($SharedData.FullDashMs -ge 500) { [int]$SharedData.FullDashMs } else { 2000 }
            $fullBgMs   = if ($SharedData.FullBgMs -ge 1000)  { [int]$SharedData.FullBgMs }   else { 4000 }
            $fullIntervalMs = if ($onDashboard) { $fullDashMs } else { $fullBgMs }
            $elapsedSinceFull = ([datetime]::Now - $lastFullSample).TotalMilliseconds

            if ($forceNow -or $elapsedSinceFull -ge $fullIntervalMs) {
                if ($null -eq $FastHw)  { $FastHw  = Get-FastHardwareMetrics }
                if ($null -eq $FastNet) { $FastNet = Get-TrafficMetrics }

                function _nz($v, $d) { if ($null -ne $v) { $v } else { $d } }

                $StaticNet   = Get-NetworkMetrics
                $SystemFrame = Get-SystemMetrics -PrecomputedFast $FastHw

                $MergedNetworkFrame = [PSCustomObject]@{
                    IntIPv4          = [string](_nz $StaticNet.IntIPv4 "0.0.0.0")
                    SubnetMask       = [string](_nz $StaticNet.SubnetMask "0.0.0.0")
                    Gateway          = [string](_nz $StaticNet.Gateway "N/A")
                    DnsServers       = [string](_nz $StaticNet.DnsServers "Auto / None")
                    DnsStatus        = [string](_nz $StaticNet.DnsStatus "Checking")
                    DnsStatusText    = [string](_nz $StaticNet.DnsStatusText "Checking...")
                    ArpStatus        = [string](_nz $StaticNet.ArpStatus "Unresolved")
                    GatewayMac       = [string](_nz $StaticNet.GatewayMac "N/A")
                    ArpDetail        = [string](_nz $StaticNet.ArpDetail "")
                    NetworkStatus    = [string](_nz $StaticNet.NetworkStatus "Offline")
                    WlanSsid         = [string](_nz $StaticNet.WlanSsid "None")
                    ExtIPv4          = [string](_nz $StaticNet.ExtIPv4 "Resolving...")
                    LinkCap          = [string](_nz $StaticNet.LinkCap "0 Mbps")
                    Firewall         = [string](_nz $StaticNet.Firewall "Unknown")
                    Realtime         = [string](_nz $StaticNet.Realtime "Unknown")
                    TamperProtection = [string](_nz $StaticNet.TamperProtection "Unknown")
                    BehaviorMonitor  = [string](_nz $StaticNet.BehaviorMonitor "Unknown")
                    CloudProtection  = [string](_nz $StaticNet.CloudProtection "Unknown")
                    IoavProtection   = [string](_nz $StaticNet.IoavProtection "Unknown")
                    Discovery        = [string](_nz $StaticNet.Discovery "Off")
                    Sharing          = [string](_nz $StaticNet.Sharing "Off")
                    lblEthDriver     = [string](_nz $StaticNet.lblEthDriver "Unknown")
                    lblWifiDriver    = [string](_nz $StaticNet.lblWifiDriver "Unknown")
                    NetAssignment    = [string](_nz $StaticNet.NetAssignment "DHCP")
                    AdapterStatuses  = @($StaticNet.AdapterStatuses)
                    RxPct            = [int](_nz $FastNet.RxPct 0)
                    TxPct            = [int](_nz $FastNet.TxPct 0)
                    RxText           = [string](_nz $FastNet.RxText "0.00 KB/s")
                    TxText           = [string](_nz $FastNet.TxText "0.00 KB/s")
                }

                $MasterObject = [PSCustomObject]@{
                    IdentityFrame  = Get-IDMetrics
                    InfraFrame     = Get-InfraMetrics
                    NetworkFrame   = $MergedNetworkFrame
                    SystemFrame    = $SystemFrame
                    StorageFrame   = Get-StorageMetrics
                    PipelineStatus = "SUCCESS"
                }
                $SharedData.FullPayload = $MasterObject | ConvertTo-Json -Compress -Depth 5
                $SharedData.FullVersion++
                $lastFullSample = [datetime]::Now
            }

            # Lightweight periodic GC + working-set trim every 60 seconds to prevent PowerShell Gen2 RAM creep
            if (([datetime]::Now - $lastGcTrim).TotalSeconds -ge 60) {
                $lastGcTrim = [datetime]::Now
                if ("CoreWatch.Win32" -as [type]) { [CoreWatch.Win32]::TrimWorkingSet() }
            }
        } catch {
            $SharedData.FullPayload = @{ PipelineStatus = "LOOP_CRASH: $($_.Exception.Message)" } | ConvertTo-Json -Compress
            $SharedData.FullVersion++
        }

        $fastBaseMs = if ($SharedData.FastCadenceMs -ge 200) { [int]$SharedData.FastCadenceMs } else { 500 }
        $targetCadence = if ($onDashboard) { $fastBaseMs } else { [int][math]::Max(1000, $fastBaseMs * 2) }
        $sleepMs = [int][math]::Max(80, $targetCadence - $sw.ElapsedMilliseconds)
        $slept = 0
        while ($slept -lt $sleepMs -and $SharedData.IsRunning -and -not $SharedData.ForceRefresh) {
            $chunk = [int][math]::Min(100, $sleepMs - $slept)
            [System.Threading.Thread]::Sleep($chunk)
            $slept += $chunk
        }
    }
}

$Runspace = [runspacefactory]::CreateRunspace()
$Runspace.ApartmentState = "STA"
$Runspace.ThreadOptions = "ReuseThread"
$Runspace.Open()

$PowerShellPool = [powershell]::Create()
$PowerShellPool.Runspace = $Runspace
$null = $PowerShellPool.AddScript($RunspaceScript).AddArgument($Global:NodeWatchRoot).AddArgument($global:SharedData)
$null = $PowerShellPool.BeginInvoke()

# =========================================================================
# CORE WINDOW FORM CONSTRUCTOR (PER-MONITOR V2 DPI-AWARE SIZING)
# =========================================================================
$script:BaseMaxWindowWidth  = 2160
$script:BaseMaxWindowHeight = 3840
$script:BaseMinWindowWidth  = 640
$script:BaseMinWindowHeight = 720
$script:BaseInitWidth       = 1080
$script:BaseInitHeight      = 1920

$primaryDpi = 96.0
try {
    $sysDpi = [CoreWatch.Win32]::GetDpiForSystem()
    if ($sysDpi -ge 96) { $primaryDpi = [double]$sysDpi }
} catch {}
$primaryScale = [Math]::Max(1.0, $primaryDpi / 96.0)

$ScreenWorkArea = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea
$script:MinWindowWidth  = [Math]::Min([int][Math]::Round($script:BaseMinWindowWidth  * $primaryScale), $ScreenWorkArea.Width)
$script:MinWindowHeight = [Math]::Min([int][Math]::Round($script:BaseMinWindowHeight * $primaryScale), $ScreenWorkArea.Height)
$script:MaxWindowWidth  = [Math]::Max([int][Math]::Round($script:BaseMaxWindowWidth  * $primaryScale), $ScreenWorkArea.Width)
$script:MaxWindowHeight = [Math]::Max([int][Math]::Round($script:BaseMaxWindowHeight * $primaryScale), $ScreenWorkArea.Height)
$InitWidth  = [Math]::Max($script:MinWindowWidth,  [Math]::Min([int][Math]::Round($script:BaseInitWidth  * $primaryScale), $ScreenWorkArea.Width))
$InitHeight = [Math]::Max($script:MinWindowHeight, [Math]::Min([int][Math]::Round($script:BaseInitHeight * $primaryScale), $ScreenWorkArea.Height))

$MainForm = New-Object System.Windows.Forms.Form
$MainForm.Text = "CoreWatch"
$MainForm.MinimumSize = New-Object System.Drawing.Size($script:MinWindowWidth, $script:MinWindowHeight)
$MainForm.MaximumSize = New-Object System.Drawing.Size($script:MaxWindowWidth, $script:MaxWindowHeight)
$MainForm.Size = New-Object System.Drawing.Size($InitWidth, $InitHeight)
$MainForm.StartPosition = "CenterScreen"
$MainForm.BackColor = [System.Drawing.Color]::FromArgb(26, 32, 44)
$MainForm.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None

# [PHASE 1] Restore saved Window Bounds, Always-on-Top & Opacity safely within visible screens
try {
    if ($Global:SavedUiSettings -is [hashtable]) {
        if ($Global:SavedUiSettings.ContainsKey("alwaysOnTop")) {
            $MainForm.TopMost = [bool]$Global:SavedUiSettings["alwaysOnTop"]
        }
        if ($Global:SavedUiSettings.ContainsKey("opacity")) {
            $opVal = [double]$Global:SavedUiSettings["opacity"]
            if ($opVal -ge 0.70 -and $opVal -le 1.0) { $MainForm.Opacity = $opVal }
        }
        if ($Global:SavedUiSettings.ContainsKey("windowLockMode")) {
            $lm = ([string]$Global:SavedUiSettings["windowLockMode"]).ToLowerInvariant()
            if ($lm -in @("none", "position", "all")) { $Global:WindowLockMode = $lm }
        }
        $wb = $Global:SavedUiSettings["windowBounds"]
        if ($wb -is [hashtable] -and $wb["width"] -and $wb["height"]) {
            $rx = [int]$wb["x"]; $ry = [int]$wb["y"]
            $rw = [Math]::Max($script:MinWindowWidth,  [Math]::Min($script:MaxWindowWidth,  [int]$wb["width"]))
            $rh = [Math]::Max($script:MinWindowHeight, [Math]::Min($script:MaxWindowHeight, [int]$wb["height"]))
            $rect = New-Object System.Drawing.Rectangle($rx, $ry, $rw, $rh)
            $visibleOnAny = $false
            foreach ($scr in [System.Windows.Forms.Screen]::AllScreens) {
                if ($scr.WorkingArea.IntersectsWith($rect)) { $visibleOnAny = $true; break }
            }
            if ($visibleOnAny) {
                $MainForm.StartPosition = "Manual"
                $MainForm.Location = New-Object System.Drawing.Point($rx, $ry)
                $MainForm.Size     = New-Object System.Drawing.Size($rw, $rh)
            }
        }
    }
} catch {}

$MainForm.Add_DpiChanged({
    param($evtSource, $evtArgs)
    try {
        $newScale = [Math]::Max(1.0, ([double]$evtArgs.DeviceDpiNew / 96.0))
        $curWork  = [System.Windows.Forms.Screen]::FromControl($MainForm).WorkingArea
        $script:MinWindowWidth  = [Math]::Min([int][Math]::Round($script:BaseMinWindowWidth  * $newScale), $curWork.Width)
        $script:MinWindowHeight = [Math]::Min([int][Math]::Round($script:BaseMinWindowHeight * $newScale), $curWork.Height)
        $script:MaxWindowWidth  = [Math]::Max([int][Math]::Round($script:BaseMaxWindowWidth  * $newScale), $curWork.Width)
        $script:MaxWindowHeight = [Math]::Max([int][Math]::Round($script:BaseMaxWindowHeight * $newScale), $curWork.Height)
        $MainForm.MinimumSize = New-Object System.Drawing.Size($script:MinWindowWidth, $script:MinWindowHeight)
        $MainForm.MaximumSize = New-Object System.Drawing.Size($script:MaxWindowWidth, $script:MaxWindowHeight)
        if ($MainForm.WindowState -eq [System.Windows.Forms.FormWindowState]::Normal) {
            $clampedW = [Math]::Min($MainForm.Width,  $curWork.Width)
            $clampedH = [Math]::Min($MainForm.Height, $curWork.Height)
            if ($clampedW -ne $MainForm.Width -or $clampedH -ne $MainForm.Height) {
                $MainForm.Size = New-Object System.Drawing.Size($clampedW, $clampedH)
            }
        }
    } catch {}
})

$IconPath = Join-Path $Global:NodeWatchRoot "Images\Icon.png"
$CoreWatchIcoPath = Join-Path $AppDataRoot "CoreWatch.ico"
$IconHandle = $null
$AppIconInstance = $null
$TrayIconInstance = $null
if (Test-Path $IconPath) {
    try {
        if (Initialize-CoreWatchMultiSizeIco -SourcePngPath $IconPath -DestIcoPath $CoreWatchIcoPath) {
            $AppIconInstance = New-Object System.Drawing.Icon($CoreWatchIcoPath)
        } else {
            $IconBitmap = New-Object System.Drawing.Bitmap($IconPath)
            $IconHandle = $IconBitmap.GetHicon()
            $AppIconInstance = [System.Drawing.Icon]::FromHandle($IconHandle)
        }
        $MainForm.Icon = $AppIconInstance
        $MainForm.ShowIcon = $true
        $TrayIconSize = [System.Windows.Forms.SystemInformation]::SmallIconSize
        $TrayIconInstance = New-Object System.Drawing.Icon($AppIconInstance, $TrayIconSize.Width, $TrayIconSize.Height)
    } catch { Write-Warning "Failed to pack runtime scaling icon assets." }
}

# Apply per-window AppUserModel properties once the native HWND exists so Windows separates
# CoreWatch from PowerShell consoles and supports right-click "Pin to Taskbar" with custom icon.
$MainForm.Add_Shown({
    $Global:MainFormHasShown = $true
    try {
        $launchSpec = Get-CoreWatchLaunchSpec -RootPath $Global:NodeWatchRoot -Minimized $false
        $relaunchCmd = $launchSpec.command
        $iconRes = if (Test-Path -LiteralPath $CoreWatchIcoPath) { "$CoreWatchIcoPath,0" } else { "" }
        $null = [CoreWatch.Win32]::SetWindowAppUserModelProperties($MainForm.Handle, $Global:CoreWatchAppUserModelId, "CoreWatch", $iconRes, $relaunchCmd)
    } catch {}
    if ($Minimized -or ($Global:AppSettings -and $Global:AppSettings.general.startMinimized)) {
        $MainForm.WindowState = [System.Windows.Forms.FormWindowState]::Minimized
        $MainForm.ShowInTaskbar = $false
        $MainForm.Hide()
    }
    Sync-CoreWatchVisibilityState
})

$global:IsFormDragging = $false
$global:FormDragCursorOffset = [System.Drawing.Point]::Empty
$MainForm.Add_MouseDown({
    param($evtSource, $evtArgs)
    if ($Global:WindowLockMode -ne "none") { return }
    if ($evtArgs.Button -eq [System.Windows.Forms.MouseButtons]::Left -and $evtArgs.Y -le 50) {
        $global:IsFormDragging = $true
        $global:FormDragCursorOffset = New-Object System.Drawing.Point($evtArgs.X, $evtArgs.Y)
    }
})
$MainForm.Add_MouseMove({
    param($evtSource, $evtArgs)
    if ($global:IsFormDragging -and $Global:WindowLockMode -eq "none") {
        $ScreenMousePos = [System.Windows.Forms.Cursor]::Position
        $MainForm.Location = New-Object System.Drawing.Point(($ScreenMousePos.X - $global:FormDragCursorOffset.X), ($ScreenMousePos.Y - $global:FormDragCursorOffset.Y))
    }
})
$MainForm.Add_MouseUp({ $global:IsFormDragging = $false })

$global:WebViewControl = New-Object Microsoft.Web.WebView2.WinForms.WebView2
$global:WebViewControl.Dock = "Fill"
$MainForm.Controls.Add($global:WebViewControl)

$global:LastSentFullVersion = -1
$global:LastSentFastVersion = -1

$global:FlushTelemetryToUi = {
    if ($null -eq $global:WebViewControl.CoreWebView2) { return }
    try {
        if ($null -ne $global:SharedData.FullPayload -and $global:SharedData.FullVersion -ne $global:LastSentFullVersion) {
            $global:LastSentFullVersion = $global:SharedData.FullVersion
            $Bytes = [System.Text.Encoding]::UTF8.GetBytes($global:SharedData.FullPayload)
            $global:WebViewControl.CoreWebView2.PostWebMessageAsString([Convert]::ToBase64String($Bytes))
        }
        if ($null -ne $global:SharedData.FastPayload -and $global:SharedData.FastVersion -ne $global:LastSentFastVersion) {
            $global:LastSentFastVersion = $global:SharedData.FastVersion
            $FastBytes = [System.Text.Encoding]::UTF8.GetBytes($global:SharedData.FastPayload)
            $global:WebViewControl.CoreWebView2.PostWebMessageAsString([Convert]::ToBase64String($FastBytes))
        }
    } catch {}
}

$global:TelemetryLoopTimer = New-Object System.Windows.Forms.Timer
$global:TelemetryLoopTimer.Interval = [int]$initCadence.uiTimerMs
$global:TelemetryLoopTimer.Add_Tick($global:FlushTelemetryToUi)

function Send-CoreWatchMessageToUi {
    param([Parameter(Mandatory)]$PayloadObj)
    if ($null -eq $global:WebViewControl -or $null -eq $global:WebViewControl.CoreWebView2) { return }
    try {
        $json = $PayloadObj | ConvertTo-Json -Compress -Depth 10
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
        $global:WebViewControl.CoreWebView2.PostWebMessageAsString([Convert]::ToBase64String($bytes))
    } catch {}
}

function Send-AppSettingsStateToUi {
    param(
        [string]$Notice = "",
        [bool]$NoticeError = $false
    )
    $Global:ModulesState = Get-CoreWatchModulesState -RootPath $Global:NodeWatchRoot -Settings $Global:AppSettings
    $autoInfo = Get-CoreWatchAutoStartStatus
    $Global:AppSettings.general.startWithWindows = [bool]$autoInfo.enabled
    Send-CoreWatchMessageToUi -PayloadObj @{
        type         = "APP_SETTINGS_STATE"
        settings     = $Global:AppSettings
        autoStart    = $autoInfo
        modulesState = $Global:ModulesState
        versionInfo  = $Global:VersionInfo
        notice       = $Notice
        noticeError  = $NoticeError
    }
}

function Sync-CoreWatchKeepAwake {
    param([bool]$Enable)
    $Global:KeepAwakeActive = [bool]$Enable
    if ("CoreWatch.ProfileNative" -as [type]) {
        try { $null = [CoreWatch.ProfileNative]::SetKeepAwake([bool]$Enable) } catch {}
    }
}

function Update-TrayProfilesSubmenu {
    if ($null -eq $global:TrayModesSubMenu -or -not $Global:ProfilesModuleAvailable) { return }
    try {
        $store = Get-CoreWatchProfilesStore
        $activeId = [string]$store["activeProfileId"]
        $global:TrayModesSubMenu.DropDownItems.Clear()
        foreach ($p in @($store["profiles"])) {
            $profId = [string]$p["id"]
            $label = "$($p['icon']) $($p['name'])"
            $mi = New-Object System.Windows.Forms.ToolStripMenuItem($label)
            $mi.Checked = ($profId -eq $activeId)
            $mi.Tag = $profId
            $mi.Add_Click({
                param($s, $e)
                try {
                    $tid = [string]$s.Tag
                    $res = Invoke-ApplySystemProfile -ProfileId $tid -RootPath $Global:NodeWatchRoot -CurrentKeepAwake $Global:KeepAwakeActive
                    Sync-CoreWatchKeepAwake -Enable ([bool]$res.keepAwakeActive)
                    $global:SharedData.ForceRefresh = $true
                    Update-TrayProfilesSubmenu
                    Send-ProfilesStateToUi -Notice $res.notice
                } catch {}
            })
            $null = $global:TrayModesSubMenu.DropDownItems.Add($mi)
        }
        if ($null -ne $store["baselineSnapshot"]) {
            $null = $global:TrayModesSubMenu.DropDownItems.Add((New-Object System.Windows.Forms.ToolStripSeparator))
            $revItem = New-Object System.Windows.Forms.ToolStripMenuItem("Revert to Baseline")
            $revItem.Add_Click({
                try {
                    $res = Invoke-RevertSystemProfileBaseline -RootPath $Global:NodeWatchRoot -CurrentKeepAwake $Global:KeepAwakeActive
                    Sync-CoreWatchKeepAwake -Enable ([bool]$res.keepAwakeActive)
                    $global:SharedData.ForceRefresh = $true
                    Update-TrayProfilesSubmenu
                    Send-ProfilesStateToUi -Notice $res.notice
                } catch {}
            })
            $null = $global:TrayModesSubMenu.DropDownItems.Add($revItem)
        }
    } catch {}
}

function Send-ProfilesStateToUi {
    param(
        [string]$Notice = "",
        [bool]$NoticeError = $false
    )
    if (-not $Global:ProfilesModuleAvailable) { return }
    try {
        $state = Get-ProfilesManagerState -RootPath $Global:NodeWatchRoot -KeepAwakeActive $Global:KeepAwakeActive -Notice $Notice -NoticeError $NoticeError
        Send-CoreWatchMessageToUi -PayloadObj $state
    } catch {
        Send-CoreWatchMessageToUi -PayloadObj @{ type = "PROFILES_NOTICE"; ok = $false; error = $_.Exception.Message; message = $_.Exception.Message }
    }
}

function Restore-CoreWatchMainWindow {
    if (-not $MainForm.Visible) { $MainForm.Show() }
    $MainForm.ShowInTaskbar = $true
    if ($MainForm.WindowState -eq [System.Windows.Forms.FormWindowState]::Minimized) {
        $MainForm.WindowState = [System.Windows.Forms.FormWindowState]::Normal
    }
    $MainForm.Activate()
    $global:SharedData.IsMinimized = $false
    $global:SharedData.ForceRefresh = $true
    if ($null -ne $global:TelemetryLoopTimer -and -not $global:TelemetryLoopTimer.Enabled) {
        $global:TelemetryLoopTimer.Start()
    }
    & $global:FlushTelemetryToUi
}

$global:ActiveTabTasks = New-Object System.Collections.ArrayList

function Start-AsyncTabTask {
    param(
        [Parameter(Mandatory)][scriptblock]$ScriptBlock,
        [object[]]$Arguments = @(),
        [string]$FallbackType = "TAB_ERROR"
    )
    $ps = [powershell]::Create()
    $null = $ps.AddScript($ScriptBlock)
    foreach ($arg in $Arguments) {
        $null = $ps.AddArgument($arg)
    }
    $handle = $ps.BeginInvoke()

    $timer = New-Object System.Windows.Forms.Timer
    $timer.Interval = 120
    $taskObj = [PSCustomObject]@{
        PS           = $ps
        Handle       = $handle
        Timer        = $timer
        FallbackType = $FallbackType
    }
    $null = $global:ActiveTabTasks.Add($taskObj)

    $timer.Tag = $taskObj
    $timer.Add_Tick({
        param($timerSender, $e)
        $t = $timerSender.Tag
        if ($null -ne $t -and $null -ne $t.Handle -and $t.Handle.IsCompleted) {
            $timerSender.Stop()
            try {
                $output = $t.PS.EndInvoke($t.Handle)
                $json = [string]($output | Select-Object -Last 1)
                if ($json -and $null -ne $global:WebViewControl.CoreWebView2) {
                    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
                    $global:WebViewControl.CoreWebView2.PostWebMessageAsString([Convert]::ToBase64String($bytes))
                }
            } catch {
                $errJson = @{ type = $t.FallbackType; error = $_.Exception.Message } | ConvertTo-Json -Compress
                if ($null -ne $global:WebViewControl.CoreWebView2) {
                    $bytes = [System.Text.Encoding]::UTF8.GetBytes($errJson)
                    $global:WebViewControl.CoreWebView2.PostWebMessageAsString([Convert]::ToBase64String($bytes))
                }
            } finally {
                try { $t.PS.Dispose() } catch {}
                try { $timerSender.Dispose() } catch {}
                $null = $global:ActiveTabTasks.Remove($t)
            }
        }
    })
    $timer.Start()
}

# =========================================================================
# UNIFIED HOST UI MESSAGE DESERIALIZATION & COMMAND HANDLER LOOP
# =========================================================================
$HandleUiMessageEvent = {
    param($evtSource, $evtArgs)
    $RawMessage = $evtArgs.TryGetWebMessageAsString()
    if ($null -eq $RawMessage) { return }
    
    switch -regex ($RawMessage) {
        '^Exit-App$' {
            if ($Global:AppSettings -and $Global:AppSettings.general.minimizeToTrayOnClose) {
                $MainForm.WindowState = [System.Windows.Forms.FormWindowState]::Minimized
                $MainForm.ShowInTaskbar = $false
                $MainForm.Hide()
            } else {
                $Global:ForceExitApp = $true
                $MainForm.Close()
            }
        }
        '^Force-Exit-App$' {
            $Global:ForceExitApp = $true
            $MainForm.Close()
        }
        '^Minimize-App$'  { $MainForm.WindowState = [System.Windows.Forms.FormWindowState]::Minimized }
        '^Maximize-App$'  {
            if ($Global:WindowLockMode -ne "none") { return }
            $MainForm.WindowState = if ($MainForm.WindowState -eq [System.Windows.Forms.FormWindowState]::Maximized) { [System.Windows.Forms.FormWindowState]::Normal } else { [System.Windows.Forms.FormWindowState]::Maximized }
        }
        
        '^\s*UI-Ready\s*$' {
            if ($MainForm.Visible -and $MainForm.WindowState -ne [System.Windows.Forms.FormWindowState]::Minimized) {
                $global:SharedData.IsMinimized = $false
                $global:SharedData.ForceRefresh = $true
            }
            if (-not $global:TelemetryLoopTimer.Enabled) { $global:TelemetryLoopTimer.Start() }
            # Push persisted UI layout & window state immediately on load
            try {
                $uiPayload = @{
                    type           = "UI_SETTINGS_STATE"
                    alwaysOnTop    = [bool]$MainForm.TopMost
                    opacity        = [math]::Round([double]$MainForm.Opacity, 2)
                    windowLockMode = [string]$Global:WindowLockMode
                    layout         = if ($Global:SavedUiSettings -is [hashtable] -and $Global:SavedUiSettings.ContainsKey("layout")) { $Global:SavedUiSettings["layout"] } else { $null }
                    diagxDismissed = if ($Global:SavedUiSettings -is [hashtable] -and $Global:SavedUiSettings.ContainsKey("diagxDismissed")) { $Global:SavedUiSettings["diagxDismissed"] } else { $null }
                } | ConvertTo-Json -Compress -Depth 8
                $global:WebViewControl.CoreWebView2.PostWebMessageAsString([Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($uiPayload)))
            } catch {}
            # Push unified App Settings, Modular Tab Registry & Version metadata
            Send-AppSettingsStateToUi
            # Push System Profiles / Modes state for Header Mode Pill & Profiles view
            if ($Global:ProfilesModuleAvailable) {
                Update-TrayProfilesSubmenu
                Send-ProfilesStateToUi
            }
            # Immediately push any already-sampled telemetry so startup is instant
            & $global:FlushTelemetryToUi
        }
        '^Active-View:(.+)$' {
            $viewKey = $Matches[1].Trim()
            $global:SharedData.ActiveView = $viewKey
            if ($viewKey -eq 'dashboard') {
                $global:SharedData.ForceRefresh = $true
                & $global:FlushTelemetryToUi
            }
        }
        '^Side-Dock:(open|closed)$' {
            $isOpen = ($Matches[1] -eq 'open')
            $global:SharedData.SideDockOpen = $isOpen
            if ($isOpen) {
                $global:SharedData.ForceRefresh = $true
                & $global:FlushTelemetryToUi
            }
        }
        '^Request-Adapters$' {
            try {
                . (Join-Path $Global:NodeWatchRoot "modules\tabs\NetworkManager.ps1")
                $Data = Get-AdapterStateMesh
            } catch { $Data = @{ type = 'REFRESH_ADAPTER_STATE'; interfaces = @(); error = $_.Exception.Message } }
            $Json = $Data | ConvertTo-Json -Compress -Depth 10
            $global:WebViewControl.CoreWebView2.PostWebMessageAsString([Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($Json)))
        }
        '^Request-StartupApps$' {
            try {
                . (Join-Path $Global:NodeWatchRoot "modules\tabs\StartupManager.ps1")
                $Data = Get-StartupAppsMesh
            } catch { $Data = @{ type = 'REFRESH_STARTUP_APPS'; apps = @(); error = $_.Exception.Message } }
            $Json = $Data | ConvertTo-Json -Compress -Depth 5
            $global:WebViewControl.CoreWebView2.PostWebMessageAsString([Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($Json)))
        }
        '^Request-Shares$' {
            try {
                . (Join-Path $Global:NodeWatchRoot 'modules\tabs\SharingManager.ps1')
                $Data = Get-SharingCenterState
            } catch { $Data = @{ type = 'SHARING_CENTER'; shares = @(); error = $_.Exception.Message } }
            $Json = $Data | ConvertTo-Json -Compress -Depth 5
            $global:WebViewControl.CoreWebView2.PostWebMessageAsString([Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($Json)))
        }
        '^Request-InstalledApps$' {
            Start-AsyncTabTask -FallbackType "REFRESH_INSTALLED_APPS" -Arguments @($Global:NodeWatchRoot) -ScriptBlock {
                param($RootPath)
                . (Join-Path $RootPath "modules\tabs\InstalledAppsManager.ps1")
                $data = Get-InstalledAppsMesh
                return ($data | ConvertTo-Json -Compress -Depth 6)
            }
        }
        '^Request-SystemDevices$' {
            Start-AsyncTabTask -FallbackType "REFRESH_SYSTEM_DEVICES" -Arguments @($Global:NodeWatchRoot) -ScriptBlock {
                param($RootPath)
                . (Join-Path $RootPath "modules\tabs\DeviceManager.ps1")
                $data = Get-SystemDevicesMesh
                return ($data | ConvertTo-Json -Compress -Depth 6)
            }
        }
        '^Request-FileOrganizer$' {
            Start-AsyncTabTask -FallbackType "FILE_ORGANIZER_STATE" -Arguments @($Global:NodeWatchRoot) -ScriptBlock {
                param($RootPath)
                . (Join-Path $RootPath "modules\tabs\FileOrganizer.ps1")
                $data = Get-FileOrganizerState -RootPath $RootPath
                return ($data | ConvertTo-Json -Compress -Depth 6)
            }
        }
        '^Request-WslManager$' {
            Start-AsyncTabTask -FallbackType "WSL_NOTICE" -Arguments @($Global:NodeWatchRoot) -ScriptBlock {
                param($RootPath)
                . (Join-Path $RootPath "modules\tabs\WslManager.ps1")
                $data = Get-WslManagerState -IncludeOnlineCatalog
                return ($data | ConvertTo-Json -Compress -Depth 6)
            }
        }
        '^Request-TasksPorts$' {
            Start-AsyncTabTask -FallbackType "TASKS_PORTS_NOTICE" -Arguments @($Global:NodeWatchRoot) -ScriptBlock {
                param($RootPath)
                . (Join-Path $RootPath "modules\tabs\TasksPortsManager.ps1")
                $data = Get-TasksPortsSnapshot
                return ($data | ConvertTo-Json -Compress -Depth 6)
            }
        }
        '^Request-SecurityRepair$' {
            Start-AsyncTabTask -FallbackType "SECURITY_REPAIR_NOTICE" -Arguments @($Global:NodeWatchRoot) -ScriptBlock {
                param($RootPath)
                . (Join-Path $RootPath "modules\tabs\SecurityRepairManager.ps1")
                $data = Get-SecurityPostureSnapshot
                return ($data | ConvertTo-Json -Compress -Depth 6)
            }
        }
        '^Browse-SupportBundleZip$' {
            $sfd = New-Object System.Windows.Forms.SaveFileDialog
            $sfd.Title = "Save CoreWatch IT Support Bundle Archive"
            $sfd.Filter = "ZIP Support Bundle (*.zip)|*.zip|All Files (*.*)|*.*"
            $sfd.FileName = "CoreWatch_SupportBundle_$($env:COMPUTERNAME)_$(Get-Date -Format 'yyyyMMdd_HHmmss').zip"
            $defExp = [string]($Global:AppSettings.directories.exportsRoot)
            if ($defExp -and (Test-Path -LiteralPath $defExp -PathType Container)) { $sfd.InitialDirectory = $defExp }
            if ($sfd.ShowDialog($MainForm) -eq [System.Windows.Forms.DialogResult]::OK -and $sfd.FileName) {
                $resp = @{ type = "SUPPORT_BUNDLE_PATH_RESULT"; path = [string]$sfd.FileName } | ConvertTo-Json -Compress
                $global:WebViewControl.CoreWebView2.PostWebMessageAsString([Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($resp)))
            }
            $sfd.Dispose()
        }
        '^Browse-Folder:(.+)$' {
            $targetKey = $Matches[1]
            $dialog = New-Object System.Windows.Forms.FolderBrowserDialog
            $dialog.Description = switch ($targetKey) {
                "dest"               { "Select destination root folder for organized files" }
                "diagfolder"         { "Select external program log folder for UltimaDiagX" }
                "wslinstalldir"      { "Select installation folder for WSL virtual disk (ext4.vhdx)" }
                "diskmap"            { "Select folder or drive to map visually in Disk Map" }
                "settings_projects"    { "Select default Git / Projects root folder" }
                "settings_exports"     { "Select default Exports & Support Bundles folder" }
                "settings_wsl"         { "Select default WSL installation & backup folder" }
                "settings_organizer"   { "Select default File Organizer destination folder" }
                "github_clone_dest"    { "Select destination folder to clone Git repository into" }
                "github_projects_root" { "Select local Git projects folder to scan" }
                default                { "Select folder to include in File Organizer" }
            }
            $seedDir = switch ($targetKey) {
                "settings_projects"    { [string]$Global:AppSettings.directories.projectsRoot }
                "github_clone_dest"    { [string]$Global:AppSettings.directories.projectsRoot }
                "github_projects_root" { [string]$Global:AppSettings.directories.projectsRoot }
                "settings_exports"     { [string]$Global:AppSettings.directories.exportsRoot }
                "settings_wsl"       { [string]$Global:AppSettings.directories.wslInstallRoot }
                "wslinstalldir"      { [string]$Global:AppSettings.directories.wslInstallRoot }
                "settings_organizer" { [string]$Global:AppSettings.directories.organizerDestRoot }
                "dest"               { [string]$Global:AppSettings.directories.organizerDestRoot }
                default              { "" }
            }
            if ($seedDir -and (Test-Path -LiteralPath $seedDir -PathType Container)) {
                $dialog.InitialDirectory = $seedDir
            }
            $dialog.UseDescriptionForTitle = $true
            $dialog.ShowNewFolderButton = $true
            if ($dialog.ShowDialog($MainForm) -eq [System.Windows.Forms.DialogResult]::OK -and $dialog.SelectedPath) {
                $resp = @{ type = "BROWSE_FOLDER_RESULT"; target = $targetKey; path = [string]$dialog.SelectedPath } | ConvertTo-Json -Compress
                $global:WebViewControl.CoreWebView2.PostWebMessageAsString([Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($resp)))
            }
            $dialog.Dispose()
        }
        '^Browse-File:settings_editor$' {
            $fd = New-Object System.Windows.Forms.OpenFileDialog
            $fd.Title  = "Select Code Editor Executable (VS Code, Cursor, etc.)"
            $fd.Filter = "Executables (*.exe;*.cmd)|*.exe;*.cmd|All Files (*.*)|*.*"
            $curEd = [string]$Global:AppSettings.directories.editorPath
            if ($curEd -and (Test-Path -LiteralPath (Split-Path -Parent $curEd) -PathType Container)) {
                $fd.InitialDirectory = (Split-Path -Parent $curEd)
            }
            if ($fd.ShowDialog($MainForm) -eq [System.Windows.Forms.DialogResult]::OK -and $fd.FileName) {
                Send-CoreWatchMessageToUi -PayloadObj @{ type = "BROWSE_FILE_RESULT"; target = "settings_editor"; path = [string]$fd.FileName }
            }
            $fd.Dispose()
        }
        '^Browse-File:github_release_assets$' {
            $fd = New-Object System.Windows.Forms.OpenFileDialog
            $fd.Title       = "Select Release Asset File(s) to Attach"
            $fd.Filter      = "All Files (*.*)|*.*|Archives & Installers (*.zip;*.exe;*.msi;*.txt)|*.zip;*.exe;*.msi;*.txt"
            $fd.Multiselect = $true
            if ($fd.ShowDialog($MainForm) -eq [System.Windows.Forms.DialogResult]::OK -and $fd.FileNames) {
                Send-CoreWatchMessageToUi -PayloadObj @{ type = "BROWSE_FILE_RESULT"; target = "github_release_assets"; paths = @($fd.FileNames) }
            }
            $fd.Dispose()
        }
        '^Browse-File:github_upload_asset$' {
            $fd = New-Object System.Windows.Forms.OpenFileDialog
            $fd.Title  = "Select Asset File to Upload to Release"
            $fd.Filter = "All Files (*.*)|*.*|Archives & Installers (*.zip;*.exe;*.msi;*.txt)|*.zip;*.exe;*.msi;*.txt"
            if ($fd.ShowDialog($MainForm) -eq [System.Windows.Forms.DialogResult]::OK -and $fd.FileName) {
                Send-CoreWatchMessageToUi -PayloadObj @{ type = "BROWSE_FILE_RESULT"; target = "github_upload_asset"; path = [string]$fd.FileName }
            }
            $fd.Dispose()
        }
        '^Browse-WslImportFile$' {
            $fd = New-Object System.Windows.Forms.OpenFileDialog
            $fd.Title = "Select Linux Tarball (.tar) or Virtual Disk (.vhdx) to Import into WSL"
            $fd.Filter = "WSL Archives & Disks (*.tar;*.tar.gz;*.vhdx)|*.tar;*.tar.gz;*.vhdx|All Files (*.*)|*.*"
            if ($fd.ShowDialog($MainForm) -eq [System.Windows.Forms.DialogResult]::OK -and $fd.FileName) {
                $resp = @{ type = "WSL_BROWSE_IMPORT_RESULT"; path = [string]$fd.FileName } | ConvertTo-Json -Compress
                $global:WebViewControl.CoreWebView2.PostWebMessageAsString([Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($resp)))
            }
            $fd.Dispose()
        }
        '^Browse-WslExportFile:(.+)$' {
            $distroName = $Matches[1]
            $sfd = New-Object System.Windows.Forms.SaveFileDialog
            $sfd.Title = "Export WSL Distribution '$distroName' Backup Archive"
            $sfd.Filter = "Tar Archive (*.tar)|*.tar|All Files (*.*)|*.*"
            $sfd.FileName = "${distroName}_$(Get-Date -Format 'yyyyMMdd').tar"
            if ($sfd.ShowDialog($MainForm) -eq [System.Windows.Forms.DialogResult]::OK -and $sfd.FileName) {
                $resp = @{ type = "WSL_BROWSE_EXPORT_RESULT"; distro = $distroName; path = [string]$sfd.FileName } | ConvertTo-Json -Compress
                $global:WebViewControl.CoreWebView2.PostWebMessageAsString([Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($resp)))
            }
            $sfd.Dispose()
        }
        '^Browse-LogFile$' {
            $fd = New-Object System.Windows.Forms.OpenFileDialog
            $fd.Title = "Select External Program Log File for UltimaDiagX"
            $fd.Filter = "Log & Event Files (*.log;*.txt;*.evtx;*.err;*.out)|*.log;*.txt;*.evtx;*.err;*.out|All Files (*.*)|*.*"
            $fd.Multiselect = $true
            if ($fd.ShowDialog($MainForm) -eq [System.Windows.Forms.DialogResult]::OK -and $fd.FileNames) {
                $resp = @{ type = "BROWSE_LOGFILE_RESULT"; paths = @($fd.FileNames) } | ConvertTo-Json -Compress
                $global:WebViewControl.CoreWebView2.PostWebMessageAsString([Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($resp)))
            }
            $fd.Dispose()
        }
        '^Identify-Monitors$' {
            try {
                . (Join-Path $Global:NodeWatchRoot "modules\telemetry\GetDisplayMetrics.ps1")
                $mons = @(Get-DisplayMetrics)

                # Dispose any existing identify overlays cleanly
                if ($null -ne $global:IdentifyOverlayTimer) {
                    $global:IdentifyOverlayTimer.Stop()
                    $global:IdentifyOverlayTimer.Dispose()
                    $global:IdentifyOverlayTimer = $null
                }
                if ($null -ne $global:IdentifyOverlayForms) {
                    foreach ($f in @($global:IdentifyOverlayForms)) { try { $f.Close(); $f.Dispose() } catch {} }
                }
                $global:IdentifyOverlayForms = New-Object System.Collections.ArrayList

                $allScreens = [System.Windows.Forms.Screen]::AllScreens

                foreach ($m in $mons) {
                    $matchedScreen = $allScreens | Where-Object { $_.DeviceName -eq $m.Id } | Select-Object -First 1
                    $workX = if ($matchedScreen) { $matchedScreen.WorkingArea.X }      else { [int]$m.BoundsX }
                    $workY = if ($matchedScreen) { $matchedScreen.WorkingArea.Y }      else { [int]$m.BoundsY }
                    $workW = if ($matchedScreen) { $matchedScreen.WorkingArea.Width }  else { [int]$m.BoundsWidth }
                    $workH = if ($matchedScreen) { $matchedScreen.WorkingArea.Height } else { [int]$m.BoundsHeight }

                    $scale = if ($m.ScalePct -and [int]$m.ScalePct -ge 100) { [double]$m.ScalePct / 100.0 } else { 1.0 }
                    $badgeW    = [Math]::Min([int][Math]::Round(220 * $scale), [Math]::Max(120, $workW - 16))
                    $badgeH    = [Math]::Min([int][Math]::Round(140 * $scale), [Math]::Max(80,  $workH - 16))
                    $marginX   = [int][Math]::Round(36 * $scale)
                    $marginY   = [int][Math]::Round(36 * $scale)
                    $borderPad = [Math]::Max(2, [int][Math]::Round(2 * $scale))
                    $nameH     = [Math]::Max(20, [int][Math]::Round(24 * $scale))
                    $minPadTop = [int][Math]::Round(16 * $scale)

                    $posX = $workX + $marginX
                    $posY = $workY + $workH - $badgeH - $marginY
                    if (($posX + $badgeW) -gt ($workX + $workW)) {
                        $posX = $workX + [Math]::Max(0, $workW - $badgeW)
                    }
                    if ($posY -lt ($workY + $minPadTop)) {
                        $posY = $workY + [Math]::Max(0, [Math]::Min($minPadTop, $workH - $badgeH))
                    }

                    $badge = if ("CoreWatch.IdentifyOverlayForm" -as [type]) {
                        New-Object CoreWatch.IdentifyOverlayForm
                    } else {
                        New-Object System.Windows.Forms.Form
                    }
                    $badge.AutoScaleMode   = [System.Windows.Forms.AutoScaleMode]::None
                    $badge.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None
                    $badge.StartPosition   = [System.Windows.Forms.FormStartPosition]::Manual
                    $badge.ShowInTaskbar   = $false
                    $badge.TopMost         = $true
                    $badge.BackColor       = [System.Drawing.Color]::FromArgb(26, 32, 44)
                    $badge.Opacity         = 0.94
                    $badge.Bounds          = New-Object System.Drawing.Rectangle($posX, $posY, $badgeW, $badgeH)

                    $borderPanel = New-Object System.Windows.Forms.Panel
                    $borderPanel.Dock = "Fill"
                    $borderPanel.BackColor = [System.Drawing.Color]::FromArgb(66, 153, 225)
                    $borderPanel.Padding = New-Object System.Windows.Forms.Padding($borderPad)

                    $innerPanel = New-Object System.Windows.Forms.Panel
                    $innerPanel.Dock = "Fill"
                    $innerPanel.BackColor = [System.Drawing.Color]::FromArgb(26, 32, 44)

                    # Use GraphicsUnit::Pixel scaled by the target monitor's exact DPI scale so
                    # typography stays crisp and identically proportioned without double-scaling
                    # or WM_DPICHANGED timing glitches across mixed-DPI displays.
                    $numFontPx  = [float]([Math]::Round(69.33 * $scale, 1))
                    $nameFontPx = [float]([Math]::Round(11.33 * $scale, 1))

                    $numLbl = New-Object System.Windows.Forms.Label
                    $numLbl.Text      = [string]$m.DisplayNumber
                    $numLbl.ForeColor = [System.Drawing.Color]::White
                    $numLbl.Font      = New-Object System.Drawing.Font("Segoe UI", $numFontPx, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
                    $numLbl.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
                    $numLbl.Dock      = "Fill"

                    $nameLbl = New-Object System.Windows.Forms.Label
                    $nameLbl.Text         = if ($m.IsPrimary) { "$($m.FriendlyName) (Primary)" } else { [string]$m.FriendlyName }
                    $nameLbl.ForeColor    = [System.Drawing.Color]::FromArgb(144, 205, 244)
                    $nameLbl.Font         = New-Object System.Drawing.Font("Consolas", $nameFontPx, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
                    $nameLbl.TextAlign    = [System.Drawing.ContentAlignment]::MiddleCenter
                    $nameLbl.AutoEllipsis = $true
                    $nameLbl.Dock         = "Bottom"
                    $nameLbl.Height       = $nameH

                    $innerPanel.Controls.Add($numLbl)
                    $innerPanel.Controls.Add($nameLbl)
                    $borderPanel.Controls.Add($innerPanel)
                    $badge.Controls.Add($borderPanel)
                    $badge.Show()
                    $null = [CoreWatch.Win32]::SetWindowPos(
                        $badge.Handle,
                        [CoreWatch.Win32]::HWND_TOPMOST,
                        $posX, $posY, $badgeW, $badgeH,
                        [CoreWatch.Win32]::SWP_NOACTIVATE
                    )
                    $null = $global:IdentifyOverlayForms.Add($badge)
                }

                $global:IdentifyOverlayTimer = New-Object System.Windows.Forms.Timer
                $global:IdentifyOverlayTimer.Interval = 2600
                $global:IdentifyOverlayTimer.Add_Tick({
                    $global:IdentifyOverlayTimer.Stop()
                    $global:IdentifyOverlayTimer.Dispose()
                    $global:IdentifyOverlayTimer = $null
                    if ($null -ne $global:IdentifyOverlayForms) {
                        foreach ($f in @($global:IdentifyOverlayForms)) { try { $f.Close(); $f.Dispose() } catch {} }
                        $global:IdentifyOverlayForms.Clear()
                    }
                })
                $global:IdentifyOverlayTimer.Start()
            } catch {}
        }
        '^Execute-SpeedTest$' {
            if ($global:SpeedTestRunning) { return }
            $global:SpeedTestRunning = $true

            $global:SpeedTestPipeline = [powershell]::Create()
            $null = $global:SpeedTestPipeline.AddScript({
                param($RootPath)
                . (Join-Path $RootPath "modules\telemetry\NetworkTest.ps1")
                $results = Get-NetworkSpeedTest
                return ($results | ConvertTo-Json -Compress)
            }).AddArgument($Global:NodeWatchRoot)

            $global:SpeedTestAsyncHandle = $global:SpeedTestPipeline.BeginInvoke()

            $global:SpeedTestTimer = New-Object System.Windows.Forms.Timer
            $global:SpeedTestTimer.Interval = 200
            $global:SpeedTestTimer.Add_Tick({
                if ($null -ne $global:SpeedTestAsyncHandle -and $global:SpeedTestAsyncHandle.IsCompleted) {
                    $global:SpeedTestTimer.Stop()
                    try {
                        $output = $global:SpeedTestPipeline.EndInvoke($global:SpeedTestAsyncHandle)
                        $json = [string]$output
                        if ($json -and $null -ne $global:WebViewControl.CoreWebView2) {
                            $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
                            $global:WebViewControl.CoreWebView2.PostWebMessageAsString([Convert]::ToBase64String($bytes))
                        }
                    } catch {
                        $errJson = @{ type = "SPEED_TEST_RESULTS"; Latency = "ERR"; Download = "ERR"; Upload = "ERR"; Error = $_.Exception.Message } | ConvertTo-Json -Compress
                        if ($null -ne $global:WebViewControl.CoreWebView2) {
                            $bytes = [System.Text.Encoding]::UTF8.GetBytes($errJson)
                            $global:WebViewControl.CoreWebView2.PostWebMessageAsString([Convert]::ToBase64String($bytes))
                        }
                    } finally {
                        if ($null -ne $global:SpeedTestPipeline) { $global:SpeedTestPipeline.Dispose(); $global:SpeedTestPipeline = $null }
                        $global:SpeedTestAsyncHandle = $null
                        if ($null -ne $global:SpeedTestTimer) { $global:SpeedTestTimer.Dispose(); $global:SpeedTestTimer = $null }
                        $global:SpeedTestRunning = $false
                    }
                }
            })
            $global:SpeedTestTimer.Start()
        }
        '^Window-DragStart$' {
            if ($Global:WindowLockMode -ne "none") { return }
            $null = [CoreWatch.Win32]::ReleaseCapture()
            $null = [CoreWatch.Win32]::SendMessage($MainForm.Handle, [CoreWatch.Win32]::WM_NCLBUTTONDOWN, [IntPtr]2, [IntPtr]::Zero)
        }
        '^Window-ResizeHit:(\d+)$' {
            $hitCode = [int]$Matches[1]
            if ($Global:WindowLockMode -eq "all") { return }
            # When Position is locked, only allow Right (11), Bottom (15), and Bottom-Right (17)
            # so width/height can still be adjusted while keeping window (X, Y) anchored in place.
            if ($Global:WindowLockMode -eq "position" -and ($hitCode -notin @(11, 15, 17))) { return }
            # Native Win32 HTLEFT(10)..HTBOTTOMRIGHT(17)
            if ($hitCode -ge 10 -and $hitCode -le 17) {
                $null = [CoreWatch.Win32]::ReleaseCapture()
                $null = [CoreWatch.Win32]::SendMessage($MainForm.Handle, [CoreWatch.Win32]::WM_NCLBUTTONDOWN, [IntPtr]$hitCode, [IntPtr]::Zero)
            }
        }
        '^Window-Drag:(.+)' {
            if ($Global:WindowLockMode -ne "none") { return }
            $Delta = $Matches[1].Split('|')
            if ($Delta.Count -eq 2) {
                $CursorPos = [System.Windows.Forms.Cursor]::Position
                $MainForm.Location = New-Object System.Drawing.Point(($CursorPos.X - [int]$Delta[0]), ($CursorPos.Y - [int]$Delta[1]))
            }
        }
        '^Window-Resize:(.+)' {
            if ($Global:WindowLockMode -eq "all") { return }
            $Dimensions = $Matches[1].Split('|')
            if ($Dimensions.Count -eq 2) {
                $Width  = [Math]::Max($script:MinWindowWidth,  [Math]::Min($script:MaxWindowWidth,  [int]$Dimensions[0]))
                $Height = [Math]::Max($script:MinWindowHeight, [Math]::Min($script:MaxWindowHeight, [int]$Dimensions[1]))
                $MainForm.Size = New-Object System.Drawing.Size($Width, $Height)
            }
        }
        '^Rename-Drive:(.+)' {
            $Payload = $Matches[1]; $SplitIndex = $Payload.IndexOf('|')
            if ($SplitIndex -gt 0) {
                . (Join-Path $Global:NodeWatchRoot "modules\telemetry\StorageEngine.ps1")
                Set-StorageLabel -DriveLetter ($Payload.Substring(0, $SplitIndex)) -NewLabel ($Payload.Substring($SplitIndex + 1))
            }
        }
        Default {
            if ($RawMessage -match '\{.*"command".*\}') {
                try {
                    $Payload = $RawMessage | ConvertFrom-Json
                    if ($Payload.command -in @('CREATE_SHARE', 'REMOVE_SHARE', 'DELETE_SHARED_FOLDER', 'GRANT_SHARE_ACCESS', 'REMOVE_SHARE_ACCESS')) {
                        try {
                            . (Join-Path $Global:NodeWatchRoot 'modules\tabs\SharingManager.ps1')
                            Invoke-SharingCenterAction -Payload $Payload
                            $Data = Get-SharingCenterState
                            $Data.message = 'Sharing action completed.'
                        } catch {
                            $Data = @{ type = 'SHARING_CENTER'; shares = $null; error = $_.Exception.Message }
                        }
                        $Json = $Data | ConvertTo-Json -Compress -Depth 5
                        $global:WebViewControl.CoreWebView2.PostWebMessageAsString([Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($Json)))
                        return
                    }

                    if ($Payload.command -in @('REMOVE_STARTUP_APP', 'CREATE_STARTUP_APP', 'TOGGLE_STARTUP_APP', 'OPEN_FILE_LOCATION')) {
                        try {
                            . (Join-Path $Global:NodeWatchRoot "modules\tabs\StartupManager.ps1")
                            $Data = Invoke-StartupAppAction -Payload $Payload
                        } catch {
                            $Data = @{ type = 'REFRESH_STARTUP_APPS'; apps = @(); error = $_.Exception.Message }
                        }
                        $Json = $Data | ConvertTo-Json -Compress -Depth 5
                        $global:WebViewControl.CoreWebView2.PostWebMessageAsString([Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($Json)))
                        return
                    }

                    if ($Payload.command -match "SET_STATIC_IP|TRIGGER_DHCP_REVERSION|RENAME_ADAPTER|TOGGLE_ADAPTER_STATE|SET_CUSTOM_DNS|FLUSH_DNS_CACHE|RESTART_ADAPTER") {
                        $NetTabPath = Join-Path $Global:NodeWatchRoot "modules\tabs\NetworkManager.ps1"
                        if (Test-Path $NetTabPath) {
                            . $NetTabPath
                            $UpdateMesh = Invoke-AdapterProvisioningControl -Payload $Payload
                            $global:SharedData.ForceRefresh = $true
                            $Json = $UpdateMesh | ConvertTo-Json -Compress -Depth 10
                            $global:WebViewControl.CoreWebView2.PostWebMessageAsString([Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($Json)))
                        }
                        return
                    }

                    if ($Payload.command -in @('UNINSTALL_APP', 'MODIFY_APP', 'MOVE_APP', 'OPEN_APP_FOLDER', 'OPEN_APP_REGISTRY', 'CALC_APP_SIZE')) {
                        Start-AsyncTabTask -FallbackType "REFRESH_INSTALLED_APPS" -Arguments @($Global:NodeWatchRoot, $RawMessage) -ScriptBlock {
                            param($RootPath, $RawJson)
                            . (Join-Path $RootPath "modules\tabs\InstalledAppsManager.ps1")
                            $data = Invoke-InstalledAppAction -Payload $RawJson
                            return ($data | ConvertTo-Json -Compress -Depth 6)
                        }
                        return
                    }

                    if ($Payload.command -in @('RESCAN_HARDWARE', 'OPEN_NATIVE_DEVMGMT', 'OPEN_DRIVER_INF', 'TOGGLE_DEVICE_STATE', 'RESTART_DEVICE', 'OPEN_DRIVER_URL')) {
                        Start-AsyncTabTask -FallbackType "REFRESH_SYSTEM_DEVICES" -Arguments @($Global:NodeWatchRoot, $RawMessage) -ScriptBlock {
                            param($RootPath, $RawJson)
                            . (Join-Path $RootPath "modules\tabs\DeviceManager.ps1")
                            $data = Invoke-DeviceManagerAction -Payload $RawJson
                            return ($data | ConvertTo-Json -Compress -Depth 6)
                        }
                        return
                    }

                    if ($Payload.command -in @('APPSTORE_LOAD', 'APPSTORE_INSTALL_ONE', 'APPSTORE_INSTALL_BATCH', 'APPSTORE_UPGRADE_ALL', 'APPSTORE_SEARCH_WINGET', 'APPSTORE_OPEN_URL', 'APPSTORE_LAUNCH_APP')) {
                        Start-AsyncTabTask -FallbackType "APPSTORE_NOTICE" -Arguments @($Global:NodeWatchRoot, $RawMessage) -ScriptBlock {
                            param($RootPath, $RawJson)
                            . (Join-Path $RootPath "modules\tabs\AppInstallerManager.ps1")
                            $data = Invoke-AppInstallerAction -Payload $RawJson -RootPath $RootPath
                            return ($data | ConvertTo-Json -Compress -Depth 6)
                        }
                        return
                    }

                    if ($Payload.command -in @('DISKMAP_LIST_DRIVES', 'DISKMAP_SCAN', 'DISKMAP_OPEN_EXPLORER', 'DISKMAP_RECYCLE')) {
                        Start-AsyncTabTask -FallbackType "DISKMAP_NOTICE" -Arguments @($Global:NodeWatchRoot, $RawMessage) -ScriptBlock {
                            param($RootPath, $RawJson)
                            . (Join-Path $RootPath "modules\tabs\DiskMapper.ps1")
                            $data = Invoke-DiskMapperAction -Payload $RawJson
                            return ($data | ConvertTo-Json -Compress -Depth 12)
                        }
                        return
                    }

                    if ($Payload.command -in @('PREVIEW_ORGANIZE', 'EXECUTE_ORGANIZE', 'UNDO_ORGANIZE', 'OPEN_ORGANIZER_FOLDER')) {
                        Start-AsyncTabTask -FallbackType "FILE_ORGANIZER_ERROR" -Arguments @($Global:NodeWatchRoot, $RawMessage) -ScriptBlock {
                            param($RootPath, $RawJson)
                            . (Join-Path $RootPath "modules\tabs\FileOrganizer.ps1")
                            $data = Invoke-FileOrganizerAction -Payload $RawJson -RootPath $RootPath
                            return ($data | ConvertTo-Json -Compress -Depth 6)
                        }
                        return
                    }

                    if ($Payload.command -in @('RUN_DIAGNOSTIC', 'TRANSLATE_CODE', 'DISCOVER_APP_LOGS', 'EXPORT_DIAG_REPORT', 'OPEN_EVENT_VIEWER', 'OPEN_RELIABILITY_MONITOR', 'OPEN_DUMP_LOCATION')) {
                        Start-AsyncTabTask -FallbackType "ULTIMADIAGX_NOTICE" -Arguments @($Global:NodeWatchRoot, $RawMessage) -ScriptBlock {
                            param($RootPath, $RawJson)
                            . (Join-Path $RootPath "modules\tabs\UltimaDiagX.ps1")
                            $data = Invoke-UltimaDiagXAction -Payload $RawJson -RootPath $RootPath
                            return ($data | ConvertTo-Json -Compress -Depth 7)
                        }
                        return
                    }

                    if ($Payload.command -in @(
                        'WSL_LOAD_ONLINE_CATALOG', 'WSL_INSTALL_ENGINE', 'WSL_UPDATE_ENGINE',
                        'WSL_SHUTDOWN_ALL', 'WSL_SET_DEFAULT_VERSION', 'WSL_DEPLOY_DISTRO',
                        'WSL_LAUNCH_DISTRO', 'WSL_EXPLORE_DISTRO', 'WSL_TERMINATE_DISTRO',
                        'WSL_SET_DEFAULT_DISTRO', 'WSL_CONVERT_VERSION', 'WSL_UNREGISTER_DISTRO',
                        'WSL_EXPORT_DISTRO', 'WSL_IMPORT_DISTRO', 'WSL_COMPACT_VHDX',
                        'WSL_SAVE_CONFIG', 'WSL_OPEN_CONFIG_FILE', 'WSL_RUN_COMMAND'
                    )) {
                        Start-AsyncTabTask -FallbackType "WSL_NOTICE" -Arguments @($Global:NodeWatchRoot, $RawMessage) -ScriptBlock {
                            param($RootPath, $RawJson)
                            . (Join-Path $RootPath "modules\tabs\WslManager.ps1")
                            $data = Invoke-WslManagerAction -RawJson $RawJson
                            return ($data | ConvertTo-Json -Compress -Depth 6)
                        }
                        return
                    }

                    if ($Payload.command -in @(
                        'SEC_TOGGLE_RDP', 'SEC_TOGGLE_TASK',
                        'SEC_LOAD_ENV_HOSTS_PROXY', 'SEC_TOGGLE_PROXY', 'SEC_OPEN_HOSTS_FILE',
                        'REPAIR_DISM_CHECK', 'REPAIR_DISM_RESTORE_TERM', 'REPAIR_SFC_TERM',
                        'REPAIR_WU_RESET', 'REPAIR_NET_STACK_RESET', 'REPAIR_WINGET_CHECK',
                        'REPAIR_BATTERY_REPORT', 'REPAIR_CLEAN_TEMP', 'EXPORT_SUPPORT_BUNDLE'
                    )) {
                        Start-AsyncTabTask -FallbackType "SECURITY_REPAIR_NOTICE" -Arguments @($Global:NodeWatchRoot, $RawMessage) -ScriptBlock {
                            param($RootPath, $RawJson)
                            . (Join-Path $RootPath "modules\tabs\SecurityRepairManager.ps1")
                            $data = Invoke-SecurityRepairAction -RawJson $RawJson -RootPath $RootPath
                            return ($data | ConvertTo-Json -Compress -Depth 6)
                        }
                        return
                    }

                    if ($Payload.command -in @(
                        'NET_DIAG_PING', 'NET_DIAG_TRACEROUTE', 'NET_DIAG_PORT_TEST',
                        'NET_DIAG_DNS_LOOKUP', 'NET_DIAG_WIFI_AND_ROUTES'
                    )) {
                        Start-AsyncTabTask -FallbackType "NET_DIAG_ERROR" -Arguments @($Global:NodeWatchRoot, $RawMessage) -ScriptBlock {
                            param($RootPath, $RawJson)
                            . (Join-Path $RootPath "modules\tabs\NetworkDiagnostics.ps1")
                            $data = Invoke-NetworkDiagnosticAction -RawJson $RawJson
                            return ($data | ConvertTo-Json -Compress -Depth 6)
                        }
                        return
                    }

                    if ($Payload.command -in @(
                        'TP_KILL_PROCESS', 'TP_OPEN_PROCESS_LOCATION',
                        'TP_SERVICE_ACTION', 'TP_SERVICE_STARTUP'
                    )) {
                        Start-AsyncTabTask -FallbackType "TASKS_PORTS_NOTICE" -Arguments @($Global:NodeWatchRoot, $RawMessage) -ScriptBlock {
                            param($RootPath, $RawJson)
                            . (Join-Path $RootPath "modules\tabs\TasksPortsManager.ps1")
                            $data = Invoke-TasksPortsAction -RawJson $RawJson
                            return ($data | ConvertTo-Json -Compress -Depth 6)
                        }
                        return
                    }

                    # =========================================================================
                    # [DYNAMIC CONTROL] UNIFIED ON/OFF TOGGLES & QUICK DASHBOARD ACTIONS
                    # =========================================================================
                    if ($Payload.command -in @(
                        'TOGGLE_TELEMETRY', 'TOGGLE_FIREWALL', 'TOGGLE_REALTIME',
                        'OPEN_TAMPER_SETTINGS', 'TOGGLE_BEHAVIOR_MONITOR', 'TOGGLE_CLOUD_PROTECTION', 'TOGGLE_IOAV_PROTECTION',
                        'TOGGLE_DISCOVERY', 'TOGGLE_SHARING', 'TOGGLE_NET_PROFILE',
                        'SET_QUICK_DNS', 'FLUSH_AND_TEST_DNS', 'REFRESH_ARP_GATEWAY',
                        'TOGGLE_HDR', 'TOGGLE_NIGHT_LIGHT', 'SET_NIGHT_LIGHT_STRENGTH',
                        'SET_MONITOR_REFRESH_RATE', 'SET_MONITOR_SCALE', 'SET_MONITOR_ORIENTATION',
                        'END_TOP_PROCESS', 'TRIGGER_SYSTEM_REBOOT', 'INSTALL_PAWNIO', 'SET_PRIMARY_JAVA',
                        'CHECK_PS_UPDATE', 'INSTALL_PS_UPDATE'
                    )) {
                        Start-AsyncTabTask -FallbackType "DASHBOARD_CONTROL_RESULT" -Arguments @($Global:NodeWatchRoot, $RawMessage, $global:SharedData) -ScriptBlock {
                            param($RootPath, $RawJson, $SharedData)
                            . (Join-Path $RootPath "modules\telemetry\DashboardControls.ps1")
                            $res = Invoke-DashboardControlAction -RawJson $RawJson -RootPath $RootPath
                            $SharedData.ForceRefresh = $true
                            return ($res | ConvertTo-Json -Compress -Depth 4)
                        }
                        return
                    }

                    if ($Payload.command -in @(
                        'GH_LOAD', 'GH_SAVE_PAT', 'GH_CLEAR_PAT', 'GH_OPEN_VSCODE', 'GH_OPEN_TERMINAL',
                        'GH_OPEN_EXPLORER', 'GH_GIT_PULL', 'GH_RUN_LOCAL_PUBLISH', 'GH_CLONE_REPO',
                        'GH_LOAD_RELEASES', 'GH_GENERATE_RELEASE_NOTES', 'GH_CREATE_RELEASE',
                        'GH_UPLOAD_RELEASE_ASSET', 'GH_DELETE_RELEASE'
                    )) {
                        Start-AsyncTabTask -FallbackType "GITHUB_NOTICE" -Arguments @($Global:NodeWatchRoot, $RawMessage) -ScriptBlock {
                            param($RootPath, $RawJson)
                            . (Join-Path $RootPath "modules\tabs\GitHubManager.ps1")
                            $data = Invoke-GitHubManagerAction -RawJson $RawJson -RootPath $RootPath
                            return ($data | ConvertTo-Json -Compress -Depth 8)
                        }
                        return
                    }

                    if ($Payload.command -in @(
                        'JIRA_LOAD', 'JIRA_SIGN_IN', 'JIRA_SIGN_OUT', 'JIRA_GET_ISSUE_DETAIL',
                        'JIRA_TRANSITION_ISSUE', 'JIRA_ADD_COMMENT', 'JIRA_LOG_WORK',
                        'JIRA_ASSIGN_TO_ME', 'JIRA_CREATE_ISSUE'
                    )) {
                        Start-AsyncTabTask -FallbackType "JIRA_NOTICE" -Arguments @($Global:NodeWatchRoot, $RawMessage) -ScriptBlock {
                            param($RootPath, $RawJson)
                            . (Join-Path $RootPath "modules\tabs\JiraManager.ps1")
                            $data = Invoke-JiraManagerAction -RawJson $RawJson -RootPath $RootPath
                            return ($data | ConvertTo-Json -Compress -Depth 8)
                        }
                        return
                    }

                    if ($Payload.command -eq "SET_WINDOW_LOCK_MODE") {
                        $wantMode = ([string]($Payload.mode ?? "none")).ToLowerInvariant()
                        if ($wantMode -notin @("none", "position", "all")) { $wantMode = "none" }
                        $Global:WindowLockMode = $wantMode
                        if (-not ($Global:SavedUiSettings -is [hashtable])) { $Global:SavedUiSettings = @{} }
                        $Global:SavedUiSettings["windowLockMode"] = $wantMode
                        Save-CoreWatchUiSettings -Settings $Global:SavedUiSettings
                        Send-CoreWatchMessageToUi -PayloadObj @{
                            type           = "UI_WINDOW_STATE"
                            alwaysOnTop    = [bool]$MainForm.TopMost
                            opacity        = [math]::Round([double]$MainForm.Opacity, 2)
                            windowLockMode = [string]$Global:WindowLockMode
                        }
                        return
                    }

                    if ($Payload.command -eq "SET_ALWAYS_ON_TOP") {
                        $wantTop = [bool]$Payload.enabled
                        $MainForm.TopMost = $wantTop
                        if (-not ($Global:SavedUiSettings -is [hashtable])) { $Global:SavedUiSettings = @{} }
                        $Global:SavedUiSettings["alwaysOnTop"] = $wantTop
                        Save-CoreWatchUiSettings -Settings $Global:SavedUiSettings
                        $resp = @{ type = "UI_WINDOW_STATE"; alwaysOnTop = [bool]$MainForm.TopMost; opacity = [math]::Round([double]$MainForm.Opacity, 2); windowLockMode = [string]$Global:WindowLockMode } | ConvertTo-Json -Compress
                        $global:WebViewControl.CoreWebView2.PostWebMessageAsString([Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($resp)))
                        return
                    }

                    if ($Payload.command -eq "SET_WINDOW_OPACITY") {
                        $op = [math]::Max(0.70, [math]::Min(1.0, [double]($Payload.opacity ?? 1.0)))
                        $MainForm.Opacity = $op
                        if (-not ($Global:SavedUiSettings -is [hashtable])) { $Global:SavedUiSettings = @{} }
                        $Global:SavedUiSettings["opacity"] = [math]::Round($op, 2)
                        Save-CoreWatchUiSettings -Settings $Global:SavedUiSettings
                        return
                    }

                    if ($Payload.command -eq "SAVE_UI_LAYOUT") {
                        if (-not ($Global:SavedUiSettings -is [hashtable])) { $Global:SavedUiSettings = @{} }
                        $Global:SavedUiSettings["layout"] = $Payload.layout
                        Save-CoreWatchUiSettings -Settings $Global:SavedUiSettings
                        return
                    }

                    if ($Payload.command -eq "SAVE_DIAGX_DISMISSED") {
                        if (-not ($Global:SavedUiSettings -is [hashtable])) { $Global:SavedUiSettings = @{} }
                        $Global:SavedUiSettings["diagxDismissed"] = $Payload.dismissed
                        Save-CoreWatchUiSettings -Settings $Global:SavedUiSettings
                        return
                    }

                    if ($Payload.command -in @('PROFILES_LOAD', 'PROFILES_APPLY', 'PROFILES_REVERT', 'PROFILES_SAVE', 'PROFILES_DELETE', 'PROFILES_RESET_PRESET', 'PROFILES_CAPTURE_CURRENT', 'PROFILES_EXPORT', 'PROFILES_IMPORT')) {
                        if (-not $Global:ProfilesModuleAvailable) {
                            Send-CoreWatchMessageToUi -PayloadObj @{ type = "PROFILES_NOTICE"; ok = $false; message = "System Profiles module is not installed." }
                            return
                        }
                        try {
                            switch ($Payload.command) {
                                'PROFILES_LOAD' {
                                    Update-TrayProfilesSubmenu
                                    Send-ProfilesStateToUi
                                }
                                'PROFILES_APPLY' {
                                    $pidTarget = ([string]$Payload.profileId).Trim()
                                    $res = Invoke-ApplySystemProfile -ProfileId $pidTarget -RootPath $Global:NodeWatchRoot -CurrentKeepAwake $Global:KeepAwakeActive
                                    Sync-CoreWatchKeepAwake -Enable ([bool]$res.keepAwakeActive)
                                    $global:SharedData.ForceRefresh = $true
                                    Update-TrayProfilesSubmenu
                                    Send-ProfilesStateToUi -Notice $res.notice
                                }
                                'PROFILES_REVERT' {
                                    $res = Invoke-RevertSystemProfileBaseline -RootPath $Global:NodeWatchRoot -CurrentKeepAwake $Global:KeepAwakeActive
                                    Sync-CoreWatchKeepAwake -Enable ([bool]$res.keepAwakeActive)
                                    $global:SharedData.ForceRefresh = $true
                                    Update-TrayProfilesSubmenu
                                    Send-ProfilesStateToUi -Notice $res.notice
                                }
                                'PROFILES_SAVE' {
                                    $profHash = ($RawMessage | ConvertFrom-Json -AsHashtable)["profile"]
                                    $savedProf = Save-CustomOrEditedProfile -ProfileHash $profHash
                                    Update-TrayProfilesSubmenu
                                    Send-ProfilesStateToUi -Notice "Saved profile '$($savedProf.name)'."
                                }
                                'PROFILES_DELETE' {
                                    $pidDel = ([string]$Payload.profileId).Trim()
                                    Remove-CustomProfile -ProfileId $pidDel
                                    Update-TrayProfilesSubmenu
                                    Send-ProfilesStateToUi -Notice "Deleted custom profile."
                                }
                                'PROFILES_RESET_PRESET' {
                                    $pidReset = ([string]$Payload.profileId).Trim()
                                    $resetProf = Reset-BuiltInProfilePreset -ProfileId $pidReset
                                    Update-TrayProfilesSubmenu
                                    Send-ProfilesStateToUi -Notice "Reset '$($resetProf.name)' preset to factory defaults."
                                }
                                'PROFILES_CAPTURE_CURRENT' {
                                    $liveSnap = Get-LiveSystemProfileSnapshot -RootPath $Global:NodeWatchRoot -KeepAwakeActive $Global:KeepAwakeActive
                                    Send-CoreWatchMessageToUi -PayloadObj @{
                                        type     = "PROFILES_CAPTURED_SNAPSHOT"
                                        snapshot = $liveSnap
                                    }
                                }
                                'PROFILES_EXPORT' {
                                    $sfd = New-Object System.Windows.Forms.SaveFileDialog
                                    $sfd.Title    = "Export CoreWatch System Profiles (JSON)"
                                    $sfd.Filter   = "JSON Profiles (*.json)|*.json|All Files (*.*)|*.*"
                                    $sfd.FileName = "CoreWatch_Profiles_$($env:COMPUTERNAME)_$(Get-Date -Format 'yyyyMMdd').json"
                                    $defExp = [string]$Global:AppSettings.directories.exportsRoot
                                    if ($defExp -and (Test-Path -LiteralPath $defExp -PathType Container)) { $sfd.InitialDirectory = $defExp }
                                    if ($sfd.ShowDialog($MainForm) -eq [System.Windows.Forms.DialogResult]::OK -and $sfd.FileName) {
                                        $store = Get-CoreWatchProfilesStore
                                        $expObj = [ordered]@{ schemaVersion = 1; exportedUtc = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ"); profiles = @($store["profiles"]) }
                                        [System.IO.File]::WriteAllText($sfd.FileName, ($expObj | ConvertTo-Json -Depth 10), (New-Object System.Text.UTF8Encoding($false)))
                                        Send-ProfilesStateToUi -Notice "Exported profiles to $($sfd.FileName)."
                                    }
                                    $sfd.Dispose()
                                }
                                'PROFILES_IMPORT' {
                                    $fd = New-Object System.Windows.Forms.OpenFileDialog
                                    $fd.Title  = "Import CoreWatch System Profiles (JSON)"
                                    $fd.Filter = "JSON Profiles (*.json)|*.json|All Files (*.*)|*.*"
                                    if ($fd.ShowDialog($MainForm) -eq [System.Windows.Forms.DialogResult]::OK -and $fd.FileName) {
                                        $rawImp = Get-Content -LiteralPath $fd.FileName -Raw -ErrorAction Stop | ConvertFrom-Json -AsHashtable
                                        $impList = if ($rawImp -is [hashtable] -and $rawImp.ContainsKey("profiles")) { @($rawImp["profiles"]) } else { @($rawImp) }
                                        $cnt = 0
                                        foreach ($ip in $impList) {
                                            if ($ip -is [hashtable]) {
                                                $null = Save-CustomOrEditedProfile -ProfileHash $ip
                                                $cnt++
                                            }
                                        }
                                        Update-TrayProfilesSubmenu
                                        Send-ProfilesStateToUi -Notice "Imported $cnt profile(s) from $(Split-Path -Leaf $fd.FileName)."
                                    }
                                    $fd.Dispose()
                                }
                            }
                        } catch {
                            Send-ProfilesStateToUi -Notice ("Profiles error: " + $_.Exception.Message) -NoticeError $true
                        }
                        return
                    }

                    if ($Payload.command -eq "GET_APP_SETTINGS") {
                        Send-AppSettingsStateToUi
                        return
                    }

                    if ($Payload.command -eq "SAVE_APP_SETTINGS") {
                        try {
                            $incomingHash = ($RawMessage | ConvertFrom-Json -AsHashtable)["settings"]
                            $prevAutoStart = [bool]$Global:AppSettings.general.startWithWindows
                            $prevStartMin  = [bool]$Global:AppSettings.general.startMinimized
                            $saved = Save-CoreWatchAppSettings -Settings $incomingHash
                            $Global:AppSettings = $saved

                            # Apply live telemetry cadence immediately without restarting CoreWatch
                            $cad = Get-CoreWatchTelemetryCadence -Profile $Global:AppSettings.telemetry.pollingProfile
                            $global:SharedData.PollingProfile = [string]$Global:AppSettings.telemetry.pollingProfile
                            $global:SharedData.FastCadenceMs  = [int]$cad.fastMs
                            $global:SharedData.FullDashMs     = [int]$cad.fullDashMs
                            $global:SharedData.FullBgMs       = [int]$cad.fullBgMs
                            if ($null -ne $global:TelemetryLoopTimer) {
                                $global:TelemetryLoopTimer.Interval = [int]$cad.uiTimerMs
                            }
                            $global:SharedData.ForceRefresh = $true

                            $noticeMsg = "Settings saved."
                            $noticeErr = $false

                            $wantAutoStart = [bool]$Global:AppSettings.general.startWithWindows
                            $wantStartMin  = [bool]$Global:AppSettings.general.startMinimized
                            if ($wantAutoStart -ne $prevAutoStart -or ($wantAutoStart -and $wantStartMin -ne $prevStartMin)) {
                                $autoRes = Set-CoreWatchAutoStart -Enable $wantAutoStart -RootPath $Global:NodeWatchRoot -Minimized $wantStartMin
                                $Global:AppSettings.general.startWithWindows = [bool]$autoRes.enabled
                                $Global:AppSettings = Save-CoreWatchAppSettings -Settings $Global:AppSettings
                                $noticeMsg = "Settings saved. $($autoRes.message)"
                                if (-not $autoRes.ok) { $noticeErr = $true }
                            }

                            Send-AppSettingsStateToUi -Notice $noticeMsg -NoticeError $noticeErr
                        } catch {
                            Send-AppSettingsStateToUi -Notice ("Failed to save settings: " + $_.Exception.Message) -NoticeError $true
                        }
                        return
                    }

                    if ($Payload.command -eq "DETECT_DEFAULT_EDITOR") {
                        $detected = Get-CoreWatchDefaultEditorPath
                        Send-CoreWatchMessageToUi -PayloadObj @{
                            type   = "BROWSE_FILE_RESULT"
                            target = "settings_editor"
                            path   = $detected
                            notice = if ($detected) { "Detected editor: $detected" } else { "Could not auto-detect VS Code or Cursor. Use Browse to select manually." }
                        }
                        return
                    }

                    if ($Payload.command -eq "OPEN_APPDATA_FOLDER") {
                        try { Start-Process explorer.exe -ArgumentList "`"$(Get-CoreWatchAppDataDir)`"" } catch {}
                        return
                    }

                    if ($Payload.command -eq "OPEN_DIRECTORY_PATH") {
                        $dirToOpen = ([string]$Payload.path).Trim()
                        if ($dirToOpen) {
                            try {
                                if (-not (Test-Path -LiteralPath $dirToOpen)) {
                                    $null = New-Item -ItemType Directory -Path $dirToOpen -Force
                                }
                                Start-Process explorer.exe -ArgumentList "`"$dirToOpen`""
                            } catch {}
                        }
                        return
                    }

                    if ($Payload.command -eq "OPEN_EXTERNAL_URL") {
                        $url = ([string]$Payload.url).Trim()
                        if ($url -match '^https?://') {
                            try { Start-Process $url } catch {}
                        }
                        return
                    }

                    if ($Payload.command -eq "CHECK_APP_UPDATE") {
                        Start-AsyncTabTask -FallbackType "APP_UPDATE_STATUS" -Arguments @($Global:NodeWatchRoot) -ScriptBlock {
                            param($RootPath)
                            . (Join-Path $RootPath "modules\core\CoreWatchSettings.ps1")
                            $res = Test-CoreWatchAppUpdate -RootPath $RootPath
                            return ($res | ConvertTo-Json -Compress -Depth 5)
                        }
                        return
                    }

                    if ($Payload.command -eq "EXPORT_APP_SETTINGS") {
                        $sfd = New-Object System.Windows.Forms.SaveFileDialog
                        $sfd.Title    = "Export CoreWatch Settings Backup (JSON)"
                        $sfd.Filter   = "JSON Settings (*.json)|*.json|All Files (*.*)|*.*"
                        $sfd.FileName = "CoreWatch_Settings_$($env:COMPUTERNAME)_$(Get-Date -Format 'yyyyMMdd').json"
                        $defExp = [string]$Global:AppSettings.directories.exportsRoot
                        if ($defExp -and (Test-Path -LiteralPath $defExp -PathType Container)) { $sfd.InitialDirectory = $defExp }
                        if ($sfd.ShowDialog($MainForm) -eq [System.Windows.Forms.DialogResult]::OK -and $sfd.FileName) {
                            try {
                                $json = $Global:AppSettings | ConvertTo-Json -Depth 8
                                [System.IO.File]::WriteAllText($sfd.FileName, $json, (New-Object System.Text.UTF8Encoding($false)))
                                Send-AppSettingsStateToUi -Notice "Exported settings to $($sfd.FileName)."
                            } catch {
                                Send-AppSettingsStateToUi -Notice ("Export failed: " + $_.Exception.Message) -NoticeError $true
                            }
                        }
                        $sfd.Dispose()
                        return
                    }

                    if ($Payload.command -eq "IMPORT_APP_SETTINGS") {
                        $fd = New-Object System.Windows.Forms.OpenFileDialog
                        $fd.Title  = "Import CoreWatch Settings Backup (JSON)"
                        $fd.Filter = "JSON Settings (*.json)|*.json|All Files (*.*)|*.*"
                        if ($fd.ShowDialog($MainForm) -eq [System.Windows.Forms.DialogResult]::OK -and $fd.FileName) {
                            try {
                                $rawTxt = Get-Content -LiteralPath $fd.FileName -Raw -ErrorAction Stop
                                $impHash = $rawTxt | ConvertFrom-Json -AsHashtable
                                $Global:AppSettings = Save-CoreWatchAppSettings -Settings $impHash
                                $cad = Get-CoreWatchTelemetryCadence -Profile $Global:AppSettings.telemetry.pollingProfile
                                $global:SharedData.PollingProfile = [string]$Global:AppSettings.telemetry.pollingProfile
                                $global:SharedData.FastCadenceMs  = [int]$cad.fastMs
                                $global:SharedData.FullDashMs     = [int]$cad.fullDashMs
                                $global:SharedData.FullBgMs       = [int]$cad.fullBgMs
                                if ($null -ne $global:TelemetryLoopTimer) { $global:TelemetryLoopTimer.Interval = [int]$cad.uiTimerMs }
                                $autoRes = Set-CoreWatchAutoStart -Enable ([bool]$Global:AppSettings.general.startWithWindows) -RootPath $Global:NodeWatchRoot -Minimized ([bool]$Global:AppSettings.general.startMinimized)
                                $Global:AppSettings.general.startWithWindows = [bool]$autoRes.enabled
                                $Global:AppSettings = Save-CoreWatchAppSettings -Settings $Global:AppSettings
                                $global:SharedData.ForceRefresh = $true
                                Send-AppSettingsStateToUi -Notice "Imported settings from $(Split-Path -Leaf $fd.FileName)."
                            } catch {
                                Send-AppSettingsStateToUi -Notice ("Import failed: " + $_.Exception.Message) -NoticeError $true
                            }
                        }
                        $fd.Dispose()
                        return
                    }

                    if ($Payload.command -eq "RESET_APP_SETTINGS") {
                        try {
                            $null = Set-CoreWatchAutoStart -Enable $false -RootPath $Global:NodeWatchRoot -Minimized $false
                            $Global:AppSettings = Save-CoreWatchAppSettings -Settings (Get-CoreWatchDefaultSettingsObject)
                            $cad = Get-CoreWatchTelemetryCadence -Profile $Global:AppSettings.telemetry.pollingProfile
                            $global:SharedData.PollingProfile = [string]$Global:AppSettings.telemetry.pollingProfile
                            $global:SharedData.FastCadenceMs  = [int]$cad.fastMs
                            $global:SharedData.FullDashMs     = [int]$cad.fullDashMs
                            $global:SharedData.FullBgMs       = [int]$cad.fullBgMs
                            if ($null -ne $global:TelemetryLoopTimer) { $global:TelemetryLoopTimer.Interval = [int]$cad.uiTimerMs }
                            $global:SharedData.ForceRefresh = $true
                            Send-AppSettingsStateToUi -Notice "All application settings reset to defaults."
                        } catch {
                            Send-AppSettingsStateToUi -Notice ("Reset failed: " + $_.Exception.Message) -NoticeError $true
                        }
                        return
                    }

                    if ($Payload.command -eq "RELAUNCH_AS_ADMIN") {
                        try {
                            $spec = Get-CoreWatchLaunchSpec -RootPath $Global:NodeWatchRoot -Minimized $false
                            if ($spec.arguments) {
                                Start-Process -FilePath $spec.filePath -ArgumentList $spec.arguments -Verb RunAs -ErrorAction Stop
                            } else {
                                Start-Process -FilePath $spec.filePath -Verb RunAs -ErrorAction Stop
                            }
                            $Global:ForceExitApp = $true
                            $MainForm.Close()
                        } catch {
                            $errJson = @{ type = "DASHBOARD_CONTROL_RESULT"; ok = $false; control = "RELAUNCH_AS_ADMIN"; message = "Elevation canceled or failed: $($_.Exception.Message)" } | ConvertTo-Json -Compress
                            $global:WebViewControl.CoreWebView2.PostWebMessageAsString([Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes($errJson)))
                        }
                        return
                    }

                    if ($Payload.command -eq "SET_POWER_PLAN") {
                        $TargetGuid = $Payload.guid
                        if ($TargetGuid -eq "e9a42b02-d5df-448d-aa00-03f14749eb61") {
                            $Existing = powercfg /l | Select-String "Ultimate Performance"
                            if ($Existing -and $Existing.ToString() -match "([a-z0-9]{8}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{12})") {
                                $TargetGuid = $Matches[1]
                            } else {
                                $NewScheme = powercfg -duplicatescheme e9a42b02-d5df-448d-aa00-03f14749eb61
                                if ($NewScheme -match "([a-z0-9]{8}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{12})") {
                                    $TargetGuid = $Matches[1]
                                }
                            }
                        }
                        powercfg /setactive $TargetGuid
                        $global:SharedData.ForceRefresh = $true
                        return
                    }

                    if ($Payload.command -eq "DISABLE_TELEMETRY") {
                        Stop-Service -Name DiagTrack, dmwappushservice -Force -ErrorAction SilentlyContinue
                        Set-Service -Name DiagTrack, dmwappushservice -StartupType Disabled -ErrorAction SilentlyContinue
                        $global:SharedData.ForceRefresh = $true
                        return
                    }

                    if ($Payload.command -eq "RENAME_COMPUTER") {
                        Rename-Computer -NewName $Payload.newName -Force -Confirm:$false -ErrorAction SilentlyContinue
                        return
                    }
                    if ($Payload.command -eq "RENAME_WORKGROUP") {
                        Add-Computer -WorkgroupName $Payload.newName -Force -Confirm:$false -ErrorAction SilentlyContinue
                        return
                    }
                } catch {
                    Write-Warning "Failed to dispatch JSON command frame: $_"
                }
            }
        }
    }
}
# =========================================================================
# DESKTOP SYSTEM TRAY CONTROLLER AND RUNTIME HOOKS
# =========================================================================
$global:SystemTrayIcon = New-Object System.Windows.Forms.NotifyIcon
$global:SystemTrayIcon.Text = "CoreWatch Host Engine"
$global:SystemTrayIcon.Visible = $true
$global:SystemTrayIcon.Icon = if ($null -ne $TrayIconInstance) { $TrayIconInstance } else { $AppIconInstance }

$TrayContextMenu = New-Object System.Windows.Forms.ContextMenuStrip
$ShowMenuItem = $TrayContextMenu.Items.Add("Show CoreWatch")
$ShowMenuItem.Add_Click({ Restore-CoreWatchMainWindow })
$global:TrayModesSubMenu = $null
if ($Global:ProfilesModuleAvailable) {
    $global:TrayModesSubMenu = New-Object System.Windows.Forms.ToolStripMenuItem("Switch Mode")
    $null = $TrayContextMenu.Items.Add($global:TrayModesSubMenu)
    Update-TrayProfilesSubmenu
}
$SettingsMenuItem = $TrayContextMenu.Items.Add("Settings...")
$SettingsMenuItem.Add_Click({
    Restore-CoreWatchMainWindow
    Send-CoreWatchMessageToUi -PayloadObj @{ type = "OPEN_SETTINGS_MODAL" }
})
$null = $TrayContextMenu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
$ExitMenuItem = $TrayContextMenu.Items.Add("Terminate Engine")
$ExitMenuItem.Add_Click({
    $Global:ForceExitApp = $true
    $MainForm.Close()
})
$global:SystemTrayIcon.ContextMenuStrip = $TrayContextMenu

$global:SystemTrayIcon.Add_Click({
    param($evtSource, $evtArgs)
    if ($evtArgs.Button -eq [System.Windows.Forms.MouseButtons]::Left) {
        Restore-CoreWatchMainWindow
    }
})

# =========================================================================
# VISIBILITY-AWARE THROTTLING & WEBVIEW2 SUSPEND ON MINIMIZE
# =========================================================================
function Sync-CoreWatchVisibilityState {
    # WinForms fires Resize while Visible is still $false before initial Shown;
    # ignore pre-Shown visibility checks so startup never falsely pauses telemetry.
    if (-not $Global:MainFormHasShown) { return }
    $isMin = ($MainForm.WindowState -eq [System.Windows.Forms.FormWindowState]::Minimized) -or (-not $MainForm.Visible)
    if ($isMin -ne $global:SharedData.IsMinimized) {
        $global:SharedData.IsMinimized = $isMin
        if ($isMin) {
            if ($null -ne $global:TelemetryLoopTimer) { $global:TelemetryLoopTimer.Stop() }
            try {
                if ($null -ne $global:WebViewControl.CoreWebView2) {
                    $null = $global:WebViewControl.CoreWebView2.TrySuspendAsync()
                }
            } catch {}
            if ("CoreWatch.Win32" -as [type]) { [CoreWatch.Win32]::TrimWorkingSet() }
        } else {
            $global:SharedData.ForceRefresh = $true
            if ($null -ne $global:TelemetryLoopTimer -and -not $global:TelemetryLoopTimer.Enabled) {
                $global:TelemetryLoopTimer.Start()
            }
            & $global:FlushTelemetryToUi
        }
    }
}

$MainForm.Add_Resize({ Sync-CoreWatchVisibilityState })
$MainForm.Add_VisibleChanged({ Sync-CoreWatchVisibilityState })

# =========================================================================
# TEARDOWN & LIFECYCLE DESTRUCTOR CLEANUP ROUTINES
# =========================================================================
$MainForm.Add_FormClosing({
    param($evtSource, $evtArgs)
    if (-not $Global:ForceExitApp -and
        $evtArgs.CloseReason -eq [System.Windows.Forms.CloseReason]::UserClosing -and
        $Global:AppSettings -and $Global:AppSettings.general.minimizeToTrayOnClose) {
        $evtArgs.Cancel = $true
        $MainForm.WindowState = [System.Windows.Forms.FormWindowState]::Minimized
        $MainForm.ShowInTaskbar = $false
        $MainForm.Hide()
        return
    }
    # [PHASE 1] Persist final window bounds & preferences before teardown
    try {
        if (-not ($Global:SavedUiSettings -is [hashtable])) { $Global:SavedUiSettings = @{} }
        $saveRect = if ($MainForm.WindowState -eq [System.Windows.Forms.FormWindowState]::Normal) {
            $MainForm.Bounds
        } else {
            $MainForm.RestoreBounds
        }
        if ($saveRect.Width -ge 320 -and $saveRect.Height -ge 320) {
            $Global:SavedUiSettings["windowBounds"] = @{
                x      = [int]$saveRect.X
                y      = [int]$saveRect.Y
                width  = [int]$saveRect.Width
                height = [int]$saveRect.Height
            }
        }
        $Global:SavedUiSettings["alwaysOnTop"]    = [bool]$MainForm.TopMost
        $Global:SavedUiSettings["opacity"]        = [math]::Round([double]$MainForm.Opacity, 2)
        $Global:SavedUiSettings["windowLockMode"] = [string]$Global:WindowLockMode
        Save-CoreWatchUiSettings -Settings $Global:SavedUiSettings
    } catch {}
    # Always release Keep Screen Awake execution state cleanly on exit
    Sync-CoreWatchKeepAwake -Enable $false
    if ($null -ne $global:SystemTrayIcon) { $global:SystemTrayIcon.Visible = $false; $global:SystemTrayIcon.Dispose() }
    if ($null -ne $TrayIconInstance) { $TrayIconInstance.Dispose() }
    if ($null -ne $IconHandle) { [CoreWatch.Win32]::DestroyIcon($IconHandle) }
    if ($null -ne $global:SpeedTestTimer) { $global:SpeedTestTimer.Stop(); $global:SpeedTestTimer.Dispose() }
    if ($null -ne $global:SpeedTestPipeline) { $global:SpeedTestPipeline.Dispose() }
    if ($null -ne $global:ActiveTabTasks) {
        foreach ($t in @($global:ActiveTabTasks)) {
            try { if ($t.Timer) { $t.Timer.Stop(); $t.Timer.Dispose() } } catch {}
            try { if ($t.PS) { $t.PS.Dispose() } } catch {}
        }
        $global:ActiveTabTasks.Clear()
    }
    if ($null -ne $global:IdentifyOverlayTimer) { $global:IdentifyOverlayTimer.Stop(); $global:IdentifyOverlayTimer.Dispose() }
    if ($null -ne $global:IdentifyOverlayForms) {
        foreach ($f in @($global:IdentifyOverlayForms)) { try { $f.Close(); $f.Dispose() } catch {} }
    }
    try {
        Get-Process -Name "CoreWatchSensorHelper" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    } catch {}
    $global:TelemetryLoopTimer.Stop()
    $global:SharedData.IsRunning = $false
    if ($null -ne $PowerShellPool) { $PowerShellPool.Dispose() }
    if ($null -ne $Runspace) { $Runspace.Close(); $Runspace.Dispose() }
})

# =========================================================================
# WEBVIEW2 WEB ENGINE PROVISIONING AND SYSTEM APPS LAUNCH (LEAN MEMORY PROFILE)
# =========================================================================
$FixedRuntimePath = Join-Path $BinPath "WebView2FixedRuntime"
$BrowserExecutableFolder = if (Test-Path $FixedRuntimePath) { [System.IO.Path]::GetFullPath($FixedRuntimePath) } else { $null }

$WebViewBrowserArgs = "--js-flags=--max-old-space-size=96 --disable-background-networking --disable-component-update --disable-domain-reliability --disable-features=Translate,OptimizationHints,MediaRouter"
$WebViewEnvOptions = $null
try {
    $WebViewEnvOptions = [Microsoft.Web.WebView2.Core.CoreWebView2EnvironmentOptions]::new($WebViewBrowserArgs, $null, $null, $false, $null)
} catch {
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $WebViewBrowserArgs
}

$EnvCreationTask = if ($null -ne $WebViewEnvOptions) {
    [Microsoft.Web.WebView2.Core.CoreWebView2Environment]::CreateAsync($BrowserExecutableFolder, $UserDataFolder, $WebViewEnvOptions)
} else {
    [Microsoft.Web.WebView2.Core.CoreWebView2Environment]::CreateAsync($BrowserExecutableFolder, $UserDataFolder)
}
while (-not $EnvCreationTask.IsCompleted) { [System.Windows.Forms.Application]::DoEvents(); [System.Threading.Thread]::Sleep(1) }
$WebViewEnvironment = $EnvCreationTask.Result

$global:WebViewControl.Add_CoreWebView2InitializationCompleted({
    param($evtSource, $evtArgs)
    if ($evtArgs.IsSuccess) {
        $global:WebViewControl.CoreWebView2.Settings.AreDefaultContextMenusEnabled = $false
        $global:WebViewControl.CoreWebView2.Settings.AreDevToolsEnabled = [bool]$Global:EnableDevTools
        $global:WebViewControl.Add_WebMessageReceived($HandleUiMessageEvent)
        $global:WebViewControl.Source = "file:///" + ((Join-Path $Global:NodeWatchRoot "modules\layouts\index.html") -replace '\\', '/')
    }
})

$null = $global:WebViewControl.EnsureCoreWebView2Async($WebViewEnvironment)
[System.Windows.Forms.Application]::Run($MainForm)
