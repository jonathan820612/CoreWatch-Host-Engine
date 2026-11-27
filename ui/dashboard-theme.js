"use strict";

const dashboardColors = [
    ["bgApp", "App background"], ["bgSurface", "Card background"], ["bgInset", "Inset background"],
    ["bgControl", "Control background"], ["border", "Border"], ["borderStrong", "Control border"],
    ["accent", "Accent"], ["accentLight", "Heading accent"], ["accentSoft", "Highlight"],
    ["textPrimary", "Main text"], ["textSecondary", "Control text"], ["textMuted", "Muted text"]
];

const appearancePalettes = [
    ["classic", "CoreWatch Classic", ["#1a202c", "#212936", "#141923", "#2d3748", "#323c4b", "#4a5568", "#3182ce", "#4299e1", "#63b3ed", "#f7fafc", "#cbd5e0", "#a0aec0"]],
    ["midnight", "Midnight OLED", ["#06080d", "#0f141e", "#090c13", "#192233", "#1e293b", "#334155", "#0284c7", "#38bdf8", "#7dd3fc", "#f8fafc", "#cbd5e1", "#94a3b8"]],
    ["cyberpunk", "Cyberpunk Neon", ["#0d0a1a", "#17122b", "#100c20", "#261d42", "#322459", "#523b8a", "#c026d3", "#e879f9", "#22d3ee", "#fdf4ff", "#e9d5ff", "#a78bfa"]],
    ["emerald", "Emerald Matrix", ["#0a1310", "#12211b", "#0c1713", "#1b3129", "#214035", "#2f5e4d", "#059669", "#10b981", "#34d399", "#ecfdf5", "#bbf7d0", "#86efac"]],
    ["amber", "Amber Forge", ["#16120f", "#221b16", "#1a1410", "#332820", "#44352a", "#634d3d", "#d97706", "#f59e0b", "#fbbf24", "#fffbeb", "#fde68a", "#c2a685"]],
    ["nord", "Nord Frost", ["#2e3440", "#3b4252", "#272c36", "#434c5e", "#4c566a", "#616e88", "#5e81ac", "#81a1c1", "#88c0d0", "#eceff4", "#e5e9f0", "#aeb9cc"]],
    ["crimson", "Crimson Ops", ["#141014", "#211820", "#181218", "#332331", "#442d40", "#66405f", "#be123c", "#f43f5e", "#fda4af", "#fff1f2", "#fecdd3", "#bca0a8"]],
    ["synthwave", "Synthwave Sunset", ["#110b1f", "#1b1230", "#140d24", "#2b1c47", "#3e2763", "#653d99", "#ea580c", "#fb7185", "#fbbf24", "#fff7ed", "#fed7aa", "#c4b5fd"]],
    ["aurora", "Aurora Borealis", ["#07121b", "#0f202e", "#0a1722", "#183247", "#1f445e", "#2e6487", "#0891b2", "#2dd4bf", "#c084fc", "#ecfeff", "#bae6fd", "#88b4cc"]],
    ["daylight", "Daylight Slate", ["#e2e8f0", "#ffffff", "#f1f5f9", "#e2e8f0", "#cbd5e1", "#94a3b8", "#2563eb", "#1d4ed8", "#0284c7", "#0f172a", "#334155", "#64748b"]]
];

function paletteColors(colors) {
    return Object.fromEntries(dashboardColors.map(([key], index) => [key, colors[index]]));
}

const classicDashboardTheme = {
    presetId: "classic",
    ...paletteColors(appearancePalettes[0][2]),
    surfaceOpacity: 100,
    cardBlur: 0,
    bgFit: "cover",
    bgOpacity: 45,
    bgBlur: 0,
    bgFadeMode: "vignette",
    bgFadeStrength: 35
};

function rgb(hex) {
    return [1, 3, 5].map((index) => parseInt(hex.slice(index, index + 2), 16));
}

function relativeLuminance(color) {
    const [r, g, b] = color.map((value) => value / 255)
        .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function wallpaperFade(theme) {
    const strength = theme.bgFadeStrength / 100;
    const tone = (alpha) => "rgba(" + rgb(theme.bgApp).join(", ") + ", " + alpha + ")";
    if (!strength || theme.bgFadeMode === "none") return "none";
    if (theme.bgFadeMode === "uniform") return tone(strength);
    if (theme.bgFadeMode === "vignette") {
        return "radial-gradient(ellipse at center, " + tone(0) + " 18%, " + tone(strength) + " 100%)";
    }
    const direction = theme.bgFadeMode === "top" ? "to bottom" : "to top";
    return "linear-gradient(" + direction + ", " + tone(strength) + ", " + tone(0) + " 85%)";
}

let lastEmittedThemeAccent = null;

function applyDashboardTheme(theme, wallpaperUrl, emitAccentEvent = true) {
    const style = document.documentElement.style;
    for (const [key] of dashboardColors) {
        const token = "--cw-" + key.replace(/[A-Z]/g, (letter) => "-" + letter.toLowerCase());
        style.setProperty(token, theme[key]);
        if (["bgApp", "bgSurface", "bgInset", "accent"].includes(key)) {
            style.setProperty(token + "-rgb", rgb(theme[key]).join(", "));
        }
    }
    const control = rgb(theme.bgControl);
    const shift = relativeLuminance(control) > 0.55 ? -14 : 14;
    const hover = control.map((value) => Math.min(255, Math.max(0, value + shift)));
    style.setProperty("--cw-bg-control-hover", "rgb(" + hover.join(", ") + ")");
    const accentLightness = relativeLuminance(rgb(theme.accent));
    style.setProperty("--cw-on-accent", accentLightness > 0.179 ? "#000000" : "#ffffff");
    style.setProperty("--cw-surface-alpha", String(theme.surfaceOpacity / 100));
    style.setProperty("--cw-inset-alpha", String(theme.surfaceOpacity * 0.0096));
    style.setProperty("--cw-card-blur", theme.cardBlur + "px");
    style.setProperty("--cw-bg-image", wallpaperUrl ? "url(" + JSON.stringify(wallpaperUrl) + ")" : "none");
    style.setProperty("--cw-bg-size", {
        cover: "cover", contain: "contain", stretch: "100% 100%", center: "auto", tile: "auto"
    }[theme.bgFit]);
    style.setProperty("--cw-bg-position", theme.bgFit === "tile" ? "top left" : "center");
    style.setProperty("--cw-bg-repeat", theme.bgFit === "tile" ? "repeat" : "no-repeat");
    style.setProperty("--cw-bg-opacity", String(theme.bgOpacity / 100));
    style.setProperty("--cw-bg-blur", theme.bgBlur + "px");
    style.setProperty("--cw-bg-scale", theme.bgBlur && theme.bgFit === "cover" ? "1.04" : "1");
    style.setProperty("--cw-bg-fade-overlay", wallpaperUrl ? wallpaperFade(theme) : "none");
    document.documentElement.dataset.cardBlur = theme.cardBlur > 0 ? "on" : "off";
    document.documentElement.dataset.bgBlur = theme.bgBlur > 0 ? "on" : "off";
    document.documentElement.dataset.hasWallpaper = wallpaperUrl ? "on" : "off";
    const isLight = relativeLuminance(rgb(theme.bgInset)) > 0.45;
    document.documentElement.style.colorScheme = isLight ? "light" : "dark";
    document.documentElement.dataset.colorScheme = isLight ? "light" : "dark";
    if (emitAccentEvent && theme.accent !== lastEmittedThemeAccent) {
        lastEmittedThemeAccent = theme.accent;
        window.dispatchEvent(new CustomEvent("cw-theme-changed", { detail: { accent: theme.accent, presetId: theme.presetId } }));
    }
}

function createDashboardAppearance(core, save) {
    const panel = byId("appearance-panel");
    const status = byId("appearance-save-status");
    const pickImage = byId("choose-wallpaper");
    const removeImage = byId("remove-wallpaper");
    const effects = [...panel.querySelectorAll(".appearance-effects [name]")];
    const paletteButtons = new Map();
    const colorInputs = new Map();
    const colorGroups = ["Surfaces & Chrome", "Accents & Interactive", "Typography"].map((title) => {
        const group = element("fieldset", "dashboard-option-group appearance-colors");
        group.append(element("legend", "", title));
        byId("appearance-colors").append(group);
        return group;
    });
    let saved = classicDashboardTheme;
    let draft = saved;
    let wallpaperVersion = null;
    let timer;
    let scheduled;
    let imageBusy = false;

    function wallpaperUrl() {
        if (wallpaperVersion == null) return "";
        return core.convertFileSrc("wallpaper", "corewatch-wallpaper") + "?v=" + wallpaperVersion;
    }

    function paint(emitAccentEvent = true) {
        applyDashboardTheme(draft, wallpaperUrl(), emitAccentEvent);
        for (const [key, [input, hex]] of colorInputs) {
            input.value = draft[key];
            if (document.activeElement !== hex) hex.value = draft[key].toUpperCase();
        }
        for (const input of effects) {
            input.value = draft[input.name];
            const output = input.nextElementSibling;
            if (output?.tagName === "OUTPUT") {
                output.value = input.value + (input.name.endsWith("Blur") ? " px" : "%");
            }
        }
        for (const [name, button] of paletteButtons) {
            const active = name === draft.presetId;
            button.classList.toggle("active", active);
            button.setAttribute("aria-pressed", String(active));
        }
        for (const pill of panel.querySelectorAll("[data-bg-fit]")) {
            const active = pill.dataset.bgFit === draft.bgFit;
            pill.classList.toggle("active", active);
            pill.setAttribute("aria-pressed", String(active));
        }
        const activeWpLabel = byId("wallpaper-active-label");
        if (activeWpLabel) activeWpLabel.textContent = wallpaperVersion == null ? "No image set" : "Custom wallpaper active";
        pickImage.disabled = imageBusy;
        removeImage.disabled = imageBusy || wallpaperVersion == null;
        byId("appearance-wallpaper-effects").hidden = wallpaperVersion == null;
    }

    function preview(next) {
        draft = next;
        status.textContent = "Live Preview";
        paint();
        clearTimeout(timer);
        timer = setTimeout(commit, 220);
    }

    function setTheme(theme) {
        clearTimeout(timer);
        saved = theme;
        draft = theme;
        status.textContent = "Live Preview";
        paint();
    }

    for (const [id, label, colors] of appearancePalettes) {
        const button = actionButton(label, () => preview({ ...draft, ...paletteColors(colors), presetId: id }));
        button.className = "appearance-preset filter-pill";
        button.dataset.palette = id;
        const swatches = element("span", "appearance-swatches");
        swatches.setAttribute("aria-hidden", "true");
        for (const color of [colors[0], colors[1], colors[6]]) {
            const square = element("span", "");
            square.style.backgroundColor = color;
            swatches.append(square);
        }
        button.append(swatches);
        byId("appearance-presets").append(button);
        paletteButtons.set(id, button);
    }
    for (const [index, [key, caption]] of dashboardColors.entries()) {
        const row = element("div", "appearance-color");
        const labels = ["App Background", "Header & Cards", "Nested Panels & Inputs", "Buttons & Controls", "Card Borders", "Control Borders",
            "Primary Accent", "Headings & Highlight", "Soft Accent & Links", "Primary Text", "Secondary Text", "Muted Labels"];
        const input = element("input", "");
        input.type = "color";
        input.setAttribute("aria-label", caption + " color picker");
        const hex = element("input", "theme-hex");
        hex.type = "text";
        hex.maxLength = 7;
        hex.setAttribute("aria-label", caption + " hex color");
        hex.addEventListener("change", () => {
            const value = hex.value.trim();
            if (/^#[\da-f]{6}$/i.test(value)) preview({ ...draft, [key]: value.toLowerCase(), presetId: "custom" });
            else { status.textContent = "Enter a six-digit hex color."; hex.value = draft[key].toUpperCase(); }
        });
        input.addEventListener("input", () => preview({ ...draft, [key]: input.value, presetId: "custom" }));
        row.append(element("span", "", labels[index]), hex, input);
        colorGroups[index < 6 ? 0 : index < 9 ? 1 : 2].append(row);
        colorInputs.set(key, [input, hex]);
    }
    for (const input of effects) {
        input.addEventListener(input.type === "range" ? "input" : "change", () => {
            preview({ ...draft, [input.name]: input.type === "range" ? Number(input.value) : input.value });
        });
    }
    for (const pill of panel.querySelectorAll("[data-bg-fit]")) {
        pill.addEventListener("click", () => preview({ ...draft, bgFit: pill.dataset.bgFit }));
    }
    byId("theme-sync-rgb")?.addEventListener("click", () => {
        if (window.cwApp?.syncRgbAccent) {
            void window.cwApp.syncRgbAccent(draft.accent);
        }
    });

    byId("reset-appearance").addEventListener("click", async () => {
        if (await confirmDashboardAction("Reset Theme Studio", "Restore the CoreWatch Classic colors and effects?", "Reset")) preview({ ...classicDashboardTheme });
    });
    const studioTabs = [...panel.querySelectorAll("[data-studio-tab]")];
    function selectStudio(next) {
        for (const tab of studioTabs) {
            const selected = tab.dataset.studioTab === next;
            tab.classList.toggle("active", selected);
            tab.setAttribute("aria-pressed", String(selected));
        }
        byId("theme-colors-pane").hidden = next !== "colors";
        byId("theme-wallpaper-pane").hidden = next !== "wallpaper";
    }
    studioTabs.forEach((tab) => tab.addEventListener("click", () => selectStudio(tab.dataset.studioTab)));
    selectStudio("colors");
    byId("theme-collapse").addEventListener("click", (event) => {
        const collapsed = panel.classList.toggle("studio-collapsed");
        event.currentTarget.setAttribute("aria-expanded", String(!collapsed));
        event.currentTarget.setAttribute("aria-label", (collapsed ? "Expand" : "Collapse") + " Theme Studio");
        event.currentTarget.textContent = collapsed ? "▸" : "▾";
    });
    for (const [id, kind] of [["export-appearance", "theme_export"], ["import-appearance", "theme_import"]]) {
        byId(id).addEventListener("click", async (event) => {
            const button = event.currentTarget;
            button.disabled = true;
            try {
                const value = await core.invoke("settings_action", { action: kind === "theme_export" ? { kind, theme: draft } : { kind } });
                if (kind === "theme_import" && value) preview(value);
                if (kind === "theme_export" && value) status.textContent = "Theme exported";
            } catch (error) { status.textContent = String(error); }
            finally { button.disabled = false; }
        });
    }
    function commit() {
        clearTimeout(timer);
        if (draft === saved || scheduled === draft) return;
        const choice = draft;
        scheduled = choice;
        status.textContent = "Saving…";
        void save({ theme: choice }).then((updated) => {
            saved = updated.theme;
            if (draft === choice) {
                draft = saved;
                status.textContent = "Saved";
                paint();
            }
        }).catch((error) => {
            status.textContent = "Theme could not be saved. " + String(error);
        }).finally(() => {
            if (scheduled === choice) scheduled = null;
        });
    }

    async function changeWallpaper(operation, isSelect = false) {
        imageBusy = true;
        paint(false);
        try {
            const nextVersion = await operation();
            const changed = nextVersion !== wallpaperVersion;
            wallpaperVersion = nextVersion;
            if (isSelect && wallpaperVersion != null && changed && draft.surfaceOpacity >= 96) {
                preview({ ...draft, surfaceOpacity: 84 });
                window.showToast?.("Wallpaper applied · card opacity set to 84% so it shows through", "ok");
            }
            status.textContent = wallpaperVersion == null ? "Wallpaper removed" : "Wallpaper saved";
        } catch (error) {
            status.textContent = String(error);
        } finally {
            imageBusy = false;
            paint(false);
        }
    }

    pickImage.addEventListener("click", () => changeWallpaper(async () =>
        (await core.invoke("settings_action", { action: { kind: "wallpaper" } })) ?? wallpaperVersion, true));
    removeImage.addEventListener("click", () => changeWallpaper(async () => {
        await core.invoke("remove_dashboard_wallpaper");
        return null;
    }));

    paint(false);
    return {
        setTheme,
        setWallpaperVersion(version) {
            wallpaperVersion = version;
            paint(false);
        },
        applyPresetById(id) {
            const found = appearancePalettes.find(([pid]) => pid === id);
            if (found) {
                preview({ ...draft, ...paletteColors(found[2]), presetId: found[0] });
                window.showToast?.(`Theme: ${found[1]}`, "ok");
            }
        },
        commit
    };
}
