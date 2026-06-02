#define AppName "CQClaw"
#define AppVersion "2.0.12"
#define AppPublisher "CQClaw"
#define SourceRoot "..\.."

[Setup]
AppId={{8792E4DE-8C5E-4F9B-8A4E-91C2DFB6F1A6}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={localappdata}\CQClaw
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\..\dist
OutputBaseFilename=CQClaw-Setup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ChangesEnvironment=yes
UsePreviousAppDir=no
UninstallDisplayIcon={app}\desktop\launch-client.vbs

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Shortcuts:"; Flags: checkedonce
Name: "autostart"; Description: "Start CQClaw automatically when I sign in"; GroupDescription: "Startup:"; Flags: unchecked
Name: "startnow"; Description: "Start the CQClaw service after installation"; GroupDescription: "After installation:"; Flags: checkedonce
Name: "launchclient"; Description: "Open CQClaw Client after installation"; GroupDescription: "After installation:"; Flags: checkedonce

[Files]
Source: "{#SourceRoot}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs; Excludes: ".git\*,.venv\*,__pycache__\*,*.pyc,*.pyo,.DS_Store,dist\*,build\*,data\runtime\*,data\tmp-scripts\*,desktop\tauri-client\node_modules\*,desktop\tauri-client\src-tauri\target\*"
Source: "{#SourceRoot}\desktop\tauri-client\src-tauri\target\release\cqclaw-client.exe"; DestDir: "{app}"; DestName: "CQClaw.exe"; Flags: ignoreversion

[Icons]
Name: "{group}\CQClaw"; Filename: "{app}\CQClaw.exe"; WorkingDir: "{app}"
Name: "{userdesktop}\CQClaw"; Filename: "{app}\CQClaw.exe"; WorkingDir: "{app}"; Tasks: desktopicon

[Run]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\packaging\windows\postinstall-inno.ps1"" {code:GetPostInstallArgs}"; WorkingDir: "{app}"; Flags: runhidden waituntilterminated
Filename: "{app}\CQClaw.exe"; WorkingDir: "{app}"; Tasks: launchclient; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\uninstall.ps1"""; Flags: runhidden waituntilterminated

[Code]
function GetPostInstallArgs(Param: String): String;
begin
  Result := '';
  if WizardIsTaskSelected('autostart') then
    Result := Result + ' -EnableAutostart';
  if WizardIsTaskSelected('startnow') then
    Result := Result + ' -StartNow';
end;
