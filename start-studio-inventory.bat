@echo off
cd /d "%~dp0"
echo Starting Studio Inventory at http://localhost:3847
start "" "http://localhost:3847"
node server.js
pause