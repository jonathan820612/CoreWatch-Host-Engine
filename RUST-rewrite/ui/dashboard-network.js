"use strict";

const dnsPresets = {
    automatic: [],
    cloudflare: ["1.1.1.1", "1.0.0.1"],
    google: ["8.8.8.8", "8.8.4.4"],
    quad9: ["9.9.9.9", "149.112.112.112"]
};

function createDashboardNetwork(invoke) {
    const dialog = byId("dashboard-dns-dialog");
    const preset = byId("dashboard-dns-preset");
    const custom = byId("dashboard-dns-custom");
    const apply = byId("dashboard-dns-apply");
    const dnsButton = byId("lblDnsServers");
    const dnsCheck = byId("lblDnsStatus");
    const arpButton = byId("lblArpStatus");
    let current = null;
    let shown = null;
    let gateway = null;
    let elevated = false;
    let applied = false;
    let saving = false;
    let probing = false;
    let resolvingGateway = false;
    let profile = "";

    const adapterKey = (uplink) => uplink ? JSON.stringify([uplink.index, uplink.name]) : "";

    function updateForm() {
        const expired = adapterKey(shown) !== adapterKey(current);
        preset.disabled = saving || applied || expired || !shown || !elevated;
        custom.disabled = preset.disabled;
        apply.disabled = preset.disabled || !preset.value;
        byId("dashboard-dns-close").disabled = saving;
        byId("dashboard-dns-custom-field").hidden = preset.value !== "custom";
        if (!saving && expired) show("dashboard-dns-message", "The active adapter changed. Close and reopen DNS settings.");
    }

    function showNeighbor(neighbor, address) {
        const state = neighbor?.state;
        const positive = state === "Reachable" || state === "Permanent";
        const failed = state === "Unreachable" || state === "Incomplete";
        badge("lblArpStatus", state ?? (address ? "No entry" : "No gateway"), positive,
            [address, neighbor?.mac, state, address ? "Click to resolve again" : null].filter(Boolean).join(" · "),
            failed ? "diag-crit" : positive ? "diag-ok" : "diag-neutral");
        arpButton.disabled = !address || resolvingGateway;
    }

    dnsButton.addEventListener("click", () => {
        shown = current;
        applied = false;
        preset.value = "";
        custom.value = shown?.ipv4.slice(0, 2).join(", ") ?? "";
        show("dashboard-dns-adapter", shown?.name ?? "No active IPv4 adapter");
        show("dashboard-dns-ipv4", shown?.ipv4.join(", ") || "None reported");
        show("dashboard-dns-ipv6", shown?.ipv6.join(", ") || "None reported");
        show("dashboard-dns-message", !shown ? "An active IPv4 default route is required to apply DNS settings." : elevated
            ? "This editor applies IPv4 DNS settings to the active adapter."
            : "Restart CoreWatch as administrator to apply DNS settings.");
        updateForm();
        dialog.showModal();
        if (!preset.disabled) preset.focus();
    });
    byId("dashboard-dns-close").addEventListener("click", () => dialog.close());
    dialog.addEventListener("cancel", (event) => { if (saving) event.preventDefault(); });
    preset.addEventListener("change", updateForm);
    byId("dashboard-dns-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        if (apply.disabled || !shown) return;
        const servers = preset.value === "custom"
            ? custom.value.split(",").map((part) => part.trim()).filter(Boolean)
            : dnsPresets[preset.value];
        if (!servers || (preset.value === "custom" && !servers.length) || servers.length > 2
            || servers.some((address) => !/^(?:\d{1,3}\.){3}\d{1,3}$/.test(address)
                || address.split(".").some((part) => String(Number(part)) !== part || Number(part) > 255))) {
            show("dashboard-dns-message", "Enter one or two IPv4 addresses separated by a comma.");
            return;
        }
        saving = true;
        updateForm();
        show("dashboard-dns-message", "Applying IPv4 DNS…");
        try {
            const message = await invoke("set_dashboard_dns", { index: shown.index, alias: shown.name, servers });
            applied = true;
            show("dashboard-dns-message", message);
            log(message);
        } catch (error) {
            show("dashboard-dns-message", String(error));
            log(String(error));
        } finally {
            saving = false;
            updateForm();
        }
    });

    async function probe() {
        if (probing) return;
        const target = profile;
        probing = true;
        dnsCheck.disabled = true;
        badge("lblDnsStatus", "Testing…", false, null, "diag-neutral");
        try {
            const result = await invoke("check_dns", { flush: true });
            const message = [result.lookup_error, result.flush_error && "Cache flush: " + result.flush_error]
                .filter(Boolean).join(" · ");
            if (target === profile) {
                const ok = result.elapsed_ms != null;
                badge("lblDnsStatus", ok ? "OK (" + result.elapsed_ms + " ms)" : "Failed", ok,
                    ["Live Windows resolver lookup for cloudflare.com", message].filter(Boolean).join(" · "));
            }
            if (message) log("DNS: " + message);
        } catch (error) {
            if (target === profile) badge("lblDnsStatus", "Failed", false, String(error));
            log("DNS: " + String(error));
        } finally {
            probing = false;
            dnsCheck.disabled = false;
        }
    }
    dnsCheck.addEventListener("click", probe);

    arpButton.addEventListener("click", async () => {
        if (!gateway || resolvingGateway) return;
        const address = gateway;
        resolvingGateway = true;
        arpButton.disabled = true;
        badge("lblArpStatus", "Resolving…", false, null, "diag-neutral");
        try {
            const result = await invoke("refresh_dashboard_arp");
            if (address === gateway) showNeighbor(result, address);
            if (result.mac) log("Gateway " + address + " · " + result.mac + " · " + result.state);
        } catch (error) {
            if (address === gateway) badge("lblArpStatus", "Unresolved", false, String(error));
            log("Gateway ARP: " + String(error));
        } finally {
            resolvingGateway = false;
            arpButton.disabled = !gateway;
        }
    });

    return {
        update(details) {
            current = details.dns_uplink;
            gateway = details.fields.gateway;
            elevated = details.fields.elevation === "Administrator";
            const next = JSON.stringify([adapterKey(current), current?.ipv4, current?.ipv6]);
            if (profile !== next) {
                profile = next;
                badge("lblDnsStatus", "Test", false, "Flush the Windows DNS cache and run a live lookup", "diag-neutral");
            }
            const caption = current?.ipv4.length ? current.ipv4.slice(0, 2).join(", ")
                : current?.ipv6.length ? "IPv6 only" : current ? "None reported" : "No IPv4 route";
            show("lblDnsServers", caption);
            dnsButton.title = (current ? current.name + " · " : "") + "View or configure DNS";
            if (!resolvingGateway) showNeighbor(details.gateway_neighbor, gateway);
            if (dialog.open) {
                if (current && adapterKey(shown) === adapterKey(current)) {
                    show("dashboard-dns-ipv4", current.ipv4.join(", ") || "None reported");
                    show("dashboard-dns-ipv6", current.ipv6.join(", ") || "None reported");
                }
                updateForm();
            }
        }
    };
}
