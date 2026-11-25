"use strict";

function createTasksView(invoke) {
    const search = byId("tasks-search");
    const sort = byId("tasks-sort");
    const liveButton = byId("tasks-live");
    const refreshButton = byId("tasks-refresh");
    const filters = byId("tasks-filters");
    const status = byId("tasks-status");
    const table = byId("tasks-rows");
    const locale = new Intl.NumberFormat();
    let snapshot = null;
    let owners = new Map();
    let active = false;
    let live = false;
    let timer;
    let refreshing = null;
    let changing = false;
    let notice = "";
    let pane = "process";
    let filter = "all";

    const tabs = [...byId("tasks-panes").querySelectorAll("button")];
    const ruleSets = {
        service: [["all", "All Services"], ["auto", "⚠ Stopped Auto"], ["running", "Running"], ["stopped", "Stopped"], ["disabled", "Disabled"]],
        socket: [["listen", "Listening Ports"], ["established", "Established TCP"], ["udp", "UDP Endpoints"], ["all", "All Sockets"]]
    };
    const isStoppedAuto = (service) => service.state === "Stopped" && service.start_mode === "Auto" && !service.delayed_auto_start;
    const listen = (socket) => socket.state === "Listen" || socket.protocol === "UDP";
    const boolButton = (button, on) => { button.classList.toggle("active", on); button.setAttribute("aria-pressed", String(on)); };

    function searchMatch(...values) {
        const text = values.filter((value) => value != null).join(" ").toLowerCase();
        return search.value.toLowerCase().trim().split(/\s+/).every((word) => text.includes(word));
    }

    function serviceMatches(service) {
        switch (filter) {
            case "auto": return isStoppedAuto(service);
            case "running": return service.state === "Running";
            case "stopped": return service.state === "Stopped";
            case "disabled": return service.start_mode === "Disabled";
            default: return true;
        }
    }

    function socketMatches(socket) {
        switch (filter) {
            case "listen": return listen(socket);
            case "established": return socket.state === "Established";
            case "udp": return socket.protocol === "UDP";
            default: return true;
        }
    }

    function button(label, handler, danger = false) {
        const node = actionButton(label, handler);
        node.className = "console-clear-btn" + (danger ? " btn-danger" : "");
        return node;
    }

    function line(primary, secondary) {
        const cell = element("td", "tasks-main-cell");
        cell.append(element("strong", "", primary));
        if (secondary) {
            const detail = element("small", "", secondary);
            detail.title = secondary;
            cell.append(detail);
        }
        return cell;
    }

    async function act(request, label, destructive = false) {
        if (changing) return;
        if (destructive && !await confirmDashboardAction(label, "Apply this action to the selected local Windows item?")) return;
        changing = true;
        try {
            await invoke("tasks_action", { action: request });
            notice = label + " completed.";
            if (request.kind !== "folder") {
                if (refreshing) await refreshing;
                await reload();
            }
        } catch (error) {
            notice = String(error);
            render();
        } finally { changing = false; schedule(); }
    }

    function ownerActions(process, endText = "End") {
        const actions = element("div", "panel-actions tasks-row-actions");
        if (process?.path) actions.append(button("Folder", () => act({ kind: "folder", pid: process.pid }, "Open process folder")));
        if (process?.token) actions.append(button(endText, () => act({ kind: "terminate", pid: process.pid, token: process.token }, `End ${process.name} (PID ${process.pid})`, true), true));
        return actions;
    }

    function processRow(process) {
        const ram = process.ram >= 1024 ** 3 ? `${(process.ram / 1024 ** 3).toFixed(2)} GiB` : `${(process.ram / 1024 ** 2).toFixed(1)} MiB`;
        const actions = element("td", ""); actions.append(ownerActions(process));
        const row = element("tr", "");
        row.append(line(process.name, process.path), ...[process.pid, process.cpu.toFixed(1) + "%", ram, process.handles, process.threads]
            .map((value) => element("td", "tasks-number", typeof value === "number" ? locale.format(value) : value ?? "—")), actions);
        return row;
    }

    function serviceRow(service) {
        const stoppedAuto = isStoppedAuto(service);
        const row = element("tr", stoppedAuto ? "tasks-stopped-auto" : "");
        const state = element("td", "");
        state.append(element("span", "diag-pill " + (service.state === "Running" ? "diag-ok" : stoppedAuto ? "diag-crit" : "diag-neutral"), service.state));
        const mode = element("select", "tab-sort-select");
        const startup = service.start_mode === "Auto" ? "automatic" : service.start_mode.toLowerCase();
        mode.replaceChildren(new Option(service.delayed_auto_start ? "Auto (Delayed)" : "Auto", "automatic"), new Option("Manual", "manual"), new Option("Disabled", "disabled"));
        if (!["automatic", "manual", "disabled"].includes(startup)) mode.add(new Option(service.start_mode, startup));
        mode.value = startup;
        mode.disabled = !snapshot.elevated;
        mode.setAttribute("aria-label", service.name + " startup type");
        const change = (action, label, destructive) => act({ kind: "service", name: service.name, action }, label, destructive);
        mode.addEventListener("change", () => {
            const next = mode.value;
            mode.value = startup;
            void change(next, `Set ${service.name} startup to ${next}`, next === "disabled");
        });
        const startupCell = element("td", ""); startupCell.append(mode);
        const actions = element("td", ""); const bar = element("div", "panel-actions tasks-row-actions"); actions.append(bar);
        if (service.state === "Running") {
            bar.append(button("Restart", () => change("restart", `Restart ${service.name}`, true)), button("Stop", () => change("stop", `Stop ${service.name}`, true), true));
        } else if (service.state === "Stopped" && service.start_mode !== "Disabled") {
            bar.append(button("Start", () => change("start", `Start ${service.name}`, false)));
        }
        for (const control of bar.children) { control.disabled = !snapshot.elevated; control.title = snapshot.elevated ? "" : "Requires administrator privileges"; }
        row.append(line(service.display_name, `${service.name}${service.start_name ? ` · ${service.start_name}` : ""}`), state, startupCell,
            element("td", "tasks-number", service.process_id || "—"), actions);
        return row;
    }

    function socketRow(socket) {
        const process = owners.get(socket.pid);
        const local = socket.address.includes(":") ? `[${socket.address}]:${socket.port}` : `${socket.address}:${socket.port}`;
        const actions = element("td", "");
        const bar = ownerActions(process, "End PID");
        bar.prepend(button("Copy", async () => {
            try { await navigator.clipboard.writeText(local); status.textContent = `Copied ${local}.`; }
            catch { status.textContent = "The clipboard is unavailable."; }
        }));
        actions.append(bar);
        const row = element("tr", "");
        row.append(element("td", "", socket.protocol), element("td", "", local), element("td", "", socket.remote ?? "—"),
            element("td", "", socket.state), line(`${process?.name ?? "—"} (${socket.pid})`, process?.path), actions);
        return row;
    }

    function renderSummary() {
        const { processes, services, sockets } = snapshot;
        const totalHandles = processes.reduce((total, process) => total + (process.handles ?? 0), 0);
        const stats = [["Processes", processes.length], ["Handles", totalHandles], ["Services Running", `${services.filter((s) => s.state === "Running").length} / ${services.length}`],
            ["Stopped Auto", services.filter(isStoppedAuto).length], ["Listening Ports", sockets.filter(listen).length], ["Established TCP", sockets.filter((socket) => socket.state === "Established").length]];
        byId("tasks-summary").replaceChildren(...stats.map(([label, count]) => {
            const badge = element("span", "tasks-stat", label + " ");
            badge.append(element("strong", "", typeof count === "number" ? locale.format(count) : count));
            return badge;
        }));
    }

    function render() {
        for (const tab of tabs) boolButton(tab, tab.dataset.taskPane === pane);
        sort.hidden = pane !== "process";
        filters.hidden = pane === "process";
        for (const button of filters.children) boolButton(button, button.dataset.taskFilter === filter);
        if (!snapshot) return;
        const scroll = table.closest(".tasks-scroll");
        const rowHeight = scroll.scrollTop;
        let rows, columns, makeRow, total, name;
        if (pane === "process") {
            rows = snapshot.processes.filter((p) => searchMatch(p.name, p.pid, p.path));
            const key = sort.value;
            const compare = key === "name" ? (a, b) => a.name.localeCompare(b.name) : key === "pid" ? (a, b) => a.pid - b.pid : (a, b) => (b[key] ?? -1) - (a[key] ?? -1);
            rows.sort((a, b) => compare(a, b) || a.pid - b.pid);
            columns = ["Process / Path", "PID", "CPU", "RAM", "Handles", "Threads", "Actions"];
            [makeRow, total, name] = [processRow, snapshot.processes.length, "processes"];
        } else if (pane === "service") {
            rows = snapshot.services.filter((s) => serviceMatches(s) && searchMatch(s.name, s.display_name, s.start_name, s.process_id));
            rows.sort((a, b) => Number(isStoppedAuto(b)) - Number(isStoppedAuto(a)) || a.display_name.localeCompare(b.display_name));
            columns = ["Service / Account", "State", "Startup", "PID", "Control"];
            [makeRow, total, name] = [serviceRow, snapshot.services.length, "Windows services"];
        } else {
            rows = snapshot.sockets.filter((s) => socketMatches(s) && searchMatch(s.protocol, s.address, s.port, s.remote, s.state, s.pid, owners.get(s.pid)?.name));
            rows.sort((a, b) => a.port - b.port || a.address.localeCompare(b.address));
            columns = ["Proto", "Local Port / Addr", "Remote Endpoint", "State", "Owning Process (PID)", "Actions"];
            [makeRow, total, name] = [socketRow, snapshot.sockets.length, "TCP/UDP sockets"];
        }
        const header = element("tr", ""); header.append(...columns.map((caption) => element("th", "", caption)));
        byId("tasks-columns").replaceChildren(header);
        const content = document.createDocumentFragment();
        for (const row of rows) content.append(makeRow(row));
        table.replaceChildren(content);
        scroll.scrollTop = rowHeight;
        status.textContent = [notice, `Showing ${locale.format(rows.length)} of ${locale.format(total)} ${name}.`, ...snapshot.errors].filter(Boolean).join(" ");
    }

    function select(next) {
        pane = next;
        filter = ruleSets[pane]?.[0][0] ?? "all";
        filters.replaceChildren(...(ruleSets[pane] ?? []).map(([id, label]) => {
            const node = actionButton(label, () => { filter = id; render(); });
            node.className = "filter-pill";
            node.dataset.taskFilter = id;
            return node;
        }));
        render();
    }

    function schedule() {
        clearTimeout(timer);
        if (active && live && !changing && !document.hidden) timer = setTimeout(reload, 2500);
    }

    function reload() {
        if (refreshing) return refreshing;
        clearTimeout(timer);
        refreshButton.disabled = true;
        refreshing = invoke("tasks_snapshot").then((data) => {
            snapshot = data;
            owners = new Map(data.processes.map((process) => [process.pid, process]));
            show("tasks-stamp", "Snapshot: " + new Date().toLocaleTimeString());
            renderSummary();
            render();
            notice = "";
        }).catch((error) => { status.textContent = String(error); }).finally(() => {
            refreshing = null;
            refreshButton.disabled = false;
            schedule();
        });
        return refreshing;
    }

    tabs.forEach((tab) => tab.addEventListener("click", () => select(tab.dataset.taskPane)));
    search.addEventListener("input", render);
    sort.addEventListener("change", render);
    refreshButton.addEventListener("click", reload);
    liveButton.addEventListener("click", () => {
        live = !live;
        boolButton(liveButton, live);
        liveButton.textContent = "Live: " + (live ? "ON" : "OFF");
        if (live) void reload(); else schedule();
    });
    document.addEventListener("visibilitychange", schedule);

    return { show(visible) { active = visible; return visible ? reload() : schedule(); } };
}
