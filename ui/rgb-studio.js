"use strict";

function createRgbStudio(invoke) {
    let state = null;
    let loaded = false;
    let busy = false;
    let effectTimer = null;
    let dirtyControls = false;
    let refreshSeq = 0;
    let pendingCoalesced = null;
    const actionQueue = [];

    // Cached DOM bindings to patch in-place without destroying open <select>/<input> or focus
    let effectsBuilt = false;
    const effectButtons = new Map();
    let presetsKey = "";
    let bindingsKey = "";
    let devicesKey = "";
    const deviceCards = new Map();
    const savedZones = new Map();

    const effectsMeta = [
        ["static", "🎯 Static"],
        ["breathing", "💨 Breathing"],
        ["rainbow", "🌈 Rainbow Wave"],
        ["dual_pulse", "✨ Dual Pulse"],
        ["thermal_cpu", "🌡️ Thermal CPU"],
        ["thermal_gpu", "🔥 Thermal GPU"],
        ["theme_sync", "🎨 Theme Sync"],
        ["blackout", "⬛ Blackout"]
    ];

    const quickSwatches = [
        ["#00b4ff", "Cyber Blue"],
        ["#3182ce", "CoreWatch Blue"],
        ["#c026d3", "Neon Magenta"],
        ["#9f7aea", "Ultraviolet"],
        ["#10b981", "Emerald"],
        ["#22d3ee", "Ice Cyan"],
        ["#ff9b3d", "Warm Amber"],
        ["#f43f5e", "Crimson"],
        ["#ffffff", "Pure White"],
        ["#000000", "Blackout"]
    ];

    const profileModes = [
        ["normal", "🖥️ Normal"],
        ["work", "💼 Work / Focus"],
        ["gaming", "🎮 Gaming"],
        ["streaming", "🎥 Streaming"],
        ["night", "🌙 Night"]
    ];

    function currentThemeAccent() {
        const val = getComputedStyle(document.documentElement).getPropertyValue("--cw-accent").trim();
        return /^#[0-9a-f]{6}$/i.test(val) ? val : "#3182ce";
    }

    function setToolbarBusy(isBusy) {
        for (const id of ["rgb-rescan-btn", "rgb-blackout-btn", "rgb-connect-btn", "rgb-launch-openrgb-btn", "rgb-save-preset-btn"]) {
            const btn = byId(id);
            if (btn) btn.disabled = isBusy;
        }
    }

    async function executeOne(action, quiet) {
        const seq = ++refreshSeq;
        try {
            const next = await invoke("rgb_action", { action });
            if (seq >= refreshSeq) {
                state = next;
                loaded = true;
                if (!pendingCoalesced) dirtyControls = false;
                render();
            }
            if (!quiet && next?.message) log("RGB Studio: " + next.message);
            return true;
        } catch (err) {
            show("rgb-status", String(err));
            log("RGB Studio: " + String(err));
            return false;
        }
    }

    async function drainQueue() {
        if (busy) return;
        busy = true;
        setToolbarBusy(true);
        try {
            while (actionQueue.length || pendingCoalesced) {
                if (actionQueue.length) {
                    const job = actionQueue.shift();
                    const ok = await executeOne(job.action, job.quiet);
                    job.resolve(ok);
                } else if (pendingCoalesced) {
                    const job = pendingCoalesced;
                    pendingCoalesced = null;
                    const ok = await executeOne(job.action, job.quiet);
                    job.resolve(ok);
                }
            }
        } finally {
            busy = false;
            dirtyControls = false;
            setToolbarBusy(false);
        }
    }

    function run(action, quiet = false, coalesce = false) {
        return new Promise((resolve) => {
            if (coalesce) {
                if (pendingCoalesced) pendingCoalesced.resolve(false);
                pendingCoalesced = { action, quiet, resolve };
            } else {
                // Discrete user actions like Blackout supersede stale slider ticks
                if (action.kind === "blackout" || action.kind === "apply_preset") {
                    clearTimeout(effectTimer);
                    if (pendingCoalesced) {
                        pendingCoalesced.resolve(false);
                        pendingCoalesced = null;
                    }
                    dirtyControls = false;
                }
                actionQueue.push({ action, quiet, resolve });
            }
            void drainQueue();
        });
    }

    async function refreshState(silent = false) {
        const seq = ++refreshSeq;
        try {
            const next = await invoke("rgb_state");
            if (seq !== refreshSeq) return;
            state = next;
            loaded = true;
            render();
        } catch (err) {
            if (!silent) show("rgb-status", String(err));
        }
    }

    function applyCurrentControls(overrideEffect) {
        const effect = overrideEffect ?? state?.config?.effect ?? "static";
        const primaryHex = byId("rgb-primary-color")?.value || "#3182ce";
        const secondaryHex = byId("rgb-secondary-color")?.value || "#9f7aea";
        const brightness = Number(byId("rgb-brightness")?.value ?? 85);
        const speed = Number(byId("rgb-speed")?.value ?? 45);
        void run({
            kind: "apply_effect",
            effect,
            primary_hex: primaryHex,
            secondary_hex: secondaryHex,
            brightness,
            speed
        }, true, true);
    }

    function scheduleControlsApply() {
        dirtyControls = true;
        clearTimeout(effectTimer);
        effectTimer = setTimeout(() => applyCurrentControls(), 120);
    }

    function renderEffects(cfg) {
        const effWrap = byId("rgb-effects-grid");
        if (!effWrap) return;
        if (!effectsBuilt) {
            effWrap.replaceChildren();
            effectButtons.clear();
            for (const [id, label] of effectsMeta) {
                const btn = element("button", "rgb-effect-btn", label);
                btn.type = "button";
                btn.dataset.rgbEffect = id;
                btn.addEventListener("click", () => {
                    if (id === "blackout") {
                        void run({ kind: "blackout" });
                    } else if (id === "theme_sync") {
                        void run({ kind: "sync_theme_accent", accent_hex: currentThemeAccent() });
                    } else {
                        applyCurrentControls(id);
                    }
                });
                effWrap.append(btn);
                effectButtons.set(id, btn);
            }
            effectsBuilt = true;
        }
        for (const [id, btn] of effectButtons) {
            const active = cfg.effect === id;
            btn.classList.toggle("active", active);
            btn.setAttribute("aria-pressed", String(active));
        }
    }

    function renderPresets() {
        const presetsWrap = byId("rgb-presets-list");
        if (!presetsWrap) return;
        const nextKey = state.presets.map((p) => `${p.id}:${p.name}:${p.effect}:${p.primaryHex}:${p.builtin}`).join("|");
        if (nextKey === presetsKey) return;
        presetsKey = nextKey;
        presetsWrap.replaceChildren();
        for (const preset of state.presets) {
            const chip = element("span", "rgb-preset-chip");
            const applyBtn = document.createElement("button");
            applyBtn.type = "button";
            const dot = element("span", "rgb-preset-dot");
            dot.style.background = preset.effect === "rainbow"
                ? "conic-gradient(#ff0080, #ff8c00, #10b981, #00b4ff, #9f7aea, #ff0080)"
                : preset.primaryHex;
            applyBtn.append(dot, document.createTextNode(preset.name));
            applyBtn.addEventListener("click", () => void run({ kind: "apply_preset", id: preset.id }));
            chip.append(applyBtn);
            if (!preset.builtin) {
                const delBtn = element("button", "rgb-preset-del", "×");
                delBtn.type = "button";
                delBtn.title = `Delete preset ${preset.name}`;
                delBtn.setAttribute("aria-label", `Delete preset ${preset.name}`);
                delBtn.addEventListener("click", async () => {
                    if (!(await confirmDashboardAction(`Delete RGB Preset '${preset.name}'?`, "Remove this saved custom lighting preset?", "Delete"))) return;
                    void run({ kind: "delete_preset", id: preset.id });
                });
                chip.append(delBtn);
            }
            presetsWrap.append(chip);
        }
    }

    let dynamicModes = [...profileModes];
    async function refreshProfileModes() {
        try {
            const pState = await invoke("profiles_state");
            if (pState?.profiles?.length) {
                dynamicModes = pState.profiles.map((p) => [p.id, `${p.icon} ${p.name}`]);
            }
        } catch { /* fallback to built-in profileModes */ }
    }

    function renderBindings(cfg) {
        const syncToggle = byId("rgb-profile-sync-toggle");
        if (syncToggle) syncToggle.checked = Boolean(cfg.autoSyncProfiles);
        const bindingsGrid = byId("rgb-profile-bindings");
        if (!bindingsGrid) return;
        const nextKey = state.presets.map((p) => `${p.id}:${p.name}`).join("|")
            + "||" + dynamicModes.map(([m, lbl]) => `${m}:${lbl}=${cfg.profileBindings?.[m] || ""}`).join(",");
        if (nextKey === bindingsKey) return;
        bindingsKey = nextKey;
        bindingsGrid.replaceChildren();
        for (const [modeId, modeLabel] of dynamicModes) {
            const lbl = document.createElement("label");
            lbl.append(document.createTextNode(modeLabel));
            const sel = element("select", "tab-sort-select");
            sel.append(new Option("(No change)", ""));
            for (const p of state.presets) {
                sel.append(new Option(p.name, p.id, false, cfg.profileBindings?.[modeId] === p.id));
            }
            sel.addEventListener("change", () => {
                const nextBindings = { ...(state?.config?.profileBindings || {}) };
                if (sel.value) nextBindings[modeId] = sel.value;
                else delete nextBindings[modeId];
                void run({ kind: "set_profile_sync", enabled: Boolean(syncToggle?.checked), bindings: nextBindings }, true);
            });
            lbl.append(sel);
            bindingsGrid.append(lbl);
        }
    }

    function renderDevices(cfg) {
        const devContainer = byId("rgb-devices-container");
        const countBadge = byId("rgb-device-count");
        if (countBadge) countBadge.textContent = `${state.devices.length} device(s)`;
        if (!devContainer) return;

        const nextKey = state.devices.map((d) =>
            `${d.id}:${d.backend}:${d.name}:${d.ledCount}:${d.modes.length}:${d.zones.length}`
        ).join("|");

        if (!state.devices.length) {
            if (devicesKey === "__empty__") return;
            devicesKey = "__empty__";
            deviceCards.clear();
            devContainer.replaceChildren();
            const guide = element("div", "rgb-empty-guide");
            guide.append(
                element("strong", "", "No RGB controllers detected yet"),
                element("div", "", "RustCoreWatch scans hardware natively without OpenRGB across 4 built-in drivers:"),
                element("div", "", "• Native USB HID: Gigabyte RGB Fusion 2.0 motherboards & ARGB headers (IT5702/IT8297/IT5711), Razer Chroma keyboards & mice."),
                element("div", "", "• Native GPU NVAPI: ASUS TUF/ROG NVIDIA GPUs (ENE Aura I2C via nvapi64.dll)."),
                element("div", "", "• Native RAM SMBus (PawnIO): Corsair Vengeance/Dominator & G.Skill/ENE RGB RAM (requires Administrator + PawnIO)."),
                element("div", "", "• Windows 11 Dynamic Lighting: Native HID LampArray peripherals."),
                (() => {
                    const actions = element("div", "panel-actions");
                    const rescanBtn = actionButton("↻ Rescan Hardware", () => void run({ kind: "rescan" }));
                    rescanBtn.className = "console-clear-btn btn-accent-action";
                    const winBtn = actionButton("⚙️ Win11 Dynamic Lighting Settings", () => void run({ kind: "open_dynamic_lighting_settings" }));
                    winBtn.className = "console-clear-btn";
                    actions.append(rescanBtn, winBtn);
                    return actions;
                })()
            );
            devContainer.append(guide);
            return;
        }

        if (nextKey !== devicesKey) {
            devicesKey = nextKey;
            deviceCards.clear();
            devContainer.replaceChildren();
            const backendMeta = {
                direct_hid: ["Native USB HID", "diag-ok"],
                direct_nvapi: ["Native GPU NVAPI", "diag-ok"],
                direct_smbus: ["Native RAM SMBus", "diag-ok"],
                windows_lamp_array: ["Win11 LampArray", "diag-neutral"],
                open_rgb: ["OpenRGB Bridge", "diag-neutral"]
            };
            const grid = element("div", "rgb-devices-grid");
            for (const dev of state.devices) {
                const card = element("div", "rgb-device-card");
                const head = element("div", "mod-card-head");
                const [bLabel, bTone] = backendMeta[dev.backend] || ["Native", "diag-ok"];
                head.append(
                    element("strong", "", `${dev.icon} ${dev.name}`),
                    element("span", `diag-pill ${bTone}`, bLabel)
                );
                const sub = element("div", "mod-card-sub");
                const glow = element("div", "rgb-device-glow");
                const controls = element("div", "rgb-device-controls");

                let modeSel = null;
                if (dev.modes.length > 1) {
                    modeSel = element("select", "tab-sort-select");
                    modeSel.title = "Hardware Mode";
                    modeSel.setAttribute("aria-label", `${dev.name} mode`);
                    for (const m of dev.modes) {
                        modeSel.append(new Option(m.name, String(m.index), false, m.index === dev.activeModeIndex));
                    }
                    modeSel.addEventListener("change", () => void run({
                        kind: "set_device_mode",
                        device_id: dev.id,
                        mode_index: Number(modeSel.value)
                    }));
                    controls.append(modeSel);
                }

                const zoneSel = element("select", "tab-sort-select");
                zoneSel.title = "Target Zone";
                zoneSel.setAttribute("aria-label", `${dev.name} zone`);
                zoneSel.append(new Option("All Zones", ""));
                for (const z of dev.zones) {
                    zoneSel.append(new Option(`${z.name} (${z.ledCount})`, String(z.index)));
                }
                if (savedZones.has(dev.id)) zoneSel.value = savedZones.get(dev.id);
                zoneSel.addEventListener("change", () => savedZones.set(dev.id, zoneSel.value));

                const colorInput = document.createElement("input");
                colorInput.type = "color";
                colorInput.value = /^#[0-9a-f]{6}$/i.test(dev.previewHex) ? dev.previewHex : cfg.primaryHex;
                colorInput.title = "Pick color for this device/zone";
                colorInput.setAttribute("aria-label", `${dev.name} color`);

                const setBtn = actionButton("Apply", () => void run({
                    kind: "set_device_color",
                    device_id: dev.id,
                    zone_index: zoneSel.value === "" ? null : Number(zoneSel.value),
                    color_hex: colorInput.value
                }));
                setBtn.className = "console-clear-btn";

                const pinBtn = actionButton("🔗 Synced", () => {
                    const isPinned = (state?.config?.pinnedDevices || []).includes(dev.id);
                    void run({ kind: "set_device_pinned", device_id: dev.id, pinned: !isPinned });
                });
                pinBtn.className = "console-clear-btn";
                controls.append(zoneSel, colorInput, setBtn, pinBtn);
                card.append(head, sub, glow, controls);
                grid.append(card);
                deviceCards.set(dev.id, { card, sub, glow, modeSel, colorInput, pinBtn });
            }
            devContainer.append(grid);
        }

        const pinnedSet = new Set(cfg.pinnedDevices || []);
        // Patch live fields in-place so open dropdowns/pickers stay intact
        for (const dev of state.devices) {
            const refs = deviceCards.get(dev.id);
            if (!refs) continue;
            const pinned = pinnedSet.has(dev.id);
            refs.sub.textContent = [dev.deviceType, dev.description || dev.vendor, `${dev.ledCount} LEDs`].filter(Boolean).join(" · ");
            refs.glow.style.backgroundColor = dev.previewHex || "#3182ce";
            if (refs.pinBtn) {
                refs.pinBtn.textContent = pinned ? "📌 Pinned" : "🔗 Synced";
                refs.pinBtn.classList.toggle("btn-accent-action", pinned);
                refs.pinBtn.title = pinned
                    ? "Pinned to independent manual lighting — click to sync back with Master Effect"
                    : "Synced with Master Effect — click to pin independently";
            }
            if (refs.modeSel && document.activeElement !== refs.modeSel) {
                refs.modeSel.value = String(dev.activeModeIndex);
            }
            if (refs.colorInput && document.activeElement !== refs.colorInput && /^#[0-9a-f]{6}$/i.test(dev.previewHex)) {
                refs.colorInput.value = dev.previewHex;
            }
        }
    }

    function render() {
        if (!state) return;
        const cfg = state.config;
        show("rgb-status", state.message);

        const hidPill = byId("rgb-hid-pill");
        if (hidPill) {
            hidPill.textContent = `USB HID · ${state.directHidCount ?? 0}`;
            hidPill.className = "diag-pill " + ((state.directHidCount ?? 0) > 0 ? "diag-ok" : "diag-neutral");
            hidPill.title = state.directHidStatus || "Native Win32 USB HID RGB backend";
        }
        const nvapiPill = byId("rgb-nvapi-pill");
        if (nvapiPill) {
            nvapiPill.textContent = `GPU NVAPI · ${state.directNvapiCount ?? 0}`;
            nvapiPill.className = "diag-pill " + ((state.directNvapiCount ?? 0) > 0 ? "diag-ok" : "diag-neutral");
            nvapiPill.title = state.directNvapiStatus || "Native NVIDIA NVAPI I2C GPU RGB backend";
        }
        const smbusPill = byId("rgb-smbus-pill");
        if (smbusPill) {
            const cnt = state.directSmbusCount ?? 0;
            smbusPill.textContent = state.smbusNeedsAdmin ? "RAM · Admin Needed" : `RAM SMBus · ${cnt}`;
            smbusPill.className = "diag-pill " + (cnt > 0 ? "diag-ok" : state.smbusNeedsAdmin ? "diag-warn" : "diag-neutral");
            smbusPill.title = state.directSmbusStatus || "Native PawnIO SMBus DRAM RGB backend";
        }
        const adminBanner = byId("rgb-admin-banner");
        if (adminBanner) adminBanner.hidden = !state.smbusNeedsAdmin;

        const win11Pill = byId("rgb-win11-pill");
        if (win11Pill) {
            win11Pill.textContent = `Win11 HID · ${state.win11LampCount}`;
            win11Pill.className = "diag-pill " + (state.win11LampCount > 0 ? "diag-ok" : "diag-neutral");
            win11Pill.title = state.win11Status;
        }
        const orgbPill = byId("rgb-openrgb-pill");
        if (orgbPill) {
            orgbPill.textContent = state.openrgbConnected
                ? `v${state.openrgbProtocol} · Connected`
                : "Offline";
            orgbPill.className = "diag-pill " + (state.openrgbConnected ? "diag-ok" : "diag-neutral");
            orgbPill.title = state.openrgbError || "Optional OpenRGB SDK TCP bridge";
        }
        const summary = byId("rgb-backend-summary");
        if (summary) {
            summary.textContent = `Standalone Native Engine · ${state.devices.length} RGB controller(s) active (zero OpenRGB required)`;
        }

        const hostInput = byId("rgb-host-input");
        const portInput = byId("rgb-port-input");
        if (hostInput && document.activeElement !== hostInput) hostInput.value = cfg.host;
        if (portInput && document.activeElement !== portInput) portInput.value = String(cfg.port);
        const connectBtn = byId("rgb-connect-btn");
        if (connectBtn) connectBtn.textContent = state.openrgbConnected ? "Disconnect" : "🔌 Connect";
        const launchBtn = byId("rgb-launch-openrgb-btn");
        if (launchBtn) {
            launchBtn.hidden = state.openrgbConnected;
            launchBtn.title = state.openrgbExePath
                ? `Launch ${state.openrgbExePath} in headless SDK mode`
                : "Detect and launch OpenRGB with --server --startminimized";
        }

        const strip = byId("rgb-live-strip");
        if (strip) {
            const hex = state.liveColorHex || cfg.primaryHex;
            strip.style.background = cfg.effect === "rainbow"
                ? "linear-gradient(90deg, #ff0080, #ff8c00, #ffd700, #10b981, #00b4ff, #9f7aea)"
                : cfg.effect === "thermal_cpu" || cfg.effect === "thermal_gpu"
                ? `linear-gradient(90deg, #00b4ff, ${hex})`
                : cfg.effect === "dual_pulse"
                ? `linear-gradient(90deg, ${cfg.primaryHex}, ${cfg.secondaryHex})`
                : hex;
            strip.style.boxShadow = cfg.effect === "blackout" ? "none" : `0 0 12px ${hex}66`;
        }

        if (!dirtyControls) {
            const primaryEl = byId("rgb-primary-color");
            const secondaryEl = byId("rgb-secondary-color");
            if (primaryEl && document.activeElement !== primaryEl) primaryEl.value = cfg.primaryHex;
            if (secondaryEl && document.activeElement !== secondaryEl) secondaryEl.value = cfg.secondaryHex;
            show("rgb-primary-hex", cfg.primaryHex.toUpperCase());
            show("rgb-secondary-hex", cfg.secondaryHex.toUpperCase());

            const brightEl = byId("rgb-brightness");
            const speedEl = byId("rgb-speed");
            if (brightEl && document.activeElement !== brightEl) brightEl.value = String(cfg.brightness);
            if (speedEl && document.activeElement !== speedEl) speedEl.value = String(cfg.speed);
            show("rgb-brightness-val", cfg.brightness + "%");
            show("rgb-speed-val", cfg.speed + "%");
        }

        updateThermalReadout(state.liveCpuTemp, state.liveGpuTemp);
        const diagPre = byId("rgb-diag-pre");
        if (diagPre && state.diagnosticJson) diagPre.textContent = state.diagnosticJson;
        renderEffects(cfg);
        renderPresets();
        renderBindings(cfg);
        renderDevices(cfg);
    }

    let tempUnit = "C";
    let moduleEnabled = true;

    function formatThermalValue(celsius) {
        if (celsius == null) return "—";
        if (tempUnit === "F") return `${Math.round((celsius * 9) / 5 + 32)}°F`;
        return `${Math.round(celsius)}°C`;
    }

    function updateThermalReadout(cpuTemp, gpuTemp) {
        const tempReadout = byId("rgb-thermal-readout");
        if (!tempReadout) return;
        const cpu = `CPU ${formatThermalValue(cpuTemp)}`;
        const gpu = `GPU ${formatThermalValue(gpuTemp)}`;
        tempReadout.textContent = `${cpu} · ${gpu}`;
    }

    // Wire static controls once
    const swatchContainer = byId("rgb-swatches");
    if (swatchContainer) {
        swatchContainer.replaceChildren();
        for (const [hex, label] of quickSwatches) {
            const sw = element("button", "rgb-swatch");
            sw.type = "button";
            sw.style.background = hex;
            sw.title = `${label} (${hex})`;
            sw.setAttribute("aria-label", label);
            sw.addEventListener("click", () => {
                if (hex === "#000000") {
                    void run({ kind: "blackout" });
                    return;
                }
                if (byId("rgb-primary-color")) byId("rgb-primary-color").value = hex;
                show("rgb-primary-hex", hex.toUpperCase());
                dirtyControls = true;
                applyCurrentControls(state?.config?.effect === "blackout" ? "static" : undefined);
            });
            swatchContainer.append(sw);
        }
    }

    byId("rgb-connect-btn")?.addEventListener("click", () => {
        if (state?.openrgbConnected) {
            void run({ kind: "disconnect" });
        } else {
            const host = byId("rgb-host-input")?.value.trim() || "127.0.0.1";
            const port = Number(byId("rgb-port-input")?.value) || 6742;
            void run({ kind: "connect", host, port });
        }
    });
    byId("rgb-rescan-btn")?.addEventListener("click", () => void run({ kind: "rescan" }));
    byId("rgb-launch-openrgb-btn")?.addEventListener("click", () => void run({ kind: "launch_openrgb" }));
    byId("rgb-win11-settings-btn")?.addEventListener("click", () => void run({ kind: "open_dynamic_lighting_settings" }));
    byId("rgb-blackout-btn")?.addEventListener("click", () => void run({ kind: "blackout" }));
    byId("rgb-sync-theme-btn")?.addEventListener("click", () => void run({ kind: "sync_theme_accent", accent_hex: currentThemeAccent() }));
    byId("rgb-diag-btn")?.addEventListener("click", () => void run({ kind: "diagnostic_readback" }));
    byId("rgb-diag-copy-btn")?.addEventListener("click", async () => {
        const text = byId("rgb-diag-pre")?.textContent?.trim();
        if (!text) {
            show("rgb-status", "Run Hardware Readback first.");
            return;
        }
        try {
            await navigator.clipboard.writeText(text);
            show("rgb-status", "Copied hardware readback JSON.");
            window.showToast?.("Copied RGB hardware readback JSON.", "ok");
        } catch {
            show("rgb-status", "Clipboard access is unavailable.");
        }
    });
    byId("rgb-elevate-btn")?.addEventListener("click", async () => {
        if (await askDashboard("Restart as administrator", "Windows will ask for permission to reopen RustCoreWatch with PawnIO SMBus access for RGB RAM.")) {
            await dashboardCommand("elevate");
        }
    });

    byId("rgb-primary-color")?.addEventListener("input", (ev) => {
        show("rgb-primary-hex", ev.currentTarget.value.toUpperCase());
        scheduleControlsApply();
    });
    byId("rgb-secondary-color")?.addEventListener("input", (ev) => {
        show("rgb-secondary-hex", ev.currentTarget.value.toUpperCase());
        scheduleControlsApply();
    });
    byId("rgb-brightness")?.addEventListener("input", (ev) => {
        show("rgb-brightness-val", ev.currentTarget.value + "%");
        scheduleControlsApply();
    });
    byId("rgb-speed")?.addEventListener("input", (ev) => {
        show("rgb-speed-val", ev.currentTarget.value + "%");
        scheduleControlsApply();
    });
    byId("rgb-save-preset-form")?.addEventListener("submit", async (ev) => {
        ev.preventDefault();
        const input = byId("rgb-preset-name-input");
        const name = input?.value.trim();
        if (!name) return;
        const ok = await run({ kind: "save_preset", name });
        if (ok && input) input.value = "";
    });
    byId("rgb-profile-sync-toggle")?.addEventListener("change", (ev) => {
        void run({ kind: "set_profile_sync", enabled: ev.currentTarget.checked, bindings: null });
    });

    // Live-follow Theme Studio accent whenever ThemeSync effect is active (coalesced)
    window.addEventListener("cw-theme-changed", (ev) => {
        if (!moduleEnabled) return;
        const accent = ev.detail?.accent;
        if (!/^#[0-9a-f]{6}$/i.test(accent)) return;
        if (!loaded) {
            void refreshState(true).then(() => {
                if (moduleEnabled && state?.config?.effect === "theme_sync") {
                    void run({ kind: "sync_theme_accent", accent_hex: accent }, true, true);
                }
            }).catch(() => {});
            return;
        }
        if (state?.config?.effect === "theme_sync") {
            void run({ kind: "sync_theme_accent", accent_hex: accent }, true, true);
        }
    });

    return {
        async show(active) {
            if (active) {
                await refreshProfileModes();
                await refreshState();
            }
        },
        setEnabled(enabled) {
            moduleEnabled = Boolean(enabled);
        },
        setTemperatureUnit(unit) {
            tempUnit = unit === "F" ? "F" : "C";
            if (state) updateThermalReadout(state.liveCpuTemp, state.liveGpuTemp);
        },
        blackout: () => run({ kind: "blackout" }),
        applyPreset: (id) => run({ kind: "apply_preset", id }),
        syncThemeAccent: (hex) => run({ kind: "sync_theme_accent", accent_hex: hex || currentThemeAccent() }),
        updateThermal(cpuTemp, gpuTemp) {
            if (state) {
                state.liveCpuTemp = cpuTemp;
                state.liveGpuTemp = gpuTemp;
            }
            updateThermalReadout(cpuTemp, gpuTemp);
        },
        isLoaded: () => loaded
    };
}
