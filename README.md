<div align="center">

<img src="images/Icon.png" alt="CoreWatch Logo" width="84" />

# CoreWatch Host Engine

**Frameless, modular Windows 10/11 telemetry dashboard, hardware control deck, operations & protection hub, system administration suite, and developer workbench.**

Built with **PowerShell 7**, **WinForms**, **Microsoft Edge WebView2**, and native Win32 / CCD / WNF / CIM / WinRT APIs.

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
| **`CoreWatch-<ver>-Setup.exe`** | **Recommended** — Modular Inno Setup installer with a pick-and-choose component selector for all **23 feature modules** (**Full Suite** default, **Home & Essentials**, **IT & SysAdmin**, **Developer Workstation**, or **Custom**), Start Menu / Desktop shortcuts, optional PawnIO sensor driver setup, and UAC-free Start-with-Windows support. |
| **`CoreWatch-<ver>-Portable.zip`** | **Zero-install Portable** — Extract anywhere and run `CoreWatch.exe` directly with all 23 modules included. |
| **`CoreWatch-<ver>-SHA256SUMS.txt`** | SHA-256 verification checksums for both release artifacts. |

---

## Key Features

### Live Telemetry Dashboard (`📟 Dashboard`)
- **Hardware Metrics**: Real-time CPU load, dynamic boost clock, thermal/power throttling badge, L1/L2/L3 Cache Matrix (with AMD 3D V-Cache detection), GPU load/power/temp/VRAM allocation, RAM & Pagefile commitment, and live Top Resource Consumer callout.
- **Multi-Provider CPU Die Temperature Engine**: Supports bundled `LibreHardwareMonitorLib.dll` (via the `.NET Framework 4.x` `CoreWatchSensorHelper.exe` persistent stdio bridge for AMD Ryzen `Tctl/Tdie` & Intel `CPU Package`), LibreHardwareMonitor/OpenHardwareMonitor WMI, Core Temp shared memory, and native Windows ACPI thermal zones, with `°C` / `°F` toggle.
- **System Identity & Infrastructure**: Hostname, Domain/Workgroup, Windows Edition & UBR build, Update & Pending Reboot status, DirectX, Virtualization & Secure Boot, **smart MSI/MSIX-aware PowerShell 7 version/update badge** (tracks official `.msi` for existing MSI installs, upgrades MSIX cleanly, and installs MSIX with clear `WindowsApps` folder-restriction tooltips when PowerShell Core is absent), Java runtime `JAVA_HOME`/PATH switcher, Windows Telemetry toggle, Elevation badge (with 1-click Admin relaunch), last crash/BSOD timestamp, Motherboard, BIOS, Power Plan switcher, Uptime, and Audio devices.
- **Interactive Multi-Monitor Display Deck**: Per-monitor selector with PerMonitorV2 DPI-aware native **Identify** overlay badges across every screen, driver-verified **Refresh Rate** switcher (`CDS_TEST` pre-validated), live **DPI Scale** switcher (native Windows CCD API), **Orientation**, **HDR** toggle, Color Profile, and **Night Light** toggle + warmth slider.
- **Network Profile & Storage**: 4-column network matrix (IPv4, CIDR subnet mask, gateway, DHCP/Static, external IPv4, WLAN SSID with Windows 11 24H2/25H2 Location-privacy fallback, Firewall/Defender/Tamper-gated controls/Discovery/Sharing toggles, Quick DNS switcher, live RX/TX bandwidth bar, Cloudflare speed/jitter/loss test), plus Storage volumes with SMART health/wear %, IO latency, inline relabeling, and 1-click **Disk Map** jump.
- **Adaptive Portrait HD (`1080×1920`) Workspace, Live Theme Studio & Window Controls**:
  - **Adaptive 2-Tier Responsive Header**: Single-row on ultra-wide displays (`≥ 1380px`) and automatically splits into a clean 2-tier utility + wrapping tab bar on **Portrait HD (`1080×1920`)** and narrow windows with zero horizontal overflow.
  - **Live Movable Theme & Appearance Studio (`🎨`)**: Non-blocking draggable floating popup with **10 presets** (*CoreWatch Classic*, *Midnight OLED*, *Cyberpunk Neon*, *Emerald Matrix*, *Amber Forge*, *Nord Frost*, *Crimson Ops*, *Synthwave Sunset*, *Aurora Borealis*, *Daylight Slate*), **12 live CSS-variable color pickers**, card translucency & frosted-glass blur, **local host background wallpaper** (`Cover`, `Stretch`, `Center`, `Contain`, `Tile`, opacity, blur, and `None`/`Uniform`/`Vignette`/`Top`/`Bottom` fade blending), JSON import/export, and **51 protected functional/diagnostic color rules** so thermal/status indicators always stay accurate.
  - **`Ctrl+K` Command Palette**: Instant quick-launch across all 23 tabs, system modes, Theme Studio, and 1-click operational actions.
  - **`✏️ Layout` Editor & Side Telemetry Dock**: Reorder, resize, collapse, or hide dashboard cards and pop frames into a slide-out dock.
  - **3-State Window Lock (`🔓` / `🔒` / `🔐`)**: 1st click locks window position `(X, Y)` (still permitting right/bottom resize), 2nd click locks both position and size, 3rd click unlocks — persisted across restarts.
  - **Header Alert Bell (`🔔`)**, **Always-on-Top Pin (`📌`)**, and native all-edge resizing.

### Top-Level Management & Diagnostic Tabs
- **📡 Network (`Network Manager & Diagnostics`)**: Static IP/Gateway/DNS provisioning, DHCP reversion, adapter toggle/restart/rename, Wi-Fi RSSI, DNS cache flush, ping, traceroute, port tester, and routing/ARP tables.
- **🧭 Tasks & Ports**: Inspect active processes, Windows services health (with auto-stopped fault check), and open TCP/UDP listening sockets.
- **🩺 UltimaDiagX**: Consolidated 10-channel Windows Event Log & external log analyzer with automated **System Health Score & Synopsis**, 8-subsystem health matrix, BSOD/WER crash dump scanner, epoch-aware Mark Solved/Dismiss persistence, live watch mode, native Windows Event ID / HRESULT / NTSTATUS / BugCheck translator, and report export.

### `🛡️ Ops & Guard ▾` Suite (6 Modules)
- **🔔 Smart Alerts & Watchdog Rules**: Built-in & custom rules (CPU/GPU overheat sustained duration, low disk %, high RAM, internet drop/recovery, critical Windows service stopped) firing native **Windows Toast notifications** (with System Tray balloon fallback), sound chimes, or auto-restarting stopped services, plus a live Header Alert Bell (`🔔`) and history log.
- **🔄 Unified Update Center**: Scans **WinGet upgrades**, **Windows Updates** (native COM `Microsoft.Update.Session`), **PowerShell 7 / runtimes**, and **CoreWatch self-updates** in one hub, with selective batch upgrades and a persistent **Pin / Ignore** list.
- **📸 System Snapshots & "What Changed?" Diff**: Captures lightweight JSON snapshots (Installed Apps, Startup Items, Services, Signed Drivers, Hosts File, Network Config) optionally paired with a native **Windows System Restore Point**, and diffs **Before vs. After** (or **Before vs. Live Current PC**) with color-coded Added/Removed/Modified breakdowns.
- **💾 Backup & Folder Sync Manager**: Friendly GUI over native `robocopy` for **Incremental** (`/E /XO`) or **Mirror** (`/MIR`) sync to external USB drives or NAS UNC shares (`\\server\share`), with **Dry-Run Previews (`/L`)**, developer ignore presets (`node_modules`, `.git`, `target`, `bin`, `obj`), optional Windows Task Scheduler automation, and run history.
- **🔋 Battery Health & Wireless Peripherals**: Parses laptop battery health (Design vs. Full Charge mWh, wear %, cycle count, charge rate), launches Windows **Battery Report** & **SleepStudy**, and monitors live battery charge for **Bluetooth mice, keyboards, headsets, and controllers** (`DEVPKEY_Bluetooth_Battery`) with low-battery alerts.
- **🛡️ Security & Repair**: BitLocker, TPM, RDP, Hosts/Proxy/Environment audit, `DISM`/`SFC` servicing, Windows Update & network repairs, and 1-click IT Support ZIP.

### `💻 Dev & Work ▾` Suite (6 Modules)
- **🐙 GitHub Manager**: Auto-authenticates via signed-in `gh` CLI or **DPAPI-encrypted** PAT; scans local Git workspaces (branch, dirty count, ahead/behind, VS Code/Terminal/Explorer/Pull/`Publish-Release.ps1`), clones your GitHub repos or any Git URL, and provides full GitHub Release management (Draft/Prerelease/Auto-Notes/Multi-Asset Upload/Delete).
- **📋 Jira Manager**: Supports **Jira Cloud** (REST v3, Email + Atlassian API Token) and **Jira Server / Data Center** (REST v2, Bearer PAT) stored DPAPI-encrypted; presets & custom JQL, ADF-to-text descriptions, live workflow transitions, comments, worklog time logging, Assign to Me, Copy Git Branch, and Create Issue.
- **🐧 WSL Manager**: Manage Windows Subsystem for Linux distros, online catalog installs, `.tar`/`.vhdx` import/export, VHDX compaction, `.wslconfig` tuning, and quick Linux diagnostics.
- **🐳 Docker / Containers & Local Dev Services**: Auto-detects Docker or Podman CLI; start/stop/restart/shell/tail-logs/remove containers, click any published port to jump straight into **🧭 Tasks & Ports**, inspect image/volume disk footprint (`system df`) with 1-click Prune, and control local Windows dev services (PostgreSQL, MySQL, Redis, MongoDB, IIS, Docker).
- **🔐 SSH Host Launcher & Certificate Inspector**: Visual `~/.ssh/config` editor with 1-click Windows Terminal SSH launch, local SSH key inventory + `ed25519` keypair generator + public-key copier, and an expiring/expired Windows TLS & code-signing certificate auditor (`LocalMachine\My` & `CurrentUser\My`).
- **🌐 Multi-PC / Homelab Monitor**: Monitor secondary desktops, Linux servers, or NAS devices via **SSH**, **WinRM**, or **HTTP/Ping** probes with optional auto-poll cadence and 1-click SSH / RDP (`mstsc`) / Web UI launchers.

### `🧰 System ▾` Suite (8 Modules)
- **⚡ System Profiles & Modes**: Built-in presets (**Normal**, **Work**, **Gaming**, **Presentation**, **Night**) + custom profiles, **Capture Current PC**, and JSON import/export controlling native Windows WNF **Do Not Disturb**, Power Plan, Keep Screen Awake, Night Light + warmth %, and per-monitor HDR / Hz / Scale overrides with **1-click Revert**.
- **🚀 Startup Apps**: View, add, enable/disable (`StartupApproved` binary flags), locate, or remove Registry & Startup Folder boot items.
- **📂 Sharing Center**: Create/remove SMB network shares and manage per-account share permissions.
- **📦 Installed Apps & App Mover**: 64/32-bit + User app inventory, folder size calculator, Uninstall/Modify, Registry jump, and cross-drive **App Mover** (`robocopy` + NTFS Junctions).
- **⬇️ App Installer & Launcher**: Curated WinGet software catalog (including **ArtCraft Launcher** & smart MSI/MSIX PowerShell 7), batch installs, bulk upgrades, direct **`▶ Launch`** for installed apps, and `▶ Launchable` filter pill.
- **🗺️ Disk Map**: Multithreaded WizTree-style visual storage treemap, largest files, and extension breakdown.
- **🧩 Devices & Drivers**: Collapsible PnP hardware tree with driver age warnings, digital signers, INF packages, rescan, restart, and enable/disable controls.
- **🗂️ File Organizer**: Rule-based sorting for default Windows folders or any custom folder with **Dry-Run Preview** and **1-click Undo**.

### Unified Settings (`⚙️`) & Security
- **General**: UAC-free Task Scheduler + HKCU Auto-Start, Launch Minimized to Tray, Minimize to Tray on Exit, Confirm Destructive Actions, Temperature Unit (`°C`/`°F`), and in-app **Check for Updates**.
- **Directories**: Projects Root, Exports, WSL Install Root, File Organizer Destination, and Preferred Code Editor (`Code.exe`) with native pickers.
- **Telemetry**: Live polling profiles (`Fast` 250ms / `Balanced` 500ms / `Eco` 1000ms) with zero-CPU pause when minimized.
- **Modules & Tabs**: Toggle any of the **23 installed modules** at runtime without reinstalling.
- **DPAPI Secrets Vault**: Tokens and API keys are encrypted per-user with Windows DPAPI (`ProtectedData`, `CurrentUser`) in `%LOCALAPPDATA%\CoreWatch\secrets.dat.json` — never stored in plaintext.

---

## Project Layout

```text
CoreWatch-Host-Engine/
├── Start-NodeWatch.ps1              # Main WinForms + WebView2 host, window lock, watchdog & async runspaces
├── version.json                     # Source-controlled semantic & monotonic beta version tracker
├── images/                          # Application icon & dashboard showcase screenshot
├── bin/                             # WebView2 wrapper DLLs (+ optional LibreHardwareMonitorLib.dll)
├── build/
│   ├── Build-Beta.ps1               # Versioned build, modular 23-tab Inno Setup & Portable ZIP pipeline
│   ├── Build-Test.ps1               # Local EXE-only test builder -> .\testBuild\ (no Git/GitHub side effects)
│   ├── Publish-Release.ps1          # One-command build, tag, push & GitHub Release publisher
│   ├── CoreWatchLauncher.cs         # Native silent x64 WinForms launcher -> CoreWatch.exe
│   ├── CoreWatchSensorHelper.cs     # .NET 4.x persistent stdio bridge for LibreHardwareMonitorLib.dll
│   └── BUILD-HISTORY.md             # Auto-appended release build provenance log
├── testBuild/                       # Git-ignored local test .exe installers (created by Build-Test.ps1)
├── RUST-rewrite/                    # Ongoing native Rust + Tauri v2 rewrite prototype & docs/ specs
└── modules/
    ├── modules-catalog.json         # 23-module manifest driving Settings UI & Inno Setup components
    ├── core/
    │   └── CoreWatchSettings.ps1    # Persistent settings, DPAPI secrets vault, Auto-Start & updater
    ├── layouts/                     # index.html, style.css (live theme vars), app.js
    ├── telemetry/                   # Hardware, Display, Storage, Network, Traffic, DashboardControls
    └── tabs/                        # 23 modular tab backends (SmartAlerts, UpdateCenter, Snapshots,
                                     # BatteryPeripherals, BackupSync, DockerServices, SshCerts, Homelab,
                                     # GitHub, Jira, Profiles, UltimaDiagX, Network, TasksPorts, Wsl,
                                     # DiskMapper, AppInstaller, InstalledApps, Device, SecurityRepair,
                                     # Startup, Sharing, FileOrganizer)
```

---

## Requirements

- **OS**: Windows 10 (64-bit) or Windows 11 (64-bit)
- **PowerShell**: [PowerShell 7+](https://github.com/PowerShell/PowerShell/releases) (`pwsh.exe`)
  - *MSI vs. MSIX note*: Existing installs in `C:\Program Files\PowerShell\7` are updated cleanly via official GitHub `.msi` packages (keeping full folder access). On fresh PCs without PowerShell Core, CoreWatch can install the WinGet **MSIX** edition automatically (noting that Windows restricts direct browsing/edits inside `C:\Program Files\WindowsApps`).
- **WebView2 Runtime**: Microsoft Edge WebView2 Evergreen Runtime (preinstalled on Windows 11)
- **PawnIO Driver (for Live Desktop CPU Die Temps with LibreHardwareMonitorLib v0.9.5+)**:
  - Install once via `winget install namazso.PawnIO` (or [pawnio.eu](https://pawnio.eu/)), or let the Setup `.exe` install it automatically.
- **Optional Pro CLI Tools**: `git`, [GitHub CLI (`gh`)](https://cli.github.com/), `docker`/`podman`, and Windows OpenSSH (`ssh`/`ssh-keygen`).

---

## Running from Source & Local Test Builds

```powershell
# Launch directly from source with PowerShell 7 (DevTools enabled in dev mode)
pwsh -NoProfile -ExecutionPolicy Bypass -File .\Start-NodeWatch.ps1

# Compile a local EXE-only installer into .\testBuild\ without touching version.json, Git, or GitHub:
.\build\Build-Test.ps1
.\build\Build-Test.ps1 -Label "my-feature"
```

---

## Versioned Builds & GitHub Releases

```powershell
# Standard versioned build (Portable ZIP + Modular 23-tab Setup .exe into .\dist\):
.\build\Build-Beta.ps1 -RequireAdmin

# One-command build, version commit, annotated tag, push & GitHub Release publish:
.\build\Publish-Release.ps1
.\build\Publish-Release.ps1 -ReleaseTitle "Major Feature Update"
.\build\Publish-Release.ps1 -Bump patch -Draft
```

Requires [Inno Setup 6](https://jrsoftware.org/isinfo.php) (`winget install JRSoftware.InnoSetup`) for compiling `Setup.exe`.

### Runtime User Data (`%LOCALAPPDATA%\CoreWatch\`)
All writable user state is stored per-user so CoreWatch runs cleanly from `C:\Program Files\CoreWatch\`:
- `settings.json`, `ui-settings.json`, `profiles.json`, `alerts.json`, `update-pins.json`, `backup-jobs.json`, `homelab-nodes.json`, `jira-config.json`
- `secrets.dat.json` (Windows DPAPI `CurrentUser`-encrypted tokens — never plaintext)
- `snapshots\*.json`, `custom-bg.<ext>` (cached local wallpaper served via `https://corewatch-local.assets`), and `WebView2UserData\`

---

## Notes for Beta Testers & Rust Rewrite Planning
- **Administrator Privileges**: Standard-user mode works for monitoring, display controls, and diagnostics; running as Administrator unlocks full hardware sensors (`LibreHardwareMonitorLib` + PawnIO), Firewall/Defender toggles, Restore Point creation, service/device controls, and Program Files app moves.
- **DevTools in Built Releases**: Disabled by default (`-Release`); launch `CoreWatch.exe -DevTools` to inspect WebView2 DevTools.
- **Rust Rewrite**: Architecture specs, Win32/WNF/CCD/CloudStore/DPAPI references, and an active Tauri v2 prototype live under [`RUST-rewrite/`](RUST-rewrite/) and [`RUST-rewrite/docs/`](RUST-rewrite/docs/).
