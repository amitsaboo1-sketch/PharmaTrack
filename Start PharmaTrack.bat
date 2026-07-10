@echo off
title PharmaTrack
rem The server auto-starts at logon (Startup\PharmaTrackServer.vbs) on http://localhost:5050.
rem This opens the app, and only launches a copy if the server is not already running.
start "" http://localhost:5050
powershell -NoProfile -Command "if (-not (Get-NetTCPConnection -LocalPort 5050 -State Listen -ErrorAction SilentlyContinue)) { Start-Process wscript.exe -ArgumentList '\"%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\PharmaTrackServer.vbs\"' }"
