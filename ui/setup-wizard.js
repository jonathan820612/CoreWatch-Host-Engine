"use strict";

function createSetupWizard(core, callbacks) {
    const dialog = byId("cwSetupWizard");
    if (!dialog) return { open: () => {}, isOpen: () => false };

    const stepButtons = [...dialog.querySelectorAll("[data-wizard-step]")];
    const panes = [...dialog.querySelectorAll("[data-wizard-pane]")];
    const backBtn = byId("cwWizardBack");
    const nextBtn = byId("cwWizardNext");
    const skipBtn = byId("cwWizardSkip");
    const statusEl = byId("cwWizardStatus");
    const legacyBanner = byId("cwWizardLegacyBanner");
    const legacyImportBtn = byId("cwWizardImportLegacy");

    const cardMeta = [
        ["hardware", "⚡ Hardware Metrics"],
        ["identity", "👤 System Identity"],
        ["storage", "💾 Storage"],
        ["infra", "🛠️ System Infrastructure"],
        ["network", "📡 Network Profile"],
        ["console", "📑 Log Console"]
    ];

    const layoutPresetMeta = [
        ["Full", "🖥 Full Diagnostic", "All 6 cards visible with full-width Network & Log Console."],
        ["Hardware", "⚡ Hardware Bench", "Focus on CPU, GPU, Storage & Infrastructure telemetry."],
        ["Network", "📡 NetOps Focus", "Network card pinned wide at top alongside Hardware & Storage."],
        ["Compact", "🎯 Compact Strip", "Minimal 3-card dashboard for low-footprint monitoring."]
    ];

    const moduleRolePresets = {
        all: null, // All catalog modules
        essentials: ["tasksports", "diagx", "alerts", "updates", "snapshots", "backupsync", "battery", "security", "profiles", "startup", "apps", "appstore", "diskmap", "organizer", "rgbstudio", "thermal"],
        gamer: ["netmanager", "tasksports", "diagx", "alerts", "updates", "profiles", "startup", "diskmap", "rgbstudio", "thermal"],
        developer: ["netmanager", "tasksports", "diagx", "github", "jira", "wsl", "docker", "sshcerts", "homelab", "alerts", "updates", "backupsync", "profiles", "startup", "apps", "appstore", "diskmap", "rgbstudio", "thermal"],
        itpro: ["netmanager", "tasksports", "diagx", "sshcerts", "homelab", "alerts", "updates", "snapshots", "backupsync", "security", "profiles", "startup", "sharing", "apps", "appstore", "diskmap", "devices", "thermal"],
        minimal: []
    };

    const fontScales = {
        small: { body: "0.88", header: "0.94" },
        normal: { body: "1", header: "1" },
        large: { body: "1.12", header: "1.06" },
        xlarge: { body: "1.24", header: "1.10" }
    };

    let step = 0;
    let savedSnapshot = null;
    let draft = null;
    let catalog = null;
    let busy = false;
    let bootLowMemory = null;

    function cloneSettings(src) {
        return JSON.parse(JSON.stringify(src));
    }

    function previewDraft() {
        if (!draft) return;
        if (callbacks.previewTheme) callbacks.previewTheme(draft.theme);
        else applyDashboardTheme(draft.theme, "", false);
        const scale = fontScales[draft.general.fontSize] || fontScales.normal;
        document.documentElement.dataset.fontSize = draft.general.fontSize || "normal";
        document.documentElement.style.setProperty("--cw-font-scale", scale.body);
        document.documentElement.style.setProperty("--cw-header-font-scale", scale.header);
        callbacks.previewLayout?.(draft.layout);
    }

    function revertPreview() {
        if (savedSnapshot) callbacks.applySettings(savedSnapshot);
    }

    function setStep(nextStep) {
        step = Math.max(0, Math.min(3, nextStep));
        stepButtons.forEach((btn, idx) => {
            btn.classList.toggle("is-active", idx === step);
            btn.classList.toggle("is-done", idx < step);
            btn.setAttribute("aria-current", idx === step ? "step" : "false");
        });
        panes.forEach((pane, idx) => {
            pane.hidden = idx !== step;
        });
        backBtn.hidden = step === 0;
        nextBtn.textContent = step === 3 ? "✓ Finish & Launch Dashboard" : "Next →";
        statusEl.textContent = `Step ${step + 1} of 4`;
        byId("cwWizardBody")?.scrollTo({ top: 0, behavior: "instant" });
    }

    function renderStep1Theme() {
        const grid = byId("cwWizardThemeGrid");
        const nodes = [];
        for (const [id, label, colors] of appearancePalettes) {
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "cw-wizard-theme-card" + (draft.theme.presetId === id ? " is-selected" : "");
            btn.dataset.wizardTheme = id;
            const preview = element("div", "cw-wizard-theme-preview");
            preview.style.background = colors[0];
            const s1 = element("span", "");
            s1.style.background = colors[1];
            const s2 = element("span", "");
            s2.style.background = colors[6];
            preview.append(s1, s2);
            btn.append(preview, element("span", "cw-wizard-theme-name", label));
            btn.addEventListener("click", () => {
                draft.theme = { ...draft.theme, ...paletteColors(colors), presetId: id };
                previewDraft();
                renderStep1Theme();
            });
            nodes.push(btn);
        }
        grid.replaceChildren(...nodes);

        const accentInput = byId("cwWizardAccent");
        const accentHex = byId("cwWizardAccentHex");
        accentInput.value = draft.theme.accent;
        accentHex.textContent = draft.theme.accent.toUpperCase();

        const opacityInput = byId("cwWizardSurfaceOpacity");
        opacityInput.value = String(draft.theme.surfaceOpacity);
        byId("cwWizardSurfaceOpacityVal").value = draft.theme.surfaceOpacity + "%";

        const blurInput = byId("cwWizardCardBlur");
        blurInput.value = String(draft.theme.cardBlur);
        byId("cwWizardCardBlurVal").value = draft.theme.cardBlur + " px";

        for (const btn of dialog.querySelectorAll("[data-wizard-font]")) {
            const active = btn.dataset.wizardFont === (draft.general.fontSize || "normal");
            btn.classList.toggle("is-selected", active);
            btn.setAttribute("aria-pressed", String(active));
        }
    }

    function layoutMatchesPreset(layout, preset) {
        return ["order", "wide", "hidden", "docked", "collapsed", "hiddenMetrics"]
            .every((key) => (layout[key] || []).join() === (preset[key] || []).join());
    }

    function renderStep2Layout() {
        const presetBox = byId("cwWizardLayoutPresets");
        const presetNodes = [];
        for (const [key, title, desc] of layoutPresetMeta) {
            const preset = dashboardPresets[key];
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "cw-wizard-preset-card" + (layoutMatchesPreset(draft.layout, preset) ? " is-selected" : "");
            btn.dataset.wizardLayout = key.toLowerCase();
            btn.append(element("strong", "", title), element("small", "", desc));
            btn.addEventListener("click", () => {
                draft.layout = cloneSettings(preset);
                previewDraft();
                renderStep2Layout();
            });
            presetNodes.push(btn);
        }
        presetBox.replaceChildren(...presetNodes);

        const cardsBox = byId("cwWizardLayoutCards");
        const cardNodes = [];
        for (const [id, label] of cardMeta) {
            const isHidden = draft.layout.hidden.includes(id);
            const isDocked = !isHidden && draft.layout.docked.includes(id);
            const isWide = draft.layout.wide.includes(id);
            const placement = isHidden ? "hide" : isDocked ? "dock" : "grid";
            const row = element("div", "cw-wizard-card-row");
            row.append(element("strong", "", label));
            const actions = element("div", "cw-wizard-card-actions");
            const group = element("div", "layout-placements");
            for (const [mode, caption] of [["grid", "Grid"], ["dock", "Dock"], ["hide", "Hide"]]) {
                const b = actionButton(caption, () => {
                    draft.layout.hidden = draft.layout.hidden.filter((v) => v !== id);
                    draft.layout.docked = draft.layout.docked.filter((v) => v !== id);
                    if (mode === "hide") draft.layout.hidden.push(id);
                    if (mode === "dock") draft.layout.docked.push(id);
                    previewDraft();
                    renderStep2Layout();
                });
                b.className = "card-ctrl-btn" + (placement === mode ? " active" : "");
                b.setAttribute("aria-pressed", String(placement === mode));
                group.append(b);
            }
            const widthBtn = actionButton(isWide ? "Wide" : "Half", () => {
                if (draft.layout.wide.includes(id)) draft.layout.wide = draft.layout.wide.filter((v) => v !== id);
                else draft.layout.wide = [...draft.layout.wide, id];
                previewDraft();
                renderStep2Layout();
            });
            widthBtn.className = "card-ctrl-btn";
            widthBtn.disabled = placement !== "grid";
            actions.append(group, widthBtn);
            row.append(actions);
            cardNodes.push(row);
        }
        cardsBox.replaceChildren(...cardNodes);
    }

    function renderStep3TelemetryAndMode() {
        const isAdmin = Boolean(draft.general.runAsAdmin);
        for (const card of dialog.querySelectorAll("[data-wizard-priv]")) {
            const wantAdmin = card.dataset.wizardPriv === "admin";
            const radio = card.querySelector("input");
            if (radio) radio.checked = wantAdmin === isAdmin;
            card.classList.toggle("is-selected", wantAdmin === isAdmin);
        }
        const sessionPill = byId("cwWizardPrivSession");
        if (sessionPill) {
            const elevated = Boolean(catalog?.elevated);
            sessionPill.textContent = elevated ? "Active session: Administrator" : "Active session: Standard User";
            sessionPill.className = "diag-pill " + (elevated ? "diag-ok" : "diag-neutral");
        }
        const privNote = byId("cwWizardPrivNote");
        if (privNote) {
            const elevated = Boolean(catalog?.elevated);
            if (isAdmin && !elevated) {
                privNote.textContent = "After clicking Finish, RustCoreWatch will offer to restart as Administrator.";
            } else if (!isAdmin && elevated) {
                privNote.textContent = "After clicking Finish, RustCoreWatch will offer to switch back to Standard User mode.";
            } else {
                privNote.textContent = "Matches your current session privilege level — no restart required.";
            }
        }

        for (const btn of dialog.querySelectorAll("[data-wizard-poll]")) {
            const active = btn.dataset.wizardPoll === draft.telemetry.pollingProfile;
            btn.classList.toggle("is-selected", active);
            btn.setAttribute("aria-pressed", String(active));
        }
        for (const btn of dialog.querySelectorAll("[data-wizard-unit]")) {
            const active = btn.dataset.wizardUnit === draft.telemetry.temperatureUnit;
            btn.classList.toggle("is-selected", active);
            btn.setAttribute("aria-pressed", String(active));
        }

        byId("cwWizardStartWindows").checked = Boolean(draft.general.startWithWindows);
        byId("cwWizardLowMemory").checked = Boolean(draft.general.lowMemoryMode);
        byId("cwWizardStartMinimized").checked = Boolean(draft.general.startMinimized);
        byId("cwWizardMinTrayClose").checked = Boolean(draft.general.minimizeToTrayOnClose);
    }

    function renderStep4Modules() {
        const modules = catalog?.modules || [];
        const disabled = new Set(draft.modules.disabled || []);
        const enabledCount = modules.filter((m) => !disabled.has(m.id)).length;
        const countEl = byId("cwWizardModCount");
        if (countEl) countEl.textContent = `${enabledCount} of ${modules.length} tabs enabled`;

        const groups = new Map();
        for (const mod of modules) {
            const g = mod.group || "Other";
            if (!groups.has(g)) groups.set(g, []);
            groups.get(g).push(mod);
        }
        const container = byId("cwWizardModGroups");
        const groupNodes = [];
        for (const [groupName, items] of groups) {
            const box = element("div", "cw-wizard-mod-group");
            const allOn = items.every((m) => !disabled.has(m.id));
            const head = element("div", "cw-wizard-mod-group-head");
            const toggleAllBtn = actionButton(allOn ? "Hide group" : "Show all", () => {
                const nextDisabled = new Set(draft.modules.disabled);
                for (const m of items) {
                    if (allOn) nextDisabled.add(m.id);
                    else nextDisabled.delete(m.id);
                }
                draft.modules.disabled = [...nextDisabled];
                renderStep4Modules();
            });
            toggleAllBtn.className = "card-ctrl-btn";
            head.append(element("strong", "", `${groupName} (${items.filter((m) => !disabled.has(m.id)).length}/${items.length})`), toggleAllBtn);
            box.append(head);

            for (const mod of items) {
                const label = element("label", "cw-wizard-mod-item");
                const cb = document.createElement("input");
                cb.type = "checkbox";
                cb.dataset.wizardModule = mod.id;
                cb.checked = !disabled.has(mod.id);
                cb.addEventListener("change", () => {
                    const nextDisabled = new Set(draft.modules.disabled);
                    if (cb.checked) nextDisabled.delete(mod.id);
                    else nextDisabled.add(mod.id);
                    draft.modules.disabled = [...nextDisabled];
                    renderStep4Modules();
                });
                label.append(cb, document.createTextNode(`${mod.icon} ${mod.shortName}`));
                box.append(label);
            }
            groupNodes.push(box);
        }
        container.replaceChildren(...groupNodes);
    }

    function renderAll() {
        renderStep1Theme();
        renderStep2Layout();
        renderStep3TelemetryAndMode();
        renderStep4Modules();
    }

    // Wire static controls once
    stepButtons.forEach((btn, idx) => btn.addEventListener("click", () => setStep(idx)));
    backBtn.addEventListener("click", () => setStep(step - 1));
    nextBtn.addEventListener("click", () => {
        if (step < 3) setStep(step + 1);
        else void finish(false);
    });
    skipBtn.addEventListener("click", () => void finish(true));

    byId("cwWizardAccent").addEventListener("input", (ev) => {
        if (!draft) return;
        const hex = ev.target.value.toLowerCase();
        draft.theme = { ...draft.theme, accent: hex, accentLight: hex, presetId: "custom" };
        previewDraft();
        byId("cwWizardAccentHex").textContent = hex.toUpperCase();
        for (const card of dialog.querySelectorAll("[data-wizard-theme]")) card.classList.remove("is-selected");
    });
    byId("cwWizardSurfaceOpacity").addEventListener("input", (ev) => {
        if (!draft) return;
        draft.theme.surfaceOpacity = Number(ev.target.value);
        byId("cwWizardSurfaceOpacityVal").value = draft.theme.surfaceOpacity + "%";
        previewDraft();
    });
    byId("cwWizardCardBlur").addEventListener("input", (ev) => {
        if (!draft) return;
        draft.theme.cardBlur = Number(ev.target.value);
        byId("cwWizardCardBlurVal").value = draft.theme.cardBlur + " px";
        previewDraft();
    });
    for (const btn of dialog.querySelectorAll("[data-wizard-font]")) {
        btn.addEventListener("click", () => {
            if (!draft) return;
            draft.general.fontSize = btn.dataset.wizardFont;
            previewDraft();
            renderStep1Theme();
        });
    }
    for (const card of dialog.querySelectorAll("[data-wizard-priv]")) {
        card.addEventListener("click", () => {
            if (!draft) return;
            draft.general.runAsAdmin = card.dataset.wizardPriv === "admin";
            renderStep3TelemetryAndMode();
        });
    }
    for (const btn of dialog.querySelectorAll("[data-wizard-poll]")) {
        btn.addEventListener("click", () => {
            if (!draft) return;
            draft.telemetry.pollingProfile = btn.dataset.wizardPoll;
            renderStep3TelemetryAndMode();
        });
    }
    for (const btn of dialog.querySelectorAll("[data-wizard-unit]")) {
        btn.addEventListener("click", () => {
            if (!draft) return;
            draft.telemetry.temperatureUnit = btn.dataset.wizardUnit;
            renderStep3TelemetryAndMode();
        });
    }
    for (const [id, key] of [
        ["cwWizardStartWindows", "startWithWindows"],
        ["cwWizardLowMemory", "lowMemoryMode"],
        ["cwWizardStartMinimized", "startMinimized"],
        ["cwWizardMinTrayClose", "minimizeToTrayOnClose"]
    ]) {
        byId(id).addEventListener("change", (ev) => {
            if (draft) draft.general[key] = ev.target.checked;
        });
    }
    for (const btn of dialog.querySelectorAll("[data-wizard-mod-preset]")) {
        btn.addEventListener("click", () => {
            if (!draft || !catalog?.modules) return;
            const allow = moduleRolePresets[btn.dataset.wizardModPreset];
            if (allow === null) {
                draft.modules.disabled = [];
            } else {
                const allowSet = new Set(allow);
                draft.modules.disabled = catalog.modules.map((m) => m.id).filter((id) => !allowSet.has(id));
            }
            renderStep4Modules();
        });
    }
    legacyImportBtn?.addEventListener("click", async () => {
        if (busy) return;
        busy = true;
        legacyImportBtn.disabled = true;
        statusEl.textContent = "Importing legacy PowerShell preferences…";
        try {
            const imported = await core.invoke("import_dashboard_preferences");
            savedSnapshot = cloneSettings(imported);
            draft = cloneSettings(imported);
            previewDraft();
            renderAll();
            statusEl.textContent = "Legacy PowerShell preferences imported!";
            window.showToast?.("Imported theme, layout & telemetry from Legacy PowerShell Edition", "ok");
        } catch (error) {
            statusEl.textContent = String(error);
        } finally {
            busy = false;
            legacyImportBtn.disabled = false;
        }
    });

    dialog.addEventListener("cancel", (ev) => {
        ev.preventDefault();
        void finish(true);
    });

    async function finish(skipped) {
        if (busy || !dialog.open) return;
        busy = true;
        nextBtn.disabled = backBtn.disabled = skipBtn.disabled = true;
        statusEl.textContent = skipped ? "Closing setup…" : "Saving your configuration…";
        try {
            if (skipped) {
                revertPreview();
                const saved = await callbacks.save({ onboardingCompleted: true });
                callbacks.applySettings(saved);
                dialog.close("skip");
                return;
            }
            const nextGeneral = { ...draft.general, onboardingCompleted: true };
            const saved = await callbacks.save({
                theme: draft.theme,
                layout: draft.layout,
                telemetry: draft.telemetry,
                general: nextGeneral,
                startWithWindows: nextGeneral.startWithWindows,
                lowMemoryMode: nextGeneral.lowMemoryMode,
                runAsAdmin: nextGeneral.runAsAdmin,
                onboardingCompleted: true,
                modules: draft.modules
            });
            callbacks.applySettings(saved);
            await callbacks.refreshStartup?.();
            dialog.close("finish");

            if (!catalog?.smoke) {
                const elevated = Boolean(catalog?.elevated);
                const wantAdmin = Boolean(saved.general.runAsAdmin);
                const lowMemChanged = bootLowMemory !== null && Boolean(saved.general.lowMemoryMode) !== bootLowMemory;
                if (wantAdmin && !elevated) {
                    if (await askDashboard(
                        "Restart as Administrator?",
                        "Setup is saved! Restart RustCoreWatch as Administrator now to unlock CPU die sensors, SMBus RAM RGB, and system controls?",
                        null, 0, "Restart as Admin"
                    )) {
                        await core.invoke("elevate").catch((e) => window.showToast?.(String(e), "warn", 4500));
                        return;
                    }
                } else if (!wantAdmin && elevated) {
                    if (await askDashboard(
                        "Switch to Standard User Mode?",
                        "Setup is saved! Restart RustCoreWatch in Standard User mode now?",
                        null, 0, "Restart as User"
                    )) {
                        await core.invoke("relaunch_unelevated").catch((e) => window.showToast?.(String(e), "warn", 4500));
                        return;
                    }
                } else if (lowMemChanged) {
                    if (await askDashboard(
                        "Restart for Low-Memory Mode?",
                        "Low-Memory Mode requires a quick restart to disable/enable WebView2 GPU compositing. Restart now?",
                        null, 0, "Restart Now"
                    )) {
                        await core.invoke("relaunch_app").catch((e) => window.showToast?.(String(e), "warn", 4500));
                        return;
                    }
                }
                window.showToast?.("RustCoreWatch setup complete! Re-run anytime from Settings.", "ok", 3800);
            }
        } catch (error) {
            statusEl.textContent = String(error);
        } finally {
            busy = false;
            nextBtn.disabled = backBtn.disabled = skipBtn.disabled = false;
        }
    }

    function open(currentSettings, currentCatalog, startStep = 0) {
        if (!currentSettings || dialog.open) return;
        window.dispatchEvent(new CustomEvent("cw-close-overlays", { detail: { source: "wizard" } }));
        savedSnapshot = cloneSettings(currentSettings);
        draft = cloneSettings(currentSettings);
        catalog = currentCatalog || catalog || { modules: [], elevated: false, hasLegacySettings: false, smoke: false };
        if (bootLowMemory === null) bootLowMemory = Boolean(currentSettings.general.lowMemoryMode);
        if (legacyBanner) legacyBanner.hidden = !catalog.hasLegacySettings;
        renderAll();
        setStep(startStep);
        dialog.showModal();
    }

    return {
        open,
        isOpen: () => dialog.open,
        closeWithoutSave: () => {
            if (!dialog.open) return;
            revertPreview();
            dialog.close("cancel");
        }
    };
}
