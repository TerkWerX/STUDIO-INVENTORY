@echo off
cd /d "%~dp0"
set "NODE_EXE=%~dp0.runtime\node.exe"
if not exist "%NODE_EXE%" set "NODE_EXE=node"
echo Starting Studio Inventory at http://localhost:3847
start "" "http://localhost:3847"
"%NODE_EXE%" server.js
pause
