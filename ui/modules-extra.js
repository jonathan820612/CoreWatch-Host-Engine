"use strict";

function createExtraModules(invoke) {
    const pill = (text, tone = "neutral") => element("span", `diag-pill diag-${tone}`, text);
    const kpiChip = (label, val, tone = "") => {
        const chip = element("span", "mod-kpi-chip" + (tone ? ` tone-${tone}` : ""));
        chip.append(document.createTextNode(label + ": "), element("strong", "", String(val)));
        return chip;
    };
    const fmtBytes = (b) => b == null ? "—" : b >= 1024 ** 3 ? (b / 1024 ** 3).toFixed(2) + " GB"
        : b >= 1024 ** 2 ? (b / 1024 ** 2).toFixed(1) + " MB"
        : b >= 1024 ? (b / 1024).toFixed(0) + " KB" : b + " B";
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
    // 1. WSL MANAGER (vmmem RAM, VHDX Disk Sizes, Explore, WSL 1↔2, Full .wslconfig)
    // =========================================================================
    let wslConfigDirty = false;
    const wslForm = byId("wsl-config-form");
    wslForm?.addEventListener("input", () => { wslConfigDirty = true; });
    wslForm?.addEventListener("change", () => { wslConfigDirty = true; });

    async function loadWsl() {
        await withBusy("wsl-load", byId("wsl-refresh-btn"), async () => {
            show("wsl-status", "Querying Windows Subsystem for Linux, VHDX disks & vmmem…");
            try {
                const data = await invoke("wsl_state");
                const kpi = byId("wsl-kpi");
                if (kpi) {
                    const runningCnt = data.distros.filter((d) => d.state.toLowerCase() === "running").length;
                    kpi.replaceChildren(
                        kpiChip("Distros", data.distros.length),
                        kpiChip("Running", runningCnt, runningCnt ? "ok" : ""),
                        kpiChip("vmmem RAM", data.vmmemMb ? `${data.vmmemMb} MB` : "Idle (0 MB)", data.vmmemMb > 6144 ? "warn" : "ok"),
                        kpiChip("Total VHDX", fmtBytes(data.totalVhdxBytes || 0))
                    );
                }
                const tbody = byId("wsl-rows");
                tbody.replaceChildren();
                if (wslForm && data.config && !wslConfigDirty) {
                    wslForm.memory.value = data.config.memory || "";
                    wslForm.processors.value = data.config.processors || "";
                    wslForm.swap.value = data.config.swap || "";
                    wslForm.networkingMode.value = data.config.networkingMode || "";
                    wslForm.localhostForwarding.checked = data.config.localhostForwarding !== false;
                    if (wslForm.autoMemoryReclaim) wslForm.autoMemoryReclaim.value = data.config.autoMemoryReclaim || "";
                    if (wslForm.dnsTunneling) wslForm.dnsTunneling.checked = data.config.dnsTunneling !== false;
                    if (wslForm.firewall) wslForm.firewall.checked = data.config.firewall !== false;
                    if (wslForm.autoProxy) wslForm.autoProxy.checked = data.config.autoProxy !== false;
                    if (wslForm.guiApplications) wslForm.guiApplications.checked = data.config.guiApplications !== false;
                    if (wslForm.nestedVirtualization) wslForm.nestedVirtualization.checked = data.config.nestedVirtualization !== false;
                    if (wslForm.sparseVhd) wslForm.sparseVhd.checked = Boolean(data.config.sparseVhd);
                }
                if (!data.distros.length) {
                    const tr = document.createElement("tr");
                    const td = element("td", "mod-card-sub", data.error || "No WSL distributions installed.");
                    td.colSpan = 5;
                    tr.append(td);
                    tbody.append(tr);
                } else {
                    for (const d of data.distros) {
                        const tr = document.createElement("tr");
                        const running = d.state.toLowerCase() === "running";
                        const acts = element("div", "panel-actions");
                        const launch = actionButton("Terminal", () => {
                            invoke("wsl_action", { action: { kind: "launch", name: d.name } })
                                .then((m) => show("wsl-status", m))
                                .catch((e) => show("wsl-status", String(e)));
                        });
                        launch.className = "console-clear-btn btn-accent-action";
                        const explore = actionButton("📂 Explore", () => {
                            invoke("wsl_action", { action: { kind: "explore", name: d.name } })
                                .then((m) => show("wsl-status", m))
                                .catch((e) => show("wsl-status", String(e)));
                        });
                        const term = actionButton("Terminate", () => void withBusy("wsl-mut", term, async () => {
                            let msg = null;
                            let errMsg = null;
                            try { msg = await invoke("wsl_action", { action: { kind: "terminate", name: d.name } }); }
                            catch (e) { errMsg = String(e); }
                            await loadWsl();
                            if (errMsg || msg) show("wsl-status", errMsg || msg);
                        }));
                        const defBtn = actionButton("Set Default", () => void withBusy("wsl-mut", defBtn, async () => {
                            let msg = null;
                            let errMsg = null;
                            try { msg = await invoke("wsl_action", { action: { kind: "set_default", name: d.name } }); }
                            catch (e) { errMsg = String(e); }
                            await loadWsl();
                            if (errMsg || msg) show("wsl-status", errMsg || msg);
                        }));
                        defBtn.disabled = d.isDefault;
                        const targetVer = d.version === "2" ? 1 : 2;
                        const verBtn = actionButton(`→ WSL ${targetVer}`, async () => {
                            if (!(await confirmDashboardAction(`Convert ${d.name} to WSL ${targetVer}?`, `Converting a WSL distribution between version 1 and 2 can take a few minutes.`, `Convert to WSL ${targetVer}`))) return;
                            await withBusy("wsl-mut", verBtn, async () => {
                                show("wsl-status", `Converting ${d.name} to WSL ${targetVer}…`);
                                try {
                                    const msg = await invoke("wsl_action", { action: { kind: "set_version", name: d.name, version: targetVer } });
                                    await loadWsl();
                                    show("wsl-status", msg);
                                } catch (e) { show("wsl-status", String(e)); }
                            });
                        });
                        const unreg = actionButton("Unregister", async () => {
                            if (!(await confirmDashboardAction(`Unregister ${d.name}?`, `Permanently delete WSL distro '${d.name}' and its virtual disk?`, "Unregister"))) return;
                            await withBusy("wsl-mut", unreg, async () => {
                                let msg = null;
                                let errMsg = null;
                                try { msg = await invoke("wsl_action", { action: { kind: "unregister", name: d.name } }); }
                                catch (e) { errMsg = String(e); }
                                await loadWsl();
                                if (errMsg || msg) show("wsl-status", errMsg || msg);
                            });
                        });
                        unreg.className = "console-clear-btn btn-danger";
                        acts.append(launch, explore, term, defBtn, verBtn, unreg);
                        tr.append(
                            element("td", "", d.name + (d.isDefault ? " ★" : "")),
                            (() => { const td = document.createElement("td"); td.append(pill(d.state.toUpperCase(), running ? "ok" : "neutral")); return td; })(),
                            element("td", "", "WSL " + d.version),
                            element("td", "mod-card-sub", fmtBytes(d.vhdxBytes)),
                            (() => { const td = document.createElement("td"); td.append(acts); return td; })()
                        );
                        tbody.append(tr);
                    }
                }
                show("wsl-status", `${data.distros.length} WSL distro(s) · Config: ${data.configPath}`);
            } catch (err) { show("wsl-status", String(err)); }
        });
    }

    byId("wsl-refresh-btn")?.addEventListener("click", () => void loadWsl());
    byId("wsl-open-config-btn")?.addEventListener("click", () => {
        invoke("wsl_action", { action: { kind: "open_config" } })
            .then((m) => show("wsl-status", m))
            .catch((e) => show("wsl-status", String(e)));
    });
    byId("wsl-shutdown-btn")?.addEventListener("click", async (ev) => {
        const btn = ev.currentTarget;
        if (!(await confirmDashboardAction("Shutdown All WSL Distros?", "Immediately terminate all running WSL 2 distributions and the lightweight VM?", "Shutdown All"))) return;
        await withBusy("wsl-mut", btn, async () => {
            let msg = null;
            let errMsg = null;
            try { msg = await invoke("wsl_action", { action: { kind: "shutdown_all" } }); }
            catch (e) { errMsg = String(e); }
            await loadWsl();
            if (errMsg || msg) show("wsl-status", errMsg || msg);
        });
    });
    byId("wsl-online-btn")?.addEventListener("click", (ev) => void withBusy("wsl-online", ev.currentTarget, async () => {
        show("wsl-status", "Fetching online WSL distro catalog…");
        try {
            byId("wsl-online-pre").textContent = await invoke("wsl_action", { action: { kind: "online_list" } });
            show("wsl-status", "Online WSL catalog loaded.");
        } catch (err) { show("wsl-status", String(err)); }
    }));
    byId("wsl-install-btn")?.addEventListener("click", async (ev) => {
        const btn = ev.currentTarget;
        const name = await askDashboard("Install WSL Distribution", "Enter distro name (e.g. Ubuntu-24.04, Debian, Arch):", { label: "Distribution", value: "Ubuntu-24.04" });
        if (!name) return;
        await withBusy("wsl-mut", btn, async () => {
            try { show("wsl-status", await invoke("wsl_action", { action: { kind: "install", name } })); }
            catch (e) { show("wsl-status", String(e)); }
        });
    });
    wslForm?.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const f = ev.currentTarget;
        const submitBtn = f.querySelector('button[type="submit"]');
        await withBusy("wsl-mut", submitBtn, async () => {
            try {
                const msg = await invoke("wsl_action", {
                    action: {
                        kind: "save_config",
                        config: {
                            memory: f.memory.value,
                            processors: f.processors.value,
                            swap: f.swap.value,
                            localhostForwarding: f.localhostForwarding.checked,
                            networkingMode: f.networkingMode.value,
                            dnsTunneling: f.dnsTunneling ? f.dnsTunneling.checked : true,
                            firewall: f.firewall ? f.firewall.checked : true,
                            autoProxy: f.autoProxy ? f.autoProxy.checked : true,
                            guiApplications: f.guiApplications ? f.guiApplications.checked : true,
                            nestedVirtualization: f.nestedVirtualization ? f.nestedVirtualization.checked : true,
                            autoMemoryReclaim: f.autoMemoryReclaim ? f.autoMemoryReclaim.value : "",
                            sparseVhd: f.sparseVhd ? f.sparseVhd.checked : false
                        }
                    }
                });
                wslConfigDirty = false;
                show("wsl-status", msg);
                toast("Saved .wslconfig", "ok");
            } catch (err) { show("wsl-status", String(err)); }
        });
    });

    // =========================================================================
    // 2. SMB SHARING CENTER (+ Copy UNC + Browse Folder)
    // =========================================================================
    function renderSharing(state) {
        const tbody = byId("sharing-rows");
        tbody.replaceChildren();
        for (const s of state.shares) {
            const tr = document.createElement("tr");
            const acts = element("div", "panel-actions");
            if (s.uncPath) {
                acts.append(actionButton("📋 UNC", () => {
                    navigator.clipboard?.writeText(s.uncPath)
                        .then(() => { show("sharing-status", `Copied ${s.uncPath}`); toast(`Copied ${s.uncPath}`, "ok"); })
                        .catch(() => show("sharing-status", "Clipboard access is unavailable."));
                }));
            }
            if (s.path) {
                acts.append(actionButton("📂 Open", () => {
                    invoke("sharing_action", { action: { kind: "open_folder", path: s.path } })
                        .then(([, m]) => show("sharing-status", m))
                        .catch((e) => show("sharing-status", String(e)));
                }));
            }
            if (!s.isSpecial) {
                const rem = actionButton("Remove", async () => {
                    if (!(await confirmDashboardAction(`Remove Share '${s.name}'?`, "Stop sharing this folder over the network? Files on disk will not be deleted.", "Remove Share"))) return;
                    await withBusy("sharing-mut", rem, async () => {
                        try {
                            const [next, msg] = await invoke("sharing_action", { action: { kind: "remove", name: s.name } });
                            renderSharing(next);
                            show("sharing-status", msg);
                        } catch (err) { show("sharing-status", String(err)); }
                    });
                });
                rem.className = "console-clear-btn btn-danger";
                acts.append(rem);
            }
            const nameTd = document.createElement("td");
            nameTd.append(element("div", "", s.name));
            if (s.uncPath) nameTd.append(element("div", "mod-card-sub mod-mono", s.uncPath));
            tr.append(
                nameTd,
                (() => { const td = document.createElement("td"); td.append(pill(s.shareType, s.isSpecial ? "neutral" : "ok")); return td; })(),
                element("td", "mod-card-sub", s.path || "—"),
                element("td", "mod-card-sub", s.description || "—"),
                (() => { const td = document.createElement("td"); td.append(acts); return td; })()
            );
            tbody.append(tr);
        }
        show("sharing-status", `${state.shares.length} SMB share(s) · ${state.isAdmin ? "Administrator" : "Read-Only (Admin required to create/remove)"}.`);
    }

    async function loadSharing() {
        await withBusy("sharing-load", byId("sharing-refresh-btn"), async () => {
            show("sharing-status", "Loading Windows SMB shares…");
            try { renderSharing(await invoke("sharing_list")); }
            catch (err) { show("sharing-status", String(err)); }
        });
    }

    byId("sharing-refresh-btn")?.addEventListener("click", () => void loadSharing());
    byId("sharing-browse-path")?.addEventListener("click", (ev) => void withBusy("sharing-browse", ev.currentTarget, async () => {
        const input = byId("sharing-path-input");
        const picked = await invoke("pick_folder", { initial: input?.value || "" }).catch(() => null);
        if (picked && input) input.value = picked;
    }));
    byId("sharing-fsmgmt-btn")?.addEventListener("click", () => {
        invoke("sharing_action", { action: { kind: "open_fsmgmt" } })
            .then(([, m]) => show("sharing-status", m))
            .catch((e) => show("sharing-status", String(e)));
    });
    byId("sharing-add-form")?.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const f = ev.currentTarget;
        const submitBtn = f.querySelector('button[type="submit"]');
        await withBusy("sharing-mut", submitBtn, async () => {
            try {
                const [next, msg] = await invoke("sharing_action", {
                    action: { kind: "create", name: f.name.value, path: f.path.value, description: f.description.value, full_access: f.fullAccess.checked }
                });
                renderSharing(next);
                show("sharing-status", msg);
                f.reset();
            } catch (err) { show("sharing-status", String(err)); }
        });
    });

    // =========================================================================
    // 3. DEVICES & DRIVERS TREE (PnP Left-Join + Code 1..52 + Filters + Sort)
    // =========================================================================
    let devicesReport = null;
    let devFilter = "all";
    let devShowAll = false;
    const devSort = { key: "status", dir: 1 };

    function renderDevices() {
        if (!devicesReport) return;
        const kpi = byId("devices-kpi");
        if (kpi) {
            kpi.replaceChildren(
                kpiChip("Devices", devicesReport.total),
                kpiChip("Issues", devicesReport.problemCount, devicesReport.problemCount ? "crit" : "ok"),
                kpiChip("Aging (>3y)", devicesReport.outdatedCount, devicesReport.outdatedCount ? "warn" : "ok"),
                kpiChip("Disabled", devicesReport.disabledCount || 0)
            );
        }
        const tbody = byId("devices-rows");
        const q = (byId("devices-search")?.value || "").trim().toLowerCase();
        const cls = byId("devices-class-filter")?.value || "";
        const list = devicesReport.devices.filter((d) => {
            if (cls && d.class !== cls) return false;
            if (devFilter === "problems" && (d.errorCode === 0 || d.disabled)) return false;
            if (devFilter === "outdated" && !d.outdated) return false;
            if (devFilter === "disabled" && !d.disabled) return false;
            return !q || d.name.toLowerCase().includes(q) || d.manufacturer.toLowerCase().includes(q) || d.class.toLowerCase().includes(q) || (d.errorDetail || "").toLowerCase().includes(q);
        });
        list.sort((a, b) => {
            const d = devSort.dir;
            if (devSort.key === "class") return a.class.localeCompare(b.class) * d;
            if (devSort.key === "manufacturer") return a.manufacturer.localeCompare(b.manufacturer) * d;
            if (devSort.key === "version") return a.driverVersion.localeCompare(b.driverVersion) * d;
            if (devSort.key === "date") return a.driverDate.localeCompare(b.driverDate) * d;
            if (devSort.key === "status") return ((b.errorCode !== 0) - (a.errorCode !== 0)) * d || a.name.localeCompare(b.name);
            return a.name.localeCompare(b.name) * d;
        });
        const limit = devShowAll ? list.length : 300;
        tbody.replaceChildren();
        show("devices-status", `Showing ${Math.min(limit, list.length)} of ${list.length} matching (${devicesReport.total} total) PnP devices · ${devicesReport.problemCount} issue(s) · ${devicesReport.outdatedCount} aging (>3 yr).`);
        for (const d of list.slice(0, limit)) {
            const tr = document.createElement("tr");
            const tone = d.disabled ? "neutral" : d.errorCode !== 0 ? "crit" : d.outdated ? "warn" : "ok";
            const nameTd = document.createElement("td");
            nameTd.append(element("div", "", d.name));
            if (d.errorDetail) nameTd.append(element("div", "mod-card-sub", `⚠ ${d.errorDetail}`));
            const statusTd = document.createElement("td");
            const p = pill(d.status, tone);
            if (d.errorDetail) p.title = d.errorDetail;
            statusTd.append(p);
            tr.append(
                nameTd,
                element("td", "", d.class),
                element("td", "mod-card-sub", d.manufacturer),
                element("td", "mod-mono", d.driverVersion),
                element("td", "", d.driverDate + (d.ageYears != null ? ` (${d.ageYears}y)` : "")),
                statusTd
            );
            tbody.append(tr);
        }
        const moreWrap = byId("devices-show-all-wrap");
        if (moreWrap) {
            moreWrap.replaceChildren();
            moreWrap.hidden = list.length <= 300 || devShowAll;
            if (!moreWrap.hidden) {
                moreWrap.append(actionButton(`Show all ${list.length} devices`, () => {
                    devShowAll = true;
                    renderDevices();
                }));
            }
        }
    }

    async function loadDevices() {
        await withBusy("devices-load", byId("devices-refresh-btn"), async () => {
            show("devices-status", "Scanning Windows PnP devices & signed drivers…");
            try {
                devicesReport = await invoke("devices_scan");
                devShowAll = false;
                const sel = byId("devices-class-filter");
                const prevClass = sel.value;
                sel.replaceChildren(new Option("All Device Classes", ""));
                for (const c of devicesReport.classes) sel.append(new Option(c, c));
                if ([...sel.options].some((o) => o.value === prevClass)) sel.value = prevClass;
                renderDevices();
            } catch (err) { show("devices-status", String(err)); }
        });
    }

    wireSortHeaders("devices-table", devSort, renderDevices);
    for (const btn of document.querySelectorAll("[data-dev-filter]")) {
        btn.addEventListener("click", () => {
            devFilter = btn.dataset.devFilter;
            for (const b of document.querySelectorAll("[data-dev-filter]")) b.classList.toggle("active", b === btn);
            renderDevices();
        });
    }
    byId("devices-refresh-btn")?.addEventListener("click", () => void loadDevices());
    byId("devices-search")?.addEventListener("input", renderDevices);
    byId("devices-class-filter")?.addEventListener("change", renderDevices);
    byId("devices-devmgmt-btn")?.addEventListener("click", () => {
        invoke("devices_action", { action: { kind: "open_device_manager" } })
            .then((m) => show("devices-status", m))
            .catch((e) => show("devices-status", String(e)));
    });
    for (const btn of document.querySelectorAll("[data-driver-vendor]")) {
        btn.addEventListener("click", () => {
            invoke("devices_action", { action: { kind: "open_vendor", vendor: btn.dataset.driverVendor } })
                .then((m) => show("devices-status", m))
                .catch((e) => show("devices-status", String(e)));
        });
    }

    // =========================================================================
    // 4. FILE ORGANIZER (Known Folder Chips + Recursive + Skip Duplicates)
    // =========================================================================
    function renderOrganizer(state, moves = null) {
        const undoBtn = byId("org-undo-btn");
        if (undoBtn) {
            undoBtn.disabled = !state.canUndo;
            undoBtn.textContent = state.canUndo ? `↩️ Undo Last (${state.lastUndoCount})` : "↩️ Undo Last";
        }
        const chipsEl = byId("org-known-folders");
        if (chipsEl && Array.isArray(state.knownFolders)) {
            chipsEl.replaceChildren();
            for (const kf of state.knownFolders) {
                const btn = element("button", "mod-filter-pill", `📂 ${kf.label} (${kf.fileCount})`);
                btn.type = "button";
                btn.title = kf.path;
                btn.addEventListener("click", () => {
                    const src = byId("org-source-input");
                    if (src) src.value = kf.path;
                    show("org-status", `Selected source folder: ${kf.path}`);
                });
                chipsEl.append(btn);
            }
        }
        const tbody = byId("org-rules-rows");
        tbody.replaceChildren();
        for (const r of state.rules) {
            const tr = document.createElement("tr");
            const acts = element("div", "panel-actions");
            const togBtn = actionButton(r.enabled ? "Disable" : "Enable", () => void runOrganizer({ kind: "toggle_rule", id: r.id, enabled: !r.enabled }, togBtn));
            const delBtn = actionButton("Delete", async () => {
                if (!(await confirmDashboardAction(`Delete Rule '${r.name}'?`, "Remove this file organizer rule?", "Delete"))) return;
                await runOrganizer({ kind: "delete_rule", id: r.id }, delBtn);
            });
            delBtn.className = "console-clear-btn btn-danger";
            acts.append(togBtn, delBtn);
            tr.append(
                element("td", "", r.name),
                element("td", "", r.folder + "/"),
                element("td", "mod-card-sub", r.extensions.join(", ")),
                (() => { const td = document.createElement("td"); td.append(pill(r.enabled ? "ACTIVE" : "OFF", r.enabled ? "ok" : "neutral")); return td; })(),
                (() => { const td = document.createElement("td"); td.append(acts); return td; })()
            );
            tbody.append(tr);
        }
        if (moves !== null) {
            const pre = byId("org-preview-pre");
            const totalBytes = moves.reduce((acc, m) => acc + (m.bytes || 0), 0);
            pre.textContent = moves.length
                ? `Planned ${moves.length} file(s) · ${fmtBytes(totalBytes)}\n`
                    + moves.map((m) => `[${m.ruleName}]  ${m.fileName} (${fmtBytes(m.bytes || 0)})  →  ${m.to}`).join("\n")
                : "No files in the source folder matched the active rules.";
        }
    }

    async function runOrganizer(action, btn = null) {
        return withBusy("organizer", btn, async () => {
            try {
                const res = await invoke("organizer_action", { action });
                renderOrganizer(res.state, res.moves);
                show("org-status", res.message);
                return true;
            } catch (err) {
                show("org-status", String(err));
                toast(String(err), "crit");
                return false;
            }
        });
    }

    async function loadOrganizer() {
        try {
            const state = await invoke("organizer_state");
            const prefs = await invoke("dashboard_preferences").catch(() => null);
            const destInput = byId("org-dest-input");
            if (destInput && !destInput.value && prefs?.settings?.directories?.organizerDestRoot) {
                destInput.value = prefs.settings.directories.organizerDestRoot;
            }
            renderOrganizer(state);
        } catch (err) { show("org-status", String(err)); }
    }

    byId("org-preview-btn")?.addEventListener("click", (ev) => void runOrganizer({
        kind: "preview",
        source: byId("org-source-input").value,
        dest: byId("org-dest-input").value,
        recursive: Boolean(byId("org-recursive")?.checked)
    }, ev.currentTarget));
    byId("org-apply-btn")?.addEventListener("click", async (ev) => {
        const btn = ev.currentTarget;
        if (!(await confirmDashboardAction("Organize Files Now?", "Move matched files from the source folder into categorized destination subfolders? (1-click Undo is available afterward.)", "Organize"))) return;
        await runOrganizer({
            kind: "apply",
            source: byId("org-source-input").value,
            dest: byId("org-dest-input").value,
            recursive: Boolean(byId("org-recursive")?.checked),
            skip_duplicates: Boolean(byId("org-skip-dupes")?.checked)
        }, btn);
    });
    byId("org-undo-btn")?.addEventListener("click", (ev) => void runOrganizer({ kind: "undo_last" }, ev.currentTarget));
    byId("org-reset-btn")?.addEventListener("click", async (ev) => {
        const btn = ev.currentTarget;
        if (!(await confirmDashboardAction("Reset Organizer Rules?", "Restore default file categorization rules?", "Reset"))) return;
        await runOrganizer({ kind: "reset_defaults" }, btn);
    });
    for (const [btnId, inputId] of [["org-browse-src", "org-source-input"], ["org-browse-dst", "org-dest-input"]]) {
        byId(btnId)?.addEventListener("click", (ev) => void withBusy("org-browse", ev.currentTarget, async () => {
            const cur = byId(inputId)?.value || "";
            const picked = await invoke("pick_folder", { initial: cur }).catch(() => null);
            if (picked) byId(inputId).value = picked;
        }));
    }
    byId("org-add-rule-form")?.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const f = ev.currentTarget;
        const submitBtn = f.querySelector('button[type="submit"]');
        const ok = await runOrganizer({
            kind: "save_rule",
            rule: { id: "", name: f.name.value, folder: f.folder.value, extensions: f.extensions.value.split(",").map((s) => s.trim()).filter(Boolean), enabled: true }
        }, submitBtn);
        if (ok) f.reset();
    });

    // =========================================================================
    // 5. APP INSTALLER (57 Curated Apps + Instant Filter + Select Essentials)
    // =========================================================================
    const selectedPkgIds = new Set();
    let appCatalog = [];

    function updateBatchBtn() {
        const btn = byId("appstore-install-btn");
        if (btn) {
            btn.disabled = selectedPkgIds.size === 0 || busyKeys.has("appstore-install");
            btn.textContent = `⬇️ Install Selected (${selectedPkgIds.size})`;
        }
    }

    function renderCatalog() {
        const grid = byId("appstore-catalog-grid");
        const cat = byId("appstore-cat-filter")?.value || "";
        const q = (byId("appstore-local-filter")?.value || "").trim().toLowerCase();
        const matches = appCatalog.filter((a) =>
            (!cat || a.category === cat)
            && (!q || a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q) || a.id.toLowerCase().includes(q) || a.category.toLowerCase().includes(q))
        );
        grid.replaceChildren();
        for (const app of matches) {
            const card = element("label", "mod-card" + (selectedPkgIds.has(app.id) ? " is-active" : ""));
            card.style.cursor = "pointer";
            const head = element("div", "mod-card-head");
            const cb = document.createElement("input");
            cb.type = "checkbox";
            cb.checked = selectedPkgIds.has(app.id);
            cb.addEventListener("change", () => {
                if (cb.checked) selectedPkgIds.add(app.id);
                else selectedPkgIds.delete(app.id);
                card.classList.toggle("is-active", cb.checked);
                updateBatchBtn();
            });
            const right = element("span", "panel-actions");
            if (app.essential) right.append(pill("★", "ok"));
            right.append(pill(app.category, "neutral"), cb);
            head.append(element("strong", "", app.name), right);
            card.append(head, element("div", "mod-card-sub", app.description), element("div", "mod-card-sub mod-mono", app.id));
            grid.append(card);
        }
        show("appstore-status", `Showing ${matches.length} of ${appCatalog.length} curated WinGet packages · ${selectedPkgIds.size} selected.`);
        updateBatchBtn();
    }

    async function loadAppStore() {
        try {
            if (!appCatalog.length) {
                appCatalog = await invoke("app_installer_catalog");
                const sel = byId("appstore-cat-filter");
                sel.replaceChildren(new Option(`All Categories (${appCatalog.length})`, ""));
                const counts = new Map();
                for (const a of appCatalog) counts.set(a.category, (counts.get(a.category) || 0) + 1);
                for (const [c, n] of counts) sel.append(new Option(`${c} (${n})`, c));
            }
            renderCatalog();
        } catch (err) {
            show("appstore-status", String(err));
        }
    }

    byId("appstore-cat-filter")?.addEventListener("change", renderCatalog);
    byId("appstore-local-filter")?.addEventListener("input", renderCatalog);
    byId("appstore-essentials-btn")?.addEventListener("click", () => {
        for (const a of appCatalog) if (a.essential) selectedPkgIds.add(a.id);
        renderCatalog();
    });
    byId("appstore-clear-sel-btn")?.addEventListener("click", () => {
        selectedPkgIds.clear();
        renderCatalog();
    });
    byId("appstore-install-btn")?.addEventListener("click", (ev) => void withBusy("appstore-install", ev.currentTarget, async () => {
        const ids = [...selectedPkgIds];
        if (!ids.length) return;
        show("appstore-status", `Installing ${ids.length} package(s) via WinGet…`);
        try {
            const logOut = await invoke("app_installer_action", { action: { kind: "install_batch", ids } });
            byId("appstore-log-pre").textContent = logOut;
            show("appstore-status", "Batch install finished.");
            toast("WinGet batch install finished", "ok");
        } catch (err) {
            byId("appstore-log-pre").textContent = String(err);
            show("appstore-status", String(err));
        } finally {
            setTimeout(updateBatchBtn, 0);
        }
    }));

    byId("appstore-search-form")?.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const query = byId("appstore-search-input").value.trim();
        if (!query) return;
        const submitBtn = ev.currentTarget.querySelector('button[type="submit"]');
        await withBusy("appstore-search", submitBtn, async () => {
            show("appstore-status", `Searching WinGet for '${query}'…`);
            try {
                const results = await invoke("app_installer_action", { action: { kind: "search", query } });
                const wrap = byId("appstore-search-wrap");
                const tbody = byId("appstore-search-rows");
                tbody.replaceChildren();
                if (wrap) wrap.hidden = !results.length;
                for (const r of results) {
                    const tr = document.createElement("tr");
                    const inst = actionButton("Install", () => void withBusy("appstore-install", inst, async () => {
                        show("appstore-status", `Installing ${r.id}…`);
                        try {
                            const out = await invoke("app_installer_action", { action: { kind: "install_batch", ids: [r.id] } });
                            byId("appstore-log-pre").textContent = out;
                            show("appstore-status", `Finished ${r.id}.`);
                        } catch (err) {
                            byId("appstore-log-pre").textContent = String(err);
                            show("appstore-status", String(err));
                        } finally {
                            setTimeout(updateBatchBtn, 0);
                        }
                    }));
                    inst.className = "console-clear-btn btn-accent-action";
                    tr.append(element("td", "", r.name), element("td", "mod-card-sub mod-mono", r.id), element("td", "", r.version), (() => { const td = document.createElement("td"); td.append(inst); return td; })());
                    tbody.append(tr);
                }
                show("appstore-status", `Found ${results.length} WinGet package(s).`);
            } catch (err) { show("appstore-status", String(err)); }
        });
    });

    // =========================================================================
    // 6. GITHUB MANAGER (Parallel Scan + Ahead/Behind + Pull All + Filter)
    // =========================================================================
    let lastGitHubData = null;

    function renderGitHub() {
        if (!lastGitHubData) return;
        const data = lastGitHubData;
        const kpi = byId("github-kpi");
        if (kpi) {
            const dirtyCnt = data.repos.filter((r) => r.dirtyFiles > 0).length;
            const behindCnt = data.repos.filter((r) => r.behind > 0).length;
            const aheadCnt = data.repos.filter((r) => r.ahead > 0).length;
            kpi.replaceChildren(
                kpiChip("Repos", data.repos.length),
                kpiChip("Dirty", dirtyCnt, dirtyCnt ? "warn" : "ok"),
                kpiChip("Behind", behindCnt, behindCnt ? "warn" : "ok"),
                kpiChip("Ahead", aheadCnt)
            );
        }
        const q = (byId("github-search")?.value || "").trim().toLowerCase();
        const list = data.repos.filter((r) => !q || r.name.toLowerCase().includes(q) || r.branch.toLowerCase().includes(q) || (r.lastCommit || "").toLowerCase().includes(q));
        const grid = byId("github-repos-grid");
        grid.replaceChildren();
        if (!list.length) {
            grid.append(element("div", "mod-card", data.repos.length
                ? "No local Git repositories match your filter."
                : `No Git repositories found under ${data.projectsRoot}. Update Default Git / Projects root in Settings → Directories or clone one above.`));
        } else {
            for (const r of list) {
                const card = element("div", "mod-card");
                const head = element("div", "mod-card-head");
                const badges = element("span", "panel-actions");
                badges.append(pill(r.dirtyFiles ? `${r.branch} · ${r.dirtyFiles} dirty` : r.branch, r.dirtyFiles ? "warn" : "ok"));
                if (r.ahead) badges.append(pill(`↑${r.ahead}`, "neutral"));
                if (r.behind) badges.append(pill(`↓${r.behind}`, "warn"));
                head.append(element("strong", "", `🐙 ${r.name}`), badges);
                const acts = element("div", "panel-actions");
                const ed = actionButton("Editor", () => {
                    invoke("github_action", { action: { kind: "open_editor", path: r.path } }).then((m) => show("github-status", m)).catch((e) => show("github-status", String(e)));
                });
                ed.className = "console-clear-btn btn-accent-action";
                const pullBtn = actionButton("Pull", () => void withBusy("github-mut", pullBtn, async () => {
                    show("github-status", `Pulling ${r.name}…`);
                    let errMsg = null;
                    try {
                        byId("github-output-pre").textContent = await invoke("github_action", { action: { kind: "git_pull", path: r.path } });
                    } catch (e) {
                        errMsg = String(e);
                        byId("github-output-pre").textContent = errMsg;
                    }
                    await loadGitHub();
                    if (errMsg) show("github-status", errMsg);
                }));
                const openBtn = actionButton("📂", () => {
                    invoke("github_action", { action: { kind: "open_folder", path: r.path } }).catch((e) => show("github-status", String(e)));
                });
                openBtn.title = "Open repository folder";
                openBtn.setAttribute("aria-label", `Open folder for ${r.name}`);
                acts.append(
                    ed,
                    actionButton("Terminal", () => {
                        invoke("github_action", { action: { kind: "open_terminal", path: r.path } }).then((m) => show("github-status", m)).catch((e) => show("github-status", String(e)));
                    }),
                    pullBtn,
                    openBtn
                );
                if (r.remoteUrl) {
                    acts.append(actionButton("GitHub", () => {
                        invoke("github_action", { action: { kind: "open_remote", url: r.remoteUrl } }).catch((e) => show("github-status", String(e)));
                    }));
                }
                card.append(
                    head,
                    element("div", "mod-card-sub", r.lastCommit ? `Commit: ${r.lastCommit}` : r.path),
                    element("div", "mod-card-sub mod-mono", r.path),
                    acts
                );
                grid.append(card);
            }
        }
        show("github-status", `${list.length} of ${data.repos.length} local Git repo(s) in ${data.projectsRoot}.`);
    }

    async function loadGitHub() {
        await withBusy("github-load", byId("github-refresh-btn"), async () => {
            show("github-status", "Scanning configured Projects folder in parallel…");
            try {
                lastGitHubData = await invoke("github_state");
                renderGitHub();
            } catch (err) { show("github-status", String(err)); }
        });
    }

    byId("github-search")?.addEventListener("input", renderGitHub);
    byId("github-refresh-btn")?.addEventListener("click", () => void loadGitHub());
    byId("github-pull-all-btn")?.addEventListener("click", (ev) => void withBusy("github-mut", ev.currentTarget, async () => {
        show("github-status", "Running parallel git pull --ff-only across all local repos…");
        try {
            const out = await invoke("github_action", { action: { kind: "pull_all" } });
            byId("github-output-pre").textContent = out;
            await loadGitHub();
            toast("Pull All complete", "ok");
        } catch (err) {
            byId("github-output-pre").textContent = String(err);
            show("github-status", String(err));
        }
    }));
    byId("github-clone-form")?.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const url = byId("github-clone-url").value.trim();
        if (!url) return;
        const submitBtn = ev.currentTarget.querySelector('button[type="submit"]');
        await withBusy("github-mut", submitBtn, async () => {
            show("github-status", `Cloning ${url}…`);
            try {
                const msg = await invoke("github_action", { action: { kind: "clone", url } });
                byId("github-clone-url").value = "";
                byId("github-output-pre").textContent = msg;
                await loadGitHub();
            } catch (err) {
                byId("github-output-pre").textContent = String(err);
                show("github-status", String(err));
            }
        });
    });
    byId("github-releases-btn")?.addEventListener("click", async (ev) => {
        const btn = ev.currentTarget;
        const slug = await askDashboard("Inspect GitHub Releases", "Enter owner/repo:", { label: "Repository", value: "jonathan820612/CoreWatch-Host-Engine" });
        if (!slug) return;
        await withBusy("github-releases", btn, async () => {
            show("github-status", `Fetching releases for ${slug}…`);
            try {
                byId("github-output-pre").textContent = await invoke("github_action", { action: { kind: "fetch_releases", owner_repo: slug } });
                show("github-status", `Loaded releases for ${slug}.`);
            } catch (err) { show("github-status", String(err)); }
        });
    });

    // =========================================================================
    // 7. JIRA MANAGER (JQL Presets + Issue Detail Inspector + Live Transitions)
    // =========================================================================
    let jiraIssues = [];
    let jiraConfigDirty = false;
    const jiraForm = byId("jira-config-form");
    jiraForm?.addEventListener("input", () => { jiraConfigDirty = true; });

    function renderJiraDetail(detail) {
        const panel = byId("jira-detail-panel");
        if (!panel) return;
        if (!detail) {
            panel.hidden = true;
            panel.replaceChildren();
            return;
        }
        panel.hidden = false;
        panel.replaceChildren();
        const head = element("div", "mod-card-head");
        const closeBtn = actionButton("✕ Close", () => renderJiraDetail(null));
        head.append(element("strong", "", `${detail.key} — ${detail.summary}`), closeBtn);

        const meta = element("div", "mod-kpi-strip");
        meta.append(
            kpiChip("Status", detail.status, detail.status.toLowerCase().includes("done") ? "ok" : "warn"),
            kpiChip("Priority", detail.priority || "—"),
            kpiChip("Assignee", detail.assignee || "Unassigned"),
            kpiChip("Reporter", detail.reporter || "—")
        );
        if (detail.labels?.length) meta.append(kpiChip("Labels", detail.labels.join(", ")));

        const transRow = element("div", "mod-toolbar");
        if (detail.transitions?.length) {
            transRow.append(element("span", "mod-card-sub", "Move to:"));
            for (const tr of detail.transitions) {
                const tBtn = actionButton(tr.name, () => void withBusy("jira", tBtn, async () => {
                    show("jira-status", `Transitioning ${detail.key} → ${tr.name}…`);
                    try {
                        const r = await invoke("jira_action", { action: { kind: "transition_issue", key: detail.key, transition_id: tr.id } });
                        show("jira-status", r.message);
                        toast(r.message, "ok");
                        const refreshed = await invoke("jira_action", { action: { kind: "get_issue_detail", key: detail.key } });
                        if (refreshed.detail) renderJiraDetail(refreshed.detail);
                    } catch (e) { show("jira-status", String(e)); }
                }));
                tBtn.className = "console-clear-btn btn-accent-action";
                transRow.append(tBtn);
            }
        }

        panel.append(head, meta, transRow, element("div", "jira-detail-desc", detail.description || "(No description)"));

        if (detail.comments?.length) {
            panel.append(element("h4", "mod-subhead", `COMMENTS (${detail.comments.length})`));
            for (const c of detail.comments) {
                const item = element("div", "jira-comment-item");
                item.append(element("div", "mod-card-sub", `${c.author} · ${c.created}`), element("div", "", c.body));
                panel.append(item);
            }
        }
    }

    function renderJira(resp, updateFormFields = true) {
        if (jiraForm && resp.config && updateFormFields) {
            jiraForm.baseUrl.value = resp.config.baseUrl || "";
            jiraForm.email.value = resp.config.email || "";
            jiraForm.jql.value = resp.config.jql || "";
            jiraForm.apiToken.placeholder = resp.config.hasToken ? "•••••••• (DPAPI encrypted — leave blank to keep)" : "Atlassian API Token / PAT";
            jiraConfigDirty = false;
        }
        const tbody = byId("jira-rows");
        if (!tbody) return;
        tbody.replaceChildren();
        const issues = resp.issues ?? jiraIssues;
        if (!issues.length) {
            const tr = document.createElement("tr");
            const td = element("td", "mod-card-sub", resp.config?.hasToken ? "Click Fetch Issues to query Jira." : "Enter your Jira site URL, email, and API token above to connect.");
            td.colSpan = 7;
            tr.append(td);
            tbody.append(tr);
            return;
        }
        for (const issue of issues) {
            const tr = document.createElement("tr");
            const acts = element("div", "panel-actions");
            const inspectBtn = actionButton("Inspect", () => void withBusy("jira", inspectBtn, async () => {
                show("jira-status", `Loading ${issue.key} details & transitions…`);
                try {
                    const r = await invoke("jira_action", { action: { kind: "get_issue_detail", key: issue.key } });
                    renderJiraDetail(r.detail || null);
                    show("jira-status", r.message);
                } catch (e) { show("jira-status", String(e)); }
            }));
            inspectBtn.className = "console-clear-btn btn-accent-action";
            const commentBtn = actionButton("Comment", async () => {
                const body = await askDashboard(`Comment on ${issue.key}`, issue.summary, { label: "Comment", value: "" });
                if (!body) return;
                await withBusy("jira-comment", commentBtn, async () => {
                    try {
                        const r = await invoke("jira_action", { action: { kind: "add_comment", key: issue.key, body } });
                        show("jira-status", r.message);
                        toast(r.message, "ok");
                    } catch (e) { show("jira-status", String(e)); }
                });
            });
            acts.append(
                inspectBtn,
                actionButton("Open", () => {
                    invoke("jira_action", { action: { kind: "open_issue", key: issue.key } }).catch((e) => show("jira-status", String(e)));
                }),
                commentBtn
            );
            tr.append(
                element("td", "mod-mono", issue.key),
                element("td", "", issue.summary),
                (() => { const td = document.createElement("td"); td.append(pill(issue.status, issue.status.toLowerCase().includes("done") ? "ok" : "warn")); return td; })(),
                element("td", "", issue.priority),
                element("td", "mod-card-sub", issue.assignee || "—"),
                element("td", "", issue.updated),
                (() => { const td = document.createElement("td"); td.append(acts); return td; })()
            );
            tbody.append(tr);
        }
    }

    async function loadJira() {
        try {
            const config = await invoke("jira_config");
            renderJira({ config, issues: jiraIssues }, !jiraConfigDirty);
            show("jira-status", config.hasToken
                ? (jiraIssues.length ? `${jiraIssues.length} issue(s) loaded from ${config.baseUrl}` : `Connected to ${config.baseUrl}`)
                : "Configure Jira Cloud or Data Center credentials above.");
        } catch (err) { show("jira-status", String(err)); }
    }

    for (const btn of document.querySelectorAll("[data-jql]")) {
        btn.addEventListener("click", () => {
            if (jiraForm?.jql) jiraForm.jql.value = btn.dataset.jql;
            byId("jira-fetch-btn")?.click();
        });
    }
    jiraForm?.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const f = ev.currentTarget;
        const submitBtn = f.querySelector('button[type="submit"]');
        await withBusy("jira", submitBtn, async () => {
            try {
                const resp = await invoke("jira_action", {
                    action: { kind: "save_config", base_url: f.baseUrl.value, email: f.email.value, api_token: f.apiToken.value, jql: f.jql.value }
                });
                f.apiToken.value = "";
                renderJira({ config: resp.config, issues: jiraIssues }, true);
                show("jira-status", resp.message);
                toast("Jira connection saved (DPAPI)", "ok");
            } catch (err) { show("jira-status", String(err)); }
        });
    });

    byId("jira-fetch-btn")?.addEventListener("click", (ev) => void withBusy("jira", ev.currentTarget, async () => {
        show("jira-status", "Fetching Jira issues…");
        try {
            const resp = await invoke("jira_action", { action: { kind: "fetch_issues", jql: jiraForm?.jql?.value || null } });
            jiraIssues = resp.issues || [];
            renderJira(resp, !jiraConfigDirty);
            show("jira-status", resp.message);
        } catch (err) { show("jira-status", String(err)); }
    }));

    byId("jira-clear-btn")?.addEventListener("click", async (ev) => {
        const btn = ev.currentTarget;
        if (!(await confirmDashboardAction("Sign Out of Jira?", "Clear saved Jira site URL, email, and DPAPI-encrypted API token?", "Sign Out"))) return;
        await withBusy("jira", btn, async () => {
            try {
                const resp = await invoke("jira_action", { action: { kind: "clear_config" } });
                jiraIssues = [];
                renderJiraDetail(null);
                renderJira(resp, true);
                show("jira-status", resp.message);
            } catch (err) { show("jira-status", String(err)); }
        });
    });

    const loaders = {
        wsl: loadWsl,
        sharing: loadSharing,
        devices: loadDevices,
        organizer: loadOrganizer,
        appstore: loadAppStore,
        github: loadGitHub,
        jira: loadJira
    };

    return {
        async show(viewName) {
            const fn = loaders[viewName];
            if (fn) await fn();
        },
        leave(viewName) {
            if (viewName === "devices") {
                devicesReport = null;
                byId("devices-rows")?.replaceChildren();
            } else if (viewName === "github") {
                lastGitHubData = null;
            } else if (viewName === "jira") {
                jiraIssues = [];
                renderJiraDetail(null);
                byId("jira-rows")?.replaceChildren();
            } else if (viewName === "appstore") {
                byId("appstore-search-rows")?.replaceChildren();
            }
        }
    };
}
