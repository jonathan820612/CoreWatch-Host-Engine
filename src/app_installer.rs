use crate::update_center::strip_ansi_and_progress;
use serde::{Deserialize, Serialize};
use std::{os::windows::process::CommandExt, process::Command};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogApp {
    pub id: &'static str,
    pub name: &'static str,
    pub category: &'static str,
    pub description: &'static str,
    pub essential: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub name: String,
    pub id: String,
    pub version: String,
    pub source: String,
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum InstallerAction {
    Search { query: String },
    InstallBatch { ids: Vec<String> },
}

pub fn catalog() -> Vec<CatalogApp> {
    let a = |id, name, category, description, essential| CatalogApp {
        id,
        name,
        category,
        description,
        essential,
    };
    vec![
        // Developer
        a("Microsoft.VisualStudioCode", "Visual Studio Code", "Developer", "Lightweight extensible code editor", true),
        a("Git.Git", "Git for Windows", "Developer", "Distributed version control CLI & Git Bash", true),
        a("Microsoft.WindowsTerminal", "Windows Terminal", "Developer", "Modern tabbed terminal for PowerShell, CMD & WSL", true),
        a("Microsoft.PowerShell", "PowerShell 7", "Developer", "Cross-platform modern PowerShell runtime", true),
        a("GitHub.cli", "GitHub CLI (gh)", "Developer", "Official GitHub command-line workflow tool", false),
        a("Docker.DockerDesktop", "Docker Desktop", "Developer", "Containers and Kubernetes for Windows", false),
        a("Postman.Postman", "Postman", "Developer", "API testing and HTTP client workbench", false),
        a("DBeaver.DBeaver.Community", "DBeaver Community", "Developer", "Universal SQL database client", false),
        a("Neovim.Neovim", "Neovim", "Developer", "Hyperextensible Vim-based terminal editor", false),
        a("BurntSushi.ripgrep.MSVC", "ripgrep (rg)", "Developer", "Blazing-fast recursive regex search CLI", false),
        a("ajeetdsouza.zoxide", "zoxide", "Developer", "Smarter cd command for terminals", false),
        // Runtimes
        a("Rustlang.Rustup", "Rustup (Rust Toolchain)", "Runtimes", "Official Rust compiler and Cargo installer", false),
        a("OpenJS.NodeJS.LTS", "Node.js LTS", "Runtimes", "JavaScript runtime & npm package manager", false),
        a("Python.Python.3.13", "Python 3.13", "Runtimes", "Latest Python interpreter & pip", false),
        a("Python.Python.3.12", "Python 3.12", "Runtimes", "Python 3.12 LTS interpreter & pip", false),
        a("EclipseAdoptium.Temurin.21.JDK", "Temurin JDK 21", "Runtimes", "OpenJDK 21 LTS distribution", false),
        a("GoLang.Go", "Go (Golang)", "Runtimes", "Go programming language toolchain", false),
        a("Microsoft.DotNet.SDK.9", ".NET 9 SDK", "Runtimes", "Microsoft .NET 9 runtime and SDK", false),
        a("Microsoft.VCRedist.2015+.x64", "Visual C++ 2015–2022 (x64)", "Runtimes", "Essential C++ runtime libraries for apps & games", true),
        a("Microsoft.VCRedist.2015+.x86", "Visual C++ 2015–2022 (x86)", "Runtimes", "32-bit Visual C++ runtime libraries", false),
        // Utilities & Hardware
        a("7zip.7zip", "7-Zip", "Utilities", "High-compression open-source file archiver", true),
        a("voidtools.Everything", "Everything Search", "Utilities", "Instant NTFS filename search engine", true),
        a("AntibodySoftware.WizTree", "WizTree", "Utilities", "High-speed MFT disk space analyzer", false),
        a("Microsoft.PowerToys", "Microsoft PowerToys", "Utilities", "FancyZones, Color Picker, Run & Windows power utilities", true),
        a("Notepad++.Notepad++", "Notepad++", "Utilities", "Fast native source & text editor", false),
        a("ShareX.ShareX", "ShareX", "Utilities", "Screen capture, recording & annotation suite", false),
        a("Rufus.Rufus", "Rufus", "Utilities", "Create bootable USB flash drives (Windows/Linux ISOs)", false),
        a("REALiX.HWiNFO", "HWiNFO64", "Utilities", "Deep hardware sensor & telemetry inspector", false),
        a("CPUID.CPU-Z", "CPU-Z", "Utilities", "Detailed CPU, cache, motherboard & memory specs", false),
        a("TechPowerUp.GPU-Z", "GPU-Z", "Utilities", "Graphics card BIOS, bus & sensor diagnostics", false),
        a("CrystalDewWorld.CrystalDiskInfo", "CrystalDiskInfo", "Utilities", "SMART disk health and NVMe wear inspector", false),
        a("OpenRGB.OpenRGB", "OpenRGB", "Utilities", "Optional external RGB SDK bridge (not required by RustCoreWatch)", false),
        a("namazso.PawnIO", "PawnIO Driver", "Utilities", "Signed low-level sensor & SMBus hardware driver", false),
        a("Microsoft.Sysinternals.ProcessExplorer", "Sysinternals Process Explorer", "Utilities", "Advanced handle, DLL & process inspector", false),
        a("Bitwarden.Bitwarden", "Bitwarden", "Utilities", "Open-source cross-platform password manager", false),
        a("KeePassXCTeam.KeePassXC", "KeePassXC", "Utilities", "Offline encrypted password vault", false),
        // Networking
        a("Tailscale.Tailscale", "Tailscale", "Networking", "Zero-config WireGuard mesh VPN", false),
        a("WireGuard.WireGuard", "WireGuard", "Networking", "Fast modern kernel-space VPN tunnel", false),
        a("WiresharkFoundation.Wireshark", "Wireshark", "Networking", "Industry-standard network packet analyzer", false),
        a("WinSCP.WinSCP", "WinSCP", "Networking", "SFTP, SCP, S3 and FTP file manager", false),
        a("PuTTY.PuTTY", "PuTTY", "Networking", "Classic SSH, Telnet & serial console client", false),
        // Browsers
        a("Mozilla.Firefox", "Mozilla Firefox", "Browsers", "Privacy-focused open-source web browser", false),
        a("Brave.Brave", "Brave Browser", "Browsers", "Chromium browser with built-in ad & tracker blocking", false),
        a("Google.Chrome", "Google Chrome", "Browsers", "Fast Chromium web browser", false),
        a("Zen-Team.Zen-Browser", "Zen Browser", "Browsers", "Privacy-focused vertical-tabs Gecko browser", false),
        // Media & Creative
        a("VideoLAN.VLC", "VLC Media Player", "Media", "Universal audio & video player", true),
        a("OBSProject.OBSStudio", "OBS Studio", "Media", "Open-source streaming & screen recording", false),
        a("BlenderFoundation.Blender", "Blender", "Media", "Open-source 3D creation & rendering suite", false),
        a("GIMP.GIMP", "GIMP", "Media", "GNU Image Manipulation Program", false),
        a("Audacity.Audacity", "Audacity", "Media", "Multi-track audio editor and recorder", false),
        a("HandBrake.HandBrake", "HandBrake", "Media", "Open-source video transcoder", false),
        a("dotPDN.PaintDotNet", "Paint.NET", "Media", "Fast lightweight image & layer editor", false),
        // Communication & Gaming
        a("Discord.Discord", "Discord", "Communication", "Voice, video & community chat", false),
        a("SlackTechnologies.Slack", "Slack", "Communication", "Team messaging and workspace hub", false),
        a("Valve.Steam", "Steam", "Gaming", "PC gaming store and library launcher", false),
        a("EpicGames.EpicGamesLauncher", "Epic Games Launcher", "Gaming", "Epic Games store & Unreal Engine hub", false),
        a("Playnite.Playnite", "Playnite", "Gaming", "Unified open-source game library manager", false),
    ]
}

fn valid_pkg_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && !id.starts_with('-')
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | '+'))
}

pub fn parse_search_output(stdout: &str) -> Vec<SearchResult> {
    let cleaned = strip_ansi_and_progress(stdout);
    let lines: Vec<&str> = cleaned
        .lines()
        .map(|l| l.rsplit('\r').next().unwrap_or(l))
        .collect();
    let Some(sep) = lines
        .iter()
        .position(|l| l.trim().len() >= 10 && l.trim().chars().all(|c| c == '-'))
    else {
        return Vec::new();
    };
    let mut results = Vec::new();
    for line in lines.iter().skip(sep + 1).take(50) {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        let cols = split_columns(trimmed);
        if cols.len() >= 3 {
            results.push(SearchResult {
                name: cols[0].to_owned(),
                id: cols[1].to_owned(),
                version: cols[2].to_owned(),
                source: cols.get(3).copied().unwrap_or("winget").to_owned(),
            });
        }
    }
    results
}

fn split_columns(line: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut start = 0usize;
    let bytes = line.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b' ' {
            let mut j = i;
            while j < bytes.len() && bytes[j] == b' ' {
                j += 1;
            }
            if j - i >= 2 {
                let piece = line[start..i].trim();
                if !piece.is_empty() {
                    out.push(piece);
                }
                start = j;
            }
            i = j;
        } else {
            i += 1;
        }
    }
    let tail = line[start..].trim();
    if !tail.is_empty() {
        out.push(tail);
    }
    out
}

pub fn search(query: &str) -> Result<Vec<SearchResult>, String> {
    let q = query.trim();
    if q.is_empty() || q.starts_with('-') {
        return Err("Enter a valid package name to search WinGet.".into());
    }
    let out = Command::new("winget.exe")
        .args([
            "search",
            q,
            "--source",
            "winget",
            "--accept-source-agreements",
            "--disable-interactivity",
        ])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .map_err(|e| format!("WinGet search failed: {e}"))?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    Ok(parse_search_output(&stdout))
}

pub fn install_batch(ids: &[String]) -> Result<String, String> {
    if ids.is_empty() {
        return Err("Select at least one package to install.".into());
    }
    let mut log_lines = Vec::new();
    let mut succeeded = 0usize;
    for id in ids {
        let clean = id.trim();
        if !valid_pkg_id(clean) {
            log_lines.push(format!("[SKIP] Invalid package ID: {clean}"));
            continue;
        }
        let out = Command::new("winget.exe")
            .args([
                "install",
                "--id",
                clean,
                "--exact",
                "--accept-package-agreements",
                "--accept-source-agreements",
                "--disable-interactivity",
            ])
            .creation_flags(CREATE_NO_WINDOW)
            .output();
        match out {
            Ok(res) if res.status.success() => {
                succeeded += 1;
                log_lines.push(format!("[OK] Installed {clean}"));
            }
            Ok(res) => {
                let detail = String::from_utf8_lossy(&res.stdout)
                    .lines()
                    .last()
                    .unwrap_or("")
                    .trim()
                    .to_owned();
                log_lines.push(format!("[FAIL] {clean} ({}): {detail}", res.status));
            }
            Err(e) => {
                log_lines.push(format!("[ERR] {clean}: {e}"));
            }
        }
    }
    Ok(format!(
        "Batch complete: {succeeded}/{} succeeded.\n{}",
        ids.len(),
        log_lines.join("\n")
    ))
}
