@echo off
rem PharmaTrack persistent launcher — runs on a dedicated port that stays up.
set PORT=5050
"%LOCALAPPDATA%\Programs\node-v24.18.0-win-x64\node.exe" --disable-warning=ExperimentalWarning "%~dp0server\index.js"
