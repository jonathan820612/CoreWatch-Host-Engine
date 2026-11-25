# CoreWatch Rust

A Windows desktop rewrite of the CoreWatch dashboard and Network Manager. It uses Tauri and WebView2 with the original CoreWatch stylesheet, dashboard cards, and Network Manager layout. The runtime does not require PowerShell.

## Run on Windows

Install the Rust MSVC toolchain, Visual Studio C++ Build Tools with **Desktop development with C++**, and Edge WebView2 Evergreen. This project was built with Rust 1.100 x64 MSVC. The first build downloads Cargo dependencies. [Tauri Windows prerequisites](https://v2.tauri.app/start/prerequisites/#windows)

From the repository root:

~~~powershell
Set-Location .\RUST-rewrite
cargo run --locked
~~~

### What to try

- **Dashboard** shows live CPU, RAM, pagefile commitment, GPU, storage, display, identity, and network readings. The header puts navigation on a separate row at portrait and narrow widths. The power plan opens a selector, the privilege badge can restart CoreWatch as administrator, and storage labels can be changed from the storage card.
- **Layout** provides Full, Hardware, Network, and Compact presets. Use the card grip or the arrow buttons to change card order. You can also collapse cards, change their width, and hide individual metrics. Changes save as you make them.
- **Appearance** previews ten palettes and custom colors while keeping thermal, diagnostic, and traffic colors intact. **Apply** saves the preview. You can also choose a PNG, JPEG, or WebP wallpaper up to 12 MiB and adjust how it fits, fades, and shows through the cards.
- **Dashboard settings** controls Celsius/Fahrenheit and Fast, Balanced, or Eco sampling. Pinning the window is also remembered. **Import from PowerShell version** copies supported layout, theme colors, and telemetry settings from the existing CoreWatch preferences into the Rust app.
- **Display** has monitor identification, driver-validated refresh rate and orientation previews, and an Advanced Color toggle where Windows exposes one. Unconfirmed mode previews revert after 15 seconds. Scale and Night Light open Windows Settings.
- **Network → Adapters & IP** lists physical adapters with MAC, link speed, IPv4, exact subnet, gateway, and DNS. You can configure static IPv4, return to DHCP, set DNS, and enable, disable, restart, or rename adapters. Writes require Windows elevation and confirmation. To exercise a write, use an adapter you can temporarily disconnect.
- **Network → Active Diagnostics** runs IPv4 ping and traceroute, single-port TCP reachability, or DNS record lookup. **Wi-Fi & Routing** shows the Windows Wi-Fi interface readout, IPv4 routes, and ARP cache. Wi-Fi details can depend on Windows Location permission.
- On the **Dashboard**, click **DNS Servers** to see the default IPv4 adapter and its IPv4 and IPv6 resolvers. The editor applies Automatic, Cloudflare, Google, Quad9, or custom IPv4 settings with administrator privileges. **DNS Check** attempts a Windows cache flush and times a fresh lookup independently of the speed test. **ARP GW** shows the Windows neighbor state and can re-resolve the active gateway.
- **Test Mesh** runs ICMP probes to Cloudflare and an HTTPS transfer of approximately 5 MiB. Select the external IPv4 field to run a public address lookup by itself. The dashboard starts without contacting either service.

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
cargo run --locked -- --smoke-test
cargo run --locked -- --smoke-test --narrow
cargo build --locked --release
.\target\release\corewatch-rust.exe
~~~

Rust stores dashboard preferences and the selected wallpaper under `%LOCALAPPDATA%\com.corewatch.rust.dashboard\${tick}. It reads `%LOCALAPPDATA%\CoreWatch\settings.json` and `ui-settings.json` only when you select **Import from PowerShell version**.

The snapshot prints native and WMI telemetry as JSON, including host and adapter details. The WebView2 smoke test uses temporary in-memory preferences. It checks card controls, palette preview and save, wallpaper loading, the live polling interval and temperature unit, display enumeration, and the Network views with a loopback ping.

The dashboard uses Windows Settings for security and sharing changes. Java is read from the selected JAVA_HOME.
