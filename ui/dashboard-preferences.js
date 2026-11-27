"use strict";

function createDashboardPreferences(core, nativeWindow, temperatureChanged, modulesChanged) {
    const panelIds = ["layout", "appearance", "preferences"];
    const profile = byId("dashboard-polling-profile");
    const unit = byId("dashboard-temperature-unit");
    const status = byId("preferences-save-status");
    const pin = byId("pin");
    const lockBtn = byId("lock-window");
    const layoutPin = byId("layout-window-pin");
    const opacity = byId("layout-opacity");
    let windowLockMode = "none";
    let telemetry = { pollingProfile: "balanced", temperatureUnit: "C" };
    let pending = Promise.resolve();
    let openPanel = null;

    function enqueue(operation) {
        const next = pending.then(operation);
        pending = next.catch(() => {});
        return next;
    }

    const save = (changes) => enqueue(() => core.invoke("save_dashboard_preferences", { changes }));
    const layout = createDashboardLayout(save);
    const appearance = createDashboardAppearance(core, save);
    const settingsPanel = createAppSettings(core, save, modulesChanged, status);

    function closePanel(restoreFocus = false) {
        if (!openPanel) return;
        const name = openPanel;
        openPanel = null;
        byId(name + "-panel").hidePopover();
        const trigger = byId(name + "-toggle");
        trigger.setAttribute("aria-expanded", "false");
        trigger.classList.remove("active");
        if (name === "layout") layout.editing(false);
        if (name === "appearance") appearance.commit();
        if (restoreFocus) trigger.focus();
    }

    function open(name, toggle = false) {
        if (openPanel === name && !toggle) return;
        const alreadyOpen = openPanel === name;
        closePanel();
        if (alreadyOpen) return;
        window.dispatchEvent(new CustomEvent("cw-close-overlays", { detail: { except: name + "-panel" } }));
        const panel = byId(name + "-panel");
        const trigger = byId(name + "-toggle");
        openPanel = name;
        panel.showPopover();
        if (panel.style.left && typeof panel._clampPosition === "function") {
            panel._clampPosition();
        }
        panel.querySelector(".panel-dismiss").focus({ preventScroll: true });
        trigger.setAttribute("aria-expanded", "true");
        trigger.classList.add("active");
        if (name === "layout") layout.editing(true);
        if (name === "preferences") void settingsPanel.opened();
    }

    for (const name of panelIds) {
        const panel = byId(name + "-panel");
        const trigger = byId(name + "-toggle");
        panel.querySelector(".panel-dismiss").addEventListener("click", () => closePanel(true));
        trigger.addEventListener("click", async () => {
            if (name === "layout" && byId("viewDashboardGrid")?.hidden && window.cwApp?.selectView) {
                await window.cwApp.selectView("dashboard");
                open("layout", false);
                return;
            }
            open(name, true);
        });
    }
    window.addEventListener("cw-close-overlays", (ev) => {
        if (openPanel && ev.detail?.except !== openPanel + "-panel") closePanel();
    });
    document.addEventListener("keydown", (event) => {
        const dpOpen = byId("diskPartitionerModal")?.matches(":popover-open");
        if (event.ctrlKey && event.key === "," && !document.querySelector("dialog[open]") && !dpOpen) {
            event.preventDefault();
            open("preferences");
        }
        if (event.key === "Escape" && openPanel && !document.querySelector("dialog[open]")) {
            event.preventDefault();
            closePanel(true);
        }
    });
    void window.__TAURI__.event.listen("open-settings", () => open("preferences")).catch((error) => log(String(error)));
    enablePanelDrag(byId("appearance-panel"));
    enablePanelDrag(byId("layout-panel"));

    function applyTelemetry(next) {
        telemetry = next;
        profile.value = next.pollingProfile;
        unit.value = next.temperatureUnit;
        temperatureChanged(next.temperatureUnit);
    }

    const dragRegions = [...document.querySelectorAll("[data-tauri-drag-region]")];
    function showLockMode(mode) {
        windowLockMode = mode || "none";
        document.documentElement.dataset.windowLock = windowLockMode;
        const locked = windowLockMode !== "none";
        for (const el of dragRegions) {
            if (locked) el.removeAttribute("data-tauri-drag-region");
            else el.setAttribute("data-tauri-drag-region", "");
        }
        if (!lockBtn) return;
        const labels = {
            none: ["🔓", "Window Unlocked — Click to lock position"],
            position: ["🔒", "Window Position Locked — Click to lock position & size"],
            all: ["🔐", "Window Position & Size Locked — Click to unlock"]
        };
        const [icon, title] = labels[windowLockMode] || labels.none;
        lockBtn.textContent = icon;
        lockBtn.title = title;
        lockBtn.classList.toggle("lock-pos", windowLockMode === "position");
        lockBtn.classList.toggle("lock-all", windowLockMode === "all");
        lockBtn.classList.toggle("active", locked);
        lockBtn.setAttribute("aria-pressed", String(locked));
    }

    async function cycleLockMode() {
        const order = ["none", "position", "all"];
        const next = order[(order.indexOf(windowLockMode) + 1) % order.length];
        if (lockBtn) lockBtn.disabled = true;
        try {
            const saved = await core.invoke("set_window_lock_mode", { mode: next });
            showLockMode(saved);
            const names = { none: "Window unlocked", position: "Window position locked", all: "Window position & size locked" };
            window.showToast?.(names[saved] || saved, "info");
        } catch (error) {
            log("Window lock: " + String(error));
        } finally {
            if (lockBtn) lockBtn.disabled = false;
        }
    }
    lockBtn?.addEventListener("click", () => void cycleLockMode());

    function apply(settings) {
        layout.apply(settings.layout);
        applyTelemetry(settings.telemetry);
        appearance.setTheme(settings.theme);
        settingsPanel.apply(settings);
        showLockMode(settings.windowLockMode || "none");
        opacity.value = settings.opacity;
        show("layout-opacity-value", opacity.value + "%");
    }

    async function changeTelemetry() {
        const next = { pollingProfile: profile.value, temperatureUnit: unit.value };
        profile.disabled = unit.disabled = true;
        status.textContent = "Saving…";
        try {
            const settings = await save({ telemetry: next });
            applyTelemetry(settings.telemetry);
            status.textContent = "Saved";
        } catch (error) {
            applyTelemetry(telemetry);
            status.textContent = String(error);
        } finally {
            profile.disabled = unit.disabled = false;
        }
    }
    profile.addEventListener("change", changeTelemetry);
    unit.addEventListener("change", changeTelemetry);

    byId("import-dashboard-settings").addEventListener("click", async (event) => {
        const button = event.currentTarget;
        if (!await askDashboard("Import dashboard preferences",
            "Apply the Legacy PowerShell Edition’s layout, colors, directories, and telemetry preferences to RustCoreWatch?")) return;
        button.disabled = true;
        try {
            apply(await enqueue(() => core.invoke("import_dashboard_preferences")));
            status.textContent = "Imported";
        } catch (error) {
            status.textContent = String(error);
        } finally {
            button.disabled = false;
        }
    });

    function showPin(pinned) {
        pin.setAttribute("aria-pressed", String(pinned));
        pin.classList.toggle("active", pinned);
        layoutPin.checked = pinned;
    }

    async function togglePin() {
        const previous = pin.getAttribute("aria-pressed") === "true";
        pin.disabled = layoutPin.disabled = true;
        try {
            await nativeWindow.setAlwaysOnTop(!previous);
            try {
                await save({ alwaysOnTop: !previous });
            } catch (error) {
                await nativeWindow.setAlwaysOnTop(previous);
                throw error;
            }
            showPin(!previous);
            window.showToast?.(!previous ? "Pinned Always on Top" : "Unpinned Always on Top", "info");
        } catch (error) {
            showPin(previous);
            log("Always on top: " + String(error));
        } finally {
            pin.disabled = layoutPin.disabled = false;
        }
    }
    pin.addEventListener("click", togglePin);
    layoutPin.addEventListener("change", togglePin);
    opacity.addEventListener("input", () => show("layout-opacity-value", opacity.value + "%"));
    opacity.addEventListener("change", async () => {
        opacity.disabled = true;
        const feedback = byId("layout-save-status");
        try {
            const saved = await save({ opacity: Number(opacity.value) });
            opacity.value = saved.opacity;
            feedback.textContent = "Saved";
        } catch (error) {
            const initial = await core.invoke("dashboard_preferences").catch(() => null);
            if (initial) opacity.value = initial.settings.opacity;
            feedback.textContent = String(error);
        } finally {
            show("layout-opacity-value", opacity.value + "%");
            opacity.disabled = false;
        }
    });

    async function restore() {
        try {
            const initial = await core.invoke("dashboard_preferences");
            apply(initial.settings);
            await settingsPanel.initialize();
            appearance.setWallpaperVersion(initial.wallpaperVersion);
            if (initial.settings.alwaysOnTop) {
                await nativeWindow.setAlwaysOnTop(true);
                showPin(true);
            }
            if (!initial.initialized) {
                let hidden;
                try {
                    hidden = JSON.parse(localStorage.getItem("corewatch-dashboard-hidden") ?? "null");
                } catch { /* Older Rust builds may have invalid or inaccessible webview storage. */ }
                if (Array.isArray(hidden) && hidden.length) {
                    const restored = await save({
                        layout: { ...initial.settings.layout, hidden: hidden.filter((value) => typeof value === "string") }
                    });
                    layout.apply(restored.layout);
                }
            }
        } catch (error) {
            status.textContent = String(error);
            log("Dashboard preferences: " + String(error));
        }
    }

    return {
        restore,
        openPanel: open,
        cycleLockMode,
        togglePin,
        toggleDock: () => layout.toggleDock(),
        applyThemePreset: (id) => appearance.applyPresetById(id),
        setFontSize: (size) => settingsPanel.setFontSize(size),
        settled: async () => { await settingsPanel.settled(); await pending; },
        async flush() { appearance.commit(); await settingsPanel.settled(); await pending; },
        viewChanged(isDashboard) {
            byId("refresh").hidden = !isDashboard;
            if (!isDashboard && openPanel === "layout") closePanel();
        }
    };
}

function enablePanelDrag(panel, options = {}) {
    const header = panel.querySelector(".draggable-panel-header");
    if (!header) return;
    const storageKey = options.storageKey || null;
    let drag = null;
    function setFloating(floating) {
        panel.classList.toggle("is-floating", floating);
        options.onFloatChange?.(floating);
    }
    function position(x, y, persist = false) {
        const w = panel.offsetWidth || 400;
        const h = panel.offsetHeight || 260;
        const maxX = Math.max(8, window.innerWidth - w - 8);
        const maxY = Math.max(8, window.innerHeight - h - 8);
        const clampedX = Math.round(Math.min(maxX, Math.max(8, x)));
        const clampedY = Math.round(Math.min(maxY, Math.max(8, y)));
        panel.style.left = clampedX + "px";
        panel.style.top = clampedY + "px";
        panel.style.right = "auto";
        panel.style.bottom = "auto";
        setFloating(true);
        if (persist && storageKey) {
            try { localStorage.setItem(storageKey, JSON.stringify({ x: clampedX, y: clampedY })); } catch {}
        }
    }
    panel._clampPosition = () => {
        if (panel.style.left) {
            position(parseFloat(panel.style.left), parseFloat(panel.style.top), false);
        } else if (storageKey) {
            try {
                const saved = JSON.parse(localStorage.getItem(storageKey) || "null");
                if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
                    position(saved.x, saved.y, false);
                }
            } catch {}
        }
    };
    panel._resetPosition = () => {
        panel.style.left = "";
        panel.style.top = "";
        panel.style.right = "";
        panel.style.bottom = "";
        setFloating(false);
        if (storageKey) {
            try { localStorage.removeItem(storageKey); } catch {}
        }
    };
    header.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || event.target.closest("button")) return;
        const rect = panel.getBoundingClientRect();
        drag = { x: event.clientX - rect.left, y: event.clientY - rect.top, moved: false };
        try { header.setPointerCapture(event.pointerId); } catch { /* Fallback to window pointerup. */ }
    });
    header.addEventListener("pointermove", (event) => {
        if (!drag) return;
        drag.moved = true;
        position(event.clientX - drag.x, event.clientY - drag.y, false);
    });
    const endDrag = () => {
        if (drag?.moved && panel.style.left) {
            position(parseFloat(panel.style.left), parseFloat(panel.style.top), true);
        }
        drag = null;
    };
    header.addEventListener("lostpointercapture", endDrag);
    window.addEventListener("pointerup", endDrag);
    window.addEventListener("pointercancel", endDrag);
    window.addEventListener("resize", () => {
        if (panel.matches(":popover-open") && panel.style.left) {
            position(parseFloat(panel.style.left), parseFloat(panel.style.top), false);
        }
    });
}

async function verifyDashboardPreferences(core, preferences) {
    const require = (condition, message) => {
        if (!condition) throw new Error(message);
    };
    const grid = byId("viewDashboardGrid");
    const header = document.querySelector(".app-header-deck");
    require(header.scrollWidth <= header.clientWidth + 1, "Dashboard header overflowed.");
    require(grid.scrollWidth <= grid.clientWidth + 1, "Dashboard cards overflowed horizontally.");
    const warmthRow = byId("night-warmth-row").getBoundingClientRect();
    const slider = byId("night-warmth").getBoundingClientRect();
    const warmthValue = byId("night-warmth-value").getBoundingClientRect();
    require(slider.height === 4 && slider.width > 20 && warmthRow.height <= 18 && warmthValue.right <= warmthRow.right + 1,
        "Night Light did not use the reference slider dimensions.");
    const orientation = byId("lblMonOrientation");
    const orientationLabel = orientation.textContent;
    orientation.textContent = "Landscape (flipped)";
    for (const control of grid.querySelectorAll(".display-setting")) {
        const area = control.getBoundingClientRect();
        require(area.height === 18 && area.right <= control.parentElement.getBoundingClientRect().right + 1,
            "A display setting exceeded its compact row.");
    }
    orientation.textContent = orientationLabel;
    if (innerWidth <= 1379) {
        const tabs = header.querySelector(".modular-tabs").getBoundingClientRect();
        const tools = header.querySelector(".header-right-group").getBoundingClientRect();
        require(tabs.top >= tools.bottom - 1, "Dashboard navigation did not move below the utility buttons.");
    }
    if (innerWidth <= 760) {
        const columns = getComputedStyle(grid).gridTemplateColumns.split(" ");
        require(columns.length === 1, "Dashboard cards did not stack at narrow width.");
    }

    byId("layout-toggle").click();
    require(grid.classList.contains("layout-edit-mode"), "Layout controls did not open.");
    document.querySelector('[data-layout-preset="network"]').click();
    const networkCard = grid.querySelector('[data-card-id="network"]');
    require(grid.firstElementChild === networkCard && networkCard.classList.contains("card-wide"),
        "The Network preset did not move and widen its card.");
    require(grid.querySelector('[data-metric-key="hw-pagefile"]').classList.contains("metric-hidden"),
        "The Network preset did not hide the pagefile metric.");
    const networkRow = byId("layout-cards").querySelector('[data-layout-card="network"]');
    networkCard.querySelector(".ctrl-collapse").click();
    networkRow.querySelector('button[aria-label$="down"]').click();
    await preferences.settled();
    const layout = (await core.invoke("dashboard_preferences")).settings.layout;
    require(layout.order[1] === "network" && layout.collapsed.includes("network"),
        "Card order or collapse state did not round-trip through IPC.");
    networkRow.querySelector('button[aria-label^="Dock "]').click();
    await preferences.settled();
    require(byId("dock-cards").contains(networkCard) && (await core.invoke("dashboard_preferences")).settings.layout.docked.includes("network"),
        "The frame did not move to the telemetry dock.");
    byId("dock-toggle").click();
    require(byId("dashboard-dock").matches(":popover-open"), "The telemetry dock did not open.");
    require(Boolean(byId("dashboard-dock").querySelector(".draggable-panel-header")) && typeof byId("dashboard-dock")._resetPosition === "function",
        "The telemetry dock header is not movable.");
    byId("dock-close").click();
    const pullTab = byId("sideDockPullTab");
    if (pullTab && !pullTab.hidden) {
        const ptRect = pullTab.getBoundingClientRect();
        const hdrRect = header.getBoundingClientRect();
        require(ptRect.top >= hdrRect.bottom - 1, "Telemetry dock pull tab overlapped the header.");
        require(Number(getComputedStyle(pullTab).zIndex) > Number(getComputedStyle(header).zIndex),
            "Telemetry dock pull tab z-index must exceed the header.");
    }
    byId("dock-toggle").click();
    require(byId("dashboard-dock").matches(":popover-open"), "The telemetry dock did not reopen.");
    byId("dock-close").click();
    const opacity = byId("layout-opacity");
    opacity.value = "90";
    opacity.dispatchEvent(new Event("change"));
    await preferences.settled();
    require((await core.invoke("dashboard_preferences")).settings.opacity === 90, "Window opacity did not apply.");
    opacity.value = "100";
    opacity.dispatchEvent(new Event("change"));
    await preferences.settled();
    byId("reset-dashboard-layout").click();
    await preferences.settled();
    byId("layout-toggle").click();

    const root = document.documentElement;
    const thermalColor = getComputedStyle(byId("badgeCpuTemp")).color;
    byId("appearance-toggle").click();
    byId("theme-collapse").click();
    require(byId("appearance-panel").classList.contains("studio-collapsed"), "Theme Studio did not collapse.");
    byId("theme-collapse").click();
    document.querySelector('[data-studio-tab="wallpaper"]').click();
    require(!byId("theme-wallpaper-pane").hidden && byId("theme-colors-pane").hidden, "Wallpaper controls did not open.");
    document.querySelector('[data-studio-tab="colors"]').click();
    document.querySelector('[data-palette="emerald"]').click();
    require(root.style.getPropertyValue("--cw-accent") === "#059669", "The theme preview did not apply.");
    require(getComputedStyle(byId("badgeCpuTemp")).color === thermalColor, "The theme changed a thermal color.");
    document.querySelector('[data-palette="midnight"]').click();
    byId("appearance-toggle").click();
    await preferences.settled();
    require((await core.invoke("dashboard_preferences")).settings.theme.presetId === "midnight",
        "The selected appearance did not round-trip through IPC.");

    const canvas = element("canvas", "");
    canvas.width = canvas.height = 1;
    const image = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    const version = await core.invoke("set_dashboard_wallpaper", new Uint8Array(await image.arrayBuffer()));
    const wallpaper = new Image();
    wallpaper.src = core.convertFileSrc("wallpaper", "corewatch-wallpaper") + "?v=" + version;
    await wallpaper.decode();
    require(wallpaper.naturalWidth === 1, "WebView2 could not decode the stored wallpaper.");
    await core.invoke("remove_dashboard_wallpaper");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true }));
    require(byId("cwCommandPaletteModal").open, "Ctrl+K did not open Quick Command Palette.");
    byId("cwCommandPaletteModal").close();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: ",", ctrlKey: true, bubbles: true }));
    require(byId("preferences-panel").matches(":popover-open"), "Ctrl+, did not open Settings.");
    const largeRadio = document.querySelector('input[name="cwFontSize"][value="large"]');
    largeRadio.click();
    await preferences.settled();
    require(document.documentElement.dataset.fontSize === "large" && document.documentElement.style.getPropertyValue("--cw-font-scale") === "1.12",
        "4-size Interface Font Size did not apply live.");
    document.querySelector('input[name="cwFontSize"][value="normal"]').click();
    await preferences.settled();
    require(document.documentElement.dataset.fontSize === "normal", "Interface Font Size did not restore to normal.");

    const behavior = document.querySelector('[data-general-setting="confirmDestructiveActions"]');
    behavior.click();
    for (let i = 0; confirmDestructiveActions && i < 100; i++) await new Promise((resolve) => setTimeout(resolve, 20));
    require(!confirmDestructiveActions, "Confirmation settings did not apply live.");
    behavior.click();
    for (let i = 0; !confirmDestructiveActions && i < 100; i++) await new Promise((resolve) => setTimeout(resolve, 20));
    require(confirmDestructiveActions, "Confirmation settings did not restore.");
    byId("settings-tab-directories").click();
    require(!byId("settings-pane-directories").hidden && document.querySelectorAll("[data-directory]").length === 5, "Directory settings did not open.");
    byId("settings-tab-modules").click();
    require(!byId("settings-pane-modules").hidden && byId("settings-modules").querySelectorAll(".settings-module-row").length === 24 && !byId("settings-modules").textContent.includes("Not Installed"),
        "Module catalog did not render all 24 installed RustCoreWatch modules.");
    const taskModule = () => document.querySelector('[data-module="tasksports"]');
    require(taskModule(), "Tasks & Ports was missing from Modules & Tabs.");
    taskModule().click();
    for (let i = 0; !byId("tabTasksPorts").hidden && i < 100; i++) await new Promise((resolve) => setTimeout(resolve, 20));
    require(byId("tabTasksPorts").hidden && taskModule().textContent === "Show", "Hiding Tasks & Ports did not update navigation.");
    taskModule().click();
    for (let i = 0; byId("tabTasksPorts").hidden && i < 100; i++) await new Promise((resolve) => setTimeout(resolve, 20));
    require(!byId("tabTasksPorts").hidden, "Showing Tasks & Ports did not update navigation.");
    byId("settings-tab-telemetry").click();
    const unit = byId("dashboard-temperature-unit");
    unit.value = "F";
    byId("dashboard-polling-profile").value = "eco";
    unit.dispatchEvent(new Event("change"));
    await preferences.settled();
    const snapshot = await core.invoke("snapshot", { after: 0 });
    require(snapshot.pollIntervalMs === 1000 && byId("lblCpuTempUnit").textContent === "°F",
        "Telemetry cadence and temperature unit did not apply.");
    byId("preferences-toggle").click();
}
