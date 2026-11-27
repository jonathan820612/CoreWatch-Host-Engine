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

const NO_PARENT: u32 = u32::MAX;

struct TreeNode {
    name: Box<str>,
    bytes: u64,
    files: u64,
    dirs: u64,
    modified_ms: i64,
    parent: u32,
    children: Vec<u32>,
    directory: bool,
    removed: bool,
}

struct CachedTree {
    scan_root: String,
    nodes: Vec<TreeNode>,
    /// Directory-only lowercase path index (~85-90% smaller than indexing every file).
    path_index: HashMap<Box<str>, u32>,
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

    /// Evicts the cached scan arena to release memory immediately when leaving Disk Map or minimizing.
    pub fn clear(&self) {
        if let Ok(mut cache) = self.cache.lock()
            && cache.take().is_some()
        {
            drop(cache);
            crate::native::trim_working_set();
        }
    }

    pub fn node_view(&self, path: &Path) -> Result<Option<Scan>, String> {
        let key = normalize_key(&path.to_string_lossy());
        let guard = self.cache.lock().map_err(|_| "Disk Map cache unavailable.")?;
        let Some(tree) = guard.as_ref() else {
            return Ok(None);
        };
        let Some(&idx) = tree.path_index.get(key.as_str()) else {
            return Ok(None);
        };
        let idx = idx as usize;
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
        if let Some(idx) = tree.find_path_index(path, &key)
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
            while cur != NO_PARENT {
                let node = &mut tree.nodes[cur as usize];
                node.bytes = node.bytes.saturating_sub(delta_bytes);
                node.files = node.files.saturating_sub(delta_files);
                node.dirs = node.dirs.saturating_sub(delta_dirs);
                cur = node.parent;
            }
            let prefix = key.clone();
            let prefix_slash = format!("{prefix}\\");
            tree.largest.retain(|e| {
                let k = normalize_key(&e.path);
                k != prefix && !k.starts_with(&prefix_slash)
            });
        }
        let target_key = current_view
            .map(|p| normalize_key(&p.to_string_lossy()))
            .unwrap_or_else(|| normalize_key(&tree.scan_root));
        if let Some(&view_idx) = tree.path_index.get(target_key.as_str())
            && !tree.nodes[view_idx as usize].removed
        {
            return Ok(Some(tree.view_for(view_idx as usize, true)));
        }
        if !tree.nodes.is_empty() && !tree.nodes[0].removed {
            return Ok(Some(tree.view_for(0, true)));
        }
        Ok(None)
    }
}

fn mark_removed(nodes: &mut [TreeNode], idx: usize) {
    let mut stack = vec![idx as u32];
    while let Some(n) = stack.pop() {
        let ni = n as usize;
        if nodes[ni].removed {
            continue;
        }
        nodes[ni].removed = true;
        stack.extend_from_slice(&nodes[ni].children);
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
    fn node_path(&self, idx: usize) -> String {
        if idx == 0 {
            return self.scan_root.clone();
        }
        let mut parts: Vec<&str> = Vec::new();
        let mut cur = idx;
        while cur != 0 {
            let node = &self.nodes[cur];
            parts.push(&node.name);
            if node.parent == NO_PARENT {
                break;
            }
            cur = node.parent as usize;
        }
        let mut out = self.scan_root.clone();
        for part in parts.into_iter().rev() {
            if !out.ends_with('\\') && !out.ends_with('/') {
                out.push('\\');
            }
            out.push_str(part);
        }
        out
    }

    fn find_path_index(&self, path: &Path, normalized_key: &str) -> Option<usize> {
        if let Some(&idx) = self.path_index.get(normalized_key) {
            return Some(idx as usize);
        }
        let parent_path = path.parent()?;
        let file_name = path.file_name()?.to_string_lossy();
        let parent_key = normalize_key(&parent_path.to_string_lossy());
        let &parent_idx = self.path_index.get(parent_key.as_str())?;
        self.nodes[parent_idx as usize]
            .children
            .iter()
            .copied()
            .find(|&c| {
                let cn = &self.nodes[c as usize];
                !cn.directory && cn.name.eq_ignore_ascii_case(&file_name)
            })
            .map(|c| c as usize)
    }

    fn view_for(&self, idx: usize, cached: bool) -> Scan {
        let node = &self.nodes[idx];
        let node_path = self.node_path(idx);
        let mut child_indices: Vec<usize> = node
            .children
            .iter()
            .map(|&c| c as usize)
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
                let child_path = join_display_path(&node_path, &child.name);
                let preview_children = if child.directory {
                    let mut subs: Vec<usize> = child
                        .children
                        .iter()
                        .map(|&s| s as usize)
                        .filter(|&s| !self.nodes[s].removed && self.nodes[s].bytes > 0)
                        .collect();
                    subs.sort_unstable_by(|&a, &b| self.nodes[b].bytes.cmp(&self.nodes[a].bytes));
                    subs.into_iter()
                        .take(MAX_PREVIEW_CHILDREN)
                        .map(|s| {
                            let sub = &self.nodes[s];
                            ChildTile {
                                name: sub.name.to_string(),
                                path: join_display_path(&child_path, &sub.name),
                                bytes: sub.bytes,
                                directory: sub.directory,
                                ext: if sub.directory {
                                    String::new()
                                } else {
                                    extension_label(&sub.name)
                                },
                            }
                        })
                        .collect()
                } else {
                    Vec::new()
                };
                Entry {
                    bytes: child.bytes,
                    name: child.name.to_string(),
                    path: child_path,
                    directory: child.directory,
                    files: child.files,
                    dirs: child.dirs,
                    modified_ms: child.modified_ms,
                    ext: if child.directory {
                        String::new()
                    } else {
                        extension_label(&child.name)
                    },
                    preview_children,
                }
            })
            .collect();

        let scope_prefix = normalize_key(&node_path);
        let scope_prefix_slash = format!("{scope_prefix}\\");
        let largest = if idx == 0 {
            self.largest.clone()
        } else {
            let mut filtered: Vec<Entry> = self
                .largest
                .iter()
                .filter(|e| normalize_key(&e.path).starts_with(&scope_prefix_slash))
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
                        let ci = c as usize;
                        let cn = &self.nodes[ci];
                        if cn.removed {
                            continue;
                        }
                        if cn.directory {
                            stack.push(ci);
                        } else {
                            let full = self.node_path(ci);
                            let full_key = normalize_key(&full);
                            if seen.insert(full_key) {
                                retain_largest(
                                    &mut heap,
                                    Entry {
                                        bytes: cn.bytes,
                                        name: cn.name.to_string(),
                                        path: full,
                                        directory: false,
                                        files: 1,
                                        dirs: 0,
                                        modified_ms: cn.modified_ms,
                                        ext: extension_label(&cn.name),
                                        preview_children: Vec::new(),
                                    },
                                    MAX_FILES,
                                );
                            }
                        }
                    }
                }
                filtered.extend(heap.into_iter().map(|r| r.0));
                filtered.sort_unstable_by_key(|a| std::cmp::Reverse(a.bytes));
                filtered.truncate(MAX_FILES);
            }
            filtered
        };

        let parent = Path::new(&node_path)
            .parent()
            .map(|p| p.to_string_lossy().into_owned());

        Scan {
            root: node_path,
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
        name: root_name.into_boxed_str(),
        bytes: 0,
        files: 0,
        dirs: 0,
        modified_ms: root_modified,
        parent: NO_PARENT,
        children: Vec::new(),
        directory: true,
        removed: false,
    }];
    let mut inaccessible = 0u64;
    let mut skipped_links = 0u64;
    let mut largest = BinaryHeap::new();
    let mut extensions = HashMap::new();
    let mut partial = None;

    // Iterative DFS with transient paths on the stack (zero full paths stored on TreeNodes).
    let mut stack: Vec<(usize, Option<String>)> = vec![(0, Some(root_path))];
    while let Some((dir_idx, maybe_path)) = stack.pop() {
        let Some(dir_path) = maybe_path else {
            let mut sum_bytes = 0u64;
            let mut sum_files = 0u64;
            let mut sum_dirs = 0u64;
            let children = nodes[dir_idx].children.clone();
            for c in children {
                let cn = &nodes[c as usize];
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
        };
        if let Some(reason) = limits.check() {
            partial = Some(reason);
            continue;
        }
        let Ok(raw_items) = read_dir_win32(Path::new(&dir_path)) else {
            inaccessible += 1;
            continue;
        };
        stack.push((dir_idx, None));
        let mut dir_file_bytes = 0u64;
        let mut dir_file_count = 0u64;
        let mut top_files: Vec<RawEntry> = Vec::new();
        let mut sub_dirs: Vec<(usize, String)> = Vec::new();

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
                    name: item.name.into_boxed_str(),
                    bytes: 0,
                    files: 0,
                    dirs: 0,
                    modified_ms: item.modified_ms,
                    parent: dir_idx as u32,
                    children: Vec::new(),
                    directory: true,
                    removed: false,
                });
                nodes[dir_idx].children.push(child_idx as u32);
                sub_dirs.push((child_idx, child_path));
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
            let child_idx = nodes.len();
            nodes.push(TreeNode {
                name: file.name.into_boxed_str(),
                bytes: file.bytes,
                files: 1,
                dirs: 0,
                modified_ms: file.modified_ms,
                parent: dir_idx as u32,
                children: Vec::new(),
                directory: false,
                removed: false,
            });
            nodes[dir_idx].children.push(child_idx as u32);
        }
        for (sub, sub_path) in sub_dirs {
            stack.push((sub, Some(sub_path)));
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
        name: root_name.into_boxed_str(),
        bytes: 0,
        files: 0,
        dirs: 0,
        modified_ms: 0,
        parent: NO_PARENT,
        children: Vec::new(),
        directory: true,
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
        let items = queue.into_inner().unwrap_or_else(|e| e.into_inner());
        let mut out = Vec::with_capacity(items.len());
        for dir in items {
            let child_path = join_display_path(&root_str, &dir.name);
            out.push(walk_subtree(dir.name, child_path, dir.modified_ms, &limits));
        }
        *results.lock().unwrap_or_else(|e| e.into_inner()) = out;
    } else {
        std::thread::scope(|s| {
            for _ in 0..workers {
                let queue = &queue;
                let results = &results;
                let limits = &limits;
                let root_ref = &root_str;
                s.spawn(move || {
                    loop {
                        let next = queue.lock().unwrap_or_else(|e| e.into_inner()).pop();
                        let Some(dir) = next else { break };
                        let child_path = join_display_path(root_ref, &dir.name);
                        let sub = walk_subtree(dir.name, child_path, dir.modified_ms, limits);
                        results.lock().unwrap_or_else(|e| e.into_inner()).push(sub);
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
        let idx = nodes.len();
        nodes.push(TreeNode {
            name: file.name.into_boxed_str(),
            bytes: file.bytes,
            files: 1,
            dirs: 0,
            modified_ms: file.modified_ms,
            parent: 0,
            children: Vec::new(),
            directory: false,
            removed: false,
        });
        nodes[0].children.push(idx as u32);
    }

    for sub in results.into_inner().unwrap_or_else(|e| e.into_inner()) {
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
        let base_offset = nodes.len() as u32;
        let sub_root_bytes = sub.nodes[0].bytes;
        let sub_root_files = sub.nodes[0].files;
        let sub_root_dirs = sub.nodes[0].dirs;
        for (local_idx, mut node) in sub.nodes.into_iter().enumerate() {
            node.parent = if local_idx == 0 {
                0
            } else if node.parent != NO_PARENT {
                node.parent + base_offset
            } else {
                NO_PARENT
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

    nodes.shrink_to_fit();
    for node in &mut nodes {
        node.children.shrink_to_fit();
    }

    let largest_sorted: Vec<Entry> = largest
        .into_sorted_vec()
        .into_iter()
        .map(|item| item.0)
        .collect();
    let mut ext_sorted: Vec<Extension> = extensions.into_values().collect();
    ext_sorted.sort_unstable_by(|a, b| b.bytes.cmp(&a.bytes).then_with(|| a.name.cmp(&b.name)));

    let mut tree = CachedTree {
        scan_root: root_str,
        nodes,
        path_index: HashMap::new(),
        largest: largest_sorted,
        extensions: ext_sorted,
        inaccessible,
        skipped_links,
        elapsed_ms: start.elapsed().as_millis(),
        partial,
    };

    // Index directories only (cuts path_index memory ~85-90%).
    let dir_count = tree.nodes.iter().filter(|n| n.directory).count();
    let mut path_index = HashMap::with_capacity(dir_count);
    for (idx, node) in tree.nodes.iter().enumerate() {
        if node.directory {
            let full = tree.node_path(idx);
            path_index.insert(normalize_key(&full).into_boxed_str(), idx as u32);
        }
    }
    tree.path_index = path_index;

    Ok(tree)
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
        let long_file = child.join("long.txt");
        fs::write(&long_file, [0; 35]).unwrap();
        fs::write(dir.path().join("short.txt"), [0; 5]).unwrap();
        let tree = scan_tree(dir.path().to_path_buf(), &AtomicBool::new(false)).unwrap();
        let result = tree.view_for(0, false);
        assert_eq!((result.files, result.folders, result.bytes), (2, 1, 40));
        assert_eq!(result.entries[0].name, "files");
        assert_eq!(result.entries[0].preview_children.len(), 1);
        assert_eq!(result.largest[0].bytes, 35);
        assert_eq!(result.extensions[0].bytes, 40);
        // Verify instant cached drill-down to child folder and directory-only path_index lookup
        let child_key = normalize_key(&child.to_string_lossy());
        let child_idx = *tree.path_index.get(child_key.as_str()).unwrap() as usize;
        let sub = tree.view_for(child_idx, true);
        assert_eq!(sub.bytes, 35);
        assert_eq!(sub.entries[0].name, "long.txt");
        // Verify file lookup still works via parent directory in directory-only index
        let file_key = normalize_key(&long_file.to_string_lossy());
        assert!(!tree.path_index.contains_key(file_key.as_str()));
        let file_idx = tree.find_path_index(&long_file, &file_key).unwrap();
        assert_eq!(tree.nodes[file_idx].bytes, 35);
        assert!(
            scan_tree(dir.path().to_path_buf(), &AtomicBool::new(true))
                .unwrap()
                .partial
                .is_some()
        );
    }
}
