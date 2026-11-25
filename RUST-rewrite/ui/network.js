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
        status(pane === "adapters" ? "Reading physical adapters…" : "Reading Wi-Fi, routes, and ARP…");
        const button = byId("refresh-network");
        button.disabled = true;
        try {
            if (pane === "adapters") {
                const data = await invoke("network_adapters");
                cards.replaceChildren(...data.map(renderAdapter));
                if (!data.length) cards.append(element("div", "driver-text-node", "No physical network adapters were found."));
                adaptersLoaded = true;
                if (pane === selected) status(data.length + (data.length === 1 ? " physical adapter" : " physical adapters"));
            } else {
                const data = await invoke("network_tables");
                renderOutput("netWifiTelemetryBox", data.wifi);
                renderOutput("netRoutesContainer", data.routes);
                renderOutput("netArpContainer", data.arp);
                show("lblNetWifiStamp", new Date().toLocaleTimeString());
                show("lblNetRoutesCount", "IPv4");
                show("lblNetArpCount", "IPv4");
                tablesLoaded = true;
                if (pane === selected) status("Network tables updated.");
            }
        } catch (error) {
            if (pane === selected) status(String(error));
        } finally {
            button.disabled = false;
        }
    }

    async function configure(adapter, action, description) {
        if (busy || description && !await askDashboard("Update network adapter", adapter.name + " · " + description)) return;
        busy = true;
        const buttons = [...cards.querySelectorAll("button")];
        for (const button of buttons) button.disabled = true;
        let message;
        try {
            message = await invoke("configure_network_adapter", { index: adapter.index, alias: adapter.name, action });
            adaptersLoaded = false;
            if (selected === "adapters") await refresh();
        } catch (error) {
            await refresh();
            message = String(error);
        } finally {
            busy = false;
            for (const button of buttons) button.disabled = false;
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
        dnsForm.append(actionButton("Apply DNS", null, true), actionButton("Automatic DNS", () => configure(info,
            { kind: "dns", servers: [] }, "Reset IPv4 DNS to automatic configuration?")));
        dnsForm.addEventListener("submit", (event) => {
            event.preventDefault();
            const servers = dns.value.split(",").map((item) => item.trim()).filter(Boolean);
            if (!servers.length || servers.length > 2) {
                status("Enter one or two IPv4 DNS addresses.");
                return;
            }
            void configure(info, { kind: "dns", servers }, "Set DNS to " + servers.join(", ") + "?");
        });
        configuration.append(dnsForm);
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
            const port = Number(byId("netDiagPortsInput").value.trim());
            if (!Number.isInteger(port) || port < 1 || port > 65535) {
                status("Enter a single TCP port from 1 to 65535.");
                return;
            }
            request.port = port;
        }
        if (kind === "dns") {
            request.record = byId("selNetDiagDnsType").value;
            request.server = byId("netDiagDnsServer").value.trim() || null;
        }
        for (const probe of probes) probe.disabled = true;
        const title = {ping: "ICMP ping", trace: "IPv4 traceroute", port: "TCP reachability", dns: "DNS lookup"}[kind];
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
    byId("flush-dns").addEventListener("click", async () => {
        try { status(await invoke("flush_dns_cache")); }
        catch (error) { status(String(error)); }
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

function renderDiagnostic(result) {
    if (result.kind === "dns") {
        renderOutput("netDiagVisualArea", result.output);
        return;
    }
    if (result.kind === "port") {
        const box = byId("netDiagVisualArea");
        box.replaceChildren(element("p", result.connected ? "diag-ok" : "diag-warn",
            result.address + " · " + result.message + " · " + result.elapsed_ms + " ms"));
        return;
    }
    const isPing = result.kind === "ping";
    const successful = result.replies.filter((reply) => reply.status === 0);
    const box = byId("netDiagVisualArea");
    if (isPing) {
        const avg = successful.length ? (successful.reduce((total, reply) => total + reply.ms, 0) / successful.length).toFixed(1) + " ms avg" : "No replies";
        const loss = Math.round((1 - successful.length / result.replies.length) * 100);
        const graph = element("div", "net-ping-sparkline");
        const max = Math.max(1, ...successful.map((reply) => reply.ms));
        for (const reply of result.replies) {
            const label = reply.ms == null ? "Timeout" : reply.ms + " ms";
            const bar = element("span", "net-ping-bar " + (reply.ms == null ? "bar-bad" : reply.ms > 100 ? "bar-warn" : "bar-good"));
            bar.style.height = reply.ms == null ? "9px" : (10 + reply.ms / max * 35) + "px";
            const wrap = element("div", "net-ping-bar-wrap");
            wrap.append(bar, element("span", "net-ping-bar-lbl", label));
            graph.append(wrap);
        }
        box.replaceChildren(element("p", "diagnostic-summary", result.address + " · " + avg + " · " + loss + "% loss"), graph);
        return;
    }
    const table = element("table", "tp-data-table");
    const head = table.createTHead().insertRow();
    for (const text of ["Hop", "Address", "Time", "Status"]) head.append(element("th", "", text));
    const body = table.createTBody();
    for (const reply of result.replies) {
        const row = body.insertRow();
        for (const text of [reply.sequence, reply.address ?? unavailable, reply.ms == null ? unavailable : reply.ms + " ms",
            reply.status === 0 ? "Destination" : reply.status === 11013 ? "TTL expired" : reply.status === 11010 ? "Timed out" : "Windows " + reply.status]) {
            row.append(element("td", "", text));
        }
    }
    box.replaceChildren(element("p", "diagnostic-summary", "Tracing " + result.address), table);
}
