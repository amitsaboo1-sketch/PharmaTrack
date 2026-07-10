' Launches the PharmaTrack server with no visible window (used by the auto-start task).
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run """" & dir & "\serve.cmd""", 0, False
