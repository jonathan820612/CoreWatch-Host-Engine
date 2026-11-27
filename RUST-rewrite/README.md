# RustCoreWatch (Beta)

A native Windows desktop rewrite of CoreWatch in Rust + Tauri v2 + WebView2 with **100% module catalog parity (23/23 original modules) + RustCoreWatch-exclusive standalone RGB Lighting Studio (24 modules total)**, plus the live telemetry Dashboard and floating **Disk Partitioner**. Launches silently with zero background console window, enforces single-instance window focus, protects secrets with Windows DPAPI, and runs native Win32/multithreaded engines across storage, diagnostics, networking, services, and certificates.

## How to Run RustCoreWatch Beta

Install the Rust MSVC toolchain, Visual Studio C++ Build Tools with **Desktop development with C++**, and Edge WebView2 Evergreen.

### Recommended: Optimized Release Build (`RustCoreWatch.exe`)

~~~powershell
Set-Location d:\GitHub\CoreWatch-Host-Engine\RUST-rewrite
cargo build --locked --release
.\prepare-sensors.ps1 -Release
.\target\release\RustCoreWatch.exe
~~~

### Dev Build

~~~powershell
Set-Location d:\GitHub\CoreWatch-Host-Engine\RUST-rewrite
.\prepare-sensors.ps1
cargo build --locked
.\target\debug\RustCoreWatch.exe
~~~

Both debug and release executables use the native Windows GUI subsystem (`windows_subsystem = "windows"`), so double-clicking `RustCoreWatch.exe` opens cleanly without a console window while CLI verification flags (`--smoke-test`, `--rgb-test`, `--snapshot`, `--diagnostics`) still output when run from a terminal.

### What's Included (Dashboard + 24 Native Rust Modules)

- **Dashboard**: Live CPU, RAM (with %), Pagefile, GPU/VRAM, Storage SMART/Wear/Temp/I/O, Display/HDR/Night Light, System Identity (PowerShell 7 MSI/MSIX, Java switcher, Telemetry, Privilege, genuine OS Pending Reboot detection, Last Crash), Network/Defender matrix (auto-resolved IPv4 External IP + refresh), and Log Console.
- **🌈 RGB Lighting Studio (RustCoreWatch Exclusive — 100% Standalone Native Hardware Engine)**: Directly detects and controls RGB hardware in pure Rust with **zero OpenRGB dependency**:
  - **Direct Win32 USB HID (`src/rgb_hid.rs`)**: Gigabyte RGB Fusion 2.0 motherboards & ARGB fan/strip headers (ITE IT5702/IT5711/IT8297) and Razer Chroma keyboards & mice (91-byte extended matrix HID).
  - **Direct NVIDIA NVAPI I2C (`src/rgb_nvapi.rs`)**: ASUS Aura / ENE 6K582 RTX GPUs directly over `nvapi64.dll` I2C port 1.
  - **Direct PawnIO SMBus DRAM (`src/rgb_smbus.rs`)**: Corsair Vengeance RGB Pro/Dominator/DDR5 and G.Skill/TeamGroup ENE Aura RAM via signed PawnIO SMBus modules (requires running as Administrator; includes a 1-click **Restart as Administrator** banner).
  - **Windows 11 Dynamic Lighting (`LampArray`) Fallback** + optional collapsed OpenRGB SDK TCP bridge (`127.0.0.1:6742`).
  - Includes **Live Thermal Reactive (CPU/GPU °C)**, **Theme Studio Accent Sync**, **System Profiles Auto-Sync**, custom presets, per-zone controls, and Tray/Command Palette Stealth Blackout.
- **Floating Disk Partitioner**: Launches from the Storage card footer (`💿 Disk Partitioner`), automatically pausing live telemetry while open and resuming on close, with strict System/Boot/`C:`/EFI/Recovery safety guardrails.
- **Shell & Controls**: Clickable GitHub crest, `⌘ Ctrl+K` Command Palette, grouped dropdowns (`💻 Dev & Work ▾`, `🛡️ Ops & Guard ▾`, `🧰 System ▾`), Active Mode Pill (`Normal ▾`), System Tray Mode Switcher & RGB Blackout submenu, Smart Alerts Bell (`🔔`), 3-State Window Lock (`🔓`/`🔒`/`🔐`), Window Bounds persistence, Always on Top (`📌`), Theme Studio, Layout Customizer + Side Dock, and Settings (`Ctrl+,`) with **4-Size Interface Font Size** (`Small 88%`, `Normal 100%`, `Large 112%`, `Extra Large 124%`).
- **Top-Level Tabs**: **Dashboard**, **Network Manager & Diagnostics**, **Tasks, Services & Ports**, **UltimaDiagX**.
- **💻 Dev & Work**: **GitHub Manager**, **Jira Manager**, **WSL Manager**, **Docker & Dev Services**, **SSH & Certificates**, **Multi-PC / Homelab**.
- **🛡️ Ops & Guard**: **Smart Alerts & Watchdog**, **Unified Update Center**, **System Snapshots & Diff**, **Backup & Folder Sync**, **Battery & Peripherals**, **Security & Repair**.
- **🧰 System**: **System Profiles & Modes**, **Startup Apps**, **SMB Sharing Center**, **Installed Apps**, **App Installer (WinGet Batch)**, **Disk Map (Visual Treemap)**, **Devices & Drivers**, **File Organizer**, **RGB Lighting Studio**.

Optional hardware readings use LibreHardwareMonitor or OpenHardwareMonitor via WMI. If the original repository still has CoreWatch's sensor helper, you can copy the helper and its dependencies into the rewrite for local use:

~~~powershell
.\prepare-sensors.ps1
cargo run --locked
~~~

Use `.\prepare-sensors.ps1 -Release` to stage the helper beside an optimized build. The helper uses the same LibreHardwareMonitor library and Windows PawnIO driver as the PowerShell version. Click the CPU temperature badge to check the provider, PawnIO state, and session privilege. To test the helper directly, run `cargo run --locked -- --sensor-status` from an elevated PowerShell window. A running driver and available helper still need a supported CPU sensor to produce a reading.

## Verify

~~~powershell
cargo test --locked
cargo run --locked -- --snapshot
cargo run --locked -- --diagnostics 24
cargo run --locked -- --smoke-test
cargo run --locked -- --smoke-test --narrow
cargo build --locked --release
.\target\release\RustCoreWatch.exe
~~~

Rust stores dashboard preferences and the selected wallpaper under `%LOCALAPPDATA%\com.corewatch.rust.dashboard`. It reads `%LOCALAPPDATA%\CoreWatch\settings.json` and `ui-settings.json` only when you select **Import from PowerShell version**.

The snapshot prints native and WMI telemetry as JSON. The diagnostics command prints an UltimaDiagX report as JSON for the requested number of hours. The WebView2 smoke test uses in-memory preferences and checks dashboard controls, settings, Theme Studio, Network, Tasks & Ports, UltimaDiagX, and Disk Map.
