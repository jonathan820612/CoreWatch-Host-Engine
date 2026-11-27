"use strict";

function createDashboardControls() {
    const toggles = [
        ["telemetry", "lblTelemetry", "Windows telemetry", "the DiagTrack and dmwappushservice services"],
        ["firewall", "lblFirewall", "Windows Firewall", "all firewall profiles, including Public"],
        ["realtime", "lblRealtime", "Real-time Protection"],
        ["behavior", "lblBehaviorMonitor", "Behavior Monitoring"],
        ["cloud", "lblCloudProtection", "Cloud-delivered Protection"],
        ["ioav", "lblIoavProtection", "Download and Attachment Scanning"],
        ["nightLight", "night-light-settings", "Night Light"]
    ];
    let fields = {};
    let uplink;
    let lastPowerShellCheck;
    const busy = new Set();
    const warmth = byId("night-warmth");
    const warmthRow = byId("night-warmth-row");
    let editingWarmth = false;
    const controls = new Map(toggles.map(([key, id]) => [key, byId(id)]));
    const canAdmin = () => fields.elevation === "Administrator";
    const isDefender = (key) => ["realtime", "behavior", "cloud", "ioav"].includes(key);

    function state(key) {
        if (key !== "firewall") return fields[key];
        const states = fields.firewall?.split(" · ").map((profile) => profile.endsWith(" on"));
        return !states ? null : states.every(Boolean) ? "On" : states.some(Boolean) ? "Mixed" : "Off";
    }

    function drawToggle(key, id, label) {
        const value = state(key);
        const button = controls.get(key);
        const writing = busy.has(key);
        const locked = Boolean(value && isDefender(key) && fields.tamper !== "Off");
        const title = !value ? `${label} status is unavailable.` :
            locked ? "Locked by Windows Tamper Protection — click to open Windows Security." :
            value === "On" || value === "Mixed" ? `Turn off ${label}` : `Turn on ${label}`;
        const caption = writing ? "…" : value ? (locked ? "🔒 " : "") + value.toUpperCase() : null;
        const theme = writing ? "diag-neutral"
            : value === "Mixed" ? "diag-warn"
            : key === "nightLight" && value === "On" ? "diag-warn"
            : undefined;
        badge(id, caption, value === "On",
            key === "firewall" && fields.firewall ? `${title} · ${fields.firewall}` : title,
            theme);
        button.classList.toggle("state-locked", locked && !writing);
        button.disabled = !value || writing;
        if (value) button.setAttribute("aria-pressed", value === "Mixed" ? "mixed" : String(value === "On"));
        else button.removeAttribute("aria-pressed");
    }

    async function run(key, action) {
        if (busy.has(key)) return;
        busy.add(key);
        render();
        try { await action(); }
        catch (err) { log(`Control ${key}: ${err}`); }
        finally { busy.delete(key); render(); }
    }

    async function ensureAdmin() {
        if (canAdmin()) return true;
        if (await askDashboard("Restart as administrator", "Windows will ask for permission to reopen CoreWatch.")) {
            await dashboardCommand("elevate");
        }
        return false;
    }

    async function apply(change, success) {
        const message = await dashboardCommand("apply_dashboard_change", { change });
        if (message !== undefined && (message || success)) log(message || success);
    }

    for (const [key, id, label, scope] of toggles) {
        byId(id).addEventListener("click", () => run(key, async () => {
            const current = state(key);
            if (!current) return;
            if (isDefender(key) && fields.tamper !== "Off") {
                if (await askDashboard(label, "Windows Tamper Protection locks this setting against external changes. Open Windows Security to manage it directly?", null, 0, "Open Windows Security")) {
                    await dashboardCommand("security_repair_action", { action: { kind: "open_defender" } }, "Opened Windows Security.");
                }
                return;
            }
            const enabled = current === "Off";
            if (key === "nightLight") {
                await apply({ kind: "night_light", enabled }, `Night Light turned ${enabled ? "on" : "off"}.`);
                return;
            }
            if (!await ensureAdmin()) return;
            const verb = enabled ? "Enable" : "Disable";
            if (await confirmDashboardAction(`${verb} ${label}`, `${verb} ${scope ? `${label} for ${scope}` : label}?`)) {
                await apply({ kind: "system_toggle", setting: key, enabled }, `${label} turned ${enabled ? "on" : "off"}.`);
            }
        }));
    }

    byId("lblTamperProtection").addEventListener("click", async () => {
        const stateText = fields.tamper?.toLowerCase() ?? "unknown";
        if (await askDashboard("Tamper Protection", `Tamper Protection is ${stateText}. Windows enforces this policy inside Windows Security. Open Virus & Threat Protection settings?`, null, 0, "Open Windows Security")) {
            await dashboardCommand("security_repair_action", { action: { kind: "open_defender" } }, "Opened Windows Security.");
        }
    });

    byId("lblPendingReboot").addEventListener("click", () => run("restart", async () => {
        if (fields.pendingReboot !== "Yes") return;
        const reasons = fields.pendingRebootDetail ? `Windows flags a restart for ${fields.pendingRebootDetail}. ` : "";
        if (await confirmDashboardAction("Restart Windows?", reasons + "Save any open work before restarting.", "Restart")) {
            await apply({ kind: "restart" });
        }
    }));

    byId("lblNetworkStatus").addEventListener("click", () => run("profile", async () => {
        const [category, name] = fields.networkStatus?.split(" · ") ?? [];
        if (!uplink || !["Private", "Public"].includes(category) || !await ensureAdmin()) return;
        const privateNetwork = category === "Public";
        const next = privateNetwork ? "Private" : "Public";
        const index = uplink.index;
        if (await askDashboard(`Switch to ${next}`, `Set ${name} on ${uplink.name} to ${next}?`)) {
            await apply({ kind: "network_profile", index, private: privateNetwork }, `Network profile changed to ${next}.`);
        }
    }));

    let pendingWarmth = null;
    async function flushWarmth() {
        if (busy.has("warmth")) return;
        busy.add("warmth");
        try {
            while (pendingWarmth !== null) {
                const percent = pendingWarmth;
                pendingWarmth = null;
                await apply({ kind: "night_warmth", percent }, `Night Light strength set to ${percent}%.`);
            }
        } catch (err) {
            log("Night Light: " + String(err));
        } finally {
            busy.delete("warmth");
            editingWarmth = false;
            render();
        }
    }
    warmth.addEventListener("input", () => {
        editingWarmth = true;
        renderWarmth();
    });
    warmth.addEventListener("change", () => {
        pendingWarmth = Number(warmth.value);
        void flushWarmth();
    });
    warmth.addEventListener("blur", () => {
        if (pendingWarmth === null && !busy.has("warmth")) {
            editingWarmth = false;
            render();
        }
    });

    function renderWarmth() {
        const writing = busy.has("warmth");
        const adjusting = editingWarmth || writing;
        const on = fields.nightLight === "On" || writing;
        const percent = adjusting ? warmth.value : fields.nightWarmth;
        const kelvin = adjusting ? 6500 - 53 * Number(warmth.value) : fields.nightKelvin;
        warmth.disabled = !on || percent == null;
        warmthRow.classList.toggle("is-disabled", !on || percent == null);
        warmthRow.title = on ? "Adjust Night Light from 6500 K (cool) to 1200 K (warm)." :
            fields.nightLight === "Off" ? "Turn on Night Light to adjust the blue-light reduction." : "Windows Night Light status is unavailable.";
        if (!adjusting && percent != null) warmth.value = percent;
        const caption = kelvin == null || !fields.nightLight ? null : `${on ? `${percent}%` : "Off"} (${kelvin}K)`;
        show("night-warmth-value", caption);
    }

    byId("lblJavaVersion").addEventListener("click", () => run("java", async () => {
        const runtimes = await dashboardCommand("java_runtimes");
        if (!runtimes) return;
        const options = runtimes.map((runtime, index) => ({ id: `runtime-${index}`, name: runtime.label, active: runtime.active }));
        for (const major of [21, 25, 27]) options.push({ id: `install-${major}`, name: `Install Eclipse Temurin JDK ${major}` });
        const selected = await askDashboard("Java runtime", "Choose an installed runtime or install a JDK from the CoreWatch App Installer catalog.", { options });
        if (!selected) return;
        const [action, choice] = selected.split("-");
        if (action === "install") {
            if (await askDashboard(`Install Eclipse Temurin JDK ${choice}?`, "WinGet will download and run the Eclipse Adoptium installer.", null, 0, "Install")) {
                await apply({ kind: "install_java", major: Number(choice) }, "Java installed. Open the Java picker again to choose the active version.");
            }
        } else {
            const runtime = runtimes[Number(choice)];
            if (runtime && !runtime.active && await ensureAdmin() && await askDashboard("Switch Java runtime", `${runtime.label}\n${runtime.home}\nThis updates JAVA_HOME and PATH for new terminals.`)) {
                await apply({ kind: "select_java", home: runtime.home }, `Java switched to ${runtime.label}.`);
            }
        }
    }));

    byId("lblPsVersion").addEventListener("click", () => run("powershell", async () => {
        const version = fields.powershell;
        const update = await dashboardCommand("powershell_update");
        if (!update) return;
        lastPowerShellCheck = { version, update };
        if (!update.available) {
            const newer = update.latest_stable && update.latest_stable !== update.version;
            const message = update.install.channel === "portable" ? "A portable PowerShell installation is present. Update that copy through its original installer." :
                !update.version ? `No matching stable ${update.installer} package is available.` :
                update.install.version ? `Installed ${update.install.version} · Latest matching ${update.installer} ${update.version}.`
                    + (newer ? ` PowerShell ${update.latest_stable} has no matching ${update.installer} package.` : "")
                    : "Windows did not report the installed PowerShell version.";
            await askDashboard("PowerShell 7", message, null, 0, "Close");
            return;
        }
        if (update.install.channel === "msi" && !await ensureAdmin()) return;
        const verb = update.install.channel === "none" ? "Install" : "Update to";
        if (await askDashboard(`${verb} PowerShell ${update.version}?`, `CoreWatch will download and verify the official ${update.installer} package.`, null, 0, "Install")) {
            await apply({ kind: "update_powershell", version: update.version });
        }
    }));

    function render() {
        for (const [key, id, label] of toggles) drawToggle(key, id, label);
        const tamper = fields.tamper;
        badge("lblTamperProtection", tamper?.toUpperCase(), tamper === "On", "View the Windows Tamper Protection policy");
        byId("lblTamperProtection").disabled = !tamper;
        const pending = fields.pendingReboot === "Yes";
        badge("lblPendingReboot", busy.has("restart") ? "…" : fields.pendingReboot, !pending,
            fields.pendingRebootDetail ?? "No pending Windows reboot flags reported");
        byId("lblPendingReboot").disabled = !pending || busy.has("restart");
        const isProfile = Boolean(fields.networkStatus?.includes(" · "));
        const category = fields.networkStatus?.split(" · ")[0];
        const profileTheme = category === "Private" || category === "Domain" ? "diag-ok"
            : category === "Public" ? "diag-warn"
            : fields.networkStatus?.includes("No IPv4") ? "diag-crit" : "diag-neutral";
        badge("lblNetworkStatus", busy.has("profile") ? "…" : isProfile ? category.toUpperCase() : fields.networkStatus,
            category === "Private" || category === "Domain", fields.networkStatus, profileTheme);
        byId("lblNetworkStatus").disabled = !uplink || !["Private", "Public"].includes(category) || busy.has("profile");
        renderWarmth();
        badge("lblJavaVersion", busy.has("java") ? "…" : (fields.java ?? "Choose") + " ▾", Boolean(fields.java), "Choose an installed Java version or install a JDK", fields.java ? undefined : "diag-neutral");
        byId("lblJavaVersion").disabled = busy.has("java");
        const ps = fields.powershell;
        const installed = Boolean(ps && /^\d/.test(ps));
        const checked = lastPowerShellCheck?.version === ps ? lastPowerShellCheck?.update : null;
        const available = checked?.available;
        const unmatched = checked?.latest_stable && checked.latest_stable !== checked.version;
        const checkingPowerShell = busy.has("powershell");
        const caption = checkingPowerShell ? "…" : (ps ?? "Check") + (available ? " ↑" : "");
        const title = available ? `PowerShell ${checked.version} (${checked.installer}) is available. Click to review.`
            : unmatched ? `Latest stable ${checked.latest_stable} has no matching ${checked.installer} package.`
            : checked?.version ? `Latest matching ${checked.installer}: ${checked.version}. Click to check again.` : "Check for PowerShell 7 updates";
        badge("lblPsVersion", caption, installed,
            title, checkingPowerShell || !installed ? "diag-neutral" : available || unmatched ? "diag-warn" : undefined);
        byId("lblPsVersion").disabled = busy.has("powershell");
    }

    return { update(details) { fields = details.fields; uplink = details.dns_uplink; render(); } };
}
