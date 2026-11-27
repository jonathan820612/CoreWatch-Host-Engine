# Agent Handoff Prompt — CoreWatch Rust Rewrite (`RUST-rewrite/`)

Use this brief when starting a new agent session to continue building `RUST-rewrite/` to full parity with CoreWatch `v0.9.2-beta`.

---

## Project Context
- **Repository Root**: `d:\GitHub\CoreWatch-Host-Engine`
- **Reference Production App (PowerShell 7 + WebView2)**: Root folder (`Start-NodeWatch.ps1`, `modules/core/`, `modules/telemetry/`, `modules/tabs/`, `modules/layouts/`)
- **Target Rust App (Tauri v2 + WebView2)**: `RUST-rewrite/` (`Cargo.toml`, `src/`, `ui/`, `bin/sensors/`)
- **Primary Docs to Read First**:
  1. `RUST-rewrite/docs/RUST-REWRITE-SPEC.md` (Architecture, Parity Gap Matrix, all 16 views)
  2. `RUST-rewrite/docs/WINDOWS-NATIVE-APIS.md` (Exact Win32/WNF/CCD/CloudStore/DPAPI/Sensor Helper contracts)
  3. `RUST-rewrite/docs/IPC-AND-SCHEMAS.md` (Exact `%LOCALAPPDATA%\CoreWatch\` schemas + Tauri bridge shim)
  4. `RUST-rewrite/docs/modules-catalog.json` (15 selectable modules & installer presets)

---

## Core Engineering Guardrails
1. **Zero PowerShell 7 Runtime Dependency**: Everything runs natively in `corewatch-rust.exe` (keeping `bin/sensors/CoreWatchSensorHelper.exe` optional until native NVML/ADLX/PawnIO is implemented).
2. **Backward-Compatible User Data**: Read/write `%LOCALAPPDATA%\CoreWatch\{settings.json,ui-settings.json,secrets.dat.json,profiles.json,jira-config.json}` using identical JSON keys and Windows DPAPI `CurrentUser` encryption (`CryptProtectData`/`CryptUnprotectData` with null entropy).
3. **Portrait HD (`1080×1920`) First-Class Layout**: Preserve the Adaptive 2-Tier Header (`<= 1379px` splits utility chrome & wrapping tab bar cleanly with zero horizontal overflow at any width).
4. **Live Theme Studio & Protected Colors**: Support the floating draggable Theme Studio (`--cw-*` CSS variables, 10 presets, local wallpaper via custom asset protocol with Cover/Stretch/Center/Contain/Tile, opacity, blur, fade/vignette, card translucency) while NEVER overriding the 51 coded diagnostic/thermal/traffic/status color rules.
5. **PerMonitorV2 DPI & 3-State Window Lock**: Maintain crisp PerMonitorV2 scaling, `none` / `position` (allows only Right/Bottom/Bottom-Right resize) / `all` window lock persistence, and never pause telemetry before initial window `Shown`.

---

## Suggested Recommended Next Milestones (from current `RUST-rewrite/` state)
1. **Milestone A (Shell & Settings)**: Add System Tray (`tray-icon`), 3-State Window Lock, `AlwaysOnTop`, Opacity, persisted `windowBounds`, `settings.json`, DPAPI `secrets.dat.json`, and the 2-Tier Portrait HD Header + Live Theme Studio + local wallpaper custom protocol.
2. **Milestone B (System Profiles & Display Parity)**: Port native WNF Do Not Disturb (`0x0D83063EA3BF1C75`), `SetThreadExecutionState` Keep Awake, CloudStore Night Light (+ warmth %), CCD DPI Scale, and `profiles.json` presets/revert.
3. **Milestone C (High-Impact Native Rust Tabs)**: Port **Disk Map** (`jwalk` + `rayon`), **Tasks/Services/Ports** (`GetExtendedTcpTable` + SCM), and **UltimaDiagX** (`EvtQuery` + BSOD/WER parser).
4. **Milestone D (Dev & Admin Suite)**: Port **GitHub Manager** (`reqwest` + local `git`), **Jira Manager** (`reqwest` + ADF), **WSL Manager**, **Security & Repair**, **Startup**, **Sharing**, **Installed Apps/Mover**, **App Installer/Launcher**, **Devices**, and **File Organizer**.

---

## Verification Commands (`RUST-rewrite/`)
```powershell
Set-Location d:\GitHub\CoreWatch-Host-Engine\RUST-rewrite
cargo test --locked
cargo run --locked -- --snapshot
cargo run --locked -- --smoke-test
cargo build --locked --release
```
