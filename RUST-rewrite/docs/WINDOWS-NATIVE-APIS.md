# CoreWatch Windows Native APIs & Binary Protocol Reference

Exact Win32, NT, CCD, WNF, CloudStore, DPAPI, COM, and Sensor Helper definitions extracted directly from the working CoreWatch Host Engine (`v0.9.2-beta`) so Rust implementations match Windows behavior on the first try.

---

## 1. Windows Do Not Disturb / Focus Assist (Native WNF API)

Source reference: `modules/tabs/ProfilesManager.ps1` (lines 26–87)

- **Library**: `ntdll.dll`
- **WNF State Name**: `WNF_SHEL_QUIETHOURS_ACTIVE_PROFILE_CHANGED = 0x0D83063EA3BF1C75u64`
- **Payload**: 4-byte little-endian `i32`:
  - `0` = Off (Notifications enabled)
  - `1` = Priority Only (Do Not Disturb)
  - `2` = Alarms Only
- **Signatures (Rust FFI)**:
  ```rust
  #[link(name = "ntdll")]
  unsafe extern "system" {
      fn NtQueryWnfStateData(
          state_name: *const u64,
          type_id: *const core::ffi::c_void,
          explicit_scope: *const core::ffi::c_void,
          change_stamp: *mut u32,
          buffer: *mut u8,
          buffer_size: *mut u32,
      ) -> i32;

      fn NtUpdateWnfStateData(
          state_name: *const u64,
          buffer: *const u8,
          length: u32,
          type_id: *const core::ffi::c_void,
          explicit_scope: *const core::ffi::c_void,
          matching_change_stamp: u32,
          check_stamp: u32,
      ) -> i32;
  }
  ```
- Pass `null()` for `type_id`/`explicit_scope` and `0, 0` for `matching_change_stamp`/`check_stamp`. Returns `STATUS_SUCCESS == 0`.

---

## 2. Keep Screen Awake (`SetThreadExecutionState`)

Source reference: `modules/tabs/ProfilesManager.ps1` (lines 22–59) & `Start-NodeWatch.ps1`

- **Library**: `kernel32.dll` (`windows-sys`: `Win32::System::Power::SetThreadExecutionState`)
- **Critical Rule**: Must be called on a **persistent long-lived thread** (e.g., main UI thread or dedicated background thread that stays alive), NOT a short-lived worker thread (Windows automatically clears execution state flags when the calling thread exits!).
- **Enable**: `ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED` (`0x80000000 | 0x00000001 | 0x00000002`)
- **Disable (and always on app shutdown)**: `ES_CONTINUOUS` (`0x80000000`)

---

## 3. Windows Night Light (CloudStore Binary Registry)

Source reference: `modules/telemetry/GetDisplayMetrics.ps1` (lines 749–910)

- **State Key**:
  `HKCU\Software\Microsoft\Windows\CurrentVersion\CloudStore\Store\DefaultAccount\Current\default$windows.data.bluelightreduction.bluelightreductionstate\windows.data.bluelightreduction.bluelightreductionstate`
  - Fallback cache path: `HKCU\Software\Microsoft\Windows\CurrentVersion\CloudStore\Store\Cache\DefaultAccount\$$windows.data.bluelightreduction.bluelightreductionstate\Current`
  - Value Name: `Data` (`REG_BINARY`)
- **Settings Key (Warmth / Color Temperature)**:
  `HKCU\Software\Microsoft\Windows\CurrentVersion\CloudStore\Store\DefaultAccount\Current\default$windows.data.bluelightreduction.settings\windows.data.bluelightreduction.settings`
  - Value Name: `Data` (`REG_BINARY`)
- **Parsing Rules**:
  - Locate the second `0x43 0x42 0x01 0x00` (`"CB\x01\x00"`) inner Bond header marker starting at offset `>= 10`.
  - Enabled flag sits as a Bond `0x10 0x00` insertion immediately after the inner timestamp field; updating requires incrementing the Windows timestamp bytes (offsets `10..14`) so Shell's CloudStore watcher notices the mutation and applies the gamma ramp immediately without rebooting.
  - Warmth strength (`0%–100%`) maps linearly to Kelvin (`6500K` = 0% warmth down to `1200K` = 100% warmth), encoded as little-endian unsigned LEB128 (`ConvertTo-Leb128Bytes`) in the `settings` binary blob.

---

## 4. Per-Monitor CCD DisplayConfig (HDR, DPI Scale, Refresh Rate, Orientation)

Source reference: `modules/telemetry/GetDisplayMetrics.ps1` (lines 100–350)

- **Enumerate Active Paths**: `GetDisplayConfigBufferSizes(QDC_ONLY_ACTIVE_PATHS)` + `QueryDisplayConfig(...)`
- **HDR Read/Write**:
  - Read: `DISPLAYCONFIG_DEVICE_INFO_GET_ADVANCED_COLOR_INFO` (`type = 9`) and Win11 24H2+ `GET_ADVANCED_COLOR_INFO_2` (`type = 15`)
  - Write: `DISPLAYCONFIG_DEVICE_INFO_SET_ADVANCED_COLOR_STATE` (`type = 10`, bit 0 = `enableAdvancedColor`)
- **Per-Monitor DPI Scale Read/Write** (undocumented but standard Windows CCD calls):
  - `DISPLAYCONFIG_DEVICE_INFO_GET_DPI_SCALE` (`type = -3`) → returns `{ minScaleRel, curScaleRel, maxScaleRel }` relative to Windows recommended scale index in `[100, 125, 150, 175, 200, 225, 250, 300, 350, 400, 450, 500]`.
  - `DISPLAYCONFIG_DEVICE_INFO_SET_DPI_SCALE` (`type = -4`) → sets `scaleRel` directly without logout!
- **Refresh Rate & Orientation**:
  - `EnumDisplaySettingsExW(deviceName, modeIdx, &devmode, 0)`
  - Validate with `ChangeDisplaySettingsExW(..., CDS_TEST, null()) == DISP_CHANGE_SUCCESSFUL` before applying with `CDS_UPDATEREGISTRY`.

---

## 5. Borderless Window Frame, PerMonitorV2 DPI & 3-State Window Lock

Source reference: `Start-NodeWatch.ps1` (lines 1252–1286)

- **Native Drag**: `ReleaseCapture()` + `SendMessageW(hwnd, WM_NCLBUTTONDOWN (0x00A1), HTCAPTION (2), 0)`
- **Native Edge Resize Hit Codes** (`WM_NCLBUTTONDOWN` `wParam`):
  - `10` = `HTLEFT`, `11` = `HTRIGHT`, `12` = `HTTOP`, `13` = `HTTOPLEFT`, `14` = `HTTOPRIGHT`, `15` = `HTBOTTOM`, `16` = `HTBOTTOMLEFT`, `17` = `HTBOTTOMRIGHT`
- **3-State Lock Enforcement**:
  - `none`: All drag, maximize, and hit codes `10..17` allowed.
  - `position`: Block drag & maximize; only allow hit codes **`11` (Right), `15` (Bottom), `17` (Bottom-Right)** so `(X, Y)` stays anchored.
  - `all`: Block drag, maximize, and all hit codes `10..17`.

---

## 6. Windows DPAPI Per-User Secrets Vault

Source reference: `modules/core/CoreWatchSettings.ps1`

- **File**: `%LOCALAPPDATA%\CoreWatch\secrets.dat.json`
- **Format**: Flat JSON map `{ "github_pat": "<base64-dpapi-bytes>", "jira_api_token": "<base64-dpapi-bytes>" }`
- **Encryption**: `CryptProtectData` with `CRYPTPROTECT_UI_FORBIDDEN (0x1)` and `pOptionalEntropy = null` (matches .NET `ProtectedData.Protect(bytes, null, DataProtectionScope.CurrentUser)` — 100% binary interoperable between PowerShell/.NET and Rust!).
- **Decryption**: `CryptUnprotectData` → `LocalFree(out_blob.pbData)` → UTF-8 string.

---

## 7. UAC-Free Auto-Start (Task Scheduler COM + HKCU Fallback)

Source reference: `modules/core/CoreWatchSettings.ps1` (lines 160–320)

- **Fast Read Check** (~5ms vs ~1,200ms for `Get-ScheduledTask`):
  - Use COM `Schedule.Service` (`ITaskService::Connect`, `GetFolder("\CoreWatch")`, `GetTask("CoreWatchAutoStart")`) and check `HKCU\Software\Microsoft\Windows\CurrentVersion\Run\CoreWatch`.
- **Elevated Write**: Register Logon trigger task `\CoreWatch\CoreWatchAutoStart` with `RunLevel = Highest` (`TASK_RUNLEVEL_HIGHEST`) so CoreWatch starts elevated at Windows logon without triggering a UAC prompt.
- **Non-Elevated Fallback**: Write `HKCU\Software\Microsoft\Windows\CurrentVersion\Run\CoreWatch`.

---

## 8. `CoreWatchSensorHelper.exe` Persistent Stdio Protocol

Source reference: `build/CoreWatchSensorHelper.cs` (already staged in `RUST-rewrite/bin/sensors/`)

- **Launch**: Spawn `CoreWatchSensorHelper.exe` with piped `stdin` and `stdout` (`CREATE_NO_WINDOW`).
- **Handshake**: On startup, helper prints 1 initial JSON line immediately.
- **Poll**: Write `"\n"` to `stdin` and flush → read 1 JSON line from `stdout` (`< 3ms`).
- **Shutdown**: Write `"EXIT\n"` to `stdin` so LibreHardwareMonitor cleanly closes PawnIO handles.
- **Payload**:
  ```json
  {
    "cpuTemp": 54,
    "cpuPower": 42.6,
    "sensor": "Core (Tctl/Tdie)",
    "gpuLoad": 12,
    "gpuTemp": 41,
    "gpuPower": 18.4,
    "gpuVramUsedMB": 1420.5,
    "gpuVramTotalMB": 16384.0
  }
  ```
