"use strict";

function createDiskMap(invoke) {
    const drive = byId("disk-map-drive");
    const drivesStrip = byId("disk-map-drives-strip");
    const path = byId("disk-map-path");
    const filter = byId("disk-map-filter");
    const status = byId("disk-map-status");
    const map = byId("disk-map-treemap");
    const canvas = byId("disk-map-canvas");
    const tooltip = byId("disk-map-tooltip");
    const rows = byId("disk-map-rows");
    const thead = byId("disk-map-thead");
    const breadcrumbs = byId("disk-map-breadcrumbs");
    const extChip = byId("disk-map-ext-chip");
    const selBar = byId("disk-map-selection");
    const selLabel = byId("disk-map-sel-label");
    const selZoom = byId("disk-map-sel-zoom");
    const selOpen = byId("disk-map-sel-open");
    const selCopy = byId("disk-map-sel-copy");
    const selRecycle = byId("disk-map-sel-recycle");
    const scanButton = byId("disk-map-scan");
    const browseButton = byId("disk-map-browse");
    const cancelButton = byId("disk-map-cancel");
    const up = byId("disk-map-up");
    const home = byId("disk-map-root");
    const modes = [...document.querySelectorAll("[data-disk-mode]")];

    let scanning = false;
    let drivesLoaded = false;
    let root = null;
    let result = null;
    let mode = "entries";
    let sortKey = "bytes";
    let sortDir = -1;
    let activeExt = null;
    let selectedItem = null;
    let hoveredRect = null;
    let renderedRects = [];

    const size = (bytes) => {
        if (!Number.isFinite(bytes)) return "0 B";
        const units = ["B", "KiB", "MiB", "GiB", "TiB"];
        let unit = 0;
        let val = bytes;
        for (; val >= 1024 && unit < units.length - 1; unit++) val /= 1024;
        return `${val.toFixed(unit ? 1 : 0)} ${units[unit]}`;
    };

    const formatDate = (ms) => {
        if (!ms) return "—";
        const d = new Date(ms);
        return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
    };

    const EXT_COLORS = {
        video: ["#7c3aed", [".mp4", ".mkv", ".avi", ".mov", ".webm", ".wmv", ".flv", ".m4v"]],
        image: ["#db2777", [".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".psd", ".raw", ".heic", ".ico"]],
        audio: ["#0d9488", [".mp3", ".flac", ".wav", ".ogg", ".aac", ".m4a", ".wma"]],
        archive: ["#d97706", [".zip", ".7z", ".rar", ".tar", ".gz", ".xz", ".bz2", ".zst", ".cab"]],
        disk: ["#4f46e5", [".iso", ".vhdx", ".vhd", ".vmdk", ".img", ".wim", ".esd", ".pak", ".bin"]],
        exec: ["#dc2626", [".exe", ".dll", ".sys", ".msi", ".msix", ".bat", ".ps1", ".cmd", ".pdb"]],
        code: ["#2563eb", [".rs", ".js", ".ts", ".jsx", ".tsx", ".py", ".cs", ".cpp", ".c", ".h", ".java", ".go", ".html", ".css", ".json", ".toml", ".yaml", ".yml", ".xml", ".md", ".sql", ".log", ".txt"]]
    };
    const extColorMap = new Map();
    for (const [, [color, list]] of Object.entries(EXT_COLORS)) {
        for (const ext of list) extColorMap.set(ext, color);
    }
    function colorForItem(item, index = 0) {
        if (item.directory) {
            const folderPalette = ["#2b6cb0", "#2c7a7b", "#3b5998", "#4c51bf", "#2f855a", "#3182ce"];
            return folderPalette[index % folderPalette.length];
        }
        const ext = (item.ext || "").toLowerCase();
        return extColorMap.get(ext) || "#4a5568";
    }

    async function refreshDrives() {
        const button = byId("disk-map-refresh");
        button.disabled = true;
        try {
            const selected = drive.value;
            const volumes = (await invoke("disk_map_drives")).filter((volume) =>
                ["Local Volume", "Removable", "Optical Drive", "RAM Disk"].includes(volume.drive_type)
            );
            drive.replaceChildren(...volumes.map((volume) =>
                new Option(`${volume.label || volume.drive_type} (${volume.mount.slice(0, 2)}) · ${size(volume.used)} used`, volume.mount)
            ));
            if (volumes.some((volume) => volume.mount === selected)) drive.value = selected;
            if (!path.value) path.value = drive.value;
            renderDriveStrip(volumes);
            drivesLoaded = true;
        } catch (error) { status.textContent = String(error); }
        finally { button.disabled = false; }
    }

    function renderDriveStrip(volumes) {
        if (!drivesStrip) return;
        drivesStrip.replaceChildren(...volumes.map((v) => {
            const pct = v.total > 0 ? Math.round((v.used * 100) / v.total) : 0;
            const free = Math.max(0, v.total - v.used);
            const card = document.createElement("button");
            card.type = "button";
            card.className = "disk-map-drive-card" + (root && root.toLowerCase().startsWith(v.mount.toLowerCase()) ? " active" : "");
            const top = element("div", "disk-map-drive-top");
            top.append(element("span", "", `${v.removable ? "🟢" : "💾"} ${v.mount.slice(0, 2)} ${v.label || "Local Disk"}`), element("span", "", `${pct}%`));
            const track = element("div", "track-bg");
            const fill = element("div", "track-fill" + (pct >= 95 ? " bar-crit" : pct >= 85 ? " bar-warn" : ""));
            fill.style.width = Math.min(100, pct) + "%";
            track.append(fill);
            const sub = element("div", "disk-map-drive-sub", `${size(free)} free · ${size(v.total)}`);
            card.append(top, track, sub);
            card.title = `Scan ${v.mount} now`;
            card.addEventListener("click", () => {
                drive.value = v.mount;
                void scan(v.mount, true);
            });
            return card;
        }));
    }

    function action(text, run, extra = "") {
        const button = actionButton(text, run);
        button.className = "console-clear-btn" + (extra ? " " + extra : "");
        return button;
    }

    async function navigateTo(targetPath, forceRescan = false) {
        if (!targetPath) return;
        if (!forceRescan && !scanning) {
            try {
                const cached = await invoke("disk_map_node", { path: targetPath });
                if (cached) {
                    result = cached;
                    path.value = result.root;
                    selectedItem = null;
                    render();
                    return;
                }
            } catch { /* Fall back to fresh scan */ }
        }
        await scan(targetPath, false);
    }

    function drill(item) {
        if (item?.directory) void navigateTo(item.path, false);
    }

    async function open(item) {
        try { await invoke("disk_map_open", { path: item.path }); }
        catch (error) { status.textContent = String(error); }
    }

    async function copyPath(item) {
        try {
            await navigator.clipboard.writeText(item.path);
            status.textContent = "Path copied.";
            window.showToast?.("Path copied", "ok", 1600);
        } catch {
            status.textContent = "The clipboard is unavailable.";
        }
    }

    async function recycleItem(item) {
        if (!item?.path) return;
        const ok = await confirmDashboardAction(
            `Move ${item.directory ? "folder" : "file"} to Recycle Bin?`,
            `${item.path}\nSize: ${size(item.bytes)}\n\nCoreWatch moves items to the Windows Recycle Bin and blocks protected system paths.`,
            "Move to Recycle Bin"
        );
        if (!ok) return;
        try {
            const updated = await invoke("disk_map_recycle", { path: item.path, currentView: result?.root ?? null });
            window.showToast?.(`Recycled ${item.name} (${size(item.bytes)})`, "ok");
            selectedItem = null;
            if (updated) {
                result = updated;
                render();
            } else if (result?.root) {
                await scan(result.root, false);
            }
        } catch (error) {
            status.textContent = String(error);
            window.showToast?.(String(error), "crit", 3600);
        }
    }

    // Squarified Treemap layout (Bruls, Huizing, van Wijk)
    function squarify(items, x, y, w, h) {
        const out = [];
        if (!items.length || w <= 1 || h <= 1) return out;
        const total = items.reduce((s, it) => s + it.bytes, 0);
        if (total <= 0) return out;
        const scale = (w * h) / total;
        const scaled = items.map((item, idx) => ({ item, idx, area: item.bytes * scale }));

        const worst = (row, side) => {
            const sum = row.reduce((s, r) => s + r.area, 0);
            if (!sum || !side) return Infinity;
            const s2 = sum * sum;
            const side2 = side * side;
            let maxR = 0;
            for (const r of row) {
                const ratio = Math.max((side2 * r.area) / s2, s2 / (side2 * r.area));
                if (ratio > maxR) maxR = ratio;
            }
            return maxR;
        };

        let rx = x, ry = y, rw = w, rh = h;
        let i = 0;
        while (i < scaled.length && rw > 0.5 && rh > 0.5) {
            const horizontal = rw >= rh;
            const side = horizontal ? rh : rw;
            const row = [scaled[i++]];
            let best = worst(row, side);
            while (i < scaled.length) {
                row.push(scaled[i]);
                const next = worst(row, side);
                if (next <= best) {
                    best = next;
                    i++;
                } else {
                    row.pop();
                    break;
                }
            }
            const rowArea = row.reduce((s, r) => s + r.area, 0);
            const thickness = rowArea / side;
            let offset = 0;
            for (const r of row) {
                const len = r.area / thickness;
                const rect = horizontal
                    ? { x: rx, y: ry + offset, w: thickness, h: len, item: r.item, idx: r.idx }
                    : { x: rx + offset, y: ry, w: len, h: thickness, item: r.item, idx: r.idx };
                out.push(rect);
                offset += len;
            }
            if (horizontal) { rx += thickness; rw -= thickness; }
            else { ry += thickness; rh -= thickness; }
        }
        return out;
    }

    function drawTreemap(tiles) {
        if (!canvas || map.hidden) {
            renderedRects = [];
            map.dataset.tileCount = "0";
            return;
        }
        const rect = map.getBoundingClientRect();
        const width = Math.max(10, Math.floor(rect.width));
        const height = Math.max(10, Math.floor(rect.height));
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
            canvas.width = Math.floor(width * dpr);
            canvas.height = Math.floor(height * dpr);
        }
        const ctx = canvas.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, width, height);

        const rects = squarify(tiles, 1, 1, width - 2, height - 2);
        renderedRects = rects;
        map.dataset.tileCount = String(rects.length);
        const totalBytes = result?.bytes || 1;

        for (const r of rects) {
            const item = r.item;
            const isSelected = selectedItem && selectedItem.path === item.path;
            const isHovered = hoveredRect && hoveredRect.item.path === item.path;
            const dimmed = Boolean(activeExt && !item.directory && item.ext !== activeExt);
            const baseColor = colorForItem(item, r.idx);

            ctx.save();
            ctx.globalAlpha = dimmed ? 0.28 : 1;
            ctx.fillStyle = baseColor;
            ctx.fillRect(r.x + 1, r.y + 1, Math.max(0, r.w - 2), Math.max(0, r.h - 2));

            // Subtle cushion gradient for depth
            const grad = ctx.createLinearGradient(r.x, r.y, r.x, r.y + r.h);
            grad.addColorStop(0, "rgba(255,255,255,0.16)");
            grad.addColorStop(1, "rgba(0,0,0,0.28)");
            ctx.fillStyle = grad;
            ctx.fillRect(r.x + 1, r.y + 1, Math.max(0, r.w - 2), Math.max(0, r.h - 2));

            // 2-level nested children inside large folders
            const headerH = 18;
            if (item.directory && item.preview_children?.length && r.w >= 76 && r.h >= 50) {
                const inner = squarify(item.preview_children, r.x + 3, r.y + headerH + 1, r.w - 6, r.h - headerH - 4);
                for (const sub of inner) {
                    if (sub.w < 3 || sub.h < 3) continue;
                    ctx.fillStyle = colorForItem(sub.item, sub.idx);
                    ctx.globalAlpha = dimmed ? 0.25 : 0.78;
                    ctx.fillRect(sub.x + 0.5, sub.y + 0.5, Math.max(0, sub.w - 1), Math.max(0, sub.h - 1));
                    ctx.strokeStyle = "rgba(10,14,22,0.55)";
                    ctx.lineWidth = 0.8;
                    ctx.strokeRect(sub.x + 0.5, sub.y + 0.5, Math.max(0, sub.w - 1), Math.max(0, sub.h - 1));
                    if (sub.w >= 46 && sub.h >= 18) {
                        ctx.save();
                        ctx.beginPath();
                        ctx.rect(sub.x + 2, sub.y + 1, sub.w - 4, sub.h - 2);
                        ctx.clip();
                        ctx.fillStyle = "rgba(248,250,252,0.92)";
                        ctx.font = "10px Consolas, Segoe UI, sans-serif";
                        ctx.fillText(sub.item.name, sub.x + 4, sub.y + 12);
                        ctx.restore();
                    }
                }
                // Dark header strip on top of nested folder
                ctx.globalAlpha = dimmed ? 0.45 : 0.88;
                ctx.fillStyle = "rgba(10,14,22,0.52)";
                ctx.fillRect(r.x + 1, r.y + 1, Math.max(0, r.w - 2), headerH - 1);
            }

            // Border & selection/hover highlight
            ctx.globalAlpha = 1;
            ctx.strokeStyle = isSelected ? "#f6e05e" : isHovered ? "#7dd3fc" : "rgba(10,14,22,0.75)";
            ctx.lineWidth = isSelected || isHovered ? 2 : 1;
            ctx.strokeRect(r.x + 1, r.y + 1, Math.max(0, r.w - 2), Math.max(0, r.h - 2));

            // Tile label
            if (r.w >= 42 && r.h >= 18) {
                ctx.save();
                ctx.beginPath();
                ctx.rect(r.x + 3, r.y + 2, r.w - 6, r.h - 4);
                ctx.clip();
                ctx.fillStyle = "#f8fafc";
                ctx.font = "bold 11px Consolas, Segoe UI, sans-serif";
                const prefix = item.directory ? "📂 " : "";
                ctx.fillText(prefix + item.name, r.x + 5, r.y + 13);
                if (r.h >= 32 && !(item.directory && item.preview_children?.length && r.w >= 76 && r.h >= 50)) {
                    const pct = ((item.bytes * 100) / totalBytes).toFixed(1);
                    ctx.fillStyle = "rgba(226,232,240,0.88)";
                    ctx.font = "10px Consolas, Segoe UI, sans-serif";
                    ctx.fillText(`${size(item.bytes)} (${pct}%)`, r.x + 5, r.y + 26);
                }
                ctx.restore();
            }
            ctx.restore();
        }
    }

    function renderBreadcrumbs() {
        if (!breadcrumbs || !result) {
            breadcrumbs?.replaceChildren();
            return;
        }
        const raw = result.root.replace(/\//g, "\\");
        const parts = raw.split("\\").filter(Boolean);
        const nodes = [];
        let acc = "";
        parts.forEach((part, idx) => {
            acc = idx === 0 ? part + "\\" : acc.endsWith("\\") ? acc + part : acc + "\\" + part;
            const target = acc;
            if (idx > 0) nodes.push(element("span", "disk-map-crumb-sep", "›"));
            const btn = document.createElement("button");
            btn.type = "button";
            btn.className = "disk-map-crumb" + (idx === parts.length - 1 ? " is-current" : "");
            btn.textContent = idx === 0 ? part + "\\" : part;
            btn.title = target;
            btn.disabled = idx === parts.length - 1;
            btn.addEventListener("click", () => void navigateTo(target, false));
            nodes.push(btn);
        });
        breadcrumbs.replaceChildren(...nodes);
    }

    function updateSelectionBar() {
        if (!selBar) return;
        if (!selectedItem || !selectedItem.path) {
            selBar.hidden = true;
            return;
        }
        selBar.hidden = false;
        const pct = result?.bytes > 0 ? ((selectedItem.bytes * 100) / result.bytes).toFixed(1) : "0.0";
        selLabel.textContent = `${selectedItem.directory ? "📂" : "📄"} ${selectedItem.name} · ${size(selectedItem.bytes)} (${pct}%)`;
        selLabel.title = selectedItem.path;
        selZoom.hidden = !selectedItem.directory;
    }

    function currentItems() {
        if (!result) return [];
        const query = filter.value.trim().toLowerCase();
        let list = result[mode].filter((item) => {
            if (activeExt && mode !== "extensions" && !item.directory && item.ext !== activeExt) return false;
            return `${item.name} ${item.path ?? ""} ${item.top_file ?? ""}`.toLowerCase().includes(query);
        });
        list = [...list].sort((a, b) => {
            if (sortKey === "name") return sortDir * a.name.localeCompare(b.name);
            if (sortKey === "info") return sortDir * ((a.files || 0) - (b.files || 0));
            if (sortKey === "modified") return sortDir * ((a.modified_ms || 0) - (b.modified_ms || 0));
            return sortDir * (a.bytes - b.bytes);
        });
        return list;
    }

    function updateSortHeaders() {
        if (!thead) return;
        const labels = {
            name: mode === "extensions" ? "Extension" : "Item / Path",
            bytes: "Size",
            pct: "%",
            info: mode === "extensions" ? "Files / Top File" : "Files / Folders",
            modified: "Modified"
        };
        for (const th of thead.querySelectorAll("th[data-sort]")) {
            const key = th.dataset.sort;
            const arrow = key === sortKey || (sortKey === "bytes" && key === "pct") ? (sortDir < 0 ? " ▼" : " ▲") : "";
            th.textContent = labels[key] + arrow;
        }
    }

    function render() {
        for (const tab of modes) {
            const selected = tab.dataset.diskMode === mode;
            tab.classList.toggle("active", selected);
            tab.setAttribute("aria-pressed", String(selected));
        }
        if (extChip) {
            extChip.hidden = !activeExt;
            if (activeExt) extChip.textContent = `Ext: ${activeExt} ✕`;
        }
        up.disabled = scanning || !result?.parent || result.root === root;
        home.disabled = scanning || !root || result?.root === root;
        if (!result) return;

        renderBreadcrumbs();
        updateSortHeaders();
        updateSelectionBar();

        const items = currentItems();
        const totalBytes = result.bytes || 1;
        const stats = [
            ["Size", size(result.bytes)],
            ["Files", result.files.toLocaleString()],
            ["Folders", result.folders.toLocaleString()],
            ["Access skipped", result.inaccessible.toLocaleString()],
            ["Links skipped", result.skipped_links.toLocaleString()],
            ["Scan", result.cached ? "Instant (cached)" : `${(result.elapsed_ms / 1000).toFixed(2)} s`]
        ];
        byId("disk-map-stats").replaceChildren(...stats.map(([label, value]) => {
            const node = element("span", "tasks-stat", label);
            node.append(element("strong", "", value));
            return node;
        }));

        byId("disk-map-table").hidden = false;
        rows.replaceChildren(...items.map((item, idx) => {
            const row = element("tr", selectedItem && item.path && selectedItem.path === item.path ? "is-selected" : "");
            const title = element("td", "tasks-main-cell");
            const strong = element("strong", "");
            if (mode === "extensions") {
                const dot = element("span", "disk-map-ext-dot");
                dot.style.backgroundColor = extColorMap.get(item.name.toLowerCase()) || "#4a5568";
                strong.append(dot, document.createTextNode(item.name));
            } else {
                strong.textContent = (item.directory ? "📂 " : "📄 ") + item.name;
            }
            const detail = element("small", "", item.path ?? (item.top_file ? `Top: ${item.top_file} (${size(item.top_file_size)})` : `${item.files} files`));
            detail.title = detail.textContent;
            title.append(strong, detail);

            const pctNum = (item.bytes * 100) / totalBytes;
            const pctCell = element("td", "disk-map-pct-cell");
            pctCell.append(element("span", "", `${pctNum.toFixed(1)}%`));
            const pctBar = element("div", "disk-map-pct-bar");
            const pctFill = element("div", "disk-map-pct-fill");
            pctFill.style.width = `${Math.min(100, pctNum)}%`;
            pctFill.style.backgroundColor = mode === "extensions"
                ? (extColorMap.get(item.name.toLowerCase()) || "var(--cw-accent-light)")
                : colorForItem(item, idx);
            pctBar.append(pctFill);
            pctCell.append(pctBar);

            const infoText = mode === "extensions"
                ? `${item.files.toLocaleString()} files`
                : item.directory
                    ? `${(item.files || 0).toLocaleString()} f · ${(item.dirs || 0).toLocaleString()} d`
                    : (item.ext || "File");
            const infoCell = element("td", "tasks-number", infoText);
            const modCell = element("td", "tasks-number", formatDate(item.modified_ms));

            const actions = element("td", "");
            const bar = element("div", "panel-actions tasks-row-actions");
            if (mode === "extensions") {
                bar.append(action("Filter Tree", () => {
                    activeExt = item.name;
                    mode = "largest";
                    render();
                }));
            } else if (item.path) {
                if (item.directory) bar.append(action("Zoom", () => drill(item)));
                bar.append(
                    action("Reveal", () => open(item)),
                    action("Copy", () => copyPath(item)),
                    action("🗑", () => recycleItem(item), "btn-danger")
                );
            }
            actions.append(bar);

            row.addEventListener("click", (ev) => {
                if (ev.target.closest("button")) return;
                if (mode === "extensions") {
                    activeExt = activeExt === item.name ? null : item.name;
                    render();
                    return;
                }
                selectedItem = item;
                updateSelectionBar();
                for (const tr of rows.children) tr.classList.remove("is-selected");
                row.classList.add("is-selected");
                if (!map.hidden) drawTreemap(items.filter((i) => i.bytes > 0).slice(0, 40));
            });
            row.addEventListener("dblclick", (ev) => {
                if (ev.target.closest("button")) return;
                if (item.directory) drill(item);
            });
            row.append(title, element("td", "tasks-number", size(item.bytes)), pctCell, infoCell, modCell, actions);
            return row;
        }));

        const tiles = mode === "entries" ? items.filter((item) => item.bytes > 0).slice(0, 40) : [];
        map.hidden = !tiles.length;
        drawTreemap(tiles);
        status.textContent = `${result.root} · ${items.length} items shown${result.partial ? ` · ${result.partial}. Totals are partial.` : ""}`;
    }

    function hitTest(clientX, clientY) {
        const bounds = canvas.getBoundingClientRect();
        const x = clientX - bounds.left;
        const y = clientY - bounds.top;
        return renderedRects.find((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) || null;
    }

    canvas?.addEventListener("mousemove", (ev) => {
        const hit = hitTest(ev.clientX, ev.clientY);
        if (hit !== hoveredRect) {
            hoveredRect = hit;
            const tiles = mode === "entries" ? currentItems().filter((i) => i.bytes > 0).slice(0, 40) : [];
            drawTreemap(tiles);
        }
        if (!hit) {
            tooltip.hidden = true;
            return;
        }
        const item = hit.item;
        const pct = result?.bytes > 0 ? ((item.bytes * 100) / result.bytes).toFixed(1) : "0.0";
        const bounds = map.getBoundingClientRect();
        const tx = Math.min(bounds.width - 260, Math.max(8, ev.clientX - bounds.left + 14));
        const ty = Math.min(bounds.height - 86, Math.max(8, ev.clientY - bounds.top + 14));
        tooltip.style.left = tx + "px";
        tooltip.style.top = ty + "px";
        tooltip.replaceChildren(
            element("strong", "", `${item.directory ? "📂 " : "📄 "}${item.name}`),
            element("div", "", `${size(item.bytes)} (${pct}%)${item.directory ? ` · ${(item.files || 0).toLocaleString()} files · ${(item.dirs || 0).toLocaleString()} folders` : ""}`),
            element("small", "", item.modified_ms ? `Modified: ${formatDate(item.modified_ms)}` : ""),
            element("small", "", item.path)
        );
        tooltip.hidden = false;
    });
    canvas?.addEventListener("mouseleave", () => {
        if (hoveredRect) {
            hoveredRect = null;
            const tiles = mode === "entries" ? currentItems().filter((i) => i.bytes > 0).slice(0, 40) : [];
            drawTreemap(tiles);
        }
        tooltip.hidden = true;
    });
    canvas?.addEventListener("click", (ev) => {
        const hit = hitTest(ev.clientX, ev.clientY);
        if (!hit) return;
        selectedItem = hit.item;
        render();
    });
    canvas?.addEventListener("dblclick", (ev) => {
        const hit = hitTest(ev.clientX, ev.clientY);
        if (!hit) return;
        if (hit.item.directory) drill(hit.item);
        else void open(hit.item);
    });

    selZoom?.addEventListener("click", () => { if (selectedItem?.directory) drill(selectedItem); });
    selOpen?.addEventListener("click", () => { if (selectedItem) void open(selectedItem); });
    selCopy?.addEventListener("click", () => { if (selectedItem) void copyPath(selectedItem); });
    selRecycle?.addEventListener("click", () => { if (selectedItem) void recycleItem(selectedItem); });
    extChip?.addEventListener("click", () => { activeExt = null; render(); });

    thead?.addEventListener("click", (ev) => {
        const th = ev.target.closest("th[data-sort]");
        if (!th) return;
        const key = th.dataset.sort === "pct" ? "bytes" : th.dataset.sort;
        if (sortKey === key) sortDir = -sortDir;
        else { sortKey = key; sortDir = key === "name" ? 1 : -1; }
        if (!scanning) render();
    });

    async function scan(target, newRoot = true) {
        if (scanning) { status.textContent = "Cancel the current scan before choosing another path."; return; }
        if (!target?.trim()) { status.textContent = "Choose a local volume or folder."; return; }
        target = target.trim();
        path.value = target;
        scanning = true;
        selectedItem = null;
        scanButton.disabled = true;
        if (browseButton) browseButton.disabled = true;
        cancelButton.hidden = false;
        cancelButton.disabled = false;
        up.disabled = home.disabled = true;
        status.textContent = `Scanning ${target} (parallel Win32 engine)…`;
        try {
            result = await invoke("disk_map_scan", { path: target });
            if (newRoot) { root = result.root; mode = "entries"; activeExt = null; }
        } catch (error) {
            status.textContent = String(error);
            return;
        } finally {
            scanning = false;
            scanButton.disabled = false;
            if (browseButton) browseButton.disabled = false;
            cancelButton.hidden = true;
            up.disabled = !result?.parent || result.root === root;
            home.disabled = !root || result?.root === root;
        }
        render();
    }

    for (const button of modes) button.addEventListener("click", () => { mode = button.dataset.diskMode; if (!scanning) render(); });
    filter.addEventListener("input", () => { if (!scanning) render(); });
    drive.addEventListener("change", () => { path.value = drive.value; });
    byId("disk-map-refresh").addEventListener("click", refreshDrives);
    scanButton.addEventListener("click", () => scan(path.value, true));
    path.addEventListener("keydown", (event) => { if (event.key === "Enter") void scan(path.value, true); });
    browseButton?.addEventListener("click", async () => {
        if (scanning || browseButton.disabled) return;
        browseButton.disabled = true;
        let selected = null;
        try {
            selected = await invoke("settings_action", { action: { kind: "disk_folder" } });
        } catch (error) {
            status.textContent = String(error);
        } finally {
            if (!scanning) browseButton.disabled = false;
        }
        if (selected) await scan(selected, true);
    });
    cancelButton.addEventListener("click", async () => {
        cancelButton.disabled = true;
        try { await invoke("disk_map_cancel"); }
        catch (error) { status.textContent = String(error); cancelButton.disabled = false; }
    });
    up.addEventListener("click", () => void navigateTo(result?.parent, false));
    home.addEventListener("click", () => void navigateTo(root, false));

    let resizeRaf = 0;
    new ResizeObserver(() => {
        if (map.hidden || !result || mode !== "entries") return;
        if (resizeRaf) cancelAnimationFrame(resizeRaf);
        resizeRaf = requestAnimationFrame(() => {
            resizeRaf = 0;
            if (map.hidden || !result || mode !== "entries") return;
            drawTreemap(currentItems().filter((item) => item.bytes > 0).slice(0, 40));
        });
    }).observe(map);

    return { async show(target) { if (!drivesLoaded) await refreshDrives(); if (target) await scan(target, true); } };
}
