"use strict";

function createNetworkView(invoke) {
    const view = byId("viewNetworkManagerPanel");
    const status = (message) => show("netManagerStatus", message);
    const panes = { adapters: "netSubAdapters", diagnostics: "netSubDiagnostics", wifiroutes: "netSubWifiRoutes" };
    const subTabs = [...view.querySelectorAll("[data-netview]")];
    const probes = [...view.querySelectorAll("[data-diagnostic]")];
    const cards = byId("adapterInterfaceContainer");
    let selected = "adapters";
    let adaptersLoaded = false;
    let tablesLoaded = false;
    let busy = false;
    let gateway = "";
    let refreshSeq = 0;
    let inFlightRefresh = 0;
    let cachedTables = null;
    let routeFilter = "";
    let routeSort = { key: "metric", dir: 1 };
    let arpFilter = "";
    let arpSort = { key: "ip", dir: 1 };

    async function select(name) {
        selected = name;
        for (const [key, id] of Object.entries(panes)) byId(id).hidden = key !== name;
        for (const button of subTabs) {
            const active = button.dataset.netview === name;
            button.classList.toggle("active", active);
            button.setAttribute("aria-pressed", String(active));
        }
        if (name === "adapters" && !adaptersLoaded || name === "wifiroutes" && !tablesLoaded) await refresh();
    }

    async function refresh() {
        const pane = selected;
        if (pane === "diagnostics") {
            status("Choose a host and run a diagnostic.");
            return;
        }
        const seq = ++refreshSeq;
        inFlightRefresh++;
        status(pane === "adapters" ? "Reading physical adapters…" : "Reading Wi-Fi, native IPv4 routes, and ARP neighbors…");
        const button = byId("refresh-network");
        button.disabled = true;
        try {
            if (pane === "adapters") {
                const data = await invoke("network_adapters");
                if (seq !== refreshSeq) return;
                cards.replaceChildren(...data.map(renderAdapter));
                if (!data.length) cards.append(element("div", "driver-text-node", "No physical network adapters were found."));
                adaptersLoaded = true;
                if (pane === selected) status(data.length + (data.length === 1 ? " physical adapter" : " physical adapters"));
            } else {
                const data = await invoke("network_tables");
                if (seq !== refreshSeq) return;
                cachedTables = data;
                renderWifiTelemetry(data.wifiParsed, data.wifi);
                renderRoutesView();
                renderArpView();
                show("lblNetWifiStamp", new Date().toLocaleTimeString());
                show("lblNetRoutesCount", `${data.routesParsed?.length ?? 0} routes`);
                show("lblNetArpCount", `${data.arpParsed?.length ?? 0} entries`);
                tablesLoaded = true;
                if (pane === selected) status("Network tables updated via native Win32 IP Helper APIs.");
            }
        } catch (error) {
            if (seq === refreshSeq && pane === selected) status(String(error));
        } finally {
            inFlightRefresh = Math.max(0, inFlightRefresh - 1);
            button.disabled = inFlightRefresh > 0;
        }
    }

    function renderRoutesView() {
        if (!cachedTables) return;
        const box = byId("netRoutesContainer");
        const rows = (cachedTables.routesParsed || []).filter((r) => {
            if (!routeFilter) return true;
            return `${r.destination} ${r.netmask} ${r.gateway} ${r.interface} ${r.metric}`.toLowerCase().includes(routeFilter);
        });
        const sorted = [...rows].sort((a, b) => {
            const { key, dir } = routeSort;
            if (key === "metric") return dir * ((Number(a.metric) || 0) - (Number(b.metric) || 0));
            return dir * String(a[key] || "").localeCompare(String(b[key] || ""));
        });
        const searchBar = element("input", "tab-search-input");
        searchBar.type = "search";
        searchBar.placeholder = "Filter routes by destination, gateway, or interface…";
        searchBar.value = routeFilter;
        searchBar.style.marginBottom = "6px";
        searchBar.addEventListener("input", () => {
            routeFilter = searchBar.value.trim().toLowerCase();
            renderRoutesTableOnly(tableWrap, sortedFilteredRoutes());
        });

        function sortedFilteredRoutes() {
            return (cachedTables.routesParsed || []).filter((r) =>
                !routeFilter || `${r.destination} ${r.netmask} ${r.gateway} ${r.interface} ${r.metric}`.toLowerCase().includes(routeFilter)
            ).sort((a, b) => {
                const { key, dir } = routeSort;
                if (key === "metric") return dir * ((Number(a.metric) || 0) - (Number(b.metric) || 0));
                return dir * String(a[key] || "").localeCompare(String(b[key] || ""));
            });
        }

        function renderRoutesTableOnly(container, list) {
            const table = element("table", "tp-data-table");
            const head = table.createTHead().insertRow();
            for (const [k, label] of [["destination", "Destination"], ["netmask", "Netmask"], ["gateway", "Gateway"], ["interface", "Interface"], ["metric", "Metric"]]) {
                const th = element("th", "tasks-sortable-th", label + (routeSort.key === k ? (routeSort.dir > 0 ? " ▲" : " ▼") : ""));
                th.addEventListener("click", () => {
                    if (routeSort.key === k) routeSort.dir = -routeSort.dir;
                    else { routeSort.key = k; routeSort.dir = 1; }
                    renderRoutesTableOnly(container, sortedFilteredRoutes());
                });
                head.append(th);
            }
            const body = table.createTBody();
            for (const r of list.slice(0, 80)) {
                const tr = body.insertRow();
                for (const v of [r.destination, r.netmask, r.gateway, r.interface, r.metric]) tr.append(element("td", "", v));
            }
            container.replaceChildren(table);
        }

        const tableWrap = document.createElement("div");
        renderRoutesTableOnly(tableWrap, sorted);
        const det = element("details", "net-raw-details");
        det.append(element("summary", "", "Raw routing table"), element("pre", "network-command-output", cachedTables.routes || ""));
        box.replaceChildren(searchBar, tableWrap, det);
    }

    function renderArpView() {
        if (!cachedTables) return;
        const box = byId("netArpContainer");
        const searchBar = element("input", "tab-search-input");
        searchBar.type = "search";
        searchBar.placeholder = "Filter neighbors by IP, MAC, vendor, state, or interface…";
        searchBar.value = arpFilter;
        searchBar.style.marginBottom = "6px";

        function sortedFilteredArp() {
            return (cachedTables.arpParsed || []).filter((r) =>
                !arpFilter || `${r.ip} ${r.mac} ${r.vendor || ""} ${r.kind} ${r.interface || ""}`.toLowerCase().includes(arpFilter)
            ).sort((a, b) => {
                const { key, dir } = arpSort;
                return dir * String(a[key] || "").localeCompare(String(b[key] || ""));
            });
        }

        function renderArpTableOnly(container, list) {
            const table = element("table", "tp-data-table");
            const head = table.createTHead().insertRow();
            for (const [k, label] of [["ip", "IP Address"], ["mac", "MAC Address"], ["vendor", "Vendor"], ["kind", "State"], ["interface", "Interface"], [null, "Probe"]]) {
                const th = element("th", k ? "tasks-sortable-th" : "", label + (k && arpSort.key === k ? (arpSort.dir > 0 ? " ▲" : " ▼") : ""));
                if (k) {
                    th.addEventListener("click", () => {
                        if (arpSort.key === k) arpSort.dir = -arpSort.dir;
                        else { arpSort.key = k; arpSort.dir = 1; }
                        renderArpTableOnly(container, sortedFilteredArp());
                    });
                }
                head.append(th);
            }
            const body = table.createTBody();
            if (!list.length) {
                const tr = body.insertRow();
                const td = element("td", "driver-text-node", "No matching unicast ARP neighbors cached.");
                td.colSpan = 6;
                tr.append(td);
            } else {
                for (const r of list.slice(0, 80)) {
                    const tr = body.insertRow();
                    const stateCell = document.createElement("td");
                    const stCls = r.kind === "Reachable" || r.kind === "Permanent" ? "diag-ok"
                        : r.kind === "Unreachable" || r.kind === "Incomplete" ? "diag-crit" : "diag-neutral";
                    stateCell.append(element("span", "diag-pill " + stCls, r.kind));
                    const probeCell = document.createElement("td");
                    const bar = element("div", "panel-actions tasks-row-actions");
                    bar.append(
                        actionButton("Ping", () => {
                            byId("netDiagTargetInput").value = r.ip;
                            void select("diagnostics").then(() => run("ping")).catch(() => {});
                        }),
                        actionButton("Trace", () => {
                            byId("netDiagTargetInput").value = r.ip;
                            void select("diagnostics").then(() => run("trace")).catch(() => {});
                        })
                    );
                    probeCell.append(bar);
                    tr.append(
                        element("td", "", r.ip),
                        element("td", "", r.mac),
                        element("td", "", r.vendor || "—"),
                        stateCell,
                        element("td", "", r.interface || "—"),
                        probeCell
                    );
                }
            }
            container.replaceChildren(table);
        }

        const tableWrap = document.createElement("div");
        renderArpTableOnly(tableWrap, sortedFilteredArp());
        searchBar.addEventListener("input", () => {
            arpFilter = searchBar.value.trim().toLowerCase();
            renderArpTableOnly(tableWrap, sortedFilteredArp());
        });
        const det = element("details", "net-raw-details");
        det.append(element("summary", "", "Raw ARP neighbor table"), element("pre", "network-command-output", cachedTables.arp || ""));
        box.replaceChildren(searchBar, tableWrap, det);
    }

    async function configure(adapter, action, description) {
        if (busy || description && !await confirmDashboardAction("Update network adapter", adapter.name + " · " + description)) return;
        busy = true;
        const buttons = [...cards.querySelectorAll("button")];
        const prevDisabled = new Map(buttons.map((b) => [b, b.disabled]));
        for (const button of buttons) button.disabled = true;
        let message;
        try {
            message = await invoke("configure_network_adapter", { index: adapter.index, alias: adapter.name, action });
            adaptersLoaded = false;
            if (selected === "adapters") await refresh();
            window.showToast?.(message, "ok");
        } catch (error) {
            adaptersLoaded = false;
            if (selected === "adapters") await refresh();
            message = String(error);
            window.showToast?.(message, "crit", 3600);
        } finally {
            busy = false;
            for (const button of buttons) {
                if (button.isConnected) button.disabled = prevDisabled.get(button) ?? false;
            }
            status(message);
            log(message);
        }
    }

    function renderAdapter({ info, config }) {
        const card = element("article", "sharing-card network-adapter-card");
        const headline = element("div", "network-adapter-head");
        headline.append(element("h3", "", info.name + (info.description ? " · " + info.description : "")));
        card.append(headline);
        const details = element("dl", "network-adapter-facts");
        const state = element("dd", "");
        state.append(adapterBadge(info, true));
        details.append(element("dt", "", "Physical status"), state);
        const prefixLength = ipv4Prefix(config?.mask);
        const subnet = prefixLength == null ? config?.mask : config.mask + " (/" + prefixLength + ")";
        for (const [key, value] of [
            ["MAC address", info.mac],
            ["Link speed", formatLink(info.link_bps) ?? (info.online ? null : "0 bps")],
            ["IPv4 address", config?.ipv4],
            ["Subnet mask", subnet],
            ["Gateway", config?.gateway],
            ["IPv4 DNS", config?.dns.filter((address) => !address.includes(":")).join(", ")],
            ["IPv6 DNS", config?.dns.filter((address) => address.includes(":")).join(", ")],
            ["Assignment", config ? config.dhcp ? "DHCP" : "Static" : null],
        ]) {
            details.append(element("dt", "", key), element("dd", "", value || unavailable));
        }
        card.append(details);

        const actions = element("div", "network-actions");
        actions.append(
            actionButton(info.enabled ? "Disable" : "Enable", () => configure(info,
                { kind: info.enabled ? "disable" : "enable" }, info.enabled ? "Disabling may disconnect this computer." : "Enable this adapter?")),
            actionButton("Restart", () => configure(info, { kind: "restart" }, "Restarting briefly disconnects this adapter.")),
            actionButton("Rename", async () => {
                const name = await askDashboard("Rename adapter", info.name, { label: "New name", value: info.name });
                if (typeof name === "string" && name.trim() && name.trim() !== info.name) {
                    await configure(info, { kind: "rename", name: name.trim() });
                }
            }),
            actionButton("Use DHCP", () => configure(info, { kind: "dhcp" }, "Switch IPv4 and DNS to automatic configuration?"))
        );
        actions.children[1].disabled = !info.enabled;
        const configuration = element("div", "network-adapter-config");
        configuration.append(element("h4", "", "IP allocation & DNS configuration"));
        const staticForm = element("form", "network-edit-form");
        staticForm.setAttribute("aria-label", "Static IPv4");
        const ip = field(staticForm, "IPv4 address", config?.ipv4 ?? "", "192.168.1.50");
        const prefix = field(staticForm, "Prefix", prefixLength ?? "24", "24", "number");
        prefix.min = 0;
        prefix.max = 32;
        const gatewayField = field(staticForm, "Gateway", config?.gateway ?? "", "Optional");
        ip.required = true;
        prefix.required = true;
        staticForm.append(actionButton("Apply static IP", null, true));
        staticForm.addEventListener("submit", (event) => {
            event.preventDefault();
            void configure(info, { kind: "static", address: ip.value.trim(), prefix: Number(prefix.value), gateway: gatewayField.value.trim() || null },
                "Change the IPv4 address and gateway? The connection may drop.");
        });
        configuration.append(staticForm);
        const dnsForm = element("form", "network-edit-form dns-edit-form");
        dnsForm.setAttribute("aria-label", "IPv4 DNS");
        const dns = field(dnsForm, "IPv4 DNS servers", config?.dns.filter((address) => !address.includes(":")).slice(0, 2).join(", ") ?? "", "1.1.1.1, 1.0.0.1");
        dnsForm.append(
            actionButton("Apply DNS", null, true),
            actionButton("Automatic DNS", () => configure(info, { kind: "dns", servers: [] }, "Reset IPv4 DNS to automatic configuration?"))
        );
        const quickPresets = element("div", "panel-actions");
        quickPresets.style.marginTop = "5px";
        for (const [label, servers] of [["Cloudflare 1.1.1.1", "1.1.1.1, 1.0.0.1"], ["Google 8.8.8.8", "8.8.8.8, 8.8.4.4"], ["Quad9 9.9.9.9", "9.9.9.9, 149.112.112.112"]]) {
            const chip = actionButton(label, () => { dns.value = servers; });
            chip.className = "diagx-code-btn";
            quickPresets.append(chip);
        }
        dnsForm.addEventListener("submit", (event) => {
            event.preventDefault();
            const servers = dns.value.split(",").map((item) => item.trim()).filter(Boolean);
            if (!servers.length || servers.length > 2) {
                status("Enter one or two IPv4 DNS addresses.");
                return;
            }
            void configure(info, { kind: "dns", servers }, "Set DNS to " + servers.join(", ") + "?");
        });
        configuration.append(dnsForm, quickPresets);
        card.append(configuration, actions);
        return card;
    }

    function field(parent, label, value, placeholder, type = "text") {
        const wrap = element("label", "network-field");
        const input = element("input", "tab-search-input");
        input.type = type;
        input.value = value;
        input.placeholder = placeholder;
        wrap.append(element("span", "", label), input);
        parent.append(wrap);
        return input;
    }

    async function run(kind) {
        const target = byId("netDiagTargetInput").value.trim();
        if (!target) {
            status("Enter a hostname or IP address.");
            return;
        }
        const request = { kind, target };
        if (kind === "port") {
            const rawPorts = byId("netDiagPortsInput").value.split(/[,\s]+/).map((p) => p.trim()).filter(Boolean);
            const ports = rawPorts.map(Number).filter((p) => Number.isInteger(p) && p >= 1 && p <= 65535);
            if (!ports.length || ports.length !== rawPorts.length) {
                status("Enter one or more comma-separated TCP ports (1–65535).");
                return;
            }
            request.ports = ports.slice(0, 16);
            request.port = ports[0];
        }
        if (kind === "dns") {
            request.record = byId("selNetDiagDnsType").value;
            request.server = byId("netDiagDnsServer").value.trim() || null;
        }
        for (const probe of probes) probe.disabled = true;
        const title = { ping: "ICMP ping", trace: "IPv4 traceroute", port: "TCP reachability", dns: "DNS lookup" }[kind];
        show("lblNetDiagResultTitle", title);
        show("lblNetDiagResultMeta", "Running…");
        status(title + " in progress");
        byId("netDiagVisualArea").replaceChildren(element("div", "driver-text-node", target));
        try {
            const result = await invoke("run_network_diagnostic", { request });
            renderDiagnostic(result);
            show("lblNetDiagResultMeta", new Date().toLocaleTimeString());
            status(title + " finished");
        } catch (error) {
            show("lblNetDiagResultMeta", "Failed");
            status(String(error));
            renderOutput("netDiagVisualArea", String(error));
        } finally {
            for (const probe of probes) probe.disabled = false;
        }
    }

    for (const button of subTabs) button.addEventListener("click", () => select(button.dataset.netview));
    for (const button of view.querySelectorAll("[data-net-target]")) button.addEventListener("click", () => {
        const target = button.dataset.netTarget === "gateway" ? gateway : button.dataset.netTarget;
        if (target) byId("netDiagTargetInput").value = target;
        else status("No IPv4 gateway is available.");
    });
    for (const button of probes) button.addEventListener("click", () => run(button.dataset.diagnostic));
    byId("refresh-network").addEventListener("click", refresh);
    byId("flush-dns").addEventListener("click", async (ev) => {
        const btn = ev.currentTarget;
        if (btn.disabled) return;
        btn.disabled = true;
        try {
            const msg = await invoke("flush_dns_cache");
            status(msg);
            window.showToast?.("DNS cache flushed", "ok");
        } catch (error) { status(String(error)); }
        finally { btn.disabled = false; }
    });
    return { select, refresh, setGateway: (value) => { gateway = value ?? ""; } };
}

function actionButton(label, action, submit = false) {
    const button = element("button", "console-clear-btn", label);
    button.type = submit ? "submit" : "button";
    if (action) button.addEventListener("click", action);
    return button;
}

function ipv4Prefix(mask) {
    if (!mask) return null;
    return mask.split(".").reduce((length, octet) => length + Number(octet).toString(2).replaceAll("0", "").length, 0);
}

function formatLink(bps) {
    if (!(bps > 0)) return null;
    return bps >= 1e9 ? Number((bps / 1e9).toFixed(2)) + " Gbps" : Math.round(bps / 1e6) + " Mbps";
}

function adapterBadge(info, detailed = false) {
    const [label, theme] = !info.enabled ? [detailed ? "Disabled" : "OFF", "off"]
        : info.online ? [detailed ? "Connected" : "ON", "on"] : ["D/C", "dc"];
    return element("span", "adapter-status-badge status-" + theme, label);
}

function renderOutput(id, text) {
    byId(id).replaceChildren(element("pre", "network-command-output", text));
}

function renderWifiTelemetry(info, raw) {
    const box = byId("netWifiTelemetryBox");
    if (!info || (!info.connected && !info.note)) {
        const msg = element("div", "driver-text-node", info?.ssid || "Disconnected / Ethernet Only");
        const det = element("details", "net-raw-details");
        det.append(element("summary", "", "Raw netsh output"), element("pre", "network-command-output", raw || ""));
        box.replaceChildren(msg, det);
        return;
    }
    if (info.note) {
        box.replaceChildren(element("div", "driver-text-node", info.note));
        return;
    }
    const sigQuality = info.signalPct == null ? null
        : info.signalPct >= 75 ? ["Excellent", "diag-ok"]
        : info.signalPct >= 50 ? ["Good", "diag-warn"]
        : ["Weak", "diag-crit"];
    const items = [
        ["SSID", info.ssid || "—"],
        ["Interface", info.interfaceName || "—"],
        ["Signal", info.signalPct != null ? `${info.signalPct}% (${info.rssiDbm} dBm)` : "—", sigQuality],
        ["Band / Channel", [info.band, info.channel && `Ch ${info.channel}`].filter(Boolean).join(" · ") || "—"],
        ["Radio Type", info.radioType || "—"],
        ["Rx / Tx Rate", [info.rxRate, info.txRate].filter(Boolean).join(" / ") || "—"],
        ["Security", [info.authentication, info.cipher].filter(Boolean).join(" · ") || "—"],
        ["BSSID", info.bssid || "—"]
    ];
    const grid = element("div", "net-wifi-cards");
    for (const [label, value, badgeSpec] of items) {
        const tile = element("div", "net-wifi-tile");
        tile.append(element("span", "net-wifi-k", label));
        const valEl = element("strong", "net-wifi-v", value);
        if (badgeSpec) {
            valEl.append(document.createTextNode(" "), element("span", "diag-pill " + badgeSpec[1], badgeSpec[0]));
        }
        tile.append(valEl);
        grid.append(tile);
    }
    box.replaceChildren(grid);
}

function renderDiagnostic(result) {
    const box = byId("netDiagVisualArea");
    if (result.kind === "dns") {
        const strip = element("div", "net-stat-strip");
        strip.append(
            element("span", "diag-pill diag-ok", `${(result.records || []).length} record(s)`),
            element("span", "diag-pill diag-neutral", `Elapsed: ${result.elapsed_ms ?? 0} ms`)
        );
        const nodes = [strip];
        if (result.records?.length) {
            const table = element("table", "tp-data-table");
            const head = table.createTHead().insertRow();
            for (const col of ["Name", "Type / Field", "Value"]) head.append(element("th", "", col));
            const body = table.createTBody();
            for (const r of result.records) {
                const tr = body.insertRow();
                tr.append(element("td", "", r.name), element("td", "", r.rtype), element("td", "", r.value));
            }
            nodes.push(table);
        }
        const det = element("details", "net-raw-details");
        det.open = !result.records?.length;
        det.append(element("summary", "", "Raw nslookup output"), element("pre", "network-command-output", result.output || ""));
        nodes.push(det);
        box.replaceChildren(...nodes);
        return;
    }
    if (result.kind === "port") {
        const probes = result.probes?.length ? result.probes : [{
            port: Number(String(result.address).split(":").pop()) || 0,
            service: "TCP",
            address: result.address,
            connected: result.connected,
            elapsedMs: result.elapsed_ms,
            message: result.message
        }];
        const openCount = probes.filter((p) => p.connected).length;
        const hostLabel = String(probes[0].address).replace(/:\d+$/, "");
        const summary = element("p", "diagnostic-summary", `${hostLabel} · ${openCount}/${probes.length} port(s) open`);
        const table = element("table", "tp-data-table");
        const head = table.createTHead().insertRow();
        for (const text of ["Port", "Service", "Status", "RTT", "Detail"]) head.append(element("th", "", text));
        const body = table.createTBody();
        for (const p of probes) {
            const row = body.insertRow();
            const badgeCell = document.createElement("td");
            badgeCell.append(element("span", "diag-pill " + (p.connected ? "diag-ok" : "diag-crit"), p.connected ? "OPEN" : "CLOSED"));
            row.append(
                element("td", "", String(p.port)),
                element("td", "", p.service || "Custom"),
                badgeCell,
                element("td", "", `${p.elapsedMs} ms`),
                element("td", "", p.message)
            );
        }
        box.replaceChildren(summary, table);
        return;
    }
    const isPing = result.kind === "ping";
    const successful = result.replies.filter((reply) => reply.status === 0);
    if (isPing) {
        const rtts = successful.map((r) => r.ms);
        const min = rtts.length ? Math.min(...rtts) : null;
        const max = rtts.length ? Math.max(...rtts) : null;
        const avgNum = rtts.length ? (rtts.reduce((a, b) => a + b, 0) / rtts.length) : null;
        const avg = avgNum != null ? avgNum.toFixed(1) : null;
        const ttl = successful.find((r) => r.ttl != null)?.ttl ?? null;
        let jitter = 0;
        if (rtts.length > 1) {
            for (let i = 1; i < rtts.length; i++) jitter += Math.abs(rtts[i] - rtts[i - 1]);
            jitter = (jitter / (rtts.length - 1)).toFixed(1);
        }
        const loss = result.replies.length ? Math.round((1 - successful.length / result.replies.length) * 100) : 100;
        const avgCls = avgNum == null ? "diag-neutral" : avgNum >= 80 ? "diag-crit" : avgNum >= 35 ? "diag-warn" : "diag-ok";
        const strip = element("div", "net-stat-strip");
        strip.append(
            element("span", "diag-pill diag-neutral", `Target: ${result.address}`),
            element("span", "diag-pill " + (loss === 0 ? "diag-ok" : loss < 50 ? "diag-warn" : "diag-crit"), `Loss: ${loss}%`),
            element("span", "diag-pill diag-neutral", `Min: ${min != null ? min + " ms" : "—"}`),
            element("span", "diag-pill " + avgCls, `Avg: ${avg != null ? avg + " ms" : "—"}`),
            element("span", "diag-pill diag-neutral", `Max: ${max != null ? max + " ms" : "—"}`),
            element("span", "diag-pill diag-neutral", `Jitter: ${rtts.length > 1 ? jitter + " ms" : "—"}`),
            element("span", "diag-pill diag-neutral", `TTL: ${ttl ?? "—"}`)
        );
        const graph = element("div", "net-ping-sparkline");
        const scaleMax = Math.max(1, ...rtts);
        for (const reply of result.replies) {
            const label = reply.ms == null ? "Timeout" : reply.ms + " ms";
            const bar = element("span", "net-ping-bar " + (reply.ms == null ? "bar-bad" : reply.ms >= 80 ? "bar-bad" : reply.ms >= 35 ? "bar-warn" : "bar-good"));
            bar.style.height = reply.ms == null ? "9px" : (10 + reply.ms / scaleMax * 35) + "px";
            const wrap = element("div", "net-ping-bar-wrap");
            wrap.append(bar, element("span", "net-ping-bar-lbl", label));
            graph.append(wrap);
        }
        box.replaceChildren(strip, graph);
        return;
    }
    const reached = result.replies.some((r) => r.status === 0);
    const table = element("table", "tp-data-table");
    const head = table.createTHead().insertRow();
    for (const text of ["Hop", "Address", "Hostname", "RTT", "Status"]) head.append(element("th", "", text));
    const body = table.createTBody();
    for (const reply of result.replies) {
        const row = body.insertRow();
        const rttCell = element("td", reply.ms == null ? "" : reply.ms >= 80 ? "task-sev-crit" : reply.ms >= 35 ? "task-sev-warn" : "",
            reply.ms == null ? unavailable : reply.ms + " ms");
        const stCell = document.createElement("td");
        const [stLabel, stCls] = reply.status === 0 ? ["Destination", "diag-ok"]
            : reply.status === 11013 ? ["Transit", "diag-neutral"]
            : reply.status === 11010 ? ["Timed out", "diag-warn"]
            : ["Win " + reply.status, "diag-crit"];
        stCell.append(element("span", "diag-pill " + stCls, stLabel));
        row.append(
            element("td", "", String(reply.sequence)),
            element("td", "", reply.address ?? "*"),
            element("td", "", reply.hostname ?? unavailable),
            rttCell,
            stCell
        );
    }
    box.replaceChildren(
        element("p", "diagnostic-summary", `Tracing ${result.address} · ${result.replies.length} hop(s) · ${reached ? "Destination reached" : "Max hops reached"}`),
        table
    );
}
