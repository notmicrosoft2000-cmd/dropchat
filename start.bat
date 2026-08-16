@echo off
cd /d "%~dp0"
python server.py --name %COMPUTERNAME%
pause
