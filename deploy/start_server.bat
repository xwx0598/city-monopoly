@echo off
title Monopoly LAN Server - http://172.31.17.226:8686
echo ============================================
echo   Monopoly LAN Server
echo   URL: http://172.31.17.226:8686
echo   Port: 8686  (bind 0.0.0.0)
echo   Close this window to stop the server.
echo ============================================
cd /d "F:\WorkBuddy\2026-10-28-15-50-18\deploy"
py -3 -m http.server 8686 --bind 0.0.0.0
