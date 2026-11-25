"use strict";

const byId = (id) => document.getElementById(id);
const unavailable = "—";

const detailsLabels = {
    domain: "lblWorkgroup", host: "lblHostName", os: "lblOsEdition", build: "lblWinBuild",
    update: "lblUpdateLevel", directX: "lblDirectX", virtualization: "lblVirtualization",
    secureBoot: "lblSecureBoot", engine: "lblPsVersion", java: "lblJavaVersion", telemetry: "lblTelemetry",
    elevation: "lblElevation", pendingReboot: "lblPendingReboot", lastCrash: "lblLastCrash",
    board: "lblMotherboard", bios: "lblBiosVersion", powerPlan: "lblPowerPlan",
    audioOutput: "lblAudioOutput", audioInput: "lblAudioInput", ipv4: "lblIntIPv4",
    subnet: "lblSubnetMask", gateway: "lblGateway", assignment: "lblNetAssignment",
    networkStatus: "lblNetworkStatus", wifiSsid: "lblWlanSsid", link: "lblLinkCap",
    firewall: "lblFirewall", realtime: "lblRealtime", tamper: "lblTamperProtection",
    behavior: "lblBehaviorMonitor", cloud: "lblCloudProtection", ioav: "lblIoavProtection",
    ethernet: "lblEthernet", wifi: "lblWifi",
    sharing: "lblSharing"
};

function show(id, value) {
    const element = byId(id);
    const missing = value == null || value === "";
    const next = missing ? unavailable : String(value);
    if (element.textContent !== next) element.textContent = next;
    if (element.dataset.unavailable !== String(missing)) {
        element.dataset.unavailable = String(missing);
        if (missing) element.setAttribute("aria-label", "Unavailable");
        else element.removeAttribute("aria-label");
    }
}

function percent(used, total) {
    return total > 0 ? used * 100 / total : 0;
}

function bar(id, value) {
    byId(id).style.width = Math.min(100, Math.max(0, value || 0)) + "%";
}

const gib = (value) => (value / 1024 ** 3).toFixed(2) + " GiB";

function usage(label, track, value) {
    show(label, value ? gib(value.used) + " / " + gib(value.total) : null);
    bar(track, value ? percent(value.used, value.total) : 0);
}

function uptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor(seconds / 3600) % 24;
    const minutes = Math.floor(seconds / 60) % 60;
    return (days ? days + "d " : "") + hours + "h " + minutes + "m";
}

function rate(bytes) {
    if (bytes == null) return null;
    if (bytes >= 1024 ** 2) return (bytes / 1024 ** 2).toFixed(2) + " MiB/s";
    return (bytes / 1024).toFixed(2) + " KiB/s";
}

function rateBar(bytes) {
    return bytes > 0 ? Math.max(8, 2 * Math.log(bytes) / Math.log(1.5)) : 0;
}

function renderLive(live) {
    show("lblCpuModel", live.cpu_name);
    show("lblCpuLoad", live.cpu_percent == null ? null : Math.round(live.cpu_percent) + "%");
    bar("barCpuLoad", live.cpu_percent);
    show("lblCpuClock", live.cpu_mhz == null ? null : (live.cpu_mhz / 1000).toFixed(2) + " GHz");
    byId("lblCpuClock").title = live.cpu_mhz_live
        ? "Effective clock estimated from Windows % Processor Performance"
        : "Windows processor frequency reading";
    usage("lblRamUsage", "barRamUsage", live.ram);
    const pagefile = live.commit && live.ram ? {
        used: Math.max(0, live.commit.used - live.ram.used),
        total: Math.max(0, live.commit.total - live.ram.total)
    } : null;
    usage("lblPagefileUsage", "barPagefileUsage", pagefile);
    show("lblUptime", uptime(live.uptime_seconds));
    const process = live.top_process;
    show("lblTopProcess", process && (
        process.name + " (PID " + process.pid + ") · " + process.cpu_percent.toFixed(1)
        + "% CPU · " + Math.round(process.memory / 1024 ** 2) + " MiB"
    ));
    show("lblNetRx", rate(live.traffic?.rx));
    show("lblNetTx", rate(live.traffic?.tx));
    bar("barNetRx", rateBar(live.traffic?.rx));
    bar("barNetTx", rateBar(live.traffic?.tx));
}

function element(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text != null) node.textContent = text;
    return node;
}

const volumeRows = new Map();

function createVolumeRow(mount) {
    const row = element("div", "metric-row storage-tight-row");
    const header = element("div", "metric-metadata");
    const entry = { row, volume: null };
    const drive = actionButton("", async () => {
        const label = await askDashboard("Rename volume", mount, { label: "Volume label", value: entry.volume.label });
        if (typeof label === "string") await dashboardCommand("label_volume", { mount, label }, "Volume label updated.");
    });
    drive.className = "storage-interactive-row-header";
    drive.title = "Rename this volume";
    entry.icon = element("span", "storage-tag-icon");
    entry.title = element("span", "drive-title");
    drive.append(entry.icon, entry.title);
    entry.usage = element("span", "storage-data-numeric-text");
    header.append(drive, entry.usage);
    const track = element("div", "track-bg");
    entry.fill = element("div", "track-fill");
    track.append(entry.fill);
    const footer = element("div", "storage-diag-footer");
    const badges = element("div", "storage-diag-badges");
    const open = actionButton("📂 Open", () => dashboardCommand("open_volume", { mount }));
    open.className = "storage-map-btn";
    entry.health = element("span", "diag-pill");
    entry.activity = element("span", "diag-pill diag-neutral");
    entry.kind = element("span", "driver-tag tight-tag");
    badges.append(open, entry.health, entry.activity);
    footer.append(entry.kind, badges);
    row.append(header, track, footer);
    return entry;
}

function renderVolumes(volumes) {
    const container = byId("storageVolumeContainer");
    const mounts = new Set(volumes.map((volume) => volume.mount));
    for (const [mount, entry] of volumeRows) {
        if (!mounts.has(mount)) {
            entry.row.remove();
            volumeRows.delete(mount);
        }
    }
    if (!volumes.length) {
        if (!container.querySelector(".driver-text-node")) {
            container.replaceChildren(element("div", "driver-text-node", "No mounted volumes detected."));
        } else {
            container.firstElementChild.textContent = "No mounted volumes detected.";
        }
        return;
    }
    let cursor = container.firstElementChild;
    for (const volume of volumes) {
        const entry = volumeRows.get(volume.mount) ?? createVolumeRow(volume.mount);
        volumeRows.set(volume.mount, entry);
        entry.volume = volume;
        entry.icon.textContent = volume.removable ? "🟢 " : "🏷️ ";
        entry.title.textContent = (volume.label || "Local Disk") + " (" + volume.mount.slice(0, 2) + ")";
        const usedPercent = percent(volume.used, volume.total);
        entry.usage.textContent = gib(volume.used) + " / " + gib(volume.total) + " (" + Math.round(usedPercent) + "%)";
        entry.fill.style.width = Math.min(100, usedPercent) + "%";
        entry.fill.style.backgroundColor = volume.removable ? "#38b2ac" : "";
        entry.health.textContent = volume.health ?? "SMART N/A";
        entry.health.className = "diag-pill " + (volume.health === "Healthy" ? "diag-ok" : volume.health === "Unhealthy" ? "diag-crit" : "diag-neutral");
        entry.activity.textContent = volume.active_percent == null ? "I/O —" : "I/O " + volume.active_percent + "%";
        entry.kind.textContent = [volume.removable ? "Removable" : "Local Volume", volume.kind, volume.filesystem].filter(Boolean).join(" · ");
        if (entry.row !== cursor) container.insertBefore(entry.row, cursor);
        cursor = entry.row.nextElementSibling;
    }
    container.querySelector(".driver-text-node")?.remove();
}

let displays = [];

function renderDisplays(next) {
    const picker = byId("selMonitorPicker");
    const prior = picker.value;
    displays = next;
    const options = next.map((display, index) => new Option(
        "Display " + (index + 1) + " – " + display.name + (display.primary ? " (Primary)" : ""), display.id
    ));
    const signature = JSON.stringify(options.map((option) => [option.value, option.text]));
    if (picker.dataset.signature !== signature) {
        picker.dataset.signature = signature;
        picker.replaceChildren(...(options.length ? options : [new Option("No displays detected", "")]));
        picker.disabled = !options.length;
        const selected = next.some((display) => display.id === prior) ? prior : next.find((display) => display.primary)?.id;
        if (selected) picker.value = selected;
    }
    renderSelectedDisplay();
}

function renderSelectedDisplay() {
    const display = displays.find((item) => item.id === byId("selMonitorPicker").value);
    show("lblMonResolution", display?.resolution);
    show("lblMonRefresh", display?.refresh_hz != null ? display.refresh_hz.toFixed(2).replace(/\.00$/, "") + " Hz" : null);
    show("lblMonOrientation", display?.orientation);
    show("lblMonScale", display?.scale != null ? display.scale + "%" : null);
    show("lblMonConnection", display?.connection);
    show("lblMonHdr", display?.advanced_color);
    tint("lblMonHdr", display?.advanced_color === "On" ? "diag-ok" : display?.advanced_color === "Off" ? "diag-crit" : "diag-neutral");
    show("lblMonColorProfile", display?.color_profile);
    byId("lblMonColorProfile").title = display?.color_profile ?? "";
}

let adapterSignature = "";

function renderAdapters(adapters, elevated) {
    const physical = adapters.filter((adapter) => adapter.physical);
    const signature = JSON.stringify([physical, elevated]);
    if (signature === adapterSignature) return;
    adapterSignature = signature;
    const nodes = physical.map((adapter) => {
        const item = element("span", "adapter-status-item");
        let state = adapterBadge(adapter);
        if (elevated && (!adapter.enabled || adapter.online)) {
            const badgeControl = actionButton(state.textContent, async () => {
                const enable = !adapter.enabled;
                if (!await askDashboard((enable ? "Enable " : "Disable ") + adapter.name,
                    enable ? "Enable this network adapter?" : "Disabling this adapter can disconnect the computer.")) return;
                badgeControl.disabled = true;
                await dashboardCommand("configure_network_adapter", {
                    index: adapter.index, alias: adapter.name, action: { kind: enable ? "enable" : "disable" }
                }, "Adapter state updated.");
                badgeControl.disabled = false;
            });
            badgeControl.className = state.className;
            badgeControl.setAttribute("aria-label", (adapter.enabled ? "Disable " : "Enable ") + adapter.name);
            state = badgeControl;
        }
        item.append(element("span", "", adapter.kind === "Wi-Fi" ? "📶" : "🌐"),
            element("span", "adapter-name", adapter.name + ":"), state);
        item.title = adapter.description;
        return item;
    });
    byId("adapterStatusContainer").replaceChildren(...(nodes.length ? nodes : [
        element("span", "adapter-status-item", "No adapters detected.")
    ]));
}

let temperatureUnit = "C";
let latestTemperature = {};

function renderTemperatures() {
    for (const [reading, metric, unit, badge] of [
        ["cpuTemp", "lblCpuTemp", "lblCpuTempUnit", "badgeCpuTemp"],
        ["gpuTemp", "lblGpuTemp", "lblGpuTempUnit", "badgeGpuTemp"]
    ]) {
        const raw = latestTemperature[reading];
        const celsius = raw == null || raw === "" ? NaN : Number(raw);
        const available = Number.isFinite(celsius);
        const value = temperatureUnit === "F" ? celsius * 9 / 5 + 32 : celsius;
        show(metric, available ? Math.round(value) : null);
        show(unit, "°" + temperatureUnit);
        const node = byId(badge);
        node.classList.remove("therm-cool", "therm-warm", "therm-hot");
        node.classList.add(celsius >= 85 ? "therm-hot" : celsius >= 65 ? "therm-warm" : "therm-cool");
        const source = reading === "cpuTemp" ? latestTemperature.cpuTempSource : null;
        node.title = available ? [Math.round(value) + " °" + temperatureUnit, source].filter(Boolean).join(" · ")
            : reading === "cpuTemp" ? "Open CPU sensor status" : "Temperature is unavailable from the current sensor provider.";
    }
}

function renderDetails(details) {
    const fields = details.fields;
    for (const [key, id] of Object.entries(detailsLabels)) show(id, fields[key]);
    networkView?.setGateway(fields.gateway);
    dashboardNetwork?.update(details);
    const firewall = fields.firewall;
    const enabled = firewall?.endsWith(" on");
    badge("lblFirewall", firewall ? firewall.includes(" · ") ? firewall : enabled ? "ON" : "OFF" : null, enabled, firewall);
    for (const [id, key] of [["lblRealtime", "realtime"], ["lblTamperProtection", "tamper"], ["lblBehaviorMonitor", "behavior"],
        ["lblCloudProtection", "cloud"], ["lblIoavProtection", "ioav"]]) {
        badge(id, fields[key]?.toUpperCase(), fields[key] === "On");
    }
    const pending = fields.pendingReboot === "Yes";
    badge("lblPendingReboot", fields.pendingReboot ? pending ? "Yes" : "No" : null, !pending);
    tint("lblElevation", fields.elevation === "Administrator" ? "diag-ok" : "diag-neutral");
    byId("lblElevation").disabled = fields.elevation === "Administrator";
    const profile = fields.networkStatus?.split(" · ");
    badge("lblNetworkStatus", profile?.length === 2 ? profile[0].toUpperCase() : fields.networkStatus, false, fields.networkStatus, "diag-neutral");
    const sharing = fields.sharing;
    badge("lblSharing", sharing == null ? null : Number(sharing) > 0 ? sharing + " active" : "None", Number(sharing) > 0);
    badge("lblTelemetry", fields.telemetry?.includes("disabled") ? "OFF" : fields.telemetry ? "ON" : null,
        Boolean(fields.telemetry && !fields.telemetry.includes("disabled")), fields.telemetry);
    badge("night-light-settings", fields.nightLight ?? "Settings", fields.nightLight === "On", null,
        fields.nightLight ? undefined : "diag-neutral");
    show("badgeThrottleState", "Throttle: " + (fields.throttle ?? unavailable));
    tint("badgeThrottleState", fields.throttle === "ACPI active" ? "diag-warn" : fields.throttle ? "diag-ok" : "diag-neutral");
    latestTemperature = { cpuTemp: fields.cpuTemp, cpuTempSource: fields.cpuTempSource, gpuTemp: fields.gpuTemp };
    renderTemperatures();
    show("lblGpuModel", fields.gpuName);
    show("lblGpuDriver", fields.gpuDriver);
    show("lblGpuLoad", fields.gpuLoad == null ? null : fields.gpuLoad + "%");
    bar("barGpuLoad", Number(fields.gpuLoad));
    show("lblGpuPower", fields.gpuPower == null ? null : fields.gpuPower + " W");
    const vram = fields.vramUsed == null ? null : Number(fields.vramUsed);
    const total = fields.vramTotal == null ? null : Number(fields.vramTotal);
    show("lblGpuVram", vram != null || total != null
        ? (vram == null ? unavailable : gib(vram)) + " / " + (total == null ? unavailable : gib(total))
        : null);
    bar("barGpuVram", vram != null && total != null ? percent(vram, total) : 0);
    byId("cpuCacheContainer").replaceChildren(...["L1", "L2", "L3"].map((level) => (
        element("span", "cache-tag", level + ": " + (fields[level.toLowerCase()] ?? unavailable))
    )));
    renderVolumes(details.volumes);
    renderDisplays(details.displays);
    renderAdapters(details.adapters, fields.elevation === "Administrator");
}

function tint(id, style) {
    const node = byId(id);
    node.classList.remove("diag-neutral", "diag-ok", "diag-warn", "diag-crit");
    node.classList.add(style);
}

function badge(id, caption, enabled, title, theme) {
    show(id, caption);
    byId(id).classList.add("diag-pill");
    tint(id, theme ?? (caption == null ? "diag-neutral" : enabled ? "diag-ok" : "diag-crit"));
    if (title) byId(id).title = title;
}

function log(message) {
    const box = byId("console-box");
    const line = element("div", "", "[" + new Date().toLocaleTimeString() + "] " + message);
    box.append(line);
    if (box.childElementCount > 120) box.firstElementChild.remove();
    box.scrollTop = box.scrollHeight;
}

let networkView;
let dashboardNetwork;
let invokeDashboard;

async function dashboardCommand(name, args, success) {
    try {
        const result = await invokeDashboard(name, args);
        if (success) log(success);
        return result;
    } catch (error) {
        log(String(error));
        show("status", "Action failed. See log.");
        return undefined;
    }
}

function askDashboard(title, message, field, timeout = 0) {
    const dialog = byId("dashboard-dialog");
    if (dialog.open) return Promise.resolve(null);
    show("dialog-title", title);
    show("dialog-message", message);
    byId("dialog-field").hidden = !field || Boolean(field.options);
    byId("dialog-options").hidden = !field?.options;
    const input = byId("dialog-input");
    const select = byId("dialog-select");
    input.value = field?.value ?? "";
    select.replaceChildren(...(field?.options ?? []).map((plan) => new Option(plan.name, plan.id, plan.active, plan.active)));
    if (field?.options && !select.value) select.selectedIndex = 0;
    if (field?.label) show("dialog-label", field.label);
    dialog.returnValue = "";
    return new Promise((resolve) => {
        let timer;
        dialog.addEventListener("close", () => {
            clearTimeout(timer);
            resolve(dialog.returnValue === "confirm" ? field?.options ? select.value : field ? input.value : true : null);
        }, { once: true });
        dialog.showModal();
        if (field && !field.options) { input.focus(); input.select(); }
        if (timeout > 0) timer = setTimeout(() => dialog.close("cancel"), timeout);
    });
}

function selectedDisplay() {
    return displays.find((display) => display.id === byId("selMonitorPicker").value);
}

async function changeDisplay(kind) {
    const display = selectedDisplay();
    if (!display) return;
    const modes = await dashboardCommand("display_modes", { id: display.id });
    const refresh = kind === "refresh";
    const options = !modes ? [] : refresh
        ? modes.rates.map((hz) => ({ id: hz, name: hz + " Hz", active: hz === modes.current_rate }))
        : ["Landscape", "Portrait", "Landscape (flipped)", "Portrait (flipped)"].map((name, index) => ({
            id: index, name, active: index === modes.current_orientation
        }));
    if (!options.length) {
        await dashboardCommand("open_windows_settings", { page: refresh ? "advanced_display" : "display" });
        return;
    }
    const choice = await askDashboard(refresh ? "Display refresh rate" : "Display orientation", display.name, { options });
    if (choice == null || choice === "") return;
    const change = refresh ? { kind, hz: Number(choice) } : { kind, orientation: Number(choice) };
    const token = await dashboardCommand("preview_display", { id: display.id, change });
    if (token == null) return;
    const keep = await askDashboard("Keep this display setting?", "Windows will restore the previous setting in 15 seconds unless you apply it.", null, 14500);
    await dashboardCommand("confirm_display", { token, keep: Boolean(keep) }, keep ? "Display setting saved." : "Previous display setting restored.");
}

async function start() {
    const tauri = window.__TAURI__;
    if (!tauri) {
        show("status", "Launch through CoreWatch");
        return;
    }
    const invoke = tauri.core.invoke;
    invokeDashboard = invoke;
    networkView = createNetworkView(invoke);
    dashboardNetwork = createDashboardNetwork(invoke);
    const nativeWindow = tauri.window.getCurrentWindow();
    const preferences = createDashboardPreferences(tauri.core, nativeWindow, (unit) => {
        temperatureUnit = unit;
        renderTemperatures();
    });
    async function selectView(name, subview) {
        const dashboard = name === "dashboard";
        byId("viewDashboardGrid").hidden = !dashboard;
        byId("viewNetworkManagerPanel").hidden = dashboard;
        preferences.viewChanged(dashboard);
        for (const [id, active] of [["tabDashboard", dashboard], ["tabNetwork", !dashboard]]) {
            byId(id).classList.toggle("active", active);
            byId(id).setAttribute("aria-pressed", String(active));
        }
        if (!dashboard) await networkView.select(subview ?? "adapters");
    }
    byId("tabDashboard").addEventListener("click", () => selectView("dashboard"));
    byId("tabNetwork").addEventListener("click", () => selectView("network"));
    byId("lblNetAssignment").addEventListener("click", () => selectView("network", "adapters"));
    for (const id of ["lblIntIPv4", "lblGateway", "lblExtIPv4"]) {
        byId(id).addEventListener("click", async () => {
            let value = byId(id).textContent;
            if (id === "lblExtIPv4" && value === unavailable) {
                const button = byId(id);
                button.disabled = true;
                value = await dashboardCommand("external_ipv4");
                button.disabled = false;
                show(id, value);
                if (!value) log("No public IPv4 was returned.");
                return;
            }
            if (value === unavailable) return;
            try { await navigator.clipboard.writeText(value); log(value + " copied."); }
            catch { log("Clipboard access is unavailable."); }
        });
    }
    for (const [id, page] of Object.entries({
        lblMonScale: "display", "night-light-settings": "night_light", lblSharing: "sharing",
        "discovery-settings": "sharing", lblFirewall: "firewall", lblRealtime: "defender"
    })) {
        byId(id).addEventListener("click", () => dashboardCommand("open_windows_settings", { page }));
    }
    byId("lblMonRefresh").addEventListener("click", () => changeDisplay("refresh"));
    byId("lblMonOrientation").addEventListener("click", () => changeDisplay("orientation"));
    byId("lblMonHdr").addEventListener("click", async () => {
        const display = selectedDisplay();
        if (!display || !["On", "Off"].includes(display.advanced_color)) {
            await dashboardCommand("open_windows_settings", { page: "display" });
            return;
        }
        const enabled = display.advanced_color === "Off";
        if (await askDashboard("Advanced Color", (enabled ? "Enable" : "Disable") + " Advanced Color on " + display.name + "?")) {
            await dashboardCommand("set_advanced_color", { id: display.id, enabled }, "Advanced Color updated.");
        }
    });
    byId("identify-displays").addEventListener("click", async () => {
        const button = byId("identify-displays");
        button.disabled = true;
        await dashboardCommand("identify_displays");
        setTimeout(() => { button.disabled = false; }, 2300);
    });
    const elevate = async () => {
        if (await askDashboard("Restart as administrator", "Windows will ask for permission to reopen CoreWatch.")) {
            await dashboardCommand("elevate");
        }
    };
    byId("lblElevation").addEventListener("click", elevate);
    const sensorDialog = byId("cpu-sensor-dialog");
    byId("cpu-sensor-elevate").addEventListener("click", () => {
        sensorDialog.close();
        void elevate();
    });
    byId("badgeCpuTemp").addEventListener("click", async () => {
        show("cpu-sensor-source", latestTemperature.cpuTempSource ?? "Checking…");
        for (const id of ["cpu-sensor-helper", "cpu-sensor-pawnio", "cpu-sensor-privilege", "cpu-sensor-message"]) {
            show(id, "Checking…");
        }
        byId("cpu-sensor-elevate").hidden = true;
        sensorDialog.showModal();
        try {
            const status = await invoke("cpu_sensor_status");
            show("cpu-sensor-helper", status.helper_available ? "Available" : "Not staged");
            show("cpu-sensor-pawnio", status.pawn_io);
            show("cpu-sensor-privilege", status.elevated ? "Administrator" : "Standard user");
            const direct = status.reading?.cpuTemp != null;
            show("cpu-sensor-source", latestTemperature.cpuTempSource
                ?? (direct ? "LibreHardwareMonitor helper · " + (status.reading.sensor || "CPU die") : "No CPU reading"));
            const message = direct || latestTemperature.cpuTempSource ? "A CPU temperature reading is available."
                : !status.helper_available ? "Run prepare-sensors.ps1 from RUST-rewrite to stage the helper and its libraries."
                : status.pawn_io !== "Running" ? "Check the PawnIO installation and driver status."
                : !status.elevated ? "Try restarting CoreWatch as administrator to read the CPU die sensor."
                : "The helper has not reported a CPU die temperature for this hardware.";
            show("cpu-sensor-message", status.error ?? message);
            byId("cpu-sensor-elevate").hidden = status.elevated || !status.helper_available || status.pawn_io !== "Running";
        } catch (error) {
            show("cpu-sensor-message", String(error));
        }
    });
    byId("lblPowerPlan").addEventListener("click", async () => {
        const plans = await dashboardCommand("power_plans");
        if (!plans?.length) return;
        const id = await askDashboard("Power plan", "Select the Windows power plan to activate.", { options: plans });
        if (id) await dashboardCommand("set_power_plan", { id }, "Power plan updated.");
    });
    for (const [id, action] of [["minimize", "minimize"], ["maximize", "toggleMaximize"], ["exit", "close"]]) {
        byId(id).addEventListener("click", async () => {
            try { await nativeWindow[action](); }
            catch (error) { log(String(error)); }
        });
    }
    const setStatus = (message) => show("status", message);
    byId("selMonitorPicker").addEventListener("change", renderSelectedDisplay);
    byId("clear-logs").addEventListener("click", () => byId("console-box").replaceChildren());
    byId("copy-logs").addEventListener("click", async () => {
        const text = byId("console-box").innerText;
        try {
            await navigator.clipboard.writeText(text);
            log("Logs copied.");
        } catch {
            log("Clipboard access is unavailable.");
        }
    });
    byId("refresh").addEventListener("click", async () => {
        try {
            await invoke("refresh");
            log("Refresh requested.");
        } catch (error) {
            log(String(error));
        }
    });
    byId("test-network").addEventListener("click", async (event) => {
        const button = event.currentTarget;
        button.disabled = true;
        button.textContent = "Testing…";
        log("Running DNS, ICMP, and HTTPS checks against Cloudflare.");
        try {
            const result = await invoke("test_network");
            show("lblExtIPv4", result.public_ipv4);
            show("net-failures", result.packet_loss?.toFixed(0));
            show("net-latency", result.latency_ms?.toFixed(1));
            show("net-jitter", result.jitter_ms?.toFixed(1));
            show("net-download", result.download_mbps?.toFixed(1));
            show("net-upload", result.upload_mbps?.toFixed(1));
            for (const error of result.errors) log(error);
            log("Network check finished.");
        } catch (error) {
            log(String(error));
        } finally {
            button.disabled = false;
            button.textContent = "Test Mesh";
        }
    });

    await preferences.restore();
    let revision = 0;
    let connected = false;
    let notes = new Set();
    let smokeSent = false;
    let pollInterval = 500;
    async function poll() {
        if (document.hidden) {
            setTimeout(poll, pollInterval);
            return;
        }
        try {
            const sample = await invoke("snapshot", { after: revision });
            pollInterval = sample.pollIntervalMs;
            if (sample.live) renderLive(sample.live);
            if (sample.details) {
                renderDetails(sample.details);
                revision = sample.revision;
                for (const note of sample.details.notes) {
                    if (!notes.has(note)) log(note);
                }
                notes = new Set(sample.details.notes);
            }
            if (!connected && sample.live) {
                connected = true;
                setStatus("Live telemetry");
                log("Windows telemetry connected.");
            }
            if (sample.smokeTest && !smokeSent && revision && sample.live?.cpu_percent != null
                && byId("lblRamUsage").textContent.includes("GiB")
                && byId("lblHostName").textContent !== unavailable
                && document.querySelectorAll("[data-card-id]").length === 6
                && byId("storageVolumeContainer").querySelector(".storage-tight-row")) {
                smokeSent = true;
                try {
                    await verifyDashboardPreferences(tauri.core, preferences);
                    const { details: full } = await invoke("snapshot", { after: 0 });
                    byId("lblDnsServers").click();
                    if (!byId("dashboard-dns-dialog").open
                        || byId("dashboard-dns-adapter").textContent !== (full.dns_uplink?.name ?? "No active IPv4 adapter")
                        || byId("dashboard-dns-ipv4").textContent !== (full.dns_uplink?.ipv4.join(", ") || "None reported")
                        || byId("dashboard-dns-apply").disabled !== true) {
                        throw new Error("Dashboard DNS dialog did not render the active adapter and IPv4 preset controls.");
                    }
                    byId("dashboard-dns-close").click();
                    const sensorStatus = await invoke("cpu_sensor_status");
                    if (typeof sensorStatus.helper_available !== "boolean" || typeof sensorStatus.pawn_io !== "string") {
                        throw new Error("CPU sensor diagnostic did not report helper and driver state.");
                    }
                    const display = selectedDisplay();
                    if (display) {
                        const modes = await invoke("display_modes", { id: display.id });
                        if (modes.current_orientation > 3) throw new Error("Invalid display mode");
                    }
                    await selectView("network", "adapters");
                    const adapters = byId("adapterInterfaceContainer");
                    if (!adapters.querySelector(".network-adapter-card, .driver-text-node")) {
                        throw new Error("Network adapter UI did not render");
                    }
                    const [first, second] = adapters.querySelectorAll(".network-adapter-card");
                    if (second && second.getBoundingClientRect().top < first.getBoundingClientRect().bottom) {
                        throw new Error("Network adapter cards did not use separate rows.");
                    }
                    if (adapters.scrollWidth > adapters.clientWidth + 1) {
                        throw new Error("Network adapter cards overflowed horizontally.");
                    }
                    await selectView("network", "wifiroutes");
                    if (!byId("netRoutesContainer").querySelector("pre")) throw new Error("Routes pane did not render");
                    const diagnostic = await invoke("run_network_diagnostic", { request: { kind: "ping", target: "127.0.0.1" } });
                    renderDiagnostic(diagnostic);
                    if (!diagnostic.replies.some((reply) => reply.status === 0)) throw new Error("Loopback ICMP failed");
                    await selectView("dashboard");
                    await invoke("finish_dashboard_smoke", { error: null });
                } catch (error) {
                    await invoke("finish_dashboard_smoke", { error: String(error) });
                }
            }
        } catch (error) {
            if (connected || byId("status").textContent !== "Telemetry connection error") log(String(error));
            connected = false;
            setStatus("Telemetry connection error");
        }
        setTimeout(poll, pollInterval);
    }
    await poll();
}

document.addEventListener("DOMContentLoaded", start);
