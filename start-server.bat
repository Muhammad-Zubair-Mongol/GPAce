@echo off
cd /d "%~dp0"
echo Installing npm dependencies...
call npm install

echo Installing Python dependencies...
python -m pip install tavily-python || pip install tavily-python

echo Starting server...
node server.js
pause
