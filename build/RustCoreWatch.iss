; RustCoreWatch Modular Installer Script for Inno Setup 6.7+
; Modern Windows 11 dynamic Light/Dark UI, grouped 24-tab modular selection,
; optional Hardware Sensor Helper & PawnIO, Low-Memory Mode, and Finish-page Start with Windows toggle.

#ifndef MyAppName
  #define MyAppName "RustCoreWatch"
#endif
#ifndef MyAppVersion
  #define MyAppVersion "1.0.0-beta.1"
#endif
#ifndef MyVersionInfo
  #define MyVersionInfo "1.0.0.1"
#endif
#ifndef MyAppExeName
  #define MyAppExeName "RustCoreWatch.exe"
#endif
#ifndef StageDir
  #define StageDir "..\dist\RustCoreWatch-1.0.0-beta.1"
#endif

[Setup]
AppId={{4C8D9E2B-7F31-4B94-A128-9E5F02C7A613}}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} v{#MyAppVersion}
AppPublisher=CoreWatch Project
AppPublisherURL=https://github.com/jonathan820612/CoreWatch-Host-Engine
AppSupportURL=https://github.com/jonathan820612/CoreWatch-Host-Engine/issues
AppUpdatesURL=https://github.com/jonathan820612/CoreWatch-Host-Engine/releases
VersionInfoVersion={#MyVersionInfo}
VersionInfoProductName={#MyAppName}
VersionInfoProductTextVersion={#MyAppVersion}
VersionInfoDescription=RustCoreWatch Modular Installer
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
DisableWelcomePage=no
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
AppMutex=Local\RustCoreWatch_SingleInstance_v1
CloseApplications=yes
CloseApplicationsFilter=RustCoreWatch.exe,CoreWatchSensorHelper.exe
RestartApplications=no
OutputDir=..\dist
OutputBaseFilename=RustCoreWatch-{#MyAppVersion}-Setup
SetupIconFile=..\icons\icon.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
UninstallDisplayName={#MyAppName}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern dynamic windows11
WizardSizePercent=115,115
WizardBackColor=#f4f7fb
WizardBackColorDynamicDark=#141923
WizardImageFile=wizard-side-light.png
WizardImageFileDynamicDark=wizard-side-dark.png
WizardSmallImageFile=wizard-header-light.png
WizardSmallImageFileDynamicDark=wizard-header-dark.png
WizardImageStretch=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Messages]
WelcomeLabel1=Welcome to RustCoreWatch Setup
WelcomeLabel2=This wizard installs [name/ver] — a native Rust system telemetry dashboard, standalone RGB lighting studio, diagnostics lab, and operations suite.%n%nOn the next steps you can choose a preset or pick the exact tabs and optional hardware components you want installed.
SelectComponentsDesc=Choose a preset or pick the exact tabs and modules you want enabled in RustCoreWatch.
SelectComponentsLabel2=Unselected tabs stay clean and hidden out of the box (you can always re-enable any module later in Settings or by re-running Setup).

[Types]
Name: "full"; Description: "Full Suite — All 24 Tabs & Modules (Recommended)"
Name: "essentials"; Description: "Home & Essentials — Telemetry, Diagnostics, Protection, Storage & RGB"
Name: "gamer"; Description: "Gamer & RGB Enthusiast — Telemetry, RGB Studio, Profiles, Network & Alerts"
Name: "developer"; Description: "Developer Workstation — Full Dev & Work, Network, Diagnostics & RGB"
Name: "itpro"; Description: "IT & SysAdmin Suite — Network, Diagnostics, Security, SSH, Homelab & Devices"
Name: "custom"; Description: "Custom — Pick & Choose Individual Tabs"; Flags: iscustom

[Components]
Name: "core"; Description: "RustCoreWatch Core Engine & Live Telemetry Dashboard (Required)"; Types: full essentials gamer developer itpro custom; Flags: fixed

; Modular Tabs (Grouped to match RustCoreWatch navigation)
Name: "tabs"; Description: "Feature Tabs & Modules"; Types: full essentials gamer developer itpro
Name: "tabs\top"; Description: "Top-Level Suites"; Types: full essentials gamer developer itpro
Name: "tabs\top\netmanager"; Description: "Network Manager & Diagnostics"; Types: full gamer developer itpro
Name: "tabs\top\tasksports"; Description: "Tasks, Services & Ports"; Types: full essentials gamer developer itpro
Name: "tabs\top\diagx"; Description: "UltimaDiagX (Crash & Event Analyzer)"; Types: full essentials gamer developer itpro

Name: "tabs\dev"; Description: "Dev & Work"; Types: full developer itpro
Name: "tabs\dev\github"; Description: "GitHub Manager"; Types: full developer
Name: "tabs\dev\jira"; Description: "Jira Manager"; Types: full developer
Name: "tabs\dev\wsl"; Description: "WSL Manager"; Types: full developer
Name: "tabs\dev\docker"; Description: "Docker & Local Dev Services"; Types: full developer
Name: "tabs\dev\sshcerts"; Description: "SSH Hosts & Certificate Inspector"; Types: full developer itpro
Name: "tabs\dev\homelab"; Description: "Multi-PC / Homelab Monitor"; Types: full developer itpro

Name: "tabs\ops"; Description: "Ops & Guard"; Types: full essentials gamer developer itpro
Name: "tabs\ops\alerts"; Description: "Smart Alerts & Watchdog Rules"; Types: full essentials gamer developer itpro
Name: "tabs\ops\updates"; Description: "Unified Update Center"; Types: full essentials gamer developer itpro
Name: "tabs\ops\snapshots"; Description: "System Snapshots & Diff"; Types: full essentials itpro
Name: "tabs\ops\backupsync"; Description: "Backup & Folder Sync Manager"; Types: full essentials developer itpro
Name: "tabs\ops\battery"; Description: "Battery & Wireless Peripherals"; Types: full essentials
Name: "tabs\ops\security"; Description: "Security & Repair Toolkit"; Types: full essentials itpro

Name: "tabs\system"; Description: "System & Hardware"; Types: full essentials gamer developer itpro
Name: "tabs\system\profiles"; Description: "System Profiles & Modes"; Types: full essentials gamer developer itpro
Name: "tabs\system\startup"; Description: "Startup Apps Manager"; Types: full essentials gamer developer itpro
Name: "tabs\system\sharing"; Description: "SMB Sharing Center"; Types: full itpro
Name: "tabs\system\apps"; Description: "Installed Apps & App Mover"; Types: full essentials developer itpro
Name: "tabs\system\appstore"; Description: "App Installer & Launcher"; Types: full essentials developer itpro
Name: "tabs\system\diskmap"; Description: "Disk Map (Visual Treemap)"; Types: full essentials gamer developer itpro
Name: "tabs\system\devices"; Description: "Devices & Drivers Tree"; Types: full itpro
Name: "tabs\system\organizer"; Description: "File Organizer"; Types: full essentials
Name: "tabs\system\rgbstudio"; Description: "RGB Lighting Studio (Direct USB HID / NVAPI / SMBus)"; Types: full essentials gamer developer

; Optional Runtime Components (physically omitted when unchecked)
Name: "extras"; Description: "Optional Hardware Components"; Types: full essentials gamer developer itpro
Name: "extras\sensors"; Description: "Hardware CPU Sensor Helper (LibreHardwareMonitor bridge for CPU die temps)"; Types: full essentials gamer developer itpro

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "Shortcuts:"
Name: "lowmemory"; Description: "Enable Low-Memory Mode (disables WebView2 GPU compositor; saves ~200 MB RAM)"; GroupDescription: "Performance:"; Flags: unchecked
Name: "installpawnio"; Description: "Install PawnIO signed kernel driver via WinGet (needed for CPU die temps & SMBus RAM RGB)"; GroupDescription: "Hardware Drivers:"; Check: not IsPawnIoInstalled; Flags: unchecked

[Files]
Source: "{#StageDir}\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion; Components: core
Source: "{#StageDir}\build-info.json"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist; Components: core
Source: "{#StageDir}\README.txt"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist; Components: core
Source: "{#StageDir}\sensors\*"; DestDir: "{app}\sensors"; Flags: ignoreversion recursesubdirs createallsubdirs skipifsourcedoesntexist; Components: extras\sensors

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; AppUserModelID: "com.corewatch.rust.dashboard"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon; AppUserModelID: "com.corewatch.rust.dashboard"

[Registry]
; Register AppUserModelId so Windows 10/11 Action Center displays native RustCoreWatch toast notifications
Root: HKCU; Subkey: "Software\Classes\AppUserModelId\com.corewatch.rust.dashboard"; ValueType: string; ValueName: "DisplayName"; ValueData: "RustCoreWatch"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\AppUserModelId\com.corewatch.rust.dashboard"; ValueType: string; ValueName: "IconUri"; ValueData: "{app}\{#MyAppExeName}"; Flags: uninsdeletekey

[UninstallDelete]
Type: files; Name: "{app}\installed-modules.json"
Type: filesandordirs; Name: "{app}\sensors"

[Run]
Filename: "winget.exe"; Parameters: "install --id namazso.PawnIO --source winget --accept-package-agreements --accept-source-agreements"; StatusMsg: "Installing PawnIO signed kernel driver via WinGet..."; Flags: waituntilterminated runhidden; Tasks: installpawnio; Check: not IsPawnIoInstalled
Filename: "{app}\{#MyAppExeName}"; Description: "Launch RustCoreWatch"; Flags: nowait postinstall skipifsilent

[Code]
var
  StartWithWindowsCheck: TNewCheckBox;
  FinishHintLabel: TNewStaticText;

function IsPawnIoInstalled(): Boolean;
begin
  Result := DirExists(ExpandConstant('{commonpf}\PawnIO')) or
            RegKeyExists(HKLM, 'SYSTEM\CurrentControlSet\Services\PawnIO');
end;

function IsStartWithWindowsConfigured(): Boolean;
var
  Existing: String;
begin
  Result := RegQueryStringValue(
    HKCU,
    'Software\Microsoft\Windows\CurrentVersion\Run',
    'RustCoreWatch',
    Existing
  ) and (Trim(Existing) <> '');
end;

function IsUpgradeInstall(): Boolean;
begin
  Result := FileExists(ExpandConstant('{localappdata}\com.corewatch.rust.dashboard\dashboard-preferences.json')) or
            IsStartWithWindowsConfigured();
end;

procedure InitializeWizard();
begin
  StartWithWindowsCheck := TNewCheckBox.Create(WizardForm.FinishedPage);
  StartWithWindowsCheck.Parent := WizardForm.FinishedPage;
  StartWithWindowsCheck.Caption := 'Start RustCoreWatch automatically with Windows';
  if IsUpgradeInstall() then
    StartWithWindowsCheck.Checked := IsStartWithWindowsConfigured()
  else
    StartWithWindowsCheck.Checked := True;

  FinishHintLabel := TNewStaticText.Create(WizardForm.FinishedPage);
  FinishHintLabel.Parent := WizardForm.FinishedPage;
  FinishHintLabel.Caption := 'Tip: You can toggle Start with Windows, Low-Memory Mode, or enable/hide any module anytime inside Settings.';
  FinishHintLabel.WordWrap := True;
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = wpFinished then begin
    // Keep Launch RustCoreWatch cleanly sized and position Start with Windows right below it
    if WizardForm.RunList.Visible then begin
      WizardForm.RunList.Height := ScaleY(28);
      StartWithWindowsCheck.Left := WizardForm.RunList.Left + ScaleX(3);
      StartWithWindowsCheck.Top := WizardForm.RunList.Top + WizardForm.RunList.Height + ScaleY(4);
      StartWithWindowsCheck.Width := WizardForm.RunList.Width - ScaleX(6);
    end else begin
      StartWithWindowsCheck.Left := WizardForm.FinishedLabel.Left;
      StartWithWindowsCheck.Top := WizardForm.FinishedLabel.Top + WizardForm.FinishedLabel.Height + ScaleY(16);
      StartWithWindowsCheck.Width := WizardForm.FinishedLabel.Width;
    end;
    StartWithWindowsCheck.Height := ScaleY(22);

    FinishHintLabel.Left := StartWithWindowsCheck.Left;
    FinishHintLabel.Top := StartWithWindowsCheck.Top + StartWithWindowsCheck.Height + ScaleY(12);
    FinishHintLabel.Width := StartWithWindowsCheck.Width;
  end;
end;

procedure AppendModuleIfSelected(const CompName, ModId: String; var List: String; var NotFirst: Boolean);
begin
  if WizardIsComponentSelected(CompName) then begin
    if NotFirst then
      List := List + ',';
    List := List + '"' + ModId + '"';
    NotFirst := True;
  end;
end;

procedure ApplyInstallConfiguration(const IncludeStartup: Boolean; const StartupEnabled: Boolean);
var
  ExePath, Params: String;
  ResultCode: Integer;
begin
  ExePath := ExpandConstant('{app}\{#MyAppExeName}');
  if not FileExists(ExePath) then Exit;

  Params := '--configure-install --apply-manifest';
  if WizardIsTaskSelected('lowmemory') then
    Params := Params + ' --low-memory=true'
  else
    Params := Params + ' --low-memory=false';

  if IncludeStartup then begin
    if StartupEnabled then
      Params := Params + ' --startup=true'
    else
      Params := Params + ' --startup=false';
  end;

  Exec(ExePath, Params, '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  ModList, JsonText, SetupType, StartupParam: String;
  NotFirst: Boolean;
begin
  if CurStep = ssPostInstall then begin
    ModList := '';
    NotFirst := False;

    AppendModuleIfSelected('tabs\top\netmanager', 'netmanager', ModList, NotFirst);
    AppendModuleIfSelected('tabs\top\tasksports', 'tasksports', ModList, NotFirst);
    AppendModuleIfSelected('tabs\top\diagx', 'diagx', ModList, NotFirst);

    AppendModuleIfSelected('tabs\dev\github', 'github', ModList, NotFirst);
    AppendModuleIfSelected('tabs\dev\jira', 'jira', ModList, NotFirst);
    AppendModuleIfSelected('tabs\dev\wsl', 'wsl', ModList, NotFirst);
    AppendModuleIfSelected('tabs\dev\docker', 'docker', ModList, NotFirst);
    AppendModuleIfSelected('tabs\dev\sshcerts', 'sshcerts', ModList, NotFirst);
    AppendModuleIfSelected('tabs\dev\homelab', 'homelab', ModList, NotFirst);

    AppendModuleIfSelected('tabs\ops\alerts', 'alerts', ModList, NotFirst);
    AppendModuleIfSelected('tabs\ops\updates', 'updates', ModList, NotFirst);
    AppendModuleIfSelected('tabs\ops\snapshots', 'snapshots', ModList, NotFirst);
    AppendModuleIfSelected('tabs\ops\backupsync', 'backupsync', ModList, NotFirst);
    AppendModuleIfSelected('tabs\ops\battery', 'battery', ModList, NotFirst);
    AppendModuleIfSelected('tabs\ops\security', 'security', ModList, NotFirst);

    AppendModuleIfSelected('tabs\system\profiles', 'profiles', ModList, NotFirst);
    AppendModuleIfSelected('tabs\system\startup', 'startup', ModList, NotFirst);
    AppendModuleIfSelected('tabs\system\sharing', 'sharing', ModList, NotFirst);
    AppendModuleIfSelected('tabs\system\apps', 'apps', ModList, NotFirst);
    AppendModuleIfSelected('tabs\system\appstore', 'appstore', ModList, NotFirst);
    AppendModuleIfSelected('tabs\system\diskmap', 'diskmap', ModList, NotFirst);
    AppendModuleIfSelected('tabs\system\devices', 'devices', ModList, NotFirst);
    AppendModuleIfSelected('tabs\system\organizer', 'organizer', ModList, NotFirst);
    AppendModuleIfSelected('tabs\system\rgbstudio', 'rgbstudio', ModList, NotFirst);

    if not WizardIsComponentSelected('extras\sensors') then
      DelTree(ExpandConstant('{app}\sensors'), True, True, True);

    SetupType := WizardSetupType(False);
    if SetupType = '' then
      SetupType := 'full';

    JsonText := '{' + #13#10 +
      '  "schemaVersion": 2,' + #13#10 +
      '  "version": "{#MyAppVersion}",' + #13#10 +
      '  "installType": "' + SetupType + '",' + #13#10 +
      '  "installedModules": [' + ModList + ']' + #13#10 +
      '}' + #13#10;
    SaveStringToFile(ExpandConstant('{app}\installed-modules.json'), JsonText, False);

    // Apply manifest & Low-Memory Mode immediately (also handles /VERYSILENT with optional /STARTUP=0|1)
    if WizardSilent() then begin
      StartupParam := ExpandConstant('{param:STARTUP|1}');
      ApplyInstallConfiguration(True, (StartupParam <> '0') and (Lowercase(StartupParam) <> 'false'));
    end else begin
      ApplyInstallConfiguration(False, False);
    end;
  end;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if CurPageID = wpFinished then begin
    // Apply final Finish-page Start with Windows toggle BEFORE Launch RustCoreWatch runs
    ApplyInstallConfiguration(True, StartWithWindowsCheck.Checked);
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  DataDir: String;
begin
  if CurUninstallStep = usPostUninstall then begin
    RegDeleteValue(HKCU, 'Software\Microsoft\Windows\CurrentVersion\Run', 'RustCoreWatch');
    DataDir := ExpandConstant('{localappdata}\com.corewatch.rust.dashboard');
    if DirExists(DataDir) and (not UninstallSilent()) then begin
      if MsgBox(
        'Do you also want to remove your saved RustCoreWatch preferences, profiles, and snapshots?' + #13#10 + #13#10 +
        'Folder: ' + DataDir,
        mbConfirmation,
        MB_YESNO or MB_DEFBUTTON2
      ) = IDYES then begin
        DelTree(DataDir, True, True, True);
      end;
    end;
  end;
end;
