' Detiene el servidor sin mostrar consola (solo el aviso final).
Dim sh, carpeta
Set sh = CreateObject("WScript.Shell")
carpeta = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = carpeta
sh.Run """" & carpeta & "\detener-ruleton.cmd""", 0, False
