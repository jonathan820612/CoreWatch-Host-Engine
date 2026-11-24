# File: modules/tabs/DiskMapper.ps1
# CoreWatch Visual Disk Space Mapper (WizTree-style Multithreaded Win32 Scanner)
[CmdletBinding()]
param()

if (-not ("CoreWatch.FastDiskScanner" -as [type])) {
    Add-Type -TypeDefinition @"
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;

namespace CoreWatch {
    public class DiskEntryDto {
        public string name;
        public string path;
        public bool isDir;
        public long size;
        public int files;
        public int dirs;
        public string ext;
        public string modified;
        public int moreChildren;
        public List<DiskEntryDto> children;
    }

    public class DiskFileDto {
        public string name;
        public string path;
        public string dir;
        public long size;
        public string ext;
        public string modified;
    }

    public class DiskExtDto {
        public string ext;
        public long size;
        public int count;
        public string topFile;
        public long topFileSize;
    }

    public class DiskScanResult {
        public string rootPath;
        public long totalBytes;
        public int totalFiles;
        public int totalDirs;
        public int accessDenied;
        public long elapsedMs;
        public DiskEntryDto tree;
        public List<DiskFileDto> largestFiles;
        public List<DiskExtDto> extensions;
    }

    public static class FastDiskScanner {
        private const int FIND_FIRST_EX_LARGE_FETCH = 2;
        private const int FILE_ATTRIBUTE_DIRECTORY = 0x10;
        private const int FILE_ATTRIBUTE_REPARSE_POINT = 0x400;
        private static readonly IntPtr INVALID_HANDLE_VALUE = new IntPtr(-1);

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        private struct WIN32_FIND_DATAW {
            public uint dwFileAttributes;
            public System.Runtime.InteropServices.ComTypes.FILETIME ftCreationTime;
            public System.Runtime.InteropServices.ComTypes.FILETIME ftLastAccessTime;
            public System.Runtime.InteropServices.ComTypes.FILETIME ftLastWriteTime;
            public uint nFileSizeHigh;
            public uint nFileSizeLow;
            public uint dwReserved0;
            public uint dwReserved1;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)]
            public string cFileName;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 14)]
            public string cAlternateFileName;
        }

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        private static extern IntPtr FindFirstFileExW(
            string lpFileName,
            int fInfoLevelId,
            out WIN32_FIND_DATAW lpFindFileData,
            int fSearchOp,
            IntPtr lpSearchFilter,
            int dwAdditionalFlags);

        [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool FindNextFileW(IntPtr hFindFile, out WIN32_FIND_DATAW lpFindFileData);

        [DllImport("kernel32.dll", SetLastError = true)]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool FindClose(IntPtr hFindFile);

        private sealed class InternalNode {
            public string Name;
            public string FullPath;
            public bool IsDir;
            public long Size;
            public int FileCount;
            public int DirCount;
            public string Ext;
            public long ModifiedUtcTicks;
            public List<InternalNode> Children;
        }

        private sealed class ExtAgg {
            public long Size;
            public int Count;
            public string TopFile;
            public long TopFileSize;
        }

        private sealed class ThreadLocalState {
            public readonly Dictionary<string, ExtAgg> Exts = new Dictionary<string, ExtAgg>(StringComparer.OrdinalIgnoreCase);
            public readonly List<DiskFileDto> TopFiles = new List<DiskFileDto>(256);
            public long MinTopFileSize = 0;
            public int AccessDenied = 0;

            public void RecordFile(string name, string fullPath, string dir, long size, string ext, long modTicks) {
                ExtAgg agg;
                if (!Exts.TryGetValue(ext, out agg)) {
                    agg = new ExtAgg();
                    Exts[ext] = agg;
                }
                agg.Size += size;
                agg.Count++;
                if (size > agg.TopFileSize) {
                    agg.TopFileSize = size;
                    agg.TopFile = fullPath;
                }

                if (size > 0 && (TopFiles.Count < 160 || size > MinTopFileSize)) {
                    string modStr = "";
                    try {
                        if (modTicks > 0) modStr = DateTime.FromFileTimeUtc(modTicks).ToLocalTime().ToString("yyyy-MM-dd HH:mm");
                    } catch { }
                    TopFiles.Add(new DiskFileDto {
                        name = name,
                        path = fullPath,
                        dir = dir,
                        size = size,
                        ext = ext,
                        modified = modStr
                    });
                    if (TopFiles.Count >= 260) {
                        TopFiles.Sort((a, b) => b.size.CompareTo(a.size));
                        TopFiles.RemoveRange(160, TopFiles.Count - 160);
                        MinTopFileSize = TopFiles[TopFiles.Count - 1].size;
                    }
                }
            }
        }

        private static string ToExtendedPath(string path) {
            if (path.StartsWith(@"\\?\")) return path;
            if (path.StartsWith(@"\\")) return @"\\?\UNC\" + path.Substring(2);
            return @"\\?\" + path;
        }

        private static string GetCleanExtension(string fileName) {
            int dot = fileName.LastIndexOf('.');
            if (dot <= 0 || dot == fileName.Length - 1) return "(no ext)";
            string ext = fileName.Substring(dot).ToLowerInvariant();
            return ext.Length <= 16 ? ext : "(other)";
        }

        private static long FileTimeToTicks(System.Runtime.InteropServices.ComTypes.FILETIME ft) {
            return ((long)ft.dwHighDateTime << 32) | (uint)ft.dwLowDateTime;
        }

        private static InternalNode ScanDirectoryRecursive(string dirPath, string dirName, int depth, ThreadLocalState state) {
            var node = new InternalNode {
                Name = dirName,
                FullPath = dirPath,
                IsDir = true,
                Children = depth < 4 ? new List<InternalNode>(32) : null
            };

            string searchPattern = ToExtendedPath(dirPath.EndsWith(@"\") ? (dirPath + "*") : (dirPath + @"\*"));
            WIN32_FIND_DATAW fd;
            IntPtr hFind = FindFirstFileExW(searchPattern, 1, out fd, 0, IntPtr.Zero, FIND_FIRST_EX_LARGE_FETCH);
            if (hFind == INVALID_HANDLE_VALUE) {
                state.AccessDenied++;
                return node;
            }

            try {
                do {
                    string name = fd.cFileName;
                    if (name == "." || name == "..") continue;

                    uint attrs = fd.dwFileAttributes;
                    bool isDir = (attrs & FILE_ATTRIBUTE_DIRECTORY) != 0;
                    bool isReparse = (attrs & FILE_ATTRIBUTE_REPARSE_POINT) != 0;

                    string childPath = dirPath.EndsWith(@"\") ? (dirPath + name) : (dirPath + @"\" + name);

                    if (isDir) {
                        // Never traverse NTFS junctions/symlinks so we don't double-count or loop
                        if (isReparse) continue;
                        var sub = ScanDirectoryRecursive(childPath, name, depth + 1, state);
                        node.Size += sub.Size;
                        node.FileCount += sub.FileCount;
                        node.DirCount += (1 + sub.DirCount);
                        if (node.Children != null && (sub.Size > 0 || depth < 2)) {
                            node.Children.Add(sub);
                        }
                    } else {
                        long fSize = ((long)fd.nFileSizeHigh << 32) | (uint)fd.nFileSizeLow;
                        string ext = GetCleanExtension(name);
                        long modTicks = FileTimeToTicks(fd.ftLastWriteTime);

                        node.Size += fSize;
                        node.FileCount++;
                        state.RecordFile(name, childPath, dirPath, fSize, ext, modTicks);

                        if (node.Children != null && fSize > 0) {
                            node.Children.Add(new InternalNode {
                                Name = name,
                                FullPath = childPath,
                                IsDir = false,
                                Size = fSize,
                                FileCount = 1,
                                Ext = ext,
                                ModifiedUtcTicks = modTicks
                            });
                        }
                    }
                } while (FindNextFileW(hFind, out fd));
            } finally {
                FindClose(hFind);
            }

            // Trim kept children on deep levels to keep memory tiny while keeping all largest items intact
            if (node.Children != null && node.Children.Count > 64) {
                node.Children.Sort((a, b) => b.Size.CompareTo(a.Size));
                node.Children.RemoveRange(64, node.Children.Count - 64);
            }

            return node;
        }

        private static DiskEntryDto ToDto(InternalNode node, int depth, int maxDepth, int maxChildren) {
            string modStr = "";
            if (!node.IsDir && node.ModifiedUtcTicks > 0) {
                try { modStr = DateTime.FromFileTimeUtc(node.ModifiedUtcTicks).ToLocalTime().ToString("yyyy-MM-dd HH:mm"); } catch { }
            }

            var dto = new DiskEntryDto {
                name = node.Name,
                path = node.FullPath,
                isDir = node.IsDir,
                size = node.Size,
                files = node.FileCount,
                dirs = node.DirCount,
                ext = node.Ext ?? "",
                modified = modStr,
                moreChildren = 0,
                children = null
            };

            if (node.IsDir && node.Children != null && node.Children.Count > 0 && depth < maxDepth) {
                node.Children.Sort((a, b) => b.Size.CompareTo(a.Size));
                int take = Math.Min(maxChildren, node.Children.Count);
                dto.moreChildren = Math.Max(0, node.Children.Count - take);
                dto.children = new List<DiskEntryDto>(take);
                int childCap = depth == 0 ? 48 : (depth == 1 ? 32 : 20);
                for (int i = 0; i < take; i++) {
                    dto.children.Add(ToDto(node.Children[i], depth + 1, maxDepth, childCap));
                }
            }
            return dto;
        }

        public static DiskScanResult ScanPath(string rawPath) {
            var sw = Stopwatch.StartNew();
            string cleanPath = Path.GetFullPath(rawPath);
            if (cleanPath.Length == 2 && cleanPath[1] == ':') cleanPath += @"\";
            string rootName = cleanPath;

            var rootNode = new InternalNode {
                Name = rootName,
                FullPath = cleanPath,
                IsDir = true,
                Children = new List<InternalNode>(64)
            };

            var topSubDirs = new List<Tuple<string, string>>();
            var rootState = new ThreadLocalState();

            string searchPattern = ToExtendedPath(cleanPath.EndsWith(@"\") ? (cleanPath + "*") : (cleanPath + @"\*"));
            WIN32_FIND_DATAW fd;
            IntPtr hFind = FindFirstFileExW(searchPattern, 1, out fd, 0, IntPtr.Zero, FIND_FIRST_EX_LARGE_FETCH);
            if (hFind != INVALID_HANDLE_VALUE) {
                try {
                    do {
                        string name = fd.cFileName;
                        if (name == "." || name == "..") continue;
                        uint attrs = fd.dwFileAttributes;
                        bool isDir = (attrs & FILE_ATTRIBUTE_DIRECTORY) != 0;
                        bool isReparse = (attrs & FILE_ATTRIBUTE_REPARSE_POINT) != 0;
                        string childPath = cleanPath.EndsWith(@"\") ? (cleanPath + name) : (cleanPath + @"\" + name);

                        if (isDir) {
                            if (isReparse) continue;
                            topSubDirs.Add(Tuple.Create(childPath, name));
                        } else {
                            long fSize = ((long)fd.nFileSizeHigh << 32) | (uint)fd.nFileSizeLow;
                            string ext = GetCleanExtension(name);
                            long modTicks = FileTimeToTicks(fd.ftLastWriteTime);
                            rootNode.Size += fSize;
                            rootNode.FileCount++;
                            rootState.RecordFile(name, childPath, cleanPath, fSize, ext, modTicks);
                            if (fSize > 0) {
                                rootNode.Children.Add(new InternalNode {
                                    Name = name,
                                    FullPath = childPath,
                                    IsDir = false,
                                    Size = fSize,
                                    FileCount = 1,
                                    Ext = ext,
                                    ModifiedUtcTicks = modTicks
                                });
                            }
                        }
                    } while (FindNextFileW(hFind, out fd));
                } finally {
                    FindClose(hFind);
                }
            }

            var subResults = new ConcurrentBag<InternalNode>();
            var workerStates = new ConcurrentBag<ThreadLocalState>();
            workerStates.Add(rootState);

            var parallelOpts = new ParallelOptions {
                MaxDegreeOfParallelism = Math.Max(2, Math.Min(Environment.ProcessorCount, 8))
            };

            Parallel.ForEach(
                topSubDirs,
                parallelOpts,
                () => {
                    var ls = new ThreadLocalState();
                    workerStates.Add(ls);
                    return ls;
                },
                (item, loopState, localState) => {
                    var sub = ScanDirectoryRecursive(item.Item1, item.Item2, 1, localState);
                    subResults.Add(sub);
                    return localState;
                },
                _ => { }
            );

            foreach (var sub in subResults) {
                rootNode.Size += sub.Size;
                rootNode.FileCount += sub.FileCount;
                rootNode.DirCount += (1 + sub.DirCount);
                rootNode.Children.Add(sub);
            }

            // Merge per-thread extension stats and top files
            var mergedExts = new Dictionary<string, ExtAgg>(StringComparer.OrdinalIgnoreCase);
            var mergedFiles = new List<DiskFileDto>(512);
            int totalDenied = 0;

            foreach (var st in workerStates) {
                totalDenied += st.AccessDenied;
                mergedFiles.AddRange(st.TopFiles);
                foreach (var kv in st.Exts) {
                    ExtAgg dst;
                    if (!mergedExts.TryGetValue(kv.Key, out dst)) {
                        dst = new ExtAgg();
                        mergedExts[kv.Key] = dst;
                    }
                    dst.Size += kv.Value.Size;
                    dst.Count += kv.Value.Count;
                    if (kv.Value.TopFileSize > dst.TopFileSize) {
                        dst.TopFileSize = kv.Value.TopFileSize;
                        dst.TopFile = kv.Value.TopFile;
                    }
                }
            }

            mergedFiles.Sort((a, b) => b.size.CompareTo(a.size));
            if (mergedFiles.Count > 150) mergedFiles.RemoveRange(150, mergedFiles.Count - 150);

            var extList = mergedExts
                .Select(kv => new DiskExtDto {
                    ext = kv.Key,
                    size = kv.Value.Size,
                    count = kv.Value.Count,
                    topFile = kv.Value.TopFile ?? "",
                    topFileSize = kv.Value.TopFileSize
                })
                .OrderByDescending(e => e.size)
                .Take(45)
                .ToList();

            sw.Stop();
            return new DiskScanResult {
                rootPath = cleanPath,
                totalBytes = rootNode.Size,
                totalFiles = rootNode.FileCount,
                totalDirs = rootNode.DirCount,
                accessDenied = totalDenied,
                elapsedMs = sw.ElapsedMilliseconds,
                tree = ToDto(rootNode, 0, 4, 60),
                largestFiles = mergedFiles,
                extensions = extList
            };
        }
    }
}
"@ -ErrorAction Stop
}

function Get-DiskMapDrives {
    $drives = New-Object System.Collections.Generic.List[PSCustomObject]
    foreach ($d in [System.IO.DriveInfo]::GetDrives()) {
        try {
            if (-not $d.IsReady) { continue }
            $total = [double]$d.TotalSize
            if ($total -le 0) { continue }
            $free = [double]$d.AvailableFreeSpace
            $used = [math]::Max(0.0, $total - $free)
            $pct  = [int][math]::Round(($used / $total) * 100.0)
            $lbl  = try { if ($d.VolumeLabel) { [string]$d.VolumeLabel } else { "Local Disk" } } catch { "Local Disk" }
            $drives.Add([PSCustomObject]@{
                path    = $d.Name
                letter  = $d.Name.TrimEnd('\')
                label   = $lbl
                format  = [string]$d.DriveFormat
                type    = [string]$d.DriveType
                totalGB = [math]::Round($total / 1GB, 2)
                usedGB  = [math]::Round($used / 1GB, 2)
                freeGB  = [math]::Round($free / 1GB, 2)
                usedPct = $pct
            })
        } catch {}
    }
    return @{
        type   = "DISKMAP_DRIVES"
        drives = @($drives)
        ok     = $true
    }
}

function Test-IsProtectedSystemPath {
    param([string]$TargetPath)
    $norm = [System.IO.Path]::GetFullPath($TargetPath).TrimEnd('\')
    if ($norm -match '^[A-Za-z]:$') { return $true }
    $protectedRoots = @(
        $env:SystemRoot,
        "$env:SystemRoot\System32",
        "$env:SystemRoot\SysWOW64",
        $env:ProgramFiles,
        ${env:ProgramFiles(x86)},
        "$env:SystemDrive\Users",
        $env:USERPROFILE
    ) | Where-Object { $_ } | ForEach-Object { $_.TrimEnd('\') }

    foreach ($p in $protectedRoots) {
        if ($norm.Equals($p, [System.StringComparison]::OrdinalIgnoreCase)) { return $true }
    }
    if ($norm.StartsWith("$env:SystemRoot\System32\", [System.StringComparison]::OrdinalIgnoreCase)) { return $true }
    return $false
}

function Invoke-DiskMapperAction {
    param(
        [Parameter(Mandatory = $true)]
        $Payload
    )

    if ($Payload -is [string]) { $Payload = $Payload | ConvertFrom-Json }
    if ($null -eq $Payload -or -not $Payload.command) { return $null }

    $cmd = [string]$Payload.command
    try {
        switch ($cmd) {
            'DISKMAP_LIST_DRIVES' {
                return Get-DiskMapDrives
            }
            'DISKMAP_SCAN' {
                $targetPath = ([string]$Payload.path).Trim()
                if (-not $targetPath) { $targetPath = "$env:SystemDrive\" }
                if (-not (Test-Path -LiteralPath $targetPath -PathType Container)) {
                    throw "Folder or drive not found: $targetPath"
                }

                $scan = [CoreWatch.FastDiskScanner]::ScanPath($targetPath)
                $drivesInfo = (Get-DiskMapDrives).drives
                return @{
                    type         = "DISKMAP_SCAN_RESULT"
                    ok           = $true
                    drives       = $drivesInfo
                    rootPath     = $scan.rootPath
                    totalBytes   = $scan.totalBytes
                    totalFiles   = $scan.totalFiles
                    totalDirs    = $scan.totalDirs
                    accessDenied = $scan.accessDenied
                    elapsedMs    = $scan.elapsedMs
                    tree         = $scan.tree
                    largestFiles = @($scan.largestFiles)
                    extensions   = @($scan.extensions)
                }
            }
            'DISKMAP_OPEN_EXPLORER' {
                $p = ([string]$Payload.path).Trim()
                if (-not $p -or -not (Test-Path -LiteralPath $p)) {
                    throw "Path no longer exists: $p"
                }
                Start-Process "explorer.exe" -ArgumentList "/select,`"$p`""
                return @{
                    type    = "DISKMAP_NOTICE"
                    ok      = $true
                    message = "Revealed in Explorer: $p"
                }
            }
            'DISKMAP_RECYCLE' {
                $p = ([string]$Payload.path).Trim()
                if (-not $p -or -not (Test-Path -LiteralPath $p)) {
                    throw "Target no longer exists: $p"
                }
                if (Test-IsProtectedSystemPath -TargetPath $p) {
                    throw "Blocked for safety: cannot recycle protected Windows system path ($p)."
                }
                Add-Type -AssemblyName Microsoft.VisualBasic -ErrorAction Stop
                if (Test-Path -LiteralPath $p -PathType Container) {
                    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteDirectory(
                        $p,
                        [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,
                        [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin
                    )
                } else {
                    [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(
                        $p,
                        [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,
                        [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin
                    )
                }
                return @{
                    type        = "DISKMAP_NOTICE"
                    ok          = $true
                    recycled    = $true
                    deletedPath = $p
                    message     = "Moved to Windows Recycle Bin: $p (click Rescan to refresh totals)."
                }
            }
            default {
                throw "Unsupported Disk Mapper command: $cmd"
            }
        }
    } catch {
        return @{
            type    = "DISKMAP_NOTICE"
            ok      = $false
            error   = $_.Exception.Message
            message = $_.Exception.Message
        }
    }
}
