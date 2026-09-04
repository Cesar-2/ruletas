@echo off
title Detener Ruleton
cd /d "%~dp0"

REM ts-node-dev levanta un supervisor y un proceso trabajador: si solo se mata
REM el que escucha en el puerto, el supervisor lo vuelve a levantar. Por eso se
REM cierra el arbol entero.
powershell -NoProfile -Command "$p = Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'ts-node-dev|server\.ts' }; if ($p) { $p | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; exit 0 } else { exit 1 }"

if errorlevel 1 (
  mshta "javascript:new ActiveXObject('WScript.Shell').Popup('El Ruleton no estaba en marcha.',0,'Ruleton',64);close();"
) else (
  mshta "javascript:new ActiveXObject('WScript.Shell').Popup('Ruleton detenido.',0,'Ruleton',64);close();"
)
exit /b 0
