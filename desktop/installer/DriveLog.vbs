' DriveLog launcher: runs in background without a console window
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
args = ""
For Each a In WScript.Arguments
  args = args & " " & a
Next
sh.Run """" & dir & "\node\drivelog-node.exe"" """ & dir & "\app\main.js""" & args, 0, False
