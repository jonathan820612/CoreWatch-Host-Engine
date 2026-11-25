"use strict";

let confirmDestructiveActions = true;
function confirmDashboardAction(title, message, label = "Apply") {
    return confirmDestructiveActions ? askDashboard(title, message, null, 0, label) : Promise.resolve(true);
}

function createAppSettings(core, save, modulesChanged, status) {
    const invoke = (action) => core.invoke("settings_action", { action });
    const fieldNames = [
        ["startWithWindows", "Start with Windows"], ["startMinimized", "Start minimized to tray"],
        ["minimizeToTrayOnClose", "Minimize to tray on EXIT"], ["confirmDestructiveActions", "Confirm before destructive actions"],
        ["autoCheckCoreWatchUpdates", "Auto-check for updates"]
    ];
    const paths = [
        ["projectsRoot", "projects", "Default Git / Projects root"], ["exportsRoot", "exports", "Exports & Support Bundles"],
        ["wslInstallRoot", "wsl", "WSL install / export folder"], ["organizerDestRoot", "organizer", "File Organizer destination"],
        ["editorPath", "editor", "Code Editor executable"]
    ];
    const installed = new Set(["netmanager", "tasksports"]);
    const generalInputs = new Map();
    const pathInputs = new Map();
    const tabs = [...byId("settings-tabs").querySelectorAll("button")];
    let settings;
    let catalog;
    let startupStatus;
    let updateStarted = false;
    let pending = Promise.resolve();

    function action(label, click) {
        const button = actionButton(label, click);
        button.className = "console-clear-btn";
        return button;
    }

    function select(name) {
        for (const tab of tabs) {
            const selected = tab.dataset.settingsTab === name;
            tab.classList.toggle("active", selected);
            tab.setAttribute("aria-selected", String(selected));
            tab.tabIndex = selected ? 0 : -1;
            byId(tab.getAttribute("aria-controls")).hidden = !selected;
        }
        if (name === "general") void refreshStartup();
    }

    tabs.forEach((tab, index) => {
        tab.addEventListener("click", () => select(tab.dataset.settingsTab));
        tab.addEventListener("keydown", (event) => {
            const targets = { ArrowLeft: (index + tabs.length - 1) % tabs.length, ArrowRight: (index + 1) % tabs.length, Home: 0, End: tabs.length - 1 };
            const next = tabs[targets[event.key]];
            if (!next) return;
            event.preventDefault();
            select(next.dataset.settingsTab);
            next.focus();
        });
    });

    function report(error) { status.textContent = String(error); }

    async function refreshStartup() {
        try { startupStatus = await invoke({ kind: "startup" }); }
        catch (error) { startupStatus = { enabled: false, detail: String(error) }; }
        const item = generalInputs.get("startWithWindows");
        if (!item.input.disabled) item.input.checked = startupStatus.enabled;
        item.badge.textContent = startupStatus.detail;
        item.badge.classList.toggle("diag-ok", startupStatus.enabled);
        item.badge.classList.toggle("diag-neutral", !startupStatus.enabled);
    }

    function change(patch) {
        const operation = pending.then(async () => {
            if (!settings) return;
            status.textContent = "Saving…";
            try {
                apply(await save(patch(settings)));
                status.textContent = "Saved";
            } catch (error) {
                apply(settings);
                report(error);
            }
        });
        pending = operation.catch(() => {});
        return operation;
    }

    for (const [key, caption] of fieldNames) {
        const row = element("label", "settings-check");
        const input = element("input", "");
        input.type = "checkbox";
        input.dataset.generalSetting = key;
        const badge = element("span", "diag-pill diag-neutral", "Checking…");
        row.append(input, element("span", "", caption));
        const startup = key === "startWithWindows";
        if (startup) row.append(badge);
        input.addEventListener("change", async () => {
            const checked = input.checked;
            input.disabled = true;
            try {
                await change((settings) => startup ? { startWithWindows: checked } : { general: { ...settings.general, [key]: checked } });
            } finally {
                input.disabled = false;
                if (startup) await refreshStartup();
            }
        });
        generalInputs.set(key, { input, badge });
        byId("settings-general-fields").append(row);
    }

    for (const [key, location, caption] of paths) {
        const field = element("fieldset", "dashboard-option-group settings-path");
        const input = element("input", "tab-search-input");
        input.type = "text";
        input.dataset.directory = key;
        input.setAttribute("aria-label", caption);
        const set = (value) => change((settings) => ({ directories: { ...settings.directories, [key]: value.trim().replace(/^"|"$/g, "") } }));
        input.addEventListener("change", () => set(input.value));
        const buttons = element("div", "panel-actions");
        const run = (request, result) => async (event) => {
            const button = event.currentTarget;
            button.disabled = true;
            try { await pending; await result(await invoke(request)); }
            catch (error) { report(error); }
            finally { button.disabled = false; }
        };
        buttons.append(action("Browse…", run({ kind: "browse", location }, (path) => path && set(path))),
            action("Open", run({ kind: "open", location }, () => {})));
        if (location === "editor") {
            for (const [editor, label] of [["vs_code", "VS Code"], ["cursor", "Cursor"]]) {
                buttons.append(action(`Detect ${label}`, run({ kind: "detect", editor }, (path) => {
                    if (!path) { status.textContent = `${label} was not found.`; return; }
                    return set(path);
                })));
            }
        }
        field.append(element("legend", "", caption), input, buttons);
        byId("settings-directories").append(field);
        pathInputs.set(key, input);
    }

    async function checkUpdates(interactive) {
        const button = byId("settings-check-update");
        if (button.disabled) return;
        button.disabled = true;
        show("settings-update-status", "Checking GitHub releases…");
        try {
            const result = await invoke({ kind: "check_updates" });
            const release = result.rust_release;
            const versions = [release, result.current].map((value) => value?.match(/\d+\.\d+\.\d+/)?.[0].split(".").map(Number));
            const [remote, current] = versions;
            const difference = remote && current ? remote[0] - current[0] || remote[1] - current[1] || remote[2] - current[2] : 0;
            const message = release ? difference > 0 ? `Rust update available: ${release}.` : `Latest Rust package: ${release}.`
                : result.latest ? `Latest CoreWatch release: ${result.latest}. A Rust package is not published in the release feed.` : "No CoreWatch releases found.";
            show("settings-update-status", message);
            if (!interactive && difference > 0) log(message);
        } catch (error) { show("settings-update-status", String(error)); }
        finally { button.disabled = false; }
    }

    byId("settings-check-update").addEventListener("click", () => checkUpdates(true));
    for (const [id, kind] of [["settings-data-folder", "open_data"], ["settings-open-releases", "open_releases"]]) {
        byId(id).addEventListener("click", () => invoke({ kind }).catch(report));
    }

    function renderModules() {
        if (!catalog || !settings) return;
        const disabled = settings.modules.disabled;
        byId("settings-modules").replaceChildren(...catalog.modules.map((module) => {
            const ready = installed.has(module.id);
            const enabled = ready && !disabled.includes(module.id);
            const row = element("div", "settings-module-row");
            const name = element("div", "settings-module-name");
            name.append(element("strong", "", `${module.icon} ${module.shortName}`), element("small", "", module.group));
            const badge = element("span", "diag-pill " + (enabled ? "diag-ok" : ready ? "diag-warn" : "diag-neutral"), enabled ? "Installed" : ready ? "Hidden" : "Not Installed");
            row.append(name, badge);
            if (ready) {
                const control = action(enabled ? "Hide" : "Show", (event) => {
                    event.currentTarget.disabled = true;
                    void change((settings) => ({ modules: { disabled: enabled ? [...settings.modules.disabled, module.id] : settings.modules.disabled.filter((id) => id !== module.id) } }));
                });
                control.dataset.module = module.id;
                control.setAttribute("aria-label", `${enabled ? "Hide" : "Show"} ${module.shortName}`);
                row.append(control);
            }
            return row;
        }));
    }

    function apply(next) {
        settings = next;
        confirmDestructiveActions = next.general.confirmDestructiveActions;
        for (const [key, item] of generalInputs) item.input.checked = key === "startWithWindows" && startupStatus ? startupStatus.enabled : next.general[key];
        for (const [key, input] of pathInputs) if (document.activeElement !== input) input.value = next.directories[key];
        modulesChanged(next.modules.disabled);
        renderModules();
    }

    async function initialize() {
        try {
            catalog = await invoke({ kind: "catalog" });
            byId("settings-version").textContent = `CoreWatch Rust ${catalog.version} · WebView2`;
            renderModules();
            if (!updateStarted && !catalog.smoke && settings?.general.autoCheckCoreWatchUpdates) {
                updateStarted = true;
                void checkUpdates(false);
            }
        } catch (error) { report(error); }
    }

    select("general");
    window.addEventListener("focus", () => {
        if (byId("preferences-panel").matches(":popover-open") && !byId("settings-pane-general").hidden) void refreshStartup();
    });
    return { apply, initialize, opened: refreshStartup };
}
