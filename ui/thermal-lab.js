"use strict";

function createThermalLab(invoke) {
    const panel = byId("viewThermalLabPanel");
    if (!panel) return { show: async () => {}, leave: () => {}, setTemperatureUnit: () => {} };

    let visible = false;
    let timer = null;
    let busy = false;
    let tempUnit = "C";
    let lastSnap = null;
    let showHiddenFans = false;
    let showHiddenTemps = false;
    const expandedCurveId = new Set();
    const expandedAliasId = new Set();

    function fmtTemp(c) {
        if (c == null || Number.isNaN(c)) return "—";
        const val = tempUnit === "F" ? (c * 9 / 5 + 32) : c;
        return `${val.toFixed(1)} °${tempUnit}`;
    }

    function fmtTempShort(c) {
        if (c == null || Number.isNaN(c)) return "—";
        const val = tempUnit === "F" ? (c * 9 / 5 + 32) : c;
        return `${Math.round(val)}°${tempUnit}`;
    }

    function roleBadge(role) {
        const map = {
            pump: ["💧 AIO PUMP", "diag-info"],
            cpu: ["🔥 CPU FAN", "diag-warn"],
            gpu: ["🎮 GPU FAN", "diag-ok"],
            cooler: ["❄️ RADIATOR", "diag-info"],
            vrm: ["⚡ VRM / PCH", "diag-neutral"],
            chassis: ["🌀 CHASSIS", "diag-neutral"]
        };
        return map[role] || ["🌀 FAN", "diag-neutral"];
    }

    function healthPillClass(status) {
        if (status === "Critical" || status === "Struggling") return "diag-crit";
        if (status === "Degraded" || status === "Warning" || status === "Attention") return "diag-warn";
        if (status === "Idle / No Tach") return "diag-neutral";
        if (status === "0-dB Idle" || status === "Monitoring") return "diag-info";
        return "diag-ok";
    }

    function renderSparklineSvg(values, color, w = 78, h = 20) {
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
        svg.setAttribute("class", "thermal-spark");
        svg.setAttribute("aria-hidden", "true");
        if (!values || values.length < 2) return svg;
        const min = Math.min(...values);
        const max = Math.max(...values);
        const span = Math.max(1, max - min);
        const pts = values.map((v, idx) => {
            const x = (idx / (values.length - 1)) * (w - 2) + 1;
            const y = h - 2 - ((v - min) / span) * (h - 4);
            return `${x.toFixed(1)},${y.toFixed(1)}`;
        }).join(" ");
        const poly = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
        poly.setAttribute("fill", "none");
        poly.setAttribute("stroke", color);
        poly.setAttribute("stroke-width", "1.6");
        poly.setAttribute("points", pts);
        svg.append(poly);
        return svg;
    }

    function renderCurveSvg(points, currentTempC) {
        const w = 260, h = 82;
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
        svg.setAttribute("class", "thermal-curve-svg");
        const toX = (t) => 16 + ((Math.max(20, Math.min(100, t)) - 20) / 80) * (w - 26);
        const toY = (p) => h - 10 - (Math.max(0, Math.min(100, p)) / 100) * (h - 18);

        for (const p of [25, 50, 75, 100]) {
            const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
            line.setAttribute("x1", "16"); line.setAttribute("x2", String(w - 10));
            line.setAttribute("y1", toY(p).toFixed(1)); line.setAttribute("y2", toY(p).toFixed(1));
            line.setAttribute("stroke", "rgba(160,174,192,0.16)"); line.setAttribute("stroke-width", "1");
            svg.append(line);
        }
        const sorted = [...points].sort((a, b) => a.tempC - b.tempC);
        const polyPts = [
            `${toX(20).toFixed(1)},${toY(sorted[0].percent).toFixed(1)}`,
            ...sorted.map((pt) => `${toX(pt.tempC).toFixed(1)},${toY(pt.percent).toFixed(1)}`),
            `${toX(100).toFixed(1)},${toY(sorted[sorted.length - 1].percent).toFixed(1)}`
        ].join(" ");
        const poly = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
        poly.setAttribute("fill", "none");
        poly.setAttribute("stroke", "var(--cw-accent-light, #4299e1)");
        poly.setAttribute("stroke-width", "2");
        poly.setAttribute("points", polyPts);
        svg.append(poly);

        for (const pt of sorted) {
            const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            c.setAttribute("cx", toX(pt.tempC).toFixed(1));
            c.setAttribute("cy", toY(pt.percent).toFixed(1));
            c.setAttribute("r", "3.5");
            c.setAttribute("fill", "var(--cw-accent-soft, #63b3ed)");
            svg.append(c);
        }
        if (currentTempC != null) {
            const mx = toX(currentTempC);
            const marker = document.createElementNS("http://www.w3.org/2000/svg", "line");
            marker.setAttribute("x1", mx.toFixed(1)); marker.setAttribute("x2", mx.toFixed(1));
            marker.setAttribute("y1", "4"); marker.setAttribute("y2", String(h - 6));
            marker.setAttribute("stroke", "#ecc94b"); marker.setAttribute("stroke-dasharray", "3 2");
            marker.setAttribute("stroke-width", "1.5");
            svg.append(marker);
        }
        return svg;
    }

    async function runAction(action, toastMsg) {
        if (busy) return;
        busy = true;
        try {
            const snap = await invoke("thermal_action", { action });
            render(snap);
            if (toastMsg) window.cwApp?.showToast?.(toastMsg, "ok");
        } catch (err) {
            window.cwApp?.showToast?.(String(err), "crit", 4000);
        } finally {
            busy = false;
        }
    }

    function render(snap) {
        if (!snap) return;
        lastSnap = snap;

        // Top status pill & preset highlights
        const overallPill = byId("thermal-overall-pill");
        if (overallPill) {
            overallPill.textContent = `Cooling Health: ${snap.overallHealthScore}% · ${snap.overallStatus}`;
            overallPill.className = "diag-pill " + healthPillClass(snap.overallStatus);
        }
        for (const btn of panel.querySelectorAll("[data-thermal-preset]")) {
            btn.classList.toggle("active", btn.dataset.thermalPreset === snap.activePreset);
        }
        const checkBtn = byId("thermal-run-check");
        if (checkBtn) {
            checkBtn.disabled = Boolean(snap.healthCheckRunning);
            checkBtn.textContent = snap.healthCheckRunning ? "🩺 Running Health Sweep…" : "🩺 Run Fan & Pump Health Check";
        }

        // Hybrid hardware provider badges
        const provBar = byId("thermal-providers-bar");
        if (provBar && Array.isArray(snap.providers)) {
            const labelNode = element("span", "thermal-preset-label", "Backends");
            const stateMap = {
                active: ["diag-ok", "●"],
                admin_required: ["diag-warn", "🔒"],
                standby: ["diag-neutral", "○"],
                unavailable: ["diag-neutral", "×"]
            };
            const pills = snap.providers.map((p) => {
                const [cls, icon] = stateMap[p.state] || ["diag-neutral", "○"];
                const statusWord = p.state === "active" ? "Active"
                    : p.state === "admin_required" ? "Admin Req"
                    : p.state === "standby" ? "Standby" : "Off";
                const el = element("span", `diag-pill thermal-provider-pill ${cls}`, `${icon} ${p.name}: ${statusWord}`);
                el.title = p.detail || "";
                return el;
            });
            provBar.replaceChildren(labelNode, ...pills);
        }

        // Info / elevation / health-check banner
        const banner = byId("thermal-banner");
        const bannerText = byId("thermal-banner-text");
        const elevateBtn = byId("thermal-banner-elevate");
        const alwaysAdminBtn = byId("thermal-banner-always-admin");
        const bannerMsg = snap.lastCheckSummary || snap.note || "";
        if (banner && bannerText) {
            banner.hidden = !bannerMsg;
            bannerText.textContent = bannerMsg;
            const showElev = !snap.elevated && (snap.helperAvailable || snap.pawnIo === "Running");
            if (elevateBtn) elevateBtn.hidden = !showElev;
            if (alwaysAdminBtn) alwaysAdminBtn.hidden = !showElev;
        }

        // KPI Grid
        const hot = snap.hottestTemp;
        show("thermal-kpi-hot", hot ? fmtTemp(hot.valueC) : "—");
        show("thermal-kpi-hot-sub", hot ? `${hot.name} (${hot.hardware})` : "No thermal sensors yet");
        show("thermal-kpi-health", `${snap.overallHealthScore}%`);
        show("thermal-kpi-health-sub", snap.findings.length
            ? `${snap.findings.length} active diagnostic alert${snap.findings.length === 1 ? "" : "s"}`
            : "All fans & sensors operating cleanly");
        const visibleFans = snap.fans.filter((f) => !f.hidden);
        const hiddenFanCount = snap.fans.length - visibleFans.length;
        const spinning = visibleFans.filter((f) => (f.rpm || 0) > 0).length;
        const controllableCount = visibleFans.filter((f) => f.controllable).length;
        show("thermal-kpi-fans", `${visibleFans.length} ch`);
        show("thermal-kpi-fans-sub", `${spinning} spinning · ${controllableCount} PWM controllable`
            + (hiddenFanCount > 0 ? ` · ${hiddenFanCount} hidden` : ""));
        const aio = snap.aioSummary;
        show("thermal-kpi-aio", aio?.detected
            ? (aio.maxPumpRpm ? `${aio.maxPumpRpm} RPM` : aio.coolantTempC != null ? fmtTemp(aio.coolantTempC) : aio.status)
            : "No AIO");
        show("thermal-kpi-aio-sub", aio?.detected
            ? [
                aio.coolantTempC != null ? `Coolant ${fmtTempShort(aio.coolantTempC)}` : null,
                aio.cpuCoolantDeltaC != null ? `Δ ${aio.cpuCoolantDeltaC}°C` : null,
                aio.flowLph != null ? `${aio.flowLph} L/h` : null
            ].filter(Boolean).join(" · ") || aio.status
            : "Motherboard PUMP_FAN / USB AIO auto-detected");

        // Findings / End-of-Life Diagnostic Alerts
        const silencedList = Array.isArray(snap.silencedAlerts) ? snap.silencedAlerts : [];
        const restoreSilencedBtn = byId("thermal-restore-silenced");
        if (restoreSilencedBtn) {
            restoreSilencedBtn.hidden = silencedList.length === 0;
            restoreSilencedBtn.textContent = `🔔 Restore Silenced (${silencedList.length})`;
        }
        const findingsWrap = byId("thermal-findings-wrap");
        const findingsBox = byId("thermal-findings");
        if (findingsWrap && findingsBox) {
            findingsWrap.hidden = snap.findings.length === 0;
            const nodes = snap.findings.map((f) => {
                const row = element("div", "thermal-finding" + (f.severity === "crit" ? " is-crit" : ""));
                const head = element("div", "thermal-finding-head");
                const headRight = element("div", "panel-actions");
                const silenceBtn = actionButton("🔇 Silence", () => {
                    void runAction(
                        { kind: "silence_alert", key: f.key },
                        `Silenced false-positive alert: ${f.channel} (${f.code})`
                    );
                });
                silenceBtn.className = "card-ctrl-btn";
                silenceBtn.title = "Silence this alert permanently (restore anytime via Restore Silenced)";
                headRight.append(
                    element("span", "diag-pill " + (f.severity === "crit" ? "diag-crit" : "diag-warn"), f.code),
                    silenceBtn
                );
                head.append(
                    element("strong", "", `${f.severity === "crit" ? "🚨" : "⚠️"} ${f.title}`),
                    headRight
                );
                row.append(head, element("p", "", f.detail), element("small", "", `Recommended action: ${f.advice}`));
                return row;
            });
            findingsBox.replaceChildren(...nodes);
        }

        // AIO Strip
        const aioBox = byId("thermal-aio-strip");
        if (aioBox) {
            aioBox.replaceChildren();
            const left = element("div", "");
            left.append(
                element("strong", "", `💧 AIO & Liquid Cooling: ${aio.status}`),
                element("div", "dashboard-hint", aio.note)
            );
            const right = element("div", "thermal-aio-metrics");
            if (aio.detected) {
                if (aio.maxPumpRpm != null) right.append(element("span", "", `Pump: `), element("strong", "", `${aio.maxPumpRpm} RPM`));
                if (aio.coolantTempC != null) right.append(element("span", "", `Coolant: `), element("strong", "", fmtTemp(aio.coolantTempC)));
                if (aio.cpuCoolantDeltaC != null) right.append(element("span", "", `CPU↔Coolant Δ: `), element("strong", "", `${aio.cpuCoolantDeltaC}°C`));
                if (aio.flowLph != null) right.append(element("span", "", `Flow: `), element("strong", "", `${aio.flowLph} L/h`));
            }
            aioBox.append(left, right);
        }

        // Fans & Pumps Control Cards
        const fansBox = byId("thermal-fans-grid");
        const hiddenFansBtn = byId("thermal-toggle-hidden-fans");
        if (hiddenFansBtn) {
            hiddenFansBtn.hidden = hiddenFanCount === 0;
            hiddenFansBtn.classList.toggle("active", showHiddenFans);
            hiddenFansBtn.textContent = showHiddenFans
                ? `👁️ Hide Hidden (${hiddenFanCount})`
                : `👁️ Show Hidden (${hiddenFanCount})`;
        }
        const displayedFans = showHiddenFans
            ? [...visibleFans, ...snap.fans.filter((f) => f.hidden)]
            : visibleFans;
        show("thermal-fans-count", `${visibleFans.length} visible · ${controllableCount} controllable`
            + (hiddenFanCount > 0 ? ` · ${hiddenFanCount} hidden` : ""));
        if (fansBox) {
            if (!displayedFans.length) {
                fansBox.replaceChildren(element("div", "driver-text-node",
                    hiddenFanCount > 0
                        ? `All ${hiddenFanCount} fan channel(s) are hidden. Click "Show Hidden" above to restore any header.`
                        : "No fan or pump tachometer channels detected yet. Run RustCoreWatch as Administrator (with PawnIO) to read motherboard SuperIO fans and AIO pumps."));
            } else {
                const visibleTemps = snap.temperatures.filter((t) => !t.hidden);
                const fanNodes = displayedFans.map((fan) => buildFanCard(fan, visibleTemps));
                fansBox.replaceChildren(...fanNodes);
            }
        }

        // System-Wide Temperature Groups
        const tempsHost = byId("thermal-temps-groups");
        const visibleTemps = snap.temperatures.filter((t) => !t.hidden);
        const hiddenTempCount = snap.temperatures.length - visibleTemps.length;
        const hiddenTempsBtn = byId("thermal-toggle-hidden-temps");
        if (hiddenTempsBtn) {
            hiddenTempsBtn.hidden = hiddenTempCount === 0;
            hiddenTempsBtn.classList.toggle("active", showHiddenTemps);
            hiddenTempsBtn.textContent = showHiddenTemps
                ? `👁️ Hide Hidden (${hiddenTempCount})`
                : `👁️ Show Hidden (${hiddenTempCount})`;
        }
        const displayedTemps = showHiddenTemps
            ? [...visibleTemps, ...snap.temperatures.filter((t) => t.hidden)]
            : visibleTemps;
        show("thermal-temps-count", `${visibleTemps.length} live sensors`
            + (hiddenTempCount > 0 ? ` · ${hiddenTempCount} hidden` : ""));
        if (tempsHost) {
            if (!displayedTemps.length) {
                tempsHost.replaceChildren(element("div", "driver-text-node",
                    hiddenTempCount > 0
                        ? `All ${hiddenTempCount} temperature sensor(s) are hidden. Click "Show Hidden" above to restore.`
                        : "No live temperature sensors reported yet."));
            } else {
                const catOrder = ["cpu", "gpu", "cooler", "motherboard", "storage", "memory", "psu", "other"];
                const catTitles = {
                    cpu: "🔥 Processor (CPU)",
                    gpu: "🎮 Graphics (GPU)",
                    cooler: "💧 Liquid / AIO Cooler",
                    motherboard: "🖥️ Motherboard, VRM & Chipset",
                    storage: "💾 Storage (NVMe / SSD)",
                    memory: "📟 Memory (DIMM)",
                    psu: "⚡ Power Supply",
                    other: "🌡️ Other Sensors"
                };
                const grouped = new Map();
                for (const t of displayedTemps) {
                    const c = catTitles[t.category] ? t.category : "other";
                    if (!grouped.has(c)) grouped.set(c, []);
                    grouped.get(c).push(t);
                }
                const sections = [];
                for (const cat of catOrder) {
                    const list = grouped.get(cat);
                    if (!list?.length) continue;
                    const sec = element("div", "");
                    const hdr = element("div", "thermal-section-title");
                    hdr.append(element("h3", "", catTitles[cat]), element("span", "", `${list.length} sensor${list.length === 1 ? "" : "s"}`));
                    const grid = element("div", "thermal-temp-grid");
                    for (const t of list) {
                        const card = element("div", "thermal-temp-card" + (t.hidden ? " is-hidden-card" : ""));
                        const top = element("div", "thermal-temp-top");
                        const left = element("div", "thermal-fan-title");
                        left.append(element("div", "thermal-temp-name", t.name), element("div", "thermal-temp-hw", t.hardware));
                        const rightWrap = element("div", "thermal-temp-card-actions");
                        const valEl = element("div", `thermal-temp-val is-${t.status}`, fmtTemp(t.valueC));
                        const hideTempBtn = actionButton(t.hidden ? "👁️" : "×", () => {
                            void runAction(
                                { kind: "set_temp_hidden", temp_id: t.id, hidden: !t.hidden },
                                t.hidden ? `Restored sensor: ${t.name}` : `Hidden sensor: ${t.name}`
                            );
                        });
                        hideTempBtn.className = "card-ctrl-btn thermal-temp-hide-btn";
                        hideTempBtn.title = t.hidden ? `Show ${t.name}` : `Hide ${t.name} from Thermal Lab`;
                        hideTempBtn.setAttribute("aria-label", t.hidden ? `Show ${t.name}` : `Hide ${t.name}`);
                        rightWrap.append(valEl, hideTempBtn);
                        top.append(left, rightWrap);
                        const foot = element("div", "thermal-temp-foot");
                        foot.append(
                            element("span", "", `Min ${fmtTempShort(t.minC)} · Max ${fmtTempShort(t.maxC)}`),
                            renderSparklineSvg(t.history, t.status === "hot" ? "#fc8181" : t.status === "warm" ? "#ecc94b" : "#38b2ac", 64, 16)
                        );
                        card.append(top, foot);
                        grid.append(card);
                    }
                    sec.append(hdr, grid);
                    sections.push(sec);
                }
                tempsHost.replaceChildren(...sections);
            }
        }

        // Power strip
        const powersBox = byId("thermal-powers-strip");
        if (powersBox) {
            if (!snap.powers.length) {
                powersBox.hidden = true;
            } else {
                powersBox.hidden = false;
                powersBox.replaceChildren(...snap.powers.map((p) =>
                    element("span", "hardware-stat-tag text-power", `⚡ ${p.name} (${p.hardware}): ${p.watts.toFixed(1)} W`)
                ));
            }
        }
    }

    function buildFanCard(fan, temperatures) {
        const card = element("div", "thermal-fan-card"
            + (fan.hidden ? " is-hidden-card" : "")
            + (fan.healthScore <= 45 ? " is-crit" : fan.healthScore <= 80 ? " is-warn" : ""));
        const [rLabel, rCls] = roleBadge(fan.role);

        const head = element("div", "thermal-fan-head");
        const title = element("div", "thermal-fan-title");
        const subText = fan.rawName && fan.rawName !== fan.name
            ? `${fan.hardware} · ${fan.rawName}`
            : fan.hardware;
        title.append(element("strong", "", fan.name), element("small", "", subText));
        const badges = element("div", "panel-actions");
        const tagBtn = actionButton("🏷️", () => {
            if (expandedAliasId.has(fan.id)) expandedAliasId.delete(fan.id);
            else expandedAliasId.add(fan.id);
            render(lastSnap);
        });
        tagBtn.className = "card-ctrl-btn";
        tagBtn.title = "Rename header & assign role (e.g. Arctic AIO Pump, Radiator, Intake)";
        tagBtn.setAttribute("aria-label", `Rename or tag ${fan.name}`);
        const hideBtn = actionButton(fan.hidden ? "👁️ Show" : "🙈", () => {
            expandedAliasId.delete(fan.id);
            if (fan.controlId) expandedCurveId.delete(fan.controlId);
            void runAction(
                { kind: "set_channel_hidden", channel_id: fan.id, hidden: !fan.hidden },
                fan.hidden ? `Restored fan header: ${fan.name}` : `Hidden fan header: ${fan.name}`
            );
        });
        hideBtn.className = "card-ctrl-btn";
        hideBtn.title = fan.hidden ? `Unhide ${fan.name}` : `Hide ${fan.name} header from Thermal Lab`;
        hideBtn.setAttribute("aria-label", fan.hidden ? `Unhide ${fan.name}` : `Hide ${fan.name}`);
        badges.append(
            element("span", `diag-pill ${rCls}`, rLabel),
            element("span", `diag-pill ${healthPillClass(fan.healthStatus)}`, fan.healthStatus),
            tagBtn,
            hideBtn
        );
        head.append(title, badges);

        const readout = element("div", "thermal-fan-readout");
        const leftRead = element("div", "");
        const rpmText = fan.rpm != null
            ? `${fan.rpm.toLocaleString()} RPM`
            : fan.pwmPct != null ? `${Math.round(fan.pwmPct)}% PWM` : "—";
        leftRead.append(element("div", "thermal-rpm-big", rpmText));
        const metaParts = [];
        if (fan.pwmPct != null) metaParts.push(`PWM ${Math.round(fan.pwmPct)}%`);
        if (fan.rpmMin != null && fan.rpmMax != null) metaParts.push(`Range ${fan.rpmMin}–${fan.rpmMax}`);
        if (fan.expectedRpm != null) metaParts.push(`Baseline ~${fan.expectedRpm} RPM`);
        if (fan.rpmJitterPct > 0) metaParts.push(`Jitter ${fan.rpmJitterPct.toFixed(1)}%`);
        leftRead.append(element("div", "thermal-rpm-meta", metaParts.join(" · ") || "Sampling…"));
        const sparkColor = fan.healthScore <= 45 ? "#fc8181" : fan.healthScore <= 80 ? "#ecc94b" : "#63b3ed";
        readout.append(leftRead, renderSparklineSvg(fan.rpmHistory, sparkColor, 82, 22));

        // Health bar
        const healthRow = element("div", "thermal-health-row");
        const healthMeta = element("div", "thermal-health-meta");
        let baselineLabel;
        if (fan.baselineSamples >= 5) {
            baselineLabel = `Baseline ready (${fan.baselineSamples} pts)`;
        } else if (fan.baselineSamples > 0) {
            baselineLabel = `Calibrating (${fan.baselineSamples}/5 pts)…`;
        } else if (fan.healthStatus === "0-dB Idle" || (fan.role === "gpu" && (fan.rpm || 0) === 0 && (fan.pwmPct || 0) <= 5)) {
            baselineLabel = "0-dB idle (learns when spinning)";
        } else if (fan.healthStatus === "Idle / No Tach") {
            baselineLabel = "No tach RPM (header idle/unplugged)";
        } else if (fan.rpm == null) {
            baselineLabel = "PWM-only (no tach RPM)";
        } else {
            baselineLabel = "Calibrating (0/5 pts)…";
        }
        healthMeta.append(
            element("span", "", `Mechanical Health: ${fan.healthScore}%`),
            element("span", "", baselineLabel)
        );
        const track = element("div", "thermal-health-track");
        const fill = element("div", "thermal-health-fill"
            + (fan.healthScore <= 45 ? " is-crit" : fan.healthScore <= 80 ? " is-warn" : ""));
        fill.style.width = `${fan.healthScore}%`;
        track.append(fill);
        healthRow.append(healthMeta, track);

        card.append(head, readout, healthRow);

        // Inline channel label & AIO/fan role editor (for motherboard headers like Arctic AIO Pump)
        if (expandedAliasId.has(fan.id)) {
            const editor = element("div", "thermal-alias-editor");
            const nameIn = document.createElement("input");
            nameIn.type = "text";
            nameIn.className = "tab-search-input";
            nameIn.maxLength = 48;
            nameIn.placeholder = "e.g. Arctic AIO Pump";
            nameIn.value = fan.name !== fan.rawName ? fan.name : "";
            const roleSel = document.createElement("select");
            roleSel.className = "tab-sort-select";
            for (const [val, txt] of [
                ["", "Auto role"],
                ["pump", "💧 AIO Pump (35% floor)"],
                ["cooler", "❄️ Radiator Fan"],
                ["cpu", "🔥 CPU Fan"],
                ["chassis", "🌀 Chassis Fan"],
                ["gpu", "🎮 GPU Fan"],
                ["vrm", "⚡ VRM Fan"]
            ]) {
                roleSel.append(new Option(txt, val, false, (fan.customRole || "") === val));
            }
            const saveBtn = actionButton("Save", () => {
                expandedAliasId.delete(fan.id);
                void runAction({
                    kind: "configure_channel",
                    channel_id: fan.id,
                    label: nameIn.value.trim() || null,
                    role: roleSel.value || null
                }, `Updated header tag for ${nameIn.value.trim() || fan.rawName}`);
            });
            saveBtn.className = "card-ctrl-btn btn-accent-action";
            const clearBtn = actionButton("Reset", () => {
                expandedAliasId.delete(fan.id);
                void runAction({
                    kind: "configure_channel",
                    channel_id: fan.id,
                    label: null,
                    role: null
                }, `Reset label for ${fan.rawName}`);
            });
            clearBtn.className = "card-ctrl-btn";
            editor.append(nameIn, roleSel, saveBtn, clearBtn);
            card.append(editor);
        }

        // Inline channel issues if any (with 1-click Silence button)
        for (const issue of fan.issues) {
            const issueRow = element("div", "dashboard-hint thermal-inline-issue");
            const silenceInline = actionButton("🔇 Silence", () => {
                void runAction(
                    { kind: "silence_alert", key: issue.key },
                    `Silenced alert: ${fan.name} (${issue.code})`
                );
            });
            silenceInline.className = "card-ctrl-btn";
            silenceInline.title = "Silence this false-positive alert";
            issueRow.append(
                element("span", "", `${issue.severity === "crit" ? "🚨" : "⚠️"} ${issue.title}`),
                silenceInline
            );
            card.append(issueRow);
        }

        // PWM / Curve Controls (if controllable)
        if (fan.controllable && fan.controlId) {
            const cid = fan.controlId;
            const ctrl = element("div", "thermal-ctrl-block");
            const modeKind = fan.mode?.kind || "auto";
            const modeBar = element("div", "thermal-mode-pills");
            const mkModeBtn = (kind, label, onClick) => {
                const b = actionButton(label, onClick);
                b.className = "filter-pill" + (modeKind === kind ? " active" : "");
                return b;
            };
            modeBar.append(
                mkModeBtn("auto", "Auto", () => {
                    expandedCurveId.delete(cid);
                    void runAction({ kind: "set_auto", control_id: cid }, `${fan.name}: Hardware Auto restored`);
                }),
                mkModeBtn("manual", "Manual PWM", () => {
                    expandedCurveId.delete(cid);
                    const startPct = Math.max(fan.minPct, Math.round(fan.pwmPct || 55));
                    void runAction({ kind: "set_manual", control_id: cid, percent: startPct }, `${fan.name}: Manual ${startPct}%`);
                }),
                mkModeBtn("curve", "Custom Curve", () => {
                    if (expandedCurveId.has(cid)) expandedCurveId.delete(cid);
                    else expandedCurveId.add(cid);
                    render(lastSnap);
                })
            );
            if (fan.role === "pump") {
                modeBar.append(element("span", "diag-pill diag-info", `🛡️ Min ${fan.minPct}%`));
            }
            ctrl.append(modeBar);

            // Manual slider (always handy in Manual mode, or quick-override in Auto)
            const sliderRow = element("div", "thermal-slider-row");
            const slider = document.createElement("input");
            slider.type = "range";
            slider.min = String(fan.minPct);
            slider.max = String(fan.maxPct || 100);
            const curVal = modeKind === "manual"
                ? fan.mode.percent
                : Math.max(fan.minPct, Math.round(fan.pwmPct || 50));
            slider.value = String(curVal);
            const out = element("output", "", `${curVal}%`);
            slider.addEventListener("input", () => { out.value = `${slider.value}%`; });
            slider.addEventListener("change", () => {
                void runAction({ kind: "set_manual", control_id: cid, percent: Number(slider.value) },
                    `${fan.name} set to ${slider.value}% PWM`);
            });
            const applyBtn = actionButton("Set", () => {
                void runAction({ kind: "set_manual", control_id: cid, percent: Number(slider.value) },
                    `${fan.name} set to ${slider.value}% PWM`);
            });
            applyBtn.className = "card-ctrl-btn";
            sliderRow.append(element("span", "", "Duty"), slider, out, applyBtn);
            ctrl.append(sliderRow);

            // Interactive Custom Curve Editor
            if (modeKind === "curve" || expandedCurveId.has(cid)) {
                const defaultSensor = temperatures.find((t) => t.category === (fan.role === "gpu" ? "gpu" : "cpu"))?.id
                    || temperatures[0]?.id || "";
                const curCurve = modeKind === "curve" ? fan.mode : {
                    sensorId: defaultSensor,
                    hysteresisC: 2,
                    points: [
                        { tempC: 35, percent: Math.max(fan.minPct, 35) },
                        { tempC: 55, percent: Math.max(fan.minPct, 55) },
                        { tempC: 72, percent: 80 },
                        { tempC: 85, percent: 100 }
                    ]
                };
                const curveBox = element("div", "thermal-curve-box");
                const sel = document.createElement("select");
                sel.className = "tab-sort-select";
                sel.setAttribute("aria-label", `Temperature sensor for ${fan.name}`);
                for (const t of temperatures) {
                    const opt = new Option(`${t.name} (${fmtTempShort(t.valueC)})`, t.id, false, t.id === curCurve.sensorId);
                    sel.append(opt);
                }
                const activeTemp = temperatures.find((t) => t.id === sel.value)?.valueC;
                const svgSlot = element("div", "");
                svgSlot.append(renderCurveSvg(curCurve.points, activeTemp));

                const ptsGrid = element("div", "thermal-curve-points");
                const ptInputs = curCurve.points.slice(0, 4).map((pt, idx) => {
                    const cell = element("div", "thermal-curve-pt");
                    const tIn = document.createElement("input");
                    tIn.type = "number"; tIn.min = "20"; tIn.max = "100"; tIn.value = String(Math.round(pt.tempC));
                    tIn.title = `Point ${idx + 1} temperature (°C)`;
                    const pIn = document.createElement("input");
                    pIn.type = "number"; pIn.min = String(fan.minPct); pIn.max = "100"; pIn.value = String(pt.percent);
                    pIn.title = `Point ${idx + 1} duty (%)`;
                    const refreshPreview = () => {
                        const livePts = ptInputs.map(([ti, pi]) => ({ tempC: Number(ti.value), percent: Number(pi.value) }));
                        svgSlot.replaceChildren(renderCurveSvg(livePts, activeTemp));
                    };
                    tIn.addEventListener("input", refreshPreview);
                    pIn.addEventListener("input", refreshPreview);
                    cell.append(element("span", "", `P${idx + 1} °C / %`), tIn, pIn);
                    ptsGrid.append(cell);
                    return [tIn, pIn];
                });

                const curveFoot = element("div", "panel-actions");
                const applyCurveBtn = actionButton("Apply Curve", () => {
                    const points = ptInputs.map(([ti, pi]) => ({
                        tempC: Math.max(20, Math.min(100, Number(ti.value) || 50)),
                        percent: Math.max(fan.minPct, Math.min(100, Number(pi.value) || 50))
                    }));
                    void runAction({
                        kind: "set_curve",
                        control_id: cid,
                        curve: { sensorId: sel.value, hysteresisC: 2.0, points }
                    }, `${fan.name}: Custom curve active`);
                });
                applyCurveBtn.className = "console-clear-btn btn-accent-action";
                curveFoot.append(sel, applyCurveBtn);
                curveBox.append(svgSlot, ptsGrid, curveFoot);
                ctrl.append(curveBox);
            }
            card.append(ctrl);
        }
        return card;
    }

    // Wire static toolbar controls once
    for (const btn of panel.querySelectorAll("[data-thermal-preset]")) {
        btn.addEventListener("click", () => {
            const preset = btn.dataset.thermalPreset;
            void runAction({ kind: "apply_preset", preset }, `Cooling preset applied: ${preset}`);
        });
    }
    byId("thermal-refresh")?.addEventListener("click", () => void runAction({ kind: "refresh" }));
    byId("thermal-reset-auto")?.addEventListener("click", () =>
        void runAction({ kind: "reset_all_auto" }, "All fans restored to hardware Auto control"));
    byId("thermal-run-check")?.addEventListener("click", async () => {
        if (await confirmDashboardAction(
            "Run Fan & Pump Health Check",
            "RustCoreWatch will gently step controllable fans through 45% -> 75% -> Auto (~5 seconds) while keeping AIO pumps above 65% to verify PWM response, bearing stability, and calibrate baselines.",
            "Run Check"
        )) {
            window.cwApp?.showToast?.("Running 5-second fan & pump health check…", "info", 4500);
            await runAction({ kind: "run_health_check" });
        }
    });
    byId("thermal-reset-baselines")?.addEventListener("click", () =>
        void runAction({ kind: "reset_baselines" }, "Learned fan/pump baselines cleared"));
    byId("thermal-restore-silenced")?.addEventListener("click", () =>
        void runAction({ kind: "clear_silenced_alerts" }, "All silenced thermal & fan alerts restored"));
    byId("thermal-toggle-hidden-fans")?.addEventListener("click", () => {
        showHiddenFans = !showHiddenFans;
        if (lastSnap) render(lastSnap);
    });
    byId("thermal-toggle-hidden-temps")?.addEventListener("click", () => {
        showHiddenTemps = !showHiddenTemps;
        if (lastSnap) render(lastSnap);
    });
    byId("thermal-banner-elevate")?.addEventListener("click", async () => {
        if (await askDashboard("Restart as Administrator", "Restart RustCoreWatch as Administrator to unlock CPU die, Motherboard SuperIO/VRM, Arctic/PWM AIO headers, and fan control?")) {
            await invoke("elevate").catch((e) => window.cwApp?.showToast?.(String(e), "warn"));
        }
    });
    byId("thermal-banner-always-admin")?.addEventListener("click", async () => {
        if (await askDashboard("Always Start as Administrator?", "Save Administrator Launch Mode in Settings and restart RustCoreWatch elevated now so motherboard fans, AIO headers, and CPU die sensors are always active?", null, 0, "Save & Elevate")) {
            try {
                await invoke("save_dashboard_preferences", { changes: { runAsAdmin: true } });
                await invoke("elevate");
            } catch (e) {
                window.cwApp?.showToast?.(String(e), "warn");
            }
        }
    });

    async function poll() {
        if (!visible) return;
        try {
            const snap = await invoke("thermal_state");
            if (visible) render(snap);
        } catch (err) {
            show("thermal-banner-text", String(err));
        }
    }

    function startTimer() {
        clearInterval(timer);
        timer = setInterval(() => { if (visible && !document.hidden && !busy) void poll(); }, 2500);
    }

    document.addEventListener("visibilitychange", () => {
        if (!visible) return;
        if (document.hidden) {
            clearInterval(timer);
            timer = null;
            void invoke("thermal_action", { action: { kind: "set_active", active: false } }).catch(() => {});
        } else {
            void invoke("thermal_action", { action: { kind: "set_active", active: true } })
                .then((snap) => { if (visible && !document.hidden) render(snap); })
                .catch(() => {});
            startTimer();
        }
    });

    return {
        async show() {
            visible = true;
            try {
                const snap = await invoke("thermal_action", { action: { kind: "set_active", active: true } });
                if (!visible) return;
                render(snap);
            } catch (err) {
                if (!visible) return;
                show("thermal-banner-text", String(err));
            }
            if (!visible || document.hidden) return;
            startTimer();
        },
        leave() {
            visible = false;
            clearInterval(timer);
            timer = null;
            void invoke("thermal_action", { action: { kind: "set_active", active: false } }).catch(() => {});
        },
        setTemperatureUnit(unit) {
            tempUnit = unit === "F" ? "F" : "C";
            if (lastSnap) render(lastSnap);
        }
    };
}
