<#
.SYNOPSIS
    Local Test Build pipeline for CoreWatch — builds ONLY the Inno Setup .exe installer
    into .\testBuild\ without modifying version.json, BUILD-HISTORY.md, Git, or GitHub Releases.

.EXAMPLE
    .\build\Build-Test.ps1
    .\build\Build-Test.ps1 -Label "theme-fix"
    .\build\Build-Test.ps1 -NoAdmin
#>
[CmdletBinding()]
param(
    [string]$Label = "",
    [switch]$NoAdmin,
    [switch]$KeepStage
)

$ErrorActionPreference = "Stop"

$ProjectRoot  = Split-Path -Parent $PSScriptRoot
$BuildDir     = $PSScriptRoot
$TestBuildDir = Join-Path $ProjectRoot "testBuild"
$VersionFile  = Join-Path $ProjectRoot "version.json"
$TestMetaFile = Join-Path $TestBuildDir "test-build.json"

if (-not (Test-Path -LiteralPath $TestBuildDir)) {
    $null = New-Item -ItemType Directory -Path $TestBuildDir -Force
}

# 1. Read current base version (read-only; NEVER mutates version.json or BUILD-HISTORY.md)
if (Test-Path -LiteralPath $VersionFile) {
    $verObj = Get-Content -LiteralPath $VersionFile -Raw | ConvertFrom-Json
} else {
    $verObj = [PSCustomObject]@{ major = 0; minor = 9; patch = 2; prerelease = "beta"; build = 0; buildNumber = 16 }
}
$major = [int]$verObj.major
$minor = [int]$verObj.minor
$patch = [int]$verObj.patch
$build = [int]$verObj.build
$pre   = [string]$verObj.prerelease

$SemVer = if ($pre) {
    if ($build -eq 0) { "$major.$minor.$patch-$pre" } else { "$major.$minor.$patch-$pre.$build" }
} else {
    if ($build -eq 0) { "$major.$minor.$patch" } else { "$major.$minor.$patch.$build" }
}
$AssemblyVer = "$major.$minor.$patch.$build"

# Increment local-only test counter in testBuild\test-build.json
$testNum = 0
if (Test-Path -LiteralPath $TestMetaFile -PathType Leaf) {
    try {
        $prevMeta = Get-Content -LiteralPath $TestMetaFile -Raw | ConvertFrom-Json
        $testNum = [int]($prevMeta.testBuildNumber ?? 0)
    } catch {}
}
$testNum++

$safeLabel = ($Label.Trim() -replace '[^A-Za-z0-9_-]', '')
$testTag = if ($safeLabel) { "Test$testNum-$safeLabel" } else { "Test$testNum" }
$TestVersionStr = "$SemVer-$testTag"

$gitBranch = "unknown"; $gitSha = "nogit"; $gitDirty = $false
try {
    $b = (& git -C $ProjectRoot rev-parse --abbrev-ref HEAD 2>$null)
    if ($LASTEXITCODE -eq 0 -and $b) { $gitBranch = $b.Trim() }
    $s = (& git -C $ProjectRoot rev-parse --short HEAD 2>$null)
    if ($LASTEXITCODE -eq 0 -and $s) { $gitSha = $s.Trim() }
    $st = (& git -C $ProjectRoot status --porcelain 2>$null)
    if ($LASTEXITCODE -eq 0 -and $st) { $gitDirty = $true }
} catch {}

$InfoVersion = "$TestVersionStr+$gitSha$(if ($gitDirty) { '.dirty' })"
$BuiltUtc    = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
$ExecLevel   = if ($NoAdmin) { "asInvoker" } else { "requireAdministrator" }
$StageDir    = Join-Path $TestBuildDir "_stage"

Write-Host "=================================================================" -ForegroundColor Yellow
Write-Host "  CoreWatch LOCAL TEST BUILD #$testNum  v$TestVersionStr" -ForegroundColor Yellow
Write-Host "  Output: .\testBuild\ (EXE Installer ONLY — No GitHub Release)" -ForegroundColor DarkYellow
Write-Host "  Git   : $gitBranch @ $gitSha$(if ($gitDirty) { ' (working tree changes)' } else { ' (clean)' })" -ForegroundColor Gray
Write-Host "=================================================================" -ForegroundColor Yellow

# 2. Locate C# Compiler (csc.exe) and Inno Setup (ISCC.exe)
$CscPath = @(
    "$env:SystemRoot\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
    "$env:SystemRoot\Microsoft.NET\Framework\v4.0.30319\csc.exe"
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
if (-not $CscPath) { throw "Could not find .NET Framework 4.x C# compiler (csc.exe)." }

$Iscc = @(
    (Get-Command "ISCC.exe" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source),
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "$env:ProgramFiles\Inno Setup 6\ISCC.exe",
    "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe"
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
if (-not $Iscc) { throw "Inno Setup 6 (ISCC.exe) is required to compile the local test .exe installer." }

# 3. Generate multi-res CoreWatch.ico (inside testBuild\_stage so build\ stays untouched)
if (Test-Path -LiteralPath $StageDir) { Remove-Item -LiteralPath $StageDir -Recurse -Force }
$null = New-Item -ItemType Directory -Path $StageDir -Force
$null = New-Item -ItemType Directory -Path (Join-Path $StageDir "bin") -Force
$null = New-Item -ItemType Directory -Path (Join-Path $StageDir "images") -Force
$null = New-Item -ItemType Directory -Path (Join-Path $StageDir "modules") -Force

Add-Type -AssemblyName System.Drawing
$SourcePng = Join-Path $ProjectRoot "images\Icon.png"
$OutIco    = Join-Path $StageDir "CoreWatch.ico"
if (Test-Path -LiteralPath $SourcePng) {
    Write-Host "[1/5] Generating multi-res CoreWatch.ico..." -ForegroundColor Gray
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
            $ms.Dispose(); $bmp.Dispose()
        }
    } finally { $srcImg.Dispose() }

    $fs = [System.IO.File]::Create($OutIco)
    $bw = New-Object System.IO.BinaryWriter($fs)
    try {
        $bw.Write([uint16]0); $bw.Write([uint16]1); $bw.Write([uint16]$sizes.Count)
        $offset = 6 + (16 * $sizes.Count)
        for ($i = 0; $i -lt $sizes.Count; $i++) {
            $sz = $sizes[$i]; $blob = $pngBlobs[$i]
            $bw.Write([byte]$(if ($sz -ge 256) { 0 } else { $sz }))
            $bw.Write([byte]$(if ($sz -ge 256) { 0 } else { $sz }))
            $bw.Write([byte]0); $bw.Write([byte]0)
            $bw.Write([uint16]1); $bw.Write([uint16]32)
            $bw.Write([uint32]$blob.Length); $bw.Write([uint32]$offset)
            $offset += $blob.Length
        }
        foreach ($blob in $pngBlobs) { $bw.Write($blob) }
    } finally { $bw.Dispose(); $fs.Dispose() }
} else {
    $OutIco = $null
}

$ManifestPath = Join-Path $StageDir "CoreWatch.manifest"
$ManifestXml = @"
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <assemblyIdentity version="$AssemblyVer" processorArchitecture="*" name="CoreWatch.HostEngine" type="win32"/>
  <description>CoreWatch Host Engine System Dashboard &amp; Diagnostics (Local Test Build)</description>
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

# 4. Stage App Files
Write-Host "[2/5] Staging local test files..." -ForegroundColor Gray
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
Get-ChildItem -LiteralPath (Join-Path $ProjectRoot "bin") -Filter "*.dll" -File -ErrorAction SilentlyContinue | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $StageDir "bin\$($_.Name)") -Force
}

# 5. Compile CoreWatchSensorHelper.exe + CoreWatch.exe
$LhmDllPath  = Join-Path $ProjectRoot "bin\LibreHardwareMonitorLib.dll"
$SensorCs    = Join-Path $BuildDir "CoreWatchSensorHelper.cs"
$StageHelper = Join-Path $StageDir "bin\CoreWatchSensorHelper.exe"
$SensorBuilt = $false
if ((Test-Path -LiteralPath $LhmDllPath) -and (Test-Path -LiteralPath $SensorCs)) {
    Write-Host "[3/5] Compiling CoreWatchSensorHelper.exe..." -ForegroundColor Gray
    $sensorAsmTmp = Join-Path $StageDir "SensorAssemblyInfo.generated.cs"
    $sensorAsmCode = @"
using System.Reflection;
[assembly: AssemblyTitle("CoreWatch Hardware Sensor Bridge")]
[assembly: AssemblyProduct("CoreWatch")]
[assembly: AssemblyVersion("$AssemblyVer")]
[assembly: AssemblyFileVersion("$AssemblyVer")]
[assembly: AssemblyInformationalVersion("$InfoVersion")]
"@
    [System.IO.File]::WriteAllText($sensorAsmTmp, $sensorAsmCode, [System.Text.Encoding]::UTF8)
    $sOut = & $CscPath "/nologo" "/target:exe" "/optimize+" "/platform:x64" "/out:$StageHelper" "/reference:$LhmDllPath" $SensorCs $sensorAsmTmp 2>&1
    Remove-Item -LiteralPath $sensorAsmTmp -Force -ErrorAction SilentlyContinue
    if ($LASTEXITCODE -ne 0) { throw "CoreWatchSensorHelper.exe compilation failed:`n$($sOut -join "`n")" }

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
    $SensorBuilt = $true
}

Write-Host "[4/5] Compiling CoreWatch.exe ($TestVersionStr, $ExecLevel)..." -ForegroundColor Gray
$ExeOut     = Join-Path $StageDir "CoreWatch.exe"
$LauncherCs = Join-Path $BuildDir "CoreWatchLauncher.cs"
$AsmInfoTmp = Join-Path $StageDir "AssemblyInfo.generated.cs"
$AsmInfoCode = @"
using System.Reflection;
[assembly: AssemblyTitle("CoreWatch Host Engine")]
[assembly: AssemblyDescription("CoreWatch System Telemetry, Management & UltimaDiagX Suite (Local Test Build)")]
[assembly: AssemblyProduct("CoreWatch")]
[assembly: AssemblyVersion("$AssemblyVer")]
[assembly: AssemblyFileVersion("$AssemblyVer")]
[assembly: AssemblyInformationalVersion("$InfoVersion")]
"@
[System.IO.File]::WriteAllText($AsmInfoTmp, $AsmInfoCode, [System.Text.Encoding]::UTF8)

$cscArgs = @("/nologo", "/target:winexe", "/optimize+", "/platform:x64", "/out:$ExeOut", "/win32manifest:$ManifestPath", "/reference:System.Windows.Forms.dll", "/reference:System.Drawing.dll")
if ($OutIco -and (Test-Path -LiteralPath $OutIco)) { $cscArgs += "/win32icon:$OutIco" }
$cscArgs += $LauncherCs; $cscArgs += $AsmInfoTmp
$cscOut = & $CscPath $cscArgs 2>&1
Remove-Item -LiteralPath $AsmInfoTmp -Force -ErrorAction SilentlyContinue
if ($LASTEXITCODE -ne 0) { throw "CoreWatch.exe compilation failed:`n$($cscOut -join "`n")" }

$buildInfo = [ordered]@{
    product         = "CoreWatch"
    version         = $TestVersionStr
    buildLabel      = "Local Test #$testNum"
    testBuildNumber = $testNum
    assemblyVer     = $AssemblyVer
    infoVersion     = $InfoVersion
    gitBranch       = $gitBranch
    gitCommit       = $gitSha
    gitDirty        = $gitDirty
    executionLevel  = $ExecLevel
    sensorBridge    = $SensorBuilt
    builtUtc        = $BuiltUtc
}
($buildInfo | ConvertTo-Json -Depth 3) + "`n" | Set-Content -LiteralPath (Join-Path $StageDir "build-info.json") -Encoding UTF8

# 6. Generate Modular 15-Tab Inno Setup Script & Compile ONLY the .exe Installer into .\testBuild\
$CatalogObj = if (Test-Path -LiteralPath $CatalogSrc -PathType Leaf) { Get-Content -LiteralPath $CatalogSrc -Raw | ConvertFrom-Json } else { $null }
$CatalogModules = if ($CatalogObj -and $CatalogObj.modules) { @($CatalogObj.modules) } else { @() }

$IssComponentsSb  = New-Object System.Text.StringBuilder
$IssModuleFilesSb = New-Object System.Text.StringBuilder
$IssCodeChecksSb  = New-Object System.Text.StringBuilder

[void]$IssComponentsSb.AppendLine('Name: "core"; Description: "CoreWatch Dashboard & Telemetry Engine (Required)"; Types: full essentials itpro developer custom; Flags: fixed')
[void]$IssComponentsSb.AppendLine('Name: "tabs"; Description: "Feature Tabs & Optional Modules"; Types: full essentials itpro developer')

foreach ($mod in $CatalogModules) {
    $mId    = [string]$mod.id
    $mName  = ([string]$mod.name).Replace('"', '""')
    $mTypes = if ($mod.installerTypes -and $mod.installerTypes.Count -gt 0) { ($mod.installerTypes -join ' ') } else { 'full' }
    [void]$IssComponentsSb.AppendLine("Name: `"tabs\$mId`"; Description: `"$mName`"; Types: $mTypes")
    foreach ($relPath in @($mod.files)) {
        $relWin = ([string]$relPath) -replace '/', '\'
        $relDir = Split-Path -Path $relWin -Parent
        $destDir = if ($relDir) { "{app}\$relDir" } else { "{app}" }
        [void]$IssModuleFilesSb.AppendLine("Source: `"$StageDir\$relWin`"; DestDir: `"$destDir`"; Flags: ignoreversion; Components: tabs\$mId")
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

$PawnIoSetupSrc = Join-Path $BuildDir "redist\PawnIO_setup.exe"
$HasPawnIoRedist = Test-Path -LiteralPath $PawnIoSetupSrc -PathType Leaf
$PawnIoFilesLine = if ($HasPawnIoRedist) { "Source: `"$PawnIoSetupSrc`"; DestDir: `"{tmp}`"; Flags: deleteafterinstall; Tasks: installpawnio" } else { "" }
$PawnIoRunLine = if ($HasPawnIoRedist) {
    'Filename: "{tmp}\PawnIO_setup.exe"; Parameters: "-install -silent"; StatusMsg: "Installing Microsoft-signed PawnIO sensor driver..."; Flags: waituntilterminated runhidden; Tasks: installpawnio; Check: not IsPawnIoInstalled'
} else {
    'Filename: "winget.exe"; Parameters: "install --id namazso.PawnIO --source winget --accept-package-agreements --accept-source-agreements"; StatusMsg: "Installing PawnIO sensor driver via winget..."; Flags: waituntilterminated runhidden; Tasks: installpawnio; Check: not IsPawnIoInstalled'
}

$SetupBaseName = "CoreWatch-$TestVersionStr-Setup"
$IssPath = Join-Path $TestBuildDir "_CoreWatchTest.iss"
$IssContent = @"
; CoreWatch Local Test Build Installer Script (EXE-Only)
#define MyAppName "CoreWatch"
#define MyAppVersion "$TestVersionStr"
#define MyAppExeName "CoreWatch.exe"

[Setup]
AppId={{7E84C29A-6C15-4D63-9F42-8E112D4B01A5}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=$TestBuildDir
OutputBaseFilename=$SetupBaseName
$(if ($OutIco) { "SetupIconFile=$OutIco" })
Compression=lzma2/fast
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=$(if ($NoAdmin) { "lowest" } else { "admin" })

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Types]
Name: "full"; Description: "Full Installation — All Tabs & Modules (Recommended)"
Name: "essentials"; Description: "Home & Essentials (Dashboard, Tasks, DiagX, Security, Apps, Disk Map, Organizer)"
Name: "itpro"; Description: "IT & SysAdmin Suite (Dashboard, Network, Tasks, DiagX, Security, Sharing, Devices, Apps)"
Name: "developer"; Description: "Developer Workstation (Dashboard, Network, Tasks, DiagX, GitHub, Jira, WSL, Apps)"
Name: "custom"; Description: "Custom — Pick & Choose Individual Tabs"; Flags: iscustom

[Components]
$($IssComponentsSb.ToString().TrimEnd())

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"
Name: "installpawnio"; Description: "Install PawnIO signed kernel driver (required by LibreHardwareMonitor for live CPU temps)"; GroupDescription: "Hardware Sensors:"; Check: not IsPawnIoInstalled

[Files]
Source: "$StageDir\CoreWatch.exe"; DestDir: "{app}"; Flags: ignoreversion; Components: core
Source: "$StageDir\Start-NodeWatch.ps1"; DestDir: "{app}"; Flags: ignoreversion; Components: core
Source: "$StageDir\version.json"; DestDir: "{app}"; Flags: ignoreversion; Components: core
Source: "$StageDir\build-info.json"; DestDir: "{app}"; Flags: ignoreversion; Components: core
Source: "$StageDir\bin\*"; DestDir: "{app}\bin"; Flags: ignoreversion recursesubdirs createallsubdirs; Components: core
Source: "$StageDir\images\*"; DestDir: "{app}\images"; Flags: ignoreversion recursesubdirs createallsubdirs; Components: core
Source: "$StageDir\modules\core\*"; DestDir: "{app}\modules\core"; Flags: ignoreversion recursesubdirs createallsubdirs; Components: core
Source: "$StageDir\modules\layouts\*"; DestDir: "{app}\modules\layouts"; Flags: ignoreversion recursesubdirs createallsubdirs; Components: core
Source: "$StageDir\modules\telemetry\*"; DestDir: "{app}\modules\telemetry"; Flags: ignoreversion recursesubdirs createallsubdirs; Components: core
Source: "$StageDir\modules\modules-catalog.json"; DestDir: "{app}\modules"; Flags: ignoreversion; Components: core
$($IssModuleFilesSb.ToString().TrimEnd())
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
$($IssCodeChecksSb.ToString().TrimEnd())
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

Write-Host "[5/5] Compiling local test .exe installer via Inno Setup..." -ForegroundColor Green
& $Iscc $IssPath
if ($LASTEXITCODE -ne 0) { throw "Inno Setup (ISCC.exe) failed with exit code $LASTEXITCODE." }

# Clean temporary stage & ISS unless -KeepStage
if (-not $KeepStage) {
    Remove-Item -LiteralPath $StageDir -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $IssPath -Force -ErrorAction SilentlyContinue
}

$FinalExe = Join-Path $TestBuildDir "$SetupBaseName.exe"
$sizeMB = [math]::Round(((Get-Item -LiteralPath $FinalExe).Length / 1MB), 2)

# Persist local test build counter metadata
$metaOut = [ordered]@{
    testBuildNumber = $testNum
    lastInstaller   = (Split-Path -Leaf $FinalExe)
    baseVersion     = $SemVer
    gitCommit       = $gitSha
    builtUtc        = $BuiltUtc
}
($metaOut | ConvertTo-Json -Depth 3) + "`n" | Set-Content -LiteralPath $TestMetaFile -Encoding UTF8

Write-Host ""
Write-Host "LOCAL TEST BUILD #$testNum COMPLETE (EXE Installer Only — Not Published)" -ForegroundColor Green
Write-Host "  Installer : $FinalExe ($sizeMB MB)" -ForegroundColor White
Write-Host "  Modules   : $($CatalogModules.Count) selectable tabs included" -ForegroundColor Cyan
Write-Host "  Git/Repo  : Untouched (version.json & BUILD-HISTORY.md unchanged)" -ForegroundColor DarkGray
