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
    .\build\Build-Beta.ps1 -Bump none -IncludeFixedRuntime
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
    [switch]$GitTag
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$BuildDir    = $PSScriptRoot
$DistRoot    = Join-Path $ProjectRoot "dist"
$VersionFile = Join-Path $ProjectRoot "version.json"

# 1. Load & Increment Semantic + Build Version from version.json
if (Test-Path -LiteralPath $VersionFile) {
    $verObj = Get-Content -LiteralPath $VersionFile -Raw | ConvertFrom-Json
} else {
    $verObj = [PSCustomObject]@{ major = 0; minor = 9; patch = 0; prerelease = "beta"; build = 0 }
}

$major = [int]$verObj.major
$minor = [int]$verObj.minor
$patch = [int]$verObj.patch
$build = [int]$verObj.build
$pre   = if ($PSBoundParameters.ContainsKey("Prerelease")) { $Prerelease } else { [string]$verObj.prerelease }

switch ($Bump) {
    "major" { $major++; $minor = 0; $patch = 0; $build = 1 }
    "minor" { $minor++; $patch = 0; $build = 1 }
    "patch" { $patch++; $build = 1 }
    "build" { $build++ }
    "none"  { if ($build -lt 1) { $build = 1 } }
}

$updatedVerObj = [ordered]@{
    major      = $major
    minor      = $minor
    patch      = $patch
    prerelease = $pre
    build      = $build
}
if ($Bump -ne "none" -or -not (Test-Path -LiteralPath $VersionFile)) {
    ($updatedVerObj | ConvertTo-Json -Depth 2) + "`n" | Set-Content -LiteralPath $VersionFile -Encoding UTF8
}

$SemVer      = if ($pre) { "$major.$minor.$patch-$pre.$build" } else { "$major.$minor.$patch.$build" }
$AssemblyVer = "$major.$minor.$patch.$build"

# 2. Capture Git Source-Control Metadata
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

$InfoVersion = "$SemVer+$gitSha$(if ($gitDirty) { '.dirty' })"
$BuiltUtc    = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")

$StageDir = Join-Path $DistRoot "CoreWatch-$SemVer"
$ZipPath  = Join-Path $DistRoot "CoreWatch-$SemVer-Portable.zip"

Write-Host "=================================================================" -ForegroundColor Cyan
Write-Host "  CoreWatch Source-Controlled Build  v$SemVer" -ForegroundColor Cyan
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
foreach ($sub in @("layouts", "tabs", "telemetry")) {
    $srcSub = Join-Path $ProjectRoot "modules\$sub"
    if (Test-Path -LiteralPath $srcSub) {
        Copy-Item -LiteralPath $srcSub -Destination (Join-Path $StageDir "modules\$sub") -Recurse -Force
    }
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
$histLine = "| v$SemVer | $AssemblyVer | $gitBranch | ``$gitSha``$(if ($gitDirty) { '*' }) | $BuiltUtc | $ExecLevel | $(if ($SensorBuilt) { 'Yes' } else { 'No' }) |"
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

$IssPath = Join-Path $BuildDir "CoreWatch.iss"
$IssContent = @"
; CoreWatch Installer Script for Inno Setup (https://jrsoftware.org/isinfo.php)
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

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"
Name: "installpawnio"; Description: "Install PawnIO signed kernel driver (required by LibreHardwareMonitor for live CPU temps)"; GroupDescription: "Hardware Sensors:"; Check: not IsPawnIoInstalled

[Files]
Source: "..\dist\CoreWatch-{#MyAppVersion}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
$PawnIoFilesLine

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

# Optional Git Version Commit & Annotated Tag
if ($GitCommit) {
    Write-Host "[GIT] Committing version bump (version.json & build/BUILD-HISTORY.md)..." -ForegroundColor Cyan
    & git -C $ProjectRoot add version.json build/BUILD-HISTORY.md
    & git -C $ProjectRoot commit -m "chore(release): bump CoreWatch to v$SemVer"
}
if ($GitTag) {
    $tagName = "v$SemVer"
    Write-Host "[GIT] Creating annotated Git tag $tagName..." -ForegroundColor Cyan
    & git -C $ProjectRoot tag -a $tagName -m "CoreWatch $tagName (commit $gitSha)"
}

$stageMB = [math]::Round(((Get-ChildItem -LiteralPath $StageDir -File -Recurse | Measure-Object Length -Sum).Sum / 1MB), 2)
$zipMB   = if (Test-Path -LiteralPath $ZipPath) { [math]::Round(((Get-Item -LiteralPath $ZipPath).Length / 1MB), 2) } else { 0 }
$setupMB = if (Test-Path -LiteralPath $SetupExePath) { [math]::Round(((Get-Item -LiteralPath $SetupExePath).Length / 1MB), 2) } else { 0 }

Write-Host ""
Write-Host "BUILD COMPLETE: CoreWatch v$SemVer" -ForegroundColor Green
Write-Host "  Executable  : $ExeOut" -ForegroundColor White
Write-Host "  SensorHelper: $(if ($SensorBuilt) { "$StageHelper (LibreHardwareMonitor bundled)" } else { 'Not bundled' })" -ForegroundColor White
Write-Host "  Folder Size : $stageMB MB" -ForegroundColor White
if ($zipMB -gt 0) {
    Write-Host "  Portable ZIP: $ZipPath ($zipMB MB)" -ForegroundColor White
}
if ($setupMB -gt 0) {
    Write-Host "  Setup .EXE  : $SetupExePath ($setupMB MB)" -ForegroundColor White
}
Write-Host "  Provenance  : $(Join-Path $StageDir 'build-info.json')" -ForegroundColor White
