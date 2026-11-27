"use strict";

const byId = (id) => document.getElementById(id);
const unavailable = "—";
const smokeErrors = [];
let statusErrorUntil = 0;

function showToast(message, tone = "info", durationMs = 2800) {
    const stack = byId("cwToastStack");
    if (!stack || !message) return;
    const toast = document.createElement("div");
    toast.className = `cw-toast tone-${tone}`;
    const icon = tone === "ok" ? "✓" : tone === "warn" ? "⚠" : tone === "crit" ? "✕" : "•";
    const glyph = document.createElement("span");
    glyph.textContent = icon;
    const text = document.createElement("span");
    text.textContent = String(message);
    toast.append(glyph, text);
    stack.append(toast);
    while (stack.childElementCount > 4) stack.firstElementChild.remove();
    setTimeout(() => {
        toast.classList.add("is-leaving");
        setTimeout(() => toast.remove(), 200);
    }, durationMs);
}
window.showToast = showToast;

const SPARK_MAX = 40;
const sparkBuffers = { cpu: [], gpu: [], ram: [], rx: [], tx: [] };
const SVG_NS = "http://www.w3.org/2000/svg";

function pushSpark(key, value) {
    if (typeof value !== "number" || !Number.isFinite(value)) return;
    const arr = sparkBuffers[key];
    arr.push(value);
    if (arr.length > SPARK_MAX) arr.shift();
}

function renderSingleSpark(svgId, values, color, maxFixed = 100, unit = "%") {
    const svg = byId(svgId);
    if (!svg || values.length < 2) return;
    const w = 56, h = 14;
    const maxV = maxFixed || Math.max(1, ...values);
    const step = w / (SPARK_MAX - 1);
    const offset = (SPARK_MAX - values.length) * step;
    const pts = values.map((v, i) => {
        const x = (offset + i * step).toFixed(1);
        const y = (h - 1 - Math.min(1, Math.max(0, v / maxV)) * (h - 2)).toFixed(1);
        return `${x},${y}`;
    }).join(" ");
    const poly = svg.firstElementChild || (() => {
        const p = document.createElementNS(SVG_NS, "polyline");
        p.setAttribute("fill", "none");
        p.setAttribute("stroke-width", "1.4");
        p.setAttribute("stroke-linejoin", "round");
        p.setAttribute("stroke-linecap", "round");
        svg.append(p);
        return p;
    })();
    poly.setAttribute("stroke", color);
    poly.setAttribute("points", pts);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const peak = Math.max(...values);
    svg.title = `20s Avg ${Math.round(avg)}${unit} · Peak ${Math.round(peak)}${unit}`;
}

function renderNetSpark() {
    const svg = byId("sparkNet");
    const rx = sparkBuffers.rx, tx = sparkBuffers.tx;
    if (!svg || (rx.length < 2 && tx.length < 2)) return;
    const w = 64, h = 14;
    const maxV = Math.max(1024, ...rx, ...tx);
    const drawLine = (idx, values, color) => {
        if (values.length < 2) return;
        const step = w / (SPARK_MAX - 1);
        const offset = (SPARK_MAX - values.length) * step;
        const pts = values.map((v, i) => `${(offset + i * step).toFixed(1)},${(h - 1 - Math.min(1, v / maxV) * (h - 2)).toFixed(1)}`).join(" ");
        while (svg.childElementCount <= idx) {
            const p = document.createElementNS(SVG_NS, "polyline");
            p.setAttribute("fill", "none");
            p.setAttribute("stroke-width", "1.3");
            svg.append(p);
        }
        const poly = svg.children[idx];
        poly.setAttribute("stroke", color);
        poly.setAttribute("points", pts);
    };
    drawLine(0, rx, "#4299e1");
    drawLine(1, tx, "#b794f4");
    const peakRx = rx.length ? Math.max(...rx) : 0;
    const peakTx = tx.length ? Math.max(...tx) : 0;
    svg.title = `20s Peak RX ${rate(peakRx)} · TX ${rate(peakTx)}`;
}

(function installErrorCollectors() {
    const origConsoleError = console.error.bind(console);
    console.error = (...args) => {
        smokeErrors.push("console.error: " + args.map((a) => (a instanceof Error ? a.message : String(a))).join(" "));
        origConsoleError(...args);
    };
    window.addEventListener("error", (ev) => {
        const msg = `JS error: ${ev.message} (${ev.filename}:${ev.lineno})`;
        smokeErrors.push(msg);
        window.__TAURI__?.core?.invoke("finish_dashboard_smoke", { error: msg }).catch(() => {});
    });
    window.addEventListener("unhandledrejection", (ev) => {
        const msg = `Unhandled rejection: ${ev.reason instanceof Error ? ev.reason.message : String(ev.reason)}`;
        smokeErrors.push(msg);
        window.__TAURI__?.core?.invoke("finish_dashboard_smoke", { error: msg }).catch(() => {});
    });
})();

const detailsLabels = {
    domain: "lblWorkgroup", host: "lblHostName", os: "lblOsEdition", build: "lblWinBuild",
    update: "lblUpdateLevel", directX: "lblDirectX", virtualization: "lblVirtualization",
    secureBoot: "lblSecureBoot", elevation: "lblElevation",
    board: "lblMotherboard", bios: "lblBiosVersion", powerPlan: "lblPowerPlan",
    audioOutput: "lblAudioOutput", audioInput: "lblAudioInput", ipv4: "lblIntIPv4",
    subnet: "lblSubnetMask", gateway: "lblGateway", assignment: "lblNetAssignment",
    wifiSsid: "lblWlanSsid", link: "lblLinkCap",
    ethernet: "lblEthernet", wifi: "lblWifi"
};

function show(id, value) {
    const element = byId(id);
    if (!element) return;
    if (id === "status") {
        if (value === "Action failed. See log.") statusErrorUntil = Date.now() + 6000;
        const text = String(value || "");
        element.classList.toggle("is-live", text === "Live telemetry");
        element.classList.toggle("is-paused", text.startsWith("Paused"));
        element.classList.toggle("is-error", /error|failed/i.test(text));
    }
    const missing = value == null || value === "";
    const next = missing ? unavailable : String(value);
    if (element.textContent !== next) element.textContent = next;
    if (element.dataset.origAriaLabel === undefined) {
        element.dataset.origAriaLabel = element.getAttribute("aria-label") ?? "";
    }
    if (element.dataset.unavailable !== String(missing)) {
        element.dataset.unavailable = String(missing);
        const orig = element.dataset.origAriaLabel;
        if (missing) {
            element.setAttribute("aria-label", orig ? `${orig} (Unavailable)` : "Unavailable");
        } else if (orig) {
            element.setAttribute("aria-label", orig);
        } else {
            element.removeAttribute("aria-label");
        }
    }
}

function percent(used, total) {
    return total > 0 ? used * 100 / total : 0;
}

function bar(id, value, dynamicLoad = false) {
    const clamped = Math.min(100, Math.max(0, value || 0));
    const el = byId(id);
    el.style.width = clamped + "%";
    if (dynamicLoad) {
        el.classList.toggle("bar-crit", clamped >= 90);
        el.classList.toggle("bar-warn", clamped >= 75 && clamped < 90);
    }
}

const gib = (value) => (value / 1024 ** 3).toFixed(2) + " GiB";

function usage(label, track, value) {
    const pct = value ? Math.round(percent(value.used, value.total)) : 0;
    show(label, value ? `${gib(value.used)} / ${gib(value.total)} (${pct}%)` : null);
    bar(track, value ? percent(value.used, value.total) : 0, true);
}

function uptime(seconds) {
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor(seconds / 3600) % 24;
    const minutes = Math.floor(seconds / 60) % 60;
    return days + "d " + hours + "h " + String(minutes).padStart(2, "0") + "m";
}

function rate(bytes) {
    if (bytes == null) return "0.00 KB/s";
    if (bytes >= 1024 ** 2) return (bytes / 1024 ** 2).toFixed(2) + " MB/s";
    return (bytes / 1024).toFixed(2) + " KB/s";
}

function rateBar(bytes) {
    return bytes > 0 ? Math.min(50, Math.max(4, (2 * Math.log(bytes) / Math.log(1.5)) * 0.5)) : 0;
}

let latestTopProcess = null;

function processMemory(bytes) {
    return bytes >= 1024 ** 3 ? gib(bytes) : Math.round(bytes / 1024 ** 2) + " MiB";
}

function processDetails(process) {
    const cpu = process.top_cpu;
    const ram = process.top_ram;
    return `PID ${process.pid}\nTop CPU — ${cpu ? `${cpu.name} (${Math.round(cpu.cpu_percent)}%)` : "Idle"}\nTop RAM — ${ram.name} (${processMemory(ram.memory)})`;
}

function renderLive(live) {
    show("lblCpuModel", live.cpu_name);
    show("lblCpuLoad", live.cpu_percent == null ? null : Math.round(live.cpu_percent) + "%");
    bar("barCpuLoad", live.cpu_percent, true);
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
    byId("lblPagefileUsage").title = live.commit ? `System commit ${gib(live.commit.used)} / ${gib(live.commit.total)}. The bar shows estimated commitment above physical RAM.` : "";
    show("lblUptime", uptime(live.uptime_seconds));
    const process = latestTopProcess = live.top_process;
    show("lblTopProcess", process && (
        process.name + " (" + (process.cpu_spike ? Math.round(process.cpu_percent) + "% CPU · " : "")
        + processMemory(process.memory) + ")"
    ));
    byId("lblTopProcess").disabled = !process;
    byId("lblTopProcess").title = process ? processDetails(process) : "Sampling processes…";
    show("lblNetRx", rate(live.traffic?.rx));
    show("lblNetTx", rate(live.traffic?.tx));
    bar("barNetRx", rateBar(live.traffic?.rx));
    bar("barNetTx", rateBar(live.traffic?.tx));
    if (live.cpu_percent != null) {
        pushSpark("cpu", live.cpu_percent);
        renderSingleSpark("sparkCpu", sparkBuffers.cpu, live.cpu_percent >= 85 ? "#f56565" : live.cpu_percent >= 65 ? "#ecc94b" : "var(--cw-accent-soft)");
    }
    if (live.ram && live.ram.total > 0) {
        const ramPct = percent(live.ram.used, live.ram.total);
        pushSpark("ram", ramPct);
        renderSingleSpark("sparkRam", sparkBuffers.ram, ramPct >= 85 ? "#f56565" : ramPct >= 70 ? "#ecc94b" : "#38b2ac");
    }
    if (live.traffic) {
        pushSpark("rx", live.traffic.rx || 0);
        pushSpark("tx", live.traffic.tx || 0);
        renderNetSpark();
    }
}

function element(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text != null) node.textContent = text;
    return node;
}

const volumeRows = new Map();
let openStorageMap;
let diskMapAvailable = true;
const mapEligible = (volume) => ["Local Volume", "Removable", "Optical Drive", "RAM Disk"].includes(volume.drive_type);

function createVolumeRow(mount) {
    const row = element("div", "metric-row storage-tight-row");
    const header = element("div", "metric-metadata");
    const entry = { row, volume: null };
    const drive = actionButton("", async () => {
        const label = await askDashboard("Rename volume", mount, { label: "Volume label", value: entry.volume.label });
        if (typeof label === "string") await dashboardCommand("label_volume", { mount, label }, "Volume label updated.");
    });
    drive.className = "storage-interactive-row-header";
    entry.drive = drive;
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
    const open = actionButton("📂", () => dashboardCommand("open_volume", { mount }));
    open.className = "storage-map-btn storage-explorer-btn";
    open.title = `Open ${mount} in File Explorer`;
    open.setAttribute("aria-label", open.title);
    entry.map = actionButton("🗺 Map", () => openStorageMap(mount));
    entry.map.className = "storage-map-btn";
    entry.map.title = `Open ${mount} in Disk Map`;
    entry.health = element("span", "diag-pill");
    entry.activity = element("span", "diag-pill diag-neutral");
    entry.kind = element("span", "driver-tag tight-tag");
    badges.append(entry.map, open, entry.health, entry.activity);
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
        entry.map.hidden = !diskMapAvailable || !mapEligible(volume);
        entry.icon.textContent = volume.removable ? "🟢 " : "🏷️ ";
        entry.title.textContent = (volume.label || "Local Disk") + " (" + volume.mount.slice(0, 2) + ")";
        entry.title.className = "drive-title " + (volume.removable ? "text-removable" : "text-local");
        entry.drive.title = `Rename ${entry.title.textContent}`;
        const usedPercent = percent(volume.used, volume.total);
        entry.usage.textContent = gib(volume.used) + " / " + gib(volume.total) + " (" + Math.round(usedPercent) + "%)";
        entry.fill.style.width = Math.min(100, usedPercent) + "%";
        entry.fill.style.backgroundColor = volume.removable ? "#9f7aea" : "";
        entry.fill.classList.toggle("bar-crit", usedPercent >= 95);
        entry.fill.classList.toggle("bar-warn", usedPercent >= 85 && usedPercent < 95);
        const wear = volume.wear_percent;
        const temp = volume.temperature_c;
        entry.health.textContent = [volume.health ?? "SMART N/A", wear == null ? null : `${wear}% Wear`, temp == null ? null : `${temp}°C`].filter(Boolean).join(" · ");
        entry.health.className = "diag-pill " + (volume.health === "Unhealthy" || wear >= 90 ? "diag-crit"
            : volume.health === "Warning" || wear >= 70 ? "diag-warn" : volume.health === "Healthy" ? "diag-ok" : "diag-neutral");
        entry.health.title = [volume.disk_name, volume.health && `Health ${volume.health}`, wear != null && `Wear ${wear}%`,
            volume.temperature_c != null && `Disk temperature ${volume.temperature_c} °C`,
            volume.read_errors != null && `Read errors ${volume.read_errors}`, volume.write_errors != null && `Write errors ${volume.write_errors}`]
            .filter(Boolean).join(" · ") || "Windows did not report SMART status for this volume.";
        const active = volume.active_percent;
        const latency = volume.latency_ms;
        const activity = [active != null && `${active}%`, latency != null && `${latency.toFixed(1)}ms`].filter(Boolean).join(" · ");
        entry.activity.textContent = "I/O " + (activity || "—");
        entry.activity.className = "diag-pill " + (active >= 90 || latency >= 35 ? "diag-crit" : active >= 70 || latency >= 15 ? "diag-warn" : "diag-neutral");
        entry.activity.title = [active != null && `Active time ${active}%`, latency != null && `Average transfer latency ${latency.toFixed(2)} ms`,
            volume.queue_length != null && `Queue length ${volume.queue_length.toFixed(1)}`].filter(Boolean).join(" · ") || "Waiting for Windows disk counters.";
        entry.kind.textContent = [volume.drive_type, volume.kind, volume.filesystem].filter(Boolean).join(" · ");
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
    byId("lblMonHdr").disabled = !["On", "Off"].includes(display?.advanced_color);
    for (const id of ["lblMonRefresh", "lblMonScale", "lblMonOrientation"]) byId(id).disabled = !display;
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
                if (!await confirmDashboardAction((enable ? "Enable " : "Disable ") + adapter.name,
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
            : reading === "cpuTemp"
                ? (latestTemperature.elevated === false
                    ? "CPU die temperature requires Administrator (PawnIO driver) — click to check status or restart elevated"
                    : "Click to inspect CPU temperature sensor status")
                : "GPU temperature is unavailable from the current sensor provider.";
    }
}

let latestCrash = null;
let crashReadout = null;
let diagnosticsAvailable = true;

function renderCrash() {
    const node = byId("lblLastCrash");
    const event = latestCrash;
    node.classList.remove("crash-recent", "crash-older", "crash-clean");
    node.disabled = !event || !diagnosticsAvailable;
    if (!event) {
        show("lblLastCrash", crashReadout);
        if (crashReadout) node.classList.add("crash-clean");
        node.title = crashReadout ? "No matching Kernel-Power or BugCheck events in the System log." : "Windows crash history is unavailable.";
        return;
    }
    const stamp = new Date(event.key.time_ms);
    const caption = stamp.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })
        + " " + stamp.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    const tag = event.event_id === 41 ? "KP-41" : "BSOD 1001";
    show("lblLastCrash", `${caption} (${tag})`);
    node.classList.add(Date.now() - event.key.time_ms <= 14 * 86400000 ? "crash-recent" : "crash-older");
    node.title = [`${event.provider} · System record ${event.key.record}`, event.message?.split(/\r?\n/, 1)[0], diagnosticsAvailable && "Inspect this event in UltimaDiagX"]
        .filter(Boolean).join("\n");
}

function renderDetails(details, isSmoke = false) {
    const fields = details.fields;
    for (const [key, id] of Object.entries(detailsLabels)) show(id, fields[key]);
    const updEl = byId("lblUpdateLevel");
    if (updEl) {
        updEl.classList.toggle("text-state-warn", Boolean(fields.update?.includes("Reboot Pending")));
        updEl.classList.toggle("text-state-ok", Boolean(fields.update?.includes("Up to Date")));
    }
    const sbEl = byId("lblSecureBoot");
    if (sbEl) {
        sbEl.classList.toggle("text-state-ok", fields.secureBoot === "On");
        sbEl.classList.toggle("text-state-warn", fields.secureBoot === "Off");
    }
    latestCrash = details.last_crash;
    crashReadout = fields.lastCrash;
    renderCrash();
    networkView?.setGateway(fields.gateway);
    dashboardNetwork?.update(details, isSmoke);
    dashboardControls?.update(details);
    tint("lblElevation", fields.elevation === "Administrator" ? "diag-ok" : "diag-neutral");
    byId("lblElevation").disabled = fields.elevation === "Administrator";
    show("badgeThrottleState", "Throttle: " + (fields.throttle ?? unavailable));
    const throttleCrit = Boolean(fields.throttle && /thermal|prochot|critical/i.test(fields.throttle));
    tint("badgeThrottleState", fields.throttle === "None reported" ? "diag-ok" : throttleCrit ? "diag-crit" : fields.throttle ? "diag-warn" : "diag-neutral");
    byId("badgeThrottleState").title = fields.throttleDetail ?? (fields.throttle ? "Windows reported no active CPU limits." : "CPU limit counters are unavailable.");
    latestTemperature = {
        cpuTemp: fields.cpuTemp,
        cpuTempSource: fields.cpuTempSource,
        gpuTemp: fields.gpuTemp,
        elevated: fields.elevation === "Administrator"
    };
    renderTemperatures();
    rgbStudio?.updateThermal(
        fields.cpuTemp == null || fields.cpuTemp === "" ? null : Number(fields.cpuTemp),
        fields.gpuTemp == null || fields.gpuTemp === "" ? null : Number(fields.gpuTemp)
    );
    show("lblGpuModel", fields.gpuName);
    show("lblGpuDriver", fields.gpuDriver);
    show("lblGpuLoad", fields.gpuLoad == null ? null : fields.gpuLoad + "%");
    bar("barGpuLoad", Number(fields.gpuLoad), true);
    if (fields.gpuLoad != null && Number.isFinite(Number(fields.gpuLoad))) {
        const g = Number(fields.gpuLoad);
        pushSpark("gpu", g);
        renderSingleSpark("sparkGpu", sparkBuffers.gpu, g >= 85 ? "#f56565" : g >= 65 ? "#ecc94b" : "#9f7aea");
    }
    show("lblGpuPower", fields.gpuPower == null ? null : fields.gpuPower + " W");
    const vram = fields.vramUsed == null ? null : Number(fields.vramUsed);
    const total = fields.vramTotal == null ? null : Number(fields.vramTotal);
    const vramPct = vram != null && total != null && total > 0 ? Math.round(percent(vram, total)) : null;
    show("lblGpuVram", vram != null || total != null
        ? (vram == null ? unavailable : gib(vram)) + " / " + (total == null ? unavailable : gib(total)) + (vramPct != null ? ` (${vramPct}%)` : "")
        : null);
    bar("barGpuVram", vram != null && total != null ? percent(vram, total) : 0, true);
    const hasVCache = /\b\w*X3D\b/i.test(byId("lblCpuModel").textContent);
    byId("cpuCacheContainer").replaceChildren(...["L1", "L2", "L3"].map((level) => {
        const value = fields[level.toLowerCase()];
        const vCache = level === "L3" && hasVCache && value;
        return element("span", `cache-tag${vCache ? " highlight-x3d" : ""}`, level + ": " + (value ?? unavailable) + (vCache ? " (3D V-Cache)" : ""));
    }));
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
    if (!box) return;
    const text = String(message);
    const stick = box.scrollHeight - box.scrollTop - box.clientHeight < 28;
    const cls = /fail|error|denied|unable|critical|cannot/i.test(text) ? "log-err"
        : /warn|timeout|throttl|paused|locked/i.test(text) ? "log-warn"
        : /saved|updated|connected|finished|copied|applied|restored|flushed|synced/i.test(text) ? "log-ok" : "";
    const line = element("div", cls, "[" + new Date().toLocaleTimeString() + "] " + text);
    box.append(line);
    if (box.childElementCount > 250) box.firstElementChild.remove();
    if (stick) box.scrollTop = box.scrollHeight;
}

let networkView;
let dashboardNetwork;
let dashboardControls;
let rgbStudio;
let invokeDashboard;

async function dashboardCommand(name, args, success) {
    try {
        const result = await invokeDashboard(name, args);
        if (success) {
            log(success);
            showToast(success, "ok");
        }
        return result;
    } catch (error) {
        const msg = String(error);
        log(msg);
        show("status", "Action failed. See log.");
        showToast(msg, "crit", 4000);
        return undefined;
    }
}

function askDashboard(title, message, field, timeout = 0, confirmLabel = "Apply") {
    const dialog = byId("dashboard-dialog");
    if (dialog.open) return Promise.resolve(null);
    show("dialog-title", title);
    show("dialog-message", message);
    const confirm = dialog.querySelector('button[value="confirm"]');
    confirm.textContent = confirmLabel;
    dialog.querySelector('button[value="cancel"]').hidden = confirmLabel === "Close";
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
    if (kind === "scale") {
        const scale = await dashboardCommand("display_scale_options", { id: display.id });
        if (!scale) return;
        const options = scale.available.map((percent) => ({ id: percent, name: `${percent}%`, active: percent === scale.current }));
        const choice = await askDashboard("Display scale", display.name, { options });
        if (choice && Number(choice) !== scale.current) {
            await dashboardCommand("apply_dashboard_change", { change: { kind: "display_scale", id: display.id, percent: Number(choice) } }, "Display scale updated.");
        }
        return;
    }
    const modes = await dashboardCommand("display_modes", { id: display.id });
    const refresh = kind === "refresh";
    const options = !modes ? [] : refresh
        ? modes.rates.map((hz) => ({ id: hz, name: hz + " Hz", active: hz === modes.current_rate }))
        : ["Landscape", "Portrait", "Landscape (flipped)", "Portrait (flipped)"].map((name, index) => ({
            id: index, name, active: index === modes.current_orientation
        }));
    if (!options.length) return;
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
    byId("corewatch-project").addEventListener("click", () => dashboardCommand("settings_action", { action: { kind: "open_project" } }));
    networkView = createNetworkView(invoke);
    dashboardNetwork = createDashboardNetwork(invoke);
    dashboardControls = createDashboardControls();
    const nativeWindow = tauri.window.getCurrentWindow();
    const tasks = createTasksView(invoke);
    const diskMap = createDiskMap(invoke);
    const diagnostics = createDiagnosticsView(invoke);
    const diskPartitioner = createDiskPartitioner(invoke);
    let currentView = "dashboard";
    let hiddenModules = [];
    const views = [
        ["dashboard", "tabDashboard", "viewDashboardGrid", null, null],
        ["network", "tabNetwork", "viewNetworkManagerPanel", "netmanager", null],
        ["tasks", "tabTasksPorts", "viewTasksPortsPanel", "tasksports", null],
        ["diagx", "tabUltimaDiagX", "viewUltimaDiagXPanel", "diagx", null],
        ["github", "tabGitHubManager", "viewGitHubPanel", "github", "tabDevMenu"],
        ["jira", "tabJiraManager", "viewJiraPanel", "jira", "tabDevMenu"],
        ["wsl", "tabWslManager", "viewWslManagerPanel", "wsl", "tabDevMenu"],
        ["docker", "tabDockerServices", "viewDockerPanel", "docker", "tabDevMenu"],
        ["sshcerts", "tabSshCerts", "viewSshCertsPanel", "sshcerts", "tabDevMenu"],
        ["homelab", "tabHomelab", "viewHomelabPanel", "homelab", "tabDevMenu"],
        ["alerts", "tabSmartAlerts", "viewSmartAlertsPanel", "alerts", "tabOpsMenu"],
        ["updates", "tabUpdateCenter", "viewUpdateCenterPanel", "updates", "tabOpsMenu"],
        ["snapshots", "tabSnapshots", "viewSnapshotsPanel", "snapshots", "tabOpsMenu"],
        ["backupsync", "tabBackupSync", "viewBackupSyncPanel", "backupsync", "tabOpsMenu"],
        ["battery", "tabBatteryPeripherals", "viewBatteryPanel", "battery", "tabOpsMenu"],
        ["security", "tabSecurityRepair", "viewSecurityRepairPanel", "security", "tabOpsMenu"],
        ["profiles", "tabProfiles", "viewProfilesPanel", "profiles", "tabSystemMenu"],
        ["startup", "tabStartup", "viewStartupPanel", "startup", "tabSystemMenu"],
        ["sharing", "tabSharing", "viewSharingPanel", "sharing", "tabSystemMenu"],
        ["apps", "tabInstalledApps", "viewInstalledAppsPanel", "apps", "tabSystemMenu"],
        ["appstore", "tabAppStore", "viewAppInstallerPanel", "appstore", "tabSystemMenu"],
        ["diskmap", "tabDiskMap", "viewDiskMapPanel", "diskmap", "tabSystemMenu"],
        ["devices", "tabDevices", "viewSystemDevicesPanel", "devices", "tabSystemMenu"],
        ["organizer", "tabOrganizer", "viewFileOrganizerPanel", "organizer", "tabSystemMenu"],
        ["rgbstudio", "tabRgbStudio", "viewRgbStudioPanel", "rgbstudio", "tabSystemMenu"]
    ];

    const dropdownPairs = [
        ["tabDevMenu", "navDevMenu"],
        ["tabOpsMenu", "navOpsMenu"],
        ["tabSystemMenu", "navSystemMenu"],
        ["btnHeaderModePill", "navModePillMenu"]
    ];
    function closeDropdowns() {
        for (const [triggerId, menuId] of dropdownPairs) {
            const trigger = byId(triggerId);
            const menu = byId(menuId);
            menu?.classList.remove("open", "align-left");
            trigger?.closest(".nav-dropdown")?.classList.remove("open");
            trigger?.setAttribute("aria-expanded", "false");
        }
    }
    for (const [triggerId, menuId] of dropdownPairs) {
        byId(triggerId)?.addEventListener("click", (ev) => {
            ev.stopPropagation();
            const trigger = byId(triggerId);
            const menu = byId(menuId);
            if (!menu) return;
            const willOpen = !menu.classList.contains("open");
            closeDropdowns();
            if (willOpen) {
                window.dispatchEvent(new CustomEvent("cw-close-overlays", { detail: { source: "dropdown" } }));
                menu.classList.add("open");
                trigger?.closest(".nav-dropdown")?.classList.add("open");
                trigger?.setAttribute("aria-expanded", "true");
                const rect = menu.getBoundingClientRect();
                if (rect.left < 8) menu.classList.add("align-left");
                if (menu.getBoundingClientRect().right > window.innerWidth - 8) {
                    menu.classList.remove("align-left");
                }
            }
        });
    }
    document.addEventListener("click", (ev) => {
        if (!ev.target.closest(".nav-dropdown")) closeDropdowns();
    });
    window.addEventListener("cw-close-overlays", (ev) => {
        if (ev.detail?.source !== "dropdown") closeDropdowns();
    });
    document.addEventListener("keydown", (ev) => {
        if (ev.key === "Escape" && !document.querySelector("dialog[open]")) {
            closeDropdowns();
        }
    });

    const headerDeck = document.querySelector(".app-header-deck");
    if (headerDeck && typeof ResizeObserver !== "undefined") {
        const syncHeaderHeight = () => {
            const bottom = Math.ceil(headerDeck.getBoundingClientRect().bottom);
            if (bottom > 0) document.documentElement.style.setProperty("--cw-header-height", bottom + "px");
        };
        syncHeaderHeight();
        new ResizeObserver(syncHeaderHeight).observe(headerDeck);
    }

    byId("dialog-cancel-btn")?.addEventListener("click", () => {
        const dialog = byId("dashboard-dialog");
        if (dialog?.open) dialog.close("cancel");
    });

    const modulesHub = createModulesHub(invoke, { closeDropdowns });
    const extraModules = createExtraModules(invoke);
    rgbStudio = createRgbStudio(invoke);
    const preferences = createDashboardPreferences(tauri.core, nativeWindow, (unit) => {
        temperatureUnit = unit;
        renderTemperatures();
        rgbStudio?.setTemperatureUnit?.(unit);
    }, (disabled) => {
        hiddenModules = disabled;
        diskMapAvailable = !disabled.includes("diskmap");
        diagnosticsAvailable = !disabled.includes("diagx");
        const alertsBell = byId("btnHeaderAlertsBell");
        if (alertsBell) alertsBell.hidden = disabled.includes("alerts");
        const modeDropdown = byId("navModePillDropdown");
        if (modeDropdown) modeDropdown.hidden = disabled.includes("profiles");
        const netAssign = byId("lblNetAssignment");
        if (netAssign) {
            const netHidden = disabled.includes("netmanager");
            netAssign.disabled = netHidden;
            netAssign.title = netHidden ? "Network Manager module is hidden" : "Open Adapters & IP";
        }
        const rgbDisabled = disabled.includes("rgbstudio");
        const themeSyncRgb = byId("theme-sync-rgb");
        if (themeSyncRgb) themeSyncRgb.hidden = rgbDisabled;
        rgbStudio?.setEnabled?.(!rgbDisabled);
        renderCrash();
        for (const entry of volumeRows.values()) entry.map.hidden = !diskMapAvailable || !mapEligible(entry.volume);
        for (const [, button, , module] of views) {
            if (module) byId(button).hidden = disabled.includes(module);
        }
        for (const [triggerId, menuId] of dropdownPairs.slice(0, 3)) {
            const anyVisible = [...byId(menuId).querySelectorAll(".nav-menu-item")].some((b) => !b.hidden);
            byId(triggerId).parentElement.hidden = !anyVisible;
        }
        if (views.some(([view, , , module]) => view === currentView && disabled.includes(module))) void selectView("dashboard");
    });

    const dropdownDefaults = {
        tabDevMenu: ["lblDevMenuText", "💻 Dev & Work"],
        tabOpsMenu: ["lblOpsMenuText", "🛡️ Ops & Guard"],
        tabSystemMenu: ["lblSystemMenuText", "🧰 System"]
    };
    const shortMenuNames = {
        github: "🐙 GitHub", jira: "📋 Jira", wsl: "🐧 WSL", docker: "🐳 Docker", sshcerts: "🔐 SSH", homelab: "🌐 Homelab",
        alerts: "🔔 Alerts", updates: "🔄 Updates", snapshots: "📸 Snapshots", backupsync: "💾 Backup", battery: "🔋 Battery", security: "🛡️ Security",
        profiles: "⚡ Profiles", startup: "🚀 Startup", sharing: "📂 Sharing", apps: "📦 Apps", appstore: "⬇️ Installer",
        diskmap: "🗺️ Disk Map", devices: "🧩 Devices", organizer: "🗂️ Organizer", rgbstudio: "🌈 RGB Studio"
    };

    let viewSeq = 0;
    async function selectView(name, subview) {
        if (!views.some(([view]) => view === name)) return;
        if (views.some(([view, , , module]) => view === name && hiddenModules.includes(module))) return;
        const seq = ++viewSeq;
        const prevView = currentView;
        closeDropdowns();
        if (prevView && prevView !== name) {
            if (prevView === "diskmap") diskMap.leave?.();
            modulesHub.leave?.(prevView);
            extraModules.leave?.(prevView);
        }
        currentView = name;
        preferences.viewChanged(name === "dashboard");
        const activeDropdowns = new Set();
        for (const [view, button, panel, , parentDropdown] of views) {
            const active = view === name;
            byId(panel).hidden = !active;
            const btn = byId(button);
            btn.classList.toggle("active", active);
            if (btn.getAttribute("role") !== "menuitem") {
                btn.setAttribute("aria-pressed", String(active));
            }
            if (active && parentDropdown) activeDropdowns.add(parentDropdown);
        }
        for (const [triggerId, [labelId, fallback]] of Object.entries(dropdownDefaults)) {
            const active = activeDropdowns.has(triggerId);
            byId(triggerId)?.classList.toggle("active", active);
            const labelEl = byId(labelId);
            if (labelEl) labelEl.textContent = active && shortMenuNames[name] ? shortMenuNames[name] : fallback;
        }
        await Promise.all([tasks.show(name === "tasks"), diagnostics.show(name === "diagx", subview)]);
        if (seq !== viewSeq) return;
        if (name === "network") await networkView.select(subview ?? "adapters");
        else if (name === "diskmap") await diskMap.show(subview);
        else if (name === "rgbstudio") await rgbStudio.show(true);
        else {
            await modulesHub.show(name);
            if (seq !== viewSeq) return;
            await extraModules.show(name);
        }
    }

    window.cwApp = {
        selectView,
        showToast,
        inspectPid: async (pid) => {
            if (hiddenModules.includes("tasksports")) return;
            await selectView("tasks");
            tasks.inspect(pid);
        },
        openTaskSockets: async () => {
            if (hiddenModules.includes("tasksports")) return;
            await selectView("tasks");
            document.querySelector('[data-task-pane="socket"]')?.click();
        },
        syncRgbAccent: async (hex) => {
            if (hiddenModules.includes("rgbstudio")) return false;
            if (rgbStudio?.syncThemeAccent) {
                const ok = await rgbStudio.syncThemeAccent(hex);
                showToast(ok ? `RGB synced to ${hex}` : "RGB accent sync failed", ok ? "ok" : "crit");
                return ok;
            }
            return false;
        }
    };

    for (const [view, button] of views) {
        byId(button)?.addEventListener("click", () => void selectView(view));
    }
    byId("btnHeaderAlertsBell")?.addEventListener("click", () => void selectView("alerts"));
    byId("lblLastCrash").addEventListener("click", () => { if (latestCrash) void selectView("diagx", latestCrash.key); });
    openStorageMap = (mount) => selectView("diskmap", mount);

    // Supercharged Quick Command Palette (Ctrl+K)
    const cmdModal = byId("cwCommandPaletteModal");
    const cmdInput = byId("cmdkSearchInput");
    const cmdResults = byId("cmdkResults");
    const switchProfile = async (id, label) => {
        try {
            await invoke("profiles_action", { action: { kind: "activate", id } });
            showToast(`Profile switched → ${label}`, "ok");
            log(`System profile activated: ${label}`);
            void modulesHub.refreshHeaderMode?.();
        } catch (err) {
            showToast(String(err), "crit");
        }
    };
    const commandCatalog = [
        ...views.map(([view, btnId, , modId]) => ({
            cat: "View",
            label: byId(btnId)?.querySelector("strong")?.textContent || byId(btnId)?.textContent?.trim() || view,
            hint: "Switch View",
            hidden: () => modId && hiddenModules.includes(modId),
            run: () => void selectView(view)
        })),
        // Sub-view deep links
        { cat: "View", label: "🔌 Network: Adapters & IP", hint: "IPv4, DNS presets & link status", hidden: () => hiddenModules.includes("netmanager"), run: () => void selectView("network", "adapters") },
        { cat: "View", label: "🧪 Network: Active Diagnostics", hint: "Ping, Traceroute, Port Scan, DNS Lookup", hidden: () => hiddenModules.includes("netmanager"), run: () => void selectView("network", "diagnostics") },
        { cat: "View", label: "📶 Network: Wi-Fi, Routes & ARP", hint: "Radio telemetry, routing table & neighbors", hidden: () => hiddenModules.includes("netmanager"), run: () => void selectView("network", "wifiroutes") },
        { cat: "View", label: "⚙️ Tasks: Windows Services", hint: "Inspect & control Windows services", hidden: () => hiddenModules.includes("tasksports"), run: () => void selectView("tasks").then(() => document.querySelector('[data-task-pane="service"]')?.click()) },
        { cat: "View", label: "🔌 Tasks: Active Sockets & Ports", hint: "TCP/UDP listeners & connections", hidden: () => hiddenModules.includes("tasksports"), run: () => void selectView("tasks").then(() => document.querySelector('[data-task-pane="socket"]')?.click()) },
        // System Modes
        { cat: "Mode", label: "🖥️ Mode: Normal", hint: "Balanced power & default apps", hidden: () => hiddenModules.includes("profiles"), run: () => void switchProfile("normal", "Normal") },
        { cat: "Mode", label: "💼 Mode: Work / Focus", hint: "Balanced power + stay awake", hidden: () => hiddenModules.includes("profiles"), run: () => void switchProfile("work", "Work") },
        { cat: "Mode", label: "🎮 Mode: Gaming", hint: "High performance + RGB sync", hidden: () => hiddenModules.includes("profiles"), run: () => void switchProfile("gaming", "Gaming") },
        { cat: "Mode", label: "🎥 Mode: Streaming", hint: "High performance + stay awake", hidden: () => hiddenModules.includes("profiles"), run: () => void switchProfile("streaming", "Streaming") },
        { cat: "Mode", label: "🌙 Mode: Night / Quiet", hint: "Power saver + Night Light", hidden: () => hiddenModules.includes("profiles"), run: () => void switchProfile("night", "Night") },
        { cat: "Mode", label: "↩ Revert System Mode Baseline", hint: "Restore previous power & display state", hidden: () => hiddenModules.includes("profiles"), run: () => void invoke("profiles_action", { action: { kind: "revert_baseline" } }).then(() => { showToast("Reverted to baseline", "ok"); void modulesHub.refreshHeaderMode?.(); }).catch((e) => showToast(String(e), "crit")) },
        // RGB Actions
        { cat: "RGB", label: "⬛ RGB Stealth Blackout", hint: "Turn off all connected RGB LEDs", hidden: () => hiddenModules.includes("rgbstudio"), run: () => void rgbStudio.blackout().then((ok) => showToast(ok ? "RGB Stealth Blackout active" : "RGB blackout failed", ok ? "info" : "crit")) },
        { cat: "RGB", label: "🎨 Sync RGB to Theme Accent", hint: "Match all RGB hardware to current UI accent", hidden: () => hiddenModules.includes("rgbstudio"), run: () => void window.cwApp.syncRgbAccent(getComputedStyle(document.documentElement).getPropertyValue("--cw-accent").trim() || "#3182ce") },
        { cat: "RGB", label: "💙 RGB Preset: CoreWatch Cyber", hint: "Apply CoreWatch Cyber dual pulse", hidden: () => hiddenModules.includes("rgbstudio"), run: () => void rgbStudio.applyPreset?.("corewatch-cyber").then((ok) => showToast(ok ? "RGB: CoreWatch Cyber" : "RGB preset failed", ok ? "ok" : "crit")) },
        { cat: "RGB", label: "💚 RGB Preset: Emerald Breathe", hint: "Apply Emerald Breathe lighting", hidden: () => hiddenModules.includes("rgbstudio"), run: () => void rgbStudio.applyPreset?.("emerald-pulse").then((ok) => showToast(ok ? "RGB: Emerald Breathe" : "RGB preset failed", ok ? "ok" : "crit")) },
        { cat: "RGB", label: "🌡️ RGB Preset: Thermal GPU Guard", hint: "Color hardware by live GPU temperature", hidden: () => hiddenModules.includes("rgbstudio"), run: () => void rgbStudio.applyPreset?.("thermal-gpu").then((ok) => showToast(ok ? "RGB: Thermal GPU Guard" : "RGB preset failed", ok ? "ok" : "crit")) },
        { cat: "RGB", label: "🌈 RGB Preset: Rainbow Wave", hint: "Smooth 15 Hz spectrum wave", hidden: () => hiddenModules.includes("rgbstudio"), run: () => void rgbStudio.applyPreset?.("rainbow-wave").then((ok) => showToast(ok ? "RGB: Rainbow Wave" : "RGB preset failed", ok ? "ok" : "crit")) },
        // Actions & Tools
        { cat: "Action", label: "💿 Disk Partitioner (Floating)", hint: "Pauses live telemetry while open", run: () => void diskPartitioner.open() },
        { cat: "Action", label: "🧹 Flush Windows DNS Cache", hint: "Native DnsFlushResolverCache", run: () => void dashboardCommand("check_dns", { flush: true }, "Windows DNS cache flushed.") },
        { cat: "Action", label: "↻ Refresh Telemetry Now", hint: "Force immediate sensor & metric poll", run: () => byId("refresh").click() },
        { cat: "Action", label: "🌐 Test Network Mesh", hint: "Cloudflare Latency, Jitter & Speed test", run: () => { void selectView("dashboard").then(() => byId("test-network").click()); } },
        { cat: "Action", label: "📋 Copy System Logs", hint: "Copy console output to clipboard", run: () => byId("copy-logs").click() },
        { cat: "Action", label: "🔄 Scan All Updates (WinGet + PS)", hint: "Open Unified Update Center and scan", hidden: () => hiddenModules.includes("updates"), run: () => void selectView("updates") },
        { cat: "Action", label: "🌐 Probe All Homelab Nodes", hint: "Check reachability across all hosts", hidden: () => hiddenModules.includes("homelab"), run: () => void selectView("homelab").then(() => byId("homelab-probe-all")?.click()) },
        // Window & Layout
        { cat: "Window", label: "⚙️ Application Settings (Ctrl+,)", hint: "General, Font Size, Directories, Modules", run: () => preferences.openPanel("preferences") },
        { cat: "Window", label: "🎨 Theme & Appearance Studio", hint: "Presets, Colors, Wallpaper", run: () => preferences.openPanel("appearance") },
        { cat: "Window", label: "✏️ Customize Dashboard Layout", hint: "Cards, Dock, Opacity", run: () => { void selectView("dashboard").then(() => preferences.openPanel("layout")); } },
        { cat: "Window", label: "🔒 Cycle Window Lock Mode", hint: "Unlocked → Position → Position & Size", run: () => void preferences.cycleLockMode() },
        { cat: "Window", label: "📌 Toggle Always on Top", hint: "Pin or unpin CoreWatch above other windows", run: () => void preferences.togglePin() },
        { cat: "Window", label: "◫ Toggle Telemetry Dock", hint: "Open/close right-edge docked frames drawer", run: () => preferences.toggleDock() },
        // Font Sizes
        { cat: "Font", label: "Aa Font Size: Small (88%)", hint: "Compact high-density typography", run: () => preferences.setFontSize("small") },
        { cat: "Font", label: "Aa Font Size: Normal (100%)", hint: "Default balanced typography", run: () => preferences.setFontSize("normal") },
        { cat: "Font", label: "Aa Font Size: Large (112%)", hint: "Easier reading on high-DPI displays", run: () => preferences.setFontSize("large") },
        { cat: "Font", label: "Aa Font Size: Extra Large (124%)", hint: "Maximum legibility typography", run: () => preferences.setFontSize("xlarge") },
        // Theme Presets
        { cat: "Theme", label: "🎨 Theme: CoreWatch Classic", hint: "Default dark slate blue", run: () => preferences.applyThemePreset("classic") },
        { cat: "Theme", label: "🎨 Theme: Midnight OLED", hint: "Deep true-black contrast", run: () => preferences.applyThemePreset("midnight") },
        { cat: "Theme", label: "🎨 Theme: Cyberpunk Neon", hint: "Magenta & cyan neon accents", run: () => preferences.applyThemePreset("cyberpunk") },
        { cat: "Theme", label: "🎨 Theme: Emerald Matrix", hint: "Deep forest green palette", run: () => preferences.applyThemePreset("emerald") },
        { cat: "Theme", label: "🎨 Theme: Aurora Borealis", hint: "Teal & northern lights purple", run: () => preferences.applyThemePreset("aurora") },
        { cat: "Theme", label: "☀️ Theme: Daylight Slate", hint: "Crisp light mode theme", run: () => preferences.applyThemePreset("daylight") }
    ];
    let cmdVisible = [];
    let cmdIndex = 0;
    function renderCommandPalette() {
        const q = cmdInput.value.trim().toLowerCase();
        cmdVisible = commandCatalog.filter((c) => (!c.hidden || !c.hidden()) && (!q || c.label.toLowerCase().includes(q) || c.hint.toLowerCase().includes(q) || (c.cat || "").toLowerCase().includes(q)));
        cmdIndex = Math.min(cmdIndex, Math.max(0, cmdVisible.length - 1));
        const countEl = byId("cmdkCount");
        if (countEl) countEl.textContent = `${cmdVisible.length} command${cmdVisible.length === 1 ? "" : "s"}`;
        cmdResults.replaceChildren();
        if (!cmdVisible.length) {
            cmdResults.append(element("div", "cmdk-empty", `No commands match "${cmdInput.value.trim()}".`));
            return;
        }
        cmdVisible.forEach((item, idx) => {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "cmdk-item" + (idx === cmdIndex ? " is-active" : "");
            const left = element("span", "", item.label);
            const right = element("span", "metric-meta-right");
            right.append(element("small", "", item.hint));
            if (item.cat) right.append(element("span", "cmdk-cat", item.cat));
            btn.append(left, right);
            btn.addEventListener("click", () => { cmdModal.close(); item.run(); });
            cmdResults.append(btn);
        });
        cmdResults.children[cmdIndex]?.scrollIntoView({ block: "nearest" });
    }
    function openCommandPalette() {
        if (cmdModal.open) {
            cmdModal.close();
            return;
        }
        if (byId("diskPartitionerModal")?.matches(":popover-open")) return;
        window.dispatchEvent(new CustomEvent("cw-close-overlays", { detail: { source: "cmdk" } }));
        closeDropdowns();
        cmdInput.value = "";
        cmdIndex = 0;
        renderCommandPalette();
        cmdModal.showModal();
        cmdInput.focus();
    }
    cmdModal?.addEventListener("click", (ev) => {
        if (ev.target === cmdModal) cmdModal.close();
    });
    byId("cmd-palette-toggle")?.addEventListener("click", openCommandPalette);
    byId("cmdkCloseBtn")?.addEventListener("click", () => cmdModal.close());
    cmdInput?.addEventListener("input", () => { cmdIndex = 0; renderCommandPalette(); });
    cmdInput?.addEventListener("keydown", (ev) => {
        if (ev.key === "ArrowDown") { ev.preventDefault(); cmdIndex = (cmdIndex + 1) % Math.max(1, cmdVisible.length); renderCommandPalette(); }
        else if (ev.key === "ArrowUp") { ev.preventDefault(); cmdIndex = (cmdIndex - 1 + Math.max(1, cmdVisible.length)) % Math.max(1, cmdVisible.length); renderCommandPalette(); }
        else if (ev.key === "Enter" && cmdVisible[cmdIndex]) { ev.preventDefault(); const chosen = cmdVisible[cmdIndex]; cmdModal.close(); chosen.run(); }
    });
    document.addEventListener("keydown", (ev) => {
        if (ev.ctrlKey && ev.key.toLowerCase() === "k" && !byId("diskPartitionerModal")?.matches(":popover-open")) {
            const otherDialog = document.querySelector("dialog[open]");
            if (otherDialog && otherDialog !== cmdModal) return;
            ev.preventDefault();
            openCommandPalette();
        }
    });
    modulesHub.init();
    byId("lblTopProcess").addEventListener("click", async () => {
        const process = latestTopProcess;
        if (!process) return;
        const options = [];
        if (!hiddenModules.includes("tasksports")) options.push({ id: "inspect", name: "Inspect in Tasks & Ports", active: true });
        if (process.token) options.push({ id: "end", name: "End process" });
        const title = process.name;
        const detail = processDetails(process);
        const action = await askDashboard(title, detail, options.length ? { options } : null, 0, options.length ? "Continue" : "Close");
        if (action === "inspect") {
            await selectView("tasks");
            tasks.inspect(process.pid);
        } else if (action === "end" && await confirmDashboardAction(`End ${process.name}?`, `Windows will terminate PID ${process.pid}. Unsaved work in this process may be lost.`, "End process")) {
            const result = await dashboardCommand("tasks_action", { action: { kind: "terminate", pid: process.pid, token: process.token } }, `Ended ${process.name} (PID ${process.pid}).`);
            if (result !== undefined) await dashboardCommand("refresh");
        }
    });
    byId("lblNetAssignment").addEventListener("click", () => selectView("network", "adapters"));
    let extIpBusy = false;
    let lastExtIpUplink = "";
    let lastExtIpAt = 0;
    async function refreshExternalIpv4(silent = false) {
        if (extIpBusy) return;
        const button = byId("lblExtIPv4");
        const refreshBtn = byId("btnRefreshExtIpv4");
        extIpBusy = true;
        if (button) button.disabled = true;
        if (refreshBtn) refreshBtn.disabled = true;
        if (!silent || button.textContent === unavailable) show("lblExtIPv4", "Resolving…");
        try {
            const value = await invoke("external_ipv4");
            show("lblExtIPv4", value || null);
            lastExtIpAt = Date.now();
            if (!value && !silent) log("No public IPv4 was returned.");
        } catch (error) {
            show("lblExtIPv4", null);
            lastExtIpAt = Date.now() - 240000; // Back off 60s on offline/resolver failures
            if (!silent) log("Ext IPv4: " + String(error));
        } finally {
            extIpBusy = false;
            if (button) button.disabled = false;
            if (refreshBtn) refreshBtn.disabled = false;
        }
    }
    byId("btnRefreshExtIpv4")?.addEventListener("click", () => void refreshExternalIpv4(false));
    for (const id of ["lblIntIPv4", "lblGateway", "lblExtIPv4", "lblHostName", "lblWorkgroup"]) {
        byId(id)?.addEventListener("click", async () => {
            const el = byId(id);
            const value = el.textContent;
            if (id === "lblExtIPv4" && (value === unavailable || value === "Resolving…")) {
                await refreshExternalIpv4(false);
                return;
            }
            if (!value || value === unavailable) return;
            try {
                await navigator.clipboard.writeText(value);
                el.classList.add("copied-flash");
                setTimeout(() => el.classList.remove("copied-flash"), 900);
                log(value + " copied.");
                showToast(`Copied: ${value}`, "ok", 1800);
            } catch {
                log("Clipboard access is unavailable.");
                showToast("Clipboard unavailable", "warn");
            }
        });
    }
    byId("lblMonRefresh").addEventListener("click", () => changeDisplay("refresh"));
    byId("lblMonScale").addEventListener("click", () => changeDisplay("scale"));
    byId("lblMonOrientation").addEventListener("click", () => changeDisplay("orientation"));
    byId("lblMonHdr").addEventListener("click", async () => {
        const display = selectedDisplay();
        if (!display || !["On", "Off"].includes(display.advanced_color)) return;
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
        if (sensorDialog.open) return;
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
                : !status.helper_available ? "Optional Hardware CPU Sensor Helper is not installed. Re-run RustCoreWatch Setup and select Hardware CPU Sensor Helper to enable CPU die temperatures."
                : status.pawn_io !== "Running" ? "Check the PawnIO installation and driver status."
                : !status.elevated ? "Try restarting RustCoreWatch as administrator to read the CPU die sensor."
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
    const maxBtn = byId("maximize");
    const syncMaxGlyph = async () => {
        if (!maxBtn || !nativeWindow.isMaximized) return;
        try {
            const maximized = await nativeWindow.isMaximized();
            maxBtn.textContent = maximized ? "❐" : "□";
            maxBtn.title = maximized ? "Restore window" : "Maximize window";
        } catch { /* ignore */ }
    };
    byId("minimize").title = "Minimize window";
    void syncMaxGlyph();
    window.addEventListener("resize", () => void syncMaxGlyph());
    for (const [id, action] of [["minimize", "minimize"], ["maximize", "toggleMaximize"], ["exit", "close"]]) {
        byId(id).addEventListener("click", async () => {
            if (id === "exit") await preferences.flush();
            try {
                await nativeWindow[action]();
                if (id === "maximize") setTimeout(() => void syncMaxGlyph(), 60);
            } catch (error) { log(String(error)); }
        });
    }
    const setStatus = (message) => show("status", message);
    byId("selMonitorPicker").addEventListener("change", renderSelectedDisplay);
    for (const btn of document.querySelectorAll("[data-log-filter]")) {
        btn.addEventListener("click", () => {
            const mode = btn.dataset.logFilter;
            byId("console-box").classList.toggle("filter-errors", mode === "errors");
            for (const other of document.querySelectorAll("[data-log-filter]")) {
                other.classList.toggle("active", other === btn);
            }
        });
    }
    byId("clear-logs").addEventListener("click", () => {
        byId("console-box").replaceChildren();
        showToast("Console cleared", "info", 1500);
    });
    byId("copy-logs").addEventListener("click", async () => {
        const text = byId("console-box").innerText;
        try {
            await navigator.clipboard.writeText(text);
            log("Logs copied.");
            showToast("System logs copied", "ok", 1800);
        } catch {
            log("Clipboard access is unavailable.");
            showToast("Clipboard unavailable", "warn");
        }
    });
    byId("refresh").addEventListener("click", async () => {
        try {
            await invoke("refresh");
            log("Refresh requested.");
            showToast("Telemetry refreshed", "info", 1500);
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
            const tintSpeed = (id, v, warn, crit) => {
                const el = byId(id);
                if (!el) return;
                el.classList.toggle("speed-crit", v != null && v >= crit);
                el.classList.toggle("speed-warn", v != null && v >= warn && v < crit);
            };
            tintSpeed("net-latency", result.latency_ms, 50, 100);
            tintSpeed("net-jitter", result.jitter_ms, 15, 30);
            tintSpeed("net-failures", result.packet_loss, 0.1, 10);
            for (const error of result.errors) log(error);
            log("Network check finished.");
            showToast(`Mesh test: ${result.latency_ms != null ? result.latency_ms.toFixed(0) + "ms · " : ""}${result.download_mbps != null ? result.download_mbps.toFixed(1) + " Mbps" : "done"}`, "ok");
        } catch (error) {
            log(String(error));
            showToast("Network mesh test failed", "crit");
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
            modulesHub.updateAlertBell(sample.unreadAlerts || 0);
            if (sample.live) renderLive(sample.live);
            if (sample.details) {
                renderDetails(sample.details, sample.smokeTest);
                revision = sample.revision;
                if (!sample.smokeTest && sample.details.dns_uplink) {
                    const uplinkKey = `${sample.details.fields.ipv4 || ""}|${sample.details.fields.gateway || ""}`;
                    if (uplinkKey !== lastExtIpUplink || Date.now() - lastExtIpAt > 300000) {
                        lastExtIpUplink = uplinkKey;
                        void refreshExternalIpv4(true);
                    }
                }
                for (const note of sample.details.notes) {
                    if (!notes.has(note)) log(note);
                }
                notes = new Set(sample.details.notes);
            }
            if (!connected && sample.live) {
                connected = true;
                setStatus("Live telemetry");
                log("RustCoreWatch native telemetry engine connected.");
            } else if (connected) {
                const desired = sample.telemetryPaused ? "Paused (Partitioner)" : "Live telemetry";
                const showingTransientError = byId("status").textContent === "Action failed. See log." && Date.now() < statusErrorUntil;
                if (byId("status").textContent !== desired && !showingTransientError) {
                    setStatus(desired);
                }
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
                    for (const [field, id, label] of [["discovery", "lblDiscovery", "Network Discovery"],
                        ["sharing", "lblSharing", "File and Printer Sharing"]]) {
                        const button = byId(id);
                        const state = full.fields[field];
                        const pressed = { On: "true", Off: "false", Mixed: "mixed" }[state] ?? null;
                        if (button.textContent !== (state?.toUpperCase() ?? unavailable)
                            || button.disabled !== !state || button.getAttribute("aria-pressed") !== pressed) {
                            throw new Error(`${label} did not render its Windows firewall group state.`);
                        }
                        if (!state) continue;
                        const confirmation = byId("dashboard-dialog");
                        button.click();
                        const expected = full.fields.elevation === "Administrator" ? "all profiles, including Public" : "administrator access";
                        if (!confirmation.open || !byId("dialog-message").textContent.includes(expected)
                            || !byId("dialog-message").textContent.includes(label)) {
                            throw new Error(`${label} did not open its confirmation dialog.`);
                        }
                        confirmation.close("cancel");
                    }
                    if (full.fields.elevation === "Standard user") {
                        let rejection;
                        try {
                            await invoke("set_discovery_sharing", { group: "discovery", enabled: false });
                        } catch (error) {
                            rejection = String(error);
                        }
                        if (!rejection?.includes("Restart CoreWatch as administrator")) {
                            throw new Error("Windows Firewall controls did not report the administrator requirement.");
                        }
                    }
                    const current = full.fields;
                    if (current.nightLight && current.nightKelvin) {
                        const nightActive = current.nightLight === "On";
                        const expectedWarmth = `${nightActive ? `${current.nightWarmth}%` : "Off"} (${current.nightKelvin}K)`;
                        if (byId("night-warmth-value").textContent !== expectedWarmth || byId("night-warmth").disabled === nightActive) {
                            throw new Error("Night Light strength did not match its live Windows state.");
                        }
                    }
                    if (!document.querySelector(".rust-version").getClientRects().length
                        || byId("lblPendingReboot").textContent !== current.pendingReboot
                        || byId("lblPendingReboot").disabled !== (current.pendingReboot !== "Yes")
                        || byId("lblPsVersion").textContent !== (current.powershell ?? "Check")
                        || byId("night-light-settings").textContent !== (current.nightLight?.toUpperCase() ?? unavailable)) {
                        throw new Error("System and display controls did not render their live readouts.");
                    }
                    const confirm = byId("dashboard-dialog");
                    if (current.telemetry) {
                        byId("lblTelemetry").click();
                        await new Promise((resolve) => setTimeout(resolve, 0));
                        if (!confirm.open || !byId("dialog-title").textContent.includes(current.elevation === "Administrator" ? "telemetry" : "administrator")) {
                            throw new Error("The telemetry control did not offer its in-app action.");
                        }
                        confirm.close("cancel");
                    }
                    byId("lblJavaVersion").click();
                    for (let i = 0; !confirm.open && i < 100; i++) {
                        await new Promise((resolve) => setTimeout(resolve, 25));
                    }
                    if (!confirm.open || !byId("dialog-select").querySelector('option[value="install-25"]')) {
                        throw new Error("The Java picker did not load the App Installer catalog options.");
                    }
                    confirm.close("cancel");
                    const sensorStatus = await invoke("cpu_sensor_status");
                    if (typeof sensorStatus.helper_available !== "boolean" || typeof sensorStatus.pawn_io !== "string") {
                        throw new Error("CPU sensor diagnostic did not report helper and driver state.");
                    }
                    const display = selectedDisplay();
                    if (display) {
                        const modes = await invoke("display_modes", { id: display.id });
                        if (modes.current_orientation > 3) throw new Error("Invalid display mode");
                        const scale = await invoke("display_scale_options", { id: display.id }).catch(() => null);
                        if (scale && !scale.available.includes(scale.current)) throw new Error("Invalid display scale options");
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
                    await selectView("tasks");
                    if (!byId("viewTasksPortsPanel").getClientRects().length || !byId("tasks-rows").querySelector("tr")) throw new Error("Tasks & Ports did not render local processes.");
                    document.querySelector('[data-task-pane="service"]').click();
                    if (!byId("tasks-rows").querySelector("tr select")) throw new Error("Tasks & Ports did not render Windows services.");
                    document.querySelector('[data-task-pane="socket"]').click();
                    if (!byId("tasks-rows").querySelector("tr") || !byId("tasks-status").textContent.includes("sockets")) throw new Error("Tasks & Ports did not render sockets.");
                    await selectView("dashboard");
                    if (latestTopProcess) {
                        byId("lblTopProcess").click();
                        if (!byId("dashboard-dialog").open || !byId("dialog-message").textContent.includes("Top RAM")) {
                            throw new Error("The Top Process action did not open its sampled details.");
                        }
                        byId("dashboard-dialog").close("cancel");
                    }
                    const testCatalog = await invoke("settings_action", { action: { kind: "catalog" } });
                    await selectView("diskmap", testCatalog.smokeDiskRoot);
                    const dmCanvas = byId("disk-map-canvas");
                    if (!byId("viewDiskMapPanel").getClientRects().length || !dmCanvas || dmCanvas.width === 0
                        || Number(byId("disk-map-treemap").dataset.tileCount || 0) === 0
                        || !byId("disk-map-rows").querySelector("tr") || !byId("disk-map-status").textContent.includes("items shown")) {
                        throw new Error("Disk Map did not render the scan totals, rows, and Canvas treemap.");
                    }
                    document.querySelector('[data-disk-mode="extensions"]').click();
                    if (!byId("disk-map-rows").textContent.includes(".js") || !byId("disk-map-treemap").hidden) {
                        throw new Error("Disk Map did not switch to the extension breakdown.");
                    }
                    await selectView("diagx", latestCrash?.key);
                    if (!byId("viewUltimaDiagXPanel").getClientRects().length || byId("diag-channels").childElementCount !== 10
                        || !byId("diag-status").textContent.includes("events")) {
                        throw new Error("UltimaDiagX did not render its live channel report.");
                    }
                    const code = await invoke("diagnostics_code", { input: "0x80070005" });
                    if (code.family !== "Win32 HRESULT" || !code.message) throw new Error("Windows code translation failed.");
                    if (latestCrash) {
                        const record = await invoke("diagnostics_event", { key: latestCrash.key });
                        if (record?.key.record !== latestCrash.key.record || byId("diag-detail").hidden
                            || !byId("diag-detail-facts").textContent.includes(`Record ${record.key.record}`)) {
                            throw new Error("UltimaDiagX did not resolve the dashboard's exact crash record.");
                        }
                        const marked = await invoke("diagnostics_mark", { key: record.key, solved: true });
                        if (!marked.some((key) => key.record === record.key.record && key.channel === record.key.channel)) throw new Error("Solving the event did not persist.");
                        const restored = await invoke("diagnostics_mark", { key: record.key, solved: false });
                        if (restored.length) throw new Error("Restoring the event did not clear the saved mark.");
                    }
                    await selectView("dashboard");
                    // Verify Disk Partitioner pauses and resumes live telemetry cleanly
                    await diskPartitioner.open();
                    const pausedSnap = await invoke("snapshot", { after: revision });
                    if (!pausedSnap.telemetryPaused || !byId("diskPartitionerModal").matches(":popover-open")) {
                        throw new Error("Disk Partitioner did not pause live telemetry while open.");
                    }
                    await diskPartitioner.close();
                    const resumedSnap = await invoke("snapshot", { after: revision });
                    if (resumedSnap.telemetryPaused) {
                        throw new Error("Disk Partitioner did not resume live telemetry when closed.");
                    }
                    // Verify header dropdown toggle & Escape close + window lock round-trip
                    byId("tabSystemMenu").click();
                    if (!byId("navSystemMenu").classList.contains("open") || !byId("tabSystemMenu").closest(".nav-dropdown").classList.contains("open")) {
                        throw new Error("Header dropdown menu did not open properly.");
                    }
                    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
                    if (byId("navSystemMenu").classList.contains("open")) {
                        throw new Error("Header dropdown menu did not close on Escape.");
                    }
                    await invoke("set_window_lock_mode", { mode: "position" });
                    await invoke("set_window_lock_mode", { mode: "all" });
                    await invoke("set_window_lock_mode", { mode: "none" });
                    // Verify newly translated native Rust module views (all remaining modules including RGB Studio)
                    const viewPanels = new Map(views.map(([v, , p]) => [v, p]));
                    for (const viewName of ["profiles", "startup", "alerts", "snapshots", "backupsync", "battery", "security", "docker", "wsl", "sshcerts", "homelab", "apps", "appstore", "devices", "organizer", "github", "jira", "sharing", "rgbstudio"]) {
                        await selectView(viewName);
                        const panelEl = byId(viewPanels.get(viewName));
                        if (!panelEl || !panelEl.getClientRects().length) {
                            throw new Error(`Module view '${viewName}' panel did not become visible.`);
                        }
                    }
                    if (!byId("rgb-presets-list").querySelector(".rgb-preset-chip") || !byId("rgb-effects-grid").querySelector(".rgb-effect-btn")) {
                        throw new Error("RGB Studio did not render its effects and lighting presets.");
                    }
                    await selectView("dashboard");
                    if (smokeErrors.length) {
                        throw new Error("Runtime JS/console errors detected: " + smokeErrors.join(" | "));
                    }
                    await invoke("finish_dashboard_smoke", { error: null });
                } catch (error) {
                    await invoke("finish_dashboard_smoke", { error: String(error) });
                }
            }
        } catch (error) {
            if (connected || byId("status").textContent !== "Telemetry connection error") log(String(error));
            connected = false;
            setStatus("Telemetry connection error");
            invoke("finish_dashboard_smoke", { error: "poll() error: " + String(error) }).catch(() => {});
        }
        setTimeout(poll, pollInterval);
    }
    await poll();
}

document.addEventListener("DOMContentLoaded", () => {
    start().catch((err) => {
        const msg = `start() failed: ${String(err)}`;
        smokeErrors.push(msg);
        window.__TAURI__?.core?.invoke("finish_dashboard_smoke", { error: msg }).catch(() => {});
    });
});
