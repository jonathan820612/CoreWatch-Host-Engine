"use strict";

function createDiagnosticsView(invoke) {
    const hours = byId("diag-hours");
    const warnings = byId("diag-warnings");
    const benign = byId("diag-benign");
    const solved = byId("diag-solved");
    const channel = byId("diag-channel");
    const level = byId("diag-level");
    const search = byId("diag-search");
    const status = byId("diag-status");
    const refresh = byId("diag-refresh");
    const exportButton = byId("diag-export");
    const liveButton = byId("diag-live");
    const restoreAllBtn = byId("diag-restore-all");
    const nearbyChip = byId("diag-nearby-chip");
    const subsysChip = byId("diag-subsys-chip");
    const matrixEl = byId("diag-matrix");
    const findingsEl = byId("diag-findings");
    const histEl = byId("diag-histogram");
    const thead = byId("diag-thead");
    const eventRows = byId("diag-rows");
    const detail = byId("diag-detail");
    const mark = byId("diag-detail-mark");

    let report;
    let selected;
    let marks = new Set();
    let markKeys = [];
    let active = false;
    let running;
    let live = false;
    let timer;
    let subsystemFilter = "";
    let nearbyCenterMs = null;
    let sortKey = "time";
    let sortDir = -1;
    const dismissedFindings = new Set();

    const signature = (key) => `${key.channel}|${key.record}|${key.time_ms}`;
    const title = (event) => `${event.provider} · ${event.event_id}`;
    const time = (value) => value == null ? "—" : new Date(value).toLocaleString();
    const severity = (value) => ({ 1: "Critical", 2: "Error", 3: "Warning" }[value] ?? "Information");
    const color = (value) => value <= 2 ? "diag-crit" : value === 3 ? "diag-warn" : "diag-neutral";

    function setMarks(keys) {
        markKeys = keys || [];
        marks = new Set(markKeys.map(signature));
        if (restoreAllBtn) restoreAllBtn.hidden = !markKeys.length;
    }

    function closeDetail() {
        selected = null;
        detail.hidden = true;
    }

    async function translateAndReveal(codeText) {
        const details = byId("diag-code-details");
        const input = byId("diag-code-input");
        if (details) details.open = true;
        if (input) input.value = codeText;
        try {
            const code = await invoke("diagnostics_code", { input: codeText });
            show("diag-code-result", `${code.hex} · ${code.family} · ${code.message ?? "Windows has no description for this code."}`);
            const fixEl = byId("diag-code-fix");
            if (fixEl) {
                fixEl.hidden = !code.fix;
                fixEl.textContent = code.fix ? `💡 Fix: ${code.fix}` : "";
            }
        } catch (error) {
            show("diag-code-result", String(error));
            const fixEl = byId("diag-code-fix");
            if (fixEl) fixEl.hidden = true;
        }
    }

    function inspect(event, focus = false) {
        selected = event;
        detail.hidden = false;
        show("diag-detail-title", title(event));
        show("diag-detail-facts", `${time(event.key.time_ms)} · ${event.key.channel} · ${severity(event.level)} · Record ${event.key.record}`);
        show("diag-detail-summary", event.summary ?? "");
        byId("diag-detail-summary").hidden = !event.summary;
        const fixEl = byId("diag-detail-fix");
        if (fixEl) {
            fixEl.hidden = !event.recommended_fix;
            fixEl.textContent = event.recommended_fix ? `💡 Recommended Fix: ${event.recommended_fix}` : "";
        }
        const codesEl = byId("diag-detail-codes");
        if (codesEl) {
            const codes = event.extracted_codes || [];
            codesEl.hidden = !codes.length;
            codesEl.replaceChildren(...codes.map((hex) => {
                const btn = actionButton(`🔎 ${hex}`, () => void translateAndReveal(hex));
                btn.className = "diagx-code-btn";
                btn.title = `Translate ${hex} in Windows Code Translator`;
                return btn;
            }));
        }
        show("diag-detail-message", event.message ?? "Windows has no formatted message for this event.");
        mark.textContent = marks.has(signature(event.key)) ? "Restore Event" : "Mark Solved";
        if (focus) byId("diag-detail-close").focus({ preventScroll: true });
    }

    function computeLiveScore() {
        const available = report.channels.some((ch) => !ch.error || ch.count > 0);
        if (!available) return { score: null, grade: "Unavailable", crit: 0, err: 0, warn: 0, benignCount: 0, solvedCount: 0, formula: "Event log unavailable" };
        let crit = 0, err = 0, warn = 0, benignCount = 0, solvedCount = 0;
        let hasWhea = false, hasStorage = false;
        for (const ev of report.events) {
            if (marks.has(signature(ev.key))) { solvedCount++; continue; }
            if (ev.benign) { benignCount++; continue; }
            if (ev.level === 1) crit++;
            else if (ev.level === 2) err++;
            else if (ev.level === 3) warn++;
            if (ev.subsystem === "Hardware / WHEA") hasWhea = true;
            if (ev.subsystem === "Storage & Disk") hasStorage = true;
        }
        const cDed = Math.min(45, crit * 15);
        const eDed = Math.min(30, err * 2);
        const wDed = Math.min(12, Math.floor(warn / 4));
        const hwPen = (hasWhea ? 12 : 0) + (hasStorage ? 12 : 0);
        const relPen = report.reliability_index != null && report.reliability_index < 7.0
            ? Math.round((7.0 - report.reliability_index) * 4.0) : 0;
        const score = Math.max(5, 100 - (cDed + eDed + wDed + hwPen + relPen));
        const grade = score >= 85 && crit === 0 ? "Healthy" : score >= 65 ? "Advisory" : score >= 40 ? "Degraded" : "Critical";
        const parts = ["100"];
        if (cDed) parts.push(`−${cDed} crit`);
        if (eDed) parts.push(`−${eDed} err`);
        if (wDed) parts.push(`−${wDed} warn`);
        if (hwPen) parts.push(`−${hwPen} hw/disk`);
        if (relPen) parts.push(`−${relPen} rel`);
        const formula = `Score breakdown: ${parts.join(" ")} = ${score}${solvedCount ? ` (${solvedCount} solved excluded)` : ""}`;
        return { score, grade, crit, err, warn, benignCount, solvedCount, formula };
    }

    function renderHistogram() {
        if (!histEl || !report) return;
        const buckets = Array.from({ length: 24 }, () => ({ c: 0, e: 0, w: 0 }));
        const endMs = report.time_ms || Date.now();
        const spanMs = Math.max(1, report.hours * 3600000);
        const startMs = endMs - spanMs;
        for (const ev of report.events) {
            if (ev.benign || marks.has(signature(ev.key))) continue;
            const pos = Math.floor(((ev.key.time_ms - startMs) / spanMs) * 24);
            if (pos < 0 || pos >= 24) continue;
            if (ev.level === 1) buckets[pos].c++;
            else if (ev.level === 2) buckets[pos].e++;
            else if (ev.level === 3) buckets[pos].w++;
        }
        const maxBucket = Math.max(1, ...buckets.map((b) => b.c + b.e + b.w));
        histEl.replaceChildren(...buckets.map((b, i) => {
            const col = element("div", "diag-hist-bar");
            const total = b.c + b.e + b.w;
            const t0 = new Date(startMs + (i * spanMs) / 24).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
            col.title = `${t0} · ${b.c} crit · ${b.e} err · ${b.w} warn`;
            if (total > 0) {
                for (const [cnt, cls] of [[b.c, "diag-hist-seg-c"], [b.e, "diag-hist-seg-e"], [b.w, "diag-hist-seg-w"]]) {
                    if (!cnt) continue;
                    const seg = element("div", cls);
                    seg.style.height = `${Math.max(12, Math.round((cnt / maxBucket) * 100))}%`;
                    col.append(seg);
                }
            }
            return col;
        }));
    }

    function renderMatrix() {
        if (!matrixEl || !report) return;
        const subs = report.subsystems || [];
        matrixEl.replaceChildren(...subs.map((s) => {
            const tile = document.createElement("button");
            tile.type = "button";
            tile.className = `diag-subsys-tile st-${s.status.toLowerCase()}` + (subsystemFilter === s.name ? " active" : "");
            const top = element("div", "diag-subsys-top");
            top.append(element("span", "", `${s.icon} ${s.name}`), element("span", "", s.status));
            const meta = element("div", "diag-subsys-meta", `${s.critical}C · ${s.errors}E · ${s.warnings}W`);
            tile.append(top, meta);
            tile.title = `Filter timeline to ${s.name}`;
            tile.addEventListener("click", () => {
                subsystemFilter = subsystemFilter === s.name ? "" : s.name;
                renderMatrix();
                renderEvents();
            });
            return tile;
        }));
    }

    function renderFindings() {
        if (!findingsEl || !report) return;
        const visible = (report.findings || []).filter((f) => !dismissedFindings.has(f.id));
        findingsEl.hidden = !visible.length;
        findingsEl.replaceChildren(...visible.map((f) => {
            const card = element("div", `diag-finding-card sev-${f.severity}`);
            const head = element("div", "diag-finding-head");
            head.append(
                element("strong", "", (f.severity === "critical" ? "🔴 " : "⚠️ ") + f.title),
                element("span", `diag-pill ${f.severity === "critical" ? "diag-crit" : "diag-warn"}`, f.subsystem)
            );
            const actions = element("div", "panel-actions");
            const filterBtn = actionButton("Filter Subsystem", () => {
                subsystemFilter = f.subsystem;
                renderMatrix();
                renderEvents();
            });
            filterBtn.className = "console-clear-btn";
            const dismissBtn = actionButton("Dismiss", () => {
                dismissedFindings.add(f.id);
                renderFindings();
            });
            dismissBtn.className = "console-clear-btn";
            actions.append(filterBtn, dismissBtn);
            card.append(
                head,
                element("p", "dashboard-hint", f.detail),
                element("p", "diag-fix-box", `💡 ${f.recommended_fix}`),
                actions
            );
            return card;
        }));
    }

    function renderSummary() {
        if (!report) return;
        const liveScore = computeLiveScore();
        const read = report.channels.filter((entry) => !entry.error || entry.count > 0).length;
        const partial = report.channels.filter((entry) => entry.error || entry.limited).length;
        show("diag-score", liveScore.score);
        show("diag-grade", liveScore.grade);
        byId("diag-score").parentElement.dataset.grade = liveScore.grade.toLowerCase();
        const suffix = partial ? ` Coverage limited in ${partial} ${partial === 1 ? "channel" : "channels"}.` : "";
        show("diag-summary", `Scanned ${read} of ${report.channels.length} Windows channels in parallel for the last ${report.hours} hours.${suffix}`);
        show("diag-formula", liveScore.formula);
        const rows = [
            ["Events", report.events.length],
            ["Critical", liveScore.crit],
            ["Errors", liveScore.err],
            ["Warnings", liveScore.warn],
            ["Benign", liveScore.benignCount],
            ["Reliability", report.reliability_index == null ? "—" : `${report.reliability_index.toFixed(1)} / 10`],
            ["WER · 7d", report.wer_recent ?? "—"]
        ];
        byId("diag-counts").replaceChildren(...rows.map(([label, value]) => {
            const chip = element("span", "tasks-stat", label);
            chip.append(element("strong", "", value));
            return chip;
        }));

        byId("diag-channels").replaceChildren(...report.channels.map((entry) =>
            element("li", "", `${entry.name} · ${entry.count} records${entry.error ? ` · ${entry.error}` : entry.limited ? " · Record limit reached" : ""}`)
        ));

        const recItems = report.recurring.length ? report.recurring.map((entry) => {
            const li = element("li", "");
            const btn = actionButton(`${entry.provider} · ${entry.event_id} (${entry.count}×)`, () => {
                search.value = String(entry.event_id);
                renderEvents();
            });
            btn.className = "diag-event-link";
            li.append(btn);
            return li;
        }) : [element("li", "", "No repeated event signatures.")];
        byId("diag-recurring").replaceChildren(...recItems);

        const dumpItems = report.dumps.length ? report.dumps.map((dump) => {
            const li = element("li", "diag-dump-item");
            li.append(element("span", "", `${dump.kind} · ${time(dump.time_ms)} · ${(dump.size / 1024 ** 2).toFixed(1)} MiB · ${dump.name}`));
            if (dump.stop_code) {
                const stopBtn = actionButton(`💥 ${dump.stop_code}`, () => void translateAndReveal(dump.stop_hex || dump.stop_code));
                stopBtn.className = "diagx-code-btn";
                li.append(stopBtn);
            }
            const locBtn = actionButton("📁 Locate", async () => {
                try { await invoke("diagnostics_open_dump", { path: dump.path }); }
                catch (err) { status.textContent = String(err); }
            });
            locBtn.className = "console-clear-btn";
            li.append(locBtn);
            return li;
        }) : [element("li", "", "No accessible crash dumps found.")];
        byId("diag-dumps").replaceChildren(...dumpItems);

        const choice = channel.value;
        channel.replaceChildren(new Option("All channels", ""), ...report.channels.map((entry) => new Option(entry.name, entry.name)));
        channel.value = choice;
        renderHistogram();
        renderMatrix();
        renderFindings();
    }

    function updateSortHeaders() {
        if (!thead) return;
        const labels = { time: "Time", level: "Severity", provider: "Provider / Event", subsystem: "Subsystem" };
        for (const th of thead.querySelectorAll("th[data-sort]")) {
            const key = th.dataset.sort;
            th.textContent = labels[key] + (key === sortKey ? (sortDir < 0 ? " ▼" : " ▲") : "");
        }
    }

    function renderEvents() {
        if (!report) return;
        if (nearbyChip) {
            nearbyChip.hidden = nearbyCenterMs == null;
            if (nearbyCenterMs != null) nearbyChip.textContent = `±5m around ${new Date(nearbyCenterMs).toLocaleTimeString()} ✕`;
        }
        if (subsysChip) {
            subsysChip.hidden = !subsystemFilter;
            if (subsystemFilter) subsysChip.textContent = `Subsystem: ${subsystemFilter} ✕`;
        }
        updateSortHeaders();
        const scroll = eventRows.closest(".tasks-scroll");
        const scrollTop = scroll ? scroll.scrollTop : 0;
        const query = search.value.trim().toLowerCase();
        const shown = report.events.filter((event) => {
            if (!solved.checked && marks.has(signature(event.key))) return false;
            if (benign.checked && event.benign) return false;
            if (channel.value && channel.value !== event.key.channel) return false;
            if (level.value && Number(level.value) !== event.level) return false;
            if (subsystemFilter && (event.subsystem || event.category) !== subsystemFilter) return false;
            if (nearbyCenterMs != null && Math.abs(event.key.time_ms - nearbyCenterMs) > 300000) return false;
            return `${event.event_id} ${event.provider} ${event.subsystem || event.category} ${event.message ?? ""}`.toLowerCase().includes(query);
        });
        shown.sort((a, b) => {
            if (sortKey === "level") return sortDir * (a.level - b.level) || (b.key.time_ms - a.key.time_ms);
            if (sortKey === "provider") return sortDir * a.provider.localeCompare(b.provider);
            if (sortKey === "subsystem") return sortDir * (a.subsystem || a.category).localeCompare(b.subsystem || b.category);
            return sortDir * (a.key.time_ms - b.key.time_ms);
        });
        eventRows.replaceChildren(...shown.map((event) => {
            const tr = element("tr", marks.has(signature(event.key)) ? "diag-solved" : "");
            const eventButton = actionButton(title(event), () => inspect(event));
            eventButton.className = "diag-event-link clickable-value";
            const provider = element("td", "tasks-main-cell");
            provider.append(eventButton, element("small", "", event.key.channel));
            const tone = element("td", "");
            tone.append(element("span", `diag-pill ${color(event.level)}`, severity(event.level)));
            tr.append(element("td", "", time(event.key.time_ms)), tone, provider, element("td", "", event.subsystem || event.category));
            return tr;
        }));
        if (scroll) scroll.scrollTop = scrollTop;
        status.textContent = `${shown.length} of ${report.events.length} events · Scanned ${time(report.time_ms)}`;
    }

    function schedule() {
        clearTimeout(timer);
        if (active && live && !document.hidden) timer = setTimeout(scan, 20000);
    }

    function scan() {
        if (running) return running;
        clearTimeout(timer);
        refresh.disabled = hours.disabled = warnings.disabled = true;
        status.textContent = "Reading 10 Windows event channels in parallel…";
        const options = { hours: Number(hours.value), warnings: warnings.checked };
        running = invoke("diagnostics_scan", { options }).then((frame) => {
            report = frame.report;
            setMarks(frame.dismissed);
            exportButton.disabled = false;
            renderSummary();
            renderEvents();
        }).catch((error) => { status.textContent = String(error); }).finally(() => {
            running = null;
            refresh.disabled = hours.disabled = warnings.disabled = false;
            schedule();
        });
        return running;
    }

    let focusSeq = 0;
    async function focusCrash(key) {
        if (!key || !active) return;
        const seq = ++focusSeq;
        const id = signature(key);
        let event = report?.events.find((candidate) => signature(candidate.key) === id);
        if (!event && report?.last_crash && signature(report.last_crash.key) === id) event = report.last_crash;
        try {
            event ??= await invoke("diagnostics_event", { key });
            if (!active || seq !== focusSeq) return;
            if (event) inspect(event, true);
            else status.textContent = "The crash record is no longer available in Windows Event Log.";
        } catch (error) { if (active && seq === focusSeq) status.textContent = String(error); }
    }

    for (const input of [hours, warnings]) input.addEventListener("change", scan);
    for (const input of [level, channel, benign, solved]) input.addEventListener("change", renderEvents);
    search.addEventListener("input", renderEvents);
    refresh.addEventListener("click", scan);
    byId("diag-open-ev")?.addEventListener("click", () => void invoke("diagnostics_launch_tool", { kind: "eventvwr" }).catch((e) => { status.textContent = String(e); }));
    byId("diag-open-rel")?.addEventListener("click", () => void invoke("diagnostics_launch_tool", { kind: "reliability" }).catch((e) => { status.textContent = String(e); }));
    nearbyChip?.addEventListener("click", () => { nearbyCenterMs = null; renderEvents(); });
    subsysChip?.addEventListener("click", () => { subsystemFilter = ""; renderMatrix(); renderEvents(); });
    byId("diag-detail-nearby")?.addEventListener("click", () => {
        if (!selected) return;
        nearbyCenterMs = selected.key.time_ms;
        subsystemFilter = "";
        channel.value = "";
        level.value = "";
        renderMatrix();
        renderEvents();
    });
    thead?.addEventListener("click", (ev) => {
        const th = ev.target.closest("th[data-sort]");
        if (!th) return;
        const key = th.dataset.sort;
        if (sortKey === key) sortDir = -sortDir;
        else { sortKey = key; sortDir = key === "time" ? -1 : 1; }
        renderEvents();
    });
    restoreAllBtn?.addEventListener("click", async () => {
        if (!markKeys.length) return;
        restoreAllBtn.disabled = true;
        try {
            let latest = markKeys;
            for (const key of [...markKeys]) {
                latest = await invoke("diagnostics_mark", { key, solved: false });
            }
            setMarks(latest);
            renderSummary();
            renderEvents();
            window.showToast?.("All solved events restored", "ok");
        } catch (err) {
            status.textContent = String(err);
        } finally {
            restoreAllBtn.disabled = false;
        }
    });
    byId("diag-detail-close").addEventListener("click", closeDetail);
    liveButton.addEventListener("click", () => {
        live = !live;
        liveButton.setAttribute("aria-pressed", String(live));
        liveButton.textContent = `Live Watch: ${live ? "ON" : "OFF"}`;
        if (live) void scan();
        else schedule();
    });
    document.addEventListener("visibilitychange", schedule);
    byId("diag-detail-copy").addEventListener("click", async () => {
        if (!selected) return;
        try {
            await navigator.clipboard.writeText(`${title(selected)}\n${time(selected.key.time_ms)} · ${selected.key.channel}\n${selected.message ?? selected.summary ?? ""}`);
            status.textContent = "Event copied.";
            window.showToast?.("Event details copied", "ok", 1600);
        } catch { status.textContent = "The clipboard is unavailable."; }
    });
    mark.addEventListener("click", async () => {
        if (!selected || mark.disabled) return;
        const event = selected;
        mark.disabled = true;
        try {
            setMarks(await invoke("diagnostics_mark", { key: event.key, solved: !marks.has(signature(event.key)) }));
            renderSummary();
            renderEvents();
            if (selected === event) inspect(event);
        } catch (error) { status.textContent = String(error); }
        finally { mark.disabled = false; }
    });
    exportButton.addEventListener("click", async () => {
        exportButton.disabled = true;
        try {
            const saved = await invoke("diagnostics_export");
            if (saved) {
                status.textContent = `Report saved to ${saved}`;
                window.showToast?.("Diagnostics report exported", "ok");
            }
        } catch (error) { status.textContent = String(error); }
        finally { exportButton.disabled = false; }
    });
    byId("diag-code-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        await translateAndReveal(byId("diag-code-input").value);
    });

    let evictTimer = 0;
    function cancelEvict() {
        if (evictTimer) {
            clearTimeout(evictTimer);
            evictTimer = 0;
        }
    }

    return { async show(visible, key) {
        active = visible;
        schedule();
        if (!visible) {
            cancelEvict();
            if (!live && report) {
                evictTimer = setTimeout(() => {
                    evictTimer = 0;
                    if (active || live || running) return;
                    report = null;
                    closeDetail();
                    exportButton.disabled = true;
                    eventRows.replaceChildren();
                    invoke("diagnostics_clear").catch(() => {});
                }, 30000);
            }
            return;
        }
        cancelEvict();
        if (!report) await scan();
        if (key) await focusCrash(key);
    } };
}
