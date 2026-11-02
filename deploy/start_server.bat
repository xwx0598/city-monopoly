@echo off
title City Monopoly - Local Server
cd /d "%~dp0"
chcp 65001 >nul 2>nul

where py >nul 2>nul
if %errorlevel%==0 (
  py -3 server.py %*
) else (
  where python >nul 2>nul
  if %errorlevel%==0 (
    python server.py %*
  ) else (
    echo.
    echo   [!] Python 3 not found.
    echo       Install it from https://www.python.org/downloads/
    echo       Remember to tick "Add python.exe to PATH" during setup.
    echo.
    pause
    exit /b 1
  )
)

echo.
echo   Server stopped. Press any key to close this window.
pause >nul
