"use strict";

function createDiskPartitioner(invoke) {
    const modal = byId("diskPartitionerModal");
    const openBtn = byId("btnOpenDiskPartitioner");
    const pausedHint = byId("lblStorageTelemetryPaused");
    const bodyEl = byId("dpDiskList");
    const inspectorEl = byId("dpInspector");
    const statusEl = byId("dpStatusText");
    const adminBanner = byId("dpAdminBanner");
    let state = null;
    let selectedDisk = null;
    let selectedSegmentKey = null;
    const collapsedDisks = new Set();
    let busy = false;
    let opening = false;

    const segKey = (seg) => `${seg.diskNumber}|${seg.kind}|${seg.partitionNumber}|${seg.offsetBytes}`;
    function resolveSelectedSegment() {
        if (!state || !selectedSegmentKey) return null;
        for (const d of state.disks) {
            for (const s of d.segments) {
                if (segKey(s) === selectedSegmentKey) return s;
            }
        }
        return null;
    }

    function setBusy(next, message) {
        busy = next;
        for (const btn of modal.querySelectorAll("button")) {
            btn.disabled = next;
        }
        if (message) statusEl.textContent = message;
        if (!next) {
            for (const id of ["dpCloseBtn", "dpRescanBtn", "dpDiskMgmtBtn"]) {
                const btn = byId(id);
                if (btn) btn.disabled = false;
            }
            if (state) renderInspector();
        }
    }

    function setPausedUi(paused) {
        if (pausedHint) pausedHint.hidden = !paused;
        show("status", paused ? "Paused (Partitioner)" : "Live telemetry");
    }

    function stampText() {
        if (!state?.scannedAtMs) return "";
        return ` · Scanned ${new Date(state.scannedAtMs).toLocaleTimeString()}`;
    }

    async function loadDisks(rescan = false) {
        if (busy) return;
        setBusy(true, rescan ? "Rescanning Windows storage buses…" : "Loading physical disks…");
        try {
            state = await invoke("dp_list_disks", { rescan });
            render();
            statusEl.textContent = (state.notice || `${state.disks.length} physical disk(s) detected.`) + stampText();
        } catch (err) {
            statusEl.textContent = String(err);
            log("Disk Partitioner: " + String(err));
        } finally {
            setBusy(false);
        }
    }

    async function runAction(action, confirmTitle, confirmBody) {
        if (busy) return;
        if (confirmTitle && !(await confirmDashboardAction(confirmTitle, confirmBody, "Confirm"))) return;
        setBusy(true, "Executing Windows storage operation…");
        try {
            state = await invoke("dp_action", { action });
            render();
            statusEl.textContent = (state.notice || "Operation completed.") + stampText();
            log("Disk Partitioner: " + (state.notice || action.kind));
            window.showToast?.(state.notice || "Storage operation completed", "ok");
        } catch (err) {
            statusEl.textContent = String(err);
            log("Disk Partitioner error: " + String(err));
            window.showToast?.(String(err), "crit", 4000);
        } finally {
            setBusy(false);
        }
    }

    function render() {
        if (!state) return;
        adminBanner.hidden = state.isAdmin;
        bodyEl.replaceChildren();
        if (!state.disks.length) {
            bodyEl.append(element("div", "driver-text-node", "No physical disks reported by Windows Storage."));
            inspectorEl.replaceChildren(element("p", "dashboard-hint", "Select a disk or partition to inspect actions."));
            return;
        }
        if (selectedDisk == null || !state.disks.some((d) => d.number === selectedDisk)) {
            selectedDisk = state.disks[0].number;
        }
        const selectedSegment = resolveSelectedSegment();
        if (!selectedSegment) selectedSegmentKey = null;

        for (const disk of state.disks) {
            const isCollapsed = collapsedDisks.has(disk.number);
            const card = element("div", "dp-disk-card" + (disk.number === selectedDisk && !selectedSegment ? " is-selected" : ""));
            const head = element("div", "dp-disk-head");
            head.addEventListener("click", () => {
                selectedDisk = disk.number;
                selectedSegmentKey = null;
                render();
            });
            const title = element("div", "dp-disk-title");
            const collapseBtn = actionButton(isCollapsed ? "▸" : "▾", (ev) => {
                ev.stopPropagation();
                if (collapsedDisks.has(disk.number)) collapsedDisks.delete(disk.number);
                else collapsedDisks.add(disk.number);
                render();
            });
            collapseBtn.className = "card-ctrl-btn";
            collapseBtn.title = isCollapsed ? "Expand disk bar" : "Collapse disk bar";
            title.append(
                collapseBtn,
                document.createTextNode(`Disk ${disk.number}: ${disk.friendlyName}`),
                element("span", "diag-pill " + (disk.isSystemDisk ? "diag-warn" : "diag-neutral"), disk.isSystemDisk ? "System/Boot" : disk.busType),
                element("span", "diag-pill " + (disk.isOffline ? "diag-crit" : "diag-ok"), disk.operationalStatus)
            );
            const meta = element("div", "dp-disk-meta",
                `${disk.partitionStyle} · ${disk.sizeGb} GB (${disk.unallocatedGb} GB unallocated) · ${disk.healthStatus}`);
            head.append(title, meta);
            card.append(head);

            if (!isCollapsed) {
                const track = element("div", "dp-bar-track");
                for (const seg of disk.segments) {
                    const isSelected = selectedSegment && segKey(selectedSegment) === segKey(seg);
                    const segBtn = document.createElement("button");
                    segBtn.type = "button";
                    segBtn.className = "dp-bar-seg"
                        + (seg.kind === "unallocated" ? " seg-unalloc" : "")
                        + (seg.isProtected ? " seg-protected" : "")
                        + (isSelected ? " is-selected" : "");
                    segBtn.style.flexGrow = String(Math.max(4, Math.round(seg.pctOfDisk)));
                    segBtn.style.flexBasis = "0";
                    if (seg.usedPct != null && seg.kind === "partition") {
                        const usedFill = element("span", "dp-seg-used-fill" + (seg.usedPct >= 90 ? " is-crit" : seg.usedPct >= 80 ? " is-warn" : ""));
                        usedFill.style.width = `${Math.min(100, Math.max(0, seg.usedPct))}%`;
                        segBtn.append(usedFill);
                    }
                    const topText = seg.kind === "unallocated"
                        ? seg.label
                        : `${seg.driveLetter ? seg.driveLetter + ": " : ""}${seg.label || seg.partType}`;
                    const subText = seg.kind === "unallocated"
                        ? `${seg.sizeGb} GB`
                        : `${seg.sizeGb} GB${seg.fileSystem ? " · " + seg.fileSystem : ""}${seg.usedPct != null ? ` (${Math.round(seg.usedPct)}%)` : ""}${seg.isProtected ? " 🔒" : ""}`;
                    segBtn.append(element("span", "dp-seg-top", topText), element("span", "dp-seg-sub", subText));
                    segBtn.title = `${topText} (${subText})${seg.freeGb != null ? ` · ${seg.freeGb} GB free` : ""}`;
                    segBtn.addEventListener("click", (ev) => {
                        ev.stopPropagation();
                        selectedDisk = disk.number;
                        selectedSegmentKey = segKey(seg);
                        render();
                    });
                    track.append(segBtn);
                }
                card.append(track);
            }
            bodyEl.append(card);
        }
        renderInspector();
    }

    function clusterSelect() {
        const sel = document.createElement("select");
        sel.className = "tab-sort-select";
        for (const [val, label] of [["", "Cluster: Default"], ["4096", "4 KB"], ["16384", "16 KB"], ["65536", "64 KB"]]) {
            sel.append(new Option(label, val));
        }
        return sel;
    }

    function renderInspector() {
        inspectorEl.replaceChildren();
        const disk = state.disks.find((d) => d.number === selectedDisk);
        if (!disk) return;
        const selectedSegment = resolveSelectedSegment();
        const card = element("div", "dp-inspector-card");

        if (!selectedSegment) {
            card.append(
                element("div", "dp-action-title", `Disk ${disk.number} — ${disk.friendlyName}`),
                element("p", "dashboard-hint", `Style: ${disk.partitionStyle} · Bus: ${disk.busType} · Size: ${disk.sizeGb} GB · Unallocated: ${disk.unallocatedGb} GB`)
            );
            if (disk.partitionStyle === "RAW" && !disk.isSystemDisk) {
                const blk = element("div", "dp-action-block");
                blk.append(element("div", "dp-action-title", "Initialize Disk"));
                const row = element("div", "panel-actions");
                row.append(
                    actionButton("Initialize as GPT (Modern)", () => runAction({ kind: "initialize", disk: disk.number, style: "GPT" }, `Initialize Disk ${disk.number} as GPT?`, "Writes a GUID Partition Table (auto-brings disk online if offline).")),
                    actionButton("Initialize as MBR (Legacy)", () => runAction({ kind: "initialize", disk: disk.number, style: "MBR" }, `Initialize Disk ${disk.number} as MBR?`, "Writes a Master Boot Record table to the disk."))
                );
                blk.append(row);
                card.append(blk);
            }
            if (!disk.isSystemDisk) {
                const stateBlk = element("div", "dp-action-block");
                stateBlk.append(element("div", "dp-action-title", "Disk Controls"));
                const sRow = element("div", "panel-actions");
                const onlineBtn = actionButton(disk.isOffline ? "Bring Online" : "Set Offline", () =>
                    runAction({ kind: "set_online", disk: disk.number, online: disk.isOffline }, `${disk.isOffline ? "Bring Disk Online" : "Take Disk Offline"}?`, `Change operational state of Disk ${disk.number}?`));
                onlineBtn.disabled = !state.isAdmin;
                sRow.append(onlineBtn);
                stateBlk.append(sRow);
                card.append(stateBlk);
            }
            if (!disk.isSystemDisk && disk.partitionStyle !== "RAW") {
                const danger = element("div", "dp-action-block dp-danger-block");
                danger.append(element("div", "dp-action-title", "Danger Zone — Wipe Disk"));
                const clearBtn = actionButton(`Clear All Partitions on Disk ${disk.number}`, async () => {
                    const expected = `DISK ${disk.number}`;
                    const typed = await askDashboard(
                        `WIPE ALL DATA ON DISK ${disk.number}?`,
                        `This permanently deletes EVERY partition on Disk ${disk.number} (${disk.friendlyName}). Type "${expected}" to confirm:`,
                        { label: `Type ${expected}`, value: "" },
                        0,
                        "Wipe Disk"
                    );
                    if (typeof typed !== "string") return;
                    if (typed.trim().toUpperCase() !== expected) {
                        statusEl.textContent = `Wipe cancelled: confirmation did not match '${expected}'.`;
                        window.showToast?.(`Confirmation did not match '${expected}'`, "warn");
                        return;
                    }
                    await runAction({ kind: "clear_disk", disk: disk.number, confirm_token: typed.trim() });
                });
                clearBtn.className = "console-clear-btn btn-danger";
                clearBtn.disabled = !state.isAdmin;
                danger.append(clearBtn);
                card.append(danger);
            }
            if (!state.isAdmin) {
                for (const b of card.querySelectorAll("button")) b.disabled = true;
            }
            inspectorEl.append(card);
            return;
        }

        const seg = selectedSegment;
        if (seg.kind === "unallocated") {
            card.append(
                element("div", "dp-action-title", `Unallocated Space — Disk ${disk.number} (${seg.sizeGb} GB)`),
                element("p", "dashboard-hint", disk.partitionStyle === "RAW" ? "Initialize this disk first (click Disk header above) before creating partitions." : "Create and format a new partition in this unallocated space.")
            );
            if (disk.partitionStyle !== "RAW") {
                const blk = element("div", "dp-action-block");
                const sizeInput = document.createElement("input");
                sizeInput.type = "number";
                sizeInput.className = "tab-search-input";
                sizeInput.placeholder = `Blank for Max (${Math.floor(seg.sizeBytes / (1024 * 1024))} MB)`;
                const labelInput = document.createElement("input");
                labelInput.className = "tab-search-input";
                labelInput.placeholder = "Volume Label (e.g. Data)";
                labelInput.maxLength = 32;
                const fsSel = document.createElement("select");
                fsSel.className = "tab-sort-select";
                for (const fs of ["NTFS", "exFAT", "FAT32", "ReFS"]) fsSel.append(new Option(fs, fs));
                const clSel = clusterSelect();
                const ltrSel = document.createElement("select");
                ltrSel.className = "tab-sort-select";
                ltrSel.append(new Option("Auto Drive Letter", ""), new Option("No Drive Letter", "__none__"));
                for (const l of state.availableLetters) ltrSel.append(new Option(l + ":", l));
                const fullCheck = document.createElement("input");
                fullCheck.type = "checkbox";
                const fullLbl = element("label", "settings-check");
                fullLbl.append(fullCheck, element("span", "", "Full Format (slow, zero-fill)"));
                const createBtn = actionButton("Create & Format Partition", () => {
                    const sizeMb = sizeInput.value.trim() ? Number(sizeInput.value) : null;
                    const noLetter = ltrSel.value === "__none__";
                    return runAction({
                        kind: "create_partition",
                        disk: disk.number,
                        size_mb: Number.isFinite(sizeMb) && sizeMb > 0 ? Math.floor(sizeMb) : null,
                        drive_letter: noLetter ? null : (ltrSel.value || null),
                        no_letter: noLetter,
                        file_system: fsSel.value,
                        label: labelInput.value,
                        cluster_size: clSel.value ? Number(clSel.value) : null,
                        full_format: fullCheck.checked
                    }, `Create Partition on Disk ${disk.number}?`, `Create and ${fullCheck.checked ? "full-" : "quick-"}format a new ${fsSel.value} volume?`);
                });
                createBtn.className = "console-clear-btn btn-accent-action";
                createBtn.disabled = !state.isAdmin;
                blk.append(sizeInput, labelInput, fsSel, clSel, ltrSel, fullLbl, createBtn);
                card.append(blk);
            }
            inspectorEl.append(card);
            return;
        }

        // Existing partition inspector
        card.append(
            element("div", "dp-action-title", `Disk ${disk.number} · Partition ${seg.partitionNumber} ${seg.driveLetter ? "(" + seg.driveLetter + ":)" : ""}`),
            element("p", "dashboard-hint", `${seg.partType} · ${seg.sizeGb} GB${seg.fileSystem ? " · " + seg.fileSystem : ""}${seg.freeGb != null ? ` · ${seg.freeGb} GB free` : ""}${seg.isProtected ? " · 🔒 Protected OS Partition" : ""}`)
        );

        // Label + Letter block (native Win32 SetVolumeLabelW!)
        const metaBlk = element("div", "dp-action-block");
        metaBlk.append(element("div", "dp-action-title", "Label & Drive Letter"));
        const labelInput = document.createElement("input");
        labelInput.className = "tab-search-input";
        labelInput.value = seg.label || "";
        labelInput.placeholder = "New Volume Label";
        labelInput.maxLength = 32;
        const lblBtn = actionButton("Apply Label", () => runAction({ kind: "set_label", disk: disk.number, partition: seg.partitionNumber, label: labelInput.value }));
        lblBtn.disabled = !seg.driveLetter;
        const row1 = element("div", "panel-actions");
        row1.append(labelInput, lblBtn);
        metaBlk.append(row1);

        if (!seg.isProtected) {
            const ltrSel = document.createElement("select");
            ltrSel.className = "tab-sort-select";
            ltrSel.append(new Option("Remove Drive Letter", ""));
            for (const l of state.availableLetters) ltrSel.append(new Option(l + ":", l));
            const ltrBtn = actionButton("Set Letter", () => runAction({ kind: "set_letter", disk: disk.number, partition: seg.partitionNumber, drive_letter: ltrSel.value || null }));
            ltrBtn.disabled = !state.isAdmin;
            const row2 = element("div", "panel-actions");
            row2.append(ltrSel, ltrBtn);
            metaBlk.append(row2);
        }
        card.append(metaBlk);

        // Resize block (hidden on protected EFI / Reserved / Recovery)
        const nonResizable = ["System", "Reserved", "Recovery", "EFI System Partition"].includes(seg.partType);
        if (!nonResizable) {
            const resizeBlk = element("div", "dp-action-block");
            const curMb = Math.round(seg.sizeBytes / (1024 * 1024));
            const minMb = seg.minSizeGb != null ? Math.max(64, Math.ceil(seg.minSizeGb * 1024)) : 64;
            const maxMb = seg.maxSizeGb != null ? Math.max(curMb, Math.floor(seg.maxSizeGb * 1024)) : curMb;
            resizeBlk.append(element("div", "dp-action-title", `Resize Partition${seg.minSizeGb != null ? ` (${seg.minSizeGb}–${seg.maxSizeGb} GB)` : " (MB)"}`));
            const slider = document.createElement("input");
            slider.type = "range";
            slider.min = String(minMb);
            slider.max = String(Math.max(minMb, maxMb));
            slider.value = String(curMb);
            slider.disabled = !state.isAdmin || maxMb <= minMb;
            const resizeInput = document.createElement("input");
            resizeInput.type = "number";
            resizeInput.className = "tab-search-input";
            resizeInput.value = String(curMb);
            slider.addEventListener("input", () => { resizeInput.value = slider.value; });
            resizeInput.addEventListener("input", () => {
                const v = Number(resizeInput.value);
                if (Number.isFinite(v)) slider.value = String(Math.min(maxMb, Math.max(minMb, v)));
            });
            const presets = element("div", "panel-actions");
            for (const [lbl, val] of [["Min", minMb], ["Half", Math.round((minMb + maxMb) / 2)], ["Max", maxMb]]) {
                const b = actionButton(lbl, () => { resizeInput.value = String(val); slider.value = String(val); });
                b.className = "diagx-code-btn";
                b.disabled = !state.isAdmin || maxMb <= minMb;
                presets.append(b);
            }
            const resizeBtn = actionButton("Resize", () => runAction({
                kind: "resize_partition",
                disk: disk.number,
                partition: seg.partitionNumber,
                size_mb: Math.floor(Number(resizeInput.value) || 0)
            }, `Resize Partition ${seg.partitionNumber}?`, `Resize partition to ${resizeInput.value} MB (${(Number(resizeInput.value) / 1024).toFixed(2)} GB)?`));
            resizeBtn.disabled = !state.isAdmin;
            const rRow = element("div", "panel-actions");
            rRow.append(resizeInput, resizeBtn);
            resizeBlk.append(slider, presets, rRow);
            card.append(resizeBlk);
        }

        if (!seg.isProtected) {
            const danger = element("div", "dp-action-block dp-danger-block");
            danger.append(element("div", "dp-action-title", "Format / Delete Partition"));
            const fsSel = document.createElement("select");
            fsSel.className = "tab-sort-select";
            for (const fs of ["NTFS", "exFAT", "FAT32", "ReFS"]) fsSel.append(new Option(fs, fs));
            const clSel = clusterSelect();
            const fullCheck = document.createElement("input");
            fullCheck.type = "checkbox";
            const fullLbl = element("label", "settings-check");
            fullLbl.append(fullCheck, element("span", "", "Full Format"));
            const fmtBtn = actionButton("Format", () => runAction({
                kind: "format_partition",
                disk: disk.number,
                partition: seg.partitionNumber,
                file_system: fsSel.value,
                label: labelInput.value,
                cluster_size: clSel.value ? Number(clSel.value) : null,
                full_format: fullCheck.checked
            }, `Format Partition ${seg.partitionNumber}?`, `${fullCheck.checked ? "Full" : "Quick"}-format ${seg.driveLetter ? seg.driveLetter + ":" : "Partition " + seg.partitionNumber} as ${fsSel.value}? All data on this partition will be erased.`));
            fmtBtn.className = "console-clear-btn btn-danger";
            fmtBtn.disabled = !state.isAdmin;
            const delBtn = actionButton("Delete Partition", () => runAction({
                kind: "delete_partition",
                disk: disk.number,
                partition: seg.partitionNumber
            }, `Delete Partition ${seg.partitionNumber}?`, `Permanently delete this partition and all data on it?`));
            delBtn.className = "console-clear-btn btn-danger";
            delBtn.disabled = !state.isAdmin;
            const dRow = element("div", "panel-actions");
            dRow.append(fsSel, clSel, fullLbl, fmtBtn, delBtn);
            danger.append(dRow);
            card.append(danger);
        }
        inspectorEl.append(card);
    }

    async function open() {
        if (opening || modal.matches(":popover-open")) return;
        opening = true;
        try {
            window.dispatchEvent(new CustomEvent("cw-close-overlays", { detail: { except: "diskPartitionerModal" } }));
            await invoke("set_telemetry_paused", { paused: true }).catch(() => {});
            setPausedUi(true);
            modal.showPopover();
            await loadDisks(false);
        } finally {
            opening = false;
        }
    }

    async function close() {
        if (!modal.matches(":popover-open")) return;
        if (busy) {
            statusEl.textContent = "Please wait for the active storage operation to finish before closing.";
            return;
        }
        modal.hidePopover();
        await invoke("set_telemetry_paused", { paused: false }).catch(() => {});
        setPausedUi(false);
    }

    openBtn?.addEventListener("click", open);
    byId("dpCloseBtn")?.addEventListener("click", close);
    byId("dpRescanBtn")?.addEventListener("click", () => loadDisks(true));
    byId("dpDiskMgmtBtn")?.addEventListener("click", () => runAction({ kind: "open_disk_mgmt" }));
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && modal.matches(":popover-open") && !document.querySelector("dialog[open]")) {
            event.preventDefault();
            void close();
        }
    });
    window.addEventListener("cw-close-overlays", (ev) => {
        if (ev.detail?.except !== "diskPartitionerModal" && modal.matches(":popover-open") && !busy) {
            void close();
        }
    });
    enablePanelDrag(modal);

    return { open, close, isOpen: () => modal.matches(":popover-open"), isBusy: () => busy };
}
