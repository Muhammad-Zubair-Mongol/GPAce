@echo off
cd /d "%~dp0"
echo Installing npm dependencies...
call npm install

echo Starting server...
node server.js
pause
