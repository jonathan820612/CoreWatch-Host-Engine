# CoreWatch Host Engine

**CoreWatch** is a frameless, dark-themed Windows 10/11 system telemetry dashboard, hardware control deck, administration suite, and diagnostic logging workbench built with **PowerShell 7**, **WinForms**, **Microsoft Edge WebView2**, and native Win32/CCD/CIM APIs.

---

## Key Features

### Live Telemetry Dashboard (`📟 Dashboard`)
- **Hardware Metrics**: Real-time CPU load, dynamic boost clock speed, L1/L2/L3 Cache Matrix (with AMD 3D V-Cache detection), GPU load/power/temp/VRAM allocation, RAM & Pagefile commitment, thermal/power throttling indicators, and live Top Resource Consumer callout.
- **CPU Die Temperature Engine**: Multi-provider sensor pipeline supporting standalone `LibreHardwareMonitorLib.dll` (via `.NET Framework 4.x` `CoreWatchSensorHelper.exe` bridge for AMD Ryzen `Tctl/Tdie` & Intel `CPU Package`), LibreHardwareMonitor/OpenHardwareMonitor WMI, Core Temp shared memory, and native Windows ACPI thermal zones.
- **System Identity & Infrastructure**: Hostname, Domain/Workgroup, Windows Edition & UBR build, Update & Pending Reboot status, DirectX, Hardware Virtualization, Secure Boot, Elevation status (with 1-click relaunch as Admin), last crash/BSOD timestamp, Motherboard, BIOS, Power Plan switcher, Uptime, and Audio devices.
- **Interactive Multi-Monitor Display Deck**: Per-monitor selector with native **Identify** overlay badges across all screens, driver-verified **Refresh Rate** switcher (`CDS_TEST` pre-validated), live **DPI Scale** switcher (native Windows CCD API), **Orientation** switcher, **HDR** toggle, and **Night Light** toggle + warmth slider.
- **Network Profile & Storage**: 4-column network matrix (IPv4, exact CIDR subnet mask, gateway, DHCP/Static, external IPv4, WLAN SSID with Windows 11 24H2/25H2 Location-privacy fallback, Firewall/Defender/Discovery/Sharing toggles, live RX/TX bandwidth bar, Cloudflare speed test), plus Storage volumes with SMART health and inline relabeling.
- **Extended Live Log Console**: Full-height scrollable timestamped diagnostic console + all-edge native OS window resizing (up to `1080×1920` HD Portrait).

### Modular Management & Diagnostic Tabs
- **📡 Network Manager & Diagnostics**: Static IP/Gateway/DNS provisioning, DHCP reversion, adapter toggle/restart/rename, DNS cache flush, ping, traceroute, port tester, and routing tables.
- **🚀 Startup Apps**: View, add, enable/disable (native `StartupApproved` binary flags), locate, or remove Registry & Startup Folder boot items.
- **📂 Sharing Center**: Create/remove SMB shares and manage per-account share permissions with protected system-folder guards.
- **📦 Installed Apps**: Index 64-bit, 32-bit, and Current User apps with automatic System/Runtime protection, native Uninstall & Modify/Repair, on-demand folder size measurement, Registry jump, and safe **Move to Another Drive/Directory** via `robocopy` + transparent NTFS Directory Junctions.
- **🧩 System Devices**: Windows Device Manager-style collapsible hardware tree enriched with driver versions, release date & age warnings, digital signers, INF packages, kernel services, bus locations, Hardware IDs, rescan, restart, and enable/disable controls.
- **⚡ Tasks & Ports**: Inspect active processes, services, and listening TCP/UDP ports.
- **🗂️ File Organizer**: Organize default Windows user folders (`Downloads`, `Pictures`, `Documents`, `Videos`, `Music`, `Desktop`) plus any custom folders by **Media Type** or **File Extension** into customizable target folder names, complete with **Dry-Run Preview** and **Undo Last Run**.
- **🛡️ Security & Repair / 🐧 WSL Manager**: Quick Windows servicing (`DISM`/`SFC`), network/WU repair tools, RDP/proxy/hosts controls, and WSL distro lifecycle management.
- **🩺 UltimaDiagX**: Consolidated multi-channel Windows Event Log & external program log diagnostic engine with automated **System Health Score & Synopsis**, 8-subsystem health matrix, BSOD/WER crash dump scanner, live watch mode, native Windows Event ID / HRESULT / NTSTATUS / BugCheck code translator, and full-system Markdown report export.

---

## Project Layout

```text
TFOL-Project/
├── Start-NodeWatch.ps1          # Main WinForms + WebView2 host & background runspaces
├── version.json                 # Source-controlled semantic & build version tracker
├── images/Icon.png              # Application icon asset
├── bin/                         # WebView2 wrapper DLLs (+ optional LibreHardwareMonitorLib.dll)
├── build/
│   ├── Build-Beta.ps1           # Automated versioned build & packaging pipeline
│   ├── CoreWatchLauncher.cs     # Native silent x64 WinForms launcher -> CoreWatch.exe
│   ├── CoreWatchSensorHelper.cs # .NET 4.x bridge for LibreHardwareMonitorLib.dll
│   └── BUILD-HISTORY.md         # Auto-appended build provenance log
└── modules/
    ├── layouts/                 # index.html, style.css, app.js
    ├── telemetry/               # Hardware, Display, Storage, Network, DashboardControls
    └── tabs/                    # InstalledApps, DeviceManager, FileOrganizer, UltimaDiagX, etc.
```

---

## Requirements

- **OS**: Windows 10 (64-bit) or Windows 11 (64-bit)
- **PowerShell**: [PowerShell 7+](https://aka.ms/powershell-release?tag=stable) (`pwsh.exe`)
- **WebView2 Runtime**: Microsoft Edge WebView2 Evergreen Runtime (preinstalled on Windows 11)
- **PawnIO Driver (Required for Live Desktop CPU Die Temps with LibreHardwareMonitorLib v0.9.5+)**:
  - LibreHardwareMonitor v0.9.5+ replaced the legacy WinRing0 driver with **[PawnIO](https://pawnio.eu/)** — a Microsoft-signed, Windows Defender / HVCI-friendly kernel driver.
  - **Portable Beta users**: Install PawnIO once via `winget install namazso.PawnIO` (or download from [pawnio.eu](https://pawnio.eu/)) — or simply click the `-- °C` CPU temperature badge inside CoreWatch if PawnIO is missing to launch the installer directly.
  - **Inno Setup Installer users**: `build\CoreWatch.iss` automatically checks whether PawnIO is installed and offers to install it during setup (either via `winget` or offline by placing `PawnIO_setup.exe` in `build\redist\PawnIO_setup.exe` before building).
  - **Alternative (No Driver Install in CoreWatch)**: Run **Core Temp** or **LibreHardwareMonitor** in the background and CoreWatch will automatically read CPU temps from it.

---

## Running from Source (Development)

```powershell
# Launch directly with PowerShell 7 (DevTools enabled automatically in dev mode)
pwsh -NoProfile -ExecutionPolicy Bypass -File .\Start-NodeWatch.ps1
```

---

## Building & Versioned Releases

CoreWatch includes a zero-dependency build pipeline ([`build/Build-Beta.ps1`](build/Build-Beta.ps1)) that compiles using Windows' built-in `.NET Framework 4.x` C# compiler (`csc.exe`), tracks versions via [`version.json`](version.json), stamps Git branch & commit metadata into the binaries and `build-info.json`, and produces a clean portable package.

### Standard Local Build (Single-Digit Rollover Versioning — Never `.10`)
```powershell
.\build\Build-Beta.ps1 -RequireAdmin
```
Versions roll over cleanly at `9 → 0` into the next segment (`v0.9.0-beta.9` → `v0.9.1-beta` [Beta #10] → `v0.9.1-beta.1` [Beta #11] → ...), while `buildNumber` in `version.json` tracks the monotonic beta count. Each run automatically:
1. Increments `version.json` and logs the build in `build\BUILD-HISTORY.md`.
2. Captures Git branch & short commit SHA into `AssemblyInformationalVersion` and `build-info.json`.
3. Generates multi-resolution `CoreWatch.ico`, compiles `CoreWatchSensorHelper.exe` + `CoreWatch.exe`, packages `CoreWatch-<ver>-Portable.zip`, compiles `CoreWatch-<ver>-Setup.exe` (via Inno Setup 6), and writes `SHA256SUMS.txt` + `RELEASE-NOTES.md` (commits since previous tag).

### One-Command Automated GitHub Release (`build/Publish-Release.ps1`)
```powershell
# Build Portable + Setup .exe, commit version bump, create annotated tag, push, and publish GitHub Release:
.\build\Publish-Release.ps1

# Optional custom release title or Draft preview:
.\build\Publish-Release.ps1 -ReleaseTitle "Disk Map & Optimization Update"
.\build\Publish-Release.ps1 -Draft
```
**One-Time GitHub Auth Setup (Choose Either)**:
- **Option A (Recommended — GitHub CLI)**: `winget install GitHub.cli` then `gh auth login`
- **Option B (Environment Token)**: Set `$env:GITHUB_TOKEN` (a GitHub Fine-Grained Personal Access Token with **Contents: Read & Write** permission on this repo)

### Useful Build Options
```powershell
# Bump patch / minor / major version instead of build number
.\build\Build-Beta.ps1 -Bump patch -RequireAdmin
.\build\Build-Beta.ps1 -Bump minor -Prerelease "" -RequireAdmin   # Stable release (non-prerelease)
.\build\Build-Beta.ps1 -Bump none -RequireAdmin                   # Rebuild without incrementing version.json

# Commit version.json + BUILD-HISTORY.md and create an annotated Git tag without publishing to GitHub
.\build\Build-Beta.ps1 -RequireAdmin -GitCommit -GitTag

# Bundle offline WebView2FixedRuntime (if present in bin\)
.\build\Build-Beta.ps1 -IncludeFixedRuntime
```

### Building a Windows `Setup.exe` Installer (Optional)
Install [Inno Setup 6](https://jrsoftware.org/isinfo.php) once:
```powershell
winget install JRSoftware.InnoSetup
```
Then run `.\build\Build-Beta.ps1` — it automatically detects `ISCC.exe` and compiles `dist\CoreWatch-<ver>-Setup.exe` from the generated `build\CoreWatch.iss`.

### Runtime User Data Location
Writable runtime files are stored under `%LOCALAPPDATA%\CoreWatch\` (`WebView2UserData` and `FileOrganizerLastUndo.json`) so CoreWatch can be safely installed into `C:\Program Files\CoreWatch\`.

---

## Notes for Beta Testers
- **Administrator Privileges**: Standard-user mode works for monitoring, display controls, and diagnostics; running as Administrator unlocks full hardware sensor access (`LibreHardwareMonitorLib`), network/firewall toggles, service/device controls, and Program Files app moves.
- **DevTools in Built Releases**: DevTools are disabled by default in `CoreWatch.exe` (`-Release`). To enable them for troubleshooting, launch `CoreWatch.exe -DevTools`.
- **SmartScreen**: Unsigned beta builds may display a Windows SmartScreen prompt on first launch until signed with a code-signing certificate.
