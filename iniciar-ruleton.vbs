' Arranca el Ruleton sin dejar ninguna ventana abierta y abre el navegador
' cuando el servidor ya responde.
Option Explicit

Dim sh, fso, carpeta, log, i, listo

Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
carpeta = fso.GetParentFolderName(WScript.ScriptFullName)
log = sh.ExpandEnvironmentStrings("%TEMP%") & "\ruleton-server.log"
sh.CurrentDirectory = carpeta

' Si ya responde, solo se abre el navegador.
If Responde() Then
  sh.Run "http://localhost:3000", 1, False
  WScript.Quit 0
End If

' Primera vez: instalar dependencias.
If Not fso.FolderExists(carpeta & "\node_modules") Then
  ' El 0 oculta la ventana; el True espera a que termine.
  If sh.Run("cmd /c npm install > """ & log & """ 2>&1", 0, True) <> 0 Then
    Aviso "No se pudieron instalar las dependencias. Comprueba que Node.js este instalado." & vbCrLf & "Detalles en: " & log
    WScript.Quit 1
  End If
End If

' Arranca el servidor oculto y sin esperar.
sh.Run "cmd /c npm run dev > """ & log & """ 2>&1", 0, False

' Espera a que responda (maximo ~40 segundos).
listo = False
For i = 1 To 80
  WScript.Sleep 500
  If Responde() Then
    listo = True
    Exit For
  End If
Next

If listo Then
  sh.Run "http://localhost:3000", 1, False
Else
  Aviso "El servidor no arranco." & vbCrLf & "Revisa: " & log
  WScript.Quit 1
End If

WScript.Quit 0

' --- funciones ---

Function Responde()
  Dim http
  Responde = False
  On Error Resume Next
  Set http = CreateObject("MSXML2.XMLHTTP")
  http.Open "GET", "http://localhost:3000/api/settings", False
  http.Send
  If Err.Number = 0 And http.Status = 200 Then Responde = True
  On Error GoTo 0
End Function

Sub Aviso(mensaje)
  CreateObject("WScript.Shell").Popup mensaje, 0, "Ruleton", 16
End Sub
