<div align="center">

<img src="images/Icon.png" alt="CoreWatch Logo" width="84" />

# CoreWatch Host Engine

**Frameless, modular Windows 10/11 telemetry dashboard, hardware control deck, system administration suite, and developer workbench.**

Built with **PowerShell 7**, **WinForms**, **Microsoft Edge WebView2**, and native Win32 / CCD / WNF / CIM APIs.

[![Latest Release](https://img.shields.io/github/v/release/jonathan820612/CoreWatch-Host-Engine?include_prereleases&style=flat-square&color=3b82f6)](https://github.com/jonathan820612/CoreWatch-Host-Engine/releases)
[![Platform](https://img.shields.io/badge/Platform-Windows%2010%20%2F%2011%20(x64)-0078D6?style=flat-square)](https://github.com/jonathan820612/CoreWatch-Host-Engine/releases)
[![PowerShell](https://img.shields.io/badge/PowerShell-7%2B-5391FE?style=flat-square)](https://aka.ms/powershell-release?tag=stable)

<br />

![CoreWatch Live Dashboard](images/dashboard-cover.jpg)

</div>

---

## Download & Installation

Grab the latest build from **[GitHub Releases](https://github.com/jonathan820612/CoreWatch-Host-Engine/releases)**:

| Package | Best For |
|---|---|
| **`CoreWatch-<ver>-Setup.exe`** | **Recommended** — Modular Inno Setup installer with a component selector for all **15 feature modules** (**Full Suite** default, **Home & Essentials**, **IT & SysAdmin**, **Developer Workstation**, or **Custom**), Start Menu / Desktop shortcuts, optional PawnIO sensor driver setup, and Start-with-Windows support. |
| **`CoreWatch-<ver>-Portable.zip`** | **Zero-install Portable** — Extract anywhere and run `CoreWatch.exe` directly with all 15 modules included. |
| **`CoreWatch-<ver>-SHA256SUMS.txt`** | SHA-256 verification checksums for both release artifacts. |

---

## Key Features

### Live Telemetry Dashboard (`📟 Dashboard`)
- **Hardware Metrics**: Real-time CPU load, dynamic boost clock, thermal/power throttling badge, L1/L2/L3 Cache Matrix (with AMD 3D V-Cache detection), GPU load/power/temp/VRAM allocation, RAM & Pagefile commitment, and live Top Resource Consumer callout.
- **Multi-Provider CPU Die Temperature Engine**: Supports bundled `LibreHardwareMonitorLib.dll` (via the `.NET Framework 4.x` `CoreWatchSensorHelper.exe` bridge for AMD Ryzen `Tctl/Tdie` & Intel `CPU Package`), LibreHardwareMonitor/OpenHardwareMonitor WMI, Core Temp shared memory, and native Windows ACPI thermal zones, with `°C` / `°F` toggle.
- **System Identity & Infrastructure**: Hostname, Domain/Workgroup, Windows Edition & UBR build, Update & Pending Reboot status, DirectX, Virtualization & Secure Boot, PowerShell version/update badge, Java runtime switcher, Windows Telemetry toggle, Elevation badge (with 1-click Admin relaunch), last crash/BSOD timestamp, Motherboard, BIOS, Power Plan switcher, Uptime, and Audio devices.
- **Interactive Multi-Monitor Display Deck**: Per-monitor selector with PerMonitorV2 DPI-aware native **Identify** overlay badges across every screen, driver-verified **Refresh Rate** switcher (`CDS_TEST` pre-validated), live **DPI Scale** switcher (native Windows CCD API), **Orientation**, **HDR** toggle, Color Profile, and **Night Light** toggle + warmth slider.
- **Network Profile & Storage**: 4-column network matrix (IPv4, CIDR subnet mask, gateway, DHCP/Static, external IPv4, WLAN SSID with Windows 11 24H2/25H2 Location-privacy fallback, Firewall/Defender/Discovery/Sharing toggles, live RX/TX bandwidth bar, Cloudflare speed test), plus Storage volumes with SMART health/wear %, IO latency, inline relabeling, and 1-click **Disk Map** jump.
- **Customizable Workspace & Window Controls**:
  - **`Ctrl+K` Command Palette** for instant navigation and profile switching.
  - **`✏️ Layout` Editor** to reorder or toggle dashboard cards, plus a collapsible **Side Telemetry Dock** and full-height diagnostic log console.
  - **3-State Window Lock (`🔓` / `🔒` / `🔐`)**: 1st click locks window position `(X, Y)` (while still permitting right/bottom resize), 2nd click locks both position and size, 3rd click unlocks — persisted across restarts.
  - **Always-on-Top Pin (`📌`)**, multi-monitor window jump, and native all-edge resizing.

### Top-Level Management & Diagnostic Tabs
- **📡 Network (`Network Manager & Diagnostics`)**: Static IP/Gateway/DNS provisioning, DHCP reversion, adapter toggle/restart/rename, Wi-Fi RSSI, DNS cache flush, ping, traceroute, port tester, and routing tables.
- **🧭 Tasks & Ports**: Inspect active processes, Windows services health, and open TCP/UDP listening sockets.
- **🩺 UltimaDiagX**: Consolidated multi-channel Windows Event Log & external log analyzer with automated **System Health Score & Synopsis**, 8-subsystem health matrix, BSOD/WER crash dump scanner, latest event timestamps, live watch mode, native Windows Event ID / HRESULT / NTSTATUS / BugCheck translator, and Markdown report export.

### `💻 Dev & Work ▾` Suite
- **🐙 GitHub Manager**:
  - Auto-authenticates via signed-in `gh` CLI or a **DPAPI-encrypted** Personal Access Token.
  - **Local Projects**: Scans your Projects Root for Git repositories (branch, modified count, ahead/behind, last commit) with 1-click **VS Code**, **Terminal**, **Explorer**, **Git Pull**, **Releases**, and local `build\Publish-Release.ps1` launch actions.
  - **My Repos & Clone Any URL**: Browse/filter your personal GitHub repos to clone in one click, or clone **any Git URL** into a chosen folder with optional branch, shallow clone, and auto-open in VS Code.
  - **Release Management**: List releases & asset download counts, create new releases (Draft / Pre-release / GitHub Auto-Generated Notes / multi-file asset attachments), upload assets to existing releases, and delete releases.
- **📋 Jira Manager**:
  - Supports **Jira Cloud** (REST v3, Email + Atlassian API Token) and **Jira Server / Data Center** (REST v2, Bearer PAT), with API tokens stored **DPAPI-encrypted**.
  - Filter by **Assigned to Me**, **All Open**, **Reported by Me**, **Recent**, **Custom JQL**, and **Project**.
  - Split issue list + inspector with ADF-to-text descriptions, live **workflow transition** buttons, **Assign to Me**, **Copy Git Branch**, **Log Work Time**, **Post Comments**, and **Create Issue**.
- **🐧 WSL Manager**: Manage Windows Subsystem for Linux distros, online catalog installs, import/export, VHDX compaction, and `.wslconfig` tuning.

### `🧰 System ▾` Suite
- **⚡ System Profiles & Modes**: Built-in presets (**Normal**, **Work**, **Gaming**, **Presentation**, **Night**) plus custom profiles, **Capture Current PC Snapshot**, and JSON import/export. Controls native Windows WNF **Do Not Disturb** (Priority / Alarms / Off), Power Plan, Keep Screen Awake, Night Light + warmth %, and per-monitor HDR / Refresh Rate / Scale overrides — with **1-click Revert** and quick switching from the **Header Mode Pill**, **System Tray**, or `Ctrl+K`.
- **🛡️ Security & Repair**: BitLocker, TPM, RDP, Hosts/Proxy/Environment audit, `DISM`/`SFC` servicing, Windows Update & network repairs, and 1-click IT Support ZIP.
- **🚀 Startup Apps**: View, add, enable/disable (native `StartupApproved` binary flags), locate, or remove Registry & Startup Folder boot items.
- **📂 Sharing Center**: Create/remove SMB network shares and manage per-account share permissions with protected system-folder guards.
- **📦 Installed Apps & App Mover**: Index 64-bit, 32-bit, and Current User apps with System/Runtime protection, Uninstall/Modify, folder size calculation, Registry jump, and safe cross-drive **Move to Another Drive** via `robocopy` + NTFS Directory Junctions.
- **⬇️ App Installer & Launcher**: Curated WinGet software catalog (including **ArtCraft Launcher**), batch installs, bulk upgrades, direct **`▶ Launch`** support for installed apps, and a `▶ Launchable` filter pill.
- **🗺️ Disk Map**: Multithreaded WizTree-style visual storage treemap, largest files breakdown, and file extension analytics.
- **🧩 Devices & Drivers**: Collapsible hardware tree enriched with driver versions, release date & age warnings, digital signers, INF packages, kernel services, Hardware IDs, rescan, restart, and enable/disable controls.
- **🗂️ File Organizer**: Rule-based sorting for default Windows user folders (`Downloads`, `Pictures`, `Documents`, `Videos`, `Music`, `Desktop`) or any custom folder by Media Type or Extension, with **Dry-Run Preview** and **1-click Undo**.

### Unified Settings (`⚙️`) & Security
- **General**: Start with Windows (UAC-free Task Scheduler + HKCU fallback), Launch Minimized to Tray, Always on Top, Temperature Unit (`°C` / `°F`), and in-app **Check for Updates**.
- **Directories**: Default Projects Root, Downloads, Backups, and Preferred Editor (`Code.exe`) with native folder/file pickers.
- **Telemetry**: Live polling interval presets & performance controls.
- **Modules & Tabs**: Enable or hide installed modules dynamically at runtime without reinstalling.
- **DPAPI Secrets Vault**: GitHub PATs and Jira API tokens are encrypted per-user with Windows DPAPI (`ProtectedData`, `CurrentUser`) and never saved in plaintext.

---

## Project Layout

```text
CoreWatch-Host-Engine/
├── Start-NodeWatch.ps1              # Main WinForms + WebView2 host, window lock & async runspaces
├── version.json                     # Source-controlled semantic & monotonic beta version tracker
├── images/
│   ├── Icon.png                     # Application icon source
│   └── dashboard-cover.jpg          # README dashboard showcase screenshot
├── bin/                             # WebView2 wrapper DLLs (+ optional LibreHardwareMonitorLib.dll)
├── build/
│   ├── Build-Beta.ps1               # Automated versioned build, modular Inno Setup & packaging pipeline
│   ├── Publish-Release.ps1          # One-command build, tag, push & GitHub Release publisher
│   ├── CoreWatchLauncher.cs         # Native silent x64 WinForms launcher -> CoreWatch.exe
│   ├── CoreWatchSensorHelper.cs     # .NET 4.x bridge for LibreHardwareMonitorLib.dll
│   └── BUILD-HISTORY.md             # Auto-appended build provenance log
└── modules/
    ├── modules-catalog.json         # 15-module manifest driving Settings UI & Inno Setup components
    ├── core/
    │   └── CoreWatchSettings.ps1    # Persistent settings, DPAPI secrets vault, Auto-Start & updater
    ├── layouts/                     # index.html, style.css, app.js
    ├── telemetry/                   # Hardware, Display, Storage, Network, Traffic, DashboardControls
    └── tabs/                        # GitHubManager, JiraManager, ProfilesManager, UltimaDiagX,
                                     # NetworkManager, TasksPortsManager, WslManager, DiskMapper,
                                     # AppInstallerManager, InstalledAppsManager, DeviceManager,
                                     # SecurityRepairManager, StartupManager, SharingManager, FileOrganizer
```

---

## Requirements

- **OS**: Windows 10 (64-bit) or Windows 11 (64-bit)
- **PowerShell**: [PowerShell 7+](https://aka.ms/powershell-release?tag=stable) (`pwsh.exe`)
- **WebView2 Runtime**: Microsoft Edge WebView2 Evergreen Runtime (preinstalled on Windows 11)
- **PawnIO Driver (Required for Live Desktop CPU Die Temps with LibreHardwareMonitorLib v0.9.5+)**:
  - LibreHardwareMonitor v0.9.5+ replaced legacy WinRing0 with **[PawnIO](https://pawnio.eu/)** — a Microsoft-signed, Windows Defender / HVCI-friendly kernel driver.
  - **Portable users**: Install PawnIO once via `winget install namazso.PawnIO` (or download from [pawnio.eu](https://pawnio.eu/)) — or click the `-- °C` CPU temperature badge inside CoreWatch to launch the installer directly.
  - **Setup `.exe` users**: `build\CoreWatch.iss` automatically checks for PawnIO and offers to install it during setup (via `winget`, or offline by placing `PawnIO_setup.exe` in `build\redist\PawnIO_setup.exe` before building).
  - **Alternative**: Run **Core Temp** or **LibreHardwareMonitor** in the background and CoreWatch will automatically read CPU temps from it.
- **Optional Developer Tools**: `git` and [GitHub CLI (`gh`)](https://cli.github.com/) for zero-config GitHub Manager authentication and local repository operations.

---

## Running from Source (Development)

```powershell
# Launch directly with PowerShell 7 (DevTools enabled automatically in dev mode)
pwsh -NoProfile -ExecutionPolicy Bypass -File .\Start-NodeWatch.ps1
```

---

## Building & Versioned Releases

CoreWatch includes a zero-dependency build pipeline ([`build/Build-Beta.ps1`](build/Build-Beta.ps1)) that compiles with Windows' built-in `.NET Framework 4.x` C# compiler (`csc.exe`), dynamically generates the 15-module Inno Setup script from [`modules/modules-catalog.json`](modules/modules-catalog.json), tracks versions in [`version.json`](version.json), stamps Git branch & commit metadata into the binaries and `build-info.json`, and packages both Portable and Setup artifacts.

### Standard Local Build (Single-Digit Rollover Versioning — Never `.10`)
```powershell
.\build\Build-Beta.ps1 -RequireAdmin
```
Versions roll over cleanly at `9 → 0` into the next segment (`v0.9.0-beta.9` → `v0.9.1-beta` [Beta #10] → `v0.9.1-beta.1` [Beta #11] → ...), while `buildNumber` in `version.json` tracks the monotonic beta count. Each run automatically:
1. Captures clean Git branch & short commit SHA into `AssemblyInformationalVersion` and `build-info.json`.
2. Increments `version.json` and logs the build in `build\BUILD-HISTORY.md`.
3. Generates multi-resolution `CoreWatch.ico`, compiles `CoreWatchSensorHelper.exe` + `CoreWatch.exe`, packages `CoreWatch-<ver>-Portable.zip`, compiles `CoreWatch-<ver>-Setup.exe` (via Inno Setup 6), and writes `SHA256SUMS.txt` + `RELEASE-NOTES.md`.

### One-Command Automated GitHub Release (`build/Publish-Release.ps1`)
```powershell
# Build Portable ZIP + Modular Setup .exe, commit version bump, create annotated tag, push, and publish GitHub Release:
.\build\Publish-Release.ps1

# Optional custom release title, patch/minor bump, or Draft preview:
.\build\Publish-Release.ps1 -ReleaseTitle "Modular Installer, Profiles, GitHub & Jira Update"
.\build\Publish-Release.ps1 -Bump patch -Draft
```
**One-Time GitHub Auth Setup (Choose Either)**:
- **Option A (Recommended — GitHub CLI)**: `winget install GitHub.cli` then `gh auth login`
- **Option B (Environment Token)**: Set `$env:GITHUB_TOKEN` (a Fine-Grained PAT with **Contents: Read & Write** on this repo)

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

### Building the Modular Windows `Setup.exe` Installer
Install [Inno Setup 6](https://jrsoftware.org/isinfo.php) once:
```powershell
winget install JRSoftware.InnoSetup
```
Then run `.\build\Build-Beta.ps1` — it automatically detects `ISCC.exe`, reads `modules\modules-catalog.json` to generate `[Types]`, `[Components]`, and per-module `[Files]`, and compiles `dist\CoreWatch-<ver>-Setup.exe`.

### Runtime User Data Location
All writable user state is stored under `%LOCALAPPDATA%\CoreWatch\` so CoreWatch can run cleanly from `C:\Program Files\CoreWatch\`:
- `settings.json`, `ui-settings.json`, `profiles.json`, `jira-config.json`
- `secrets\` (Windows DPAPI-encrypted tokens — never plaintext)
- `WebView2UserData\` and `FileOrganizerLastUndo.json`

---

## Notes for Beta Testers
- **Administrator Privileges**: Standard-user mode works for monitoring, display controls, and diagnostics; running as Administrator unlocks full hardware sensor access (`LibreHardwareMonitorLib`), network/firewall toggles, service/device controls, and Program Files app moves.
- **DevTools in Built Releases**: DevTools are disabled by default in `CoreWatch.exe` (`-Release`). To enable them for troubleshooting, launch `CoreWatch.exe -DevTools`.
- **SmartScreen**: Unsigned beta builds may display a Windows SmartScreen prompt on first launch until signed with a code-signing certificate.
