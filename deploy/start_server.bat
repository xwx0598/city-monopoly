@echo off
title Monopoly LAN Server - port 8686
echo ============================================
echo   Monopoly LAN Server
echo   Local:  http://localhost:8686
echo   LAN:    http://[your-ip]:8686   (run ipconfig to find it)
echo   Port:   8686  (bind 0.0.0.0)
echo   Close this window to stop the server.
echo ============================================
cd /d "%~dp0"
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 server.py
) else (
  python server.py
)
