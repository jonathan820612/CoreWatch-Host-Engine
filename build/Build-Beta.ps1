<#
.SYNOPSIS
    Builds a clean CoreWatch Beta distribution (CoreWatch.exe + portable folder + ZIP + optional Inno Setup installer).

.EXAMPLE
    .\build\Build-Beta.ps1
    .\build\Build-Beta.ps1 -Version "0.9.0-beta" -RequireAdmin
    .\build\Build-Beta.ps1 -Version "0.9.0-beta" -IncludeFixedRuntime
#>
[CmdletBinding()]
param(
    [string]$Version = "0.9.0-beta",
    [switch]$RequireAdmin,
    [switch]$IncludeFixedRuntime,
    [switch]$SkipZip
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$BuildDir    = $PSScriptRoot
$DistRoot    = Join-Path $ProjectRoot "dist"
$StageDir    = Join-Path $DistRoot "CoreWatch-$Version"
$ZipPath     = Join-Path $DistRoot "CoreWatch-$Version-Portable.zip"

$AssemblyVer = if ($Version -match '^(\d+\.\d+\.\d+)') { "$($Matches[1]).0" } else { "0.9.0.0" }

Write-Host "=========================================================" -ForegroundColor Cyan
Write-Host "  CoreWatch Beta Build Pipeline  (v$Version)" -ForegroundColor Cyan
Write-Host "=========================================================" -ForegroundColor Cyan

# 1. Locate Windows built-in C# Compiler (csc.exe)
$CscPath = @(
    "$env:SystemRoot\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
    "$env:SystemRoot\Microsoft.NET\Framework\v4.0.30319\csc.exe"
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1

if (-not $CscPath) {
    throw "Could not find Windows C# compiler (csc.exe) under .NET Framework 4.x."
}
Write-Host "[1/6] Using C# Compiler: $CscPath" -ForegroundColor Gray

# 2. Convert images\Icon.png -> multi-resolution PNG-in-ICO (build\CoreWatch.ico)
Add-Type -AssemblyName System.Drawing
$SourcePng = Join-Path $ProjectRoot "images\Icon.png"
$OutIco    = Join-Path $BuildDir "CoreWatch.ico"

if (Test-Path -LiteralPath $SourcePng) {
    Write-Host "[2/6] Generating CoreWatch.ico from images\Icon.png..." -ForegroundColor Gray
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
        # ICONDIR header (6 bytes)
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

# 3. Generate Application Manifest (PerMonitorV2 DPI + asInvoker/requireAdministrator)
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

# 4. Prepare Clean Staging Directory
Write-Host "[3/6] Preparing clean release folder: $StageDir" -ForegroundColor Gray
if (Test-Path -LiteralPath $StageDir) {
    Remove-Item -LiteralPath $StageDir -Recurse -Force
}
$null = New-Item -ItemType Directory -Path $StageDir -Force
$null = New-Item -ItemType Directory -Path (Join-Path $StageDir "bin") -Force
$null = New-Item -ItemType Directory -Path (Join-Path $StageDir "images") -Force
$null = New-Item -ItemType Directory -Path (Join-Path $StageDir "modules") -Force

Copy-Item -LiteralPath (Join-Path $ProjectRoot "Start-NodeWatch.ps1") -Destination $StageDir -Force
if (Test-Path -LiteralPath $SourcePng) {
    Copy-Item -LiteralPath $SourcePng -Destination (Join-Path $StageDir "images\Icon.png") -Force
}
foreach ($sub in @("layouts", "tabs", "telemetry")) {
    $srcSub = Join-Path $ProjectRoot "modules\$sub"
    if (Test-Path -LiteralPath $srcSub) {
        Copy-Item -LiteralPath $srcSub -Destination (Join-Path $StageDir "modules\$sub") -Recurse -Force
    }
}

# Copy ONLY required WebView2 wrapper DLLs (omit WebView2UserData & optionally WebView2FixedRuntime)
foreach ($dll in @("Microsoft.Web.WebView2.Core.dll", "Microsoft.Web.WebView2.WinForms.dll", "WebView2Loader.dll")) {
    $srcDll = Join-Path $ProjectRoot "bin\$dll"
    if (Test-Path -LiteralPath $srcDll) {
        Copy-Item -LiteralPath $srcDll -Destination (Join-Path $StageDir "bin\$dll") -Force
    } else {
        Write-Warning "Missing expected WebView2 DLL: $srcDll"
    }
}
if ($IncludeFixedRuntime) {
    $fixedSrc = Join-Path $ProjectRoot "bin\WebView2FixedRuntime"
    if (Test-Path -LiteralPath $fixedSrc) {
        Write-Host "      Bundling WebView2FixedRuntime (offline mode)..." -ForegroundColor Yellow
        Copy-Item -LiteralPath $fixedSrc -Destination (Join-Path $StageDir "bin\WebView2FixedRuntime") -Recurse -Force
    }
}

# 5. Compile Native Windows Launcher CoreWatch.exe
Write-Host "[4/6] Compiling CoreWatch.exe (ExecutionLevel=$ExecLevel)..." -ForegroundColor Gray
$ExeOut = Join-Path $StageDir "CoreWatch.exe"
$LauncherCs = Join-Path $BuildDir "CoreWatchLauncher.cs"
$AsmInfoTmp = Join-Path $BuildDir "AssemblyInfo.generated.cs"

$AsmInfoCode = @"
using System.Reflection;
[assembly: AssemblyTitle("CoreWatch Host Engine")]
[assembly: AssemblyDescription("CoreWatch System Telemetry, Management & UltimaDiagX Suite")]
[assembly: AssemblyProduct("CoreWatch")]
[assembly: AssemblyVersion("$AssemblyVer")]
[assembly: AssemblyFileVersion("$AssemblyVer")]
[assembly: AssemblyInformationalVersion("$Version")]
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

# 6. Package Portable ZIP + Generate Inno Setup Installer Script
if (-not $SkipZip) {
    Write-Host "[5/6] Creating Portable Beta ZIP: $ZipPath" -ForegroundColor Gray
    if (Test-Path -LiteralPath $ZipPath) { Remove-Item -LiteralPath $ZipPath -Force }
    Compress-Archive -Path "$StageDir\*" -DestinationPath $ZipPath -CompressionLevel Optimal
}

$IssPath = Join-Path $BuildDir "CoreWatch.iss"
$IssContent = @"
; CoreWatch Beta Installer Script for Inno Setup (https://jrsoftware.org/isinfo.php)
#define MyAppName "CoreWatch"
#define MyAppVersion "$Version"
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

[Files]
Source: "..\dist\CoreWatch-{#MyAppVersion}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#StringChange(MyAppName, '&', '&&')}}"; Flags: nowait postinstall skipifsilent
"@
[System.IO.File]::WriteAllText($IssPath, $IssContent, [System.Text.Encoding]::UTF8)

# Auto-compile Inno Setup Installer if ISCC.exe is installed
$Iscc = @(
    (Get-Command "ISCC.exe" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source),
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1

if ($Iscc) {
    Write-Host "[6/6] Inno Setup detected! Building Windows Installer..." -ForegroundColor Green
    & $Iscc $IssPath
} else {
    Write-Host "[6/6] Generated Inno Setup script: $IssPath (install Inno Setup 6 to build Setup.exe)" -ForegroundColor Yellow
}

$stageMB = [math]::Round(((Get-ChildItem -LiteralPath $StageDir -File -Recurse | Measure-Object Length -Sum).Sum / 1MB), 2)
$zipMB   = if (Test-Path -LiteralPath $ZipPath) { [math]::Round(((Get-Item -LiteralPath $ZipPath).Length / 1MB), 2) } else { 0 }

Write-Host ""
Write-Host "BUILD COMPLETE!" -ForegroundColor Green
Write-Host "  Executable : $ExeOut" -ForegroundColor White
Write-Host "  Folder Size: $stageMB MB" -ForegroundColor White
if ($zipMB -gt 0) {
    Write-Host "  Portable ZIP: $ZipPath ($zipMB MB)" -ForegroundColor White
}
Write-Host "  Inno Script : $IssPath" -ForegroundColor White
