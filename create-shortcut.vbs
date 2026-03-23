Set ws = CreateObject("WScript.Shell")
Set shortcut = ws.CreateShortcut(ws.SpecialFolders("Desktop") & "\Pokemon Monitor.lnk")
shortcut.TargetPath = ws.CurrentDirectory & "\start.vbs"
shortcut.WorkingDirectory = ws.CurrentDirectory
shortcut.WindowStyle = 1
shortcut.Description = "Pokemon Target Monitor"
shortcut.Save
WScript.Echo "Shortcut updated on Desktop!"
