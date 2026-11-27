"use strict";

function createModulesHub(invoke, helpers) {
    const fmtTime = (ms) => ms ? new Date(ms).toLocaleString() : "—";
    const fmtKb = (kb) => !kb ? "—" : kb >= 1024 * 1024 ? (kb / (1024 * 1024)).toFixed(2) + " GB"
        : kb >= 1024 ? (kb / 1024).toFixed(1) + " MB" : kb + " KB";
    const fmtBytes = (b) => !b ? "0 B" : b >= 1024 ** 3 ? (b / 1024 ** 3).toFixed(2) + " GB"
        : b >= 1024 ** 2 ? (b / 1024 ** 2).toFixed(1) + " MB"
        : b >= 1024 ? (b / 1024).toFixed(0) + " KB" : b + " B";
    const pill = (text, tone = "neutral") => element("span", `diag-pill diag-${tone}`, text);
    const kpiChip = (label, val, tone = "") => {
        const chip = element("span", "mod-kpi-chip" + (tone ? ` tone-${tone}` : ""));
        chip.append(document.createTextNode(label + ": "), element("strong", "", String(val)));
        return chip;
    };
    const numOr = (value, fallback) => {
        if (value === "" || value == null) return fallback;
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : fallback;
    };
    const toast = (msg, tone = "info") => window.showToast?.(msg, tone);

    const busyKeys = new Set();
    async function withBusy(key, btn, fn) {
        if (busyKeys.has(key)) return false;
        busyKeys.add(key);
        if (btn) btn.disabled = true;
        try {
            return await fn();
        } finally {
            busyKeys.delete(key);
            if (btn && btn.isConnected) btn.disabled = false;
        }
    }

    function wireSortHeaders(tableId, state, onSort) {
        const table = byId(tableId);
        if (!table) return;
        const headers = [...table.querySelectorAll("th[data-sort]")];
        const updateClasses = () => {
            for (const th of headers) {
                th.classList.toggle("sort-asc", state.key === th.dataset.sort && state.dir === 1);
                th.classList.toggle("sort-desc", state.key === th.dataset.sort && state.dir === -1);
            }
        };
        for (const th of headers) {
            th.addEventListener("click", () => {
                const k = th.dataset.sort;
                if (state.key === k) state.dir *= -1;
                else { state.key = k; state.dir = 1; }
                updateClasses();
                onSort();
            });
        }
        updateClasses();
    }

    // =========================================================================
    // 1. SYSTEM PROFILES & MODES (+ Header Mode Pill Sync)
    // =========================================================================
    let profilesData = null;
    let profilesSeq = 0;

    function renderModePill() {
        if (!profilesData) return;
        const active = profilesData.profiles.find((p) => p.id === profilesData.activeId) || profilesData.profiles[0];
        const pillBtn = byId("btnHeaderModePill");
        if (pillBtn) {
            pillBtn.classList.toggle("is-awake", Boolean(profilesData.keepAwakeActive));
            pillBtn.title = active
                ? `Active Mode: ${active.name}${profilesData.keepAwakeActive ? " · ☕ Keep Awake ON" : ""}`
                : "System Profile & Mode";
        }
        if (active) {
            const shortName = active.name.length > 14 ? active.name.split(" ")[0] : active.name;
            show("lblHeaderModeText", `${active.icon} ${shortName}${profilesData.keepAwakeActive ? " ☕" : ""}`);
        }
        const menu = byId("navModePillMenu");
        if (!menu) return;
        menu.replaceChildren();
        for (const p of profilesData.profiles) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "nav-menu-item" + (p.id === profilesData.activeId ? " active" : "");
            btn.setAttribute("role", "menuitem");
            btn.append(
                element("span", "nav-mi-icon", p.icon),
                (() => {
                    const b = element("span", "nav-mi-body");
                    b.append(element("strong", "", p.name), element("small", "", p.description));
                    return b;
                })()
            );
            btn.addEventListener("click", () => {
                helpers.closeDropdowns();
                void runProfileAction({ kind: "activate", id: p.id }, btn);
            });
            menu.append(btn);
        }
        if (profilesData.hasBaseline) {
            const rev = document.createElement("button");
            rev.type = "button";
            rev.className = "nav-menu-item";
            rev.setAttribute("role", "menuitem");
            rev.append(element("span", "nav-mi-icon", "↩️"), element("span", "nav-mi-body", "Revert to Baseline"));
            rev.addEventListener("click", () => {
                helpers.closeDropdowns();
                void runProfileAction({ kind: "revert_baseline" }, rev);
            });
            menu.append(rev);
        }
        const mgr = document.createElement("button");
        mgr.type = "button";
        mgr.className = "nav-menu-item";
        mgr.setAttribute("role", "menuitem");
        mgr.style.borderTop = "1px solid var(--cw-border)";
        mgr.append(element("span", "nav-mi-icon", "⚙️"), element("span", "nav-mi-body", "Manage Profiles…"));
        mgr.addEventListener("click", () => {
            helpers.closeDropdowns();
            void window.cwApp?.selectView("profiles");
        });
        menu.append(mgr);
    }

    async function runProfileAction(action, btn = null) {
        return withBusy("profiles", btn, async () => {
            try {
                const [next, msg] = await invoke("profiles_action", { action });
                profilesSeq++;
                profilesData = next;
                renderModePill();
                renderProfilesPanel();
                show("profiles-status", msg);
                toast(msg, "ok");
                log("Profiles: " + msg);
                return true;
            } catch (err) {
                show("profiles-status", String(err));
                toast(String(err), "crit");
                log("Profiles: " + String(err));
                return false;
            }
        });
    }

    function renderProfilesPanel() {
        const grid = byId("profiles-grid");
        if (!grid || !profilesData) return;
        const revertBtn = byId("profiles-revert-btn");
        if (revertBtn) revertBtn.hidden = !profilesData.hasBaseline;
        const awakeBtn = byId("profiles-awake-btn");
        if (awakeBtn) {
            awakeBtn.textContent = profilesData.keepAwakeActive ? "☕ Keep Awake: ON" : "☕ Keep Awake: OFF";
            awakeBtn.classList.toggle("active", profilesData.keepAwakeActive);
            awakeBtn.setAttribute("aria-pressed", String(Boolean(profilesData.keepAwakeActive)));
        }
        grid.replaceChildren();
        for (const p of profilesData.profiles) {
            const isActive = p.id === profilesData.activeId;
            const card = element("div", "mod-card" + (isActive ? " is-active" : ""));
            const head = element("div", "mod-card-head");
            head.append(element("strong", "", `${p.icon} ${p.name}`), pill(isActive ? "ACTIVE" : p.builtin ? "PRESET" : "CUSTOM", isActive ? "ok" : "neutral"));
            const meta = [
                `Power: ${p.powerPlan}`,
                p.dnd != null ? `DnD: ${p.dnd ? "On" : "Off"}` : null,
                p.keepAwake ? "Keep Awake" : null,
                p.nightLight != null ? `Night Light: ${p.nightLight ? "On" : "Off"}` : null
            ].filter(Boolean).join(" · ");
            const actions = element("div", "panel-actions");
            const actBtn = actionButton(isActive ? "Re-apply" : "Activate", () => void runProfileAction({ kind: "activate", id: p.id }, actBtn));
            actBtn.className = "console-clear-btn btn-accent-action";
            actions.append(actBtn);
            if (!p.builtin) {
                const del = actionButton("Delete", async () => {
                    if (!(await confirmDashboardAction(`Delete profile '${p.name}'?`, "Remove this custom system profile?", "Delete"))) return;
                    await runProfileAction({ kind: "delete_custom", id: p.id }, del);
                });
                del.className = "console-clear-btn btn-danger";
                actions.append(del);
            }
            card.append(head, element("div", "mod-card-sub", p.description), element("div", "mod-card-sub", meta), actions);
            grid.append(card);
        }
    }

    async function loadProfiles() {
        const seq = ++profilesSeq;
        try {
            const next = await invoke("profiles_state");
            if (seq !== profilesSeq) return;
            profilesData = next;
            renderModePill();
            renderProfilesPanel();
        } catch (err) {
            if (seq === profilesSeq) show("profiles-status", String(err));
        }
    }

    byId("profiles-revert-btn")?.addEventListener("click", (ev) => void runProfileAction({ kind: "revert_baseline" }, ev.currentTarget));
    byId("profiles-awake-btn")?.addEventListener("click", (ev) => void runProfileAction({ kind: "toggle_keep_awake", enabled: !profilesData?.keepAwakeActive }, ev.currentTarget));
    byId("profiles-add-form")?.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const form = ev.currentTarget;
        const submitBtn = form.querySelector('button[type="submit"]');
        const ok = await runProfileAction({
            kind: "save_custom",
            profile: {
                id: "",
                name: form.name.value,
                icon: form.icon.value || "⚡",
                description: form.description.value || "Custom mode",
                builtin: false,
                powerPlan: form.powerPlan.value,
                dnd: form.dnd.value === "" ? null : form.dnd.value === "true",
                keepAwake: form.keepAwake.checked,
                nightLight: form.nightLight.value === "" ? null : form.nightLight.value === "true",
                nightWarmth: form.nightLight.value === "true" ? 55 : null
            }
        }, submitBtn);
        if (ok) form.reset();
    });

    // =========================================================================
    // 2. STARTUP APPS MANAGER
    // =========================================================================
    let startupEntries = [];
    let startupFilter = "all";
    const startupSort = { key: "name", dir: 1 };

    function renderStartup() {
        const tbody = byId("startup-rows");
        if (!tbody) return;
        const enabledCnt = startupEntries.filter((e) => e.enabled).length;
        const brokenCnt = startupEntries.filter((e) => e.fileExists === false).length;
        const kpi = byId("startup-kpi");
        if (kpi) {
            kpi.replaceChildren(
                kpiChip("Total", startupEntries.length),
                kpiChip("Enabled", enabledCnt, "ok"),
                kpiChip("Disabled", startupEntries.length - enabledCnt),
                kpiChip("Missing Target", brokenCnt, brokenCnt ? "crit" : "ok")
            );
        }
        const q = (byId("startup-search")?.value || "").trim().toLowerCase();
        const filtered = startupEntries.filter((e) => {
            if (startupFilter === "enabled" && !e.enabled) return false;
            if (startupFilter === "disabled" && e.enabled) return false;
            if (startupFilter === "broken" && e.fileExists !== false) return false;
            return !q || e.name.toLowerCase().includes(q) || e.command.toLowerCase().includes(q) || e.scope.toLowerCase().includes(q);
        });
        filtered.sort((a, b) => {
            const d = startupSort.dir;
            if (startupSort.key === "enabled") return (Number(b.enabled) - Number(a.enabled)) * d;
            if (startupSort.key === "scope") return a.scope.localeCompare(b.scope) * d;
            if (startupSort.key === "command") return a.command.localeCompare(b.command) * d;
            return a.name.localeCompare(b.name) * d;
        });
        tbody.replaceChildren();
        show("startup-status", `${filtered.length} of ${startupEntries.length} startup entries shown.`);
        for (const e of filtered) {
            const tr = document.createElement("tr");
            const acts = element("div", "panel-actions");
            const tog = actionButton(e.enabled ? "Disable" : "Enable", () => void withBusy("startup", tog, async () => {
                try {
                    const res = await invoke("startup_action", { action: { kind: "toggle", id: e.id, enabled: !e.enabled } });
                    startupEntries = res.entries;
                    renderStartup();
                    toast(`${e.name} ${e.enabled ? "disabled" : "enabled"}`, "ok");
                } catch (err) { show("startup-status", String(err)); }
            }));
            const open = actionButton("📂", () => {
                invoke("startup_action", { action: { kind: "open_location", id: e.id } }).catch((err) => show("startup-status", String(err)));
            });
            open.title = "Reveal executable in Explorer";
            open.setAttribute("aria-label", `Reveal ${e.name}`);
            const rem = actionButton("Remove", async () => {
                if (!(await confirmDashboardAction(`Remove ${e.name}?`, `Remove '${e.name}' from Windows startup?`, "Remove"))) return;
                await withBusy("startup", rem, async () => {
                    try {
                        const res = await invoke("startup_action", { action: { kind: "remove", id: e.id } });
                        startupEntries = res.entries;
                        renderStartup();
                    } catch (err) { show("startup-status", String(err)); }
                });
            });
            rem.className = "console-clear-btn btn-danger";
            acts.append(tog, open, rem);

            const nameTd = document.createElement("td");
            nameTd.append(document.createTextNode(e.name + " "));
            if (e.requiresAdmin) nameTd.append(pill("ADMIN", "warn"));
            if (e.fileExists === false) nameTd.append(document.createTextNode(" "), pill("⚠ MISSING", "crit"));

            tr.append(
                nameTd,
                (() => { const td = document.createElement("td"); td.append(pill(e.enabled ? "ENABLED" : "DISABLED", e.enabled ? "ok" : "neutral")); return td; })(),
                element("td", "", `${e.scope} · ${e.source}`),
                element("td", "mod-card-sub mod-mono", e.command),
                (() => { const td = document.createElement("td"); td.append(acts); return td; })()
            );
            tbody.append(tr);
        }
    }

    async function loadStartup() {
        await withBusy("startup", byId("startup-refresh-btn"), async () => {
            show("startup-status", "Scanning Windows startup registry & folders…");
            try {
                const res = await invoke("startup_list");
                startupEntries = res.entries;
                renderStartup();
            } catch (err) { show("startup-status", String(err)); }
        });
    }

    wireSortHeaders("startup-table", startupSort, renderStartup);
    for (const btn of document.querySelectorAll("[data-startup-filter]")) {
        btn.addEventListener("click", () => {
            startupFilter = btn.dataset.startupFilter;
            for (const b of document.querySelectorAll("[data-startup-filter]")) b.classList.toggle("active", b === btn);
            renderStartup();
        });
    }
    byId("startup-refresh-btn")?.addEventListener("click", () => void loadStartup());
    byId("startup-search")?.addEventListener("input", renderStartup);
    byId("startup-add-form")?.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const f = ev.currentTarget;
        const submitBtn = f.querySelector('button[type="submit"]');
        await withBusy("startup", submitBtn, async () => {
            try {
                const res = await invoke("startup_action", { action: { kind: "add", name: f.name.value, command: f.command.value } });
                startupEntries = res.entries;
                renderStartup();
                f.reset();
            } catch (err) { show("startup-status", String(err)); }
        });
    });

    // =========================================================================
    // 3. SMART ALERTS & WATCHDOG RULES
    // =========================================================================
    let alertsData = null;
    const metricLabels = {
        cpu_temp: "CPU Temp (°C ≥)",
        gpu_temp: "GPU Temp (°C ≥)",
        cpu_load: "CPU Load (% ≥)",
        ram_pct: "RAM Usage (% ≥)",
        drive_free_pct: "Drive Free (% ≤)",
        internet_down: "Network Route Lost"
    };

    function updateAlertBell(count) {
        const badgeEl = byId("lblHeaderAlertsCount");
        const bellBtn = byId("btnHeaderAlertsBell");
        if (bellBtn) {
            bellBtn.classList.toggle("has-alerts", count > 0);
            bellBtn.style.opacity = alertsData?.muted ? "0.55" : "";
        }
        if (!badgeEl) return;
        badgeEl.textContent = String(count);
        badgeEl.hidden = !count;
        badgeEl.style.display = count ? "inline-flex" : "none";
    }

    function renderAlerts() {
        if (!alertsData) return;
        updateAlertBell(alertsData.unreadCount);
        const muteBtn = byId("alerts-mute-btn");
        if (muteBtn) {
            muteBtn.textContent = alertsData.muted ? "🔊 Unmute Alerts" : "🔇 Mute All";
            muteBtn.classList.toggle("btn-danger", Boolean(alertsData.muted));
            muteBtn.setAttribute("aria-pressed", String(Boolean(alertsData.muted)));
        }
        const kpi = byId("alerts-kpi");
        if (kpi) {
            const armed = alertsData.rules.filter((r) => r.enabled).length;
            kpi.replaceChildren(
                kpiChip("Armed Rules", `${armed}/${alertsData.rules.length}`, armed ? "ok" : ""),
                kpiChip("Watchdog", alertsData.muted ? "MUTED" : "LIVE", alertsData.muted ? "warn" : "ok"),
                kpiChip("Logged Events", alertsData.history.length)
            );
        }
        const rulesBody = byId("alerts-rules-rows");
        const histBody = byId("alerts-history-rows");
        rulesBody.replaceChildren();
        for (const r of alertsData.rules) {
            const tr = document.createElement("tr");
            const acts = element("div", "panel-actions");
            const toggleBtn = actionButton(r.enabled ? "Pause" : "Enable", () => void runAlertAction({ kind: "toggle_rule", id: r.id, enabled: !r.enabled }, toggleBtn));
            const delBtn = actionButton("Delete", async () => {
                if (!(await confirmDashboardAction(`Delete rule '${r.name}'?`, "Remove this watchdog alert rule?", "Delete"))) return;
                await runAlertAction({ kind: "delete_rule", id: r.id }, delBtn);
            });
            delBtn.className = "console-clear-btn btn-danger";
            acts.append(toggleBtn, delBtn);
            tr.append(
                element("td", "", r.name),
                element("td", "", metricLabels[r.metric] || r.metric),
                element("td", "", `${r.threshold} (${r.durationSecs}s / cool ${r.cooldownSecs}s)`),
                (() => { const td = document.createElement("td"); td.append(pill(alertsData.muted ? "MUTED" : r.enabled ? "ARMED" : "PAUSED", alertsData.muted ? "warn" : r.enabled ? "ok" : "neutral")); return td; })(),
                (() => { const td = document.createElement("td"); td.append(acts); return td; })()
            );
            rulesBody.append(tr);
        }
        histBody.replaceChildren();
        if (!alertsData.history.length) {
            const tr = document.createElement("tr");
            const td = element("td", "mod-card-sub", "No alerts triggered yet.");
            td.colSpan = 4;
            tr.append(td);
            histBody.append(tr);
            return;
        }
        for (const ev of alertsData.history) {
            const tr = document.createElement("tr");
            tr.append(
                element("td", "", fmtTime(ev.timestampMs)),
                (() => { const td = document.createElement("td"); td.append(pill(ev.severity.toUpperCase(), ev.severity === "critical" ? "crit" : ev.severity === "warning" ? "warn" : "neutral")); return td; })(),
                element("td", "", ev.ruleName),
                element("td", "", ev.message)
            );
            histBody.append(tr);
        }
    }

    async function runAlertAction(action, btn = null) {
        return withBusy("alerts", btn, async () => {
            try {
                const [next, msg] = await invoke("alerts_action", { action });
                alertsData = next;
                renderAlerts();
                show("alerts-status", msg);
                return true;
            } catch (err) {
                show("alerts-status", String(err));
                return false;
            }
        });
    }

    async function loadAlerts() {
        await withBusy("alerts", null, async () => {
            try {
                alertsData = await invoke("alerts_state");
                if (alertsData.unreadCount > 0) {
                    const [next] = await invoke("alerts_action", { action: { kind: "mark_read" } });
                    alertsData = next;
                }
                renderAlerts();
            } catch (err) { show("alerts-status", String(err)); }
        });
    }

    byId("alerts-mute-btn")?.addEventListener("click", (ev) => void runAlertAction({ kind: "set_muted", muted: !alertsData?.muted }, ev.currentTarget));
    byId("alerts-test-btn")?.addEventListener("click", (ev) => void runAlertAction({ kind: "test_toast" }, ev.currentTarget));
    byId("alerts-reset-btn")?.addEventListener("click", async (ev) => {
        const btn = ev.currentTarget;
        if (!(await confirmDashboardAction("Reset Alert Rules?", "Restore all Smart Alerts rules back to factory defaults?", "Reset"))) return;
        await runAlertAction({ kind: "reset_defaults" }, btn);
    });
    byId("alerts-clear-btn")?.addEventListener("click", async (ev) => {
        const btn = ev.currentTarget;
        if (!(await confirmDashboardAction("Clear Alert History?", "Remove all logged alert events?", "Clear"))) return;
        await runAlertAction({ kind: "clear_history" }, btn);
    });
    byId("alerts-add-form")?.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const f = ev.currentTarget;
        const submitBtn = f.querySelector('button[type="submit"]');
        const ok = await runAlertAction({
            kind: "save_rule",
            rule: {
                id: "",
                name: f.name.value,
                metric: f.metric.value,
                threshold: numOr(f.threshold.value, 85),
                durationSecs: numOr(f.duration.value, 15),
                cooldownSecs: numOr(f.cooldown.value, 300),
                enabled: true,
                notifyToast: f.toast.checked,
                target: null
            }
        }, submitBtn);
        if (ok) f.reset();
    });

    // =========================================================================
    // 4. BATTERY & WIRELESS PERIPHERALS
    // =========================================================================
    async function loadBattery() {
        await withBusy("battery", byId("battery-refresh-btn"), async () => {
            show("battery-status", "Querying Windows battery telemetry & Bluetooth peripherals…");
            try {
                const snap = await invoke("battery_snapshot");
                const batGrid = byId("battery-cards");
                const btGrid = byId("battery-peripherals");
                batGrid.replaceChildren();
                if (!snap.hasBattery) {
                    batGrid.append(element("div", "mod-card", "No internal laptop/UPS battery detected (Desktop AC Power). Active Plan: " + (snap.powerPlan || "—")));
                } else {
                    for (const b of snap.batteries) {
                        const card = element("div", "mod-card");
                        const head = element("div", "mod-card-head");
                        head.append(element("strong", "", `🔋 ${b.name}`), pill(`${b.chargePercent ?? "—"}% · ${b.status}`, (b.chargePercent ?? 100) <= 20 ? "crit" : "ok"));
                        const lines = [
                            b.healthPercent != null ? `Health: ${b.healthPercent}% (Wear: ${b.wearPercent}%)` : null,
                            b.designCapacityMwh && b.fullChargeCapacityMwh ? `Capacity: ${b.fullChargeCapacityMwh} / ${b.designCapacityMwh} mWh` : null,
                            b.cycleCount != null ? `Cycle Count: ${b.cycleCount}` : null,
                            b.estimatedMinutes != null ? `Est. Runtime: ${Math.floor(b.estimatedMinutes / 60)}h ${b.estimatedMinutes % 60}m` : null,
                            b.voltageMv != null ? `Voltage: ${(b.voltageMv / 1000).toFixed(2)} V` : null,
                            b.dischargeRateMw != null ? `Discharge: ${(b.dischargeRateMw / 1000).toFixed(1)} W` : b.chargeRateMw != null ? `Charge Rate: ${(b.chargeRateMw / 1000).toFixed(1)} W` : null
                        ].filter(Boolean);
                        card.append(head, element("div", "mod-card-sub", lines.join(" · ") || "Basic battery status reported."));
                        batGrid.append(card);
                    }
                }
                btGrid.replaceChildren();
                if (!snap.peripherals.length) {
                    btGrid.append(element("div", "mod-card", "No Bluetooth peripherals reporting Windows battery levels."));
                } else {
                    for (const p of snap.peripherals) {
                        const card = element("div", "mod-card");
                        const head = element("div", "mod-card-head");
                        head.append(element("strong", "", `🎧 ${p.name}`), pill(`${p.batteryPercent}%`, p.batteryPercent <= 15 ? "crit" : p.batteryPercent <= 35 ? "warn" : "ok"));
                        const barBg = element("div", "track-bg");
                        const fill = element("div", "track-fill");
                        fill.style.width = `${p.batteryPercent}%`;
                        barBg.append(fill);
                        card.append(head, barBg);
                        btGrid.append(card);
                    }
                }
                show("battery-status", `${snap.batteries.length} battery(ies) · ${snap.peripherals.length} wireless peripheral(s).`);
            } catch (err) { show("battery-status", String(err)); }
        });
    }

    byId("battery-refresh-btn")?.addEventListener("click", () => void loadBattery());
    for (const [id, kind] of [
        ["battery-report-btn", "battery_report"],
        ["battery-sleep-btn", "sleep_study"],
        ["battery-power-btn", "open_power_settings"],
        ["battery-bt-btn", "open_bluetooth_settings"]
    ]) {
        byId(id)?.addEventListener("click", (ev) => void withBusy("battery-action", ev.currentTarget, async () => {
            try {
                const msg = await invoke("battery_action", { action: { kind } });
                show("battery-status", msg);
            } catch (err) { show("battery-status", String(err)); }
        }));
    }

    // =========================================================================
    // 5. SYSTEM SNAPSHOTS & DIFF (6 Domains + Visual Diff Cards)
    // =========================================================================
    async function loadSnapshots() {
        try {
            const list = await invoke("snapshots_list");
            const tbody = byId("snapshots-rows");
            const selA = byId("snap-before");
            const selB = byId("snap-after");
            const prevA = selA.value;
            const prevB = selB.value;
            tbody.replaceChildren();
            selA.replaceChildren();
            selB.replaceChildren(new Option("Current Live System", "__LIVE__"));
            for (const s of list) {
                selA.append(new Option(`${s.label} (${fmtTime(s.createdMs)})`, s.id));
                selB.append(new Option(`${s.label} (${fmtTime(s.createdMs)})`, s.id));
                const tr = document.createElement("tr");
                const del = actionButton("Delete", async () => {
                    if (!(await confirmDashboardAction(`Delete snapshot '${s.label}'?`, "Permanently delete this saved system snapshot?", "Delete"))) return;
                    await withBusy("snapshots", del, async () => {
                        try {
                            await invoke("snapshots_delete", { id: s.id });
                            await loadSnapshots();
                        } catch (err) { show("snapshots-status", String(err)); }
                    });
                });
                del.className = "console-clear-btn btn-danger";
                tr.append(
                    element("td", "", s.label),
                    element("td", "", fmtTime(s.createdMs)),
                    element("td", "", `${s.appCount} apps · ${s.startupCount} startup · ${s.serviceCount} svcs · ${s.driverCount || 0} drivers`),
                    (() => { const td = document.createElement("td"); td.append(del); return td; })()
                );
                tbody.append(tr);
            }
            if ([...selA.options].some((o) => o.value === prevA)) selA.value = prevA;
            if ([...selB.options].some((o) => o.value === prevB)) selB.value = prevB;
            show("snapshots-status", `${list.length} saved snapshot(s).`);
        } catch (err) { show("snapshots-status", String(err)); }
    }

    byId("snap-capture-btn")?.addEventListener("click", (ev) => void withBusy("snapshots", ev.currentTarget, async () => {
        const label = byId("snap-label-input").value.trim() || `Snapshot ${new Date().toLocaleDateString()}`;
        const rp = byId("snap-restore-point").checked;
        show("snapshots-status", "Capturing 6-domain system snapshot in parallel…");
        try {
            const [, msg] = await invoke("snapshots_capture", { label, createRestorePoint: rp });
            byId("snap-label-input").value = "";
            await loadSnapshots();
            show("snapshots-status", msg);
            toast(msg, "ok");
        } catch (err) { show("snapshots-status", String(err)); }
    }));

    byId("snap-diff-btn")?.addEventListener("click", (ev) => void withBusy("snapshots", ev.currentTarget, async () => {
        const beforeId = byId("snap-before").value;
        const afterId = byId("snap-after").value;
        if (!beforeId) { show("snapshots-status", "Capture at least one snapshot first."); return; }
        show("snapshots-status", "Comparing snapshots across 6 system domains…");
        try {
            const d = await invoke("snapshots_diff", { beforeId, afterId: afterId === "__LIVE__" ? null : afterId });
            const categories = [
                ["Apps", "📦", d.apps],
                ["Startup", "🚀", d.startup],
                ["Services", "⚙️", d.services],
                ["Drivers", "🧩", d.drivers || { added: [], removed: [], changed: [] }],
                ["Hosts", "🌐", d.hosts],
                ["Network", "📡", d.network]
            ];
            const lines = [`=== DIFF: ${d.beforeLabel} → ${d.afterLabel} (${d.totalChanges} total changes) ===`];
            const visual = byId("snap-diff-visual");
            if (visual) visual.replaceChildren();
            for (const [title, icon, cat] of categories) {
                const count = cat.added.length + cat.removed.length + cat.changed.length;
                if (!count) continue;
                lines.push(`\n[${title}] (+${cat.added.length} / -${cat.removed.length} / ~${cat.changed.length})`);
                for (const x of cat.added) lines.push(`  + ${x.key}: ${x.after}`);
                for (const x of cat.removed) lines.push(`  - ${x.key}: ${x.before}`);
                for (const x of cat.changed) lines.push(`  ~ ${x.key}: ${x.before}  ==>  ${x.after}`);

                if (visual) {
                    const card = element("div", "snap-diff-card");
                    const head = element("div", "mod-card-head");
                    head.append(element("strong", "", `${icon} ${title}`), pill(`+${cat.added.length} / -${cat.removed.length} / ~${cat.changed.length}`, "warn"));
                    card.append(head);
                    for (const x of cat.added) card.append(element("div", "snap-diff-line diff-add", `+ ${x.key}: ${x.after ?? ""}`));
                    for (const x of cat.removed) card.append(element("div", "snap-diff-line diff-rem", `- ${x.key}: ${x.before ?? ""}`));
                    for (const x of cat.changed) card.append(element("div", "snap-diff-line diff-chg", `~ ${x.key}: ${x.before ?? ""} → ${x.after ?? ""}`));
                    visual.append(card);
                }
            }
            if (d.totalChanges === 0) {
                lines.push("\nNo differences detected across apps, startup, services, drivers, hosts, or network.");
                if (visual) visual.append(element("div", "mod-card", `✅ No differences detected between '${d.beforeLabel}' and '${d.afterLabel}'.`));
            }
            byId("snap-diff-output").textContent = lines.join("\n");
            show("snapshots-status", `Diff complete: ${d.totalChanges} change(s).`);
        } catch (err) { show("snapshots-status", String(err)); }
    }));

    byId("snap-export-btn")?.addEventListener("click", (ev) => void withBusy("snapshots-export", ev.currentTarget, async () => {
        const text = (byId("snap-diff-output")?.textContent || "").trim();
        if (!text || text.startsWith("Select two snapshots")) {
            show("snapshots-status", "Run a snapshot diff first before exporting.");
            return;
        }
        try {
            const saved = await invoke("snapshots_export", { markdown: "```text\n" + text + "\n```\n" });
            if (saved) { show("snapshots-status", `Exported diff to ${saved}`); toast("Diff exported", "ok"); }
        } catch (err) { show("snapshots-status", String(err)); }
    }));

    // =========================================================================
    // 6. SSH HOSTS & CERTIFICATES (Native Crypt32 + Tabs + Expiry Filter)
    // =========================================================================
    let sshData = null;
    let sshActiveTab = "all";
    let sshCertFilter = "all";

    function applySshTabVisibility() {
        const setVis = (id, vis) => { const el = byId(id); if (el) el.hidden = !vis; };
        setVis("ssh-sec-hosts", sshActiveTab === "all" || sshActiveTab === "hosts");
        setVis("ssh-sec-keys", sshActiveTab === "all" || sshActiveTab === "keys");
        setVis("ssh-sec-certs", sshActiveTab === "all" || sshActiveTab === "certs");
    }

    function renderSshCertsTable() {
        if (!sshData) return;
        const certsBody = byId("ssh-certs-rows");
        if (!certsBody) return;
        certsBody.replaceChildren();
        const filtered = sshData.certs.filter((c) => {
            if (sshCertFilter === "expired") return c.status === "expired";
            if (sshCertFilter === "expiring") return c.status === "expired" || c.daysRemaining <= 90;
            return true;
        });
        if (!filtered.length) {
            const tr = document.createElement("tr");
            const td = element("td", "mod-card-sub", "No certificates matching current expiry filter.");
            td.colSpan = 6;
            tr.append(td);
            certsBody.append(tr);
            return;
        }
        for (const c of filtered) {
            const tr = document.createElement("tr");
            const thumb = c.thumbprint || "";
            const thumbTd = element("td", "mod-mono mod-click-copy", thumb ? thumb.slice(0, 14) + "…" : "—");
            if (thumb) {
                thumbTd.title = `Click to copy full thumbprint: ${thumb}`;
                thumbTd.addEventListener("click", () => {
                    navigator.clipboard?.writeText(thumb).then(() => toast("Copied certificate thumbprint", "ok")).catch(() => {});
                });
            }
            tr.append(
                (() => { const td = document.createElement("td"); td.append(pill(c.status === "expired" ? "EXPIRED" : `${c.daysRemaining}d`, c.status === "expired" || c.status === "critical" ? "crit" : c.status === "warning" ? "warn" : "ok")); return td; })(),
                element("td", "", c.store),
                element("td", "", c.subject),
                element("td", "mod-card-sub", c.issuer || "—"),
                element("td", "", c.notAfter),
                thumbTd
            );
            certsBody.append(tr);
        }
    }

    async function loadSshCerts() {
        await withBusy("ssh-load", byId("ssh-refresh-btn"), async () => {
            show("ssh-status", "Reading ~/.ssh/config, keys, and Windows Crypt32 certificate stores…");
            try {
                const data = await invoke("ssh_certs_state");
                sshData = data;
                const hostsEl = byId("ssh-hosts-grid");
                hostsEl.replaceChildren();
                if (!data.hosts.length) {
                    hostsEl.append(element("div", "mod-card", `No hosts defined in ${data.configPath}. Expand "Add SSH Host" above to create one.`));
                } else {
                    for (const h of data.hosts) {
                        const card = element("div", "mod-card");
                        const head = element("div", "mod-card-head");
                        head.append(element("strong", "", `🖥️ ${h.alias}`), pill(`:${h.port}`, "neutral"));
                        const acts = element("div", "panel-actions");
                        const launch = actionButton("SSH Launch", () => {
                            invoke("ssh_certs_action", { action: { kind: "launch_ssh", alias: h.alias } })
                                .then((m) => show("ssh-status", m))
                                .catch((e) => show("ssh-status", String(e)));
                        });
                        launch.className = "console-clear-btn btn-accent-action";
                        const test = actionButton("Test TCP", () => void withBusy(`ssh-test-${h.alias}`, test, async () => {
                            try {
                                const msg = await invoke("ssh_certs_action", { action: { kind: "test_host", host_name: h.hostName, port: h.port } });
                                show("ssh-status", msg);
                                toast(msg, msg.includes("Reachable") ? "ok" : "warn");
                            } catch (e) { show("ssh-status", String(e)); }
                        }));
                        const del = actionButton("Delete", async () => {
                            if (!(await confirmDashboardAction(`Delete SSH Host '${h.alias}'?`, `Remove Host '${h.alias}' from ~/.ssh/config?`, "Delete"))) return;
                            await withBusy("ssh-mut", del, async () => {
                                try {
                                    const msg = await invoke("ssh_certs_action", { action: { kind: "delete_host", alias: h.alias } });
                                    await loadSshCerts();
                                    show("ssh-status", msg);
                                } catch (e) { show("ssh-status", String(e)); }
                            });
                        });
                        del.className = "console-clear-btn btn-danger";
                        acts.append(launch, test, del);
                        const meta = `${h.user ? h.user + "@" : ""}${h.hostName}${h.identityFile ? " · " + h.identityFile : ""}${h.proxyJump ? " · via " + h.proxyJump : ""}`;
                        card.append(head, element("div", "mod-card-sub", meta), acts);
                        hostsEl.append(card);
                    }
                }
                const keysEl = byId("ssh-keys-list");
                keysEl.replaceChildren();
                for (const k of data.keys) {
                    const row = element("div", "mod-card");
                    const head = element("div", "mod-card-head");
                    const copy = actionButton("Copy Public Key", async () => {
                        try {
                            await navigator.clipboard.writeText(k.publicKey);
                            show("ssh-status", `Copied ${k.name}`);
                            toast(`Copied ${k.name}`, "ok");
                        } catch {
                            show("ssh-status", "Clipboard access is unavailable.");
                        }
                    });
                    head.append(element("strong", "", `🔑 ${k.name} (${k.keyType})`), copy);
                    row.append(head, element("div", "mod-card-sub mod-mono", k.publicKey.slice(0, 96) + (k.publicKey.length > 96 ? "…" : "")));
                    keysEl.append(row);
                }
                renderSshCertsTable();
                applySshTabVisibility();
                show("ssh-status", `${data.hosts.length} SSH host(s) · ${data.keys.length} key(s) · ${data.certs.length} certificate(s).`);
            } catch (err) { show("ssh-status", String(err)); }
        });
    }

    for (const btn of document.querySelectorAll("[data-ssh-tab]")) {
        btn.addEventListener("click", () => {
            sshActiveTab = btn.dataset.sshTab;
            for (const b of document.querySelectorAll("[data-ssh-tab]")) b.classList.toggle("active", b === btn);
            applySshTabVisibility();
        });
    }
    for (const btn of document.querySelectorAll("[data-cert-filter]")) {
        btn.addEventListener("click", () => {
            sshCertFilter = btn.dataset.certFilter;
            for (const b of document.querySelectorAll("[data-cert-filter]")) b.classList.toggle("active", b === btn);
            renderSshCertsTable();
        });
    }
    byId("ssh-refresh-btn")?.addEventListener("click", () => void loadSshCerts());
    byId("ssh-host-form")?.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const f = ev.currentTarget;
        const submitBtn = f.querySelector('button[type="submit"]');
        await withBusy("ssh-mut", submitBtn, async () => {
            try {
                const msg = await invoke("ssh_certs_action", {
                    action: {
                        kind: "save_host",
                        host: {
                            alias: f.alias.value,
                            hostName: f.hostName.value,
                            user: f.user.value,
                            port: numOr(f.port.value, 22),
                            identityFile: f.identityFile.value,
                            proxyJump: f.proxyJump?.value || ""
                        }
                    }
                });
                f.reset();
                await loadSshCerts();
                show("ssh-status", msg);
            } catch (err) { show("ssh-status", String(err)); }
        });
    });
    byId("ssh-keygen-btn")?.addEventListener("click", async (ev) => {
        const btn = ev.currentTarget;
        const name = await askDashboard("Generate ED25519 SSH Key", "Enter key filename inside ~/.ssh/", { label: "Filename", value: "id_ed25519_corewatch" });
        if (!name) return;
        await withBusy("ssh-mut", btn, async () => {
            try {
                const msg = await invoke("ssh_certs_action", { action: { kind: "generate_key", name, comment: "corewatch" } });
                await loadSshCerts();
                show("ssh-status", msg);
            } catch (err) { show("ssh-status", String(err)); }
        });
    });

    // =========================================================================
    // 7. BACKUP & FOLDER SYNC (ROBOCOPY)
    // =========================================================================
    function renderBackup(data) {
        const grid = byId("backup-jobs-grid");
        grid.replaceChildren();
        if (!data.jobs.length) {
            grid.append(element("div", "mod-card", "No backup sync jobs yet. Expand \"Create Backup Job\" above to configure Robocopy sync."));
        } else {
            for (const j of data.jobs) {
                const card = element("div", "mod-card");
                const head = element("div", "mod-card-head");
                head.append(element("strong", "", `💾 ${j.name}`), pill(j.mode.toUpperCase(), j.mode === "mirror" ? "warn" : "ok"));
                const acts = element("div", "panel-actions");
                const dry = actionButton("Dry-Run", () => void runBackupAction({ kind: "run_job", id: j.id, dry_run: true }, dry));
                const run = actionButton("Run Sync", async () => {
                    if (j.mode === "mirror") {
                        const ok = await confirmDashboardAction(
                            `Run Mirror Sync '${j.name}'?`,
                            `Robocopy /MIR will DELETE files in '${j.destination}' that do not exist in '${j.source}'.`,
                            "Run Mirror"
                        );
                        if (!ok) return;
                    }
                    await runBackupAction({ kind: "run_job", id: j.id, dry_run: false }, run);
                });
                run.className = "console-clear-btn btn-accent-action";
                const openSrc = actionButton("📂 Src", () => void runBackupAction({ kind: "open_folder", path: j.source }, openSrc));
                const openDst = actionButton("📂 Dest", () => void runBackupAction({ kind: "open_folder", path: j.destination }, openDst));
                const del = actionButton("Delete", async () => {
                    if (!(await confirmDashboardAction(`Delete Backup Job '${j.name}'?`, "Remove this sync job configuration? Files on disk will not be touched.", "Delete"))) return;
                    await runBackupAction({ kind: "delete_job", id: j.id }, del);
                });
                del.className = "console-clear-btn btn-danger";
                acts.append(dry, run, openSrc, openDst, del);
                card.append(
                    head,
                    element("div", "mod-card-sub", `${j.source}  →  ${j.destination}`),
                    element("div", "mod-card-sub", j.excludes.length ? `Exclude: ${j.excludes.join(", ")}` : "No excluded folders"),
                    element("div", "mod-card-sub", j.lastStatus ? `Last: ${j.lastStatus}` : "Never run"),
                    acts
                );
                grid.append(card);
            }
        }
        const pre = byId("backup-history-log");
        pre.textContent = data.history.length
            ? data.history.map((h) => `[${fmtTime(h.timestampMs)}] ${h.jobName}: ${h.summary}\n${h.outputTail}`).join("\n\n---\n\n")
            : "";
    }

    async function runBackupAction(action, btn = null) {
        return withBusy("backup", btn, async () => {
            show("backup-status", "Running backup operation…");
            try {
                const [next, msg] = await invoke("backup_action", { action });
                renderBackup(next);
                show("backup-status", msg);
                return true;
            } catch (err) {
                show("backup-status", String(err));
                toast(String(err), "crit");
                return false;
            }
        });
    }

    async function loadBackup() {
        try { renderBackup(await invoke("backup_state")); }
        catch (err) { show("backup-status", String(err)); }
    }

    for (const btn of document.querySelectorAll("[data-backup-excl]")) {
        btn.addEventListener("click", () => {
            const input = byId("backup-excludes-input");
            if (!input) return;
            const kind = btn.dataset.backupExcl;
            if (kind === "dev") input.value = "node_modules, target, .git, bin, obj, dist, __pycache__, .venv";
            else if (kind === "media") input.value = "*.tmp, *.cache, Thumbs.db, desktop.ini";
            else input.value = "";
        });
    }
    byId("backup-add-form")?.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const f = ev.currentTarget;
        const submitBtn = f.querySelector('button[type="submit"]');
        const ok = await runBackupAction({
            kind: "save_job",
            job: {
                id: "",
                name: f.name.value,
                source: f.source.value,
                destination: f.destination.value,
                mode: f.mode.value,
                excludes: f.excludes.value.split(",").map((s) => s.trim()).filter(Boolean),
                lastRunMs: null,
                lastStatus: null
            }
        }, submitBtn);
        if (ok) f.reset();
    });
    byId("backup-clear-history")?.addEventListener("click", async (ev) => {
        const btn = ev.currentTarget;
        if (!(await confirmDashboardAction("Clear Backup History?", "Clear all recorded Robocopy execution logs?", "Clear"))) return;
        await runBackupAction({ kind: "clear_history" }, btn);
    });
    for (const [btnId, inputId] of [["backup-browse-src", "backup-src-input"], ["backup-browse-dst", "backup-dst-input"]]) {
        byId(btnId)?.addEventListener("click", (ev) => void withBusy("backup-browse", ev.currentTarget, async () => {
            const cur = byId(inputId)?.value || "";
            const picked = await invoke("pick_folder", { initial: cur }).catch(() => null);
            if (picked) byId(inputId).value = picked;
        }));
    }

    // =========================================================================
    // 8. SECURITY & REPAIR TOOLKIT (Score, TPM/RDP, PATH Audit, Temp Bloat)
    // =========================================================================
    async function loadSecurity() {
        await withBusy("security-audit", byId("security-refresh-btn"), async () => {
            show("security-status", "Auditing Windows security posture, PATH integrity & %TEMP% bloat…");
            try {
                const data = await invoke("security_audit");
                const kpi = byId("security-kpi");
                const missingPath = (data.pathAudit || []).filter((p) => !p.exists).length;
                const dupPath = (data.pathAudit || []).filter((p) => p.duplicate).length;
                if (kpi) {
                    const scoreTone = data.score >= 85 ? "ok" : data.score >= 65 ? "warn" : "crit";
                    kpi.replaceChildren(
                        kpiChip("Posture Score", `${data.score}/100`, scoreTone),
                        kpiChip("Session", data.isAdmin ? "Administrator" : "Standard User", data.isAdmin ? "ok" : "warn"),
                        kpiChip("%TEMP% Bloat", `${fmtBytes(data.tempBloatBytes)} (${data.tempFileCount} files)`, data.tempBloatBytes > 1024 ** 3 ? "warn" : "ok"),
                        kpiChip("PATH Audit", missingPath || dupPath ? `${missingPath} missing · ${dupPath} dup` : `${data.pathEntries.length} clean`, missingPath || dupPath ? "warn" : "ok")
                    );
                }
                const grid = byId("security-checks-grid");
                grid.replaceChildren();
                for (const c of data.checks) {
                    const card = element("div", "mod-card");
                    const head = element("div", "mod-card-head");
                    head.append(element("strong", "", c.label), pill(c.value, c.status));
                    card.append(head, element("div", "mod-card-sub", c.detail));
                    grid.append(card);
                }
                const pathLines = (data.pathAudit || []).map((p) => {
                    const flags = [!p.exists ? "[MISSING]" : null, p.duplicate ? "[DUPLICATE]" : null].filter(Boolean).join(" ");
                    return `  ${flags ? flags + " " : ""}${p.path}`;
                });
                byId("security-audit-pre").textContent = [
                    `Proxy: ${data.proxyEnabled ? data.proxyServer : "Disabled"}`,
                    `\nActive hosts entries (${data.hostsEntries.length}):`,
                    ...(data.hostsEntries.length ? data.hostsEntries.map((l) => "  " + l) : ["  (default clean hosts)"]),
                    `\nPATH directories (${data.pathEntries.length} total · ${missingPath} missing · ${dupPath} duplicate):`,
                    ...(pathLines.length ? pathLines.slice(0, 30) : data.pathEntries.slice(0, 20).map((p) => "  " + p))
                ].join("\n");
                show("security-status", `Audit complete · Score ${data.score}/100 (${data.isAdmin ? "Administrator" : "Standard User"}).`);
            } catch (err) { show("security-status", String(err)); }
        });
    }

    byId("security-refresh-btn")?.addEventListener("click", () => void loadSecurity());
    const repairButtons = [...document.querySelectorAll("[data-repair-kind]")];
    const confirmRepairs = {
        reset_winsock: ["Reset Windows Winsock Catalog?", "Resetting Winsock requires a system reboot to take full effect and may briefly interrupt networking."],
        reset_ip_stack: ["Reset TCP/IP Stack (netsh int ip reset)?", "Resets the Windows IPv4/IPv6 network stack and requires a reboot to complete."],
        dism_restore_health: ["Run DISM /RestoreHealth?", "DISM image repair downloads component files via Windows Update and can take several minutes."],
        sfc_scannow: ["Run System File Checker (sfc /scannow)?", "Windows will scan and repair protected system files. This can take several minutes."],
        safe_temp_cleanup: ["Clean Stale %TEMP% Files?", "Safely removes unlocked temporary files older than 24 hours from your user %TEMP% directory."]
    };
    for (const btn of repairButtons) {
        btn.addEventListener("click", async () => {
            const kind = btn.dataset.repairKind;
            if (busyKeys.has("security-repair")) return;
            if (confirmRepairs[kind]) {
                const [title, msg] = confirmRepairs[kind];
                if (!(await confirmDashboardAction(title, msg, "Run Repair"))) return;
            }
            await withBusy("security-repair", null, async () => {
                for (const b of repairButtons) b.disabled = true;
                show("security-status", `Running ${btn.textContent}…`);
                try {
                    const out = await invoke("security_repair_action", { action: { kind } });
                    byId("security-repair-output").textContent = out || "Completed.";
                    show("security-status", `${btn.textContent} finished.`);
                    toast(`${btn.textContent} finished`, "ok");
                    if (kind === "safe_temp_cleanup") void loadSecurity();
                } catch (err) {
                    byId("security-repair-output").textContent = String(err);
                    show("security-status", String(err));
                    toast(String(err), "crit");
                } finally {
                    for (const b of repairButtons) b.disabled = false;
                }
            });
        });
    }

    // =========================================================================
    // 9. DOCKER / CONTAINERS, IMAGES & NATIVE SCM DEV SERVICES
    // =========================================================================
    async function loadDocker() {
        await withBusy("docker-load", byId("docker-refresh-btn"), async () => {
            show("docker-status", "Checking Docker/Podman & local developer services…");
            try {
                const data = await invoke("docker_state");
                const cBody = byId("docker-containers-rows");
                cBody.replaceChildren();
                if (!data.runtimeAvailable) {
                    const tr = document.createElement("tr");
                    const td = element("td", "mod-card-sub", data.runtimeError || "Docker / Podman daemon is not running or not installed.");
                    td.colSpan = 5;
                    tr.append(td);
                    cBody.append(tr);
                } else if (!data.containers.length) {
                    const tr = document.createElement("tr");
                    const td = element("td", "mod-card-sub", `Connected to ${data.runtime}: no containers found.`);
                    td.colSpan = 5;
                    tr.append(td);
                    cBody.append(tr);
                } else {
                    for (const c of data.containers) {
                        const tr = document.createElement("tr");
                        const running = c.state.toLowerCase() === "running";
                        const acts = element("div", "panel-actions");
                        const toggleBtn = actionButton(running ? "Stop" : "Start", () => void withBusy("docker-mut", toggleBtn, async () => {
                            let errMsg = null;
                            try { await invoke("docker_action", { action: { kind: running ? "stop" : "start", id: c.id } }); }
                            catch (e) { errMsg = String(e); }
                            await loadDocker();
                            if (errMsg) show("docker-status", errMsg);
                        }));
                        const restartBtn = actionButton("Restart", () => void withBusy("docker-mut", restartBtn, async () => {
                            let errMsg = null;
                            try { await invoke("docker_action", { action: { kind: "restart", id: c.id } }); }
                            catch (e) { errMsg = String(e); }
                            await loadDocker();
                            if (errMsg) show("docker-status", errMsg);
                        }));
                        const logsBtn = actionButton("Logs", () => void withBusy("docker-logs", logsBtn, async () => {
                            try {
                                const out = await invoke("docker_action", { action: { kind: "logs", id: c.id } });
                                byId("docker-logs-pre").textContent = out || "(no logs)";
                            } catch (e) {
                                byId("docker-logs-pre").textContent = String(e);
                                show("docker-status", String(e));
                            }
                        }));
                        const rmBtn = actionButton("Remove", async () => {
                            if (!(await confirmDashboardAction(`Remove container '${c.name}'?`, "Force-remove this container?", "Remove"))) return;
                            await withBusy("docker-mut", rmBtn, async () => {
                                try {
                                    await invoke("docker_action", { action: { kind: "remove_container", id: c.id } });
                                    await loadDocker();
                                } catch (e) { show("docker-status", String(e)); }
                            });
                        });
                        rmBtn.className = "console-clear-btn btn-danger";
                        acts.append(toggleBtn, restartBtn, logsBtn, rmBtn);

                        const portsTd = document.createElement("td");
                        if (c.ports) {
                            for (const seg of c.ports.split(",").map((s) => s.trim()).filter(Boolean)) {
                                const btn = element("button", "mod-port-link", seg);
                                btn.type = "button";
                                btn.title = "Inspect sockets in Tasks & Ports";
                                btn.addEventListener("click", () => void window.cwApp?.selectView("tasksports"));
                                portsTd.append(btn);
                            }
                        } else {
                            portsTd.textContent = "—";
                        }

                        tr.append(
                            element("td", "", c.name),
                            element("td", "", c.image),
                            (() => { const td = document.createElement("td"); td.append(pill(c.state.toUpperCase(), running ? "ok" : "neutral")); return td; })(),
                            portsTd,
                            (() => { const td = document.createElement("td"); td.append(acts); return td; })()
                        );
                        cBody.append(tr);
                    }
                }

                const iBody = byId("docker-images-rows");
                if (iBody) {
                    iBody.replaceChildren();
                    if (!data.images.length) {
                        const tr = document.createElement("tr");
                        const td = element("td", "mod-card-sub", data.runtimeAvailable ? "No local container images found." : "Runtime offline.");
                        td.colSpan = 5;
                        tr.append(td);
                        iBody.append(tr);
                    } else {
                        for (const img of data.images) {
                            const tr = document.createElement("tr");
                            const rmImg = actionButton("Remove", async () => {
                                if (!(await confirmDashboardAction(`Remove image ${img.repository}:${img.tag}?`, "Delete this container image from local storage?", "Remove"))) return;
                                await withBusy("docker-mut", rmImg, async () => {
                                    try {
                                        await invoke("docker_action", { action: { kind: "remove_image", id: img.id } });
                                        await loadDocker();
                                    } catch (e) { show("docker-status", String(e)); }
                                });
                            });
                            rmImg.className = "console-clear-btn btn-danger";
                            tr.append(
                                element("td", "", img.repository),
                                element("td", "", img.tag),
                                element("td", "mod-mono mod-card-sub", img.id),
                                element("td", "", img.size),
                                (() => { const td = document.createElement("td"); td.append(rmImg); return td; })()
                            );
                            iBody.append(tr);
                        }
                    }
                }

                const svcGrid = byId("docker-dev-services");
                svcGrid.replaceChildren();
                if (!data.devServices.length) {
                    svcGrid.append(element("div", "mod-card", "No local developer services (Docker, Postgres, MySQL, Redis, Mongo, Nginx, OpenSSH) installed."));
                } else {
                    for (const s of data.devServices) {
                        const card = element("div", "mod-card");
                        const head = element("div", "mod-card-head");
                        const running = s.status === "Running";
                        head.append(element("strong", "", s.displayName), pill(s.status, running ? "ok" : "neutral"));
                        const acts = element("div", "panel-actions");
                        const runSvc = (op, btn) => void withBusy("docker-svc", btn, async () => {
                            try {
                                const msg = await invoke("docker_action", { action: { kind: "service_control", name: s.name, op } });
                                show("docker-status", msg);
                                toast(msg, "ok");
                                await loadDocker();
                            } catch (e) {
                                show("docker-status", String(e));
                                toast(String(e), "crit");
                            }
                        });
                        const toggleSvc = actionButton(running ? "Stop" : "Start", () => runSvc(running ? "stop" : "start", toggleSvc));
                        toggleSvc.className = "console-clear-btn " + (running ? "btn-danger" : "btn-accent-action");
                        const restartSvc = actionButton("Restart", () => runSvc("restart", restartSvc));
                        acts.append(toggleSvc, restartSvc);
                        card.append(
                            head,
                            element("div", "mod-card-sub", `${s.name} · Startup: ${s.startType}${s.pid ? " · PID " + s.pid : ""}`),
                            acts
                        );
                        svcGrid.append(card);
                    }
                }
                show("docker-status", `${data.runtime ? data.runtime + ": " : ""}${data.containers.length} container(s), ${data.images.length} image(s) · ${data.devServices.length} local dev service(s).`);
            } catch (err) { show("docker-status", String(err)); }
        });
    }

    byId("docker-refresh-btn")?.addEventListener("click", () => void loadDocker());
    byId("docker-prune-btn")?.addEventListener("click", async (ev) => {
        const btn = ev.currentTarget;
        if (!(await confirmDashboardAction("Prune Unused Docker Data?", "Remove stopped containers, dangling images, and unused networks?", "Prune"))) return;
        await withBusy("docker-mut", btn, async () => {
            try {
                const out = await invoke("docker_action", { action: { kind: "prune_system" } });
                byId("docker-logs-pre").textContent = out;
                await loadDocker();
            } catch (err) { show("docker-status", String(err)); }
        });
    });

    // =========================================================================
    // 10. INSTALLED APPS (Filters, Sortable Columns, Full Catalog Expansion)
    // =========================================================================
    let installedApps = [];
    let appsFilter = "all";
    let appsShowAll = false;
    const appsSort = { key: "name", dir: 1 };

    function renderInstalledApps() {
        const tbody = byId("apps-rows");
        if (!tbody) return;
        const sysCnt = installedApps.filter((a) => a.isSystem).length;
        const totalKb = installedApps.reduce((acc, a) => acc + (a.estimatedSizeKb || 0), 0);
        const kpi = byId("apps-kpi");
        if (kpi) {
            kpi.replaceChildren(
                kpiChip("Total", installedApps.length),
                kpiChip("User Apps", installedApps.length - sysCnt, "ok"),
                kpiChip("System / Runtimes", sysCnt),
                kpiChip("Est. Footprint", fmtKb(totalKb))
            );
        }
        const q = (byId("apps-search")?.value || "").trim().toLowerCase();
        const list = installedApps.filter((a) => {
            if (appsFilter === "user" && a.isSystem) return false;
            if (appsFilter === "system" && !a.isSystem) return false;
            return !q || a.name.toLowerCase().includes(q) || a.publisher.toLowerCase().includes(q) || a.version.toLowerCase().includes(q);
        });
        list.sort((a, b) => {
            const d = appsSort.dir;
            if (appsSort.key === "size") return ((b.estimatedSizeKb || 0) - (a.estimatedSizeKb || 0)) * d;
            if (appsSort.key === "version") return a.version.localeCompare(b.version) * d;
            if (appsSort.key === "publisher") return a.publisher.localeCompare(b.publisher) * d;
            return a.name.localeCompare(b.name) * d;
        });
        const limit = appsShowAll ? list.length : 300;
        tbody.replaceChildren();
        show("apps-status", `Showing ${Math.min(limit, list.length)} of ${list.length} matching (${installedApps.length} total) installed applications.`);
        for (const a of list.slice(0, limit)) {
            const tr = document.createElement("tr");
            const acts = element("div", "panel-actions");
            if (a.installLocation) {
                const open = actionButton("📂", () => {
                    invoke("installed_apps_action", { action: { kind: "open_folder", path: a.installLocation } }).catch((e) => show("apps-status", String(e)));
                });
                open.title = a.installLocation;
                open.setAttribute("aria-label", `Open install folder for ${a.name}`);
                acts.append(open);
            }
            if (a.uninstallString) {
                const un = actionButton("Uninstall", async () => {
                    if (!(await confirmDashboardAction(`Uninstall ${a.name}?`, "Launch this application's native Windows uninstaller?", "Launch Uninstaller"))) return;
                    await withBusy("apps-uninst", un, async () => {
                        try {
                            show("apps-status", await invoke("installed_apps_action", { action: { kind: "uninstall", id: a.id } }));
                        } catch (e) { show("apps-status", String(e)); }
                    });
                });
                un.className = "console-clear-btn btn-danger";
                acts.append(un);
            }
            const nameTd = document.createElement("td");
            nameTd.append(document.createTextNode(a.name + " "));
            if (a.isSystem) nameTd.append(pill("SYSTEM", "neutral"));
            tr.append(
                nameTd,
                element("td", "", a.version || "—"),
                element("td", "mod-card-sub", a.publisher || "—"),
                element("td", "", fmtKb(a.estimatedSizeKb)),
                (() => { const td = document.createElement("td"); td.append(acts); return td; })()
            );
            tbody.append(tr);
        }
        const moreWrap = byId("apps-show-all-wrap");
        if (moreWrap) {
            moreWrap.replaceChildren();
            moreWrap.hidden = list.length <= 300 || appsShowAll;
            if (!moreWrap.hidden) {
                const btn = actionButton(`Show all ${list.length} applications`, () => {
                    appsShowAll = true;
                    renderInstalledApps();
                });
                moreWrap.append(btn);
            }
        }
    }

    async function loadInstalledApps() {
        await withBusy("apps-load", byId("apps-refresh-btn"), async () => {
            show("apps-status", "Reading Windows installed software registry…");
            try {
                installedApps = await invoke("installed_apps_list");
                appsShowAll = false;
                renderInstalledApps();
            } catch (err) { show("apps-status", String(err)); }
        });
    }

    wireSortHeaders("apps-table", appsSort, renderInstalledApps);
    for (const btn of document.querySelectorAll("[data-apps-filter]")) {
        btn.addEventListener("click", () => {
            appsFilter = btn.dataset.appsFilter;
            for (const b of document.querySelectorAll("[data-apps-filter]")) b.classList.toggle("active", b === btn);
            renderInstalledApps();
        });
    }
    byId("apps-refresh-btn")?.addEventListener("click", () => void loadInstalledApps());
    byId("apps-search")?.addEventListener("input", renderInstalledApps);

    // =========================================================================
    // 11. UNIFIED UPDATE CENTER (Batch Upgrade + Instant Search + Hide Pinned)
    // =========================================================================
    let lastUpdateScan = null;
    const selectedUpgradeIds = new Set();

    function updateBatchUpgradeBtn() {
        const btn = byId("updates-upgrade-selected");
        if (btn) {
            btn.disabled = selectedUpgradeIds.size === 0 || busyKeys.has("updates-mut");
            btn.textContent = `⬆️ Upgrade Selected (${selectedUpgradeIds.size})`;
        }
    }

    function renderUpdatesTable() {
        if (!lastUpdateScan) return;
        const data = lastUpdateScan;
        const q = (byId("updates-search")?.value || "").trim().toLowerCase();
        const hidePinned = Boolean(byId("updates-hide-pinned")?.checked);
        const pinnedCount = data.upgrades.filter((u) => u.ignored).length;
        const kpi = byId("updates-kpi");
        if (kpi) {
            kpi.replaceChildren(
                kpiChip("Upgrades", data.upgrades.length - pinnedCount, (data.upgrades.length - pinnedCount) ? "warn" : "ok"),
                kpiChip("Pinned/Ignored", pinnedCount),
                kpiChip("Selected", selectedUpgradeIds.size, selectedUpgradeIds.size ? "ok" : "")
            );
        }
        const filtered = data.upgrades.filter((u) =>
            (!hidePinned || !u.ignored)
            && (!q || u.name.toLowerCase().includes(q) || u.id.toLowerCase().includes(q))
        );
        const tbody = byId("updates-rows");
        tbody.replaceChildren();
        if (!filtered.length) {
            const tr = document.createElement("tr");
            const td = element("td", "mod-card-sub", data.wingetError || (data.upgrades.length ? "No upgrades match the current filter." : "All WinGet packages appear up to date."));
            td.colSpan = 6;
            tr.append(td);
            tbody.append(tr);
            updateBatchUpgradeBtn();
            return;
        }
        for (const u of filtered) {
            const tr = document.createElement("tr");
            const cb = document.createElement("input");
            cb.type = "checkbox";
            cb.disabled = u.ignored;
            cb.checked = !u.ignored && selectedUpgradeIds.has(u.id);
            cb.addEventListener("change", () => {
                if (cb.checked) selectedUpgradeIds.add(u.id);
                else selectedUpgradeIds.delete(u.id);
                renderUpdatesTable();
            });
            const acts = element("div", "panel-actions");
            if (!u.ignored) {
                const up = actionButton("Upgrade", () => void withBusy("updates-mut", up, async () => {
                    show("updates-status", `Upgrading ${u.name}…`);
                    let msg = null;
                    let errMsg = null;
                    try { msg = await invoke("update_center_action", { action: { kind: "upgrade_package", id: u.id } }); }
                    catch (e) { errMsg = String(e); }
                    if (errMsg) show("updates-status", errMsg);
                    else {
                        selectedUpgradeIds.delete(u.id);
                        await loadUpdates();
                        if (msg) { show("updates-status", msg); toast(msg, "ok"); }
                    }
                }));
                up.className = "console-clear-btn btn-accent-action";
                acts.append(up);
            }
            const pinBtn = actionButton(u.ignored ? "Unpin" : "Pin/Ignore", () => void withBusy("updates-mut", pinBtn, async () => {
                try {
                    await invoke("update_center_action", { action: { kind: "toggle_ignore", id: u.id, ignored: !u.ignored } });
                    selectedUpgradeIds.delete(u.id);
                    await loadUpdates();
                } catch (e) { show("updates-status", String(e)); }
            }));
            acts.append(pinBtn);
            tr.append(
                (() => { const td = document.createElement("td"); td.append(cb); return td; })(),
                element("td", "", u.name),
                element("td", "mod-card-sub mod-mono", u.id),
                element("td", "", u.version),
                (() => { const td = document.createElement("td"); td.append(pill(u.ignored ? "PINNED" : u.available, u.ignored ? "neutral" : "ok")); return td; })(),
                (() => { const td = document.createElement("td"); td.append(acts); return td; })()
            );
            tbody.append(tr);
        }
        updateBatchUpgradeBtn();
    }

    async function loadUpdates() {
        await withBusy("updates-load", byId("updates-scan-btn"), async () => {
            show("updates-status", "Scanning WinGet upgrades, PowerShell 7, and CoreWatch releases in parallel…");
            try {
                const data = await invoke("update_center_scan");
                lastUpdateScan = data;
                const validIds = new Set(data.upgrades.filter((u) => !u.ignored).map((u) => u.id));
                for (const id of [...selectedUpgradeIds]) if (!validIds.has(id)) selectedUpgradeIds.delete(id);

                const cards = byId("updates-summary-cards");
                cards.replaceChildren();
                const psCard = element("div", "mod-card");
                psCard.append(
                    element("strong", "", "❯_ PowerShell 7"),
                    element("div", "mod-card-sub", data.powershell
                        ? (data.powershell.available ? `Update available: ${data.powershell.version} (${data.powershell.installer})` : `Up to date (${data.powershell.install?.version || "—"})`)
                        : "Could not check PowerShell releases.")
                );
                const cwCard = element("div", "mod-card");
                cwCard.append(
                    element("strong", "", "🛡️ CoreWatch Releases"),
                    element("div", "mod-card-sub", data.corewatch
                        ? `Current Rust v${data.corewatch.current} · Latest GitHub: ${data.corewatch.latest || "—"}`
                        : "Release status unavailable.")
                );
                cards.append(psCard, cwCard);

                renderUpdatesTable();
                show("updates-status", `${data.upgrades.length} WinGet package upgrade(s) found.`);
            } catch (err) { show("updates-status", String(err)); }
        });
    }

    byId("updates-scan-btn")?.addEventListener("click", () => void loadUpdates());
    byId("updates-search")?.addEventListener("input", renderUpdatesTable);
    byId("updates-hide-pinned")?.addEventListener("change", renderUpdatesTable);
    byId("updates-select-all")?.addEventListener("change", (ev) => {
        if (!lastUpdateScan) return;
        const checked = ev.currentTarget.checked;
        for (const u of lastUpdateScan.upgrades) {
            if (u.ignored) continue;
            if (checked) selectedUpgradeIds.add(u.id);
            else selectedUpgradeIds.delete(u.id);
        }
        renderUpdatesTable();
    });
    byId("updates-upgrade-selected")?.addEventListener("click", (ev) => void withBusy("updates-mut", ev.currentTarget, async () => {
        const ids = [...selectedUpgradeIds];
        if (!ids.length) return;
        show("updates-status", `Batch upgrading ${ids.length} package(s) via WinGet…`);
        try {
            const msg = await invoke("update_center_action", { action: { kind: "upgrade_batch", ids } });
            selectedUpgradeIds.clear();
            await loadUpdates();
            show("updates-status", msg);
            toast(`Batch upgraded ${ids.length} package(s)`, "ok");
        } catch (err) {
            show("updates-status", String(err));
            toast(String(err), "crit");
        } finally {
            setTimeout(updateBatchUpgradeBtn, 0);
        }
    }));
    byId("updates-winupdate-btn")?.addEventListener("click", () => {
        invoke("update_center_action", { action: { kind: "open_windows_update" } }).catch((e) => show("updates-status", String(e)));
    });

    // =========================================================================
    // 12. MULTI-PC / HOMELAB MONITOR (Parallel Multi-Protocol + Launchers)
    // =========================================================================
    function renderHomelab(nodes) {
        const kpi = byId("homelab-kpi");
        if (kpi) {
            const online = nodes.filter((n) => n.online === true).length;
            const offline = nodes.filter((n) => n.online === false).length;
            kpi.replaceChildren(
                kpiChip("Nodes", nodes.length),
                kpiChip("Online", online, online ? "ok" : ""),
                kpiChip("Offline", offline, offline ? "crit" : "ok")
            );
        }
        const grid = byId("homelab-grid");
        grid.replaceChildren();
        if (!nodes.length) {
            grid.append(element("div", "mod-card", "No homelab / remote PC nodes configured. Expand \"Add Homelab Node\" above or import from ~/.ssh/config."));
            return;
        }
        for (const n of nodes) {
            const card = element("div", "mod-card");
            const head = element("div", "mod-card-head");
            const statusText = n.online == null ? "UNCHECKED" : n.online ? `ONLINE · ${n.latencyMs}ms` : "OFFLINE";
            const tone = n.online == null ? "neutral" : n.online ? "ok" : "crit";
            head.append(element("strong", "", `🌐 ${n.name}`), pill(statusText, tone));
            const acts = element("div", "panel-actions");
            const probeBtn = actionButton("Probe", () => void runHomelabAction({ kind: "probe_one", id: n.id }, probeBtn));
            acts.append(probeBtn);
            const proto = (n.protocol || "").toLowerCase();
            if (proto === "ssh" || proto === "tcp") {
                const sshBtn = actionButton("SSH", () => void runHomelabAction({ kind: "launch_ssh", id: n.id }, sshBtn));
                sshBtn.className = "console-clear-btn btn-accent-action";
                acts.append(sshBtn);
            }
            if (proto === "rdp" || proto === "winrm") {
                const rdpBtn = actionButton("RDP", () => void runHomelabAction({ kind: "launch_rdp", id: n.id }, rdpBtn));
                rdpBtn.className = "console-clear-btn btn-accent-action";
                acts.append(rdpBtn);
            }
            if (proto === "http" || proto === "https") {
                const webBtn = actionButton("Open Web", () => void runHomelabAction({ kind: "open_web", id: n.id }, webBtn));
                webBtn.className = "console-clear-btn btn-accent-action";
                acts.append(webBtn);
            }
            const delBtn = actionButton("Delete", async () => {
                if (!(await confirmDashboardAction(`Delete node '${n.name}'?`, "Remove this homelab monitor entry?", "Delete"))) return;
                await runHomelabAction({ kind: "delete_node", id: n.id }, delBtn);
            });
            delBtn.className = "console-clear-btn btn-danger";
            acts.append(delBtn);
            card.append(
                head,
                element("div", "mod-card-sub", `${n.protocol.toUpperCase()} · ${n.host}${n.port ? ":" + n.port : ""}${n.role ? " · " + n.role : ""}`),
                element("div", "mod-card-sub", n.detail || "Click Probe to check connectivity"),
                acts
            );
            grid.append(card);
        }
    }

    async function runHomelabAction(action, btn = null) {
        return withBusy("homelab", btn, async () => {
            show("homelab-status", "Contacting homelab nodes…");
            try {
                const [list, msg] = await invoke("homelab_action", { action });
                renderHomelab(list);
                show("homelab-status", msg);
                return true;
            } catch (err) {
                show("homelab-status", String(err));
                return false;
            }
        });
    }

    async function loadHomelab() {
        try { renderHomelab(await invoke("homelab_list")); }
        catch (err) { show("homelab-status", String(err)); }
    }

    byId("homelab-proto-select")?.addEventListener("change", (ev) => {
        const portInput = byId("homelab-port-input");
        if (!portInput) return;
        const defaults = { ssh: 22, http: 80, https: 443, rdp: 3389, winrm: 5985, icmp: 0, tcp: 22 };
        portInput.value = String(defaults[ev.currentTarget.value] ?? 22);
    });
    byId("homelab-probe-all")?.addEventListener("click", (ev) => void runHomelabAction({ kind: "probe_all" }, ev.currentTarget));
    byId("homelab-import-ssh")?.addEventListener("click", (ev) => void runHomelabAction({ kind: "import_ssh_config" }, ev.currentTarget));
    byId("homelab-add-form")?.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const f = ev.currentTarget;
        const submitBtn = f.querySelector('button[type="submit"]');
        const ok = await runHomelabAction({
            kind: "save_node",
            node: {
                id: "",
                name: f.name.value,
                host: f.host.value,
                port: numOr(f.port.value, 0),
                protocol: f.protocol.value,
                role: f.role.value,
                online: null,
                latencyMs: null,
                lastCheckedMs: null,
                detail: null
            }
        }, submitBtn);
        if (ok) f.reset();
    });

    const loaders = {
        profiles: loadProfiles,
        startup: loadStartup,
        alerts: loadAlerts,
        battery: loadBattery,
        snapshots: loadSnapshots,
        sshcerts: loadSshCerts,
        backupsync: loadBackup,
        security: loadSecurity,
        docker: loadDocker,
        apps: loadInstalledApps,
        updates: loadUpdates,
        homelab: loadHomelab
    };

    return {
        init() {
            void loadProfiles();
            window.__TAURI__?.event?.listen("profiles-changed", () => void loadProfiles()).catch(() => {});
            // Global '/' shortcut to focus active panel's search filter
            document.addEventListener("keydown", (ev) => {
                if (ev.key !== "/" || ev.ctrlKey || ev.metaKey || ev.altKey) return;
                const activeEl = document.activeElement;
                if (activeEl && (["INPUT", "TEXTAREA", "SELECT"].includes(activeEl.tagName) || activeEl.isContentEditable)) return;
                if (document.querySelector("dialog[open]")) return;
                const activePanel = document.querySelector(".tab-view-panel:not([hidden])");
                const search = activePanel?.querySelector('input[type="search"], input.tab-search-input');
                if (search && search.getClientRects().length) {
                    ev.preventDefault();
                    search.focus();
                    search.select();
                }
            });
        },
        refreshHeaderMode: loadProfiles,
        updateAlertBell,
        async show(viewName) {
            const fn = loaders[viewName];
            if (fn) await fn();
        },
        leave(viewName) {
            // Release large cached datasets and hidden DOM rows when switching tabs.
            if (viewName === "apps") {
                installedApps = [];
                byId("apps-rows")?.replaceChildren();
            } else if (viewName === "sshcerts") {
                sshData = null;
                byId("ssh-certs-rows")?.replaceChildren();
                byId("ssh-keys-list")?.replaceChildren();
            } else if (viewName === "updates") {
                lastUpdateScan = null;
                byId("updates-rows")?.replaceChildren();
            } else if (viewName === "snapshots") {
                byId("snap-diff-visual")?.replaceChildren();
                const out = byId("snap-diff-output");
                if (out) out.textContent = "";
            } else if (viewName === "docker") {
                byId("docker-containers-rows")?.replaceChildren();
                byId("docker-images-rows")?.replaceChildren();
            }
        }
    };
}
