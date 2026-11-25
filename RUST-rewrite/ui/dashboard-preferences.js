"use strict";

function createDashboardPreferences(core, nativeWindow, temperatureChanged) {
    const panelIds = ["layout", "appearance", "preferences"];
    const profile = byId("dashboard-polling-profile");
    const unit = byId("dashboard-temperature-unit");
    const status = byId("preferences-save-status");
    const pin = byId("pin");
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

    function closePanel(restoreFocus = false) {
        if (!openPanel) return;
        const name = openPanel;
        openPanel = null;
        byId(name + "-panel").hidePopover();
        const trigger = byId(name + "-toggle");
        trigger.setAttribute("aria-expanded", "false");
        trigger.classList.remove("active");
        if (name === "layout") layout.editing(false);
        if (name === "appearance") appearance.discardPreview();
        if (restoreFocus) trigger.focus();
    }

    for (const name of panelIds) {
        const panel = byId(name + "-panel");
        const trigger = byId(name + "-toggle");
        panel.querySelector(".panel-dismiss").addEventListener("click", () => closePanel(true));
        trigger.addEventListener("click", () => {
            const alreadyOpen = openPanel === name;
            closePanel();
            if (alreadyOpen) return;
            openPanel = name;
            panel.showPopover();
            panel.querySelector(".panel-dismiss").focus({ preventScroll: true });
            trigger.setAttribute("aria-expanded", "true");
            trigger.classList.add("active");
            if (name === "layout") layout.editing(true);
        });
    }
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && openPanel && !byId("dashboard-dialog").open) {
            closePanel(true);
        }
    });
    enablePanelDrag(byId("appearance-panel"));

    function applyTelemetry(next) {
        telemetry = next;
        profile.value = next.pollingProfile;
        unit.value = next.temperatureUnit;
        temperatureChanged(next.temperatureUnit);
    }

    function apply(settings) {
        layout.apply(settings.layout);
        applyTelemetry(settings.telemetry);
        appearance.setTheme(settings.theme);
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
            "Apply the PowerShell version’s layout, colors, and telemetry preferences to CoreWatch Rust?")) return;
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
    }

    pin.addEventListener("click", async () => {
        const previous = pin.getAttribute("aria-pressed") === "true";
        pin.disabled = true;
        try {
            await nativeWindow.setAlwaysOnTop(!previous);
            try {
                await save({ alwaysOnTop: !previous });
            } catch (error) {
                await nativeWindow.setAlwaysOnTop(previous);
                throw error;
            }
            showPin(!previous);
        } catch (error) {
            log("Always on top: " + String(error));
        } finally {
            pin.disabled = false;
        }
    });

    async function restore() {
        try {
            const initial = await core.invoke("dashboard_preferences");
            apply(initial.settings);
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
        settled: () => pending,
        viewChanged(isDashboard) {
            byId("layout-toggle").hidden = !isDashboard;
            if (!isDashboard && openPanel === "layout") closePanel();
        }
    };
}

function enablePanelDrag(panel) {
    const header = panel.querySelector(".draggable-panel-header");
    let drag = null;
    function position(x, y) {
        const maxX = Math.max(8, window.innerWidth - panel.offsetWidth - 8);
        const maxY = Math.max(8, window.innerHeight - panel.offsetHeight - 8);
        panel.style.left = Math.min(maxX, Math.max(8, x)) + "px";
        panel.style.top = Math.min(maxY, Math.max(8, y)) + "px";
        panel.style.right = "auto";
    }
    header.addEventListener("pointerdown", (event) => {
        if (event.button !== 0 || event.target.closest("button")) return;
        const rect = panel.getBoundingClientRect();
        drag = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        header.setPointerCapture(event.pointerId);
    });
    header.addEventListener("pointermove", (event) => {
        if (drag) position(event.clientX - drag.x, event.clientY - drag.y);
    });
    header.addEventListener("lostpointercapture", () => { drag = null; });
    window.addEventListener("resize", () => {
        if (panel.matches(":popover-open") && panel.style.left) {
            position(parseFloat(panel.style.left), parseFloat(panel.style.top));
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
    networkRow.querySelector('input[aria-label^="Collapse"]').click();
    networkRow.querySelector('button[aria-label$="down"]').click();
    await preferences.settled();
    const layout = (await core.invoke("dashboard_preferences")).settings.layout;
    require(layout.order[1] === "network" && layout.collapsed.includes("network"),
        "Card order or collapse state did not round-trip through IPC.");
    byId("reset-dashboard-layout").click();
    await preferences.settled();
    byId("layout-toggle").click();

    const root = document.documentElement;
    const accent = root.style.getPropertyValue("--cw-accent");
    const thermalColor = getComputedStyle(byId("badgeCpuTemp")).color;
    byId("appearance-toggle").click();
    document.querySelector('[data-palette="emerald"]').click();
    require(root.style.getPropertyValue("--cw-accent") === "#059669", "The theme preview did not apply.");
    require(getComputedStyle(byId("badgeCpuTemp")).color === thermalColor, "The theme changed a thermal color.");
    byId("revert-appearance").click();
    require(root.style.getPropertyValue("--cw-accent") === accent, "Reverting the preview did not restore the theme.");
    document.querySelector('[data-palette="midnight"]').click();
    byId("save-appearance").click();
    await preferences.settled();
    require((await core.invoke("dashboard_preferences")).settings.theme.presetId === "midnight",
        "The selected appearance did not round-trip through IPC.");
    byId("appearance-toggle").click();

    const canvas = element("canvas", "");
    canvas.width = canvas.height = 1;
    const image = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    const version = await core.invoke("set_dashboard_wallpaper", new Uint8Array(await image.arrayBuffer()));
    const wallpaper = new Image();
    wallpaper.src = core.convertFileSrc("wallpaper", "corewatch-wallpaper") + "?v=" + version;
    await wallpaper.decode();
    require(wallpaper.naturalWidth === 1, "WebView2 could not decode the stored wallpaper.");
    await core.invoke("remove_dashboard_wallpaper");

    byId("preferences-toggle").click();
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
