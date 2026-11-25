"use strict";

const fullDashboardLayout = {
    order: ["hardware", "identity", "storage", "infra", "network", "console"],
    wide: ["network", "console"],
    hidden: [],
    collapsed: [],
    hiddenMetrics: []
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
    const cards = new Map([...grid.querySelectorAll(":scope > [data-card-id]")].map((card) => [card.dataset.cardId, card]));
    const controls = new Map();
    const metricChecks = new Map();
    const presetButtons = new Map();
    let layout = fullDashboardLayout;
    let activeDrag = null;

    const empty = element("div", "dashboard-empty");
    empty.append(element("p", "", "All dashboard cards are hidden."),
        actionButton("Show all cards", () => change({ ...layout, hidden: [] })));
    grid.append(empty);

    function toggle(key, id) {
        const existing = layout[key];
        const values = existing.includes(id) ? existing.filter((value) => value !== id) : [...existing, id];
        void change({ ...layout, [key]: values });
    }

    function move(id, offset) {
        const order = [...layout.order];
        const start = order.indexOf(id);
        const end = start + offset;
        if (start < 0 || end < 0 || end >= order.length) return;
        [order[start], order[end]] = [order[end], order[start]];
        void change({ ...layout, order });
    }

    async function change(next) {
        apply(next);
        status.textContent = "Saving…";
        try {
            await save({ layout: next });
            if (layout === next) status.textContent = "Saved";
        } catch (error) {
            if (layout === next) status.textContent = "Layout could not be saved. " + String(error);
        }
    }

    function apply(next) {
        const orderChanged = layout.order.join() !== next.order.join();
        layout = next;
        for (const [id, card] of cards) {
            const visible = !layout.hidden.includes(id);
            const wide = layout.wide.includes(id);
            const collapsed = layout.collapsed.includes(id);
            const control = controls.get(id);
            const index = layout.order.indexOf(id);
            card.hidden = !visible;
            card.classList.toggle("card-wide", wide);
            card.classList.toggle("card-half", !wide);
            card.classList.toggle("card-collapsed", collapsed);
            control.show.checked = visible;
            control.wide.checked = wide;
            control.fold.checked = collapsed;
            control.up.disabled = index === 0;
            control.down.disabled = index === layout.order.length - 1;
            control.collapse.textContent = collapsed ? "+" : "−";
            control.collapse.setAttribute("aria-expanded", String(!collapsed));
            control.collapse.setAttribute("aria-label", (collapsed ? "Expand " : "Collapse ") + card.dataset.cardTitle);
            control.width.textContent = wide ? "½" : "↔";
            control.width.setAttribute("aria-label", (wide ? "Use half width for " : "Widen ") + card.dataset.cardTitle);
        }
        if (orderChanged) {
            const focused = document.activeElement;
            for (const id of layout.order) {
                const card = cards.get(id);
                if (!card) continue;
                grid.insertBefore(card, empty);
                list.append(controls.get(id).row);
            }
            if (focused instanceof HTMLElement && list.contains(focused)) {
                const target = focused.disabled ? focused.closest("li")?.querySelector("button:not(:disabled)") : focused;
                target?.focus({ preventScroll: true });
            }
        }
        for (const node of grid.querySelectorAll("[data-metric-key]")) {
            node.classList.toggle("metric-hidden", layout.hiddenMetrics.includes(node.dataset.metricKey));
        }
        for (const [key, checkbox] of metricChecks) checkbox.checked = !layout.hiddenMetrics.includes(key);
        for (const [preset, button] of presetButtons) {
            const active = Object.keys(preset).every((key) => preset[key].join() === layout[key].join());
            button.classList.toggle("active", active);
            button.setAttribute("aria-pressed", String(active));
        }
        empty.hidden = layout.hidden.length !== cards.size;
    }

    for (const [name, preset] of Object.entries(dashboardPresets)) {
        const button = actionButton(name, () => change(preset));
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
        const hide = controlButton("×", "Hide " + title, () => toggle("hidden", id), "ctrl-hide");
        edits.append(grip, collapse, width, hide);
        header.append(edits);
        grip.addEventListener("dragstart", (event) => {
            activeDrag = id;
            event.dataTransfer.setData("text/plain", id);
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setDragImage(header, 8, 8);
            card.classList.add("is-dragging");
        });
        grip.addEventListener("dragend", () => {
            activeDrag = null;
            card.classList.remove("is-dragging");
            for (const other of cards.values()) other.classList.remove("drag-before", "drag-after");
        });
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
            const order = layout.order.filter((value) => value !== activeDrag);
            order.splice(order.indexOf(id) + Number(afterMiddle(event)), 0, activeDrag);
            void change({ ...layout, order });
        });

        const row = element("li", "layout-card-row");
        row.dataset.layoutCard = id;
        const [showLabel, show] = layoutOption("Show", "Show " + title, () => toggle("hidden", id));
        const [wideLabel, wide] = layoutOption("Wide", "Full width for " + title, () => toggle("wide", id));
        const [foldLabel, fold] = layoutOption("Fold", "Collapse " + title, () => toggle("collapsed", id));
        const up = controlButton("↑", "Move " + title + " up", () => move(id, -1));
        const down = controlButton("↓", "Move " + title + " down", () => move(id, 1));
        const options = element("div", "layout-row-controls");
        options.append(showLabel, wideLabel, foldLabel, up, down);
        row.append(element("strong", "", title), options);
        list.append(row);
        controls.set(id, { row, show, wide, fold, up, down, collapse, width });

        const keys = new Set([...card.querySelectorAll("[data-metric-key]")].map((node) => node.dataset.metricKey));
        if (!keys.size) continue;
        const metricGroup = element("fieldset", "layout-metric-group");
        metricGroup.append(element("legend", "", title));
        for (const key of keys) {
            const caption = dashboardMetricLabels[key];
            const [label, input] = layoutOption(caption, "Show " + caption, () => toggle("hiddenMetrics", key));
            metricChecks.set(key, input);
            metricGroup.append(label);
        }
        byId("layout-metrics").append(metricGroup);
    }

    byId("reset-dashboard-layout").addEventListener("click", () => change(fullDashboardLayout));
    apply(fullDashboardLayout);
    return {
        apply,
        editing: (editing) => grid.classList.toggle("layout-edit-mode", editing)
    };
}
