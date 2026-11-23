; DriveLog 설치 프로그램 (Inno Setup 6)
#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif

[Setup]
AppId={{6F1C2B9E-4D7A-4B5E-9C61-DRIVELOG0001}
AppName=DriveLog
AppVersion={#AppVersion}
AppPublisher=DriveLog
DefaultDirName={localappdata}\DriveLog
PrivilegesRequired=lowest
DisableProgramGroupPage=yes
DisableDirPage=yes
OutputDir=..\..\dist
OutputBaseFilename=DriveLog-Setup
SetupIconFile=icon.ico
UninstallDisplayIcon={app}\icon.ico
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=no

[Languages]
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"

[Files]
Source: "..\..\stage\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion createallsubdirs

[Icons]
Name: "{userprograms}\DriveLog 설정"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\DriveLog.vbs"" --open"; IconFilename: "{app}\icon.ico"
Name: "{userstartup}\DriveLog"; Filename: "{sys}\wscript.exe"; Parameters: """{app}\DriveLog.vbs"""; IconFilename: "{app}\icon.ico"

[Run]
Filename: "{sys}\wscript.exe"; Parameters: """{app}\DriveLog.vbs"" --open"; Description: "DriveLog 설정 화면 열기"; Flags: nowait postinstall

[UninstallRun]
Filename: "{sys}\taskkill.exe"; Parameters: "/F /T /IM drivelog-node.exe"; Flags: runhidden; RunOnceId: "KillNode"
Filename: "{sys}\taskkill.exe"; Parameters: "/F /IM drivelog-tunnel.exe"; Flags: runhidden; RunOnceId: "KillTunnel"
Filename: "{sys}\taskkill.exe"; Parameters: "/F /IM fleet-telemetry.exe"; Flags: runhidden; RunOnceId: "KillTelemetry"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Code: Integer;
begin
  { 업데이트 설치 시 실행 중인 DriveLog를 먼저 종료 }
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /T /IM drivelog-node.exe', '', SW_HIDE, ewWaitUntilTerminated, Code);
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /IM drivelog-tunnel.exe', '', SW_HIDE, ewWaitUntilTerminated, Code);
  Exec(ExpandConstant('{sys}\taskkill.exe'), '/F /IM fleet-telemetry.exe', '', SW_HIDE, ewWaitUntilTerminated, Code);
  Result := '';
end;
