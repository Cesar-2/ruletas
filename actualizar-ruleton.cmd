@echo off
setlocal
title Actualizar Ruleton
cd /d "%~dp0"

REM Trae la ultima version sin perder los datos de esta instalacion
REM (exclusiones, rarezas, ganadores, ajustes). Los archivos de data\ se
REM apartan antes de actualizar y se devuelven a su sitio despues, porque
REM la actualizacion deja de versionarlos y Git los borraria del disco.

set "COPIA=data-backup"

if not exist "data" (
  call :aviso "No encuentro la carpeta data junto a este archivo. Ejecuta el script dentro de la carpeta del Ruleton."
  exit /b 1
)

echo Copiando datos a %COPIA% ...
if not exist "%COPIA%" mkdir "%COPIA%"
copy /y "data\*.json" "%COPIA%\" >nul
if errorlevel 1 (
  call :aviso "No se pudo copiar la carpeta data. No se ha cambiado nada."
  exit /b 1
)

REM Con los archivos ya a salvo, se descartan los cambios que Git aun vigila
REM para que la actualizacion no se quede a medias por un conflicto.
git checkout -- data 2>nul

echo Descargando la ultima version ...
git pull
if errorlevel 1 (
  call :restaurar
  call :aviso "La actualizacion fallo. Tus datos siguen intactos en data y en %COPIA%. Avisa antes de volver a intentarlo."
  exit /b 1
)

call :restaurar

echo.
echo Listo. Tus datos siguen en su sitio y hay una copia en %COPIA%.
echo Puedes borrar %COPIA% cuando compruebes que todo va bien.
echo.
pause
exit /b 0

:restaurar
echo Devolviendo tus datos a data\ ...
if not exist "data" mkdir "data"
copy /y "%COPIA%\*.json" "data\" >nul
exit /b 0

:aviso
mshta "javascript:var m='%~1';new ActiveXObject('WScript.Shell').Popup(m,0,'Ruleton',16);close();"
exit /b 0
