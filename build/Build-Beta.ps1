<#
.SYNOPSIS
    Source-controlled, auto-versioned Beta build pipeline for CoreWatch.
    Reads & bumps version.json, stamps Git branch/commit SHA into EXEs & build-info.json,
    compiles CoreWatch.exe + CoreWatchSensorHelper.exe (LibreHardwareMonitor .NET 4.x bridge),
    stages a clean release folder, packages a Portable ZIP, and optionally creates an Inno Setup installer & Git tag.

.EXAMPLE
    .\build\Build-Beta.ps1
    .\build\Build-Beta.ps1 -Bump patch -RequireAdmin
    .\build\Build-Beta.ps1 -Bump build -GitCommit -GitTag
    .\build\Build-Beta.ps1 -RequireAdmin -PublishGitHub
    .\build\Publish-Release.ps1 -ReleaseTitle "Test Beta 12"
#>
[CmdletBinding()]
param(
    [ValidateSet("build", "patch", "minor", "major", "none")]
    [string]$Bump = "build",
    [string]$Prerelease = $null,
    [switch]$RequireAdmin,
    [switch]$IncludeFixedRuntime,
    [switch]$SkipZip,
    [switch]$GitCommit,
    [switch]$GitTag,
    [switch]$GitPush,
    [switch]$PublishGitHub,
    [switch]$Draft,
    [string]$ReleaseTitle = ""
)

if ($PublishGitHub) {
    $GitCommit = $true
    $GitTag    = $true
    $GitPush   = $true
}

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$BuildDir    = $PSScriptRoot
$DistRoot    = Join-Path $ProjectRoot "dist"
$VersionFile = Join-Path $ProjectRoot "version.json"

# 1. Capture Git Source-Control Metadata BEFORE mutating version.json so clean releases are never stamped .dirty
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

# 2. Load & Increment Single-Digit Rollover Version from version.json (0-9 per segment; avoids confusing .10)
if (Test-Path -LiteralPath $VersionFile) {
    $verObj = Get-Content -LiteralPath $VersionFile -Raw | ConvertFrom-Json
} else {
    $verObj = [PSCustomObject]@{ major = 0; minor = 9; patch = 0; prerelease = "beta"; build = 0; buildNumber = 0 }
}

$major       = [int]$verObj.major
$minor       = [int]$verObj.minor
$patch       = [int]$verObj.patch
$build       = [int]$verObj.build
$buildNumber = if ($null -ne $verObj.buildNumber) { [int]$verObj.buildNumber } else { ($patch * 10) + $build }
$pre         = if ($PSBoundParameters.ContainsKey("Prerelease")) { $Prerelease } else { [string]$verObj.prerelease }

# Normalize any legacy >= 10 segment before bumping
while ($build -ge 10) { $build -= 10; $patch++ }
while ($patch -ge 10) { $patch -= 10; $minor++ }
while ($minor -ge 10) { $minor -= 10; $major++ }

switch ($Bump) {
    "major" { $major++; $minor = 0; $patch = 0; $build = 0; $buildNumber++ }
    "minor" {
        $minor++; $patch = 0; $build = 0; $buildNumber++
        if ($minor -ge 10) { $major++; $minor = 0 }
    }
    "patch" {
        $patch++; $build = 0; $buildNumber++
        if ($patch -ge 10) { $minor++; $patch = 0 }
        if ($minor -ge 10) { $major++; $minor = 0 }
    }
    "build" {
        $build++; $buildNumber++
        if ($build -ge 10) { $patch++; $build = 0 }
        if ($patch -ge 10) { $minor++; $patch = 0 }
        if ($minor -ge 10) { $major++; $minor = 0 }
    }
    "none"  { }
}

$updatedVerObj = [ordered]@{
    major       = $major
    minor       = $minor
    patch       = $patch
    prerelease  = $pre
    build       = $build
    buildNumber = $buildNumber
}
if ($Bump -ne "none" -or -not (Test-Path -LiteralPath $VersionFile)) {
    ($updatedVerObj | ConvertTo-Json -Depth 2) + "`n" | Set-Content -LiteralPath $VersionFile -Encoding UTF8
}

# Clean human-readable version: e.g., 0.9.1-beta (Beta #10), 0.9.1-beta.1 (Beta #11) .. 0.9.1-beta.9 (#19), 0.9.2-beta (#20)
$SemVer = if ($pre) {
    if ($build -eq 0) { "$major.$minor.$patch-$pre" } else { "$major.$minor.$patch-$pre.$build" }
} else {
    if ($build -eq 0) { "$major.$minor.$patch" } else { "$major.$minor.$patch.$build" }
}
$AssemblyVer = "$major.$minor.$patch.$build"
$BuildLabel  = if ($pre) { "$($pre.Substring(0,1).ToUpper())$($pre.Substring(1)) #$buildNumber" } else { "Build #$buildNumber" }

$InfoVersion = "$SemVer+$gitSha$(if ($gitDirty) { '.dirty' })"
$BuiltUtc    = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

$StageDir = Join-Path $DistRoot "CoreWatch-$SemVer"
$ZipPath  = Join-Path $DistRoot "CoreWatch-$SemVer-Portable.zip"

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "  CoreWatch Source-Controlled Build  v$SemVer ($BuildLabel)" -ForegroundColor Cyan
Write-Host "  Git: $gitBranch @ $gitSha$(if ($gitDirty) { ' (uncommitted changes)' } else { ' (clean)' })" -ForegroundColor DarkCyan
Write-Host "=================================================================" -ForegroundColor Cyan

# 3. Locate Windows built-in .NET Framework 4.x C# Compiler (csc.exe)
$CscPath = @(
    "$env:SystemRoot\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
    "$env:SystemRoot\Microsoft.NET\Framework\v4.0.30319\csc.exe"
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

if (-not $CscPath) {
    throw "Could not find Windows C# compiler (csc.exe) under .NET Framework 4.x."
}
Write-Host "[1/7] Compiler: $CscPath" -ForegroundColor Gray

# 4. Convert images\Icon.png -> multi-resolution PNG-in-ICO (build\CoreWatch.ico)
Add-Type -AssemblyName System.Drawing
$SourcePng = Join-Path $ProjectRoot "images\Icon.png"
$OutIco    = Join-Path $BuildDir "CoreWatch.ico"

if (Test-Path -LiteralPath $SourcePng) {
    Write-Host "[2/7] Generating multi-res CoreWatch.ico..." -ForegroundColor Gray
    $sizes = @(16, 32, 48, 64, 128, 256)
    $srcImg = [System.Drawing.Image]::FromFile($SourcePng)
    $pngBlobs = New-Object System.Collections.Generic.List[byte[]]

    try {
        foreach ($sz in $sizes) {
            $bmp = New-Object System.Drawing.Bitmap($sz, $sz)
            $g = [System.Drawing.Graphics]::FromImage($bmp)
            $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
            $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
            $g.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
            $g.Clear([System.Drawing.Color]::Transparent)
            $g.DrawImage($srcImg, 0, 0, $sz, $sz)
            $g.Dispose()

            $ms = New-Object System.IO.MemoryStream
            $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
            $pngBlobs.Add($ms.ToArray())
            $ms.Dispose()
            $bmp.Dispose()
        }
    } finally {
        $srcImg.Dispose()
    }

    $fs = [System.IO.File]::Create($OutIco)
    $bw = New-Object System.IO.BinaryWriter($fs)
    try {
        $bw.Write([uint16]0)
        $bw.Write([uint16]1)
        $bw.Write([uint16]$sizes.Count)

        $offset = 6 + (16 * $sizes.Count)
        for ($i = 0; $i -lt $sizes.Count; $i++) {
            $sz = $sizes[$i]
            $blob = $pngBlobs[$i]
            $bw.Write([byte]$(if ($sz -ge 256) { 0 } else { $sz }))
            $bw.Write([byte]$(if ($sz -ge 256) { 0 } else { $sz }))
            $bw.Write([byte]0)
            $bw.Write([byte]0)
            $bw.Write([uint16]1)
            $bw.Write([uint16]32)
            $bw.Write([uint32]$blob.Length)
            $bw.Write([uint32]$offset)
            $offset += $blob.Length
        }
        foreach ($blob in $pngBlobs) {
            $bw.Write($blob)
        }
    } finally {
        $bw.Dispose()
        $fs.Dispose()
    }
} else {
    Write-Warning "images\Icon.png not found; compiling without custom icon."
    $OutIco = $null
}

# 5. Generate Application Manifest (PerMonitorV2 DPI + Execution Level)
$ExecLevel = if ($RequireAdmin) { "requireAdministrator" } else { "asInvoker" }
$ManifestPath = Join-Path $BuildDir "CoreWatch.manifest"
$ManifestXml = @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <assemblyIdentity version="$AssemblyVer" processorArchitecture="*" name="CoreWatch.HostEngine" type="win32"/>
  <description>CoreWatch Host Engine System Dashboard &amp; Diagnostics</description>
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security>
      <requestedPrivileges>
        <requestedExecutionLevel level="$ExecLevel" uiAccess="false"/>
      </requestedPrivileges>
    </security>
  </trustInfo>
  <application xmlns="urn:schemas-microsoft-com:asm.v3">
    <windowsSettings>
      <dpiAwareness xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">PerMonitorV2, PerMonitor</dpiAwareness>
      <dpiAware xmlns="http://schemas.microsoft.com/SMI/2005/WindowsSettings">true/pm</dpiAware>
    </windowsSettings>
  </application>
</assembly>
"@
[System.IO.File]::WriteAllText($ManifestPath, $ManifestXml, [System.Text.Encoding]::UTF8)

# 6. Prepare Clean Staging Directory
Write-Host "[3/7] Staging clean release directory: $StageDir" -ForegroundColor Gray
if (Test-Path -LiteralPath $StageDir) {
    Remove-Item -LiteralPath $StageDir -Recurse -Force
}
$null = New-Item -ItemType Directory -Path $StageDir -Force
$null = New-Item -ItemType Directory -Path (Join-Path $StageDir "bin") -Force
$null = New-Item -ItemType Directory -Path (Join-Path $StageDir "images") -Force
$null = New-Item -ItemType Directory -Path (Join-Path $StageDir "modules") -Force

Copy-Item -LiteralPath (Join-Path $ProjectRoot "Start-NodeWatch.ps1") -Destination $StageDir -Force
Copy-Item -LiteralPath $VersionFile -Destination $StageDir -Force
if (Test-Path -LiteralPath $SourcePng) {
    Copy-Item -LiteralPath $SourcePng -Destination (Join-Path $StageDir "images\Icon.png") -Force
}
foreach ($sub in @("core", "layouts", "tabs", "telemetry")) {
    $srcSub = Join-Path $ProjectRoot "modules\$sub"
    if (Test-Path -LiteralPath $srcSub) {
        Copy-Item -LiteralPath $srcSub -Destination (Join-Path $StageDir "modules\$sub") -Recurse -Force
    }
}
$CatalogSrc = Join-Path $ProjectRoot "modules\modules-catalog.json"
if (Test-Path -LiteralPath $CatalogSrc -PathType Leaf) {
    Copy-Item -LiteralPath $CatalogSrc -Destination (Join-Path $StageDir "modules\modules-catalog.json") -Force
}

# Copy required WebView2 + LibreHardwareMonitor companion DLLs (omit WebView2UserData & optionally WebView2FixedRuntime)
Get-ChildItem -LiteralPath (Join-Path $ProjectRoot "bin") -Filter "*.dll" -File -ErrorAction SilentlyContinue | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $StageDir "bin\$($_.Name)") -Force
}
if ($IncludeFixedRuntime) {
    $fixedSrc = Join-Path $ProjectRoot "bin\WebView2FixedRuntime"
    if (Test-Path -LiteralPath $fixedSrc) {
        Write-Host "      Bundling WebView2FixedRuntime (offline mode)..." -ForegroundColor Yellow
        Copy-Item -LiteralPath $fixedSrc -Destination (Join-Path $StageDir "bin\WebView2FixedRuntime") -Recurse -Force
    }
}

# 7. Compile CoreWatchSensorHelper.exe (.NET 4.x bridge for LibreHardwareMonitorLib.dll)
$LhmDllPath  = Join-Path $ProjectRoot "bin\LibreHardwareMonitorLib.dll"
$SensorCs    = Join-Path $BuildDir "CoreWatchSensorHelper.cs"
$DevHelper   = Join-Path $ProjectRoot "bin\CoreWatchSensorHelper.exe"
$StageHelper = Join-Path $StageDir "bin\CoreWatchSensorHelper.exe"
$SensorBuilt = $false

if ((Test-Path -LiteralPath $LhmDllPath) -and (Test-Path -LiteralPath $SensorCs)) {
    Write-Host "[4/7] Compiling CoreWatchSensorHelper.exe (LibreHardwareMonitor bridge)..." -ForegroundColor Gray
    $sensorAsmTmp = Join-Path $BuildDir "SensorAssemblyInfo.generated.cs"
    $sensorAsmCode = @"
using System.Reflection;
[assembly: AssemblyTitle("CoreWatch Hardware Sensor Bridge")]
[assembly: AssemblyProduct("CoreWatch")]
[assembly: AssemblyVersion("$AssemblyVer")]
[assembly: AssemblyFileVersion("$AssemblyVer")]
[assembly: AssemblyInformationalVersion("$InfoVersion")]
"@
    [System.IO.File]::WriteAllText($sensorAsmTmp, $sensorAsmCode, [System.Text.Encoding]::UTF8)

    $sensorArgs = @(
        "/nologo",
        "/target:exe",
        "/optimize+",
        "/platform:x64",
        "/out:$StageHelper",
        "/reference:$LhmDllPath",
        $SensorCs,
        $sensorAsmTmp
    )
    $sOut = & $CscPath $sensorArgs 2>&1
    Remove-Item -LiteralPath $sensorAsmTmp -Force -ErrorAction SilentlyContinue
    if ($LASTEXITCODE -ne 0) {
        throw "CoreWatchSensorHelper.exe compilation failed:`n$($sOut -join "`n")"
    }
    # Emit .NET 4.7.2 runtime & binding redirect config beside CoreWatchSensorHelper.exe
    $sensorConfigXml = @"
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <startup>
    <supportedRuntime version="v4.0" sku=".NETFramework,Version=v4.7.2" />
  </startup>
  <runtime>
    <assemblyBinding xmlns="urn:schemas-microsoft-com:asm.v1">
      <dependentAssembly>
        <assemblyIdentity name="System.Resources.Extensions" publicKeyToken="cc7b13ffcd2ddd51" culture="neutral" />
        <bindingRedirect oldVersion="0.0.0.0-10.0.0.3" newVersion="10.0.0.3" />
      </dependentAssembly>
    </assemblyBinding>
  </runtime>
</configuration>
"@
    [System.IO.File]::WriteAllText("$StageHelper.config", $sensorConfigXml, [System.Text.Encoding]::UTF8)

    # Also place a copy in local bin\ so VS Code / Start-NodeWatch.ps1 dev mode gets live Ryzen/Intel temps immediately
    try {
        Copy-Item -LiteralPath $StageHelper -Destination $DevHelper -Force -ErrorAction Stop
        Copy-Item -LiteralPath "$StageHelper.config" -Destination "$DevHelper.config" -Force -ErrorAction Stop
    } catch {
        Write-Host "      Note: Local dev bin\CoreWatchSensorHelper.exe is currently in use (staged release copy is up to date)." -ForegroundColor Yellow
    }
    $SensorBuilt = $true
} else {
    Write-Host "[4/7] Skipping CoreWatchSensorHelper.exe (bin\LibreHardwareMonitorLib.dll not present)" -ForegroundColor Yellow
}

# 8. Compile Native Windows Launcher CoreWatch.exe
Write-Host "[5/7] Compiling CoreWatch.exe (v$SemVer, ExecutionLevel=$ExecLevel)..." -ForegroundColor Gray
$ExeOut     = Join-Path $StageDir "CoreWatch.exe"
$LauncherCs = Join-Path $BuildDir "CoreWatchLauncher.cs"
$AsmInfoTmp = Join-Path $BuildDir "AssemblyInfo.generated.cs"

$AsmInfoCode = @"
using System.Reflection;
[assembly: AssemblyTitle("CoreWatch Host Engine")]
[assembly: AssemblyDescription("CoreWatch System Telemetry, Management & UltimaDiagX Suite")]
[assembly: AssemblyProduct("CoreWatch")]
[assembly: AssemblyVersion("$AssemblyVer")]
[assembly: AssemblyFileVersion("$AssemblyVer")]
[assembly: AssemblyInformationalVersion("$InfoVersion")]
"@
[System.IO.File]::WriteAllText($AsmInfoTmp, $AsmInfoCode, [System.Text.Encoding]::UTF8)

$cscArgs = @(
    "/nologo",
    "/target:winexe",
    "/optimize+",
    "/platform:x64",
    "/out:$ExeOut",
    "/win32manifest:$ManifestPath",
    "/reference:System.Windows.Forms.dll",
    "/reference:System.Drawing.dll"
)
if ($OutIco -and (Test-Path -LiteralPath $OutIco)) {
    $cscArgs += "/win32icon:$OutIco"
}
$cscArgs += $LauncherCs
$cscArgs += $AsmInfoTmp

$cscOutput = & $CscPath $cscArgs 2>&1
Remove-Item -LiteralPath $AsmInfoTmp -Force -ErrorAction SilentlyContinue
if ($LASTEXITCODE -ne 0) {
    throw "CoreWatch.exe compilation failed:`n$($cscOutput -join "`n")"
}

# Write build-info.json provenance manifest inside the release folder
$buildInfo = [ordered]@{
    product        = "CoreWatch"
    version        = $SemVer
    buildLabel     = $BuildLabel
    buildNumber    = $buildNumber
    assemblyVer    = $AssemblyVer
    infoVersion    = $InfoVersion
    gitBranch      = $gitBranch
    gitCommit      = $gitSha
    gitDirty       = $gitDirty
    executionLevel = $ExecLevel
    sensorBridge   = $SensorBuilt
    fixedRuntime   = [bool]$IncludeFixedRuntime
    builtUtc       = $BuiltUtc
}
($buildInfo | ConvertTo-Json -Depth 3) + "`n" | Set-Content -LiteralPath (Join-Path $StageDir "build-info.json") -Encoding UTF8

# Append entry to build\BUILD-HISTORY.md
$HistoryPath = Join-Path $BuildDir "BUILD-HISTORY.md"
if (-not (Test-Path -LiteralPath $HistoryPath)) {
    "# CoreWatch Build History`n`n| Version | Assembly | Git Branch | Commit | Built (UTC) | Admin | LHM Bridge |`n|---|---|---|---|---|---|---|" | Set-Content -LiteralPath $HistoryPath -Encoding UTF8
}
$histLine = "| v$SemVer (#$buildNumber) | $AssemblyVer | $gitBranch | ``$gitSha``$(if ($gitDirty) { '*' }) | $BuiltUtc | $ExecLevel | $(if ($SensorBuilt) { 'Yes' } else { 'No' }) |"
Add-Content -LiteralPath $HistoryPath -Value $histLine -Encoding UTF8

# 9. Package Portable ZIP + Generate Inno Setup Installer Script
if (-not $SkipZip) {
    Write-Host "[6/7] Packaging Portable ZIP: $ZipPath" -ForegroundColor Gray
    if (Test-Path -LiteralPath $ZipPath) { Remove-Item -LiteralPath $ZipPath -Force }
    Compress-Archive -Path "$StageDir\*" -DestinationPath $ZipPath -CompressionLevel Optimal
}

$PawnIoSetupSrc = Join-Path $BuildDir "redist\PawnIO_setup.exe"
$HasPawnIoRedist = Test-Path -LiteralPath $PawnIoSetupSrc -PathType Leaf
$PawnIoFilesLine = if ($HasPawnIoRedist) {
    'Source: "redist\PawnIO_setup.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall; Tasks: installpawnio'
} else { "" }
$PawnIoRunLine = if ($HasPawnIoRedist) {
    'Filename: "{tmp}\PawnIO_setup.exe"; Parameters: "-install -silent"; StatusMsg: "Installing Microsoft-signed PawnIO sensor driver..."; Flags: waituntilterminated runhidden; Tasks: installpawnio; Check: not IsPawnIoInstalled'
} else {
    'Filename: "winget.exe"; Parameters: "install --id namazso.PawnIO --source winget --accept-package-agreements --accept-source-agreements"; StatusMsg: "Installing PawnIO sensor driver via winget..."; Flags: waituntilterminated; Tasks: installpawnio; Check: not IsPawnIoInstalled'
}

# Build dynamic Inno Setup [Types], [Components], per-module [Files], and installed-modules.json writer
$CatalogObj = $null
if (Test-Path -LiteralPath $CatalogSrc -PathType Leaf) {
    $CatalogObj = Get-Content -LiteralPath $CatalogSrc -Raw | ConvertFrom-Json
}
$CatalogModules = if ($CatalogObj -and $CatalogObj.modules) { @($CatalogObj.modules) } else { @() }

$IssComponentsSb = New-Object System.Text.StringBuilder
[void]$IssComponentsSb.AppendLine('Name: "core"; Description: "CoreWatch Dashboard & Telemetry Engine (Required)"; Types: full essentials itpro developer custom; Flags: fixed')
[void]$IssComponentsSb.AppendLine('Name: "tabs"; Description: "Feature Tabs & Optional Modules"; Types: full essentials itpro developer')

$IssModuleFilesSb = New-Object System.Text.StringBuilder
$IssCodeChecksSb  = New-Object System.Text.StringBuilder

foreach ($mod in $CatalogModules) {
    $mId    = [string]$mod.id
    $mName  = ([string]$mod.name).Replace('"', '""')
    $mTypes = if ($mod.installerTypes -and $mod.installerTypes.Count -gt 0) { ($mod.installerTypes -join ' ') } else { 'full' }
    [void]$IssComponentsSb.AppendLine("Name: `"tabs\$mId`"; Description: `"$mName`"; Types: $mTypes")

    foreach ($relPath in @($mod.files)) {
        $relWin = ([string]$relPath) -replace '/', '\'
        $relDir = Split-Path -Path $relWin -Parent
        $destDir = if ($relDir) { "{app}\$relDir" } else { "{app}" }
        [void]$IssModuleFilesSb.AppendLine("Source: `"..\dist\CoreWatch-{#MyAppVersion}\$relWin`"; DestDir: `"$destDir`"; Flags: ignoreversion; Components: tabs\$mId")
    }

    [void]$IssCodeChecksSb.AppendLine("    if WizardIsComponentSelected('tabs\$mId') then begin")
    [void]$IssCodeChecksSb.AppendLine("      if NotFirst then ModList := ModList + ',';")
    [void]$IssCodeChecksSb.AppendLine("      ModList := ModList + '`"$mId`"';")
    [void]$IssCodeChecksSb.AppendLine("      NotFirst := True;")
    [void]$IssCodeChecksSb.AppendLine("    end else begin")
    foreach ($relPath in @($mod.files)) {
        $relWin = (([string]$relPath) -replace '/', '\').Replace("'", "''")
        [void]$IssCodeChecksSb.AppendLine("      DeleteFile(ExpandConstant('{app}\$relWin'));")
    }
    [void]$IssCodeChecksSb.AppendLine("    end;")
}

$IssComponentsBlock  = $IssComponentsSb.ToString().TrimEnd()
$IssModuleFilesBlock = $IssModuleFilesSb.ToString().TrimEnd()
$IssCodeChecksBlock  = $IssCodeChecksSb.ToString().TrimEnd()

$IssPath = Join-Path $BuildDir "CoreWatch.iss"
$IssContent = @"
; CoreWatch Modular Installer Script for Inno Setup (https://jrsoftware.org/isinfo.php)
#define MyAppName "CoreWatch"
#define MyAppVersion "$SemVer"
#define MyAppExeName "CoreWatch.exe"

[Setup]
AppId={{7E84C29A-6C15-4D63-9F42-8E112D4B01A5}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=..\dist
OutputBaseFilename=CoreWatch-{#MyAppVersion}-Setup
SetupIconFile=CoreWatch.ico
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=$(if ($RequireAdmin) { "admin" } else { "lowest" })

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Types]
Name: "full"; Description: "Full Installation — All Tabs & Modules (Recommended)"
Name: "essentials"; Description: "Home & Essentials (Dashboard, Tasks, DiagX, Security, Apps, Disk Map, Organizer)"
Name: "itpro"; Description: "IT & SysAdmin Suite (Dashboard, Network, Tasks, DiagX, Security, Sharing, Devices, Apps)"
Name: "developer"; Description: "Developer Workstation (Dashboard, Network, Tasks, DiagX, WSL, Apps, Disk Map)"
Name: "custom"; Description: "Custom — Pick & Choose Individual Tabs"; Flags: iscustom

[Components]
$IssComponentsBlock

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"
Name: "installpawnio"; Description: "Install PawnIO signed kernel driver (required by LibreHardwareMonitor for live CPU temps)"; GroupDescription: "Hardware Sensors:"; Check: not IsPawnIoInstalled

[Files]
; Core Engine & Required Runtime Files
Source: "..\dist\CoreWatch-{#MyAppVersion}\CoreWatch.exe"; DestDir: "{app}"; Flags: ignoreversion; Components: core
Source: "..\dist\CoreWatch-{#MyAppVersion}\Start-NodeWatch.ps1"; DestDir: "{app}"; Flags: ignoreversion; Components: core
Source: "..\dist\CoreWatch-{#MyAppVersion}\version.json"; DestDir: "{app}"; Flags: ignoreversion; Components: core
Source: "..\dist\CoreWatch-{#MyAppVersion}\build-info.json"; DestDir: "{app}"; Flags: ignoreversion; Components: core
Source: "..\dist\CoreWatch-{#MyAppVersion}\bin\*"; DestDir: "{app}\bin"; Flags: ignoreversion recursesubdirs createallsubdirs; Components: core
Source: "..\dist\CoreWatch-{#MyAppVersion}\images\*"; DestDir: "{app}\images"; Flags: ignoreversion recursesubdirs createallsubdirs; Components: core
Source: "..\dist\CoreWatch-{#MyAppVersion}\modules\core\*"; DestDir: "{app}\modules\core"; Flags: ignoreversion recursesubdirs createallsubdirs; Components: core
Source: "..\dist\CoreWatch-{#MyAppVersion}\modules\layouts\*"; DestDir: "{app}\modules\layouts"; Flags: ignoreversion recursesubdirs createallsubdirs; Components: core
Source: "..\dist\CoreWatch-{#MyAppVersion}\modules\telemetry\*"; DestDir: "{app}\modules\telemetry"; Flags: ignoreversion recursesubdirs createallsubdirs; Components: core
Source: "..\dist\CoreWatch-{#MyAppVersion}\modules\modules-catalog.json"; DestDir: "{app}\modules"; Flags: ignoreversion; Components: core
; Optional Pick-and-Choose Feature Modules
$IssModuleFilesBlock
$PawnIoFilesLine

[UninstallDelete]
Type: files; Name: "{app}\installed-modules.json"

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
$PawnIoRunLine
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent

[Code]
function IsPawnIoInstalled(): Boolean;
begin
  Result := DirExists(ExpandConstant('{commonpf}\PawnIO')) or
            RegKeyExists(HKLM, 'SYSTEM\CurrentControlSet\Services\PawnIO');
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ModList: String;
  JsonText: String;
  SetupType: String;
  NotFirst: Boolean;
begin
  if CurStep = ssPostInstall then begin
    ModList := '';
    NotFirst := False;
$IssCodeChecksBlock
    SetupType := WizardSetupType(False);
    if SetupType = '' then SetupType := 'full';
    JsonText := '{' + #13#10 +
      '  "schemaVersion": 1,' + #13#10 +
      '  "installType": "' + SetupType + '",' + #13#10 +
      '  "installedModules": [' + ModList + ']' + #13#10 +
      '}' + #13#10;
    SaveStringToFile(ExpandConstant('{app}\installed-modules.json'), JsonText, False);
  end;
end;
"@
[System.IO.File]::WriteAllText($IssPath, $IssContent, [System.Text.Encoding]::UTF8)

$Iscc = @(
    (Get-Command "ISCC.exe" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source),
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "$env:ProgramFiles\Inno Setup 6\ISCC.exe",
    "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1

$SetupExePath = Join-Path $DistRoot "CoreWatch-$SemVer-Setup.exe"
if ($Iscc) {
    Write-Host "[7/7] Inno Setup detected ($Iscc)! Building Setup.exe..." -ForegroundColor Green
    & $Iscc $IssPath
    if ($LASTEXITCODE -ne 0) { throw "Inno Setup (ISCC.exe) failed with exit code $LASTEXITCODE." }
} else {
    Write-Host "[7/7] Inno Setup script ready: $IssPath" -ForegroundColor Yellow
}

# 10. Generate SHA256SUMS.txt & Categorized Release Notes (Commits Since Previous Tag)
$ChecksumPath     = Join-Path $DistRoot "CoreWatch-$SemVer-SHA256SUMS.txt"
$ReleaseNotesPath = Join-Path $StageDir "RELEASE-NOTES.md"
$AssetPaths       = New-Object System.Collections.Generic.List[string]
if (Test-Path -LiteralPath $SetupExePath) { $AssetPaths.Add($SetupExePath) }
if (Test-Path -LiteralPath $ZipPath)      { $AssetPaths.Add($ZipPath) }

$checksumLines = New-Object System.Collections.Generic.List[string]
foreach ($ap in $AssetPaths) {
    $h = (Get-FileHash -LiteralPath $ap -Algorithm SHA256).Hash.ToLowerInvariant()
    $fn = Split-Path -Path $ap -Leaf
    $checksumLines.Add("$h  $fn")
}
if ($checksumLines.Count -gt 0) {
    ($checksumLines -join "`n") + "`n" | Set-Content -LiteralPath $ChecksumPath -Encoding UTF8
    $AssetPaths.Add($ChecksumPath)
}

# Parse GitHub owner/repo from origin remote
$repoSlug = ""
try {
    $remoteUrl = ((& git -C $ProjectRoot remote get-url origin 2>$null) | Out-String).Trim()
    if ($remoteUrl -match 'github\.com[:/]([^/]+/[^/\.]+?)(?:\.git)?$') {
        $repoSlug = $Matches[1]
    }
} catch {}

# Collect commits since previous tag for complete release overview
$prevTag = ""
try {
    $pt = ((& git -C $ProjectRoot describe --tags --abbrev=0 2>$null) | Out-String).Trim()
    if ($LASTEXITCODE -eq 0 -and $pt) { $prevTag = $pt }
} catch {}

$tagName      = "v$SemVer"
$commitRange  = if ($prevTag) { "$prevTag..HEAD" } else { "HEAD" }
$rawCommits   = @()
try {
    $rawCommits = @(& git -C $ProjectRoot log $commitRange --no-merges --pretty=format:"%h|%ad|%an|%s" --date=short 2>$null)
} catch {}

$featList  = New-Object System.Collections.Generic.List[string]
$fixList   = New-Object System.Collections.Generic.List[string]
$otherList = New-Object System.Collections.Generic.List[string]

foreach ($line in $rawCommits) {
    if (-not $line -or $line -notmatch '\|') { continue }
    $parts = $line -split '\|', 4
    if ($parts.Count -lt 4) { continue }
    $cSha  = $parts[0].Trim()
    $cDate = $parts[1].Trim()
    $cSubj = $parts[3].Trim()
    if ($cSubj -match '^chore\(release\):') { continue }

    $entry = "- ``$cSha`` $cSubj _($cDate)_"
    if ($cSubj -match '(?i)^feat(\([^)]*\))?:') {
        $featList.Add($entry)
    } elseif ($cSubj -match '(?i)^fix(\([^)]*\))?:') {
        $fixList.Add($entry)
    } else {
        $otherList.Add($entry)
    }
}

$notesSb = New-Object System.Text.StringBuilder
$effectiveTitle = if ($ReleaseTitle) { "CoreWatch $tagName — $ReleaseTitle" } else { "CoreWatch $tagName ($BuildLabel)" }
[void]$notesSb.AppendLine("## $effectiveTitle")
[void]$notesSb.AppendLine("")
if ($prevTag) {
    [void]$notesSb.AppendLine("Changes since ``$prevTag``:")
} else {
    [void]$notesSb.AppendLine("Release overview:")
}
[void]$notesSb.AppendLine("")

if ($featList.Count -gt 0) {
    [void]$notesSb.AppendLine("### Features")
    foreach ($x in $featList) { [void]$notesSb.AppendLine($x) }
    [void]$notesSb.AppendLine("")
}
if ($fixList.Count -gt 0) {
    [void]$notesSb.AppendLine("### Bug Fixes")
    foreach ($x in $fixList) { [void]$notesSb.AppendLine($x) }
    [void]$notesSb.AppendLine("")
}
if ($otherList.Count -gt 0) {
    [void]$notesSb.AppendLine("### Improvements & Maintenance")
    foreach ($x in $otherList) { [void]$notesSb.AppendLine($x) }
    [void]$notesSb.AppendLine("")
}
if ($featList.Count -eq 0 -and $fixList.Count -eq 0 -and $otherList.Count -eq 0) {
    [void]$notesSb.AppendLine("- Versioned release build ``$tagName`` ($BuildLabel) from commit ``$gitSha``.")
    [void]$notesSb.AppendLine("")
}

if ($repoSlug -and $prevTag) {
    [void]$notesSb.AppendLine("**Full Changelog**: https://github.com/$repoSlug/compare/$prevTag...$tagName")
    [void]$notesSb.AppendLine("")
}

[void]$notesSb.AppendLine("### Build & Verification")
[void]$notesSb.AppendLine("| Field | Value |")
[void]$notesSb.AppendLine("|---|---|")
[void]$notesSb.AppendLine("| **Version** | ``$tagName`` ($BuildLabel) |")
[void]$notesSb.AppendLine("| **Assembly** | ``$AssemblyVer`` |")
[void]$notesSb.AppendLine("| **Branch / Commit** | ``$gitBranch`` @ ``$gitSha`` |")
[void]$notesSb.AppendLine("| **Execution Level** | ``$ExecLevel`` |")
[void]$notesSb.AppendLine("| **Hardware Sensor Bridge** | $(if ($SensorBuilt) { 'Bundled (LibreHardwareMonitor + PawnIO)' } else { 'Not bundled' }) |")
[void]$notesSb.AppendLine("| **Built (UTC)** | ``$BuiltUtc`` |")
[void]$notesSb.AppendLine("")

if ($checksumLines.Count -gt 0) {
    [void]$notesSb.AppendLine("### SHA-256 Checksums")
    [void]$notesSb.AppendLine('```text')
    foreach ($cl in $checksumLines) { [void]$notesSb.AppendLine($cl) }
    [void]$notesSb.AppendLine('```')
}

$notesContent = $notesSb.ToString()
[System.IO.File]::WriteAllText($ReleaseNotesPath, $notesContent, (New-Object System.Text.UTF8Encoding($false)))

# 11. Optional Git Version Commit, Annotated Tag (with full overview), and Push
if ($GitCommit) {
    Write-Host "[GIT] Committing version bump (version.json & build/BUILD-HISTORY.md)..." -ForegroundColor Cyan
    & git -C $ProjectRoot add version.json build/BUILD-HISTORY.md
    $stagedDiff = & git -C $ProjectRoot diff --cached --name-only
    if ($stagedDiff) {
        & git -C $ProjectRoot commit -m "chore(release): release CoreWatch $tagName ($BuildLabel)"
        if ($LASTEXITCODE -ne 0) { throw "Git commit failed." }
        $gitSha = ((& git -C $ProjectRoot rev-parse --short HEAD 2>$null) | Out-String).Trim()
    }
}
if ($GitTag) {
    Write-Host "[GIT] Creating annotated Git tag $tagName with full release overview..." -ForegroundColor Cyan
    $existingTag = (& git -C $ProjectRoot tag -l $tagName)
    if ($existingTag) {
        Write-Host "      Tag $tagName already exists locally — replacing with updated annotation." -ForegroundColor Yellow
        & git -C $ProjectRoot tag -d $tagName | Out-Null
    }
    & git -C $ProjectRoot tag -a $tagName --cleanup=verbatim -F $ReleaseNotesPath
    if ($LASTEXITCODE -ne 0) { throw "Failed to create annotated tag $tagName." }
}
if ($GitPush) {
    Write-Host "[GIT] Pushing $gitBranch and tag $tagName to origin..." -ForegroundColor Cyan
    & git -C $ProjectRoot push origin $gitBranch
    if ($LASTEXITCODE -ne 0) { throw "Failed to push branch $gitBranch to origin." }
    & git -C $ProjectRoot push origin $tagName --force
    if ($LASTEXITCODE -ne 0) { throw "Failed to push tag $tagName to origin." }
}

# 12. Optional Automated GitHub Release Publication (gh CLI -> GITHUB_TOKEN REST API)
$PublishedUrl = ""
if ($PublishGitHub) {
    if (-not $repoSlug) { throw "Could not determine GitHub owner/repo from git remote 'origin'." }
    $isPrerelease = [bool]($pre -match '(?i)alpha|beta|rc|dev|preview')
    Write-Host "[GITHUB] Publishing release $tagName to $repoSlug (Prerelease=$isPrerelease)..." -ForegroundColor Cyan

    $ghExe = $null
    $ghCmd = Get-Command gh -ErrorAction SilentlyContinue
    if ($ghCmd) { $ghExe = $ghCmd.Source }
    elseif (Test-Path 'C:\Program Files\GitHub CLI\gh.exe') { $ghExe = 'C:\Program Files\GitHub CLI\gh.exe' }

    $ghReady = $false
    if ($ghExe) {
        & $ghExe auth status 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) { $ghReady = $true }
    }

    $token = if ($env:GITHUB_TOKEN) { $env:GITHUB_TOKEN } elseif ($env:GH_TOKEN) { $env:GH_TOKEN } else { "" }

    if ($ghReady) {
        $ghArgs = @("release", "create", $tagName)
        foreach ($ap in $AssetPaths) { $ghArgs += $ap }
        $ghArgs += @("--repo", $repoSlug, "--title", $effectiveTitle, "--notes-file", $ReleaseNotesPath)
        if ($isPrerelease) { $ghArgs += "--prerelease" }
        if ($Draft)        { $ghArgs += "--draft" }

        $ghOut = & $ghExe @ghArgs 2>&1
        if ($LASTEXITCODE -ne 0) {
            throw "gh release create failed: $($ghOut -join ' ')"
        }
        $PublishedUrl = ($ghOut | Select-Object -Last 1).ToString().Trim()
        Write-Host "[GITHUB] Release live: $PublishedUrl" -ForegroundColor Green
    } elseif ($token) {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $headers = @{
            "Authorization"        = "Bearer $token"
            "Accept"               = "application/vnd.github+json"
            "User-Agent"           = "CoreWatch-ReleasePipeline"
            "X-GitHub-Api-Version" = "2022-11-28"
        }
        $relBody = @{
            tag_name         = $tagName
            target_commitish = $gitBranch
            name             = $effectiveTitle
            body             = $notesContent
            draft            = [bool]$Draft
            prerelease       = [bool]$isPrerelease
        } | ConvertTo-Json -Depth 4

        $relResp = Invoke-RestMethod -Method Post -Uri "https://api.github.com/repos/$repoSlug/releases" -Headers $headers -Body ([System.Text.Encoding]::UTF8.GetBytes($relBody)) -ContentType "application/json; charset=utf-8" -ErrorAction Stop
        $PublishedUrl = [string]$relResp.html_url
        $uploadBase   = ([string]$relResp.upload_url) -replace '\{\?.*\}$', ''

        foreach ($ap in $AssetPaths) {
            $fn = Split-Path -Path $ap -Leaf
            $mime = if ($fn -match '\.zip$') { "application/zip" } elseif ($fn -match '\.exe$') { "application/vnd.microsoft.portable-executable" } else { "text/plain" }
            $uploadUrl = "$uploadBase?name=$([System.Uri]::EscapeDataString($fn))"
            Write-Host "         Uploading asset: $fn..." -ForegroundColor Gray
            $null = Invoke-RestMethod -Method Post -Uri $uploadUrl -Headers $headers -InFile $ap -ContentType $mime -ErrorAction Stop
        }
        Write-Host "[GITHUB] Release live: $PublishedUrl" -ForegroundColor Green
    } else {
        Write-Host ""
        Write-Host "[GITHUB] Authentication required to publish release $tagName." -ForegroundColor Yellow
        Write-Host "         Option 1 (Recommended): winget install GitHub.cli && gh auth login" -ForegroundColor White
        Write-Host "         Option 2 (Token):       Set `$env:GITHUB_TOKEN (Fine-Grained PAT with Contents: Read & Write)" -ForegroundColor White
        Write-Host "         Release notes saved to: $ReleaseNotesPath" -ForegroundColor DarkCyan
    }
}

$stageMB = [math]::Round(((Get-ChildItem -LiteralPath $StageDir -File -Recurse | Measure-Object Length -Sum).Sum / 1MB), 2)
$zipMB   = if (Test-Path -LiteralPath $ZipPath) { [math]::Round(((Get-Item -LiteralPath $ZipPath).Length / 1MB), 2) } else { 0 }
$setupMB = if (Test-Path -LiteralPath $SetupExePath) { [math]::Round(((Get-Item -LiteralPath $SetupExePath).Length / 1MB), 2) } else { 0 }

Write-Host ""
Write-Host "BUILD COMPLETE: CoreWatch v$SemVer ($BuildLabel)" -ForegroundColor Green
Write-Host "  Executable  : $ExeOut" -ForegroundColor White
Write-Host "  SensorHelper: $(if ($SensorBuilt) { "$StageHelper (LibreHardwareMonitor bundled)" } else { 'Not bundled' })" -ForegroundColor White
Write-Host "  Folder Size : $stageMB MB" -ForegroundColor White
if ($zipMB -gt 0) {
    Write-Host "  Portable ZIP: $ZipPath ($zipMB MB)" -ForegroundColor White
}
if ($setupMB -gt 0) {
    Write-Host "  Setup .EXE  : $SetupExePath ($setupMB MB)" -ForegroundColor White
}
if (Test-Path -LiteralPath $ChecksumPath) {
    Write-Host "  SHA-256 Sums: $ChecksumPath" -ForegroundColor White
}
Write-Host "  ReleaseNotes: $ReleaseNotesPath" -ForegroundColor White
Write-Host "  Provenance  : $(Join-Path $StageDir 'build-info.json')" -ForegroundColor White
if ($PublishedUrl) {
    Write-Host "  GitHub URL  : $PublishedUrl" -ForegroundColor Green
}
