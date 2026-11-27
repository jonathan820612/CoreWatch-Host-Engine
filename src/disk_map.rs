use serde::Serialize;
use std::{
    cmp::Reverse,
    collections::{BinaryHeap, HashMap},
    os::windows::ffi::OsStringExt,
    path::{Component, Path, PathBuf, Prefix},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    time::{Duration, Instant},
};
use windows_sys::Win32::{
    Foundation::INVALID_HANDLE_VALUE,
    Storage::FileSystem::{
        FILE_ATTRIBUTE_DIRECTORY, FILE_ATTRIBUTE_REPARSE_POINT, FIND_FIRST_EX_LARGE_FETCH,
        FindClose, FindExInfoBasic, FindExSearchNameMatch, FindFirstFileExW, FindNextFileW,
        WIN32_FIND_DATAW,
    },
};

const MAX_ENTRIES: usize = 1_500_000;
const MAX_SCAN_TIME: Duration = Duration::from_secs(45);
const MAX_CHILDREN_RESPONSE: usize = 300;
const MAX_STORED_FILES_PER_DIR: usize = 64;
const MAX_PREVIEW_CHILDREN: usize = 14;
const MAX_FILES: usize = 200;
const MAX_EXTENSIONS: usize = 512;

#[derive(Default)]
pub struct State {
    active: Mutex<Option<Arc<AtomicBool>>>,
    cache: Mutex<Option<CachedTree>>,
}

pub struct Job {
    state: Arc<State>,
    cancel: Arc<AtomicBool>,
}

struct TreeNode {
    name: String,
    path: String,
    bytes: u64,
    files: u64,
    dirs: u64,
    modified_ms: i64,
    directory: bool,
    ext: String,
    parent: Option<usize>,
    children: Vec<usize>,
    removed: bool,
}

struct CachedTree {
    scan_root: String,
    nodes: Vec<TreeNode>,
    path_index: HashMap<String, usize>,
    largest: Vec<Entry>,
    extensions: Vec<Extension>,
    inaccessible: u64,
    skipped_links: u64,
    elapsed_ms: u128,
    partial: Option<&'static str>,
}

impl State {
    pub fn begin(self: &Arc<Self>) -> Result<Job, String> {
        let mut active = self.active.lock().map_err(|_| "Disk Map is unavailable.")?;
        if active.is_some() {
            return Err("A disk scan is already running.".into());
        }
        let cancel = Arc::new(AtomicBool::new(false));
        *active = Some(cancel.clone());
        Ok(Job {
            state: self.clone(),
            cancel,
        })
    }

    pub fn cancel(&self) {
        if let Ok(active) = self.active.lock()
            && let Some(cancel) = active.as_ref()
        {
            cancel.store(true, Ordering::Relaxed);
        }
    }

    pub fn node_view(&self, path: &Path) -> Result<Option<Scan>, String> {
        let key = normalize_key(&path.to_string_lossy());
        let guard = self.cache.lock().map_err(|_| "Disk Map cache unavailable.")?;
        let Some(tree) = guard.as_ref() else {
            return Ok(None);
        };
        let Some(&idx) = tree.path_index.get(&key) else {
            return Ok(None);
        };
        if tree.nodes[idx].removed || !tree.nodes[idx].directory {
            return Ok(None);
        }
        Ok(Some(tree.view_for(idx, true)))
    }

    pub fn recycle(&self, path: &Path, current_view: Option<&Path>) -> Result<Option<Scan>, String> {
        local_path(path)?;
        crate::dashboard_actions::recycle_path(path)?;
        let key = normalize_key(&path.to_string_lossy());
        let mut guard = self.cache.lock().map_err(|_| "Disk Map cache unavailable.")?;
        let Some(tree) = guard.as_mut() else {
            return Ok(None);
        };
        if let Some(&idx) = tree.path_index.get(&key)
            && !tree.nodes[idx].removed
        {
            let delta_bytes = tree.nodes[idx].bytes;
            let delta_files = if tree.nodes[idx].directory {
                tree.nodes[idx].files
            } else {
                1
            };
            let delta_dirs = if tree.nodes[idx].directory {
                tree.nodes[idx].dirs + 1
            } else {
                0
            };
            mark_removed(&mut tree.nodes, idx);
            let mut cur = tree.nodes[idx].parent;
            while let Some(p) = cur {
                let node = &mut tree.nodes[p];
                node.bytes = node.bytes.saturating_sub(delta_bytes);
                node.files = node.files.saturating_sub(delta_files);
                node.dirs = node.dirs.saturating_sub(delta_dirs);
                cur = node.parent;
            }
            let prefix = key.clone();
            tree.largest.retain(|e| {
                let k = normalize_key(&e.path);
                k != prefix && !k.starts_with(&(prefix.clone() + "\\"))
            });
        }
        let target_key = current_view
            .map(|p| normalize_key(&p.to_string_lossy()))
            .unwrap_or_else(|| normalize_key(&tree.scan_root));
        if let Some(&view_idx) = tree.path_index.get(&target_key)
            && !tree.nodes[view_idx].removed
        {
            return Ok(Some(tree.view_for(view_idx, true)));
        }
        if !tree.nodes.is_empty() && !tree.nodes[0].removed {
            return Ok(Some(tree.view_for(0, true)));
        }
        Ok(None)
    }
}

fn mark_removed(nodes: &mut [TreeNode], idx: usize) {
    let mut stack = vec![idx];
    while let Some(n) = stack.pop() {
        if nodes[n].removed {
            continue;
        }
        nodes[n].removed = true;
        stack.extend_from_slice(&nodes[n].children);
    }
}

impl Drop for Job {
    fn drop(&mut self) {
        if let Ok(mut active) = self.state.active.lock() {
            *active = None;
        }
    }
}

impl Job {
    pub fn scan(&self, path: PathBuf) -> Result<Scan, String> {
        let resolved = local_path(&path)?;
        if !resolved.is_dir() {
            return Err("Choose a mounted drive or a local folder.".into());
        }
        let tree = scan_tree(path, &self.cancel)?;
        let view = tree.view_for(0, false);
        if let Ok(mut cache) = self.state.cache.lock() {
            *cache = Some(tree);
        }
        Ok(view)
    }
}

fn normalize_key(path: &str) -> String {
    let stripped = path.strip_prefix(r"\\?\").unwrap_or(path);
    let trimmed = if stripped.len() > 3 {
        stripped.trim_end_matches(['\\', '/'])
    } else {
        stripped
    };
    trimmed.to_ascii_lowercase()
}

fn local_path(path: &Path) -> Result<PathBuf, String> {
    fn drive(path: &Path) -> Option<char> {
        match path.components().next()? {
            Component::Prefix(prefix) => match prefix.kind() {
                Prefix::Disk(letter) | Prefix::VerbatimDisk(letter) => Some(letter as char),
                _ => None,
            },
            _ => None,
        }
    }
    if !path.is_absolute() || drive(path).is_none() {
        return Err("Disk Map requires a local drive path.".into());
    }
    let mounted = |path| {
        drive(path).is_some_and(|letter| {
            matches!(
                crate::storage::drive_type(Path::new(&format!("{letter}:\\"))),
                "Local Volume" | "Removable" | "Optical Drive" | "RAM Disk"
            )
        })
    };
    if !mounted(path) {
        return Err("The selected drive is not a mounted local volume.".into());
    }
    let resolved = path.canonicalize().map_err(|error| format!("{error}"))?;
    if !mounted(&resolved) {
        return Err("This path resolves outside the local volumes.".into());
    }
    Ok(resolved)
}

pub fn open_path(path: &Path) -> Result<(), String> {
    local_path(path)?;
    if path.is_dir() {
        crate::dashboard_actions::open_directory(path)
    } else {
        crate::dashboard_actions::reveal_in_explorer(path)
    }
}

#[derive(Serialize, Clone)]
pub struct Scan {
    root: String,
    scan_root: String,
    parent: Option<String>,
    bytes: u64,
    files: u64,
    folders: u64,
    inaccessible: u64,
    skipped_links: u64,
    elapsed_ms: u128,
    partial: Option<&'static str>,
    cached: bool,
    entries: Vec<Entry>,
    largest: Vec<Entry>,
    extensions: Vec<Extension>,
}

#[derive(Serialize, Clone, PartialEq, Eq)]
struct ChildTile {
    name: String,
    path: String,
    bytes: u64,
    directory: bool,
    ext: String,
}

#[derive(Serialize, Clone, PartialEq, Eq)]
struct Entry {
    bytes: u64,
    name: String,
    path: String,
    directory: bool,
    files: u64,
    dirs: u64,
    modified_ms: i64,
    ext: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    preview_children: Vec<ChildTile>,
}

impl Ord for Entry {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.bytes
            .cmp(&other.bytes)
            .then_with(|| self.path.cmp(&other.path))
    }
}

impl PartialOrd for Entry {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}

#[derive(Serialize, Default, Clone)]
struct Extension {
    name: String,
    bytes: u64,
    files: u64,
    top_file: String,
    top_file_size: u64,
}

impl CachedTree {
    fn view_for(&self, idx: usize, cached: bool) -> Scan {
        let node = &self.nodes[idx];
        let mut child_indices: Vec<usize> = node
            .children
            .iter()
            .copied()
            .filter(|&c| !self.nodes[c].removed)
            .collect();
        child_indices.sort_unstable_by(|&a, &b| {
            self.nodes[b]
                .bytes
                .cmp(&self.nodes[a].bytes)
                .then_with(|| self.nodes[a].name.cmp(&self.nodes[b].name))
        });
        let entries: Vec<Entry> = child_indices
            .into_iter()
            .take(MAX_CHILDREN_RESPONSE)
            .map(|c| {
                let child = &self.nodes[c];
                let preview_children = if child.directory {
                    let mut subs: Vec<usize> = child
                        .children
                        .iter()
                        .copied()
                        .filter(|&s| !self.nodes[s].removed && self.nodes[s].bytes > 0)
                        .collect();
                    subs.sort_unstable_by(|&a, &b| self.nodes[b].bytes.cmp(&self.nodes[a].bytes));
                    subs.into_iter()
                        .take(MAX_PREVIEW_CHILDREN)
                        .map(|s| {
                            let sub = &self.nodes[s];
                            ChildTile {
                                name: sub.name.clone(),
                                path: sub.path.clone(),
                                bytes: sub.bytes,
                                directory: sub.directory,
                                ext: sub.ext.clone(),
                            }
                        })
                        .collect()
                } else {
                    Vec::new()
                };
                Entry {
                    bytes: child.bytes,
                    name: child.name.clone(),
                    path: child.path.clone(),
                    directory: child.directory,
                    files: child.files,
                    dirs: child.dirs,
                    modified_ms: child.modified_ms,
                    ext: child.ext.clone(),
                    preview_children,
                }
            })
            .collect();

        let scope_prefix = normalize_key(&node.path);
        let largest = if idx == 0 {
            self.largest.clone()
        } else {
            let mut filtered: Vec<Entry> = self
                .largest
                .iter()
                .filter(|e| {
                    let k = normalize_key(&e.path);
                    k.starts_with(&(scope_prefix.clone() + "\\"))
                })
                .cloned()
                .collect();
            if filtered.len() < 30 {
                // Collect top files inside this subtree from cached directory file entries.
                let mut seen: std::collections::HashSet<String> =
                    filtered.iter().map(|e| normalize_key(&e.path)).collect();
                let mut stack = vec![idx];
                let mut heap = BinaryHeap::new();
                while let Some(cur) = stack.pop() {
                    for &c in &self.nodes[cur].children {
                        let cn = &self.nodes[c];
                        if cn.removed {
                            continue;
                        }
                        if cn.directory {
                            stack.push(c);
                        } else if !seen.contains(&normalize_key(&cn.path)) {
                            seen.insert(normalize_key(&cn.path));
                            retain_largest(
                                &mut heap,
                                Entry {
                                    bytes: cn.bytes,
                                    name: cn.name.clone(),
                                    path: cn.path.clone(),
                                    directory: false,
                                    files: 1,
                                    dirs: 0,
                                    modified_ms: cn.modified_ms,
                                    ext: cn.ext.clone(),
                                    preview_children: Vec::new(),
                                },
                                MAX_FILES,
                            );
                        }
                    }
                }
                filtered.extend(heap.into_iter().map(|r| r.0));
                filtered.sort_unstable_by_key(|a| std::cmp::Reverse(a.bytes));
                filtered.truncate(MAX_FILES);
            }
            filtered
        };

        let parent = Path::new(&node.path)
            .parent()
            .map(|p| p.to_string_lossy().into_owned());

        Scan {
            root: node.path.clone(),
            scan_root: self.scan_root.clone(),
            parent,
            bytes: node.bytes,
            files: node.files,
            folders: node.dirs,
            inaccessible: self.inaccessible,
            skipped_links: self.skipped_links,
            elapsed_ms: self.elapsed_ms,
            partial: self.partial,
            cached,
            entries,
            largest,
            extensions: self.extensions.clone(),
        }
    }
}

struct RawEntry {
    name: String,
    bytes: u64,
    modified_ms: i64,
    is_dir: bool,
    is_reparse: bool,
}

fn filetime_to_unix_ms(low: u32, high: u32) -> i64 {
    let ticks = ((high as u64) << 32) | (low as u64);
    if ticks < 116_444_736_000_000_000 {
        return 0;
    }
    ((ticks - 116_444_736_000_000_000) / 10_000) as i64
}

fn extended_search_pattern(dir: &Path) -> Vec<u16> {
    let raw = dir.to_string_lossy();
    let trimmed = raw.trim_end_matches(['\\', '/']);
    let mut pattern = if trimmed.starts_with(r"\\?\") {
        format!(r"{trimmed}\*")
    } else if trimmed.starts_with(r"\\") {
        format!(r"\\?\UNC\{}\*", trimmed.trim_start_matches('\\'))
    } else {
        format!(r"\\?\{trimmed}\*")
    };
    if pattern.ends_with(r"\\*") {
        pattern = pattern.replace(r"\\*", r"\*");
    }
    pattern.encode_utf16().chain([0]).collect()
}

fn read_dir_win32(dir: &Path) -> Result<Vec<RawEntry>, ()> {
    let pattern = extended_search_pattern(dir);
    let mut data: WIN32_FIND_DATAW = unsafe { std::mem::zeroed() };
    let handle = unsafe {
        FindFirstFileExW(
            pattern.as_ptr(),
            FindExInfoBasic,
            (&mut data as *mut WIN32_FIND_DATAW).cast(),
            FindExSearchNameMatch,
            std::ptr::null(),
            FIND_FIRST_EX_LARGE_FETCH,
        )
    };
    if handle == INVALID_HANDLE_VALUE {
        return Err(());
    }
    let mut out = Vec::with_capacity(32);
    loop {
        let len = data
            .cFileName
            .iter()
            .position(|&c| c == 0)
            .unwrap_or(data.cFileName.len());
        let name_slice = &data.cFileName[..len];
        let is_dots = (len == 1 && name_slice[0] == b'.' as u16)
            || (len == 2 && name_slice[0] == b'.' as u16 && name_slice[1] == b'.' as u16);
        if !is_dots {
            let name = std::ffi::OsString::from_wide(name_slice)
                .to_string_lossy()
                .into_owned();
            let attrs = data.dwFileAttributes;
            let bytes = ((data.nFileSizeHigh as u64) << 32) | (data.nFileSizeLow as u64);
            let modified_ms =
                filetime_to_unix_ms(data.ftLastWriteTime.dwLowDateTime, data.ftLastWriteTime.dwHighDateTime);
            out.push(RawEntry {
                name,
                bytes,
                modified_ms,
                is_dir: attrs & FILE_ATTRIBUTE_DIRECTORY != 0,
                is_reparse: attrs & FILE_ATTRIBUTE_REPARSE_POINT != 0,
            });
        }
        if unsafe { FindNextFileW(handle, &mut data) } == 0 {
            break;
        }
    }
    unsafe {
        FindClose(handle);
    }
    Ok(out)
}

fn extension_label(name: &str) -> String {
    match Path::new(name).extension().filter(|e| !e.is_empty()) {
        Some(ext) => format!(".{}", ext.to_string_lossy().to_ascii_lowercase()),
        None => "No extension".into(),
    }
}

fn join_display_path(base: &str, child: &str) -> String {
    if base.ends_with('\\') || base.ends_with('/') {
        format!("{base}{child}")
    } else {
        format!(r"{base}\{child}")
    }
}

struct SubtreeResult {
    nodes: Vec<TreeNode>,
    inaccessible: u64,
    skipped_links: u64,
    largest: BinaryHeap<Reverse<Entry>>,
    extensions: HashMap<String, Extension>,
    partial: Option<&'static str>,
}

struct SharedLimits<'a> {
    cancelled: &'a AtomicBool,
    start: Instant,
    visited: AtomicUsize,
}

impl SharedLimits<'_> {
    fn check(&self) -> Option<&'static str> {
        if self.cancelled.load(Ordering::Relaxed) {
            return Some("Scan canceled");
        }
        if self.visited.load(Ordering::Relaxed) >= MAX_ENTRIES {
            return Some("Scan reached the entry limit");
        }
        if self.start.elapsed() >= MAX_SCAN_TIME {
            return Some("Scan reached the time limit");
        }
        None
    }

    fn advance(&self) -> Option<&'static str> {
        if let Some(reason) = self.check() {
            return Some(reason);
        }
        self.visited.fetch_add(1, Ordering::Relaxed);
        None
    }
}

fn retain_largest(heap: &mut BinaryHeap<Reverse<Entry>>, item: Entry, limit: usize) {
    if heap.len() < limit {
        heap.push(Reverse(item));
    } else if heap.peek().is_some_and(|last| item > last.0) {
        *heap.peek_mut().unwrap() = Reverse(item);
    }
}

fn record_file(
    path: &str,
    name: &str,
    bytes: u64,
    modified_ms: i64,
    ext: &str,
    largest: &mut BinaryHeap<Reverse<Entry>>,
    extensions: &mut HashMap<String, Extension>,
) {
    let key = if extensions.len() >= MAX_EXTENSIONS && !extensions.contains_key(ext) {
        "Other extensions".to_owned()
    } else {
        ext.to_owned()
    };
    let total = extensions.entry(key.clone()).or_insert(Extension {
        name: key,
        ..Extension::default()
    });
    total.bytes = total.bytes.saturating_add(bytes);
    total.files += 1;
    if bytes > total.top_file_size || total.top_file.is_empty() {
        total.top_file_size = bytes;
        total.top_file = name.to_owned();
    }
    if largest.len() < MAX_FILES || largest.peek().is_some_and(|last| bytes > last.0.bytes) {
        retain_largest(
            largest,
            Entry {
                bytes,
                name: name.to_owned(),
                path: path.to_owned(),
                directory: false,
                files: 1,
                dirs: 0,
                modified_ms,
                ext: ext.to_owned(),
                preview_children: Vec::new(),
            },
            MAX_FILES,
        );
    }
}

fn walk_subtree(
    root_name: String,
    root_path: String,
    root_modified: i64,
    limits: &SharedLimits<'_>,
) -> SubtreeResult {
    let mut nodes = vec![TreeNode {
        name: root_name,
        path: root_path,
        bytes: 0,
        files: 0,
        dirs: 0,
        modified_ms: root_modified,
        directory: true,
        ext: String::new(),
        parent: None,
        children: Vec::new(),
        removed: false,
    }];
    let mut inaccessible = 0u64;
    let mut skipped_links = 0u64;
    let mut largest = BinaryHeap::new();
    let mut extensions = HashMap::new();
    let mut partial = None;

    // Iterative DFS with post-order bubble-up of sizes/counts.
    let mut stack: Vec<(usize, bool)> = vec![(0, false)];
    while let Some((dir_idx, expanded)) = stack.pop() {
        if expanded {
            let mut sum_bytes = 0u64;
            let mut sum_files = 0u64;
            let mut sum_dirs = 0u64;
            let children = nodes[dir_idx].children.clone();
            for c in children {
                let cn = &nodes[c];
                if cn.directory {
                    sum_bytes = sum_bytes.saturating_add(cn.bytes);
                    sum_files = sum_files.saturating_add(cn.files);
                    sum_dirs = sum_dirs.saturating_add(cn.dirs + 1);
                }
            }
            nodes[dir_idx].bytes = nodes[dir_idx].bytes.saturating_add(sum_bytes);
            nodes[dir_idx].files = nodes[dir_idx].files.saturating_add(sum_files);
            nodes[dir_idx].dirs = nodes[dir_idx].dirs.saturating_add(sum_dirs);
            continue;
        }
        if let Some(reason) = limits.check() {
            partial = Some(reason);
            continue;
        }
        let dir_path = nodes[dir_idx].path.clone();
        let Ok(raw_items) = read_dir_win32(Path::new(&dir_path)) else {
            inaccessible += 1;
            continue;
        };
        stack.push((dir_idx, true));
        let mut dir_file_bytes = 0u64;
        let mut dir_file_count = 0u64;
        let mut top_files: Vec<RawEntry> = Vec::new();
        let mut sub_dirs: Vec<usize> = Vec::new();

        for item in raw_items {
            if let Some(reason) = limits.advance() {
                partial = Some(reason);
                break;
            }
            if item.is_reparse {
                skipped_links += 1;
                continue;
            }
            if item.is_dir {
                let child_path = join_display_path(&dir_path, &item.name);
                let child_idx = nodes.len();
                nodes.push(TreeNode {
                    name: item.name,
                    path: child_path,
                    bytes: 0,
                    files: 0,
                    dirs: 0,
                    modified_ms: item.modified_ms,
                    directory: true,
                    ext: String::new(),
                    parent: Some(dir_idx),
                    children: Vec::new(),
                    removed: false,
                });
                nodes[dir_idx].children.push(child_idx);
                sub_dirs.push(child_idx);
            } else {
                let child_path = join_display_path(&dir_path, &item.name);
                let ext = extension_label(&item.name);
                dir_file_bytes = dir_file_bytes.saturating_add(item.bytes);
                dir_file_count += 1;
                record_file(
                    &child_path,
                    &item.name,
                    item.bytes,
                    item.modified_ms,
                    &ext,
                    &mut largest,
                    &mut extensions,
                );
                top_files.push(item);
            }
        }
        nodes[dir_idx].bytes = dir_file_bytes;
        nodes[dir_idx].files = dir_file_count;

        if top_files.len() > MAX_STORED_FILES_PER_DIR {
            top_files.select_nth_unstable_by(MAX_STORED_FILES_PER_DIR, |a, b| b.bytes.cmp(&a.bytes));
            top_files.truncate(MAX_STORED_FILES_PER_DIR);
        }
        for file in top_files {
            let ext = extension_label(&file.name);
            let child_path = join_display_path(&dir_path, &file.name);
            let child_idx = nodes.len();
            nodes.push(TreeNode {
                name: file.name,
                path: child_path,
                bytes: file.bytes,
                files: 1,
                dirs: 0,
                modified_ms: file.modified_ms,
                directory: false,
                ext,
                parent: Some(dir_idx),
                children: Vec::new(),
                removed: false,
            });
            nodes[dir_idx].children.push(child_idx);
        }
        for sub in sub_dirs {
            stack.push((sub, false));
        }
    }

    SubtreeResult {
        nodes,
        inaccessible,
        skipped_links,
        largest,
        extensions,
        partial,
    }
}

fn scan_tree(path: PathBuf, cancel: &AtomicBool) -> Result<CachedTree, String> {
    let start = Instant::now();
    let root_str = path.to_string_lossy().into_owned();
    let root_name = path
        .file_name()
        .unwrap_or(path.as_os_str())
        .to_string_lossy()
        .into_owned();

    let limits = SharedLimits {
        cancelled: cancel,
        start,
        visited: AtomicUsize::new(0),
    };

    let raw_root = read_dir_win32(&path)
        .map_err(|()| format!("Could not scan {}. Access denied or path not found.", path.display()))?;

    let mut nodes = vec![TreeNode {
        name: root_name,
        path: root_str.clone(),
        bytes: 0,
        files: 0,
        dirs: 0,
        modified_ms: 0,
        directory: true,
        ext: String::new(),
        parent: None,
        children: Vec::new(),
        removed: false,
    }];
    let mut inaccessible = 0u64;
    let mut skipped_links = 0u64;
    let mut largest = BinaryHeap::new();
    let mut extensions: HashMap<String, Extension> = HashMap::new();
    let mut partial = limits.check();

    let mut top_dirs: Vec<RawEntry> = Vec::new();
    let mut root_files: Vec<RawEntry> = Vec::new();
    let mut root_file_bytes = 0u64;
    let mut root_file_count = 0u64;

    if partial.is_none() {
        for item in raw_root {
            if let Some(reason) = limits.advance() {
                partial = Some(reason);
                break;
            }
            if item.is_reparse {
                skipped_links += 1;
                continue;
            }
            if item.is_dir {
                top_dirs.push(item);
            } else {
                let child_path = join_display_path(&root_str, &item.name);
                let ext = extension_label(&item.name);
                root_file_bytes = root_file_bytes.saturating_add(item.bytes);
                root_file_count += 1;
                record_file(
                    &child_path,
                    &item.name,
                    item.bytes,
                    item.modified_ms,
                    &ext,
                    &mut largest,
                    &mut extensions,
                );
                root_files.push(item);
            }
        }
    }

    // Scan top-level directories in parallel across up to 8 worker threads!
    let workers = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .clamp(1, 8)
        .min(top_dirs.len().max(1));

    let queue = Mutex::new(top_dirs);
    let results: Mutex<Vec<SubtreeResult>> = Mutex::new(Vec::new());

    if workers <= 1 {
        let items = queue.into_inner().unwrap();
        let mut out = Vec::with_capacity(items.len());
        for dir in items {
            let child_path = join_display_path(&root_str, &dir.name);
            out.push(walk_subtree(dir.name, child_path, dir.modified_ms, &limits));
        }
        *results.lock().unwrap() = out;
    } else {
        std::thread::scope(|s| {
            for _ in 0..workers {
                let queue = &queue;
                let results = &results;
                let limits = &limits;
                let root_ref = &root_str;
                s.spawn(move || {
                    loop {
                        let next = queue.lock().unwrap().pop();
                        let Some(dir) = next else { break };
                        let child_path = join_display_path(root_ref, &dir.name);
                        let sub = walk_subtree(dir.name, child_path, dir.modified_ms, limits);
                        results.lock().unwrap().push(sub);
                    }
                });
            }
        });
    }

    nodes[0].bytes = root_file_bytes;
    nodes[0].files = root_file_count;

    if root_files.len() > MAX_STORED_FILES_PER_DIR {
        root_files.select_nth_unstable_by(MAX_STORED_FILES_PER_DIR, |a, b| b.bytes.cmp(&a.bytes));
        root_files.truncate(MAX_STORED_FILES_PER_DIR);
    }
    for file in root_files {
        let ext = extension_label(&file.name);
        let child_path = join_display_path(&root_str, &file.name);
        let idx = nodes.len();
        nodes.push(TreeNode {
            name: file.name,
            path: child_path,
            bytes: file.bytes,
            files: 1,
            dirs: 0,
            modified_ms: file.modified_ms,
            directory: false,
            ext,
            parent: Some(0),
            children: Vec::new(),
            removed: false,
        });
        nodes[0].children.push(idx);
    }

    for sub in results.into_inner().unwrap() {
        inaccessible += sub.inaccessible;
        skipped_links += sub.skipped_links;
        if partial.is_none() && sub.partial.is_some() {
            partial = sub.partial;
        }
        for Reverse(entry) in sub.largest {
            retain_largest(&mut largest, entry, MAX_FILES);
        }
        for (ext_key, ext_val) in sub.extensions {
            let key = if extensions.len() >= MAX_EXTENSIONS && !extensions.contains_key(&ext_key) {
                "Other extensions".to_owned()
            } else {
                ext_key
            };
            let target = extensions.entry(key.clone()).or_insert(Extension {
                name: key,
                ..Extension::default()
            });
            target.bytes = target.bytes.saturating_add(ext_val.bytes);
            target.files += ext_val.files;
            if ext_val.top_file_size > target.top_file_size || target.top_file.is_empty() {
                target.top_file_size = ext_val.top_file_size;
                target.top_file = ext_val.top_file;
            }
        }
        if sub.nodes.is_empty() {
            continue;
        }
        let base_offset = nodes.len();
        let sub_root_bytes = sub.nodes[0].bytes;
        let sub_root_files = sub.nodes[0].files;
        let sub_root_dirs = sub.nodes[0].dirs;
        for (local_idx, mut node) in sub.nodes.into_iter().enumerate() {
            node.parent = if local_idx == 0 {
                Some(0)
            } else {
                node.parent.map(|p| p + base_offset)
            };
            for c in &mut node.children {
                *c += base_offset;
            }
            nodes.push(node);
        }
        nodes[0].children.push(base_offset);
        nodes[0].bytes = nodes[0].bytes.saturating_add(sub_root_bytes);
        nodes[0].files = nodes[0].files.saturating_add(sub_root_files);
        nodes[0].dirs = nodes[0].dirs.saturating_add(sub_root_dirs + 1);
    }

    let mut path_index = HashMap::with_capacity(nodes.len());
    for (idx, node) in nodes.iter().enumerate() {
        path_index.insert(normalize_key(&node.path), idx);
    }

    let largest_sorted: Vec<Entry> = largest
        .into_sorted_vec()
        .into_iter()
        .map(|item| item.0)
        .collect();
    let mut ext_sorted: Vec<Extension> = extensions.into_values().collect();
    ext_sorted.sort_unstable_by(|a, b| b.bytes.cmp(&a.bytes).then_with(|| a.name.cmp(&b.name)));

    Ok(CachedTree {
        scan_root: root_str,
        nodes,
        path_index,
        largest: largest_sorted,
        extensions: ext_sorted,
        inaccessible,
        skipped_links,
        elapsed_ms: start.elapsed().as_millis(),
        partial,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn scan_totals_and_largest_files_match_the_tree() {
        let base = Path::new(env!("CARGO_MANIFEST_DIR")).join("target");
        let dir = tempfile::tempdir_in(base).unwrap();
        let child = dir.path().join("files");
        fs::create_dir(&child).unwrap();
        fs::write(child.join("long.txt"), [0; 35]).unwrap();
        fs::write(dir.path().join("short.txt"), [0; 5]).unwrap();
        let tree = scan_tree(dir.path().to_path_buf(), &AtomicBool::new(false)).unwrap();
        let result = tree.view_for(0, false);
        assert_eq!((result.files, result.folders, result.bytes), (2, 1, 40));
        assert_eq!(result.entries[0].name, "files");
        assert_eq!(result.entries[0].preview_children.len(), 1);
        assert_eq!(result.largest[0].bytes, 35);
        assert_eq!(result.extensions[0].bytes, 40);
        // Verify instant cached drill-down to child folder
        let child_idx = *tree
            .path_index
            .get(&normalize_key(&child.to_string_lossy()))
            .unwrap();
        let sub = tree.view_for(child_idx, true);
        assert_eq!(sub.bytes, 35);
        assert_eq!(sub.entries[0].name, "long.txt");
        assert!(
            scan_tree(dir.path().to_path_buf(), &AtomicBool::new(true))
                .unwrap()
                .partial
                .is_some()
        );
    }
}
