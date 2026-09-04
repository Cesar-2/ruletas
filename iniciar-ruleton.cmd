@echo off
title Ruleton
cd /d "%~dp0"

REM Primera vez: instala dependencias si faltan.
if not exist "node_modules" (
  echo Instalando dependencias, esto puede tardar unos minutos...
  call npm install
  if errorlevel 1 (
    echo.
    echo No se pudieron instalar las dependencias. Revisa que Node.js este instalado.
    pause
    exit /b 1
  )
)

REM Si ya hay un servidor en el 3000, se abre el navegador y listo.
powershell -NoProfile -Command "try{(New-Object Net.Sockets.TcpClient).Connect('localhost',3000);exit 0}catch{exit 1}" >nul 2>&1
if not errorlevel 1 (
  echo El servidor ya estaba en marcha.
  start "" http://localhost:3000
  exit /b 0
)

echo Iniciando servidor...
start "Ruleton - servidor" /min cmd /c "npm run dev"

REM Espera a que el puerto responda antes de abrir el navegador (max ~30s).
powershell -NoProfile -Command "for($i=0;$i -lt 75;$i++){try{(New-Object Net.Sockets.TcpClient).Connect('localhost',3000);exit 0}catch{Start-Sleep -Milliseconds 400}}; exit 1"

if errorlevel 1 (
  echo.
  echo El servidor no arranco. Mira la ventana 'Ruleton - servidor' para ver el error.
  pause
  exit /b 1
)

start "" http://localhost:3000
exit /b 0
