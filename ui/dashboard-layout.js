"use strict";

const fullDashboardLayout = {
    order: ["hardware", "identity", "storage", "infra", "network", "console"],
    wide: ["network", "console"],
    hidden: [],
    docked: [],
    collapsed: [],
    hiddenMetrics: [],
    heights: {}
};

const dashboardPresets = {
    Full: fullDashboardLayout,
    Hardware: {
        ...fullDashboardLayout,
        order: ["hardware", "storage", "infra", "identity", "network", "console"],
        wide: ["hardware"],
        hidden: ["identity", "network", "console"]
    },
    Network: {
        ...fullDashboardLayout,
        order: ["network", "hardware", "storage", "console", "identity", "infra"],
        hidden: ["identity", "infra"],
        hiddenMetrics: ["hw-pagefile"]
    },
    Compact: {
        ...fullDashboardLayout,
        order: ["hardware", "storage", "network", "identity", "infra", "console"],
        wide: ["network"],
        hidden: ["identity", "infra", "console"],
        hiddenMetrics: ["hw-pagefile", "net-defender", "net-speedtest"]
    }
};

const dashboardMetricLabels = {
    "hw-cpu": "Processor",
    "hw-gpu": "Graphics",
    "hw-vram": "VRAM allocation",
    "hw-ram": "RAM and cache",
    "hw-pagefile": "Pagefile",
    "hw-topproc": "Top process",
    "id-host": "Host and domain",
    "id-os": "Windows version",
    "id-runtime": "Runtime and boot",
    "id-java": "Java version",
    "id-telemetry": "Windows telemetry",
    "id-stability": "Privilege and stability",
    "infra-board": "Motherboard and BIOS",
    "infra-power": "Power plan and uptime",
    "infra-audio": "Audio devices",
    "infra-display": "Displays",
    "net-defender": "Defender indicators",
    "net-dnsarp": "DNS and ARP",
    "net-drivers": "Adapter drivers and status",
    "net-speedtest": "Speed test",
    "net-bandwidth": "Live throughput"
};

function createDashboardLayout(save) {
    const grid = byId("viewDashboardGrid");
    const list = byId("layout-cards");
    const presetBar = byId("layout-presets");
    const status = byId("layout-save-status");
    const dock = byId("dock-cards");
    const dockPanel = byId("dashboard-dock");
    const dockToggle = byId("dock-toggle");
    const sidePullTab = byId("sideDockPullTab");
    const cards = new Map([...grid.querySelectorAll(":scope > [data-card-id]")].map((card) => [card.dataset.cardId, card]));
    const controls = new Map();
    const metricChecks = new Map();
    const presetButtons = new Map();
    let layout = fullDashboardLayout;
    let activeDrag = null;
    let isEditing = false;

    const empty = element("div", "dashboard-empty");
    empty.append(element("p", "", "All dashboard cards are hidden."),
        actionButton("Show all cards on grid", () => change({ ...layout, hidden: [], docked: [] })));
    grid.append(empty);

    function toggle(key, id) {
        const existing = layout[key];
        const values = existing.includes(id) ? existing.filter((value) => value !== id) : [...existing, id];
        void change({ ...layout, [key]: values });
    }

    function place(id, location) {
        const hidden = layout.hidden.filter((other) => other !== id);
        const docked = layout.docked.filter((other) => other !== id);
        if (location === "hide") hidden.push(id);
        if (location === "dock") docked.push(id);
        void change({ ...layout, hidden, docked });
    }

    const snapRightBtn = byId("dock-snap-right");
    if (typeof enablePanelDrag === "function") {
        enablePanelDrag(dockPanel, {
            storageKey: "cw-dock-pos-v1",
            onFloatChange(floating) {
                if (snapRightBtn) snapRightBtn.hidden = !floating;
            }
        });
    }
    snapRightBtn?.addEventListener("click", () => dockPanel._resetPosition?.());
    dockPanel.querySelector(".draggable-panel-header")?.addEventListener("dblclick", (ev) => {
        if (!ev.target.closest("button")) dockPanel._resetPosition?.();
    });

    // Vertically movable right-edge pull tab (clamped cleanly below header)
    const TAB_Y_KEY = "cw-dock-tab-y-v1";
    function clampPullTabY(y) {
        const headerBottom = Math.ceil(document.querySelector(".app-header-deck")?.getBoundingClientRect().bottom || 92);
        const tabH = sidePullTab?.offsetHeight || 48;
        const minY = headerBottom + 12;
        const maxY = Math.max(minY, window.innerHeight - tabH - 16);
        return Math.round(Math.min(maxY, Math.max(minY, y)));
    }
    function applySavedPullTabY() {
        if (!sidePullTab) return;
        let saved = null;
        try {
            const raw = localStorage.getItem(TAB_Y_KEY);
            if (raw != null && Number.isFinite(Number(raw))) saved = Number(raw);
        } catch {}
        if (saved != null) {
            sidePullTab.style.top = clampPullTabY(saved) + "px";
        } else {
            sidePullTab.style.top = clampPullTabY(Math.round(window.innerHeight * 0.66)) + "px";
        }
    }
    let tabDrag = null;
    let suppressNextTabClick = false;
    if (sidePullTab) {
        sidePullTab.addEventListener("pointerdown", (ev) => {
            if (ev.button !== 0) return;
            const rect = sidePullTab.getBoundingClientRect();
            tabDrag = { startY: ev.clientY, offsetY: ev.clientY - rect.top, moved: false };
            try { sidePullTab.setPointerCapture(ev.pointerId); } catch {}
        });
        sidePullTab.addEventListener("pointermove", (ev) => {
            if (!tabDrag) return;
            if (!tabDrag.moved && Math.abs(ev.clientY - tabDrag.startY) < 5) return;
            tabDrag.moved = true;
            sidePullTab.style.top = clampPullTabY(ev.clientY - tabDrag.offsetY) + "px";
        });
        const finishTabDrag = () => {
            if (!tabDrag) return;
            if (tabDrag.moved) {
                suppressNextTabClick = true;
                try { localStorage.setItem(TAB_Y_KEY, String(parseFloat(sidePullTab.style.top) || 0)); } catch {}
            }
            tabDrag = null;
        };
        sidePullTab.addEventListener("lostpointercapture", finishTabDrag);
        window.addEventListener("pointerup", finishTabDrag);
        window.addEventListener("resize", () => {
            if (!sidePullTab.hidden) applySavedPullTabY();
        });
    }

    function syncPullTab() {
        if (!sidePullTab) return;
        const dockOpen = dockPanel.matches(":popover-open");
        sidePullTab.hidden = !layout.docked.length || dockOpen;
        show("sideDockPullCount", layout.docked.length);
        if (!sidePullTab.hidden) applySavedPullTabY();
    }

    function showDock(showIt) {
        if (showIt && !layout.docked.length) return;
        if (showIt) window.dispatchEvent(new CustomEvent("cw-close-overlays", { detail: { except: "dashboard-dock" } }));
        if (showIt && !dockPanel.matches(":popover-open")) {
            dockPanel.showPopover();
            dockPanel._clampPosition?.();
        }
        if (!showIt && dockPanel.matches(":popover-open")) dockPanel.hidePopover();
        dockToggle.setAttribute("aria-expanded", String(showIt));
        dockToggle.classList.toggle("active", showIt);
        syncPullTab();
    }
    dockToggle.addEventListener("click", () => showDock(!dockPanel.matches(":popover-open")));
    sidePullTab?.addEventListener("click", () => {
        if (suppressNextTabClick) { suppressNextTabClick = false; return; }
        showDock(true);
    });
    byId("dock-close").addEventListener("click", () => showDock(false));
    byId("dock-open-layout")?.addEventListener("click", () => {
        showDock(false);
        byId("layout-toggle")?.click();
    });
    window.addEventListener("cw-close-overlays", (ev) => {
        if (ev.detail?.except !== "dashboard-dock" && dockPanel.matches(":popover-open")) showDock(false);
    });
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && dockPanel.matches(":popover-open") && !document.querySelector("dialog[open]")) {
            event.preventDefault();
            showDock(false);
        }
    });

    function move(id, offset) {
        const order = [...layout.order];
        const start = order.indexOf(id);
        const end = start + offset;
        if (start < 0 || end < 0 || end >= order.length) return;
        [order[start], order[end]] = [order[end], order[start]];
        void change({ ...layout, order });
    }

    async function change(next) {
        const previous = layout;
        apply(next);
        status.textContent = "Saving…";
        try {
            await save({ layout: next });
            if (layout === next) status.textContent = "Saved";
        } catch (error) {
            if (layout === next) {
                apply(previous);
                status.textContent = "Layout could not be saved. " + String(error);
            }
        }
    }

    function applyCardHeight(card, id, heightsMap) {
        const custom = heightsMap && Number.isFinite(heightsMap[id]) ? Math.round(heightsMap[id]) : null;
        if (custom && custom >= 110) {
            card.classList.add("has-custom-height");
            if (id === "console") {
                card.style.height = custom + "px";
                card.style.minHeight = custom + "px";
            } else {
                card.style.minHeight = custom + "px";
                card.style.height = "auto";
            }
        } else {
            card.classList.remove("has-custom-height");
            card.style.minHeight = "";
            card.style.height = "";
        }
    }

    function apply(next) {
        const orderChanged = layout.order.join() !== next.order.join() || layout.docked.join() !== (next.docked ?? []).join();
        layout = {
            ...next,
            docked: next.docked ?? [],
            heights: next.heights ? { ...next.heights } : {}
        };
        for (const [id, card] of cards) {
            const visible = !layout.hidden.includes(id);
            const wide = layout.wide.includes(id);
            const collapsed = layout.collapsed.includes(id);
            const inDock = layout.docked.includes(id);
            const control = controls.get(id);
            const index = layout.order.indexOf(id);
            card.hidden = !visible;
            card.classList.toggle("card-wide", wide);
            card.classList.toggle("card-half", !wide);
            card.classList.toggle("card-collapsed", collapsed);
            if (!collapsed && !inDock) applyCardHeight(card, id, layout.heights);
            else {
                card.classList.remove("has-custom-height");
                card.style.minHeight = "";
                card.style.height = "";
            }
            for (const [placement, button] of control.placements) {
                const selected = placement === (!visible ? "hide" : inDock ? "dock" : "grid");
                button.classList.toggle("active", selected);
                button.setAttribute("aria-pressed", String(selected));
            }
            control.rowWidth.textContent = wide ? "Wide" : "Half";
            control.rowWidth.disabled = inDock;
            control.up.disabled = index === 0;
            control.down.disabled = index === layout.order.length - 1;
            const collapseLabel = (collapsed ? "Expand " : "Collapse ") + card.dataset.cardTitle;
            control.collapse.textContent = collapsed ? "+" : "−";
            control.collapse.setAttribute("aria-expanded", String(!collapsed));
            control.collapse.setAttribute("aria-label", collapseLabel);
            control.dockCollapse.textContent = collapsed ? "+" : "−";
            control.dockCollapse.setAttribute("aria-expanded", String(!collapsed));
            control.dockCollapse.setAttribute("aria-label", collapseLabel);
            control.dockCollapse.title = collapseLabel;
            control.width.textContent = wide ? "½" : "↔";
            control.width.setAttribute("aria-label", (wide ? "Use half width for " : "Widen ") + card.dataset.cardTitle);
        }
        if (orderChanged) {
            const focused = document.activeElement;
            for (const id of layout.order) {
                const card = cards.get(id);
                if (!card) continue;
                if (layout.docked.includes(id)) dock.append(card);
                else grid.insertBefore(card, empty);
                list.append(controls.get(id).row);
            }
            if (focused instanceof HTMLElement && list.contains(focused)) {
                const target = focused.disabled ? focused.closest("li")?.querySelector("button:not(:disabled)") : focused;
                target?.focus({ preventScroll: true });
            }
        }
        for (const card of cards.values()) {
            for (const node of card.querySelectorAll("[data-metric-key]")) node.classList.toggle("metric-hidden", layout.hiddenMetrics.includes(node.dataset.metricKey));
        }
        for (const [key, checkbox] of metricChecks) checkbox.checked = !layout.hiddenMetrics.includes(key);
        const presetKeys = ["order", "wide", "hidden", "docked", "collapsed", "hiddenMetrics"];
        for (const [preset, button] of presetButtons) {
            const active = presetKeys.every((key) => (preset[key] || []).join() === (layout[key] || []).join());
            button.classList.toggle("active", active);
            button.setAttribute("aria-pressed", String(active));
        }
        const gridEmpty = layout.hidden.length + layout.docked.length === cards.size;
        empty.hidden = !gridEmpty;
        empty.querySelector("p").textContent = layout.docked.length ? "No frames are assigned to the grid." : "All dashboard cards are hidden.";
        dockToggle.hidden = !layout.docked.length;
        show("dock-count", layout.docked.length);
        if (!layout.docked.length) showDock(false);
        else syncPullTab();
    }

    for (const [name, preset] of Object.entries(dashboardPresets)) {
        const labels = { Full: "🖥 Full Diagnostic", Hardware: "⚡ Hardware Bench", Network: "📡 NetOps Focus", Compact: "🎯 Compact Strip" };
        const button = actionButton(labels[name], () => change(preset));
        button.className = "filter-pill";
        button.dataset.layoutPreset = name.toLowerCase();
        presetBar.append(button);
        presetButtons.set(preset, button);
    }

    function layoutOption(labelText, title, action) {
        const label = element("label", "layout-card-option");
        const input = element("input", "");
        input.type = "checkbox";
        input.setAttribute("aria-label", title);
        input.addEventListener("change", action);
        label.append(input, document.createTextNode(labelText));
        return [label, input];
    }

    function controlButton(label, name, action, extra = "") {
        const button = actionButton(label, action);
        button.className = "card-ctrl-btn" + (extra ? " " + extra : "");
        button.setAttribute("aria-label", name);
        button.title = name;
        return button;
    }

    for (const [id, card] of cards) {
        const title = card.dataset.cardTitle;
        let header = card.querySelector(":scope > .console-header-row");
        if (!header) {
            const heading = card.querySelector(":scope > h2");
            header = element("div", "card-header-bar");
            heading.replaceWith(header);
            header.append(heading);
        }
        const edits = element("div", "card-edit-controls");
        const grip = element("span", "card-drag-grip", "⠿");
        grip.draggable = true;
        grip.title = "Drag " + title;
        grip.setAttribute("aria-hidden", "true");
        const collapse = controlButton("−", "Collapse " + title, () => toggle("collapsed", id), "ctrl-collapse");
        const width = controlButton("↔", "Widen " + title, () => toggle("wide", id));
        const hide = controlButton("×", "Hide " + title, () => place(id, "hide"), "ctrl-hide");
        const sendToDock = controlButton("◫", "Dock " + title, () => place(id, "dock"));
        edits.append(grip, collapse, width, sendToDock, hide);
        const dockCtrls = element("div", "dock-card-controls");
        const dockReturn = controlButton("↩ Grid", "Return " + title + " to grid", () => place(id, "grid"));
        const dockCollapse = controlButton("−", "Collapse " + title, () => toggle("collapsed", id));
        dockCtrls.append(dockReturn, dockCollapse);
        header.append(dockCtrls, edits);

        // Vertical-only resize handle at bottom of each frame (zero scrollbars, double-click resets to auto-fit)
        const resizeHandle = element("div", "card-resize-handle");
        resizeHandle.setAttribute("role", "separator");
        resizeHandle.setAttribute("aria-orientation", "horizontal");
        resizeHandle.setAttribute("aria-label", "Adjust " + title + " height vertically");
        resizeHandle.title = "Drag up/down to resize frame vertically · Double-click to auto-fit";
        resizeHandle.append(element("span", "card-resize-grip"));
        let resizeState = null;
        resizeHandle.addEventListener("pointerdown", (ev) => {
            if (ev.button !== 0 || card.classList.contains("card-collapsed") || layout.docked.includes(id)) return;
            ev.preventDefault();
            ev.stopPropagation();
            const startRect = card.getBoundingClientRect();
            // Measure natural minimum content height (temporarily clearing minHeight for non-console cards)
            let naturalMin = 120;
            if (id !== "console") {
                const prevMin = card.style.minHeight;
                const prevH = card.style.height;
                card.style.minHeight = "";
                card.style.height = "auto";
                naturalMin = Math.max(120, Math.ceil(card.getBoundingClientRect().height));
                card.style.minHeight = prevMin;
                card.style.height = prevH;
            }
            resizeState = {
                startY: ev.clientY,
                startHeight: Math.round(startRect.height),
                minHeight: naturalMin,
                currentHeight: Math.round(startRect.height),
                moved: false
            };
            card.classList.add("is-resizing-v");
            try { resizeHandle.setPointerCapture(ev.pointerId); } catch {}
        });
        resizeHandle.addEventListener("pointermove", (ev) => {
            if (!resizeState) return;
            const dy = ev.clientY - resizeState.startY;
            if (!resizeState.moved && Math.abs(dy) < 3) return;
            resizeState.moved = true;
            const nextH = Math.max(resizeState.minHeight, Math.min(1400, Math.round(resizeState.startHeight + dy)));
            resizeState.currentHeight = nextH;
            applyCardHeight(card, id, { [id]: nextH });
        });
        const finishResize = () => {
            if (!resizeState) return;
            const finalH = resizeState.currentHeight;
            const moved = resizeState.moved;
            const minH = resizeState.minHeight;
            resizeState = null;
            card.classList.remove("is-resizing-v");
            if (!moved) return;
            const nextHeights = { ...(layout.heights || {}) };
            if (id !== "console" && finalH <= minH + 4) {
                delete nextHeights[id];
            } else {
                nextHeights[id] = finalH;
            }
            void change({ ...layout, heights: nextHeights });
        };
        resizeHandle.addEventListener("lostpointercapture", finishResize);
        window.addEventListener("pointerup", finishResize);
        window.addEventListener("pointercancel", finishResize);
        resizeHandle.addEventListener("dblclick", (ev) => {
            ev.stopPropagation();
            if (!layout.heights || !(id in layout.heights)) return;
            const nextHeights = { ...layout.heights };
            delete nextHeights[id];
            void change({ ...layout, heights: nextHeights });
            window.showToast?.(`${title} height reset to auto-fit`, "info", 1800);
        });
        card.append(resizeHandle);
        const startDrag = (event) => {
            if (!isEditing && event.currentTarget === header) {
                event.preventDefault();
                return;
            }
            if (event.target.closest("button, select, input")) {
                event.preventDefault();
                return;
            }
            activeDrag = id;
            event.dataTransfer.setData("text/plain", id);
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setDragImage(header, 8, 8);
            card.classList.add("is-dragging");
        };
        const stopDrag = () => {
            activeDrag = null;
            card.classList.remove("is-dragging");
            for (const other of cards.values()) other.classList.remove("drag-before", "drag-after");
        };
        grip.addEventListener("dragstart", startDrag);
        grip.addEventListener("dragend", stopDrag);
        header.addEventListener("dragstart", startDrag);
        header.addEventListener("dragend", stopDrag);
        const afterMiddle = (event) => {
            const rect = header.getBoundingClientRect();
            return event.clientY > rect.bottom;
        };
        card.addEventListener("dragover", (event) => {
            if (!activeDrag || activeDrag === id) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "move";
            const after = afterMiddle(event);
            card.classList.toggle("drag-before", !after);
            card.classList.toggle("drag-after", after);
        });
        card.addEventListener("dragleave", (event) => {
            if (!card.contains(event.relatedTarget)) card.classList.remove("drag-before", "drag-after");
        });
        card.addEventListener("drop", (event) => {
            if (!activeDrag || activeDrag === id) return;
            event.preventDefault();
            const dragged = activeDrag;
            const after = Number(afterMiddle(event));
            activeDrag = null;
            for (const other of cards.values()) other.classList.remove("is-dragging", "drag-before", "drag-after");
            const order = layout.order.filter((value) => value !== dragged);
            order.splice(order.indexOf(id) + after, 0, dragged);
            void change({ ...layout, order });
        });

        const row = element("li", "layout-card-row");
        row.dataset.layoutCard = id;
        const placements = ["Grid", "Dock", "Hide"].map((name) => [name.toLowerCase(),
            controlButton(name, name + " " + title, () => place(id, name.toLowerCase()), "frame-location")]);
        const rowWidth = controlButton("Half", "Toggle width for " + title, () => toggle("wide", id));
        const up = controlButton("▲", "Move " + title + " up", () => move(id, -1));
        const down = controlButton("▼", "Move " + title + " down", () => move(id, 1));
        const options = element("div", "layout-row-controls");
        const locationBar = element("span", "layout-placements");
        locationBar.append(...placements.map(([, button]) => button));
        options.append(locationBar, up, down, rowWidth);
        row.append(element("strong", "", title), options);
        list.append(row);
        controls.set(id, { row, placements, rowWidth, up, down, collapse, dockCollapse, width });

        const keys = new Set([...card.querySelectorAll("[data-metric-key]")].map((node) => node.dataset.metricKey));
        if (!keys.size) continue;
        const details = element("details", "layout-metric-details");
        const metricGroup = element("div", "layout-metric-group");
        details.append(element("summary", "", title), metricGroup);
        for (const key of keys) {
            const caption = dashboardMetricLabels[key];
            const [label, input] = layoutOption(caption, "Show " + caption, () => toggle("hiddenMetrics", key));
            metricChecks.set(key, input);
            metricGroup.append(label);
        }
        byId("layout-metrics").append(details);
    }

    byId("reset-dashboard-layout").addEventListener("click", () => change(fullDashboardLayout));
    apply(fullDashboardLayout);
    return {
        apply,
        toggleDock: () => showDock(!dockPanel.matches(":popover-open")),
        editing: (editing) => {
            isEditing = editing;
            grid.classList.toggle("layout-edit-mode", editing);
            for (const card of cards.values()) {
                const hdr = card.querySelector(":scope > .card-header-bar, :scope > .console-header-row");
                if (hdr) hdr.draggable = editing;
            }
        }
    };
}
