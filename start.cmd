@echo off
chcp 65001 >nul
node "%~dp0scripts\start.mjs"
exit /b %errorlevel%
