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
    const busy = new Set();
    const warmth = byId("night-warmth");
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
        const title = !value ? `${label} status is unavailable.` :
            isDefender(key) && fields.tamper !== "Off" ? "Windows controls changes through Tamper Protection or managed policy." :
            value === "On" || value === "Mixed" ? `Turn off ${label}` : `Turn on ${label}`;
        badge(id, writing ? "…" : value?.toUpperCase(), value === "On",
            key === "firewall" && fields.firewall ? `${title} · ${fields.firewall}` : title,
            writing ? "diag-neutral" : value === "Mixed" ? "diag-warn" : undefined);
        button.disabled = !value || writing;
        if (value) button.setAttribute("aria-pressed", value === "Mixed" ? "mixed" : String(value === "On"));
        else button.removeAttribute("aria-pressed");
    }

    async function run(key, action) {
        if (busy.has(key)) return;
        busy.add(key);
        render();
        try { await action(); }
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
                await askDashboard(label, "Windows Tamper Protection or managed policy controls changes to this setting.", null, 0, "Close");
                return;
            }
            const enabled = current === "Off";
            if (key === "nightLight") {
                await apply({ kind: "night_light", enabled }, `Night Light turned ${enabled ? "on" : "off"}.`);
                return;
            }
            if (!await ensureAdmin()) return;
            const verb = enabled ? "Enable" : "Disable";
            if (await askDashboard(`${verb} ${label}`, `${verb} ${scope ? `${label} for ${scope}` : label}?`)) {
                await apply({ kind: "system_toggle", setting: key, enabled }, `${label} turned ${enabled ? "on" : "off"}.`);
            }
        }));
    }

    byId("lblTamperProtection").addEventListener("click", () => {
        const state = fields.tamper?.toLowerCase();
        return askDashboard("Tamper Protection", `Tamper Protection is ${state}. Windows manages this policy.`, null, 0, "Close");
    });

    byId("lblPendingReboot").addEventListener("click", () => run("restart", async () => {
        if (fields.pendingReboot !== "Yes") return;
        const reasons = fields.pendingRebootDetail ? `Windows flags a restart for ${fields.pendingRebootDetail}. ` : "";
        if (await askDashboard("Restart Windows?", reasons + "Save any open work before restarting.", null, 0, "Restart")) {
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

    warmth.addEventListener("input", () => {
        editingWarmth = true;
        show("night-warmth-value", warmth.value + "%");
    });
    warmth.addEventListener("change", () => {
        const percent = Number(warmth.value);
        editingWarmth = false;
        void run("warmth", () => apply({ kind: "night_warmth", percent }, `Night Light strength set to ${percent}%.`));
    });
    warmth.addEventListener("blur", () => { editingWarmth = false; render(); });

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
        const update = await dashboardCommand("powershell_update");
        if (!update) return;
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
        badge("lblNetworkStatus", busy.has("profile") ? "…" : isProfile ? category.toUpperCase() : fields.networkStatus,
            false, fields.networkStatus, "diag-neutral");
        byId("lblNetworkStatus").disabled = !uplink || !["Private", "Public"].includes(category) || busy.has("profile");
        const percent = fields.nightWarmth;
        warmth.disabled = percent == null || busy.has("warmth") || fields.nightLight !== "On";
        if (!editingWarmth && !busy.has("warmth") && percent != null) warmth.value = percent;
        show("night-warmth-value", percent == null ? null : (editingWarmth || busy.has("warmth") ? warmth.value : percent) + "%");
        badge("lblJavaVersion", busy.has("java") ? "…" : (fields.java ?? "Choose") + " ▾", Boolean(fields.java), "Choose an installed Java version or install a JDK", fields.java ? undefined : "diag-neutral");
        byId("lblJavaVersion").disabled = busy.has("java");
        const ps = fields.powershell;
        badge("lblPsVersion", busy.has("powershell") ? "…" : ps ?? "Check", Boolean(ps && /^\d/.test(ps)), "Check for PowerShell 7 updates", !ps || !/^\d/.test(ps) ? "diag-neutral" : undefined);
        byId("lblPsVersion").disabled = busy.has("powershell");
    }

    return { update(details) { fields = details.fields; uplink = details.dns_uplink; render(); } };
}
