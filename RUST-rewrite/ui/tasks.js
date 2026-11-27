"use strict";

function createTasksView(invoke) {
    const search = byId("tasks-search");
    const sort = byId("tasks-sort");
    const liveButton = byId("tasks-live");
    const refreshButton = byId("tasks-refresh");
    const filters = byId("tasks-filters");
    const status = byId("tasks-status");
    const table = byId("tasks-rows");
    const columnsEl = byId("tasks-columns");
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
    const sortState = {
        process: { key: "ram", dir: -1 },
        service: { key: "auto", dir: -1 },
        socket: { key: "port", dir: 1 }
    };

    const tabs = [...byId("tasks-panes").querySelectorAll("button")];
    const ruleSets = {
        service: [["all", "All Services"], ["auto", "⚠ Stopped Auto"], ["running", "Running"], ["stopped", "Stopped"], ["disabled", "Disabled"]],
        socket: [["listen", "TCP Listening"], ["established", "Established TCP"], ["udp", "UDP Endpoints"], ["all", "All Sockets"]]
    };
    const isStoppedAuto = (service) => service.state === "Stopped" && service.start_mode === "Auto" && !service.delayed_auto_start;
    const isTcpListen = (socket) => socket.protocol === "TCP" && socket.state === "Listen";
    const boolButton = (button, on) => { button.classList.toggle("active", on); button.setAttribute("aria-pressed", String(on)); };

    function ownerName(pid) {
        if (pid === 0) return "System Idle Process";
        if (pid === 4) return "System";
        return owners.get(pid)?.name ?? "—";
    }

    function jumpToPid(pid) {
        if (!pid) return;
        search.value = String(pid);
        select("process");
    }

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
            case "listen": return isTcpListen(socket);
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

    function line(primary, secondary, clickHandler = null) {
        const cell = element("td", "tasks-main-cell");
        if (clickHandler) {
            const btn = actionButton(primary, clickHandler);
            btn.className = "diag-event-link clickable-value";
            cell.append(btn);
        } else {
            cell.append(element("strong", "", primary));
        }
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
            window.showToast?.(notice, "ok", 2200);
            if (request.kind !== "folder") {
                if (refreshing) await refreshing;
                await reload();
            } else {
                render();
            }
        } catch (error) {
            notice = String(error);
            window.showToast?.(notice, "crit", 3600);
            render();
        } finally { changing = false; schedule(); }
    }

    function ownerActions(process, endText = "End") {
        const actions = element("div", "panel-actions tasks-row-actions");
        if (process?.path) actions.append(button("Folder", () => act({ kind: "folder", pid: process.pid }, "Reveal process executable")));
        if (process?.token) actions.append(button(endText, () => act({ kind: "terminate", pid: process.pid, token: process.token }, `End ${process.name} (PID ${process.pid})`, true), true));
        return actions;
    }

    function processRow(process) {
        const ram = process.ram >= 1024 ** 3 ? `${(process.ram / 1024 ** 3).toFixed(2)} GiB` : `${(process.ram / 1024 ** 2).toFixed(1)} MiB`;
        const actions = element("td", ""); actions.append(ownerActions(process));
        const row = element("tr", "");
        const cpuTd = element("td", "tasks-number" + (process.cpu >= 25 ? " task-sev-crit" : process.cpu >= 10 ? " task-sev-warn" : ""), process.cpu.toFixed(1) + "%");
        const ramTd = element("td", "tasks-number" + (process.ram >= 4 * 1024 ** 3 ? " task-sev-crit" : process.ram >= 1024 ** 3 ? " task-sev-warn" : ""), ram);
        const hdlTd = element("td", "tasks-number" + ((process.handles ?? 0) >= 15000 ? " task-sev-crit" : (process.handles ?? 0) >= 5000 ? " task-sev-warn" : ""), process.handles != null ? locale.format(process.handles) : "—");
        const thrTd = element("td", "tasks-number", process.threads != null ? locale.format(process.threads) : "—");
        row.append(line(process.name, process.path), element("td", "tasks-number", locale.format(process.pid)), cpuTd, ramTd, hdlTd, thrTd, actions);
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
        const pidCell = element("td", "tasks-number");
        if (service.process_id) {
            const pidBtn = actionButton(String(service.process_id), () => jumpToPid(service.process_id));
            pidBtn.className = "diag-event-link clickable-value";
            pidBtn.title = `Inspect PID ${service.process_id} in Processes`;
            pidCell.append(pidBtn);
        } else {
            pidCell.textContent = "—";
        }
        const actions = element("td", ""); const bar = element("div", "panel-actions tasks-row-actions"); actions.append(bar);
        if (service.state === "Running") {
            bar.append(button("Restart", () => change("restart", `Restart ${service.name}`, true)), button("Stop", () => change("stop", `Stop ${service.name}`, true), true));
        } else if (service.state === "Stopped" && service.start_mode !== "Disabled") {
            bar.append(button("Start", () => change("start", `Start ${service.name}`, false)));
        }
        for (const control of bar.children) { control.disabled = !snapshot.elevated; control.title = snapshot.elevated ? "" : "Requires administrator privileges"; }
        const sub = [service.name, service.start_name, service.binary_path].filter(Boolean).join(" · ");
        row.append(line(service.display_name, sub), state, startupCell, pidCell, actions);
        return row;
    }

    function socketRow(socket) {
        const process = owners.get(socket.pid);
        const local = socket.address.includes(":") ? `[${socket.address}]:${socket.port}` : `${socket.address}:${socket.port}`;
        const protoCell = element("td", "");
        protoCell.append(element("span", "diag-pill " + (socket.protocol === "TCP" ? "task-proto-tcp" : "task-proto-udp"), socket.protocol));
        const localCell = element("td", "");
        localCell.append(document.createTextNode(local));
        if (socket.service && socket.service !== "Custom") {
            localCell.append(document.createTextNode(" "), element("span", "cache-tag", socket.service));
        }
        const stateCell = element("td", "");
        const stCls = socket.state === "Listen" ? "diag-ok" : socket.state === "Established" ? "task-proto-tcp" : /wait|clos/i.test(socket.state) ? "diag-warn" : "diag-neutral";
        stateCell.append(element("span", "diag-pill " + stCls, socket.state));
        const actions = element("td", "");
        const bar = ownerActions(process, "End PID");
        bar.prepend(button("Copy", async () => {
            try { await navigator.clipboard.writeText(local); status.textContent = `Copied ${local}.`; window.showToast?.(`Copied ${local}`, "ok", 1600); }
            catch { status.textContent = "The clipboard is unavailable."; }
        }));
        actions.append(bar);
        const row = element("tr", "");
        const ownerTitle = `${ownerName(socket.pid)} (${socket.pid})`;
        row.append(protoCell, localCell, element("td", "", socket.remote ?? "—"), stateCell,
            line(ownerTitle, process?.path, socket.pid > 4 ? () => jumpToPid(socket.pid) : null), actions);
        return row;
    }

    function renderSummary() {
        const { processes, services, sockets } = snapshot;
        const totalHandles = processes.reduce((total, process) => total + (process.handles ?? 0), 0);
        const stats = [
            ["Processes", processes.length],
            ["Handles", totalHandles],
            ["Services Running", `${services.filter((s) => s.state === "Running").length} / ${services.length}`],
            ["Stopped Auto", services.filter(isStoppedAuto).length],
            ["TCP Listening", sockets.filter(isTcpListen).length],
            ["Established TCP", sockets.filter((socket) => socket.state === "Established").length],
            ["UDP Bound", sockets.filter((socket) => socket.protocol === "UDP").length]
        ];
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
        const curSort = sortState[pane];
        if (pane === "process") {
            rows = snapshot.processes.filter((p) => searchMatch(p.name, p.pid, p.path));
            const key = curSort.key;
            const dir = curSort.dir;
            rows.sort((a, b) => {
                if (key === "name") return dir * a.name.localeCompare(b.name);
                return dir * ((a[key] ?? -1) - (b[key] ?? -1)) || a.pid - b.pid;
            });
            columns = [["name", "Process / Path"], ["pid", "PID"], ["cpu", "CPU"], ["ram", "RAM"], ["handles", "Handles"], ["threads", "Threads"], [null, "Actions"]];
            [makeRow, total, name] = [processRow, snapshot.processes.length, "processes"];
        } else if (pane === "service") {
            rows = snapshot.services.filter((s) => serviceMatches(s) && searchMatch(s.name, s.display_name, s.start_name, s.binary_path, s.process_id));
            const key = curSort.key;
            const dir = curSort.dir;
            rows.sort((a, b) => {
                if (key === "auto") return Number(isStoppedAuto(b)) - Number(isStoppedAuto(a)) || a.display_name.localeCompare(b.display_name);
                if (key === "state") return dir * a.state.localeCompare(b.state) || a.display_name.localeCompare(b.display_name);
                if (key === "start") return dir * a.start_mode.localeCompare(b.start_mode) || a.display_name.localeCompare(b.display_name);
                if (key === "pid") return dir * ((a.process_id ?? 0) - (b.process_id ?? 0));
                return dir * a.display_name.localeCompare(b.display_name);
            });
            columns = [["name", "Service / Account"], ["state", "State"], ["start", "Startup"], ["pid", "PID"], [null, "Control"]];
            [makeRow, total, name] = [serviceRow, snapshot.services.length, "Windows services"];
        } else {
            rows = snapshot.sockets.filter((s) => socketMatches(s) && searchMatch(s.protocol, s.address, s.port, s.service, s.remote, s.state, s.pid, ownerName(s.pid)));
            const key = curSort.key;
            const dir = curSort.dir;
            rows.sort((a, b) => {
                if (key === "proto") return dir * a.protocol.localeCompare(b.protocol) || a.port - b.port;
                if (key === "remote") return dir * (a.remote || "").localeCompare(b.remote || "");
                if (key === "state") return dir * a.state.localeCompare(b.state) || a.port - b.port;
                if (key === "owner") return dir * ownerName(a.pid).localeCompare(ownerName(b.pid)) || a.port - b.port;
                return dir * (a.port - b.port) || a.address.localeCompare(b.address);
            });
            columns = [["proto", "Proto"], ["port", "Local Port / Addr"], ["remote", "Remote Endpoint"], ["state", "State"], ["owner", "Owning Process (PID)"], [null, "Actions"]];
            [makeRow, total, name] = [socketRow, snapshot.sockets.length, "TCP/UDP sockets"];
        }
        const header = element("tr", "");
        for (const [colKey, caption] of columns) {
            const arrow = colKey && colKey === curSort.key ? (curSort.dir < 0 ? " ▼" : " ▲") : "";
            const th = element("th", colKey ? "tasks-sortable-th" : "", caption + arrow);
            if (colKey) th.dataset.sortKey = colKey;
            header.append(th);
        }
        columnsEl.replaceChildren(header);
        const content = document.createDocumentFragment();
        for (const row of rows) content.append(makeRow(row));
        table.replaceChildren(content);
        scroll.scrollTop = rowHeight;
        status.textContent = [notice, `Showing ${locale.format(rows.length)} of ${locale.format(total)} ${name}.`, ...snapshot.errors].filter(Boolean).join(" ");
    }

    columnsEl.addEventListener("click", (ev) => {
        const th = ev.target.closest("th[data-sort-key]");
        if (!th) return;
        const key = th.dataset.sortKey;
        const cur = sortState[pane];
        if (cur.key === key) cur.dir = -cur.dir;
        else {
            cur.key = key;
            cur.dir = ["name", "proto", "port", "owner", "remote", "state", "start", "pid"].includes(key) ? 1 : -1;
        }
        if (pane === "process" && [...sort.options].some((o) => o.value === key)) sort.value = key;
        render();
    });

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

    function isInteracting() {
        return Boolean(document.querySelector("dialog[open]") || (table.contains(document.activeElement) && document.activeElement?.tagName === "SELECT"));
    }

    function schedule() {
        clearTimeout(timer);
        if (active && live && !changing && !document.hidden) {
            timer = setTimeout(() => {
                if (isInteracting()) {
                    schedule();
                    return;
                }
                void reload();
            }, 2500);
        }
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
    sort.addEventListener("change", () => {
        sortState.process.key = sort.value;
        sortState.process.dir = ["name", "pid"].includes(sort.value) ? 1 : -1;
        render();
    });
    refreshButton.addEventListener("click", reload);
    liveButton.addEventListener("click", () => {
        live = !live;
        boolButton(liveButton, live);
        liveButton.textContent = "Live: " + (live ? "ON" : "OFF");
        if (live) void reload(); else schedule();
    });
    document.addEventListener("visibilitychange", schedule);

    return {
        show(visible) { active = visible; return visible ? reload() : schedule(); },
        inspect(pid) { search.value = String(pid); select("process"); }
    };
}
