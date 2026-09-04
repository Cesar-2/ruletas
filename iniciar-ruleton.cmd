@echo off
title Ruleton
cd /d "%~dp0"

REM Este .cmd lo lanza iniciar-ruleton.vbs con la ventana oculta, asi que no
REM se usa 'pause' en ningun sitio: los errores se avisan con un cuadro de
REM dialogo, que si es visible.

REM Primera vez: instala dependencias si faltan.
if not exist "node_modules" (
  call npm install > "%TEMP%\ruleton-install.log" 2>&1
  if errorlevel 1 (
    call :aviso "No se pudieron instalar las dependencias. Comprueba que Node.js este instalado. Detalles en %TEMP%\ruleton-install.log"
    exit /b 1
  )
)

REM Si ya hay un servidor en el 3000, solo se abre el navegador.
powershell -NoProfile -Command "try{(New-Object Net.Sockets.TcpClient).Connect('localhost',3000);exit 0}catch{exit 1}" >nul 2>&1
if not errorlevel 1 (
  start "" http://localhost:3000
  exit /b 0
)

REM /b no abre ventana: el proceso hereda la consola oculta.
start "Ruleton - servidor" /b cmd /c "npm run dev > \"%TEMP%\ruleton-server.log\" 2>&1"

REM Espera a que el puerto responda antes de abrir el navegador (max ~30s).
powershell -NoProfile -Command "for($i=0;$i -lt 75;$i++){try{(New-Object Net.Sockets.TcpClient).Connect('localhost',3000);exit 0}catch{Start-Sleep -Milliseconds 400}}; exit 1"
if errorlevel 1 (
  call :aviso "El servidor no arranco. Revisa %TEMP%\ruleton-server.log"
  exit /b 1
)

start "" http://localhost:3000
exit /b 0

:aviso
mshta "javascript:var m='%~1';new ActiveXObject('WScript.Shell').Popup(m,0,'Ruleton',16);close();"
exit /b 0
