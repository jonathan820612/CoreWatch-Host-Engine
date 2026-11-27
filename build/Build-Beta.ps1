<#
.SYNOPSIS
    Modern Beta release & modular installer build pipeline for RustCoreWatch.
    Verifies Clippy + unit tests, builds optimized Release binary (locked deps),
    stages optional Hardware Sensor Helper, renders high-DPI Dark/Light installer artwork,
    compiles the Inno Setup 6.7+ modular installer (Setup.exe), packages Portable.zip,
    and writes SHA-256 checksums.

.EXAMPLE
    .\build\Build-Beta.ps1
    .\build\Build-Beta.ps1 -Bump beta
    .\build\Build-Beta.ps1 -Bump patch
    .\build\Build-Beta.ps1 -SkipTests
    .\build\Build-Beta.ps1 -SkipInstaller
#>
[CmdletBinding()]
param(
    [ValidateSet("none", "beta", "patch", "minor", "major")]
    [string]$Bump = "none",
    [switch]$SkipTests,
    [switch]$SkipBuild,
    [switch]$SkipInstaller,
    [switch]$SkipZip
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$BuildDir    = $PSScriptRoot
$DistRoot    = Join-Path $ProjectRoot "dist"

# 1. Read canonical version from Cargo.toml (and optionally bump across Cargo.toml, Cargo.lock, tauri.conf.json)
$cargoPath = Join-Path $ProjectRoot "Cargo.toml"
$cargoRaw  = Get-Content -LiteralPath $cargoPath -Raw
if ($cargoRaw -notmatch '(?m)^version\s*=\s*"([^"]+)"') {
    throw "Could not parse package version from Cargo.toml."
}
$AppVersion = $Matches[1]
$verNums = ($AppVersion -replace '-.*$', '').Split('.')
$major = if ($verNums.Count -ge 1) { [int]$verNums[0] } else { 1 }
$minor = if ($verNums.Count -ge 2) { [int]$verNums[1] } else { 0 }
$patch = if ($verNums.Count -ge 3) { [int]$verNums[2] } else { 0 }
$betaNum = if ($AppVersion -match 'beta\.(\d+)') { [int]$Matches[1] } else { 0 }

if ($Bump -ne "none") {
    $oldVersion = $AppVersion
    switch ($Bump) {
        "beta" {
            if ($AppVersion -match '-beta\.(\d+)$') {
                $betaNum = [int]$Matches[1] + 1
                $AppVersion = "$major.$minor.$patch-beta.$betaNum"
            } else {
                $patch += 1; $betaNum = 1
                $AppVersion = "$major.$minor.$patch-beta.1"
            }
        }
        "patch" {
            if ($AppVersion -match '-beta\.') {
                $betaNum = 0
                $AppVersion = "$major.$minor.$patch"
            } else {
                $patch += 1; $betaNum = 0
                $AppVersion = "$major.$minor.$patch"
            }
        }
        "minor" {
            $minor += 1; $patch = 0; $betaNum = 0
            $AppVersion = "$major.$minor.0"
        }
        "major" {
            $major += 1; $minor = 0; $patch = 0; $betaNum = 0
            $AppVersion = "$major.0.0"
        }
    }
    Write-Host "Bumping version: $oldVersion -> $AppVersion" -ForegroundColor Yellow
    $cargoUpdated = [regex]::Replace($cargoRaw, '(?m)^version\s*=\s*"[^"]+"', "version = `"$AppVersion`"", 1)
    [System.IO.File]::WriteAllText($cargoPath, $cargoUpdated, [System.Text.UTF8Encoding]::new($false))

    $tauriConfPath = Join-Path $ProjectRoot "tauri.conf.json"
    if (Test-Path -LiteralPath $tauriConfPath) {
        $tauriRaw = Get-Content -LiteralPath $tauriConfPath -Raw
        $tauriUpdated = [regex]::Replace($tauriRaw, '"version"\s*:\s*"[^"]+"', "`"version`": `"$AppVersion`"", 1)
        [System.IO.File]::WriteAllText($tauriConfPath, $tauriUpdated, [System.Text.UTF8Encoding]::new($false))
    }

    $cargoLockPath = Join-Path $ProjectRoot "Cargo.lock"
    if (Test-Path -LiteralPath $cargoLockPath) {
        $lockRaw = Get-Content -LiteralPath $cargoLockPath -Raw
        $lockUpdated = [regex]::Replace(
            $lockRaw,
            '(name\s*=\s*"corewatch-rust"\r?\nversion\s*=\s*)"[^"]+"',
            "`${1}`"$AppVersion`"",
            1
        )
        [System.IO.File]::WriteAllText($cargoLockPath, $lockUpdated, [System.Text.UTF8Encoding]::new($false))
    }
}
$VersionInfo = "$major.$minor.$patch.$betaNum"

$gitBranch = "unknown"
$gitSha    = "nogit"
$gitDirty  = $false
try {
    $b = (& git -C $ProjectRoot rev-parse --abbrev-ref HEAD 2>$null)
    if ($LASTEXITCODE -eq 0 -and $b) { $gitBranch = $b.Trim() }
    $s = (& git -C $ProjectRoot rev-parse --short HEAD 2>$null)
    if ($LASTEXITCODE -eq 0 -and $s) { $gitSha = $s.Trim() }
    $st = (& git -C $ProjectRoot status --porcelain 2>$null)
    if ($LASTEXITCODE -eq 0 -and $st) { $gitDirty = $true }
} catch {}

$StageDir      = Join-Path $DistRoot "RustCoreWatch-$AppVersion"
$ZipPath       = Join-Path $DistRoot "RustCoreWatch-$AppVersion-Portable.zip"
$SetupExePath  = Join-Path $DistRoot "RustCoreWatch-$AppVersion-Setup.exe"
$ChecksumsPath = Join-Path $DistRoot "RustCoreWatch-$AppVersion-SHA256SUMS.txt"

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "  RustCoreWatch Beta Release Builder  v$AppVersion" -ForegroundColor Cyan
Write-Host "  Git: $gitBranch @ $gitSha$(if ($gitDirty) { ' (working tree changes)' } else { ' (clean)' })" -ForegroundColor DarkCyan
Write-Host "=================================================================" -ForegroundColor Cyan

# 2. Refresh crisp 8-size icons\icon.ico & generate modern Dark/Light wizard PNG artwork
Add-Type -AssemblyName System.Drawing
$SourcePng = Join-Path $ProjectRoot "ui\icon.png"
if (-not (Test-Path -LiteralPath $SourcePng)) {
    throw "Missing source icon: $SourcePng"
}

function New-WizardSideBanner {
    param(
        [string]$OutPath,
        [string]$IconPath,
        [string]$VersionText,
        [bool]$DarkMode
    )
    # 328x628 (2x crisp DPI for modern Inno Setup 6.7+)
    $w = 328; $h = 628
    $bmp = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

    try {
        $rect = New-Object System.Drawing.Rectangle(0, 0, $w, $h)
        $cTop = if ($DarkMode) { [System.Drawing.Color]::FromArgb(255, 13, 18, 30) } else { [System.Drawing.Color]::FromArgb(255, 233, 240, 250) }
        $cBot = if ($DarkMode) { [System.Drawing.Color]::FromArgb(255, 24, 35, 56) } else { [System.Drawing.Color]::FromArgb(255, 212, 226, 246) }
        $grad = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, $cTop, $cBot, 90.0)
        $g.FillRectangle($grad, $rect)
        $grad.Dispose()

        # Subtle top & right accent border
        $accentA = [System.Drawing.Color]::FromArgb(255, 56, 189, 248)
        $accentB = [System.Drawing.Color]::FromArgb(255, 59, 130, 246)
        $topBarRect = New-Object System.Drawing.Rectangle(0, 0, $w, 6)
        $topGrad = New-Object System.Drawing.Drawing2D.LinearGradientBrush($topBarRect, $accentA, $accentB, 0.0)
        $g.FillRectangle($topGrad, $topBarRect)
        $topGrad.Dispose()

        # Subtle ambient radial glow behind logo
        $gp = New-Object System.Drawing.Drawing2D.GraphicsPath
        $gp.AddEllipse(44, 52, 240, 240)
        $glow = New-Object System.Drawing.Drawing2D.PathGradientBrush($gp)
        $glow.CenterColor = if ($DarkMode) { [System.Drawing.Color]::FromArgb(72, 56, 189, 248) } else { [System.Drawing.Color]::FromArgb(55, 49, 130, 206) }
        $glow.SurroundColors = @([System.Drawing.Color]::FromArgb(0, 56, 189, 248))
        $g.FillEllipse($glow, 44, 52, 240, 240)
        $glow.Dispose()
        $gp.Dispose()

        # Draw centered app icon
        $iconImg = [System.Drawing.Image]::FromFile($IconPath)
        try {
            $g.DrawImage($iconImg, 94, 96, 140, 140)
        } finally {
            $iconImg.Dispose()
        }

        # Typography
        $fgMain  = if ($DarkMode) { [System.Drawing.Color]::FromArgb(255, 247, 250, 252) } else { [System.Drawing.Color]::FromArgb(255, 15, 23, 42) }
        $fgSub   = if ($DarkMode) { [System.Drawing.Color]::FromArgb(255, 148, 163, 184) } else { [System.Drawing.Color]::FromArgb(255, 71, 85, 105) }
        $fgPill  = if ($DarkMode) { [System.Drawing.Color]::FromArgb(255, 125, 211, 252) } else { [System.Drawing.Color]::FromArgb(255, 29, 78, 216) }
        $pillBg  = if ($DarkMode) { [System.Drawing.Color]::FromArgb(46, 56, 189, 248) } else { [System.Drawing.Color]::FromArgb(30, 37, 99, 235) }
        $pillPenColor = if ($DarkMode) { [System.Drawing.Color]::FromArgb(120, 56, 189, 248) } else { [System.Drawing.Color]::FromArgb(110, 37, 99, 235) }

        $sfCenter = New-Object System.Drawing.StringFormat
        $sfCenter.Alignment = [System.Drawing.StringAlignment]::Center

        $fTitle = New-Object System.Drawing.Font("Segoe UI", 18, [System.Drawing.FontStyle]::Bold)
        $bMain  = New-Object System.Drawing.SolidBrush($fgMain)
        $g.DrawString("RUSTCOREWATCH", $fTitle, $bMain, [System.Drawing.RectangleF]::new(12, 258, ($w - 24), 34), $sfCenter)
        $fTitle.Dispose(); $bMain.Dispose()

        # Version pill
        $pillW = $w - 152
        $pillRect = New-Object System.Drawing.Rectangle(76, 300, $pillW, 28)
        $bPillBg  = New-Object System.Drawing.SolidBrush($pillBg)
        $pPill    = New-Object System.Drawing.Pen($pillPenColor, 1.5)
        $g.FillRectangle($bPillBg, $pillRect)
        $g.DrawRectangle($pPill, $pillRect)
        $fVer = New-Object System.Drawing.Font("Segoe UI Semibold", 10, [System.Drawing.FontStyle]::Bold)
        $bPillFg = New-Object System.Drawing.SolidBrush($fgPill)
        $g.DrawString("v$VersionText", $fVer, $bPillFg, [System.Drawing.RectangleF]::new(76, 304, $pillW, 22), $sfCenter)
        $bPillBg.Dispose(); $pPill.Dispose(); $fVer.Dispose(); $bPillFg.Dispose()

        # Feature bullets
        $fFeat = New-Object System.Drawing.Font("Segoe UI", 10, [System.Drawing.FontStyle]::Regular)
        $bSub  = New-Object System.Drawing.SolidBrush($fgSub)
        $feats = @(
            "Native Rust + Win32 Telemetry",
            "25 Modular Tabs & Suites",
            "Thermal Lab & Fan Health Engine",
            "Standalone Native RGB Engine",
            "Zero Background Console Window"
        )
        $y = 376
        foreach ($line in $feats) {
            $g.DrawString($line, $fFeat, $bSub, [System.Drawing.RectangleF]::new(18, $y, ($w - 36), 24), $sfCenter)
            $y += 30
        }
        $fFeat.Dispose()

        # Footer note
        $fFoot = New-Object System.Drawing.Font("Segoe UI", 8.5, [System.Drawing.FontStyle]::Regular)
        $g.DrawString("Windows 10 / 11 (x64)", $fFoot, $bSub, [System.Drawing.RectangleF]::new(12, ($h - 42), ($w - 24), 22), $sfCenter)
        $fFoot.Dispose(); $bSub.Dispose(); $sfCenter.Dispose()

        $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
        $g.Dispose()
        $bmp.Dispose()
    }
}

function New-WizardSmallIcon {
    param([string]$OutPath, [string]$IconPath, [bool]$DarkMode)
    $sz = 110
    $bmp = New-Object System.Drawing.Bitmap($sz, $sz, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    try {
        $bg = if ($DarkMode) { [System.Drawing.Color]::FromArgb(255, 20, 25, 35) } else { [System.Drawing.Color]::FromArgb(255, 244, 247, 251) }
        $g.Clear($bg)
        $iconImg = [System.Drawing.Image]::FromFile($IconPath)
        try {
            $inner = $sz - 18
            $g.DrawImage($iconImg, 9, 9, $inner, $inner)
        } finally {
            $iconImg.Dispose()
        }
        $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
        $g.Dispose()
        $bmp.Dispose()
    }
}

Write-Host "[1/6] Rendering high-DPI Dark & Light installer artwork..." -ForegroundColor Gray
New-WizardSideBanner -OutPath (Join-Path $BuildDir "wizard-side-dark.png")    -IconPath $SourcePng -VersionText $AppVersion -DarkMode $true
New-WizardSideBanner -OutPath (Join-Path $BuildDir "wizard-side-light.png")   -IconPath $SourcePng -VersionText $AppVersion -DarkMode $false
New-WizardSmallIcon  -OutPath (Join-Path $BuildDir "wizard-header-dark.png")  -IconPath $SourcePng -DarkMode $true
New-WizardSmallIcon  -OutPath (Join-Path $BuildDir "wizard-header-light.png") -IconPath $SourcePng -DarkMode $false

# 3. Verify Clippy & Unit Tests
Push-Location $ProjectRoot
try {
    if (-not $SkipTests) {
        Write-Host "[2/6] Running cargo clippy & cargo test (--locked)..." -ForegroundColor Gray
        & cargo clippy --all-targets --locked -- -D warnings
        if ($LASTEXITCODE -ne 0) { throw "cargo clippy failed with exit code $LASTEXITCODE" }
        & cargo test --locked
        if ($LASTEXITCODE -ne 0) { throw "cargo test failed with exit code $LASTEXITCODE" }
    } else {
        Write-Host "[2/6] Skipping clippy & unit tests (-SkipTests)." -ForegroundColor Yellow
    }

    # 4. Build optimized Release binary
    if (-not $SkipBuild) {
        Write-Host "[3/6] Building optimized Release binary (cargo build --locked --release)..." -ForegroundColor Gray
        & cargo build --locked --release
        if ($LASTEXITCODE -ne 0) { throw "cargo build --release failed with exit code $LASTEXITCODE" }
    } else {
        Write-Host "[3/6] Skipping cargo build --release (-SkipBuild)." -ForegroundColor Yellow
    }
} finally {
    Pop-Location
}

$ReleaseExe = Join-Path $ProjectRoot "target\release\RustCoreWatch.exe"
if (-not (Test-Path -LiteralPath $ReleaseExe)) {
    throw "Release binary not found at $ReleaseExe"
}

# Stage sensor helper beside release binary if available
$PrepareSensors = Join-Path $ProjectRoot "prepare-sensors.ps1"
if (Test-Path -LiteralPath $PrepareSensors) {
    try {
        & $PrepareSensors -Release | Out-Null
    } catch {
        Write-Warning "Sensor helper staging skipped: $_"
    }
}

# 5. Stage Clean Release Directory
Write-Host "[4/6] Staging release directory: $StageDir" -ForegroundColor Gray
if (Test-Path -LiteralPath $StageDir) {
    Remove-Item -LiteralPath $StageDir -Recurse -Force
}
$null = New-Item -ItemType Directory -Path $StageDir -Force
Copy-Item -LiteralPath $ReleaseExe -Destination (Join-Path $StageDir "RustCoreWatch.exe") -Force

$SensorSrc = Join-Path $ProjectRoot "target\release\sensors"
$HasSensors = $false
if (Test-Path -LiteralPath (Join-Path $SensorSrc "CoreWatchSensorHelper.exe")) {
    Copy-Item -LiteralPath $SensorSrc -Destination (Join-Path $StageDir "sensors") -Recurse -Force
    $HasSensors = $true
}

$buildInfo = [ordered]@{
    product     = "RustCoreWatch"
    version     = $AppVersion
    gitBranch   = $gitBranch
    gitSha      = $gitSha
    gitDirty    = $gitDirty
    builtUtc    = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    sensors     = $HasSensors
    arch        = "x64"
}
($buildInfo | ConvertTo-Json -Depth 3) + "`n" | Set-Content -LiteralPath (Join-Path $StageDir "build-info.json") -Encoding UTF8

$readmeTxt = @"
RustCoreWatch v$AppVersion (Windows x64)
============================================================
Native Rust + Win32 + WebView2 System Telemetry, Hardware RGB,
Diagnostics, Operations & Developer Workbench.

Quick Tips:
- On first launch, the in-app Setup Wizard lets you configure theme,
  dashboard layout, telemetry, Admin/User launch mode, and visible tabs.
- Press Ctrl+K for the Quick Command Palette (50+ actions).
- Press Ctrl+, for Settings (Launch Privilege Mode, General, Low-Memory Mode,
  Font Size, Directories, Telemetry, and Modules & Tabs).
- To enable CPU die temperatures and SMBus DRAM RGB control, install
  the signed PawnIO driver (winget install namazso.PawnIO) and choose
  Administrator mode in Setup or Settings -> General.

Project & Releases:
https://github.com/jonathan820612/CoreWatch-Host-Engine
"@
$readmeTxt | Set-Content -LiteralPath (Join-Path $StageDir "README.txt") -Encoding UTF8

# 6. Package Portable ZIP & Compile Modern Modular Installer (Inno Setup 6.7+)
$artifacts = New-Object System.Collections.Generic.List[string]

if (-not $SkipZip) {
    Write-Host "[5/6] Packaging Portable ZIP: $ZipPath" -ForegroundColor Gray
    if (Test-Path -LiteralPath $ZipPath) { Remove-Item -LiteralPath $ZipPath -Force }
    Compress-Archive -Path (Join-Path $StageDir "*") -DestinationPath $ZipPath -CompressionLevel Optimal -Force
    $artifacts.Add($ZipPath)
}

if (-not $SkipInstaller) {
    $iscc = @(
        "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
        "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
        "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
    ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

    if (-not $iscc) {
        throw "Inno Setup 6 (ISCC.exe) was not found. Install Inno Setup 6.7+ or pass -SkipInstaller."
    }

    Write-Host "[6/6] Compiling modular installer via Inno Setup ($iscc)..." -ForegroundColor Gray
    $issPath = Join-Path $BuildDir "RustCoreWatch.iss"
    & $iscc "/DMyAppVersion=$AppVersion" "/DMyVersionInfo=$VersionInfo" "/DStageDir=$StageDir" $issPath
    if ($LASTEXITCODE -ne 0) {
        throw "ISCC.exe failed with exit code $LASTEXITCODE"
    }
    if (-not (Test-Path -LiteralPath $SetupExePath)) {
        throw "Expected installer not found at $SetupExePath"
    }
    $artifacts.Add($SetupExePath)
}

# 7. Write SHA-256 Checksums
$sumLines = New-Object System.Collections.Generic.List[string]
foreach ($file in $artifacts) {
    $hash = (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
    $name = Split-Path -Leaf $file
    $sumLines.Add("$hash  $name")
}
if ($sumLines.Count -gt 0) {
    $sumLines | Set-Content -LiteralPath $ChecksumsPath -Encoding ASCII
}

Write-Host "`n=================================================================" -ForegroundColor Green
Write-Host "  RustCoreWatch v$AppVersion Beta Build Complete!" -ForegroundColor Green
foreach ($file in $artifacts) {
    $item = Get-Item -LiteralPath $file
    $mb = [math]::Round($item.Length / 1MB, 2)
    Write-Host ("  - {0} ({1} MB)" -f $item.Name, $mb) -ForegroundColor White
}
if (Test-Path -LiteralPath $ChecksumsPath) {
    Write-Host ("  - {0}" -f (Split-Path -Leaf $ChecksumsPath)) -ForegroundColor Gray
}
Write-Host "=================================================================" -ForegroundColor Green
