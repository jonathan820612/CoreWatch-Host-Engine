# File: modules/tabs/AppInstallerManager.ps1
# CoreWatch Curated App Store & Package Installer (powered by WinGet + Official Fallback Links)
[CmdletBinding()]
param()

function Get-CuratedAppCatalog {
    return @(
        # ---- USER-REQUESTED CORE APPS ----
        @{ id='7zip.7zip'; name='7-Zip'; category='SysAdmin & Network'; requested=$true; essential=$true; desc='High-compression open-source archive manager (.7z, .zip, .rar, .tar).'; url='https://www.7-zip.org/download.html'; launchExe='7zFM.exe'; launchHints=@('7-Zip File Manager','7-Zip') }
        @{ id='BlenderFoundation.Blender'; name='Blender'; category='Creative & Media'; requested=$true; essential=$false; desc='Free, open-source 3D modeling, sculpting, rendering & animation suite.'; url='https://www.blender.org/download/'; launchExe='blender.exe'; launchHints=@('Blender') }
        @{ id='Docker.DockerDesktop'; name='Docker Desktop'; category='Dev & Languages'; requested=$true; essential=$false; desc='Container runtime, Docker CLI, Compose & WSL2 integration.'; url='https://www.docker.com/products/docker-desktop/'; launchExe='Docker Desktop.exe'; launchHints=@('Docker Desktop') }
        @{ id='EclipseAdoptium.Temurin.25.JDK'; name='Eclipse Temurin JDK 25 (LTS)'; category='Dev & Languages'; requested=$true; essential=$true; launchable=$false; desc='Eclipse Adoptium OpenJDK 25 Long-Term Support Java runtime & compiler.'; url='https://adoptium.net/temurin/releases/?version=25' }
        @{ id='EclipseAdoptium.Temurin.27.JDK'; name='Eclipse Temurin JDK 27 (Latest)'; category='Dev & Languages'; requested=$true; essential=$false; launchable=$false; desc='Latest Eclipse Adoptium OpenJDK 27+ feature release runtime & compiler.'; url='https://adoptium.net/temurin/releases/' }
        @{ id='EpicGames.EpicGamesLauncher'; name='Epic Games Launcher'; category='Gaming & RGB'; requested=$true; essential=$false; desc='Epic Games Store & Unreal Engine deployment launcher.'; url='https://store.epicgames.com/en-US/download'; launchExe='EpicGamesLauncher.exe'; launchHints=@('Epic Games Launcher') }
        @{ id='Git.Git'; name='Git for Windows'; category='Dev & Languages'; requested=$true; essential=$true; desc='Distributed version control CLI, Git Bash & credential manager.'; url='https://git-scm.com/download/win'; launchExe='git-bash.exe'; launchHints=@('Git Bash') }
        @{ id='GitHub.GitHubDesktop'; name='GitHub Desktop'; category='Dev & Languages'; requested=$true; essential=$false; desc='Official visual Git & GitHub client for commits, branches & PRs.'; url='https://desktop.github.com/'; launchExe='GitHubDesktop.exe'; launchHints=@('GitHub Desktop') }
        @{ id='Google.Chrome'; name='Google Chrome'; category='Browsers & Comms'; requested=$true; essential=$false; desc='Fast, widely compatible Chromium web browser by Google.'; url='https://www.google.com/chrome/'; launchExe='chrome.exe'; launchHints=@('Google Chrome') }
        @{ id='HypixelStudios.Hytale'; name='Hytale Launcher'; category='Gaming & RGB'; requested=$true; essential=$false; desc='Official Hypixel Studios Hytale game launcher & updater.'; url='https://hytale.com/download'; launchHints=@('Hytale Launcher','Hytale') }
        @{ id='LLVM.LLVM'; name='LLVM / Clang (C/C++ Compiler)'; category='Dev & Languages'; requested=$true; essential=$false; launchable=$false; desc='Modern Clang C/C++ compiler toolchain, lld linker & LLDB debugger.'; url='https://releases.llvm.org/' }
        @{ id='Microsoft.EdgeWebView2Runtime'; name='Microsoft Edge WebView2 Runtime'; category='Runtimes & Drivers'; requested=$true; essential=$true; launchable=$false; desc='Required Evergreen WebView2 engine powering CoreWatch & modern Windows apps.'; url='https://developer.microsoft.com/en-us/microsoft-edge/webview2/' }
        @{ id='Modrinth.ModrinthApp'; name='Modrinth App'; category='Gaming & RGB'; requested=$true; essential=$false; desc='Open-source Minecraft modpack & mod manager powered by Modrinth.'; url='https://modrinth.com/app'; launchHints=@('Modrinth App','Modrinth') }
        @{ id='MSYS2.MSYS2'; name='MSYS2 (MinGW / GCC C++ Toolchain)'; category='Dev & Languages'; requested=$true; essential=$false; desc='UNIX-like package manager with GCC/G++ C++ compilers for Windows.'; url='https://www.msys2.org/'; launchHints=@('MSYS2 UCRT64','MSYS2 MINGW64','MSYS2 MSYS') }
        @{ id='Nlitesoft.NTLite'; name='NTLite'; category='SysAdmin & Network'; requested=$true; essential=$false; desc='Windows ISO image customization, slipstreaming & live OS tweaking tool.'; url='https://www.ntlite.com/download/'; launchExe='NTLite.exe'; launchHints=@('NTLite') }
        @{ id='OpenRGB.OpenRGB'; name='OpenRGB'; category='Gaming & RGB'; requested=$true; essential=$false; desc='Open-source unified RGB lighting control without bloated vendor suites.'; url='https://openrgb.org/'; launchExe='OpenRGB.exe'; launchHints=@('OpenRGB') }
        @{ id='Opera.OperaGX'; name='Opera GX'; category='Browsers & Comms'; requested=$true; essential=$false; desc='Gaming-focused browser with RAM/CPU/network limiters.'; url='https://www.opera.com/gx'; launchExe='opera.exe'; launchHints=@('Opera GX Browser','Opera GX') }
        @{ id='Microsoft.PowerShell'; name='PowerShell 7 (Core)'; category='Dev & Languages'; requested=$true; essential=$true; desc='Modern PowerShell 7 shell. Updates existing MSI installs via official .msi; installs MSIX via WinGet if PowerShell Core is not yet installed (note: MSIX locks WindowsApps install folder permissions).'; url='https://github.com/PowerShell/PowerShell/releases'; launchExe='pwsh.exe'; launchHints=@('PowerShell 7') }
        @{ id='PrismLauncher.PrismLauncher'; name='Prism Launcher'; category='Gaming & RGB'; requested=$true; essential=$false; desc='Open-source multi-instance Minecraft launcher with Java & modpack management.'; url='https://prismlauncher.org/download/'; launchExe='prismlauncher.exe'; launchHints=@('Prism Launcher') }
        @{ id='Python.Python.3.13'; name='Python 3 (3.13)'; category='Dev & Languages'; requested=$true; essential=$true; launchable=$false; desc='Python 3 runtime, pip package manager & standard library.'; url='https://www.python.org/downloads/' }
        @{ id='Roblox.Roblox'; name='Roblox'; category='Gaming & RGB'; requested=$true; essential=$false; desc='Roblox player client & online game platform.'; url='https://www.roblox.com/download'; launchHints=@('Roblox Player','Roblox') }
        @{ id='Rustlang.Rustup'; name='Rust (rustup + cargo)'; category='Dev & Languages'; requested=$true; essential=$false; launchable=$false; desc='Official Rust toolchain installer (rustc, cargo, rustup).'; url='https://www.rust-lang.org/tools/install' }
        @{ id='Valve.Steam'; name='Steam'; category='Gaming & RGB'; requested=$true; essential=$false; desc='Valve PC gaming storefront, launcher & library manager.'; url='https://store.steampowered.com/about/'; launchExe='steam.exe'; launchHints=@('Steam') }
        @{ id='Microsoft.VCRedist.2015+.x64'; name='Visual C++ Redistributable (x64)'; category='Runtimes & Drivers'; requested=$true; essential=$true; launchable=$false; desc='Required Microsoft C++ 2015-2022 64-bit runtime libraries for games & apps.'; url='https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist' }
        @{ id='Microsoft.VCRedist.2015+.x86'; name='Visual C++ Redistributable (x86)'; category='Runtimes & Drivers'; requested=$true; essential=$true; launchable=$false; desc='Required Microsoft C++ 2015-2022 32-bit runtime libraries for games & apps.'; url='https://learn.microsoft.com/en-us/cpp/windows/latest-supported-vc-redist' }
        @{ id='Microsoft.VisualStudio.Community'; name='Visual Studio Community 2026'; category='Dev & Languages'; requested=$true; essential=$false; desc='Latest Visual Studio 2026 Community IDE (v18.x) for C++, C#, .NET & desktop dev.'; url='https://visualstudio.microsoft.com/downloads/'; launchHints=@('Visual Studio 2026','Visual Studio') }
        @{ id='Microsoft.VisualStudio.2022.Community'; name='Visual Studio Community 2022'; category='Dev & Languages'; requested=$true; essential=$false; desc='Visual Studio 2022 Community IDE (v17.x) for C++ & .NET workloads.'; url='https://visualstudio.microsoft.com/vs/older-downloads/'; launchHints=@('Visual Studio 2022') }
        @{ id='Microsoft.VisualStudioCode'; name='Visual Studio Code'; category='Dev & Languages'; requested=$true; essential=$true; desc='Lightweight, extensible source code editor by Microsoft.'; url='https://code.visualstudio.com/download'; launchExe='Code.exe'; launchHints=@('Visual Studio Code') }
        @{ id='WiresharkFoundation.Wireshark'; name='Wireshark'; category='SysAdmin & Network'; requested=$true; essential=$false; desc='Industry-standard network packet capture & protocol analyzer.'; url='https://www.wireshark.org/download.html'; launchExe='Wireshark.exe'; launchHints=@('Wireshark') }

        # ---- FULL ARTCRAFT SUITE (GITHUB / STORYTOLD PURE-RUST CREATIVE & OFFICE SUITE) ----
        @{ id='ArtCraft.Launcher'; name='ArtCraft Launcher'; category='ArtCraft Suite'; requested=$true; essential=$false; customType='github_msi'; githubRepo='storytold/craft-launcher'; desc='Official ArtCraft Suite hub & auto-updater for installing, updating & launching all Craft apps.'; url='https://getartcraft.com/apps'; launchHints=@('ArtCraft Launcher') }
        @{ id='ArtCraft.ArtCraft'; name='ArtCraft'; category='ArtCraft Suite'; requested=$true; essential=$false; desc='ArtCraft AI creative studio & 2D/3D visual composition workspace (Pure Rust).'; url='https://github.com/storytold'; launchHints=@('ArtCraft') }
        @{ id='ArtCraft.CadCraft'; name='CADCraft'; category='ArtCraft Suite'; requested=$true; essential=$false; desc='ArtCraft native CAD & precision technical drafting app (Pure Rust).'; url='https://github.com/storytold'; launchHints=@('CADCraft') }
        @{ id='ArtCraft.CraftAnything'; name='Craft Anything'; category='ArtCraft Suite'; requested=$true; essential=$false; desc='ArtCraft creative asset authoring & generative studio tool (Pure Rust).'; url='https://github.com/storytold'; launchHints=@('Craft Anything') }
        @{ id='ArtCraft.DeckCraft'; name='DeckCraft'; category='ArtCraft Suite'; requested=$true; essential=$false; desc='ArtCraft presentation & slideshow creator (PowerPoint alternative).'; url='https://github.com/storytold'; launchHints=@('DeckCraft') }
        @{ id='ArtCraft.DesignCraft'; name='DesignCraft'; category='ArtCraft Suite'; requested=$true; essential=$false; desc='ArtCraft page layout & desktop publishing tool (InDesign alternative).'; url='https://github.com/storytold'; launchHints=@('DesignCraft') }
        @{ id='ArtCraft.EffectCraft'; name='EffectCraft'; category='ArtCraft Suite'; requested=$true; essential=$false; desc='ArtCraft motion graphics & VFX compositor (After Effects alternative).'; url='https://github.com/storytold'; launchHints=@('EffectCraft') }
        @{ id='ArtCraft.FilmCraft'; name='FilmCraft'; category='ArtCraft Suite'; requested=$true; essential=$false; desc='ArtCraft non-linear video editing & color grading suite (Premiere alternative).'; url='https://github.com/storytold'; launchHints=@('FilmCraft') }
        @{ id='ArtCraft.GridCraft'; name='GridCraft'; category='ArtCraft Suite'; requested=$true; essential=$false; desc='ArtCraft spreadsheet & data analysis app (Excel alternative).'; url='https://github.com/storytold'; launchHints=@('GridCraft') }
        @{ id='ArtCraft.LightCraft'; name='LightCraft'; category='ArtCraft Suite'; requested=$true; essential=$false; desc='ArtCraft RAW photo library & color developer (Lightroom alternative).'; url='https://github.com/storytold'; launchHints=@('LightCraft') }
        @{ id='ArtCraft.MaterialCraft'; name='MaterialCraft'; category='ArtCraft Suite'; requested=$true; essential=$false; desc='ArtCraft node-based PBR material authoring studio for 3D workflows.'; url='https://github.com/storytold'; launchHints=@('MaterialCraft') }
        @{ id='ArtCraft.PdfCraft'; name='PdfCraft'; category='ArtCraft Suite'; requested=$true; essential=$false; desc='ArtCraft fast native PDF viewer, editor & document utility.'; url='https://github.com/storytold'; launchHints=@('PdfCraft') }
        @{ id='ArtCraft.PhotoCraft'; name='PhotoCraft'; category='ArtCraft Suite'; requested=$true; essential=$false; desc='ArtCraft layer/mask/PSD raster image editor (modern Photoshop alternative).'; url='https://github.com/storytold'; launchHints=@('PhotoCraft') }
        @{ id='ArtCraft.SoundCraft'; name='SoundCraft'; category='ArtCraft Suite'; requested=$true; essential=$false; desc='ArtCraft multi-track audio recording, editing & mixing DAW.'; url='https://github.com/storytold'; launchHints=@('SoundCraft') }
        @{ id='ArtCraft.TextureCraft'; name='TextureCraft'; category='ArtCraft Suite'; requested=$true; essential=$false; desc='ArtCraft procedural & seamless 3D texture creation suite.'; url='https://github.com/storytold'; launchHints=@('TextureCraft') }
        @{ id='ArtCraft.VectorCraft'; name='VectorCraft'; category='ArtCraft Suite'; requested=$true; essential=$false; desc='ArtCraft scalable vector illustration tool (Illustrator alternative).'; url='https://github.com/storytold'; launchHints=@('VectorCraft') }
        @{ id='ArtCraft.WordCraft'; name='WordCraft'; category='ArtCraft Suite'; requested=$true; essential=$false; desc='ArtCraft native word processor & document editor (Word alternative).'; url='https://github.com/storytold'; launchHints=@('WordCraft') }

        # ---- ESSENTIAL NON-OVERLAPPING RUNTIMES, DEV TOOLS & POPULAR APPS ----
        @{ id='Microsoft.DotNet.DesktopRuntime.8'; name='.NET Desktop Runtime 8 (LTS)'; category='Runtimes & Drivers'; requested=$false; essential=$true; launchable=$false; desc='Required runtime for modern .NET 8 WPF/WinForms desktop applications.'; url='https://dotnet.microsoft.com/en-us/download/dotnet/8.0' }
        @{ id='Microsoft.DotNet.DesktopRuntime.9'; name='.NET Desktop Runtime 9'; category='Runtimes & Drivers'; requested=$false; essential=$false; launchable=$false; desc='Latest .NET 9 Windows Desktop runtime for newer C# applications.'; url='https://dotnet.microsoft.com/en-us/download/dotnet/9.0' }
        @{ id='Microsoft.DirectX'; name='DirectX End-User Runtime'; category='Runtimes & Drivers'; requested=$false; essential=$true; launchable=$false; desc='Legacy DirectX 9/10/11 libraries (d3dx9/xinput) required by many games.'; url='https://www.microsoft.com/en-us/download/details.aspx?id=35' }
        @{ id='CoreWatch.PawnIO'; name='PawnIO Kernel Driver (CPU Temps)'; category='Runtimes & Drivers'; requested=$false; essential=$true; launchable=$false; desc='WHQL-signed driver enabling Ryzen/Intel CPU thermal & MSR telemetry in CoreWatch.'; url='https://pawnio.eu/'; customType='pawnio' }
        @{ id='EclipseAdoptium.Temurin.21.JDK'; name='Eclipse Temurin JDK 21 (LTS)'; category='Dev & Languages'; requested=$false; essential=$false; launchable=$false; desc='OpenJDK 21 LTS — widely required by Minecraft 1.20.5+ & legacy Java tools.'; url='https://adoptium.net/temurin/releases/?version=21' }
        @{ id='OpenJS.NodeJS.LTS'; name='Node.js (LTS)'; category='Dev & Languages'; requested=$false; essential=$false; launchable=$false; desc='JavaScript runtime & npm package manager (Long-Term Support).'; url='https://nodejs.org/en/download' }
        @{ id='Kitware.CMake'; name='CMake'; category='Dev & Languages'; requested=$false; essential=$false; launchable=$false; desc='Cross-platform C/C++ build system generator.'; url='https://cmake.org/download/' }
        @{ id='Microsoft.WindowsTerminal'; name='Windows Terminal'; category='Dev & Languages'; requested=$false; essential=$true; desc='Modern tabbed terminal for PowerShell, CMD, WSL & Azure Cloud Shell.'; url='https://github.com/microsoft/terminal/releases'; launchExe='wt.exe'; launchHints=@('Windows Terminal','Terminal') }
        @{ id='Notepad++.Notepad++'; name='Notepad++'; category='Dev & Languages'; requested=$false; essential=$true; desc='Fast, lightweight syntax-highlighted text, log & code editor.'; url='https://notepad-plus-plus.org/downloads/'; launchExe='notepad++.exe'; launchHints=@('Notepad++') }
        @{ id='Mozilla.Firefox'; name='Mozilla Firefox'; category='Browsers & Comms'; requested=$false; essential=$false; desc='Open-source, privacy-focused Gecko web browser.'; url='https://www.mozilla.org/firefox/new/'; launchExe='firefox.exe'; launchHints=@('Firefox','Mozilla Firefox') }
        @{ id='Brave.Brave'; name='Brave Browser'; category='Browsers & Comms'; requested=$false; essential=$false; desc='Chromium browser with built-in ad & tracker blocking.'; url='https://brave.com/download/'; launchExe='brave.exe'; launchHints=@('Brave') }
        @{ id='Discord.Discord'; name='Discord'; category='Browsers & Comms'; requested=$false; essential=$false; desc='Voice, video, screen-sharing & community chat app.'; url='https://discord.com/download'; launchHints=@('Discord') }
        @{ id='Rufus.Rufus'; name='Rufus'; category='SysAdmin & Network'; requested=$false; essential=$false; desc='Create bootable Windows & Linux USB installation drives reliably.'; url='https://rufus.ie/'; launchExe='rufus.exe'; launchHints=@('Rufus') }
        @{ id='PuTTY.PuTTY'; name='PuTTY'; category='SysAdmin & Network'; requested=$false; essential=$false; desc='Lightweight SSH, Telnet & serial console client.'; url='https://www.putty.org/'; launchExe='putty.exe'; launchHints=@('PuTTY') }
        @{ id='WinSCP.WinSCP'; name='WinSCP'; category='SysAdmin & Network'; requested=$false; essential=$false; desc='GUI SFTP, SCP, WebDAV & FTP file transfer client for Windows.'; url='https://winscp.net/eng/download.php'; launchExe='WinSCP.exe'; launchHints=@('WinSCP') }
        @{ id='Tailscale.Tailscale'; name='Tailscale VPN'; category='SysAdmin & Network'; requested=$false; essential=$false; desc='Zero-config WireGuard mesh VPN for secure remote access to your devices.'; url='https://tailscale.com/download/windows'; launchExe='tailscale-ipn.exe'; launchHints=@('Tailscale') }
        @{ id='Bitwarden.Bitwarden'; name='Bitwarden'; category='SysAdmin & Network'; requested=$false; essential=$false; desc='Open-source cross-platform password & passkey manager.'; url='https://bitwarden.com/download/'; launchExe='Bitwarden.exe'; launchHints=@('Bitwarden') }
        @{ id='VideoLAN.VLC'; name='VLC Media Player'; category='Creative & Media'; requested=$false; essential=$true; desc='Universal open-source audio & video player supporting virtually all codecs.'; url='https://www.videolan.org/vlc/'; launchExe='vlc.exe'; launchHints=@('VLC media player','VLC') }
        @{ id='OBSProject.OBSStudio'; name='OBS Studio'; category='Creative & Media'; requested=$false; essential=$false; desc='Open-source screen recording, streaming & virtual camera studio.'; url='https://obsproject.com/download'; launchExe='obs64.exe'; launchHints=@('OBS Studio') }
        @{ id='Guru3D.Afterburner'; name='MSI Afterburner'; category='Gaming & RGB'; requested=$false; essential=$false; desc='GPU overclocking, custom fan curves & RivaTuner FPS overlay.'; url='https://www.msi.com/Landing/afterburner/graphics-cards'; launchExe='MSIAfterburner.exe'; launchHints=@('MSI Afterburner') }
    )
}

function Get-VersionLagInfo {
    param([string]$InstalledVer, [string]$AvailableVer)

    if (-not $AvailableVer -or $AvailableVer -eq $InstalledVer) {
        return @{ tier = 'uptodate'; missed = 0 }
    }
    try {
        $iNums = @([regex]::Matches($InstalledVer, '\d+') | ForEach-Object { [int]$_.Value })
        $aNums = @([regex]::Matches($AvailableVer, '\d+') | ForEach-Object { [int]$_.Value })
        if ($iNums.Count -gt 0 -and $aNums.Count -gt 0) {
            $iMaj = $iNums[0]; $aMaj = $aNums[0]
            $iMin = if ($iNums.Count -gt 1) { $iNums[1] } else { 0 }
            $aMin = if ($aNums.Count -gt 1) { $aNums[1] } else { 0 }
            $iPat = if ($iNums.Count -gt 2) { $iNums[2] } else { 0 }
            $aPat = if ($aNums.Count -gt 2) { $aNums[2] } else { 0 }

            if ($aMaj -gt $iMaj) {
                $majDiff = $aMaj - $iMaj
                if ($majDiff -ge 2) { return @{ tier = 'critical'; missed = ($majDiff * 6) } }
                return @{ tier = 'update'; missed = 3 }
            }
            if ($aMaj -eq $iMaj -and $aMin -gt $iMin) {
                $minDiff = $aMin - $iMin
                return @{ tier = $(if ($minDiff -gt 5) { 'critical' } else { 'update' }); missed = $minDiff }
            }
            if ($aMaj -eq $iMaj -and $aMin -eq $iMin -and $aPat -gt $iPat) {
                $patDiff = $aPat - $iPat
                return @{ tier = $(if ($patDiff -gt 5) { 'critical' } else { 'update' }); missed = $patDiff }
            }
        }
    } catch {}
    return @{ tier = 'update'; missed = 1 }
}

function Get-InstalledWingetMap {
    $map = @{}
    $wingetCmd = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $wingetCmd) {
        return @{ available = $false; version = ''; map = $map }
    }

    $wgVer = ""
    try { $wgVer = ((& winget --version 2>$null) | Out-String).Trim() } catch {}

    try {
        $rawLines = @(& winget list --accept-source-agreements 2>$null)
        foreach ($line in $rawLines) {
            if (-not $line -or $line.Length -lt 10) { continue }
            # Capture: PackageId   InstalledVersion   [AvailableVersion]   [Source]
            if ($line -match '\s([A-Za-z0-9][A-Za-z0-9\-+]*\.[A-Za-z0-9\.\-\+_]+)\s+([^\s]+)(?:\s+([^\s]+))?(?:\s+([^\s]+))?') {
                $pkgId = $Matches[1].Trim()
                $ver   = $Matches[2].Trim()
                $col3  = if ($Matches[3]) { $Matches[3].Trim() } else { '' }
                $avail = ''
                # col3 is Available version only when it looks like a version (not 'winget'/'msstore')
                if ($col3 -and $col3 -notmatch '^(winget|msstore|Tag:)$' -and $col3 -match '\d') {
                    $avail = $col3
                }
                if ($pkgId -and -not $map.ContainsKey($pkgId.ToLowerInvariant())) {
                    $map[$pkgId.ToLowerInvariant()] = @{ version = $ver; available = $avail }
                }
            }
        }
    } catch {}

    try {
        $pawnSvc = Get-Service -Name "PawnIO" -ErrorAction SilentlyContinue
        if ($pawnSvc) {
            $map['corewatch.pawnio'] = @{ version = $(if ($pawnSvc.Status -eq 'Running') { 'Running' } else { 'Installed' }); available = '' }
        }
    } catch {}

    return @{ available = $true; version = $wgVer; map = $map }
}

function Get-AppLaunchIndex {
    $shortcuts = New-Object System.Collections.Generic.List[object]
    $roots = @(
        (Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"),
        (Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs"),
        [Environment]::GetFolderPath("Desktop")
    )
    foreach ($root in $roots) {
        if (-not $root -or -not (Test-Path -LiteralPath $root -PathType Container)) { continue }
        try {
            Get-ChildItem -LiteralPath $root -Filter "*.lnk" -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
                $base = [System.IO.Path]::GetFileNameWithoutExtension($_.Name)
                if ($base -and $base -notmatch '(?i)\b(uninstall|readme|help|website|documentation|license|release notes|manual|updater|remove)\b') {
                    $shortcuts.Add([PSCustomObject]@{ name = $base; full = $_.FullName })
                }
            }
        } catch {}
    }

    $appPaths = @{}
    foreach ($apRoot in @(
        "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\*",
        "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\*"
    )) {
        try {
            Get-ItemProperty -Path $apRoot -ErrorAction SilentlyContinue | ForEach-Object {
                $exeKey = [string]$_.PSChildName
                $exeVal = ([string]$_.'(default)').Trim().Trim('"')
                if ($exeKey -and $exeVal -and (Test-Path -LiteralPath $exeVal -PathType Leaf)) {
                    $appPaths[$exeKey.ToLowerInvariant()] = $exeVal
                }
            }
        } catch {}
    }

    return @{ shortcuts = $shortcuts; appPaths = $appPaths }
}

function Resolve-CatalogAppLaunchTarget {
    param(
        [Parameter(Mandatory)][hashtable]$App,
        [Parameter(Mandatory)][hashtable]$LaunchIndex,
        [hashtable]$RegEntry = $null
    )
    if ($App.ContainsKey('launchable') -and $App.launchable -eq $false) {
        return $null
    }

    # 1. Exact Start Menu / Desktop shortcut match by launchHints or clean app name
    $hints = @()
    if ($App.ContainsKey('launchHints') -and $App.launchHints) { $hints += @($App.launchHints) }
    $cleanName = ($App.name -replace '\s*\([^)]*\)\s*', '').Trim()
    if ($cleanName -and ($hints -notcontains $cleanName)) { $hints += $cleanName }

    foreach ($h in $hints) {
        $exact = $LaunchIndex.shortcuts | Where-Object { $_.name -ieq $h } | Select-Object -First 1
        if ($exact) { return $exact.full }
    }
    foreach ($h in $hints) {
        if ($h.Length -lt 4) { continue }
        $partial = $LaunchIndex.shortcuts | Where-Object { $_.name -like "$h*" } | Sort-Object { $_.name.Length } | Select-Object -First 1
        if ($partial) { return $partial.full }
    }

    # 2. Windows App Paths registry or PATH lookup for known launchExe
    if ($App.ContainsKey('launchExe') -and $App.launchExe) {
        $exeLow = ([string]$App.launchExe).ToLowerInvariant()
        if ($LaunchIndex.appPaths.ContainsKey($exeLow)) {
            return $LaunchIndex.appPaths[$exeLow]
        }
        $cmd = Get-Command ([string]$App.launchExe) -ErrorAction SilentlyContinue
        if ($cmd -and $cmd.Source -and (Test-Path -LiteralPath $cmd.Source -PathType Leaf)) {
            return [string]$cmd.Source
        }
        # Common standard paths for popular tools
        $probeDirs = @(
            (Join-Path $env:ProgramFiles "7-Zip"),
            (Join-Path $env:ProgramFiles "PowerShell\7"),
            (Join-Path $env:ProgramFiles "Git"),
            (Join-Path $env:ProgramFiles "Wireshark"),
            (Join-Path $env:ProgramFiles "Notepad++"),
            (Join-Path $env:ProgramFiles "VideoLAN\VLC"),
            (Join-Path $env:ProgramFiles "obs-studio\bin\64bit"),
            (Join-Path ${env:ProgramFiles(x86)} "Steam"),
            (Join-Path ${env:ProgramFiles(x86)} "MSI Afterburner"),
            (Join-Path $env:LOCALAPPDATA "Programs\Microsoft VS Code")
        )
        foreach ($d in $probeDirs) {
            if (-not $d) { continue }
            $cand = Join-Path $d ([string]$App.launchExe)
            if (Test-Path -LiteralPath $cand -PathType Leaf) { return $cand }
        }
    }

    # 3. Uninstall registry DisplayIcon / InstallLocation fallback
    if ($RegEntry) {
        if ($RegEntry.displayIcon) {
            $iconPath = ([string]$RegEntry.displayIcon -split ',')[0].Trim().Trim('"')
            if ($iconPath -match '\.exe$' -and $iconPath -notmatch '(?i)unins|setup|update' -and (Test-Path -LiteralPath $iconPath -PathType Leaf)) {
                return $iconPath
            }
        }
        if ($RegEntry.installLocation -and $App.ContainsKey('launchExe') -and $App.launchExe) {
            $cand = Join-Path ([string]$RegEntry.installLocation).Trim().Trim('"') ([string]$App.launchExe)
            if (Test-Path -LiteralPath $cand -PathType Leaf) { return $cand }
        }
    }

    return $null
}

function Get-AppInstallerState {
    [CmdletBinding()]
    param([switch]$SkipInstalledProbe)

    $catalog = @(Get-CuratedAppCatalog | Sort-Object { $_.name })
    $wgAvailable = $false
    $wgVersion   = ""
    $installedMap = @{}

    if (-not $SkipInstalledProbe) {
        $probe = Get-InstalledWingetMap
        $wgAvailable  = [bool]$probe.available
        $wgVersion    = [string]$probe.version
        $installedMap = $probe.map
    } else {
        $wgCmd = Get-Command winget -ErrorAction SilentlyContinue
        $wgAvailable = ($null -ne $wgCmd)
        if ($wgAvailable) {
            try { $wgVersion = ((& winget --version 2>$null) | Out-String).Trim() } catch {}
        }
    }

    $regEntries = New-Object System.Collections.Generic.List[object]
    try {
        $regPaths = @(
            'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
            'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
            'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
        )
        foreach ($rp in $regPaths) {
            Get-ItemProperty -Path $rp -ErrorAction SilentlyContinue | ForEach-Object {
                if ($_.DisplayName) {
                    $regEntries.Add([PSCustomObject]@{
                        displayName     = [string]$_.DisplayName
                        displayVersion  = if ($_.DisplayVersion) { [string]$_.DisplayVersion } else { "" }
                        installLocation = if ($_.InstallLocation) { [string]$_.InstallLocation } else { "" }
                        displayIcon     = if ($_.DisplayIcon) { [string]$_.DisplayIcon } else { "" }
                    })
                }
            }
        }
    } catch {}

    $launchIndex = Get-AppLaunchIndex

    $items = New-Object System.Collections.Generic.List[PSCustomObject]
    $installedCount  = 0
    $outdatedCount   = 0
    $launchableCount = 0

    foreach ($app in $catalog) {
        $idKey = $app.id.ToLowerInvariant()
        $isInstalled = $false
        $instVer = ""
        $availVer = ""
        $verTier = "none"
        $missedUpdates = 0

        $needle = ($app.name -replace '\s*\([^)]*\)\s*', '').Trim()
        $matchedReg = $null
        if ($needle.Length -ge 4) {
            $matchedReg = $regEntries | Where-Object { $_.displayName -ieq $needle } | Select-Object -First 1
            if (-not $matchedReg) {
                $matchedReg = $regEntries | Where-Object { $_.displayName -like "*$needle*" } | Select-Object -First 1
            }
        }

        if ($installedMap.ContainsKey($idKey)) {
            $isInstalled = $true
            $entry = $installedMap[$idKey]
            $instVer  = [string]$entry.version
            $availVer = [string]$entry.available
            $lag = Get-VersionLagInfo -InstalledVer $instVer -AvailableVer $availVer
            $verTier = [string]$lag.tier
            $missedUpdates = [int]$lag.missed
        } elseif ($app.id -eq 'CoreWatch.PawnIO') {
            $pawnSvc = Get-Service -Name "PawnIO" -ErrorAction SilentlyContinue
            if ($pawnSvc) { $isInstalled = $true; $instVer = [string]$pawnSvc.Status; $verTier = 'uptodate' }
        } elseif ($matchedReg) {
            $isInstalled = $true
            $instVer = if ($matchedReg.displayVersion) { $matchedReg.displayVersion } else { "Detected" }
            $verTier = "uptodate"
        }

        $launchTarget = $null
        if ($isInstalled -or (-not ($app.ContainsKey('launchable') -and $app.launchable -eq $false))) {
            $launchTarget = Resolve-CatalogAppLaunchTarget -App $app -LaunchIndex $launchIndex -RegEntry $(if ($matchedReg) { @{ displayIcon = $matchedReg.displayIcon; installLocation = $matchedReg.installLocation } } else { $null })
            if ($launchTarget -and -not $isInstalled) {
                $isInstalled = $true
                $instVer = "Detected"
                $verTier = "uptodate"
            }
        }
        $canLaunch = (-not [string]::IsNullOrWhiteSpace($launchTarget))

        if ($isInstalled) { $installedCount++ }
        if ($canLaunch) { $launchableCount++ }
        if ($verTier -eq 'update' -or $verTier -eq 'critical') { $outdatedCount++ }

        $items.Add([PSCustomObject]@{
            id               = [string]$app.id
            name             = [string]$app.name
            category         = [string]$app.category
            requested        = [bool]$app.requested
            essential        = [bool]$app.essential
            desc             = [string]$app.desc
            url              = [string]$app.url
            customType       = if ($app.ContainsKey('customType')) { [string]$app.customType } else { 'winget' }
            installed        = [bool]$isInstalled
            canLaunch        = [bool]$canLaunch
            version          = $instVer
            availableVersion = $availVer
            versionTier      = $verTier
            missedUpdates    = $missedUpdates
        })
    }

    return @{
        type            = "REFRESH_APP_INSTALLER"
        wingetAvailable = $wgAvailable
        wingetVersion   = $wgVersion
        apps            = @($items)
        summary         = @{
            total      = $items.Count
            installed  = $installedCount
            launchable = $launchableCount
            available  = ($items.Count - $installedCount)
            outdated   = $outdatedCount
            requested  = @($items | Where-Object { $_.requested }).Count
        }
        error           = $null
    }
}

function Start-WingetTerminalBatch {
    param(
        [string[]]$PackageIds,
        [string]$ActionMode = 'install',
        [string]$RootPath = ''
    )

    $catalogMap = @{}
    foreach ($c in (Get-CuratedAppCatalog)) {
        $catalogMap[$c.id.ToLowerInvariant()] = $c
    }

    $safeIds = New-Object System.Collections.Generic.List[string]
    $includePawnIo = $false
    foreach ($pidRaw in $PackageIds) {
        $clean = ([string]$pidRaw).Trim()
        if ($clean -eq 'CoreWatch.PawnIO') {
            $includePawnIo = $true
            continue
        }
        if ($clean -match '^[A-Za-z0-9][A-Za-z0-9\.\-\+_]{2,110}$') {
            $safeIds.Add($clean)
        }
    }

    if ($safeIds.Count -eq 0 -and -not $includePawnIo -and $ActionMode -ne 'upgrade_all') {
        throw "No valid package IDs were provided."
    }

    $runnerPath = Join-Path $env:TEMP ("CoreWatch-AppInstaller-{0}.ps1" -f ([guid]::NewGuid().ToString('N').Substring(0,8)))
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.AppendLine('$Host.UI.RawUI.WindowTitle = "CoreWatch App Installer"')
    [void]$sb.AppendLine('Write-Host "============================================================" -ForegroundColor Cyan')
    [void]$sb.AppendLine('Write-Host "  CoreWatch App Downloader & Package Installer" -ForegroundColor Cyan')
    [void]$sb.AppendLine('Write-Host "============================================================" -ForegroundColor Cyan')
    [void]$sb.AppendLine('')
    [void]$sb.AppendLine('# Refresh local WinGet manifest index first to minimize stale installer hash mismatches')
    [void]$sb.AppendLine('Write-Host "Refreshing WinGet package sources..." -ForegroundColor DarkCyan')
    [void]$sb.AppendLine('& winget source update --disable-interactivity 2>$null | Out-Null')
    [void]$sb.AppendLine('$hashFallbackItems = New-Object System.Collections.Generic.List[object]')
    [void]$sb.AppendLine('')

    if ($ActionMode -eq 'upgrade_all') {
        [void]$sb.AppendLine('Write-Host "Running: winget upgrade --all --accept-package-agreements --accept-source-agreements" -ForegroundColor Yellow')
        [void]$sb.AppendLine('& winget upgrade --all --accept-package-agreements --accept-source-agreements')
    } else {
        $total = $safeIds.Count + $(if ($includePawnIo) { 1 } else { 0 })
        $idx = 0
        foreach ($pkg in $safeIds) {
            $idx++
            $wgVerb = if ($ActionMode -eq 'upgrade') { 'upgrade' } else { 'install' }
            $meta = if ($catalogMap.ContainsKey($pkg.ToLowerInvariant())) { $catalogMap[$pkg.ToLowerInvariant()] } else { $null }
            $safeUrl = if ($meta -and $meta.url) { $meta.url.Replace("'", "''") } else { "" }
            $safeName = if ($meta -and $meta.name) { $meta.name.Replace("'", "''") } else { $pkg }

            [void]$sb.AppendLine("Write-Host `"`n[$idx/$total] $($wgVerb.ToUpper()): $safeName ($pkg)`" -ForegroundColor Green")
            if ($meta -and $meta.ContainsKey('customType') -and $meta.customType -eq 'github_msi' -and $meta.ContainsKey('githubRepo')) {
                $ghRepo = ([string]$meta.githubRepo).Replace("'", "''")
                [void]$sb.AppendLine('try {')
                [void]$sb.AppendLine('  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12')
                [void]$sb.AppendLine('  $arch = if ($env:PROCESSOR_ARCHITECTURE -match "ARM64") { "arm64" } else { "x64" }')
                [void]$sb.AppendLine("  `$rel = Invoke-RestMethod -Uri 'https://api.github.com/repos/$ghRepo/releases/latest' -Headers @{'User-Agent'='CoreWatch'} -TimeoutSec 20 -ErrorAction Stop")
                [void]$sb.AppendLine('  $msiAsset = $rel.assets | Where-Object { $_.name -match "windows-$arch\.msi$" } | Select-Object -First 1')
                [void]$sb.AppendLine('  if (-not $msiAsset) { $msiAsset = $rel.assets | Where-Object { $_.name -match "\.msi$" } | Select-Object -First 1 }')
                [void]$sb.AppendLine('  if ($msiAsset) {')
                [void]$sb.AppendLine('    $dst = Join-Path $env:TEMP $msiAsset.name')
                [void]$sb.AppendLine('    Write-Host "  Downloading $($msiAsset.name) ($($rel.tag_name))..." -ForegroundColor Cyan')
                [void]$sb.AppendLine('    Invoke-WebRequest -Uri $msiAsset.browser_download_url -OutFile $dst -UseBasicParsing -ErrorAction Stop')
                [void]$sb.AppendLine('    $p = Start-Process -FilePath "msiexec.exe" -ArgumentList @("/i", "`"$dst`"", "/qb") -Wait -PassThru')
                [void]$sb.AppendLine('    Remove-Item -LiteralPath $dst -Force -ErrorAction SilentlyContinue')
                [void]$sb.AppendLine('    Write-Host "  -> Installed $($rel.tag_name) via MSI (exit $($p.ExitCode))" -ForegroundColor Cyan')
                [void]$sb.AppendLine("  } elseif ('$safeUrl') { Start-Process '$safeUrl' }")
                [void]$sb.AppendLine("} catch { Write-Host `"  Download error: `$(`$_.Exception.Message)`" -ForegroundColor Yellow; if ('$safeUrl') { Start-Process '$safeUrl' } }")
                continue
            }
            if ($pkg -ieq 'Microsoft.PowerShell') {
                # Existing MSI install -> upgrade via latest official GitHub .msi.
                # No existing PowerShell Core (or already on MSIX) -> install/upgrade MSIX via WinGet (noting WindowsApps folder restrictions).
                [void]$sb.AppendLine('try {')
                [void]$sb.AppendLine('  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12')
                [void]$sb.AppendLine('  $psArch = if ($env:PROCESSOR_ARCHITECTURE -match "ARM64") { "arm64" } elseif ([Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }')
                [void]$sb.AppendLine('  $psDir = "C:\Program Files\PowerShell\7"')
                [void]$sb.AppendLine('  $hasMsiPs = Test-Path -LiteralPath (Join-Path $psDir "pwsh.exe") -PathType Leaf')
                [void]$sb.AppendLine('  if ($hasMsiPs) {')
                [void]$sb.AppendLine('    Write-Host "  Existing MSI PowerShell 7 found in $psDir — checking latest official .MSI..." -ForegroundColor Cyan')
                [void]$sb.AppendLine('    $psRels = @(Invoke-RestMethod -Uri "https://api.github.com/repos/PowerShell/PowerShell/releases?per_page=30" -Headers @{"User-Agent"="CoreWatch"} -TimeoutSec 20 -ErrorAction Stop)')
                [void]$sb.AppendLine('    $bestMsi = $null; $bestVer = [version]"0.0.0"; $bestTag = ""')
                [void]$sb.AppendLine('    foreach ($r in $psRels) {')
                [void]$sb.AppendLine('      if ($r.prerelease -or $r.draft) { continue }')
                [void]$sb.AppendLine('      if ([string]$r.tag_name -notmatch "^v(\d+\.\d+\.\d+)$") { continue }')
                [void]$sb.AppendLine('      $v = [version]$Matches[1]')
                [void]$sb.AppendLine('      $mA = $r.assets | Where-Object { $_.name -match "^PowerShell-.*-win-$psArch\.msi$" } | Select-Object -First 1')
                [void]$sb.AppendLine('      if ($mA -and $v -gt $bestVer) { $bestVer = $v; $bestTag = [string]$r.tag_name; $bestMsi = $mA }')
                [void]$sb.AppendLine('    }')
                [void]$sb.AppendLine('    if ($bestMsi) {')
                [void]$sb.AppendLine('      $psMsi = Join-Path $env:TEMP $bestMsi.name')
                [void]$sb.AppendLine('      Write-Host "  Downloading official MSI $($bestMsi.name) ($bestTag)..." -ForegroundColor Cyan')
                [void]$sb.AppendLine('      Invoke-WebRequest -Uri $bestMsi.browser_download_url -OutFile $psMsi -UseBasicParsing -ErrorAction Stop')
                [void]$sb.AppendLine('      $p = Start-Process -FilePath "msiexec.exe" -ArgumentList @("/i", "`"$psMsi`"", "/qb", "ADD_PATH=1", "REGISTER_MANIFEST=1", "USE_MU=1", "ENABLE_MU=1") -Wait -PassThru')
                [void]$sb.AppendLine('      Remove-Item -LiteralPath $psMsi -Force -ErrorAction SilentlyContinue')
                [void]$sb.AppendLine('      Write-Host "  -> Installed PowerShell $bestTag MSI into $psDir (exit $($p.ExitCode))" -ForegroundColor Cyan')
                [void]$sb.AppendLine('    }')
                [void]$sb.AppendLine('  } else {')
                [void]$sb.AppendLine('    Write-Host "  No MSI PowerShell Core found — installing/upgrading MSIX via WinGet..." -ForegroundColor Cyan')
                [void]$sb.AppendLine('    Write-Host "  NOTE: MSIX installs inside C:\Program Files\WindowsApps where Windows restricts direct folder edits." -ForegroundColor Yellow')
                [void]$sb.AppendLine("    & winget $wgVerb --id 'Microsoft.PowerShell' -e --source winget --accept-package-agreements --accept-source-agreements")
                [void]$sb.AppendLine('    Write-Host "  -> WinGet exit code: $LASTEXITCODE" -ForegroundColor Cyan')
                [void]$sb.AppendLine('  }')
                [void]$sb.AppendLine('} catch { Write-Host "  PowerShell update error: $($_.Exception.Message)" -ForegroundColor Red }')
                continue
            }
            [void]$sb.AppendLine("& winget $wgVerb --id '$pkg' -e --source winget --accept-package-agreements --accept-source-agreements")
            [void]$sb.AppendLine('$code = $LASTEXITCODE')
            [void]$sb.AppendLine('if ($code -eq 0 -or $code -eq -1978335189) {')
            [void]$sb.AppendLine("  Write-Host '  -> Installed / Already up to date ($pkg)' -ForegroundColor Cyan")
            [void]$sb.AppendLine('} elseif ($code -eq -1978335215) {')
            [void]$sb.AppendLine("  Write-Host '  -> HASH MISMATCH (-1978335215): Vendor updated their installer newer than the WinGet manifest.' -ForegroundColor Yellow")
            [void]$sb.AppendLine("  Write-Host '     Windows blocks hash-override inside elevated Admin terminals for security.' -ForegroundColor DarkYellow")
            if ($safeUrl) {
                [void]$sb.AppendLine("  `$hashFallbackItems.Add([PSCustomObject]@{ Name='$safeName'; Id='$pkg'; Url='$safeUrl' })")
                [void]$sb.AppendLine("  Write-Host '     Official installer fallback queued: $safeUrl' -ForegroundColor Cyan")
            }
            [void]$sb.AppendLine('} else {')
            [void]$sb.AppendLine("  Write-Host `"  -> Exit code `$code ($pkg)`" -ForegroundColor Yellow")
            [void]$sb.AppendLine('}')
        }
        if ($includePawnIo) {
            $idx++
            [void]$sb.AppendLine("Write-Host `"`n[$idx/$total] INSTALLING: PawnIO Kernel Driver (CPU Thermal Telemetry)`" -ForegroundColor Green")
            [void]$sb.AppendLine('try {')
            [void]$sb.AppendLine('  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12')
            [void]$sb.AppendLine('  $rel = Invoke-RestMethod -Uri "https://api.github.com/repos/namazso/PawnIO.Setup/releases/latest" -Headers @{"User-Agent"="CoreWatch"} -TimeoutSec 20')
            [void]$sb.AppendLine('  $asset = $rel.assets | Where-Object { $_.name -match "\.exe$" } | Select-Object -First 1')
            [void]$sb.AppendLine('  if ($asset) {')
            [void]$sb.AppendLine('    $dst = Join-Path $env:TEMP $asset.name')
            [void]$sb.AppendLine('    Write-Host "Downloading $($asset.name)..." -ForegroundColor Cyan')
            [void]$sb.AppendLine('    Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $dst -UseBasicParsing')
            [void]$sb.AppendLine('    Start-Process -FilePath $dst -Wait')
            [void]$sb.AppendLine('  } else { Start-Process "https://pawnio.eu/" }')
            [void]$sb.AppendLine('} catch { Write-Host "PawnIO download error: $($_.Exception.Message). Opening pawnio.eu..." -ForegroundColor Yellow; Start-Process "https://pawnio.eu/" }')
        }
    }

    [void]$sb.AppendLine('')
    [void]$sb.AppendLine('if ($hashFallbackItems.Count -gt 0) {')
    [void]$sb.AppendLine('  Write-Host "`n------------------------------------------------------------" -ForegroundColor Yellow')
    [void]$sb.AppendLine('  Write-Host "  $($hashFallbackItems.Count) package(s) hit a WinGet upstream hash mismatch (-1978335215):" -ForegroundColor Yellow')
    [void]$sb.AppendLine('  foreach ($fi in $hashFallbackItems) { Write-Host "   - $($fi.Name): $($fi.Url)" -ForegroundColor White }')
    [void]$sb.AppendLine('  $ans = Read-Host "`nOpen official vendor download page(s) in your browser now? [Y/n]"')
    [void]$sb.AppendLine('  if ([string]::IsNullOrWhiteSpace($ans) -or $ans -match "^[Yy]") {')
    [void]$sb.AppendLine('    foreach ($fi in $hashFallbackItems) { Start-Process $fi.Url }')
    [void]$sb.AppendLine('  }')
    [void]$sb.AppendLine('}')
    [void]$sb.AppendLine('')
    [void]$sb.AppendLine('Write-Host "`n============================================================" -ForegroundColor Cyan')
    [void]$sb.AppendLine('Write-Host "All queued operations finished. Return to CoreWatch and click Refresh Status." -ForegroundColor Green')
    [void]$sb.AppendLine('Read-Host "Press Enter to close this installer window"')
    [void]$sb.AppendLine("Remove-Item -LiteralPath '$runnerPath' -Force -ErrorAction SilentlyContinue")

    Set-Content -LiteralPath $runnerPath -Value $sb.ToString() -Encoding UTF8

    $containsPs = ($PackageIds | Where-Object { $_ -ieq 'Microsoft.PowerShell' }).Count -gt 0
    $shellExe = if ($containsPs) {
        Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
    } elseif (Get-Command pwsh -ErrorAction SilentlyContinue) {
        "pwsh.exe"
    } else {
        "powershell.exe"
    }
    Start-Process -FilePath $shellExe -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$runnerPath`"") -ErrorAction Stop
}

function Invoke-AppInstallerAction {
    param(
        [Parameter(Mandatory = $true)]
        $Payload,
        [string]$RootPath = ""
    )

    if ($Payload -is [string]) {
        $Payload = $Payload | ConvertFrom-Json
    }
    if ($null -eq $Payload -or -not $Payload.command) { return $null }

    $cmd = [string]$Payload.command
    try {
        switch ($cmd) {
            'APPSTORE_LOAD' {
                return Get-AppInstallerState
            }
            'APPSTORE_INSTALL_ONE' {
                $pkgId = ([string]$Payload.id).Trim()
                $mode  = if ($Payload.mode -eq 'upgrade') { 'upgrade' } else { 'install' }
                Start-WingetTerminalBatch -PackageIds @($pkgId) -ActionMode $mode -RootPath $RootPath
                return @{
                    type    = "APPSTORE_NOTICE"
                    ok      = $true
                    message = "Launched installer terminal for [$pkgId]. Click 'Refresh Status' after installation completes."
                }
            }
            'APPSTORE_INSTALL_BATCH' {
                $ids = @($Payload.ids | ForEach-Object { ([string]$_).Trim() } | Where-Object { $_ })
                if ($ids.Count -eq 0) { throw "Select at least one application to install." }
                Start-WingetTerminalBatch -PackageIds $ids -ActionMode 'install' -RootPath $RootPath
                return @{
                    type    = "APPSTORE_NOTICE"
                    ok      = $true
                    message = "Launched batch installer terminal for $($ids.Count) app(s): $($ids -join ', ')."
                }
            }
            'APPSTORE_UPGRADE_ALL' {
                Start-WingetTerminalBatch -PackageIds @() -ActionMode 'upgrade_all' -RootPath $RootPath
                return @{
                    type    = "APPSTORE_NOTICE"
                    ok      = $true
                    message = "Launched WinGet Upgrade All terminal."
                }
            }
            'APPSTORE_SEARCH_WINGET' {
                $query = ([string]$Payload.query).Trim()
                if (-not $query -or $query.Length -lt 2) { throw "Enter at least 2 characters to search WinGet." }
                if ($query -match '[;&|`$<>]') { throw "Search query contains unsupported shell characters." }
                $wgCmd = Get-Command winget -ErrorAction SilentlyContinue
                if (-not $wgCmd) { throw "WinGet is not installed on this system." }

                $raw = @(& winget search $query --source winget --accept-source-agreements 2>$null)
                $found = New-Object System.Collections.Generic.List[PSCustomObject]
                $inRows = $false
                foreach ($line in $raw) {
                    if ($line -match '^-{5,}') { $inRows = $true; continue }
                    if (-not $inRows -or -not $line.Trim()) { continue }
                    if ($line -match '^(.+?)\s{2,}([A-Za-z0-9][A-Za-z0-9\-+]*\.[A-Za-z0-9\.\-\+_]+)\s+([^\s]+)') {
                        $found.Add([PSCustomObject]@{
                            name    = $Matches[1].Trim()
                            id      = $Matches[2].Trim()
                            version = $Matches[3].Trim()
                        })
                        if ($found.Count -ge 25) { break }
                    }
                }
                return @{
                    type    = "APPSTORE_SEARCH_RESULTS"
                    query   = $query
                    results = @($found)
                    ok      = $true
                    message = "Found $($found.Count) WinGet package(s) matching '$query'."
                }
            }
            'APPSTORE_LAUNCH_APP' {
                $pkgId = ([string]$Payload.id).Trim()
                $app = Get-CuratedAppCatalog | Where-Object { $_.id -ieq $pkgId } | Select-Object -First 1
                if (-not $app) { throw "Application '$pkgId' is not in the curated catalog." }
                if ($app.ContainsKey('launchable') -and $app.launchable -eq $false) {
                    throw "$($app.name) is a system runtime or CLI toolchain and cannot be launched directly."
                }
                $launchIdx = Get-AppLaunchIndex
                $regEntry = $null
                $needle = ($app.name -replace '\s*\([^)]*\)\s*', '').Trim()
                foreach ($rp in @(
                    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*',
                    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*',
                    'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*'
                )) {
                    $hit = Get-ItemProperty -Path $rp -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like "*$needle*" } | Select-Object -First 1
                    if ($hit) {
                        $regEntry = @{ displayIcon = [string]$hit.DisplayIcon; installLocation = [string]$hit.InstallLocation }
                        break
                    }
                }
                $target = Resolve-CatalogAppLaunchTarget -App $app -LaunchIndex $launchIdx -RegEntry $regEntry
                if (-not $target -or -not (Test-Path -LiteralPath $target -PathType Leaf)) {
                    throw "Could not locate a launchable executable or shortcut for $($app.name)."
                }
                Start-Process -FilePath $target -ErrorAction Stop
                return @{
                    type    = "APPSTORE_NOTICE"
                    ok      = $true
                    message = "Launched $($app.name)."
                }
            }
            'APPSTORE_OPEN_URL' {
                $url = ([string]$Payload.url).Trim()
                if ($url -notmatch '^https://[A-Za-z0-9\-\.]+(/.*)?$') {
                    throw "Blocked non-HTTPS URL."
                }
                Start-Process $url
                return @{
                    type    = "APPSTORE_NOTICE"
                    ok      = $true
                    message = "Opened official download page: $url"
                }
            }
            default {
                throw "Unsupported App Installer command: $cmd"
            }
        }
    } catch {
        return @{
            type    = "APPSTORE_NOTICE"
            ok      = $false
            error   = $_.Exception.Message
            message = $_.Exception.Message
        }
    }
}
